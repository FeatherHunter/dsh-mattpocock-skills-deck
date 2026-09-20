# #662 首开引导顺序 · 八道门禁调查报告

这是一份给写规格的会话用的工作笔记，不是给人看结论的报告。八道门禁逐个说清三件事：
它守的是什么行为、它有没有在守「首开引导顺序」这条链、新顺序定下之后它的哪几条断言必须改或必须删。

判定口径（本报告用的三条标准）：

1. **顺序门禁**：断言里出现「先弹哪个条」「哪一行排前面」「注入哪一段文本」「黄条要不要等仓库」这类先后关系，才算在守顺序。
2. **结构门禁**：只断言文件里有没有某个字符串、某个槽位、某个常量、某个组件，不涉及先后，就算只守结构。
3. **测法**：读源码当文本扫（静态），还是真的把代码跑起来（行为）。混合的两种都写。

关于 `npm run verify` 的名单，先给结论（这是查证过的，不是猜的）：

- 名单只有一处来源，就是 `package.json` 第 18 行的 `scripts.verify` 那一条 `&&` 串，共 112 道。
- CI（`.github/workflows/verify.yml` 第 63 行）跑的是 `node scripts/verify-all.mjs`，而该脚本第 20 行读的就是同一个 `scripts.verify` 字符串，逐道 `execSync` 执行，没有自己另抄一份名单。
- 全仓库没有任何脚本用 glob 枚举 `tests/verify-*.js`（已搜过 `scripts/`、`test/`，无命中）。`tests/` 下现有 161 个 `verify-*.js`，只有 112 个在链上。
- `acceptance/` 目录只有一个 HTML 文件，不是门禁运行器。

| 文件 | 在 `npm run verify` 链上 | 今天跑一遍的结果 |
| --- | --- | --- |
| tests/verify-issue195.js | 不在 | 红（4 条失败） |
| tests/verify-496-github-wizard-first.js | 不在 | 绿（13 条全过） |
| tests/verify-496b-inject-guard.js | 不在 | 红（1 条失败） |
| tests/verify-655-setup-layout.js | 在（第 25 道） | 绿（174 条全过） |
| tests/verify-656-subworkspace-acceptance.js | 在（第 111 道，共 112 道，靠近末道） | 绿 |
| tests/verify-no-repo-redcard.js | 在（第 29 道） | 绿 |
| tests/verify-setup-describe.js | 在（第 42 道） | 绿（171/171） |
| tests/verify-deck-slots.js | 不在 | 绿（130/130） |

---

## tests/verify-issue195.js

**它断言什么。** 它守的是 #195 第二轮的分层契约：后端 preflight 提供一段「怎么装 gh」的长提示词（`GH_INSTALL_PROMPT`），宿主把它原样透传到 `c4.hint`，界面拿这条 hint 直接注入，不再走 `prompt:installGh` 这种键名协议，也不留 `openUrl` 副按钮。换句话说，它把「缺 gh 时点一下条上的按钮会注入后端那段完整安装指引」这件事钉死了。

**它有没有守顺序。** 守了顺序的一半：它就是「缺 gh 这一环由谁来发话、发的是什么」的那道门禁，正是新顺序第 ③ 条要改的那条路。但它不守条与条之间的优先级（不读 `firstBlock`，也不读链目录顺序）。它另外还有一半内容（`ghLastError`、`resetGhCache`、`ghCliBad`、无 `banner.ghcliFallback`）与顺序无关，只是 #195 的历史契约。

**新顺序下要改或要删的断言。**

- `tests/verify-issue195.js:36`：`if (!src.includes("prompt: GH_INSTALL_PROMPT")) problems.push("Backend: ghPreflight 未返回 prompt: GH_INSTALL_PROMPT")`。第 ③ 条要求缺 gh 时注入的文本是逐字固定的 `/wizard 帮用户安装gh cli 官方地址：https://cli.github.com/`，而这句话今天进会话的路径就是「后端 preflight 的 prompt → c4.hint → 按钮 inject(hint)」。这条断言与新文案直接冲突，必须改或删。
- `tests/verify-issue195.js:46-49`：`if (!src.includes("det.preflight") || !src.includes("prompt")) { if (!src.includes("promptFromBackend") && !src.includes("det.preflight.prompt")) problems.push("Host: 未透传 det.preflight.prompt 到 c4.hint") }`。这是「宿主把后端 prompt 透传成 hint」的那条接线，也就是第 ③ 条要换掉的那段来源。必须改。（这条断言今天本来就是红的，实测失败信息就是 `Host: 未透传 det.preflight.prompt 到 c4.hint`。）
- `tests/verify-issue195.js:35`、`:37`、`:38`：`problems.push("Backend: 缺 GH_INSTALL_PROMPT 常量")`、`"Backend: prompt 缺 winget/brew"`、`"Backend: prompt 缺 gh --version"`。这三条守的是那段长安装提示词本身（含 `winget`、`brew`、`gh --version` 的写法）。如果第 ③ 条是「把长提示词整段退役、换成固定一句话」，这三条要删；如果只是「按钮不再注入它、长提示词仍留在 preflight 里备用」，这三条仍然成立。
- `tests/verify-issue195.js:64-65`：`const hasHintInject = src.includes("inject(st, h)") || src.includes("inject(s, h)") || src.includes("inject(st, hint)")` 与 `problems.push("UI: ChecksTab/StatusBar 未改为 inject(hint)（后端透传）")`。如果第 ③ 条把按钮改成注入一句写死的常量（不再是「注入 hint」），这条判据的说法要跟着改（改的是判据文案与它想锁的东西，不是行为）；实际判断逻辑很松（只有 client.js 且不含 `ghCli2` 时才走到），今天不构成红点。
- `tests/verify-issue195.js:77`：`if (!/ghCliBad = .*level === 'bad'/.test(src)) problems.push("UI: ghCliBad 未改为 level === 'bad'")`。与本次新顺序无关，但它今天就是红的：`src/client/statusbar/checksums.js:39` 现在是 `const ghCliBad = !!(ghCliStep && ghCliStep.status === 'fail')`，不再有 `level === 'bad'` 写法。写规格时顺手决定这道门禁是留是废。

