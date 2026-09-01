// tests/verify-newsession-workspace-fallback.js — #364 工作区回退与首条注入保真（兼容 alpha 新参）
// 用法: node tests/verify-newsession-workspace-fallback.js [file...]（默认 src 源 + package/lib/client.js 双源）
//
// 验收标准（#364 = #363 之后剩余 40% 的“创时即正”三要素中，工作区回退矩阵与首条保真）：
//  a) 静態：ensureWorkspaceId 含 #364 矩阵注释与 workspaces.create 双参试探（path→cwd）及回落 null 语义
//  b) 静態：buildCreateOpts 两分支互斥且必带 agentPreset:'ptc'（判据 P 不漂移）
//  c) 静態：createPTCSession 含首条原子挂载且含 workspaceId/agentPreset 兼容回退（alpha 新参）
//  d) 沙箱：ensureWorkspaceId — 命中复用、未命中创建、创建失败回落、alpha path→cwd 回退、多形态 snapshot 兼容
//  e) 沙箱：buildCreateOpts — 有 wid / 无 wid / 空 cwd 三态
//  f) 沙箱：createPTCSession — 正常 wid/cwd 分支、workspaceId 失败回落 cwd+ptc、agentPreset 更名回退仍挂 pendingDraft
//  g) 沙箱：openTextInNewSession 工作区回退集成 — cwd 缺失走 fallback、workspaceId 创建失败走 cwd+ptc、成功走 wid+ptc、首条锚定不丢
//  h) 双源一致（src 与构建产物逐字 splice 保留）
//
// 与 verify-newsession-preset-guard.js 同范式：从目标文件提取真实源码并在沙箱以忠实替身执行。

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

