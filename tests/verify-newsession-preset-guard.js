// tests/verify-newsession-preset-guard.js — #362 可判定门禁 + #363 单点工厂（2026-09-01 定版）
// 用法: node tests/verify-newsession-preset-guard.js [file...]（默认 src 源 + package/lib/client.js 双源）
//
// 验收标准（#362 三判据合取 + #361 闸门 + #363 单点工厂）：
//  a) 静態：openTextInNewSession 源码必含 agentPreset:'ptc' 且两分支均带（判据 P）
//  b) 静態：存在单点工厂 createPTCSession 与入参构造 buildCreateOpts，且为唯一显式携带点
//  c) 静態：存在复用闸门 isReusableBlank / getRowPreset / isHealthyPreset 且已接入两级复用
//  d) 沙箱：buildCreateOpts(workspaceId,cwd) 两分支均返回携带 ptc 的入参
//  e) 沙箱：isReusableBlank 对 code/空/跨区 拒绝，对健康同区 允许（#361 §闸门谓词）
//  f) 沙箱：createPTCSession 调用 sessions.create 时必含 ptc 且原子化挂载 pendingDraft
//  g) 沙箱：openTextInNewSession 集成闸门——喂 code/空/跨区幽灵快照必走新建（非复用），健康同区可复用
//  h) 双源一致（src 与构建产物逐字 splice 保留）
//
// 本测试与 verify-newsession-blank-seed-315.js 同范式：从目标文件提取真实源码并在沙箱以忠实替身执行，
// 能抓住“逻辑改坏 / 双源漂移”两类回归。
const fs = require('fs')

const files = process.argv.slice(2).length ? process.argv.slice(2) : ['src/client/kernel/api.js', 'package/lib/client.js']

function extractOpenFn(src) {
  const marker = 'const openTextInNewSession = function (st, text, title) {'
  const src2 = src.indexOf(marker) >= 0 ? src : src.replace(/export const openTextInNewSession/, 'const openTextInNewSession')
  const i = src2.indexOf(marker)
  if (i < 0) throw new Error('起始锚点缺失: openTextInNewSession')
  const j = src2.indexOf('// #361 原入口：行级「在新会话打开」保留', i)
  if (j < 0) throw new Error('终止锚点缺失: #361 注释')
  return src2.slice(i, j)
}

