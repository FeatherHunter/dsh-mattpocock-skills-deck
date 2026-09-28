# 研究：DSH 0.1.7-rc.1 会话创建接口到底变了什么（#737，地图 #736 子票）

> 只读研究，不改代码、不改票。结论只对下面列出的一手来源负责；0.1.7-rc.1 自身的改动点不在仓内，需要按文末方法到真机重测，不能直接沿用旧版本号的结论。
> 日志字段口径遵守 `research/489-appendix.md`（令牌原文永不记、路径只记散列、标题与错误文本截断，见该附录 1.2 节）。

## 问题一句话

DSH 0.1.7-rc.1 起，插件所有开新会话入口都走兜底：当前会话注入加右下角 `toast.newSessionManual` 让用户手动新建。之前同样代码正常。

## 一手来源与行号（按查阅顺序）

### 1. 新会话主链路：`src/client/kernel/api-new-session.js`

- 兜底函数本体：95–98 行（`doFallback`：当前会话 `inject(st, text)` ＋ `flash(st, tr('toast.newSessionManual', …), 'warn')`）。这是票面症状里那两件事的唯一来源。
- 第一处兜底分支：99 行。`sessions` 对象拿不到或没有 `create` 方法，直接 `doFallback()`。
- 取当前目录的三级写法 `ensureCwd`：102–116 行。顺序是同步读 `getCwdSync(st.sessionId)`（103–107）→ 用 `st.cwd`（108）→ 异步问宿主 `host.call('wf.cwd', …)`（109–114）。三级都拿不到返回 `null`（115）。
- 工作区编号只做薄转发：126–129 行。真正查找在 `src/client/kernel/api-workspace.js` 的 `resolveWorkspaceEntry`，这里失败一律回落空、不抛错（注释 117–128 行）。
- 第二处兜底分支：130–131 行。`ensureCwd()` 回来是空，直接 `doFallback()`，连创建都不试。
- 空白复用分支：137–243 行。复用只走“打开旧空白会话＋改名＋挂首条＋`sessions.open`”，不经过任何 `doFallback`。所以“全部入口都兜底”意味着：要么根本没进到复用（快照里没有可复用行），要么创建分支每次都抛错。
- 创建分支（单点工厂出口）：244–308 行。245 行按 `buildCreateOpts` 组装入参；246 行 `__createOnce` 经 `createPTCSession` 或直调 `sessions.create` 创建；248 行经 `createVerifiedPTCSession` 编排（有该函数时）；306–307 行 `sessions.open(sid)` ＋成功提示；308 行是第三处兜底分支：创建链任何一步抛错都进 `.catch`，先看错误里有没有 `preset-blocked` 字样决定是否多闪一条 `toast.newSessionPresetBlocked`，然后一律 `doFallback()`。

### 2. 入参构造与兼容重试：`src/client/kernel/api-naming.js`

- `buildCreateOpts`：89–95 行。有工作区编号只发 `{ workspaceId, agentPreset: 'ptc' }`（93 行），无编号只发 `{ cwd, agentPreset: 'ptc' }`（94 行）。91–92 行注释写明两分支互斥，目的是防 `workspaceId`＋`cwd` 同传被底座判 `bad-request`。
- `createPTCSession`：96–136 行。插件里唯一调用 `sessions.create` 的出口（101 行注释）。104–108 行创建成功即原子化挂首条（`pendingDraft`＋`pendingDraftTargetSid`）。
- 回退 1（工作区编号不认）：109–120 行。只有首发带 `workspaceId` 且错误文本同时命中“工作区”字样与 `bad-request|unknown|invalid|not found` 才回落 `{ cwd, ptc }` 重试（113–119 行）。
- 回退 2（预设键更名）：121–133 行。只有错误文本命中 `agentPreset|preset` 且命中 `bad-request|unknown|invalid` 才依次试 `presetId`、`agentPresetId`（122–133 行）。注意重试仍只认这两个别名，第三种写法不在表里。

### 3. 创建后验编排：`src/client/kernel/api-preset-guard.js`

