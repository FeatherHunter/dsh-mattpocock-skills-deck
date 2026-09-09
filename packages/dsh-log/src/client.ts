// packages/dsh-log/src/client.ts —— 日志包的客户端入口（dsh-log/client，#558 Q4 双入口之一）。
//
// 本票（宿主引擎 #559）只实现宿主侧；客户端引擎的完整实现另有票 #560。
// 本入口先提供两样不变的字面，供客户端引擎票直接引用：
// 1. 电话名拼法（与宿主入口同一套：前缀加点加动作名，默认前缀 wf 下与现状一字不差）。
// 2. 批量转发口径数字（每批 50 条、每 1000 毫秒、单包约 128KB 或队列 100 条先到先截）。
// 文本拼接消费方式（本仓现有构建做法）只走本入口的声明体文本，不走宿主入口。

import {
  buildPhoneNames,
  CLIENT_BATCH_INTERVAL_MS,
  CLIENT_BATCH_MAX,
  CLIENT_PACKET_BYTES,
  CLIENT_QUEUE_MAX,
  type PhoneAction,
  type PhoneNameMap
} from './config.js'

export { buildPhoneName, buildPhoneNames } from './config.js'
export type { PhoneAction, PhoneNameMap } from './config.js'

export const CLIENT_BATCH = {
  maxPerBatch: CLIENT_BATCH_MAX,
  intervalMs: CLIENT_BATCH_INTERVAL_MS,
  packetBytes: CLIENT_PACKET_BYTES,
  queueMax: CLIENT_QUEUE_MAX
} as const

// 客户端转发与开关读写要调的 5 个电话名（与宿主注册名同一套拼法，调用方传入同一前缀）。
export function buildClientPhoneNames(prefix: string): PhoneNameMap {
  return buildPhoneNames(prefix)
}
