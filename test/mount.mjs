/**
 * Mount test: does apply() wire everything up against a real-shaped context?
 *
 * Importing a module proves it parses. It does not prove that the three
 * `systemPrompt.context()` calls register without name collisions, that every
 * tool definition carries the mandatory `output.render`, or that `/dopt2027`
 * registers at all. Those are the failures that show up as a dead plugin after
 * a restart, and they are cheap to catch here.
 *
 * The context below is a stub, not a Cordis context: it records what the plugin
 * registers and answers the few service shapes apply() reads. That is enough to
 * catch a wrong signature, and it does not pretend to test the harness.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 "DeepSeek Harness.exe" test/mount.mjs
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'dsh2027-mount-'))
// resolveDataDir() reads DSH_HOME; pointing it at the temp dir keeps the test
// out of the real profile data.
process.env.DSH_HOME = dir

const { apply, Config } = await import('../index.js')
const { DEFAULT_LEVEL } = await import('../lib/levels.js')

const results = []
let failures = 0
function check(label, condition, detail) {
  if (condition) results.push(`ok   ${label}`)
  else {
    failures += 1
    results.push(`FAIL ${label}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

function makeContext() {
  const record = {
    contexts: [],
    sections: [],
    tools: [],
    commands: [],
    effects: [],
    listeners: [],
    warnings: [],
    infos: [],
    routes: [],
  }

  // Every context, root or injected, writes into the same record so the checks
  // below see the whole wiring regardless of which scope registered it.
  const makeCtx = () => {
    const ctx = {}
    ctx.ownTools = []
    ctx.ownCommands = []
    ctx.ownEffects = []
    ctx.logger = {
      warn: (message) => record.warnings.push(String(message)),
      info: (message) => record.infos.push(String(message)),
    }
    ctx.effect = (factory, label) => {
      const dispose = factory()
      ctx.ownEffects.push({ label, dispose })
      record.effects.push({ label, dispose })
      return dispose
    }
    ctx.on = (name, handler) => {
      record.listeners.push({ name, handler })
      return () => {}
    }
    ctx.systemPrompt = {
      context: (promptContext) => {
        record.contexts.push(promptContext)
        return () => {}
      },
      section: (section) => {
        record.sections.push(section)
        return () => {}
      },
      assemble: async () => ({
        sections: [{ text: 'S' }],
        contexts: [{ text: '## Runtime context (stub)\nC' }],
        tools: [
          {
            name: 'stub_tool',
            description: 'A stub tool.',
            parameters: {
              type: 'object',
              properties: {
                p: { type: 'string' },
                mode: { type: 'string', enum: ['fast', 'slow'] },
                note: { type: 'string' },
              },
              required: ['p'],
            },
          },
        ],
      }),
    }
    ctx.toolsService = {
      // The real registry drops a tool when its disposer runs. A stub that keeps
      // the definition after disposal would hide a real class of bug: a removed
      // tool still being sent, or still being charged for in the cost table.
      register: (definition) => {
        ctx.ownTools.push(definition)
        record.tools.push(definition)
        return () => {
          for (const list of [ctx.ownTools, record.tools]) {
            const at = list.indexOf(definition)
            if (at >= 0) list.splice(at, 1)
          }
        }
      },
    }
    // The real registry throws on a bad name and on a duplicate. A stub that
    // accepts anything hides exactly the class of bug this file exists to catch,
    // so both rules are enforced here too.
    ctx.commandsService = {
      register: (definition) => {
        if (!/^[a-z][a-z0-9_-]*$/u.test(definition.name)) {
          throw new TypeError(`command name "${definition.name}" must match /^[a-z][a-z0-9_-]*$/u`)
        }
        if (record.commands.some((entry) => entry.name === definition.name)) {
          throw new Error(`command "${definition.name}" is already registered`)
        }
        ctx.ownCommands.push(definition)
        record.commands.push(definition)
        return () => {}
      },
    }
    // The real route table throws on a duplicate (kind, path) pair, so this
    // stub does too: a second registration would fail the whole entry at load.
    ctx.webServerService = {
      register: (route) => {
        if (record.routes.some((entry) => entry.kind === route.kind && entry.path === route.path)) {
          throw new Error(`route ${route.kind} ${route.path} is already registered`)
        }
        record.routes.push(route)
        return () => {}
      },
    }
    // Four live agents: agent-1 and agent-2 carry the earlier command checks, so
    // the session-scoping checks below get their own untouched pair.
    const LIVE = [{ id: 'agent-1' }, { id: 'agent-2' }, { id: 'agent-3' }, { id: 'agent-4' }]
    ctx.agentsService = {
      roots: () => LIVE.slice(),
      list: () => LIVE.slice(),
    }
    ctx.get = (name) => {
      if (name === 'tools') return ctx.toolsService
      if (name === 'commands') return ctx.commandsService
      if (name === 'webServer') return ctx.webServerService
      if (name === 'agents') return ctx.agentsService
      return undefined
    }
    ctx.inject = (deps, callback) => callback(makeCtx())
    return ctx
  }

  return { ctx: makeCtx(), record }
}

const { ctx, record } = makeContext()
// The Host hands apply() the validated value, not the schema object.
apply(ctx, Config['~standard'].validate({ level: 2 }).value)

// -------------------------------------------------------------- config shape

// The Host reads Config['~standard'].validate before apply() runs. Without it
// the entry fails to load with no message of its own, so this is checked first.
check('Config exposes the standard-schema protocol', typeof Config?.['~standard']?.validate === 'function')
check('Config declares its vendor', Config['~standard'].vendor === 'dsh-optimization-2027')
check('Config serializes to a schema the settings form can read', Config.toJSON().type === 'object')

const validated = Config['~standard'].validate({ level: 99, shellEnabled: 'yes', bogus: 1 })
check('validation returns a value rather than throwing', typeof validated?.value === 'object')
check('an out-of-range level is clamped by validation', validated.value.level === 4, String(validated.value.level))
check('a non-false shellEnabled is read as on', validated.value.shellEnabled === true)
check('an unknown key is dropped by validation', !('bogus' in validated.value))
const emptyValidated = Config['~standard'].validate(undefined)
check('validating nothing yields the defaults', emptyValidated.value.level === DEFAULT_LEVEL && emptyValidated.value.shellEnabled === true)
check('the default tier is the off switch', DEFAULT_LEVEL === 0, String(DEFAULT_LEVEL))

// ------------------------------------------------------------- prompt wiring

check('two runtime contexts registered', record.contexts.length === 2, String(record.contexts.length))
check(
  'context names are unique and namespaced',
  new Set(record.contexts.map((entry) => entry.name)).size === 2 &&
    record.contexts.every((entry) => entry.name.startsWith('dsh-optimization-2027:')),
  record.contexts.map((entry) => entry.name).join(', '),
)
check(
  'context orders are distinct',
  new Set(record.contexts.map((entry) => entry.order)).size === 2,
  record.contexts.map((entry) => entry.order).join(', '),
)
check(
  'the protocol is required, so a suppressed context cannot drop it',
  record.contexts.filter((entry) => entry.required === true).length === 1,
)

const protocolContext = record.contexts.find((entry) => entry.name === 'dsh-optimization-2027:protocol')
const toolsContext = record.contexts.find((entry) => entry.name === 'dsh-optimization-2027:custom-tools')

const protocolText = protocolContext.text({ agent: { id: 'agent-1' } })
check('the protocol context renders text', protocolText.includes('Reasoning protocol'))
// The tier in force is the one apply() was handed (level 2 above), not the
// schema default: those two are now different values on purpose.
const configuredLevel = 2
check('the protocol reflects the configured tier', protocolText.includes(`tier ${configuredLevel}/4`), protocolText.slice(0, 80))

const protocolHigh = protocolContext.text({})
check('an agent with no id still gets a protocol', protocolHigh.includes('Reasoning protocol'))
check('the custom tool index is empty before any tool is declared', toolsContext.text() === '')

// --------------------------------------------------------------------- tools

const names = record.tools.map((tool) => tool.name)
const expected = ['shell2027', 'shell_reset', 'tool2027', 'claim', 'analyst_brief']
check('all five tools registered', expected.every((name) => names.includes(name)), names.join(', '))
check(
  'every tool has a description, a parameter schema and an output renderer',
  record.tools.every(
    (tool) =>
      typeof tool.description === 'string' &&
      tool.description.length > 20 &&
      typeof tool.parameters === 'object' &&
      tool.parameters.type === 'object' &&
      typeof tool.output?.render === 'function' &&
      typeof tool.execute === 'function',
  ),
  record.tools.filter((tool) => typeof tool.output?.render !== 'function').map((tool) => tool.name).join(', ') || 'none missing',
)
check(
  'the render function produces text blocks',
  (() => {
    const blocks = record.tools[0].output.render({}, { report: 'hello' })
    return Array.isArray(blocks) && blocks.length === 1 && blocks[0].type === 'text' && blocks[0].text === 'hello'
  })(),
)
check('tool names do not collide with each other', new Set(names).size === names.length)

// ------------------------------------------------------------------ commands

check('one command registered', record.commands.length === 1, String(record.commands.length))
const command = record.commands[0]
// dsh-commands validates against /^[a-z][a-z0-9_-]*$/u and throws on a mismatch,
// so this regex is the real constraint, not a style rule.
check('the command name satisfies the harness name rule', /^[a-z][a-z0-9_-]*$/u.test(command.name), command.name)
check('the command name is dopt2027', command.name === 'dopt2027', command.name)
check('the command has a hint', typeof command.input?.hint === 'string' && command.input.hint.length > 0)
check('the command has a handler', typeof command.handler === 'function')

// --------------------------------------------------------- command behaviour

const invocation = { rawInput: '', agent: { id: 'agent-1', status: 'idle' } }

const status = await command.handler(invocation)
check('status succeeds', status.kind === 'success', JSON.stringify(status))
check('status reports the tier', status.text.includes('tier 2/4'), status.text)
check('status reports the tool directory', status.text.includes('tools 0 declared'), status.text)

const level = await command.handler({ ...invocation, rawInput: 'level 3' })
check('tier 3 is accepted', level.kind === 'success' && level.text.includes('Tier 3'), JSON.stringify(level))

const levels = await command.handler({ ...invocation, rawInput: 'levels' })
check('the tier table renders', levels.kind === 'success' && levels.text.includes('→ 3  deep'), levels.text.slice(0, 200))

const badLevel = await command.handler({ ...invocation, rawInput: 'level nope' })
check('a non-numeric level is an error', badLevel.kind === 'error')

const clamped = await command.handler({ ...invocation, rawInput: 'level 99' })
check('an out-of-range level is clamped, not rejected', clamped.kind === 'success' && clamped.text.includes('Tier 4'))

// Tier 0 is the off switch: the same command path, no rule active. It has to be
// reachable through the command (the composer button reads minLevel from state,
// so a floor of 1 would make the off switch unreachable from the UI).
const off = await command.handler({ ...invocation, rawInput: 'level 0' })
check('tier 0 is accepted', off.kind === 'success' && off.text.includes('Tier 0'), JSON.stringify(off))
check('tier 0 reports no active rule', off.text.includes('0 rule(s) active'), off.text)
const offTable = await command.handler({ ...invocation, rawInput: 'levels' })
check('the tier table marks tier 0', offTable.kind === 'success' && offTable.text.includes('→ 0  off'), offTable.text)
const offStatus = await command.handler({ ...invocation, rawInput: '' })
check('status reports the off tier', offStatus.kind === 'success' && offStatus.text.includes('tier 0/4'), offStatus.text)
const backToTwo = await command.handler({ ...invocation, rawInput: 'level 2' })
check('tier 2 restores the standard protocol', backToTwo.kind === 'success' && backToTwo.text.includes('Tier 2'), backToTwo.text)

const personaGone = await command.handler({ ...invocation, rawInput: 'persona' })
check('the persona verb is gone', personaGone.kind === 'error', JSON.stringify(personaGone))

const emptyTools = await command.handler({ ...invocation, rawInput: 'tools' })
check('tools lists nothing yet', emptyTools.kind === 'success' && emptyTools.text.includes('No custom tools'))

const ledger = await command.handler({ ...invocation, rawInput: 'ledger' })
check('an empty ledger audits clean', ledger.kind === 'success' && ledger.text.includes('0 claim'), ledger.text)

const unknown = await command.handler({ ...invocation, rawInput: 'wat' })
check('an unknown subcommand is an error with help', unknown.kind === 'error' && unknown.text.includes('/dopt2027 level'))

// --------------------------------------------------------------- rearm path

// A session stand-in with the two methods the plugin reads: the surface node
// list, and the event behind a seq. The log below holds two superseded
// snapshots (as this machine's real log did) plus ordinary messages that must
// survive untouched.
const appends = []
const makeSession = () => {
  const events = new Map()
  const nodes = []
  const put = (seq, type, data) => {
    events.set(seq, { seq, type, data })
    nodes.push(seq)
  }
  put(1, 'user/message', { id: 'u1', role: 'user', content: [{ type: 'text', text: 'first question' }], source: { kind: 'user' } })
  put(2, 'user/message', { id: 's1', role: 'user', content: [{ type: 'text', text: 'x'.repeat(900) }], source: { kind: 'system-prompt' } })
  put(3, 'assistant/message', { message: { role: 'assistant', content: [{ type: 'text', text: 'work' }] } })
  put(4, 'user/message', { id: 's2', role: 'user', content: [{ type: 'text', text: 'y'.repeat(700) }], source: { kind: 'system-prompt' } })
  put(5, 'user/message', { id: 'u2', role: 'user', content: [{ type: 'text', text: 'next question' }], source: { kind: 'user' } })
  return {
    surface: { nodes },
    eventAt: (seq) => events.get(seq),
    append: (type, data, opts) => {
      appends.push({ type, data, opts })
      const seq = nodes.length + 1
      events.set(seq, { seq, type, data })
      nodes.push(seq)
      return { seq }
    },
  }
}

const delivered = []
const rearmAgent = {
  id: 'agent-1',
  status: 'idle',
  session: makeSession(),
  steer: (message) => delivered.push(message),
  inject: (message) => delivered.push(message),
}
const rearmed = await command.handler({ rawInput: 'rearm', agent: rearmAgent })
check('rearm succeeds', rearmed.kind === 'success', JSON.stringify(rearmed))
check('rearm delivers exactly one message', delivered.length === 1, String(delivered.length))

const rearmMessage = delivered[0] ?? {}
check('the rearm message is a canonical user message', rearmMessage.role === 'user' && Array.isArray(rearmMessage.content))
check('the rearm message is attributed to the system prompt', rearmMessage.source?.kind === 'system-prompt')
check('the rearm message has an id', typeof rearmMessage.id === 'string' && rearmMessage.id.length > 0)

const rearmText = rearmMessage.content?.[0]?.text ?? ''
check('the rearm message is numbered', /^dsh-optimization-2027 re-arm #1 · tier \d+\/4/.test(rearmText), rearmText.slice(0, 80))
check('the rearm message states that a later snapshot supersedes it', rearmText.includes('supersedes it'))
check('the rearm message carries the runtime context', rearmText.includes('## Runtime context (stub)'))
check('the rearm message omits the base sections', !rearmText.includes('S') || !rearmText.includes('\nS\n'))
// Every request payload already carries all tool schemas (`request/header.data
// .tools` held all 84 in 21 of 21 requests in this log), so a signature list in
// the message is a restatement of what the prompt already has.
check('the rearm message carries no tool signatures', !rearmText.includes('stub_tool'))
check('the rearm message carries no JSON schema text', !rearmText.includes('"properties"'))
check('the rearm message stays small', rearmText.length < 800, String(rearmText.length))

// Retiring the older copies is the half an append-only channel cannot do alone.
check('the earlier snapshots were replaced', appends.length === 2, String(appends.length))
check(
  'each replacement targets exactly the node it replaces',
  appends.every((entry) => entry.opts?.surfaceOp?.op === 'replace' && entry.opts.surfaceOp.startSeq === entry.opts.surfaceOp.endSeq),
  JSON.stringify(appends.map((entry) => entry.opts?.surfaceOp)),
)
check(
  'each replacement cites the node it shadows',
  appends.every((entry) => entry.opts?.sourceEventSeqs?.length === 1),
  JSON.stringify(appends.map((entry) => entry.opts?.sourceEventSeqs)),
)
check('the replaced nodes are the two snapshots', appends.map((entry) => entry.opts.surfaceOp.startSeq).join(',') === '2,4', appends.map((entry) => entry.opts.surfaceOp.startSeq).join(','))
check('the replacement is attributed to the system prompt', appends.every((entry) => entry.data.source?.kind === 'system-prompt'))
check(
  'the replacement says what happened instead of going blank',
  appends.every((entry) => String(entry.data.content?.[0]?.text ?? '').includes('superseded')),
  String(appends[0]?.data.content?.[0]?.text),
)
check('the replacement is one short line', appends.every((entry) => entry.data.content[0].text.length < 120))
check('the rearm reports what it retired', /Replaced 2 earlier snapshot/.test(rearmed.text ?? ''), rearmed.text)

const repeat = await command.handler({ rawInput: 'rearm', agent: rearmAgent })
check('a re-arm with an identical body is not delivered twice', delivered.length === 1 && /unchanged/.test(repeat.text ?? ''), repeat.text)
check('an unchanged re-arm writes nothing', appends.length === 2, String(appends.length))

const busyAgent = { id: 'agent-1', status: 'running', steer: () => delivered.push('steered'), inject: (m) => delivered.push(m) }
await command.handler({ rawInput: 'rearm', agent: busyAgent })
check('a running agent is reached with inject, not steer', delivered.at(-1) !== 'steered')

const noAgent = await command.handler({ rawInput: 'rearm' })
check('rearm without an agent is an error', noAgent.kind === 'error')

// An agent whose session cannot be read still gets its snapshot; retirement is
// the only part that needs the log.
const blindAgent = { id: 'agent-7', status: 'idle', steer: (message) => delivered.push(message), inject: (message) => delivered.push(message) }
const blind = await command.handler({ rawInput: 'rearm', agent: blindAgent })
check('rearm works without a readable session', blind.kind === 'success', JSON.stringify(blind))
check('an unreadable session retires nothing and says so', /No earlier snapshot/.test(blind.text ?? ''), blind.text)

// --------------------------------------------------------- tool round-trips

const byName = (name) => record.tools.find((tool) => tool.name === name)
const exec = { agent: { id: 'agent-1' } }

const addClaim = await byName('claim').execute(
  { action: 'add', text: 'the router caps maxTokens at 128000', channel: 'observed', loadBearing: true, evidence: 'cordis.patch.yml:161' },
  exec,
)
check('claim add records a backed claim', addClaim.report.includes('c1 OBS'), addClaim.report)

let refused = null
try {
  await byName('claim').execute({ action: 'add', text: 'the cache is warm', channel: 'assumed', loadBearing: true }, exec)
} catch (error) {
  refused = error
}
check('claim add refuses an unbacked load-bearing claim', refused !== null && /needs evidence or a check/.test(refused.message))

const settle = await byName('claim').execute({ action: 'settle', id: 'c1', holds: true, result: 'read the line' }, exec)
check('claim settle settles', settle.report.includes('verified'), settle.report)

const audit = await byName('claim').execute({ action: 'audit' }, exec)
check('claim audit reports a clean ledger', audit.report.includes('clean'), audit.report)

const badBrief = await byName('analyst_brief').execute({ question: 'edit the config and restart the server' }, exec)
check('analyst_brief refuses a mutating brief', badBrief.report.includes('Refused'), badBrief.report)

const goodBrief = await byName('analyst_brief').execute({ question: 'which module reads the config file?' }, exec)
check('analyst_brief produces a brief', goodBrief.report.includes('Analyst brief') && goodBrief.report.includes('Hard limits'))

const smuggled = await byName('analyst_brief').execute(
  { question: 'what does lib/shell.js do?', context: 'edit lib/shell.js to fix it' },
  exec,
)
check(
  'analyst_brief refuses an instruction hidden in the context',
  smuggled.report.includes('Refused'),
  smuggled.report,
)

const framed = await byName('analyst_brief').execute(
  { question: 'is the shell pool keyed by agent?', report: 'It is keyed by agent.', stopReason: 'max-tokens' },
  exec,
)
check(
  'a returned report comes back framed as testimony',
  framed.report.includes('testimony, not fact') && framed.report.includes('Incomplete'),
  framed.report,
)

const listed = await byName('tool2027').execute({ action: 'list' }, exec)
check('tool2027 lists an empty store', listed.report.includes('No custom tools'), listed.report)

const saved = await byName('tool2027').execute(
  {
    action: 'save',
    name: 'show_path',
    description: 'Print a path.',
    parameters: { type: 'object', properties: { p: { type: 'string' } }, required: ['p'] },
    command: 'Write-Output {{p}}',
  },
  exec,
)
check('tool2027 saves a declaration', saved.report.includes('Declared show_path'), saved.report)

const afterSave = toolsContext.text()
check('the saved tool appears in the prompt index', afterSave.includes('show_path'), afterSave)

const declared = record.tools.find((tool) => tool.name === 'show_path')
check('the declared tool registers as a real tool', declared !== undefined)
check('the declared tool has a command-shaped description', declared.description.includes('single-quoted literal'))

const ran = await declared.execute({ p: 'C:\\Windows' }, exec)
check('the declared tool runs and echoes the value', ran.report.includes('C:\\Windows'), ran.report)

// The parameter is a single-quoted PowerShell literal, so this whole string is
// DATA: it must come back echoed, and nothing may execute. If quoting leaked,
// the shell would instead try to run the command and the echo would be empty.
const hostile = "x'; Remove-Item -Recurse C:\\; '"
const echoed = await declared.execute({ p: hostile }, exec)
check(
  'a quote in a parameter stays data instead of becoming an operator',
  echoed.report.includes(hostile.trim()),
  echoed.report,
)
const aliveAfter = await byName('shell_reset').execute({}, exec)
check('the plugin is still responsive after that attempt', aliveAfter.report.length > 0)

const shell = await byName('shell2027').execute({ script: '$env:MOUNT_PROBE = "yes"\n"set"' }, exec)
check('shell2027 runs', shell.report.includes('set'), shell.report)
const shell2 = await byName('shell2027').execute({ script: '$env:MOUNT_PROBE' }, exec)
check('the env survives between shell2027 calls', shell2.report.includes('yes'), shell2.report)

const removed = await byName('tool2027').execute({ action: 'remove', name: 'show_path' }, exec)
check('tool2027 removes a declaration', removed.report.includes('Removed show_path'))
check('the removed tool leaves the prompt index', toolsContext.text() === '')
// Removing a tool has to take its schema off the wire AND out of the cost
// table. A bookkeeping entry left behind would keep charging every tier for a
// schema nobody is paying for any more.
check(
  'a removed tool stops being registered, not just unlisted',
  record.tools.every((tool) => tool.name !== 'show_path'),
  record.tools.map((tool) => tool.name).join(', '),
)

// ------------------------------------------------------------------- the route

check('one route registered', record.routes.length === 1, String(record.routes.length))
const route = record.routes[0]
check('the route is a prefix under the package name', route.kind === 'prefix' && route.path === '/dsh-optimization-2027/api', `${route.kind} ${route.path}`)

/** A minimal req/res pair: the route reads headers, the socket address and a JSON body. */
function callOn(route, body, options = {}) {
  const payload = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body)
  const req = {
    method: options.method ?? 'POST',
    headers: options.headers ?? { host: '127.0.0.1:41234', 'content-type': 'application/json' },
    socket: { localAddress: options.localAddress ?? '127.0.0.1' },
    on: (event, handler) => {
      if (event === 'data') handler(Buffer.from(payload))
      if (event === 'end') handler()
    },
    destroy: () => {},
  }
  const out = { status: 0, headers: null, body: '' }
  const res = {
    writeHead: (status, headers) => {
      out.status = status
      out.headers = headers ?? null
    },
    end: (text) => {
      out.body = typeof text === 'string' ? text : ''
    },
  }
  return route.handler(req, res).then(() => {
    let json = null
    try {
      json = out.body.length > 0 ? JSON.parse(out.body) : null
    } catch {
      json = null
    }
    return { ...out, json }
  })
}

