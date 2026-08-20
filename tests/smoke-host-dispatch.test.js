// smoke-host-dispatch.test.js — host seam dispatch 端到端验证
// 验证 harness.handle 注册的 handler 能经 connection.rpc.handle('/dsws') 通道被调用：
//   wf.ping → ping 端点 → { ok: true, value: 'pong' }
import { readFileSync } from 'node:fs'

const mod = await import('../package/lib/index.js')

let registered = null
const subprocess = {
  async resolveExecutable() { return 'gh' },
  spawn() { return { stdout: { on: () => {} }, stderr: { on: () => {} }, on: () => {}, terminate: () => {} } },
}
const timer = { timeout: (fn, ms) => setTimeout(fn, ms) }
const fsSvc = { readFileSync: () => '', writeFileSync: () => {}, existsSync: () => false, mkdirSync: () => {}, readdirSync: () => [], statSync: () => ({ isDirectory: () => false }) }
const services = {
  subprocess, timer, fs: fsSvc,
  connection: { rpc: { handle: (path, fn, opts) => { registered = { path, fn, opts } } } },
}
const ctx = { get: (k) => services[k], effect: (fn) => { const r = fn(); return typeof r === 'function' ? r : () => {} } }

mod.apply(ctx)

let failures = 0
const check = (ok, msg) => { console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failures++ }
check(!!registered && typeof registered.fn === 'function', 'connection.rpc.handle 收到 dispatch fn')

// 调 dispatch：endpoint 'ping'（动态 host 注册的是 wf.ping → seam 去掉 wf. 前缀）
if (registered && typeof registered.fn === 'function') {
  const res = await registered.fn('ping', {})
  console.log('  ping 结果:', JSON.stringify(res))
  check(!!res && res.ok === true, 'ping dispatch ok=true')
  const bad = await registered.fn('nonexistent', {})
  check(!!bad && bad.ok === false, '未知端点 ok=false（RpcResult 错误信封）')
}

console.log(failures ? `\ndispatch 冒烟失败 ${failures} 项` : '\ndispatch 冒烟全部通过')
process.exit(failures ? 1 : 0)
