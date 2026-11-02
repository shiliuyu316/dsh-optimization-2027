// Marginal cost of the reasoning protocol in the host's own rendering path.
//
// Why this exists: renderProtocol(0) is '' and the host drops empty sections,
// so "tier 0 costs 0" has to be proven against the host renderer, not against
// the plugin's own string. This measures the difference in the FINAL snapshot
// text with and without the protocol context, per tier.
//
// Run (no node on PATH):
//   $env:ELECTRON_RUN_AS_NODE='1'; & 'D:\DSH\DeepSeek Harness.exe' test\tier-cost.mjs

import { existsSync } from 'node:fs'
import { join } from 'node:path'

// The host ships either as an asar archive or as an unpacked directory,
// depending on how this machine was installed (and a purge/repack moves it
// between the two). Hard-coding one of them makes this suite fail for a reason
// that has nothing to do with the thing it measures, so probe both.
const REL = 'dsh/node_modules/@deepseek-ai/dsh-system-prompt/lib/index.js'
const HOST_CANDIDATES = [
  'D:/DSH/resources/app',
  'D:/DSH/resources/app.asar',
  'D:/DSH/resources/app.asar.unpacked',
].map((root) => join(root, REL))

const hostPath = HOST_CANDIDATES.find((candidate) => existsSync(candidate))
if (hostPath === undefined) {
  console.error(`tier-cost: no host system-prompt module found. Looked in:\n  ${HOST_CANDIDATES.join('\n  ')}`)
  process.exit(1)
}

const HOST = new URL(`file:///${hostPath.replace(/\\/g, '/')}`).href
const LEVELS = new URL('../lib/levels.js', import.meta.url).href

const [{ renderProtocol, clampLevel, levelTitle, MAX_LEVEL, MIN_LEVEL }, host] = await Promise.all([
  import(LEVELS),
  import(HOST),
])

// The other runtime-context sections a real request carries on this machine.
const others = [
  { name: 'cwd', text: 'Current working directory: "D:\\会话1".' },
  { name: 'policy', text: 'Current DSH file policy: danger-full-access. The DSH file sandbox does not restrict file modifications by available operations.' },
  { name: 'gui', text: 'Current DeepSeek Harness Web GUI URL: "http://127.0.0.1:41234".' },
]

const render = (contexts) => host.renderContextSnapshot({ contexts, variables: {} })

const baseline = render(others)
let failed = 0
const check = (label, ok, detail) => {
  if (!ok) failed += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail === undefined ? '' : `  (${detail})`}`)
}

check('the host renders a non-empty snapshot for the baseline', baseline.length > 0, `${baseline.length} chars`)

for (let n = MIN_LEVEL; n <= MAX_LEVEL; n += 1) {
  const text = renderProtocol(n)
  const withProtocol = render([...others, { name: 'dsh-optimization-2027:protocol', text }])
  const marginal = withProtocol.length - baseline.length
  console.log(
    `tier ${n} ${levelTitle(n).padEnd(12)} raw=${String(text.length).padStart(4)} marginal=${String(marginal).padStart(4)}`,
  )
  if (n === 0) {
    check('tier 0 adds exactly 0 chars to the final snapshot', marginal === 0, `${marginal} chars`)
    check('tier 0 renders an empty protocol string', text.length === 0, JSON.stringify(text))
    check('tier 0 leaves the baseline snapshot untouched', withProtocol === baseline)
  }
  if (n > 0) {
    check(`tier ${n} adds a positive, monotone amount`, marginal > 0, `${marginal} chars`)
  }
}

check('the off tier is the floor', clampLevel(-1) === 0 && clampLevel(9) === MAX_LEVEL, `${clampLevel(-1)}/${clampLevel(9)}`)

if (failed === 0) {
  console.log('\nall tier-cost checks passed')
} else {
  console.log(`\n${failed} check(s) failed`)
  process.exitCode = 1
}
