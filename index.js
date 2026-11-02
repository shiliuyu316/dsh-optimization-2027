/**
 * dsh-optimization-2027 — one bundle, five behaviours.
 *
 * Every part of this plugin was chosen because the alternative was measurably
 * worse on this harness, not because it looked complete. The reasoning behind
 * each choice lives in the module that implements it:
 *
 *   lib/levels.js        reasoning protocol as text; no effort-bucket collapse
 *   lib/ledger.js        load-bearing claims must carry evidence or a check
 *   lib/custom-tools.js  model declares tools as JSON, never as code in the Host
 *   lib/shell.js         one long-lived pwsh per agent; cwd and env survive
 *   lib/analyst.js       delegates analyze only; their reports are testimony
 *
 * Two harness facts shape the wiring:
 *
 * - Only `@deepseek-ai/schemastery` resolves from a profile-linked plugin, so
 *   Config is a plain object with its own validation, and tool definitions are
 *   plain objects. Importing `@deepseek-ai/dsh-llm` for `createUserMessage`
 *   fails with ERR_MODULE_NOT_FOUND, so the one place a message is constructed
 *   builds the canonical shape by hand.
 * - Services are injected in two tiers. `systemPrompt` is required; `tools` and
 *   `commands` are looked up per use so a profile without them loses those
 *   tools instead of failing the whole plugin entry.
 */

import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import {
  CHARS_PER_TOKEN,
  DEFAULT_LEVEL,
  MAX_LEVEL,
  MIN_LEVEL,
  clampLevel,
  costTable,
  describeLevel,
  levelTitle,
  protocolCost,
  renderLevelTable,
  renderProtocol,
} from './lib/levels.js'
import { ClaimLedger, renderAudit, renderClaim } from './lib/ledger.js'
import { CustomToolStore, renderCommand, slugOf } from './lib/custom-tools.js'
import { ShellPool } from './lib/shell.js'
import { LevelStore } from './lib/level-store.js'
import { RearmStore } from './lib/rearm-store.js'
import {
  MUTATION_REFUSAL,
  analystPrompt,
  classifyBrief,
  frameReport,
} from './lib/analyst.js'

export const name = 'dsh-optimization-2027'

/**
 * Only the prompt registry is required. Everything else is looked up per use so
 * that a profile without the commands service still gets the level protocol.
 */
export const inject = ['systemPrompt']

/** Order numbers for this plugin's runtime contexts. */
const ORDER_PROTOCOL = 310
const ORDER_TOOLS = 320

/**
 * The slash-command name. Not `2027`: dsh-commands validates a name against
 * `/^[a-z][a-z0-9_-]*$/u`, so a leading digit is rejected at registration and
 * the command never exists. `dopt2027` is the shortest name that parses.
 */
const COMMAND_NAME = 'dopt2027'

/**
 * The route the Client half posts to. A Client half runs in the renderer and
 * has exactly one way back into this process that is documented and already in
 * use here: an HTTP route on the harness's own origin.
 */
const ROUTE_PATH = '/dsh-optimization-2027/api'

const DEFAULTS = {
  level: DEFAULT_LEVEL,
  customToolsDir: '',
  shellEnabled: true,
  shellTimeoutMs: 60_000,
  shellIdleMs: 900_000,
  rearmDistance: 0,
}

/**
 * Config in two halves: the rows the settings form projects, and the
 * standard-schema protocol the Host calls at load.
 *
 * The protocol is not optional. The Host reads `Config['~standard'].validate`
 * before `apply()` runs; a bare plain object throws `Cannot read properties of
 * undefined (reading 'validate')` and the entry lands in `fiberPhase: "failed"`
 * with no console error of its own. Schemastery would supply the protocol for
 * free, but `@deepseek-ai/dsh-tools` does not resolve from a profile-linked
 * plugin, so the protocol is written out here.
 *
 * Validation never throws: an unreadable value falls back to its default,
 * unknown keys are dropped, and out-of-range numbers are clamped. A rejected
 * config at load time would take the whole plugin down over a typo.
 */
const FIELDS = {
  level: {
    type: 'integer',
    meta: { default: DEFAULTS.level, description: `推理档位 0–${MAX_LEVEL}，默认 0=off：0=off（不注入任何规则，正常推理，消耗 0 token）/ 1 light / 2 standard / 3 deep / 4 multi-agent。高档追加的是写出答案之前的推理要求。` },
  },
  customToolsDir: {
    type: 'string',
    meta: { default: '', description: '自建工具声明目录。留空用 <DSH_HOME>/plugin-data/dsh-optimization-2027/tools。' },
  },
  shellEnabled: {
    type: 'boolean',
    meta: { default: true, description: '启用常驻 PowerShell，cwd 与环境变量跨调用保持。' },
  },
  shellTimeoutMs: {
    type: 'integer',
    meta: { default: DEFAULTS.shellTimeoutMs, description: '单次脚本超时毫秒数。' },
  },
  shellIdleMs: {
    type: 'integer',
    meta: { default: DEFAULTS.shellIdleMs, description: '会话空闲多久后回收，毫秒。' },
  },
  rearmDistance: {
    type: 'integer',
    meta: {
      default: 0,
      description: '自动重发阈值，按「距最后一份 runtime context 已过多少条消息」计。0 关闭。实测本机 18 个会话 213 个请求：距离中位数 145，p90 453，最大 561；120 会在 51% 的请求上触发，300 是 30%。',
    },
  },
}

const CORE = { type: 'object', dict: FIELDS, meta: { default: {} } }

export const Config = {
  ...CORE,
  toJSON() {
    return CORE
  },
  '~standard': {
    version: 1,
    vendor: name,
    validate(value) {
      // normalizeConfig cannot throw: every branch either coerces or falls back.
      return { value: normalizeConfig(value) }
    },
  },
}

