// tests/verify-newsession-workspace-fallback.ts — #364 工作区回退与首条注入保真（兼容 alpha 新参）
// 用法: node tests/verify-newsession-workspace-fallback.ts [file...]（默认 src 源 + package/lib/client.js 双源）
//
// 验收标准（#364 = #363 之后剩余 40% 的“创时即正”三要素中，工作区回退矩阵与首条保真）：
//  d) 沙箱：ensureWorkspaceId — 命中复用、未命中创建、创建失败回落、alpha path→cwd 回退、多形态 snapshot 兼容
//  e) 沙箱：buildCreateOpts — 有 wid / 无 wid / 空 cwd 三态
//  f) 沙箱：createPTCSession — 正常 wid/cwd 分支、workspaceId 失败回落 cwd+ptc、agentPreset 更名回退仍写目标会话自己的草稿
//  g) 沙箱：openTextInNewSession 工作区回退集成 — cwd 缺失走 fallback、workspaceId 创建失败走 cwd+ptc、成功走 wid+ptc、首条写目标会话自己的存放
//  h) 双源一致（src 与构建产物逐字 splice 保留）
//
// 2026-10-12 修订：原来还有 a/b/c 三条「静態：源码必含某段字」的断言，它们读源码文本钉写法，等价重构就会变红，
//   已连同只服务它们的读取语句与临时变量一并删掉；下面 d/e/f/g 四条沙箱断言是真跑代码，一条都没动。
//
// 与 verify-newsession-preset-guard.ts 同范式：从目标文件提取真实源码并在沙箱以忠实替身执行。

const fs = require('fs')
// 取源走共用入口（tests/lib/source-text.ts）：拼给沙箱的那几片要当场求值，所以走 spliceableJs ——
//   它按「同名 .ts 优先」解到真源，再按构建同一份口径转译成可 eval 的 JavaScript（去类型标注、去注释、剥行首 export）。
//   参数仍写 .js 说明符，读到的就是今天那份 .ts 真源。
const { sourcePath, spliceableJs } = require('./lib/source-text.ts')
const { compileFn: compileFnRaw } = require('./lib/eval-probe.js')

// #1215 之后的必修：api 源码里新加了模块级 import（api-new-session.js 的会话 tick / 交接延迟、
//   api-io.ts 的草稿重聚焦重试毫秒）。沙箱是 new Function 拼出来的，吃不下 import 语句，
//   以前会当场 SyntaxError、整条门禁红。修法不是删掉那些 import 了事，而是：拼给沙箱的文本里
//   先把模块级 import 行摘掉，再把 src/shared/time-config/values.js 里**真实导出**的数值按同名
//   常量注进沙箱体——数字仍然只有中央那一个来源，门禁不手抄。
const timeValues = require('../src/shared/time-config/values.js')
const SANDBOX_CONSTS = ['CLIENT_SESSION_TICK_MS', 'CLIENT_HANDOFF_DELAY_MS', 'DRAFT_REFOCUS_RETRY_MS']
  .map((name) => `const ${name} = ${timeValues[name]};`)
  .join('\n')
const stripModuleImports = (text) => String(text).replace(/^\s*import\s[^\n]*$/gm, '')
const compileFn = (paramNames, body) => compileFnRaw(paramNames, SANDBOX_CONSTS + '\n' + stripModuleImports(body))

const API_SRC_FILES = ['src/client/kernel/api-naming.js', 'src/client/kernel/api-workspace.js', 'src/client/kernel/api-handoff.js', 'src/client/kernel/api-new-session.js', 'src/client/kernel/api-io.js'] // #457 K4 + #636 + #1251：api 拆分文件 + 工作区查找模块 + 交接执行模块。src 侧读五文件拼合：查找块用独立锚点提取，它的终止锚点 probeHandoffReady 从 #1251 起住在 api-handoff.ts（api-io 于 #1111、api-handoff 于 #1251 转成 .ts，一律写 .js 说明符，由共用入口解到同名 .ts 真源）
const files = process.argv.slice(2).length ? process.argv.slice(2) : ['src/client/kernel/api-naming.js+api-workspace.js+api-handoff.js+api-new-session.js+api-io.js（拼合）', 'package/lib/client.js']
// #1251：拼合那一腿改走 spliceableJs（五片都按构建同一份口径转译成可 eval 的 JS）。原来直接 fs.readFileSync
//   读真源，读到的 .ts 带类型标注与 declare 行，喂进 new Function 当场语法错；产物的注释又被剥掉，两端形状对不上。
const readTestSrc = (file) => file.indexOf('（拼合）') >= 0 ? API_SRC_FILES.map((f) => spliceableJs(f)).join('\n') : fs.readFileSync(file, 'utf8') // #457 K4：拼合含 openText/工厂/回退/查找全量（跨 naming、workspace、handoff 与 new-session，单文件含不全）
const testExists = (file) => file.indexOf('（拼合）') >= 0 ? API_SRC_FILES.every((f) => { try { return fs.existsSync(sourcePath(f)) } catch (e) { return false } }) : fs.existsSync(file) // #457 K4：五文件全存在才算存在

