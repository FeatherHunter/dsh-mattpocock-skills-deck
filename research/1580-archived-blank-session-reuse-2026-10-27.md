# #1580 诊断：新会话打开后停在「选择工作区」，是因为插件复用了已归档的空白会话

- 票号：#1580（回归 #639，旧单保持关闭）
- 调查日期：2026-10-27
- 调查方式：第一现场日志与数据（本机复现 20:38–20:51）、插件源码、DSH 打包件（`D:\DeepseekHarness\resources\app.asar`）里的客户端与 Host 代码

## 调查范围

- 票 #1580 的正文、唯一评论与进度（评论记录了 2026-10-27 新增常驻事件 `newsession.decide`，提交 `a65498e8`；进度 35%）。
- 本机 2026-10-27 的插件日志 `%USERPROFILE%\.dsh\profiles\desktop\.dsh-mattskillsdeck-cache\logs\2026-10-27.log`，其中 7 条 `newsession.decide`、以及同一时段的 `ui.action` 点击记录。
- DSH 本机数据：`%USERPROFILE%\.dsh\storages\workspace.json`（工作区注册表）与 `%USERPROFILE%\.dsh\sessions\<工作区>\session-<编号>\session.v4.jsonl.zstd`（会话文件）。
- 插件源码：`src/client/kernel/api-new-session.ts`、`src/client/kernel/api-naming.ts`、`src/client/kernel/api-workspace.ts`。
- DSH 打包件里的相关实现：客户端 `ui-workspace`、Workspace 模型、`ConversationContent` 顶栏与草稿逻辑；Host 的 `SessionCommandController.create`、`WorkspaceEntity`、归档集合。
- 既有笔记：`research/737-dsh-0-1-7-new-session-api.md`（新会话 API 与复用/创建分支）、`research/746-rename-capabilities-017.md`（会话行读取）、`research/489-appendix.md`（日志事件表）。三篇都不涉及“已归档会话”。

## 一句话结论

插件在复用空白会话前只检查了“这个会话是不是当前工作区的成员”（`allowReuse` 读工作区登记项的 `sessionIds`），没有检查“这个会话是否已被归档”；当它挑中一个已归档的空白会话去打开时，DSH 客户端不允许已归档会话作为主会话显示，于是顶栏退回「选择工作区」、输入框不可用，草稿虽已写进那个归档会话，界面上没有任何会话可以承载它——这就是用户看到的现象。

## 现场证据

### 日志：7 条 `newsession.decide` 的对照

同一天 20:38–20:51，插件日志里有 7 条 `newsession.decide`。它们全部显示 `wsResolved=yes`、`wsSource=snapshot`、`wsItems=17`、`branch=reuse`、`allowReuse=pass`、`outcome=reuse-draft`——按插件自己的判断是“复用成功”，但界面上三次失败、两次成功。

| 本地时间 | 入口 | 长度 | 复用来源 | 被复用的会话 | 未归档? | 结果 |
| --- | --- | --- | --- | --- | --- | --- |
| 20:38:03 | text（新增 BUG 按钮） | 1739 | blank | `bdfc515a`（plugin-manage 工作区） | 是 | 成功 |
| 20:38:14 | text（条目卡） | 660 | current | `bdfc515a` | 是 | 成功 |
| 20:50:04 | diagnose（#1567） | 816 | blank | `a35d7196`（deck 工作区） | **否（已归档）** | 失败 |
| 20:50:21 | diagnose（#1580） | 816 | blank | `a35d7196` | **否（已归档）** | 失败 |
| 20:50:28 | diagnose（#1580） | 816 | current | `22a00b85` | 是 | 成功 |
| 20:51:29 | execute（#1001） | 538 | blank | `a35d7196` | **否（已归档）** | 失败 |
| 20:51:37 | execute（#1001） | 538 | current | `8b926bbc` | 是 | 成功 |

失败的三次全部指向同一个会话 `a35d7196`；成功的三次复用的都不是它。用户的原话是“第一次打开的新会话没有选择工作区，手动选了工作区、再点新会话之后 prompt 才注入”，与这张表的时间顺序一致：点击 → 打开归档会话失败 → 手动选工作区并新建会话 → 再点一次，这次复用当前会话成功。

