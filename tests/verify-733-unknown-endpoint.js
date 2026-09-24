// tests/verify-733-unknown-endpoint.js —— 门禁：分发时不认识端点名必须留痕（#733）。
//
// 为什么要有这一条：2026-09-24 生产日志里视野上报 316 次失败全是
// “unknown endpoint: focus”（新界面调旧宿主、旧宿主继续服务那段升级窗口），
// 而宿主侧对“不认识”一行都不记，只能拿客户端散列反推，现场钉不出来。
// 本门禁用同一条常驻告警 host.dispatch.empty 加第四种形状 unknown-endpoint 把它补上，
// 与 #724 那三档（no-value / null-value / no-error）共用事件名与字段，不新增事件、不改计数。
//
// 判定分四段（回滚其中任何一段都变红，见末尾反证说明）：
//   ① 源码里不认识分支必须走 log('warn','host.dispatch.empty',{method,shape,version})，字段不多不少；
//   ② 真跑一次：调不存在的端点，回失败信封且留痕一行（电话名、形状、版本齐）；
//   ③ 负控：业务性正常失败（ok:false 带 error）不触发留痕，已有三档行为不变；
//   ④ 附录 #88 登记了 unknown-endpoint，计数仍是常驻 38 条。
//
// 用法：node tests/verify-733-unknown-endpoint.js
import { readFileSync } from 'node:fs'

let failures = 0
const check = (ok, msg) => { console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failures++ }
const src = (p) => readFileSync(p, 'utf8')

// ---------- ① 源码形状 ----------
const rpcSrc = src('src/host/rpcChannel.js')
check(rpcSrc.includes("'host.dispatch.empty'"), 'rpcChannel.js 有 host.dispatch.empty 落点')
check(rpcSrc.includes('unknown-endpoint'), 'rpcChannel.js 登记了 unknown-endpoint 形状')
// 字段门禁只认 log('级别','事件名',{…}) 形状，写成 fireLog 会成野点（见文件里 #724 那段说明）。
check(rpcSrc.includes("log('warn', 'host.dispatch.empty'"), '未知端点走 log 告警（字段门禁可扫到）')
// 告警级始终落盘，不许加外层开关判断（与 #724 三档一致）。
{
  const lines = rpcSrc.split('\n')
  const hit = lines.filter((l) => l.includes('host.dispatch.empty') && l.includes('unknown-endpoint'))
  check(hit.length >= 1, '未知端点留痕行存在（实得 ' + hit.length + ' 行）')
  check(hit.every((l) => !/isEnabled\s*\(/.test(l)), '告警直发不判开关')
}
check(rpcSrc.includes('unknownEndpointShape'), '形状由小函数收口（不散写字面）')

// ---------- ② 真跑一次 ----------
const services = { connection: { fetch: { register: (route) => { globalThis.__733route = route; return () => {} } } } }
const ctx = { get: (k) => services[k] }
const mod = await import('../src/host/rpcChannel.js')
const seen = []
const result = mod.createRpcChannel({
  ctx,
  handlers: new Map([['probe.echo', async (payload) => ({ ok: true, echoed: payload })]]),
  fireLog: (level, event, fields) => { seen.push({ level, event, fields }) },
  dispatchMeta: async () => ({ shortArgHash: () => '', dispatchErrorKind: () => 'internal' }),
})
check(!!result && result.ok === true, '通道注册成功')
const route = globalThis.__733route
check(!!route && typeof route.fetch === 'function', '拿到注册路由的 fetch 分发函数')
const call = async (endpoint, payload) => {
  const res = await route.fetch({
    method: 'POST',
    url: 'http://dsh.internal/api/dsws',
    json: async () => ({ type: 'client-request', rpcId: 'verify-733', method: 'dsws', payload: { method: endpoint, payload } }),
  })
  return res.json()
}
{
  seen.length = 0
  const body = await call('focus', { windowId: 'w1' })
  check(!!(body && body.result && body.result.ok === false), '未知端点回失败信封')
  check(String((body && body.result && body.result.error && body.result.error.message) || '').includes('unknown endpoint: focus'), '失败原因写明不认识 focus')
  const hit = seen.filter((e) => e.event === 'host.dispatch.empty')
  check(hit.length === 1, '未知端点留痕一行（实得 ' + hit.length + ' 行）')
  check(hit.length === 1 && hit[0].level === 'warn', '留痕取告警级（始终落盘）')
  check(hit.length === 1 && hit[0].fields.method === 'wf.focus', '留痕记电话名 wf.focus')
  check(hit.length === 1 && hit[0].fields.shape === 'unknown-endpoint', '留痕记形状 unknown-endpoint')
  check(hit.length === 1 && typeof hit[0].fields.version === 'string' && hit[0].fields.version.length > 0, '留痕记服务版本')
  const keys = hit.length === 1 ? Object.keys(hit[0].fields).sort() : []
  check(JSON.stringify(keys) === JSON.stringify(['method', 'shape', 'version']), '留痕只含三键（实得 ' + keys.join('、') + '）')
}

// ---------- ③ 负控：业务失败不留痕，既有三档不变 ----------
{
  seen.length = 0
  const handlers2 = new Map([
    ['okfail', async () => ({ ok: false, error: '说清了原因' })],
    ['empty', async () => undefined],
  ])
  const services2 = { connection: { fetch: { register: (route) => { globalThis.__733route2 = route; return () => {} } } } }
  const mod2 = mod
  mod2.createRpcChannel({ ctx: { get: (k) => services2[k] }, handlers: handlers2, fireLog: (l, e, f) => { seen.push({ level: l, event: e, fields: f }) }, dispatchMeta: async () => ({}) })
  const route2 = globalThis.__733route2
  const call2 = async (endpoint) => (await route2.fetch({ method: 'POST', url: 'http://dsh.internal/api/dsws', json: async () => ({ type: 'client-request', rpcId: 'x', method: 'dsws', payload: { method: endpoint, payload: {} } }) })).json()
  await call2('okfail')
  check(seen.filter((e) => e.event === 'host.dispatch.empty').length === 0, '业务性失败（带 error）不触发留痕')
  await call2('empty')
  const empties = seen.filter((e) => e.event === 'host.dispatch.empty')
  check(empties.length === 1 && empties[0].fields.shape === 'no-value', '既有三档不变（undefined 仍记 no-value）')
}

// ---------- ④ 附录登记 ----------
// 只登记形状，不新增事件名，所以计数仍是常驻 38 条（verify-log-count.js 钉着）。
{
  const appendix = src('research/489-appendix.md')
  check(appendix.includes('unknown-endpoint'), '附录登记了 unknown-endpoint 形状')
  check(appendix.includes('常驻 38 条、按需 43 条、自监控 5 条、总数 86 条'), '附录计数仍是 38/43/5/86（未新增事件名）')
}

// 反证（把修复回滚则变红）：删掉 dispatchRpcEndpoint 里未知分支那行 log，
// ① 的“未知端点留痕行存在”与 ② 的“留痕一行”当场变红；只报“改完绿了”不算证据。
console.log(failures ? '\n#733 门禁失败 ' + failures + ' 项' : '\n#733 门禁全部通过')
process.exit(failures ? 1 : 0)