function positiveInt(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : fallback
}

function nonNegativeInt(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : fallback
}

function normalizeConfig(raw) {
  const input = typeof raw === 'object' && raw !== null ? raw : {}
  return {
    level: clampLevel(input.level ?? DEFAULTS.level),
    customToolsDir: typeof input.customToolsDir === 'string' ? input.customToolsDir.trim() : '',
    shellEnabled: input.shellEnabled !== false,
    shellTimeoutMs: positiveInt(input.shellTimeoutMs, DEFAULTS.shellTimeoutMs),
    shellIdleMs: positiveInt(input.shellIdleMs, DEFAULTS.shellIdleMs),
    rearmDistance: nonNegativeInt(input.rearmDistance, DEFAULTS.rearmDistance),
  }
}

/**
 * Where the plugin keeps custom tool declarations and ledgers. DSH_HOME is the
 * harness's own answer; homedir()/.dsh is the same directory by default and
 * covers a process started outside the desktop shell.
 */
function resolveDataDir() {
  const home =
    typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME.length > 0
      ? process.env.DSH_HOME
      : join(homedir(), '.dsh')
  return join(home, 'plugin-data', name)
}

function textBlocks(text) {
  return [{ type: 'text', text: String(text ?? '') }]
}

/**
 * Tool definitions are plain objects here, not `defineTool` output: the typed
 * helper lives in a package that does not resolve from a profile-linked
 * plugin. The only mandatory extra is `output`, whose `render` turns the
 * canonical value into model content.
 */
function tool(definition) {
  return {
    ...definition,
    output: {
      schema: { type: 'object' },
      render: (_args, value) => textBlocks(value?.report ?? ''),
    },
  }
}

function agentIdOf(agent) {
  return typeof agent === 'object' && agent !== null && typeof agent.id === 'string' ? agent.id : 'default'
}

/** Longest body the button route will read. It carries one short verb. */
const BODY_LIMIT = 64 * 1024

/**
 * Loopback check for the button route.
 *
 * The listener address must be loopback, the Host header must name that same
 * kind of address, and an Origin, when present, must be loopback too. An absent
 * Origin passes: that is the shape of the plugin's own fetch and of `curl`.
 * This does not defend against a same-origin script that is already running —
 * nothing on this origin can — it defends against another origin reaching the
 * route.
 */
function isLoopbackAddress(value) {
  const text = String(value ?? '').replace(/^\[|\]$/gu, '')
  return (
    text === '::1' ||
    text === '::ffff:127.0.0.1' ||
    text === 'localhost' ||
    text === '127.0.0.1' ||
    text.startsWith('127.')
  )
}

function isLoopback(req) {
  if (!isLoopbackAddress(req.socket?.localAddress ?? '')) return false
  const host = String(req.headers?.host ?? '').replace(/:\d+$/u, '')
  if (host.length > 0 && !isLoopbackAddress(host)) return false
  const origin = req.headers?.origin
  if (typeof origin === 'string' && origin.length > 0 && origin !== 'null') {
    let originHost
    try {
      originHost = new URL(origin).hostname
    } catch {
      return false
    }
    if (!isLoopbackAddress(originHost)) return false
  }
  return true
}

/** Read and parse a JSON body, refusing anything larger than `limit`. */
function readJson(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error(`body over ${limit} bytes`))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').trim()
      if (text.length === 0) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(text))
      } catch (error) {
        reject(new Error(`body is not JSON: ${error?.message ?? error}`))
      }
    })
    req.on('error', reject)
  })
}

/**
 * The agent a button press acts on.
 *
 * The composer dock is a session-scoped slot, so the button sends the session it
 * is displayed in and this picks that exact agent. All the state here is per
 * agent — `levels`, `ledgers`, the shell pool — so a button in one session
 * changing another session's level would be the wrong change reported as
 * success.
 *
 * When the id does not resolve — a session that has not registered yet, or a
 * press that carried none — the most recently registered root agent is the
 * honest fallback: it is the session the person is looking at. With no agent at
 * all the verbs still answer, because `agentIdOf` folds a missing agent to
 * `default` and only `rearm` needs a live one.
 */
function anyAgent(agents, session) {
  if (agents === undefined) return undefined
  const wanted = typeof session === 'string' ? session : ''
  if (wanted.length > 0) {
    const all = agents.list()
    if (Array.isArray(all)) {
      const exact = all.find((agent) => agent?.id === wanted)
      if (exact !== undefined) return exact
    }
  }
  const roots = agents.roots()
  if (Array.isArray(roots) && roots.length > 0) return roots[roots.length - 1]
  const all = agents.list()
  return Array.isArray(all) && all.length > 0 ? all[all.length - 1] : undefined
}

