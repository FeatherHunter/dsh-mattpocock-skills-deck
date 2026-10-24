/**
 * src/tracker/rooms/gitlab/capability-register.ts —— GitLab 后端对 26 条能力的回答（数据）
 *
 * 四类的判据、为什么写成联合、以及「运行时不读它」这条 G5 纪律，都写在
 * `src/tracker/contract/capability-answer.ts` 的文件头，这里不重复。
 *
 * ── 这一家的账，本轮还清了 ─────────────────────────────────────────────────────
 * 2026-10-14 之前这份登记是「15 条真提供、10 条未来会开发」——欠账最多的一家。地图 10
 * （`#1062`）本轮把那 10 条逐条落地：9 条真做（`counts`、`listPage`、`listLabels`、
 * `setLabelColors`、`getCurrentUser`、`getRepoPermissions`、`listSubIssues`、`getRepoKey`、
 * `initProject`），1 条判定为形态不合（`ensureLabelColorsFile`，往下看第 2 条）。
 * 今天这一家与 GitHub 那家一样，是 **25 条真提供、1 条明确不支持**。
 *
 * ── 与谁是一对 ──────────────────────────────────────────────────────────────────
 *   - 给人读的表：`docs/tracker/capability-gitlab.md`（视图，门禁逐条比对，两边不许打架）
 *   - 实现真源：`src/tracker/rooms/gitlab/index.ts`（工厂交出来的成员由本文件推出来）
 *   - 接手的人先读：`src/tracker/rooms/gitlab/README.md`（这一房与另外两房不一样的地方）
 *
 * ── 改这里之前先看两条（与 GitHub 那份同一套规矩）──────────────────────────────
 *   1. 先改本文件，再改实现（`provided` 多一条、少一条，编译期当场红），最后改 md 表；
 *      门禁 `tests/verify-capability-register.ts` 会告诉你哪一行还没对齐。
 *   2. 一条能力从「未来会开发」改成「明确不支持」是一次**判定**，不是修字：判据是
 *      「这条能力在这个后端上的形态存不存在」。本房的 `ensureLabelColorsFile` 就是这种判定。
 *   3. 本文件只有数据：没有函数、没有分支、没有 import 运行时值（G5 红线：能力只能调用即知，
 *      不许查表）。
 */
import type { CapabilityRegister } from '../../contract/capability-answer.js'

/**
 * GitLab 后端：26 条能力里 25 条真提供（含 #1446 落地的读预算），1 条按设计明确不支持。
 *
 * 顺序照契约名录（23 条操作在前、3 条定位口在后），读的人可以两边对着看。
 */
export const GITLAB_CAPABILITY_REGISTER = {
  // —— 操作 23 条：22 条真实现，1 条按设计不支持 ——
  preflight: { tier: 'provided' },
  list: { tier: 'provided' },
  get: { tier: 'provided' },
  getDependencies: { tier: 'provided' },
  create: { tier: 'provided' },
  close: { tier: 'provided' },
  reopen: { tier: 'provided' },
  comment: { tier: 'provided' },
  update: { tier: 'provided' },
  setLabels: { tier: 'provided' },
  setAssignees: { tier: 'provided' },
  setParent: { tier: 'provided' },
  setBlockedBy: { tier: 'provided' },
  // 本轮补的九条。
  counts: { tier: 'provided' },
  listPage: { tier: 'provided' },
  listLabels: { tier: 'provided' },
  setLabelColors: { tier: 'provided' },
  getCurrentUser: { tier: 'provided' },
  getRepoPermissions: { tier: 'provided' },
  // 这一条读的是票正文顶部的 `Part of #<地图>` 声明行（setParent 建票/挂载时写下），不是原生子票 ——
  // 「能读回来」这件事成立，但读回来的东西叫什么要看清，理由见 md 表与交接说明。
  listSubIssues: { tier: 'provided' },
  initProject: { tier: 'provided' },
  // 唯一一条形态不合的，与 GitHub 那家是同一件事、同一把尺子：这条能力承诺的不只是
  // 「文件存在」，还有「改了算数」。GitLab 的颜色真源是远端仓库的标签，工作区里放一份
  // 文件没有任何读者，改了不算数 —— 硬做出来正好撞上契约那句禁止。这不是欠账：欠账是
  // 「形态成立、只是没做」，它连形态都不成立。理由见 md 表的依据列。
  ensureLabelColorsFile: { tier: 'unsupported-by-design', stubBy: 'registry' },
  // 读预算（#1446 落地）：经 `glab api --include` 读响应头里的 RateLimit-Limit /
  // RateLimit-Remaining，量出请求桶的水位；量不到时回「读数未知」并带原因，不回 0。
  // 实现在 ./budget.ts，三条坏路的理由写在那个文件头上。
  readBudget: { tier: 'provided' },

  // —— 定位口 3 条：全部提供 ——
  // getRepoKey 是这一轮补的第三条。定位口没有「我不支持」这种答案，注册表也不替它们补桩：
  // 问「这个仓库叫什么」，答案是名字或者空，空也是答案。
  getRepoKey: { tier: 'provided' },
  describe: { tier: 'provided' },
  issueAddress: { tier: 'provided' },
} as const satisfies CapabilityRegister
