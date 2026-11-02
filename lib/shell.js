/**
 * Persistent PowerShell.
 *
 * `ctx.shell` resolves and runs one process per call, so `cd`, `$env:X = ...`
 * and anything started in the background are gone by the next call. That is the
 * single largest source of wasted turns in shell work: every call has to
 * re-establish where it is before doing anything.
 *
 * This module keeps one long-lived PowerShell per agent and drives it over
 * stdin. Four details in the protocol are load-bearing, and each was found by
 * watching it fail:
 *
 * 1. The payload must end with a BLANK line. PowerShell 5.1 in `-Command -`
 *    mode does not execute a statement block until it reads an empty line: a
 *    payload ending right after the closing brace waits forever with no output
 *    and no error. Measured: `"& { 'hi' }\n"` prints nothing in 4 s;
 *    `"& { 'hi' }\n\n"` prints immediately.
 * 2. The body is dot-sourced from a ScriptBlock, not invoked with `& { }`.
 *    `&` runs the body in a child scope, so `Set-Location` reverts when the
 *    block ends — a session that "persists" but silently returns to the start
 *    directory every call. Dot-sourcing keeps the location change.
 * 3. Building the ScriptBlock inside try/catch means a syntax error is a
 *    reported error instead of a payload that never emits its end marker and
 *    hangs until the timeout.
 * 4. Output goes through `[Console]::Out.WriteLine`, so table formatting,
 *    column widths and progress bars never enter the captured text.
 * 5. The payload is BASE64, and stdout is pinned to UTF-8, because Windows
 *    PowerShell 5.1 decodes `-Command -` stdin with the ANSI code page while
 *    `child.stdout.setEncoding('utf8')` decodes output as UTF-8 — those two
 *    disagree on every byte above 0x7F. Measured before the fix: a body
 *    containing `D:\工作区\...` reached the child as mojibake, so
 *    `Test-Path -LiteralPath` returned False for a file that exists, and any
 *    CJK the script printed came back as U+FFFD. The wrapper is therefore
 *    assembled as a JS string, base64-encoded to pure ASCII, and decoded
 *    inside the child; the stub also sets
 *    `[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false`
 *    so non-ASCII output is emitted as the UTF-8 bytes the parent expects.
 *
 * Sessions are keyed by agent id, so two agents never share a working directory
 * or an environment. Idle sessions are reaped after shellIdleMs.
 */

import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

const MAX_CAPTURED_LINES = 4000
const MAX_CAPTURED_CHARS = 200_000

/**
 * Candidate shells, best first.
 *
 * `pwsh` (PowerShell 7) is preferred, but it is not installed on every Windows
 * machine — this one has only Windows PowerShell 5.1. Both accept
 * `-Command -` and both read the script incrementally from stdin, which is the
 * only property a persistent session needs.
 */
const SHELL_CANDIDATES =
  process.platform === 'win32'
    ? [
        { exe: 'pwsh' },
        { exe: join(process.env.ProgramFiles ?? 'C:\\Program Files', 'PowerShell', '7', 'pwsh.exe') },
        { exe: 'powershell.exe' },
      ]
    : [{ exe: 'pwsh' }]

/**
 * Resolve an executable the way a shell would, so candidate selection is a
 * deterministic decision here instead of a guess that fails later inside a
 * child process.
 */
function resolveOnPath(exe) {
  if (exe.includes('\\') || exe.includes('/')) return existsSync(exe) ? exe : null
  const dirs = String(process.env.PATH ?? '').split(process.platform === 'win32' ? ';' : ':')
  const exts =
    process.platform === 'win32'
      ? String(process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').filter(Boolean)
      : ['']
  for (const dir of dirs) {
    const trimmed = dir.trim()
    if (trimmed.length === 0) continue
    for (const ext of exts) {
      const full = join(trimmed, exe.toLowerCase().endsWith(ext.toLowerCase()) ? exe : `${exe}${ext}`)
      if (existsSync(full)) return full
    }
  }
  return null
}

/** The shells this machine actually has, best first. */
function availableShells() {
  const usable = []
  for (const candidate of SHELL_CANDIDATES) {
    const resolved = resolveOnPath(candidate.exe)
    if (resolved !== null) usable.push(resolved)
  }
  return usable
}

/** PowerShell single-quoted literal: no expansion, internal quote doubled. */
export function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}

class ShellSession {
  constructor(key, options) {
    this.key = key
    this.options = options
    this.child = null
    this.buffer = ''
    this.pending = null
    this.idleTimer = null
    this.closed = false
    this.startedAt = Date.now()
    this.runs = 0
    this.exe = null
  }