- `verifyFreshPreset`：18–52 行。只对明确读到 `code`／`broken` 判 `bad`（46–49 行）；一条都读不到判 `unknown`，不阻断（50 行）。读两路：实时对象 `sessions.get`（23–37 行）与列表快照行 `getRowPreset`（38–45 行）。
- `tryQuarantineSession`：53–70 行。确认是 `code` 的新会话绝不打开，尽力按 `close/archive/delete/remove` 顺序关一个（57–67 行）；宿主没有关闭能力时返回 `false`，靠复用闸门永久隔离。
- `createVerifiedPTCSession`：71–83 行。首建验出 `bad` 则隔离并重建一次（74–77 行）；两次都 `bad` 抛 `preset-blocked`（80 行）。调用方在 `api-new-session.js:308` 接住后闪 `toast.newSessionPresetBlocked` 再进 `doFallback`。

### 4. 同步取目录：`src/client/kernel/store-snapshot.js`

- `getCwdSync`：287–313 行。先读 `sessions.list.getSnapshot().byId[sid].cwd`（290–297 行），再读 `sessions.get(sid)` 的 `header/meta` 常见目录字段与 `s.cwd`（298–309 行）。两路都读不到返回空串（312 行）。字段名、快照形状、`getSnapshot` 方法名任一对不上，这一层就静默返回空，把决定权交给 `st.cwd` 与 `wf.cwd` 兜底。

### 5. 工作区查找的兼容垫层：`src/client/kernel/api-workspace.js`

- 路径别名 `workspacePathOf`：10–11 行（认 `path/cwd/workspacePath/dir/directory/root/fullPath/uri/fsPath/location` 与 `handle` 嵌套）。
- 编号别名 `workspaceIdOf`：13–25 行（认 `workspaceId/workspaceID/id/workspace_id/handleId` 与嵌套对象）。
- 快照形状收集 `workspaceCollectFromSnap`：31–53 行（收 `items/数组/byId/workspaces/rows/data/workspacesById/entries`，`byId` 与数组共存时两边都收）。
- 按路径命中带回整项 `workspaceMatchEntry`：56–67 行。命中但无编号不算命中（62–63 行），供复用分支凭名单验归属。
- 创建别名试探 `workspaceTryCreateWid`：70–91 行。按 `{ path } → { cwd } → { workspacePath } → { directory } → { dir }` 逐个试（76 行），只在错误文本像“参数不认”时继续试下一个（81–85 行），全败回落 `null`。
- 总入口 `resolveWorkspaceEntry`：96–156 行。无服务或空目录直接回 `{ wid: null }`（97 行）；同步快照读 `getSnapshot` 或 `getCurrent`（98–106 行）；同步为空再试异步 `list()`／`getAll()`（127–150 行）；找不到则按需创建（118–125 行）；全程失败只回落空（155 行）。关键：**工作区回落空本身不触发兜底**，只会让创建走 `{ cwd, ptc }` 分支。

### 6. 平台契约的版本基线（本次研究的“旧正常”到底是哪一版）

- 插件声明的宿主要求：`package/package.json:9–11`（`"engines": { "dsh": ">=0.1.5-rc.1" }`）。根 `package.json:21–25` 的 `dependencies` 里没有 DSH 内核包（只有 `dsh-log`、`dsh-plugin-update`、`ws`），DSH 由宿主提供，不走 npm 依赖。
- 对外口径：`README.md:24` 写明匹配内核 `0.1.5-rc.1`，桌面应用 2.0.10 自带 `0.1.5-rc.2` 是同一份代码只差版本号（核对见 `research/624-file-channel.md` 第 6.3 节）。
- 变更历史：`CHANGELOG.md:64–65`（v1.7.26 声明宿主要求的由来与下限取值理由）、`:139`（v1.7.20 把内核匹配写进说明）、`:121`（v1.7.22 在 `0.1.5-rc.1` 与 `0.1.5-rc.2` 上复核面板行为）。
- 平台事实（只对 DSH Desktop 2.0.10、内置 `0.1.5-rc.2` 成立，版本一变必须重测）：`research/dsh-platform-facts-2026-09-23.md:3–5`（版本声明）；`:22` 与 `:68–75`（预设默认值是 `standard`，不是 `ptc`——这正是插件每次显式带 `agentPreset: 'ptc'` 的原因）；`:92–103`（会话头记 `agentPreset`、创建时解析预设的调用链）。
- Alpha 管线（0.1.2-alpha.1 时代）：`docs/research/359-dsh-alpha-pipeline.md:92–100`（`SessionCommands.create` 入参 `{ sessionId?, workspaceId?, cwd?, agentPreset? }`，`workspaceId` 与 `cwd` 同传判 `bad-request`）；`:104`（`WorkspaceCommands.create({ path })` 幂等）；`:108–116`（兼容矩阵：`{workspaceId,ptc}` 权威推荐、`{cwd,ptc}` 兼容、`{workspaceId,cwd}` 必错）；`:146`（基线声明）。

