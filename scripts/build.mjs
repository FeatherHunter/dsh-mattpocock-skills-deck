/**
 * scripts/build.mjs — T0 阶段 0 构建管线（esbuild 双 entry）
 *
 * 规范方言 = 动态版方言（src/client/index.js / src/host/index.js，host/styles/React/timer 为自由变量）。
 * 一源出两物：
 *   _dev → 根 client.js / host.js（cordis_define 函数体形态，须过 precheckCode）
 *   _pkg → package/lib/client.js / package/lib/index.js（ModuleLoader / ESM 形态，pkg entry 提供 shim）
 *
 * seam（src/seam/*）：B1 runtime / B2 style / B3 rpc / B4 timer / B5 editor / B6 sidebar + G 门禁。
 * pkg 产物 = 规范源函数体（逐字保留）+ 工厂壳 + seam shim 词法绑定 —— 文本组合而非 esbuild 重写，
 * 因此 verify-* 的文本特征断言（zIndex: 2147483000、单引号、const L = { 等）保持不变。
 *
 * 门禁（G）：
 *   - dev 产物：precheckCode 包装编译（等价宿主 (async () => {code})() 校验）
 *   - pkg 产物：vm 编译 + __ModuleLoader__ 特征 + 单组件单声明
 *   - DSW_VERSION：从 package/package.json 注入（__DSW_VERSION__ 占位符替换）
 *
 * 用法：node scripts/build.mjs [--dev-only|--pkg-only] [--out-dir DIR]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import * as esbuild from 'esbuild'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// ---------- 工具 ----------
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8')
const write = (p, content) => {
  const abs = resolve(ROOT, p)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, content, 'utf8')
}

/** 从规范源模块提取插件对象函数体（export default { ... } 的 `{ ... }` 部分，含 apply 方法）。
 *  插件对象 = export default 之后到文件末尾的内容（规范源约定：对象闭合是文件最后一个 `}`）。 */
function extractPluginBody(srcPath) {
  const src = read(srcPath)
  const marker = 'export default {'
  const idx = src.indexOf(marker)
  if (idx < 0) throw new Error(`${srcPath}: 找不到 export default {`)
  const start = idx + marker.length - 1 // 指向 {
  const end = src.lastIndexOf('}') // 对象闭合 = 文件末尾的 }
  if (end < start) throw new Error(`${srcPath}: 找不到对象闭合`)
  return {
    header: src.slice(0, idx).replace(/\s+$/, ''), // 头注释
    body: src.slice(start, end + 1), // { apply(ctx) {...} }
  }
}

// ---------- seam shim 文本（pkg 方言绑定） ----------
/** B3 rpc + B2 style + B4 timer 的 pkg 方言 shim（工厂壳内词法绑定，源函数体的自由变量解析到它们）。 */
const PKG_CLIENT_SHIMS = `    // ===================== seam shims（pkg 方言绑定 · B3 rpc / B2 style / B4 timer） =====================
    const React = require('react')
    let __DSW_CTX__ = null
    const __rpcCall = async function (endpoint, args) {
      const ctx = __DSW_CTX__
      const conn = ctx && ctx.get ? ctx.get('connection') : undefined
      if (conn === undefined || conn.rpc === undefined) throw new Error('connection 服务不可用')
      const res = await conn.rpc.call('/dsws', endpoint, args)
      if (res && res.ok) return res.value
      throw new Error((res && res.error && res.error.message) || ('RPC 失败：' + endpoint))
    }
    const host = {
      call: (method, args) => __rpcCall(method.replace(/^wf\\./, ''), args)
    }
    const styles = {
      insert: (css) => {
        const ctx = __DSW_CTX__
        const styleEl = document.createElement('style')
        styleEl.setAttribute('data-plugin', 'dsh-mattpocock-skills-deck')
        styleEl.textContent = typeof css === 'string' ? css : Array.isArray(css) ? css.join('') : String(css)
        document.head.appendChild(styleEl)
        if (ctx && typeof ctx.effect === 'function') {
          ctx.effect(() => () => {
            try { if (styleEl.parentNode) styleEl.parentNode.removeChild(styleEl) } catch (e) { /* 忽略 */ }
          }, 'dsh-mattpocock-skills-deck: styles')
        }
        return () => {
          try { if (styleEl.parentNode) styleEl.parentNode.removeChild(styleEl) } catch (e) { /* 忽略 */ }
        }
      }
    }
    const timer = {
      schedule: (fn, ms) => {
        const ctx = __DSW_CTX__
        const timerSvc = ctx && ctx.get ? ctx.get('timer') : undefined
        if (timerSvc !== undefined && timerSvc.timeout) return timerSvc.timeout(fn, ms)
        return setTimeout(fn, ms)
      }
    }`
