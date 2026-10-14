# issue #1047 背景调查：判定今天怎么做、做到哪一步可解释

> 只认一手来源：源码、ADR、`CONTEXT.md`、已落盘 research。每条结论后跟 `文件:行`。
> 本文件只写背景，不写方案、不做决策、不扩散到别的地图。
> 调查时间 2026-10-13；路径全是工作区相对路径。

## 0. 先说三处旧路径名今天的样子（免得按图索骥走空）

- 结论：任务书写的 `src/host/logPkg/store.js` 今天已不存在；宿主日志在 #1016 改成常规依赖 `dsh-log`，那份副本与派生脚本宿主那一半一并删除。
- 来源：`research/489-appendix.md:56`、`src/host/logFromPackage.js:8`、`scripts/build.mjs:88`、`tests/verify-log-count.js:81`
- 结论：任务书写的 `src/shared/deck-tools/shell.js` 今天住 `src/deck/shell/call-shell.ts`（文件头注释还写着旧路径，见该文件 `src/deck/shell/call-shell.ts:1`）。
- 来源：`src/deck/shell/call-shell.ts:1-11`
- 结论：任务书写的 `docs/agents/workspace.yaml` 在本工作区磁盘上今天没有实物；`docs/agents/` 下只有 `domain.md`、`commit-convention.md`、`issue-tracker.md`、`triage-labels.md`、`verification.md`。`workspace.yaml` 是代码里约定的相对路径常量，不是已落盘的文件。
- 来源：`docs/agents/` 目录实测（`domain.md`、`commit-convention.md`、`issue-tracker.md`、`triage-labels.md`、`verification.md` 存在，`workspace.yaml` 与 `workspace.json` 不存在）、`src/shared/config-store/workspace.js:3-4`

## 1. 判定级联今天的真实顺序