## 结论一：哪一项变了（诚实口径＋四类候选）

诚实口径先行：**仓内一手来源能钉死的最新契约是 `0.1.5-rc.1`／`0.1.5-rc.2`（外加 alpha 管线史料），`0.1.7-rc.1` 的改动点不在仓内。** 下面不是“已证实 0.1.7 改了某行”，而是“按现有代码结构，能让‘之前正常、现在全部兜底’成立的只有四类平台侧变化”，按可能性排序。每类都给出到真机上一眼可判的方法（读本机 DSH 安装目录的打包代码，对照 `docs/research/359-dsh-alpha-pipeline.md` 第 19–28 行的方法）：

1. **会话创建不再接受 `{ cwd }`（工作区编号必填化）或改了入参名。** 现有回退 1 只会“编号→路径”单向回落（`api-naming.js:109–120`），没有“路径→编号”回试。若 0.1.7 起 `{ cwd, ptc }` 被拒而 `{ workspaceId, ptc }` 仍可用，则工作区未登记的会话必挂；若连参数名都改了（如 `path`／`directory` 之外的第六种写法），则 `workspaceTryCreateWid`（`api-workspace.js:70–91`）的五个别名全败。判别：看创建失败的错误文本里是 `cwd` 被指名，还是 `workspaceId` 被要求。
2. **同步取目录的两路同时失效（快照字段改名或列表接口改形）。** `getCwdSync`（`store-snapshot.js:287–313`）依赖快照行 `cwd` 字段与 `getSnapshot` 方法名；`st.cwd` 依赖宿主装快照时写入；`wf.cwd` 依赖宿主电话还在。若三路同空，`api-new-session.js:131` 直接兜底，一次创建都不发起。判别：看日志里创建电话有没有发出去——没发即本类，发了被拒即第 1 或第 3 类。
3. **预设键第三次更名或 `ptc` 值不再合法。** 现有回退 2 只认 `presetId`、`agentPresetId`（`api-naming.js:121–133`）。若 0.1.7 用了第三种键，或预设名册删改导致显式 `ptc` 被判未知（`UnknownPresetError`，见 `docs/research/359-dsh-alpha-pipeline.md:78`），则两退全败。判别：错误文本是否点名 `agentPreset|preset`（走回退 2 仍败），或是否出现 `toast.newSessionPresetBlocked`（后验双 `bad`，`api-preset-guard.js:71–83`＋`api-new-session.js:308`）。
4. **`sessions` 对象本身改形（`create` 改名／移位置）。** 命中则 `api-new-session.js:99` 直接兜底。可能性排最后：若此成立，面板其他会话能力也会大面积异常，不会只有“开新会话”一个症状。判别：看同一面板内改名、打开旧会话等是否同样全败。

## 结论二：必然走到哪条兜底分支

`doFallback` 本体只有一处（`api-new-session.js:95–98`），但调用点有三处。按“之前正常、现在全部入口兜底”反推：

- **复用分支（137–243 行）不可能直接产生票面症状。** 它成功则打开旧会话，失败则落到创建分支，没有调 `doFallback` 的语句。
- **若真机上一次创建电话都没发出去，必走 131 行**（`ensureCwd` 取空）。这是唯一“不试创建就兜底”的分支，对应上面的候选第 2 类。
- **若创建电话发出但每次都被拒，必走 308 行 `.catch`**。这是唯一“试过创建仍兜底”的分支，对应候选第 1 类（`{cwd}` 被拒／编号必填化）或第 3 类（预设键／值被拒），以及后验双 `bad` 的 `preset-blocked` 子路。区分第 1 与第 3 类只看 308 行收到的错误文本与是否伴随 `toast.newSessionPresetBlocked`。
- **99 行（`sessions.create` 不存在）只有当面板其他会话操作同样全败时才考虑**，否则不把它当主因。

