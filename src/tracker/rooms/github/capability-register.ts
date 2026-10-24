/**
 * src/tracker/rooms/github/capability-register.ts —— GitHub 后端对 26 条能力的回答（数据）
 *
 * 四类的判据、为什么写成联合、以及「运行时不读它」这条 G5 纪律，都写在
 * `src/tracker/contract/capability-answer.ts` 的文件头，这里不重复。
 *
 * ── 这份文件与谁是一对 ──────────────────────────────────────────────────────────
 *   - 给人读的表：`docs/tracker/capability-github.md`（视图，门禁逐条比对，两边不许打架）
 *   - 实现真源：`src/tracker/rooms/github/backend.ts`（工厂交出来的成员；成员集合由本文件推出来，
 *     见该文件里 `GithubBackendMembers` 的写法）
 *   - 依据（哪份文件实现的、为什么不做）写在 md 表里人的那两列，不在这里重复一份。
 *
 * ── 改这里之前先看三条 ─────────────────────────────────────────────────────────
 *   1. 先改本文件，再改实现（`provided` 多一条、少一条，编译期当场红），最后改 md 表；
 *      门禁 `tests/verify-capability-register.ts` 会告诉你哪一行还没对齐。
 *   2. 把一条能力从「未来会开发」改成「明确不支持」是一次**判定**，不是修字：判据是
 *      「这条能力在这个后端上的形态存不存在」。做过一次这种判定的是 `ensureLabelColorsFile`
 *      （2026-10-14，理由见 md 表的变更一节）。
 *   3. 本文件只有数据：没有函数、没有分支、没有 import 运行时值。谁把它接进运行时代码，
 *      谁就撞上了 G5 红线（能力只能调用即知，不许查表）。
 */
import type { CapabilityRegister } from '../../contract/capability-answer.js'

/**
 * GitHub 后端：24 条能力真提供，1 条明确不支持，1 条未来会开发（读预算，承接 #1439）。
 *
 * 顺序照契约名录（23 条操作在前、3 条定位口在后），读的人可以两边对着看。
 */
export const GITHUB_CAPABILITY_REGISTER = {
  // —— 操作 23 条：21 条真实现 ——
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
  getCurrentUser: { tier: 'provided' },
  initProject: { tier: 'provided' },
  listLabels: { tier: 'provided' },
  setLabelColors: { tier: 'provided' },
  counts: { tier: 'provided' },
  listPage: { tier: 'provided' },
  getRepoPermissions: { tier: 'provided' },
  listSubIssues: { tier: 'provided' },
  // 唯一一条形态不合的：配色文件的读者在本地 Markdown 那边（颜色真源是工作区文件）；
  // GitHub 的颜色真源是仓库标签，放一份手改不算数的文件只会误导人。理由见 md 表的依据列。
  ensureLabelColorsFile: { tier: 'unsupported-by-design', stubBy: 'registry' },
  // 规格 1439 的读预算：#1443 起房间自己读 gh（budget.ts），不再是未来会开发。
  readBudget: { tier: 'provided' },

  // —— 定位口 3 条：全部提供 ——
  getRepoKey: { tier: 'provided' },
  describe: { tier: 'provided' },
  issueAddress: { tier: 'provided' },
} as const satisfies CapabilityRegister