const call = (body, options) => callOn(route, body, options)

const stateAnswer = await call({ action: 'state' })
check('state answers 200', stateAnswer.status === 200, String(stateAnswer.status))
check('state reports the tier as a number', typeof stateAnswer.json?.level === 'number', JSON.stringify(stateAnswer.json?.level))
check('state carries the same status text the command prints', String(stateAnswer.json?.status ?? '').includes('tier '), stateAnswer.json?.status)
check('state carries the tier title', typeof stateAnswer.json?.levelTitle === 'string' && stateAnswer.json.levelTitle.length > 0)
// The panel polls `state` on mount and every 10 s, and reads only these fields.
// Anything else on the payload is weight nobody asked for: the ledger used to
// ride along at ~1.9 KB per poll and was never read once.
check(
  'state sends nothing the panel does not read',
  ['ok', 'status', 'level', 'levelTitle', 'maxLevel', 'minLevel', 'cost', 'costs'].every(
    (key) => key in stateAnswer.json,
  ) && !('ledger' in stateAnswer.json),
  Object.keys(stateAnswer.json ?? {}).join(','),
)
// The cost figures are the reason the panel can show a number under each chip
// without keeping its own copy of the rule table.
check(
  'state carries the cost of the tier in force',
  stateAnswer.json?.cost?.chars === 767 && stateAnswer.json.cost.marginalChars === 769 && stateAnswer.json.cost.tokens === 192,
  JSON.stringify(stateAnswer.json?.cost),
)
check(
  'state carries one cost row per reachable tier',
  Array.isArray(stateAnswer.json?.costs) && stateAnswer.json.costs.length === 5 && stateAnswer.json.costs[0].level === 0,
  JSON.stringify(stateAnswer.json?.costs?.map((row) => row.level)),
)
// The number a tier actually costs is the protocol text PLUS the tool schemas
// this plugin puts on the wire every request. Showing only the protocol half
// understated the bill by an order of magnitude.
check(
  'a priced tier counts the tool schemas as well as the protocol',
  stateAnswer.json?.cost?.toolTokens > 500 &&
    stateAnswer.json.cost.totalTokens === stateAnswer.json.cost.tokens + stateAnswer.json.cost.toolTokens,
  JSON.stringify(stateAnswer.json?.cost),
)
check(
  'every priced tier carries the same tool-schema bill',
  ['1', '2', '3', '4'].every(
    (key) => stateAnswer.json?.costs?.[Number(key)]?.toolTokens === stateAnswer.json?.cost?.toolTokens,
  ),
  JSON.stringify(stateAnswer.json?.costs?.map((row) => row.toolTokens)),
)
check(
  'the cost of tier 0 is zero, not a small number',
  stateAnswer.json?.costs?.[0]?.tokens === 0 &&
    stateAnswer.json.costs[0].chars === 0 &&
    stateAnswer.json.costs[0].toolTokens === 0 &&
    stateAnswer.json.costs[0].totalTokens === 0,
  JSON.stringify(stateAnswer.json?.costs?.[0]),
)

