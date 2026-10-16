// src/deck/shell/in-flight-lease.ts —— 进程存活租约（#1157 落地；决策与实测见 docs/adr/20261014-process-liveness-lease.md）
// 用法：把一场还没结算的活圈进来 —— return withInFlightLease(() => Promise.race([真活, sleep(上限)]))
//
// 为什么要有它：Node 判断「这个进程可不可以退出」只看还有没有被引用的句柄，不看「还有没有活没干完」。
// 于是「到点提醒」与「还有活在跑」这两种完全不同的意思被挤在同一个开关上：#1114 把等待定时器一律
// unref（提醒不拥有存活，方向是对的），但一场还没结算的竞速里如果只剩下这一笔等待，进程会当场收摊，
// **退出码还是 0** —— 补全仓库标识、归一仓路径、等表装好、等写锁这几处的竞速都可能这样静默消失，
// 工具调用永远不结算，实机上看就是「选后端那一步没有下文」。
//
// 办法：谁有活在跑，谁显式拿一份租约。租约是一支懒创建、被引用的长延时定时器：计数从 0 变 1 时建，
// 回到 0 时清。并发一百场竞速也只有一支句柄，取得与释放都是 O(1)。
// 为什么不是「每场竞速各拿一支定时器」：句柄数会变成 O(并发)，而这件事只需要回答「有没有活」。
// 为什么不是轮询：存活是「有没有停在跑的活」这个事实，不需要周期性确认（ADR 第 3 节否掉的路）。
//
// 机制性代价（写在这里，免得后来人当疏忽）：Node 没有公开的「把事件循环重新引用起来」的接口，
// 只能靠一支真实句柄，所以本文件是这套方案里唯一碰全局定时器的地方。延时不超过 2147483647 毫秒
// ——超过这个数 Node 会把延时改成 1 毫秒并告警；它平时不到点，真到了也只是空转一次，不影响判定。
//
// 与时间压缩助手（tests/lib/time-compress.ts）的关系：句柄在每次取得时向全局 setInterval 现要，
// 不预先存进模块级常量，所以门禁把全局时钟换成虚拟时钟时租约跟着走虚拟时钟；助手的规矩是
// 「队列里还有被引用的等待，泵就必须是活的」，这一支就是那个被引用的等待。

// 超时住中央 YAML，调时间改 config/timeouts.yaml。
import { IN_FLIGHT_KEEP_ALIVE_MS } from '../../shared/time-config/values.js'

/** 保活句柄的延时（毫秒）：2147483647 是 Node 允许的最大值（约 24.8 天），再大就会被改成 1 毫秒并告警。 */

/** 此刻持有租约的场数。 */
let holders = 0
/** 那一支保活句柄；没有租约时是 null。 */
let keepAlive: ReturnType<typeof setInterval> | null = null
/** 累计建过几支保活句柄：探针用，「并发多场只建一支」这条判据只有它看得见。 */
let handlesOpened = 0

/** 空回调：这支定时器只为让事件循环保持被引用，不做任何事。 */
function noop(): void { /* 租约只需要句柄存在，不需要它做任何事 */ }

/** 取得一份租约：第一场进来时建句柄，后面进来的只加计数。 */
function acquire(): void {
  holders += 1
  if (holders !== 1 || keepAlive !== null) return
  try {
    keepAlive = setInterval(noop, IN_FLIGHT_KEEP_ALIVE_MS)
    handlesOpened += 1
  } catch (e) {
    // 建不出来（宿主把定时器收走了）就如实降级：活照跑，只是这一趟不再保证进程活到它结算。
    keepAlive = null
  }
}

/** 释放一份租约：计数回到 0 时清掉句柄，其余情况只减计数。 */
function release(): void {
  if (holders > 0) holders -= 1
  if (holders > 0) return
  holders = 0
  const handle = keepAlive
  keepAlive = null
  if (handle === null) return
  try { clearInterval(handle) } catch (e) { /* 句柄已经没了也算释放成功 */ }
}

/**
 * 把一场还没结算的活圈进租约：work 跑完（成功、抛错、同步抛都一样）之前，这一趟进程不许退出。
 * work 的返回值与异常原样交回，本函数只加一层存活保证，不改判定、不吞错。
 *
 * 本模块只导出这一个干活的口（加一个只读快照）：「跨函数持有」的用法今天一个都没有，
 * 五处调用点都是「这场活圈起来」的形状，所以不让 acquire / release 出去成对出现 —— 那对接口
 * 一导出就会有人漏放。真要出现跨函数的用法，再按那时的真形状加（票 #1157 的方案一节就是这么定的）。
 */
export function withInFlightLease<T>(work: () => Promise<T> | T): Promise<T> {
  acquire()
  let started: Promise<T>
  try {
    started = Promise.resolve(work())
  } catch (e) {
    release()
    return Promise.reject(e)
  }
  return started.then(
    function (value: T): T { release(); return value },
    function (err: unknown): never { release(); throw err },
  )
}

/** 租约现状（探针与门禁用）：几名持有者、句柄还在不在、累计建过几支。 */
export function inFlightLeaseSnapshot(): { holders: number; holding: boolean; handlesOpened: number } {
  return { holders: holders, holding: keepAlive !== null, handlesOpened: handlesOpened }
}
