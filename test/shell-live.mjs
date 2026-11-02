/**
 * Does the persistent shell actually persist?
 *
 * The claim this plugin makes is that Set-Location, environment variables and a
 * background process survive from one call to the next. That claim is only
 * worth making if it is tested against the real pwsh on this machine, because
 * the failure mode — a shell that silently restarts — looks exactly like
 * success in a single call.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 "DeepSeek Harness.exe" test/shell-live.mjs
 */

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { ShellPool } from '../lib/shell.js'

/**
 * A path that is guaranteed to contain non-ASCII on this machine, discovered
 * rather than hard-coded: the suite must stay valid if the plugin is moved out
 * of a CJK directory. Falls back to a constructed name, which still exercises
 * the stdin decoder even though the file does not exist — the check then asks
 * for False instead of True.
 */
const thisFile = fileURLToPath(import.meta.url)
const nonAscii = /[^\x00-\x7F]/.test(thisFile)
const cjkProbePath = nonAscii ? thisFile : `${thisFile.slice(0, thisFile.lastIndexOf('\\'))}\\会话1-probe.js`

const results = []
let failures = 0

function check(label, condition, detail) {
  if (condition) results.push(`ok   ${label}`)
  else {
    failures += 1
    results.push(`FAIL ${label}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

/**
 * Is this pid still running? `tasklist /FI` prints an INFO line instead of a row
 * when nothing matches, so the pid has to appear as the image-name column's own
 * field rather than as a substring of the header.
 */
function alive(pid) {
  if (!Number.isFinite(pid)) return false
  const out = spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH', '/FO', 'CSV'], {
    encoding: 'utf8',
    windowsHide: true,
  })
  return out.stdout.includes(`"${pid}"`)
}

const pool = new ShellPool({ timeoutMs: 30_000, idleMs: 0 })
// A plain object is all the pool needs from an agent: it keys sessions by id.
const agent = { id: 'smoke-agent' }

try {
  const first = await pool.run(agent, '$env:DSH2027_PROBE = "kept"\nSet-Location $env:USERPROFILE\n(Get-Location).Path')
  check('the first call runs', first.exitCode === 0, first.output)
  const where = first.output.trim().split('\n').pop() ?? ''
  check('Set-Location took effect inside the call', where.toLowerCase().includes('users'), where)

  const second = await pool.run(agent, '$env:DSH2027_PROBE')
  check('the environment variable survived to the next call', second.output.trim() === 'kept', second.output)

  const third = await pool.run(agent, '(Get-Location).Path')
  check(
    'the working directory survived to the next call',
    third.output.trim().toLowerCase().includes('users'),
    third.output,
  )

  const pid = await pool.run(agent, '$PID')
  const pid2 = await pool.run(agent, '$PID')
  check('both calls used the same process', pid.output.trim() === pid2.output.trim(), `${pid.output} vs ${pid2.output}`)

  const failed = await pool.run(agent, 'throw "boom"')
  check('a terminating error is reported, not swallowed', failed.output.includes('boom'), failed.output)

  const exit = await pool.run(agent, 'cmd /c exit 3')
  check('the exit code is captured', exit.exitCode === 3, String(exit.exitCode))

  const syntax = await pool.run(agent, 'if (')
  check('a syntax error does not hang the session', syntax.exitCode !== 0, String(syntax.exitCode))

  const after = await pool.run(agent, '"still alive"')
  check('the session is still usable after a syntax error', after.output.trim() === 'still alive', after.output)

  // Windows PowerShell 5.1 decodes `-Command -` stdin with the ANSI code page
  // while the parent decodes stdout as UTF-8, so anything above 0x7F used to be
  // mangled in both directions. The payload is base64 for that reason; these
  // checks fail loudly if that wrapper is ever simplified back to plain text.
  const cjkPath = await pool.run(agent, `Test-Path -LiteralPath '${cjkProbePath}'`)
  check(
    'a non-ASCII path survives stdin',
    cjkPath.output.trim() === (nonAscii ? 'True' : 'False'),
    `${cjkPath.output} for ${cjkProbePath}`,
  )
  const cjkOut = await pool.run(agent, "'中文输出'")
  check('non-ASCII output survives stdout', cjkOut.output.trim() === '中文输出', cjkOut.output)
  const cjkRound = await pool.run(agent, "$s = '会话一'; 'len=' + $s.Length")
  check('non-ASCII keeps its character count', cjkRound.output.trim() === 'len=3', cjkRound.output)

  pool.reset(agent)
  const fresh = await pool.run(agent, '$env:DSH2027_PROBE')
  check('reset clears the environment', fresh.output.trim() === '', fresh.output)

  const status = pool.status(agent)
  check('status reports a live process', status.alive === true && typeof status.pid === 'number', JSON.stringify(status))

  // A shell that started a background process must take that process down with
  // it. `child.kill()` alone leaves the grandchildren running: measured
  // pwsh -> cmd -> timeout, where the pwsh died and the timeout survived.
  const spawn = await pool.run(
    agent,
    '$p = Start-Process -FilePath cmd.exe -ArgumentList "/c","ping -n 60 127.0.0.1" -PassThru -WindowStyle Hidden\n$p.Id',
  )
  const grandchild = Number(spawn.output.trim().split('\n').pop())
  check('a background process can be started', Number.isFinite(grandchild), spawn.output)
  check('the background process is alive before close', alive(grandchild) === true, String(grandchild))

  const shellPid = pool.status(agent).pid
  pool.reset(agent)
  await new Promise((resolve) => setTimeout(resolve, 500))
  check('close kills the shell itself', alive(shellPid) === false, String(shellPid))
  check('close kills the process the shell started', alive(grandchild) === false, String(grandchild))
  if (alive(grandchild)) {
    spawnSync('taskkill', ['/pid', String(grandchild), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
  }
} finally {
  pool.disposeAll()
}

const summary = [
  ...results,
  '',
  failures === 0 ? `all ${results.length} checks passed` : `${failures} of ${results.length} checks FAILED`,
].join('\n')
process.stdout.write(`${summary}\n`)
process.exitCode = failures === 0 ? 0 : 1
