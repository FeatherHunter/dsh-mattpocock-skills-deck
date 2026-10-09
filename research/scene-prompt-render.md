# 三条切换/初始化模板的渲染真相（scene-prompt-render）

> 只认一手来源，不给改法建议。一手来源：src/client/kernel/prompts.js（全文 303 行，已通读）、src/client/statusbar/StatusBackend.js（142-157 行）、src/client/kernel/store-switch.js（207-243 行）、tests/verify-669-choice-precedence.js、tests/verify-698-switch-asks-layout.js（只记录它们断了什么）。取证时 HEAD 含提交 716b353（2026-10-09）。

## 1. 三条模板现行正文

### 1.1 PROMPTS.setupRun：version 15（prompts.js:34）

占位符表：trackerLine, trackerChoice, backendNote, labelReqs, contextLayout（5 个，无 from/to）。

中文正文原文：

    /setup-matt-pocock-skills

    初始化本仓库配置（技能套件已安装；本命令仅记录 issue tracker / 标签词汇 / 文档路径，不安装、不克隆任何技能）：
    1. 按技能流程选择 issue tracker：{trackerLine}，由用户确认；
    2. 初始化时按 setup-matt-pocock-skills 技能自身流程执行（issue tracker 选择 {trackerChoice}；triage 标签保留默认五角色）{labelReqs}；后续打标签严格遵循技能规则，不额外强制任何标签；
    3. 完成后核对技能真实产物：docs/agents/issue-tracker.md + triage-labels.md + domain.md 及 AGENTS.md 的 ## Agent skills 块；再复查环境检查（setup 变绿）。{contextLayout}。{backendNote}

英文正文原文：

    /setup-matt-pocock-skills

    Bootstrap this repo configuration (the skill suite is already installed; this command only records the issue tracker / label vocabulary / doc paths):
    1. Follow the skill flow to pick the issue tracker: {trackerLine}, confirm with the user;
    2. During init, follow the setup-matt-pocock-skills skill own flow (choose {trackerChoice} as the tracker; keep the default triage-role labels){labelReqs};
    3. Verify the actual outputs of the setup skill: docs/agents/issue-tracker.md + triage-labels.md + domain.md and the ## Agent skills block in AGENTS.md; then re-run the environment check (setup turns green). {contextLayout}.{backendNote}

### 1.2 switchAlign：version 4（prompts.js:35）

占位符表（7 个 = setupRun 的 5 个 + from/to）：trackerLine, trackerChoice, backendNote, labelReqs, contextLayout, from, to。

中文正文 = setupRun 中文一字一致，仅多一个首句段落。首句：本工作区已从 {from} 切换为 {to}。

英文正文 = setupRun 英文一字一致，仅首句为：The workspace has been switched from {from} to {to}.

### 1.3 switchLayout：version 4（prompts.js:41）

占位符表：与 switchAlign 完全相同 7 个。中文首句：本工作区布局已从 [{from}] 改为 [{to}]（原文首尾为中文引号）。英文首句：The workspace layout has been changed from [{from}] to [{to}]（原文为英文双引号）。主体与 setupRun 一字一致。

## 2. promptText 缺参留原形的契约（prompts.js:68-78）

函数原文行为：取 PROMPTS[id] 的 zh（或 en）；把 params 逐键替换文本里的 {name}；params 里没有的占位符名保留匹配原文。唯一例外是 VOCABULARY_DEFAULT 的两个键（prompts.js:53，cli 默认为 [当前后端的命令行]、cliBrand 默认为 [当前跟踪器]）：调用者没传也自动填中性说法，所以 {cli} 与 {cliBrand} 永远不会原样进入会话（注释 #716）。其余占位符没有任何兜底。

## 3. 填充链：四个函数各自填什么

### 3.1 setupRunParamsFrom（prompts.js:102-116）

输入 (modules, backendId, dictOverride, layout)，产出 5 个键：trackerLine / trackerChoice / backendNote / labelReqs 按后端模块 setupPrompt 声明查 locale 字典（SETUP_DEFAULT_PROMPT_KEYS，prompts.js:83-88），查不到落空串；contextLayout 与后端无关，单独按 layout（single/multi）查 SETUP_LAYOUT_TEXT_KEYS（prompts.js:91），不认识或没传按缺省 single。

### 3.2 setupRunPrompt（prompts.js:121-130）

