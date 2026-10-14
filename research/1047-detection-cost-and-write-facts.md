# #1047 两件待坐实的事实：判定今天走多少路、以及工作区文件为什么可能写不进去

> 只认一手来源（源码、ADR、门禁脚本、本机实物状态）。每条结论后面跟 `文件:行`。
> 本文件只报事实，不写方案、不做决策。
> 调查时间 2026-10-14；除注明「DSH 侧」的条目外，路径都是本仓工作区相对路径。
>
> **DSH 侧引用的读法**：本机 DSH 桌面版的实现装在 `D:\DeepseekHarness\resources\app.asar` 里，
> 包内路径形如 `dsh/node_modules/@deepseek-ai/<包名>/lib/index.js`。提示里给的
> `D:\DeepseekHarness\resources\app.asar\dsh\` 这个目录在磁盘上并不存在（那只是 asar 归档内的逻辑路径），
> 所以本次是把相关文件从 asar 里抽出来逐行读的。下文 DSH 侧的行号对 asar 内该文件的原文成立。
> 本仓 `research/624-file-channel.md` 第 6.3 节已经核过：asar 内与 profile 物理拷贝逐行一致，
> 只有首行与末尾行是打包/导出伪影。

---

## 第一节 判定今天到底怎么走，成本落在哪里

### 1 四条调用路各自怎么进 `decideBackend`，有没有 `autodetect` 钩子

唯一出口是 `src/tracker/detection/backendDecision.ts:182` 的 `decideBackend(root, deps)`。
四条路都调它，区别只在递进去的依赖包：

| 调用路 | 入口 | 传的依赖 | 有没有 `autodetect` 钩子 |
|---|---|---|---|
| 宿主电话 `wf.detect` / `wf.chain` | `src/host/detectChain.ts:50`、`src/host/detectChain.ts:98` | 经 `detectionService.detect` 转手 | 有，但钩子内容就是直调注册表 |
| deck 工具壳（九个工具共用） | `src/deck/shell/call-shell.ts:259` | `{registry, backendCtx, readWorkspaceFileText, parseWorkspaceFile, readDeclarationId, caller, autodetect}` | 有，且外面包着配额闸 |
| 改色两条电话 `wf.listLabels` / `wf.setLabelColors` | `src/host/workspaceLabelColors.js:86` | `{registry, platform, fs, caller, signal}` | **没有** |
| 面板进工作区补问一次 `wf.selection` | `src/host/workspaceCwd.js:148` | 不走出口，直调 `reg.select` | 不适用 |

分开说清楚：

- **`wf.detect` / `wf.chain`**：两条电话都住 `src/host/detectChain.ts`（`handleDetect` 在 `:43`，
  `handleChain` 在 `:59`），各自调 `detectionService.detect`（`:50`、`:98`）。探测服务由
  `src/host/platformChannel.js:280-316` 建一次，建的时候**没有传 `autodetect`**
  （`src/host/platformChannel.js:316` 的依赖包里有 `decideBackend`，没有 `autodetect`）。
  于是出口走 `deps.autodetect` 缺席那一支，**直调 `registry.select`**
  （`src/tracker/detection/backendDecision.ts:217-220`）。行为上与自己包一层没有区别。
  `wf.chain` 与 `wf.detect` 的差别只在 `handleChain` 多传 `skipSkillProbes` 与一个「环境预检复用位」
  的执行器（`src/host/detectChain.ts:98`），判定本身是同一条。

- **deck 工具壳**：`src/deck/shell/call-shell.ts:230` 的 `pickBackend` 是每笔工具调用的第一件事。
  它把自动识别包成 `directSelect`（`:253-256`）递进出口，整段包在配额闸的 `probe` 一格里
  （`:258`），成功记 1 请求（`:272`）。**有钩子的这条路绕开的是「出口自己直调注册表」那一支**
  （`src/tracker/detection/backendDecision.ts:217` 的 `else if`），换来的是这次识别要过一次闸、
  记一格账（`src/deck/shell/call-shell.ts:241` 的注释把这件事写明）。识别语义没变：钩子里仍是
  `registry.select`（`:255`）。

- **改色两条电话**：`src/host/workspaceLabelColors.js:66` 的 `pickBackend` 调出口
  （`:86-88`），依赖包里**只有 `registry` / `platform` / `fs` / `caller` / `signal`**，
  既没有 `autodetect`、也没有 `readWorkspaceFileText` / `parseWorkspaceFile` / `readDeclarationId`。
  所以它这一路：自动识别由出口直调注册表；工作区文件与声明文件都靠出口自己的 `deps.fs` 分支读
  （`src/tracker/detection/backendDecision.ts:107` 与 `:138`）。

- **`wf.selection`**：`src/host/workspaceCwd.js:138` 的 `handleSelection` **根本不经过判定出口**，
  它自己调 `reg.select({cwd}, {cwd, platform, fs, caller: 'wf.selection'})`（`:148`）。
  这条路没有探测服务那层缓存与失效判据，每次调用都是完整一轮。

装配层只有一处：`src/deck/registration/host-assemble.ts:133-134` 把 `decideBackend` 直接递给九个工具。
顺带一条今天的事实：该文件 `:24` 导入了 `stringifyWorkspaceFile` 与 `WORKSPACE_FILE_REL`，
但全文件没有任何一处使用它们（只有这一行 import 命中），也就是说**工具壳这条路今天不写工作区文件**。

### 2 `decideBackend` 内部每一步实际做了什么

按代码顺序（`src/tracker/detection/backendDecision.ts:182-231`）：

1. `:184-186` 空根直接回 `workspace-not-ready`：**不读文件、不问注册表、不起子进程**。
2. `:191` `registry.bound(handle)` 读内存绑定。实现在 `src/tracker/registry/core.ts:202-205`：
   只查一个 `Map`，**没有 I/O、没有子进程**。命中且已注册即在 `:196` 返回。
3. `:198` → `readFileLayer`（`:100-129`）：按 `[WORKSPACE_FILE_REL, WORKSPACE_FILE_LEGACY_REL]`
   依次试，即 `docs/agents/workspace.yaml` 再 `docs/agents/workspace.json`
   （`src/deck/shell/workspace-anchor.ts:34-36`、`src/shared/config-store/workspace.js:3-4`）。
   每一路径一次 `fs.resolve` + 一次 `fs.readText`（`:110-111`）。读不到/读坏就试下一条（`:114`）。
   **不设超时、不起子进程。**
4. `:203` → `readDeclarationLayer`（`:131-152`）：优先用调用方递进来的 `readDeclarationId`
   （`:133-136`）；没递时 `fs.resolve('docs/agents/issue-tracker.md')` + `fs.readText`（`:139-140`），
   再交给调用方递的 `parseDeclaration` 或退到标题行最小判定（`:141-146`）。**一次 resolve + 一次 readText。**
5. `:210-223` 自动识别：有钩子用钩子（`:216`），否则 `registry.select`（`:219`）。
   `:221-223` 把这一段的异常吞成 `autodetect = null`。`skipAutodetect !== true` 是这条路的总闸（`:217`）。
6. `:224-230` 按结论分档返回。

**这份文件全篇零日志**（`src/tracker/detection/backendDecision.ts:1-233` 无任何 `logCtx` / `fire`）：
走到哪一层、读到了什么，今天从日志里读不出来。

### 3 各房 `matches` 的实际成本

三房的注册顺序是 github → markdown → gitlab（`src/host/platformChannel.js:56-80`），
注册序 = 平局时的赢家（`src/tracker/registry/core.ts:170-173`）。

**GitHub**（`src/tracker/rooms/github/backend.ts:30-60`）

- `:32-36` `handle.refId` 含 `/` 即命中：**零 I/O、零子进程**。
- `:41-47` 读 `.git/config`：一次 `fs.resolve('.git/config', {cwd})` + 一次 `fs.readText`。
- `:49-55` 回落起子进程：`git -C <cwd> remote get-url origin`，`timeout: 3000`（`:51`）。
  **这个 3000 写死在调用点，不在任何共享常量里。**
- 本机现场：本仓 `.git/config` 里的 remote 是 `https://github.com/...`（三个 remote 全是 github.com），
  所以 github 那一路在 `:45` 就命中，**不起 `git`**。

