/**
 * src/tracker/rooms/gitlab/capability-register.ts —— GitLab 后端对 25 条能力的回答（数据）
 *
 * 三类的判据、为什么写成联合、以及「运行时不读它」这条 G5 纪律，都写在
 * `src/tracker/contract/capability-answer.ts` 的文件头，这里不重复。
 *
 * ── 这一家的特点是「欠账多」────────────────────────────────────────────────────
 * 15 条真提供，10 条是**形态成立、只是今天没做**（`planned`）。按判据它们都带了承接票号，
 * 今天全部挂在 `#1062`（地图 10：GitLab 房）名下——「未来会开发」必须写清谁承接，
 * 否则就是没人管的欠账。地图 10 动工时，那些票做完一条就把这里的一条改成 `provided`
 * （编译期会逼着实现跟上成员集合），md 表由门禁对齐。
 *
 * ── 与谁是一对 ──────────────────────────────────────────────────────────────────
 *   - 给人读的表：`docs/tracker/capability-gitlab.md`（视图，门禁逐条比对）
 *   - 实现真源：`src/tracker/rooms/gitlab/index.ts`（工厂交出来的成员由本文件推出来）
 *
 * 改法、以及「本文件只有数据、不许被运行时代码 import」这两条，同 GitHub 那份。
 */
import type { CapabilityRegister } from '../../contract/capability-answer.js'

/** GitLab 后端：15 条真提供，10 条形态成立但今天没做（欠账，承接票号见各行）。 */
export const GITLAB_CAPABILITY_REGISTER = {
  // —— 操作 22 条：13 条真实现 ——
  preflight: { kind: 'provided' },
  list: { kind: 'provided' },
  get: { kind: 'provided' },
  getDependencies: { kind: 'provided' },
  create: { kind: 'provided' },
  close: { kind: 'provided' },
  reopen: { kind: 'provided' },
  comment: { kind: 'provided' },
  update: { kind: 'provided' },
  setLabels: { kind: 'provided' },
  setAssignees: { kind: 'provided' },
  setParent: { kind: 'provided' },
  setBlockedBy: { kind: 'provided' },

  // —— 操作 22 条：9 条今天没做（工厂自己写着「还没做」，语义都说得通）——
  counts: { kind: 'planned', ticket: '1062' },
  listPage: { kind: 'planned', ticket: '1062' },
  listLabels: { kind: 'planned', ticket: '1062' },
  setLabelColors: { kind: 'planned', ticket: '1062' },
  getCurrentUser: { kind: 'planned', ticket: '1062' },
  initProject: { kind: 'planned', ticket: '1062' },
  getRepoPermissions: { kind: 'planned', ticket: '1062' },
  listSubIssues: { kind: 'planned', ticket: '1062' },
  ensureLabelColorsFile: { kind: 'planned', ticket: '1062' },

  // —— 定位口 3 条：2 条提供，1 条今天没做 ——
  getRepoKey: { kind: 'planned', ticket: '1062' },
  describe: { kind: 'provided' },
  issueAddress: { kind: 'provided' },
} as const satisfies CapabilityRegister