**仍然成立的断言。** `:29`/`:31`（契约层有 `prompt` 字段）、`:42-44`（`host` 里没有 `ghPathError` 永久缓存，有 `ghLastError`、`resetGhCache`）、`:53-56`（`PROMPTS` 里没有 `installGh`、没有 `banner.ghcliFallback`、没有 `promptText('installGh')`）、`:71-75`（`openUrl('https://cli.github.com/')` 这个副按钮不许回来）、`:45`（不许再出现 `hint: 'prompt:installGh'`）——这些都不受新顺序影响，照旧成立。

**测法。** 纯静态：`fs.readFileSync` 读六个文件（`:15` 的默认名单：`client.js`、`package/lib/client.js`、`host.js`、`package/lib/index.js`、`src/host/tracker/contract.js`、`src/host/tracker/backends/github/preflight.js`），只做子串与正则判断，一行代码都不执行。

**是否在链上。** 不在。既不在 `npm run verify`，也不在 CI。

---

## tests/verify-496-github-wizard-first.js

**它断言什么。** 它守 #496 第一票：`gh:remote` 这条失败知识的主动作是「创建并发布」两步向导（提交 `wf.initPublish`），外加一条重新求值动作；并且把「先建仓推送、再执行初始化」这套先后说法写进了三处后端文案与初始化模板。同时守 Markdown 后端没被 GitHub 建仓文案污染。

**它有没有守顺序。** 守了，而且守的正是要被推翻的那版顺序：文案层反复说「先建仓再初始化」。它不守条与条之间的优先级（不读 `firstBlock`，不读链目录顺序，不读决策函数）。

**新顺序下要改或要删的断言。**

- `tests/verify-496-github-wizard-first.js:19`：`check(loc.includes('向用户确认仓库名与可见性'), '初始化模板中文让 AI 先确认再建仓（话说给能动手的人）')`。这句话就在 `src/client/kernel/locale-panel.js:68` 的 `setup.github.backendNote` 里，位置是「本次已选后端：GitHub —」这个破折号**之后**。第 ⑧ 条就是要删掉破折号之后那一段，所以这条必须删。
- `tests/verify-496-github-wizard-first.js:20`：`check(loc.includes('建仓成功并重查变绿后'), '初始化模板中文要求建成重查变绿后再继续')`。同一段被删的尾巴，必须删。
- `tests/verify-496-github-wizard-first.js:21`：`check(loc.includes('confirm the repo name and visibility'), '初始化模板英文同步 AI 可执行说法')`。英文那份尾巴（`setup.github.backendNote` 的 en 值）里的同一句，必须删。
- `tests/verify-496-github-wizard-first.js:14-18`（三条后端文案的顺序说法）：`:14` `check(gh.includes('先点「创建并发布」完成建仓推送，再执行初始化'), ...)`、`:16` `check(gh.includes('顺序要求：无远端时先建仓并推送成功，再按初始化全文生成文件与补标签'), ...)`、`:17` `check(gh.includes('Ordering rule: without a remote, create and push the repo first'), ...)`、`:18` `check(gh.includes('若仓库尚未创建，先走「创建并发布」完成建仓推送，再重查'), ...)`。这四句守的是「有这个说法」，不守「它被注入」。第 ⑤ 条只说不许再注入那段长文案，没说删文案本身；**只要 github 后端的 `repoRemoteFix` / `repoAccessFix` / `gh:remote.hint` 三段文本还在，这四条仍然成立**。如果规格决定连文本一起退役，这四条要删（同一票的 `:15` 英文那句同理）。

**仍然成立的断言。** `:10` `check(gh.includes("'gh:remote'"), 'GitHub 房含 gh:remote 失败知识')`、`:11` `check(gh.includes("label: { zh: '创建并发布'") && gh.includes("submitAction: { type: 'rpc', method: 'wf.initPublish'"), 'gh:remote 主动作为创建并发布向导并提交到建仓发布')`、`:12` `check(gh.includes("{ type: 'refresh', target: 'chain' }"), '失败知识含重查动作，推进靠重求值')`——第 ⑤ 条要「复用现成的两步向导」，正好就是这三条描述的形态，照旧成立。`:23`、`:24`（Markdown 未被污染）也成立。

