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
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, rmSync, cpSync, utimesSync } from 'node:fs'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import vm from 'node:vm'
import { spawnSync } from 'node:child_process'
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
/** 宿主侧 pkg shim：harness.handle('wf.x', fn) → dispatch 表 + connection.rpc.handle('/dsws')
 *  #172 方案 C 原样复制已不再使用此拼接，保留常量仅作历史参照（零打包不变量）。 */
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

/** 仓库主页 URL（#repo-link）：package/package.json 的 repository 字段（string 或 {url}），
 *  去 git+ 前缀与 .git 后缀。版本号可点跳转的单一真源；客户端源码只有 __DSW_REPO_URL__ 占位符，
 *  无 URL 字面量（过硬编码门禁 F2），产物中的字面量已在门禁 RE_LICENSED 登记。 */
function dswRepoUrl() {
  const pkg = JSON.parse(read('package/package.json'))
  const r = pkg.repository
  const raw = typeof r === 'string' ? r : (r && r.url) || ''
  const url = String(raw).replace(/^git\+/, '').replace(/\.git$/, '')
  if (!url) throw new Error('[build] package/package.json 缺 repository 字段，__DSW_REPO_URL__ 注入无源')
  return url
}

function injectVersion(body, version, repoUrl) {
  return body.split('__DSW_VERSION__').join(`'${version}'`).split('__DSW_REPO_URL__').join(`'${repoUrl}'`)
}