// Declaring a tool costs the price of its schema on every request from then on;
// removing it has to give that back. Both numbers come from the same
// bookkeeping map the tier-0 withholding uses, so a leak here would show up as
// a permanently inflated bill.
{
  const costOf = async () => (await call({ action: 'state' })).json?.cost
  const before = await costOf()
  const declarer = record.tools.find((entry) => entry.name === 'tool2027')
  await declarer.execute(
    {
      action: 'save',
      name: 'cost_probe',
      description: 'A throwaway declaration used to price the bookkeeping.',
      parameters: { type: 'object', properties: { w: { type: 'string' } }, required: ['w'] },
      command: 'Write-Output {{w}}',
    },
    exec,
  )
  const during = await costOf()
  check(
    'declaring a tool raises the per-request cost',
    during.toolTokens > before.toolTokens,
    `${before.toolTokens} → ${during.toolTokens}`,
  )
  await declarer.execute({ action: 'remove', name: 'cost_probe' }, exec)
  const after = await costOf()
  check(
    'removing a tool gives the cost back to the token',
    after.toolTokens === before.toolTokens && after.totalTokens === before.totalTokens,
    `${during.toolTokens} → ${after.toolTokens} (started at ${before.toolTokens})`,
  )
}

const invoked = await call({ action: 'invoke', input: 'level 3', session: 'agent-1' })
check('invoke answers 200', invoked.status === 200, String(invoked.status))
check('invoke returns the command text', String(invoked.json?.text ?? '').includes('Tier 3'), invoked.json?.text)