**测法。** 纯静态：读 `src/host/tracker/backends/github/index.js`、`src/client/kernel/locale-panel.js`、`src/host/tracker/backends/markdown/index.js` 三个源文件做子串判断，不执行。

**是否在链上。** 不在。

---

## tests/verify-496b-inject-guard.js

**它断言什么。** 它守 #496 第二票（A 方案门控式）：注入决策只有一个漏斗（`setupOrRepoPrompt` / `injectSetupDecision` / `consumePendingSetup` 三个导出），判据读后端能力位 `capabilities.repoCreateChain` 而不是品牌名；缺仓库时改发后端声明的 `repoRemoteFix` 长指引、不发初始化全文，并记一个「建仓成功后补发一次」的标记；六个注入点都走同一个漏斗；两处建仓成功的地方消费那个标记；日志只记分支不记路径。

**它有没有守顺序。** 守了核心的一半：它钉的正是「缺仓库时不发初始化全文、改发建仓长指引、建完补发一次」这套顺序，而第 ⑤ 条要求「仓库没就绪期间不再注入那段长文案」。它不守条与条之间的优先级。

**新顺序下要改或要删的断言。**

- `tests/verify-496b-inject-guard.js:19`：`check(prompts.includes('repoRemoteFix'), '缺仓改发后端声明的缺仓指引')`。第 ⑤ 条落地后，决策函数不再需要去找后端声明的缺仓指引这段文本，这条判据失去对象，必须改或删。
- `tests/verify-496b-inject-guard.js:24-25`：`const sites = (sb.match(/injectSetupDecision\(s,id\)/g) || []).length` 与 `check(sites === 3, 'StatusBackend 三处走决策器（得 3，实 ' + sites + '）')`。这条今天已经红了（实测 `实 0`），因为现在三处调用都带了第三参（例如 `src/client/statusbar/StatusBackend.js:95` 是 `injectSetupDecision(s,id,{allowCard:true})`），正则匹配不上。而第 ① 条又要求蓝条确认后什么都不注入，`StatusBackend.js:95`（蓝条门控弹窗确认后绑定成功那段）必须改，所以这条无论怎样都要重写。
- `tests/verify-496b-inject-guard.js:22`：`check(prompts.includes('pendingSetupAfterPublish') && prompts.includes('pendingSetupCwd'), '待补标记按工作区键隔离')`，以及 `:30` `check(nr.includes('consumePendingSetup(st)'), '旧红卡建成后消费标记')`、`:31` `check(mv.includes('consumePendingSetup(st)'), '向导建成后消费标记')`。这一组守的是「建仓成功后补发一次初始化全文」的机制。它的触发条件就是「缺仓那一档注入了长文案」（`src/client/kernel/prompts.js:183` 的 `st.pendingSetupAfterPublish = (kind === 'repo')`）。第 ⑤ 条取消了那次注入、第 ⑥ 条改成「仓库就绪后黄条自己出现」，这套补发机制是否还需要，是规格要拍板的点；若退役，这三条必须删。
- `tests/verify-496b-inject-guard.js:18`：`check(prompts.includes('capabilities.repoCreateChain'), '判据读能力位 repoCreateChain（非 id 判据）')`。如果「要不要走建仓这一档」的判据仍然沿用能力位，这条成立；若改成直接读 `gh:remote` 检查项或改成「有建仓向导就弹」，则要改。

**仍然成立的断言（若单漏斗重构保留）。** `:15-17`（三个导出）、`:20`（`prompts.js` 里不许有 `=== 'github'` 这类品牌等值分支）、`:26-28`（Dock / OverlayGate / store-switch 三个入口走同一个决策函数）、`:33-35`（至少三处 `[MattSkillsDeck] setup-inject` 日志、日志不记 `st.cwd`）。注意 `:26-28` 是「字符串形态」的断言，入口的调用签名一变就可能失配（同一个文件里 `:24-25` 已经踩过这个坑），写规格时应把它改成「函数名出现」而不是「精确调用串」。

**测法。** 纯静态：读 `prompts.js`、`StatusBackend.js`、`Dock.js`、`OverlayGate.js`、`store-switch.js`、`NoRepoCard.js`、`slotRenderer-modal-view.js` 七个源文件做子串与正则判断，不执行。

**是否在链上。** 不在。

---

## tests/verify-655-setup-layout.js

**它断言什么。** 它守 #655：布局没选过时，能弹出那张小卡的入口要先弹卡、一个字都不注入（`injectSetupDecision(..., {allowCard:true})` 返回 `'setup-card'`）；弹不出卡的入口（切换后端等）不许卡在半路，缺仓库就照旧注入建仓指引、有仓库就按缺省布局注入初始化全文；布局选过之后，注入的全文字面带着用户选的那一句布局结论，两种布局各出各的；建仓成功后的补发沿用会话里已选的布局且只补一次；最后五条是结构门禁（只允许一条注入初始化文案的路径）。