### 会话与工作区数据

- 被复用的会话 `session-a35d7196-e57f-4c75-a5df-577ebcd21a81`：会话文件只有 1 行头记录，没有任何对话消息（`agentPreset:"ptc"`，创建于 12:16:56，在会话列表里是空白会话），目录修改时间停在 12:17，说明草稿写入没有变成这个会话里可显示的内容。
- `workspace.json`：`global.archivedSessionIds` 共 588 条，`session-a35d7196...` 在名单里；`session-bdfc515a...`、`session-22a00b85...`、`session-8b926bbc...` 都不在名单里（未归档）。`global.pinnedSessionIds` 共 4 条。
- deck 工作区（`2a4a5559-1b23-4043-98e9-a09a2c92c2ce`，`D:\dsh-plugin\dsh-mattpocock-skills-deck`）的 `sessionIds` 共 384 条，`a35d7196` 也在其中——这就是 `allowReuse=pass` 的来源：它只看这份名单，而归档不会把会话从名单里删掉。

### 为什么这个会话会被挑中

插件的空白会话扫描（`src/client/kernel/api-new-session.ts:153-172`）会在快照里找“空白、预设健康、同目录”的会话，取 `updatedAt` 最新那个；`a35d7196` 在扫描当时是 deck 工作区里符合条件的空白会话中 `updatedAt` 最大的一个，所以连续三次都被它选中。复用的是“当前会话”的两次（20:50:28、20:51:37）之所以成功，是因为用户手动新建的空白会话就在当前，且未归档。

## 代码证据

### 1. 插件的复用判据缺“未归档”这一条

`src/client/kernel/api-new-session.ts:134`：

```ts
const allowReuse = function (sid) {
  try {
    if (!workspaceId || !wsEntry || !Array.isArray(wsEntry.sessionIds)) return true
    return wsEntry.sessionIds.indexOf(sid) >= 0
  } catch (e) { return true }
}
```

`workspaceId`、`wsEntry` 来自 `api-workspace.ts` 的 `resolveWorkspaceEntry`，它返回的是工作区登记项，`sessionIds` 里包含已归档的会话（DSH 的规则是“归档保留其在工作区名单里的位置，取消归档要能回到原位”，见下）。`isReusableBlank`（`src/client/kernel/api-naming.ts:106-129`）也只验空白、预设健康、同目录，同样不看归档。

全仓手写代码里没有 `archived` / `archivedSessionIds` 字样（grep 只命中 `docs/README.en.md`、`src/tracker/rooms/gitlab/labels-ops.ts` 里 GitLab 标签字段、`research/1063-adversarial-review.md` 的 GitLab 说明），说明归档这件事在插件里从未被考虑过。

### 2. DSH 自己的复用判据明确排除已归档会话

DSH 打包件里 Host 的 `SessionCommandController.create`（`app.asar` 偏移≈20003000、≈20877000 两处同码）：

```ts
created = await this.agents.createSession({
  ...,
  reusable: (sessionId) =>
    !this.ctx.workspaceRegistry.archivedSessionIds.includes(sessionId) &&
    (workspace === undefined || workspace.sessionIds.includes(sessionId)),
})
```

同一个 asar 里 `@deepseek-ai/dsh-workspace` 的注释写着：归档会话保留其 `sessionIds` 槽位（`"an archived session keeps its sessionIds slot (unarchiving must restore the position), so the set never participates in the one-owner accounting invariant"`）。即：**名单成员 ≠ 可复用**，DSH 自己用两个条件，插件只用了后一个。

### 3. 已归档会话被打开后，客户端会把它从主区清掉