  #spawn() {
    const shells = this.options.shells ?? availableShells()
    if (shells.length === 0) {
      throw new Error(
        'no PowerShell found: neither pwsh nor powershell.exe resolves from PATH. ' +
          'Install PowerShell 7, or set shellEnabled:false to use one process per call.',
      )
    }
    const exe = shells[0]
    const child = spawn(exe, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '-'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env, TERM: 'dumb', NO_COLOR: '1' },
    })
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => this.#onData(chunk))
    child.stderr.on('data', (chunk) => this.#onData(chunk))
    child.on('exit', (code, signal) => this.#onExit(code, signal))
    child.on('error', (error) => {
      const pending = this.pending
      this.pending = null
      this.child = null
      pending?.reject(
        new Error(
          `could not start ${exe}: ${error.message}. ` +
            'Set shellEnabled:false to fall back to one process per call.',
        ),
      )
    })
    this.exe = exe
    this.child = child
    return child
  }

  #onData(chunk) {
    this.buffer += chunk
    const pending = this.pending
    if (pending === null) return
    const endAt = this.buffer.indexOf(pending.endMarker)
    if (endAt === -1) {
      if (this.buffer.length > MAX_CAPTURED_CHARS * 4) {
        this.buffer = this.buffer.slice(-MAX_CAPTURED_CHARS)
        pending.truncated = true
      }
      return
    }
    const full = this.buffer
    const rest = full.slice(endAt + pending.endMarker.length)
    // Keep only what follows the marker's line: the exit-code line itself is
    // consumed here, and its newline must not leak into the next call's output.
    const newlineAt = rest.indexOf('\n')
    this.buffer = newlineAt === -1 ? '' : rest.slice(newlineAt + 1)
    this.pending = null
    clearTimeout(pending.timer)
    pending.resolve({ ...parseCapture(full, pending.startMarker, pending.endMarker), truncated: pending.truncated === true })
  }

  #onExit(code, signal) {
    this.child = null
    const pending = this.pending
    this.pending = null
    if (pending !== null) {
      clearTimeout(pending.timer)
      pending.reject(
        new Error(
          `PowerShell exited before finishing (code ${code ?? 'null'}, signal ${signal ?? 'none'}). ` +
            'The session is reset; the next call starts a fresh shell.',
        ),
      )
    }
  }

  #touch() {
    if (this.idleTimer !== null) clearTimeout(this.idleTimer)
    const idle = this.options.idleMs
    if (!Number.isFinite(idle) || idle <= 0) return
    this.idleTimer = setTimeout(() => this.close('idle'), idle)
    this.idleTimer.unref?.()
  }

  async run(script, { timeoutMs, cwd } = {}) {
    if (this.closed) throw new Error('shell session is closed')
    const child = this.child ?? this.#spawn()
    if (child.stdin.destroyed) throw new Error('shell stdin is closed; session reset')

    const token = randomUUID().replace(/-/g, '').slice(0, 12)
    const startMarker = `__DSH2027_START_${token}__`
    const endMarker = `__DSH2027_END_${token}__`
    const body = String(script ?? '')

    const lines = ['$global:LASTEXITCODE = 0', '$__dsh2027_bad = $null', 'try {']
    if (typeof cwd === 'string' && cwd.trim().length > 0) {
      lines.push(`  Set-Location -LiteralPath ${psQuote(cwd.trim())}`)
    }
    lines.push(`  $__dsh2027_sb = [ScriptBlock]::Create(${psQuote(body)})`)
    // Dot-sourced, so Set-Location and function definitions survive the call.
    lines.push('  . $__dsh2027_sb 2>&1 | ForEach-Object { [Console]::Out.WriteLine("$_") }')
    lines.push('} catch {')
    lines.push('  $__dsh2027_bad = [string]$_')
    // A parse error never ran a statement, so $LASTEXITCODE still holds the
    // previous call's value. Reporting 0 for a script that never executed is
    // worse than reporting a failure, so the catch sets it explicitly.
    lines.push('  $global:LASTEXITCODE = 1')
    lines.push('  [Console]::Out.WriteLine([string]$__dsh2027_bad)')
    lines.push('}')
    lines.push(`[Console]::Out.WriteLine(${psQuote(startMarker)})`)
    lines.push(
      `[Console]::Out.WriteLine(${psQuote(endMarker)} + [string]$LASTEXITCODE + $(if ($null -ne $__dsh2027_bad) { '|error' } else { '|ok' }))`,
    )
    // The wrapper travels as base64: see note 5 at the top. Every byte written
    // to stdin is then ASCII, so the child's codepage cannot corrupt the body,
    // and the stub pins the output side to the encoding the parent decodes.
    const wrapper = lines.join('\n')
    const payload = [
      'try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch { }',
      `$__dsh2027_wrapper = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(wrapper, 'utf8').toString('base64')}'))`,
      // A wrapper that fails to compile must still emit the end marker: without
      // it the parent waits for output that never arrives and reports a timeout
      // instead of the syntax error. This guard only fires on a defect in the
      // code above; the body's own errors are caught inside the wrapper.
      'try {',
      '  . ([ScriptBlock]::Create($__dsh2027_wrapper))',
      '} catch {',
      '  [Console]::Out.WriteLine([string]$_)',
      `  [Console]::Out.WriteLine(${psQuote(endMarker)} + '1|error')`,
      '}',
      // The trailing empty lines commit the block: see note 1 at the top.
      '',
      '',
    ].join('\n')
    const limit = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : this.options.timeoutMs

    const result = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending !== null) {
          this.pending = null
          this.close('timeout')
          reject(
            new Error(
              `command exceeded ${limit} ms and the shell was killed. ` +
                'A script that waits for input looks identical to this; so does one that never finishes. ' +
                'Raise shellTimeoutMs or run the long step as a background job.',
            ),
          )
        }
      }, limit)
      timer.unref?.()
      this.pending = { resolve, reject, timer, startMarker, endMarker, truncated: false }
    })

    child.stdin.write(payload)
    this.runs += 1
    this.#touch()
    const captured = await result
    this.#touch()
    return captured
  }

  close(reason = 'closed') {
    if (this.closed) return
    this.closed = true
    if (this.idleTimer !== null) clearTimeout(this.idleTimer)
    this.idleTimer = null
    const child = this.child
    this.child = null
    if (child !== null) {
      try {
        child.stdin.end()
      } catch {}
      // Kill the whole tree, not just the shell. A script that starts a server,
      // a build or a background job leaves descendants whose parent is this
      // PowerShell; child.kill() reaches only the direct child, and those
      // grandchildren outlive the session as orphans. Measured: pwsh -> cmd ->
      // `timeout` — after close() the pwsh was gone and the process two levels
      // down was still running.
      if (process.platform === 'win32' && Number.isFinite(child.pid)) {
        try {
          spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
            stdio: 'ignore',
            windowsHide: true,
            timeout: 5000,
          })
        } catch {}
      }
      try {
        child.kill()
      } catch {}
    }
    if (this.pending !== null) {
      const pending = this.pending
      this.pending = null
      clearTimeout(pending.timer)
      pending.reject(new Error(`shell session closed (${reason})`))
    }
  }

  status() {
    return {
      key: this.key,
      alive: this.child !== null && !this.closed,
      exe: this.exe,
      pid: this.child?.pid ?? null,
      runs: this.runs,
      uptimeMs: Date.now() - this.startedAt,
    }
  }
}

