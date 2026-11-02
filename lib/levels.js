/**
 * Reasoning tiers — protocol text only.
 *
 * Four tiers, not twelve. The twelve-level ladder this replaces was monotone
 * but wasteful: adjacent levels differed by one sentence while the rendered
 * block grew to 3.8 KB (~950 tokens), and nobody can tell level 7 from level 8
 * from the outside, so the dial got set once and abandoned.
 *
 *   tier 0  off          no rules, no text: the context renders empty and costs 0
 *   tier 1  light        answer first, look before editing
 *   tier 2  standard     claim ledger, boundaries, cost
 *   tier 3  deep         attack the answer, derive it fully
 *   tier 4  multi-agent  delegation boundaries, on top of 3
 *
 * Tier 0 exists because a protocol that cannot be switched off is a protocol
 * every task pays for. Some work is pure mechanics — rename these, print that —
 * and the twelve lines at tier 3 are overhead with no decision to inform. Tier 0
 * is the honest off switch: the context stays registered (it is `required`, and
 * a missing context reads as a defect while an empty one is a normal state), the
 * rendered text is the empty string, so the host drops both the block and the
 * "Current runtime context" wrapper around it and the tier costs zero tokens.
 * Status, `/dopt2027 levels` and the composer button still report the tier from the
 * plugin's own state, not from the injected text.
 *
 * Tier 4 is separate rather than "tier 3 with more rules" because delegation is
 * a different shape of work: it constrains who may change state, not how hard
 * the model thinks.
 *
 * A tier is a set of rules active at or below it: raising the tier adds rules,
 * never removes them.
 *
 * Rule text is one clause carrying one order. The earlier version justified
 * each rule inside the rule ("Vague hedging hides the uncertainty instead of
 * reporting it") — true, and the model does not need it to comply. Dropping
 * the justifications is where most of the token saving comes from.
 *
 * What was tried upstream and removed: a "review round" at high tiers that
 * re-entered the turn so the model re-read its own draft. It manufactures the
 * appearance of rigor without adding information, and spends a round trip the
 * user never asked for.
 */

export const MIN_LEVEL = 0
export const MAX_LEVEL = 4

/**
 * New sessions start at the off switch.
 *
 * A protocol nobody asked for is a cost paid on every request of every session,
 * and the person who wants rules is the one who will turn them on — they have a
 * button for exactly that. `clampLevel` also falls back here for unreadable
 * input: a tier that cannot be parsed may not impose rules out of nowhere, and
 * `off` is the only value that imposes nothing.
 */
export const DEFAULT_LEVEL = 0

/** Short name per tier, indexed by tier number. Tier 0 is the off switch. */
const TITLES = ['off', 'light', 'standard', 'deep', 'multi-agent']

/**
 * One rule. `from` is the lowest tier at which it is active; a rendered
 * protocol for tier N is every rule with `from <= N`, in array order.
 */
const RULES = [
  // tier 1 — the floor. Everything above assumes these are already true.
  { id: 'answer-first', from: 1, text: 'Lead with the answer or the action; the reason follows.' },
  { id: 'no-padding', from: 1, text: 'Cut sentences that carry nothing: restating the question, filler transitions, closing offers.' },
  { id: 'name-uncertainty', from: 1, text: 'Name the step you are unsure about instead of hedging.' },

  // tier 2 — read the world, tag what you assert.
  { id: 'read-first', from: 2, text: 'Read the file, run the read-only command, open the log before you change anything.' },
  { id: 'one-verifiable-step', from: 2, text: 'One verifiable change at a time; verify it, then continue.' },
  { id: 'reproduce-before-attributing', from: 2, text: 'Reproduce a failure before explaining it; a fix for an unreproduced failure is a guess.' },
  { id: 'quantify', from: 2, text: 'Count what can be counted: line numbers, byte sizes, timings, exit codes.' },
  { id: 'claim-channel', from: 2, text: 'Tag load-bearing claims observed / derived / assumed / guessed. Assumed or guessed may not carry the answer.' },
  { id: 'state-the-falsifier', from: 2, text: 'Say what you would see if a load-bearing claim were false; look when looking is cheap.' },

  // tier 3 — know the shape, name the price, attack the conclusion.
  { id: 'boundary-and-diff', from: 3, text: 'Fix the boundary before editing — inputs, outputs, error paths, callers — then deliver the smallest reviewable diff.' },
  { id: 'state-the-cost', from: 3, text: 'State the cost — time, quota, irreversible effects — and let the user decide; before a destructive action, what it destroys and how to undo it.' },
  { id: 'find-the-breaking-case', from: 3, text: 'Find the input that breaks the answer and fix it. A disclaimer moves that work back to the reader, so repair the claim or mark it broken; "there may be edge cases" counts as neither.' },
  { id: 'counterexample', from: 3, text: 'Construct the input that would falsify the conclusion and run it, and derive the same result a second way; their disagreement is where the error is.' },
  { id: 'carriers', from: 3, text: 'Every step names its carrier — file, field, command, line — and a step with no carrier is a step you skipped.' },
  { id: 'six-phases', from: 3, text: 'Hard case: constitute the problem, derive it two ways, derive from primitives, press it with counterfactuals, scale what is left unknown (high/medium/low, with the reason), then argue it holds.' },
  { id: 'bet-first', from: 3, text: 'Bet shape, magnitude and direction before deriving; a mismatch is the signal, so never delete the bet.' },
  { id: 'compress-by-decision', from: 3, text: 'Summarize by decision and cost, not by topic visited.' },

  // tier 4 — delegation boundaries, additive over tier 3.
  { id: 'delegate-analysis-only', from: 4, text: 'Delegate analysis and retrieval; code, edits and decisions stay with you.' },
  { id: 'report-is-testimony', from: 4, text: 'A delegate report is testimony, not fact; mark a truncated one incomplete.' },
]

