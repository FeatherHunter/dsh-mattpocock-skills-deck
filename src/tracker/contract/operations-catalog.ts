/**
 * src/tracker/contract/operations-catalog.ts —— 契约的操作名录：19 个操作名的唯一真源
 *
 * ── 这个文件为什么存在 ──────────────────────────────────────────────────────────
 * 在这之前，「19 条契约操作叫什么」有两份：`operations.ts` 里的联合类型 `OpName`，
 * 与运行时真源里的 `OPERATIONS` 数组。两份靠人眼对齐 ——
 * 漏改一处的后果是「类型说有、注册表不补桩」，那种错只在运行时才炸，且只炸没实现它的后端。
 *
 * 现在改成一份数据生类型、再加一处转出：本文件写数组，`operations.ts` 用 `typeof OPERATIONS[number]`
 * 从它生成 `OpName`，`index.ts` 把同一份数组转出去给注册表（同一个引用，不拷贝）。
 * 加一条操作只需改这里一处，类型与运行时跟着变。
 *
 * ── 为什么这个文件算「数据」不算「实现」 ────────────────────────────────────────
 * 契约层只许有类型与数据（门禁 `tests/verify-contract-types.js` 的第四项盯着这件事）。
 * 本文件只有一个 `as const` 的字符串数组：没有函数、没有指到目录外的值引用、没有取值逻辑。
 * 注册表拿到它只是照着遍历，不会因为它是「值」而多出任何行为。
 *
 * ── 单源的来历（迁移完成，曾经的两份在哪里） ────────────────────────────────────
 * 旧运行时真源（`src/host/tracker/contract.js`，JSDoc 版）已在 #1019 退休，值住进了本目录；
 * `index.ts` 曾经手抄过第二份数组（`Object.freeze` 那一份），#1026 把它改成从本文件转出
 * （`Object.freeze` 留着：冻住的是同一份数组，金标准夹具断言它冻住）。
 * 旧门禁里「两份同集」那两条断言随之撤掉（见门禁文件头的「撤掉的两项」），不再有东西可比。
 *
 * ── 为什么不把 `CONTRACT_VERSION` 也搬过来 ──────────────────────────────────────
 * 它住在 `vocabulary.ts`（值 1，供日志与审计引用）。若在本文件「再导出」一次，
 * 两个文件各有一份写法相近的导出，后人容易以为是两份真源。所以本文件只记一句：
 * 版本号的唯一真源在 `vocabulary.ts`，这一层不复制它。
 */

/**
 * 19 条契约操作的名字（本目录与注册表的唯一真源）。
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