/** 宿主侧 pkg shim：harness.handle('wf.x', fn) → dispatch 表 + connection.rpc.handle('/dsws') */
const PKG_HOST_PREAMBLE = `// ===================== seam shims（pkg 方言绑定 · B3 rpc host 侧） =====================
const __DSW_HANDLERS__ = new Map()
const harness = {
  handle: (method, fn) => {
    const endpoint = method.replace(/^wf\\./, '')
    __DSW_HANDLERS__.set(endpoint, fn)
  }
}
`

// ---------- 版本注入 ----------
function dswVersion() {
  const pkg = JSON.parse(read('package/package.json'))
  return 'v' + pkg.version
}

function injectVersion(body, version) {
  return body.split('__DSW_VERSION__').join(`'${version}'`)
}

// ---------- 门禁（G） ----------
function gatePrecheck(code, label) {
  try {
    new vm.Script(`(async () => {\n${code}\n})()`, { filename: `cordis-dyn-${label}.js` })
  } catch (e) {
    throw new Error(`[G门禁] ${label} precheckCode 失败：${e.message}`)
  }
}
function gateSyntax(code, label) {
  // ESM（export）用 esbuild 校验语法（可解析 module 语法）；其余用 vm.Script。
  if (/\bexport\b/.test(code)) {
    return esbuild.transform(code, { loader: 'js', format: 'esm' }).then(() => true).catch((e) => {
      throw new Error(`[G门禁] ${label} 语法编译失败：${e.message}`)
    })
  }
  try {
    new vm.Script(code, { filename: `gate-${label}.js` })
  } catch (e) {
    throw new Error(`[G门禁] ${label} 语法编译失败：${e.message}`)
  }
  return true
}
function gateModuleLoader(code, label) {
  if (!code.includes('window.__ModuleLoader__.load')) {
    throw new Error(`[G门禁] ${label} 缺 __ModuleLoader__ 特征`)
  }
}
function gateSingleDeclaration(code, label, names) {
  for (const name of names) {
    const re = new RegExp(`(?:const|function|var)\\s+${name}\\s*[=(]`, 'g')
    const hits = code.match(re) || []
    if (hits.length > 1) throw new Error(`[G门禁] ${label} ${name} 声明 ${hits.length} 次（应恰好 1 次）`)
  }
}

// ---------- Ctx 模块组合（阶段 2 步骤 1 · #95） ----------
/** 从 src/client/kernel/ctx.js 提取声明体（去每行行首 export 关键字）。
 *  注入 client 插件对象 apply 闭包顶部 —— 双产物同构，一源两物（与 seam shims 同模式）。 */
function extractCtxBlock() {
  return read('src/client/kernel/ctx.js')
    .split('\n')
    .map((l) => l.replace(/^export\s+/, ''))
    .join('\n')
    .trim()
}
function wireCtx(body) {
  const marker = 'apply(ctx) {'
  const idx = body.indexOf(marker)
  if (idx < 0) throw new Error('src/client/index.js 找不到 apply(ctx) { 注入点（Ctx 接线失败）')
  return body.slice(0, idx + marker.length) + '\n' + extractCtxBlock() + '\n' + body.slice(idx + marker.length)
}

