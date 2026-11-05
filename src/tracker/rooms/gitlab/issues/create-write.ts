/**
 * src/tracker/rooms/gitlab/issues/create-write.ts —— 建票那一次调用到底怎么发（#722），
 * 随票的写路径搬进 issues/ 子树（#1913）。
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
 * 例如命令找不到、起进程就失败）。判据不在这个文件里，在纯函数 src/refresh/kernel/create-write-policy.ts
 * （产物 .build/refresh/kernel/create-write-policy.js）：那是三个后端将来共用的一处判据，能被穷举测一遍。
 * 超时、EOF、5xx、回包形状不对一律属于「有可能已经写出去」，绝不再发第二次写 —— 只如实失败，
 * 并在那句话里带上幂等键，让调用方带同一个键重试（重试会先按票面上的锚回查，找到就复用那张票）。
 *
 * 请求的形状也不在这个文件里：POST 的 method、路径与表单字段住在房间根目录 requests.ts 的
 * requestIssueCreate 一处；本文件只决定「发几次、怎么判」，不再自己拼 glab 参数。
 *
 * 与 #711 幂等锚的关系：回查与锚的写入在 issues/write.ts 与 issues/idempotency.ts 里，逻辑没有动；
 * 本文件只管「这一次写怎么发」。所以带键的第二次调用根本走不到这里 —— 它在回查那一步就命中并复用了。
 */

import { ERROR_KIND } from '../../../contract/vocabulary.js'
import type { ErrorKind } from '../../../contract/identity.js'
import type { BackendContext, OpContext } from '../../../contract/contexts.js'
import { requestIssueCreate } from '../requests.js'
import { classifyCreateWriteAttempt, decideCreateWriteRetry } from '../../../../refresh/kernel/create-write-policy.js'
import type {
  CreateWriteJudgement,
  CreateWriteVerdict,
} from '../../../../refresh/kernel/create-write-policy.js'
// 超时住中央 YAML，调时间改 config/timeouts.yaml。
import { GITLAB_READ_TIMEOUT_MS } from '../../../../shared/time-config/src/values.js'

/** 建票写请求的 body 形状只含三格，是因为这条单写路径历史上就只拼这三项，加别的会改掉网关看到的形状。 */
export interface CreateIssueBody {
  title: string
  description?: string
  labels?: string
}

// 一次建票调用的写轨迹：判据结果加这次实际发出请求的次数。
// 请求形状已经收进 requests.ts，argv 不再经过本文件；调用方报错时用次数说清「试了几次」。
export interface WriteNewIssueResult {
  verdict: CreateWriteJudgement
  attempts: number
}

/**
 * 建票：一次调用最多发两次请求，但**会被远端收到的写最多只有一次**。
 *
 * 两次的情形只可能是「第一次确定没发出去」（判据见纯函数），第二次用的是**同一条请求**：
 * 不换路、不改参数、不退回到另一种写法。请求函数按同一份 body 重新拼出来的 argv 与第一次逐字相同，
 * 差别只在超时预算重新开始。
 *
 * @param opCtx 本次调用的上下文（请求函数里的 glabClient 吃这个 ctx）
 * @param refId 目标仓库
 * @param body 建票表单（只含 title / description / labels）
 */
export async function writeNewIssue(
  opCtx: Partial<OpContext> & Partial<BackendContext>,
  refId: string,
  body: CreateIssueBody,
): Promise<WriteNewIssueResult> {
  let attempts = 1
  // 值实现来自构建产物 .js（无类型），判据形状以源码 .ts 的契约类型为准，这里只收敛类型不改逻辑。
  let verdict = classifyCreateWriteAttempt(
    await requestIssueCreate(opCtx, refId, body, GITLAB_READ_TIMEOUT_MS),
  ) as unknown as CreateWriteJudgement

  const decision = decideCreateWriteRetry(verdict.verdict, attempts)
  if (decision.retry) {
    attempts = 2
    verdict = classifyCreateWriteAttempt(
      await requestIssueCreate(opCtx, refId, body, GITLAB_READ_TIMEOUT_MS),
    ) as unknown as CreateWriteJudgement
  }

  return { verdict, attempts }
}

/** 没建出票时的错误分类：判据档位直接对应既有档位（不拿回包原文去猜档位）。 */
export function createWriteFailureKind(judgement: CreateWriteJudgement | null | undefined): ErrorKind {
  const verdict: CreateWriteVerdict =
    judgement && judgement.verdict ? judgement.verdict : 'maybe-written'
  if (verdict === 'never-sent') return ERROR_KIND.ENV as ErrorKind
  if (verdict === 'endpoint-absent') return ERROR_KIND.NOTFOUND as ErrorKind
  return ERROR_KIND.NETWORK as ErrorKind
}

/**
 * 没建出票时给调用方看的那句话。写这句话的规矩（#722）：把「这一次发了几次写请求、票可能已经建出来
 * 没有、接下来该怎么办」三件事说全，不糊过去。
 *
 * @param judgement 纯函数给的判据结果
 * @param idempotencyKey 本次调用带的幂等键（没带就是空串）
 * @param attempts 这个调用实际发出去几次建票请求（最多两次；请求形状不在这里，所以不再收 argv）
 */
export function createWriteFailureMessage(
  judgement: CreateWriteJudgement | null | undefined,
  idempotencyKey: string,
  attempts: number,
): string {
  const key = String(idempotencyKey || '')
  const sent = typeof attempts === 'number' && isFinite(attempts) ? attempts : 0
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

export default { writeNewIssue, createWriteFailureKind, createWriteFailureMessage }