**GitLab**（`src/tracker/rooms/gitlab/index.js:28-66`）

- `:32` `refId` 含 `gitlab` 即命中：零 I/O。
- `:40-45` 读 `.git/config`：这一处**没有 resolve**，直接把
  `platform.path.join(cwd, '.git', 'config')` 交给 `fs.readText`（`:41-43`）。
  这与 DSH 文件服务「`readText` 吃目标对象、不吃裸路径」的形状不一致
  （`@deepseek-ai/dsh-fs-local/lib/index.js:826-830`），真实环境下这一步的结局是**抛错被 `:45` 吞掉**。
- `:47-51` 读 `docs/agents/issue-tracker.md`：同样是**裸路径直接 `fs.readText`**（`:48-49`），同样会抛错被吞。
- `:53-60` 起子进程兜底：`git remote get-url origin`，`timeout: 2000`（`:56`）。
  **注释写着「best-effort，5s」，真实值是 2000ms，代码与注释不一致。**
- 本机现场：`.git/config` 里没有 `gitlab` 字样，所以 gitlab 那一路最终会走到 `:56` 起一次 `git`——
  前提是它能走到那里（`:38` 要求 `fs` 与 `platform` 都在）。

**Markdown**（`src/tracker/rooms/markdown/index.ts:17-58`）

- `:28-30` 先加 `.scratch/map.md` 这个候选；`:23-27` 在 `refId` 含 `.scratch` 时再加两个候选。
- `:32-40` 列举 `.scratch/` 的子目录：`fs.resolve(root)` + `fs.listDir(target)`（`:33`），
  每个子目录再拼一个 `<name>/map.md` 候选（`:38`）。
- `:41` 对每个候选调 `exists`；命中即 `true`，**短路**。
- `:43-55` 以上全不命中时，读 `docs/agents/issue-tracker.md` 看有没有 `Local Markdown`（`:44-53`）。
- `exists` 的实现在 `src/tracker/rooms/markdown/read.ts:19-40`：先 `fs.lstat(fullPath)`（`:25`），
  失败再试 `resolve`+`lstat`（`:28`）、`resolve`+`stat`（`:33`）、裸 `stat`（`:35`），
  最后兜底读一次全文（`:39`）。也就是说**每个候选最少一次 lstat**。
- 本机现场（实测计数）：`.scratch/` 下有 **198 个**子目录，`.scratch/map.md` 不存在，
  但 `.scratch/572-debug/map.md` 存在。所以本仓跑一次 markdown 的 `matches` 要
  1 次 `resolve` + 1 次 `listDir` + 约 **199 次 lstat**（枚举顺序取决于是哪一个先被查到），
  而且 `.scratch` 越大这个数越大——这不是常量成本。
- **没有子进程**，也没有自己的超时。

**谁写死了超时常量**：三个房各写各的——github 3000（`src/tracker/rooms/github/backend.ts:51`）、
gitlab 2000（`src/tracker/rooms/gitlab/index.js:56`）、markdown 没有。
注册表那层另有一个兜底等待 `MATCHES_TIMEOUT_MS = 30000`
（`src/tracker/registry/core.ts:25`），它**只包住整次 `matches` 的等待**，
不覆盖房内 `exec` 自己那个 timeout。

### 4 注册表 `select` 的形状

