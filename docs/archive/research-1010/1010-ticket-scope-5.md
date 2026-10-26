# 票面核实（第五组）：907、857、783、996、1001、578、1012（2026-10-12）

判定基准是本次 deck 重构的写范围：`src/deck/**`、`src/tracker/contract/**`、`src/tracker/registry/**`、`src/tracker/rooms/{github,markdown}/**`、`src/tracker/detection/**`，以及 `src/host/refresh/**` 里被 deck 调到的行。不在内：`src/client/**`、提示词文案本身、`scripts/**`、GitLab 房、四个计算库、配置存储核。

每张票四选一：**吞掉**（重构内解决）／**部分**（写明哪半归谁）／**不归我们**（写明归哪块）／**已可关**（给证据）。判定都开着源码或票内原文核过，没核到的写「未核实」。

---

## #907 「当前会话处理记录」列表的标题位显示成票号，出现「#901 #901」这样的重复编号

**判定：不归我们。**

依据（源码落点，全部亲手搜过）：

- 修复引入的瘦身行 `thinTickets` 只落在四处宿主文件与一处客户端文件：`src/host/tracker/snapshot.js`（86、104、119、137 行）、`src/host/sessionRefresh.js`（180、199、228、307 行）、`src/host/sessionSnapshot.js`（212、229、258、335 行）、`src/host/snapshotEnvelope.js`（23 行）、`src/client/views/shared/sessionChainView.js`（48、181 行）。这五处都不在本次写范围内：`src/host/tracker/snapshot.js` 不在 `contract/`、`registry/`、`rooms/` 三个子目录下；其余在 `src/host/` 顶层与客户端。
- 票内自述的改动面同样指向客户端与快照组装：`src/client/statusbar/SessionChainCapsule.js`、`src/client/views/shared/sessionChainView.js`、词条、`tests/verify-907-chain-titles.js`。
- 与本重构的关系只有一处间接：它读的快照里含 deck 计数与首屏票行，而我们搬家不会改这些数据的形状（契约里的 `Issue` 与 `COUNT` 口径不变）。重构不需要为它做任何事。

另注：票内「实施完成（77a54ba）」一节写明「未做真机确认，票保持打开等验收」，所以它没有「已可关」的证据，判定停在「不归我们」。

---

## #857 详情页提交评论总提示发送失败，但 GitHub 上实际已经成功

**判定：不归我们（已修，等验收）。但转写 GitHub 房评论写路径时要保住这条已修行为。**

依据：

- 修复落点在宿主传输适配层，不在房间：门禁 `tests/verify-857-comment-false-failure.js` 头几行读的是 `src/host/repoKeys.js`，并逐处核对三处转交层 `src/host/commentThreads.js`（comment-write）与 `src/host/snapshotBuild.js`（viewer-lookup、snapshot-select）。这三个文件都在本次写范围外（`src/host/repoKeys.js` 是起进程那一层，另两个在 `src/host/` 顶层）。
- 票内诊断的根因是「通用进程执行成功时没带整数退出码，转交层原样转发不存在的退出码，命令执行器按拿不到整数退出码即失败处理」，属传输层形状问题；房间侧的 `comment` 操作只关心 `OpResult`，不受影响。
- 与我们的关系：GitHub 房的评论写路径（`src/host/tracker/backends/github/comments.js`）在我们全量转写范围内，转写时不许把这层已修的成功判定改回去。这条写进转写验收项即可，不需要为它单独立活。

---

## #783 让链接上「AI 直接改票文件」这条来源，并把工作单元并进票身份

**判定：部分。** 票身份里的「工作单元」这一维归我们契约；链的落盘与判定归刷新那一摊。

依据：