- 结论：唯一的判定出口是 `decideBackend`，纯核是 `decidePure`，两者都住 `src/tracker/detection/backendDecision.ts`。纯核只做排序，不碰文件系统与注册表。
- 来源：`src/tracker/detection/backendDecision.ts:80-98`、`src/tracker/detection/backendDecision.ts:182-231`
- 结论：纯核顺序是内存绑定 → 工作区文件 → 声明文件 → 自动识别 → 待定 → 无结论，共四层加两个收尾档。记忆（H）不在纯核里。
- 来源：`src/tracker/detection/backendDecision.ts:80-98`（`boundId` 见 `:81-83`；`fileParsed` 见 `:84-87`；`declarationId` 见 `:88-90`；`autodetect.backendId` 见 `:91-93`；`autodetect.pending` 见 `:94-96`；`origin: 'none'` 见 `:97`）
- 结论：`decideBackend` 是同顺序的异步版，共四层：L1 进程内绑定副本（`registry.bound`）、L2 工作区文件（新 yaml 优先、老 json 兼容读）、L3 声明文件、L4 自动识别（调用方递 `autodetect` 钩子则用它，否则直调 `registry.select`）。空根直接回未知，不读文件、不问注册表、不起外部命令。
- 来源：`src/tracker/detection/backendDecision.ts:182-231`（空根见 `:184-186`；L1 见 `:195-197`；L2 见 `:198-202`；L3 见 `:203-206`；L4 见 `:210-226`；`skipAutodetect` 见 `:217`）
- 结论：文件层读法是双路径新优先老兼容，与核的读写口同顺序；声明层优先用调用方递进来的 `readDeclarationId`／`parseDeclaration`，没递时读 `docs/agents/issue-tracker.md` 只做标题行最小判定。
- 来源：`src/tracker/detection/backendDecision.ts:100-129`（`rels` 见 `:102-104`；`fs.resolve/readText` 见 `:107-115`）、`src/tracker/detection/backendDecision.ts:131-152`、`src/tracker/detection/backendDecision.ts:25-32`
- 结论：文件来源到 `origin` 的映射是 `migrated→file-migrated`、`detected→file-detected`、`auto→file-auto`（只读历史文件时出现，新文件不再产出），其余记 `user-file`。
- 来源：`src/tracker/detection/backendDecision.ts:38-43`、`src/deck/shell/workspace-anchor.ts:9-11`、`src/deck/shell/workspace-anchor.ts:25-26`
- 结论：出口答案到调用方选择形状由 `selectionFromOutlet` 做：有 `backendId` 则带 `ref`（缺席现算）并透传 `multiHit`／`pending`；只有 `pending` 则回 `backendId: null, source: 'fallback', pending: true`；其余回 `backendId: null, source: 'fallback'`；出口抛错（`o` 为空）回空，由调用方走老路或诚实失败。
- 来源：`src/tracker/detection/backendDecision.ts:50-64`
- 结论：`explicitDetector.detectExplicit` 是旧显式分支，今天 `detectionService` 每次仍调用它，但只是为了拿 `explicit.raw/parsed` 给界面与排查看“仓库里那份文件写的是什么”，“这一次采用谁”由统一出口另判一次。
- 来源：`src/tracker/detection/explicitDetector.ts:23-69`、`src/tracker/detection/detectionService.ts:184-188`、`src/tracker/detection/detectionService.ts:190-216`
- 结论：`detectExplicit` 内部顺序是内存绑定 → 工作区文件 → 声明文件。`boundId === null` 是显式无后端逃生舱，直接回 `backendId: null, source: 'explicit'`；字符串且已注册直接回显式选择；无平台（`platform.fs.resolve/readText` 缺席）回 `reason: 'no-platform'`；声明文件读失败回 `reason: 'read-failed'`。
- 来源：`src/tracker/detection/explicitDetector.ts:27-36`、`src/tracker/detection/explicitDetector.ts:39-41`、`src/tracker/detection/explicitDetector.ts:43-52`、`src/tracker/detection/explicitDetector.ts:53-69`
- 结论：`detectionService.detect` 的真实流程是：洗 `cwd` 键 → 空目录直接回未知 → 查缓存（非 `force`）→ 每次重读 `detectExplicit`（为 `explicit` 栏）→ 走统一出口 `decideBackend` 定选择 → 算 `repoHandle` → 惰性 `preflight` → 按需技能探测 → 按规则写缓存。
- 来源：`src/tracker/detection/detectionService.ts:122-278`（洗键见 `:130-135`；空目录见 `:139-141`；缓存见 `:152-182`；`explicit` 重读见 `:184-188`；出口见 `:198-216`；`repoHandle` 见 `:221-227`；`preflight` 见 `:229-244`；技能见 `:251`；写缓存见 `:270-276`）
- 结论：缓存三条硬规则：`force` 直通；`pending` 不缓存不取（取时跳过 `pending`，写时跳过 `pending`）；`preflight` 为 `env` 失败不取不存。另两条作废判据：工作区已空则缓存的显式选择视为过期并失效；缓存时记下的 `fileMs` 对不上就重算（取不到时间按“判不了”处理，不误判）。
- 来源：`src/tracker/detection/detectionService.ts:149-182`、`src/tracker/detection/detectionService.ts:270-276`、`src/tracker/detection/workspaceStore.ts:54-55`
- 结论：`preflight` 惰性且只在“命中且非 `pending`”时调；异常收成 `{ok:false, error:{kind:'network', message}}`（截断 300 字）。
- 来源：`src/tracker/detection/detectionService.ts:229-244`
- 结论：`parseIssueTracker` 是纯函数（`text→结构`），不读 `fs`／`process.env`／`path.join`。第一阶段标题高置信三者互斥按 `gitlab > markdown > github` 收敛；第二阶段正文关键词低兜底，且 `markdown` 正文不参与判定（`markdown` 旧文档无标题时由 `matches` 经 `.scratch` 目录探测，不走显式低兜底）。
- 来源：`src/tracker/detection/parseIssueTracker.ts:22-57`（标题见 `:27-41`；`gitlab` 优先见 `:32-34`；`markdown` 见 `:35-37`；`github` 见 `:38-41`；低兜底见 `:43-54`；`markdown` 正文忽略见 `:44-45`；无命中见 `:56`）、`src/tracker/detection/parseIssueTracker.ts:62-70`