输入 (st, backendId, layout)。后端 id 按链取值：显式 backendId，st.selection，st.snapshot.selection，按工作区缓存 getCachedSelection(cwd)。然后以 setupRunParamsFrom 的产出为参数调 promptText 取 setupRun 模板。注释写明 layout 由调用处显式传入。

### 3.3 backendParamsFor / promptTextFor（prompts.js:265-278）

backendParamsFor(st, params) 只补三样：subIssue（经 newWayfinderParamsFrom）、subject（后端 prompts.healthCheck 声明，无声明时空串）、cli/cliBrand（经 vocabularyParamsFrom）；并对 subject 值再做一遍嵌套占位符替换。promptTextFor(st, id, params) 即以 backendParamsFor 的产出为参数调 promptText。关键事实：backendParamsFor 不补 trackerLine / trackerChoice / backendNote / labelReqs / contextLayout / from / to；setupRunParamsFrom 不补 from / to。两条填充链互不相交。

### 3.4 切换三处调用走了哪条链

三处切换调用全部直调 promptText，只传 from/to，不经过 setupRunParamsFrom / setupRunPrompt / promptTextFor / backendParamsFor 中任何一段。因此 V4 模板里的 5 个 setup 系占位符在这三处永远没有值，按第 2 章契约原样留在文本里（见第 6 章实证）。

## 4. 三处切换调用实际传参（逐处贴，均为意译转写，键名与行号保真）

### 4.1 StatusBackend.js:142-143：已初始化分支的后端对齐（确认与取消都走）

调用：promptText([switchAlign], [from: fromLabel, to: toLabel])，结果非空则 inject(s, t)。只传 from/to。fromLabel/toLabel 来自 labelOf(s.switchCardFrom) 与 labelOf(s.switchCardTo)（第 126 行），即后端标签人话。外层守卫 switchAlignDone !== true（第 142 行），已给过则跳过。

### 4.2 StatusBackend.js:150-153：已初始化且布局真改了才多给的布局对齐

判据：changedLayout = switchCardLayoutFrom 与 setupLayout 皆非空且两者不等（第 150-151 行）。调用：promptText([switchLayout], [from: 布局人话(switchCardLayoutFrom), to: 布局人话(setupLayout)])。布局人话由 layoutWordOf 翻译（第 94-99 行）：single/multi 对应词条 setup.layoutSingle / setup.layoutMulti（卡上选项原文），不认识落回 single 那一句。取消分支同样先走 4.1，不走本条。

### 4.3 store-switch.js:236：卡没开成时的兜底

调用：promptText([switchAlign], [from: _fromLabel, to: _label])，其中 _fromLabel = labelOf(sc.curBackendId)，_label = labelOf(targetId)（第 190-191 行）。触发条件（第 229-243 行）：已初始化，但 injectSetupDecision(allowCard:true, askLayout:true, source:[switch]) 没返回 [askLayout]（卡没开成，例如链里没有 tracker:initialized 这一步）→ 直接注 switchAlign，并记 inject.decision [prompt:switchAlign, kind:align] 调试轨迹（第 240 行）。卡开出来时（_kind === [askLayout]）这里一个字都不注，等 settleSwitchCard 收尾（第 224-228 行注释）。


### 4.4 三处调用原文（X 代表单引号，ZZ 代表空串，保证与源文件逐字符一致）

StatusBackend.js:143 原文： try{ const t=(typeof promptText===X) ? promptText(XswitchAlignX,{from:fromLabel,to:toLabel}) : ZZ ; if(t&&typeof inject===X) inject(s,t) }catch(eInj){}

StatusBackend.js:153 原文： try{ const t=(typeof promptText===X) ? promptText(XswitchLayoutX,{from:layoutWordOf(s.switchCardLayoutFrom),to:layoutWordOf(s.setupLayout)}) : ZZ ; if(t&&typeof inject===X) inject(s,t) }catch(eInj2){}

store-switch.js:236 原文： const _txt = (typeof promptText === X) ? promptText(XswitchAlignX, { from: _fromLabel, to: _label }) : ZZ

## 5. V3 与已落地 716b353 的 V4 的差异

提交 716b353（标题：切换提示语回归为 V15 原文加首句）共改 3 个文件 4 增 4 删：prompts.js 里 switchAlign 与 switchLayout 各一行（每行一增一删），两份门禁各一行断言同步。

### 5.1 switchAlign V3（父提交 716b353^ 原文）