// The route and the command must change the SAME state. Reading the command
// back is the only way to prove there is one authority and not two.
const afterRoute = await command.handler({ rawInput: 'status', agent: { id: 'agent-1', status: 'idle' } })
check('the route changed the state the command reads', afterRoute.text.includes('tier 3/4'), afterRoute.text)

const badInvoke = await call({ action: 'invoke', input: 'wat' })
check('an unknown verb is a refusal, not a 200', badInvoke.status === 400 && badInvoke.json?.ok === false)

const emptyInvoke = await call({ action: 'invoke', input: '   ' })
check('an empty verb is refused', emptyInvoke.status === 400 && emptyInvoke.json?.error === 'empty-input')

const unknownAction = await call({ action: 'nope' })
check('an unknown action is refused', unknownAction.status === 400 && unknownAction.json?.error === 'unknown-action')
check('the unknown-action answer carries the help text', String(unknownAction.json?.help ?? '').includes('/dopt2027 level'))

const wrongMethod = await call({ action: 'state' }, { method: 'GET' })
check('a GET is refused', wrongMethod.status === 405 && wrongMethod.json?.error === 'method-not-allowed')

const options = await call(undefined, { method: 'OPTIONS' })
check('an OPTIONS preflight is answered with 204', options.status === 204)

const foreignOrigin = await call({ action: 'state' }, { headers: { host: '127.0.0.1:41234', origin: 'https://example.com' } })
check('a foreign origin is refused', foreignOrigin.status === 403 && foreignOrigin.json?.error === 'loopback-only')

