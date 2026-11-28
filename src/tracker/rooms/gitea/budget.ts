/**
 * src/tracker/rooms/gitea/budget.ts —— gitea 房的读预算（契约 readBudget，票 #14）。
 *
 * 为什么是「没量出来」的 unsupported 档而不是别的读数：Gitea API 没有账号级配额端点，tea 这个
 * 客户端也不透出 HTTP 速率响应头，所以没有可量的水位——这不是「还没写实现」，是数据源本身不存在。
 * 契约允许这一档（budget-model.ts 的 { known: false, reason: 'unsupported' }），且读预算永不失败：
 * 恒回 ok:true。模块预算口径仍按「只计请求」声明（index.ts 的 budget 字段），那是记账口径，
 * 与这里「水位读不出来」是两件事。
 *
 * 将来怎么承接：tea 哪天透出速率响应头（或 Gitea 出账号配额端点），在这里加一趟读、把三个分支
 * 补齐（requests-only 的 remaining/limit/resetAt）；改完把登记数据与文档表里的依据一起改——
 * 三处同步的规矩见 docs/tracker/capability-gitea.md 的交接段。
 */

import type { OpContext } from '../../contract/contexts.js'
import type { BudgetResult } from '../../contract/results.js'

/**
 * 读预算水位（契约 readBudget）：Gitea 无账号级配额端点、tea 不透出速率响应头，恒回
 * { known: false, reason: 'unsupported' }——如实说「没有量」，不猜一个数。
 */
export async function readBudget(_ctx: OpContext | null | undefined): Promise<BudgetResult> {
  return { ok: true, data: { known: false, reason: 'unsupported' } }
}