实现在 `src/tracker/registry/core.ts:142-189`：

- `:145-148` 空目录直接回 `unknown-workspace`，不起任何命令。
- **① 内存绑定**（`:154-159`）：`byHandle` 命中且 `byId` 里有这个 id，立即返回
  `{backendId, source: 'explicit', ref}`。**它短路掉的是整段 `matches`**——一次 `matches` 都不跑、
  一个计时器都不起。绑了 `null`（显式无后端）同样在这里返回（`:156`）。
  绑定指向的 id 已不在注册表里时会落到 ②（`:158` 的注释）。
- **② `matches` 并行**（`:161-181`）：`Promise.all` 同时问所有已注册后端（`:165`），
  每一路用 `withTimeout` 包一层（`:166`），**整体超时 30000ms**（`:25`、`:65`）。
  单路抛错记成 `false`（`:41`），超时记成 `pending`（`:167`）并且会 `controller.abort()`（`:36`）。
  所以是**并行 + 一路一个独立计时器 + 超时 abort**，不是串行。
- **多命中**（`:172-181`）：`hits[0]` 按注册序取赢家，同时把全部命中放进 `multiHit`（`:178`）
  原样交出去；有超时的另带 `pending: true`（`:179`）。
- **③ 回落**（`:187-188`）：无命中无 pending 才是干净的 `fallback`；有 pending 必须带出去。
- 每次 `select` 落一行 `registry.select`（`:174`、`:187`），字段是
  `cwdHash` / `backendId` / `source` / `latencyMs` / `caller`。

**一个今天就能复现的现场**：本仓里 github 那一路（`.git/config` 含 github.com）与 markdown 那一路
（`.scratch/572-debug/map.md` 存在）**同时命中**，注册序在前的是 github，
所以今天这个工作区是「github 赢了、但 `multiHit` 里躺着两个」。
两条读用途的电话照常能走（`multiHit` 只在写用途上被拦），
但工具壳的写用途会因此拒绝（`src/deck/shell/call-shell.ts:288-323` 与
`src/host/workspaceLabelColors.js:122-126`）。

### 5 调用频次与缓存

**缓存**（`src/tracker/detection/detectionService.ts:154-184`、`:278-282`，
`src/tracker/detection/workspaceStore.ts:23-63`）：

- 键 = `handleKey(handle)` = `cwd|refId`，**就是目录字符串本身**（`workspaceStore.ts:16-21`），
  只放在内存 `Map` 里，不落盘。
- 新鲜度还有一层 TTL：`DEFAULT_TTL = 30000`（`workspaceStore.ts:12`），
  生产装配时由 `STATUS_CACHE_MS = 30000` 覆盖（`src/host/platformChannel.js:35`、`:190`）。
- **不缓存/不取缓存的四种情况**：`force` 直通（`detectionService.ts:154`）；
  `selection.pending` 不写也不读（`detectionService.ts:156`、`:278`、`workspaceStore.ts:55`）；
  `preflight` 是 `env` 失败时不读也不写（`detectionService.ts:158`、`:280`）；
  工作区已被清空时缓存的显式选择判过期（`detectionService.ts:163` → `isWorkspaceEmpty` `:49-94`）。
- 第五条作废判据是**手改文件即时生效**：缓存里记了 `fileMs`，对不上就失效重算
  （`detectionService.ts:171-176`）。

**命中缓存时还剩什么成本**（`detectionService.ts:154-184`）：不是零成本。

- 每次命中都要跑一次 `isWorkspaceEmpty`（`:163`），它先试
  `fs.resolve(cwd)` + `fs.listDir(target)`（`:57-60`）——**一次真实目录列举**；
  只有拿不到列目录能力时才退到 5 个锚点探测（`:74-88`）。
- 然后每次命中都要跑一次 `workspaceFileMs`（`:173` → `:101-117`），
  它依次对 `docs/agents/workspace.yaml`、`docs/agents/workspace.json` 各做一次
  `fs.resolve` + `fs.stat`（`:108-110`）。
- 也就是说：**命中路径今天的成本 = 1 次 listDir + 4 次（resolve+stat）里能走到的那几次**，
  没有 `matches`、没有子进程。

**各调用方会触发几次判定**：

| 调用方 | 触发次数 | 说明 |
|---|---|---|
| `wf.detect` | 每次调用 1 次 | `src/host/detectChain.ts:43-57`；走探测服务，有缓存 |
| `wf.chain` | 每次求值 1 次 | `src/host/detectChain.ts:98`；同上 |
| 面板首帧 | 没有独立的「首帧判定」入口 | `wf.selection` 是「进工作区时若还不知道用哪个后端就补问一次」，由 `src/client/kernel/probe-select.js:45-77` 的 `askSelectionOnce` 触发 |
| 状态栏 | 不轮询 | `src/client/statusbar/StatusBar.js:176` 的注释记着 2 秒轮询已在 #725 去掉；状态栏读的是 `s.selection` |
| 设置页对每个工作区 | **每个工作区 1 次** | `src/client/views/SettingsWorkspaces.js:38` 在 `all` 上 `for` 循环，逐个 `wf.selection` |
| 工具壳每次调用 | 每笔工具调用 1 次 | `src/deck/shell/call-shell.ts:230-273`，过闸记 1 请求 |
| 改色两条电话 | 每次调用 1 次 | `src/host/workspaceLabelColors.js:86` |
| 还有三处后台调用 | 各自最多 1 次 | `src/host/sessionLifecycle.js:156`、`src/host/handoffClaim.js:116`、`src/host/snapshotBuild.ts:143`、`src/host/refresh/wiring.js:229` |

