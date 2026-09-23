/**
 * backends/gitlab/create-write.js — 建票那一次调用到底怎么发（#722）。
 *
 * 这个文件只做一件事：**把「建一张票」这件事收敛成一条写路径**，并保证一次调用里
 * 「会被远端收到的写请求」最多只有一次。
 *
 * 原来的写法（2026-09 之前）在一次 create 里先发 PUT 到集合端点、拿不到票面再回落发一次 POST。
 * 对远端来说这是两次都可能写成功的请求：第一次其实建成了、只是回包没拿到（超时、EOF、回包形状不对），
 * 回落那条就会再建一张，而两次调用都回成功。用假远端把这条路取出来看过：一次调用发出 PUT 与 POST 两条写请求，
 * 假远端上多出两张票，调用却回 ok 与后建那一张的 key —— 界面上完全看不出多了一张票。
 * 修法是把两条路收敛成**一条**：POST 到集合端点，参数逐项 -f。再也没有「先试 A、失败再试 B」。
 *
 * 唯一允许再发一次的档只有一种：**这一次请求确定一个字节都没发出去**（这台机器上 glab 根本没跑起来，
 * 例如命令找不到、起进程就失败）。判据不在这个文件里，在纯函数 refresh-core/src/create-write.ts
 * （产物 src/shared/refresh/create-write.js）：那是三个后端将来共用的一处判据，能被穷举测一遍。
 * 超时、EOF、5xx、回包形状不对一律属于「有可能已经写出去」，绝不再发第二次写 —— 只如实失败，
 * 并在那句话里带上幂等键，让调用方带同一个键重试（重试会先按票面上的锚回查，找到就复用那张票）。
 *
 * 与 #711 幂等锚的关系：回查与锚的写入仍在 issues.js 里，一个字没动；本文件只管「这一次写怎么发」。
 * 所以带键的第二次调用根本走不到这里 —— 它在回查那一步就命中并复用了。
 */

import { ERROR_KIND } from '../../../../shared/tracker/constants.js'
import { glabClient } from './client.js'
import { projectPath } from './queries.js'
import { classifyCreateWriteAttempt, decideCreateWriteRetry } from '../../../../shared/refresh/create-write.js'

/** 建票写请求的超时（沿既有值）。 */
const CREATE_TIMEOUT_MS = 8000

/**
 * 建票唯一一条写路径的 argv。参数拼法与改动前那条回落路一模一样（title / description / labels 逐项 -f），
 * 所以网关、脱敏与日志里看到的形状不变，变的只是「不再有另一条路」。
 *
 * @param {string} refId 目标仓库（形如 group/project）
 * @param {{title: string, description?: string, labels?: string}} body
 * @returns {string[]}
 */
export function createIssueArgs(refId, body) {
  const args = ['api', `${projectPath(refId)}/issues`, '--method', 'POST', '-f', `title=${body.title}`]
  if (body.description) args.push('-f', `description=${body.description}`)
  if (body.labels) args.push('-f', `labels=${body.labels}`)
  return args
}

/**
 * 建票：一次调用最多发两次请求，但**会被远端收到的写最多只有一次**。
 *
 * 两次的情形只可能是「第一次确定没发出去」（判据见纯函数），第二次用的是**同一条 argv**：
 * 不换路、不改参数、不退回到另一种写法。
 *
 * @param {object} opCtx 本次调用的上下文（glabClient 吃这个 ctx）
 * @param {string} refId 目标仓库
 * @param {{title: string, description?: string, labels?: string}} body
 * @returns {Promise<{verdict: object, argvs: string[][]}>} verdict 是纯函数给的判据结果
 */
export async function writeNewIssue(opCtx, refId, body) {
  const argv = createIssueArgs(refId, body)
  const client = glabClient(opCtx)
  const argvs = []

  const first = await client.run(argv, { timeout: CREATE_TIMEOUT_MS })
  argvs.push(argv.slice())
  let verdict = classifyCreateWriteAttempt(first)

  const decision = decideCreateWriteRetry(verdict.verdict, argvs.length)
  if (decision.retry) {
    const again = await client.run(argv, { timeout: CREATE_TIMEOUT_MS })
    argvs.push(argv.slice())
    verdict = classifyCreateWriteAttempt(again)
  }

  return { verdict, argvs }
}

/** 没建出票时的错误分类：判据档位直接对应既有档位（不拿回包原文去猜档位）。 */
export function createWriteFailureKind(judgement) {
  const verdict = judgement && judgement.verdict ? judgement.verdict : 'maybe-written'
  if (verdict === 'never-sent') return ERROR_KIND.ENV
  if (verdict === 'endpoint-absent') return ERROR_KIND.NOTFOUND
  return ERROR_KIND.NETWORK
}

/**
 * 没建出票时给调用方看的那句话。写这句话的规矩（#722）：把「这一次发了几次写请求、票可能已经建出来
 * 没有、接下来该怎么办」三件事说全，不糊过去。
 *
 * @param {object} judgement 纯函数给的判据结果
 * @param {string} idempotencyKey 本次调用带的幂等键（没带就是空串）
 * @param {string[][]} argvs 这个调用发出去的建票请求（每一条的 argv）
 */
export function createWriteFailureMessage(judgement, idempotencyKey, argvs) {
  const key = String(idempotencyKey || '')
  const sent = Array.isArray(argvs) ? argvs.length : 0
  const reason = judgement && judgement.reason ? judgement.reason : '原因不明'
  if (judgement && judgement.verdict === 'never-sent') {
    return '建票没发出去：' + reason + '。这个调用一共试了 ' + sent + ' 次，两次都没有把请求送出去，远端不会有这张票；请先修好 glab 再重试。'
  }
  if (judgement && judgement.verdict === 'endpoint-absent') {
    return '建票没能做成：' + reason + '。这个调用只发了 1 次建票写请求，没有拿到票也不会再发第二次；请先核对仓库路径与 glab 版本，再重试。'
  }
  const advice = key
    ? '请带同一个幂等键（' + key + '）重试：重试会先按票面上的锚回查，找到就复用那张票、不会重复建。'
    : '这次调用没带幂等键，重试之前请先给一个（input.idempotencyKey），否则可能再建一张重复的票。'
  return '建票没有拿到确定的结果：' + reason + '。这个调用只发了 1 次建票写请求，它有可能已经把票建出来了 —— 本间房不会再发第二次写，免得远端多出一张重复的票。' + advice
}

export default { createIssueArgs, writeNewIssue, createWriteFailureKind, createWriteFailureMessage }
