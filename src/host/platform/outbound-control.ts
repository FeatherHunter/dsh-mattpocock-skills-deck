/**
 * src/host/platform/outbound-control.ts —— 出站控制面的宿主实现（房间要的那三样本事）
 *
 * ── 这个文件只做转发 ─────────────────────────────────────────────────────────
 * 名额闸在 `../outbound/admission.ts`、搭车账本在 `../refresh/chain-ride.ts`，本文件不复制它们的
 * 任何逻辑，只把两处已有的东西按契约形状 `OutboundControl`（`src/tracker/contract/outbound.ts`）
 * 包一层。为什么要包：房间不许 import 宿主模块，而宿主必须能把自己的能力交给房间 —— 中间这一层
 * 就是那道「只认形状、不认实现」的接缝。转发一字不差，所以宿主侧与既有门禁的行为不变。
 *
 * ── 为什么住在 platform/ 而不是 outbound/ ────────────────────────────────────
 * 宿主层有同层禁互引的纪律（`.dependency-cruiser.cjs` 的 `same-layer-import-host`：接线由装配文件
 * 负责，干活的文件之间不许互相引用），而 `src/host/platform/` 正是这条纪律**留出来的装配层**
 * （与 `deckToolsAssembly.js`、`refreshAssembly.js` 同类）：放在这里，它才能合法地同时读名额闸与
 * 搭车账本，而 `platformChannel.ts` 与 `refresh/wiring.js` 读它也不新增任何同层边。
 *
 * ── 注入点（两处都要挂） ─────────────────────────────────────────────────────
 *   · `src/host/platformChannel.ts` 的 `backendCtxForRooms`（平台通道那条路，快照与探测都走它）
 *   · `src/refresh/rooms/host/refresh-runtime.js` 的 `backendObj`（deck 工具那条路）
 * 两处都是「房间 create 时注入一次」的那份进程级上下文；缺一处，那条路上的房间会按环境失败返回
 * （有意为之：宁可大声报错，也不静默绕过名额闸）。
 */

import { getGhLane, isAdmissionCancelled } from '../outbound/admission.js'
import { getChainRide } from '../../refresh/rooms/host/chain-coalescing.js'
import type { OutboundControl } from '../../tracker/contract/outbound.js'

/**
 * 造一份出站控制面。每次调用都返回一个新对象，但它们背后是同一份进程级单例
 * （`getGhLane()` 与 `getChainRide()` 各自持有自己的状态），所以多处注入不会造成两套上限。
 */
export function createOutboundControl(): OutboundControl {
  return {
    acquire(req) {
      return getGhLane().acquire({ bucket: req.bucket, signal: req.signal })
    },
    isCancelled(err) {
      return isAdmissionCancelled(err)
    },
    noteWrite() {
      getChainRide({}).markWrite()
    },
  }
}