**这里有一条关键分叉**：`wf.selection`（`src/host/workspaceCwd.js:148`）、`wf.listLabels` /
`wf.setLabelColors`（`src/host/workspaceLabelColors.js:86`）这两路**都不吃探测服务那份缓存**
（前者不经探测服务，后者不经探测服务）。所以「设置页对每个工作区循环一次」= 每个工作区
**完整跑一遍三层 `matches`**；而这一轮里 markdown 那一路的成本随 `.scratch` 子目录数增长。

### 6 如果改成「两条规则都执行、都收集」，多出来什么

先说清楚今天的分叉点在哪：出口的第 3 层（声明文件，`backendDecision.ts:203`）与第 4 层
（`registry.select` → 各房 `matches`，`:210-223`）是**串行且互斥**的——
第 3 层命中就在 `:205` 返回，第 4 层整段不执行；第 3 层不命中才轮到第 4 层。
而第 4 层内部，各房 `matches` 已经是**并行**的（`registry/core.ts:165`）。
所以「两条规则都走」多出来的，主要是**第 3 层与第 4 层之间的那次互斥**，
加上「把两边的命中都留下来」这件事本身。

**调用次数清单（可核对，全部按代码结构数出来，不是估算）**：

今天一次「三层都不命中、走到 `matches`」的判定，读盘与子进程次数（以本仓为现场）：

| 项目 | 今天 | 两条规则都执行后 | 依据 |
|---|---|---|---|
| 工作区配置文件读 | 2 次 resolve + 2 次 readText（新老两路径，只在文件存在时才真读到内容） | 不变 | `backendDecision.ts:102-115` |
| 声明文件读 | 0 次（被第 4 层挡住了） | +1 次 resolve + 1 次 readText | `backendDecision.ts:139-140` |
| github `matches` | 1 次 `readText`（`.git/config`）；不起 `git` | 不变 | `rooms/github/backend.ts:43-45` |
| gitlab `matches` | 1 次 `readText`（裸路径，今天会抛）+ 1 次 `git remote`（2000ms） | 不变 | `rooms/gitlab/index.js:43`、`:56` |
| markdown `matches` | 1 次 `resolve` + 1 次 `listDir` + 约 199 次 lstat（本仓 198 个子目录） | 不变 | `rooms/markdown/index.ts:33`、`:41`、`read.ts:25` |
| 声明文件读（markdown 那一支的兜底） | 多一次 `readText`（`rooms/markdown/index.ts:44-53`） | 不变 | 同左 |
| **合计新增** | — | **+1 次 resolve、+1 次 readText、0 次子进程** | — |

**结论（可核对的那一半）**：如果只是「声明文件 + 各房 `matches` 都执行、都收集」，
按今天的代码结构，每次判定多出来的是**一次声明文件读取（1 次 resolve + 1 次 readText）**
与「多留一份命中名单」的内存开销；**子进程次数不再增加**（因为各房 `matches` 今天已经是并行全跑，
没有任何一路是被声明文件挡掉的）。真正会增加的子进程只可能来自另一件事：
如果「都收集」意味着要对每一路命中再各跑一次它自己的 `getRepoKey` 之类的补全，
那才会多出 `git remote` 这类子进程——**这件事今天不在判定里，不能记在「判定」的账上**。

**毫秒数：未实测，只能给出调用次数。** 理由是上面这些数字全部来自代码结构与本机目录计数，
没有在真机上跑过一次「两条规则都执行」的计时。要给出毫秒数需要一次真实计时实验，
本次没有做。**唯一的实测量级参考**：markdown 那一路的 lstat 次数随 `.scratch/` 子目录数线性增长
（本仓 198 个子目录 → 约 199 次 lstat），它是这一轮里次数最多的一项。

**哪些调用路会明显变慢**（按「今天有没有短路保护」判断）：

1. **`wf.selection`（设置页每个工作区一次、进工作区补问一次）最明显**：它今天不吃任何缓存，
   每次都是完整一轮（`src/host/workspaceCwd.js:148`）。
2. **改色两条电话**：同样不吃缓存，且它在写用途上本来就要 `canWrite`
   （`src/host/workspaceLabelColors.js:119`、`:142`），多一次读盘的同时不会换来更多信息。
3. **工具壳每笔调用**：每笔工具调用都要过这一次，多一次读盘；
   而且多出来的声明文件读取如果拿不到结论，`multiHit` 那条拒绝对话（`:288-323`）会更频繁地出现。
4. **`wf.detect` 最不明显**：它今天有 30 秒 TTL 缓存，命中时本来就要跑 1 次 listDir + 若干次
   resolve+stat（`detectionService.ts:163`、`:173`），多一次文件读取在这一堆里不显眼。
5. **`wf.chain` 更不明显**：它自带退避与全绿缓存（`src/host/detectChain.ts:75-84`），
   未全绿时才真跑。

---

## 第二节 工作区文件的写入通道能不能保证写成功

### 7 文件通道的能力清单，以及 `writeText` 的真身

**本仓这一侧的声明**：`src/host/platform/index.js:21` 写着 `fs`：**透传** `ctx.get('fs')`，
**「无 `mkdir`」**，并提示 path-shaped（`lstat` / `resolve`）与 target-shaped
（`readText` / `writeText` / `stat` / `listDir`）两种形状不能混用。
`:47` 的 `@property` 再次列了同一份清单：`lstat/readText/writeText/resolve/listDir/stat`，无 `mkdir`。

**真身在哪**：`ctx.get('fs')` 注册的是 `@deepseek-ai/dsh-fs-sandbox` 的 `SandboxedFileSystem`
（本仓 `research/624-file-channel.md:21`、`：411` 已经核过），
实现在 asar 内的 `dsh/node_modules/@deepseek-ai/dsh-fs-sandbox/lib/index.js`。
它 `extends LocalFileSystem`（`dsh-fs-sandbox/lib/index.js:104`），只覆写 `writeText`（`:126-128`）
与 `editText`（`:140-142`）两个写方法。

