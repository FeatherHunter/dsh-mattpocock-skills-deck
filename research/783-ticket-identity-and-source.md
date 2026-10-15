# 票 #783 的缺口在今天的代码树里还找不找得到

> 落盘日期 2026-10-15 · 只做调查，未改任何源码、测试与配置 · 基线 `f3da13da`（地图09收尾：日志出口的同形复制收进内核一份，本房识别路径的失败不再被吞掉，#1182）
> 工作树现场：`src/tracker/contract/backend-module.ts`、`src/tracker/rooms/github/checks.ts`、`src/tracker/rooms/github/index.ts`、`src/tracker/rooms/gitlab/index.ts`、`src/tracker/rooms/markdown/index.ts` 五个文件有未提交改动，是别的会话留下的，本次调查没有动它们。
> 票面写的路径（`src/host/refresh/writeEvents.js` 之类）大多还在，但票上文提到的那批老路径（`refresh-core/src/write-detect.ts` 之外）已经搬过家；本文一律给今天树里的落点。

## 一、票面说的是什么

原话摘要（票 #783，2026-09-29 定稿，同日提交 `d3c4c26f` 实施）：

- 「**AI 直接改票文件这条路，一条都进不了链。** 链的判据里有一条专门为它写的分支（来源 `markdown-file`，票号从票文件路径里取），但生产代码没有一处喂它。」
- 「**一个仓库有多个工作单元时，两张同号的票会被当成同一张。** 每份工作单元的票号各自从头排，而链上那条记录只带票号、不带工作单元，链的键（工作区根、后端、票号、会话）里也没有工作单元 —— 于是 A 工作单元的 01 与 B 工作单元的 01 合并成一条记录。」
- 期望：工作单元与票号同源（都从同一条票文件路径里取）；工作单元进链的键，也进落盘那条记录；老落盘记录兼容读回；跳转按链记下的工作单元走；界面上仍只显示编号。

## 二、今天的代码对应物（逐段给位置）

### 2.1 票身份：今天由 (工作单元, 编号) 这一对算出来

- 身份算法：`src/tracker/kernel/identity-keys.ts:60-66` 的 `idOfParts(effortId, key)` —— 工作单元为空串时退化成编号本身，否则是 `工作单元 + '\u0000' + 编号`；`src/tracker/kernel/identity-keys.ts:71-78` 的 `idOf` 从票对象取这一对。文件头写明语义：本地 Markdown 一个仓库可以有多个工作单元（`.scratch/<工作单元>/`），每份各自从 01 编号，「唯一的是 **(effortId, key)** 这一对」（`src/tracker/kernel/identity-keys.ts:10-15`）。
- 同一句话在契约里也写着：`src/tracker/contract/entities.ts:113` 「规范 id，**在本工作单元内**唯一；全局身份是 (仓库引用, effortId, key) 三元组」，`src/tracker/contract/entities.ts:120` 的 `effortId: string` 是核心字段。
- 工作单元在本地 Markdown 里怎么算出来：目录名。`src/tracker/rooms/markdown/issues-locate.ts:50-66` 的 `listEfforts` 把 `<仓库根>/map.md` 记成空串（根级扁平布局），把 `.scratch/<目录名>/` 下带 `map.md` 的目录记成 `effortId = 目录名`；`src/tracker/rooms/markdown/path.ts:69-75` 按 `effortId` 拼路径，空串就是根级扁平布局。
- 寻址：`src/tracker/rooms/markdown/issues-locate.ts:88-131` 的 `resolveIssueFile` 按 (工作单元范围, 编号) 找票文件，**多命中且没指定工作单元时直接报冲突**，错误原话是「issue NN 在 N 个 effort 里都存在，但没指定 effortId（拒绝猜目标文件）」（`src/tracker/rooms/markdown/issues-locate.ts:86`）；`src/tracker/rooms/markdown/issues-create.ts:71` 新建票时多工作单元不给 `effortId` 也直接拒绝。
- 同号票在今天的各个键上怎么分开：
  - 链的键：`src/shared/refresh/src/chain.ts:203-218` 的 `chainEntryKey` 返回 `r:根散列|b:后端|e:工作单元|t:票键|s:会话分格`，注释写明「#783 加上工作单元这一段：键正是去重用的，工作单元不进键就白改」。
  - 链的记录与落盘：`src/shared/refresh/src/chain.ts:399-406` 的 `ChainEntry` 就四个字段（票键、工作单元、时刻、动作）；落盘版本号从 1 升到 2 的说明在 `src/shared/refresh/src/chain.ts:507`；老版本三元组按「工作单元未知（空串）」收下的分支在 `src/shared/refresh/src/chain.ts:561` 附近。
  - 会话那格链的记录：`src/host/refresh/sessionTickets.js:127-135` 把 `verdict.effortId` 一路交给 `chainRecord`。
  - 界面读数：`src/host/refresh/sessionChainReadout.js:47-53` 每条带出 `effortId`（文件头 `src/host/refresh/sessionChainReadout.js:75` 注明 #783）；界面行数据 `src/client/views/shared/sessionChainView.js:217-231` 用链记下的工作单元去查标题、状态与是不是地图，跳转 `src/client/views/shared/sessionChainView.js:249-259` 有工作单元就直接找对应那一张，取不到按 #780 的护栏回落普通票页。
  - 客户端缓存与键：详情缓存 `src/client/kernel/api-io.ts:238-240`（`idOfParts(effortId, num)`）、评论缓存 `src/client/kernel/api-io.ts:338`、地图子票桶 `src/client/kernel/api-io.ts:447-448`；列表行键 `src/client/views/ListTabRow.js:77`（`idOf(x)`）、地图子票行键 `src/client/views/MapDetail.js:132`（`idOf(t)`）、详情页子票/阻塞票行键 `src/client/views/IssueDetail.js:344` 与 `:358`；导航栈坐标 `src/client/kernel/store-prefs.js:62-68` 与 `:105-106`（同号不同工作单元是两条坐标，照压）；按身份找地图 `src/client/kernel/store-derived.js:12-31`（`findMapByIdentity` / `findGroupByIdentity`）；宿主侧按需取地图子票也带上工作单元 `src/host/mapTickets.js:111-112`。
  - 快照按 (工作单元, 编号) 唯一化：`src/tracker/deck-derive.ts:18`；编排列 `src/tracker/rooms/markdown/issues-read.ts:221-228` 建立索引时也是 `idOfParts(it.effortId, key)`。