// 「命名守护」那一段的第一条语句：源码里它上面还压着几行说明注释，而注释经转译会被剥掉，
//   所以「工厂块到哪儿为止」一律用代码锚点，不再用 `// ==== 命名守护` 那行注释当终点（#1251）。
const NAMING_GUARD_ANCHOR = 'let _namingPullBusy = false'

function extractOpenFn(src) {
  // 锚点按转译后的形状写：esbuild 把 `function (st: any, text: any, title: any, opts?: any)` 收成
  //   `function(st, text, title, opts)` —— 函数关键字与括号之间没有空格，参数上的类型标注全没了。
  //   源（.ts 经 spliceableJs 转译）与产物（package/lib/client.js）两条腿都是这个形状，一个锚点够用。
  const marker = 'const openTextInNewSession = function(st, text, title'
  const i = src.indexOf(marker)
  if (i < 0) throw new Error('起始锚点缺失: openTextInNewSession')
  // 终止锚点写成 `//!`（法律注释）：api-io 转成 TypeScript 之后由 esbuild 出产物，普通注释会被去掉，
  // 只有 `//!` 这一种能一路留到 package/lib/client.js，源与产物两条腿才能用同一个锚点（#1111）。
  const j = src.indexOf('//! #361 原入口：行级「在新会话打开」保留', i)
  if (j < 0) throw new Error('终止锚点缺失: #361 注释')
  return src.slice(i, j)
}

function extractFactoryBlock(src) {
  // 起点 = 工厂那一段的第一条声明（getRowPreset，住在 api-naming.ts）；
  // 终点 = 「命名守护」那一段的第一条语句。两端都是代码锚，源与产物同形。
  const start = src.indexOf('const getRowPreset = function')
  const end = src.indexOf(NAMING_GUARD_ANCHOR, start)
  if (start < 0 || end < 0) throw new Error('工厂块锚点缺失')
  return src.slice(start, end)
}

function extractEnsureWorkspaceId(src) {
  const marker = 'const ensureWorkspaceId = function(cwd) {'
  const i = src.indexOf(marker)
  if (i < 0) throw new Error('ensureWorkspaceId 起始缺失')
  // 终点是它在同文件里被调用的那一行（薄转发函数就在这一行之前收尾，闭合大括号留在切片里）。
  // #1251：不再连行首缩进一起锚 —— esbuild 会把缩进重排（源码 6 空格 → 产物 2 空格），
  //   只认 `ensureCwd().then` 这一段，源与产物两条腿同形。
  const endMarker = 'ensureCwd().then'
  const j = src.indexOf(endMarker, i)
  if (j < 0) throw new Error('ensureWorkspaceId 终止缺失')
  return src.slice(i, j)
}

function extractWorkspaceBlock(src) {
  // #636 拆分：工作区查找住在 api-workspace.js（src 拼合里带 export 前缀，构建产物里已剥掉），起止锚点两边都有。
  // #1251：终止锚点 probeHandoffReady 随「交接执行」那一族搬去了 api-handoff.ts；拼合清单里跟着加这一份，
  //   两端的先后顺序与 src/client/index.js 里的拼接标记一致，切出来的仍是「工作区查找」那一段。
  const startMarker = 'const workspacePathOf = function'
  const endMarker = 'const probeHandoffReady = function'
  const i = src.indexOf(startMarker)
  if (i < 0) throw new Error('工作区查找起始缺失: workspacePathOf')
  const j = src.indexOf(endMarker, i)
  if (j < 0) throw new Error('工作区查找终止缺失: probeHandoffReady')
  return src.slice(i, j)
}

let failed = false
let total = 0
function check(ok, msg) {
  total++
  console.log((ok ? '  PASS ' : '  FAIL ') + msg)
  if (!ok) failed = true
}

function keyOf(raw) {
  if (raw == null) return ''
  let s = String(raw).trim()
  if (!s) return ''
  s = s.split('\\').join('/')
  s = s.replace(/\/+/g, '/')
  s = s.toLowerCase()
  while (s.length > 1 && s.charAt(s.length-1) === '/') s = s.slice(0,-1)
  return s
}