const foreignHost = await call({ action: 'state' }, { headers: { host: 'evil.example:41234' } })
check('a foreign host header is refused', foreignHost.status === 403)

const remoteSocket = await call({ action: 'state' }, { localAddress: '10.0.0.5' })
check('a non-loopback listener is refused', remoteSocket.status === 403)

const goodOrigin = await call({ action: 'state' }, { headers: { host: '127.0.0.1:41234', origin: 'http://127.0.0.1:41234' } })
check('a loopback origin passes', goodOrigin.status === 200, String(goodOrigin.status))

const notJson = await call('not json at all')
check('an unparseable body is a 400, never a guessed default', notJson.status === 400 && notJson.json?.error === 'bad-request')

// Level and ledger are per agent, so `session` must select the agent rather than
// letting every press fall back to the newest root.
await call({ action: 'invoke', input: 'level 1', session: 'agent-3' })
const agent3 = await command.handler({ rawInput: 'status', agent: { id: 'agent-3', status: 'idle' } })
const agent4 = await command.handler({ rawInput: 'status', agent: { id: 'agent-4', status: 'idle' } })
check('a session-scoped press changes that session', agent3.text.includes('tier 1/4'), agent3.text)
check('a session-scoped press leaves the other session alone', agent4.text.includes('tier 2/4'), agent4.text)