**`writeText` 的实现读出来是这样**：

```js
// dsh-fs-sandbox/lib/index.js:126-128
async writeText(target, content, expected, signal, sandboxPolicy) {
    return super.writeText(await this.checkedTarget(target, sandboxPolicy), content, expected, signal);
}
// dsh-fs-sandbox/lib/index.js:154-167（checkedTarget）
const policy = sandboxPolicy ?? this.ctx.sandboxPolicy.resolve();
if (mode === "danger-full-access") return target;
if (mode === "read-only") throw new FsError(`cannot write "${target.displayPath}": file access denied under read-only mode`, "FS_SANDBOX_DENIED");
const fresh = await this.resolve(target.displayPath);
for (const root of writableRoots(policy)) if (await isPathUnder(fresh.targetKey, root)) { contained = true; break; }
if (!contained) throw new FsError(`cannot write "${target.displayPath}": file access denied under workspace-write mode`, "FS_SANDBOX_DENIED");
```

**会不会自动建父目录：会。** 父类 `LocalFileSystem.writeText`
（`dsh-fs-local/lib/index.js:865-874`）最终落到 `writeFileAtomic`
（`dsh-fs-local/lib/index.js:513-578`），它的第一句就是：

```js
// dsh-fs-local/lib/index.js:515-516
const directory = dirname(absolutePath);
await mkdir(directory, { recursive: true });
```

另有一个零依赖的原子替换实现 `@deepseek-ai/dsh-atomic-write`
（`dsh-atomic-write/lib/index.js:62-78`），同样在开头
`await mkdir(dirname(filename), { recursive: true })`（`:63-66`）。

**写入是不是原子替换：是。** `dsh-fs-local/lib/index.js:513-578` 的写法是：
建父目录 → 在同一父目录下建一个随机名 staging 目录（`:518-519`、`:532`）→
在 staging 里 `open(tempPath, "wx", 384)` 独占创建（`:535`）→ 写入并 `handle.sync()`（`:538-542`）→
在 Windows 上先 `copyFileDacl` 复制原文件 DACL（`:537`）→ `handle.close()`（`:548`）→
最后 `link`（createIfAbsent）或 `replaceFile`/`rename` 发布（`:551-562`），
发布后删掉 staging 目录（`:563-565`）。失败路径删掉临时物再抛（`:566-577`）。

**失败时抛什么**：抛 `FsError`，它 `extends HarnessError`
（`dsh-fs/lib/index.js:35-41`），而 `HarnessError` 只带一个 `code` 字段
（`dsh-llm/lib/index.js:127-135`：`constructor(message, code, options)`，`this.code = code`，
`this.name = new.target.name`，`cause` 走标准 `ErrorOptions`）。**没有 `kind` 字段。**
已知的错误码（同一套词表，`dsh-fs/lib/index.js` 与 `dsh-fs-local/lib/index.js` 共用）：

- `FS_SANDBOX_DENIED`（沙箱拒绝，两种模式的措辞不同，见上）
- `FS_NOT_FOUND`（`dsh-fs-local/lib/index.js:171`、`:180`、`:296` 等）
- `FS_NOT_DIRECTORY`（`:297`）、`FS_NOT_REGULAR_FILE`（`:360`、`:493`）
- `FS_NOT_TEXT`（`:330`）、`FS_TOO_LARGE`（`:390`）、`FS_ABORTED`（`:406`）
- `FS_NOT_OBSERVED`（`:493-495`，「没先读就想覆盖」）、`FS_STALE_VERSION`（`:870-871`）
- `FS_IO_ERROR`（`:271`、`:496`）、`FS_PERMISSION_DENIED`（`:270`）

消息形状统一是 `cannot <动作> "<displayPath>": <一句英文原因>`，`displayPath` 是绝对路径原文。

**这份通道确实没有 `mkdir`**：`dsh-fs` 的抽象基类只声明了
`watch` / `sandboxMode` / `processPathFromHostPath`（`dsh-fs/lib/index.js:59-97`），
`LocalFileSystem` 的公开方法表是 `resolve` / `processPath` / `processPathFromHostPath` / `fileUrl` /
`contains` / `stat` / `lstat` / `readText` / `streamText` / `readBytes` / `readByteRange` /
`listDir` / `writeText` / `editText` / `versionAfterWrite`
（`dsh-fs-local/lib/index.js:781-904` 逐个方法定义处）——**`mkdir` 不在其中**。
建目录的能力在 `writeFileAtomic` 内部，不对外暴露。

### 8 `workspaceCwd.js:203` 那句「先建父目录」的守卫

原文（`src/host/workspaceCwd.js:201-204`）：

```js
try {
  const platPath = await getPlatform().then(function (p) { return (p && p.path) || null }).catch(function () { return null })
  if (platPath && typeof platPath.dirname === 'function' && typeof fsSvc.mkdir === 'function') { try { await fsSvc.mkdir(platPath.dirname(target2), { recursive: true }) } catch (eM) {} }
} catch (eD) {}
```

**结论：在这份通道下会永远跳过。** 守卫的第二个条件是 `typeof fsSvc.mkdir === 'function'`，
而 `fsSvc` 就是 `platform.fs`（`:179`）即 DSH 沙箱文件服务，它**没有 `mkdir`**
（见上一节的方法表）。所以 `if` 永远为假，`await fsSvc.mkdir(...)` 一次也不会执行。
`src/host/workspaceCwd.js:206` 的第二次重试前的「再建一次父目录」是同一份代码，同样永远跳过。
`src/host/workspaceCwd.js:98`（`handleSetupLayout` 里那一处）也是同一个形状，同样永远跳过。

