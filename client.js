/**
 * dsh-optimization-2027 — Client half.
 *
 * This file is not ESM and has no build step: the harness loads it with its own
 * module loader and hands it a `require` that resolves `react`. The shape below
 * is the documented one, and every installed UI plugin here is written the same
 * way.
 *
 * What this half does NOT do: it does not decide anything. Every press posts a
 * verb that `/dopt2027` also accepts and prints whatever the Host half answered.
 * A button that computed "the next level" itself would be a second authority
 * for the same state, and the two would disagree the first time one of them
 * changed — so the level shown here is always read back from the Host.
 */

window.__ModuleLoader__.load({
  id: 'dsh-optimization-2027', // ui-copy-ignore
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    // The app's document language wins, because that is what the surrounding
    // interface speaks; the browser's own order decides when the document has
    // not synced its `lang` yet.
    const detectZh = (documentLanguage, browserLanguage) => {
      const tag = typeof documentLanguage === 'string' ? documentLanguage : '';
      if (/^zh(-|$)/i.test(tag)) return true;
      if (tag !== '' && !/^en(-|$)/i.test(tag)) return false;
      const first = Array.isArray(browserLanguage) ? browserLanguage[0] : browserLanguage;
      return typeof first === 'string' && /^zh(-|$)/i.test(first);
    };
    const zh = detectZh(
      typeof document !== 'undefined' ? document?.documentElement?.lang : '',
      typeof navigator !== 'undefined' ? navigator.languages || navigator.language : '',
    );

    // Every verb `/dopt2027` accepts has a button below, so the panel needs no text
    // entry: a free-text box would let a person type a verb that has no button,
    // and then the panel would be a second, unchecked interface to the same
    // state. `tierNames` are the five chip labels — and the trigger's own text,
    // so the control reads as the setting it changes instead of as a product
    // name competing with the model trigger beside it. `tierHints` says what
    // each tier actually adds.
    const COPY = zh
      ? {
          label: '档位',
          name: 'dsh-optimization-2027',
          title: '推理优化',
          close: '收起',
          tier: '档位',
          tierNames: ['关', '轻', '标准', '深', '多智能体'],
          tierHints: [
            'off — 不注入任何规则，成本精确为 0',
            'light — 先给答案、删废话、点明不确定处',
            'standard — 先读再改、一次一验、标结论渠道',
            'deep — 造反例、报代价、每步点载体',
            'multi-agent — 只派分析不派改动，报告当证词',
          ],
          levels: '档位表',
          tools: '自建工具',
          ledger: '结论台账',
          rearm: '重发提示词',
          hintTier: '切换推理档位：档位越高注入的规则越多，\n每轮请求都付这份 token',
          hintCost: '每个档位每轮请求额外注入的估算 token\n（4 字符 ≈ 1 token）：协议文字加上\n本插件发的工具定义。0 档两者都不发',
          costUnit: 'tok',
          hintLevels: '列出 0–4 每个档位各激活几条规则、\n各值多少字符',
          hintTools: '看本配置里声明过哪些自建工具、\n声明文件放在哪个目录。自建工具是\n自己声明的命令行模板，存下就能用，\n不用重启',
          hintLedger: '看结论台账全文：每条结论的渠道、\n是否承重、是否已结案',
          hintRearm: '把宿主每轮附在提示词前的上下文\n立刻重发一次，并把对话里更早的\n同类快照换成一行注释',
          rearmField: '自动重发阈值',
          rearmOff: '关',
          hintRearmField: '距上一份宿主上下文隔了几条消息\n就补发一份（工作目录、策略、审批等），\n工具调用也算。留空或 0 为关',
          hintClose: '收起面板，不改变任何设置',
          status: '当前状态',
          hintStatus: '宿主现在报的四行：档位、自建工具\n目录、shell 进程、台账计数。\n与 /dopt2027 status 同源，每 10 秒刷新',
          result: '上一次操作',
          hintResult: '你刚按下的按钮返回了什么。\n这里只说明上次那一按，\n不代表当前状态',
          working: '读取中…',
          idle: '按上方按钮查看',
          unreachable: '宿主未响应',
        }
      : {
          label: 'tier',
          name: 'dsh-optimization-2027',
          title: 'reasoning tuning',
          close: 'close',
          tier: 'tier',
          tierNames: ['off', 'light', 'std', 'deep', 'multi'],
          tierHints: [
            'off — no rule injected, exactly 0 cost',
            'light — answer first, cut filler, name uncertainty',
            'standard — read before edit, one verifiable step, tag claims',
            'deep — counterexamples, state the cost, name every carrier',
            'multi-agent — delegate analysis only, a report is testimony',
          ],
          levels: 'tier table',
          tools: 'custom tools',
          ledger: 'claim ledger',
          rearm: 're-arm prompt',
          hintTier: 'change the reasoning tier: a higher tier\ninjects more rules, and every request\npays for them',
          hintCost: 'estimated tokens each tier adds to every\nrequest (4 chars ≈ 1 token): protocol\ntext plus the tool schemas this plugin\nsends; tier 0 sends neither',
          costUnit: 'tok',
          hintLevels: 'list how many rules each tier 0–4\nactivates, and what each costs in chars',
          hintTools: 'list the custom tools declared for this\nprofile and where their files live.\nA custom tool is a PowerShell command\ntemplate you declare yourself; it works\nat once, no restart',
          hintLedger: 'read the claim ledger in full: each\nclaim’s channel, whether it is\nload-bearing, whether it is settled',
          hintRearm: 're-send the block the Host attaches to\nevery prompt right now, and replace the\nolder copies in the transcript with a\none-line note',
          rearmField: 'auto re-arm',
          rearmOff: 'off',
          hintRearmField: 'once this many messages (tool calls\nincluded) have passed since the last\nHost context, one is re-sent (cwd,\npolicy, approvals). Blank or 0 is off',
          hintClose: 'close the panel without changing any\nsetting',
          status: 'current state',
          hintStatus: 'the four lines the host reports now:\ntier, custom-tool directory, shell\nprocess, ledger counts. Same source as\n/dopt2027 status, refreshed every 10 s',
          result: 'last action',
          hintResult: 'what the button you just pressed\nreturned. It describes that press only,\nnot the current state',
          working: 'reading…',
          idle: 'pick a button above',
          unreachable: 'host did not answer',
        };

    const ROUTE = '/dsh-optimization-2027/api'; // ui-copy-ignore

    /**
     * How often the collapsed button re-reads the tier. The tier can move
     * without this component (`/dopt2027 level 3` from the conversation), and a
     * button that names the tier has to name the one in force. One `state`
     * request returns a short string; a ten-second stale window is the cost.
     */
    const POLL_MS = 10000; // ui-copy-ignore

    /**
     * The two read-only panels are a fixed size. Nothing here is a height
     * control: the box is a fixed viewport and the mouse wheel scrolls its
     * content. The previous version put a slider under each caption, which made
     * "how much of this do I want on screen" a thing a person had to set before
     * reading — and on a four-line status block the slider did nothing at all,
     * so it read as broken.
     *
     * The heights are the two content shapes, not a taste. The rule sets
     * `box-sizing: border-box`, so these include the 8px padding on each side:
     * 80 = 4 × 16px line boxes + 16px padding plus slack, so the four status
     * lines fit with no scrollbar, and 96 is two lines taller so a single-line
     * answer is not cropped and a long ledger still has room to scroll.
     */
    const READ_STATUS_HEIGHT = 80; // ui-copy-ignore
    const READ_RESULT_HEIGHT = 96; // ui-copy-ignore

    /**
     * The chrome is the harness's own, not a hand-drawn look-alike.
     *
     * The trigger copies the shipped composer chips (`PlanChip`, the access-mode
     * trigger, the vision toggle): 28px tall, `--dsw-radius-sm`, no border,
     * `--dsw-alias-label-secondary` at 13px, `--dsw-alias-interactive-bg-hover`
     * on hover, the shipped focus ring, and the shipped "selected chip"
     * treatment (`--dsw-alias-button-ghost-active-fill` plus an inset 1px border)
     * while the panel is open. The panel copies the shipped menu surface: 16px
     * radius, `--dsw-specific-menu` fill, the menu backdrop filter, and
     * `--dsw-elevation-prominent`.
     *
     * These live in a `:hover`/`:focus-visible`-bearing stylesheet because inline
     * styles cannot express a pseudo-class. Every value is a `--dsw-*` token that
     * the theme plugin actually defines; the previous version used invented
     * `--dsh-*` names whose fallbacks were the only thing that ever rendered,
     * which is why it read as foreign next to the real controls.
     */
    const CSS =
      '.dopt2027-root{position:relative;min-width:0}' +
      '.dopt2027-trigger{display:inline-flex;align-items:center;gap:4px;min-width:0;height:28px;' +
      'padding:0 8px;border:none;border-radius:var(--dsw-radius-sm);background:transparent;' +
      'color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;font-weight:500;' +
      'line-height:20px;cursor:pointer;white-space:nowrap;user-select:none}' +
      '.dopt2027-trigger:hover:not(:disabled),.dopt2027-trigger[aria-expanded=true]{' +
      'background:var(--dsw-alias-interactive-bg-hover)}' +
      '.dopt2027-trigger[aria-expanded=true]{color:var(--dsw-alias-label-primary)}' +
      '.dopt2027-trigger:focus-visible{outline:var(--dsw-focus-ring-width) solid ' +
      'var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}' +
      '.dopt2027-trigger:disabled{cursor:default;color:var(--dsw-alias-label-dimmed)}' +
      '.dopt2027-trigger-label{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden}' +
      '.dopt2027-panel{position:absolute;bottom:calc(100% + 8px);right:0;z-index:1100;' +
      'box-sizing:border-box;display:flex;flex-direction:column;gap:8px;width:max-content;' +
      'min-width:min(300px,100vw - 24px);max-width:min(360px,86vw);padding:16px;border:0;' +
      'border-radius:var(--dsw-radius-lg);background:var(--dsw-specific-menu);' +
      'backdrop-filter:var(--dsw-menu-backdrop-filter);' +
      '--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);' +
      'box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-secondary);' +
      'font-size:12px;line-height:18px;text-align:left;cursor:default}' +
      '.dopt2027-title{display:flex;align-items:center;justify-content:space-between;gap:16px;' +
      'color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500;line-height:20px}' +
      '.dopt2027-rule{border-top:.5px solid var(--dsw-alias-border-l2)}' +
      '.dopt2027-caption{color:var(--dsw-alias-label-caption);font-size:11px;line-height:16px}' +
      '.dopt2027-row{display:flex;align-items:center;gap:4px}' +
      '.dopt2027-tier{flex:1 1 0;min-width:0;height:26px;padding:0 4px;border:none;' +
      'border-radius:var(--dsw-radius-sm);background:transparent;' +
      'color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;' +
      'text-align:center;cursor:pointer;overflow:hidden;text-overflow:ellipsis;' +
      'white-space:nowrap}' +
      '.dopt2027-tier:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}' +
      '.dopt2027-tier:focus-visible{outline:var(--dsw-focus-ring-width) solid ' +
      'var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}' +
      '.dopt2027-tier[aria-pressed=true]{color:var(--dsw-alias-label-primary);' +
      'background:var(--dsw-alias-button-ghost-active-fill);' +
      'box-shadow:inset 0 0 0 1px var(--dsw-alias-button-ghost-active-border)}' +
      '.dopt2027-tier[aria-pressed=true]:hover:not(:disabled){' +
      'background:var(--dsw-alias-button-ghost-active-hover)}' +
      '.dopt2027-tier:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}' +
      // The cost row sits under the chips rather than inside them: a chip holds
      // one word at 12px and the panel is 360px wide at most, so a second line
      // inside the chip would either clip or force the five chips to wrap. One
      // 10px number per column, sharing the chips' `flex:1 1 0`, keeps every
      // figure directly under the tier it belongs to with no extra width.
      '.dopt2027-cost-row{display:flex;align-items:center;gap:4px}' +
      // The figure is the point of the row, so it is not the faintest thing on
      // the panel: `label-caption` at weight 500 is readable at 10px without
      // becoming a second row of buttons, and tabular figures keep the five
      // numbers vertically aligned so a column can be compared at a glance.
      // The current tier's figure steps up to `label-primary` at weight 600 with
      // the same ghost-active fill the chip above it wears, so the number you
      // are paying right now is the one the eye lands on.
      '.dopt2027-cost{flex:1 1 0;min-width:0;text-align:center;color:var(--dsw-alias-label-caption);' +
      'border-radius:var(--dsw-radius-sm);font-size:10px;font-weight:500;line-height:14px;' +
      'font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.dopt2027-cost[data-active=true]{color:var(--dsw-alias-label-primary);font-weight:600;' +
      'background:var(--dsw-alias-button-ghost-active-fill);' +
      'box-shadow:inset 0 0 0 1px var(--dsw-alias-button-ghost-active-border)}' +
      '.dopt2027-grid{display:grid;grid-template-columns:1fr 1fr;gap:4px}' +
      '.dopt2027-cell{box-sizing:border-box;min-width:0;height:30px;padding:0 8px;border:none;' +
      'border-radius:var(--dsw-radius-md);background:transparent;' +
      'color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;' +
      'text-align:left;cursor:pointer;overflow:hidden;text-overflow:ellipsis;' +
      'white-space:nowrap}' +
      '.dopt2027-cell:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}' +
      '.dopt2027-cell:focus-visible{outline:var(--dsw-focus-ring-width) solid ' +
      'var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-2px}' +
      '.dopt2027-cell:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}' +
      '.dopt2027-close{height:24px;padding:0 6px;font-size:12px;color:var(--dsw-alias-label-tertiary)}' +
      '.dopt2027-status{display:flex;flex-direction:column;gap:2px}' +
      '.dopt2027-status-line{display:flex;gap:6px;min-width:0}' +
      '.dopt2027-status-key{flex:none;color:var(--dsw-alias-label-caption)}' +
      '.dopt2027-status-value{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.dopt2027-box{display:flex;flex-direction:column;gap:4px}' +
      '.dopt2027-caption-row{display:flex;align-items:center;justify-content:space-between;gap:8px}' +
      // The read-only boxes have to read as something you look at, not something
      // you press, and the first attempt failed on a measured number: it used
      // `--dsw-alias-markdown-code-block` (bluish-50, `#f9fafb` light / `#1b1b1c`
      // dark) against a menu surface that composites to `#fbfcfc` light and
      // `#2e2f34` dark — a contrast ratio of 1.017 in light, i.e. no visible
      // edge at all.
      //
      // These two tokens are measured instead. `--dsw-alias-interactive-bg-active`
      // is `#2631481a` light and `#ffffff24` dark; composited on the menu
      // surface that is `#e5e7ea` (ratio 1.205) and `#4c4c51` (1.564). Both flip
      // with the theme by themselves, and 1.2 is the same step the harness uses
      // between a menu surface and its own pressed state — visible, not loud.
      // `--dsw-alias-border-l4` (`#00000029` / `#ffffff33`) is the palette's
      // heaviest hairline, so the box has an edge even where the fill is faint.
      '.dopt2027-read{box-sizing:border-box;overflow:auto;overscroll-behavior:contain;' +
      'padding:8px;margin:0;border-radius:var(--dsw-radius-sm);' +
      'background:var(--dsw-alias-interactive-bg-active);' +
      'box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l4);' +
      'color:var(--dsw-alias-label-secondary);white-space:pre-wrap;word-break:break-word;' +
      'font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;line-height:16px}' +
      '.dopt2027-read:focus-visible{outline:var(--dsw-focus-ring-width) solid ' +
      'var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}' +
      '.dopt2027-read::-webkit-scrollbar{width:6px;height:6px}' +
      '.dopt2027-read::-webkit-scrollbar-thumb{' +
      'border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-scrollbar-bg-l1)}' +
      '.dopt2027-read::-webkit-scrollbar-thumb:hover{' +
      'background:var(--dsw-alias-scrollbar-bg-l2)}' +
      '.dopt2027-read::-webkit-scrollbar-track{background:transparent}' +
      // The automatic re-arm field. Two pieces, not one box: the label is plain
      // text like the caption above it, and only the number gets a frame, so the
      // control reads as 'this word, then its value' instead of as a text box that
      // happens to contain a sentence. height:24px on the input is one step
      // below the 28px composer row: it is a value, not a button beside it.
      '.dopt2027-field{display:flex;align-items:center;gap:6px;height:28px}' +
      '.dopt2027-field-label{flex:0 0 auto;max-width:100%;overflow:hidden;text-overflow:ellipsis;' +
      'white-space:nowrap;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:20px}' +
      '.dopt2027-field-input{flex:0 0 52px;width:52px;height:24px;padding:0 4px;border:0;' +
      'border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-interactive-bg-hover);' +
      'box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l2);text-align:center;' +
      'color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:20px;' +
      'font-variant-numeric:tabular-nums;outline:none}' +
      '.dopt2027-field-input:hover{background:var(--dsw-alias-interactive-bg-active)}' +
      '.dopt2027-field-input:focus-visible{box-shadow:inset 0 0 0 1px ' +
      'var(--dsw-alias-state-business-primary),0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary))}' +
      '.dopt2027-field-input::placeholder{color:var(--dsw-alias-label-dimmed)}' +
      '.dopt2027-field-input:disabled{color:var(--dsw-alias-label-dimmed)}' +
      '.dopt2027-idle{color:var(--dsw-alias-label-caption)}';

    let cssInstalled = false;

    /**
     * One stylesheet per page. A reload can replay `apply`, and a second copy of
     * the same rules would only re-declare them; the guard is the tag, not a
     * module flag, so a hot-swapped module cannot stack two of them either.
     */
    const installCss = () => {
      if (cssInstalled) return;
      cssInstalled = true;
      if (typeof document === 'undefined' || typeof document.createElement !== 'function') return;
      const head = document.head ?? document.documentElement;
      if (head === null || head === undefined || typeof head.appendChild !== 'function') return;
      const existing = typeof document.querySelector === 'function' ? document.querySelector('style[data-plugin-css="dsh-optimization-2027"]') : null;
      if (existing !== null && existing !== undefined) return;
      const tag = document.createElement('style');
      if (typeof tag.setAttribute === 'function') tag.setAttribute('data-plugin-css', 'dsh-optimization-2027');
      tag.textContent = CSS;
      head.appendChild(tag);
    };

    /**
     * One POST to the Host half. The answer is the Host's own words; on a
     * transport failure this returns a line saying so rather than an empty
     * string, because an empty answer and a refused answer must not look alike.
     *
     * `session` rides along on every call: the dock is a session-scoped slot and
     * all the state behind it is per agent, so a press must name the session it
     * is displayed in. Without it a button in one session would change another's
     * level and report success.
     */
    const post = async (body, session) => {
      const payload = session ? { ...body, session } : body;
      try {
        const response = await fetch(ROUTE, {
          method: 'POST', // ui-copy-ignore
          headers: { 'Content-Type': 'application/json' }, // ui-copy-ignore
          credentials: 'same-origin', // ui-copy-ignore
          body: JSON.stringify(payload),
        });
        const text = await response.text();
        let parsed = null;
        try {
          parsed = text.length > 0 ? JSON.parse(text) : null;
        } catch {
          parsed = null;
        }
        if (parsed === null) return { ok: false, text: text.length > 0 ? text : `HTTP ${response.status}` };
        return parsed;
      } catch (error) {
        return { ok: false, text: `${COPY.unreachable}: ${String(error && error.message ? error.message : error)}` };
      }
    };

    function Dock2027(props) {
      const session = typeof props?.sessionId === 'string' ? props.sessionId : '';
      const [open, setOpen] = React.useState(false);
      const [state, setState] = React.useState(null);
      const [output, setOutput] = React.useState(null);
      const [busy, setBusy] = React.useState(false);
      const wrap = React.useRef(null);

      /** Read the level back from the Host. Nothing here derives it locally. */
      const refresh = React.useCallback(async () => {
        const answer = await post({ action: 'state' }, session);
        if (answer && answer.ok) setState(answer);
        else if (answer) setState({ level: null, levelTitle: answer.error || COPY.unreachable });
      }, [session]);

      /**
       * The poll interval exists because the tier can change without this
       * component: `/dopt2027 level 3` typed in the conversation moves it, and the
       * button is supposed to name the tier that is actually in force. Ten
       * seconds is chosen against the cost — one `state` request returns a
       * short string, and a stale label for up to ten seconds is the failure
       * this accepts.
       */
      React.useEffect(() => {
        refresh();
        const timer = setInterval(refresh, POLL_MS);
        const onVisible = () => {
          if (document.visibilityState === 'visible') refresh();
        };
        document.addEventListener('visibilitychange', onVisible);
        return () => {
          clearInterval(timer);
          document.removeEventListener('visibilitychange', onVisible);
        };
      }, [refresh]);

      // The panel reads the level again on open: between the poll and the press
      // the tier may have moved, and the panel is where a person acts on it.
      React.useEffect(() => {
        if (!open) return undefined;
        refresh();
        return undefined;
      }, [open, refresh]);

      // A press outside the panel closes it. Without this the panel stays over
      // the composer and the next person to type finds it in the way.
      React.useEffect(() => {
        if (!open) return undefined;
        const onDown = (event) => {
          const node = wrap.current;
          if (node !== null && node !== undefined && !node.contains(event.target)) setOpen(false);
        };
        document.addEventListener('mousedown', onDown);
        return () => document.removeEventListener('mousedown', onDown);
      }, [open]);

      // The automatic re-arm field is declared after the effects on purpose: the
      // hook order above is what the tests and any replayed render depend on,
      // and adding a slot in the middle would renumber every effect after it.
      // Declaration order carries no meaning to React — only the call order does.
      //
      // `null` means "show whatever the Host reports". It goes back to null after
      // a commit, so the field is never a second source of truth: the value on
      // screen is the Host's value unless someone is in the middle of typing one.
      const [rearmDraft, setRearmDraft] = React.useState(null);

      const run = async (input) => {
        const verb = String(input || '').trim();
        if (verb.length === 0) return;
        setBusy(true);
        setOutput(COPY.working);
        const answer = await post({ action: 'invoke', input: verb }, session);
        setBusy(false);
        setOutput(answer && typeof answer.text === 'string' && answer.text.length > 0 ? answer.text : COPY.unreachable);
        await refresh();
      };

      // The tool row already names the plugin by position and tooltip, so the
      // visible text is the tier alone: "标准" reads as a setting, "2027 · T2"
      // reads as a model name and competes with the model trigger beside it.
      // `title` stays the plain panel name. The plugin id is not part of it —
      // the id lives in the tooltip instead (`COPY.name`), so the heading reads
      // as a setting ("推理优化") rather than as a package listing.
      const level = state !== null && typeof state.level === 'number' ? state.level : null;
      const minLevel = state !== null && typeof state.minLevel === 'number' ? state.minLevel : 0;
      const maxLevel = state !== null && typeof state.maxLevel === 'number' ? state.maxLevel : 4;
      const title = state !== null && typeof state.levelTitle === 'string' ? state.levelTitle : '';
      // The threshold in force, as the Host last reported it. `null` means the
      // Host has not answered yet; the field then invites a number rather than
      // pretending one is set.
      const reportedRearm = state !== null && typeof state.rearmDistance === 'number' ? state.rearmDistance : null;
      // What the field shows: the Host's value unless someone is mid-edit.
      const rearmValue =
        rearmDraft !== null
          ? rearmDraft
          : reportedRearm === null || reportedRearm === 0
            ? ''
            : String(reportedRearm);
      // Before the first answer arrives, the honest guess is the plugin's own
      // default: a new session starts at the off switch, so the button says
      // "关" instead of a placeholder word that names nothing.
      const label = level === null ? COPY.tierNames[0] : COPY.tierNames[level] ?? String(level);

      const button = h(
        'button',
        {
          type: 'button', // ui-copy-ignore
          className: 'dopt2027-trigger', // ui-copy-ignore
          title: level === null ? `${COPY.name} · ${COPY.title}` : `${COPY.name} · ${COPY.title} — ${COPY.tier} ${level}/${maxLevel}${title.length > 0 ? `: ${title}` : ''}`, // ui-copy-ignore
          'aria-label': `${COPY.name} · ${COPY.title} — ${label}`, // ui-copy-ignore
          'aria-expanded': open,
          onClick: (event) => {
            event.preventDefault();
            setOpen((was) => !was);
          },
        },
        h('span', { className: 'dopt2027-trigger-label' }, label), // ui-copy-ignore
      );

      if (!open) {
        return h('div', { ref: wrap, className: 'dopt2027-root' }, button); // ui-copy-ignore
      }

      // One chip per tier the Host reports as reachable. The chips are the whole
      // tier control: no `−`/`+` pair, so reaching tier 0 from tier 4 is one
      // press instead of four, and there is no state in which a chip and the
      // level disagree about which tier is current.
      const tierChips = [];
      for (let n = minLevel; n <= maxLevel; n += 1) {
        const active = level === n;
        tierChips.push(
          h(
            'button',
            {
              type: 'button', // ui-copy-ignore
              key: `tier-${n}`, // ui-copy-ignore
              className: 'dopt2027-tier', // ui-copy-ignore
              title: COPY.tierHints[n] ?? `${COPY.tier} ${n}`, // ui-copy-ignore
              'aria-pressed': active,
              disabled: busy || level === null,
              onClick: () => run(`level ${n}`),
            },
            COPY.tierNames[n] ?? String(n),
          ),
        );
      }

      // The cost row: one figure per tier, straight under the chip that sets it.
      // The numbers come from the host (`state.costs`, built by `costTable()`
      // from the very rules it renders) and never from the client — a second
      // copy of the rule table would drift from the protocol it describes.
      // When the host has not answered yet there is nothing honest to print, so
      // the row is omitted rather than filled with zeros.
      const costs = state !== null && Array.isArray(state.costs) ? state.costs : null;
      const costRow =
        costs === null
          ? null
          : h(
              'div',
              { className: 'dopt2027-cost-row', title: COPY.hintCost }, // ui-copy-ignore
              ...costs
                .filter((row) => row.level >= minLevel && row.level <= maxLevel)
                .map((row) =>
                  h(
                    'span',
                    {
                      key: `cost-${row.level}`, // ui-copy-ignore
                      className: 'dopt2027-cost', // ui-copy-ignore
                      'data-active': row.level === level,
                      title: `${COPY.tierNames[row.level] ?? row.level}: ${row.chars} chars ≈ ${row.tokens} tok, ${row.toolTokens} of it tool schemas ⇒ ${row.totalTokens} tok per request — ${COPY.hintCost}`, // ui-copy-ignore
                    },
                    `${row.totalTokens} ${COPY.costUnit}`,
                  ),
                ),
            );

      // The read-only region is resident and carries both halves of what this
      // Two read-only panels, not one with a rule through it. The status panel
      // answers "what is true right now" and is the first thing the eye lands on
      // after the title; the result panel answers "what did the last press
      // return". Merging them made one 180px scroller where a stale result could
      // be read as current state, and splitting them lets each size itself: the
      // status block is four short lines, the result can be a whole ledger dump.
      // Both are the Host's own text, unchanged, so the panel and `/dopt2027 status`
      // can never disagree; the split into key/value is presentational only.
      const statusLines = (state !== null && typeof state.status === 'string' ? state.status : '')
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map((line, index) => {
          const cut = line.indexOf(' ');
          const key = cut === -1 ? line : line.slice(0, cut);
          const value = cut === -1 ? '' : line.slice(cut + 1);
          return h(
            'div',
            { className: 'dopt2027-status-line', key: `status-${index}` }, // ui-copy-ignore
            h('span', { className: 'dopt2027-status-key' }, key), // ui-copy-ignore
            h('span', { className: 'dopt2027-status-value', title: value }, value), // ui-copy-ignore
          );
        });

      // Every control carries its own sentence. The chips already say what the
      // tier adds; the verbs say what pressing them will put in the read-only
      // region, so nobody has to press one to find out.
      const verbButton = (verb, text, hint) =>
        h(
          'button',
          {
            type: 'button', // ui-copy-ignore
            className: 'dopt2027-cell', // ui-copy-ignore
            title: hint, // ui-copy-ignore
            'aria-label': `${text} — ${hint}`, // ui-copy-ignore
            disabled: busy,
            onClick: () => run(verb),
          },
          text,
        );

      /**
       * One read-only panel: fixed height, its own scroll area, wheel-driven.
       *
       * The height is a constant, not state. A read-only box whose size the
       * reader has to set first is a control pretending to be text; the wheel
       * already answers "show me the rest" without asking anything. The box is
       * focusable (`tabIndex 0`) so the keyboard can scroll it too, and
       * `overscroll-behavior: contain` keeps the wheel inside the box instead of
       * scrolling the conversation behind it when the content ends.
       *
       * No hint text: a caption row that also had to say "scroll with the wheel"
       * put four words of instruction on a two-word label, and a box that
       * visibly overflows is already the instruction. The caption alone names
       * the panel.
       */
      const readPanel = (key, caption, hint, height, body) =>
        h(
          'div',
          { className: 'dopt2027-box', key }, // ui-copy-ignore
          h(
            'div',
            { className: 'dopt2027-caption-row' }, // ui-copy-ignore
            h('span', { className: 'dopt2027-caption', title: hint }, caption), // ui-copy-ignore
          ),
          h(
            'div',
            {
              className: `dopt2027-read dopt2027-read-${key}`, // ui-copy-ignore
              style: { height }, // ui-copy-ignore
              tabIndex: 0, // ui-copy-ignore
              'aria-label': caption, // ui-copy-ignore
              'aria-live': 'polite',
              /**
               * Scroll by hand instead of trusting the platform default.
               *
               * Two reasons. First, `height` used to be content-box, so a 76px
               * box held 76px of text and the four status lines fit exactly —
               * there was nothing to scroll, and the wheel looked broken
               * because it was. The rule now sets `box-sizing: border-box`, so
               * the box scrolls; this handler makes that scroll happen even
               * when an ancestor Wheel listener runs first. Second, React
               * attaches `wheel` passively at the root, so `preventDefault()`
               * here would not take effect — assigning `scrollTop` does, and
               * `stopPropagation()` keeps the conversation from also moving
               * when this box still had room to scroll.
               */
              onWheel: (event) => {
                const box = event.currentTarget;
                if (box === null || box === undefined) return;
                if (box.scrollHeight <= box.clientHeight) return;
                const before = box.scrollTop;
                box.scrollTop = before + event.deltaY;
                if (box.scrollTop !== before) event.stopPropagation();
              },
            },
            body,
          ),
        );

      const panel = h(
        'div',
        { className: 'dopt2027-panel', role: 'dialog', 'aria-label': `${COPY.name} · ${COPY.title}` }, // ui-copy-ignore
        h(
          'div',
          { className: 'dopt2027-title' }, // ui-copy-ignore
          h('span', null, COPY.title),
          h(
            'button',
            {
              type: 'button', // ui-copy-ignore
              className: 'dopt2027-cell dopt2027-close', // ui-copy-ignore
              title: COPY.hintClose, // ui-copy-ignore
              'aria-label': `${COPY.close} — ${COPY.hintClose}`, // ui-copy-ignore
              onClick: () => setOpen(false),
            },
            COPY.close,
          ),
        ),
        h('div', { className: 'dopt2027-rule' }), // ui-copy-ignore
        h(
          'div',
          null,
          h(
            'div',
            { className: 'dopt2027-caption', style: { marginBottom: 4 }, title: COPY.hintTier }, // ui-copy-ignore
            `${COPY.tier} · ${level === null ? '–' : `${level}/${maxLevel}`}${title.length > 0 ? ` · ${title}` : ''}`,
          ),
          h('div', { className: 'dopt2027-row' }, ...tierChips), // ui-copy-ignore
          costRow,
        ),
        h(
          'div',
          { className: 'dopt2027-grid' }, // ui-copy-ignore
          verbButton('levels', COPY.levels, COPY.hintLevels),
          verbButton('tools', COPY.tools, COPY.hintTools),
          verbButton('ledger', COPY.ledger, COPY.hintLedger),
          verbButton('rearm', COPY.rearm, COPY.hintRearm),
        ),
        // The automatic half of re-arm. It is a field, not a button, because the
        // value is a number rather than one of a fixed set — and it writes on
        // blur or Enter, not on every keystroke, so a three-digit value costs one
        // request instead of three. Empty means off: the same thing the word
        // "off" and the number 0 mean, so a person can express it whichever way
        // they think of it.
        h(
          'label',
          { className: 'dopt2027-field' }, // ui-copy-ignore
          h('span', { className: 'dopt2027-field-label', title: COPY.hintRearmField }, COPY.rearmField), // ui-copy-ignore
          h('input', {
            type: 'text', // ui-copy-ignore
            inputMode: 'numeric', // ui-copy-ignore
            className: 'dopt2027-field-input', // ui-copy-ignore
            value: rearmValue,
            placeholder: COPY.rearmOff, // ui-copy-ignore
            'aria-label': `${COPY.rearmField} — ${COPY.hintRearmField}`, // ui-copy-ignore
            disabled: busy,
            onChange: (event) => setRearmDraft(String(event?.target?.value ?? '').replace(/[^0-9]/g, '')),
            onKeyDown: (event) => {
              if (event?.key === 'Enter') event.target?.blur?.();
            },
            onBlur: () => {
              // Nothing typed: leave the Host's value alone and cost no request.
              if (rearmDraft === null) return;
              const wanted = rearmDraft.trim();
              const current = reportedRearm === null ? 0 : reportedRearm;
              const next = wanted.length === 0 ? 0 : Number(wanted);
              // Drop back to the Host's value first, so the field never shows a
              // number the Host did not confirm.
              setRearmDraft(null);
              if (!Number.isFinite(next) || next === current) return;
              run(next === 0 ? 'rearm off' : `rearm ${next}`);
            },
          }),
        ),
        readPanel(
          'status',
          COPY.status,
          COPY.hintStatus,
          READ_STATUS_HEIGHT,
          h(
            'div',
            { className: 'dopt2027-status' }, // ui-copy-ignore
            statusLines.length === 0
              ? h('span', { className: 'dopt2027-idle' }, COPY.working) // ui-copy-ignore
              : statusLines,
          ),
        ),
        readPanel(
          'result',
          COPY.result,
          COPY.hintResult,
          READ_RESULT_HEIGHT,
          output === null ? h('span', { className: 'dopt2027-idle' }, COPY.idle) : output, // ui-copy-ignore
        ),
      );

      return h('div', { ref: wrap, className: 'dopt2027-root' }, button, panel); // ui-copy-ignore
    }

    /**
     * The context this plugin already registered into. The host can replay an
     * injection — a remount, a reload that keeps the context — and registering
     * the row twice puts a second button in the row with its own listeners.
     */
    let appliedCtx = null;

    return {
      inject: ['slots'], // ui-copy-ignore
      apply(ctx) {
        if (ctx === appliedCtx) return;
        appliedCtx = ctx;
        installCss();
        /**
         * `conversation.input.right` is the composer's own tool row, the one
         * holding rewind and the vision toggle, immediately before the send
         * button. That is where a person looks for a control that acts on the
         * conversation, and it is inside the card rather than under it.
         *
         * order 30 lands between the installed rewind (20) and vision toggle
         * (40): a fresh id is added beside them instead of replacing either.
         */
        ctx.slots.inject('conversation.input.right', () =>
          ctx.slots.register(
            {
              name: 'conversation.input.right', // ui-copy-ignore
              id: 'dsh-optimization-2027', // ui-copy-ignore
              order: 30, // ui-copy-ignore
              label: () => COPY.label, // ui-copy-ignore
            },
            Dock2027,
          ),
        );
      },
    };
  },
});
