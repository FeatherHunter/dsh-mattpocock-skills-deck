// src/deck/tools/issue-create-failure.ts —— 建票失败回执（#1171）
//
// 为什么单独一份：后端诚实说「没建成」这一支要区别对待两种失败。锚回查没做成那一档，后端只陈述
// 事实（回查没做成、这次没建票），因为它不知道调用面上有没有退路；「接下来能做什么」只有工具这一层
// 知道，所以在这里补一句原样重试，并把为什么安全说清：自动锚在同一 5 分钟窗口里算出的还是同一个锚，
// 显式键更不消说；重试会先按锚回查，命中就复用那张票，不会多建一张。别的失败（权限、参数……）没有
// 这层保证，一个字都不多给。
//
// 搬出来还有一个现实原因：issue-create.ts 的有效行已经贴着文件粒度门禁的 350 行上限，这一段进不去。
import { DECK_STATUS, REFUSAL_REASONS } from '../shell/call-shell.js'
import type { TransportResult } from '../shell/backend-transport.js'
// 回查阶段的取值从契约的同一张表里取，不在这里另写一遍字面量：改名时编译器能顺着常量找到每一处。
import { TRACKER_ERROR_STAGE } from '../../tracker/contract/results.js'

/**
 * 把「后端诚实失败」这一支收成回执值：后端原话（截 300）、错误档与错误原文照抄，
 * 锚回查那一档再补原样重试的下一步；这次花掉的 1 次请求 4 点照记。
 *
 * @param created 契约 create 的返回值（成功与否按 `ok === true` 判；失败时看 error）
 * @param explicitKey 调用方有没有自带幂等键；有就说「同一个幂等键」，没有才说「同一个 5 分钟窗口」
 * @param notes 走到这一步已经攒下的提示，原样放进回执，不改顺序、不改内容
 */
export function backendCreateFailure(created: TransportResult, explicitKey: boolean, notes: string[]): { value: Record<string, unknown>; claimed: { requests: number; points: number } } {
  const err = created && created.error
  const msg = String((err && err.message) || '后端没给出原因').slice(0, 300)
  // 只有「回查没做成」这一档有确定可做的下一步；别的失败重试未必有用，不追加任何建议。
  const lookupFailed = !!err && err.stage === TRACKER_ERROR_STAGE.ANCHOR_LOOKUP
  const retryAdvice = lookupFailed
    ? ' 原样重试即可：重试带的是' + (explicitKey ? '同一个幂等键' : '同一个 5 分钟窗口内算出的同一个锚（标题和标签都别改）') + '，会先按它回查，命中就复用那张票，不会多建一张。'
    : ''
  return {
    value: { status: DECK_STATUS.UNSUPPORTED, reason: REFUSAL_REASONS.BACKEND_UNSUPPORTED, text: '这张票没建成（后端原话：' + msg + '）。' + retryAdvice, data: { error: { kind: String((err && err.kind) || ''), message: msg } }, notes: notes },
    claimed: { requests: 1, points: 4 },
  }
}
