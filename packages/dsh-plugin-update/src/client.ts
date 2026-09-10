// packages/dsh-plugin-update/src/client.ts —— 更新包的客户端入口（#581 双入口之一）。
//
// 面板界面不进包：配置面板里的弹窗、轮询调度、重启提示仍活在各插件自己的面板代码里，
// 本入口只装调用电话所需的最小形状（电话名拼法、轮询时间口径、手工兜底命令形状），
// 供面板代码照着拼电话名与控制轮询间隔。
//
// 两种消费方式（文档细节见包内集成文档第 3 节第 3 步）：
// 1. 构建期派生（本仓当前插件走的就是这条，已被真实消费方验证）：构建时把本入口打包一次，
//    把消费方自己的前缀代进去，在消费方仓库里生成一个小文件，里面是三个电话名与轮询间隔的常量，
//    面板直接引用这些常量，源码里不出现电话名字面量与写死的间隔。
// 2. 文本拼接：取本入口编译后对应函数的声明体、去行首 export 后拼进插件主文件闭包。
//    这条至今没有真实消费方用过（本仓当前插件也不走它），要用请先补一次真实验证。
//
// 无论哪条路，取值都从下面三样来，不另起字面：电话名拼法走 buildPhoneNames（与宿主入口同一套，
// 前缀加点加动作名，默认前缀 wf 下与现状一字不差）；轮询口径走 CLIENT_POLL 常量
// （默认 1 秒、下限 250 毫秒，规格 #591 第 5 条）；手工兜底命令走 manualCommand
// （与配方同一套政策，精确版本、官方源、--save-exact，规格 #591 第 12 条冻结形状）。
//
// 未新增日志事件：本文件不发日志，三个旧事件的标识字段由宿主入口发出。

import { buildPhoneNames, DEFAULT_PANEL_POLL_MS, MIN_PANEL_POLL_MS, type PhoneAction } from './config.js'
import { manualCommand } from './commands.js'

export { buildPhoneName, buildPhoneNames } from './config.js'
export type { PhoneAction } from './config.js'
export { manualCommand } from './commands.js'

export const CLIENT_POLL = {
  defaultMs: DEFAULT_PANEL_POLL_MS,
  minMs: MIN_PANEL_POLL_MS,
} as const

// 客户端调用三个电话要用的电话名（与宿主注册名同一套拼法，调用方传入同一前缀）。
export function buildClientPhoneNames(prefix: string): Record<PhoneAction, string> {
  return buildPhoneNames(prefix)
}

// 面板轮询间隔校验（规格 #591 第 5 条）：不得小于 250 毫秒防止忙循环；越界直接抛错。
export function assertPollInterval(ms: unknown): number {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < MIN_PANEL_POLL_MS) {
    throw new Error('[dsh-plugin-update] 面板轮询间隔非法：不得小于 250 毫秒（收到 ' + JSON.stringify(ms) + '）')
  }
  return ms
}
