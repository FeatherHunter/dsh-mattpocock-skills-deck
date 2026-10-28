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
 * ── 注入点（三处都要挂） ─────────────────────────────────────────────────────
 *   · `src/host/platformChannel.ts` 的 `backendCtxForRooms`（平台通道那条路，快照与探测都走它）
 *   · `src/refresh/registry/deck-tool-bridge.ts` 的 backendObj（deck 工具那条路）
 *   · `src/refresh/rooms/host/refresh-runtime.ts` 的 backendObj（刷新后台开会话那条路）
 * 三处都是「房间 create 时注入一次」的那份进程级上下文；缺一处，那条路上的房间会按环境失败返回
 * （有意为之：宁可大声报错，也不静默绕过名额闸）。
 *
 * ── 日志上下文必须显式传（#1224） ───────────────────────────────────────────
 * 准入闸的三条日志（gh.lane.wait / gh.lane.saturated / gh.transport）只在闸拿到日志上下文时才落盘。
 * 2026-10-24 #1453 删掉最后一个 runGh 生产调用点之后，唯一传上下文的那条路只剩死函数，生产里三条
 * 日志全部静默（#1224 测量时发现）。所以这里把 logCtx 收成显式参数：调用方注入这份控制面时把
 * 自己的 logCtx 带进来，闸在第一次 getGhLane(logCtx) 时接上；新增注入点不许漏传。
 */

import { getGhLane, isAdmissionCancelled } from './outbound-admission.js'
import { getChainRide } from './chain-coalescing.js'
import type { OutboundControl } from '../../../tracker/contract/outbound.js'

/**
 * 造一份出站控制面。每次调用都返回一个新对象，但它们背后是同一份进程级单例
 * （`getGhLane()` 与 `getChainRide()` 各自持有自己的状态），所以多处注入不会造成两套上限。
 */
export function createOutboundControl(logCtx?: Parameters<typeof getGhLane>[0]): OutboundControl {
  return {
    acquire(req) {
      return getGhLane(logCtx).acquire({ bucket: req.bucket, signal: req.signal, cmd: req.cmd, service: req.service, waitMs: req.waitMs })
    },
    isCancelled(err) {
      return isAdmissionCancelled(err)
    },
    noteWrite() {
      getChainRide({}).markWrite()
    },
    reportTransportFailure(failure) {
      getGhLane(logCtx).reportTransportFailure({ bucket: failure.bucket, reason: failure.reason, cmd: failure.cmd, service: failure.service })
    },
    reportSuccess(req) {
      getGhLane(logCtx).reportSuccess({ bucket: req.bucket, service: req.service })
    },
  }
}