### 2.2 来源：今天「AI 直接改票文件」这条确实有落点

- 判据那一侧：`src/shared/refresh/src/chain.ts:225` 的 `ChainSource = 'tool-args' | 'cli' | 'markdown-file'`；分支在 `src/shared/refresh/src/chain.ts:363-366`（命中 `markdown-file` 且工具是文件写工具时，动作记成 `file-write`），读工具走 `src/shared/refresh/src/chain.ts:348` 明确不记。
- 喂它的那一处（票面点名「生产代码没有一处喂它」）：`src/host/refresh/writeEvents.js:316-336` —— 从工具参数里取出被写的文件路径（`src/host/refresh/writeEvents.js:165-191` 的 `filePathOf`，认 `file_path` / `path` / `file` 等字段与批量数组），路径像票文件且工具不是 deck 写工具时，`chainSource = 'markdown-file'`（`src/host/refresh/writeEvents.js:324`），路径随 `note` 一起传下去（`src/host/refresh/writeEvents.js:332-336`）。这里的 `note` 在生产里确实接上了：`src/host/refresh/wiring.js:201-208` 把 `note` 接成 `sessionTickets.note`，并把 `backendOf`、首条消息钩子一并注入；订阅在 `src/host/refresh/wiring.js:303-305` 挂上。
- 界面上这条来源有词条：动作类别 `file-write` 的文案是「改票文件」，中文在 `src/client/kernel/locale-pages.js:93`，英文在 `src/client/kernel/locale-pages.js:160`，词条键与动作闭集合的对应表在 `src/client/views/shared/sessionChainView.js:52-62`。
- deck 工具那条路（本来就有）也把工作单元显式带上：`src/deck/tools/issue-report.ts:166-173` 用票自己回包里的 `effortId`，取不到才用参数里那个，传给链的 `source` 是 `tool-args`。

## 三、判定与依据

**判定：(b) 已被新结构消除** —— 票面点名的两处缺口在今天的树里都找不到可走的路径，而且不是靠显示层遮掩，是身份本身就把两张同号的票分开、来源那一栏也有了落点与文案。

依据分四条：

