# 规格：面板刷新双通道韧性 —— GitHub 读取 GraphQL 失败自动 REST 降级 + 链接归一（#414/#415 经验全链路落地）

> 本规格由 2026-09-02「刷新不出现 414」全链路排障经验合成（to-spec）。功能当前已上线（main bf73446 / 1d1d51e），本票作为**规格文档**与**后续回归/扩展的契约地**，方便查阅与验收。

## Problem Statement

用户每天在外部（gh issue create 等）新建问题后，右侧面板点「重新检查」应能看到新票出现在列表中（增量绿闪、无旧票消失），状态栏「上次刷新」时间随之走针。但从 09-02 起，新票（#414、#415-422）一直不出现：状态栏时间会走，列表却保持旧的 08-29 快照；修复后数据出现了，可展示/装填的链接又变成了 `https://api.github.com/...` 的 API 地址而非 `https://github.com/...` 页面地址。用户直观感受是「一个原本完善的功能被改坏了」。

## Solution

让 GitHub 数据读取具备**双通道韧性**，并保证对外链接形态恒为页面地址：

1. **发源处降级**：GitHub 后端的数据读取以 GraphQL 为主；GraphQL 任何失败（网络中断/配额/形状异常）都自动走 REST 通道，产出与 GraphQL **同构**的 Issue[]（数量完整、不截断、地图→子票树边完整、过滤语义一致）。
2. **链接归一**：任何来源（GraphQL/REST）的快照，其 issue/map/ticket 的 url 一律呈现为 `https://github.com/{owner}/{repo}/issues/{n}` 页面地址，不再泄露 API 地址。
3. **诚实失败**：双通道都失败时明确返回错误（可诊断），而不是静默保留旧数据造成「刷新像没点一样」的观感。

## User Stories

1. 作为面板用户，我想在外部新建问题后点「重新检查」就看到该票出现在列表中（并带新增绿闪），以便继续跟进。
2. 作为面板用户，我想在 GraphQL 完全不可用时仍能刷新出全量列表（含最新票），以便网络异常期间工作不停。
3. 作为面板用户，我想刷新后「上次刷新」时间与列表数据一致更新（同一事实源），以便相信面板状态。
4. 作为地图用户，我想降级后的快照仍保持「地图 → 子票」的归属关系，以便点开地图行依然能看到其下子票。
5. 作为面板用户，我想看到的地图牌（deck）统计（可接/阻塞/已关闭）在降级时依然由真实数据派生，以便数字可信。
6. 作为面板用户，我想票的行链接、详情链接、「装填」到执行/诊断/grill 提示词里的链接都是 `github.com` 页面地址，以便直接打开/引用。
7. 作为面板用户，我想链接归一不出现在 markdown 等本地后端的文件路径上（只对 GitHub API 地址生效），以便本地图谱行为不变。
8. 作为开发者，我想降级逻辑放在**数据发源处**（后端 list/get 单缝），以便宿主编排层、探针、详情页以及未来新增调用方自动获得同一韧性。
9. 作为开发者，我想降级只在 GraphQL 失败时触发（成功路径零改动），以便 GraphQL 健康时性能和字段完整度不受影响。
10. 作为开发者，我想 REST 降级分页失败有清晰语义：首页失败=双路皆挂（诚实报错），尾页失败=按已得数据截断上报，以便不吞错、不无限重试。
11. 作为开发者，我想降级逻辑有确定性回归门禁（stub 双路：GraphQL 恒失败 / REST 恒成功），以便无需真实网络即可验证数据形状。
12. 作为回归验收者，我想门禁同时断言「数量全量」「414 存在」「树边正确」「url 为页面地址」，以便覆盖现场用户可见症状。
13. 作为维护者，我想客户端的平台 URL 字面量仍受硬编码门禁约束（新许可标记登记），以便 F2 规则不被破坏。
14. 作为排障者，我想有一条「宿主真实行为」的端到端信号（快照磁盘缓存文件），以便快速判断刷新是否真正成功。
15. 作为排障者，我想知道「这台机器 GraphQL 大响应偶发被切断、直连稳定」的诊断方法（小查询全过/大查询失败/直连对照），以便区分环境问题与代码问题。
16. 作为长期维护者，我想把「通道变更必须保留降级」写进规格，以便未来迁移不再犯同样错误。

## Implementation Decisions

- **降级缝位置 = GitHub 后端数据发源处**（list/get 的模块内），而非宿主编排层：宿主侧「所有后端统一走编排器」契约不变，composer、probe、详情、未来调用方自动受益；避免多处分支。
- **REST 降级结构**（原型即线上实现的形状）：
  - `fetchAllIssuesREST`：逐页 `gh api repos/{owner}/{name}/issues?state=all&per_page=100&page=n`（≤10 页）；首页失败诚实返回错误；尾页失败按已得截断。
  - `repairParentLinksREST`：对带 `wayfinder:map` 标签的地图票并行拉 `/issues/{n}/sub_issues`，把子票的 `parent` 置为地图票号；normalize 的 deriveParentKey 直接消费，组装层（maps/tickets）零改动。
  - `applyIssueFilter`：GraphQL/REST 两路共用同一内存过滤（state/type/parentKey/keys）。
  - normalize 兼容双形状（labels 数组或 nodes / user 或 author / html_url 或 url / created_at 等），单条 REST 失败不丢整页。
- **链接归一**（双层，互不依赖）：
  - 宿主层：normalizeIssue 优先 `html_url`（REST 展示地址），GraphQL 仅有 `url`（即页面地址）→ 回退；此修复随宿主重启生效。
  - **URL 形态归属 = 后端单缝**（v1 修订：客户端层不做任何后端专属归一——UI 是各后端 URL 的盲消费方，github 后端知识不得进入 client kernel）。原客户端 `sanitizeIssueUrls` 临时 shim 已移除（它是免宿主重启的过渡手段，违反后端无关原则）；宿主 normalize 优先 `html_url` 后，任意来源的 url 都为页面地址，随宿主重启生效。
