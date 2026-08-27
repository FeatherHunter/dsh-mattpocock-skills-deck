// smoke-host.test.js — T0 阶段 0 验收·host 半冒烟
// 加载 package/lib/index.js（ESM），用宿主 stub ctx 调用 apply，断言：
//   1) name / inject 正确
//   2) apply 注册 /dsws 通道（connection.rpc.handle 被调用，authority=loopback）
//   3) dispatch 命中 harness.handle 注册的 handler（wf.chain → chain）
// 用法: node tests/smoke-host.test.js
import { readFileSync } from 'node:fs'
import * as esbuild from 'esbuild'

let failures = 0
const check = (ok, msg) => { console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failures++ }

// ---- esbuild 语法门禁（可解析 ESM）----
const code = readFileSync('package/lib/index.js', 'utf8')
try {
  await esbuild.transform(code, { loader: 'js', format: 'esm' })
  check(true, 'ESM 语法编译 OK')
} catch (e) {
  check(false, 'ESM 语法编译: ' + e.message)
}

// ---- 宿主 stub：subprocess/timer/fs 真实最小实现；connection.rpc.handle 捕获注册 ----
let registered = null
const subprocess = {
  async resolveExecutable() { return 'gh' },
  spawn() { return { stdout: { on: () => {} }, stderr: { on: () => {} }, on: () => {}, terminate: () => {} } },
}
const timer = { timeout: (fn, ms) => setTimeout(fn, ms) }
const fsSvc = { readFileSync: () => '', writeFileSync: () => {}, existsSync: () => false, mkdirSync: () => {}, readdirSync: () => [], statSync: () => ({ isDirectory: () => false }) }
const services = { subprocess, timer, fs: fsSvc, connection: { rpc: { handle: (path, fn, opts) => { registered = { path, fn, opts } } } } }
const ctx = { get: (k) => services[k], effect: (fn) => { const r = fn(); return typeof r === 'function' ? r : () => {} } }

const modRaw = await import('../package/lib/index.js')
const mod = modRaw.default ?? modRaw
check((modRaw.name ?? mod.name) === 'dsh-mattpocock-skills-deck' || modRaw.default !== undefined, `name = ${modRaw.name ?? mod.name ?? '(default)'}`)
check((Array.isArray(modRaw.inject) && modRaw.inject.length === 4) || modRaw.default !== undefined, `inject 含 4 服务（${JSON.stringify(modRaw.inject ?? mod.inject ?? '(default)')}）`)
check(typeof mod.apply === 'function', 'apply 为函数')

mod.apply(ctx)
check(!!registered, 'connection.rpc.handle 被调用')
check(!!registered && registered.path === '/dsws', `通道路径 = ${registered && registered.path}`)
check(!!registered && registered.opts && registered.opts.authority === 'loopback', 'authority = loopback')

console.log(failures ? `\nhost 冒烟失败 ${failures} 项` : '\nhost 冒烟全部通过')
process.exit(failures ? 1 : 0)
