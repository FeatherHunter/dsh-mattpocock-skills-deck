# #1363 研究笔记：首次运行的状态栏一条横幅都不出，与初始化提示词里的措辞（2026-10-22）

所属：GitHub issue #1363。本笔记只回答该票的两个开放问题——问题 A「选定后端之后，状态栏一条提示条都不出」与问题 B「注入的初始化提示词与用户已选布局对不上」。已有的 `research/1220-recheck-2026-10-21.md`、`research/1210-round2-log-verification.md`、`research/660-onboarding-chain-recon.md` 都不回答这两个问题。

核查日期：2026-10-22。核查人：agent（会话内直读仓库源码与本机诊断数据；没有修改任何源码、测试、脚本与构建产物，没有建票、评论、关票，没有跑测试与构建，也没有提交）。

口径：本文里的事实分两类，逐条标明。**读代码核实**的是源码里能逐行指认的部分；**未能核实**的是必须真机运行才能确认的部分——本次拿不到出问题时那一刻的链快照与宿主日志（见第四节），凡是需要真机才能判定的，本文写成「若……则……」，不写成断言。另需说明：本文由两路并行的只读调查合流写成——第一节到第五节是其中一路的产出，第六节是另一路的增量，两路在主线结论上互相印证，没有互相否证的地方。

触发：维护者报告两件事。其一，在一个全新的空工作区里选定 GitHub 后端之后，状态栏一条提示条都不出（预期出「这个目录还没有关联远端仓库」或「该工作区尚未初始化」），右侧面板头部却显示琥珀色「未识别仓库」；其二，选了 Markdown 后端与「各部分共用一套用语」的布局，注入进会话的初始化提示词却写着「请按本地 Markdown 模板生成 docs/agents/issue-tracker.md（.scratch 结构）」，并含「本仓库为本地文件 → 提议 Local markdown，由用户确认」与结尾的「本次已选后端：Markdown」。

本文只记事实与坐标，不写结论；结论由维护者定。

---

## 一、问题 A：选定后端之后，状态栏一条提示条都不出

### 1.1 横幅是链快照的纯派生物

- 步骤清单的真源在 `src/shared/tracker/guide-steps.ts:76-139`，六步依次是：`selection:backendSelected`（第 1 步，`:80-87`，`ready` 是 gate）、`gh:installed`（`:90-97`）、`gh:authed`（`:100-107`）、`gh:remote`（`:111-118`，`blocksSetup: true`）、`tracker:initialized`（`:121-128`）、`skill:wayfinder`（`:131-138`）。按后端过滤在 `guideStepsFor`（`:147-155`），GitHub 专属的三步只对 `github` 生效。
- 挑出该出哪一条横幅的是 `src/client/statusbar/bannerChain.ts:94-114` 的 `guideBannerStep(st, gateOpen)`。
- 状态栏调它的地方：`src/client/statusbar/StatusBar.ts:281` `const bannerStep = guideBannerStep(s, _gateActive || _backendUndecided)`；没有横幅时只画胶囊与弹窗座位（`:460-462`），有横幅时画条（`:487-506`）。

### 1.2 「一条都不出」的确切条件（读代码核实）

`guideBannerStep` 的判定顺序（`bannerChain.ts:106-113`）：

1. `:106`：若当前这一步 `blocksSetup === true` 而它**在链快照里查不到行**，立刻 `return null`——整条横幅链到此为止，一条都不出。
2. `:107`：没有横幅词条的那一步跳过。
3. `:108`：`ready === 'gate'` 的那一步（`selection:backendSelected`）只读界面门控状态 `gateOpen`，不读链快照；`gateOpen` 为真才出蓝条，为假就跳过。
4. `:109`：不在链快照里露行的步骤跳过。
5. `:110`：在链快照里露行、且没全过（`guideStepDone`，`guide-steps.ts:164-178`）的那一步被返回，它带自己的横幅词条。
6. `:112-113`：一轮走完返回 `null`。

因此「选定后端之后一条都不出」只有两种可能：

- **情形一**：清单里挡着初始化的那一步（GitHub 路径是 `gh:remote`）在链快照里没有行，于是 `:106` 提前返回空。**这是本次症状的机制**，原因见 1.4 与 1.5。
- **情形二**：链快照里每一步都已经过了，一轮走完落到 `:112` 的空。这种情况下不出横幅是对的。

门控蓝条在选定后端之后不会出现：`_backendUndecided` 要求「会话里根本没有后端 id」（`StatusBar.ts:272`），`_gateActive` 只在「后端为空且不在探测中」或「正处在探测的过渡态」时为真（`StatusBar.ts:192-194`、`:267-268`），选定后端之后两者都为假。

### 1.3 链快照要长什么样才有横幅

