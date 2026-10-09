// src/shared/deck-tools/workspace-file.js —— 工作区配置文件的纯半（#947 规格）
//
// 住共享层：探测（host 经注入无关，直接引用）与工具壳（shared，经接线注入）共用同一套解析，
// 不各写一份。调用方（host）引用本文件是允许的方向；shared 文件之间不互引，所以本文件零导入。
// 本文件只做字符串与 JSON：不碰 fs / 平台 / 注册表；读文件与「后端认不认得」由调用方做。
// 只认人亲手选的：source 不是 'user' 的一律不认（派生结论不许钉成意图，与选择记忆 H 同一条铁律）。
export const WORKSPACE_FILE_REL = 'docs/agents/workspace.json'
export const WORKSPACE_FILE_VERSION = 1
export const WORKSPACE_FILE_SOURCE = 'user'

function finiteNumber(v) { return (typeof v === 'number' && Number.isFinite(v)) }

// 工作区文件文本 → 人选后端候选。形状不对一律 null（调用方按「没有这层」继续往下走，不报错）。
// 已知性（注册表认不认得这个 id）不在这里判：调用方手里有注册表，各自按既有形状核验。
export function parseWorkspaceFile(text) {
  let obj = null
  try { obj = JSON.parse(String(text == null ? '' : text)) } catch (e) { return null }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null
  if (obj.version !== WORKSPACE_FILE_VERSION) return null
  const backendId = (typeof obj.backendId === 'string') ? obj.backendId.trim() : ''
  if (!backendId) return null
  if (obj.source !== WORKSPACE_FILE_SOURCE) return null
  if (!finiteNumber(obj.pickedAt)) return null
  return { backendId: backendId, pickedAt: obj.pickedAt, source: WORKSPACE_FILE_SOURCE }
}

// 人选 → 落盘文本。只装四项：版本、后端、档案时间、来源；不装路径、令牌、登录态。
export function stringifyWorkspaceFile(input) {
  const src = (input && typeof input === 'object') ? input : {}
  const backendId = (typeof src.backendId === 'string') ? src.backendId.trim() : ''
  const pickedAt = finiteNumber(src.pickedAt) ? src.pickedAt : 0
  return JSON.stringify({ version: WORKSPACE_FILE_VERSION, backendId: backendId, pickedAt: pickedAt, source: WORKSPACE_FILE_SOURCE }, null, 2) + '\n'
}