version 3，占位符仅 from/to。独立短文：首句为 [本工作区的 issue tracker 后端已由用户在面板上从 {from} 切换为 {to}（切换方式：保留——原有数据仍留在 {from}，切回可见）]；正文三条对齐指令（改 issue-tracker.md 记录行、改 domain.md 与 AGENTS.md 相关行、回读抄行并列改动文件行号）；末句 [不要重跑初始化，不要重建已有的产物，也不要在 {to} 这边新建任何目录或骨架]。英文同构，含 (mode: keep) 与 Do not re-run the setup。

### 5.2 switchAlign V4（现行，见 1.2）

version 4，占位符 7 个，主体与 setupRun V15 一字一致，仅首句 [本工作区已从 {from} 切换为 {to}。]。use 字段追加：v4 经用户拍板回归为 V15 原文+首句，属有意回归，后人勿当 bug 再撤。

### 5.3 switchLayout V3（父提交 716b353^ 原文）

version 3，占位符仅 from/to。独立短文：首句为 [本工作区的域文档布局已由用户在面板上从 {from} 改为 {to}]；正文三条布局对齐指令（改 domain.md 写布局那一句为 {to} 结论、AGENTS.md 的 Domain docs 行对齐、回读抄两行并列改动）；末句 [不要重跑初始化，不要重建任何已有的产物——布局结论变了不等于要立刻把新布局下的文件都建出来]。英文同构。源头为 6b24f4e 引入的 V1，中间经 9e7e0c7（#779 补工具节→V2）与 c6f531c（#792 撤工具节→V3）。

### 5.4 switchLayout V4（现行，见 1.3）

version 4，占位符 7 个，主体与 setupRun V15 一字一致，仅首句 [本工作区布局已从 {from} 改为 {to}]。门禁同步：verify-698 第 220 行旧断言（不要重跑初始化）改为断 [本工作区布局已从]；verify-669 第 395 行旧断言（占位符 from/to）改为断 V4 七个占位符。

### 5.5 一句话差异

V3 是两条各管各的短指令（后端那几处 / 布局那两处，点名文件与行，明确说不要重跑初始化）；V4 是两条共用 setupRun V15 全文的长指令，区别只剩首句与第二条是否出现。

## 6. 真渲染举例：哪些大括号会裸奔

