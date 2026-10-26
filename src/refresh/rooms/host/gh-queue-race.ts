/**
 * src/refresh/rooms/host/gh-queue-race.ts —— gh 出站「排队拿名额」与「本档到点」赛跑（#1007 评论四）。
 *
 * 为什么单独一个文件：宿主 runGh 那条路原先直接 await 拿名额，名额被慢调用占满时，
 * 面板调用会把整段分档预算花在排队上，最后却以「命令超时」返回，命令一次都没执行（#1101 实测：
 * 64 个名额全满、排队中位数 35 位、最长 338 位）。这里只做三件事：
 *   ① 把拿名额与到点放在一起赛跑；
 *   ② 排队到点立刻中止排队，并保证晚一步回来的名额一定被归还（#1007 复核指出的泄漏就住在这里）；
 *   ③ 排队最多等多久由中央时间参数决定：本档预算与 ghQueueWaitTimeoutMs 取更小的那个。
 *
 * 为什么有 ③：名额满时不该把整档预算（读 12 秒 / 写 30 秒）全花在排队上。这个上限的来由与取值
 * 写在 config/timeouts.yaml 的 ghQueueWaitTimeoutMs 键旁边；这里只说它会参与「取更小」的计算，
 * 数字本身不在代码里再写一遍。
 *
 * 为什么不写在 gh-execution.ts 里：那个文件已经贴着单文件 350 有效行的上限（#1017），
 * 而这段机械逻辑与 gh 命令本身的执行无关，拆出来能独立读、独立测。
 *
 * #1392 的边界：实例销毁之后，宿主给的计时器服务会在建表这一步同步抛 INACTIVE_EFFECT（别的错也可能同步抛）。
 * 这里单独接住建表异常，退化成「只等名额、不赛跑」；调用方随后照旧起进程，由 startWaitTimeout 统一收尾
 * （终止子进程、归还名额、按错误类别返回 disposed 或原样抛出）。代价是这一趟排队不再有上限，
 * 但实例已经销毁，这一趟活不到排队结束。
 */
import { GH_QUEUE_WAIT_TIMEOUT_MS } from '../../../shared/time-config/src/values.js'

/** 「排队拿名额」与「到点」赛跑之后的那一个结果：拿到名额时 release 是归还函数；
 *  冷却/取消等失败时 failed 是拒绝原因；timedOut 表示排队到点（命令一次没跑）；disposed 表示运行实例已销毁。 */
export interface GhQueueRace {
  release: (() => void) | null
  failed: unknown
  timedOut: boolean
  disposed: boolean
}

/** 只取这里用得到的两样本事：计时器与准入闸。形状写窄，方便测试注入假件。 */
interface GhQueueTimerLike { timeout(ms: number): Promise<unknown> }
interface GhQueueLaneLike { acquire(args: { bucket: string; signal?: AbortSignal | undefined; cmd?: string }): Promise<(() => void)> }

/** 赛跑参数：调用方给同一只桶、同一个短标签与同一份时间预算。 */
interface GhQueueRaceOpts {
  lane: GhQueueLaneLike
  timer: GhQueueTimerLike
  timeoutMs: number
  bucket: string
  cmd: string
  signal: AbortSignal | undefined
}

/**
 * 排队上限：本档超时与中央配置里的排队上限取更小的那个。
 * 为什么在排队这一侧再夹一次：本档预算可能比排队上限还短（例如探活档 15 秒、测试里给 150 毫秒），
 * 那时排队自然只等到本档超时；取更小的那个能让两种情况共用同一只表，不出现「排队比整档还久」。
 */
export function queueTimeoutForTier(tierTimeoutMs: number): number {
  return Math.min(tierTimeoutMs, GH_QUEUE_WAIT_TIMEOUT_MS)
}

/** 赛跑句柄：调用方 await result 判结局；放弃这一笔时调 abandon，由它负责中止排队与归还迟到名额。 */
export interface GhQueueRaceHandle {
  result: Promise<GhQueueRace>
  abandon(ctrl: AbortController | null): void
}

/**
 * 开始赛跑。返回的 result 一定以 GhQueueRace 落定，不会因为计时器建不出来而抛。
 * 调用方要自己区分 timedOut / disposed / failed 三种结局：分别对应「排队到点」「实例销毁」「拿名额失败」。
 */
export function raceGhQueue(opts: GhQueueRaceOpts): GhQueueRaceHandle {
  const o = opts
  // 这两个旗子只为一件事：计时器先赢之后，acquire 仍可能晚一步带回一个名额；
  // 那个名额没有人会去用（result 已以 timedOut/disposed 落定），不在这里当场归还就永久漏掉。
  let timerWon = false
  let abandoned = false
  let timerPromise: Promise<GhQueueRace> | null = null
  try {
    timerPromise = o.timer.timeout(o.timeoutMs).then(
      function (): GhQueueRace { timerWon = true; return { release: null, failed: null, timedOut: true, disposed: false } },
      function (): GhQueueRace { timerWon = true; return { release: null, failed: null, timedOut: false, disposed: true } },
    )
  } catch (eSetup) { timerPromise = null }
  // 拿名额这一支两条都已接住：放行给 release，拒绝给 failed；冷却错误由调用方用 outboundCooldownOf 认。
  const acquired: Promise<GhQueueRace> = o.lane.acquire({ bucket: o.bucket, signal: o.signal, cmd: o.cmd }).then(
    function (rel: () => void): GhQueueRace {
      // 计时器先赢、或调用方已经放弃：这个名额没人会用，交回给准入桶，不能让它漏掉。
      if (timerWon || abandoned) {
        try { rel() } catch (eRelease) {}
        return { release: null, failed: null, timedOut: false, disposed: false }
      }
      return { release: rel, failed: null, timedOut: false, disposed: false }
    },
    function (e: unknown): GhQueueRace { return { release: null, failed: e, timedOut: false, disposed: false } },
  )
  // 计时器建不出来：只等名额（#1392 的老路，由调用方后面那一步负责收尾）。
  const result: Promise<GhQueueRace> = timerPromise ? Promise.race([acquired, timerPromise]) : acquired
  return {
    result: result,
    abandon: function (ctrl: AbortController | null): void {
      abandoned = true
      if (ctrl) { try { ctrl.abort() } catch (eAbort) {} }
    },
  }
}