async function testFile(file) {
  console.log('--- ' + file + ' ---')
  if (!testExists(file)) { check(false, file + ' 存在'); return }
  let src
  try { src = readTestSrc(file) } catch(e) { check(false, file + ' 可读 — ' + e.message); return }
  let factoryBlock
  try { factoryBlock = extractFactoryBlock(src) } catch(e) { check(false, file + ' 工厂块可提取 — ' + e.message); return }
  check(true, file + ' 单点工厂块可提取')
  let openSrc
  try { openSrc = extractOpenFn(src) } catch(e) { check(false, file + ' openTextInNewSession 可提取 — ' + e.message); return }
  check(true, file + ' openTextInNewSession 可提取')
  let ensureSrc
  try { ensureSrc = extractEnsureWorkspaceId(src) } catch(e) { check(false, file + ' ensureWorkspaceId 可提取 — ' + e.message); return }
  check(true, file + ' ensureWorkspaceId 可提取')
  // #636 拆分：ensureWorkspaceId 只是薄转发，真实逻辑在 api-workspace.js；下面沙箱把两段拼在一起跑。
  let wsLib = ''
  try { wsLib = extractWorkspaceBlock(src).replace(/^\s*export\s+/gm, '') } catch (eWs) { wsLib = '' }

  // d) 沙箱：ensureWorkspaceId
  try {
    // 构造一个可独立执行的 ensureWorkspaceId 沙箱（薄转发 + 工作区查找块拼合执行）
    // 需要 keyOf, workspaces, etc. 我们用 Function 注入
    const ensureFnSrc = wsLib + '\n' + ensureSrc.replace(/^\s*const ensureWorkspaceId/, 'const ensureWorkspaceId')
    // 测试 1：命中已有工作区
    {
      const workspacesStub = {
        list: { getSnapshot: () => ({ items: [{ path: 'D:/my-app', workspaceId: 'ws-hit' }] }) },
        create: async () => { throw new Error('should not call create when hit') }
      }
      // 手法：compileFn——本文件全靠把目标源码文本放进沙箱跑，参数名与文本分开交给 tests/lib/eval-probe.js 的共用入口，行为不变。
      const fn = compileFn(['workspaces','keyOf'], ensureFnSrc + '; return (...a) => ensureWorkspaceId(...a).then(r => (r && typeof r === "object" ? r.wid : r))')
      const ensure = fn(workspacesStub, keyOf)
      const wid = await ensure('D:/my-app')
      check(wid === 'ws-hit', file + ' ensureWorkspaceId 命中已登记 → 复用 wid')
    }
    // 测试 2：未命中则创建 {path:cwd}
    {
      let createdArg = null
      const workspacesStub = {
        list: { getSnapshot: () => ({ items: [{ path: 'D:/other', workspaceId: 'ws-other' }] }) },
        create: async (arg) => { createdArg = arg; return { workspaceId: 'ws-new' } }
      }
      // 手法：compileFn——本文件全靠把目标源码文本放进沙箱跑，参数名与文本分开交给 tests/lib/eval-probe.js 的共用入口，行为不变。
      const fn = compileFn(['workspaces','keyOf'], ensureFnSrc + '; return (...a) => ensureWorkspaceId(...a).then(r => (r && typeof r === "object" ? r.wid : r))')
      const ensure = fn(workspacesStub, keyOf)
      const wid = await ensure('D:/my-app')
      check(wid === 'ws-new' && createdArg && createdArg.path === 'D:/my-app', file + ' ensureWorkspaceId 未命中 → 创建 {path:cwd}')
    }
    // 测试 3：创建失败回落 null
    {
      const workspacesStub = {
        list: { getSnapshot: () => ({ items: [] }) },
        create: async () => { throw new Error('create failed') }
      }
      // 手法：compileFn——本文件全靠把目标源码文本放进沙箱跑，参数名与文本分开交给 tests/lib/eval-probe.js 的共用入口，行为不变。
      const fn = compileFn(['workspaces','keyOf'], ensureFnSrc + '; return (...a) => ensureWorkspaceId(...a).then(r => (r && typeof r === "object" ? r.wid : r))')
      const ensure = fn(workspacesStub, keyOf)
      const wid = await ensure('D:/my-app')
      check(wid === null, file + ' ensureWorkspaceId 创建失败 → 回落 null')
    }
    // 测试 4：alpha 兼容 — path 抛 bad-request 则重试 {cwd}
    {
      let call = 0
      const workspacesStub = {
        list: { getSnapshot: () => ({ items: [] }) },
        create: async (arg) => {
          call++
          if (arg.path) throw new Error('bad-request: unknown field path')
          if (arg.cwd) return { workspaceId: 'ws-cwd' }
          throw new Error('unexpected')
        }
      }
      // 手法：compileFn——本文件全靠把目标源码文本放进沙箱跑，参数名与文本分开交给 tests/lib/eval-probe.js 的共用入口，行为不变。
      const fn = compileFn(['workspaces','keyOf'], ensureFnSrc + '; return (...a) => ensureWorkspaceId(...a).then(r => (r && typeof r === "object" ? r.wid : r))')
      const ensure = fn(workspacesStub, keyOf)
      const wid = await ensure('D:/my-app')
      check(wid === 'ws-cwd' && call===2, file + ' ensureWorkspaceId alpha path bad-request → 回退 {cwd}')
    }
    // 测试 5：无 workspaces 服务或空 cwd → null
    {
      // 手法：compileFn——本文件全靠把目标源码文本放进沙箱跑，参数名与文本分开交给 tests/lib/eval-probe.js 的共用入口，行为不变。
      const fn = compileFn(['workspaces','keyOf'], ensureFnSrc + '; return (...a) => ensureWorkspaceId(...a).then(r => (r && typeof r === "object" ? r.wid : r))')
      const ensureNull1 = fn(null, keyOf)
      const wid1 = await ensureNull1('D:/my-app')
      check(wid1===null, file + ' ensureWorkspaceId 无 workspaces → null')
      const workspacesStub2 = { list: { getSnapshot: () => ({ items: [] }) }, create: async()=>({workspaceId:'ws'})}
      const ensure2 = fn(workspacesStub2, keyOf)
      const wid2 = await ensure2('')
      check(wid2===null, file + ' ensureWorkspaceId 空 cwd → null')
      const wid3 = await ensure2(null)
      check(wid3===null, file + ' ensureWorkspaceId null cwd → null')
    }
    // 测试 7：按编号存的对象形状与更多路径字段（真机曾因只取 snap.items 导致新会话不选中工作区，见 2026-09-14 回归）
    {
      const workspacesStub = {
        list: { getSnapshot: () => ({ byId: { ws1: { workspaceId: 'ws1', path: 'D:/my-app' } } }) },
        create: async () => ({ workspaceId: 'ws-created-wrong' })
      }
      // 手法：compileFn——本文件全靠把目标源码文本放进沙箱跑，参数名与文本分开交给 tests/lib/eval-probe.js 的共用入口，行为不变。
      const fn = compileFn(['workspaces','keyOf'], ensureFnSrc + '; return (...a) => ensureWorkspaceId(...a).then(r => (r && typeof r === "object" ? r.wid : r))')
      const ensure = fn(workspacesStub, keyOf)
      const wid = await ensure('D:/my-app')
      check(wid === 'ws1', file + ' ensureWorkspaceId 兼容按编号存的对象形状（取对象里每一项）')
    }
    {
      const workspacesStub = {
        list: { getSnapshot: () => ({ byId: {}, workspaces: [{ path: 'D:/my-app', workspaceId: 'ws-multi' }] }) },
        create: async () => ({ workspaceId: 'ws-created-wrong' })
      }
      // 手法：compileFn——本文件全靠把目标源码文本放进沙箱跑，参数名与文本分开交给 tests/lib/eval-probe.js 的共用入口，行为不变。
      const fn = compileFn(['workspaces','keyOf'], ensureFnSrc + '; return (...a) => ensureWorkspaceId(...a).then(r => (r && typeof r === "object" ? r.wid : r))')
      const ensure = fn(workspacesStub, keyOf)
      const wid = await ensure('D:/my-app')
      check(wid === 'ws-multi', file + ' ensureWorkspaceId 对象与数组共存时两边都收（不互斥丢弃）')
    }
    {
      const workspacesStub = {
        list: { getSnapshot: () => ({ items: [{ dir: 'D:/my-app', workspaceId: 'ws-dir' }] }) },
        create: async () => ({ workspaceId: 'ws-created-wrong' })
      }
      // 手法：compileFn——本文件全靠把目标源码文本放进沙箱跑，参数名与文本分开交给 tests/lib/eval-probe.js 的共用入口，行为不变。
      const fn = compileFn(['workspaces','keyOf'], ensureFnSrc + '; return (...a) => ensureWorkspaceId(...a).then(r => (r && typeof r === "object" ? r.wid : r))')
      const ensure = fn(workspacesStub, keyOf)
      const wid = await ensure('D:/my-app')
      check(wid === 'ws-dir', file + ' ensureWorkspaceId 认 dir 等更多路径字段（与设置页总览同口径）')
    }
    // 测试 6：快照多种形状兼容（items 数组、workspaces 数组）
    {
      const workspacesStub = {
        list: { getSnapshot: () => ({ workspaces: [{ path: 'D:/my-app', workspaceId: 'ws-multi' }] }) },
        create: async()=>({workspaceId:'ws-new'})
      }
      // 手法：compileFn——本文件全靠把目标源码文本放进沙箱跑，参数名与文本分开交给 tests/lib/eval-probe.js 的共用入口，行为不变。
      const fn = compileFn(['workspaces','keyOf'], ensureFnSrc + '; return (...a) => ensureWorkspaceId(...a).then(r => (r && typeof r === "object" ? r.wid : r))')
      const ensure = fn(workspacesStub, keyOf)
      const wid = await ensure('D:/my-app')
      check(wid==='ws-multi', file + ' ensureWorkspaceId 兼容 snap.workspaces 形态')
    }
    {
      const workspacesStub = {
        list: { getSnapshot: () => ({ items: [] }) }, // 空 items 应尝试创建
        create: async(arg)=>({ workspaceId: 'ws-arr' })
      }
      // 同时测试直接数组 snapshot（Array.isArray(snap) 分支）
      const workspacesStub2 = {
        list: { getSnapshot: () => ([{ path: 'D:/my-app', workspaceId: 'ws-arr2' }]) },
        create: async()=>({workspaceId:'ws-new2'})
      }
      // 手法：compileFn——本文件全靠把目标源码文本放进沙箱跑，参数名与文本分开交给 tests/lib/eval-probe.js 的共用入口，行为不变。
      const fn = compileFn(['workspaces','keyOf'], ensureFnSrc + '; return (...a) => ensureWorkspaceId(...a).then(r => (r && typeof r === "object" ? r.wid : r))')
      const ensure = fn(workspacesStub2, keyOf)
      const wid = await ensure('D:/my-app')
      // 对于数组形态，items = snap（直接），命中 ws-arr2
      check(wid==='ws-arr2', file + ' ensureWorkspaceId 兼容数组 snapshot 形态')
    }
    // 测试 8：命中时同路返回登记项（含名单，供复用验归属防僵尸复活，见 #638 回归）
    {
      const entry = { path: 'D:/my-app', workspaceId: 'ws-entry', sessionIds: ['sid-attached'] }
      const workspacesStub = {
        list: { getSnapshot: () => ({ items: [entry] }) },
        create: async () => { throw new Error('should not call create when hit') }
      }
      const rawSrc = ensureFnSrc + '; return ensureWorkspaceId'
      // 手法：compileFn——同上。
      const fnRaw = compileFn(['workspaces','keyOf'], rawSrc)
      const ensureRaw = fnRaw(workspacesStub, keyOf)
      const found = await ensureRaw('D:/my-app')
      check(found && found.wid === 'ws-entry', file + ' ensureWorkspaceId 命中同路返回 wid')
      check(found && found.entry && Array.isArray(found.entry.sessionIds) && found.entry.sessionIds[0] === 'sid-attached', file + ' ensureWorkspaceId 命中同路返回登记项名单')
    }
  } catch(e) { check(false, file + ' ensureWorkspaceId 沙箱 — ' + e.stack) }

  // e) 沙箱：buildCreateOpts
  try {
    let block = factoryBlock.replace(/^\s*export\s+/gm, '')
    const fnBuildSrc = block.slice(block.indexOf('const buildCreateOpts'), block.indexOf('const createPTCSession'))
    // 手法：compileFn——同上，这里没有额外参数要传，给空的名字数组。
    const vmBuild = compileFn([], fnBuildSrc + '; return { buildCreateOpts }')()
    const withWid = vmBuild.buildCreateOpts('ws-123', 'D:/repo')
    check(withWid.workspaceId === 'ws-123' && withWid.agentPreset === 'ptc' && !withWid.cwd, file + ' buildCreateOpts(有 wid) → {workspaceId,ptc}（互斥）')
    const withCwd = vmBuild.buildCreateOpts(null, 'D:/repo')
    check(withCwd.cwd === 'D:/repo' && withCwd.agentPreset === 'ptc' && !withCwd.workspaceId, file + ' buildCreateOpts(无 wid) → {cwd,ptc}')
    const emptyCwd = vmBuild.buildCreateOpts(null, '')
    check(emptyCwd.cwd === '' && emptyCwd.agentPreset === 'ptc', file + ' buildCreateOpts(空 cwd) 仍含 ptc（不漂移）')
    const withBoth = vmBuild.buildCreateOpts('ws-9', 'D:/repo')
    check(withBoth.workspaceId === 'ws-9' && withBoth.agentPreset === 'ptc' && !withBoth.cwd, file + ' buildCreateOpts 优先 workspaceId 互斥 cwd')
  } catch(e) { check(false, file + ' buildCreateOpts 沙箱 — ' + e.message) }

  // f) 沙箱：createPTCSession
  try {
    let block = factoryBlock.replace(/^\s*export\s+/gm, '')
    const cStart = block.indexOf('const createPTCSession')
    const cEnd = block.indexOf(NAMING_GUARD_ANCHOR)
    const createBlock = cStart>=0 ? block.slice(cStart, cEnd>=0 ? cEnd : block.length) : ''
    // 提取 buildCreateOpts 以供 createPTCSession 使用
    const buildSrc = block.slice(block.indexOf('const buildCreateOpts'), block.indexOf('const createPTCSession'))
    // 更直接的 sandbox：运行 createPTCSession 的真实逻辑（注入 buildCreateOpts + 按编号缓存的 storeOf）
    const mkStoreOf = () => { const m = {}; const f = (sid) => (m[sid] || (m[sid] = { incomingDraft: null })); f.map = m; return f }
    {
      // 用真实的 factory 逻辑沙箱
      const sessionsOk = {
        create: async (opts)=>{
          if (!opts.agentPreset || opts.agentPreset!=='ptc') throw new Error('missing ptc')
          if (opts.workspaceId && opts.cwd) throw new Error('bad-request: workspaceId or cwd, not both')
          return 'sid-ok'
        }
      }
      const block2 = buildSrc + ';\n' + createBlock
      // 构造执行环境：storeOf 按编号缓存替身，写进哪个目标事后可查
      const storeOfStub = mkStoreOf()
      // 手法：compileFn——同上，沙箱参数名收进数组。
      const exec = compileFn(['sessions','workspaceId','cwd','text','storeOf'],
        buildSrc + ';\n'
        + createBlock.replace(/return sessions\.create/, 'return sessions.create')
        + '\nreturn createPTCSession(sessions, workspaceId, cwd, text).then(sid=>({sid, draft: storeOf(sid).incomingDraft}));'
      )
      const res = await exec(sessionsOk, 'ws-1', 'D:/repo', '/wayfinder #1', storeOfStub)
      check(res.sid==='sid-ok' && res.draft==='/wayfinder #1', file + ' createPTCSession 有 wid → {workspaceId,ptc} 且原子写入目标 store')
      const res2 = await exec(sessionsOk, null, 'D:/repo', '/wayfinder #2', storeOfStub)
      check(res2.sid==='sid-ok' && storeOfStub.map['sid-ok'].incomingDraft==='/wayfinder #2', file + ' createPTCSession 无 wid → {cwd,ptc} 且原子写入目标 store')
    }
    // 回退：workspaceId 失败 → 回落 cwd+ptc
    {
      const sessionsFailWid = {
        create: async (opts)=>{
          if (opts.workspaceId) throw new Error('bad-request: workspaceId unknown')
          if (opts.cwd) return 'sid-fb'
          throw new Error('unexpected')
        }
      }
      const blockExec = buildSrc + ';\n' + createBlock
      const storeOfStubFb = mkStoreOf()
      // 手法：compileFn——同上，沙箱参数名收进数组。
      const exec = compileFn(['sessions','workspaceId','cwd','text','storeOf'],
        buildSrc + ';\n' + createBlock
        + '\nreturn createPTCSession(sessions, workspaceId, cwd, text).then(sid=>({sid, draft: storeOf(sid).incomingDraft}));'
      )
      const res = await exec(sessionsFailWid, 'ws-bad', 'D:/repo', '/wayfinder fallback', storeOfStubFb)
      check(res.sid==='sid-fb' && res.draft==='/wayfinder fallback', file + ' createPTCSession workspaceId 失败 → 回落 cwd+ptc 仍写入目标 store')
    }
    // 回退：agentPreset 更名 → presetId
    {
      const sessionsFailPreset = {
        create: async (opts)=>{
          if (opts.agentPreset) throw new Error('bad-request: unknown field agentPreset')
          if (opts.presetId==='ptc') return 'sid-preset'
          throw new Error('unexpected opts '+JSON.stringify(opts))
        }
      }
      const storeOfStubPreset = mkStoreOf()
      // 手法：compileFn——同上，沙箱参数名收进数组。
      const exec = compileFn(['sessions','workspaceId','cwd','text','storeOf'],
        buildSrc + ';\n' + createBlock
        + '\nreturn createPTCSession(sessions, workspaceId, cwd, text).then(sid=>({sid, draft: storeOf(sid).incomingDraft}));'
      )
      const res = await exec(sessionsFailPreset, 'ws-1', 'D:/repo', '/wayfinder preset', storeOfStubPreset)
      check(res.sid==='sid-preset' && res.draft==='/wayfinder preset', file + ' createPTCSession agentPreset 更名 → presetId 回退仍写入目标 store')
    }
  } catch(e) { check(false, file + ' createPTCSession 沙箱 — ' + e.stack) }

  // g) 沙箱：openTextInNewSession 工作区回退集成
  try {
    const mkStoreOfG = () => { const m = {}; const f = (sid) => (m[sid] || (m[sid] = { incomingDraft: null })); f.map = m; return f }
    let factory = factoryBlock.replace(/^\s*export\s+/gm, '')
    const helpersSrc = factory.slice(factory.indexOf('const getRowPreset'), factory.indexOf('const buildCreateOpts'))
    // #636：薄转发要找到 resolveWorkspaceEntry，沙箱里把它前面拼上（与真实闭包里的拼接次序一致）。
    const wsPrelude = wsLib ? wsLib + ';\n' : ''
    let open = openSrc
    open = open.replace(/\bpendingDraft\b/g, '__dbg.pendingDraft')
    open = open.replace(/\bpendingDraftTargetSid\b/g, '__dbg.pendingDraftTargetSid')
    const fullOpenHelpers = helpersSrc + ';\n' + factory.slice(factory.indexOf('const buildCreateOpts'), factory.indexOf(NAMING_GUARD_ANCHOR))

    async function runOpen(stOverrides, sessionsStub, workspacesStub) {
      const rec = { created: null, opened: null, injected: null, flashed: null }
      const dbg = { pendingDraft: null, pendingDraftTargetSid: null }
      const defaultWorkspacesStub = workspacesStub || { list: { getSnapshot: ()=>({ items: [{ path: 'D:/my-app', workspaceId: 'ws1' }] }) }, create: async()=>({workspaceId:'ws1'}) }
      const defaultSessionsStub = sessionsStub || {
        create: async (opts)=>{ rec.created = JSON.parse(JSON.stringify(opts)); return 'sid-new' },
        scope: (sid)=>({sessionId: sid}),
        sessionOf: ()=>({ rename: async (t)=>({ok:true, value:{title:t}}) }),
        open: (sid)=>{ rec.opened = sid },
        list: { getSnapshot: ()=>({ byId: {} }) }
      }
      const st = Object.assign({ sessionId: 'sess-1', cwd: 'D:/my-app', snapshot: null }, stOverrides)
      // host 实现 wf.cwd 兜底
      const hostStub = { call: async (m, args)=>{ if(m==='wf.cwd') return {ok:true, cwd:'D:/my-app'}; if(m==='wf.registerNewSessionWatcher') return {}; return {ok:true} } }
      // 手法：compileFn——同上。
      const fn = compileFn(['st','text','title','ctx','host','__dbg','inject','flash','tr','getCwdSync','keyOf','storeOf','hydrateFromCache','getCachedSnapshot','namingHintOf','isNewPlaceholderTitle','namingGuardianKick'],
        wsPrelude + helpersSrc + ';\n' + fullOpenHelpers + ';\n' + open + '; return openTextInNewSession'
      )
      const openFn = fn(st,'/wayfinder https://github.com/x/issues/1','[#1] test',
        { get:(k)=> k==='sessions'?defaultSessionsStub:k==='workspaces'?defaultWorkspacesStub:null },
        hostStub, dbg,
        (s, txt)=>{ rec.injected = txt }, (s, msg, lvl)=>{ rec.flashed = lvl }, (k)=>k, ()=>null, keyOf, ()=>({cwd: 'D:/my-app', snapshot:null}), ()=>false, ()=>null, ()=>null, (t)=>/^\[New\] /.test(String(t)), ()=>{}
      )
      openFn(st,'/wayfinder https://github.com/x/issues/1','[#1] test')
      await new Promise(r=>setTimeout(r, 80))
      return { rec, dbg, st }
    }

    // 场景 A：cwd 缺失 → 走 fallback 注入（不创建）
    {
      const sessionsStub = {
        create: async (opts)=>{ return 'sid-new' },
        scope: (sid)=>({sessionId: sid}),
        sessionOf: ()=>({ rename: async(t)=>({ok:true,value:{title:t}}) }),
        open: ()=>{},
        list: { getSnapshot: ()=>({ byId: {} }) }
      }
      const workspacesStub = { list: { getSnapshot: ()=>({ items: [] }) }, create: async()=>({workspaceId:'ws'})}
      // 通过让 getCwdSync 和 st.cwd 都为空，且 host 不可用，来触发 ensureCwd null
      let openA = openSrc
      openA = openA.replace(/\bpendingDraft\b/g, '__dbg.pendingDraft')
      openA = openA.replace(/\bpendingDraftTargetSid\b/g, '__dbg.pendingDraftTargetSid')
      const helpers = helpersSrc
      const factoryAll = factory.slice(factory.indexOf('const buildCreateOpts'), factory.indexOf(NAMING_GUARD_ANCHOR))
      const rec = { created:null, injected:null }
      const dbg = { pendingDraft:null, pendingDraftTargetSid:null }
      // 手法：compileFn——同上。
      const fn = compileFn(['st','text','title','ctx','host','__dbg','inject','flash','tr','getCwdSync','keyOf','storeOf','hydrateFromCache','getCachedSnapshot','namingHintOf','isNewPlaceholderTitle','namingGuardianKick'],
        wsPrelude + helpers + ';\n' + factoryAll + ';\n' + openA + '; return openTextInNewSession')
      const st = { sessionId: 's1', cwd: '', snapshot: null }
      const openFn = fn(st, '/wayfinder https://github.com/x/issues/1','[#1] test',
        { get:(k)=> k==='sessions'?sessionsStub:k==='workspaces'?workspacesStub:null },
        { call: async()=>({ok:false}) }, dbg,
        (s, txt)=>{ rec.injected = txt }, ()=>{}, (k)=>k, ()=>null, keyOf, ()=>({}), ()=>false, ()=>null, ()=>null, (t)=>/\[New\]/.test(String(t)), ()=>{}
      )
      openFn(st,'/wayfinder https://github.com/x/issues/1','[#1] test')
      await new Promise(r=>setTimeout(r, 60))
      check(rec.created===null && rec.injected==='/wayfinder https://github.com/x/issues/1', file + ' 集成：cwd 缺失 → fallback 注入（不创建）')
    }

    // 场景 B：workspaces.create 失败但 cwd 有 → 走 {cwd,ptc} 创建（非 fallback 注入）
    {
      const sessionsStub = {
        create: async (opts)=>{
          // 期望是 cwd+ptc，因为 wid 为 null
          if (opts.cwd==='D:/my-app' && opts.agentPreset==='ptc' && !opts.workspaceId) return 'sid-cwd'
          throw new Error('unexpected opts '+JSON.stringify(opts))
        },
        scope:(sid)=>({sessionId:sid}), sessionOf:()=>({rename: async(t)=>({ok:true,value:{title:t}})}),
        open:(sid)=>{},
        list:{ getSnapshot: ()=>({ byId: {} }) }
      }
      const workspacesStub = {
        list: { getSnapshot: ()=>({ items: [] }) },
        create: async()=>{ throw new Error('create failed') }
      }
      const helpers = helpersSrc
      const factoryAll = factory.slice(factory.indexOf('const buildCreateOpts'), factory.indexOf(NAMING_GUARD_ANCHOR))
      let openB = openSrc.replace(/\bpendingDraft\b/g, '__dbg.pendingDraft').replace(/\bpendingDraftTargetSid\b/g, '__dbg.pendingDraftTargetSid')
      const rec = { created: null }
      const dbg = { pendingDraft:null, pendingDraftTargetSid:null }
      const st = { sessionId:'s1', cwd:'D:/my-app', snapshot:null }
      // 手法：compileFn——同上。
      const fn = compileFn(['st','text','title','ctx','host','__dbg','inject','flash','tr','getCwdSync','keyOf','storeOf','hydrateFromCache','getCachedSnapshot','namingHintOf','isNewPlaceholderTitle','namingGuardianKick'],
        wsPrelude + helpers + ';\n' + factoryAll + ';\n' + openB + '; return openTextInNewSession')
      let createdSid=null
      const sessionsStub2 = {
        create: async (opts)=>{ rec.created = opts; createdSid = 'sid-cwd'; return createdSid },
        scope:(sid)=>({sessionId:sid}), sessionOf:()=>({rename: async(t)=>({ok:true,value:{title:t}})}),
        open:(sid)=>{ rec.opened=sid },
        list:{ getSnapshot: ()=>({ byId: {} }) }
      }
      const hostStub = { call: async()=>({ok:true}) }
      const storeOfStubB = mkStoreOfG()
      const openFn = fn(st, '/wayfinder https://github.com/x/issues/1','[#1] test',
        { get:(k)=> k==='sessions'?sessionsStub2:k==='workspaces'?workspacesStub:null },
        hostStub, dbg,
        ()=>{}, ()=>{}, (k)=>k, ()=>null, keyOf, storeOfStubB, ()=>false, ()=>null, ()=>null, (t)=>/\[New\]/.test(String(t)), ()=>{}
      )
      openFn(st,'/wayfinder https://github.com/x/issues/1','[#1] test')
      await new Promise(r=>setTimeout(r, 80))
      check(rec.created && rec.created.cwd==='D:/my-app' && rec.created.agentPreset==='ptc', file + ' 集成：workspaces.create 失败 → 回落 {cwd,ptc} 创建')
      check(storeOfStubB.map['sid-cwd'] && storeOfStubB.map['sid-cwd'].incomingDraft==='/wayfinder https://github.com/x/issues/1', file + ' 集成：回落创建仍原子写入目标 store')
    }

    // 场景 C：命中已有工作区 → 走 {workspaceId,ptc}
    {
      const workspacesStub = {
        list: { getSnapshot: ()=>({ items: [{ path:'D:/my-app', workspaceId:'ws-hit' }] }) },
        create: async()=>{ throw new Error('should not create') }
      }
      const rec = { created:null }
      const dbg = { pendingDraft:null, pendingDraftTargetSid:null }
      const st = { sessionId:'s1', cwd:'D:/my-app', snapshot:null }
      let openC = openSrc.replace(/\bpendingDraft\b/g, '__dbg.pendingDraft').replace(/\bpendingDraftTargetSid\b/g, '__dbg.pendingDraftTargetSid')
      // 手法：compileFn——同上。
      const fn = compileFn(['st','text','title','ctx','host','__dbg','inject','flash','tr','getCwdSync','keyOf','storeOf','hydrateFromCache','getCachedSnapshot','namingHintOf','isNewPlaceholderTitle','namingGuardianKick'],
        wsPrelude + helpersSrc + ';\n' + factory.slice(factory.indexOf('const buildCreateOpts'), factory.indexOf(NAMING_GUARD_ANCHOR)) + ';\n' + openC + '; return openTextInNewSession')
      const sessionsStub = {
        create: async (opts)=>{ rec.created=opts; return 'sid-wid' },
        scope:(sid)=>({sessionId:sid}), sessionOf:()=>({rename: async(t)=>({ok:true,value:{title:t}})}),
        open:(sid)=>{ rec.opened=sid },
        list:{ getSnapshot: ()=>({ byId: {} }) }
      }
      const storeOfStubC = mkStoreOfG()
      const openFn = fn(st,'/wayfinder https://github.com/x/issues/1','[#1] test',
        { get:(k)=> k==='sessions'?sessionsStub:k==='workspaces'?workspacesStub:null },
        { call: async()=>({ok:true}) }, dbg,
        ()=>{}, ()=>{}, (k)=>k, ()=>null, keyOf, storeOfStubC, ()=>false, ()=>null, ()=>null, (t)=>/\[New\]/.test(String(t)), ()=>{}
      )
      openFn(st,'/wayfinder https://github.com/x/issues/1','[#1] test')
      await new Promise(r=>setTimeout(r, 80))
      check(rec.created && rec.created.workspaceId==='ws-hit' && rec.created.agentPreset==='ptc', file + ' 集成：命中工作区 → {workspaceId,ptc} 创建')
      check(storeOfStubC.map['sid-wid'] && storeOfStubC.map['sid-wid'].incomingDraft==='/wayfinder https://github.com/x/issues/1', file + ' 集成：命中创建仍写入目标 store 首条')
    }
  } catch(e) { check(false, file + ' 集成沙箱 — ' + e.stack) }
}

async function main() {
  console.log('== #364 工作区回退与首条注入保真（兼容 alpha 新参）==')
  for (const f of files) await testFile(f)
  if (failed) { console.log('\nFAIL ' + total + ' checks, some failed'); process.exit(1) }
  else { console.log('\nPASS all ' + total + ' checks') }
}
main()