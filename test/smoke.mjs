/**
 * Functional smoke test for the parts that do not need a Cordis context.
 *
 * This is not a substitute for loading the plugin: it exercises the pure
 * behaviour — protocol rendering, the ledger's refusal rules, the placeholder
 * substitution that is supposed to make injection impossible, and the brief
 * classifier. If any of those are wrong, the plugin is wrong no matter how
 * cleanly it mounts.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 "DeepSeek Harness.exe" test/smoke.mjs
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  CHARS_PER_TOKEN,
  DEFAULT_LEVEL,
  MAX_LEVEL,
  MIN_LEVEL,
  activeRules,
  clampLevel,
  costTable,
  levelTitle,
  protocolCost,
  renderLevelTable,
  renderProtocol,
} from '../lib/levels.js'
import { ClaimLedger, renderAudit } from '../lib/ledger.js'
import { CustomToolStore, placeholdersIn, renderCommand, slugOf } from '../lib/custom-tools.js'
import { classifyBrief, analystPrompt, frameReport } from '../lib/analyst.js'

let failures = 0
const results = []

function check(label, condition, detail) {
  if (condition) {
    results.push(`ok   ${label}`)
  } else {
    failures += 1
    results.push(`FAIL ${label}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

function throws(label, fn, matcher) {
  try {
    fn()
    failures += 1
    results.push(`FAIL ${label} — did not throw`)
  } catch (error) {
    const message = String(error?.message ?? error)
    const ok = matcher === undefined || matcher.test(message)
    if (ok) results.push(`ok   ${label}`)
    else {
      failures += 1
      results.push(`FAIL ${label} — wrong error: ${message}`)
    }
  }
}

// ------------------------------------------------------------------- levels

check('clampLevel floors at MIN_LEVEL', clampLevel(-5) === MIN_LEVEL)
check('clampLevel ceilings at MAX_LEVEL', clampLevel(99) === MAX_LEVEL)
check('clampLevel survives a non-number', clampLevel('abc') === DEFAULT_LEVEL)
check('the floor is the off switch, not tier 1', MIN_LEVEL === 0, String(MIN_LEVEL))
// A new session has no stored tier and falls back to DEFAULT_LEVEL, so this
// value decides what every fresh conversation pays before anyone asks.
check('a new session starts at the off switch', DEFAULT_LEVEL === 0, String(DEFAULT_LEVEL))
check('the default tier injects nothing', renderProtocol(DEFAULT_LEVEL) === '', JSON.stringify(renderProtocol(DEFAULT_LEVEL)))
check(
  'an unreadable tier falls back to the off switch',
  clampLevel(undefined) === 0 && clampLevel(Number.NaN) === 0,
  `${clampLevel(undefined)}/${clampLevel(Number.NaN)}`,
)

const l0 = renderProtocol(0)
check('tier 0 renders the empty string', l0 === '', JSON.stringify(l0))
check('tier 0 activates no rule', activeRules(0).length === 0, `${activeRules(0).length} rules`)
check('tier 0 costs exactly zero characters', l0.length === 0, `${l0.length} chars`)
check('tier 0 costs less than tier 1', l0.length < renderProtocol(1).length, `${l0.length} vs ${renderProtocol(1).length}`)
check('tier 0 title is off', levelTitle(0) === 'off', levelTitle(0))
check('tier 0 is reachable by clamping a negative', clampLevel(-1) === 0, String(clampLevel(-1)))

const l1 = renderProtocol(1)
const l4 = renderProtocol(MAX_LEVEL)
check('tier 1 protocol names the tier', l1.includes('tier 1/4'))
check('the top tier protocol names the tier', l4.includes(`tier ${MAX_LEVEL}/4`))
check(
  'protocol is monotone: every tier-1 rule survives at the top tier',
  activeRules(1).every((rule) => activeRules(MAX_LEVEL).some((other) => other.id === rule.id)),
)
check(
  'each tier from 2 up adds at least one rule',
  Array.from({ length: MAX_LEVEL - 1 }, (_, i) => i + 2).every(
    (n) => activeRules(n).length > activeRules(n - 1).length,
  ),
  Array.from({ length: MAX_LEVEL + 1 }, (_, i) => i)
    .map((n) => `${n}:${activeRules(n).length}`)
    .join(' '),
)
check('the top tier is multi-agent', levelTitle(MAX_LEVEL) === 'multi-agent')
check('tier table marks the current tier', renderLevelTable(3).includes('→ 3  deep'))
check('the tier table lists every tier name', ['off', 'light', 'standard', 'deep', 'multi-agent'].every((name) => renderLevelTable(1).includes(name)), renderLevelTable(1))
check('the tier table marks the off tier', renderLevelTable(0).includes('→ 0  off'), renderLevelTable(0))
// The removed design must not creep back in: no tier may instruct the model to
// re-read its own draft or spend an extra pass.
check(
  'no tier asks for a re-read pass',
  !/re-read your (own )?draft|re-read the draft|second pass over/i.test(l1 + l4),
)
// Four tiers must cost materially less than the twelve-level protocol it
// replaced: the top tier used to be 3814 chars, the whole table 382.
check(
  'the top tier is smaller than the old level 12 (3814 chars)',
  l4.length < 2400,
  `${l4.length} chars`,
)
check('the tier table stays under 320 chars', renderLevelTable(2).length < 320, `${renderLevelTable(2).length} chars`)

// --------------------------------------------------------------- tier cost
// The cost columns exist so a tier is chosen for what it costs as well as for
// what it adds, and the numbers have to be derived from the rendered protocol,
// not typed in: a rule edit that changes the block must move the figure.
check(
  'tier 0 costs exactly zero tokens as well as zero characters',
  protocolCost(0).chars === 0 && protocolCost(0).tokens === 0,
  JSON.stringify(protocolCost(0)),
)
check(
  'the cost of a tier is the block it renders',
  costTable().every((row) => row.chars === renderProtocol(row.level).length),
  JSON.stringify(costTable().map((row) => `${row.level}:${row.chars}`)),
)
check(
  'the marginal cost includes the separator the host inserts',
  protocolCost(3).marginalChars === renderProtocol(3).length + 2 && protocolCost(0).marginalChars === 0,
  `${protocolCost(3).marginalChars} / ${protocolCost(0).marginalChars}`,
)
check(
  'tokens are the characters divided by four, rounded up',
  costTable().every((row) => row.tokens === Math.ceil(row.chars / CHARS_PER_TOKEN)),
  JSON.stringify(costTable().map((row) => `${row.level}:${row.tokens}`)),
)
check(
  'every tier costs at least as much as the one below it',
  costTable().every((row, index, all) => index === 0 || row.chars >= all[index - 1].chars),
  JSON.stringify(costTable().map((row) => row.chars)),
)
check(
  'the cost table covers every reachable tier',
  costTable().length === MAX_LEVEL - MIN_LEVEL + 1 && costTable()[0].level === MIN_LEVEL,
  JSON.stringify(costTable().map((row) => row.level)),
)
check(
  'the tier table prints the token cost of each tier',
  costTable().every((row) => renderLevelTable(2).includes(`${row.tokens} tok`)),
  renderLevelTable(2),
)
check('an out-of-range tier is priced at the tier it clamps to', protocolCost(99).chars === protocolCost(MAX_LEVEL).chars, `${protocolCost(99).chars}`)

// ------------------------------------------------------------------- ledger

const dir = mkdtempSync(join(tmpdir(), 'dsh2027-'))
const ledger = new ClaimLedger(join(dir, 'ledger'), 'session-1')
throws(
  'a load-bearing claim with no evidence and no check is refused',
  () => ledger.add({ text: 'the cache is cold', channel: 'assumed', loadBearing: true }),
  /needs evidence or a check/,
)

const backed = ledger.add({
  text: 'the config file sets maxTokens to 128000',
  channel: 'observed',
  loadBearing: true,
  evidence: 'cordis.patch.yml:161',
})
check('a backed claim is stored', backed.id === 'c1' && backed.loadBearing === true)

const soft = ledger.add({ text: 'the user probably wants Chinese', channel: 'assumed' })
check('a non-load-bearing assumption is allowed', soft.id === 'c2' && soft.weak === true)

ledger.settle('c1', { holds: true, result: 'read the line' })
const afterSettle = ledger.audit()
check('a settled claim counts as verified', afterSettle.verified === 1, JSON.stringify(afterSettle))

const broken = ledger.add({
  text: 'the router accepts an explicit effort value',
  channel: 'derived',
  loadBearing: true,
  check: 'send effort=max and read the error',
})
ledger.settle(broken.id, { holds: false, result: 'router rejects it' })
const afterFalsify = ledger.audit()
check('a falsified claim is kept, not deleted', afterFalsify.falsified === 1)
check(
  'a falsified claim is still listed',
  afterFalsify.claims.some((claim) => claim.id === broken.id && claim.falsified === true),
)
check('the audit renders', renderAudit(afterFalsify).includes('falsified'))

// Reload from disk: the ledger is a file, so a restart must resume.
const reopened = new ClaimLedger(join(dir, 'ledger'), 'session-1')
check('the ledger rebuilds from its JSONL file', reopened.audit().total === afterFalsify.total)

// ------------------------------------------------------------- custom tools

check('slugOf folds illegal characters', slugOf('Git Status!') === 'git_status')
check('placeholders are found', placeholdersIn('git log -- {{path}} {{n}}').join(',') === 'path,n')

const schema = {
  type: 'object',
  properties: { path: { type: 'string' }, branch: { type: 'string' } },
  required: ['path'],
}
const rendered = renderCommand('Get-ChildItem -LiteralPath {{path}}', schema, { path: 'C:\\a b' })
check('a value becomes a single-quoted literal', rendered.includes("'C:\\a b'"), rendered)

const quoted = renderCommand('git checkout -- {{branch}}', schema, { path: 'x', branch: "main'; rm -rf /; '" })
check(
  'a quote in a value cannot break out of the literal',
  quoted.includes("'main''; rm -rf /; '''"),
  quoted,
)

throws(
  'a missing required parameter is an error',
  () => renderCommand('Get-ChildItem {{path}}', schema, {}),
  /missing required parameter: path/,
)
throws(
  'an undeclared placeholder is an error',
  () => renderCommand('Get-ChildItem {{nope}}', schema, { path: 'x' }),
  /does not declare it/,
)
throws(
  'an unset optional placeholder is an error, not an empty string',
  () => renderCommand('git log -- {{branch}}', schema, { path: 'x' }),
  /has no value/,
)

const store = new CustomToolStore(join(dir, 'tools'), () => () => {})
const saved = store.save({
  name: 'list_dir',
  description: 'List a directory.',
  parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  command: 'Get-ChildItem -LiteralPath {{path}}',
})
check('a declaration is saved and registered', store.get('list_dir') !== null && saved.name === 'list_dir')
check('the tool document is written', readFileSync(store.mdPath('list_dir'), 'utf8').includes('list_dir'))
check('the prompt index stays one line per tool', store.renderIndex().split('\n').filter((l) => l.startsWith('- ')).length === 1)

throws(
  'a reserved name is refused',
  () => store.save({ name: 'read', description: 'x', parameters: {}, command: 'x' }),
  /reserved/,
)

// ------------------------------------------------------------------ analyst

check('a mutating brief is classified as mutating', classifyBrief('edit the config file and restart the server').mutating === true)
check('a read-only brief is not', classifyBrief('which module reads the config file, and where?').mutating === false)
check('git push is caught', classifyBrief('check whether git push would work').mutating === true)

// The classifier was wrong in both directions before the two-tier split. These
// four cases are the measured failures, kept as regressions.
check(
  'a question about a test runner is not an instruction to run tests',
  classifyBrief('Does the existing test runner run tests in parallel?').mutating === false,
)
check(
  'asking how to run the suite is not asking the delegate to run it',
  classifyBrief('How do I run the test suite to check this?').mutating === false,
)
check(
  'a request form is caught even when the verb is not in the word list',
  classifyBrief('Can you fix the off-by-one in parseCapture?').mutating === true,
)
check(
  'a Chinese request form is caught',
  classifyBrief('帮我改一下 lib/shell.js 里的 parseCapture').mutating === true,
)
check('a Chinese imperative is caught', classifyBrief('把 _app.bin 删掉').mutating === true)
check(
  'a Chinese question is not an imperative',
  classifyBrief('parseCapture 在命令抛错时返回什么？').mutating === false,
)
check(
  'a hard pattern wins over the question frame',
  classifyBrief('would git push merge this cleanly?').mutating === true,
)
check(
  'an instruction hidden in the context is caught, not just one in the question',
  classifyBrief('what does lib/shell.js do?\nedit lib/shell.js to fix it').mutating === true,
)

const brief = analystPrompt({ question: 'which module reads the config file?', workspace: 'lib/' })
check('the brief carries the question', brief.includes('which module reads the config file?'))
check('the brief forbids mutation', brief.includes('Do not modify, create, move or delete any file.'))
check('the brief asks for a counterexample', brief.includes('counterexample'))

check(
  'a truncated report is marked incomplete',
  frameReport({ label: 'a', output: 'partial', stopReason: 'max-tokens' }).includes('Incomplete'),
)
check(
  'a normal report is still framed as testimony',
  frameReport({ label: 'a', output: 'done', stopReason: 'end' }).includes('testimony, not fact'),
)

rmSync(dir, { recursive: true, force: true })

const summary = [
  ...results,
  '',
  failures === 0 ? `all ${results.length} checks passed` : `${failures} of ${results.length} checks FAILED`,
].join('\n')
process.stdout.write(`${summary}\n`)
process.exitCode = failures === 0 ? 0 : 1