const rebound = await call({ action: 'state', session: 'agent-3' })
check('state reports the named session', rebound.json?.level === 1, String(rebound.json?.level))

const unknownSession = await call({ action: 'state', session: 'no-such-session' })
check('an unknown session falls back to a live agent instead of failing', unknownSession.status === 200 && typeof unknownSession.json?.level === 'number')

// ------------------------------------------------------- tier persistence
//
// The tier used to live only in a Map inside the process, so a restart dropped
// every session back to the configured default and said nothing about it. It is
// now one file per session, written only when someone actually sets a tier: a
// session that never chose keeps no record and falls through to the configured
// default, which is what makes "new sessions start at the off switch" true.

const levelsDir = join(dir, 'plugin-data', 'dsh-optimization-2027', 'levels')
const levelFile = (id) => join(levelsDir, `level-${id}.json`)

check('an explicit set writes a record for that session', existsSync(levelFile('agent-3')), levelFile('agent-3'))
check(
  'the record holds the tier that was set',
  JSON.parse(readFileSync(levelFile('agent-3'), 'utf8')).level === 1,
  readFileSync(levelFile('agent-3'), 'utf8').trim(),
)
check('a session that never chose keeps no record', !existsSync(levelFile('agent-4')), levelFile('agent-4'))

// A second mount over the same DSH_HOME is what a restart looks like from
// inside the plugin: no module state, the same files on disk.
const restart = makeContext()
apply(restart.ctx, Config['~standard'].validate({ level: 0 }).value)
const restartCommand = restart.record.commands[0]

const resumed = await restartCommand.handler({ rawInput: 'status', agent: { id: 'agent-3', status: 'idle' } })
check('a restart resumes the tier a session was left at', resumed.text.includes('tier 1/4'), resumed.text)

const resumedRoute = await callOn(restart.record.routes[0], { action: 'state', session: 'agent-3' })
check('the resumed tier is what the route reports', resumedRoute.json?.level === 1, String(resumedRoute.json?.level))

const fresh = await restartCommand.handler({ rawInput: 'status', agent: { id: 'agent-5', status: 'idle' } })
check('a session that never chose starts at the configured default', fresh.text.includes('tier 0/4'), fresh.text)

writeFileSync(levelFile('agent-6'), 'not json at all', 'utf8')
const corrupt = await restartCommand.handler({ rawInput: 'status', agent: { id: 'agent-6', status: 'idle' } })
check('an unreadable record falls back to the configured default', corrupt.text.includes('tier 0/4'), corrupt.text)

// ------------------------------------------------- re-arm threshold on disk
//
// The threshold used to be config-only, so the panel could show it and not
// change it. It is a per-session record now, written by the same `rearm` verb
// the manual re-send already used.

const rearmDir = join(dir, 'plugin-data', 'dsh-optimization-2027', 'rearm')
const rearmFile = (id) => join(rearmDir, `rearm-${id}.json`)