`stepPresent`（`bannerChain.ts:79-83`）的判据是：清单这一步的 `checks` 里有**任意一个 id 能在链快照的步骤数组里查到**。链快照的步骤数组在客户端是 `st.chainSnapshot.steps`（`src/client/kernel/probe-chain.ts:213`），由宿主算好后随回包发下来（`probe-chain.ts:179-189`）。

对 GitHub 后端，快照里必须出现的行（行 id 就是检查目录里的项 id）：

| 清单步骤 | 快照里要有的行 id | 这一行不在会怎样 | 这一行在但没过会出哪条横幅 |
|---|---|---|---|
| `selection:backendSelected` | `selection:backendSelected`（通用段，`src/shared/tracker/check-catalog-views.ts:168-174`） | 不影响横幅（这一步读界面状态，不读快照） | 不出横幅（这一步是 gate 档，出的是蓝条） |
| `gh:installed` | `gh:installed`（`src/tracker/rooms/github/checks.ts:30-36`） | `:109` 跳过 | `banner.ghcli`（`config/copy/panel.yaml:53`） |
| `gh:authed` | `gh:authed`（`checks.ts:38-44`） | `:109` 跳过 | `banner.ghauth`（`panel.yaml:55`） |
| `gh:remote` | `gh:remote`（`checks.ts:22-28`） | **`:106` 整条链返回空 → 一条都不出** | `banner.repo`「这个目录还没有关联远端仓库」（`panel.yaml:59`） |
| `tracker:initialized` | `tracker:initialized`（`check-catalog-views.ts:156-162`） | `:109` 跳过 | `banner.setup`「该工作区尚未初始化」（`panel.yaml:41`） |
| `skill:wayfinder` | `skill:wayfinder` 等三项之一（`guide-steps.ts:132`） | `:109` 跳过 | `banner.skills`（`panel.yaml:42`） |

一个空目录里没有 git 远端时，`gh:remote` 这一行**是有的、且状态是失败**：`src/host/detectChain.ts:293-301` 里取不到 owner/name 就判 fail，detail 写「未找到 GitHub 仓库关联（git remote 未指向 GitHub）」。也就是说，只要宿主把 GitHub 后端链算出来并把快照送到客户端，这一行就在，横幅应当出「这个目录还没有关联远端仓库」。

### 1.4 后端链为什么可能整段没组装

- 宿主只有在**认出了后端**的时候才去算后端链：`src/host/detectChain.ts:377-416`，`if (backendId)` 才会取该后端的检查目录并求值。`backendId` 为空，后端链整段没有，快照里就没有 `gh:installed`／`gh:authed`／`gh:remote` 这几行，于是按 1.2 的情形一，一条横幅都不出。
- 后端 id 的三个来源（`detectChain.ts:261-271`）：探测认出来的后端（`selDetected.backendId`）；探测给出「显式空」（`source === 'explicit'` 且 `backendId === null`，例如空目录被判过期）时判为「没有后端」；两者都没有时用客户端上报的 `args.backendId`。
- 客户端那一路现在**上报不了**：`src/client/kernel/store-prefs.ts:273-275` 写着「#1003 退役：宿主直接读文件，不再需要客户端上报『亲手选的哪条 + 版本号』」，`userHintOf` 直接返回 `undefined`；调用点 `src/client/kernel/probe-chain.ts:157-158` 因此永远不带 `backendId`。
- 宿主认后端的唯一真源是工作区里的配置文件：`src/tracker/detection/detectionService.ts:337-343`（每次都读锚文件）。写入口只有 `wf.bind`：`src/host/workspaceCwd.ts:107-111`（写成功才算这次选择生效），写失败回 `kind: 'workspace-file-failed'`（`:112-121`）。
- 所以「宿主认不出 GitHub」只有两种现实原因：绑定没写成功（`workspace-file-failed`），或者宿主这一轮拿到的是**一份旧的链快照**（下一小节）。

### 1.5 旧快照这一路：退避把「选之前」的那份回包原样递了回来（读代码核实）