export function clampLevel(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return DEFAULT_LEVEL
  return Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, Math.round(n)))
}

export function levelTitle(level) {
  return TITLES[clampLevel(level)]
}

/** Every rule active at `level`, in registration order. */
export function activeRules(level) {
  const n = clampLevel(level)
  return RULES.filter((rule) => rule.from <= n)
}

/**
 * Characters per token used for the cost estimate. The protocol is English
 * prose with short lines, and the measured numbers (252 chars ≈ 63 tokens,
 * 767 ≈ 192, 1833 ≈ 459, 1993 ≈ 499) all come out the same at 4 chars/token.
 * It is an estimate, and the panel says so: nothing here counts real tokens,
 * because the tokeniser belongs to the model, not to this plugin.
 */
export const CHARS_PER_TOKEN = 4

/**
 * What a tier costs on the wire, per request.
 *
 * `chars` is the block this plugin renders; `marginalChars` adds the two
 * newlines the host puts between contexts when more than one survives, so tier
 * 0 is 0 and not 2. The token figures are `chars / 4`, rounded up, and exist
 * because "1833 字符" means nothing to a person choosing a tier while "459 tok"
 * does.
 */
export function protocolCost(level, toolTokens = 0) {
  const n = clampLevel(level)
  const chars = renderProtocol(n).length
  const marginalChars = chars === 0 ? 0 : chars + 2
  // Tier 0 registers none of this plugin's tools, so the tool half of the bill
  // is zero there as well — the total, not the protocol alone, is what a tier
  // actually costs per request.
  const tools = n === MIN_LEVEL ? 0 : Math.max(0, Math.round(toolTokens))
  return {
    level: n,
    title: levelTitle(n),
    rules: activeRules(n).length,
    chars,
    marginalChars,
    tokens: Math.ceil(chars / CHARS_PER_TOKEN),
    marginalTokens: Math.ceil(marginalChars / CHARS_PER_TOKEN),
    toolTokens: tools,
    totalTokens: Math.ceil(chars / CHARS_PER_TOKEN) + tools,
  }
}

/** Every tier's cost, cheapest first — the panel and /dopt2027 levels use this. */
export function costTable(toolTokens = 0) {
  const rows = []
  for (let n = MIN_LEVEL; n <= MAX_LEVEL; n += 1) rows.push(protocolCost(n, toolTokens))
  return rows
}

/**
 * The protocol block injected as runtime context.
 *
 * Tier 0 returns the empty string, and that is the whole point: the harness
 * drops every context whose rendered text is empty (`renderContextSections`
 * filters `text.length > 0`) and then drops the surrounding "Current runtime
 * context" wrapper when no context survives, so tier 0 costs exactly zero
 * characters and zero tokens — not a short header. The registration itself
 * stays (`required: true`), because a missing required context is a defect the
 * host reports, while an empty one is a normal state.
 */
export function renderProtocol(level) {
  const n = clampLevel(level)
  const rules = activeRules(n)
  if (rules.length === 0) return ''
  return [`## Reasoning protocol — tier ${n}/${MAX_LEVEL} (${levelTitle(n)})`, '', ...rules.map((rule) => `- ${rule.text}`)].join('\n')
}

/**
 * One-line-per-tier table for /dopt2027 levels.
 *
 * The cost columns are the reason this table exists now: a tier is chosen for
 * what it adds, and what it adds is paid on every request. Characters and
 * tokens are both shown because one is exact and the other is the unit a
 * person budgets in.
 */
export function renderLevelTable(current, toolTokens = 0) {
  const now = clampLevel(current)
  return TITLES.map((title, index) => {
    const n = index
    const mark = n === now ? '→' : ' '
    const cost = protocolCost(n, toolTokens)
    return `${mark} ${n}  ${title.padEnd(12)} ${String(cost.rules).padStart(2)} rules ${String(cost.chars).padStart(4)} chars ${String(cost.tokens).padStart(3)} tok ${String(cost.totalTokens).padStart(4)} tok/req`
  }).join('\n')
}

export function describeLevel(level) {
  const n = clampLevel(level)
  return {
    level: n,
    title: levelTitle(n),
    rules: activeRules(n).map((rule) => ({ id: rule.id, from: rule.from, text: rule.text })),
  }
}