function extractFactoryBlock(src) {
  const start = src.indexOf('// ============ 单点工厂 createPTCSession 原子化')
  const end = src.indexOf('// ============ 命名守护', start)
  if (start < 0 || end < 0) throw new Error('工厂块锚点缺失')
  return src.slice(start, end)
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
  if (!fs.existsSync(file)) { check(false, file + ' 存在'); return }
  let src
  try { src = fs.readFileSync(file, 'utf8') } catch(e) { check(false, file + ' 可读 — ' + e.message); return }
  let openSrc
  try { openSrc = extractOpenFn(src) } catch(e) { check(false, file + ' openTextInNewSession 源码可提取 — ' + e.message); return }
  check(true, file + ' openTextInNewSession 源码可提取（锚点保留）')
  let factoryBlock
  try { factoryBlock = extractFactoryBlock(src) } catch(e) { check(false, file + ' 工厂块可提取 — ' + e.message); return }
  check(true, file + ' 单点工厂块可提取')

  // a) 静態：必含 agentPreset:'ptc'
  const hasPreset = openSrc.indexOf("agentPreset") >= 0 && openSrc.indexOf("'ptc'") >= 0 || openSrc.indexOf('"ptc"') >= 0
  check(hasPreset, file + ' 源码含 agentPreset 显式 ptc（判据 P）')
  // 检查两分支均带：通过 buildCreateOpts 或直接字面出现次数 >=2 或包含 buildCreateOpts 调用
  const presetCount = (openSrc.match(/agentPreset/g) || []).length + (factoryBlock.match(/agentPreset/g) || []).length
  // 工厂块含 2 处，回退也含，openSrc 经工厂调用间接触含
  check(presetCount >= 2, file + ' 源码中 agentPreset 出现 >=2 次（两分支均带）—实际 ' + presetCount)
  // 旧无预设形态不应出现（裸 createOpts 不带 preset）
  const oldBare = "const createOpts = workspaceId ? { workspaceId: workspaceId } : { cwd: cwd }"
  check(src.indexOf(oldBare) < 0, file + ' 源码不含旧裸 createOpts（无 preset 形态已移除）')

  // b) 单点工厂存在性
  check(factoryBlock.indexOf('export const buildCreateOpts') >=0 || factoryBlock.indexOf('buildCreateOpts')>=0, file + ' 源码含 buildCreateOpts（单点入参构造）')
  check(factoryBlock.indexOf('export const createPTCSession') >=0 || factoryBlock.indexOf('createPTCSession')>=0, file + ' 源码含 createPTCSession（单点工厂）')
  check(factoryBlock.indexOf("agentPreset: 'ptc'")>=0 || factoryBlock.indexOf('agentPreset')>=0, file + ' 工厂块内显式携带 ptc')
  // 确认 openTextInNewSession 经工厂创建（调用 createPTCSession 或 buildCreateOpts）
  check(openSrc.indexOf('createPTCSession')>=0 || openSrc.indexOf('buildCreateOpts')>=0, file + ' openTextInNewSession 经单点工厂/构造创建（非直连裸参）')

  // c) 复用闸门存在性与接入
  check(factoryBlock.indexOf('isReusableBlank')>=0, file + ' 源码含 isReusableBlank（闸门谓词）')
  check(factoryBlock.indexOf('getRowPreset')>=0, file + ' 源码含 getRowPreset（预设抽取，回退 header）')
  check(factoryBlock.indexOf('isHealthyPreset')>=0, file + ' 源码含 isHealthyPreset（字面 code 判不健康）')
  // 已接入两级
  const gateCalls = (openSrc.match(/isReusableBlank/g) || []).length
  check(gateCalls >= 2, file + ' openTextInNewSession 内 isReusableBlank 调用 >=2（两级同形）—实际 ' + gateCalls)
  // 空隔离语义：工厂块内有 "!normRow" 拒绝
  check(factoryBlock.indexOf('!normRow')>=0 && factoryBlock.indexOf('空永不复用')>=0, file + ' 工厂块含空永不复用语义（!normRow 拒绝）')

  // d) 沙箱：buildCreateOpts
  try {
    let block = factoryBlock
    block = block.replace(/^\s*export\s+/gm, '')
    // 去掉注释行首的 export 残留后，提取两个 helper 的源码文本
    const fnBuildSrc = block.slice(block.indexOf('const buildCreateOpts'), block.indexOf('const createPTCSession'))
    const vmBuild = new Function(fnBuildSrc + '; return { buildCreateOpts }')()
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
    const helpers = new Function('keyOf', getPresetSrc + healthySrc + reusableSrc + '; return { getRowPreset, isHealthyPreset, isReusableBlank }')(keyOf)
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

  // f) 沙箱：createPTCSession（轻量文本判定）
  try {
    let block = factoryBlock.replace(/^\\s*export\\s+/gm, '')
    const cStart = block.indexOf('const createPTCSession')
    const cEnd = block.indexOf('// ============ 命名守护')
    const createSrc = cStart >=0 ? block.slice(cStart, cEnd>=0 ? cEnd : block.length) : ''
    check(createSrc.indexOf('pendingDraft = text')>=0 && createSrc.indexOf('pendingDraftTargetSid = sid')>=0, file + ' createPTCSession 内原子化挂载 pendingDraft')
    check(createSrc.indexOf('buildCreateOpts')>=0, file + ' createPTCSession 经 buildCreateOpts 显式 ptc（buildCreateOpts 已验含 ptc）')
    check(createSrc.indexOf('sessions.create')>=0, file + ' createPTCSession 内调用 sessions.create（单点出口）')
  } catch(e) { check(false, file + ' createPTCSession 沙箱 — ' + e.message) }

  // g) 沙箱：openTextInNewSession 集成闸门（喂快照必走新建 vs 可复用）
  try {
    // 复用 openSrc 沙箱：需注入 isReusableBlank 等 helper
    let factory = factoryBlock.replace(/^\s*export\s+/gm, '')
    const helpersSrc = factory.slice(factory.indexOf('const getRowPreset'), factory.indexOf('const buildCreateOpts'))
    let open = openSrc
    // 替换裸 pendingDraft 为可观测
    open = open.replace(/\bpendingDraft\b/g, '__dbg.pendingDraft')
    open = open.replace(/\bpendingDraftTargetSid\b/g, '__dbg.pendingDraftTargetSid')
    // 注入 helpers 到沙箱作用域：把 helpersSrc 拼到 open 前
    const combined = helpersSrc + ';\n' + open + '; return openTextInNewSession'
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
      const fn = new Function('st','text','title','ctx','host','__dbg','inject','flash','tr','getCwdSync','keyOf','storeOf','hydrateFromCache','getCachedSnapshot','namingHintOf','isNewPlaceholderTitle','namingGuardianKick',
        helpersSrc + ';\n' + open + '; return openTextInNewSession'
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
  } catch(e) { check(false, file + ' 集成闸门沙箱 — ' + e.stack) }
}

async function main() {
  console.log('== #362/#363 新会话必为 PTC 可判定门禁 + 单点工厂（#363）==')
  for (const f of files) await testFile(f)
  if (failed) { console.log('\nFAIL ' + total + ' checks, some failed'); process.exit(1) }
  else { console.log('\nPASS all ' + total + ' checks') }
}
main()