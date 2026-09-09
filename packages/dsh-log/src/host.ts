// packages/dsh-log/src/host.ts —— 日志包的宿主入口（dsh-log/host，#558 Q4 双入口之一）。
//
// 3 步接入零配置可跑：装包、调用 createHostLog 并传入插件标识、用默认配置即跑。
// 当前插件传插件标识 wf，拼出的 5 个电话名与现状一字不差，落盘目录与开关文件名也不变。
// 第二个插件必须传自己的插件标识（目录默认派生为不同名字，不得共用同一目录）。
//
// 本入口只做三件事：建日志库、拼电话名、注册电话名（已注册再注册报错、不覆盖旧的）。
// 失败语义冻结（#558）：失败只计数不抛错，所有电话失败回成功为假的结构，不抛异常，
// 唯独记录电话的最外层例外原样保留（回成功加接收 0 条），不扩大。

import {
  buildPhoneNames,
  type HostLogConfigInput,
  type PhoneAction,
  type PhoneNameMap,
  type ResolvedHostLogConfig
} from './config.js'
import { createLogStore, type LogStore, type LogStoreDeps } from './store.js'

export { buildPhoneName, buildPhoneNames, resolveHostLogConfig } from './config.js'
export type { HostLogConfigInput, PhoneAction, PhoneNameMap, ResolvedHostLogConfig } from './config.js'
export {
  LOG_DEBOUNCE_MS,
  LOG_DIR_NAME,
  LOG_SWITCH_FILE,
  formatDailyFileName,
  formatLogFileName,
  createLogStore
} from './store.js'
export type { LogEntry, LogLevel, LogStore, LogStoreDeps } from './store.js'

export interface HostLog {
  store: LogStore
  phoneNames: PhoneNameMap
}

// 建宿主日志：一次调用得到一个独立实例（内存队列、累计丢弃数、开关状态各自独立，互不串）。
export function createHostLog(deps: LogStoreDeps, configInput: HostLogConfigInput): HostLog {
  const store = createLogStore(deps, configInput)
  const phoneNames = buildPhoneNames(store.config.prefix)
  return { store: store, phoneNames: phoneNames }
}

// 电话名注册表最小形状（宿主侧用内存表登记，调用方传入自己的表）。
export interface PhoneRegistry {
  has: (name: string) => boolean
  set: (name: string, handler: (args: never) => Promise<unknown>) => void
}

// 把 5 个电话名注册进表：该名字已被注册则报错、不覆盖旧的。
// 默认前缀 wf 只给当前插件用，第二个插件必须显式配自己的前缀后才能注册。
export function registerHostLogPhones(registry: PhoneRegistry, hostLog: HostLog): PhoneNameMap {
  const store = hostLog.store
  const handlers: Record<PhoneAction, (args: never) => Promise<unknown>> = {
    logBatch: (args) => store.handleLogBatch(args as { entries?: unknown }) as Promise<unknown>,
    logExport: (args) => store.handleLogExport(args as { date?: unknown }) as Promise<unknown>,
    logClear: (args) => store.handleLogClear(args as { date?: unknown }) as Promise<unknown>,
    logGetSwitch: () => store.handleLogGetSwitch() as Promise<unknown>,
    logSetSwitch: (args) => store.handleLogSetSwitch(args as { enabled?: unknown }) as Promise<unknown>
  }
  const actions: PhoneAction[] = ['logBatch', 'logExport', 'logClear', 'logGetSwitch', 'logSetSwitch']
  for (const action of actions) {
    const name = hostLog.phoneNames[action]
    if (registry.has(name)) {
      throw new Error('[dsh-log] 电话名已被注册，不覆盖旧的：' + name)
    }
    registry.set(name, handlers[action])
  }
  return hostLog.phoneNames
}
