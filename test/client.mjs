/**
 * Client half test: does client.js register into the composer dock in the shape
 * the harness actually accepts?
 *
 * The harness loads this file through `window.__ModuleLoader__.load`, hands the
 * factory a `require` that resolves `react`, and calls `apply(ctx)` with a
 * context carrying the `slots` service. None of that needs a browser here: a
 * stub loader, a stub React and a stub slots service exercise the same code
 * path, and the assertions below encode the three failures that produce a dead
 * or doubled button:
 *
 * - the module id must equal the package name, or the loader drops it
 * - `register` must name the slot, its own id and a numeric order
 * - a replayed `apply` must not register twice
 *
 * Run: ELECTRON_RUN_AS_NODE=1 "DeepSeek Harness.exe" test/client.mjs
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const source = readFileSync(join(root, 'client.js'), 'utf8')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

const results = []
let failures = 0
function check(label, condition, detail) {
  if (condition) results.push(`ok   ${label}`)
  else {
    failures += 1
    results.push(`FAIL ${label}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

// A React small enough to build the tree without a renderer. Every hook keeps
// its own cell, so the component body runs the same statements it would in a
// browser.
function makeReact() {
  const cells = []
  const effects = []
  let cursor = 0
  const reset = () => {
    cursor = 0
  }
  const slot = (initial) => {
    const index = cursor++
    if (!(index in cells)) cells[index] = initial
    return [
      cells[index],
      (next) => {
        cells[index] = typeof next === 'function' ? next(cells[index]) : next
      },
    ]
  }
  return {
    __reset: reset,
    __cells: cells,
    __effects: effects,
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat() }),
    useState: (initial) => slot(initial),
    useRef: (initial) => slot({ current: initial }),
    // Keep the latest closure, not the first one: React re-creates a callback
    // when its deps change, and a stub that pinned the first closure would run
    // a stale `session` and quietly hide exactly the bug this test looks for.
    useCallback: (fn) => {
      const index = cursor++
      cells[index] = fn
      return fn
    },
    // Effects are recorded, not run: a render pass must stay pure. Tests that
    // care about the effect body call `__effects[i]()` themselves.
    useEffect: (fn) => {
      const index = cursor++
      effects[index] = fn
      return fn
    },
  }
}
const react = makeReact()
const loaded = []
const registered = []
let injectedInto = []

const documentStub = {
  documentElement: { lang: 'zh-CN' },
  head: { appendChild: (node) => styles.push(node) },
  querySelector: () => null,
  createElement: () => ({ setAttribute: (name, value) => { created.attrs.push([name, value]) }, textContent: '' }),
  addEventListener: () => {},
  removeEventListener: () => {},
}
const styles = []
const created = { attrs: [] }

globalThis.window = {
  __ModuleLoader__: {
    load: (definition) => loaded.push(definition),
  },
}
globalThis.document = documentStub

// Evaluate the file the way the loader does: it defines exactly one module.
// `window`, `document`, `navigator` and `fetch` are passed as parameters so the
// file's own references resolve to these stubs rather than to Node globals —
// `navigator` in particular is getter-only on the real global object.
const STATUS_TEXT = [
  'tier 2/4 — standard',
  'tools 0 declared — C:\\Users\\x\\.dsh\\plugin-data\\dsh-optimization-2027\\tools',
  'shell pid none · runs 0',
  'ledger 4 claims · 3 load-bearing · 0 unverified · 1 falsified',
].join('\n')

// Shaped like the host's `state.costs`: protocol text plus the tool schemas the
// plugin puts on the wire. Tier 0 sends neither, so its total is zero.
const TOOL_TOKENS = 1100
const COST_ROWS = [
  { level: 0, title: 'off', rules: 0, chars: 0, marginalChars: 0, tokens: 0, marginalTokens: 0, toolTokens: 0, totalTokens: 0 },
  { level: 1, title: 'light', rules: 3, chars: 252, marginalChars: 254, tokens: 63, marginalTokens: 64, toolTokens: TOOL_TOKENS, totalTokens: 63 + TOOL_TOKENS },
  { level: 2, title: 'standard', rules: 9, chars: 767, marginalChars: 769, tokens: 192, marginalTokens: 193, toolTokens: TOOL_TOKENS, totalTokens: 192 + TOOL_TOKENS },
  { level: 3, title: 'deep', rules: 17, chars: 1833, marginalChars: 1835, tokens: 459, marginalTokens: 459, toolTokens: TOOL_TOKENS, totalTokens: 459 + TOOL_TOKENS },
  { level: 4, title: 'multi-agent', rules: 19, chars: 1993, marginalChars: 1995, tokens: 499, marginalTokens: 499, toolTokens: TOOL_TOKENS, totalTokens: 499 + TOOL_TOKENS },
]

const posts = []
const fetchStub = async (url, init) => {
  const body = JSON.parse(init.body)
  posts.push({ url, body })
  if (body.action === 'state') {
    return {
      status: 200,
      text: async () =>
        JSON.stringify({
          ok: true,
          level: 2,
          levelTitle: 'standard',
          minLevel: 0,
          maxLevel: 4,
          status: STATUS_TEXT,
          cost: COST_ROWS[2],
          costs: COST_ROWS,
        }),
    }
  }
  return { status: 200, text: async () => JSON.stringify({ ok: true, text: `answer:${body.input}` }) }
}


// The component polls the Host on a timer so the collapsed button names the
// tier actually in force. Timers are stubbed: a real interval would keep this
// process alive after the last check.
const intervals = []
globalThis.setInterval = (fn, ms) => {
  intervals.push({ fn, ms })
  return intervals.length
}
globalThis.clearInterval = () => {}

new Function('window', 'document', 'navigator', 'fetch', source)(
  globalThis.window,
  documentStub,
  { languages: ['zh-CN'], language: 'zh-CN' },
  fetchStub,
)

check('the file registers exactly one module', loaded.length === 1, String(loaded.length))
const module = loaded[0]
check('the module id is the package name', module.id === pkg.name, module.id)
check('the factory is a function', typeof module.factory === 'function')

const client = module.factory((specifier) => {
  if (specifier === 'react') return react
  throw new Error(`unexpected require: ${specifier}`)
})

check('the client injects the slots service', Array.isArray(client.inject) && client.inject.includes('slots'), JSON.stringify(client.inject))
check('the client exposes apply', typeof client.apply === 'function')

const ctx = {
  slots: {
    inject: (key, callback) => {
      injectedInto.push(key)
      callback()
      return () => {}
    },
    register: (registration, component) => {
      registered.push({ registration, component })
      return () => {}
    },
  },
}

client.apply(ctx)

check('one slot injection', injectedInto.length === 1, String(injectedInto.length))
check('the injection targets the composer tool row', injectedInto[0] === 'conversation.input.right', injectedInto[0])
check('one registration', registered.length === 1, String(registered.length))

const { registration, component } = registered[0] ?? {}
check('the registration names the same slot', registration?.name === 'conversation.input.right', registration?.name)
check('the registration carries the package id', registration?.id === pkg.name, registration?.id)
check('the registration carries a numeric order', typeof registration?.order === 'number', String(registration?.order))
// That row already holds rewind (20) and the vision toggle (40); a fresh id
// beside them is the only outcome that replaces neither.
check(
  'the order does not collide with an installed entry',
  ![0, 1, 10, 11, 20, 40, 85].includes(registration?.order),
  String(registration?.order),
)
check('the label resolves to text', typeof registration?.label?.() === 'string' && registration.label().length > 0)
check('the registration has a component', typeof component === 'function')

// A replayed apply must not add a second button: the host does replay it.
client.apply(ctx)
check('a replayed apply registers nothing', registered.length === 1, String(registered.length))
// A different context is a genuine remount and must register again.
client.apply({ ...ctx })
check('a remounted context registers again', registered.length === 2, String(registered.length))

// The component must survive a render pass with the hooks stubbed above.
react.__reset()
let tree = null
try {
  tree = component()
} catch (error) {
  tree = { error }
}
check('the component renders without throwing', tree !== null && tree.error === undefined, String(tree?.error?.message ?? ''))
check('the component renders an element', typeof tree?.type === 'string', String(tree?.type))

// The label in the tool row is the client's own copy: it must stay short enough
// to sit beside the icon controls without pushing the send button.
check('the button label is short enough for the tool row', String(registration?.label?.()).length <= 8, registration?.label?.())
// The row already identifies the plugin; the visible word is the setting it
// changes. A product name here reads as a second model selector.
check(
  'the tool-row label names the tier, not the plugin',
  !String(registration?.label?.()).includes('2027') && !String(registration?.label?.()).includes('T'),
  registration?.label?.(),
)
check('the stylesheet is installed once, into the document head', styles.length === 1, String(styles.length))
check(
  'the stylesheet is tagged so a replay cannot stack a second copy',
  created.attrs.some(([name, value]) => name === 'data-plugin-css' && value === 'dsh-optimization-2027'),
  JSON.stringify(created.attrs),
)
// Every declared custom property must be one the theme plugin actually defines.
// The previous version used `--dsh-*` names that nothing declared, so its
// fallbacks were the only thing that ever rendered and the control looked foreign.
const declared = Array.from(String(styles[0]?.textContent ?? '').matchAll(/var\((--[a-z0-9-]+)/g), (match) => match[1])
const unknown = declared.filter((name) => !name.startsWith('--dsw-'))
check('every custom property comes from the theme namespace', unknown.length === 0, unknown.join(','))
const css = String(styles[0]?.textContent ?? '')
check('the trigger copies the shipped chip height', String(styles[0]?.textContent ?? '').includes('height:28px'))
check(
  'the panel copies the shipped menu surface',
  ['--dsw-specific-menu', '--dsw-menu-backdrop-filter', '--dsw-elevation-prominent', '--dsw-radius-lg'].every((token) =>
    String(styles[0]?.textContent ?? '').includes(token),
  ),
)

// ------------------------------------------------------------------ panel
// Open the panel and read the tree it builds. The panel is the whole human
// interface, so its shape is worth asserting: every verb reachable by pressing
// something, no free-text entry that could name a verb no button covers.

/** Depth-first walk over the stub React tree. */
function walk(node, visit) {
  if (node === null || node === undefined) return
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit)
    return
  }
  if (typeof node !== 'object') return
  visit(node)
  for (const child of node.children ?? []) walk(child, visit)
}

