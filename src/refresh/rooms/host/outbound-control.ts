/**
 * src/refresh/rooms/host/outbound-control.ts —— 出站控制面的宿主实现（房间要的那五样本事）
 *
 * ── 这个文件只做转发 ─────────────────────────────────────────────────────────
 * 名额闸（含 #1007 的通路失败冷却）在 `./outbound-admission.ts`、搭车账本在
 * `./chain-coalescing.ts`，本文件不复制它们的任何逻辑，只把两处已有的东西按契约形状
 * `OutboundControl`（`src/tracker/contract/outbound.ts`）包一层。为什么要包：房间不许 import 宿主模块，而宿主必须能把自己的能力交给房间 —— 中间这一层
 * 就是那道「只认形状、不认实现」的接缝。转发一字不差，所以宿主侧与既有门禁的行为不变。
 *
 * ── 为什么住在 rooms/host/ ───────────────────────────────────────────────────
 * 名额闸与搭车账本都在本房，同房引用不新增跨层边；装配时由平台通道与登记层的桥来读它，
 * 接线关系见下面「注入点」一节。
 *
 * ── 注入点（两处都要挂） ─────────────────────────────────────────────────────
 *   · `src/host/platformChannel.ts` 的 `backendCtxForRooms`（平台通道那条路，快照与探测都走它）
 *   · `src/refresh/registry/deck-tool-bridge.ts` 第 137 行（deck 工具那条路）
 * 两处都是「房间 create 时注入一次」的那份进程级上下文；缺一处，那条路上的房间会按环境失败返回
 * （有意为之：宁可大声报错，也不静默绕过名额闸）。
 */

import { getGhLane, isAdmissionCancelled } from './outbound-admission.js'
import { getChainRide } from './chain-coalescing.js'
import type { OutboundControl } from '../../../tracker/contract/outbound.js'

/**
 * 造一份出站控制面。每次调用都返回一个新对象，但它们背后是同一份进程级单例
 * （`getGhLane()` 与 `getChainRide()` 各自持有自己的状态），所以多处注入不会造成两套上限。
 */
export function createOutboundControl(): OutboundControl {
  return {
    acquire(req) {
      return getGhLane().acquire({ bucket: req.bucket, signal: req.signal, cmd: req.cmd })
    },
    isCancelled(err) {
      return isAdmissionCancelled(err)
    },
    noteWrite() {
      getChainRide({}).markWrite()
    },
    reportTransportFailure(failure) {
      getGhLane().reportTransportFailure({ bucket: failure.bucket, reason: failure.reason, cmd: failure.cmd })
    },
    reportSuccess(req) {
      getGhLane().reportSuccess({ bucket: req.bucket })
    },
  }
}
