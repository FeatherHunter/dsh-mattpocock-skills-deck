// tests/verify-newsession-preset-guard.js — #362 可判定门禁 + #363 单点工厂（2026-09-01 定版）
// 用法: node tests/verify-newsession-preset-guard.js [file...]（默认 src 源 + package/lib/client.js 双源）
//
// 验收标准（#362 三判据合取 + #361 闸门 + #363 单点工厂）：
//  d) 沙箱：buildCreateOpts(workspaceId,cwd) 两分支均返回携带 ptc 的入参
//  e) 沙箱：isReusableBlank 对 code/空/跨区 拒绝，对健康同区 允许（#361 §闸门谓词）
//  g) 沙箱：openTextInNewSession 集成闸门——喂 code/空/跨区幽灵快照必走新建（非复用），健康同区可复用
//  h) 双源一致（src 与构建产物逐字 splice 保留）
//  i) #478 创建后验：verifyFreshPreset 明确 code/broken 判 bad（读不到判 unknown 不阻断）；createVerifiedPTCSession 首坏隔离重建、双坏抛 preset-blocked；open 绝不 open code，双坏大声失败回当前会话
//
// 2026-10-12 修订：原来还有 a/b/c 三条「静態：源码必含某段字」和 f 的轻量文本判定，它们读源码文本钉写法，
//   等价重构（改写法、搬文件、改注释）就会变红，已连同只服务它们的读取语句与临时变量一并删掉。
//   上面 d/e/g 是沙箱里真跑代码，h/i 是双源与创建后验，一条都没动。
//
// 本测试与 verify-newsession-blank-seed-315.js 同范式：从目标文件提取真实源码并在沙箱以忠实替身执行，
// 能抓住“逻辑改坏 / 双源漂移”两类回归。
const fs = require('fs')
// 本文件选 compileFn 手法：五处沙箱都是把真源码文本当函数体造函数，依赖一律按参数名显式传进去，不靠外层作用域。
const { compileFn } = require('./lib/eval-probe.js')

const API_SRC_FILES = ['src/client/kernel/api-naming.js', 'src/client/kernel/api-workspace.js', 'src/client/kernel/api-new-session.js', 'src/client/kernel/api-io.ts', 'src/client/kernel/api-preset-guard.js'] // #457 K4 + #478 + #636：api 拆分文件 + 预设守卫模块 + 工作区查找模块，src 侧读五文件拼合（守卫块经独立锚点提取；api-io 于 #1111 转成 .ts，锚点写在源码里）
const files = process.argv.slice(2).length ? process.argv.slice(2) : ['src/client/kernel/api-naming.js+api-workspace.js+api-new-session.js+api-io.js+api-preset-guard.js（拼合）', 'package/lib/client.js']
const readTestSrc = (file) => file.indexOf('（拼合）') >= 0 ? API_SRC_FILES.map((f) => fs.readFileSync(f, 'utf8')).join('\n') : fs.readFileSync(file, 'utf8') // #457 K4：拼合含 openText/工厂/回退/工作区查找全量（跨 naming、workspace 与 new-session，单文件含不全）
const testExists = (file) => file.indexOf('（拼合）') >= 0 ? API_SRC_FILES.every((f) => fs.existsSync(f)) : fs.existsSync(file) // #457 K4：五文件全存在才算存在

function extractOpenFn(src) {
  const marker = 'const openTextInNewSession = function (st, text, title'
  const src2 = src.indexOf(marker) >= 0 ? src : src.replace(/export const openTextInNewSession/, 'const openTextInNewSession')
  const i = src2.indexOf(marker)
  if (i < 0) throw new Error('起始锚点缺失: openTextInNewSession')
  // 终止锚点写成 `//!`（法律注释）：api-io 转成 TypeScript 之后由 esbuild 出产物，普通注释会被去掉，
  // 只有 `//!` 这一种能一路留到 package/lib/client.js，源与产物两条腿才能用同一个锚点（#1111）。
  const j = src2.indexOf('//! #361 原入口：行级「在新会话打开」保留', i)
  if (j < 0) throw new Error('终止锚点缺失: #361 注释')
  return src2.slice(i, j)
}