- **门禁许可登记**：client-hardcode-gate 的 F2 规则新增行级标记 `SANITIZE_API_URL` 登记归一器中的平台字面量（该门禁的「显式登记处」约定）。
- **诚实失败语义**：GraphQL 失败+REST 首页失败 → 返回错误对象（含 kind/message），不做「失败→当成功→返回旧数据」的静默吞错。
- **操作事实（非代码决策但影响验收）**：DSH Desktop 启动后由 dsh-plugin-desktop 显式擦除 `loader.internal`，故桌面端无 HMR/热更通道——宿主代码变更必须重启桌面（或 CLI web 环）验证；客户端变更刷新页面即可。

## Testing Decisions

- **只测外部行为**：门禁不应断言实现细节（如循环次数），而应断言数据形状与用户可见症状（数量全量、含指定票、树边归属、URL 形态）。
- **确定性门禁（红线，无反作弊）**：`tests/verify-github-rest-fallback.js` 用 stub ctx（GraphQL 恒 `unexpected EOF`、REST 恒成功、夹具 150 条含 414 与地图 #7）驱动 `listIssues`/`getIssue`，断言：恢复成功、全量 150、414 存在、414/#8 的 parentKey=7、#7 type=map、parentKey 过滤、url 为页面地址；另含文件级断言（降级辅助函数存在、normalize 优先 html_url、probe 入库归一）。
- **先例**：沿用 tracker-contract 的 stub-ctx 模式；一并跑 `npm run verify`（含 client-hardcode-gate，F2 新许可标记须过）。
- **真实环（人工低频，不入红线）**：`.tmp/run-listIssues-414.mjs` 对真实 gh 跑 listIssues（GraphQL 大查询 3/5 失败时仍应 GREEN）；用于环境类问题的现场确认。
- **端到端信号**：宿主快照磁盘缓存（DSH 进程 cwd 下 `.dsh-mattskillsdeck-cache/{owner}__{repo}.json`）的 mtime 与内容（条数/含 414/deck）＝ `writeDiskCache` 成功的铁证；注意工作区路径下的同名缓存可能是其它进程（CLI web）的旧写点，勿混淆。
- **回归触发**：以后修改 github 后端任何读取与快照 url 形状时，必须跑 `node tests/verify-github-rest-fallback.js` + `node tests/verify-refresh-414.js` + `npm run verify`。

## Out of Scope

- 不改 GraphQL 主通道本身；GraphQL 健康时行为与字段完整度不变。
- 不动 gitlab / markdown 后端（无 GraphQL 风险面）。
- 不做 blockedBy 的 REST 增强降级（降级时 blockedBy 为空数组，诚实可读；GraphQL 恢复后自动满血）。
- 不清理 `fetchMapsDetail`/旧 `buildSnapshot` 死代码（另有迁移史，建议单独票处理，本次不与功能改动混投）。
- 不解决本机代理/网络对大响应不稳定（环境侧；建议 api.github.com 走直连规则，已在 09-02 排障中给出）。
- 不改客户端 store/渲染结构（归一只在快照入库单缝）。
- 不承诺 GraphQL 恢复的时长——降级是韧性，不是网络修复。

## Further Notes

- **架构红线（用户确认）**：UI（client kernel）对任何后端零耦合——URL 形态由各后端自己的 normalize 负责（gitlab/markdown 各自独立文件，本次未触碰；回归门禁新增强断言 `客户端 kernel 不含 github 专属 url 归一`）。
- **教训（本次最大收获）**：08-29（d02e54b「所有后端统一走编排器」）把 GitHub 刷新主链路从「REST 为主 + GraphQL 别名 + REST 降级通道」换成 GraphQL 单通道，丢掉了防弹层；09-02 本机对 GraphQL 大响应（≈500KB）开始高频 `unexpected EOF`（5 次 3 败；小查询全过；绕过代理直连 5/5 全成功 → 代理/网络对大响应不稳），单通道被打穿 → 静默旧快照。**经验法规：任何数据通道迁移必须同步保留/重建降级通道。**
- **顺带发现的两点（建议后续票，本次未改）**：
  1. `wf.snapshot` 非 force 打开路径在 `fetchIssueIndex` 失败（返回 null）时仍会把旧盘快照当「较新」返回（`cacheSnapshotIsCurrent` null→非 false），与「拉不到远端≠没变化」的原则相悖；本次主修复在 force 刷新路径，打开路径建议单独评估。
  2. 桌面端 `loader.internal` 被设计性擦除（无 HMR/热更、注入器 `dev_reload_package` 不可用），宿主代码验证链 = 重启桌面；建议在插件文档/交接模板里写明，避免每次排障都重新发现。
- **参考提交**：`bf73446`（REST 降级主修复：list/get 双通道 + 树边修复 + 回归门禁）、`1d1d51e`（链接归一：normalize html_url 优先 + probe 入库归一 + SANITIZE_API_URL 许可）。关联：#414（可见性）、#415（8-29 方案记录，需转 ready 状态）、#418（发布反馈研究，同段环境报告）。
- **真实宿主验收记录**：09-02 18:38 重启后，桌面真缓存 `D:\0Tools\DSH Desktop\.dsh-mattskillsdeck-cache\FeatherHunter__dsh-mattpocock-skills-deck.json` 于 18:43:45 写入：430 条 / has414 ✓ / has422 ✓ / maps 44 / deck 完整 / cacheFormat 3。用户确认「看到全部数据」。
