/**
 * src/deck/shell/text-write-verify.ts —— 写正文之后「读回并核对」的一整段（#1091 从 issue-patch 抽出）
 *
 * 为什么单独一份：issue-patch.ts 在加维护者原话参数后有效行越过了 350 的上限
 * （tests/verify-file-granularity.ts 判红）。这里把「读回 + 记账」整段搬出来：
 * 调 tracker 读回与超时判据仍然由调用方递进来（那是工具与后端之间的边界），
 * 读回来以后怎么比对、怎么记成 item 住在这份文件里。
 *
 * 纯计算加一次「读回」调用：不碰 ctx、不读写盘、不读钟。
 */
import { must, timeoutMessage } from './backend-transport.js'
import { bodyWriteFields, bodyWriteReadbackProblem } from './body-write.js'
import type { BodyWritePlan } from './body-write.js'
import { evidenceFields, failureOf } from './receipt-reason.js'

/**
 * 把一次正文写入的读回结果记成 item：
 *   · 额度不够读回、读回失败、读回来对不上，都记 failed 并说清「别当成已经写好」；
 *   · 全对才记 ok，fields 写上这次点了哪几区（模型按它看得懂核对过什么）。
 * 每条失败都带证据：code 必有；本地这一环的失败另带 local，后端原样回来的另带 errorKind/stage。
 * 顶层 reason 就从这些码里挑（#1799），所以这里不能只写一句人话。
 */
export function textWriteVerifyItem(arg: { key: string; plan: BodyWritePlan; body: string | null; failure: string; outOfBudget: boolean; evidence?: Record<string, string> }): Record<string, unknown> {
  const failedItem = (reason: string, ev: Record<string, string>) => Object.assign({ key: arg.key, step: 'text', status: 'failed', reason: reason }, ev)
  const evidence = (ev: ReturnType<typeof failureOf>) => evidenceFields(ev, 'errorKind')
  if (arg.outOfBudget) return failedItem('正文写动作回了成功，但剩余额度不够读回核对：别当成已经写好，稍后读一次现状确认。', evidence(failureOf(null, 'write', 'budget')))
  if (arg.failure) return failedItem(arg.failure, arg.evidence || evidence(failureOf(null, 'write', 'unconfirmed')))
  if (arg.body === null) return failedItem('正文写动作回了成功，但写后没读回正文：写进去的对不对不知道，别当成已经写好。', evidence(failureOf(null, 'read', 'unconfirmed')))
  const problem = bodyWriteReadbackProblem(arg.plan, arg.body)
  if (problem) return failedItem(problem, evidence(failureOf(null, 'write', 'verify')))
  const item: Record<string, unknown> = { key: arg.key, step: 'text', status: 'ok', fields: bodyWriteFields(arg.plan) }
  if (arg.plan.progress) item.progress = arg.plan.progress
  if (arg.plan.originalWords) item.originalWords = arg.plan.originalWords
  return item
}

/**
 * 读回一次正文并核对：read 由调用方给（它知道怎么调后端）。
 * 超时、后端没回正文、比对不上都记 failed；任何一支都提醒「别当成已经写好」。
 */
export async function textWriteVerify(arg: { key: string; plan: BodyWritePlan; outOfBudget: boolean; read: () => Promise<unknown> }): Promise<Record<string, unknown>> {
  if (arg.outOfBudget) return textWriteVerifyItem({ key: arg.key, plan: arg.plan, body: null, failure: '', outOfBudget: true })
  const rawBack = await arg.read()
  const backTimeout = timeoutMessage(rawBack as never)
  if (backTimeout) return textWriteVerifyItem({ key: arg.key, plan: arg.plan, body: null, failure: '正文写动作回了成功，但读回核对超时（' + String(backTimeout).slice(0, 160) + '）：别当成已经写好，稍后读一次现状确认。', outOfBudget: false, evidence: evidenceFields(failureOf({ kind: 'timeout' }, 'read'), 'errorKind') })
  const back = must(rawBack) as { ok?: boolean; data?: { body?: unknown }; error?: { message?: unknown } } | null | undefined
  const body = (back && back.ok === true && back.data && typeof back.data.body === 'string') ? back.data.body : null
  if (body === null) return textWriteVerifyItem({ key: arg.key, plan: arg.plan, body: null, failure: '正文写动作回了成功，但写后没读回正文（后端原话：' + String((back && back.error && back.error.message) || '没给出原因').slice(0, 160) + '）：写进去的对不对不知道，别当成已经写好。', outOfBudget: false, evidence: evidenceFields(failureOf(null, 'read', 'unconfirmed'), 'errorKind') })
  return textWriteVerifyItem({ key: arg.key, plan: arg.plan, body: body, failure: '', outOfBudget: false })
}