## 2. 三个后端房间的 `matches` 今天怎么写

- 结论：GitHub 的 `matches` 读三处现场信号：`handle.refId` 含 `/` 视为显式绑定直接命中；否则读 `.git/config` 是否含 `github.com`；再回落 `git remote get-url origin` 是否含 `github.com`。全程不抛错，不确定一律 `false`。
- 来源：`src/tracker/rooms/github/backend.ts:29-59`（`refId` 见 `:31-35`；`.git/config` 见 `:40-46`；`git remote` 见 `:48-54`）
- 结论：GitHub 房间入口 `index.ts` 不写逻辑，只转发（`describe`／`issueUrl`／`checks`／`githubMatches`／`createGithubBackend` 等）。
- 来源：`src/tracker/rooms/github/index.ts:19-26`
- 结论：GitLab 的 `matches` 读四处：`handle.refId` 含 `gitlab` 直接命中；`.git/config` 是否含 `gitlab`；`docs/agents/issue-tracker.md` 是否含 `gitlab`；`git remote get-url origin` 输出是否含 `gitlab`（`timeout: 2000`）。无 `fs` 或无 `platform` 直接 `false`；异常只记 `gitlab matches error` 告警。
- 来源：`src/tracker/rooms/gitlab/index.js:28-66`（`refId` 见 `:32`；`.git/config` 见 `:40-45`；声明文件见 `:47-51`；`exec` 兜底见 `:53-60`）
- 结论：声明文件同时是 GitLab `matches` 的输入之一，这是 ADR 把声明文件归入“程序自己认”的证据之一。
- 来源：`docs/adr/20261012-backend-decision-two-classes.md:34`、`src/tracker/rooms/gitlab/index.js:47-51`
- 结论：Markdown 的 `matches` 读两类现场：`.scratch/` 下是否有 `map.md`（含 `handle.refId` 含 `.scratch` 时的候选、`root/map.md`、枚举子目录的 `<name>/map.md`）；若无 `map.md`，再看 `docs/agents/issue-tracker.md` 是否含 `Local Markdown`（给“已选本地但尚未落 `map.md`”的身份兜底）。
- 来源：`src/tracker/rooms/markdown/index.ts:17-58`（候选见 `:23-30`；枚举见 `:32-40`；存在即命中见 `:41`；声明兜底见 `:42-55`）
- 结论：Markdown 的 `preflight` 只认 `map.md` 是否存在，存在即 `{ok:true}`，否则 `{ok:false, error:{kind: NOTFOUND}}`。
- 来源：`src/tracker/rooms/markdown/index.ts:90-123`（三处存在检查见 `:103-110`、`:113-114`、`:118-120`；`NOTFOUND` 见 `:121`）

## 3. 显式声明的优先级与三者关系

