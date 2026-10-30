/**
 * src/tracker/rooms/github/read-sources.ts —— GitHub 后端的读来源登记表（#1683）
 *
 * 这份登记表回答：「在 GitHub 上，每条读操作允许走哪些渠道、取回什么形状、能表达哪些字段组。」
 * 答案不在这里手写：每一条都直接引用操作百科（`src/tracker/contract/operations-encyclopedia.ts`）
 * 里的那一份，所以百科改一处，这里跟着变，不会出现两份说法。
 *
 * 键的类型是 `ReadOperationName`——名录里被标成读的那些操作；少登记一条，编译期就报错。
 * 它今天只被门禁 `tests/verify-operation-catalog.ts` 读取；阶段 1 的读结果来源记录（票 1685）
 * 会拿它当声明面。这里不接运行时行为：本票不改 GitHub 的读路径。
 */
import { OPERATION_ENCYCLOPEDIA } from '../../contract/operations-encyclopedia.js'
import type { ReadOperationName, ReadProfile } from '../../contract/operations-encyclopedia.js'

export const GITHUB_READ_SOURCES = {
  preflight: OPERATION_ENCYCLOPEDIA.preflight,
  list: OPERATION_ENCYCLOPEDIA.list,
  get: OPERATION_ENCYCLOPEDIA.get,
  getDependencies: OPERATION_ENCYCLOPEDIA.getDependencies,
  getCurrentUser: OPERATION_ENCYCLOPEDIA.getCurrentUser,
  listLabels: OPERATION_ENCYCLOPEDIA.listLabels,
  counts: OPERATION_ENCYCLOPEDIA.counts,
  listPage: OPERATION_ENCYCLOPEDIA.listPage,
  getRepoPermissions: OPERATION_ENCYCLOPEDIA.getRepoPermissions,
  listSubIssues: OPERATION_ENCYCLOPEDIA.listSubIssues,
  listMaps: OPERATION_ENCYCLOPEDIA.listMaps,
  readBudget: OPERATION_ENCYCLOPEDIA.readBudget,
} as const satisfies Record<ReadOperationName, ReadProfile>