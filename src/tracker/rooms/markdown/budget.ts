/**
 * src/tracker/rooms/markdown/budget.ts —— 本地 Markdown 房间的额度读数（#1446）。
 *
 * 本地文件读写不经过任何远端服务，本来就没有「请求额度」这回事；房间在模块对象上声明的
 * 口径也是离网（off-network）。所以这一条读数的正确答案是「离网」——不是 0，也不是未知：
 * 回 0 会被裁决读成「额度用完了」，回未知会让同步去重试一件永远量不出来的事。
 *
 * 为什么还留这个函数：能力登记把 readBudget 列为「明确提供功能」，调用方按统一入口来问，
 * 本地房必须给一个明确的答案；答案的形状由契约的离网读数固定，只有 kind 一格，
 * 没有剩余与上限可报。这里不读盘、不看时钟、不调任何东西，是一个纯回答。
 */
import type { BudgetReading } from '../../contract/budget-model.js'
import type { OpResult } from '../../contract/results.js'

/**
 * 本地 Markdown 后端的额度读数：恒为「离网」，永远成功、永不抛。
 * 不做缓存也不看上下文：答案与机器状态无关，每次问都得到同一个值。
 */
export function readMarkdownBudget(): OpResult<BudgetReading> {
  return { ok: true, data: { known: true, kind: 'off-network' } }
}