- 结论：工作区配置文件（`docs/agents/workspace.yaml`，兼容读老 `docs/agents/workspace.json`）是人选的唯一真源，判定第 2 层读它，跨重启跨机器都在。常量与解析见核与垫片。
- 来源：`src/shared/config-store/workspace.js:3-4`、`src/deck/shell/workspace-anchor.ts:20-22`、`src/deck/shell/workspace-anchor.ts:35-48`、`src/tracker/detection/backendDecision.ts:100-129`
- 结论：本次进程内绑定副本是同一次“人在界面上点确认”动作写下的当次副本，进程结束即失。它与工作区文件是同一件事的两份记录，不是两个来源。
- 来源：`docs/adr/20261012-backend-decision-two-classes.md:27-32`、`src/tracker/detection/backendDecision.ts:163-170`
- 结论：声明文件（`docs/agents/issue-tracker.md`，由初始化那一步的 AI 写下，插件自己不写）属于“程序自己认”，不属于人选。它既是判定第 3 层单独读的一条，也是后端 `matches` 的输入之一。
- 来源：`CONTEXT.md:150-154`、`docs/adr/20261012-backend-decision-two-classes.md:29-34`、`src/tracker/detection/backendDecision.ts:172-177`
- 结论：本机那份按工作区记的选择（#683 的宿主侧记录，`src/host/choiceStore.js`）2026-10-12 起不再参与后端判定，只用来把工作区配置文件生成一次，以及版式答案。记录本身不删（只停用不删记录）。判定链里原来读记忆的那一层已整段删除。
- 来源：`docs/adr/20261012-backend-decision-two-classes.md:42-44`、`src/tracker/detection/backendDecision.ts:154-156`、`src/tracker/detection/backendDecision.ts:207-209`、`src/tracker/detection/detectionService.ts:146-148`、`src/tracker/detection/detectionService.ts:205-206`
- 结论：四层只有两类（2026-10-12 维护者拍板）：L1 进程内绑定副本与 L2 工作区文件是“人选”，今天能写；L3 声明文件与 L4 `matches` 命中是“程序自己认”，今天不能写（`reason: 'needs-generate'`）。
- 来源：`docs/adr/20261012-backend-decision-two-classes.md:23-34`、`src/tracker/detection/backendDecision.ts:179-180`、`src/tracker/detection/backendDecision.ts:196-230`
- 结论：判定顺序仍以 ADR `20260921` 为准（手动选择 > 声明文件 > 自动识别），`20261012` 不改顺序，只回答“结论是谁给的、谁有权写”。
- 来源：`docs/adr/20261012-backend-decision-two-classes.md:3-5`、`docs/adr/20261012-backend-decision-two-classes.md:36-38`
- 结论：本仓今天的声明文件实物标题是 `# Issue tracker: GitHub`，按 `parseIssueTracker` 属于高置信标题命中（`title-github`）。
- 来源：`docs/agents/issue-tracker.md:1`、`src/tracker/detection/parseIssueTracker.ts:27-41`
- 结论：契约层 `Selection.origin` 今天仍是平铺字符串（`user-memory-bind`／`user-file` 等／`declaration`／`autodetect`／`unknown-workspace`／`pending`／`none`），“出处到两类”的机器可判表另起一笔，本轮只改注释不动形状。
- 来源：`src/tracker/contract/results.ts:64-78`、`docs/adr/20261012-backend-decision-two-classes.md:52-54`

## 4. 失败与判不出时的全部档位