- 插件调用的 `uiWorkspace.openSession(target)`（`app.asar` 偏移≈49145052）只做 `replaceMain(target, lifetime.signal, "reveal")`，本身没有归档检查。
- 客户端在 `reconcile()` 里走 `clearArchivedCurrent()`：只要主会话在 `archivedSessionIds` 里，就 `clearMain()`，主区回到没有主会话的空草稿页（同码在偏移≈49152307、≈49149586）。
- 空草稿页的会话视图里，`sessionWorkspace` 从 `workspaces.items` 找不到主会话，`chipTitle` 为空，顶栏渲染 `t("hero.chooseWorkspace")`=「选择工作区」，输入框 `inert`（`app.asar` 偏移≈25148386 附近）。文案层也有 `"toast.archivedNotOpenable": "已归档对话暂时无法查看，请取消归档后查看"`（偏移≈49300413），说明“归档后不可查看”是宿主既有的产品决定。
- 副作用：草稿已经写进归档会话的 store（`api-new-session.ts:243` 的 `incomingDraft`），但界面上没有会话承载它，用户看到的是“打开的新会话没选工作区、prompt 没注入”。

### 4. 日志为什么“全绿”却没成功

`api-new-session.ts:248` 在调用 `openSession` **之前**就记 `outcome:'reuse-draft'`；`open-failed` 只在打开的 Promise 拒绝时记（`:250`），而 `openSession` 是同步替换主视图、不返回 Promise。所以“草稿已写、open 已发起”都会被记成成功，UI 是否真的把会话显示出来、是否被归档清理，日志里没有对应字段。这解释了为什么票面 16:56 加的日志在本轮复现里全部是 `reuse-draft`，而现象仍然发生。

## 与 #639 的关系：两道不同的闸，缺的是第二道

#639 修的是“会话没有归属工作区”：按路径找到登记项时把整项带回，复用空白会话前必须凭登记项名单验明归属。本次复发的会话 `a35d7196` **本来就有归属**（在 deck 工作区的 `sessionIds` 里），所以 #639 的归属闸放行了；它缺的是“未归档”这道新闸。DSH 早在 Host 侧把两道闸写在一起，插件只补了第一道。这也是为什么 #639 的修复没有失效，只是判据不够。

## 修复方向（建议，不在本票实施）

1. 在选空白会话复用之前，排除 `archivedSessionIds` 里的会话：从 `workspaces.list.getSnapshot()` 取（插件读取工作区的同一处入口，见 `src/client/kernel/api-workspace.ts:105-113`；客户端 Workspace 快照 `buildSnapshot()` 返回 `items`、`archivedSessionIds`、`pinnedSessionIds`）。当前会话的复用也要过同一道判定。
2. 读不到归档集合时怎么办，需要拍板（见下面 Q1）。
3. 补门禁：在 `tests/verify-newsession-preset-guard.ts` 的 `g)` 集成腿里加“归档空白会话不可复用”；并在 `tests/verify-newsession-workspace-fallback.ts` 的 g) 集成腿里补“归档集合缺失时按所定策略处理”。（票面“做完”清单里写的 `tests/verify-workspace-id-tolerant.ts` 在仓里不存在，实际相关文件是上面两扇加 `tests/verify-issue60-cwd.ts`，收口时已在票面更正。）
4. 让日志能对上打开结果：把 `outcome='reuse-draft'` 挪到确认主会话已选中之后再记，或另记一条“打开结果”事件。这属于日志改善，可以和修复同一票做，也可以单独开票。
5. `uiWorkspace.openSession` 本身要不要拒绝归档会话，属于宿主行为，不在本仓范围；如果 DSH 那边愿意加，插件这侧仍应保留自己的闸（插件不知道自己面对的是哪个版本的宿主）。

## 复用的既有笔记

- `research/737-dsh-0-1-7-new-session-api.md`：讲 0.1.7 新会话 API 的复用分支与创建分支，可用于理解插件当前的调用形状；不涉及归档，答不了本次问题。
- `research/746-rename-capabilities-017.md`：讲会话列表行读取；与归档无关。
- `research/489-appendix.md`：日志事件对照表，`newsession.decide` 的 16 个字段记在这里；不含归档判据。

## 出处

