// src/shared/deck-tools/workspace-file.js —— 工作区配置文件的兼容垫片（#1012 切核）
//
// 住共享层：探测（host 直接引用）与工具壳（shared，经接线注入）共用同一套解析，
// 不各写一份。真正的读写实现住核里（src/shared/config-store/workspace.js），
// 这里只做新老名字的翻译，不重写规则。
// 同层引用核是门禁基线里记名的一条例外（理由与归属见 tests/same-layer-baseline.json）：
// 垫片不调核就得另写一份 YAML 解析，那就真成两套实现，违背 #1012 的首要交付。
// 本文件只做字符串：不碰 fs / 平台 / 注册表；读文件与「后端认不认得」由调用方做。
// 只认人亲手选的：历史上 source 不是 'user' 的一律不认（派生结论不许钉成意图，
// 与选择记忆 H 同一条铁律）；切核后新增 migrated（迁移来的）与 detected（生成来的），
// auto 只在读老文件时认（历史文件里有），新文件不再产出。
import {
  parseWorkspaceText,
  stringifyWorkspace,
  WORKSPACE_YAML_REL,
  WORKSPACE_JSON_REL,
  WORKSPACE_KNOWN_VERSION,
} from '../config-store/workspace.js'

export const WORKSPACE_FILE_REL = WORKSPACE_YAML_REL
/** 老文件位置：只做兼容读（读到就由调用方的迁移逻辑搬走），新写入一律走新路径。 */
export const WORKSPACE_FILE_LEGACY_REL = WORKSPACE_JSON_REL
export const WORKSPACE_FILE_VERSION = WORKSPACE_KNOWN_VERSION
export const WORKSPACE_FILE_SOURCE = 'user'
/** 读老文件时照认（历史文件里有）；新文件不再产出 auto（机器的猜不许钉成意图）。 */
export const WORKSPACE_FILE_SOURCE_AUTO = 'auto'

function finiteNumber(v) { return (typeof v === 'number' && Number.isFinite(v)) }

// 工作区文件文本 → 人选后端候选。形状不对一律 null（调用方按「没有这层」继续往下走，不报错）。
// 老 JSON（v1 四字段）与新 YAML（v2）都认：JSON 是 YAML 的子集，直接可读。
// 版本高于认识的也按 null 回（旧版本读不懂新字段，只能当没有这层，往声明与记忆回落；
// 要读新内容请调核，核会标只读）。
// 已知性（注册表认不认得这个 id）不在这里判：调用方手里有注册表，各自按既有形状核验。
export function parseWorkspaceFile(text) {
  let parsed = null
  try {
    parsed = parseWorkspaceText(text)
  } catch (e) { return null }
  if (!parsed || parsed.ok !== true || parsed.readonly === true) return null
  const v = parsed.value || {}
  const backendId = (typeof v.backendId === 'string') ? v.backendId.trim() : ''
  if (!backendId) return null
  if (!finiteNumber(v.pickedAt)) return null
  const out = { backendId: backendId, pickedAt: v.pickedAt, source: v.source }
  if (typeof v.layout === 'string' && v.layout) out.layout = v.layout
  return out
}

// 人选 → 落盘文本（一律新格式 v2 YAML，注释由程序生成）。
// 只装：版本、后端、档案时间、来源、有布局才加布局；不装路径、令牌、登录态。
// version 缺席默认当前版；pickedAt 缺席沿旧例默认 0；source 缺席默认人选。
// 写不出（形状不对、高版本）直接抛错，由调用方的 try 接住并如实回报，不静默。
export function stringifyWorkspaceFile(input) {
  const src = (input && typeof input === 'object') ? input : {}
  const made = stringifyWorkspace({
    version: (src.version === undefined || src.version === null) ? WORKSPACE_KNOWN_VERSION : src.version,
    backendId: (typeof src.backendId === 'string') ? src.backendId.trim() : src.backendId,
    pickedAt: finiteNumber(src.pickedAt) ? src.pickedAt : 0,
    source: (src.source === undefined || src.source === null) ? WORKSPACE_FILE_SOURCE : src.source,
    layout: src.layout,
  })
  if (!made.ok) throw new Error(made.message)
  return made.text
}