- 结论：`unknown-workspace`（还没认出目录）：`decideBackend` 回 `{backendId:null, source:'unknown', origin:'unknown-workspace', canWrite:false, reason:'workspace-not-ready'}`；注册表 `select` 同口径回 `{backendId:null, source:'unknown', origin:'unknown-workspace'}`；`detectionService` 空 `cwd` 回 `selection: null` 且 `choiceSource: 'empty-cwd'`。
- 来源：`src/tracker/detection/backendDecision.ts:184-186`、`src/tracker/registry/registryCore.ts:132-135`、`src/tracker/detection/detectionService.ts:139-141`
- 结论：`pending`（自动识别有超时未决）：`decideBackend` 回 `{backendId:null, source:'fallback', origin:'pending', pending:true, canWrite:false, reason:'pending'}`；注册表 `matches` 超时（默认 3000ms）视作 `pending` 排除出决策集，有 `pending` 必须向外展示，不得静默当无后端。
- 来源：`src/tracker/detection/backendDecision.ts:227-229`、`src/tracker/registry/registryCore.ts:147-175`（超时见 `:152-156`；`fallback+pending` 见 `:169-175`）、`src/tracker/contract/results.ts:53-55`
- 结论：`multiHit`（多个后端同时命中）：注册序取第一个，但如实全部给出；`decideBackend` 透传 `multiHit`；调用方（工具壳、改色电话）见到多命中必须拒绝，不得静默挑赢家。
- 来源：`src/tracker/registry/registryCore.ts:159-168`、`src/tracker/detection/backendDecision.ts:225`、`src/deck/shell/call-shell.ts:240`、`src/host/workspaceLabelColors.js:122-125`
- 结论：`fallback/none`（已决无后端）：`decideBackend` 回 `{backendId:null, source:'fallback', origin:'none', canWrite:false, reason:'no-backend'}`；无 `pending` 且 `backendId===null` 才算已决无后端，是面板无后端卡的唯一身份分支。
- 来源：`src/tracker/detection/backendDecision.ts:230`、`src/tracker/contract/index.ts:128-138`
- 结论：`needs-generate/no-backend`（程序自己认的两层）：`canWrite: false, reason: 'needs-generate'`；写用途拦截一律拒绝，读用途不受限。
- 来源：`src/tracker/detection/backendDecision.ts:203-206`、`src/tracker/detection/backendDecision.ts:224-226`、`src/deck/shell/call-shell.ts:245-246`、`src/host/workspaceLabelColors.js:49-51`
- 结论：`canWrite` 今天只给人选：L1/L2 为 `true`；L3/L4（含 `pending`／`none`／`unknown-workspace`）为 `false`。
- 来源：`src/tracker/detection/backendDecision.ts:179-180`、`src/tracker/detection/backendDecision.ts:196-230`
- 结论：`preflight env` 失败（工具没装、平台能力缺席）不进缓存。GitHub 缺 `gh` 回 `ENV`；GitLab 缺 `glab` 或 `exec` 缺席回 `ENV`；登录态失败回 `AUTH`；Markdown 缺 `map.md` 回 `NOTFOUND`。
- 来源：`src/tracker/detection/detectionService.ts:150-151`、`src/tracker/detection/detectionService.ts:272-276`、`src/tracker/rooms/github/preflight.ts:45-56`、`src/tracker/rooms/github/preflight.ts:58-75`、`src/tracker/rooms/gitlab/preflight.js:26-37`、`src/tracker/rooms/gitlab/preflight.js:38-50`、`src/tracker/rooms/markdown/index.ts:121`
- 结论：九个 deck 工具的呈现：`pickBackend` 先过空目录闸，再走统一出口；多命中／待定／无后端回 `reason: 'no-backend'` 的 `unsupported`；非人选结论回同一句“还没选定后端……请先在面板上选定”（写用途拦截，读用途不受影响）；闸推迟回 `gate-defer`；后端抛错回 `backend-threw`。
- 来源：`src/deck/shell/call-shell.ts:164-250`（空目录见 `:165`；出口见 `:176-203`；多命中待定见 `:240`；无后端见 `:241-244`；写拦截见 `:245-246`）
- 结论：改色两条电话的呈现：`pickBackend` 同走统一出口；写（`setLabelColors`）要 `canWrite`，否则回同一句 `notPickedYet`（`conflict`）；读（`listLabels`）不查 `canWrite`；多命中／无后端／待定回 `conflict` 并带 `UNDECIDED` 文案；后端形状不合契约、后端抛错、宿主自己出错回 `env`，文案必须说清是插件这边的问题。
- 来源：`src/host/workspaceLabelColors.js:43-51`、`src/host/workspaceLabelColors.js:66-144`（多命中见 `:122-125`；无后端见 `:127-135`；待定见 `:137`；写拦截见 `:142`）、`src/host/workspaceLabelColors.js:145-161`、`src/host/workspaceLabelColors.js:166-202`
- 结论：面板的呈现：`pending` 显示等待态（切换后端按钮灰置、切换不可用）；`multiHit` 显示黄条“检测到多个可用后端……建议显式绑定”；显式无后端／`pending` 不走无仓库红卡分支。
- 来源：`src/client/panel/Dock.js:63-66`、`src/client/panel/Dock.js:228-229`、`src/client/panel/Dock.js:261-272`、`src/client/views/shared/BackendSelector.js:42-70`、`src/client/views/NoRepoCard.js:26-30`、`src/client/views/shared/ChainRenderer.js:242`