- 票 #1580：https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1580
- 旧票 #639：https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/639
- 日志：`%USERPROFILE%\.dsh\profiles\desktop\.dsh-mattskillsdeck-cache\logs\2026-10-27.log`（7 条 `newsession.decide`，20:38:03–20:51:37）
- 工作区与归档集合：`%USERPROFILE%\.dsh\storages\workspace.json`（`global.archivedSessionIds` 588 条、`global.pinnedSessionIds` 4 条、deck 工作区 `sessionIds` 384 条）
- 插件源码：`src/client/kernel/api-new-session.ts:134`、`:153-172`、`:244`、`:248-258`；`src/client/kernel/api-naming.ts:106-129`；`src/client/kernel/api-workspace.ts:101-118`
- DSH 打包件：`D:\DeepseekHarness\resources\app.asar`，客户端 `ConversationContent` 顶栏（偏移≈25148386）、`ui-workspace.openSession`（≈49145052）、`clearArchivedCurrent`（≈49152307 / ≈49149586）、归档文案（≈49300413）、Workspace 模型 `buildSnapshot`（≈21500346）、Host `SessionCommandController.create`（≈20003000 / ≈20876813）、`WorkspaceEntity` 归档注释（≈115643004 / ≈115670000）
- 新增日志的提交：`a65498e8`（常驻事件 #134 `newsession.decide`）

## 实施（2026-10-27 晚，等发版后由维护者验证关闭）

维护者拍板：Q1 读不到归档名单时 fail-closed（不复用、走新建）；Q2 日志改到打开之后并在同一票里做；Q3 宿主侧 `openSession` 不额外改（不在本仓范围）。按这三条落地，实现提交 `de1bd4ba`。

- `src/client/kernel/api-workspace.ts`：新增 `archivedSessionIdsOf(workspaces)`，返回 `{ known, ids, legacy }`。`workspaces` 为空（老宿主没有工作区/归档概念）→ `known=true, legacy=true`，行为不变；有新快照形状（带 `pinnedSessionIds` / `state` / `phase`）却缺归档名单、字段不是数组、读快照抛错、拿到异步结果 → `known=false, legacy=false`，调用方按 fail-closed 处理。
- `src/client/kernel/api-new-session.ts`：`allowReuse` 升级为 `canReuse`——先验工作区名单，再跳过归档名单命中的候选；归档名单读不到（`known=false` 且非老版）也跳过。另加失败草稿台账：`__ok742a` 给被复用的非当前会话打 `reuseDraftPending`，下次挑候选时发现它仍挂着草稿就清掉残留、改走新建（防宿主静默清主区后一直踩同一个坑）。复用分支日志从打开前移到打开后：成功 `reuse-opened`、失败 `open-failed`，字段新增 `reuseSkip`（`archived` / `archive-unknown` / `stale-draft` / `gate` / 空串）。
- 日志契约：`src/shared/log-event-list.ts`、`tests/verify-log-fields.ts`、`research/489-appendix.md` #134 段与 `scripts/generated/logKernel.derived.js` 同步为 17 个字段，`outcome` 枚举里 `reuse-draft` 换成 `reuse-opened`。
- 门禁：`tests/verify-newsession-workspace-fallback.ts` 新增 7 条归档闸门单测 + 6 个集成场景（唯一候选已归档、最新候选已归档但较旧干净、新版快照缺名单、老版快照行为不变、当前会话已归档、失败草稿台账），104 项全过；`verify-newsession-preset-guard` 86 项、`verify-log-fields` 266 项、`verify-log-count` 209 项、`verify-kernel` 全过。`npm run verify:parallel` 410/410 步，真红 1 步 `verify-detail-levels`（快照 maps 无子票，与另一路会话未提交的检测层改动有关，本改动未触碰该链路）。
- 限制（写清楚，免得误判）：`reuseDraftPending` 是进程内存标记，插件重载后丢失；归档名单读取按每次点击读快照，代价很小但不缓存。

### 落库信息

- 票面：诊断结论、修复方向、Q1–Q3 已写进正文；实施完成后评论区补一条“已按 Q1/Q2 实施、Q3 不动”的说明，进度更新到 90%。
- 标签：保持 `bug` 与 `ready-for-human`（修复已提交，等发版后由维护者验证再关闭）。
- 实现提交：`de1bd4ba`（9 个文件，242 插入 / 29 删除，已推 main）。
- 本笔记：`research/1580-archived-blank-session-reuse-2026-10-27.md`（早期诊断提交 `6b1f4d64`，本段更新提交见本次推送）。
- 未改业务代码，未提交源码改动；本笔记自身的提交为 `6b1f4d64`（已推 main）。