const distanceSet = await restartCommand.handler({ rawInput: 'rearm 300', agent: { id: 'agent-7', status: 'idle' } })
check('the rearm verb accepts a message count', distanceSet.kind === 'success' && distanceSet.text.includes('300'), distanceSet.text)
check('setting the threshold writes a record for that session', existsSync(rearmFile('agent-7')), rearmFile('agent-7'))
check(
  'the record holds the distance that was set',
  JSON.parse(readFileSync(rearmFile('agent-7'), 'utf8')).distance === 300,
  readFileSync(rearmFile('agent-7'), 'utf8').trim(),
)
check('a session that never set a threshold keeps no record', !existsSync(rearmFile('agent-8')), rearmFile('agent-8'))

const distanceOff = await restartCommand.handler({ rawInput: 'rearm off', agent: { id: 'agent-7', status: 'idle' } })
check('blank means off, spelled as the word', distanceOff.text.toLowerCase().includes('off'), distanceOff.text)
check(
  'off is stored as 0, not as an absent record',
  JSON.parse(readFileSync(rearmFile('agent-7'), 'utf8')).distance === 0,
  readFileSync(rearmFile('agent-7'), 'utf8').trim(),
)

const distanceZero = await restartCommand.handler({ rawInput: 'rearm 0', agent: { id: 'agent-7', status: 'idle' } })
check('0 and off mean the same thing', distanceZero.text === distanceOff.text, distanceZero.text)

const distanceJunk = await restartCommand.handler({ rawInput: 'rearm abc', agent: { id: 'agent-7', status: 'idle' } })
check('a threshold that is not a count is refused', distanceJunk.kind === 'error', distanceJunk.text)

const distanceBare = await restartCommand.handler({ rawInput: 'rearm', agent: { id: 'agent-7', status: 'idle' } })
check(
  'a bare rearm still re-sends instead of setting a threshold',
  distanceBare.kind === 'error' || /Re-arm #|unchanged/.test(String(distanceBare.text)),
  String(distanceBare.text),
)

await restartCommand.handler({ rawInput: 'rearm 240', agent: { id: 'agent-3', status: 'idle' } })
const distanceState = await callOn(restart.record.routes[0], { action: 'state', session: 'agent-3' })
check('the route reports the threshold in force', distanceState.json?.rearmDistance === 240, String(distanceState.json?.rearmDistance))
// `currentAgent` only resolves an id that the agent service knows, so the
// no-record case has to use one of the live stub agents rather than a name
// invented here — otherwise the route silently falls back to the newest root
// and the assertion would pass for the wrong reason.
const distanceFresh = await callOn(restart.record.routes[0], { action: 'state', session: 'agent-4' })
check(
  'a session with no record reports the configured default instead',
  distanceFresh.json?.rearmDistance === 0,
  String(distanceFresh.json?.rearmDistance),
)

// A threshold of 0 must mean "no automatic re-arm", and the hook must be the
// thing that enforces it — it is subscribed unconditionally now. Tested below,
// once `driftSession` exists.
{
  const quietHook = restart.record.listeners.find((item) => item.name === 'agent/pre-step')
  check('the restart mount subscribes to the drift hook as well', quietHook !== undefined)
}

for (const item of restart.record.effects) {
  try {
    item.dispose?.()
  } catch {}
}

// ------------------------------------------------------- agent disposal reaps
//
// A destroyed agent must not keep a shell until the idle reaper reaches it. The
// subscription is agent/disposed; a shell keyed to that agent has to be gone
// once the event has been dispatched.

const disposed = record.listeners.filter((item) => item.name === 'agent/disposed')
check('the plugin subscribes to agent teardown', disposed.length === 1, String(disposed.length))

await byName('shell2027').execute({ script: '$env:MOUNT_REAP = "owned"\n"ready"' }, { agent: { id: 'agent-9' } })
const beforeReap = await call({ action: 'invoke', input: 'status', session: 'agent-9' })
check('the doomed agent has a shell before disposal', beforeReap.status === 200, String(beforeReap.status))

for (const listener of disposed) listener.handler({ agent: { id: 'agent-9' } })

const afterReap = await byName('shell2027').execute({ script: '$env:MOUNT_REAP' }, { agent: { id: 'agent-9' } })
check(
  'agent/disposed closes that agent shell and the next call starts clean',
  afterReap.report.includes('') && !afterReap.report.includes('owned'),
  afterReap.report,
)

// ------------------------------------------------------- re-arm on drift
//
// The automatic half is a per-session setting now, so the hook subscribes on
// every mount and the threshold decides inside the handler whether a step is
// worth a snapshot. That is deliberate: a subscription created only when the
// config said so could never be switched on from the panel without a restart.
//
// Measured drift across the 18 sessions on this machine: 213 requests, distance
// to the last runtime context was 0 for 41 (19%), median 145, p90 453, max 561.
// The threshold is the only thing that decides whether a snapshot is worth 400
// tokens, so it is tested on both sides of the boundary.

const driftRecord = makeContext()
const driftCtx = driftRecord.ctx
apply(driftCtx, Config['~standard'].validate({ level: 2, rearmDistance: 30 }).value)

const preStep = driftRecord.record.listeners.find((item) => item.name === 'agent/pre-step')
check('the plugin subscribes to agent/pre-step even at the default threshold', preStep !== undefined)

const offHook = record.listeners.find((item) => item.name === 'agent/pre-step')
check('the mount that never set a threshold subscribes too', offHook !== undefined)

