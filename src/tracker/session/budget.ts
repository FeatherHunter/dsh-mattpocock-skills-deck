/**
 * src/tracker/session/budget.ts —— 预算口径的转手垫片（形状真源已搬进契约层）。
 *
 * 为什么这里只剩转手：预算口径是会话、房间、注册表三处共用的形状，真源住在契约层那一份
 * （src/tracker/contract/budget-model.ts），三处只从那里引用，依赖规则才不把这些引用
 * 算成同层互引。这一份保留下来，只是为了让已经按这条路径引用的人不用改路径；
 * 新写的引用请直接走契约层那一份，不要再经这里转手。
 */
export type { BudgetKind, BackendBudgetModel } from '../contract/budget-model.js'
export { BUDGET_KINDS } from '../contract/budget-model.js'