**那么 `docs/agents/` 不存在时会发生什么：不会因此失败。**
因为 `writeText` 内部自己会 `mkdir(dirname, {recursive: true})`
（`dsh-fs-local/lib/index.js:515-516`），父目录会在写入时被建出来。
也就是说：**这条守卫是死代码，但它的缺席并不造成写失败**——
它是多余的保险，不是必需的一步。这三处守卫没有门禁盯着（本次没有找到断言它们真的执行过的测试）。

顺带把「读」这一侧的同一形状记一笔：`fsSvc.resolve` 对不存在的路径**不抛错**，
它会 realpath 最深的已存在祖先再把缺的后缀拼上去
（`dsh-fs-local/lib/index.js:170-213`，`:184-198` 是拼接那一段），
返回的 `targetKey` 是「将来这个文件该在哪」的稳定身份。所以读一个还不存在的工作区文件，
走的是「拿到目标 → `readText` 抛 `FS_NOT_FOUND` → 被调用方吞掉」这条路，
而不是 resolve 阶段就失败。

### 9 `resolveSandboxPolicy(args, cwd)` 在什么情况下拒绝写

实现在 `src/host/workspaceCwd.js:325-341`。它**不抛错**，只有两种返回：

- `{ policy: <对象>, sessionId: <会话号> }`：先按 `args.sessionId` 找会话（`:329`），
  找不到就在这个工作区下找「目录正好是它」的会话（`:331`），再找不到就找「开在它下面的」会话（`:334`）；
  正好一个就用它，调 `svc.resolve({session})`（`:339`）。
- `{ policy: undefined, sessionId: '' }`：**这四种情况都会走这里**——
  `ctx.get('sandboxPolicy')` 取不到或没有 `resolve` 方法（`:328`）；
  传了会话号但那会话查不到且工作区下也找不到唯一会话（`:338`）；
  工作区下有多个会话无法确定是哪一个（`:332` 的 `hits.length === 1` 不成立）；
  以及整个函数抛错时的兜底（`:340`）。

**`policy: undefined` 意味着什么**：调用方把它当第 5 个参数传给 `writeText`，
`checkedTarget` 里的 `sandboxPolicy ?? this.ctx.sandboxPolicy.resolve()` 于是**回退到部署默认政策**
（`dsh-fs-sandbox/lib/index.js:155`）。注释把这条口径写死了：
「无归属会话不取默认政策，免静默落错档」（`src/host/workspaceCwd.js:338`）——
也就是**故意不自己在插件里拼一个宽松政策**（`:321-322`）。

**拒绝时抛什么**（这一层是 DSH 的，不是插件的）：`FsError`，`code = 'FS_SANDBOX_DENIED'`，
消息两种：

- `read-only` 模式：`cannot write "<displayPath>": file access denied under read-only mode`
- `workspace-write` 模式且目标不在可写根下：
  `cannot write "<displayPath>": file access denied under workspace-write mode`

可写根的定义在 `dsh-sandbox/lib/index.js:167-174`：`workspace-write` 时是
`[policy.workspaceRoot, "/tmp", os.tmpdir()]` 三个去重后的规范路径；`read-only` 时是空数组；
`danger-full-access` 时 `checkedTarget` 在 `:157` 就直接放行了，根本不查根。

**本机的现场政策**（这条决定今天到底会不会被拒）：桌面版 profile 的
`~/.dsh/profiles/desktop/cordis.patch.yml:29-42` 把权限预设的默认档设成了
`defaultPreset: danger-full-access`（`:42`）。而在 `danger-full-access` 下
`checkedTarget` 在 `:157` 直接返回目标，**不查可写根**。
本次会话开头收到的运行期快照也写着同一件事：「Current DSH file policy: danger-full-access」
（这与 `dsh-sandbox-policy/lib/index.js:77` 里 `renderPolicyContext` 的原文逐字同形）。
**所以在本机这一档默认下，写用户工作区不会被沙箱拒。**

**`fileWriteReasonOf` 认哪几种原因**（`src/host/workspaceCwd.js:10`）：

```js
const s = String((e && (e.code || e.message)) || e || '');
return /EACCES|EPERM|permission|denied|permit|沙箱/i.test(s) ? 'no-permit'
     : (/EROFS|read-only|readonly/i.test(s) ? 'readonly'
     : (/ENOENT|not found|不存在/i.test(s) ? 'no-dir' : 'other'))
```

四档各对应的人话（`src/host/workspaceCwd.js:7-8` 的注释写明这四档的依据）：

| 代号 | 判据（正则，顺序匹配，先中先算） | 它想说的意思 |
|---|---|---|
| `no-permit` | `EACCES` / `EPERM` / `permission` / `denied` / `permit` / `沙箱` | 拿不到文件通道，或沙箱不给本次写许可 |
| `readonly` | `EROFS` / `read-only` / `readonly` | 文件系统只读 |
| `no-dir` | `ENOENT` / `not found` / `不存在` | 目录不存在 |
| `other` | 以上都不中 | 判不出来就归这里，不编一个具体原因 |

因为 `FsError` 的 message 是 `cannot write "...": file access denied under workspace-write mode`
这种形状（含 `denied`），**沙箱拒绝会被分到 `no-permit`**，不是 `readonly`——
即使当时会话的模式就是 `read-only`。这是分类正则的实际落点，与注释里「文件系统只读」那一档的
字面期待不完全对齐。

**同一份四档在别处也有一份，且口径不同**：`src/host/workspaceCwd.js:74` 那一处（`handleBind`
兜 `writeWorkspaceFileOnFirstBind` 抛出来的错）用的是同一个 `fileWriteReasonOf`，一致；
但 `src/host/workspaceCwd.js:102`（`handleSetupLayout`）用的是**函数返回值**而不是抛出的错误，
也是同一个函数。三处共用一份分类。

### 10 两处「没写文件也返回成功」的出口，调用方拿到会怎么处理