function parseCapture(full, startMarker, endMarker) {
  const startAt = full.indexOf(startMarker)
  const body = startAt === -1 ? full : full.slice(0, startAt)
  const lines = body.replace(/\r\n/g, '\n').split('\n')
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop()
  let truncated = false
  let kept = lines
  if (kept.length > MAX_CAPTURED_LINES) {
    kept = kept.slice(-MAX_CAPTURED_LINES)
    truncated = true
  }
  let joined = kept.join('\n')
  if (joined.length > MAX_CAPTURED_CHARS) {
    joined = joined.slice(-MAX_CAPTURED_CHARS)
    truncated = true
  }
  // The end marker carries "<exitCode>|ok" or "<exitCode>|error".
  const tailLine = full.slice(full.indexOf(endMarker) + endMarker.length).split('\n')[0] ?? ''
  const [codeText = '', flagText = ''] = tailLine.replace(/\r/g, '').trim().split('|')
  const failed = flagText === 'error'
  const parsed = Number.parseInt(codeText, 10)
  // A caught parse error never ran a statement, so the reported code can still
  // be the last successful command's 0. A script that did not run is a failure.
  const exitCode = failed
    ? Number.isFinite(parsed) && parsed !== 0
      ? parsed
      : 1
    : Number.isFinite(parsed)
      ? parsed
      : null
  return {
    output: joined,
    lineCount: kept.length,
    exitCode,
    failed,
    truncated,
  }
}

export class ShellPool {
  #sessions = new Map()
  #options

  constructor(options) {
    this.#options = options
  }

  get size() {
    return this.#sessions.size
  }

  #key(agent) {
    const id = typeof agent === 'object' && agent !== null ? agent.id : undefined
    const raw = typeof id === 'string' && id.length > 0 ? id : 'unbound'
    return raw.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120)
  }

  session(agent) {
    const key = this.#key(agent)
    let session = this.#sessions.get(key)
    if (session === undefined || session.closed) {
      session = new ShellSession(key, this.#options)
      this.#sessions.set(key, session)
    }
    return session
  }

  async run(agent, script, options) {
    return this.session(agent).run(script, options)
  }

  reset(agent) {
    const key = this.#key(agent)
    const session = this.#sessions.get(key)
    if (session === undefined) return false
    session.close('reset')
    this.#sessions.delete(key)
    return true
  }

  status(agent) {
    const key = this.#key(agent)
    const session = this.#sessions.get(key)
    return session === undefined
      ? { key, alive: false, exe: null, pid: null, runs: 0, uptimeMs: 0 }
      : session.status()
  }

  disposeAll() {
    for (const session of this.#sessions.values()) session.close('dispose')
    this.#sessions.clear()
  }
}