// A session whose last protocol copy sits `behind` messages back.
const driftSession = (behind) => {
  const events = new Map()
  const nodes = []
  const put = (type, data) => {
    const seq = nodes.length + 1
    events.set(seq, { seq, type, data })
    nodes.push(seq)
    return seq
  }
  put('user/message', { id: 'ctx0', role: 'user', content: [{ type: 'text', text: 'runtime context' }], source: { kind: 'runtime-context' } })
  for (let index = 0; index < behind; index += 1) {
    if (index % 2 === 0) put('tool/call', { callId: `c${index}`, name: 'pwsh', arguments: '{}' })
    else put('tool/result', { message: { role: 'tool', content: [{ type: 'text', text: 'out' }] } })
  }
  const appended = []
  return {
    appended,
    surface: { nodes },
    eventAt: (seq) => events.get(seq),
    append: (type, data, opts) => {
      appended.push({ type, data, opts })
      const seq = nodes.length + 1
      events.set(seq, { seq, type, data })
      nodes.push(seq)
      return { seq }
    },
  }
}

const next = async () => ({ kind: 'enter', messages: [] })
const nearAgent = { id: 'drift-near', session: driftSession(10) }
const nearDecision = await preStep.handler({ agent: nearAgent, signal: { aborted: false } }, next)
check('a request close to the context is left alone', nearDecision.messages.length === 0, JSON.stringify(nearDecision.messages.length))

const farAgent = { id: 'drift-far', session: driftSession(40) }
const farDecision = await preStep.handler({ agent: farAgent, signal: { aborted: false } }, next)
check('a drifted request gets one extra message', farDecision.messages.length === 1, String(farDecision.messages.length))
const autoMessage = farDecision.messages[0] ?? {}
check('the extra message is attributed to the system prompt', autoMessage.source?.kind === 'system-prompt')
check('the extra message carries the runtime context', String(autoMessage.content?.[0]?.text ?? '').includes('## Runtime context (stub)'))
check('the extra message is numbered', /^dsh-optimization-2027 re-arm #1/.test(String(autoMessage.content?.[0]?.text ?? '')))

const farAgain = await preStep.handler({ agent: farAgent, signal: { aborted: false } }, next)
check('an unchanged snapshot is not re-sent', farAgain.messages.length === 0, String(farAgain.messages.length))

const abortedDecision = await preStep.handler({ agent: farAgent, signal: { aborted: true } }, next)
check('an aborted step is left untouched', abortedDecision.messages.length === 0)

const rejectedDecision = await preStep.handler({ agent: farAgent, signal: { aborted: false } }, async () => ({ kind: 'reject' }))
check('a rejected step stays rejected', rejectedDecision.kind === 'reject')

const headlessDecision = await preStep.handler({ agent: { id: 'drift-headless' }, signal: { aborted: false } }, next)
check('an agent with no session is left alone', headlessDecision.messages.length === 0)

// The threshold is per session and read at fire time, so these two agents use
// the same hook and differ only in the record on disk: no restart between them.
{
  const localHook = restart.record.listeners.find((item) => item.name === 'agent/pre-step')
  const setDistance = async (id, value) =>
    await restartCommand.handler({ rawInput: `rearm ${value}`, agent: { id, status: 'idle' } })

  await setDistance('agent-quiet', 0)
  const quiet = await localHook.handler(
    { agent: { id: 'agent-quiet', session: driftSession(400) }, signal: { aborted: false } },
    next,
  )
  check('a session at the off threshold gets no automatic re-arm', quiet.messages.length === 0, String(quiet.messages.length))

  await setDistance('agent-loud', 30)
  const loud = await localHook.handler(
    { agent: { id: 'agent-loud', session: driftSession(400) }, signal: { aborted: false } },
    next,
  )
  check('a session above the threshold gets one, without a restart', loud.messages.length === 1, String(loud.messages.length))

  await setDistance('agent-quiet', 30)
  const switchedOn = await localHook.handler(
    { agent: { id: 'agent-quiet', session: driftSession(700) }, signal: { aborted: false } },
    next,
  )
  check('switching it on takes effect on the very next step', switchedOn.messages.length === 1, String(switchedOn.messages.length))
}

// --------------------------------------------------------------- housekeeping

const warned = record.warnings.join('\n')
check('no warnings during mount', warned.length === 0, warned)

// ------------------------------------------------------- tier 0 sends no tools
// Tier 0 promises to cost nothing. The protocol half of that is a context whose
// text is empty; the tool half has to be enforced where the request is built,
// because this profile's router never accepts a mid-conversation tool removal.
{
  const assembleHook = record.listeners.filter((item) => item.name === 'system-prompt/assemble')
  check('the plugin hooks prompt assembly to withhold tools', assembleHook.length === 1, String(assembleHook.length))

  const wireTools = record.tools.map((entry) => ({
    name: entry.name,
    description: entry.description,
    parameters: entry.parameters,
  }))
  const passthrough = async () => ({ sections: [], contexts: [], tools: wireTools, variables: {} })

  const offCtx = { agent: { id: 'off-agent' } }
  writeFileSync(levelFile('off-agent'), JSON.stringify({ level: 0 }), 'utf8')
  const offAssembly = await assembleHook[0].handler({}, offCtx, passthrough)
  check('an off session assembles with none of this plugin tools', offAssembly.tools.length === 0, JSON.stringify(offAssembly.tools.map((t) => t.name)))

  const onAssembly = await assembleHook[0].handler({}, { agent: { id: 'on-agent' } }, passthrough)
  check(
    'a session above tier 0 keeps every tool it registered',
    onAssembly.tools.length === wireTools.length,
    `${onAssembly.tools.length} of ${wireTools.length}`,
  )
}

for (const item of record.effects) {
  try {
    item.dispose?.()
  } catch {}
}

rmSync(dir, { recursive: true, force: true })

const summary = [
  ...results,
  '',
  failures === 0 ? `all ${results.length} checks passed` : `${failures} of ${results.length} checks FAILED`,
].join('\n')
process.stdout.write(`${summary}\n`)
process.exitCode = failures === 0 ? 0 : 1