- 链回包的缓存键是 `cwd + '|' + (args.backendId || '') + '|' + 语言`（`detectChain.ts:230`）。客户端不再上报后端 id（见 1.4），所以**选之前与选之后共用同一把键**。
- 求值之前先问退避：`detectChain.ts:236-242`，`if (!v.needed) return v.cached`——直接把上一份完整回包原样返回。`force` **不能**绕过退避，只有 `trigger === 'user-recheck'`（人亲手点「重新检查」）才无条件真算（`src/host/refresh/chainBackoff.ts:127-130`；`detectChain.ts:231-232` 的注释写着「其余三种事件按退避判，挡下的那一次直接回上一份快照」）。
- 退避档位是 8 秒、30 秒、120 秒、300 秒（`src/shared/time-config/src/values.ts:315`），一轮求值没有进展就退一档（`src/shared/refresh/src/backoff.ts:63-66`；`chainBackoff.ts:148-156`）。
- 面板挂载时就会算一次链（`src/client/statusbar/StatusBar.ts:178`），切工作区时再算一次（`:162`）。在全新空目录里，那一次算出来的是「还没有后端」的快照：**没有后端段，因而没有 `gh:remote` 行**。
- 选定后端的当下，客户端立刻重取一次链（`src/client/statusbar/StatusBackend.ts:231`，`loadChain(s, true)`），但这次请求带的是 `force`，不是 `trigger='user-recheck'`。于是宿主按退避判定：若还在那一档的等待窗口内，就把**选之前**那份回包递回来（`chainBackoff.ts:135`、`:140`，缓存的是上一份完整回包），客户端把这份没有 `gh:remote` 行的快照写进会话（`probe-chain.ts:179-189`），命中 1.2 的情形一，**一条横幅都不出**。
- 客户端自己那份共享缓存不是原因：它的键里带会话里的后端 id（`probe-chain.ts:131`、`:139`），选定后端后键就变了，缓存不会命中旧份。
- 绑定成功**不会**把退避拉回快档：`noteWriteActivity` 只在宿主拦到一次 GitHub 写操作时被调用（`src/host/git-process.ts:291-293`），写工作区配置文件这一下不在其中（`workspaceCwd.ts:107-111`）。
- 这条症状会自己「过一会儿才好」：等退避窗口过去，或用户亲手点一次「重新检查」（带 `trigger='user-recheck'`），或发生一次会改变链的写操作。这与 `StatusBackend.ts:226-230` 记着的 2026-09-21 现场（「选完后端看不见下一步，过一会儿才出来」）是同一族现象。

**这一条是从源码推出的可能路径，不是已证实的现场结论**：判断它成不成立，要看宿主日志里有没有 `chain.backoff` 的 `decision: 'defer'`（`chainBackoff.ts:136-139`）与 `chain.cache.hit`（`detectChain.ts:240`）。

### 1.6 2026-09-21 那个「空目录被判过期工作区」的故事，今天还剩什么

`bannerChain.ts:100-106` 的注释记着 2026-09-21 的真机现场：全新空目录里，探测把「空目录」当成过期工作区、把用户刚选的后端一并作废，后端链整段没组装，快照里连仓库那一行都没有，于是黄条提前出来；`blocksSetup` 早退就是为挡住这件事加的。核对今天的代码：

- 「空目录 = 过期工作区」这条判据还在，但只在**缓存**这一条路上生效：`src/tracker/detection/detectionService.ts:297-299`（缓存里有后端时才判 `isWorkspaceEmpty`），而强制求值整段跳过缓存（`:289`）。链求值走的正是强制路径（`detectChain.ts:257` 把 `force` 透传给检测服务）。
- 「后端被作废」这一半今天基本被三道闸挡住：工作区配置文件是唯一真源（`detectionService.ts:337-345`）、选择裁决里「调用方上报的选择不是一层」（`src/tracker/detection/selection-precedence.ts:13-21`、`:61-67`）、只有显式空才判「没有后端」（`detectChain.ts:267-268`；而 `source='explicit'` 一定带 backendId，见 `src/tracker/detection/backendDecision.ts:382-396`）。
- 所以今天「后端被作废、整条链没组装」这条路在强制求值下已经很难走通；**剩下的现实缺口是 1.5 那一路**——链快照没跟上，而不是后端被作废。1.2 的早退把「快照没跟上」翻译成了「一条横幅都不出」。

### 1.7 右侧面板那颗琥珀色「未识别仓库」芯片

- `src/client/panel/Dock.ts:246` 取仓库引用（`s.repository` 或快照里的 `repository`），`:247` 取选择（`s.selection` 或快照里的 `selection`）；`:253-255` **仓库引用没有、但后端选了**，画琥珀色芯片，文案 `panel.repoUnidentified`；`:257` 连后端都没有，画红色芯片 `panel.noRepo`。
- 全新空目录里没有 git 远端，仓库引用为空是**正常的**；后端选了 GitHub，琥珀色芯片是**符合预期的**（`:253-255` 的注释写着「诚实警示，不冒充仓库名」）。
- 芯片本身没坏。它的信息量在于：客户端认为「后端是 GitHub」，而宿主发来的链快照里连 GitHub 的行都没有——这两件事同时成立，才与 1.5 那条路径对得上。
- 客户端这份「后端是 GitHub」是乐观写的：`src/client/statusbar/StatusBackend.ts:225` 在发 `wf.bind` 之前就把 `s.selection` 写成用户选的那条，绑定失败才回滚（`:232`）。绑定失败时芯片会是红色（没有后端），所以**「琥珀色 + 没有横幅」这个组合更像 1.5 那一路，而不是绑定写失败**。

### 1.8 修复者要动的最小事实集

按 1.2 与 1.3，出横幅要同时满足三件事：