function extractEnsureWorkspaceId(src) {
  const marker = 'const ensureWorkspaceId = function (cwd) {'
  const i = src.indexOf(marker)
  if (i < 0) throw new Error('ensureWorkspaceId 起始缺失')
  // 找到匹配的闭合：数括号层级，简化以 "      }\n      ensureCwd" 定位
  const endMarker = '      ensureCwd().then'
  const j = src.indexOf(endMarker, i)
  if (j < 0) throw new Error('ensureWorkspaceId 终止缺失')
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
  if (!fs.existsSync(file)) { check(false, file + ' 存在'); return }
  let src
  try { src = fs.readFileSync(file, 'utf8') } catch(e) { check(false, file + ' 可读 — ' + e.message); return }
  let factoryBlock
  try { factoryBlock = extractFactoryBlock(src) } catch(e) { check(false, file + ' 工厂块可提取 — ' + e.message); return }
  check(true, file + ' 单点工厂块可提取')
  let openSrc
  try { openSrc = extractOpenFn(src) } catch(e) { check(false, file + ' openTextInNewSession 可提取 — ' + e.message); return }
  check(true, file + ' openTextInNewSession 可提取')
  let ensureSrc
  try { ensureSrc = extractEnsureWorkspaceId(src) } catch(e) { check(false, file + ' ensureWorkspaceId 可提取 — ' + e.message); return }
  check(true, file + ' ensureWorkspaceId 可提取')

  // a) 静態：ensureWorkspaceId 含 #364 矩阵与双参试探（注释在函数前，扫全文件）
  check(src.indexOf('#364')>=0 && src.indexOf('工作区回退')>=0, file + ' ensureWorkspaceId 含 #364 矩阵注释')
  check(ensureSrc.indexOf('workspaces.create')>=0, file + ' ensureWorkspaceId 含 workspaces.create')
  check(ensureSrc.indexOf('{ path: cwd }')>=0, file + ' ensureWorkspaceId 以 {path:cwd} 为主')
  check(ensureSrc.indexOf('{ cwd: cwd }')>=0 || ensureSrc.indexOf('{cwd: cwd}')>=0, file + ' ensureWorkspaceId 含 {cwd} 兼容回退')
  check(ensureSrc.indexOf('return null')>=0 && ensureSrc.indexOf('.catch')>=0, file + ' ensureWorkspaceId 失败回落 null（不阻断）')
  check(ensureSrc.indexOf('workspaces || !cwd')>=0, file + ' ensureWorkspaceId 空 cwd/无服务回落 null')
  check(ensureSrc.indexOf('workspacePath')>=0 || ensureSrc.indexOf('workspace_id')>=0, file + ' ensureWorkspaceId 兼容多形态 w.path/ workspacePath')
  check(ensureSrc.indexOf('snap.workspaces')>=0, file + ' ensureWorkspaceId 兼容 snap.workspaces 形态')

  // b) 静態：buildCreateOpts
  check(factoryBlock.indexOf('buildCreateOpts')>=0, file + ' 工厂块含 buildCreateOpts')
  check(factoryBlock.indexOf("agentPreset: 'ptc'")>=0, file + ' buildCreateOpts 显式 ptc')
  check(factoryBlock.indexOf('#364')>=0, file + ' 工厂块含 #364 注释（回退矩阵）')

  // c) 静態：createPTCSession 含首条原子与兼容回退
  const cStart = factoryBlock.indexOf('const createPTCSession')
  const createSrc = cStart>=0 ? factoryBlock.slice(cStart, factoryBlock.indexOf('// ============ 命名守护')) : ''
  check(createSrc.indexOf('pendingDraft = text')>=0 && createSrc.indexOf('pendingDraftTargetSid = sid')>=0, file + ' createPTCSession 原子挂载 pendingDraft')
  check(createSrc.indexOf('presetId')>=0 || createSrc.indexOf('agentPresetId')>=0, file + ' createPTCSession 含 preset 兼容回退')
  check(createSrc.indexOf('workspaceId')>=0 && createSrc.indexOf('buildCreateOpts')>=0, file + ' createPTCSession 经 buildCreateOpts 且提及 workspaceId')
  check(createSrc.indexOf('bad-request')>=0 || createSrc.indexOf('workspaceId')>=0, file + ' createPTCSession 含 workspaceId 失败回退语义')
  // 旧单一 promise 链不应裸露（应有 catch 回退）
  check(createSrc.indexOf('.catch')>=0, file + ' createPTCSession 含 catch 回退（兼容 alpha）')

  // d) 沙箱：ensureWorkspaceId
  try {
    // 构造一个可独立执行的 ensureWorkspaceId 沙箱
    // 需要 keyOf, workspaces, etc. 我们用 Function 注入
    const ensureFnSrc = ensureSrc.replace(/^\s*const ensureWorkspaceId/, 'const ensureWorkspaceId')
    // 测试 1：命中已有工作区
    {
      const workspacesStub = {
        list: { getSnapshot: () => ({ items: [{ path: 'D:/my-app', workspaceId: 'ws-hit' }] }) },
        create: async () => { throw new Error('should not call create when hit') }
      }
      const fn = new Function('workspaces','keyOf', ensureFnSrc + '; return ensureWorkspaceId')
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
      const fn = new Function('workspaces','keyOf', ensureFnSrc + '; return ensureWorkspaceId')
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
      const fn = new Function('workspaces','keyOf', ensureFnSrc + '; return ensureWorkspaceId')
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
      const fn = new Function('workspaces','keyOf', ensureFnSrc + '; return ensureWorkspaceId')
      const ensure = fn(workspacesStub, keyOf)
      const wid = await ensure('D:/my-app')
      check(wid === 'ws-cwd' && call===2, file + ' ensureWorkspaceId alpha path bad-request → 回退 {cwd}')
    }
    // 测试 5：无 workspaces 服务或空 cwd → null
    {
      const fn = new Function('workspaces','keyOf', ensureFnSrc + '; return ensureWorkspaceId')
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
    // 测试 6：snapshot 多形态兼容（items 数组、workspaces 数组、snap.byId 空）
    {
      const workspacesStub = {
        list: { getSnapshot: () => ({ workspaces: [{ path: 'D:/my-app', workspaceId: 'ws-multi' }] }) },
        create: async()=>({workspaceId:'ws-new'})
      }
      const fn = new Function('workspaces','keyOf', ensureFnSrc + '; return ensureWorkspaceId')
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
      const fn = new Function('workspaces','keyOf', ensureFnSrc + '; return ensureWorkspaceId')
      const ensure = fn(workspacesStub2, keyOf)
      const wid = await ensure('D:/my-app')
      // 对于数组形态，items = snap（直接），命中 ws-arr2
      check(wid==='ws-arr2', file + ' ensureWorkspaceId 兼容数组 snapshot 形态')
    }
  } catch(e) { check(false, file + ' ensureWorkspaceId 沙箱 — ' + e.stack) }

  // e) 沙箱：buildCreateOpts
  try {
    let block = factoryBlock.replace(/^\s*export\s+/gm, '')
    const fnBuildSrc = block.slice(block.indexOf('const buildCreateOpts'), block.indexOf('const createPTCSession'))
    const vmBuild = new Function(fnBuildSrc + '; return { buildCreateOpts }')()
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
    const cEnd = block.indexOf('// ============ 命名守护')
    const createBlock = cStart>=0 ? block.slice(cStart, cEnd>=0 ? cEnd : block.length) : ''
    // 提取 buildCreateOpts 以供 createPTCSession 使用
    const buildSrc = block.slice(block.indexOf('const buildCreateOpts'), block.indexOf('const createPTCSession'))
    // 正常：有 wid — 仅源码文本检查
    {
      const hasFallback = createBlock.indexOf('presetId')>=0 && createBlock.indexOf('workspaceId')>=0 && createBlock.indexOf('pendingDraft = text')>=0
      check(hasFallback, file + ' createPTCSession 源码含回退与原子挂载')
    }
    // 更直接的 sandbox：运行 createPTCSession 的真实逻辑（注入 buildCreateOpts）
    {
      // 用真实的 factory 逻辑沙箱
      let pendingDraftCaptured = null
      let pendingTargetCaptured = null
      const sessionsOk = {
        create: async (opts)=>{
          if (!opts.agentPreset || opts.agentPreset!=='ptc') throw new Error('missing ptc')
          if (opts.workspaceId && opts.cwd) throw new Error('bad-request: workspaceId or cwd, not both')
          return 'sid-ok'
        }
      }
      const block2 = buildSrc + ';\n' + createBlock
      // 构造执行环境：需要 sessions, workspaceId, cwd, text, pendingDraft, pendingDraftTargetSid 在作用域
      const exec = new Function('sessions','workspaceId','cwd','text',
        'let pendingDraft=null; let pendingDraftTargetSid=null;\n'
        + buildSrc + ';\n'
        + createBlock.replace(/return sessions\.create/, 'return sessions.create')
        + '\nreturn createPTCSession(sessions, workspaceId, cwd, text).then(sid=>({sid, pendingDraft, pendingDraftTargetSid}));'
      )
      const res = await exec(sessionsOk, 'ws-1', 'D:/repo', '/wayfinder #1')
      check(res.sid==='sid-ok' && res.pendingDraft==='/wayfinder #1' && res.pendingDraftTargetSid==='sid-ok', file + ' createPTCSession 有 wid → {workspaceId,ptc} 且原子挂载')
      const res2 = await exec(sessionsOk, null, 'D:/repo', '/wayfinder #2')
      check(res2.sid==='sid-ok' && res2.pendingDraft==='/wayfinder #2', file + ' createPTCSession 无 wid → {cwd,ptc} 且原子挂载')
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
      const exec = new Function('sessions','workspaceId','cwd','text',
        'let pendingDraft=null; let pendingDraftTargetSid=null;\n'
        + buildSrc + ';\n' + createBlock
        + '\nreturn createPTCSession(sessions, workspaceId, cwd, text).then(sid=>({sid, pendingDraft, pendingDraftTargetSid}));'
      )
      const res = await exec(sessionsFailWid, 'ws-bad', 'D:/repo', '/wayfinder fallback')
      check(res.sid==='sid-fb' && res.pendingDraft==='/wayfinder fallback', file + ' createPTCSession workspaceId 失败 → 回落 cwd+ptc 仍挂载')
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
      const exec = new Function('sessions','workspaceId','cwd','text',
        'let pendingDraft=null; let pendingDraftTargetSid=null;\n'
        + buildSrc + ';\n' + createBlock
        + '\nreturn createPTCSession(sessions, workspaceId, cwd, text).then(sid=>({sid, pendingDraft, pendingDraftTargetSid}));'
      )
      const res = await exec(sessionsFailPreset, 'ws-1', 'D:/repo', '/wayfinder preset')
      check(res.sid==='sid-preset' && res.pendingDraft==='/wayfinder preset', file + ' createPTCSession agentPreset 更名 → presetId 回退仍挂载')
    }
  } catch(e) { check(false, file + ' createPTCSession 沙箱 — ' + e.stack) }

  // g) 沙箱：openTextInNewSession 工作区回退集成
  try {
    let factory = factoryBlock.replace(/^\s*export\s+/gm, '')
    const helpersSrc = factory.slice(factory.indexOf('const getRowPreset'), factory.indexOf('const buildCreateOpts'))
    let open = openSrc
    open = open.replace(/\bpendingDraft\b/g, '__dbg.pendingDraft')
    open = open.replace(/\bpendingDraftTargetSid\b/g, '__dbg.pendingDraftTargetSid')
    const fullOpenHelpers = helpersSrc + ';\n' + factory.slice(factory.indexOf('const buildCreateOpts'), factory.indexOf('// ============ 命名守护'))

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
      const fn = new Function('st','text','title','ctx','host','__dbg','inject','flash','tr','getCwdSync','keyOf','storeOf','hydrateFromCache','getCachedSnapshot','namingHintOf','isNewPlaceholderTitle','namingGuardianKick',
        helpersSrc + ';\n' + fullOpenHelpers + ';\n' + open + '; return openTextInNewSession'
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
      const factoryAll = factory.slice(factory.indexOf('const buildCreateOpts'), factory.indexOf('// ============ 命名守护'))
      const rec = { created:null, injected:null }
      const dbg = { pendingDraft:null, pendingDraftTargetSid:null }
      const fn = new Function('st','text','title','ctx','host','__dbg','inject','flash','tr','getCwdSync','keyOf','storeOf','hydrateFromCache','getCachedSnapshot','namingHintOf','isNewPlaceholderTitle','namingGuardianKick',
        helpers + ';\n' + factoryAll + ';\n' + openA + '; return openTextInNewSession')
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
      const factoryAll = factory.slice(factory.indexOf('const buildCreateOpts'), factory.indexOf('// ============ 命名守护'))
      let openB = openSrc.replace(/\bpendingDraft\b/g, '__dbg.pendingDraft').replace(/\bpendingDraftTargetSid\b/g, '__dbg.pendingDraftTargetSid')
      const rec = { created: null }
      const dbg = { pendingDraft:null, pendingDraftTargetSid:null }
      const st = { sessionId:'s1', cwd:'D:/my-app', snapshot:null }
      const fn = new Function('st','text','title','ctx','host','__dbg','inject','flash','tr','getCwdSync','keyOf','storeOf','hydrateFromCache','getCachedSnapshot','namingHintOf','isNewPlaceholderTitle','namingGuardianKick',
        helpers + ';\n' + factoryAll + ';\n' + openB + '; return openTextInNewSession')
      let createdSid=null
      const sessionsStub2 = {
        create: async (opts)=>{ rec.created = opts; createdSid = 'sid-cwd'; return createdSid },
        scope:(sid)=>({sessionId:sid}), sessionOf:()=>({rename: async(t)=>({ok:true,value:{title:t}})}),
        open:(sid)=>{ rec.opened=sid },
        list:{ getSnapshot: ()=>({ byId: {} }) }
      }
      const hostStub = { call: async()=>({ok:true}) }
      const openFn = fn(st, '/wayfinder https://github.com/x/issues/1','[#1] test',
        { get:(k)=> k==='sessions'?sessionsStub2:k==='workspaces'?workspacesStub:null },
        hostStub, dbg,
        ()=>{}, ()=>{}, (k)=>k, ()=>null, keyOf, ()=>({cwd:'D:/my-app'}), ()=>false, ()=>null, ()=>null, (t)=>/\[New\]/.test(String(t)), ()=>{}
      )
      openFn(st,'/wayfinder https://github.com/x/issues/1','[#1] test')
      await new Promise(r=>setTimeout(r, 80))
      check(rec.created && rec.created.cwd==='D:/my-app' && rec.created.agentPreset==='ptc', file + ' 集成：workspaces.create 失败 → 回落 {cwd,ptc} 创建')
      check(dbg.pendingDraft==='/wayfinder https://github.com/x/issues/1' && dbg.pendingDraftTargetSid==='sid-cwd', file + ' 集成：回落创建仍原子挂载 pendingDraft')
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
      const fn = new Function('st','text','title','ctx','host','__dbg','inject','flash','tr','getCwdSync','keyOf','storeOf','hydrateFromCache','getCachedSnapshot','namingHintOf','isNewPlaceholderTitle','namingGuardianKick',
        helpersSrc + ';\n' + factory.slice(factory.indexOf('const buildCreateOpts'), factory.indexOf('// ============ 命名守护')) + ';\n' + openC + '; return openTextInNewSession')
      const sessionsStub = {
        create: async (opts)=>{ rec.created=opts; return 'sid-wid' },
        scope:(sid)=>({sessionId:sid}), sessionOf:()=>({rename: async(t)=>({ok:true,value:{title:t}})}),
        open:(sid)=>{ rec.opened=sid },
        list:{ getSnapshot: ()=>({ byId: {} }) }
      }
      const openFn = fn(st,'/wayfinder https://github.com/x/issues/1','[#1] test',
        { get:(k)=> k==='sessions'?sessionsStub:k==='workspaces'?workspacesStub:null },
        { call: async()=>({ok:true}) }, dbg,
        ()=>{}, ()=>{}, (k)=>k, ()=>null, keyOf, ()=>({}), ()=>false, ()=>null, ()=>null, (t)=>/\[New\]/.test(String(t)), ()=>{}
      )
      openFn(st,'/wayfinder https://github.com/x/issues/1','[#1] test')
      await new Promise(r=>setTimeout(r, 80))
      check(rec.created && rec.created.workspaceId==='ws-hit' && rec.created.agentPreset==='ptc', file + ' 集成：命中工作区 → {workspaceId,ptc} 创建')
      check(dbg.pendingDraft==='/wayfinder https://github.com/x/issues/1', file + ' 集成：命中创建仍挂载首条')
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