## 5. 今天日志能读出多少“为什么这么判”

- 结论：白名单与条数以 `research/489-appendix.md` 第 1 章为准；字段只记已知安全字段（散列／截断／枚举），令牌与登录态原文永不落盘，路径与仓库地址不记原文。
- 来源：`CONTEXT.md:85-92`、`research/489-appendix.md:29-32`、`research/489-appendix.md:194-195`、`research/489-appendix.md:199-200`
- 结论：与判定直接相关的只有三行常驻：`registry.select`（#14：`cwdHash`／`backendId`／`source`／`latencyMs`／`caller`）、`detection.detect`（#16：`cwdHash`／`explicit`／`matches`／`pending`／`selection`）、`host.call`／`host.call.fail`（#26／#27：`method`／`kind`／`latencyMs`／`errorHash`，检查链那条另带 `errorKind`）。
- 来源：`research/489-appendix.md:194-195`、`research/489-appendix.md:199-200`、`research/489-appendix.md:246`
- 结论：`backendDecision` 与 `detectionService` 沿途没有自己的分层日志。`backendDecision.ts` 全文件零日志调用；`detectionService.ts` 只收 `logCtx` 参数，不产生任何 `fire`；`explicitDetector.ts` 同样零日志。能读出的“为什么”只到调用方那三行。
- 来源：`src/tracker/detection/backendDecision.ts:1-233`（全文无 `logCtx/fire`）、`src/tracker/detection/detectionService.ts:117`（`logCtx` 只在参数表）、`src/tracker/detection/explicitDetector.ts:1-71`（全文无日志）、`src/tracker/detection/workspaceStore.ts:46-48`（仅调试级 `hit/miss`）
- 结论：`registry.select` 每次仲裁落一行（含 `caller`，如 `detection-service`／`deck-tool`／`snapshot-early`／`detect`），字段只有结论没有分层依据（看不出 L1–L4 走到哪一层、文件时间、声明标题行、`matches` 各房真假）。
- 来源：`src/tracker/registry/registryCore.ts:138-175`（三处 `rlog` 见 `:144`、`:161`、`:174`）、`research/489-appendix.md:194`
- 结论：`detection.detect` 由两个调用方在 `detect` 返回后补记：`handleDetect` 与会话生命周期。字段只有 `explicit` 是否显式、`pending` 是否待定、`selection` 选中结果（`handleDetect` 版少 `matches`，会话版把 `multiHit` 长度记进 `matches`）。
- 来源：`src/host/detectChain.ts:51`、`src/host/sessionLifecycle.js:169`
- 结论：缓存命中时几乎没有轨迹。`detectionService` 命中直接 `return cached`，不记日志；`workspaceStore` 的 `hit` 是调试级且每 100 次采样一次，开关关着没有；外层 `detection.detect` 仍会落一行结论，但看不出“这次是缓存”。
- 来源：`src/tracker/detection/detectionService.ts:177-179`、`src/tracker/detection/workspaceStore.ts:48`、`src/host/detectChain.ts:51`
- 结论：九个工具共用壳的落点只有 `fire()` 一处（`deck.select` 成功行、`host.call`／`host.call.fail`），`kind` 一律 `deck-tool`；房间起 `gh/glab` 落既有 `gh.exec` 那一族；改色两条电话沿用 `host.call`／`host.call.fail`，交后端执行器跑外部命令时 `exec.run` 的 `via` 取 `label-colors`。
- 来源：`src/deck/shell/call-shell.ts:97-103`、`src/deck/shell/call-shell.ts:247-249`、`research/489-appendix.md:30`、`research/489-appendix.md:119`

## 6. 面板与 deck 共用同一条判定的现状

