/**
 * src/tracker/rooms/gitea/support/capability-register.ts —— gitea 房对 27 条能力的回答（数据）
 *
 * 四类的判据、为什么写成联合、以及「运行时不读它」这条 G5 纪律，都写在
 * `src/tracker/contract/capability-answer.ts` 的文件头，这里不重复。
 *
 * ── 这一家的账（票 #3 的口径）────────────────────────────────────────────────
 * gitea 房目前接了探活（preflight）、三个定位口、8 条读操作（票 #11：list / get / getDependencies /
 * counts / listPage / listLabels / listSubIssues / listMaps）与 9 条写操作（票 #12：create / close /
 * reopen / comment / update / setLabels / setAssignees；票 #13：setParent / setBlockedBy）；其余操作一律不写进工厂，由注册表按名录
 * 补「不支持」的桩（stubBy: "registry"），调用方拿到的是规范的 unsupported 失败，不是方法缺失。
 * 每补一条操作：先在这里把那一行改成 `{ tier: 'provided' }`，再去实现，最后同步
 * `docs/tracker/capability-gitea.md` 的文档表，门禁 `tests/verify-capability-register.ts`
 * 会逐行比对三处。
 *
 * `getRepoKey` 为什么是「提供」而不是「不支持」：契约对定位口只有一种答案形态——名字或者空，
 * 空也是答案、不是失败（`contract/README.md` 定位口那一段）。注册表**不给定位口补桩**，
 * 缺席就是实例上没有这个方法，调用方一调就抛类型错；所以这一房真的实现了一条：
 * 从 `git remote get-url origin` 的地址里解析 owner/name，解析不出来诚实回 null（实现见
 * `rooms/gitea/index.ts` 的 createGiteaBackend）。
 *
 * 本文件只有数据：没有函数、没有分支、没有 import 运行时值（G5 红线：能力只能调用即知，不许查表）。
 */
import type { CapabilityRegister } from '../../../contract/capability-answer.js'

/**
 * gitea 后端：27 条能力里 22 条真提供（探活、两个定位口，加票 #11 的 8 条读操作、票 #12 的 7 条写操作、
 * 票 #13 的 2 条结构写与票 #14 的 4 条管理类操作），2 条操作由后端实例显式桩、明确不支持（票 #14）。
 *
 * 顺序照契约名录（24 条操作在前、3 条定位口在后），读的人可以两边对着看。
 */
export const GITEA_CAPABILITY_REGISTER = {
  // —— 操作 24 条：探活、8 条读操作（票 #11）、9 条写操作（票 #12、#13）与 4 条管理类操作（票 #14）真实现，
  //    其余 2 条由后端实例显式桩、明确不支持 ——
  preflight: { tier: 'provided' },
  list: { tier: 'provided' },
  get: { tier: 'provided' },
  getDependencies: { tier: 'provided' },
  // 票 #12 的 7 条写操作：tea 命令面见 support/tea-run.ts，实现见 issues/write.ts、labels/assign.ts、comments/write.ts。
  create: { tier: 'provided' },
  close: { tier: 'provided' },
  reopen: { tier: 'provided' },
  comment: { tier: 'provided' },
  update: { tier: 'provided' },
  setLabels: { tier: 'provided' },
  setAssignees: { tier: 'provided' },
  // 票 #13 的 2 条结构写：归属与阻塞都写进正文（隐藏标记优先、可见行兜底），实现见 graph/write.ts。
  setParent: { tier: 'provided' },
  setBlockedBy: { tier: 'provided' },
  counts: { tier: 'provided' },
  listPage: { tier: 'provided' },
  listLabels: { tier: 'provided' },
  // 票 #14 的 4 条管理类操作：改色在 labels/colors.ts（tea labels update 只认 id，先建「名字→id」对照），
  // 当前登录人在 repo/current-user.ts（tea logins ls 的 default 项），权限读在 repo/permissions.ts
  // （tea repos ls 翻页扫仓），读预算在 budget.ts（Gitea 无配额端点、tea 不透出速率头，如实回「没量出来」）。
  setLabelColors: { tier: 'provided' },
  getCurrentUser: { tier: 'provided' },
  getRepoPermissions: { tier: 'provided' },
  listSubIssues: { tier: 'provided' },
  // 票 #14 的两条诚实桩（stubBy:'backend'，工厂实例上交 fail(unsupported)）：
  //   · initProject —— `tea repos create` 存在，但「建仓＋git init＋首次推送」全链路未经真机验证，
  //     硬接只会交半成品；将来真机验证通过后改真实现（先开承接票再动手）。
  //   · ensureLabelColorsFile —— 颜色真源在远端仓库标签，工作区配色文件没有任何读者，
  //     「放一份手改就生效的文件」在这个后端上不成立（GitHub / GitLab 同一条理由，不是欠账）。
  initProject: { tier: 'unsupported-by-design', stubBy: 'backend' },
  ensureLabelColorsFile: { tier: 'unsupported-by-design', stubBy: 'backend' },
  // 读预算（票 #14）：Gitea API 没有账号级配额端点、tea 不透出速率响应头，没有水位可量——
  // 实现恒回 { known: false, reason: 'unsupported' }（budget.ts），如实说「没有量」，不猜一个数。
  // 档位仍是明确提供功能（双轴评审第 5 条的背书）：provided 的判据是「成员在、调得动、
  // 每种合法输入对得上承诺」——readBudget 不收任何输入，不存在「某几种输入对不上」的
  // partially-provided 形态；而「永远放行、不记账」正是契约对它的承诺（contract/README.md），
  // budget-model.ts 的 unknown 读数分支就是为量不出水位的后端准备的合法回话（operations.ts）。
  // 同形先例：本地 Markdown 房恒回常量读数同样登记 provided。
  readBudget: { tier: 'provided' },
  listMaps: { tier: 'provided' },

  // —— 定位口 3 条：getRepoKey 实现为「名字或空」，describe 与 issueAddress 真提供 ——
  getRepoKey: { tier: 'provided' },
  describe: { tier: 'provided' },
  issueAddress: { tier: 'provided' },
} as const satisfies CapabilityRegister
