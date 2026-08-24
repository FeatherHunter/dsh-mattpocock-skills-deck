/**
 * backends/gitlab/errors.js — glab/API 错误 → 契约 ERROR_KIND。
 *
 * 按 #144 §六：透传 KIND_VALUES + 按 glab 文案补（ENV/AUTH/RATELIMIT/NOTFOUND等），兜底 NETWORK。
 */

import { ERROR_KIND } from '../../../../shared/tracker/constants.js'
import { classifyError as baseClassify } from '../../preflight.js'

const KIND_VALUES = new Set(Object.values(ERROR_KIND))

export function classifyGlabError(err) {
  if (err && KIND_VALUES.has(err.kind)) return err.kind
  if (err && err.error && KIND_VALUES.has(err.error.kind)) return err.error.kind

  const msg = (err && typeof err === 'object')
    ? (err.message || err.stderr || err.stdout || (err.error && err.error.message) || '')
    : err
  const s = String(msg || '').toLowerCase()

  // glab 特有文案优先（#143 §二 glab能力结论）
  if (/glab:\s*command not found|which:\s*no glab|enoent.*glab|glab not found/i.test(s)) return ERROR_KIND.ENV
  if (/\bnot logged in\b|\bno token\b|\bhost not found\b|\b401\b|\b403\b.*blocked/i.test(s)) return ERROR_KIND.AUTH
  if (/\bnot (logged )?in\b|\bauth\b|\b401\b|\b403\b|credential|unauthorized|permission denied/i.test(s)) return ERROR_KIND.AUTH
  if (/\brate ?limit\b|\b429\b/i.test(s)) return ERROR_KIND.RATELIMIT
  if (/is not recognized|\bcommand not found\b|\bno such file\b|cannot find|not found in path|which:|enoent/i.test(s)) return ERROR_KIND.ENV
  if (/not ?found|\b404\b/.test(s)) return ERROR_KIND.NOTFOUND
  if (/unsupported|not supported|not implemented/i.test(s)) return ERROR_KIND.UNSUPPORTED
  if (/parse|invalid json|syntax/i.test(s)) return ERROR_KIND.PARSE
  if (/network|timed ?out|econn|eai_again|offline|timeout|fetch failed|enotfound/i.test(s)) return ERROR_KIND.NETWORK
  // GraphQL errors[] 上层已提 message，此处兜底
  return baseClassify(err)
}

export default classifyGlabError
