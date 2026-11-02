# dsh-optimization-2027

一个 DeepSeek Harness bundle：**推理档位协议 + 结论台账 + 声明式自建工具 + 持久 PowerShell + 提示词重注入 + 只读分析员 + 输入框按钮面板**，七项能力装在一个包里，外加一条把它们接到面板上的 HTTP 路由。

它衍生于 [husongan/dsh-deepseek-2027](https://github.com/husongan/dsh-deepseek-2027)（MIT，见[代码来源](#代码来源与授权)）：保留机制，重写实现，丢掉实测有问题或权限过大的部分。**几乎所有行为差异都能在代码里找到一条注释解释「为什么不用另一种做法」——理由写在模块文件头，不在这个 README 里重复。**

- 五套测试共 **376 条断言**（67 / 18 / 161 / 121 / 9），全绿
- 不使用网络，不读取除 `<DSH_HOME>/plugin-data/dsh-optimization-2027/` 之外的任何路径
- 上游十二级变五档：`off` 档下本插件对这个请求的额外开销是 **精确 0 字符**

---

## 目录

- [它给你什么](#它给你什么)
- [推理协议：五档，19 条规则](#推理协议五档19-条规则)
- [token 账单：每轮到底多付多少](#token-账单每轮到底多付多少)
- [档位活过重启](#档位活过重启)
- [结论台账](#结论台账)
- [声明式自建工具](#声明式自建工具)
- [持久 PowerShell](#持久-powershell)
- [提示词重注入](#提示词重注入)
- [只读分析员](#只读分析员)
- [输入框按钮面板](#输入框按钮面板)
- [HTTP 路由](#http-路由)
- [安装](#安装)
- [命令](#命令)
- [配置](#配置)
- [数据落在哪](#数据落在哪)
- [测试](#测试)
- [代码来源与授权](#代码来源与授权)
- [兼容性与已知限制](#兼容性与已知限制)
- [踩过的坑](#踩过的坑)
- [License](#license)

---

## 它给你什么

| 能力 | 入口 | 为什么值得要 |
|---|---|---|
| 推理协议 | 自动注入 + `/dopt2027 level` | 五档（off / light / standard / deep / multi-agent），高档追加的是**写出答案之前**的推理要求，不是事后复审；`off` 是真正的关掉；设过的档位写盘，重启后按会话恢复 |
| 结论台账 | `claim`（`action: add / settle / audit`） | 承重结论必须带 evidence 或 check；被推翻的结论保留不删 |
| 声明式自建工具 | `tool2027` | 模型声明 JSON 命令模板，不往宿主进程里挂模型生成的代码；声明后免重启即可调用 |
| 持久 PowerShell | `shell2027` / `shell_reset` | 一次调用一个进程时，`cd` 和 `$env:` 每次都丢；这里 cwd、环境变量和后台进程跨调用保持 |
| 提示词重注入 | `/dopt2027 rearm` | 长 turn 之后模型会漂移；重发当前 runtime context 并**作废旧快照**；`rearmDistance` 打开时按漂移距离自动重发 |
| 只读分析员 | `analyst_brief` | 派给子智能体的简报不能要求改文件；分析员的报告是证词，不是事实 |
| 输入框按钮 | `conversation.input.right` | 不离开对话就能换档位、看工具/台账、重发提示词；走的是和 `/dopt2027` 同一份实现 |
| HTTP 路由 | `POST /dsh-optimization-2027/api` | 上面那个按钮回到本进程的唯一通道；按钮与手打共用 `surface.invoke`，不会各长一套状态 |

---

## 推理协议：五档，19 条规则

档位**只决定注入的协议文本**，不碰 `reasoningEffort`、`temperature`、`maxTokens`——这是与上游最大的行为差异，理由见[代码来源](#代码来源与授权)。

规则按 `from ≤ 档位` 累加，高挡包含低挡的全部内容：

| 档 | 名称 | 规则数 | 加入的规则 |
|---|---|---|---|
| 0 | off（默认） | 0 | 不注任何文本，渲染空串 |
| 1 | light | 3 | `answer-first` `no-padding` `name-uncertainty` |
| 2 | standard（推荐） | 9 | `read-first` `one-verifiable-step` `reproduce-before-attributing` `quantify` `claim-channel` `state-the-falsifier` |
| 3 | deep | 17 | `boundary-and-diff` `state-the-cost` `find-the-breaking-case` `counterexample` `carriers` `six-phases` `bet-first` `compress-by-decision` |
| 4 | multi-agent | 19 | `delegate-analysis-only` `report-is-testimony` |

19 条原文（英文，因为协议以英文写、被测模型对英文指令服从度更高）：

**tier 1 — 文风约束**
- `answer-first` — Lead with the answer or the action; the reason follows.
- `no-padding` — Cut sentences that carry nothing: restating the question, filler transitions, closing offers.
- `name-uncertainty` — Name the step you are unsure about instead of hedging.

**tier 2 — 做事顺序**
- `read-first` — Read the file, run the read-only command, open the log before you change anything.
- `one-verifiable-step` — One verifiable change at a time; verify it, then continue.
- `reproduce-before-attributing` — Reproduce a failure before explaining it; a fix for an unreproduced failure is a guess.
- `quantify` — Count what can be counted: line numbers, byte sizes, timings, exit codes.
- `claim-channel` — Tag load-bearing claims observed / derived / assumed / guessed. Assumed or guessed may not carry the answer.
- `state-the-falsifier` — Say what you would see if a load-bearing claim were false; look when looking is cheap.

**tier 3 — 硬问题的推导流程**
- `boundary-and-diff` — Fix the boundary before editing — inputs, outputs, error paths, callers — then deliver the smallest reviewable diff.
- `state-the-cost` — State the cost — time, quota, irreversible effects — and let the user decide; before a destructive action, what it destroys and how to undo it.
- `find-the-breaking-case` — Find the input that breaks the answer and fix it. A disclaimer moves that work back to the reader, so repair the claim or mark it broken; "there may be edge cases" counts as neither.
- `counterexample` — Construct the input that would falsify the conclusion and run it, and derive the same result a second way; their disagreement is where the error is.
- `carriers` — Every step names its carrier — file, field, command, line — and a step with no carrier is a step you skipped.
- `six-phases` — Hard case: constitute the problem, derive it two ways, derive from primitives, press it with counterfactuals, scale what is left unknown (high/medium/low, with the reason), then argue it holds.
- `bet-first` — Bet shape, magnitude and direction before deriving; a mismatch is the signal, so never delete the bet.
- `compress-by-decision` — Summarize by decision and cost, not by topic visited.

**tier 4 — 委派边界**
- `delegate-analysis-only` — Delegate analysis and retrieval; code, edits and decisions stay with you.
- `report-is-testimony` — A delegate report is testimony, not fact; mark a truncated one incomplete.

**off 档为什么真是 0**：`renderProtocol(0)` 返回 `''`。宿主的 `renderContextSections` 有 `filter(text.length > 0)`，`joinContextSections` 再因 `body.length === 0` 返回空串，所以模型侧连 `Current runtime context. This snapshot supersedes…` 这层外壳都收不到。档位仍注册为 `required`（缺一个 required 上下文是缺陷，空一个是正常状态），`status`、按钮、`/dopt2027 levels` 都从插件状态读档位，不依赖注入文本。`test/tier-cost.mjs` 直接调宿主自己的 `renderContextSnapshot()` 把这件事钉住。

---

## token 账单：每轮到底多付多少

| 档 | 协议文本 | 工具定义 | **每轮合计** |
|---|---|---|---|
| 0 off | 0 字符 ≈ 0 tok | 不发 | **0 tok** |
| 1 light | 252 字符 ≈ 63 tok | 1100 tok | **≈ 1163 tok** |
| 2 standard | 767 字符 ≈ 192 tok | 1100 tok | **≈ 1292 tok** |
| 3 deep | 1833 字符 ≈ 459 tok | 1100 tok | **≈ 1559 tok** |
| 4 multi-agent | 1993 字符 ≈ 499 tok | 1100 tok | **≈ 1599 tok** |

五个工具的实测（按宿主真正发出去的 `{name, description, input_schema}` 序列化形状量）：

| 工具 | 字符 | ≈ tok |
|---|---|---|
| `shell2027` | 644 | 161 |
| `shell_reset` | 240 | 60 |
| `tool2027` | 1039 | 260 |
| `claim` | 1112 | 278 |
| `analyst_brief` | 1365 | 342 |
| **合计** | **4400** | **1100** |

读法：工具定义那 1100 tok **每个请求都在付**，用不用都一样；协议文字才是档位可调的那一半。面板和 `/dopt2027 levels` 都显示合计而不只显示协议，因为只报协议会把真实账单少报一个数量级。

数字由 `protocolCost()` 从**真正渲染出来的文本**和**真正注册的工具定义**算出——改规则或改工具描述会立刻改数字，没有第二处手抄的表。token 数用 `ceil(字符 / 4)` 估算：实测这批文本全 ASCII、折算落在 4 字符/token 上，但真 tokenizer 属于模型，所以标签写 `tok` 而不假装精确（交错估算显示 `/4` 是下界，真值可能高 10–30%）。

**想把 1100 tok 降下来**：`shellEnabled: false` 省 221 tok（`shell2027` + `shell_reset` 不注册）；低频工具可以整块删，代价是对应能力消失。**「需要时才由 AI 自己调用」在本机做不到**——宿主有一等公民的 `deferLoading` 机制，但它要求模型侧支持对话中途增删工具（`toolUpdate`），本机 `workbuddy` 路由不声明该能力，`dsh-llm` 会把 `deferLoading` 标记剥掉后全量发送；更糟的是 `dsh-llm-pi-ai` 的 `toolsOf()` 会把带标记却未被抬起的工具**直接丢弃**，等于能力消失。

---

## 档位活过重启

档位按 agent（即会话）记。显式设过的档位写进 `<DSH_HOME>/plugin-data/dsh-optimization-2027/levels/level-<会话>.json`（临时文件 + `renameSync` 原子写），重启后按文件恢复。

两条边界是刻意的：

- **只有显式设置才写盘。** 从没切过档的会话不留记录、继续吃 `config.level`，所以「新会话默认 off」不会因为老会话用过高档而被破坏。
- **读不出来按「没有记录」处理**，回落到默认值而不是钉死 0。坏 JSON、权限错误、字段类型不对，都走这条路——读不出你的选择，就不该替你做一个。

值超出 0–4 会被钳到最近的档（负数→0，5 以上→4）。`clampLevel` 对**读不出来的值**（`undefined`、`NaN`、`"abc"`）同样回落 0：一个解析不出的档位不能凭空施加规则，off 是唯一不施加任何东西的值。

---

## 结论台账

`claim` 一个工具三个动作，取代了原来三个工具（`claim_add` / `claim_settle` / `claim_audit`）——三个工具的定义在 wire 上占 373 tok，合成一个带 `action` 参数的定义后是 278 tok，省 95 tok 而能力不减。

```
claim { action: "add", text: "shell 子进程在 dispose 时会被 taskkill /T 全部杀掉", channel: "observed",
        loadBearing: true, evidence: "实测 pid 12788 → cmd 7688 → timeout 9856，只有父进程死" }
claim { action: "settle", id: "c3", holds: false, result: "复测发现 /T 生效，此前测错" }
claim { action: "audit" }
```

**唯一被强制执行的那条规则**：`channel` 只接受 `observed` / `derived` / `assumed` / `guessed`；一条 `loadBearing: true` 的结论如果既没有 `evidence` 也没有 `check`，`add()` 直接抛错——它是伪装成结论的猜测，而猜测不能承载答案。

**被证伪的结论保留不删**，标 `[FALSIFIED]`。台账是 append-only 的 JSONL，`<DSH_HOME>/plugin-data/dsh-optimization-2027/ledger/ledger-<会话>.jsonl`，跨压缩、跨重启、逐版本可见。

`audit()` 把计数分开报：`unverified`（承重但没核对）与 `unsupported`（承重且无凭据）是两件事，混成一个数字会掩盖前者。`clean` 要求 `unverified === 0 && unsupported === 0 && falsified === 0`。

**它不阻断任何东西**：`clean` 只被 `renderAudit` 读过，插件里没有任何门禁。定位是自我报告 + 事后可查，强制执行的只有 `add()` 那一处抛错。

---

## 声明式自建工具

模型用 `tool2027` 声明一个工具：名称、描述、参数 schema、PowerShell 命令模板。写进 `<tools>/<name>.json`（机器读）+ `<name>.md`（人读，也是模型自己的备忘），**声明后免重启即可调用**。

`tool2027` 四个动作：`save`（声明，免重启立刻可调）、`list`（列出已声明的 + 各自文档路径）、`show`（看模板原文）、`remove`（删掉，下一轮提示词里就不再出现）。

```json
{
  "name": "disk_free",
  "description": "报告某个磁盘的剩余空间",
  "parameters": { "type": "object", "properties": { "drive": { "type": "string" } }, "required": ["drive"] },
  "command": "Get-PSDrive {{drive}} | Select-Object -ExpandProperty Free"
}
```

**为什么不用「模型写 JS」**：把模型生成的代码加载进 Host 进程是用户没同意过的提权——模型的代码拿到了插件的全部权限，而且一个语法错误拖垮整个插件。声明式模板则是：占位符的值作为 PowerShell 单引号字面量插入（内部引号翻倍），所以参数无法注入 shell 操作符；缺占位符直接报错而不是填空串（空值会把一个过滤器变成通配符）。

实测：传 `a'; Write-Output 'PWNED'; $(1+1)` 给模板 `Write-Output ('probe:' + {{word}})`，输出是原样的 `probe:a'; Write-Output 'PWNED'; $(1+1)`——没被执行。

提示词里只放**索引**（名字 + 摘要 + md 绝对路径），不放全文：说明会无限增长，全塞进提示词会挤占真正的任务空间。单条索引约 275 字符 ≈ 69 tok。

保留名不能占用：`bash` `pwsh` `run_code` `read` `write` `edit` `glob` `grep` `skill` `subagent` `workflow` `present` `ask_user_question` `todo_write` `web_search` `web_fetch` `shell2027` `shell_reset` `tool2027` `claim` `analyst_brief`——占用会让一个已有调用的含义静默改变。

---

## 持久 PowerShell

`ctx.shell` 一次调用一个进程，所以 `cd`、`$env:X = ...` 和任何后台启动的东西下次全丢。那是 shell 工作里最大的浪费来源：每次调用都得先把上下文重建一遍。

`shell2027` 给每个 agent 一个长期存活的 PowerShell，cwd、环境变量和进程跨调用保持。实测同一 pid 连续多次调用，`Set-Location` 与 `$env:` 都存活。

- **平台**：优先 `pwsh`（PowerShell 7），只有 Windows PowerShell 5.1 时也能跑
- **超时**：默认 60s（`shellTimeoutMs`）。超时后先 `taskkill /pid <pid> /T /F` 杀整棵进程树再 `kill`——实测孙进程（pwsh → cmd → timeout）会变成孤儿
- **回收**：空闲 15 分钟（`shellIdleMs`）关闭；`agent/disposed` 时立刻关（空闲计时器答的是「没人用」，disposed 答的才是「没人拥有」）；`shell_reset` 手动丢弃
- **输出**：保留最后 4000 行与最后 200,000 字符（`MAX_CAPTURED_LINES` / `MAX_CAPTURED_CHARS`），更早的内容丢弃并标记 `truncated`

**编码是这里最容易错的一处**：`-Command -` 的 stdin 按 ANSI 代码页解码，stdout 却按子进程自己选的编码写。两头都得治——body 走 base64 自解码，开头显式 `[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false`。不治的话，`D:\工作区` 会变成一个 38 字符的另一个字符串（`Test-Path` 返回 `False`，而中文回显看起来还是对的）。

---

## 提示词重注入

长 turn 之后模型会漂移——runtime context 离请求尾部越来越远。`/dopt2027 rearm` 重新装配当前 runtime context 并作为一条消息投递。

三个设计点：

- **只发 runtime context，不发全量装配。** 第一版把 `assemble()` 的 24 段全塞进消息，实测 177,508 字符 ≈ 44,377 tok，其中 22,762 tok 是永不变的基础提示词、20,624 tok 是 84 个工具的完整 JSON Schema。现在 tier 4 下 1,993 字符 ≈ 499 tok。
- **作废旧快照。** 旧快照留在 transcript 里会被模型当成第二份有效上下文。`session.append('user/message', …, {surfaceOp:{op:'replace', startSeq, endSeq}, sourceEventSeqs:[seq]})` 把旧快照换成一行注释。逐条替换而不是一个区间——区间替换会吞掉区间内所有 surface 节点。实测两份过期快照合计 353,155 字符 ≈ 88,289 tok。
- **body 相同就短路。** 重复按同一个 rearm 不会再写消息。

自动那一半挂在 `agent/pre-step` 上，**不管阈值是不是 0 都挂着**——阈值是每个会话自己的设置，只在配置里是正数时才存在的钩子永远没法在不重启的情况下被打开。handler 里先读本会话的阈值，0 就直接放行。

阈值默认关闭（0），面板里那一行「自动重发阈值」或 `/dopt2027 rearm <n>` 都能改，改完下一次请求就按新值走，不用重启。

---

## 只读分析员

`analyst_brief` 不启动任何东西。它做两件事：把问题写成一份带硬限制的简报，或把子智能体回来的报告框成证词。

```
1. analyst_brief { question: "shell 子进程在 dispose 时是否真被全部杀掉", workspace: "lib/shell.js" }   → 拿到简报文本
2. subagent { description: "查 shell 回收", prompt: <简报原文> }                                  → 拿到子智能体报告
3. analyst_brief { question: <同上>, report: <报告原文>, stopReason: "max-tokens" }                 → 报告被框成「证词，不是事实」
```

三道约束：

- **简报不能要求改状态。** 分类器分两档。硬档（`git push`、`npm install`、`chmod`、`can you fix…`、`帮我改…`）命中即拒，问句也不例外；软档（`run tests` 这类只有命令式才成立的动词）在问句里放行，所以 `Does the test runner run tests in parallel?` 不会被误挡。判的是整份简报（question + context + workspace），不是只看 question。
- **简报不携带你的假设。** `analystPrompt` 的签名里根本没有 hypothesis 参数，所以它不可能漏进去——分析员被告知预期答案，就一定会找到它，无论真假。
- **报告不当结论用。** `frameReport` 第一行是「testimony, not fact」；`stopReason` 为 `max-tokens` / `length` 时再加一条「Incomplete」。

---

## 输入框按钮面板

输入框右侧工具行多一个按钮（`conversation.input.right`，order 30，夹在 `dsh-purge-rewind 20` 和 `vision-router-mode-toggle 40` 之间）。

- **按钮上只写当前档位名**——`关` / `轻` / `标准` / `深` / `多智能体`，不写插件名也不写 `T2` 这类内部编号：它改的是一个设置，读起来就该是一个设置。挂载时读一次宿主状态，之后每 10 秒轮询 + 页面重新可见时再读一次，因为档位可能被聊天里的 `/dopt2027 level 3` 改掉。
- **点开基本是按钮，唯一的输入框只收数字**——`/dopt2027` 的每个子命令都有对应按钮；只有自动重发阈值这一个值没有固定的候选集，所以它有一个框，且 `inputMode: numeric` + 输入时过滤非数字，提交走的是和 `/dopt2027 rearm <n>` 完全同一个动词。放一个能打字命令的自由文本框才是让面板变成第二套无人校验的接口，这一版没有那样做。
- **五个档位 chip** 等分一行，当前档位用原生「选中态」样式（`--dsw-alias-button-ghost-active-fill` + 内嵌 1px 描边）并带 `aria-pressed`；悬停给出该档实际加什么。按钮数量由宿主返回的 `minLevel`/`maxLevel` 决定，从 4 档到 0 档是一次点击。
- **chip 正下方一行 token 数字**，与 chip 用同一个列宽等分，所以每个数字正对它那一档。当前档那个数字是亮的（`--dsw-alias-label-primary` 600 + 同一套选中态），其余是 `--dsw-alias-label-caption` 500 + `tabular-nums`（竖向对齐）。五个数字里只有一个是你此刻在付的，让它自己说出来比让眼睛去比对哪颗 chip 是按下的省一步。
- **四个动词按钮**（`档位表` `自建工具` / `结论台账` `重发提示词`）两行两列。每个都带悬停说明（`title` 与 `aria-label` 都写，键盘与读屏用户同样拿得到）。
- **动词按钮下面一行是「自动重发阈值」字段**：左边是普通文字标签，右边紧跟一个 52px 的窄输入框，只有数字有框——框住整行会让一行字看起来像一个输入框的内容。它是面板里唯一一个「改一个数」而不是「按一个动词」的控件，所以在 blur 或 Enter 时提交、不按键提交——三位数按一次键就发三次请求是把一个字段做成三份状态。留空等于 0 等于 off，同一种意思三种写法都认；填回宿主已经报过的数不发请求。提交后字段立刻退回宿主的数，屏幕上永远不是宿主没确认过的数字。悬停说明挂在「自动重发阈值」这几个字上（不是挂在数字框上），但正文里不再重复这个词：`距上一份宿主上下文隔了几条消息就补发一份（工作目录、策略、审批等），工具调用也算。留空或 0 为关`。不出现 runtime context 这个词——那是实现里的名字，面板里没人定义过它。自建工具与重发提示词两条说明同样全中文，没有 `profile`、`PowerShell`、`transcript` 这类只在代码里出现的词。长的几条按语义断成多行，因为 tooltip 是一个窄框，一整行 60 字会被屏幕边缘裁掉。宽度按**显示列**算而不是字符数——一个汉字占两列，38 个汉字就是 76 列，照样被裁——所以每条断行后的每一行都不超过 40 列，`test/client.mjs` 按列宽断言而不是按 `length` 断言。
- **两个只读面板**：`当前状态`（固定 80px，`status` 那四行）与 `上一次操作`（固定 96px）。高度是常量不是状态，`box-sizing:border-box` 所以高度含内边距；内容超出时鼠标滚轮在框内翻（`overscroll-behavior:contain`），滚到底事件还给后面的对话。没有滑块——上一版给每块配一根高度滑块，等于让人在读之前先设一次尺寸。
- **面板标题是 `推理优化`**，不是包名：它回答的是「我打开它要改什么」而不是「这里面有什么」。包名在触发器的 `title` 与 `role="dialog"` 的 `aria-label` 里，所以悬停或读屏仍能确认是哪个插件。

**外观抄的是宿主自己的控件**：触发器与档位 chip 用 composer 那一排 chip 的规格（28px 高、`--dsw-radius-sm`、无边框、`--dsw-alias-label-secondary` 13px、悬停 `--dsw-alias-interactive-bg-hover`、焦点环 `--dsw-focus-ring-width`/`--dsw-focus-ring-color`）；面板用宿主菜单规格（`--dsw-radius-lg`、`--dsw-specific-menu`、`--dsw-menu-backdrop-filter` 毛玻璃、`--dsw-elevation-prominent` 阴影）。这些是 `:hover`/`:focus-visible` 规则，内联样式表达不了，所以按宿主插件同样的做法在 `document.head` 里挂一张 `style[data-plugin-css="dsh-optimization-2027"]`，重放 `apply` 时按标签判重、不会叠第二张。`test/client.mjs` 钉住一条：所有 `var()` 引用的自定义属性必须以 `--dsw-` 开头。

---

## HTTP 路由

`POST /dsh-optimization-2027/api`，body 是 `{"action":"state"}` 或 `{"action":"invoke","input":"level 3"}`。

客户端半部跑在 renderer 里，调不到 Host service，这条路由是按钮回到本进程的唯一通道。按钮与手打命令都走同一个 `surface.invoke`，所以两条路不会各长出一套状态。

三处拒绝是有意的：**非 loopback → 403**、**非 POST → 405**、**body 不是 JSON → 400**，绝不猜默认值。`isLoopback` 查三样：socket 本地地址、`Host` 头、以及存在时的 `Origin`。

`state` 只回客户端真读的字段（`level` / `levelTitle` / `minLevel` / `maxLevel` / `cost` / `costs`）加一行 `status` 摘要。台账全文不随 `state` 发——面板挂载读一次、之后每 10 秒读一次，那 1883 字符一个字节都没被用过。

---

## 安装

从仓库克隆后安装到当前 profile：

```powershell
git clone https://github.com/shiliuyu316/dsh-optimization-2027
plugin_manager install_bundle ".\dsh-optimization-2027"
```

或者从任意本地目录安装：

```powershell
plugin_manager install_bundle "D:\path\to\dsh-optimization-2027"
```

或者把它加进 profile 的 `package.json`：

```json
{
  "dependencies": { "dsh-optimization-2027": "link:D:/path/to/dsh-optimization-2027" },
  "dsh": { "profile": { "bundles": ["dsh-optimization-2027"] } }
}
```

然后重启 DSH。**客户端半侧必须重启才出现**：`dsh-client-modules` 把「这个包不是客户端包」的否定判论按 Loader specifier 缓存到进程结束，装包时那次 boot 已经缓存过了。

装完想要中文界面不用额外配置——`client.js` 按 `document.documentElement.lang` 与 `navigator.language` 自动选语言，`locale/zh.json` 与 `locale/en.json` 给宿主插件列表用的名字与描述。

---

## 命令

```
/dopt2027                     状态（四行：档位 / 工具目录 / shell 进程 / 台账计数）
/dopt2027 level <0-4>         设置本次会话的推理档位（0 = 关掉协议）
/dopt2027 levels              五档各加了什么、各值多少字符和 tok
/dopt2027 tools               列出已声明的自建工具
/dopt2027 ledger              审计结论台账
/dopt2027 rearm               重发当前 runtime context，并把旧快照换成一行注释
/dopt2027 rearm <n> | off     设置自动重发阈值（0 与 off 同义）
```

命令名必须是 `dopt2027`：宿主的校验是 `/^[a-z][a-z0-9_-]*$/u`，数字开头（如 `2027`）会在 `register()` 里抛 `TypeError`。

---

## 配置

`cordis.patch.yml` 里的 `config`：

| 键 | 默认 | 说明 |
|---|---|---|
| `level` | `0` | 初始推理档位，0–4。新会话没有记录时回落到这个值，所以默认是 off |
| `customToolsDir` | `''` | 空则用 `<DSH_HOME>/plugin-data/dsh-optimization-2027/tools` |
| `shellEnabled` | `true` | 关掉则 `shell2027` / `shell_reset` 不注册（省 221 tok） |
| `shellTimeoutMs` | `60000` | 单次脚本超时，超时杀整棵进程树 |
| `shellIdleMs` | `900000` | 空闲多久回收会话 |
| `rearmDistance` | `0` | 新会话的自动重发阈值：距最后一份 runtime context 已过多少条消息就重发。0 = 关闭。每个会话自己的值存在 `rearm/` 下，面板与 `/dopt2027 rearm <n>` 都能改 |

未知键会被丢弃且不报错，所以老配置里留着已删除的键（例如上游的 `maxTokensCeiling`）不影响启动。

---

## 数据落在哪

```
<DSH_HOME>/plugin-data/dsh-optimization-2027/
  tools/<name>.json            自建工具声明（机器读）
  tools/<name>.md              自建工具文档（人读 + 模型读）
  ledger/ledger-<会话>.jsonl     结论台账，append-only
  levels/level-<会话>.json       显式设过的推理档位，重启后恢复
rearm/rearm-<会话>.json       自动重发阈值，0 也是记录（面板留空与填 0 落盘一致）
```

**这些文件是用户的，不是插件的**——`.gitignore` 里挡掉了 `plugin-data/` 与 `.dsh/`，提交或发布前不要带上别人的台账与档位。

---

## 测试

五套，全是断言式，失败以非零退出码结束。共 376 条：

```powershell
# 纯逻辑：协议渲染、台账拒绝规则、占位符转义、简报分类、成本计算
$env:ELECTRON_RUN_AS_NODE='1'; & 'D:\DSH\DeepSeek Harness.exe' test\smoke.mjs      # 67

# 真起 PowerShell，验 cwd / env / 非 ASCII 真的跨调用保持
$env:ELECTRON_RUN_AS_NODE='1'; & 'D:\DSH\DeepSeek Harness.exe' test\shell-live.mjs  # 18

# 用 stub context 跑一遍 apply()：Config 协议、两处 context、五个工具、全部子命令、
# HTTP 路由的六种拒绝、按会话选 agent、tier 0 摘工具、rearm 的作废与漂移自动重发
$env:ELECTRON_RUN_AS_NODE='1'; & 'D:\DSH\DeepSeek Harness.exe' test\mount.mjs       # 161

# 用 stub loader + stub React 跑一遍 client.js：模块 id、slot 注册形状、样式判重、
# 滚轮行为、成本高亮、面板结构
$env:ELECTRON_RUN_AS_NODE='1'; & 'D:\DSH\DeepSeek Harness.exe' test\client.mjs      # 121

# 拿宿主自己的 dsh-system-prompt 渲染器算边际成本：0 档必须精确加 0 字符
$env:ELECTRON_RUN_AS_NODE='1'; & 'D:\DSH\DeepSeek Harness.exe' test\tier-cost.mjs   # 9
```

`ENGINES` 里声明了 `node >= 20`、`dsh >= 0.2.0-rc.1`。本机没有 `node` on PATH，所以用 harness 自带的 Electron 以 `ELECTRON_RUN_AS_NODE=1` 跑；有 node 时直接 `node test/smoke.mjs` 即可。

`test/tier-cost.mjs` 会去 `D:/DSH/resources/app`、`app.asar`、`app.asar.unpacked` 三处找宿主自己的 `dsh-system-prompt` 模块——它测的是「宿主渲染器眼里 0 档加了多少字符」，不是插件自己的字符串长度。找不到宿主时它会以退出码 1 明确失败，而不是静默跳过。

---

## 代码来源与授权

本包是 [husongan/dsh-deepseek-2027](https://github.com/husongan/dsh-deepseek-2027) v1.0.8（commit `88136b41`，MIT，`Copyright (c) 2026 husongan`）的**衍生作品**。原项目 MIT 授权，本包沿用同一授权并在 `LICENSE` 里保留原始版权行。

### 保留并重写的机制

| 机制 | 上游位置 | 本包位置 | 改了什么 |
|---|---|---|---|
| 分档推理协议 | `levels.js`（12 级、`slot` 映射 effort、`intensity` 控制输出预算） | `lib/levels.js` | 12 级压成 5 档；**删掉 `slot` → `reasoningEffort` 的映射**；删掉 `intensity`（输出预算）；19 条规则重写并去掉每条后面那句解释 |
| 结论台账 | `enhance.js`（`CHANNELS = ['observed','derived','assumed','guessed']`、`WEAK_CHANNELS`、承重结论要凭据） | `lib/ledger.js` | 保留同一套渠道词汇与承重门槛；加上 append-only JSONL 落盘、`settle`、`audit` 分项计数，并工具化成 `claim` |
| 声明式自建工具 | `custom-tools.js`（`{{placeholder}}` + 单引号字面量 + 缺占位符拒绝 + `.json`/`.md` 双文件 + 提示词只放索引） | `lib/custom-tools.js` | 占位符协议与 `psLiteral()` 实现**逐字符相同**（`'${String(value).replace(/'/g, "''")}'`，本包叫 `psQuote`）；只保留 PowerShell 后端；入口从 `dev_tool` 改为 `tool2027` |
| 只读分析员 | `delegation.js`（`MUTATION_PATTERNS` + `classifyBrief` + 报告框成 testimony） | `lib/analyst.js` | 分类器从一档改成两档（hard / soft）加问句放行；保留「报告是证词」的框法与 `Incomplete` 标记 |
| 提示词重注入 | `index.js` 的 `/deepseek2027`（重跑 `systemPrompt.assemble()` 全量投递） | `index.js` 的 `rearm` | 不再发全量装配，只发 runtime context（1,993 字符 vs 177,508）；新增作废旧快照、body 相同短路、`rearmDistance` 自动重发 |

上游 `levels.js` 的这条结论被完整继承，写在本包 `lib/levels.js` 的文件头里：**「给高档加 review rounds、重新进入 turn 审自己草稿」已删除——重跑 turn 让模型重读自己的输出只产生严谨的外观，不增加信息。**真正的差别在答案写出**之前**的推理形状。

### 本包新增（上游没有）

- **`off` 档（level 0）**：真零成本关掉协议。上游最低是 L1，且 L1 仍占用 effort 槽位。
- **档位写盘跨重启**（`lib/level-store.js`）：上游档位只活在进程内存里。
- **持久本地 PowerShell 池**（`lib/shell.js`）：上游只有 `ssh.js` 的远程 SSH 空闲计时器，本地 shell 是一次一进程。
- **HTTP 路由 + 输入框按钮面板**：上游的客户端 UI 是档位滑块 + 重注入按钮，没有任何 HTTP 路由（全部 JS 里 `webServer`/`registerRoute` 零命中）；本包的按钮面板靠一条 loopback-only 的 POST 路由回到 Host。
- **token 成本计价**（`protocolCost` / `costTable` / 面板数字 / `/dopt2027 levels` 的字符与 tok 列）：上游没有任何成本显示。
- **`claim` 三合一**：上游三个台账动作是三个工具。
- **tier 0 在 `system-prompt/assemble` 里摘掉本插件自己的工具**：上游没有这个钩子。
- **`-Command -` 双向编码修复**（base64 body + 显式 `Console::OutputEncoding`）：上游的 `psLiteral` 只管模板取值，不管 stdin/stdout 编码。
- **五套测试（376 条断言）**：上游有 `_test/{fake-ssh,integration-test,schema-check}.mjs` 三份，本包全部重写。

### 有意没带过来的（上游有）

| 上游能力 | 为什么不带 |
|---|---|
| 12 级思考 + `effortFor()` 映射 | `efforts[round(slot*(efforts.length-1))]` 在只有 `[low,high,max]` 三个 effort 的模型上把 12 级塌成 3 档（L1=L2=low、L3=L4=L5=high、L6–L12=max）。本包档位只决定协议文本，不碰 `reasoningEffort` |
| `maxTokens` 因子 | 上游默认 ceiling 65536，比本机路由的 128000 还小，开了等于砍预算；改成 `max(ceiling, base)` 之后又变成「唯一能生效的配置就是向声明 128000 的模型要 192000」。全局绝对值这个形状本身不对——本机 50 个模型的 `maxTokens` 分布在 32000–131072 五档 |
| 旧 1–12 等级兼容层 | 留着等于同一个配置键有两套刻度，`level: 7` 指第 7 档还是旧第 7 级要靠猜 |
| `dev_admin`（任意命令的管理员执行） | 权限远超「让模型把活干完」 |
| `dev_desktop`（鼠标、键盘、窗口、截图） | 同上 |
| `dev_ssh` + `servers.js` / `targets.js`（持久 SSH、远程服务器注册表） | 同上；本包只做本机 |
| `dev_persona` + `persona.js`（人格写入 required 上下文，3000 token 上限） | 人格是另一个方向的产品；以 required 上下文常驻等于每个请求都在付 |
| `dev_image` / `images.js` / `chart.js`（图片展示、SVG 栅格化、图表） | 与本包五个机制无关，且需要额外依赖 |
| `dev_agent` / `dev_team` / `agents.js`（L12 分析员定义与派活） | profile 里已经有 `subagent` / `subagent_fork` / `workflow`；本包只提供简报，不新建第二套委派机制 |
| `developer.js`（93 KB 开发者预设与操作手册） | 预设是另一层的东西，不是插件 |
| `dev-exec.ps1` / `dev-desktop.ps1` | 上面两个工具的实现，工具不带，脚本也不带 |

### 如果你想核对

```powershell
git clone https://github.com/husongan/dsh-deepseek-2027
cd dsh-deepseek-2027
git log -1 --format=%H   # 88136b41c77c5310bab04c99595a1498aede2 附近
```

对照表里的每一行都能在两份源码里找到对应的函数：`psLiteral` / `psQuote`、`CHANNELS`、`MUTATION_PATTERNS` / `classifyBrief`、`frameReport`。

---

## 兼容性与已知限制

- **DSH 版本**：`>= 0.2.0-rc.1`。用到 `ctx.systemPrompt.context`、`ctx.on('system-prompt/assemble')`、`ctx.on('agent/pre-step')`、`ctx.on('agent/disposed')`、`webServer.register`、`commands.register`、`tools.register`。
- **Windows 优先**：持久 PowerShell 在 Windows 上验得最全（`taskkill /T /F` 杀进程树是 Windows 专属路径）。Linux/macOS 上 `pwsh` 存在时应该能跑，但进程树回收走的是另一条分支，未在本项目里验证。
- **Chromium 系浏览器**：客户端面板用的是 composer 那一排 chip 的原生 token。宿主主题的 403 个 `--dsw-*` 变量缺失时全部退回兜底色，面板仍可用但外观不像原生。
- **`deferLoading` 不可用**：见 [token 账单](#token-账单每轮到底多付多少)。本机路由不声明 `toolUpdate` 能力，所以工具定义必须每请求全量发送，这是 1100 tok 的来源。
- **不改模型参数**：本包从不设置 `reasoningEffort` / `temperature` / `maxTokens`；它只注入文本。想让模型真正「想得更久」，要改的是 profile 里的模型选择，不是这个插件。
- **`unsupported` 计数在正常路径上恒为 0**：`add()` 的抛错已经把「承重无凭据」挡在门外，那个分支是给手改或外部写入 JSONL 的兜底。

---

## 踩过的坑

装到别的 profile 时会再遇到这六个：

- **`Config` 必须带 `'~standard'.validate`。** 宿主在 `apply()` 之前读它；普通对象会让条目停在 `fiberPhase: "failed"`，报 `Cannot read properties of undefined (reading 'validate')`，而且没有自己的日志行。Schemastery 会自带这个协议，但它在 profile-linked 插件里裸 import 不了，所以这里手写。
- **`-Command -` 必须收到空行才执行。** Windows PowerShell 5.1 上，`& { ... }` 后面少一个空行就是四秒零输出且不退出。`lib/shell.js` 里那个收尾空行是协议的一部分，不是格式。
- **客户端半侧要重启才出现。** `dsh-client-modules` 把「这个包不是客户端包」的否定判论按 Loader specifier 缓存到进程结束；关/开插件不清这个缓存。
- **命令名必须过 `/^[a-z][a-z0-9_-]*$/`。** 数字开头（如 `2027`）会在 `register()` 里抛 `TypeError`——所以命令叫 `dopt2027`。
- **`-Command -` 的 stdin/stdout 不是同一个编码。** 子进程按 ANSI 代码页解码 stdin，却按它自己选定的编码写 stdout：直接灌 UTF-8 明文进去，`D:\工作区` 会变成另一个 38 字符的字符串（`Test-Path` 返回 `False`，而输出里的中文看起来是对的）；改成 base64 后 stdin 对了，stdout 又开始吐 `���`。两头都得治。`test/shell-live.mjs` 里那三条非 ASCII 断言就是为此存在的。
- **`tools.restrict()` 只能限制继承层。** 它要求 scoped ctx（`agent.ctx`），而且同一个 fiber 自己注册的工具不受它约束。想在低档「不注册」自己的工具，正确的位置是 `system-prompt/assemble` waterfall——它跑在 `buildRequest` 建 header 之前，所以第一次请求就是干净的。

---

## License

MIT。原始作品 `Copyright (c) 2026 husongan`（[husongan/dsh-deepseek-2027](https://github.com/husongan/dsh-deepseek-2027)），本衍生作品 `Copyright (c) 2026 shiliuyu316`（[shiliuyu316/dsh-optimization-2027](https://github.com/shiliuyu316/dsh-optimization-2027)）。完整文本见 [LICENSE](LICENSE)。