export function apply(ctx, rawConfig) {
  const config = normalizeConfig(rawConfig)
  const dataDir = resolveDataDir()
  mkdirSync(dataDir, { recursive: true })

  /**
   * Per-agent tier. An explicit choice is stored on disk, so a restart resumes
   * the tier a session was left at instead of silently dropping it; a session
   * that never chose keeps no record and runs at the configured default.
   */
  const levelStore = new LevelStore(join(dataDir, 'levels'))
  const levelFor = (agent) => {
    const stored = levelStore.read(agentIdOf(agent))
    return stored === null ? config.level : stored
  }
  const setLevel = (agent, level) => levelStore.write(agentIdOf(agent), level)

  /**
   * Per-agent automatic re-arm threshold. Same shape as the tier store, and
   * for the same reason: the number used to be config-only, so changing it
   * meant editing YAML and restarting the Host. A setting the panel can show
   * but not change is a setting that reads as broken.
   *
   * A session that never touched the field keeps no record and uses
   * `config.rearmDistance`, so the config still moves every session that never
   * overrode it. 0 means off and is stored as 0, not as "absent".
   */
  const rearmStore = new RearmStore(join(dataDir, 'rearm'))
  const rearmDistanceFor = (agent) => {
    const stored = rearmStore.read(agentIdOf(agent))
    return stored === null ? config.rearmDistance : stored
  }
  const setRearmDistance = (agent, distance) => rearmStore.write(agentIdOf(agent), distance)

  /**
   * Every tool this plugin puts on the wire, keyed by name. It is used for two
   * things: the cost table needs the byte size of what is being sent every
   * request, and tier 0 needs the list of names to hold back. Both would drift
   * if they were written out by hand next to the definitions.
   */
  const ownTools = new Map()

  /**
   * Characters this plugin adds to every request through tool schemas. The
   * wire shape is the one dsh-llm-deepseek serializes: name, description and
   * the parameters under the `input_schema` key.
   */
  const ownToolChars = () => {
    let total = 0
    for (const definition of ownTools.values()) {
      total += JSON.stringify({
        name: definition.name,
        description: definition.description,
        input_schema: definition.parameters,
      }).length
    }
    return total
  }
  const toolCostTokens = () => Math.ceil(ownToolChars() / CHARS_PER_TOKEN)

  /** One ledger per agent; the file name carries the session id. */
  const ledgers = new Map()
  const ledgerFor = (agent) => {
    const id = agentIdOf(agent)
    let ledger = ledgers.get(id)
    if (ledger === undefined) {
      ledger = new ClaimLedger(join(dataDir, 'ledger'), id)
      ledgers.set(id, ledger)
    }
    return ledger
  }

  const shells = config.shellEnabled
    ? new ShellPool({ timeoutMs: config.shellTimeoutMs, idleMs: config.shellIdleMs })
    : null

  let store = null

  /**
   * The one implementation of every `/dopt2027` verb, published to whichever
   * caller registered it. The slash command and the composer button both invoke
   * `surface.invoke`, so a button press and a typed line cannot drift apart: a
   * UI that reimplemented "set the level" would be a second authority for the
   * same state, and the two would disagree the first time one of them changed.
   */
  let surface = null

  ctx.effect(
    () => () => {
      shells?.disposeAll()
      store?.disposeAll()
    },
    'dsh-optimization-2027: release shells and custom tools',
  )

  /**
   * An agent that is gone should not keep a PowerShell alive.
   *
   * Without this, a destroyed agent's shell survives until the idle reaper
   * reaches it — shellIdleMs, 900s by default — carrying its working directory,
   * its environment and any process it started. The idle timer is the wrong
   * mechanism for this: it answers "nobody has used it lately", not "nobody
   * owns it any more". `agent/disposed` is the host's own answer to the second
   * question; it fires after driver quiescence and before session detachment.
   */
  if (shells !== null) {
    ctx.on('agent/disposed', ({ agent }) => {
      try {
        shells.reset(agent)
      } catch {
        // Releasing a session must not take the disposal path down with it.
      }
    })
  }

  // --------------------------------------------------------------- protocol

  ctx.systemPrompt.context({
    name: 'dsh-optimization-2027:protocol',
    order: ORDER_PROTOCOL,
    required: true,
    interpolate: false,
    text: (assembleContext) => renderProtocol(levelFor(assembleContext?.agent)),
  })

  // ------------------------------------------------- custom tool prompt index

  /**
   * Only the index goes into the prompt: name, one-line summary, absolute path
   * to the tool's document. The declarations themselves are unbounded, and a
   * prompt that grows with every declared tool crowds out the actual task.
   */
  ctx.systemPrompt.context({
    name: 'dsh-optimization-2027:custom-tools',
    order: ORDER_TOOLS,
    interpolate: false,
    text: () => store?.renderIndex() ?? '',
  })

  /**
   * Tier 0 means "this plugin costs nothing", so it has to cost nothing in the
   * tool channel too — not just in the protocol text. The last hook that can
   * trim the tool list is this waterfall: it runs inside assemble(), before the
   * request header is built, so the very first request of an off session
   * already carries no schema from here. Waiting for a tool-removal update
   * would not work on this profile: the router declares no mid-conversation
   * tool protocol, so a removal never reaches the wire.
   */
  ctx.on('system-prompt/assemble', async (assembly, context, next) => {
    const out = await next()
    if (levelFor(context?.agent) !== MIN_LEVEL) return out
    const withheld = ownTools
    const kept = (out.tools ?? []).filter((entry) => !withheld.has(entry?.name))
    return kept.length === (out.tools ?? []).length ? out : { ...out, tools: kept }
  })

  // ------------------------------------------------------------------ tools

  ctx.inject(['tools'], (host) => {
    const tools = host.get('tools')
    if (tools === undefined) return

    const disposers = []
    const add = (definition) => {
      const dispose = tools.register(definition)
      disposers.push(dispose)
      ownTools.set(definition.name, definition)
      // The bookkeeping has to fall away with the tool, or the cost table keeps
      // charging for a schema that is no longer on the wire: removing one
      // declared tool would leave every tier over-reporting by its size.
      return () => {
        ownTools.delete(definition.name)
        dispose()
      }
    }
    host.effect(
      () => () => {
        for (const dispose of disposers.splice(0)) {
          try {
            dispose()
          } catch {}
        }
      },
      'dsh-optimization-2027: dispose registered tools',
    )

    /** Register one declared custom tool; returns its disposer. */
    const registerDeclared = (decl) =>
      add(
        tool({
          name: decl.name,
          description: [
            decl.description,
            '',
            'Declared as a PowerShell command template. Every {{parameter}} is inserted as a single-quoted literal, so a value cannot inject an operator.',
          ].join('\n'),
          parameters: decl.parameters,
          async execute(args, exec) {
            if (shells === null) {
              throw new Error('shellEnabled is false; a declared tool has no shell to run in')
            }
            const command = renderCommand(decl.command, decl.parameters, args)
            const result = await shells.run(exec?.agent, command)
            return {
              report: [
                `# ${decl.name}`,
                '',
                '```powershell',
                command,
                '```',
                '',
                result.output.length > 0 ? result.output : '_(no output)_',
                '',
                `exit ${result.exitCode ?? 'unknown'}${result.failed ? ' (raised)' : ''}${result.truncated ? ' · output truncated' : ''}`,
              ].join('\n'),
            }
          },
        }),
      )

    store = new CustomToolStore(
      config.customToolsDir.length > 0 ? config.customToolsDir : join(dataDir, 'tools'),
      registerDeclared,
    )
    const loaded = store.load()

    // ------------------------------------------------------ persistent shell

    if (shells !== null) {
      add(
        tool({
          name: 'shell2027',
          description:
            'Run PowerShell in a session that persists between calls: cwd, environment variables and started processes survive. Use it instead of a one-process-per-call shell when you need to stay somewhere or keep state.',
          parameters: {
            type: 'object',
            properties: {
              script: { type: 'string', description: 'PowerShell to run. Multiple lines are one block.' },
              cwd: { type: 'string', description: 'Optional directory to enter before running the script.' },
              timeout_ms: {
                type: 'number',
                minimum: 1000,
                maximum: 1_800_000,
                description: `Kill the shell if the script exceeds this. Defaults to ${config.shellTimeoutMs}.`,
              },
            },
            required: ['script'],
          },
          async execute(args, exec) {
            const started = Date.now()
            const result = await shells.run(exec?.agent, args.script, {
              timeoutMs: args.timeout_ms,
              cwd: args.cwd,
            })
            const status = shells.status(exec?.agent)
            return {
              report: [
                result.output.length > 0 ? result.output : '_(no output)_',
                '',
                `exit ${result.exitCode ?? 'unknown'}${result.failed ? ' (raised)' : ''} · ${Date.now() - started} ms · pid ${status.pid ?? 'none'} · run ${status.runs}${result.truncated ? ' · output truncated' : ''}`,
              ].join('\n'),
            }
          },
        }),
      )

      add(
        tool({
          name: 'shell_reset',
          description:
            'Discard the persistent shell for this agent. Use it after a script left the session in a bad state: wrong directory, broken environment, a killed child.',
          parameters: { type: 'object', properties: {} },
          async execute(_args, exec) {
            const had = shells.reset(exec?.agent)
            return {
              report: had
                ? 'Shell reset. The next shell2027 call starts a clean process with a fresh environment.'
                : 'No live shell for this agent; the next shell2027 call starts one anyway.',
            }
          },
        }),
      )
    }

    // ------------------------------------------------------- declared tools

    add(
      tool({
        name: 'tool2027',
        description: [
          'Declare, list, inspect or remove a custom tool: a JSON declaration (name, description, parameter schema, PowerShell template with {{placeholders}}), never JavaScript.',
          'Declare one when the same command sequence has been retyped three times. Its authority is exactly the shell authority you already have.',
        ].join(' '),
        parameters: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['list', 'show', 'save', 'remove'], description: 'What to do.' },
            name: { type: 'string', description: 'Tool name for show/save/remove. Lowercase, 2-47 chars, [a-z0-9_].' },
            description: { type: 'string', description: 'For save: one sentence on when to call it.' },
            parameters: {
              type: 'object',
              description:
                'For save: JSON Schema for the tool parameters, e.g. {"type":"object","properties":{"path":{"type":"string"}},"required":["path"]}.',
            },
            command: {
              type: 'string',
              description: 'For save: PowerShell template. Use {{name}} for parameters, e.g. Get-ChildItem -LiteralPath {{path}}',
            },
          },
          required: ['action'],
        },
        async execute(args) {
          const action = String(args?.action ?? '').trim()
          if (store === null) throw new Error('tool2027: the custom tool store is not available')
          if (action === 'list') {
            const list = store.list()
            if (list.length === 0) return { report: `No custom tools declared. Directory: ${store.dir}` }
            return {
              report: [
                `Custom tools in ${store.dir}:`,
                '',
                ...list.map(
                  (entry) =>
                    `- ${entry.name}${entry.params.length > 0 ? ` (${entry.params.join(', ')})` : ''} — ${entry.description}\n  doc: ${entry.doc}`,
                ),
              ].join('\n'),
            }
          }
          if (action === 'show') {
            const decl = store.get(args?.name)
            if (decl === null) throw new Error(`tool2027: no custom tool named ${slugOf(args?.name)}`)
            return {
              report: [
                `# ${decl.name}`,
                '',
                decl.description,
                '',
                '```powershell',
                decl.command,
                '```',
                '',
                `doc: ${store.mdPath(decl.name)}`,
              ].join('\n'),
            }
          }
          if (action === 'save') {
            const saved = store.save({
              name: args?.name,
              description: args?.description,
              parameters: args?.parameters,
              command: args?.command,
            })
            return {
              report: [
                `Declared ${saved.name}. It is callable now, without a restart.`,
                '',
                '```powershell',
                saved.command,
                '```',
                '',
                `doc: ${store.mdPath(saved.name)}`,
              ].join('\n'),
            }
          }
          if (action === 'remove') {
            const removed = store.remove(args?.name)
            return { report: `Removed ${removed}. The next prompt no longer lists it.` }
          }
          throw new Error(`tool2027: action must be list, show, save or remove; got ${action}`)
        },
      }),
    )

    // ------------------------------------------------------------- ledger

    // One tool, three actions. Three separate tools would repeat most of their
    // schema on every request forever; the shared vocabulary (a claim, its
    // channel, its evidence) is declared once here instead.
    add(
      tool({
        name: 'claim',
        description: [
          'Record what the answer rests on, check it, audit before answering.',
          'add: text + channel; load-bearing needs evidence or a check, else it is a refused guess.',
          'settle: id + holds; holds:false keeps the claim and marks it falsified.',
          'audit: nothing. Unverified and unsupported are counted apart.',
        ].join(' '),
        parameters: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['add', 'settle', 'audit'] },
            text: { type: 'string', description: 'add: the claim, one sentence.' },
            channel: { type: 'string', enum: ['observed', 'derived', 'assumed', 'guessed'] },
            loadBearing: { type: 'boolean', description: 'add: true if the answer collapses when this is wrong.' },
            evidence: { type: 'string', description: 'add: the output, path, line or value it rests on.' },
            check: { type: 'string', description: 'add: what would settle it, if you have not looked yet.' },
            id: { type: 'string', description: 'settle: claim id, e.g. c3.' },
            holds: { type: 'boolean', description: 'settle: did it survive the check?' },
            result: { type: 'string', description: 'settle: what the check showed.' },
          },
          required: ['action'],
        },
        async execute(args, exec) {
          const ledger = ledgerFor(exec?.agent)
          const action = String(args?.action ?? '').trim().toLowerCase()
          if (action === 'add') {
            return { report: `Recorded.\n\n${renderClaim(ledger.add(args ?? {}))}` }
          }
          if (action === 'settle') {
            const claim = ledger.settle(args?.id, { holds: args?.holds === true, result: args?.result })
            return { report: `Settled.\n\n${renderClaim(claim)}` }
          }
          if (action === 'audit') {
            return { report: renderAudit(ledger.audit()) }
          }
          throw new Error(`claim: action must be add, settle or audit; got ${action}`)
        },
      }),
    )

    // ------------------------------------------------------------ analyst

    add(
      tool({
        name: 'analyst_brief',
        description: [
          'Build a read-only brief for a subagent, then pass the returned text to the subagent tool.',
          'A delegate may analyze and retrieve; it may not write, edit, run commands or make the decision. A brief that asks for any of those is refused with the reason.',
          'The brief deliberately does not carry your hypothesis: an analyst told the expected answer will find it, whether or not it is true.',
          'Pass the reply back as `report` to have it framed as testimony, not fact.',
        ].join(' '),
        parameters: {
          type: 'object',
          properties: {
            question: { type: 'string', description: 'The one question the delegate answers.' },
            context: { type: 'string', description: 'What the delegate may rely on. Not your conclusion.' },
            workspace: { type: 'string', description: 'Where to look: paths, files, read-only commands.' },
            form: {
              type: 'array',
              items: { type: 'string', enum: ['conclusion', 'evidence', 'uncertainty', 'counterexample'] },
              description: 'Answer sections, in order. Defaults to all four.',
            },
            forbid: { type: 'string', description: 'One extra hard limit for this brief.' },
            report: {
              type: 'string',
              description:
                'Optional: paste the delegate reply here to have it framed as testimony before you rely on it.',
            },
            stopReason: {
              type: 'string',
              description: 'Optional: the delegate stop reason, so a truncated report is marked incomplete.',
            },
          },
          required: ['question'],
        },
        async execute(args) {
          // The whole brief can carry an instruction, not just the question: a
          // caller who keeps the question innocent and writes "and then apply it"
          // into the context has still handed the delegate a mutation.
          const verdict = classifyBrief(
            [args?.question, args?.context, args?.workspace].filter((part) => typeof part === 'string').join('\n'),
          )
          if (verdict.mutating) {
            return {
              report: [
                `Refused: the brief asks a delegate to change state ("${verdict.matched}", ${verdict.tier} match).`,
                '',
                MUTATION_REFUSAL,
              ].join('\n'),
            }
          }
          const report = String(args?.report ?? '').trim()
          if (report.length > 0) {
            return {
              report: frameReport({ label: 'the delegate', output: report, stopReason: args?.stopReason }),
            }
          }
          const brief = analystPrompt({
            question: args?.question,
            context: args?.context,
            workspace: args?.workspace,
            form: args?.form,
            forbid: args?.forbid,
          })
          return {
            report: [
              brief,
              '',
              '---',
              '',
              'Pass the text above to the subagent tool as its prompt. When it returns,',
              'pass the reply back to this tool as `report` to have it framed as testimony.',
            ].join('\n'),
          }
        },
      }),
    )

    if (loaded.problems.length > 0) {
      ctx.logger?.warn?.(
        `[dsh-optimization-2027] ${loaded.problems.length} custom tool declaration(s) skipped:\n${loaded.problems.join('\n')}`,
      )
    }
  })

  // ----------------------------------------------------------- one authority

  // Everything below is the single implementation of every verb. The slash
  // command and the HTTP route that the composer button posts to both call
  // `surface.invoke`; neither has its own copy of the logic.

  {
    const help = [
      'dsh-optimization-2027 — reasoning protocol, claim ledger, declared tools, persistent shell.',
      '',
      '  /dopt2027                      status',
      '  /dopt2027 level <0-4>          set the reasoning tier for this session (0 = off)',
      '  /dopt2027 levels               tiers 0-4, the rules each adds, and what each costs per request',
      '  /dopt2027 tools                list declared custom tools',
      '  /dopt2027 ledger               audit the claim ledger',
      '  /dopt2027 rearm                re-send the runtime context as a message, retiring the older copies',
      '  /dopt2027 rearm <n> | off      set the automatic re-arm distance; off is the same as 0',
    ].join('\n')

    /** How many re-arms each agent has received; the header carries the count. */
    const rearmCounts = new Map()
    /** Last delivered body per agent, so a repeated press costs no tokens. */
    const lastRearmBody = new Map()

    /**
     * The surface nodes this plugin is allowed to rewrite: `user/message` events
     * whose source says a previous re-arm produced them.
     *
     * Read back from the session rather than from memory, so snapshots written
     * before this code existed are found too — the two 177k-character ones in
     * this log were appended by a version that had no registry.
     */
    const snapshotNodes = (session) => {
      const nodes = session?.surface?.nodes
      if (!Array.isArray(nodes)) return []
      const found = []
      for (const seq of nodes) {
        const event = session.eventAt?.(seq)
        if (event?.type !== 'user/message') continue
        if (event.data?.source?.kind === 'system-prompt') found.push(seq)
      }
      return found
    }

    /**
     * Retire every earlier snapshot by replacing each one with a one-line note.
     *
     * This is the half an append-only channel cannot do by itself. The protocol
     * has changed four times (level 6/12, tier 3/4, tier 2/4) and the old copies
     * stayed in history claiming the old rules; the two stale ones alone held
     * 353,155 characters. `Session.append` accepts
     * `surfaceOp: {op:'replace', startSeq, endSeq}` — the harness's own system
     * prompt projection uses exactly that to blank superseded nodes — so the
     * outdated text leaves the transcript while the log keeps its record.
     *
     * One node at a time, deliberately: a range replace must densely cover every
     * surface node it shadows, so spanning from the first snapshot to the last
     * would swallow every message in between.
     *
     * The replacement carries a short sentence instead of empty content. An
     * empty `user/message` still projects (only system, developer and assistant
     * messages drop on empty content), and a zero-content user turn reaching a
     * provider is a needless edge case when one sentence removes it.
     */
    const retireSnapshots = (session, replacement) => {
      const retired = []
      for (const seq of snapshotNodes(session)) {
        try {
          session.append(
            'user/message',
            {
              id: randomUUID(),
              role: 'user',
              content: [{ type: 'text', text: replacement }],
              source: { kind: 'system-prompt' },
            },
            { surfaceOp: { op: 'replace', startSeq: seq, endSeq: seq }, sourceEventSeqs: [seq] },
          )
          retired.push(seq)
        } catch {
          // A node that vanished from the surface between the scan and the write
          // is already retired; anything else must not take the re-arm down.
        }
      }
      return retired
    }

    /**
     * How far the model is from the last copy of the runtime context, counted in
     * surface messages.
     *
     * Measured from the session, not from a step counter: a step that appends
     * forty tool results moves the context just as far as forty steps that
     * append one message each, and only the first number predicts whether the
     * tail of the request still contains the protocol.
     */
    const distanceFromContext = (session) => {
      const nodes = session?.surface?.nodes
      if (!Array.isArray(nodes)) return 0
      let seen = 0
      for (let index = nodes.length - 1; index >= 0; index -= 1) {
        const event = session.eventAt?.(nodes[index])
        if (event?.type !== 'user/message') {
          seen += 1
          continue
        }
        const kind = event.data?.source?.kind
        if (kind === 'runtime-context' || kind === 'system-prompt') return seen
        seen += 1
      }
      return seen
    }

    /**
     * Build the snapshot text, and say how much of it is new.
     *
     * What this carries is the runtime context — the tier protocol and the custom
     * tool index — and nothing else. What it deliberately leaves out:
     *
     * - The base sections. They are stable, they sit at the top of every request
     *   anyway, and repeating them cost 22,762 tokens for text the model never
     *   drifted away from.
     * - The tool signatures. Every request payload carries all 84 full JSON
     *   schemas (`request/header.data.tools`, 21 of 21 requests in this log), so
     *   a signature list is a restatement of what is already in the prompt. It
     *   was 4,088 characters and bought zero information.
     *
     * The stored body is kept so an unchanged press can be answered without
     * writing anything.
     */
    const composeSnapshot = async (agent) => {
      let assembly
      try {
        assembly = await ctx.systemPrompt.assemble({ agent, scope: agent })
      } catch (error) {
        return { error: `Could not assemble the prompt: ${error?.message ?? error}` }
      }
      const contexts = (assembly?.contexts ?? [])
        .map((entry) => (typeof entry?.text === 'string' ? entry.text : ''))
        .filter((text) => text.length > 0)
      const body = contexts.join('\n\n')
      const key = agentIdOf(agent)
      const level = levelFor(agent)
      const sequence = (rearmCounts.get(key) ?? 0) + 1
      const text = [
        `dsh-optimization-2027 re-arm #${sequence} · tier ${level}/${MAX_LEVEL} (${levelTitle(level)}) · ${new Date().toISOString()}`,
        '',
        'The runtime context as it stands now. This is a snapshot: a later re-arm or a',
        'later runtime context supersedes it, and when two of them disagree the later',
        'one is the current one. Superseded copies have been replaced with a note.',
        '',
        body,
      ].join('\n')
      // Canonical user message, built by hand: `createUserMessage` lives in
      // @deepseek-ai/dsh-llm, which does not resolve from a profile-linked
      // plugin. The shape is the documented one — id, role, text blocks, source.
      const message = {
        id: randomUUID(),
        role: 'user',
        content: [{ type: 'text', text }],
        source: { kind: 'system-prompt' },
      }
      return { key, sequence, level, body, text, message, contexts: contexts.length }
    }

    /**
     * Re-send the runtime context as one message, retiring the earlier copies.
     *
     * Called from two places with one implementation: the command and the button
     * both reach it through `surface.invoke`, and `agent/pre-step` reaches it
     * when a request has drifted far enough that the protocol at the front of it
     * is no longer in view.
     */
    const rearm = async (agent) => {
      if (agent === undefined) return { kind: 'error', text: '/dopt2027 rearm needs a live agent.' }
      const composed = await composeSnapshot(agent)
      if (composed.error !== undefined) return { kind: 'error', text: composed.error }
      const { key, sequence, level, body, text, message, contexts } = composed
      if (lastRearmBody.get(key) === body) {
        return {
          kind: 'success',
          text: `Re-arm #${rearmCounts.get(key) ?? 0} is unchanged (tier ${level}/${MAX_LEVEL}); not delivered again.`,
        }
      }
      const retired = retireSnapshots(
        agent.session,
        '(a superseded dsh-optimization-2027 snapshot was removed here; a later one is current)',
      )
      try {
        if (agent.status === 'idle') agent.steer(message)
        else agent.inject(message)
      } catch (error) {
        return { kind: 'error', text: `Could not deliver: ${error?.message ?? error}` }
      }
      rearmCounts.set(key, sequence)
      lastRearmBody.set(key, body)
      return {
        kind: 'success',
        text: [
          `Re-arm #${sequence}: ${contexts} context(s), ${text.length} chars delivered as one message.`,
          retired.length === 0 ? 'No earlier snapshot was left in the transcript.' : `Replaced ${retired.length} earlier snapshot(s) with a one-line note.`,
        ].join(' '),
      }
    }

    /**
     * Re-arm on drift, without being asked.
     *
     * `agent/pre-step` runs before every step and its returned `messages` are
     * appended to the session as they are, which is the documented way for a
     * plugin to put a user message in front of the model mid-request. Using it
     * instead of `agent.steer` keeps the delivery in the same place as the
     * runtime context, so ordering is well defined: the loop appends the
     * context first and then whatever else the waterfall returned.
     *
     * Off unless the threshold in force for this agent is positive. The check
     * moved inside the handler (it used to gate the subscription) because the
     * threshold is now a per-session setting the panel can change without a
     * restart: a hook that only exists when the config said so could never be
     * switched on from the panel.
     *
     * Measured drift across all 18 sessions on this machine: 213 requests, the
     * distance to the last runtime context was 0 for 41 of them (19%), median
     * 145, p90 453, max 561. A threshold of 120 fires on 51% of requests —
     * roughly every other request — so `levels`/`state` recommend 300 (30%).
     * One fire costs one snapshot: 1,993 characters at tier 4, not 177k.
     */
    ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
      const decision = await next()
      if (decision.kind === 'reject' || signal?.aborted === true) return decision
      try {
        if (agent?.session === undefined) return decision
        const threshold = rearmDistanceFor(agent)
        if (!(threshold > 0)) return decision
        if (distanceFromContext(agent.session) <= threshold) return decision
        const composed = await composeSnapshot(agent)
        if (composed.error !== undefined) return decision
        if (lastRearmBody.get(composed.key) === composed.body) return decision
        retireSnapshots(
          agent.session,
          '(a superseded dsh-optimization-2027 snapshot was removed here; a later one is current)',
        )
        rearmCounts.set(composed.key, composed.sequence)
        lastRearmBody.set(composed.key, composed.body)
        return { ...decision, messages: [...decision.messages, composed.message] }
      } catch {
        // A re-arm that cannot be composed must leave the step untouched:
        // losing the turn over a reminder would be the worse failure.
        return decision
      }
    })

    /**
     * The implementation. `rawInput` is the text after the command name, so a
     * button sending `{verb:'level', argument:'7'}` and a person typing
     * `/dopt2027 level 7` reach the same function with the same string.
     */
    const run = async (rawInput, agent) => {
      const raw = String(rawInput ?? '').trim()
      const [verb = '', ...rest] = raw.split(/\s+/)
      const argument = rest.join(' ').trim()
      const lower = verb.toLowerCase()

      if (lower === '' || lower === 'status') {
        const level = levelFor(agent)
        const shellStatus = shells?.status(agent)
        const audit = ledgerFor(agent).audit()
        const cost = protocolCost(level, toolCostTokens())
        return {
          kind: 'success',
          text: [
            `tier ${level}/${MAX_LEVEL} — ${levelTitle(level)} · ~${cost.totalTokens} tok/request`,
            `tools ${store?.list().length ?? 0} declared — ${store?.dir ?? '(store not loaded)'}`,
            shells === null
              ? 'shell disabled (shellEnabled:false)'
              : `shell pid ${shellStatus?.pid ?? 'none'} · runs ${shellStatus?.runs ?? 0}`,
            `ledger ${audit.total} claims · ${audit.loadBearing} load-bearing · ${audit.unverified} unverified · ${audit.falsified} falsified`,
          ].join('\n'),
        }
      }

      if (lower === 'level') {
        const wanted = Number(argument)
        if (!Number.isFinite(wanted)) {
          return { kind: 'error', text: `/dopt2027 level needs a number ${MIN_LEVEL}-${MAX_LEVEL}.` }
        }
        const applied = setLevel(agent, wanted)
        const described = describeLevel(applied)
        const cost = protocolCost(applied, toolCostTokens())
        return {
          kind: 'success',
          text: `Tier ${applied} — ${described.title}. ${described.rules.length} rule(s) active, ~${cost.totalTokens} tok per request. Applies from the next request.`,
        }
      }

      if (lower === 'levels') {
        return { kind: 'success', text: renderLevelTable(levelFor(agent), toolCostTokens()) }
      }

      if (lower === 'tools') {
        const list = store?.list() ?? []
        if (list.length === 0) {
          return { kind: 'success', text: `No custom tools declared. Directory: ${store?.dir ?? '(none)'}` }
        }
        return {
          kind: 'success',
          text: list
            .map(
              (entry) =>
                `${entry.name}${entry.params.length > 0 ? ` (${entry.params.join(', ')})` : ''} — ${entry.description}`,
            )
            .join('\n'),
        }
      }

      if (lower === 'ledger') {
        return { kind: 'success', text: renderAudit(ledgerFor(agent).audit()) }
      }

      if (lower === 'rearm') {
        // `rearm` alone re-sends now; `rearm <n>` sets the drift threshold,
        // with `off` and an empty argument both meaning 0. Two behaviours on
        // one verb because they are the manual and automatic halves of the
        // same decision, and a person who just pressed the button is the
        // person most likely to want the automatic one tuned.
        if (argument.length === 0) return await rearm(agent)
        const wanted = argument.toLowerCase() === 'off' ? 0 : Number(argument)
        if (!Number.isFinite(wanted) || wanted < 0) {
          return { kind: 'error', text: `/dopt2027 rearm needs a message count, or "off".` }
        }
        const applied = setRearmDistance(agent, wanted)
        return {
          kind: 'success',
          text:
            applied === 0
              ? 'Automatic re-arm off: a request no longer re-sends the runtime context on its own.'
              : `Automatic re-arm at ${applied} message(s): a step whose last runtime context is further back than that re-sends one snapshot first.`,
        }
      }

      return { kind: 'error', text: `Unknown /dopt2027 subcommand: ${verb}\n\n${help}` }
    }

    /**
     * The published surface. `invoke` takes exactly the two things a caller can
     * supply — the text after the command name and the agent to act on — so the
     * route below cannot invent a third input the command does not have.
     */
    surface = {
      help,
      invoke: (rawInput, agent) => run(rawInput, agent),
    }
  }

  // ----------------------------------------------------------------- command

  ctx.inject(['commands'], (host) => {
    const commands = host.get('commands')
    if (commands === undefined) return
    if (surface === null) return

    /**
     * Registration is deliberately not wrapped in a try/catch. A rejected name
     * inside a catch is invisible: the logger line goes nowhere the user reads
     * and the command silently never exists. A throw here fails the entry loudly
     * instead.
     */
    host.effect(() =>
      commands.register({
        name: COMMAND_NAME,
        description: 'dsh-optimization-2027: status, reasoning level, declared tools, claim ledger, re-arm.',
        input: {
          hint: 'status | level <0-4> | levels | tools | ledger | rearm',
        },
        handler: async (invocation) =>
          await surface.invoke(invocation?.rawInput, invocation?.agent),
      }),
    )
  })

  // ------------------------------------------------------------------- route

  /**
   * The composer button's way back into this process.
   *
   * The Client half runs in the renderer and cannot call a Host service
   * directly. An HTTP route on the harness's own origin is the one route that is
   * both documented and already in use by installed plugins here, so the button
   * posts JSON to it and this handler calls the same `surface.invoke` the typed
   * command calls.
   *
   * Three refusals are load-bearing:
   * - not loopback → 403. A credit-adjacent surface is not worth the benefit of
   *   the doubt.
   * - POST only → 405. A GET from a link, an image tag or a prefetcher must not
   *   be able to change the reasoning level.
   * - unparseable body → 400, never a guessed default.
   */
  ctx.inject(['webServer'], (host) => {
    const webServer = host.get('webServer')
    if (webServer === undefined) return
    if (surface === null) return

    const currentAgent = (session) => anyAgent(host.get('agents'), session)

    const handler = async (req, res) => {
      const send = (status, body) => {
        const payload = JSON.stringify(body)
        res.writeHead(status, {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': Buffer.byteLength(payload),
          'Cache-Control': 'no-store',
        })
        res.end(payload)
      }

      if (!isLoopback(req)) {
        send(403, { error: 'loopback-only' })
        return
      }
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '600',
        })
        res.end()
        return
      }
      if (req.method !== 'POST') {
        send(405, { error: 'method-not-allowed', allow: 'POST' })
        return
      }

      let body
      try {
        body = await readJson(req, BODY_LIMIT)
      } catch (error) {
        send(400, { error: 'bad-request', detail: String(error?.message ?? error) })
        return
      }

      const action = typeof body?.action === 'string' ? body.action : ''
      if (action === 'state') {
        // Read-only projection for the button's own label. It goes through the
        // same `status`/`levels` verbs the command has; nothing here reads state
        // the command could not also print.
        const agent = currentAgent(body?.session)
        const status = await surface.invoke('status', agent)
        const level = levelFor(agent)
        send(200, {
          ok: status.kind === 'success',
          status: status.text,
          level,
          levelTitle: levelTitle(level),
          maxLevel: MAX_LEVEL,
          minLevel: MIN_LEVEL,
          // The panel carries an automatic re-arm field. It shows the number in
          // force and writes it back through the `rearm <n>` verb, so the field
          // and the command can never disagree.
          rearmDistance: rearmDistanceFor(agent),
          // The panel draws a cost column next to the tier chips, so the numbers
          // have to come from the same place the protocol is built from — the
          // client cannot compute them without duplicating the rule table.
          // `totalTokens` is what the tier actually costs per request: protocol
          // text plus the tool schemas this plugin puts on the wire.
          cost: protocolCost(level, toolCostTokens()),
          costs: costTable(toolCostTokens()),
        })
        return
      }

      if (action === 'invoke') {
        const text = typeof body?.input === 'string' ? body.input : ''
        if (text.trim().length === 0) {
          send(400, { error: 'empty-input', detail: 'action "invoke" needs a non-empty input.' })
          return
        }
        const agent = currentAgent(body?.session)
        const result = await surface.invoke(text, agent)
        send(result.kind === 'success' ? 200 : 400, {
          ok: result.kind === 'success',
          text: result.text ?? '',
        })
        return
      }

      send(400, {
        error: 'unknown-action',
        detail: `action must be "state" or "invoke".`,
        help: surface.help,
      })
    }

    host.effect(() => webServer.register({ kind: 'prefix', path: ROUTE_PATH, handler }), ROUTE_PATH)
  })
}