// ---------- 门禁（G） ----------
function gatePrecheck(code, label) {
  try {
    new vm.Script(`(async () => {\n${code}\n})()`, { filename: `cordis-dyn-${label}.js` })
  } catch (e) {
    if (process.env.DSH_PRECHECK_LOC) console.error('LOC '+label+' :: '+(e.stack||'').split('\n').slice(1,3).join(' | '))
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

// ---------- Kernel 模块组合（阶段 2 内核迁移 · #96 T3）----------
/** 内核模块清单（docs/architecture/kernel-contract.md · G3 冻结 · 迁移完成即全活跃）。
 *  index.js 中每模块原位置留标记 `// ==== kernel:<name> (spliced by build) ====`，
 *  构建时把模块文件声明体（去行首 export）拼回标记处 —— 闭包内原位，行为零变化。 */
const KERNEL_MODULES = [
  { name: 'backendList', file: 'src/client/kernel/builtin-backends.js' },
  { name: 'link', file: 'src/client/kernel/link.js' },
  { name: 'styles', file: 'src/client/kernel/styles.js' },
  { name: 'portal', file: 'src/client/kernel/portal.js' },
  { name: 'locale', file: 'src/client/kernel/locale.js' },
  { name: 'icons', file: 'src/client/kernel/icons.js' },
  { name: 'prompts', file: 'src/client/kernel/prompts.js' },
  { name: 'config', file: 'src/client/kernel/config.js' },
  { name: 'store', file: 'src/client/kernel/store.js' },
  { name: 'api', file: 'src/client/kernel/api.js' },
  { name: 'actions', file: 'src/client/kernel/actions.js' },
  { name: 'slots', file: 'src/client/kernel/slots.js' },
  { name: 'slotRenderer', file: 'src/client/kernel/slotRenderer.js' },
  { name: 'probe', file: 'src/client/kernel/probe.js' },
  { name: 'router', file: 'src/client/kernel/router.js' },
]

// ---------- 共享核心拼装（一源两物 · #265）----------
/** 共享纯函数模块（src/shared/*）：host 半运行时 import()；client 半按与 kernel 同模式的
 *  标记拼回闭包 —— 原文零复制（去行首 export），两半共用同一份实现文本，无第二处命名真源。
 *  shared-0（#443）接线结论：下面 5 项与 src/client/index.js 里 5 个拼接标记一一对应，已经对齐；
 *  chain.js（682 行）与 check-catalog.js（356 行）只被 host 半在运行时引用，client 半没有运行时引用，
 *  所以不进拼接清单，S1/S3 拆分时不新设拼接标记；naming-guardian.js（498 行）两半都要用，
 *  S2 拆成 3 个文件后须拆成 3 个拼接项与 3 个标记位（做法见 #443 票内接线图），本票先不动功能只留档。 */
const SHARED_SPLICE = [
  { marker: '// ==== shared:namingGuardian (spliced by build) ====', file: 'src/shared/naming-guardian.js' },
  { marker: '// ==== shared:trackerSync (spliced by build) ====', file: 'src/shared/tracker/sync.js' },
  { marker: '// ==== shared:slots (spliced by build) ====', file: 'src/shared/ui/slots.js' },
  { marker: '// ==== shared:mattSkills (spliced by build) ====', file: 'src/shared/matt-skills.js' },
  { marker: '// ==== shared:workspaceKey (spliced by build) ====', file: 'src/shared/workspaceKey.js' },
]

// ---------- 叶子模块组合（阶段 2 叶子迁移 · #97 T4）----------
/** 叶子组件模块清单（G3 共享 → views/shared/ · G4 严格一文件 ≤350 行）。
 *  与 kernel 同模式：index.js 中原位置留标记 `// ==== leaf:<id> (spliced by build) ====`，
 *  构建时把叶子文件声明体（去行首 export）拼回标记处 —— 闭包内原位，行为零变化；
 *  组件经 React.useContext(DswsCtx) 消费 cx（ARCHITECTURE-CTX.md §2）。 */
const LEAF_MODULES = [
  { id: 'chips', file: 'src/client/views/shared/chips.js' },
  { id: 'hoverTip', file: 'src/client/views/primitives/HoverTip.js' },
  { id: 'tip', file: 'src/client/views/primitives/Tip.js' },
  { id: 'backendSelector', file: 'src/client/views/shared/BackendSelector.js' },
  { id: 'switchConfirmModal', file: 'src/client/views/shared/SwitchConfirmModal.js' },
  { id: 'md', file: 'src/client/views/shared/md.js' },
  { id: 'ticket', file: 'src/client/views/shared/ticket.js' },
  { id: 'tagsFit', file: 'src/client/views/shared/tagsFit.js' },
  { id: 'tabs', file: 'src/client/views/shared/Tabs.js' },
  { id: 'ticketRow', file: 'src/client/views/TicketRow.js' },
  { id: 'mapDetail', file: 'src/client/views/MapDetail.js' },
  { id: 'IssueDetail', file: 'src/client/views/IssueDetail.js' },
  { id: 'noRepoCard', file: 'src/client/views/NoRepoCard.js' },
  { id: 'listTab', file: 'src/client/views/ListTab.js' },
  { id: 'ringSkills', file: 'src/client/views/RingSkills.js' },
  { id: 'skillsTab', file: 'src/client/views/SkillsTab.js' },
  { id: 'checksTab', file: 'src/client/views/ChecksTab.js' },
  { id: 'settingsPage', file: 'src/client/views/SettingsPage.js' },
  { id: 'runPanel', file: 'src/client/views/RunPanel.js' },
  { id: 'dock', file: 'src/client/panel/Dock.js' },
  { id: 'namingFailBanner', file: 'src/client/panel/NamingFailBanner.js' },
  { id: 'overlay', file: 'src/client/panel/Overlay.js' },
  { id: 'seg', file: 'src/client/statusbar/Seg.js' },
  { id: 'checksums', file: 'src/client/statusbar/checksums.js' },
  { id: 'statusBar', file: 'src/client/statusbar/StatusBar.js' },
  { id: 'chainRenderer', file: 'src/client/views/shared/ChainRenderer.js' },
  { id: 'skillFloatList', file: 'src/client/floating/SkillFloatList.js' },
  { id: 'pop', file: 'src/client/floating/Pop.js' },
]
function extractModuleBlock(file) {
  return read(file).split('\n').map((l) => l.replace(/^(\s*)export\s+/, '$1')).join('\n').trim()
}
function wireModules(body) {
  let out = body
  for (const m of KERNEL_MODULES) {
    const marker = `// ==== kernel:${m.name} (spliced by build) ====`
    if (out.indexOf(marker) < 0) throw new Error(`[build] 缺 marker ${marker} 对应 ${m.file} — 请在 src/client/index.js 加标记并在 KERNEL_MODULES 注册`)
    out = out.replace(marker, extractModuleBlock(m.file))
  }
  for (const m of LEAF_MODULES) {
    const marker = `// ==== leaf:${m.id} (spliced by build) ====`
    if (out.indexOf(marker) < 0) throw new Error(`[build] 缺 marker ${marker} 对应 ${m.file} — 请在 src/client/index.js 加标记并在 LEAF_MODULES 注册`)
    out = out.replace(marker, extractModuleBlock(m.file))
  }
  for (const m of SHARED_SPLICE) {
    const marker = m.marker
    if (out.indexOf(marker) < 0) throw new Error(`[build] 缺 marker ${marker} 对应 ${m.file} — 请在 src/client/index.js 加标记并在 SHARED_SPLICE 注册`)
    out = out.replace(marker, extractModuleBlock(m.file))
  }
  // 反向检查：src 下有叶子文件却未在 LEAF_MODULES 登记（比“忘贴纸条”更隐蔽）
  try {
    const leafFiles = []
    const walk = (dir) => {
      const abs = resolve(ROOT, dir)
      if (!existsSync(abs)) return
      for (const ent of readdirSync(abs, { withFileTypes: true })) {
        const rel = dir + '/' + ent.name
        const absEnt = resolve(ROOT, rel)
        if (ent.isDirectory()) walk(rel)
        else if (ent.isFile() && rel.endsWith('.js')) leafFiles.push(rel)
      }
    }
    walk('src/client/views'); walk('src/client/panel'); walk('src/client/statusbar'); walk('src/client/floating')
    const registered = new Set(LEAF_MODULES.map(m => m.file))
    for (const f of leafFiles) {
      if (!registered.has(f)) throw new Error(`[build] ${f} 未在 LEAF_MODULES 登记 — 新加叶子需在 LEAF_MODULES 加一项并在 src/client/index.js 加 // ==== leaf:<id> ==== 标记`)
    }
  } catch (e) {
    if (e && e.message && e.message.startsWith('[build]')) throw e
  }
  return out
}

// ---------- 构建 client ----------
async function buildClient({ version, repoUrl }) {
  const { header, body } = extractPluginBody('src/client/index.js')
  const bodyW = wireCtx(wireModules(injectVersion(body, version, repoUrl)))
  // 根产物降级声明（G1 · T5 #98）：client.js/host.js 为构建产物，人手不碰
  const devBanner = `// AUTO-GENERATED by scripts/build.mjs — DO NOT EDIT. Source: src/client/index.js + kernel/* + leaves/* (${version})\n// 产物 gitignore，一源两物；改 src/ 后运行 node scripts/build.mjs 重新生成。\n`

  // ---- _dev：cordis_define 函数体形态 ----
  const devCode = `${devBanner}${header}\n\nreturn ${bodyW}\n`
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
  gateSingleDeclaration(pkgCode, 'client-pkg', ['StatusBar', 'DetailsDock', 'OverlayPanel', 'SettingsPage', 'RunPanel', 'IssueDetail'])
  write('package/lib/client.js', pkgCode)
  return { devCode, pkgCode }
}

// ---------- 构建 host（方案 C 原样复制 · #136/#172） ----------
async function buildHost({ version }) {
  const { header, body } = extractPluginBody('src/host/index.js')
  const hostDevBanner = `// AUTO-GENERATED by scripts/build.mjs — DO NOT EDIT. Source: src/host/index.js (${version})\n// 产物 gitignore，一源两物；改 src/ 后运行 node scripts/build.mjs 重新生成。\n`

  // ---- _dev：cordis_define 函数体形态（保留，host.js 不在发布包，#172 不碰其函数体）----
  const devCode = `${hostDevBanner}${header}\n\nreturn ${body}\n`
  gatePrecheck(devCode, 'host-dev')
  write('host.js', devCode)

  // ---- _pkg：原样复制（零打包）—— src/host 整树 → package/lib, src/shared → package/shared ----
  // 幂等清理：先清旧产物再复制，确保双向差集 0；lib/client.js 工厂壳由 buildClient 负责，不在此删
  const pkgLib = resolve(ROOT, 'package/lib')
  const pkgShared = resolve(ROOT, 'package/shared')
  // 清理 package/lib 下的 host 树（保留 lib/client.js）
  const toRemove = [
    join(pkgLib, 'index.js'),
    join(pkgLib, 'platform'),
    join(pkgLib, 'tracker'),
  ]
  for (const p of toRemove) {
    try { rmSync(p, { recursive: true, force: true }) } catch {}
  }
  try { rmSync(pkgShared, { recursive: true, force: true }) } catch {}
  mkdirSync(pkgLib, { recursive: true })
  mkdirSync(pkgShared, { recursive: true })
  // 复制 src/host → package/lib（逐文件 sha256 一致）
  const srcHost = resolve(ROOT, 'src/host')
  // Node 16.7+ cpSync 原生支持；fall back 手写
  const copyOpts = { recursive: true, force: true }
  try {
    if (typeof cpSync === 'function') {
      // 复制 src/host/* 到 package/lib/*
      const entries = readdirSync(srcHost, { withFileTypes: true })
      for (const ent of entries) {
        const s = join(srcHost, ent.name)
        const d = join(pkgLib, ent.name)
        cpSync(s, d, copyOpts)
      }
      cpSync(resolve(ROOT, 'src/shared'), pkgShared, copyOpts)
    } else {
      throw new Error('cpSync unavailable')
    }
  } catch (e) {
    // fallback 手写递归
    function cpRecur(src, dst) {
      const st = statSync(src)
      if (st.isDirectory()) {
        mkdirSync(dst, { recursive: true })
        for (const ent of readdirSync(src)) cpRecur(join(src, ent), join(dst, ent))
      } else {
        mkdirSync(dirname(dst), { recursive: true })
        writeFileSync(dst, readFileSync(src))
      }
    }
    const entries = readdirSync(srcHost, { withFileTypes: true })
    for (const ent of entries) cpRecur(join(srcHost, ent.name), join(pkgLib, ent.name))
    cpRecur(resolve(ROOT, 'src/shared'), pkgShared)
  }
  // 校验：package/lib/index.js 必须与 src/host/index.js 逐字节一致（零打包不变量）
  try {
    const a = readFileSync(resolve(ROOT, 'src/host/index.js'), 'utf8')
    const b = readFileSync(join(pkgLib, 'index.js'), 'utf8')
    if (a !== b) throw new Error('package/lib/index.js 与 src/host/index.js 不一致（原样复制失败）')
  } catch (e) {
    throw new Error(`[build] 原样复制校验失败：${e.message}`)
  }
  // 触新 mtime：确保产物新鲜度门禁（verify-parse-leaf 检查产物 mtime > 源 mtime），原样复制需显式 touch
  try {
    const now = new Date()
    const touch = (dir) => {
      for (const ent of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, ent.name)
        if (ent.isDirectory()) touch(p)
        else try { utimesSync(p, now, now) } catch {}
      }
    }
    touch(pkgLib)
    touch(pkgShared)
  } catch {}

  // L1 冒烟：构建内 await import('package/lib/index.js') 入口 + node --check 全树
  // --check 全树
  function collectJs(dir) {
    const out = []
    const walk = (d) => {
      for (const ent of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, ent.name)
        if (ent.isDirectory()) walk(p)
        else if (p.endsWith('.js')) out.push(p)
      }
    }
    if (existsSync(dir)) walk(dir)
    return out
  }
  const allHostJs = collectJs(pkgLib).concat(collectJs(pkgShared))
  for (const f of allHostJs) {
    const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' })
    if (r.status !== 0) throw new Error(`[L1] node --check 失败 ${f}: ${r.stderr || r.stdout}`)
  }
  // 入口 import 冒烟（显式 .js 已在 src 侧保证，此处验证 runtime 解析）
  const entryUrl = pathToFileURL(join(pkgLib, 'index.js')).href
  let mod
  try {
    mod = await import(entryUrl)
  } catch (e) {
    throw new Error(`[L1] import(package/lib/index.js) 失败：${e.message}`)
  }
  // 方案 C：src/host/index.js 为 export default { apply } 默认导出，非命名导出；兼容两种形态
  const hasApply = typeof mod.apply === 'function' || typeof mod.default?.apply === 'function'
  const hasName = typeof mod.name === 'string' || typeof mod.default?.name === 'string'
  if (!mod || !hasApply) {
    throw new Error(`[L1] 入口导出校验失败：hasApply=${hasApply} name=${mod?.name ?? mod?.default?.name} apply=${typeof (mod?.apply ?? mod?.default?.apply)} keys=${Object.keys(mod)}`)
  }
  const dispName = mod.name ?? mod.default?.name ?? '(default)'
  const dispInject = Array.isArray(mod.inject) ? mod.inject.join(',') : Array.isArray(mod.default?.inject) ? mod.default.inject.join(',') : '(default.apply)'
  console.log(`[L1] host pkg 入口冒烟通过：name=${dispName} inject=${dispInject} apply=function`)

  const pkgCode = readFileSync(join(pkgLib, 'index.js'), 'utf8')
  return { devCode, pkgCode }
}