/** Let the async run()/refresh() chain settle before reading state. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

// Render collapsed first: that is the state a fresh mount is in.
react.__reset()
const closedTree = component({ sessionId: 'session-test' })

// Press the tool-row button. The stub setter writes the hook cell, so the next
// render — which the real React would trigger by itself — sees `open: true`.
let closedNodes = []
walk(closedTree, (node) => closedNodes.push(node))
closedNodes.find((node) => node.type === 'button')?.props?.onClick?.({ preventDefault: () => {} })

// The effect that calls refresh() is not run by the stub, so seed the state the
// Host would have answered with. Hook order: open, state, output, busy, ref.
const OPEN_STATE = {
  ok: true,
  level: 2,
  levelTitle: 'standard',
  minLevel: 0,
  maxLevel: 4,
  status: STATUS_TEXT,
  cost: COST_ROWS[2],
  costs: COST_ROWS,
  rearmDistance: 300,
}
react.__cells[1] = { ...OPEN_STATE }

react.__reset()
const openTree = component({ sessionId: 'session-test' })

let nodes = []
walk(openTree, (node) => nodes.push(node))

const buttons = nodes.filter((node) => node.type === 'button')
// One field is allowed: the automatic re-arm threshold. It takes digits only and
// writes through the `rearm <n>` verb, so it is not a second way to name a verb.
// What must not exist is a free-text entry that could.
const textInputs = nodes.filter((node) => node.type === 'input' && node.props?.type !== 'range')
check('the panel renders one free-text entry, for the re-arm threshold', textInputs.length === 1, `${textInputs.length} input node(s)`)
check(
  'the only free-text entry takes digits, not a verb',
  String(textInputs[0]?.props?.inputMode ?? '') === 'numeric' &&
    String(textInputs[0]?.props?.className ?? '').includes('dopt2027-field-input'),
  JSON.stringify(textInputs.map((n) => [n.props?.inputMode, n.props?.className])),
)
check('the panel renders buttons only as its controls', buttons.length > 0, `${buttons.length} button(s)`)

// The heading is the name of the setting, not of the package. "推理优化" is what
// a person opened the panel to change; "dsh-optimization-2027 · tier, tools, ledger" was a
// package listing, and a heading that lists the features is a heading that has
// to be re-read every time one is added or removed. The id still has to be
// reachable — it moved into the tooltip and the dialog's aria-label, so nothing
// became unfindable, it just stopped occupying the title line.
const titleRow = nodes.find((node) => String(node.props?.className ?? '') === 'dopt2027-title')
const titleText = String(titleRow?.children?.[0]?.children?.[0] ?? '')
check('the panel heading is the setting it changes', titleText === '推理优化', titleText)
check(
  'the heading does not repeat the package id',
  titleText.length > 0 && !titleText.includes('dsh-optimization-2027') && !titleText.includes('2027'),
  titleText,
)
const dialog = nodes.find((node) => node.props?.role === 'dialog')
check(
  'the dialog still carries the package id for identification',
  String(dialog?.props?.['aria-label'] ?? '').includes('dsh-optimization-2027'),
  String(dialog?.props?.['aria-label']),
)

// One chip per tier the Host reports reachable: minLevel 0 .. maxLevel 4.
const chips = buttons.filter((node) => String(node.props?.className ?? '').includes('dopt2027-tier'))
check('five tier chips, one per reachable tier', chips.length === 5, `${chips.length} chip(s)`)
check(
  'exactly one chip is marked pressed',
  buttons.filter((node) => node.props?.['aria-pressed'] === true).length === 1,
  `${buttons.filter((node) => node.props?.['aria-pressed'] === true).length} pressed`,
)
check(
  'the pressed chip is the current tier',
  buttons.find((node) => node.props?.['aria-pressed'] === true)?.children?.[0] === '标准',
  String(buttons.find((node) => node.props?.['aria-pressed'] === true)?.children?.[0]),
)

// Pressing the "关" chip must post `level 0` — the off switch, in one press.
posts.length = 0
buttons.find((node) => node.children?.[0] === '关')?.props?.onClick?.()
await flush()
check('pressing the off chip posts level 0', posts.some((entry) => entry.body?.input === 'level 0'), JSON.stringify(posts.map((p) => p.body)))
check('every post names the session it was pressed in', posts.every((entry) => entry.body?.session === 'session-test'), JSON.stringify(posts.map((p) => p.body)))
check('the panel posts to the plugin route', posts.every((entry) => entry.url === '/dsh-optimization-2027/api'), JSON.stringify(posts.map((p) => p.url)))

// Each verb has its own button, so nothing needs typing. `status` is the one
// verb with no button: the panel prints the four status lines itself, and a
// button that only re-fetches what is already on screen is a press with no
// decision in it. `rearm` keeps its button even though it writes a message into
// the transcript — that is exactly what the button says it does, and reaching
// for `/dopt2027 rearm` means leaving the panel that is open in front of you.
posts.length = 0
for (const name of ['档位表', '自建工具', '结论台账', '重发提示词']) {
  buttons.find((node) => node.children?.[0] === name)?.props?.onClick?.()
}
await flush()
const verbs = posts.filter((entry) => entry.body?.action === 'invoke').map((entry) => entry.body.input)
check(
  'four verb buttons cover levels, tools, ledger and re-arm',
  ['levels', 'tools', 'ledger', 'rearm'].every((verb) => verbs.includes(verb)),
  JSON.stringify(verbs),
)
check('no button re-fetches the status it already prints', !verbs.includes('status'), JSON.stringify(verbs))

// Every control explains itself on hover: a panel of bare nouns makes a person
// press something to learn what it does, and one of these presses writes into
// the transcript.
const controlButtons = buttons.filter((node) => String(node.props?.className ?? '').includes('dopt2027-cell'))
check(
  'every verb button carries a hover explanation',
  controlButtons.every((node) => typeof node.props?.title === 'string' && node.props.title.length > 10),
  JSON.stringify(controlButtons.map((node) => node.props?.title)),
)
check(
  'the re-arm button says it writes into the conversation',
  controlButtons.some((node) => String(node.props?.title ?? '').includes('对话')),
  JSON.stringify(controlButtons.map((node) => node.props?.title)),
)
check(
  'a verb button names its action and its explanation',
  controlButtons.every((node) => String(node.props?.['aria-label'] ?? '').includes('—')),
  JSON.stringify(controlButtons.map((node) => node.props?.['aria-label'])),
)
const tierChipsWithHints = buttons.filter((node) => String(node.props?.className ?? '').includes('dopt2027-tier'))
check(
  'every tier chip carries a hover explanation',
  tierChipsWithHints.length > 0 && tierChipsWithHints.every((node) => typeof node.props?.title === 'string'),
  String(tierChipsWithHints.length),
)

// The cost row: one figure per tier, under the chips, straight from the Host.
// The client keeps no copy of the rule table, so if the host stops sending
// `state.costs` the row must vanish rather than print a guess.
const costCells = nodes.filter((node) => String(node.props?.className ?? '') === 'dopt2027-cost')
check('the panel prints one cost figure per tier', costCells.length === 5, `${costCells.length} cell(s)`)
check(
  'each cost figure sits under its own tier, in tier order',
  costCells.map((node) => String(node.children ?? '')).join('|') === '0 tok|1163 tok|1292 tok|1559 tok|1599 tok',
  costCells.map((node) => String(node.children ?? '')).join('|'),
)
check(
  'the cost row is grouped so it lines up with the chips',
  nodes.some((node) => String(node.props?.className ?? '') === 'dopt2027-cost-row'),
)
check(
  'a cost cell names its tier and its characters on hover',
  costCells.every((node) => String(node.props?.title ?? '').includes('chars ≈')),
  String(costCells[0]?.props?.title ?? ''),
)
check(
  'the cost row explains that the figure is an estimate',
  String(nodes.find((node) => String(node.props?.className ?? '') === 'dopt2027-cost-row')?.props?.title ?? '').includes(
    '4 字符',
  ),
)
check(
  'the stylesheet keeps the cost figures on one line each',
  String(styles[0]?.textContent ?? '').includes('.dopt2027-cost{flex:1 1 0'),
  String(styles[0]?.textContent ?? '').slice(0, 0),
)
// The figure you are paying right now has to be findable without reading five
// numbers: only the current tier's cell is marked, and the mark is styled.
check(
  'exactly one cost figure is marked as the one in force',
  costCells.filter((node) => node.props?.['data-active'] === true).length === 1,
  JSON.stringify(costCells.map((node) => node.props?.['data-active'])),
)
check(
  'the marked cost figure is the current tier',
  String(costCells.find((node) => node.props?.['data-active'] === true)?.children ?? '') === '1292 tok',
  String(costCells.find((node) => node.props?.['data-active'] === true)?.children ?? ''),
)
check(
  'the marked cost figure is highlighted, not just labelled',
  String(styles[0]?.textContent ?? '').includes('.dopt2027-cost[data-active=true]') &&
    String(styles[0]?.textContent ?? '').includes('--dsw-alias-button-ghost-active-fill'),
)
check(
  'the cost figures no longer use the faintest label colour',
  !String(styles[0]?.textContent ?? '').includes('.dopt2027-cost{') ||
    !String(styles[0]?.textContent ?? '')
      .slice(String(styles[0]?.textContent ?? '').indexOf('.dopt2027-cost{'))
      .slice(0, 200)
      .includes('--dsw-alias-label-dimmed'),
)

// The status block is resident: the four lines the `status` verb prints are
// rendered as soon as the Host answers, without any press. Before the answer
// arrives it says so instead of showing an empty box.
const statusBlock = nodes.find((node) => String(node.props?.className ?? '') === 'dopt2027-status')
check('the panel prints a resident status block', statusBlock !== undefined)
const statusText = JSON.stringify(statusBlock?.children ?? [])
check(
  'the status block renders one line per status field',
  (statusBlock?.children ?? []).length === 4,
  String((statusBlock?.children ?? []).length),
)
check(
  'the status block carries the tier line',
  statusText.includes('tier') && statusText.includes('standard'),
  statusText.slice(0, 160),
)
check(
  'the status block carries the shell line',
  statusText.includes('shell'),
  statusText.slice(0, 160),
)

// The four verbs are not tier controls, so they get their own two-column grid:
// two rows of two, none of them spanning. A spanning row was doing layout work
// to express emphasis the hover text already carries, and it pushed the panel
// past the height of the screen it opens over.
const verbGrid = nodes.find((node) => String(node.props?.className ?? '') === 'dopt2027-grid')
const gridKids = (verbGrid?.children ?? []).filter((node) => node !== null && node !== undefined)
check('the four verbs sit in one grid', verbGrid !== undefined && gridKids.length === 4, String(gridKids.length))
check(
  'every verb cell occupies one column',
  gridKids.every((node) => {
    const className = String(node.props?.className ?? '')
    return className.includes('dopt2027-cell') && !className.includes('dopt2027-wide')
  }),
  JSON.stringify(gridKids.map((node) => node.props?.className)),
)

// Two read-only panels, not one split by a rule: the status panel answers "what
// is true now", the result panel answers "what did that press return". Merging
// them let a stale result be read as current state.
const readPanels = nodes.filter((node) => String(node.props?.className ?? '').includes('dopt2027-read'))
const statusPanel = readPanels.find((node) => String(node.props?.className ?? '').includes('dopt2027-read-status'))
const resultPanel = readPanels.find((node) => String(node.props?.className ?? '').includes('dopt2027-read-result'))
check('the status gets a read-only panel of its own', statusPanel !== undefined)
check('the last result gets a read-only panel of its own', resultPanel !== undefined)
check(
  'the two read-only panels are separate nodes',
  statusPanel !== undefined && resultPanel !== undefined && statusPanel !== resultPanel,
)
check(
  'the status panel holds the status block',
  (statusPanel?.children ?? []).some((node) => String(node?.props?.className ?? '') === 'dopt2027-status'),
  JSON.stringify((statusPanel?.children ?? []).map((node) => node?.props?.className ?? node?.type)),
)
check(
  'the result panel starts with what to do',
  JSON.stringify(resultPanel?.children ?? []).includes('按上方按钮查看'),
  JSON.stringify(resultPanel?.children ?? []),
)

// Each panel is labelled, and the status panel comes first: it is always true of
// the current state, while the result only describes the last press.
const captionRows = nodes.filter((node) => String(node.props?.className ?? '') === 'dopt2027-caption-row')
check(
  'each read-only panel carries its own caption row',
  captionRows.length === 2,
  JSON.stringify(captionRows.map((node) => node?.props?.className ?? node?.type)),
)
const boxCaptions = captionRows.map((node) => (node.children ?? [])[0])
check(
  'each read-only panel carries its own caption',
  boxCaptions.length === 2 &&
    boxCaptions.every((node) => String(node?.props?.className ?? '') === 'dopt2027-caption'),
  JSON.stringify(boxCaptions.map((node) => node?.props?.className ?? node?.type)),
)
check(
  'the status panel is captioned as the current state',
  String(boxCaptions[0]?.children ?? '') === '当前状态',
  String(boxCaptions[0]?.children ?? ''),
)
check(
  'the status panel comes before the result panel',
  nodes.indexOf(statusPanel) < nodes.indexOf(resultPanel),
  `${nodes.indexOf(statusPanel)} < ${nodes.indexOf(resultPanel)}`,
)

// The read-only boxes are fixed size and scroll their own content: no slider,
// no height state. A box whose size the reader has to set first is a control
// pretending to be text, and on a four-line status block the slider did nothing.
const sliders = nodes.filter((node) => node.type === 'input' && node.props?.type === 'range')
check('no read-only panel carries a size slider', sliders.length === 0, `${sliders.length} slider(s)`)
check(
  'the read-only panels keep a fixed height',
  Number(statusPanel?.props?.style?.height) === 80 && Number(resultPanel?.props?.style?.height) === 96,
  JSON.stringify([statusPanel?.props?.style?.height, resultPanel?.props?.style?.height]),
)
check(
  'the fixed height is the only height set, not a max-height',
  statusPanel?.props?.style?.maxHeight === undefined && resultPanel?.props?.style?.maxHeight === undefined,
  JSON.stringify([statusPanel?.props?.style?.maxHeight, resultPanel?.props?.style?.maxHeight]),
)
check(
  'the read-only panels scroll their own content',
  css.includes('.dopt2027-read{box-sizing:border-box;overflow:auto') && css.includes('overscroll-behavior:contain'),
  css.slice(css.indexOf('.dopt2027-read{'), css.indexOf('.dopt2027-read{') + 120),
)
check(
  'the read-only panels take the wheel without scrolling the conversation',
  css.includes('overscroll-behavior:contain'),
)
check(
  'the read-only panels are reachable by keyboard too',
  statusPanel?.props?.tabIndex === 0 && resultPanel?.props?.tabIndex === 0,
  JSON.stringify([statusPanel?.props?.tabIndex, resultPanel?.props?.tabIndex]),
)
check(
  'the read-only panels carry no wheel instruction',
  !String(statusPanel?.props?.title ?? '').includes('滚轮') &&
    !String(resultPanel?.props?.title ?? '').includes('滚轮') &&
    !css.includes('滚轮') &&
    !css.includes('dopt2027-hint'),
  JSON.stringify([statusPanel?.props?.title, resultPanel?.props?.title]),
)
check(
  'a read-only panel is still named for screen readers',
  String(statusPanel?.props?.['aria-label'] ?? '') === '当前状态' &&
    String(resultPanel?.props?.['aria-label'] ?? '') === '上一次操作',
  JSON.stringify([statusPanel?.props?.['aria-label'], resultPanel?.props?.['aria-label']]),
)

// The read-only boxes must not look like the buttons: every control in this
// panel is transparent until hover, so a filled box with a border of its own is
// what separates "text you read" from "thing you press".
//
// The first attempt used `--dsw-alias-markdown-code-block` and failed on a
// measured number: bluish-50 against the composited menu surface is a contrast
// ratio of 1.017 in light — no visible edge. These two tokens are the ones with
// a real step (1.205 light / 1.564 dark for the fill, and the palette's heaviest
// hairline for the edge), so the assertion pins the tokens, not a comment.
const readRule = css.slice(css.indexOf('.dopt2027-read{'), css.indexOf('.dopt2027-read::-webkit-scrollbar'))
check(
  'the read-only panels were not left on the code-block fill that measured 1.017',
  !readRule.includes('--dsw-alias-markdown-code-block'),
  readRule.slice(0, 200),
)
check(
  'the read-only fill is the pressed-surface token, which separates from the menu',
  readRule.includes('background:var(--dsw-alias-interactive-bg-active)'),
  readRule.slice(0, 240),
)
check(
  'the read-only panels carry the heaviest hairline of their own',
  readRule.includes('box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l4)'),
  readRule.slice(0, 300),
)
check(
  'the fixed height includes the padding, so the box can actually scroll',
  readRule.includes('box-sizing:border-box'),
  readRule.slice(0, 120),
)
// React attaches `wheel` passively at the root, so preventDefault there does
// nothing; assigning scrollTop does. The handler also stops the event once the
// box has moved, so the conversation behind it does not scroll too.
const wheelPanels = nodes.filter((node) => String(node.props?.className ?? '').includes('dopt2027-read') && typeof node.props?.onWheel === 'function')
check('every read-only panel scrolls itself on the wheel', wheelPanels.length === 2, `${wheelPanels.length} handler(s)`)
{
  // A real scrollport clamps `scrollTop` to [0, scrollHeight - clientHeight];
  // a plain object would not, and the handler's "did it move?" test would then
  // report movement that the browser would have refused.
  const makeBox = (scrollTop) => {
    const box = { offset: 0, clientHeight: 80, scrollHeight: 400 }
    Object.defineProperty(box, 'scrollTop', {
      get: () => box.offset,
      set: (value) => {
        const limit = box.scrollHeight - box.clientHeight
        box.offset = Math.max(0, Math.min(limit, value))
      },
    })
    box.scrollTop = scrollTop
    return box
  }
  const stops = []
  const box = makeBox(0)
  wheelPanels[0]?.props?.onWheel?.({ currentTarget: box, deltaY: 60, stopPropagation: () => stops.push('stop') })
  check('the wheel moves the box it is over', box.scrollTop === 60, String(box.scrollTop))
  check('the wheel stops propagating once the box moved', stops.length === 1, JSON.stringify(stops))
  const edge = makeBox(400)
  const edgeStops = []
  wheelPanels[0]?.props?.onWheel?.({ currentTarget: edge, deltaY: 60, stopPropagation: () => edgeStops.push('stop') })
  check('the wheel leaves the conversation alone at the end of the content', edgeStops.length === 0, JSON.stringify(edgeStops))
}
check(
  'no button in the panel is filled at rest',
  !css.includes('.dopt2027-cell{') || !/\.dopt2027-cell\{[^}]*background:(?!transparent)/.test(css),
  css.slice(css.indexOf('.dopt2027-cell{'), css.indexOf('.dopt2027-cell{') + 120),
)

// The collapsed state is the tool-row button only — the panel must not mount
// while closed, or it would sit invisibly over the composer.
let closedButtons = 0
walk(closedTree, (node) => {
  if (node.type === 'button') closedButtons += 1
})

// The collapsed trigger must carry the tier word, not the plugin name: the row
// already identifies the plugin, and a second product name beside the model
// selector reads as a competing selector. Rendered with a known tier, because
// before the first Host answer the label falls back to the bare word `档位`.
react.__reset()
const knownTree = component({ sessionId: 'session-test' })
react.__cells[1] = { ok: true, level: 2, levelTitle: 'standard', minLevel: 0, maxLevel: 4 }
react.__reset()
const tieredTree = component({ sessionId: 'session-test' })
react.__cells[1] = { ok: true, level: 2, levelTitle: 'standard', minLevel: 0, maxLevel: 4 }
let tieredButton = null
walk(tieredTree, (node) => {
  if (tieredButton === null && node.type === 'button') tieredButton = node
})
const tieredLabel = String(tieredButton?.props?.['aria-label'] ?? '')
check('the collapsed trigger names the current tier', tieredLabel.endsWith('标准'), tieredLabel)
check(
  'the collapsed trigger text is the tier word alone',
  tieredButton?.children?.[0]?.props?.className === 'dopt2027-trigger-label' && String(tieredButton?.children?.[0]?.children?.[0]) === '标准',
  JSON.stringify(tieredButton?.children?.[0]),
)
check(
  'the trigger tooltip keeps the plugin name for identification',
  String(tieredButton?.props?.title ?? '').includes('dsh-optimization-2027'),
  String(tieredButton?.props?.title),
)

// ------------------------------------------------- always names the tier
// A collapsed button that never asked the Host shows nothing useful. Two
// failures are possible here and they are different: the mount effect not
// firing (label stays a guess), and the guess being wrong (a placeholder word
// instead of the tier a fresh session actually has).

posts.length = 0
react.__reset()
component({ sessionId: 'session-test' })
// Hook order: open, state, output, busy, ref, refresh (callback), mount effect,
// open effect, outside-press effect, rearm draft, rearm draft effect. The mount
// effect must ask the Host on its own. The two read-only panels hold no state —
// their height is a constant — so adding them did not shift this index. The
// re-arm field was declared after the effects for the same reason: its two
// slots are the last two, so nothing above it renumbered.
const mountEffect = react.__effects[6]
check('the component records a mount effect', typeof mountEffect === 'function')
mountEffect?.()
await flush()
check(
  'the collapsed button reads the tier without being opened',
  posts.some((entry) => entry.body?.action === 'state'),
  JSON.stringify(posts.map((p) => p.body)),
)
check('the mount effect schedules a poll', intervals.length >= 1 && intervals[0].ms === 10000, JSON.stringify(intervals.map((i) => i.ms)))

// Before any answer arrives the label must still say something true. The
// plugin's own default is the off switch, so the honest placeholder is its
// name, not a word like `档位` that names no tier.
react.__reset()
react.__cells[1] = null
const unbornTree = component({ sessionId: 'session-test' })
let unbornButton = null
walk(unbornTree, (node) => {
  if (unbornButton === null && node.type === 'button') unbornButton = node
})
const unbornLabel = String(unbornButton?.props?.['aria-label'] ?? '')
check('an unanswered button falls back to the default tier name', unbornLabel.endsWith('关'), unbornLabel)

check('collapsed, only the tool-row button renders', closedButtons === 1, `${closedButtons} button(s)`)

// ------------------------------------------------- the automatic re-arm field
//
// The field is the only control in the panel that edits a value instead of
// naming a verb. Three things have to hold: it shows what the Host reported, it
// writes back through the same verb the command uses, and an untouched field
// costs nothing. A field that posts on every keystroke would turn "300" into
// three `rearm` calls; a field that posts on blur without comparing would make
// Enter in an unchanged field cost one request.

{
  // Hook order: open, state, output, busy, ref, refresh (callback), mount effect,
  // open effect, outside-press effect, re-arm draft. The draft is the last slot,
  // which is why the field was declared after the effects.
  const DRAFT = 9
  const SEED = { ...OPEN_STATE, rearmDistance: 300 }

  // A render pass is pure here, so the handlers a tree carries close over the
  // draft value that was in the cells at render time — exactly as React would
  // capture the state of that pass. Committing therefore needs a fresh render
  // with the draft already in place, which is what this helper does.
  const render = (seed) => {
    react.__reset()
    react.__cells[1] = seed
    const tree = component({ sessionId: 'session-test' })
    const all = []
    walk(tree, (node) => all.push(node))
    return {
      field: all.find((node) => String(node.props?.className ?? '').includes('dopt2027-field-input')),
      label: all.find((node) => String(node.props?.className ?? '') === 'dopt2027-field-label'),
      row: all.find((node) => String(node.props?.className ?? '') === 'dopt2027-field'),
    }
  }

  const shown = render(SEED)
  check('the panel carries the automatic re-arm field', shown.field !== undefined)
  check('the field shows the threshold the host reports', String(shown.field?.props?.value ?? '') === '300', String(shown.field?.props?.value))
  check(
    'the field explains itself to screen readers',
    String(shown.field?.props?.['aria-label'] ?? '').includes('自动重发阈值'),
    String(shown.field?.props?.['aria-label']),
  )
  // The explanation belongs to the words, not to the box: hovering the label is
  // how you ask what "自动重发阈值" counts; the number field stays a number field.
  check(
    'the field value sits next to its label, not at the far edge',
    String(css).includes('.dopt2027-field-label{flex:0 0 auto') && String(css).includes('.dopt2027-field{display:flex;align-items:center;gap:6px'),
    'label is not stretched',
  )
  check(
    'only the number gets a frame, not the label',
    String(css).includes('.dopt2027-field-input{flex:0 0 52px;width:52px;height:24px') && !String(css).includes('.dopt2027-field{display:flex;align-items:center;gap:6px;height:28px;padding'),
    'no frame on the row',
  )
  const hint = String(shown.label?.props?.title ?? '')
  check(
    'the label carries the hover explanation',
    hint.includes('隔了几条消息') && hint.includes('补发一份') && !hint.startsWith('自动重发阈值'),
    hint,
  )
  check('the explanation says what is counted and what is sent', hint.includes('工具调用也算') && hint.includes('工作目录') && !hint.includes('runtime context'), hint)
  check('the explanation says what gets sent', hint.includes('补发一份'), hint)
  check('the explanation says how to turn it off', hint.includes('留空或 0 为关'), hint)
  check('the hover explanation stays one short line', hint.length <= 60, hint.length + ' chars')
  check('the number box is not the explainer', shown.field?.props?.title === undefined, String(shown.field?.props?.title))
  check('the row itself is not a control', shown.row?.props?.title === undefined, String(shown.row?.props?.title))
  // A tooltip is one narrow box, so the long explanations break at their own
  // clause boundaries instead of running off the screen edge as one line.
  // Width is counted in display columns, not code points: a Chinese glyph takes
  // two columns, so 38 characters of Chinese is 76 columns and still clipped.
  const columns = (text) => {
    let width = 0
    for (const glyph of text) {
      width += /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(glyph) ? 2 : 1
    }
    return width
  }
  const hintLines = hint.split('\n')
  check(
    'the field explanation is broken into three short lines',
    hintLines.length === 3 && hintLines.every((line) => columns(line) <= 40),
    JSON.stringify(hintLines.map(columns)),
  )
  const everyHint = [hint, ...controlButtons.map((node) => String(node.props?.title ?? ''))]
  check(
    'no hover explanation runs past forty columns on one line',
    everyHint.every((text) => text.split('\n').every((line) => columns(line) <= 40)),
    JSON.stringify(everyHint.map((text) => text.split('\n').map(columns))),
  )
  check(
    'anything too wide for one line is wrapped instead',
    everyHint.every((text) => columns(text) <= 40 || text.includes('\n')),
    JSON.stringify(everyHint.filter((text) => columns(text) > 40 && !text.includes('\n'))),
  )
  check(
    'every Chinese hover explanation is Chinese',
    [hint, ...controlButtons.map((node) => String(node.props?.title ?? ''))].every((text) => !/[A-Za-z]{2,}/.test(text)),
    JSON.stringify(controlButtons.map((node) => node.props?.title)),
  )
  check('an off threshold shows as a blank field, not as 0', String(render({ ...OPEN_STATE, rearmDistance: 0 }).field?.props?.value ?? 'x') === '')
  check('an unreported threshold shows as blank too', String(render(null).field?.props?.value ?? 'x') === '')

  // Typing filters to digits, so no letter can reach the verb.
  shown.field?.props?.onChange?.({ target: { value: '3a0b0' } })
  check('the field keeps digits only', react.__cells[DRAFT] === '300', String(react.__cells[DRAFT]))

  // Blur without having typed anything costs no request.
  posts.length = 0
  react.__cells[DRAFT] = null
  render(SEED).field?.props?.onBlur?.()
  await flush()
  check('an untouched field costs no request', posts.length === 0, JSON.stringify(posts.map((p) => p.body)))

  // Blur with the value the Host already reported costs no request either.
  posts.length = 0
  react.__cells[DRAFT] = '300'
  render(SEED).field?.props?.onBlur?.()
  await flush()
  check('typing back the same number costs no request', posts.length === 0, JSON.stringify(posts.map((p) => p.body)))
  // The draft always steps aside once the field is left, so what is on screen is
  // never a number the Host did not confirm.
  check('leaving the field hands it back to the host', react.__cells[DRAFT] === null, String(react.__cells[DRAFT]))

  // Blur with a new value writes through the verb the command uses.
  posts.length = 0
  react.__cells[DRAFT] = '120'
  render(SEED).field?.props?.onBlur?.()
  await flush()
  check(
    'a changed field writes through the rearm verb',
    posts.some((entry) => entry.body?.action === 'invoke' && entry.body?.input === 'rearm 120'),
    JSON.stringify(posts.map((p) => p.body)),
  )
  check('the field drops back to the host value after a write', react.__cells[DRAFT] === null, String(react.__cells[DRAFT]))

  // Blank means off, and off is sent as the word so the two spellings agree.
  posts.length = 0
  react.__cells[DRAFT] = ''
  render(SEED).field?.props?.onBlur?.()
  await flush()
  check(
    'a blank field turns the automatic re-arm off',
    posts.some((entry) => entry.body?.action === 'invoke' && entry.body?.input === 'rearm off'),
    JSON.stringify(posts.map((p) => p.body)),
  )

  // An empty field already showing the off state is the same answer, so it is
  // not a change and costs nothing.
  posts.length = 0
  react.__cells[DRAFT] = ''
  render({ ...OPEN_STATE, rearmDistance: 0 }).field?.props?.onBlur?.()
  await flush()
  check('clearing an already-off field costs no request', posts.length === 0, JSON.stringify(posts.map((p) => p.body)))

  // Enter commits by blurring, which is what makes the keyboard path identical
  // to the mouse path rather than a second implementation.
  let blurred = 0
  shown.field?.props?.onKeyDown?.({ key: 'Enter', target: { blur: () => { blurred += 1 } } })
  check('Enter commits the field by blurring it', blurred === 1, String(blurred))
  shown.field?.props?.onKeyDown?.({ key: 'Escape', target: { blur: () => { blurred += 1 } } })
  check('any other key leaves the field alone', blurred === 1, String(blurred))
}


const summary = [
  ...results,
  '',
  failures === 0 ? `all ${results.length} checks passed` : `${failures} of ${results.length} checks FAILED`,
].join('\n')
process.stdout.write(`${summary}\n`)
process.exitCode = failures === 0 ? 0 : 1