**它有没有守顺序。** 守了，而且这是八道里唯一真正在跑决策函数、从外部行为上守「先问还是先注入、注入哪一段」的门禁。它守的是注入这一段（第 ④⑤⑥⑦⑧ 条都会打到它），但它不守状态栏条与条之间的优先级，也不守检查页行的排序。

**新顺序下要改或要删的断言。**

- `tests/verify-655-setup-layout.js:121-123`（最重要）：
  - `:121` `ok(kind === 'repo', tag + ' → 照旧改发建仓指引（实得 ' + kind + '）')`
  - `:122` `ok(injected.length === before + 1 && injected[injected.length - 1] === repoFixOf(backend).zh, tag + ' → 建仓指引确实注入了，不是「什么都没发生」')`
  - `:123` `ok(st.pendingSetupAfterPublish === true, tag + ' → 记下了「建仓成功后补发一次」的标记')`

  这三条正是「缺仓库时把长指引注入会话」。第 ⑤ 条要求改成「点按钮开建仓向导、不注入」，所以第 122 条必须删（它断言的就是那句长文案被注入），第 121 条要改成新档位（例如开向导），第 123 条随补发机制的去留定。
- `tests/verify-655-setup-layout.js:98-104` 的循环里 `hasRepo=false` 那一轮：`:101` `ok(kind === 'setup-card', ...)`、`:102` `ok(injected.length === before, '布局未选 · ' + backend + ' → 一个字都没注入')`、`:103` `ok(st.setupLayoutCardOpen === true, '布局未选 · ' + backend + ' → 那张小卡被要求打开')`。现在这三条对「缺仓库」也要求「先弹布局卡」，而第 ⑤ 条第 ⑥ 条要求缺仓库时先走建仓向导、黄条要等仓库就绪才出现，所以缺仓库那一轮必须改。`hasRepo=true` 那一轮的三条仍然成立（弹卡不注入这件事本身没变，只是多了一个「仓库就绪」前提，规格应补一条新断言）。
- `tests/verify-655-setup-layout.js:138-140`（显式喂一份带 `repoRemoteFix` 的后端数据，把缺仓那档单独走一遍）：`:138` `ok(mod.injectSetupDecision(stFix, 'github') === 'repo', '带建仓指引声明的后端缺仓库时 → 走建仓指引那一档')`、`:139` `ok(injected.length === beforeFix + 1 && injected[injected.length - 1] === '先建仓库再初始化', '建仓指引的原文确实注入了')`、`:140` `ok(stFix.pendingSetupAfterPublish === true, '缺仓这一档照样记下补发标记')`。第 139 条必须删（第 ⑤ 条明说不许再注入），第 138 条要改写，第 140 条随补发机制去留。
- `tests/verify-655-setup-layout.js:224-228`（`consumePendingSetup` 补发一次、用已选的 multi 布局）：`:224` `ok(mod.consumePendingSetup(stRe) === true, '补发发生了一次')`、`:225` `ok(injected.length === n2 + 1, '补发恰好多注入一次')`、`:226` `ok(injected[injected.length - 1] === textOf('github', 'multi', 'zh'), '补发用的是本次会话已选的布局（multi），不是缺省值')`、`:227` `ok(stRe.pendingSetupAfterPublish === false, '补发标记被消费掉，不会重复补发')`、`:228` `ok(mod.consumePendingSetup(stRe) === false, '第二次调用不再补发（仅一次）')`。这一整段是否保留，取决于「建仓后补发」这条机制在新顺序里还留不留；若第 ⑥ 条改成「仓库就绪后黄条直接出现、用户点黄条再选布局」，这段要删。
- `tests/verify-655-setup-layout.js:259`：`ok(barSrc.indexOf('layoutRadios(s, h)') >= 0 && (barSrc.match(/layoutRadios\(s, h\)/g) || []).length >= 2, '那张小卡与门控弹窗里都放了这组单选')`。今天 `src/client/statusbar/StatusBar.js` 里这组单选出现两次：第 232 行（黄条下面那张卡）与第 279 行（蓝条门控弹窗）。第 ① 条要求蓝条「只问后端、不问布局」，所以第 279 行那处必须去掉，count 会变成 1，这条断言必须从 `>= 2` 改掉。这是这道门禁里唯一一条**结构**断言与新顺序直接冲突的地方。

**仍然成立的断言。** `:149-157`（布局已选 → 注入全文，且文本里就是用户选的那一句）、`:171-175`（两种布局的全文不串台）、`:179`、`:188`、`:198`、`:199`（三后端共用同一模板、点名 `docs/agents/domain.md`）、`:204-206`（选定布局后注入一次、与金样逐字相同）、`:208-212`（`injectNow:false` 只给决定不注入；`injectNow:false + allowCard` 仍然返回先问并开卡——注意这里喂的 `stCard` 是「有仓库」状态）、`:231-235`（兜底取值与入参容错）、`:238`（调试开关关着不记日志）、`:250`/`:253`/`:255`/`:257`（单漏斗结构）。`:217`（Markdown 缺仓库也直接注入）按今天的规则成立（markdown 没有 `repoCreateChain` 能力位），但如果规格对本地 Markdown 也加前置条件，这条要复核。