1. 多工作单元下同号票不再合并。链的键含工作单元（`src/shared/refresh/src/chain.ts:203-218`），记录与落盘含工作单元（`src/shared/refresh/src/chain.ts:399-406`、`src/shared/refresh/src/chain.ts:507`），界面读数与行数据含工作单元（`src/host/refresh/sessionChainReadout.js:47-53`、`src/client/views/shared/sessionChainView.js:217-231`），跳转按它精确定位（`src/client/views/shared/sessionChainView.js:249-259`）。全仓其它会把票当键的地方同样走 `idOf` / `idOfParts`（第 2.1 节末列的那一串位置）。
2. 本地 Markdown 那层从寻址上就不允许「同号两张猜一张」：不指定工作单元而多命中时报冲突（`src/tracker/rooms/markdown/issues-locate.ts:86`），新建票同样拒绝（`src/tracker/rooms/markdown/issues-create.ts:71`）。#780 的护栏今天还在，只在取不到工作单元时兜底（`src/client/views/shared/sessionChainView.js:247` 的说明，以及 `tests/verify-chain-view.js:336` 那条断言）。
3. 直接改票文件这条路有人喂：`src/host/refresh/writeEvents.js:316-336` 标来源并传路径，`src/host/refresh/wiring.js:201-208` 把 `note` 接在生产装配里；只读工具看同一张票文件仍不记（`src/shared/refresh/src/chain.ts:348`）。
4. 门禁在现场核对通过（只读运行，未改文件）：
   - `node --import ./scripts/ts-hook.mjs tests/verify-783-chain-effort.js` → 全部通过，#783 共 26 项（同源解析、只记写、两份工作单元同号两条记录、同一工作单元两次写仍是一条、落盘四元组版本 2、老三元组当未知收下、形状不对与版本不认识丢弃、记账那一步标来源并传路径、跳转取得到进对应那一张、取不到回落普通票页）。
   - `tests/verify-781-chain-identity.js` 全部通过（10 项）、`tests/verify-714-session-tickets.js` 全部通过（75 项断言）、`tests/verify-chain-view.js` 全部通过、`tests/verify-chain-capsule.js` 全部通过。
   - 编译产物与源码一致：`src/shared/refresh/chain.js`（AUTO-GENERATED）里同时有 `markdown-file` 分支、`chainEffortIdFromPath` 与 `CHAIN_DISK_VERSION = 2`（关键字面量只出现在 `.ts` 源码，是正常的，产物里被转成同义写法）。
   - 实施提交在历史里：`git log` 里 `d3c4c26f 让处理链记下直接改票文件并按工作单元区分同号票（修复783）`，之后 chain 文件只经历 #1023 的搬家（`3ce9b201`、`245f8915`），搬家提交说的是「行为一个字不改」。

顺带记下今天结构里新增的一层，它让「同号被当成一张」更难发生：`src/deck/shell/call-memo.ts:45-49` 的仓库缓存前缀拼上 `effortId`，`src/deck/shell/write-mutex.ts:38-42` 的写锁键也把 `effortId` 算进「同一个仓库」的判据。

## 四、不确定处

1. `tests/verify-783-chain-effort.js` 直接 `node` 跑会失败：`Cannot find module './lib/eval-probe.js'`（`tests/verify-783-chain-effort.js:22`）—— 共用小件已经转成 `tests/lib/eval-probe.ts`，只有挂上 `scripts/ts-hook.mjs`（`npm test` 那条路）才解析得到。这是测试装载方式的事，不是产品缺口；本次调查用 `node --import ./scripts/ts-hook.mjs` 跑通。
2. 本次只读运行了与本票直接相关的那几条门禁，没有跑全链（`npm run verify:all` 按要求没跑），所以「别处改动是否破坏了这两件事」只能就相关几条门禁与源码走读下结论。
3. 界面仍按票面要求只显示编号（多工作单元仓库里行尾另有一个工作单元小标，`src/client/views/ListTabRow.js:102`）；链那一行画的是编号加动作词「改票文件」，没有单独一栏写「这张票是从哪条路来的」。「来源」在今天是链判据内部的一格，不是界面上的一栏 —— 与票面期望一致（票面只要求这条来源记进链、动作是「改票文件」）。
4. 工作树里那五个未提交文件不属于本票范围，本次没有读它们的内容，也没有据此调整结论。

## 五、若真要处理

不必再动这两处：#783 要的两件事今天都在树上，并且有 26 项门禁守着。真要继续往前推，只剩两件可选的小事：一是把「来源」从判据内部的一格变成界面上可看的一栏（票面明确说不必，需要就另开一票）；二是给 `tests/verify-783-chain-effort.js` 补上装载钩子或把它转成 `.ts`，让这条门禁脱离别的入口也能直接跑（这件事与 #1023 那批迁移同性质，仓里已有基线名单在管）。
