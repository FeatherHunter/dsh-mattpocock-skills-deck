/**
 * backends/markdown/normalize.js — 本地解析结果 → 契约形状。
 *
 * ⌈ 骨架占位 ⌉ #115 实现；当前直接转发 parse。本地无 labels，按契约省略该字段。
 */
import { parseMd } from './parse.js'

export function normalizeIssue(text, meta) {
  return parseMd(text, meta)
}
export default normalizeIssue