**测法。** 混合，主体是行为测试：把 `src/client/kernel/prompts.js` 的真源去掉行首 `export` 后用 `new Function` 求值（`:19-45`），喂假会话状态与三个后端的描述数据替身，调真的 `setupOrRepoPrompt` / `injectSetupDecision` / `consumePendingSetup` / `setupRunParamsFrom`，断言「注入了几段、注入的是哪段、开没开卡」。词表是真的（`:48-59` 直接 import 四个 locale 片段）。末尾 `:242-259` 的五条属于静态结构扫描（读 `ChecksTab.js`、`NoRepoCard.js`、`client.js`、`package/lib/client.js`、`StatusBackend.js`、`StatusBar.js` 做子串判断）。

**是否在链上。** 在，`package.json` 第 18 行 `verify` 链第 25 道，CI 也跑。

---

## tests/verify-656-subworkspace-acceptance.js

**它断言什么。** 它守的是「子目录会话归到工作区根」这件事（地图 #647 / 票 #656）：工作区根怎么判定（自带 `.git` 或自带 `docs/agents/issue-tracker.md`，谁近听谁）、四个抽屉（面板快照 / 检查链快照 / 后端绑定 / 仓库引用）按同一把钥匙分桶、写路径只落在工作区根那一份（不许多出第二套 `.scratch`、第二份 `label-colors.json`）、同一把钥匙 30 秒内只判一次且不起子进程。它跟首开引导的先后顺序没有关系。

**它有没有守顺序。** 没有。它不读 `firstBlock`、不读链目录顺序、不读注入文本、不提黄条。唯一与首开沾边的是 C3 那一段（`:429-469`）：`docs/agents/issue-tracker.md` 这个主锚文件必须读工作区根那一份，其中 `:434-438` 断言「子目录会话的『工作区已初始化』看的是工作区根那份主锚文件」、`:459-461` 断言只读工作区根那一条路径。第 ⑥ 条给黄条加的是「仓库也要就绪」这个前置条件，改的是黄条**什么时候出现**，不改「初始化判据读哪个文件」，所以这两条仍然成立。

**新顺序下要改或要删的断言。** 没有。全部照旧成立，包括 `:550` `must(chain.indexOf('verify-656-subworkspace-acceptance.js') >= 0, '本门禁已挂进 npm run verify 链（判据不靠人记得手动跑）')` 与 `:553`、`:556`（另外两道门禁的入链检查）。

**测法。** 混合，主体是行为测试：真在临时目录里造一棵夹具树（`:102-141`），跑真的 `src/host/workspaceKey.js`、`workspaceCwd.js`、`tracker/registryCore.js`、`markdown/path.js`、`markdown/label-colors.js`、`remotePredicates.js`、`detection/explicitDetector.js`，客户端那两个抽屉是把 `store-snapshot.js` / `store-prefs.js` 的片段取出来用 `new Function` 求值后真跑。另一部分是静态：`:492-501`、`:506-512`、`:515-525`、`:529-543` 用正则扫 `workspaceKey.js`、`repoKeys.js`、`detectChain.js`、`sessionSnapshot.js` 等源码，`:547-562` 读 `package.json` 与另一个门禁文件做子串判断。

**是否在链上。** 在，`verify` 链第 111 道（共 112 道），CI 也跑。

---

## tests/verify-no-repo-redcard.js

**它断言什么。** 它守的是「无仓库」这条 UI 线的历史定版：`NoRepoCard` 组件与它那套表单（仓库名用 cwd 尾段预填、可见性默认私有、错误条、提交 loading）必须留着，十六个 i18n 键、红色样式 token、按 cwd 的 dismiss 状态机、以及「提交调 `host.call('wf.initPublish', { cwd, name, visibility })`、成功后刷新快照与检查链」这条链路也留着；同时守「全屏红卡不再挂在列表页首屏、检查页也不再有顶部弱化卡与重置入口」，远端未关联改由检查页行内那一行表达。

**它有没有守顺序。** 大部分没有：不读 `firstBlock`、不读目录顺序、不读注入文本。与顺序沾边的是两处：一是它把 `NoRepoCard` 那条**另一位**的建仓通道钉住了（它是内联一行式表单，不是 `gh:remote` 那条两步向导），二是 `:104` `check(cli.includes("remoteBad") && cli.includes("remoteStep && remoteStep.status"), 'client ChecksTab 保留 remote 判定（行内红卡源）')` 把检查页行内的远端判定钉住了——第 ⑤ 条那颗按钮就长在这一行上。

**新顺序下要改或要删的断言。** 分两种情况，取决于规格怎么处置 `NoRepoCard`：