两处都在 `writeWorkspaceFileOnFirstBind`（`src/host/workspaceCwd.js:165-214`）里，
都是**主动跳过**，不是失败：

**出口一：`:171` `{ ok: true, skipped: 'explicit-none' }`**
条件 `!backendId || typeof backendId !== 'string' || backendId.trim() === ''`。
也就是用户选的是「显式无后端」逃生舱（`backendId` 为 `null`）时：
不写文件、不说失败，如实说「跳过，原因是显式无后端」。

**出口二：`:174` `{ ok: true, skipped: 'unregistered' }`**
条件 `!reg.has(backendId)`。也就是这个 id 不在当前注册表里：
同样不写文件、不说失败。
`:175` 还有第三个跳过出口 `{ ok: true, skipped: 'registry-unavailable' }`（注册表整个问不到）。

**调用方怎么处理**：

- `handleBind` 把它原样放进回包的 `workspaceFile` 一项（`src/host/workspaceCwd.js:74-75`），
  回包形状是 `{ ok: true, cwd, backendId, labelColorsFile, workspaceFile, rev, persisted }`。
- 客户端在收到 `wf.bind` 回包时把它记进会话状态：
  `src/client/panel/OverlayGate.js:53`、`src/client/statusbar/StatusBackend.js:201`、
  `src/client/kernel/store-switch.js:180` 三处都调 `adoptBoundRev`，
  它在 `src/client/kernel/store-prefs.js:262-265` 把
  `res.workspaceFile`（兼容 `res.value.workspaceFile`）整条存进 `st.workspaceFileResult`。
- 界面显示由 `src/client/kernel/store-prefs.js:271-282` 的 `workspaceFileNoteOf` 决定，
  节点由 `:284-290` 的 `workspaceFileNoteEl` 造，挂在状态栏上
  （`src/client/statusbar/StatusBar.js:300` 与 `:336` 两处都挂了）。
  三种结果的界面话：

  | 回包形状 | 状态栏那句 |
  |---|---|
  | `ok !== true` 且（`ok === false` 或带 `error`） | 「这次没能把选择写进工作区里的配置文件（绑定照旧有效，下次再选一次可以重试）。」 |
  | `ok === true` 且带 `skipped` | **空串，不显示**（`:278`） |
  | `ok === true` 且 `reason === 'overwritten'` | 「已把这次选择写进工作区里的配置文件（覆盖了原来那一条）。」 |
  | `ok === true` 其余 | 「已把这次选择写进工作区里的配置文件。」 |

  形状对不上又没带失败原因时也回空串（`:276`）：宁可不说话，不替一次没发生的失败下结论。

**一句要紧的话**：这两个跳过出口，从回包到界面都**看不出「这次其实没写文件」**——
`skipped` 一律翻译成空串。而 `handleBind` 的 `ok: true` 也不受它影响，
所以一次「绑定成功但工作区文件没写」在界面上与「写成了」长得一样（只少了那行成功小字）。

### 11 结论：把「写失败」的可能原因列成一张表

前提先说清楚（这三条决定表的读法）：这是**唯一写入口**（`src/host/workspaceCwd.js:160-164`
的注释写明），入口是 `wf.bind` → `handleBind`（`:46`）→ `writeWorkspaceFileOnFirstBind`（`:165`）；
本机部署默认档是 `danger-full-access`（`~/.dsh/profiles/desktop/cordis.patch.yml:42`）；
本仓工作区里 `docs/agents/` 目录**存在**，但 `docs/agents/workspace.yaml` 与
`docs/agents/workspace.json` **都不存在**（目录实测：只有 `commit-convention.md`、`domain.md`、
`issue-tracker.md`、`triage-labels.md`、`verification.md` 这五个 md 文件；
全仓递归找 `workspace.y*ml` 零命中）。这份报告开头引用过的
`research/1047-detection-background.md:13-14` 记的是同一件事。

