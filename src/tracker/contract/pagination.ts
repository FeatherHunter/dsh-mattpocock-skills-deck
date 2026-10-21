/**
 * src/tracker/contract/pagination.ts —— 三个后端房间（GitHub、GitLab、本地 Markdown）共用的分页与额度数字表。
 *
 * 为什么要有这一份：
 *   这三个数字族原先在各房各写一份，同一个含义散在十几个文件里 —— 列出给界面的分页契约（缺省 50、上限 200）
 *   在 GitHub、GitLab、Markdown 三房各有一份；子票每页 100 张、一张地图最多 1000 张在 GitHub 与 GitLab
 *   两房各有一份；改色并发 4 也在两房各有一份。同一个数在几处各写一遍，改一处忘一处时没有任何东西会红。
 *   收进这里以后，这些数字只有一处真源，谁要用就从这里取。
 *
 * 为什么按后端分组、而不是每个名字只留一个值：
 *   同一个名字在不同后端背后是**不同的接口事实**，不能为了「看着统一」而合并。最典型的是 GitLab 的
 *   per_page 上限是官方写死的 100（默认 20）：如果照着 GitHub 的 50 或 200 去问，远端会把 200 自己截到
 *   100，而调用方还以为这一页的大小是 200 —— 一页 100 行就成了「比 per_page 少」，于是把「还有下一页」
 *   误判成到底，历史从中间少一段，而且不会报错。GitHub 的标签列表一次能要 1000 条、GitLab 是每页 100、
 *   最多翻 100 页，也是两家接口各自的算法。所以表按后端分组，各组的差异照实写，不做归一。
 *
 * 这里只放「一次问后端要多少条、最多问几次」这类数字。它们是后端接口的硬约束与安全护栏，不是给人调的旋钮，
 * 所以不搬进 config/ 下的 YAML（见 docs/adr/20261021-config-ownership.md 第 2.4 节与
 * docs/adr/20261016-time-config-yaml.md 第 5 节：条数、页数、次数这类值排除在时间参数之外）。
 *
 * 谁在读它：GitHub 房（page / sub-issues / pulls / issues / label-colors-ops / idempotency / queries /
 * graph / parent-repair）、GitLab 房（pages / labels-ops / sub-issues / idempotency / graph-blocking）、
 * 本地 Markdown 房（page）。各房原来的导出名与导出位置保持不变，只是值改成从这里取，外部调用方与现有测试
 * 不需要改。
 *
 * 改这里的数字必须同时改 tests/verify-pagination-limits.ts 里的期望值清单：那份门禁逐项比对本表，
 * 两边不一致就判红。这是有意为之 —— 数字是「接口事实」，改动应当是一次能被人看见的、同时改两处的 diff，
 * 而不是悄悄漂移。
 */
export const PAGINATION = {
  github: {
    // 分页契约：一页默认 50 张，要多了按 200 封顶（contract/results.ts 的「分页契约」，各后端同一套口径）。
    limitDefault: 50,
    limitMax: 200,
    // 整仓列表那条 GraphQL 路径一页取多少张（issues / pullRequests 两条连接都是 100）。
    listPageSize: 100,
    // REST 兜底通道一页取多少条（GitHub REST 的 per_page 上限就是 100）、最多翻几页（安全上限，防远端异常时死翻）。
    restPageSize: 100,
    restMaxPages: 10,
    // 子票连接：每页 100 张（GraphQL 连接的单页上限），一张地图最多装 1000 张（契约 operations.ts 的硬上限）。
    subIssuesPageSize: 100,
    subIssuesMax: 1000,
    // 列标签一次最多向 gh 要 1000 条；到了这个数就当「可能没拿全」，整条操作如实失败。
    labelListLimit: 1000,
    // 改标签颜色：同时最多发 4 个请求（官方建议串行，但并发撞限流时单条会如实失败、可重试，所以默认拉满到上限）。
    labelWriteConcurrencyMax: 4,
    labelWriteConcurrencyDefault: 4,
    // 建票后按锚回查：慢路最多读 40 张候选正文；搜索接口快路一次最多取 20 条；列表接口快路一次取 100 条（接口允许的最大值）。
    anchorLookupBodyFetches: 40,
    anchorLookupSearchLimit: 20,
    anchorLookupListLimit: 100,
    // 依赖投影：blockedBy 与 blocking 两条连接各最多一次取 50 条（到顶时要能如实说「可能不全」）。
    depsMax: 50,
  },
  gitlab: {
    // 分页契约：与 GitHub 房同一套（缺省 50、上限 200）。
    limitDefault: 50,
    limitMax: 200,
    // GitLab REST 的 per_page 上限：官方文档写的是默认 20、上限 100。不能照 200 去问，理由见文件头。
    maxPerPage: 100,
    // 子票读：翻页扫仓时一页取 100 张，最多装 1000 张（与 GitHub 房同一个契约硬上限）。
    subIssuesPageSize: 100,
    subIssuesMax: 1000,
    // 列标签：每页 100 条（官方上限）、最多翻 100 页（100 页 × 100 条 = 10000 条，比真实仓库的标签数高三个数量级）。
    labelListPerPage: 100,
    labelListMaxPages: 100,
    // 改标签颜色：同时最多发 4 个请求（GitLab 没有单请求限速建议，默认与 GitHub 房同档）。
    labelWriteConcurrencyMax: 4,
    labelWriteConcurrencyDefault: 4,
    // 建票后按锚回查的慢路：最多看 100 张候选（按创建时间倒序的第一页）。
    anchorLookupScanLimit: 100,
  },
  markdown: {
    // 本地 Markdown 房只有分页契约这一组数字：缺省 50、上限 200，与另外两房同一口径。
    limitDefault: 50,
    limitMax: 200,
  },
} as const
