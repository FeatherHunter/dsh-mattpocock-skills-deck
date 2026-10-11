/**
 * src/tracker/contract/operations-catalog.ts —— 契约的操作名录：19 个操作名的唯一真源
 *
 * ── 这个文件为什么存在 ──────────────────────────────────────────────────────────
 * 在这之前，「19 条契约操作叫什么」有两份：`operations.ts` 里的联合类型 `OpName`，
 * 与运行时 `src/host/tracker/contract.js` 里的 `OPERATIONS` 数组。两份靠人眼对齐 ——
 * 漏改一处的后果是「类型说有、注册表不补桩」，那种错只在运行时才炸，且只炸没实现它的后端。
 *
 * 现在改成一份数据生类型：本文件写数组，`operations.ts` 用 `typeof OPERATIONS[number]`
 * 从它生成 `OpName`。加一条操作只需改这里一处，类型跟着变。
 *
 * ── 为什么这个文件算「数据」不算「实现」 ────────────────────────────────────────
 * 契约层只许有类型与数据（门禁 `tests/verify-contract-types.js` 的第三项盯着这件事）。
 * 本文件只有一个 `as const` 的字符串数组：没有函数、没有运行时 import、没有取值逻辑。
 * 注册表拿到它只是照着遍历，不会因为它是「值」而多出任何行为。
 *
 * ── 与运行时真源的关系（迁移期必读） ────────────────────────────────────────────
 * 今天运行时的真源仍是 `src/host/tracker/contract.js:58-74` 的 `OPERATIONS`（注册表按它
 * 给没实现的后端补「做不到」的桩）。两个数组暂时并存，**顺序与名字都逐字照那一份抄**：
 * 迁移期由门禁 `tests/verify-contract-types.js` 的第四项断言两边同集，
 * 不等就判红并列出差异；等 contract.js 退休（退休时点由迁移批次定）时，
 * 那条断言与本文件「照抄」这句话一起撤掉，本文件成为唯一真源。
 *
 * ── 为什么不把 `CONTRACT_VERSION` 也搬过来 ──────────────────────────────────────
 * 它今天住在 `src/shared/tracker/constants.js`（值 1，供日志与审计引用）。若在本文件
 * 「再导出」一次，就产生一条运行时 import —— 契约层不许引运行时模块（门禁第三项会判红），
 * 而且那会变成第二个真源。所以本文件只记一句：版本号的唯一真源仍在 constants.js，
 * 这一层不复制它。
 */

/**
 * 19 条契约操作的名字，顺序逐字照 `src/host/tracker/contract.js:58-74`。
 *
 * 为什么没有 `detect`：身份识别不是操作，它是 `matches`（布尔）+ 注册表三级仲裁 + `describe`。
 * 为什么没有 `snapshot` / `children` / `listSubIssues`：那些是读路径的实现细节或宿主编排的
 * 便利函数，进了这份名录就等于把「谁来拼装」写死进契约。
 */
export const OPERATIONS = [
  'preflight',
  'list',
  'get',
  'getDependencies',
  'create',
  'close',
  'reopen',
  'comment',
  'update',
  'setLabels',
  'setAssignees',
  'setParent',
  'setBlockedBy',
  'getCurrentUser',
  'initProject',
  'listLabels',
  'setLabelColors',
  'counts',
  'listPage',
] as const
