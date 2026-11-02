/**
 * Read-only analyst briefs.
 *
 * The useful half of the upstream delegation design was not the subagent
 * machinery — this profile already has `subagent`, `subagent_fork` and
 * `workflow`. It was three constraints on how a delegate is used:
 *
 * 1. A delegate may analyze and retrieve. It may not write, edit, run, or
 *    decide. A delegate that mutates is a second author of the same diff, and
 *    the lead can no longer say who changed what.
 * 2. The brief never states the lead's hypothesis. An analyst told the
 *    expected answer will find it, whether or not it is true.
 * 3. The report is framed as testimony, not fact, and a truncated report is
 *    marked incomplete rather than summarized as if it finished.
 *
 * This module produces the brief text and classifies it. It does not spawn
 * anything: the caller passes the result to the existing `subagent` tool, so
 * there is one delegation mechanism in the process, not two.
 */

/**
 * Briefs that ask a delegate to change state. A hit is refused with the reason
 * rather than silently rewritten, because the caller needs to know their plan
 * was the wrong shape.
 *
 * Two tiers, because judging intent from a regex fails in two different ways
 * and they need different repairs:
 *
 * - HARD patterns are unambiguous wherever they appear: a VCS or package-manager
 *   subcommand, a privilege command, a request form ("can you fix…"), an explicit
 *   intent word. These are checked against the whole brief, question or not.
 * - SOFT patterns are a verb that only means mutation in an imperative frame:
 *   "run tests" is an instruction, "does the runner run tests in parallel" is a
 *   question. These are skipped when the brief is phrased as a question.
 *
 * Measured before the split: "Does the existing test runner run tests in
 * parallel?" and "How do I run the test suite to check this?" were both refused,
 * while "Can you fix the off-by-one in parseCapture?" and every Chinese brief
 * ("帮我改一下 lib/shell.js"、"把 _app.bin 删掉") passed. Both directions wrong.
 */

const CJK_VERBS = '改|修改|删|删除|移除|重命名|创建|新建|写入|保存|执行|运行|跑|安装|卸载|提交|推送|合并|回滚|重构|实现'

const MUTATION_PATTERNS = [
  // vcs and package managers
  /\bgit\s+(commit|push|merge|rebase|reset|checkout|switch|tag|stash|clean|apply|cherry-pick)\b/i,
  /\b(npm|pnpm|yarn|bun)\s+(install|i|add|remove|publish|run|exec|dlx)\b/i,
  /\b(pip|pip3|poetry|uv|cargo|go|gem|composer)\s+(install|add|remove|uninstall|get|build)\b/i,
  // privilege and system config
  /\b(chmod|chown|sudo|su|runas|regedit|reg\s+add|reg\s+delete|sc\s+create|sc\s+delete|netsh|setx)\b/i,
  // explicit intent words
  /\b(implement|refactor|migrate|apply the (fix|patch|change)|make the change|do it yourself|go ahead and (change|write|edit|run))\b/i,
  // a request form, even when written as a question
  /\b(please|can you|could you|would you|i need you to|i want you to)\s+(fix|change|rewrite|update|remove|add|edit|delete|write|run|execute)\b/i,
  // a Chinese request form, or an unmistakable Chinese mutation phrase
  new RegExp(`(帮我|请你?|麻烦你?|你来|直接)\\s*(?:一?下)?\\s*(?:${CJK_VERBS})`, 'u'),
]

const SOFT_PATTERNS = [
  // an imperative verb opening the sentence — the mood, not a keyword, is the
  // signal. "edit lib/shell.js to fix it" matches nothing word-pair based,
  // because the object is a path rather than the word "file".
  /^\s*(?:please\s+)?(write|save|create|delete|remove|edit|patch|modify|rename|move|overwrite|append|run|execute|install|fix|change|update|rewrite|refactor|implement|add|drop|kill|start|stop|restart|deploy)\b/i,
  // file mutation
  /\b(write|save|create|delete|remove|edit|patch|modify|rename|move|overwrite|append)\b[^.]{0,40}\b(file|files|path|folder|directory|dir|repo|repository|source|code)\b/i,
  /\b(create|delete|remove|rename|move)\b[^.]{0,30}(\.\w{1,6}\b|\/|\\)/i,
  // process and environment mutation
  /\b(run|execute|install|uninstall|start|stop|restart|kill|launch|deploy)\b[^.]{0,40}\b(command|commands|script|process|service|server|daemon|job|container|build|test|tests)\b/i,
  // Chinese mutation verb with an object, but no request prefix
  new RegExp(`(?:${CJK_VERBS})(?:一下|掉|下|它|这个|那个|文件|代码|测试|脚本)`, 'u'),
  new RegExp(`^\\s*(?:${CJK_VERBS})`, 'u'),
]