- 归我们的那半：契约 `src/tracker/contract/ports.ts` 已经把工作单元写进身份——第 197 行列出核心字段 `key、effortId、…`，第 205 行注释写明「全局身份是 (仓库引用, effortId, key) 三元组」，第 212 行 `effortId: string`，第 268 行另有一处可选 `effortId?: string`。这正是本票要的「同号两张票不再当成一张」的身份基础，且是我们已在契约里落地的形状。转写房间与工具时，`RepositoryRef.effortId` 与各操作入参里的工作单元必须原样保留。
- 不归我们的那半：票内实施改动在 `src/host/refresh/writeEvents.js`（链的唯一喂点，只给 `tool-args` 与 `cli` 两种来源、不传 `path`）与 `src/shared/refresh/write-detect.js`（本地只读工具名单里没有 `write`/`edit`），以及链的落盘版本兼容与键结构。`src/shared/refresh/**` 不在本次写范围；`writeEvents.js` 属「链」那一摊，虽然 deck 工具的写会喂它，但它的主人是刷新机制。
- 票内自述「2026-09-30 已实施并推送（d3c4c26），待人验收后关闭」，所以它已修未验收，不是我们的活。

---

## #996 map 完成确认提示词首行的 /wayfinder 后面没有链接

**判定：部分。** 房间侧的「链接模板」这一条线索归我们；客户端拼装与取数不归我们。

依据：

- 归我们的那半：票内四条候选路径里的第 2 条指出，链接的模板渲染要求该后端声明 `links.issueUrlTemplate`。亲手核过：GitHub 房声明了（`src/host/tracker/backends/github/repo.js:60`，值是 `https://github.com/{refId}/issues/{key}`），本地 Markdown 房**没声明**——它只有 `links: { linkPatternSource: "#(\\d+)" }`（`src/host/tracker/backends/markdown/index.js:248`，第 247 行注释写明「本地 Markdown 无远程链接 —— issueUrl 由后端现算为裸盘符路径，links 仅留提及识别正则」）。这两个文件都在我们全量转写的房间范围内，所以「Markdown 房要不要补链接模板」这个决定落在我们这趟里，不能装作没看见。
- 不归我们的那半：票内其余候选路径与全部拼装点都在客户端——`src/client/kernel/link.js`（`issueUrlFor`、`__metaLinks`）、`src/client/kernel/prompts.js`（`completePrompt`、`inspectPrompt`）、`src/client/kernel/router.js`、`src/client/kernel/store-derived.js`、`src/client/kernel/api-io.js`、`src/client/views/ListTabRow.js`。这些都超出本次写范围。
- 票内状态是「待复现」（重启后链接恢复，无当日日志可查），所以它既不是我们能吞的活，也不该按必现缺陷排期。

---

## #1001 清理 `gh:labels` 死项

**判定：不归我们。** 且与本重构无文件重叠（只有一处「被提到但不需要改」）。

依据：

- 改动清单五条全在本次写范围外：真源 `src/shared/tracker/check-catalog-dirs.js`（第 134 行 `id: 'gh:labels'`、第 237 行 `'gh:labels': 'GITHUB_CATALOG[3]'`、第 96 行自注保留原因）、`MIGRATION_MAP` 注释级修正、`src/client/kernel/locale-word.js` 第 111 与 256 行两个词条、`src/host/detectChain.js:219` 的过滤、`tests/verify-668-guide-steps-single-source.js` 与 `tests/verify-issue529-checks-i18n.js`。
- 唯一挨着我们的是 GitHub 房的检查目录。亲手数过 `src/host/tracker/backends/github/checks.js`：只有四项（`gh:remote` 第 17 行、`gh:installed` 第 25 行、`gh:authed` 第 33 行、`gh:repoAccess` 第 41 行），本来就没有 `gh:labels`，票内也不要求改这个文件。我们转写它时原样保留四项即可。
- 结论：清理动作归环境检查链与客户端词条那一摊，我们不做，也不受影响。

---

## #578 加固：子议题关联脚本与提示词门禁的残余边界

**判定：不归我们。**

依据：