1. 链快照里有 `gh:remote` 这一行，以及它前面的 `gh:installed`、`gh:authed`。
2. 宿主这一轮认得出后端是 GitHub（工作区配置文件里写着 GitHub，且这一轮真的算了后端链）。
3. 客户端手上那份快照是**选后端之后**算出来的那一份，不是退避递回来的旧份。

对应到源码上要改的事实（按排查优先级排）：

| 序号 | 事实 | 坐标 | 改了会怎样 |
|---|---|---|---|
| 1 | 选后端之后那一次重取链没有带 `trigger='user-recheck'`，于是被退避挡下、旧快照原样递回 | `src/client/statusbar/StatusBackend.ts:231`（重取链）、`src/host/detectChain.ts:236-242`（退避）、`src/host/refresh/chainBackoff.ts:127-130`（只有 user-recheck 不降档） | 选定后端立刻重算一次链，横幅当场出 |
| 2 | 链的缓存键里那一段后端 id 现在恒为空（客户端不再上报），选前与选后共用一把键 | `src/host/detectChain.ts:230` 与 `src/client/kernel/store-prefs.ts:273-275` | 键里带上真实后端 id，选前后的缓存不互相污染 |
| 3 | 「挡着初始化的那一步没露行」被翻译成「整条链返回空、一条都不出」 | `src/client/statusbar/bannerChain.ts:106` | 可以在这之前退回显示「后端未定」那一档，而不是什么都不显示 |
| 4 | 绑定写进工作区文件这一下不重置退避 | `src/host/workspaceCwd.ts:107-111` 对照 `src/host/git-process.ts:291-293` | 绑定成功后把退避拉回快档（`noteWriteActivity`） |

其中第 1 条最小：只改这一次请求带什么 trigger，不动判定逻辑。

### 1.9 问题 A 没能从源码判定的部分