/** A brief phrased as a question asks about the code; it does not tell anyone to change it. */
function looksLikeQuestion(brief) {
  const text = String(brief ?? '').trim()
  if (text.length === 0) return false
  if (/[?？]\s*$/.test(text)) return true
  return /^(how|what|where|when|which|who|why|does|do|is|are|was|were|did|can|could|would|should|may|might)\b/i.test(
    text,
  )
}

const FORM_DEFAULT = ['conclusion', 'evidence', 'uncertainty', 'counterexample']

const FORM_LABELS = {
  conclusion: 'Conclusion — one sentence, up front.',
  evidence: 'Evidence — the exact output, path, line or value each conclusion rests on.',
  uncertainty: 'Uncertainty — what you could not check, and what would settle it.',
  counterexample: 'Counterexample — the input that would falsify your conclusion.',
}

export function classifyBrief(brief) {
  const text = String(brief ?? '').trim()
  if (text.length === 0) return { mutating: false, matched: null, tier: null }
  for (const pattern of MUTATION_PATTERNS) {
    const match = pattern.exec(text)
    if (match !== null) return { mutating: true, matched: match[0], tier: 'hard' }
  }
  // The question frame is judged per line, not for the whole brief. A brief that
  // opens with a question and continues with an instruction is an instruction:
  // "what does lib/shell.js do?\nedit lib/shell.js to fix it" reads as a question
  // if you only look at the first word.
  for (const line of text.split(/\r?\n/)) {
    if (looksLikeQuestion(line)) continue
    for (const pattern of SOFT_PATTERNS) {
      const match = pattern.exec(line)
      if (match !== null) return { mutating: true, matched: match[0], tier: 'soft' }
    }
  }
  return { mutating: false, matched: null, tier: null }
}

export const MUTATION_REFUSAL =
  'A delegate may analyze and retrieve. Writing code, editing files, running commands and making the decision stay with you — ' +
  'otherwise two authors share one diff and neither can say what changed. ' +
  'Rewrite the brief as a question about the code, not an instruction to change it.'

/**
 * The analyst brief. `context` is what the analyst needs to answer; the lead's
 * own hypothesis is deliberately not a parameter, so it cannot leak in by
 * accident.
 */
export function analystPrompt({ question, context, form, forbid, workspace }) {
  const ask = String(question ?? '').trim()
  if (ask.length === 0) throw new Error('analyst_brief: question is required')
  const sections = [
    '# Analyst brief',
    '',
    'You are answering one question about existing material. You are not the author of the work and you do not change it.',
    '',
    '## Question',
    '',
    ask,
    '',
  ]
  const ctx = String(context ?? '').trim()
  if (ctx.length > 0) {
    sections.push('## Context you may rely on', '', ctx, '')
  }
  const ws = String(workspace ?? '').trim()
  if (ws.length > 0) {
    sections.push('## Where to look', '', ws, '')
  }
  const wanted = Array.isArray(form) && form.length > 0 ? form : FORM_DEFAULT
  sections.push('## Answer in exactly these sections', '')
  for (const key of wanted) {
    const label = FORM_LABELS[key]
    if (label !== undefined) sections.push(`**${key}.** ${label}`)
  }
  sections.push('')
  const hard = [
    'Do not modify, create, move or delete any file.',
    'Do not run a command that changes state; read-only inspection only.',
    'Do not make the decision for the caller. Report; do not conclude what to do.',
    'Do not invent a citation, a file path, or an output you did not see. If you did not look, say you did not look.',
    'Do not restate the question back as if it were an answer.',
  ]
  const extra = String(forbid ?? '').trim()
  if (extra.length > 0) hard.push(extra)
  sections.push('## Hard limits', '', ...hard.map((line) => `- ${line}`), '')
  return sections.join('\n')
}

/**
 * Frame a returned report. The point is that the caller reads it as evidence
 * of what the analyst said, not as the answer to the question.
 */
export function frameReport({ label, output, stopReason }) {
  const name = String(label ?? 'analyst').trim() || 'analyst'
  const body = String(output ?? '').trim()
  const lines = [
    `## Report from ${name} — testimony, not fact`,
    '',
    'This is what the delegate reported, not a verified conclusion: a delegate can',
    'be wrong in the same direction as the brief that asked it. Check anything',
    'load-bearing before relying on it.',
    '',
  ]
  if (stopReason === 'max-tokens' || stopReason === 'length') {
    lines.push(
      '> **Incomplete.** The delegate stopped at its token limit. Treat what is',
      '> here as partial evidence and the missing part as unknown, not as absent.',
      '',
    )
  } else if (typeof stopReason === 'string' && stopReason.length > 0 && stopReason !== 'end') {
    lines.push(`> Stopped early: ${stopReason}. Treat the report as partial.`, '')
  }
  lines.push(body.length > 0 ? body : '_(the delegate returned no text)_')
  return lines.join('\n')
}