一句话：先查“创建电话发没发”，没发查 131 行的上游三级目录来源，发了被拒查 308 行收到的错误文本归属（工作区／预设／其他）。

## 结论三：修复侧只需改的一处或几处（只指定位置，不给补丁全文）

按“单点出口”原则，修一处、由门禁守住，不在每个调用入口各打一块补丁：

1. **若判别落到目录（131 行分支）：只改同步取目录一处。** 位置是 `src/client/kernel/store-snapshot.js:287–313`（给 `getCwdSync` 补 0.1.7 的新字段／新形状别名），连带确认 `src/client/kernel/api-new-session.js:102–116` 的 `wf.cwd` 兜底电话名未变。守卫：现有 `verify-730-cwd-consistent`（见 `CHANGELOG.md` v1.7.30 第 13 行提及）。
2. **若判别落到创建被拒且错误点名工作区（308 行分支之工作区子路）：只改工作区一处。** 位置是 `src/client/kernel/api-workspace.js:70–91`（给 `workspaceTryCreateWid` 加 0.1.7 的新创建参数别名）与 `:31–53`／`:13–25`（若快照形状或编号字段也变了，同步加别名）。注意 `resolveWorkspaceEntry` 回落空（`:155`）之后仍走 `{ cwd, ptc }`，若 0.1.7 已是编号必填，还需在 `api-naming.js:109–120` 的反方向（路径→编号）补一次回试——这是现有矩阵里唯一缺的一条边（`docs/research/359-dsh-alpha-pipeline.md:108–116` 矩阵作证：当年只写了编号→路径）。
3. **若判别落到创建被拒且错误点名预设（308 行分支之预设子路）：只改工厂一处。** 位置是 `src/client/kernel/api-naming.js:89–95`（`buildCreateOpts` 的键名）与 `:121–133`（回退 2 的别名表，加 0.1.7 的新键）。若是 `ptc` 值本身不合法，则还要看 `src/client/kernel/api-preset-guard.js:18–52` 的 `verifyFreshPreset` 读数路是否要跟新值（只加读数，不改“明确 `code/broken` 才判 `bad`、未知不阻断”的判定语义）。守卫：现有 `tests/verify-newsession-preset-guard.js` 与 `tests/verify-newsession-workspace-fallback.js`（两文件的验收标准分别见各自文件头 1–14 行注释）。
4. **最多三处，不必多改。** 上述 1、2、3 互斥：判别落到哪一类就改那一类的一处；`doFallback` 本体（95–98 行）与复用闸门语义（`api-naming.js:56–88`，未知即不可复用）不在本次改动之列。

## 到真机重测的最小步骤（给 #736 地图，不在本票执行）

1. 到本机 DSH 0.1.7-rc.1 安装目录，对 `dsh-api-session-controller` 的 `create` 入参校验与 `dsh-api-workspace-controller` 的 `create` 入参做 359 式直读（方法见 `docs/research/359-dsh-alpha-pipeline.md:19–28`），确认四类候选中了哪一类。
2. 在面板侧复现一次开新会话，按结论二的“发没发创建电话”二分到 131 行还是 308 行，再按错误文本归属到工作区还是预设。
3. 按结论三改且只改那一处，加别名并跑通对应的现有门禁（`verify-730-cwd-consistent`、`verify-newsession-workspace-fallback`、`verify-newsession-preset-guard`、`verify-workspace-id-tolerant`），不要动任何票的正文与状态。

## 本次研究未动事项

- 未改任何源文件与测试文件；未改任何 issue 正文与状态；未提交。
- 本次只读，未跑需终端的命令（故无 `pwsh` 跑什么／为什么需要说明的事项）。
- 日志字段：本文件只引用仓库内文件路径与行号，未记录令牌、登录态、用户工作区路径原文、仓库地址原文，符合 `research/489-appendix.md` 1.2 节白名单口径。