- 结论：面板的两条电话 `wf.detect` 与 `wf.chain` 注册在同一处，都经 `_detectChain()` 进同一编排。
- 来源：`src/host/index.js:206`
- 结论：`handleDetect` 与 `handleChain` 都调同一 `detectionService.detect`，再经同一 `decideBackend` 出口。区别只在包装：`handleDetect` 直接 `svc.detect({cwd},{force})`；`handleChain` 用 `skipSkillProbes: true` 并把登录态与仓库可达的预检包进同一次评估的复用位（`ghTunnel`），一次求值里那两条命令各只真问一次。
- 来源：`src/host/detectChain.ts:43-57`、`src/host/detectChain.ts:88-98`、`src/tracker/detection/detectionService.ts:198-216`
- 结论：装配层只有一处单出口装配点：`platformChannel` 动态 `import('../tracker/detection/backendDecision.js')` 并把 `selectionFromOutlet` 挂到函数上整包递出；探测服务与改色电话都经 `getDecisionFn` 拿同一函数。
- 来源：`src/host/platformChannel.js:285`、`src/host/platformChannel.js:312`、`src/host/platformChannel.js:340-344`、`src/host/workspaceLabelColors.js:76-92`
- 结论：九个工具侧同样只认这个出口：装配层把 `decideBackend` 直接递进工具依赖，壳里 `useOutlet` 缺席即按装配错如实失败，不编后端；自动识别包着配额闸走（`probe` 一格），里面直调 `registry.select`，不重复记账。
- 来源：`src/deck/registration/host-assemble.ts:132-134`、`src/deck/shell/call-shell.ts:176-203`
- 结论：三处（面板链、工具壳、改色电话）确实调同一出口函数，但递进去的上下文形状不完全相同：探测服务递 `{registry, platform, fs, caller, signal, autodetect}`，工具壳递 `{registry, backendCtx, readWorkspaceFileText, parseWorkspaceFile, readDeclarationId, caller, autodetect}`。背景层面记一笔，是否一致由 07 的开发票判定。
- 来源：`src/tracker/detection/detectionService.ts:207`、`src/deck/shell/call-shell.ts:188-192`、`src/host/workspaceLabelColors.js:86-88`

## 7. 地图07与相邻图的边界

- 结论：07 的目的定稿是“这个工作区是什么后端的探测可信且可解释，面板与 deck 共用同一条判定”；边界是探测级联与显式声明判定；做完的标志是判定与今天一致、且每一步都能从日志读出为什么这么判；交给下一环的是“后端只需声明自己匹配什么”。
- 来源：`research/1010-ticket-structure.md:219`
- 结论：06 守护的是“这张票归哪个后端管、哪些能力可用”的仲裁只有一个真源（注册表与跟踪器顶层）；07 不碰仲裁本身，只消费它的结论。
- 来源：`research/1010-ticket-structure.md:217`
- 结论：08 是 GitHub 房（`gh` 之上的一切操作），09 是 Markdown 房（本地票文件解析写入与关系），10 是 GitLab 房占位（只随目录改名加迁移说明，代码不转）；07 不碰任何一房的实现，只要求各房“声明自己匹配什么”。
- 来源：`research/1010-ticket-structure.md:221-225`
- 结论：07 不碰新行为。能力图 C1（在办可见）与 C2（进度与原话）的完成判据是“新行为可用”，与改写单元的“行为零变化”不混；07 的判据是后者。
- 来源：`research/1010-ticket-structure.md:191-194`、`research/1010-ticket-structure.md:235-240`
- 结论：07 不建日志机制。日志的事件常量与字段表归 01 基建；每段旅途的埋点是各开发票的验收项。07 只提“用日志读出为什么”，不立机制。
- 来源：`research/1010-ticket-structure.md:197-201`
- 结论：07 不改契约签名。02 契约负责把接口变成编译期事实（含两房 `implements` 对上）；07 只在既有契约下把判定过程讲清。
- 来源：`research/1010-ticket-structure.md:203-207`
- 结论：07 不做接线收尾。全域索引与旧票结账归 13 收口；引用点与展示读数归 12 宿主接线；最后一跳（进程闸账本快照）归 11 且只转被 deck 调到的行。
- 来源：`research/1010-ticket-structure.md:227-233`