- 情况一（**保持 `NoRepoCard` 现状**）：它今天已经不挂在任何页面上了——全仓库搜 `h(NoRepoCard` 零命中，`src/client/views/ListTab.js:227` 的注释写着「全屏红卡（NoRepoCard）不再挂载于列表页顶部」，也就是说这是一份被门禁钉住的死代码。若规格只是让 `gh:remote` 的向导成为入口、不动这份组件，**这道门禁今天整份仍然通过，可以不动**。
- 情况二（**规格决定退役 `NoRepoCard`**，理由：第 ⑤ 条点名要开的是「现成的两步建仓向导」，而那套向导在 `gh:remote` 的失败动作里，`NoRepoCard` 是第二套形状不同的建仓表单）：下面这些要删或要改——`:80-96`（组件与表单十三条：`:80` `cli.includes("const NoRepoCard") && cli.includes("Ic({ n: 'alert'")`、`:82` `tr('panel.noRepoCardTitle')` / `tr('panel.noRepoCardDesc')`、`:83` `panel.noRepoCardAction` / `panel.noRepoCardDismiss`、`:84` `tr('panel.noRepoFormName')` + `cwdBasename(st.cwd)`、`:85` `panel.noRepoFormNameHint`、`:86` `panel.noRepoFormVisibility` / `Private` / `Public`、`:87` `visibility === 'private'` + `visibility === 'public'`、`:88` `className: 'err'` + `card.error`、`:89` `card.loading` + `panel.noRepoFormSubmitting` + `dsws-spinner`、`:90` `isNoRepoNameValid(card.name)` + `disabled: card.loading || !isValid`）、`:92-96`（提交链路：`host.call('wf.initPublish'` + `name: card.name` + `visibility: card.visibility`、`loadSnapshot(st, true, true)` + `loadChain(st, true)`）、`:34-45`（十六个 zh 键与八个 errorKind 键）、`:47-53`（红色样式 token）、`:56-68`（dismiss 前缀、`cwdHash`、`isNoRepoDismissed` / `setNoRepoDismissed`、`ensureNoRepoCard`）、`:108-116`（产物特征、dismiss 按 cwd、visibility 默认私有且不持久化、不加 description）。
- 无论哪种情况，`:104`（检查页保留 `remoteBad` 行内判定）建议保留：第 ⑤ 条「仓库没就绪时不注长文案、改为开向导」这件事，入口就在这一行。

**仍然成立的断言。** `:72-73`（触发判据 `checkRepo.level === 'bad' && !isNoRepoDismissed` 保留）、`:74-77`（列表页不再挂全屏红卡、不再有 `nBad` 环境警告红条）、`:99-103`（检查页不再挂弱化卡、不再有重置入口）、`:17-31`（宿主侧 `wf.initPublish` 与 `publishFlow.js` 的实现细节）——这些与首开顺序无关，照旧成立。

**测法。** 纯静态：读 `host.js`、`package/lib/index.js`、`src/host/publishFlow.js`、`package/lib/publishFlow.js`、`client.js`、`package/lib/client.js` 六个文件做子串判断（含若干反向断言，即「不许出现」），不执行任何代码。

**是否在链上。** 在，`verify` 链第 29 道，CI 也跑。

---

## tests/verify-setup-describe.js

**它断言什么。** 它守 #230（setup 提示词后端描述数据化）：三个后端在客户端词表里的 `trackerLine` / `trackerChoice` / `backendNote` 必须逐字节等于历史金样；初始化的注入全文必须与金样逐字相同（github / gitlab 全文等价、markdown 只少「标签齐全」那一条）；占位符取值与工作区状态无关；后端确实声明了四个 `setupPrompt` 键、宿主确实转发；最后是「客户端零残留」扫描。

**它有没有守顺序。** 没有守条与条的先后，但它守的正是第 ⑧ 条要动手的那份文本：`{backendNote}` 的金样值，也就是初始化注入全文最后那一句「本次已选后端：GitHub — ……」。这道门禁是「注入全文长什么样」的唯一金样锁。

**新顺序下要改或要删的断言。**

- `tests/verify-setup-describe.js:27`（最重要）。该行在文件里是拼接写法，`ARROW` 与 `EMDASH` 是第 20、21 行的常量（`String.fromCharCode(0x2192)` 即 `→`、`String.fromCharCode(0x2014)` 即 `—`），原文逐字为：
  `github: { trackerLine: '本仓库为 GitHub ' + ARROW + ' 提议 GitHub Issues', trackerChoice: 'GitHub Issues', backendNote: '\n\n本次已选后端：GitHub ' + EMDASH + ' 若此目录还没有关联 GitHub 远端，先停下：向用户确认仓库名与可见性（公开还是私有），然后自己用建仓命令建好并推送（等价 gh repo create <name> --public/--private --source=. --push，非 Git 目录先 git init），或请用户在面板环境检查中点「创建并发布」向导完成；建仓成功并重查变绿后，再按 GitHub 模板生成 docs/agents/issue-tracker.md' }`
  它期望的值就是 `src/client/kernel/locale-panel.js:68` 的 `'setup.github.backendNote'`。第 ⑧ 条要求去掉破折号之后那一段，金样必须同步改成只剩破折号前面那半句。