| # | 可能的失败原因 | 触发的代码位置 | 归谁 |
|---|---|---|---|
| 1 | 拿不到文件通道（`platform.fs` 缺席，或缺 `resolve`/`readText`/`writeText` 中任一个） | `src/host/workspaceCwd.js:181-184`，回 `{ok:false, error:{kind:'env', message:'…没拿到可用的文件通道…'}}` | **真环境限制**（DSH 没挂 fs 服务）；本机不适用 |
| 2 | 沙箱 `read-only` 拒绝 | `dsh-fs-sandbox/lib/index.js:158`，`FS_SANDBOX_DENIED` | **真环境限制**（会话自己选的那一档，插件不该越过——`src/host/workspaceCwd.js:338` 的注释与 `research/624-file-channel.md:214` 同口径） |
| 3 | 沙箱 `workspace-write` 但可写根不含目标 | `dsh-fs-sandbox/lib/index.js:159-165`；可写根见 `dsh-sandbox/lib/index.js:167-174` | **真环境限制**，但**本仓今天不会发生**：部署默认是 `danger-full-access`，`:157` 直接放行 |
| 4 | 找不到归属会话，政策整个 `undefined`，于是回退到部署默认政策 | `src/host/workspaceCwd.js:328`、`:332`、`:338`、`:340` | **不确定**：在 `danger-full-access` 下无害；若哪天部署默认换成 `workspace-write`，这里就会因为「拿不到会话」而写到 DSH 进程的当前目录那一档可写根上，被拒。属于「静默降级到另一档政策」，是一条真实风险，本次没有实测 |
| 5 | 目标不是普通文件（路径上挡着一个目录） | `dsh-fs-local/lib/index.js:868`，`FS_NOT_REGULAR_FILE` | **真环境限制**（磁盘上的东西不是我们造的）；本机不适用 |
| 6 | 覆盖已有文件却没先读过它 | `dsh-fs-local/lib/index.js:872`，`FS_NOT_OBSERVED` | **我们自己的缺陷**（`writeWorkspaceFileOnFirstBind` 从不传 `expected`，第 3 个参数恒为 `undefined`，所以这一支永远走不到；但如果将来有人传了 `expected` 而没先读，就会踩这里） |
| 7 | 文件被别处改过，版本对不上 | `dsh-fs-local/lib/index.js:870-871`，`FS_STALE_VERSION` | **我们自己的缺陷**（同上，今天 `expected` 恒为 `undefined`，这一支走不到） |
| 8 | 相对路径没带 `{cwd}`，被当成本进程当前目录下的相对路径 | `dsh-fs-local/lib/index.js:155-160` 的 `localDisplayPath(cwd, path)`；本仓的写法见 `src/host/workspaceCwd.js:188`、`:200`（两处都带了 `{cwd}`） | **我们自己的缺陷**（今天是带对的；这一条记下来是因为它一旦写错，症状就是写去了别的地方而不是报错） |
| 9 | 建父目录那一步是死代码 | `src/host/workspaceCwd.js:203`、`:206`（`typeof fsSvc.mkdir === 'function'` 恒假） | **我们自己的缺陷，但不造成失败**：`writeText` 内部自己会 `mkdir(dirname, {recursive:true})`（`dsh-fs-local/lib/index.js:515-516`）。这三处守卫没有测试盯着 |
| 10 | 「没写文件也返回成功」的两个出口在界面上看不出来 | `src/host/workspaceCwd.js:171`（`explicit-none`）、`:174`（`unregistered`）、`:175`（`registry-unavailable`）；`src/client/kernel/store-prefs.js:278` 把 `skipped` 翻成空串 | **我们自己的缺陷**（不是写失败，是「没写也不说」，与失败共用一个静默路径） |
| 11 | 失败原因分档把沙箱拒绝归到 `no-permit` 而不是 `readonly` | `src/host/workspaceCwd.js:10` 的正则顺序 | **我们自己的缺陷**（分类与注释的字面期待不一致；不过这一档今天没有消费者——`:213` 的 message 只把 `msgOf(eW)` 截 120 字放进去，`reason` 没有进界面） |
| 12 | 内存绑定写成功、本机记忆写成功、只有工作区文件写失败 | `src/host/workspaceCwd.js:75` 的 `rev` 与 `persisted` 只跟 `rememberWorkspace` 的结果挂钩（`:72`） | **我们自己的缺陷**（回包用 `ok: true` 表示整体成功，文件的成败藏在 `workspaceFile` 里；调用方若不读那一格就完全看不见） |

**这张表的总回答**：**「环境限制」与「我们自己的缺陷」两类都存在，而今天卡住写失败最可能的一条不在表里
前几行，而是「写失败这件事本身在界面上几乎无声」**：
- 通道本身今天具备写成的一切条件（`danger-full-access` 放行、`writeText` 自建父目录、原子替换）；
- 本仓工作区里 `docs/agents/` 存在、`workspace.yaml` 不存在，也就是说**这一次写入会走 `created` 这条路，
  不会被任何「版本前提」拦住**；
- 真正会让人以为「写失败」的，是第 10 行与第 12 行那两个静默路径，以及失败时状态栏那一句
  只有一行小灰字、不带原因档的提示。

**没有实测的部分**：本次没有在活着的插件宿主进程里真的写过一次
（`research/624-file-channel.md:451` 第 8 节第 1 条留的同一个空白，今天仍然空着）。

---

## 没查到的项

1. **「两条规则都执行」的真实毫秒数**：没有实测，本文只给了调用次数清单（第一节第 6 节）。
   要做需要一次真实计时实验。
2. **活着的宿主进程里的一次真写入**：没有实测。`ctx.get('sandboxPolicy')` 在运行中的插件里
   拿到的是哪一个实例、`resolve({session})` 给的政策是本机哪一档，本次只从部署配置
   （`~/.dsh/profiles/desktop/cordis.patch.yml:42`）与本次会话的运行期快照推出来，没有在插件里打点验证。
3. **`danger-full-access` 是不是这个工作区会话当前生效的那一档**：运行期快照说本次会话是这一档
   （与 `dsh-sandbox-policy/lib/index.js:77` 的渲染原文同形），但会话级的 `sandbox/mode` 覆盖
   是按会话记在会话日志里的（`dsh-sandbox-policy/lib/index.js:7-25`），本次没有去读会话日志核对。
   如果用户那个会话的覆盖不是这一档，第 3 行的「不会发生」就不成立。
4. **`workspaceFile` 回包在客户端之外还有没有别的消费者**：本次只找到
   `store-prefs.js` 那一条链（`adoptBoundRev` → `workspaceFileNoteOf` → 状态栏）。
   没有逐个检查客户端插件里有没有别的地方读这一格。
5. **`fileWriteReasonOf` 的四档有没有任何一处被展示给人**：本次追到的用法是
   `src/host/workspaceCwd.js:74`、`:213` 两处塞进 `error.reason`。没有找到读 `reason` 的界面代码——
   但这不等于没有（客户端可能按 `.error.reason` 的泛型形状读过），没有全仓逐字核对。
6. **三个房 `matches` 各自在本机真实耗时**：没有实测。本文给的是调用次数与量级判断。
7. **`src/tracker/rooms/gitlab/index.js` 里那两处裸路径 `fs.readText`（`:43`、`:49`）在真机上
   到底抛的是什么错**：从 DSH 侧的代码形状推断会抛（`readText` 吃目标对象，见
   `dsh-fs-local/lib/index.js:826-830`），没有在真机上跑一次看它抛什么。
8. **`.scratch/` 里 198 个子目录这个数字的稳定性**：这是 2026-10-14 当时的实测值。
   它是本仓的工作产物，会随工作区变化。
