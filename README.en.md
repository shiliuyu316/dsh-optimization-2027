# dsh-optimization-2027

A DeepSeek Harness bundle that puts seven capabilities in one package — **reasoning-tier protocol + claim ledger + declarative custom tools + persistent PowerShell + prompt re-injection + read-only analyst briefs + a composer button panel** — plus the HTTP route that wires the panel to them.

It is a derivative of [husongan/dsh-deepseek-2027](https://github.com/husongan/dsh-deepseek-2027) (MIT, see [Provenance and licence](#provenance-and-licence)): the mechanisms are kept, the implementations are rewritten, and the parts that measured wrong or granted too much authority are gone. **Almost every behavioural difference has a comment in the code explaining why the alternative was worse — the reasoning lives in each module's header, not in this README.**

- Five test suites, **376 assertions** (67 / 18 / 161 / 121 / 9), all green
- No network access; reads nothing outside `<DSH_HOME>/plugin-data/dsh-optimization-2027/`
- Twelve levels became five: at `off`, this plugin's extra cost for the request is **exactly 0 characters**

---

## Contents

- [What you get](#what-you-get)
- [Reasoning protocol: five tiers, 19 rules](#reasoning-protocol-five-tiers-19-rules)
- [The token bill](#the-token-bill)
- [A tier survives a restart](#a-tier-survives-a-restart)
- [Claim ledger](#claim-ledger)
- [Declarative custom tools](#declarative-custom-tools)
- [Persistent PowerShell](#persistent-powershell)
- [Prompt re-injection](#prompt-re-injection)
- [Read-only analyst](#read-only-analyst)
- [Composer button panel](#composer-button-panel)
- [HTTP route](#http-route)
- [Install](#install)
- [Commands](#commands)
- [Configuration](#configuration)
- [Where data lands](#where-data-lands)
- [Tests](#tests)
- [Provenance and licence](#provenance-and-licence)
- [Compatibility and known limits](#compatibility-and-known-limits)
- [Traps](#traps)
- [License](#license)

---

## What you get

| Capability | Entry point | Why it earns its place |
|---|---|---|
| Reasoning protocol | injected automatically + `/dopt2027 level` | Five tiers (off / light / standard / deep / multi-agent); the higher ones add requirements on the reasoning that produces the answer, not a review pass afterwards; `off` is a real off switch; a tier you set is written to disk and comes back after a restart |
| Claim ledger | `claim` (`action: add / settle / audit`) | A load-bearing claim must carry evidence or a check; a falsified claim is kept rather than deleted |
| Declarative custom tools | `tool2027` | The model declares a JSON command template; it never loads model-generated code into the Host process, and a declared tool is callable without a restart |
| Persistent PowerShell | `shell2027` / `shell_reset` | With one process per call, `cd`, `$env:` and background processes are lost every time; here they survive between calls |
| Prompt re-injection | `/dopt2027 rearm` | A model drifts after a long turn; the re-send carries the current runtime context and replaces the older snapshots, and `rearmDistance` re-arms by itself once a request has drifted far enough |
| Read-only analyst | `analyst_brief` | A brief handed to a subagent may not ask it to mutate anything, and its report is testimony rather than fact |
| Composer button | `conversation.input.right` | Change the tier, read the tools / ledger and re-arm the prompt without leaving the conversation, through the same implementation `/dopt2027` uses |
| HTTP route | `POST /dsh-optimization-2027/api` | The only way back into this process for that button; button and typed command share one `surface.invoke`, so they cannot grow two sets of state |

---

## Reasoning protocol: five tiers, 19 rules

A tier **only chooses protocol text**. It never touches `reasoningEffort`, `temperature` or `maxTokens` — the largest behavioural difference from upstream, explained in [Provenance](#provenance-and-licence).

Rules accumulate by `from ≤ tier`, so a higher tier contains everything below it:

| Tier | Name | Rules | Rules added |
|---|---|---|---|
| 0 | off (default) | 0 | no text at all, renders an empty string |
| 1 | light | 3 | `answer-first` `no-padding` `name-uncertainty` |
| 2 | standard (recommended) | 9 | `read-first` `one-verifiable-step` `reproduce-before-attributing` `quantify` `claim-channel` `state-the-falsifier` |
| 3 | deep | 17 | `boundary-and-diff` `state-the-cost` `find-the-breaking-case` `counterexample` `carriers` `six-phases` `bet-first` `compress-by-decision` |
| 4 | multi-agent | 19 | `delegate-analysis-only` `report-is-testimony` |

The 19 rules, verbatim:

**tier 1 — how it reads**
- `answer-first` — Lead with the answer or the action; the reason follows.
- `no-padding` — Cut sentences that carry nothing: restating the question, filler transitions, closing offers.
- `name-uncertainty` — Name the step you are unsure about instead of hedging.

**tier 2 — the order of work**
- `read-first` — Read the file, run the read-only command, open the log before you change anything.
- `one-verifiable-step` — One verifiable change at a time; verify it, then continue.
- `reproduce-before-attributing` — Reproduce a failure before explaining it; a fix for an unreproduced failure is a guess.
- `quantify` — Count what can be counted: line numbers, byte sizes, timings, exit codes.
- `claim-channel` — Tag load-bearing claims observed / derived / assumed / guessed. Assumed or guessed may not carry the answer.
- `state-the-falsifier` — Say what you would see if a load-bearing claim were false; look when looking is cheap.

**tier 3 — derivation on hard problems**
- `boundary-and-diff` — Fix the boundary before editing — inputs, outputs, error paths, callers — then deliver the smallest reviewable diff.
- `state-the-cost` — State the cost — time, quota, irreversible effects — and let the user decide; before a destructive action, what it destroys and how to undo it.
- `find-the-breaking-case` — Find the input that breaks the answer and fix it. A disclaimer moves that work back to the reader, so repair the claim or mark it broken; "there may be edge cases" counts as neither.
- `counterexample` — Construct the input that would falsify the conclusion and run it, and derive the same result a second way; their disagreement is where the error is.
- `carriers` — Every step names its carrier — file, field, command, line — and a step with no carrier is a step you skipped.
- `six-phases` — Hard case: constitute the problem, derive it two ways, derive from primitives, press it with counterfactuals, scale what is left unknown (high/medium/low, with the reason), then argue it holds.
- `bet-first` — Bet shape, magnitude and direction before deriving; a mismatch is the signal, so never delete the bet.
- `compress-by-decision` — Summarize by decision and cost, not by topic visited.

**tier 4 — delegation boundaries**
- `delegate-analysis-only` — Delegate analysis and retrieval; code, edits and decisions stay with you.
- `report-is-testimony` — A delegate report is testimony, not fact; mark a truncated one incomplete.

**Why `off` really is 0.** `renderProtocol(0)` returns `''`. The Host's `renderContextSections` has `filter(text.length > 0)` and `joinContextSections` returns `''` once `body.length === 0`, so the model never even receives the `Current runtime context. This snapshot supersedes…` wrapper. The context is still registered as `required` (a missing required context is a defect; an empty one is a normal state), and `status`, the button and `/dopt2027 levels` read the tier from plugin state rather than from injected text. `test/tier-cost.mjs` proves this against the Host's own `renderContextSnapshot()`.

---

## The token bill

| Tier | Protocol text | Tool schemas | **Per request** |
|---|---|---|---|
| 0 off | 0 chars ≈ 0 tok | not sent | **0 tok** |
| 1 light | 252 chars ≈ 63 tok | 1100 tok | **≈ 1163 tok** |
| 2 standard | 767 chars ≈ 192 tok | 1100 tok | **≈ 1292 tok** |
| 3 deep | 1833 chars ≈ 459 tok | 1100 tok | **≈ 1559 tok** |
| 4 multi-agent | 1993 chars ≈ 499 tok | 1100 tok | **≈ 1599 tok** |

The five tools, measured in the shape the Host actually sends (`{name, description, input_schema}`):

| Tool | chars | ≈ tok |
|---|---|---|
| `shell2027` | 644 | 161 |
| `shell_reset` | 240 | 60 |
| `tool2027` | 1039 | 260 |
| `claim` | 1112 | 278 |
| `analyst_brief` | 1365 | 342 |
| **total** | **4400** | **1100** |

Read it this way: those 1100 tok of tool schemas are paid **on every request**, used or not; the protocol text is the half that a tier can change. The panel and `/dopt2027 levels` show the total rather than the protocol alone, because reporting only the protocol half understated the real bill by an order of magnitude.

The numbers come from `protocolCost()`, computed from **the text actually rendered** and **the tool definitions actually registered** — change a rule or a tool description and the number changes with it, with no second table to fall out of sync. Tokens are estimated as `ceil(chars / 4)`: this text measured at 4 chars/token on this machine, but the real tokenizer belongs to the model, so the label says `tok` rather than pretending to be exact (an interleaved estimate puts `/4` at the lower bound; the true number may be 10–30% higher).

**Bringing the 1100 tok down.** `shellEnabled: false` saves 221 tok (`shell2027` and `shell_reset` are never registered); a low-frequency tool can be deleted outright at the cost of the capability. **"Load it only when the model needs it" is not available on this machine** — the Host has a first-class `deferLoading` mechanism, but it requires the model side to support adding tools mid-conversation (`toolUpdate`). The `workbuddy` route here does not declare that capability, so `dsh-llm` strips the `deferLoading` flag and sends every tool anyway; worse, `dsh-llm-pi-ai`'s `toolsOf()` **drops** any tool that carries the flag without being lifted by the projection, which means the capability disappears.

---

## A tier survives a restart

A tier is per agent (that is, per session). A tier you set explicitly is written to `<DSH_HOME>/plugin-data/dsh-optimization-2027/levels/level-<session>.json` (temp file plus `renameSync`, so the write is atomic) and restored from that file after a restart.

Two boundaries are deliberate:

- **Only an explicit set reaches the disk.** A session that never changed tier leaves no record and keeps reading `config.level`, so "a new session starts at off" is never broken by an old session that once used a high tier.
- **An unreadable record counts as no record**, falling back to the default rather than pinning 0. Bad JSON, a permission error or a wrong type all take that path — if your choice cannot be read, it should not be replaced by a choice of mine.

Values outside 0–4 are clamped to the nearest tier (negatives → 0, 5 and above → 4). `clampLevel` also falls back to 0 for **unreadable** input (`undefined`, `NaN`, `"abc"`): a tier that cannot be parsed must not conjure rules out of nothing, and off is the only value that adds nothing.

---

## Claim ledger

`claim` is one tool with three actions, replacing the three tools it used to be (`claim_add` / `claim_settle` / `claim_audit`). Three definitions cost 373 tok on the wire; one definition with an `action` parameter costs 278 tok — 95 tok saved, no capability lost.

```
claim { action: "add", text: "dispose kills every shell child process via taskkill /T", channel: "observed",
        loadBearing: true, evidence: "measured pids 12788 -> cmd 7688 -> timeout 9856, only the parent died" }
claim { action: "settle", id: "c3", holds: false, result: "re-measured: /T does reach the tree, the earlier test was wrong" }
claim { action: "audit" }
```

**The one rule that is actually enforced.** `channel` accepts only `observed` / `derived` / `assumed` / `guessed`. A `loadBearing: true` claim with neither `evidence` nor `check` makes `add()` throw: it is a guess wearing a conclusion's clothes, and a guess may not carry the answer.

**A falsified claim is kept, not deleted**, and marked `[FALSIFIED]`. The ledger is append-only JSONL at `<DSH_HOME>/plugin-data/dsh-optimization-2027/ledger/ledger-<session>.jsonl` — it survives compression, restarts, and every version of the conversation.

`audit()` reports the counts separately: `unverified` (load-bearing, not checked) and `unsupported` (load-bearing without evidence) are different failures, and merging them would hide the first behind the second. `clean` requires `unverified === 0 && unsupported === 0 && falsified === 0`.

**It blocks nothing.** `clean` is only ever read by `renderAudit`; there is no gate anywhere in the plugin. Its role is self-report plus after-the-fact review, and the only enforcement is that one throw in `add()`.

---

## Declarative custom tools

The model uses `tool2027` to declare a tool: a name, a description, a parameter schema and a PowerShell command template. It is written to `<tools>/<name>.json` (for the machine) and `<name>.md` (for the human, and the model's own notes), and **a declared tool is callable without a restart**.

`tool2027` takes four actions: `save` (declare — callable immediately, no restart), `list` (the declared set plus each tool's doc path), `show` (the template as written) and `remove` (delete it, so the next prompt no longer lists it).

```json
{
  "name": "disk_free",
  "description": "report free space on a drive",
  "parameters": { "type": "object", "properties": { "drive": { "type": "string" } }, "required": ["drive"] },
  "command": "Get-PSDrive {{drive}} | Select-Object -ExpandProperty Free"
}
```

**Why not "the model writes JavaScript".** Loading model-authored code into the Host process is privilege escalation the user never agreed to: the model's code receives the plugin's full authority, and one syntax error takes the whole plugin down. A declarative template instead inserts each placeholder value as a PowerShell single-quoted literal (internal quotes doubled), so an argument cannot smuggle a shell operator; a missing placeholder is an error rather than an empty substitution (an emptied value turns a filter into a wildcard).

Measured: passing `a'; Write-Output 'PWNED'; $(1+1)` to the template `Write-Output ('probe:' + {{word}})` returns the literal `probe:a'; Write-Output 'PWNED'; $(1+1)` — nothing was executed.

The prompt carries only an **index** (name + summary + absolute path to the `.md`), never the full text: documentation grows without bound, and stuffing all of it into the prompt crowds out the actual task. One index entry is about 275 chars ≈ 69 tok.

Reserved names a custom tool may not take: `bash` `pwsh` `run_code` `read` `write` `edit` `glob` `grep` `skill` `subagent` `workflow` `present` `ask_user_question` `todo_write` `web_search` `web_fetch` `shell2027` `shell_reset` `tool2027` `claim` `analyst_brief` — shadowing one of these would silently change what an existing call does.

---

## Persistent PowerShell

`ctx.shell` resolves and runs one process per call, so `cd`, `$env:X = ...` and anything started in the background are gone by the next call. That is the single largest source of wasted turns in shell work: every call has to rebuild its own context first.

`shell2027` gives each agent one long-lived PowerShell, so the working directory, the environment and started processes survive. Measured across several calls on the same pid: `Set-Location` and `$env:` both still held.

- **Platform**: `pwsh` (PowerShell 7) is preferred; Windows PowerShell 5.1 works when it is the only one installed.
- **Timeout**: 60 s by default (`shellTimeoutMs`). On expiry it runs `taskkill /pid <pid> /T /F` before `kill`, because grandchild processes (measured pwsh → cmd → timeout) otherwise become orphans.
- **Recycling**: closed after 15 minutes idle (`shellIdleMs`); closed immediately on `agent/disposed` (the idle timer answers "nobody is using it", disposed answers "nobody owns it"); `shell_reset` discards it on demand.
- **Output**: keeps the last 4000 lines and the last 200,000 characters (`MAX_CAPTURED_LINES` / `MAX_CAPTURED_CHARS`); anything earlier is dropped and the result is marked `truncated`.

**Encoding is the easiest thing to get wrong here.** `-Command -` decodes stdin with the ANSI code page while the child writes stdout in whatever encoding it picked. Both ends need fixing: the body goes in as base64 that decodes itself, and the script opens with `[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false`. Without that, `D:\工作区` arrives as a different 38-character string (`Test-Path` answers `False` while the CJK text in the output still looks right).

---

## Prompt re-injection

A model drifts after a long turn: the runtime context sits further and further from the tail of the request. `/dopt2027 rearm` re-assembles the current runtime context and delivers it as one message.

Three design points:

- **Runtime context only, never the whole assembly.** The first version stuffed all 24 sections of `assemble()` into one message: measured 177,508 chars ≈ 44,377 tok, of which 22,762 tok was the unchanging base prompt and 20,624 tok was the full JSON Schema of 84 tools. Now tier 4 costs 1,993 chars ≈ 499 tok.
- **The old snapshot is retired.** A stale snapshot left in the transcript is read by the model as a second valid context. `session.append('user/message', …, {surfaceOp:{op:'replace', startSeq, endSeq}, sourceEventSeqs:[seq]})` swaps it for a one-line note. One node at a time rather than one range, because a range replace swallows every surface node inside it. Measured: the two stale snapshots this replaced held 353,155 chars ≈ 88,289 tok.
- **An unchanged body short-circuits.** Pressing re-arm twice does not write a second message.

The automatic half hangs off `agent/pre-step`, and it is subscribed **whether or not the threshold is on**: the threshold is a per-session setting now, and a hook that only exists when the config file says a positive number can never be switched on without a restart. The handler reads this session's threshold first and lets the step through when it is 0.

The threshold is off by default (0). The panel's "auto re-arm" field and `/dopt2027 rearm <n>` both write it, and the next request uses the new value — no restart.

---

## Read-only analyst

`analyst_brief` starts nothing. It does one of two things: write a question out as a brief with hard limits, or frame a subagent's reply as testimony.

```
1. analyst_brief { question: "does dispose actually kill every shell child process?", workspace: "lib/shell.js" }   → the brief text
2. subagent { description: "check shell teardown", prompt: <the brief> }                                      → the delegate's report
3. analyst_brief { question: <same>, report: <the reply>, stopReason: "max-tokens" }                            → the reply comes back framed as testimony
```

Three constraints:

- **A brief may not ask for a state change.** The classifier has two tiers. Hard patterns (`git push`, `npm install`, `chmod`, `can you fix…`, `帮我改…`) refuse wherever they appear, question frame or not; soft patterns — a verb that only means mutation in the imperative — are skipped when the line reads as a question, so `Does the test runner run tests in parallel?` passes. The whole brief is judged (question + context + workspace), not the question alone.
- **The brief never carries your hypothesis.** `analystPrompt` has no hypothesis parameter at all, so it cannot leak in — an analyst told the expected answer will find it, whether or not it is true.
- **The report is not the answer.** `frameReport` opens with "testimony, not fact", and adds an "Incomplete" note when `stopReason` is `max-tokens` or `length`.

---

## Composer button panel

A button sits in the composer's right-hand tool row (`conversation.input.right`, order 30, between `dsh-purge-rewind 20` and `vision-router-mode-toggle 40`).

- **Its visible text is the current tier alone** — `off` / `light` / `std` / `deep` / `multi`, never the plugin name and never an internal `T2` index: it changes a setting, so it should read like a setting. It reads Host state on mount, then every 10 s and again whenever the page becomes visible, because the tier can be changed from the chat with `/dopt2027 level 3`.
- **Opened, it is buttons plus one digits-only field** — every `/dopt2027` subcommand already has a button; only the auto re-arm threshold has no fixed set of candidates, so it gets the single input, with `inputMode: numeric` and non-digits filtered as you type, committing through the very same verb as `/dopt2027 rearm <n>`. A free-text box that could type a command is what would make the panel a second, unvalidated interface; this version has none.
- **Five tier chips** split one row evenly; the current tier wears the native "selected chip" treatment (`--dsw-alias-button-ghost-active-fill` plus an inset 1px border) and is marked `aria-pressed`; hovering gives what that tier actually adds. The number of chips comes from the Host's `minLevel`/`maxLevel`, and going from tier 4 to tier 0 is one click.
- **A token figure sits directly under each chip**, sharing the same column width, so a number always sits under the tier it belongs to. The figure for the tier in force is lit (`--dsw-alias-label-primary` at 600 plus the same selected treatment); the others are `--dsw-alias-label-caption` at 500 with `tabular-nums` so they line up as a column. Only one of the five is the number you are paying right now, and it should say so rather than make the eye work out which chip is pressed.
- **Four verb buttons** (`tiers` `tools` / `ledger` `re-arm prompt`) in a two-by-two grid. Every one carries a hover explanation in both `title` and `aria-label`, so keyboard and screen-reader users get it too.
- **Under the verb grid sits the auto re-arm field**: a plain text label, then a 52px input right beside it. Only the number gets a frame — wrapping the row would make a sentence look like the contents of one input. It is the only control in the panel that edits a number instead of naming a verb, so it commits on blur or Enter rather than on each keystroke — three digits committing three requests would turn one field into three states. Blank means 0 means off: all three spellings are accepted as the same answer, and typing back the number the Host already reported costs no request. After a commit the field hands itself back to the Host, so what is on screen is never a number the Host did not confirm. Its hover text hangs on the words "auto re-arm", not on the number box: the text does not repeat that word: `once this many messages (tool calls included) have passed since the last Host context, one is re-sent (cwd, policy, approvals). Blank or 0 is off`. The words "runtime context" never appear — that is the implementation name and nothing in the panel defines it. The custom-tools and re-arm hints are equally plain, with no `profile`, `PowerShell` or `transcript`. The longer ones are broken into lines, because a tooltip is a narrow box and a 60-character line gets clipped at the screen edge. Width is measured in display columns, not characters — one Chinese glyph takes two columns, so 38 glyphs is 76 columns and still clipped — and every wrapped line stays within 40 columns; `test/client.mjs` asserts on column width, not on `length`, then that the count is messages since the last one, tool calls included, and that what gets re-sent at the threshold is that runtime context itself.
- **Two read-only panels**: `current state` (fixed 80px, the four `status` lines) and `last action` (fixed 96px). The heights are constants rather than state, and `box-sizing:border-box` means the height includes the padding; when content overflows, the wheel scrolls inside the box (`overscroll-behavior:contain`) and hands the event back to the conversation once it hits the end. There is no size slider — the previous draft gave each panel one, which amounts to asking someone to size the box before they can read it.
- **The panel heading is `reasoning tuning`**, not the package name: it answers "what am I about to change" rather than "what is in here". The package name lives in the trigger's `title` and in the `role="dialog"` `aria-label`, so hovering or a screen reader still identifies the plugin.

**The chrome copies the Host's own controls** rather than hand-drawing something similar: the trigger and tier chips follow the composer chip spec (28px tall, `--dsw-radius-sm`, no border, `--dsw-alias-label-secondary` at 13px, hover `--dsw-alias-interactive-bg-hover`, focus ring `--dsw-focus-ring-width`/`--dsw-focus-ring-color`); the panel follows the Host menu spec (`--dsw-radius-lg`, `--dsw-specific-menu`, `--dsw-menu-backdrop-filter`, `--dsw-elevation-prominent`). These are `:hover`/`:focus-visible` rules that inline styles cannot express, so the stylesheet is mounted in `document.head` as `style[data-plugin-css="dsh-optimization-2027"]` — the same approach the shipped UI plugins use — and de-duplicated by that tag so replaying `apply` cannot stack a second copy. `test/client.mjs` pins one rule: every `var()` custom property must start with `--dsw-`.

---

## HTTP route

`POST /dsh-optimization-2027/api`, with a body of `{"action":"state"}` or `{"action":"invoke","input":"level 3"}`.

The Client half runs in the renderer and cannot call a Host service, so this route is the button's only way back into the process. The button and the typed command both go through one `surface.invoke`, so the two paths cannot grow separate state.

Three refusals are load-bearing: **not loopback → 403**, **not POST → 405**, **body is not JSON → 400**, never a guessed default. `isLoopback` checks three things: the socket's local address, the `Host` header, and the `Origin` header when one is present.

`state` returns only the fields the client actually reads (`level` / `levelTitle` / `minLevel` / `maxLevel` / `cost` / `costs`) plus a one-line `status` summary. The full ledger is not sent with `state`: the panel reads it on mount and every 10 s thereafter, and those 1883 characters were never used once.

---

## Install

Clone and install into the current profile:

```powershell
git clone https://github.com/shiliuyu316/dsh-optimization-2027
plugin_manager install_bundle ".\dsh-optimization-2027"
```

Or from any local directory:

```powershell
plugin_manager install_bundle "D:\path\to\dsh-optimization-2027"
```

Or add it to the profile's `package.json`:

```json
{
  "dependencies": { "dsh-optimization-2027": "link:D:/path/to/dsh-optimization-2027" },
  "dsh": { "profile": { "bundles": ["dsh-optimization-2027"] } }
}
```

Then restart DSH. **The client half only appears after a restart**: `dsh-client-modules` caches the "this package is not a client package" negative verdict per Loader specifier for the life of the process, and the boot that installed the package is the one that cached it.

No extra configuration is needed for a Chinese UI — `client.js` picks the language from `document.documentElement.lang` and `navigator.language`, and `locale/zh.json` / `locale/en.json` give the Host's plugin list its name and description.

---

## Commands

```
/dopt2027                     status (four lines: tier / tools directory / shell process / ledger counts)
/dopt2027 level <0-4>         set this session's reasoning tier (0 = turn the protocol off)
/dopt2027 levels              what each of the five tiers adds, with characters and tok
/dopt2027 tools               list declared custom tools
/dopt2027 ledger              audit the claim ledger
/dopt2027 rearm               re-send the current runtime context and swap old snapshots for a one-line note`r`n/dopt2027 rearm <n> | off     set the automatic re-arm threshold (0 and off mean the same)
```

The command must be `dopt2027`: the Host validates `/^[a-z][a-z0-9_-]*$/u`, so a name starting with a digit (`2027`) throws a `TypeError` inside `register()`.

---

## Configuration

The `config` block in `cordis.patch.yml`:

| Key | Default | Meaning |
|---|---|---|
| `level` | `0` | initial reasoning tier, 0–4. A new session has no stored tier and falls back here, so the default is off |
| `customToolsDir` | `''` | empty means `<DSH_HOME>/plugin-data/dsh-optimization-2027/tools` |
| `shellEnabled` | `true` | when false, `shell2027` and `shell_reset` are not registered (saves 221 tok) |
| `shellTimeoutMs` | `60000` | per-script timeout; expiry kills the whole process tree |
| `shellIdleMs` | `900000` | how long an idle session is kept |
| `rearmDistance` | `0` | the automatic re-arm threshold a new session starts with: how many surface messages may pass since the last runtime context. 0 = off. Each session stores its own value under `rearm/`, and both the panel and `/dopt2027 rearm <n>` write it |

Unknown keys are dropped without an error, so leaving a removed key in an old config (upstream's `maxTokensCeiling`, for instance) does not break startup.

---

## Where data lands

```
<DSH_HOME>/plugin-data/dsh-optimization-2027/
  tools/<name>.json            custom tool declaration (machine-readable)
  tools/<name>.md              custom tool documentation (human + model)
  ledger/ledger-<session>.jsonl  claim ledger, append-only
  levels/level-<session>.json    explicitly set reasoning tier, restored after a restart
rearm/rearm-<session>.json     automatic re-arm threshold; 0 is a stored value too, so a blank field and a typed 0 land identically
```

**These files belong to the user, not to the plugin** — `.gitignore` excludes `plugin-data/` and `.dsh/`, so never commit or publish someone else's ledger and tiers.

---

## Tests

Five suites, all assertion-based, all failing with a non-zero exit code. 376 checks in total:

```powershell
# Pure logic: protocol rendering, ledger refusal rules, placeholder escaping, brief classification, cost maths
$env:ELECTRON_RUN_AS_NODE='1'; & 'D:\DSH\DeepSeek Harness.exe' test\smoke.mjs      # 67

# Really starts PowerShell and checks that cwd / env / non-ASCII survive between calls
$env:ELECTRON_RUN_AS_NODE='1'; & 'D:\DSH\DeepSeek Harness.exe' test\shell-live.mjs  # 18

# Runs apply() against a stub context: Config protocol, both contexts, five tools, every subcommand,
# the route's six refusals, per-session agent lookup, tier-0 tool withholding, re-arm retire + drift re-arm
$env:ELECTRON_RUN_AS_NODE='1'; & 'D:\DSH\DeepSeek Harness.exe' test\mount.mjs       # 161

# Runs client.js against a stub loader and stub React: module id, slot registration shape,
# stylesheet de-duplication, wheel behaviour, cost highlighting, panel structure
$env:ELECTRON_RUN_AS_NODE='1'; & 'D:\DSH\DeepSeek Harness.exe' test\client.mjs      # 121

# Measures marginal cost with the Host's own dsh-system-prompt renderer: tier 0 must add exactly 0 chars
$env:ELECTRON_RUN_AS_NODE='1'; & 'D:\DSH\DeepSeek Harness.exe' test\tier-cost.mjs   # 9
```

`engines` declares `node >= 20` and `dsh >= 0.2.0-rc.1`. This machine has no `node` on `PATH`, so the suites run through the harness's bundled Electron with `ELECTRON_RUN_AS_NODE=1`; with node installed, `node test/smoke.mjs` works as-is.

`test/tier-cost.mjs` looks for the Host's own `dsh-system-prompt` module in `D:/DSH/resources/app`, `app.asar` and `app.asar.unpacked` — it measures what the Host's renderer adds for tier 0, not the length of the plugin's own string. When no Host module is found it fails with exit code 1 rather than skipping silently.

---

## Provenance and licence

This package is a **derivative work** of [husongan/dsh-deepseek-2027](https://github.com/husongan/dsh-deepseek-2027) v1.0.8 (commit `88136b41`, MIT, `Copyright (c) 2026 husongan`). The original is MIT-licensed; this package uses the same licence and keeps the original copyright line in `LICENSE`.

### Mechanisms kept and rewritten

| Mechanism | Upstream location | Here | What changed |
|---|---|---|---|
| Tiered reasoning protocol | `levels.js` (12 levels, `slot` mapped onto effort, `intensity` for output budget) | `lib/levels.js` | 12 levels compressed to 5 tiers; **the `slot` → `reasoningEffort` mapping is gone**; `intensity` (output budget) is gone; the 19 rules are rewritten and the trailing "because…" clause on each is dropped |
| Claim ledger | `enhance.js` (`CHANNELS = ['observed','derived','assumed','guessed']`, `WEAK_CHANNELS`, load-bearing claims need evidence) | `lib/ledger.js` | same channel vocabulary and the same load-bearing gate; adds append-only JSONL persistence, `settle`, split audit counts, and exposes it as the `claim` tool |
| Declarative custom tools | `custom-tools.js` (`{{placeholder}}` + single-quoted literal + refuse a missing placeholder + `.json`/`.md` pair + index-only prompt) | `lib/custom-tools.js` | the placeholder protocol and the quoting helper are **character-for-character identical** (`'${String(value).replace(/'/g, "''")}'`, `psLiteral` upstream and `psQuote` here); only the PowerShell backend is kept; the entry point moved from `dev_tool` to `tool2027` |
| Read-only analyst | `delegation.js` (`MUTATION_PATTERNS` + `classifyBrief` + report framed as testimony) | `lib/analyst.js` | the classifier went from one tier to two (hard / soft) with a question-frame pass; the "report is testimony" framing and the `Incomplete` marker are kept |
| Prompt re-injection | `index.js`, `/deepseek2027` (re-runs `systemPrompt.assemble()` and delivers all of it) | `index.js`, `rearm` | no longer sends the whole assembly, only the runtime context (1,993 chars vs 177,508); adds snapshot retirement, an unchanged-body short-circuit and `rearmDistance` |

One conclusion from upstream's `levels.js` is inherited whole and quoted in this package's `lib/levels.js` header: **the "review rounds" that re-entered the turn to audit the draft were removed — re-running a turn to make a model reread its own output produces the appearance of rigour without adding information.** What changes a hard answer is the shape of the reasoning *before* the answer is written.

### New in this package (not in upstream)

- **`off` tier (level 0)**: a genuinely zero-cost way to turn the protocol off. Upstream's floor is L1, and L1 still occupies an effort slot.
- **Tiers persisted across restarts** (`lib/level-store.js`): upstream's tier lives in process memory only.
- **A persistent local PowerShell pool** (`lib/shell.js`): upstream has an idle timer for remote SSH (`ssh.js`) but a one-process-per-call local shell.
- **An HTTP route and the composer button panel**: upstream's client UI is a tier slider plus a re-inject button, with no HTTP route at all (no `webServer` / `registerRoute` match in any of its JS); this panel gets back to the Host through a loopback-only POST route.
- **Token accounting** (`protocolCost` / `costTable` / the panel figures / the char and tok columns in `/dopt2027 levels`): upstream shows no cost anywhere.
- **`claim` as one tool with three actions**: upstream has three separate ledger tools.
- **Tier 0 withholds this plugin's own tools inside `system-prompt/assemble`**: upstream has no such hook.
- **The `-Command -` two-way encoding fix** (base64 body plus explicit `Console::OutputEncoding`): upstream's `psLiteral` covers template values only, not stdin/stdout encoding.
- **Five suites, 376 assertions**: upstream has three files under `_test/` (`fake-ssh`, `integration-test`, `schema-check`), all replaced here.

### Deliberately not carried over

| Upstream capability | Why not |
|---|---|
| 12 thinking levels + `effortFor()` | `efforts[round(slot*(efforts.length-1))]` collapses 12 levels onto the 3 efforts a model actually advertises (L1=L2=low, L3=L4=L5=high, L6–L12=max). Here a tier chooses protocol text and never touches `reasoningEffort` |
| The `maxTokens` factor | Upstream's default ceiling of 65536 is below this machine's 128000, so enabling it halves the budget; after fixing it to `max(ceiling, base)` the only effective setting became "ask a model that declares 128000 for 192000". The global-absolute shape is itself wrong — the 50 models here declare `maxTokens` across 32000–131072 |
| The 1–12 compatibility layer | Keeping it means one config key with two scales: `level: 7` would need a guess between tier 7 and old level 7 |
| `dev_admin` (administrator execution of arbitrary commands) | Authority far beyond "let the model finish the job" |
| `dev_desktop` (mouse, keyboard, windows, screenshots) | Same |
| `dev_ssh` + `servers.js` / `targets.js` (persistent SSH, remote server registry) | Same; this package is local-only |
| `dev_persona` + `persona.js` (persona written into a required context, 3000-token cap) | A different product direction, and as a required context it is paid on every request |
| `dev_image` / `images.js` / `chart.js` (image display, SVG rasterising, charts) | Unrelated to these five mechanisms, and needs an extra dependency |
| `dev_agent` / `dev_team` / `agents.js` (L12 analyst definitions and dispatch) | The profile already has `subagent`, `subagent_fork` and `workflow`; this package supplies the brief, not a second delegation mechanism |
| `developer.js` (a 93 KB developer preset and manual) | A preset is a different layer, not a plugin |
| `dev-exec.ps1` / `dev-desktop.ps1` | They implement the two tools above; no tool, no script |

### If you want to check

```powershell
git clone https://github.com/husongan/dsh-deepseek-2027
cd dsh-deepseek-2027
git log -1 --format=%H   # around 88136b41c77c5310bab04c99595a1498aede2
```

Every row in those tables maps to a function you can find in both trees: `psLiteral` / `psQuote`, `CHANNELS`, `MUTATION_PATTERNS` / `classifyBrief`, `frameReport`.

---

## Compatibility and known limits

- **DSH version**: `>= 0.2.0-rc.1`. Uses `ctx.systemPrompt.context`, `ctx.on('system-prompt/assemble')`, `ctx.on('agent/pre-step')`, `ctx.on('agent/disposed')`, `webServer.register`, `commands.register` and `tools.register`.
- **Windows first**: the persistent PowerShell is verified most thoroughly on Windows (the `taskkill /T /F` tree kill is a Windows-only path). With `pwsh` present it should work on Linux and macOS, but process-tree reclamation takes a different branch and has not been verified by this project.
- **Chromium-based browsers**: the panel uses the composer chip's native tokens. When the Host theme is missing any of them the panel falls back to the raw defaults — still usable, but it will not look native.
- **`deferLoading` is unavailable**: see [The token bill](#the-token-bill). The route here does not declare `toolUpdate`, so tool definitions must be sent in full on every request, which is where the 1100 tok comes from.
- **Model parameters are never touched**: this package sets no `reasoningEffort`, `temperature` or `maxTokens`; it only injects text. Making a model actually think longer is a matter of the model chosen in the profile, not of this plugin.
- **The `unsupported` count is always 0 on the normal path**: `add()`'s throw already keeps "load-bearing without evidence" out, so that branch exists for hand-edited or externally written JSONL.

---

## Traps

Six of these will bite again when installing into another profile:

- **`Config` must carry `'~standard'.validate`.** The Host reads it before `apply()`; a plain object leaves the entry at `fiberPhase: "failed"` with `Cannot read properties of undefined (reading 'validate')` and no log line of its own. Schemastery provides that protocol, but it does not resolve from a profile-linked plugin, so it is written by hand here.
- **`-Command -` only executes once it receives a blank line.** On Windows PowerShell 5.1, `& { ... }` without a trailing blank line is four seconds of silence and no exit. That trailing blank line in `lib/shell.js` is part of the protocol, not formatting.
- **The client half needs a restart to appear.** `dsh-client-modules` caches the "this package is not a client package" negative verdict per Loader specifier for the life of the process; disabling and enabling the plugin does not clear it.
- **The command name must pass `/^[a-z][a-z0-9_-]*$/`.** A name starting with a digit (`2027`) throws a `TypeError` in `register()` — which is why the command is `dopt2027`.
- **`-Command -` does not share one encoding between stdin and stdout.** The child decodes stdin with the ANSI code page but writes stdout with whatever encoding it picked: feeding UTF-8 bytes straight in turns `D:\工作区` into another 38-character string (`Test-Path` answers `False` while the CJK text in the output still looks fine); switching to base64 fixes stdin and then stdout starts emitting `���`. Both ends need fixing. The three non-ASCII assertions in `test/shell-live.mjs` exist for this.
- **`tools.restrict()` only restricts the inherited layer.** It requires a scoped ctx (`agent.ctx`), and tools registered by the same fiber are not subject to it. To withhold your own tools at a low tier, the correct place is the `system-prompt/assemble` waterfall — it runs before `buildRequest` builds the header, so the very first request is already clean.

---

## License

MIT. Original work `Copyright (c) 2026 husongan` ([husongan/dsh-deepseek-2027](https://github.com/husongan/dsh-deepseek-2027)); this derivative `Copyright (c) 2026 shiliuyu316` ([shiliuyu316/dsh-optimization-2027](https://github.com/shiliuyu316/dsh-optimization-2027)). Full text in [LICENSE](LICENSE).