- `tests/verify-setup-describe.js:33`（英文同一条，同样用 `+ EMDASH +` 拼接），`backendNote` 全文逐字为：
  `'\n\nSelected backend: GitHub ' + EMDASH + ' if this directory is not linked to a GitHub remote yet, stop: confirm the repo name and visibility (public/private) with the user, then create and push it yourself (equivalent to gh repo create <name> --public/--private --source=. --push; git init first outside a Git repo), or ask the user to finish the "Create & publish" wizard in the panel environment checks; only after the repo rows turn green on re-check, generate docs/agents/issue-tracker.md from the GitHub template.'`
  同样去尾。
- `tests/verify-setup-describe.js:149`：`check(dict[resolvedKey] === G[lang][b][f], lang + '/' + b + '.' + f + ' == 金样（键 ' + resolvedKey + '）')`。这条是「词表值等于金样」，词表一改它自动跟着走，不用改判据本身，但改完金样之前它会红。
- `tests/verify-setup-describe.js:177`：`check(got === want, lang + ' · ' + b + ' · ' + tag + ' setupRun 全文与金样逐字相同' + …)`。同上，全文比对跟着金样走。
- `tests/verify-setup-describe.js:186`：`check(P.promptText('setupRun', P.setupRunParamsFrom(stubs, 'github', L.zh)) === fill(P.PROMPTS.setupRun.zh, P.setupRunParamsFrom(stubs, 'github', L.zh)), 'promptText 替换算法与门禁 fill 一致（zh 全等）')`。**这条取决于实现方式**：若第 ⑧ 条是「直接改词表里的 `setup.github.backendNote`」（把尾巴从词表删掉），这条仍然成立；若是「词表不动、在注入时把破折号之后截掉」，那 `promptText` 的结果就不再等于 `fill(模板, 参数)`，这条必须改。写规格时应显式二选一，否则实现者会在两个地方各切一刀。
- `tests/verify-setup-describe.js:24` 那条注释（`#512 收敛注记：GitHub 后端说明金样已同步到 #496 落地的先建仓说法…`）不是断言，但它描述的就是要被推翻的那版说法，改金样时一并更新。

**仍然成立的断言。** `:102`（四个 `setupPrompt` 键都声明）、`:105`（不许声明 `paletteNote`）、`:116`（宿主转发 `setupPrompt`）、`:120`（双语键齐全）、`:123`（不许复活 `setup.markdown.paletteNote`）、`:125-133`（布局这组键中英都在且非空、后端不声明布局键、两种布局金样不同）、`:134-140`、`:153`（markdown `labelReqs` 为空）、`:156`、`:160`、`:162`、`:178`、`:182`、`:188`、`:197-199`（不许出现旧调色盘文案）、`:204`、`:206`（github 仍要求标签齐全）、`:207`（注入文本以 `/setup-matt-pocock-skills` 开头）、`:210-211`、`:216`（不留悬空 `{contextLayout}`）、`:221-223`、`:249`（零残留扫描）。这些都不涉及那段尾巴。

**测法。** 混合：真的 `import` 了 `src/client/kernel/prompts.js` 与四个 locale 片段，真的调 `setupRunParamsFrom` / `promptText` / `setupRunPrompt` 并跟金样逐字比（171 条）；另一半是静态扫描（`:74` 的 `stripComments` + 逐行正则，扫 `src/client` 全树与 `client.js` / `package/lib/client.js` 两个产物）。

**是否在链上。** 在，`verify` 链第 42 道，CI 也跑。

---

## tests/verify-deck-slots.js

**它断言什么。** 它守 ADR #221 的五个槽位（banner-seat / dock-seat / statusbar-seat / modal-seat / toast-seat）与「弹窗只在 `fail + (form|wizard)` 时挂」这条挂接规则；后端修复契约那一节（`:134-156`）守的是 `gh:remote` 与 `gh:repoAccess` 两条失败知识都带「创建并发布」的 form/wizard 动作、提交到 `wf.initPublish`、仓库名有 `A-Za-z0-9` 的 pattern、可见性用 single；后面是检查页挂接、弹窗外观交互、以及 #319 的多步分页与步进导航。

**它有没有守顺序。** 没有。它不读 `firstBlock`、不读链目录顺序、不读注入文本、不提黄条与布局卡。它守的是第 ⑤ 条要复用的那个动作的形状（两步向导、`wf.initPublish`、仓库名校验、可见性单选），但不守「什么时候弹它」。

**新顺序下要改或要删的断言。** 没有必须改的。逐条核对如下：