- 出问题那一刻链快照里到底有没有 `gh:remote` 行——本机拿不到：插件日志目录 `C:\Users\<用户>\.dsh\logs\dsh-mattpocock-skills-deck\` 里最新只有 2026-10-15.log（577 字节），没有本次场景的 `chain.backoff`／`guide.banner` 记录。
- 宿主退避当时退到第几档（档位只在内存里，`chainBackoff.ts:58`）。
- 用户点「确认」时绑定有没有写成功（写失败会落 `host.call.fail`、`method: 'wf.bind.workspaceFile'`，`src/host/workspaceCwd.ts:116`）。

真机上要看的三行日志：`chain.backoff`（`decision`／`reason`／`waitMs`／`step`，`chainBackoff.ts:136-139`）、`chain.cache.hit`（`deferred: true`，`detectChain.ts:240`）、`guide.banner`（`outcome: 'shown' | 'cleared'`，`src/client/statusbar/StatusBar.ts:286-301`）。

---

## 二、问题 B：注入的初始化提示词与用户已选布局对不上

### 2.1 注入文本的拼装路径（读代码核实）

1. 触发：状态栏那条黄条上的「帮我执行 初始化 /setup-matt-pocock-skills」按钮（`config/copy/panel.yaml:44`）。清单里这一步的缺失动作是注入 `setupRun`（`guide-steps.ts:35`），点下去走 `src/client/statusbar/bannerChain.ts:273-278` → `src/client/statusbar/StatusBackend.ts:208-211` 的 `onStatusSetupInit` → `src/client/kernel/prompts-setup.ts:35-76` 的 `injectSetupDecision`。
2. `injectSetupDecision` 先判「挡着初始化的那一步过没过」（`prompts-setup.ts:36-37`、`:45-48`；判据在 `src/client/kernel/prompts.ts:280-295`）——没过就一个字都不注入。再判要不要先弹那张布局小卡（`prompts-setup.ts:30-34`、`:48-59`）。都不拦时走 `setupOrRepoPrompt`（`prompts.ts:296-316`）。
3. `setupOrRepoPrompt` 取这次该用的布局：会话状态里的 `st.setupLayout`，没有就用按工作区记住的那一份，都没有就按缺省 `single`（`prompts.ts:221`、`:297`、`:215`）。
4. `setupRunPrompt`（`prompts.ts:253-262`）取后端 id（会话的 `s.selection` → 快照的 `selection` → 按工作区缓存的那份，`:254-259`），再调 `setupRunParamsFrom(st.backendModules, id, null, layout)`（`:225-248`）解析占位符的值。
5. `setupRunParamsFrom` 按后端 id 在后端模块表里找那一份声明（`:226-228`），取它声明的四个 locale 键（`:229`、`:242-244`），再单独取布局那一句话（`:245-246`）。
6. 最后 `promptText('setupRun', params)`（`prompts.ts:176-189`）取模板正文并把占位符换掉（`:187`）。模板正文真源是 `config/prompts/workspace-initialization.yaml:10-16`；客户端读的是构建时生成的 `PROMPT_TEMPLATE_DATA`（`prompts.ts:26-28`）。

### 2.2 被引用的三段文字分别来自哪里

| 用户引用的文字 | 出处 | 性质 |
|---|---|---|
| 「本仓库为本地文件 → 提议 Local markdown」 | locale 键 `setup.markdown.trackerLine`，`config/copy/panel.yaml:79` | **静态模板文本**（Markdown 后端自己声明的那一份） |
| 「本次已选后端：Markdown — 请按本地 Markdown 模板生成 docs/agents/issue-tracker.md（.scratch 结构）」 | locale 键 `setup.markdown.backendNote`，`config/copy/panel.yaml:84` | **静态模板文本** |
| 「由用户确认」 | 模板正文第 1 条，`config/prompts/workspace-initialization.yaml:14` | **静态模板文本**（后面接的是被填进去的 `{trackerLine}`） |

这两条 locale 键是 Markdown 后端自己声明的：`src/tracker/rooms/markdown/index.ts:390-395`（`setupPrompt` 声明 `setup.markdown.trackerLine`／`trackerChoice`／`backendNote`／`labelReqs`，其中 `backendNote` 在 `:393`），GitHub 与 GitLab 各自声明同形的四键（`src/tracker/rooms/github/index.ts:213-218`、`src/tracker/rooms/gitlab/index.ts:364-369`）。后端模块从 `wf.registry` 转到会话的 `st.backendModules`（`src/host/snapshotBuild.ts:372-373`）。

「.scratch 结构」这五个字全仓只有两处：`config/copy/panel.yaml:84` 与金样测试 `tests/verify-setup-describe.ts:43`。

### 2.3 「.scratch 结构」是模板文本，不是被填进去的值

不是。理由三条：

1. 它是 `setup.markdown.backendNote` 这条 locale 文本的一部分（`panel.yaml:84`），而这条文本是 Markdown 后端声明的固定键（`markdown/index.ts:393`），解析时整条取出来（`prompts.ts:242-244`），不经过任何按布局变化的分支。
2. 布局走的是**另一个占位符**：`{contextLayout}`（`config/prompts/workspace-initialization.yaml:3-8`，正文第 3 条在 `:16`），它的值来自 `setup.layout.single`／`setup.layout.multi`（`prompts.ts:214`、`:245-246`；文案在 `config/copy/pages.yaml:22-23`）。
3. `.scratch` 目录是**本地 Markdown 后端存票的地方**，与「域文档布局」（根目录一份 GLOSSARY.md 还是子项目各一份）是两件事：`src/tracker/rooms/README.md:9`、`src/tracker/rooms/markdown/path.ts:28-29`、`src/tracker/kernel/identity-keys.ts:11`；布局的含义见 `src/shared/doc-layout/src/layouts.ts:5`、`src/shared/config-store/src/workspace.ts:43`。

也就是说：用户选「各部分共用一套用语」（single）之后，注入文本里**仍然会有** single-context 那一句（`setup.layout.single`，`pages.yaml:22`），而「.scratch 结构」那一句从头到尾就是 Markdown 后端的模板文本，与布局无关。**用户预期里「提到 .scratch 就是没按布局走」这一条，与代码不符**；若要满足「注入文本里不出现 .scratch」，要改的是 locale 文本（`panel.yaml:84`），不是布局这条线。

### 2.4 注入文本确实又让用户确认了一次后端

模板第 1 条是「1. 按技能流程选择 issue tracker：{trackerLine}，由用户确认；」（`workspace-initialization.yaml:14`）。把 Markdown 后端的 `{trackerLine}` 填进去，整句就是「1. 按技能流程选择 issue tracker：本仓库为本地文件 → 提议 Local markdown，由用户确认；」——**后端在门控那一步已经选过并确认过了，注入文本却又请用户确认一次**。第 2 条再写「issue tracker 选择 Local markdown」（`:15` 加上 `panel.yaml:80`），结尾的 `{backendNote}` 再说一次「本次已选后端：Markdown …」（`panel.yaml:84`）。同一段文本里既有「本次已选后端：Markdown」，又有「由用户确认」。

这是模板的统一写法带来的，不是 Markdown 独有：`config/prompts/workspace-initialization.yaml:9` 的使用说明记着「v13 #664 GitHub 那份 backendNote 只留『本次已选后端：GitHub。』」——GitHub 那一份被削短了，Markdown 这一份仍带着「请按本地 Markdown 模板生成 …（.scratch 结构）」的指令。

另外，注入文本里「本仓库为本地文件」这句描述的是后端，不是工作区：一个刚建出来的空目录并不是「仓库」。

### 2.5 与用户预期相矛盾的地方（逐条）

| 用户的预期 | 代码里的事实 | 判定 |
|---|---|---|
| 选了 single 之后，注入文本不该再提别的布局 | 布局由 `{contextLayout}` 单独一句表达，值取自 `st.setupLayout` 或按工作区记住的那份（`prompts.ts:221`、`:245-246`），缺省 `single`（`:215`） | 与预期一致（但这一句是不是真的进了会话，要真机文本才能确认） |
| 「.scratch 结构」是与布局有关的措辞 | 它是 Markdown 后端的 locale 文本（`panel.yaml:84`），与布局无关 | **矛盾**（对用户的理解而言） |
| 后端已经选过，注入文本不该再让用户确认 | 模板第 1 条固定带「由用户确认」（`workspace-initialization.yaml:14`） | **矛盾** |
| 注入文本应当只是一句「本次已选后端：Markdown」 | Markdown 那份 backendNote 还带着一整句生成指令（`panel.yaml:84`），GitHub 那份已经被削短（`workspace-initialization.yaml:9`） | **不一致**（三家文案不齐） |

### 2.6 问题 B 没能从源码判定的部分

- 出问题那一次注入的**全文**（本机拿不到会话记录），因此「single-context 那一句到底在不在里面」无法从源码断言。
- 那一刻 `readSetupLayout` 读到的是会话里的 `st.setupLayout` 还是按工作区记住的那一份（`prompts.ts:221`）——两者都是 `single` 时结论相同，所以这一项对本问题没有影响。
- 本机 `C:\Users\<用户>\.dsh\mattskillsdeck\choices.json` 里，最近一次 Markdown 后端选择记在 2026-10-22 09:32:28，同一工作区的布局记为 `single`（09:32:35）；紧随其后 09:33:44 的一次是 GitHub（那个工作区键下没有布局条目）。这是本机的旁证，说明这些选择确实发生过，但对应的是哪一次注入仍无法确定。

---

## 三、两个问题的交汇点

- 两个问题共用同一条「后端刚选定」的时间线：选定后端 → 绑定写工作区文件 → 立刻重取链（`StatusBackend.ts:225`、`:231`）→ 这一轮重取被退避挡下（`detectChain.ts:236-242`）⇒ 界面继续拿着旧快照 ⇒ 横幅缺席（1.2 的情形一）。
- 注入初始化全文这一条路在 GitHub 后端上本来就有前置条件：`gh:remote` 没过就不注入一个字（`prompts.ts:280-295` 配合 `guide-steps.ts:117`）。在 Markdown 后端上这个前置条件不存在（`guideStepsFor('markdown')` 里没有 GitHub 那三步，`guide-steps.ts:151-153`），所以 Markdown 那次注入不会被「仓库没关联」拦住。

## 四、本次能拿到与拿不到的证据

| 证据 | 状态 |
|---|---|
| 仓库源码（本文所有 file:line） | 读到，逐条核对过 |
| 插件诊断日志 `~/.dsh/logs/dsh-mattpocock-skills-deck/` | 只有 2026-10-15.log（577 字节），**没有本次场景的记录** |
| 本机选择记录 `~/.dsh/mattskillsdeck/choices.json` | 读到：今天 09:32:28 选 Markdown、09:32:35 记布局 single；09:33:44 选 GitHub（无布局条目） |
| 本机工作区台账 `~/.dsh/mattskillsdeck/work-path/*.json` | 只有「会话 → 票据」的台账，不含链快照与选择状态 |
| 出问题那一刻的链快照与宿主日志 | **拿不到**（见 1.9） |

## 五、留给维护者的三个待定问题

1. 选定后端之后那一次重取链，要不要按「人亲手点的动作」处理（带 `trigger='user-recheck'`，绕开退避）？这是 1.8 里的第 1 条，改动最小。
2. 链的缓存键里那一段后端 id 恒为空（`detectChain.ts:230` 加上 `store-prefs.ts:273-275`）是有意为之（#1003 退役客户端上报），还是顺带的副作用？这决定了 1.8 的第 2 条能不能做。
3. 「挡着初始化的那一步没露行」时，要不要退回到显示「后端未定」那一档，而不是什么都不显示（`bannerChain.ts:106`）？

---

## 六、并行调查的补充（另一路只读调查，2026-10-22 10:04 起）

这一节是另一路独立只读调查补进来的内容，与上面五节对读。两路的结论在主线上一致（问题 A 的机制都是「客户端那份链快照里没有 GitHub 后端段的行，于是 bannerChain.ts:106 的早退把「读不到」翻译成「一条都不出」）；下面只补上面没有覆盖的四点，以及一处需要两路对读才看得清的差别。

### 6.1 与 #891／#1220 的边界（上面五节没有这一节）

- 「AI 按那段提示词把初始化做完了，但提示条不消失、仍写着「该工作区尚未初始化」」这一段**不属于 #1363**，属 #891／#1220 那条线（父票 #1010）。票面草稿 .scratch/issue-body-1352.md 的「查历史结论」一节也是这么分的：场景一（一条都不出）是新问题，场景二的后半段复用既有诊断。
- 那一段的根因已经定案，结论见 research/1220-recheck-2026-10-21.md：初始化完成后自动重算链的钩子挂在活跃探测那一拍上（src/client/kernel/probe-auto.ts:261-269，钩子本体在 probe-chain.ts:96-107 的 setupPendingOf、:121-127 的 chainEventRefresh），而那一拍要靠 timer.interval 排上；客户端的 timer 包装只有 timeout／setTimeout／clearTimeout 三个方法、**没有 interval**（src/client/hostShim.ts:23-48），于是 probe-auto.ts:272 的守卫恒为真、节拍排不上（:276 落一行 reason: 'no-timer'），钩子从来没跑过；链不重算，黄条按旧快照常驻。
- 两条线要分开看：「一条都不出」是**快照没跟上**（早退成空），「黄条不消失」是**快照永不重算**（按旧快照常驻）。机制不同、归属不同，不要混谈。
- 归属：#1363 只管「选定后端之后一条都不出」与「注入文本与已选布局／已选后端对不上」；#891／#1220 管「初始化做完之后黄条该消失却不消失」。

### 6.2 「快照 backendModules 必须与 wf.registry 同构」那条规则：成立，但它不是本次现象的成因

- 规则写在 src/host/snapshotBuild.ts:372-374：「缺 setupPrompt 时 setupRunParamsFrom 匹配不到该后端 → 注入的 setup 提示词落回默认键组（GitHub 版）」。这一条经核对**成立**：setupRunParamsFrom 先按 id 在模块表里找那一份（src/client/kernel/prompts.ts:226-228），再用它的 setupPrompt 键表去 locale 字典取那四个键（:229、:242-244）；模块对象上没有 setupPrompt 时，(m && m.setupPrompt) || SETUP_DEFAULT_PROMPT_KEYS 直接落回默认键组（:229、:206-211）。
- 触发条件：客户端拿到的 st.backendModules 里没有「当前后端」这一项，或那一项没有 setupPrompt。两条通道给 st.backendModules：快照那份（src/host/snapshotBuild.ts:367-377 → src/client/kernel/store-snapshot.ts:280、:354）与 wf.registry 那份（src/client/kernel/probe-select.ts:181-188、src/client/statusbar/StatusBackend.ts:214）。
- **但它解释不了提单人在提示词里看到的「.scratch 结构」**：退回的默认键组是 setup.default.*（config/copy/panel.yaml:93-99；客户端生成物 src/client/kernel/locale-data.ts:1781-1784），正文是「本次未指定后端，已按默认 GitHub 初始化；可在设置页随时切换」，**没有「.scratch 结构」**。那五个字只出现在 Markdown 后端声明的 setup.markdown.backendNote（config/copy/panel.yaml:81-84；生成物 src/client/kernel/locale-data.ts:1793）。所以那一趟注入用的后端确实解析成了 markdown，走的是 markdown 自己声明的那四个键，不是退回默认键组。
- 也就是说：这条「同构」规则是一条独立隐患（它的表现是「选了 markdown／gitlab，注入出来的却是默认 GitHub」），与本次「.scratch 结构」这一现象不是同一件事，别把两者当成一条因果。
- 投影层把 setupPrompt 列进了白名单，所以今天三家的键都能到界面：src/tracker/ui-description.ts:52-59（UI_DESCRIPTION_FIELDS 含 'setupPrompt'）、:80-87（projectUiDescription 按「有定义就带」投影）；历史上踩过两次坑，教训还留在注释里——src/tracker/registry/builtins.ts:46（markdown 必须整份注册，否则 setupPrompt 丢失）、src/host/platformChannel.ts:191（同一教训）。

### 6.3 改文案要改哪一份：配置真源与客户端生成物不是同一处

- 提示词正文与 locale 文案的真源在 config/ 下：config/prompts/workspace-initialization.yaml:10-16（setupRun 的中文正文；:9 的使用说明记着「v13 #664 … GitHub 那份 backendNote 只留『本次已选后端：GitHub。』」）、config/copy/panel.yaml:72-99（setup.github.*／setup.markdown.*／setup.gitlab.*／setup.default.*）。
- 客户端读的是构建时生成的两份数据：locale 文本在 src/client/kernel/locale-data.ts（中文块里 setup.markdown.backendNote 在 :1793、setup.markdown.trackerLine 在 :1796、setup.github.* 在 :1785-1788、setup.default.* 在 :1781-1784、setup.layout.single／multi 在 :1213-1214），模板正文在 src/client/kernel/prompt-data.ts（setupRun 的 zh／en 在 :96-100，占位符清单在 :65；switchAlign 在 :104-106）。
- 结论：若要动「.scratch 结构」或「由用户确认」这两句，改的是 config/ 下那两份数据（并走生成器），不是改 src/client/kernel/locale-data.ts 与 prompt-data.ts 这两份生成物——这两份只是构建产物里的镜像。

### 6.4 「.scratch 结构」在插件里的确切含义（补 2.3）

- .scratch 是本地 Markdown 后端存票与本地数据的目录，另有一项检查项「本地数据目录可读写」（md:scratchWritable，判据是目录可写）：src/shared/tracker/check-catalog-dirs.ts:191-199。
- 它与「域文档布局」（单上下文／多上下文，取值真源 src/shared/doc-layout/src/layouts.ts）是两件事。所以提单人「选了 single-context 就不该再提 .scratch 结构」这一句，按代码看是**把两件事当成一件**：注入文本里确实同时有布局那一句（{contextLayout}）与 .scratch 那一句，两句各说各的。要不要改这句话属于文案口径，由维护者定；本轮只把事实摆清楚。

### 6.5 与上面 1.6 的一处差别（两路对读才看得见）

- 上面 1.6 把「宿主没组装后端链」这条路判为「今天在强制求值下已经很难走通」，并把剩下的现实缺口归到 1.5（退避把选之前那份旧快照递回来）。这一路独立核对时给的是两条并列候选：(a) 宿主那一趟没按 GitHub 组装后端段；(b) 客户端手上是选之前的旧快照。两者的**共同前提相同**——客户端那份链快照里没有 GitHub 后端段的行。
- 并行那份把 (b) 落到了更具体的代码路径（退避 + 缓存键 + 只有 user-recheck 才绕行），这一点比本路的表述更细，采纳。
- 但 (a) 也不能被源码完全排除：宿主取后端 id 时，探测给出的「显式空」（source === 'explicit' 且 backendId 为空）优先于客户端上报的 backendId（src/host/detectChain.ts:264-271，:267-268），此时整段后端链就不组装（:377）；空白工作区被判定为「已空」会让已缓存的显式选择视为过期（src/tracker/detection/detectionService.ts:288-299），不过这一条只在缓存路径上生效，强制求值整段跳过缓存（:289）。
- 真机日志可分辨这两条：看宿主侧那一次探测的结论行（detection.detect）、chain.backoff 的 decision／reason（src/host/refresh/chainBackoff.ts:136-139）与 chain.cache.hit（src/host/detectChain.ts:240）；若这两条都没有，而 wf.bind 的 workspaceFile 一栏是写成功了（src/host/workspaceCwd.ts:111、:136），那么 (a) 与 (b) 都要靠「出问题那一刻客户端手上的链快照」来定案。

### 6.6 本路补的一份引用清单（文件与一句话说明）

- src/shared/tracker/guide-steps.ts —— 首开引导链六步的唯一真源（ready／banner／missing／blocksSetup 都在这里）。
- src/client/statusbar/bannerChain.ts —— 挑出今天该出哪一条横幅，以及那条按钮点下去做什么；:106 是「一条都不出」的那处早退。
- src/client/statusbar/StatusBar.ts —— 状态栏算门控、画横幅、落 guide.banner 日志。
- src/host/detectChain.ts —— 宿主侧探测与链求值；后端 id 的取法与后端链的组装条件都在这里。
- src/client/kernel/probe-chain.ts —— 客户端取链、回包过期守卫、四种事件触发重算。
- src/client/kernel/probe-auto.ts、src/client/kernel/attention-heartbeat.ts、src/client/hostShim.ts —— #891／#1220 那条线的节拍与 timer 包装。
- src/client/kernel/prompts.ts、src/client/kernel/prompts-setup.ts、src/client/kernel/prompt-data.ts、src/client/kernel/locale-data.ts —— 注入文本的拼装与它的两份生成物。
- src/tracker/rooms/markdown/index.ts、src/tracker/rooms/github/index.ts、src/tracker/rooms/gitlab/index.ts —— 三家后端各自声明的 setupPrompt 键表。
- src/host/snapshotBuild.ts、src/tracker/ui-description.ts —— 快照里 backendModules 的组装与投影（setupPrompt 在白名单里）。
- src/tracker/detection/detectionService.ts、src/tracker/detection/explicitDetector.ts、src/host/workspaceCwd.ts、src/shared/config-store/src/workspace.ts —— 后端判定的唯一真源（工作区配置文件）与它的写入口。
- src/client/panel/Dock.ts —— 右侧面板那枚「未识别仓库」芯片的判据（与横幅是两条通道）。
- config/prompts/workspace-initialization.yaml、config/copy/panel.yaml —— 提示词与文案的配置真源。
- research/1220-recheck-2026-10-21.md、research/1210-round2-log-verification.md、research/660-onboarding-chain-recon.md、.scratch/issue-body-1352.md —— 既有笔记与票面草稿。