用真源 PROMPTS + promptText（中文路径）实测，传参与三处调用同口径（只给 from/to）。输入 promptText([switchAlign], [from:GitHub, to:Markdown]），实得全文如下（已逐字核对，由程序求值产生）：

    /setup-matt-pocock-skills

    本工作区已从 GitHub 切换为 Markdown。

    初始化本仓库配置（技能套件已安装；本命令仅记录 issue tracker / 标签词汇 / 文档路径，不安装、不克隆任何技能）：
    1. 按技能流程选择 issue tracker：{trackerLine}，由用户确认；
    2. 初始化时按 setup-matt-pocock-skills 技能自身流程执行（issue tracker 选择 {trackerChoice}；triage 标签保留默认五角色）{labelReqs}；后续打标签严格遵循技能规则，不额外强制任何标签；
    3. 完成后核对技能真实产物：docs/agents/issue-tracker.md + triage-labels.md + domain.md 及 AGENTS.md 的 ## Agent skills 块；再复查环境检查（setup 变绿）。{contextLayout}。{backendNote}

填上了：{from} → GitHub、{to} → Markdown（首句）。裸奔（原样留在文本里，一共 5 个）：{trackerLine}、{trackerChoice}、{labelReqs}、{contextLayout}、{backendNote}。switchLayout 同理（首句填布局人话，其余 5 个同样裸奔；英文路径同理）。对照：走 setupRunPrompt 的初始化路径（黄条按钮 / 未初始化切换）由 setupRunParamsFrom 把这 5 个全填上，不裸奔。

## 7. 哪种操作实际看到哪条全文（当前 V4 为准）

- 切换后端 → 已初始化 → 布局小卡点确认，且布局没改（switchCardLayoutFrom 等于 setupLayout）：只有 switchAlign 全文一条。对应门禁 verify-669 C2（已初始化没改布局只注一条）与 verify-698 E（同场景）。
- 切换后端 → 已初始化 → 布局小卡点确认，且布局改了：switchAlign 全文 + switchLayout 全文，共两条。对应门禁 verify-669 C2（改布局确认注两条）与 verify-698 E（同场景，第一条 switchAlign，第二条 switchLayout）。
- 切换后端 → 已初始化 → 布局小卡点取消：switchAlign 全文一条，布局对齐不补（取消前卡上点的选项作废，答案退回开卡前值）。对应 verify-669 C2 取消断言与 verify-698 E 取消整链断言。
- 切换后端 → 还没初始化 → 点确认：不走两条 switch 模板；交回 injectSetupDecision（allowCard:false），即 setupRun V15 全文（与黄条同一份）。对应 verify-669 C2（交回决策器）与 verify-698 E（fresh 分支）。
- 切换后端 → 链里没有 tracker:initialized 这一步（unknown）：一个字都不注入，只提示看状态栏。
- 切换后端 → 卡没开成兜底：switchAlign 全文一条（store-switch.js:236）。
- 黄条初始化按钮 / 检查页：setupRun V15 全文（无 from/to 首句）。

用户实测对照（只转述对应关系）：[同后端保留确认 + 布局单确认只见后端段] 对应第 1 条（changedLayout 为假，第二条不触发，StatusBackend.js:150-156 不执行）；[布局改多确认多见布局段] 对应第 2 条（changedLayout 为真，多注一条）。两段全文主体都是 V15 同一段文字，区别只有首句与第二条是否出现。

## 8. 两份门禁只看断了什么

### 8.1 verify-669-choice-precedence.js

A 组断宿主判定链（真 detectionService）：带用户选择压过锚文件、不带时锚照旧、未注册 id 忽略，配反证。B 组断客户端闸门（真 userHintOf / mergeSelection）：只有带 userPicked 的选择才上报 hint，配反证。C 组断 store-switch.js 的 confirmSwitchConfirm：已初始化先开布局小卡（decision 一条，allowCard / askLayout / source:switch 全对）且当场零注入；未初始化走同一份判据；链没到时不注入不开卡。C2 组断 StatusBackend.js 的 settleSwitchCard：改布局确认注两条；没改只注 switchAlign；取消照旧给 switchAlign；竞态按点确认时刻重判；无链一步不注入；switchAlignDone 防重复；cardOwnedBySwitch 归属；黄条卡取消零注入。注意 C2 用 promptText 桩（ALIGN/from->to 缩写），不断言模板正文，只断模板 id 与 from/to 传参。D 组断静态层：清除后端选择按钮与路径退役、迁移/清空置灰、GitLab 暂不可选、中英词条成对、switchAlign 在注册表里（V4 七个占位符，点名 /setup-matt-pocock-skills）。E 组为反证。

### 8.2 verify-698-switch-asks-layout.js

A 组断卡的位置（SetupCard.js 独立叶子，黄条不再自拼）。B 组断判据单源（layoutCardShouldOpen 只在 prompts-setup.js 一处；切换两支各传 askLayout:true 与 source:switch）。C 组断判据行为（答过也问 / 没答过也问 / 不传 askLayout 且答过才不问）。D 组断切换两支都先开卡、当场零注入、记下 switchCardLayoutFrom 与 switchAlignDone=false。E 组断 settle 收尾 8 类场景（含取消整链答案退回、确认对照两条都给），并断 switchLayout 是 V15 原文+首句（第 220 行）、模板表与取值分家（第 221 行）。同样用 id/from->to 桩，不逐字断言正文。F 组断同屏一张卡。G 组为三处反证。

## 9. 来源行号总表

- src/client/kernel/prompts.js:34 setupRun V15；:35 switchAlign V4；:41 switchLayout V4；:53 VOCABULARY_DEFAULT；:68-78 promptText；:83-92 键表与布局键表；:102-116 setupRunParamsFrom；:121-130 setupRunPrompt；:265-278 backendParamsFor / promptTextFor。
- src/client/statusbar/StatusBackend.js:94-99 layoutWordOf；:107-119 worktreeInitializedState；:124-158 settleSwitchCard（:142-143 switchAlign 调用，:150-156 switchLayout 调用）；:159-176 confirmStatusSetupPick（:174 切换收尾分流）。
- src/client/kernel/store-switch.js:207-243 _route（:218-221 开卡前记录，:228 决策调用，:236 兜底 switchAlign）。
- src/client/kernel/prompts-setup.js:22 起 injectSetupDecision。
- tests/verify-669-choice-precedence.js:196 起 C 组；295-371 C2 组；395-396 注册表断言。tests/verify-698-switch-asks-layout.js:122-182 D 组；185-268 E 组；220-221 模板断言。
- 版本沿革：6b24f4e（switchLayout V1 引入；switchAlign V1）；9e7e0c7（#779 补工具节→V2）；c6f531c（#792 撤工具节→V3）；716b353（回归 V15 原文+首句→V4，含两份门禁同步）。