- `:137` `check(gh.includes("gh:remote"), 'github/index.js 含 gh:remote')`、`:138`（含 `gh:repoAccess`）：成立。
- `:140-141` `const hasRemoteForm = gh.includes("'gh:remote'") && gh.slice(…).includes("type: 'form'") || gh.includes('gh:remote') && gh.includes("Create & publish")` 与 `check(hasRemoteForm, 'gh:remote 含 form[创建并发布]')`：判据很松，只要文件里有 `Create & publish` 就过；今天 `gh:remote` 已经是两步 wizard 且标签是「创建并发布 / Create & publish」，成立。
- `:143-147`（`gh:repoAccess` 的动作块含 `type: 'wizard'` 或 `form`、含 `wf.initPublish`、含 `name` + `visibility`、含 `pattern` + `A-Za-z0-9`）、`:149-151`（两条 schema 都有 `single`）：成立，且第 ⑤ 条要复用的正是这个形状。
- `:154-155` `check(fc.includes('attachFixContract'), 'fixContract.js 含 attachFixContract')` 与 `check(fc.includes("type === 'form'"), 'fixContract 处理 form 动作')`：成立。`src/host/tracker/fixContract.js:115` 已经同时处理 form 与 wizard，所以就算动作类型从 form 换成 wizard，这条也只是「要求 form 处理仍在」，不冲突。
- `:163`（检查页已移除 form 过滤）、`:166`/`:169`/`:170`（`renderForm` 走弹窗、挂 `FormModalSeat`）：成立。

**测法。** 混合：一部分真跑（`await import('../src/shared/ui/slots.js')` 与 kernel 版本，真调 `shouldShowInModal` / `getFormAction` / `getWizardAction` / `getWizardSteps` / `validateAction`，见 `:70-131`、`:268-282`），一部分是静态扫描（读 `slots.js`、`github/index.js`、`fixContract.js`、`ChecksTab.js`、`ChainRenderer.js`、`slotRenderer-三文件`、`styles.js`、`client.js`、`package/lib/client.js` 做子串判断）。

**是否在链上。** 不在。这条要在写规格时留意：它是唯一守住 `gh:remote` 动作形状的门禁，却不在 `npm run verify` 里，改动了也不会有自动检查提示。

---

## 交叉结论（八道之外，写规格时会用到）

1. **没有一道门禁在守「条与条的优先级」。** 八道里没有任何一条读 `src/client/statusbar/StatusBar.js:142` 的 `firstBlock`，也没有任何一条断言「黄条要等仓库就绪才出现」。全仓库搜 `firstBlock`，只有 `tests/verify-capsule-narrow.js:86-88` 在断言那段 JSX 的 flex 样式，与优先级无关。也就是说，第 ⑥ 条（黄条必须等 gh cli + 登录 + 远端仓库都就绪）目前没有任何自动检查在守，写规格时要新配一道。
2. **没有一道门禁在守检查页的行序。** 八道里没有一条读 `src/shared/tracker/check-catalog-dirs.js`。链外提到 `gh:installed` 的只有 `tests/verify-chain-renderer.js:193-194`（只查 markdown 目录没有、github 目录有，不查排在第几）与 `tests/verify-generic-catalog.js:140`（转换函数），都不锁顺序。第 ④ 条「把 `gh:remote` 排到 `gh:installed` 之后」也需要新配门禁。
3. **四道不在链上，其中两道已经是红的。** `tests/verify-issue195.js`（4 条红：`client.js` 与 `package/lib/client.js` 的 `ghCliBad` 判据、`host.js` 与 `package/lib/index.js` 的 `det.preflight.prompt` 透传）与 `tests/verify-496b-inject-guard.js`（1 条红：`StatusBackend` 三处决策器调用，正则匹配 `injectSetupDecision(s,id)` 得 0）今天跑就已经失败。它们现在的作用更像历史契约文档，不像门禁；写规格时要决定是修好并挂回链上，还是明确作废。
4. **第 ③ 条会牵动链外的三处断言**（不在本次调查的八道里，但会红）：`src/host/tracker/backends/github/preflight.js:20` 的 `GH_INSTALL_PROMPT` 是宿主全树唯一的 `*_PROMPT` 常量，`tests/verify-prompts.js:69`（`const EXPECT_HOST_PROMPT_CONSTS = 1`，注释写明「今天只有 GH_INSTALL_PROMPT」）与 `:83`（`'S4#GH_INSTALL_PROMPT'`）按这条计数；`tests/verify-prompts.js:100` 的 `'backend:github': ['ensureLabels', 'repoAccessFix', 'repoRemoteFix']` 按名字清点 github 后端的提示词键。若第 ③ 条退役那段长安装提示词、或第 ⑤ 条退役 `repoRemoteFix` 这段文本，这两处要同步改。
5. **第 ⑧ 条有两种实现方式，门禁红点不一样**（见 `tests/verify-setup-describe.js:186` 那一条）：改词表 → 只动金样；注入时截断 → 还要改 `promptText` 与 `fill` 的一致性判据。规格里应写明选哪一种，否则实现者可能在两处各切一刀，出现「词表已去尾、注入时又截一次」的双重改动。
6. **第 ⑤ 条「开的是哪一套向导」需要拍板。** 仓库里现在有两套建仓表单：`gh:remote`（与 `gh:repoAccess`）失败动作里的两步 wizard（仓库名 → 可见性，提交 `wf.initPublish`，见 `src/host/tracker/backends/github/index.js:62-83`），以及 `src/client/views/NoRepoCard.js` 里一套内联的一步式表单（同样是 `wf.initPublish`，但形状不同，且今天已经不再挂载）。第 ⑤ 条说「开现成的两步向导」，按字面就是前者；后者是否随之退役，直接决定 `tests/verify-no-repo-redcard.js` 是整份保留还是大半作废。
