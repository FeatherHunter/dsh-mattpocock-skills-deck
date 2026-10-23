/**
 * src/tracker/session/budget-reading.ts —— 预算读数的转手垫片（形状真源已搬进契约层）。
 *
 * 为什么这里只剩转手：读数形状与口径形状是同一件事的两面，真源住在契约层那一份
 * （src/tracker/contract/budget-model.ts），会话与注册表只从那里引用，依赖规则才不把
 * 这些引用算成同层互引。这一份保留下来，只是为了让已经按这条路径引用的人不用改路径；
 * 新写的引用请直接走契约层那一份，不要再经这里转手。
 */
export type { BucketLevel, BudgetReading } from '../contract/budget-model.js'