function extractFactoryBlock(src) {
  const start = src.indexOf('// ============ 单点工厂 createPTCSession 原子化')
  const end = src.indexOf('// ============ 命名守护', start)
  if (start < 0 || end < 0) throw new Error('工厂块锚点缺失')
  return src.slice(start, end)
}

// #636 拆分：工作区查找住在 api-workspace.js；沙箱跑薄转发时要把它拼在前面（与真实闭包拼接次序一致）。
function extractWorkspaceBlock(src) {
  const startMarker = 'const workspacePathOf = function'
  const endMarker = 'const probeHandoffReady = function'
  const i = src.indexOf(startMarker)
  if (i < 0) throw new Error('工作区查找起始缺失: workspacePathOf')
  const j = src.indexOf(endMarker, i)
  if (j < 0) throw new Error('工作区查找终止缺失: probeHandoffReady')
  return src.slice(i, j).replace(/^\s*export\s+/gm, '')
}

let failed = false
let total = 0
function check(ok, msg) {
  total++
  console.log((ok ? '  PASS ' : '  FAIL ') + msg)
  if (!ok) failed = true
}

// 简易 keyOf 复刻（与 src/shared/workspaceKey.js 同形，大小写/斜杠归一）
function keyOf(raw) {
  if (raw == null) return ''
  let s = String(raw).trim()
  if (!s) return ''
  let isWin = /^[a-zA-Z]:[\\\/]/.test(s) || s.indexOf('\\\\') >= 0 || s.indexOf('\\') >=0
  // 简化：走 win 分支统一转小写与正斜杠，posix 保留大小写仅斜杠归一
  // 为复刻测试，仅用 win 逻辑（小写+斜杠折叠）以匹配 isReusableBlank 的 fallback
  s = s.replace(/\\\\/g, '/').replace(/\\/g, '/')
  // isWin 判断后需按 win 处理：此处统一按 win 小写折叠，确保跨平台一致
  s = s.replace(/\\/g, '/')
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
  let openSrc
  try { openSrc = extractOpenFn(src) } catch(e) { check(false, file + ' openTextInNewSession 源码可提取 — ' + e.message); return }
  check(true, file + ' openTextInNewSession 源码可提取（锚点保留）')
  let factoryBlock
  try { factoryBlock = extractFactoryBlock(src) } catch(e) { check(false, file + ' 工厂块可提取 — ' + e.message); return }
  check(true, file + ' 单点工厂块可提取')
  let wsLib = ''
  try { wsLib = extractWorkspaceBlock(src) } catch(eWs) { check(false, file + ' 工作区查找块可提取 — ' + eWs.message); return }
  // #478 预设守卫块经独立锚点提取（拼合源含守卫模块；双产物经构建拼接同样含该块）
  const presetGuardMarker = '// ============ 预设守卫'
  let presetGuardSrc = ''
  const pgStart = src.indexOf(presetGuardMarker)
  if (pgStart >= 0) {
    // 构建产物中守卫块后还有后续模块（拼接标记构建时被消费，无残留），必须截到后一模块开头为止，
    // 否则会把后半个闭包全吞进来导致沙箱重声明；拼合源里守卫是最后一块，自然截到末尾。
    // #636 起守卫后面紧邻的是工作区查找模块，故把它的首行也列为终止锚点。
    const pgAfter = pgStart + presetGuardMarker.length
    const pgEnds = ['probeHandoffReady = function', 'workspacePathOf = function', '// ==== kernel:', '// ==== leaf:', '// ==== shared:']
      .map((k) => src.indexOf(k, pgAfter)).filter((i) => i >= 0)
    let pgStop = pgEnds.length ? Math.min.apply(null, pgEnds) : src.length
    // 命中点可能在行中部（如 const probeHandoffReady 的 const 前缀），必须回退到行首，否则切出半截行
    const pgLineStart = src.lastIndexOf('\n', pgStop)
    if (pgLineStart >= pgStart) pgStop = pgLineStart
    presetGuardSrc = src.slice(pgStart, pgStop)
  }

  // d) 沙箱：buildCreateOpts
  try {
    let block = factoryBlock
    block = block.replace(/^\s*export\s+/gm, '')
    // 去掉注释行首的 export 残留后，提取两个 helper 的源码文本
    const fnBuildSrc = block.slice(block.indexOf('const buildCreateOpts'), block.indexOf('const createPTCSession'))
    // 本处走 compileFn：这段工厂源码不引用外层变量，参数名给空数组。
    const vmBuild = compileFn([], fnBuildSrc + '; return { buildCreateOpts }')()
    const withWid = vmBuild.buildCreateOpts('ws-123', 'D:/repo')
    check(withWid.workspaceId === 'ws-123' && withWid.agentPreset === 'ptc' && !withWid.cwd, file + ' buildCreateOpts(有 wid) → {workspaceId,ptc}')
    const withCwd = vmBuild.buildCreateOpts(null, 'D:/repo')
    check(withCwd.cwd === 'D:/repo' && withCwd.agentPreset === 'ptc' && !withCwd.workspaceId, file + ' buildCreateOpts(无 wid) → {cwd,ptc}')
    const withBoth = vmBuild.buildCreateOpts('ws-9', 'D:/repo')
    check(withBoth.workspaceId === 'ws-9' && withBoth.agentPreset === 'ptc', file + ' buildCreateOpts 优先 workspaceId')
  } catch(e) { check(false, file + ' buildCreateOpts 沙箱 — ' + e.message) }

  // e) 沙箱：isReusableBlank
  try {
    let block = factoryBlock.replace(/^\s*export\s+/gm, '')
    // 提取 isReusableBlank 依赖的两个小函数
    const getPresetSrc = block.slice(block.indexOf('const getRowPreset'), block.indexOf('const isHealthyPreset'))
    const healthySrc = block.slice(block.indexOf('const isHealthyPreset'), block.indexOf('const isReusableBlank'))
    const reusableSrc = block.slice(block.indexOf('const isReusableBlank'), block.indexOf('const buildCreateOpts'))
    const guardHelpersSrc = presetGuardSrc.replace(/^\s*export\s+/gm, '')
    // 换行再接 return：截断点可能落在一条行注释上（如 api-workspace 首行注释），
    // 若直接拼 '; return ...' 会被并进那条注释，函数就没有返回值。
    // 本处走 compileFn：这些助手函数只认一个 keyOf，照旧按参数名传进去。
    const helpers = compileFn(['keyOf'], getPresetSrc + healthySrc + reusableSrc + guardHelpersSrc + '\n; return { getRowPreset, isHealthyPreset, isReusableBlank, describeReuseDecision, verifyFreshPreset, tryQuarantineSession, createVerifiedPTCSession }')(keyOf)
    const normTarget = keyOf('D:/my-app')
    // 准备 row 变体
    const healthySame = { blank: true, cwd: 'D:/my-app', projectionValues: { agentPreset: 'ptc' }, updatedAt: 1 }
    const codeSame = { blank: true, cwd: 'D:/my-app', projectionValues: { agentPreset: 'code' }, updatedAt: 2 }
    const emptyCwd = { blank: true, cwd: '', projectionValues: { agentPreset: 'ptc' }, updatedAt: 3 }
    const crossHealthy = { blank: true, cwd: 'D:/other', projectionValues: { agentPreset: 'ptc' }, updatedAt: 4 }
    const nonBlank = { blank: false, cwd: 'D:/my-app', projectionValues: { agentPreset: 'ptc' }, updatedAt: 5 }
    const headerCodeFallback = { blank: true, cwd: 'D:/my-app', header: { agentPreset: 'code' }, updatedAt: 6 }
    const emptyTargetHealthy = { blank: true, cwd: '', projectionValues: { agentPreset: 'ptc' } }
    check(helpers.isReusableBlank(healthySame, normTarget) === true, file + ' isReusableBlank 健康同区 → 可复用')
    check(helpers.isReusableBlank(codeSame, normTarget) === false, file + ' isReusableBlank code 同区 → 不可复用（幽灵拒绝）')
    check(helpers.isReusableBlank(emptyCwd, normTarget) === false, file + ' isReusableBlank 空 cwd → 不可复用（空隔离）')
    check(helpers.isReusableBlank(crossHealthy, normTarget) === false, file + ' isReusableBlank 跨区健康 → 不可复用（工作区隔离）')
    check(helpers.isReusableBlank(nonBlank, normTarget) === false, file + ' isReusableBlank 非空白 → 不可复用')
    check(helpers.isReusableBlank(headerCodeFallback, normTarget) === false, file + ' isReusableBlank header code 回退 → 不可复用')
    check(helpers.isReusableBlank(emptyTargetHealthy, keyOf('')) === false, file + ' isReusableBlank 空对空 → 不可复用（悬空桶不续命）')
    // #478 未知即不可复用：预设读不到或空一律不可复用（投影未到瞬间不得放行）
    const emptyPresetSame = { blank: true, cwd: 'D:/my-app', projectionValues: { agentPreset: '' }, updatedAt: 7 }
    const missingPresetSame = { blank: true, cwd: 'D:/my-app', updatedAt: 8 }
    const whitespacePresetSame = { blank: true, cwd: 'D:/my-app', projectionValues: { agentPreset: '   ' }, updatedAt: 9 }
    const brokenSame = { blank: true, cwd: 'D:/my-app', projectionValues: { agentPreset: 'broken' }, updatedAt: 10 }
    check(helpers.isReusableBlank(emptyPresetSame, normTarget) === false, file + ' isReusableBlank 空预设同区 → 不可复用（#478 未知即不可复用）')
    check(helpers.isReusableBlank(missingPresetSame, normTarget) === false, file + ' isReusableBlank 缺预设字段同区 → 不可复用（#478 未知即不可复用）')
    check(helpers.isReusableBlank(whitespacePresetSame, normTarget) === false, file + ' isReusableBlank 空白预设同区 → 不可复用（#478 未知即不可复用）')
    check(helpers.isReusableBlank(brokenSame, normTarget) === false, file + ' isReusableBlank broken 同区 → 不可复用（#478）')
    check(helpers.isHealthyPreset('') === false && helpers.isHealthyPreset(null) === false && helpers.isHealthyPreset(undefined) === false, file + ' isHealthyPreset 空/缺 → 不健康（#478）')
    // #478 创建后验语义：明确 code/broken 判 bad，读不到判 unknown（快照滞后不阻断）
    const mkSess = (byId, live) => ({ get: (live === undefined ? undefined : function () { return live }), list: { getSnapshot: () => ({ byId: byId }) } })
    check(helpers.verifyFreshPreset(mkSess({ s1: { projectionValues: { agentPreset: 'code' } } }), 's1') === 'bad', file + ' verifyFreshPreset code 行 → bad（#478）')
    check(helpers.verifyFreshPreset(mkSess({ s1: { projectionValues: { agentPreset: 'broken' } } }), 's1') === 'bad', file + ' verifyFreshPreset broken 行 → bad（#478）')
    check(helpers.verifyFreshPreset(mkSess({ s1: { projectionValues: { agentPreset: 'ptc' } } }), 's1') === 'ok', file + ' verifyFreshPreset ptc 行 → ok（#478）')
    check(helpers.verifyFreshPreset(mkSess({}, undefined), 's9') === 'unknown', file + ' verifyFreshPreset 快照无此行 → unknown（#478 快照滞后不阻断）')
    check(helpers.verifyFreshPreset({}, 's9') === 'unknown', file + ' verifyFreshPreset 无快照能力 → unknown（#478）')
    check(helpers.verifyFreshPreset(mkSess({ s1: { projectionValues: { agentPreset: 'ptc' } } }, { agentPreset: 'code' }), 's1') === 'bad', file + ' verifyFreshPreset 实时对象 code 覆盖快照 → bad（#478）')
    check(helpers.tryQuarantineSession({ close: function () { return { ok: true } } }, 's1') === true, file + ' tryQuarantineSession 有 close 能力 → 隔离 true（#478）')
    check(helpers.tryQuarantineSession({}, 's1') === false, file + ' tryQuarantineSession 无关闭能力 → false 但不抛（#478）')
    check(helpers.tryQuarantineSession(null, 's1') === false, file + ' tryQuarantineSession 空 sessions → false（#478）')
    // #478 后验编排直测：好会话直接返回；首坏隔离重建后返回好的；双坏抛 preset-blocked
    try {
      const okSess = { list: { getSnapshot: () => ({ byId: { a: { projectionValues: { agentPreset: 'ptc' } } } }) } }
      const sidOk = await helpers.createVerifiedPTCSession(() => Promise.resolve('a'), okSess)
      check(sidOk === 'a', file + ' 后验编排：好会话直接返回（#478）')
      const mixClosed = []
      const mixSess = { close: (sid) => { mixClosed.push(sid); return { ok: true } }, list: { getSnapshot: () => ({ byId: { b1: { projectionValues: { agentPreset: 'code' } }, b2: { projectionValues: { agentPreset: 'ptc' } } } }) } }
      let n = 0
      const sidMix = await helpers.createVerifiedPTCSession(() => Promise.resolve(n++ === 0 ? 'b1' : 'b2'), mixSess)
      check(sidMix === 'b2' && mixClosed.indexOf('b1') >= 0, file + ' 后验编排：首坏隔离重建后返回好的（#478）')
      const badSess = { list: { getSnapshot: () => ({ byId: { c1: { projectionValues: { agentPreset: 'code' } }, c2: { projectionValues: { agentPreset: 'code' } } } }) } }
      let m = 0
      let threw = null
      try { await helpers.createVerifiedPTCSession(() => Promise.resolve(m++ === 0 ? 'c1' : 'c2'), badSess) } catch (e9) { threw = e9 }
      check(threw && String(threw.message).indexOf('preset-blocked') >= 0, file + ' 后验编排：双坏抛 preset-blocked（#478）')
    } catch (eO) { check(false, file + ' 后验编排直测 — ' + (eO && eO.stack || eO)) }
    // 最久择优仍受闸门约束：多候选中仅健康同区可胜出
    const candidates = [codeSame, emptyCwd, crossHealthy, healthySame]
    let best = null, bestTime=-1
    for (const r of candidates) {
      if (!helpers.isReusableBlank(r, normTarget)) continue
      const t = r.updatedAt||0
      if (t>bestTime){bestTime=t; best=r}
    }
    check(best === healthySame, file + ' isReusableBlank 择优：仅健康同区胜出')
  } catch(e) { check(false, file + ' isReusableBlank 沙箱 — ' + e.stack) }

  // g) 沙箱：openTextInNewSession 集成闸门（喂快照必走新建 vs 可复用）
  try {
    // 复用 openSrc 沙箱：需注入 isReusableBlank 等 helper
    let factory = factoryBlock.replace(/^\s*export\s+/gm, '')
    const helpersSrc = factory.slice(factory.indexOf('const getRowPreset'), factory.indexOf('const buildCreateOpts')) + presetGuardSrc.replace(/^\s*export\s+/gm, '')
    let open = openSrc
    // 替换裸 pendingDraft 为可观测
    open = open.replace(/\bpendingDraft\b/g, '__dbg.pendingDraft')
    open = open.replace(/\bpendingDraftTargetSid\b/g, '__dbg.pendingDraftTargetSid')
    // 注入 helpers 到沙箱作用域：把工作区查找块与 helpersSrc 拼到 open 前（次序与真实闭包一致）
    const combined = wsLib + ';\n' + helpersSrc + ';\n' + open + '; return openTextInNewSession'
    // 构造一个可复用的沙箱运行器
    async function runWithSnap(snapById, curSid, cwd) {
      const rec = { created: null, opened: null }
      const dbg = { pendingDraft: null, pendingDraftTargetSid: null }
      const sessionsStub = {
        create: async (opts)=>{ rec.created = JSON.parse(JSON.stringify(opts)); return 'sid-new' },
        scope: (sid)=>({sessionId: sid}),
        sessionOf: ()=>({ rename: async (t)=>({ok:true, value:{title:t}}) }),
        open: (sid)=>{ rec.opened = sid },
        list: { getSnapshot: ()=>({ byId: snapById }) }
      }
      const workspacesStub = { list: { getSnapshot: ()=>({ items: [{ workspaceId: 'ws1', path: cwd }] }) }, create: async ()=>({workspaceId: 'ws1'}) }
      const st = { sessionId: curSid, cwd: cwd, snapshot: null }
      // 本处走 compileFn：把拼好的闭包文本当函数体造函数，依赖一律按参数名显式传进去（下面两段创建流程同一套依赖）。
      const fn = compileFn(['st','text','title','ctx','host','__dbg','inject','flash','tr','getCwdSync','keyOf','storeOf','hydrateFromCache','getCachedSnapshot','namingHintOf','isNewPlaceholderTitle','namingGuardianKick'],
        wsLib + ';\n' + helpersSrc + ';\n' + open + '; return openTextInNewSession'
      )
      const openFn = fn(st,'/wayfinder https://github.com/x/issues/1','[#1] test',
        { get:(k)=> k==='sessions'?sessionsStub:k==='workspaces'?workspacesStub:null },
        { call: async ()=>({ok:true}) }, dbg,
        ()=>{}, ()=>{}, (k)=>k, ()=>null, keyOf, ()=>({cwd, snapshot:null}), ()=>false, ()=>null, ()=>null, (t)=>/^\\[New\\] /.test(String(t)), ()=>{}
      )
      openFn(st,'/wayfinder https://github.com/x/issues/1','[#1] test')
      await new Promise(r=>setTimeout(r, 60))
      return { rec, dbg }
    }
    const cwdTarget = 'D:/my-app'
    const normTarget = keyOf(cwdTarget)
    // 场景1：仅 code 幽灵同区 + 空幽灵 → 应新建（不复用），且新建入参含 ptc
    {
      const snap = {
        'sid-code': { id:'sid-code', blank:true, cwd:'D:/my-app', projectionValues:{agentPreset:'code'}, updatedAt: 100 },
        'sid-empty': { id:'sid-empty', blank:true, cwd:'', projectionValues:{agentPreset:'ptc'}, updatedAt: 101 },
      }
      const { rec } = await runWithSnap(snap, 'src-sess', cwdTarget)
      check(rec.created && rec.created.agentPreset==='ptc', file + ' 集成闸门：code+空 快照 → 新建且含 ptc（不复用幽灵）')
      check(rec.created && (rec.created.workspaceId==='ws1' || rec.created.cwd===cwdTarget), file + ' 集成闸门：code+空 快照 → 新建携带工作区归属')
      check(rec.opened==='sid-new', file + ' 集成闸门：code+空 快照 → open 新 sid（非复用）')
    }
    // 场景2：存在健康同区空白 → 应复用该健康者，不走新建
    {
      const snap = {
        'sid-healthy': { id:'sid-healthy', blank:true, cwd:'D:/my-app', projectionValues:{agentPreset:'ptc'}, updatedAt: 50 },
        'sid-code': { id:'sid-code', blank:true, cwd:'D:/my-app', projectionValues:{agentPreset:'code'}, updatedAt: 100 },
      }
      const { rec } = await runWithSnap(snap, 'src-sess', cwdTarget)
      check(rec.created===null && rec.opened==='sid-healthy', file + ' 集成闸门：健康同区 存在 → 复用健康者（跳过 code）')
    }
    // 场景3：跨区健康不应复用 → 走新建
    {
      const snap = {
        'sid-cross': { id:'sid-cross', blank:true, cwd:'D:/other', projectionValues:{agentPreset:'ptc'}, updatedAt: 100 },
      }
      const { rec } = await runWithSnap(snap, 'src-sess', cwdTarget)
      check(rec.created && rec.created.agentPreset==='ptc' && rec.opened==='sid-new', file + ' 集成闸门：跨区健康 → 不复用走新建')
    }
    // 场景4：当前会话为 code 幽灵自身 → 不复用自身，走新建
    {
      const snap = {
        'cur-code': { id:'cur-code', blank:true, cwd:'D:/my-app', projectionValues:{agentPreset:'code'}, updatedAt: 200 },
      }
      const { rec } = await runWithSnap(snap, 'cur-code', cwdTarget)
      check(rec.created && rec.opened==='sid-new', file + ' 集成闸门：当前会话为 code 幽灵 → 不复用自身走新建')
    }
    // #478 创建后验集成：剧本式 create（首建 code → 隔离重试；双 code → 大声失败，绝不 open code）
    async function runWithScriptedCreate(snapById, curSid, cwd, sids) {
      const rec = { created: [], opened: null, closed: [], injected: null, flashes: [] }
      const dbg = { pendingDraft: null, pendingDraftTargetSid: null }
      let n = 0
      const sessionsStub = {
        create: async (opts)=>{ rec.created.push(JSON.parse(JSON.stringify(opts))); return sids[Math.min(n++, sids.length - 1)] },
        close: async (sid)=>{ rec.closed.push(sid); return { ok: true } },
        scope: (sid)=>({sessionId: sid}),
        sessionOf: ()=>({ rename: async (t)=>({ok:true, value:{title:t}}) }),
        open: (sid)=>{ rec.opened = sid },
        list: { getSnapshot: ()=>({ byId: snapById }) }
      }
      const workspacesStub = { list: { getSnapshot: ()=>({ items: [{ workspaceId: 'ws1', path: cwd }] }) }, create: async ()=>({workspaceId: 'ws1'}) }
      const st = { sessionId: curSid, cwd: cwd, snapshot: null }
      // 本处走 compileFn：把拼好的闭包文本当函数体造函数，依赖一律按参数名显式传进去（下面两段创建流程同一套依赖）。
      const fn = compileFn(['st','text','title','ctx','host','__dbg','inject','flash','tr','getCwdSync','keyOf','storeOf','hydrateFromCache','getCachedSnapshot','namingHintOf','isNewPlaceholderTitle','namingGuardianKick'],
        wsLib + ';\n' + helpersSrc + ';\n' + open + '; return openTextInNewSession'
      )
      const openFn = fn(st,'/wayfinder https://github.com/x/issues/1','[#1] test',
        { get:(k)=> k==='sessions'?sessionsStub:k==='workspaces'?workspacesStub:null },
        { call: async ()=>({ok:true}) }, dbg,
        (t)=>{ rec.injected = t }, (m,k)=>{ rec.flashes.push(String(m) + '|' + k) }, (k)=>k, ()=>null, keyOf, ()=>({cwd, snapshot:null}), ()=>false, ()=>null, ()=>null, (t)=>/^\\[New\\] /.test(String(t)), ()=>{}
      )
      openFn(st,'/wayfinder https://github.com/x/issues/1','[#1] test')
      await new Promise(r=>setTimeout(r, 150))
      return { rec, dbg }
    }
    // 场景5：首建命中 code → 隔离并重建，打开第二个好的，绝不打开 code
    {
      const snap = {
        'sid-bad1': { id:'sid-bad1', blank: false, cwd:'D:/my-app', projectionValues:{agentPreset:'code'}, updatedAt: 1 },
        'sid-good': { id:'sid-good', blank: false, cwd:'D:/my-app', projectionValues:{agentPreset:'ptc'}, updatedAt: 2 },
      }
      const { rec } = await runWithScriptedCreate(snap, 'src-sess', cwdTarget, ['sid-bad1', 'sid-good'])
      check(rec.created.length === 2, file + ' 创建后验：首建 code → 重建一次（#478）')
      check(rec.closed.indexOf('sid-bad1') >= 0, file + ' 创建后验：code 新会话被隔离（#478）')
      check(rec.opened === 'sid-good', file + ' 创建后验：打开重建好的会话，绝不打开 code（#478）')
    }
    // 场景6：两次都命中 code → 大声失败回当前会话，code 一个都不打开
    {
      const snap = {
        'sid-bad1': { id:'sid-bad1', blank: false, cwd:'D:/my-app', projectionValues:{agentPreset:'code'}, updatedAt: 1 },
        'sid-bad2': { id:'sid-bad2', blank: false, cwd:'D:/my-app', projectionValues:{agentPreset:'code'}, updatedAt: 2 },
      }
      const { rec } = await runWithScriptedCreate(snap, 'src-sess', cwdTarget, ['sid-bad1', 'sid-bad2'])
      check(rec.opened === null, file + ' 创建后验：双 code → 一个都不打开（#478）')
      check(rec.injected && rec.flashes.some(function (f) { return f.indexOf('PresetBlocked') >= 0 }), file + ' 创建后验：双 code → 大声失败并回填当前会话（#478）')
    }
    // 对抗 K1（#746）：改名面同步抛错 → 照样记账（注册电话仍发出，wrote=false），会话不丢出台账
    {
      const snap = {
        'sid-healthy': { id:'sid-healthy', blank:true, cwd:'D:/my-app', projectionValues:{agentPreset:'ptc'}, updatedAt: 50 },
      }
      const rec = { opened: null, regCalls: [] }
      const dbg = { pendingDraft: null, pendingDraftTargetSid: null }
      const sessionsStub = {
        create: async ()=>{ throw new Error('should-reuse-not-create') },
        scope: (sid)=>({sessionId: sid}),
        sessionOf: ()=>({ rename: (t)=>{ throw new Error('sync-rename-boom') } }),
        open: (sid)=>{ rec.opened = sid },
        list: { getSnapshot: ()=>({ byId: snap }) }
      }
      const workspacesStub = { list: { getSnapshot: ()=>({ items: [{ workspaceId: 'ws1', path: 'D:/my-app' }] }) }, create: async ()=>({workspaceId: 'ws1'}) }
      const st = { sessionId: 'src-sess', cwd: 'D:/my-app', snapshot: null }
      // 本处走 compileFn：K1 对抗那一段与上面同一套依赖，只多一个 parseNumberedTitle，照旧按参数名传进去。
      const fn = compileFn(['st','text','title','ctx','host','__dbg','inject','flash','tr','getCwdSync','keyOf','storeOf','hydrateFromCache','getCachedSnapshot','namingHintOf','isNewPlaceholderTitle','namingGuardianKick','parseNumberedTitle'],
        wsLib + ';\n' + helpersSrc + ';\n' + open + '; return openTextInNewSession'
      )
      const openFn = fn(st,'/wayfinder https://github.com/x/issues/1','[#1] test',
        { get:(k)=> k==='sessions'?sessionsStub:k==='workspaces'?workspacesStub:null },
        { call: async (m,a)=>{ rec.regCalls.push(m); return {ok:true} } }, dbg,
        ()=>{}, ()=>{}, (k)=>k, ()=>null, keyOf, ()=>({cwd:'D:/my-app', snapshot:null}), ()=>false, ()=>null, ()=>null, (t)=>/^\[New\] /.test(String(t)), ()=>{},
        (s)=>{ const m = /^\s*\[#(\d+)\](?:\s+([\s\S]*))?$/.exec(String(s == null ? '' : s)); return m ? { number: Number(m[1]), numberText: m[1], title: String(m[2] || '').trim() } : null }
      )
      openFn(st,'/wayfinder https://github.com/x/issues/1','[#1] test')
      await new Promise(r=>setTimeout(r, 60))
      check(rec.opened==='sid-healthy', file + ' 对抗 K1：复用分支照常打开（改名抛错不拦打开）')
      check(rec.regCalls.indexOf('wf.registerNewSessionWatcher')>=0, file + ' 对抗 K1：改名同步抛错仍记账（注册电话发出）')
    }
  } catch(e) { check(false, file + ' 集成闸门沙箱 — ' + e.stack) }
}

async function main() {
  console.log('== #362/#363 新会话必为 PTC 可判定门禁 + 单点工厂（#363）==')
  for (const f of files) await testFile(f)
  if (failed) { console.log('\nFAIL ' + total + ' checks, some failed'); process.exit(1) }
  else { console.log('\nPASS all ' + total + ' checks') }
}
main()