- 涉及的对象是脚本与门禁：脚本文件确实存在（`scripts/wire-subissues.mjs`，本次亲手列出）；票内点名的门禁是 `tests/verify-wire-subissues-script.js` 与 `tests/verify-prompts.js`。`scripts/**` 明确在本次写范围外。
- 票内待办的七条（A1 误写守护认不出是哪张地图、A2 失败评论落盘抛未捕获异常、A3 自阻塞与地图做阻塞者无校验、A4 票不存在判据过宽、A5 超长票号无上限、A8 `--children` 不校验归属、A6 子目录里跑认不出后端）全部是那条脚本的输入校验与失败语义，与 deck 工具链路的代码不重叠。
- 票面状态是 `ready-for-human`，正文「待维护者拍板（三处）」列了 Q1 身份核对、Q2 子票授权口径、Q3 `Blocked by` 指向自己或地图三条要维护者裁定的问题。裁定未下之前不实施——这也不是重构能替它决定的。
- 与本重构的唯一交集是提醒：它要求「不改变 #576 定版契约里已写死的参数集与回包六字段」，而我们已经把契约写成了 TypeScript（19 个操作加升进来的权限口）。那条脚本的回包六字段不在契约接口里，两者不冲突；若以后有人想把脚本收进契约，要先过 Q1 到 Q3 三道裁定。

---

## #1012 配置存储统一改造：三个文件全改 YAML + 抽出一个共用的 TS 读写核

**判定：部分，并且存在文件级冲突，必须排先后。**

依据（这是本组最要紧的一条）：

- 它是**另一件并行的 TypeScript 改造**（新建 `config-store-core/`，产物 `src/shared/config-store/`，形态照既有三个核），不归我们，但两边**抢同一批文件**。把它的写范围与我们的迁移映射表逐条对过，重叠 7 个文件：
  - `src/shared/deck-tools/workspace-file.js`：它要「内部换成调核」，我们要搬成 `src/deck/shell/workspace-anchor.ts`（映射表里逐字可见）。
  - `src/host/tracker/backends/markdown/label-colors.js`、`label-colors-ops.js`、`label-colors-codec.js`、`label-colors-errors.js`、`label-colors-paint.js`、`label-colors-palette.js`：它已把前两个切到 YAML，我们要整房转成 `.ts`（`src/tracker/rooms/markdown/label-colors*.ts`）。
  - 另有一处同域但不同文件：`src/host/tracker/contract-label-colors.js` 属我们契约范围（映射到 `src/tracker/contract/contract-label-colors.ts`），它没点名要改，但契约形状由我们定。
- 地图硬规则是「同一条边界，同一时间只允许一个写者」。这 7 个文件就是同一条边界，两边同时动手会互相覆盖，必须排先后：要么它先把这 7 个文件改完（含 YAML 迁移与门禁），我们再按它改后的形状转 `.ts`；要么我们先转 `.ts`（含把它的 YAML 内核调用接上），它停止改这些文件。**这个选择要维护者拍板，不归我这一层定。**
- 票内自述的进度对它自己的判断也重要：第三轮已把 `workspace-file.js` 垫片化、读写实现搬进核；当前树 14 条 verify 红全是别的票（deck 工具簇九扇等 `#1003` 单出口接线在办）；它自己还剩客户端偏好搬迁等活。也就是说它**正在动**这批文件，冲突是当下的，不是理论上的。
- 与 `#1003` 的关系它也写明了：两票无硬依赖，共享同一个配置读写接口，`store-prefs.js` 由 `#1003` 先删选择那一族、它随后动。`#1003` 也在我们的相邻范围里（`src/host/tracker/detection/**` 归我们转写），所以同一批「配置与判定」文件上有三方（我们、#1012、#1003）可能同时落笔，这一点必须在排期时说清。

---

## 一句话汇总

- 吞掉：无。
- 部分：#783（身份字段归我们、链归刷新）、#996（Markdown 房链接模板归我们、客户端不归）、#1012（另一件并行改造，7 个文件与我们冲突，要排先后）。
- 不归我们：#907（客户端与宿主快照）、#857（宿主传输层，已修等验收）、#1001（共享目录与客户端词条）、#578（脚本与门禁，且等人拍板）。
- 已可关：无（四张已实施的票都还等真机或维护者验收，没有一张有「可以关」的证据）。
