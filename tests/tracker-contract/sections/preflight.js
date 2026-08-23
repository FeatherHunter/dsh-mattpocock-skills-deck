/**
 * tests/tracker-contract/sections/preflight.js — preflight.js 错误分类段（#132 Q2=B）。
 *
 * 第一性原理（#124 §1）：classifyError 顺序纪律 ——
 *   ① 已规范 TrackerError（含 kind:'conflict'/'unsupported'）→ 透传，不重复分类；
 *   ② env 先于 not-found（防 "command not found" 被 "not found" 误吞）；
 *   ③ auth 先于 rate-limit；④ **兜底 network**（未知不归 env，不混资源问题）。
 */

import { classifyError, fail } from '../../../src/host/tracker/preflight.js'
import { ERROR_KIND } from '../../../src/shared/tracker/constants.js'

export async function run() {
  const out = []
  const P = 'preflight · '
  const assert = async (name, cond, detail) => {
    let ok = false
    try { ok = !!(await cond) } catch (e) { out.push({ name: P + name, ok: false, detail: String(e) }); return }
    out.push({ name: P + name, ok, detail: detail || '' })
  }

  // ③ auth 先于 rate-limit
  await assert('auth 先于 rate-limit（403+rate limit → auth）', classifyError('403 rate limit exceeded') === ERROR_KIND.AUTH,
    'got=' + classifyError('403 rate limit exceeded'))
  // ② env 先于 not-found
  await assert('env 先于 not-found（command not found）', classifyError('command not found: gh') === ERROR_KIND.ENV,
    'got=' + classifyError('command not found: gh'))
  await assert('env 先于 not-found（no such file）', classifyError('no such file or directory: /x') === ERROR_KIND.ENV,
    'got=' + classifyError('no such file or directory: /x'))
  // 基础分类
  await assert('auth（401/unauthorized）', classifyError('401 unauthorized') === ERROR_KIND.AUTH)
  await assert('rate-limit（429 无 auth 标记）', classifyError('429 rate limit reached') === ERROR_KIND.RATELIMIT)
  await assert('not-found（404/not found）', classifyError('404 not found: issue 99') === ERROR_KIND.NOTFOUND)
  await assert('unsupported（not implemented）', classifyError('not implemented by backend') === ERROR_KIND.UNSUPPORTED)
  await assert('parse（invalid json）', classifyError('invalid json: syntax error') === ERROR_KIND.PARSE)
  await assert('network（ECONNREFUSED/fetch failed/timeout）',
    classifyError('fetch failed ECONNREFUSED') === ERROR_KIND.NETWORK && classifyError('timeout after 1000ms') === ERROR_KIND.NETWORK)
  // ① 透传（含 conflict —— 非 regex 派生，由后端显式产生）
  await assert('透传：{kind:conflict}', classifyError({ kind: 'conflict', message: 'cycle detected' }) === ERROR_KIND.CONFLICT)
  await assert('透传：{error:{kind:conflict}}', classifyError({ error: { kind: 'conflict', message: '' } }) === ERROR_KIND.CONFLICT)
  await assert('透传：{error:{kind:unsupported}}', classifyError({ error: { kind: 'unsupported', message: '' } }) === ERROR_KIND.UNSUPPORTED)
  // ④ 兜底 network（#132 定决：实义变更，非表面清理）
  await assert('空/未知 → 兜底 NETWORK', classifyError('') === ERROR_KIND.NETWORK && classifyError(undefined) === ERROR_KIND.NETWORK
    && classifyError('utterly unknown corner') === ERROR_KIND.NETWORK)
  // fail() 形状
  {
    const r = fail(ERROR_KIND.CONFLICT, 'self in blockers')
    await assert('fail() 返回统一失败形状', r && r.ok === false && r.error.kind === 'conflict' && r.error.message === 'self in blockers',
      JSON.stringify(r))
  }

  // ✗ probe：env-first 顺序是真的（planted 先判 not-found 的错序分类器会把 command-not-found 误判为 NOTFOUND）
  await assert('✗ probe: 错序分类器（not-found 先于 env）会把 env 误判为 not-found', (async () => {
    const wrongOrder = (msg) => (/not ?found/.test(msg) ? ERROR_KIND.NOTFOUND : ERROR_KIND.ENV)
    const mis = wrongOrder('command not found: gh')
    return mis === ERROR_KIND.NOTFOUND && classifyError('command not found: gh') === ERROR_KIND.ENV
  })(), 'prove env-first is real (wrong order misclassifies)')
  // ✗ probe：conflict 不是 regex 派生（正文出现 "conflict" 单词不得判为 conflict）
  await assert('✗ probe: conflict 靠透传不靠 regex', classifyError('a conflict happened in some account') !== ERROR_KIND.CONFLICT,
    'got=' + classifyError('a conflict happened in some account'))

  return out
}

export default { name: 'preflight', run }