// ---------- 产物自检（风险A） ----------
function gateBuildArtifacts() {
  for (const p of ['client.js', 'host.js']) {
    if (existsSync(resolve(ROOT, p))) {
      const txt = read(p)
      if (!txt.startsWith('// AUTO-GENERATED')) {
        console.warn(`[warn] ${p} 缺 AUTO-GENERATED 横幅 — 可能为手改产物，下次 build 将被覆盖`)
      }
    }
  }
}

// ---------- 捆绑技能存在性检查（#388 T1 · G2 定版：目录直铺 25，空目录期跳过校验） ----------
function ensureBundledSkills() {
  const bundledDir = resolve(ROOT, 'package/bundled-skills')
  if (!existsSync(bundledDir)) {
    console.warn('[build] 警告：package/bundled-skills 不存在，跳过捆绑校验（早期分支容忍）。请运行 node scripts/sync-matt-skills.mjs --pin v1.2.3 --verify 同步')
    return
  }
  const entries = readdirSync(bundledDir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name)
  if (entries.length !== 25) {
    console.warn(`[build] 警告：bundled-skills 期望 25 项，当前 ${entries.length} 项（可能未同步完成）`)
  }
  // 轻量校验：每项含 SKILL.md 且 frontmatter name 与目录一致（与 verify-bundled-skills 同口径，失败仅 warn 不阻断 build）
  for (const name of entries) {
    const mdPath = join(bundledDir, name, 'SKILL.md')
    if (!existsSync(mdPath)) {
      console.warn(`[build] 警告：${name}/SKILL.md 缺失`)
      continue
    }
    try {
      const md = readFileSync(mdPath, 'utf8')
      const m = md.match(/^name:\s*(.+)$/m)
      const fm = m ? m[1].trim().replace(/^[\'\"]|[\'\"]$/g, '') : ''
      if (fm && fm !== name) console.warn(`[build] 警告：${name}/SKILL.md name:${fm} ≠ 目录名`)
    } catch {}
  }
  const verPath = join(bundledDir, 'VERSION')
  const licPath = join(bundledDir, 'LICENSE')
  if (!existsSync(verPath)) console.warn('[build] 警告：bundled-skills/VERSION 缺失')
  if (!existsSync(licPath)) console.warn('[build] 警告：bundled-skills/LICENSE 缺失')
}

// ---------- main ----------

const args = process.argv.slice(2)
const devOnly = args.includes('--dev-only')
const pkgOnly = args.includes('--pkg-only')
const version = dswVersion()
const repoUrl = dswRepoUrl()
console.log(`[build] DSW_VERSION=${version} (package/package.json)`)
console.log(`[build] DSW_REPO_URL=${repoUrl} (package/package.json repository)`)

// A 自检（build 前）：若产物存在但无横幅，给 warn（不阻断，防旧产物）
gateBuildArtifacts()
ensureBundledSkills()

const out = {}
if (!pkgOnly) out.clientDev = (await buildClient({ version, repoUrl })).devCode
if (!devOnly) out.clientPkg = (await buildClient({ version, repoUrl })).pkgCode
if (!pkgOnly) out.hostDev = (await buildHost({ version })).devCode
if (!devOnly) out.hostPkg = (await buildHost({ version })).pkgCode

console.log('[build] OK')
console.log(`  client.js (dev)      ${out.clientDev ? read('client.js').length + ' bytes' : 'skipped'}`)
console.log(`  host.js (dev)        ${out.hostDev ? read('host.js').length + ' bytes' : 'skipped'}`)
console.log(`  package/lib/client.js (pkg) ${out.clientPkg ? read('package/lib/client.js').length + ' bytes' : 'skipped'}`)
console.log(`  package/lib/index.js (pkg)  ${out.hostPkg ? read('package/lib/index.js').length + ' bytes' : 'skipped'}`)

// A 自检（build 后）：产物必须带横幅
gateBuildArtifacts()

// C 自动同步（默认同步，--no-sync 可跳过）
if (!args.includes('--no-sync')) {
  // 同步为 async 需 await，main 已在顶层 async 上下文（文件整体为 ESM，顶层 await 可用）
  const _home = process.env.HOME || process.env.USERPROFILE || ''
  if (_home) {
    try {
      const profileBase = resolve(_home, '.dsh/profiles/web/node_modules/dsh-mattpocock-skills-deck')
      if (existsSync(profileBase)) {
        for (const [srcRel, dstRel] of [['package/lib/client.js','lib/client.js'],['package/lib/index.js','lib/index.js']]) {
          const src = resolve(ROOT, srcRel)
          const dst = resolve(profileBase, dstRel)
          if (existsSync(src)) {
            mkdirSync(resolve(profileBase, 'lib'), { recursive: true })
            writeFileSync(dst, readFileSync(src, 'utf8'), 'utf8')
          }
        }
        console.log(`[build] 已同步 profile → ${profileBase}`)
        // hash 校验
        try {
          const a = readFileSync(resolve(ROOT,'package/lib/client.js'),'utf8')
          const b = readFileSync(resolve(profileBase,'lib/client.js'),'utf8')
          if (a !== b) console.warn('[build] profile 同步 hash 不一致')
          else console.log('[build] profile 同步 hash 校验通过')
        } catch {}
      }
    } catch (e) {
      console.warn('[build] profile 同步跳过:', e.message)
    }
  }
} else {
  console.log('[build] --no-sync 已跳过 profile 同步')
}