// ---------- 构建 client ----------
async function buildClient({ version }) {
  const { header, body } = extractPluginBody('src/client/index.js')
  const bodyW = wireCtx(injectVersion(body, version))

  // ---- _dev：cordis_define 函数体形态 ----
  const devCode = `${header}\n\nreturn ${bodyW}\n`
  gatePrecheck(devCode, 'client-dev')
  write('client.js', devCode)

  // ---- _pkg：ModuleLoader 工厂壳 + seam shims ----
  const pkgCode = `${header}

window.__ModuleLoader__.load({
  id: 'dsh-mattpocock-skills-deck',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
${PKG_CLIENT_SHIMS}
    const __plugin = ${bodyW}
    exports.inject = ['connection', 'slots', 'locale', 'workspaces', 'sessions']
    exports.apply = function (ctx) { __DSW_CTX__ = ctx; return __plugin.apply(ctx) }
    return module.exports
  }
})
`
  await gateSyntax(pkgCode, 'client-pkg')
  gateModuleLoader(pkgCode, 'client-pkg')
  gateSingleDeclaration(pkgCode, 'client-pkg', ['StatusBar', 'DetailsDock', 'OverlayPanel', 'SettingsPage', 'RunPanel'])
  write('package/lib/client.js', pkgCode)
  return { devCode, pkgCode }
}

// ---------- 构建 host ----------
async function buildHost({ version }) {
  const { header, body } = extractPluginBody('src/host/index.js')

  // ---- _dev：cordis_define 函数体形态 ----
  const devCode = `${header}\n\nreturn ${body}\n`
  gatePrecheck(devCode, 'host-dev')
  write('host.js', devCode)

  // ---- _pkg：ESM 插件形态 + harness shim + connection.rpc.handle ----
  const pkgCode = `${header}
${PKG_HOST_PREAMBLE}
export const name = 'dsh-mattpocock-skills-deck'
export const inject = ['subprocess', 'timer', 'connection', 'fs']

export function apply(ctx) {
  const subprocess = ctx.get('subprocess')
  const timer = ctx.get('timer')
  const fs = ctx.get('fs')
  if (subprocess === undefined || timer === undefined) return

  const __plugin = ${body}
  const __result = __plugin.apply(ctx)

  // RPC 通道：/dsws → dispatch 表（B3 rpc host 侧绑定）
  const connection = ctx.get('connection')
  if (connection === undefined || connection.rpc === undefined) return __result
  connection.rpc.handle('/dsws', async function (endpoint, payload) {
    const fn = __DSW_HANDLERS__.get(endpoint)
    if (!fn) return { ok: false, error: { code: 'internal', message: 'unknown endpoint: ' + endpoint, details: {} } }
    try {
      const value = await fn(payload)
      return { ok: true, value: value }
    } catch (e) {
      return { ok: false, error: { code: 'internal', message: String((e && e.message) || e), details: {} } }
    }
  }, { authority: 'loopback' })

  return __result
}
`
  await gateSyntax(pkgCode, 'host-pkg')
  gateSingleDeclaration(pkgCode, 'host-pkg', [])
  write('package/lib/index.js', pkgCode)
  return { devCode, pkgCode }
}

// ---------- main ----------
const args = process.argv.slice(2)
const devOnly = args.includes('--dev-only')
const pkgOnly = args.includes('--pkg-only')
const version = dswVersion()
console.log(`[build] DSW_VERSION=${version} (package/package.json)`)

const out = {}
if (!pkgOnly) out.clientDev = (await buildClient({ version })).devCode
if (!devOnly) out.clientPkg = (await buildClient({ version })).pkgCode
if (!pkgOnly) out.hostDev = (await buildHost({ version })).devCode
if (!devOnly) out.hostPkg = (await buildHost({ version })).pkgCode

console.log('[build] OK')
console.log(`  client.js (dev)      ${out.clientDev ? read('client.js').length + ' bytes' : 'skipped'}`)
console.log(`  host.js (dev)        ${out.hostDev ? read('host.js').length + ' bytes' : 'skipped'}`)
console.log(`  package/lib/client.js (pkg) ${out.clientPkg ? read('package/lib/client.js').length + ' bytes' : 'skipped'}`)
console.log(`  package/lib/index.js (pkg)  ${out.hostPkg ? read('package/lib/index.js').length + ' bytes' : 'skipped'}`)
