/**
 * config-store-core/src/ports.ts —— 配置读写核的插口形状（#1012）
 *
 * 只装类型与模块标识，不装任何运行时逻辑。核只管做决定（解析、校验、拼装文本），
 * 跑腿的活（读文件、写文件、删老文件、拿用户主目录）全在外面的宿主适配器
 *（src/host/configStore.js）。形态照 label-color-core/src/ports.ts：类型走
 * `import type`，转译后不留引用，产物自包含。
 */

export const PORTS_SOURCE = 'config-store-core/src/ports.ts'

/** 核认识的三种文件：工作区后端配置、本机全局设置、标签配色数据。 */
export type SchemaId = 'workspace' | 'settings' | 'label-colors'

/** 解析失败的档位：每一档都有固定含义，调用方按档位给用户不同的说法。 */
export type ParseFailReason =
  | 'oversize'
  | 'aliases'
  | 'yaml-error'
  | 'bad-shape'
  | 'unknown-keys'

/** 解析成功。readonly 为真表示文件版本比核认识的新：可以读来展示，不许写回去。 */
export interface ConfigParseOk {
  ok: true
  value: Record<string, unknown>
  readonly: boolean
  warnings: string[]
}

/** 解析失败。不崩：任何输入（超大、炸弹、坏形状）都落到这一档。 */
export interface ConfigParseFail {
  ok: false
  reason: ParseFailReason
  message: string
  keys?: string[]
}

export type ConfigParseResult = ConfigParseOk | ConfigParseFail

/** 拼装失败的档位。version-newer 必须带明确回执：告诉用户现在认到第几版。 */
export type StringifyFailReason = 'version-newer' | 'unknown-keys' | 'bad-shape'

export interface ConfigStringifyOk {
  ok: true
  text: string
}

export interface ConfigStringifyFail {
  ok: false
  reason: StringifyFailReason
  message: string
  keys?: string[]
}

export type ConfigStringifyResult = ConfigStringifyOk | ConfigStringifyFail
