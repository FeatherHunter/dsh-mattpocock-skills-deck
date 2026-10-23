/**
 * src/tracker/session/interceptors.ts —— 管线两个拦截口的转手垫片（形状真源已搬进契约层）。
 *
 * 为什么这里只剩转手：裁决口与记账口是装配方要实现的类型，真源住在契约层那一份
 * （src/tracker/contract/budget-model.ts），管线与入口只从那里引用，依赖规则才不把
 * 这些引用算成同层互引。关于「口」的说明（为什么是口而不是实现）见契约层那一份的用法，
 * 这里不再抄第二份。这一份保留下来，只是为了让已经按这条路径引用的人不用改路径；
 * 新写的引用请直接走契约层那一份，不要再经这里转手。
 */
export type {
  AdmitInput,
  AdmitDecision,
  AdmitPort,
  AccountInput,
  AccountPort,
} from '../contract/budget-model.js'
