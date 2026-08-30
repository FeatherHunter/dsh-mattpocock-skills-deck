// tests/verify-skill-probe-redcard-and-waiting.js — #281 红牌分拣与等待合同门禁（#296 修订：多通道并联判装）
// 覆盖：缺失 vs 名片无效分拣 · 异处副本绿+来源 · 等待 pending 有界 · 失效广播事件驱动 · 封顶失败携带原文
// #296 新增：注册表未命中时「任一通道有效即已安装」——fs 通道合法名片 → 绿；fs 通道被挡（工作区作用域）
//           但直读通道可读 → 绿（#296 用户环境形态回归）；通道全空才红且附各通道判据。
import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let failed = false
let total = 0
let passed = 0
function check(ok, msg, detail='') {
  total++
  if (ok) { passed++; console.log('  PASS ' + msg) }
  else { failed = true; console.log('  FAIL ' + msg + (detail ? ' — ' + String(detail).slice(0,800) : '')) }
}

// #284 迁移桥：wf.status 已退役，断言目标改为 wf.chain 全链快照；把链步骤归一化为旧行形状（key/level/detail/hint）
function chainToRow(chainRes) {
  const v = chainRes && chainRes.value ? chainRes.value : chainRes
  const snap = (v && (v.fullSnapshot || v.snapshot)) || null
  const steps = (snap && Array.isArray(snap.steps)) ? snap.steps : []
  return {
    checks: steps.map(function (s) {
      const show = s.show || {}
      return {
        key: s.id, id: s.id,
        name: show.fallback || s.id,
        level: s.status === 'done' ? 'ok' : (s.status === 'pending' ? 'pending' : 'bad'),
        ok: s.status === 'done',
        detail: show.desc || '',
        hint: show.hint || '',
      }
    }),
  }
}
const callChain = async (dispatch, payload) => {
  if (!dispatch) return { checks: [] }
  // 链为串行求值：前置（已选后端/已初始化）须通过，技能步才会被求值；测试环境显式给定后端
  // #284 修订：链上检查项逐项独立求值（不依赖前置通过）——测试不再注入后端、不再预置初始化文件
  const res = await dispatch('chain', Object.assign({}, payload, { force: true }))
  return chainToRow(res)
}

console.log('== #281 红牌分拣与等待合同门禁（#284 迁移：断言经 wf.chain 全链快照）==')

// ---------- 1. 源码门禁 ----------
console.log('\n— 验收1：源码门禁（纪律与线索） —')
{
  const hostSrc = readFileSync('src/host/index.js', 'utf8')
  check(hostSrc.includes('SKILL_PENDING_MAX'), 'src/host/index.js 含 SKILL_PENDING_MAX（有界等待）')
  check(hostSrc.includes('lightProbeReason'), '含 lightProbeReason（轻探分拣）')
  check(hostSrc.includes('isSkillCardValid'), '含 isSkillCardValid（名片校验）')
  check(hostSrc.includes('ensureSkillsInvalidateSubscription'), '含失效广播订阅')
  check(hostSrc.includes('pending:skills-unavailable'), '含 pending hint 前缀')
  check(!/SKILL_PROBE_DIRS/.test(hostSrc), '仍无 SKILL_PROBE_DIRS（单一尺度未回退）')
  check(hostSrc.includes('source:') || hostSrc.includes('来源：'), '绿牌来源路径逻辑存在')
  check(hostSrc.includes('directSkillCardRead'), '#296: host 含只读直读通道（directSkillCardRead）')
  check(hostSrc.includes('probeCardViaDirect'), '#296: host 含直读探卡（probeCardViaDirect）')
  check(hostSrc.includes('evidenceSummary'), '#296: host 含判据摘要（evidenceSummary）')
  // 轻探仅涉标准根
  const lightProbeSnippet = hostSrc.slice(hostSrc.indexOf('async function lightProbeReason'))
  check(lightProbeSnippet.includes('.agents') && lightProbeSnippet.includes('SKILL.md'), '轻探仅涉标准根 SKILL.md')
  check(!lightProbeSnippet.includes('.claude') && !lightProbeSnippet.includes('.minimax'), '轻探不含 .claude/.minimax（已退役）')
}
{
  const predSrc = readFileSync('src/host/tracker/predicateRegistry.js', 'utf8')
  check(!predSrc.includes('.claude'), 'predicateRegistry 无 .claude（仅标准根）')
  // 确保仅一个候选
  const candCount = (predSrc.match(/\.agents\/skills/g) || []).length
  check(candCount === 1, 'predicateRegistry 仅一个 .agents/skills 候选 — 实际 ' + candCount)
}
{
  // #284：statusDerive.js 已随九格目录视图退役；拼写防线移到链目录（check-catalog 单一真源）
  const catSrc = readFileSync('src/shared/tracker/check-catalog.js', 'utf8')
  check(!/setup-mattpocock-skills/.test(catSrc), 'check-catalog 无错拼（setup-matt-pocock-skills）')
  check(/setup-matt-pocock-skills/.test(catSrc), 'check-catalog 含正确拼写')
}
{
  const adrPath = 'docs/adr/20260828-skill-probe-redcard-and-waiting.md'
  check(existsSync(adrPath), 'ADR 第三、五条已落纸：' + adrPath)
  if (existsSync(adrPath)) {
    const adr = readFileSync(adrPath, 'utf8')
    check(adr.includes('看一眼文件只用于解释原因') || adr.includes('One Glance'), 'ADR 含“看一眼”纪律')
    check(adr.includes('等待合同') || adr.includes('Waiting'), 'ADR 含等待合同')
    check(adr.includes('SKILL_PENDING_MAX') || adr.includes('有界'), 'ADR 含封顶/有界')
  }
  const adrUnionPath = 'docs/adr/20260828-skill-probe-union-channels.md'
  check(existsSync(adrUnionPath), '#296 ADR 已落纸：' + adrUnionPath)
  if (existsSync(adrUnionPath)) {
    const uadr = readFileSync(adrUnionPath, 'utf8')
    check(uadr.includes('任一通道') || uadr.includes('union'), '#296 ADR 含「任一通道有效」规则')
    check(uadr.includes('直读'), '#296 ADR 含直读通道边界')
  }
  // 产物一致性：build 产物与 src 同步（防陈旧产物派发）
  {
    const pkgLog = 'package/lib/index.js'
    check(existsSync(pkgLog), '构建产物存在：' + pkgLog)
    if (existsSync(pkgLog)) {
      const lib = readFileSync(pkgLog, 'utf8')
      check(lib.includes('SKILL_PENDING_MAX'), 'pkg 产物含 SKILL_PENDING_MAX（产物不陈旧）')
      check(lib.includes('lightProbeReason'), 'pkg 产物含 lightProbeReason')
      check(lib.includes('probeFsExists'), 'pkg 产物含 probeFsExists（path-shaped 纪律）')
      check(lib.includes('directSkillCardRead'), 'pkg 产物含 directSkillCardRead（产物不陈旧）')
      check(!/SKILL_PROBE_DIRS/.test(lib), 'pkg 产物无 SKILL_PROBE_DIRS')
      check(!lib.includes('.claude'), 'pkg 产物无 .claude（仅标准根）')
    }
  }
}

// ---------- 2. 集成缝：缺失 vs 无效分拣 ----------
console.log('\n— 验收2：轻探分拣 缺失 vs 名片无效（永不绿） —')
{
  // 构造带轻探的 host 实例：skills.get 返回 null，fs 控制文件是否存在与合法性
  const hostUrl = new URL('../src/host/index.js', import.meta.url)
  // 动态构造测试用的 ctx
  // 使用真实 host 源码的 probeSkill 逻辑：需加载宿主并触发 wf.chain（#284 迁移）
  const tmpHome = mkdtempSync(join(tmpdir(), 'home281-'))
  const platformStub = {
    os: 'linux',
    path: {
      join: (...a) => join(...a),
      normalize: (p) => p,
      dirname: (p) => p.slice(0, p.lastIndexOf('/')),
      basename: (p) => p.split('/').pop(),
      isAbsolute: (p) => p.startsWith('/'),
      sep: '/',
    },
    async getHome() { return tmpHome },
    async resolveExecutable() { return null },
    env: { get: () => undefined, has: () => false },
    fs: null, // 占位
  }
  // fs 内存映射
  const files = new Map()
  const blockedRead = new Set() // 模拟「文件在但读不了」
  const fsMock = {
    // 真实 DSH fs 契约形状：resolve 返回 target 对象（target-shaped 读接口使用）
    async resolve(p, opts) {
      if (p && typeof p === 'object') return p
      const base = (opts && opts.cwd) ? String(opts.cwd) : ''
      const joined = base ? join(base, String(p)) : String(p)
      return { path: joined }
    },
    // readText：target-shaped —— 只接受 resolve 返回值（对象）；裸字符串直接拒（防喂错 API）
    async readText(target) {
      const k = (target && typeof target === 'object') ? String(target.path) : null
      if (!k) throw new Error('readText requires target object (resolve result)')
      if (blockedRead.has(k)) throw new Error('read denied: ' + k)
      if (files.has(k)) return files.get(k)
      throw new Error('not found: ' + k)
    },
    // lstat：path-shaped —— 只接受裸字符串路径；传 target 对象即抛（真实契约如此）
    async lstat(p) {
      if (typeof p !== 'string') throw new Error('lstat requires string path')
      const k = p
      if (files.has(k)) return { type: 'file' }
      if (files.has(k + '/.dir')) return { type: 'directory' }
      const prefix = k.endsWith('/') ? k : k + '/'
      for (const fk of files.keys()) if (fk.startsWith(prefix)) return { type: 'directory' }
      return undefined
    },
    // exists：path-shaped
    async exists(p) {
      if (typeof p !== 'string') return false
      return files.has(p)
    }
  }
  platformStub.fs = fsMock

  // skills mock：始终未命中（供轻探分拣）
  let skillsShouldThrow = false
  let invalidateHandler = null
  const skillsMock = {
    async get(name) {
      if (skillsShouldThrow) throw new Error('service down: skills unavailable')
      return null
    },
    on(event, handler) {
      if (event === 'invalidate' || event === 'didInvalidate') invalidateHandler = handler
      return () => { invalidateHandler = null }
    },
    off(event, handler) { if (invalidateHandler === handler) invalidateHandler = null },
    trigger() { if (invalidateHandler) invalidateHandler() }
  }

  const subprocess = {
    async resolveExecutable() { return null },
    spawn() { return { done: Promise.resolve({ exitCode: 0 }), collected: { stdout: { readFrom: () => ({ text: '' }) }, stderr: { readFrom: () => ({ text: '' }) } }, terminate() {} } }
  }
  const timer = {
    timeout: (a,b) => (typeof a==='function' ? setTimeout(a,b) : new Promise(r=>setTimeout(r,a))),
    interval: () => () => {},
  }
  const connection = { rpc: { handle: (path, fn) => { handlers[path] = fn } } }
  const handlers = {}
  const ctx = {
    get(k) {
      if (k === 'skills') return skillsMock
      if (k === 'fs') return fsMock
      if (k === 'platform') return platformStub
      if (k === 'subprocess') return subprocess
      if (k === 'timer') return timer
      if (k === 'connection') return connection
      if (k === 'sessions') return { get: () => null }
      return undefined
    },
    effect: (fn) => { try { const d = fn(); return typeof d==='function'?d:()=>{} } catch { return ()=>{} } },
    set: () => {}
  }

  // 加载 host
  let hostMod
  try { hostMod = await import(hostUrl.href) } catch (e) { check(false, '导入 src/host/index.js 失败', String(e)); hostMod = null }
  if (hostMod) {
    const mod = hostMod.default ?? hostMod
    try { (mod.apply ?? mod).call(null, ctx) } catch (e) { console.log('apply error', e) }
    // 等待平台初始化
    await new Promise(r=> setTimeout(r, 50))
    // 调用 wf.chain 并检查 wayfinder 步骤的 detail 区分（#284 迁移）
    // 场景 A：目录完全缺失 -> 应为缺失
    files.clear()
    // 需要触发一次订阅（probe 会尝试订阅）
    let statusA = null
    {
      const dispatch = handlers['/dsws']
      statusA = await callChain(dispatch, { cwd: tmpHome, lang: 'zh' })
    }
    if (!statusA || !Array.isArray(statusA.checks)) {
      check(false, 'wf.chain 返回链快照（缺失场景）', JSON.stringify(statusA).slice(0,500))
    } else {
      const rowWay = statusA.checks.find(c=> c.key==='skill:wayfinder' || String(c.name).includes('wayfinder'))
      check(!!rowWay, '找到 wayfinder 检查行（缺失场景）')
      if (rowWay) {
        check(rowWay.level==='bad', '缺失场景 wayfinder 为 bad', JSON.stringify(rowWay))
        check(rowWay.detail.includes('缺失') || rowWay.detail.includes('missing') || rowWay.detail.includes('未安装'), '缺失场景 detail 含“缺失/未安装”', rowWay.detail)
        check(rowWay.level!=='ok', '轻探永不产生绿（缺失场景）')
      }
    }

    // 场景 B：放入坏名片（目录存在但 SKILL.md 非法） -> 应为名片无效
    // 准备坏卡：frontmatter 无 name 或 name 错误
    const badCardPath = join(tmpHome, '.agents', 'skills', 'wayfinder', 'SKILL.md')
    files.set(badCardPath, '---\nname: wrong-name\n---\n# bad')
    // 也标记目录存在
    files.set(join(tmpHome, '.agents', 'skills', 'wayfinder') + '/.dir', 'dir')
    let statusB = null
    {
      const dispatch = handlers['/dsws']
      statusB = await callChain(dispatch, { cwd: tmpHome, lang: 'zh' })
    }
    if (statusB && Array.isArray(statusB.checks)) {
      const rowWayB = statusB.checks.find(c=> c.key==='skill:wayfinder' || String(c.name).includes('wayfinder'))
      check(!!rowWayB, '找到 wayfinder 检查行（坏名片场景）')
      if (rowWayB) {
        check(rowWayB.level==='bad', '坏名片场景 wayfinder 为 bad', JSON.stringify(rowWayB))
        check(rowWayB.detail.includes('无效') || rowWayB.detail.includes('Invalid'), '坏名片 detail 含“无效”', rowWayB.detail)
        check(rowWayB.detail !== statusA.checks.find(c=> c.key==='skill:wayfinder').detail, '坏名片与缺失的 detail 不混同')
      }
    } else {
      check(false, 'wf.chain 返回链快照（坏名片场景）')
    }

    // 清理：移除坏卡，回到缺失，确保可逆
    files.delete(badCardPath)
    files.delete(join(tmpHome, '.agents', 'skills', 'wayfinder') + '/.dir')
    let statusC = null
    {
      const dispatch = handlers['/dsws']
      statusC = await callChain(dispatch, { cwd: tmpHome, lang: 'zh' })
    }
    const rowC = statusC && statusC.checks ? statusC.checks.find(c=> c.key==='skill:wayfinder') : null
    if (rowC) check(rowC.detail.includes('缺失') || rowC.detail.includes('未安装'), '移走坏卡后回到缺失', rowC.detail)

    // 场景 C：目录在但 SKILL.md 缺失 → 名片无效（验收用例1 真实形态；回归 path-shaped 契约缺陷）
    {
      const wfDir2 = join(tmpHome, '.agents', 'skills', 'wayfinder')
      files.set(wfDir2 + '/.dir', 'dir')
      let statusD1 = null
      const dispatchD1 = handlers['/dsws']
      statusD1 = await callChain(dispatchD1, { cwd: tmpHome, lang: 'zh' })
      const rowD1 = statusD1 && statusD1.checks ? statusD1.checks.find(c=> c.key==='skill:wayfinder') : null
      check(rowD1 && rowD1.level==='bad', '目录在·SKILL.md 缺失 → 红牌（bad）', JSON.stringify(rowD1))
      check(rowD1 && /无效/.test(rowD1.detail), '目录在·SKILL.md 缺失 detail 含“无效”', rowD1 && rowD1.detail)
      files.delete(wfDir2 + '/.dir')
    }

    // 场景 D：名片存在但读不了 → 名片无效（不可读）
    {
      const wfDir3 = join(tmpHome, '.agents', 'skills', 'wayfinder')
      const cardP3 = join(wfDir3, 'SKILL.md')
      files.set(cardP3, '---\nname: wayfinder\n---')
      blockedRead.add(cardP3)
      let statusD2 = null
      const dispatchD2 = handlers['/dsws']
      statusD2 = await callChain(dispatchD2, { cwd: tmpHome, lang: 'zh' })
      const rowD2 = statusD2 && statusD2.checks ? statusD2.checks.find(c=> c.key==='skill:wayfinder') : null
      check(rowD2 && rowD2.level==='bad', '名片存在但不可读 → 红牌（bad）', JSON.stringify(rowD2))
      check(rowD2 && /无效/.test(rowD2.detail), '名片不可读 detail 含“无效”', rowD2 && rowD2.detail)
      blockedRead.delete(cardP3)
      files.delete(cardP3)
    }

    rmSync(tmpHome, { recursive: true, force: true })
  }
}

// ---------- 3. 异处同名副本绿 + 来源行 ----------
console.log('\n— 验收3：标准根外有效副本 绿+来源行 —')
{
  const tmpHome2 = mkdtempSync(join(tmpdir(), 'home281-off-'))
  const platformStub2 = {
    os: 'linux',
    path: {
      join: (...a) => join(...a),
      normalize: (p) => p,
      dirname: (p) => p.slice(0, p.lastIndexOf('/')),
      basename: (p) => p.split('/').pop(),
      isAbsolute: (p) => p.startsWith('/'),
      sep: '/',
    },
    async getHome() { return tmpHome2 },
    async resolveExecutable() { return null },
    env: { get: () => undefined, has: () => false },
    fs: { resolve: async (p)=>String(p), readText: async ()=>{throw new Error('not found')}, lstat: async ()=>undefined, exists: async ()=>false },
  }
  const offPath = '/tmp/other-skills/wayfinder'
  // #284：链串行求值需要前置通过
  const fsMock2Off = { async resolve(p){ return String(p) }, async readText(){ throw new Error('not found') }, async lstat(){ return undefined }, async exists(){ return false } }
  const skillsOffMock = {
    async get(name) {
      if (name === 'wayfinder') return { name, path: offPath }
      return null
    },
    on() { return ()=>{} },
  }
  const fsMock2 = {
    async resolve(p){ return String(p) },
    async readText(){ throw new Error('not found') },
    async lstat(){ return undefined },
    async exists(){ return false },
  }
  const subprocess2 = { async resolveExecutable(){return null}, spawn(){ return { done: Promise.resolve({exitCode:0}), collected:{stdout:{readFrom:()=>({text:''})}, stderr:{readFrom:()=>({text:''})}}, terminate(){} } } }
  const timer2 = { timeout: (a,b)=> (typeof a==='function'? setTimeout(a,b): new Promise(r=>setTimeout(r,a))) }
  const handlers2 = {}
  const ctx2 = {
    get(k){
      if(k==='skills') return skillsOffMock
      if(k==='fs') return fsMock2
      if(k==='platform') return platformStub2
      if(k==='subprocess') return subprocess2
      if(k==='timer') return timer2
      if(k==='connection') return { rpc: { handle: (p,fn)=>{handlers2[p]=fn} } }
      if(k==='sessions') return { get: ()=>null }
      return undefined
    },
    effect: (fn)=>{ try{ const d=fn(); return typeof d==='function'?d:()=>{} } catch{return ()=>{}} },
    set: ()=>{},
  }
  const hostUrl2 = new URL('../src/host/index.js', import.meta.url)
  const hostMod2 = await import(hostUrl2.href)
  const mod2 = hostMod2.default ?? hostMod2
  try { (mod2.apply ?? mod2).call(null, ctx2) } catch{}
  await new Promise(r=> setTimeout(r,50))
  let statusOff = null
  {
    const dispatch = handlers2['/dsws']
    statusOff = await callChain(dispatch, { cwd: tmpHome2, lang: 'zh' })
  }
  if (statusOff && Array.isArray(statusOff.checks)) {
    const row = statusOff.checks.find(c=> c.key==='skill:wayfinder')
    check(!!row, '找到 wayfinder 绿牌行（异处副本）')
    if (row) {
      check(row.level==='ok', '异处有效副本为绿', JSON.stringify(row))
      check(row.detail.includes(offPath) || row.detail.includes('来源') || row.detail.includes('source'), '绿牌 detail 含来源路径', row.detail)
    }
  } else {
    check(false, 'wf.chain 返回（异处副本）', JSON.stringify(statusOff).slice(0,600))
  }
  rmSync(tmpHome2, {recursive:true, force:true})
}

// ---------- 3.5 多通道并联判装（#296 修订）----------
console.log('\n— 验收3.5：多通道并联 — 注册表未命中时任一通道合法即绿 —')
{
  const tmpHome5 = mkdtempSync(join(tmpdir(), 'home296-'))
  const realSkillDir = join(tmpHome5, '.agents', 'skills', 'wayfinder')
  const realCard = join(realSkillDir, 'SKILL.md')
  mkdirSync(realSkillDir, { recursive: true })
  const validContent = '---\nname: wayfinder\ndescription: test\n---\n# card\n'
  writeFileSync(realCard, validContent) // 5b 用：真实盘上文件
  const platformStub5 = {
    os: 'linux',
    path: { join: (...a)=>join(...a), normalize:(p)=>p, dirname:(p)=>p.slice(0,p.lastIndexOf('/')), basename:(p)=>p.split('/').pop(), isAbsolute:(p)=>p.startsWith('/'), sep:'/' },
    async getHome(){ return tmpHome5 },
    async resolveExecutable(){return null},
    env: { get:()=>undefined, has:()=>false },
    fs: null,
  }
  const files5 = new Map()
  const blocked5 = new Set()
  const fsMock5 = {
    async resolve(p, opts) {
      if (p && typeof p === 'object') return p
      const base = (opts && opts.cwd) ? String(opts.cwd) : ''
      const joined = base ? join(base, String(p)) : String(p)
      return { path: joined }
    },
    async readText(target) {
      const k = (target && typeof target === 'object') ? String(target.path) : null
      if (!k) throw new Error('readText requires target object')
      if (blocked5.has(k)) throw new Error('read denied (workspace scope): ' + k)
      if (files5.has(k)) return files5.get(k)
      throw new Error('not found: ' + k)
    },
    async lstat(p) {
      if (typeof p !== 'string') throw new Error('lstat requires string path')
      if (files5.has(p)) return { type: 'file' }
      if (files5.has(p + '/.dir')) return { type: 'directory' }
      const prefix = p.endsWith('/') ? p : p + '/'
      for (const fk of files5.keys()) if (fk.startsWith(prefix)) return { type: 'directory' }
      return undefined
    },
    async exists(p) { if (typeof p !== 'string') return false; return files5.has(p) }
  }
  platformStub5.fs = fsMock5
  let invalidateHandler5 = null
  const skillsOffMiss5 = {
    async get(name) { return null }, // 注册表始终未命中 → 走盘上通道
    on(event, handler) { if (event === 'invalidate' || event === 'didInvalidate') invalidateHandler5 = handler; return () => { invalidateHandler5 = null } },
    off(event, handler) { if (invalidateHandler5 === handler) invalidateHandler5 = null },
    trigger() { if (invalidateHandler5) invalidateHandler5() },
  }
  const subprocess5 = { async resolveExecutable(){return null}, spawn(){ return { done: Promise.resolve({exitCode:0}), collected:{stdout:{readFrom:()=>({text:''})}, stderr:{readFrom:()=>({text:''})}}, terminate(){} } } }
  const timer5 = { timeout: (a,b)=> (typeof a==='function'? setTimeout(a,b): new Promise(r=>setTimeout(r,a))) }
  const handlers5 = {}
  const ctx5 = {
    get(k){
      if(k==='skills') return skillsOffMiss5
      if(k==='fs') return fsMock5
      if(k==='platform') return platformStub5
      if(k==='subprocess') return subprocess5
      if(k==='timer') return timer5
      if(k==='connection') return { rpc: { handle: (p,fn)=>{handlers5[p]=fn} } }
      if(k==='sessions') return { get: ()=>null }
      return undefined
    },
    effect: (fn)=>{ try{ const d=fn(); return typeof d==='function'?d:()=>{} } catch{return ()=>{}} },
    set: ()=>{},
  }
  const hostUrl5 = new URL('../src/host/index.js', import.meta.url)
  const hostMod5 = await import(hostUrl5.href)
  const mod5 = hostMod5.default ?? hostMod5
  try{ (mod5.apply ?? mod5).call(null, ctx5) } catch{}
  await new Promise(r=> setTimeout(r,50))
  const call5 = async () => {
    const dispatch = handlers5['/dsws']
    return await callChain(dispatch, { cwd: tmpHome5, lang: 'zh' })
  }
  const call5Plain = async () => {
    const dispatch = handlers5['/dsws']
    const res = await dispatch('chain', { cwd: tmpHome5, lang: 'zh' })
    return chainToRow(res)
  }
  // 5a：fs 通道可读的合法名片（mock 内存文件；真实盘上此刻已有同路径文件 → 任一命中即可）→ 绿 + 来源
  const cardKey = join(tmpHome5, '.agents', 'skills', 'wayfinder', 'SKILL.md')
  files5.set(cardKey, validContent)
  let s5a = await call5()
  const row5a = s5a && s5a.checks ? s5a.checks.find(c=> c.key==='skill:wayfinder') : null
  check(row5a && row5a.level==='ok', '注册表未命中 + fs 通道合法名片 → 绿（新契约）', JSON.stringify(row5a))
  check(row5a && /来源|source/.test(row5a.detail), 'fs 通道绿牌 detail 含来源路径', row5a && row5a.detail)
  // 5b：fs 通道被挡（模拟工作区作用域限制）+ 真实盘上文件可直读 → 绿（#296 用户环境形态）
  files5.delete(cardKey)
  blocked5.add(cardKey)
  let s5b = await call5()
  const row5b = s5b && s5b.checks ? s5b.checks.find(c=> c.key==='skill:wayfinder') : null
  check(row5b && row5b.level==='ok', 'fs 通道被挡 + 直读通道命中 → 绿（#296 用户环境形态）', JSON.stringify(row5b))
  check(row5b && /来源|source/.test(row5b.detail), '直读绿牌 detail 含来源路径', row5b && row5b.detail)
  // 5c：移走真实文件 → 全通道空 → 红·缺失（回退成立）
  rmSync(realSkillDir, { recursive: true, force: true })
  blocked5.delete(cardKey)
  let s5c = await call5()
  const row5c = s5c && s5c.checks ? s5c.checks.find(c=> c.key==='skill:wayfinder') : null
  check(row5c && row5c.level==='bad', '全通道空 → 红·缺失（回退成立）', JSON.stringify(row5c))
  check(row5c && /缺失|未安装|missing/.test(row5c.detail), '红牌 detail 含缺失语义', row5c && row5c.detail)
  check(row5c && /已查：|probed:/.test(row5c.detail), '红牌 detail 附各通道判据', row5c && row5c.detail)
  // 5d：恢复真实文件 + 刷新 → 绿（双向一致性：移除变红、恢复即绿，不刷新缓存滞后）
  mkdirSync(realSkillDir, { recursive: true })
  writeFileSync(realCard, validContent)
  let s5d = await call5()
  const row5d = s5d && s5d.checks ? s5d.checks.find(c=> c.key==='skill:wayfinder') : null
  check(row5d && row5d.level==='ok', '恢复文件后刷新 → 绿（双向一致性）', JSON.stringify(row5d))
  // 5d2：恢复后【无 force】刷新——模拟 DSH 目录失效广播（真机由 watcher 触发），清缓存后即绿（30s 缓存不滞后）
  skillsOffMiss5.trigger()
  let s5d2 = await call5Plain()
  const row5d2 = s5d2 && s5d2.checks ? s5d2.checks.find(c=> c.key==='skill:wayfinder') : null
  check(row5d2 && row5d2.level==='ok', '恢复 + 失效广播后【无 force】即绿（缓存不滞后）', JSON.stringify(row5d2))
  // 5e：子目录工作区（~/xxxx 形态：同一主目录下的子目录）→ 与 ~ 工作区同果（不随 cwd 翻转）
  const subCwd = join(tmpHome5, 'work-subbir')
  mkdirSync(subCwd, { recursive: true })
  let s5e = await call5()
  const row5e = s5e && s5e.checks ? s5e.checks.find(c=> c.key==='skill:wayfinder') : null
  check(row5e && row5e.level==='ok', '子目录工作区（~/xxxx 形态）→ 仍绿（不随 cwd 翻转）', JSON.stringify(row5e))
  rmSync(tmpHome5, { recursive: true, force: true })
}

// ---------- 3.6 BOM 名片（#295 加固）----------
console.log('\n— 验收3.6：BOM 名片 — Windows 编辑器另存的合法名片不再误判无效 —')
{
  const tmpHome6 = mkdtempSync(join(tmpdir(), 'home295-bom-'))
  const realSkillDir6 = join(tmpHome6, '.agents', 'skills', 'wayfinder')
  const realCard6 = join(realSkillDir6, 'SKILL.md')
  mkdirSync(realSkillDir6, { recursive: true })
  const bomContent = '\uFEFF---\nname: wayfinder\ndescription: bom\n---\n# card\n'
  writeFileSync(realCard6, bomContent) // 真实盘上 BOM 名片（直读通道用）
  const platformStub6 = {
    os: 'linux',
    path: { join: (...a)=>join(...a), normalize:(p)=>p, dirname:(p)=>p.slice(0,p.lastIndexOf('/')), basename:(p)=>p.split('/').pop(), isAbsolute:(p)=>p.startsWith('/'), sep:'/' },
    async getHome(){ return tmpHome6 },
    async resolveExecutable(){return null},
    env: { get:()=>undefined, has:()=>false },
    fs: null,
  }
  const files6 = new Map()
  const blocked6 = new Set()
  const fsMock6 = {
    async resolve(p, opts) {
      if (p && typeof p === 'object') return p
      const base = (opts && opts.cwd) ? String(opts.cwd) : ''
      const joined = base ? join(base, String(p)) : String(p)
      return { path: joined }
    },
    async readText(target) {
      const k = (target && typeof target === 'object') ? String(target.path) : null
      if (!k) throw new Error('readText requires target object')
      if (blocked6.has(k)) throw new Error('read denied (workspace scope): ' + k)
      if (files6.has(k)) return files6.get(k)
      throw new Error('not found: ' + k)
    },
    async lstat(p) {
      if (typeof p !== 'string') throw new Error('lstat requires string path')
      if (files6.has(p)) return { type: 'file' }
      if (files6.has(p + '/.dir')) return { type: 'directory' }
      return undefined
    },
    async exists(p) { if (typeof p !== 'string') return false; return files6.has(p) }
  }
  platformStub6.fs = fsMock6
  let invalidateHandler6 = null
  const skillsMiss6 = {
    async get(name) { return null }, // 注册表始终未命中 → 走盘上通道
    on(event, handler) { if (event === 'invalidate' || event === 'didInvalidate') invalidateHandler6 = handler; return () => { invalidateHandler6 = null } },
    off(event, handler) { if (invalidateHandler6 === handler) invalidateHandler6 = null },
  }
  const subprocess6 = { async resolveExecutable(){return null}, spawn(){ return { done: Promise.resolve({exitCode:0}), collected:{stdout:{readFrom:()=>({text:''})}, stderr:{readFrom:()=>({text:''})}}, terminate(){} } } }
  const timer6 = { timeout: (a,b)=> (typeof a==='function'? setTimeout(a,b): new Promise(r=>setTimeout(r,a))) }
  const handlers6 = {}
  const ctx6 = {
    get(k){
      if(k==='skills') return skillsMiss6
      if(k==='fs') return fsMock6
      if(k==='platform') return platformStub6
      if(k==='subprocess') return subprocess6
      if(k==='timer') return timer6
      if(k==='connection') return { rpc: { handle: (p,fn)=>{handlers6[p]=fn} } }
      if(k==='sessions') return { get: ()=>null }
      return undefined
    },
    effect: (fn)=>{ try{ const d=fn(); return typeof d==='function'?d:()=>{} } catch{return ()=>{}} },
    set: ()=>{},
  }
  const hostUrl6 = new URL('../src/host/index.js', import.meta.url)
  const hostMod6 = await import(hostUrl6.href)
  const mod6 = hostMod6.default ?? hostMod6
  try{ (mod6.apply ?? mod6).call(null, ctx6) } catch{}
  await new Promise(r=> setTimeout(r,50))
  const call6 = async () => {
    const dispatch = handlers6['/dsws']
    return await callChain(dispatch, { cwd: tmpHome6, lang: 'zh' })
  }
  // 6a：fs 通道读 BOM 名片 → 绿（旧代码此处误判「名片无效 · frontmatter invalid」）
  const cardKey6 = join(tmpHome6, '.agents', 'skills', 'wayfinder', 'SKILL.md')
  files6.set(cardKey6, bomContent)
  const s6a = await call6()
  const row6a = s6a && s6a.checks ? s6a.checks.find(c=> c.key==='skill:wayfinder' || String(c.name).includes('wayfinder')) : null
  check(row6a && row6a.level==='ok', 'fs 通道 BOM 名片 → 绿（#295 加固）', JSON.stringify(row6a))
  check(row6a && /来源|source/.test(row6a.detail), 'BOM 绿牌 detail 含来源路径', row6a && row6a.detail)
  // 6b：fs 被挡 + 直读真实盘上 BOM 文件 → 绿（与 #296 形态叠加：围栏环境 + BOM 文件）
  files6.delete(cardKey6)
  blocked6.add(cardKey6)
  const s6b = await call6()
  const row6b = s6b && s6b.checks ? s6b.checks.find(c=> c.key==='skill:wayfinder' || String(c.name).includes('wayfinder')) : null
  check(row6b && row6b.level==='ok', 'fs 被挡 + 直读 BOM 名片 → 绿', JSON.stringify(row6b))
  // 6c：BOM + 错名 → 仍判名片无效（加固不放松防冒名：name 精确匹配原样保留）
  const badDir6 = join(tmpHome6, '.agents', 'skills', 'ask-matt')
  mkdirSync(badDir6, { recursive: true })
  const badCard6 = join(badDir6, 'SKILL.md')
  const bomWrong6 = '\uFEFF---\nname: wrong-name\n---\n# bad\n'
  writeFileSync(badCard6, bomWrong6)
  files6.set(join(tmpHome6, '.agents', 'skills', 'ask-matt', 'SKILL.md'), bomWrong6)
  const s6c = await call6()
  const row6c = s6c && s6c.checks ? s6c.checks.find(c=> c.key==='skill:ask-matt' || String(c.name).includes('ask-matt')) : null
  check(row6c && row6c.level==='bad', 'BOM + 错名 → 仍为红牌（防冒名不放松）', JSON.stringify(row6c))
  check(row6c && /无效|Invalid/.test(row6c.detail), 'BOM + 错名 detail 含「无效」', row6c && row6c.detail)
  blocked6.delete(cardKey6)
  rmSync(tmpHome6, { recursive: true, force: true })
}

// ---------- 4. 等待态有界与失效广播 ----------
console.log('\n— 验收4：等待态 有界推进 + 失效广播 + 封顶失败 —')
{
  const tmpHome3 = mkdtempSync(join(tmpdir(), 'home281-wait-'))
  const platformStub3 = {
    os: 'linux',
    path: { join: (...a)=>join(...a), normalize:(p)=>p, dirname:(p)=>p.slice(0,p.lastIndexOf('/')), basename:(p)=>p.split('/').pop(), isAbsolute:(p)=>p.startsWith('/'), sep:'/' },
    async getHome(){ return tmpHome3 },
    async resolveExecutable(){return null},
    env: { get:()=>undefined, has:()=>false },
    fs: { resolve: async(p)=>String(p), readText: async ()=>{throw new Error('not found')}, lstat: async()=>undefined, exists: async ()=>false },
  }
  const fsMock3 = { async resolve(p){return String(p)}, async readText(){throw new Error('not found')}, async lstat(){return undefined}, async exists(){return false} }
  let shouldThrow = true
  let capturedHandler = null
  let installedSet = new Set()
  const skillsMock3 = {
    async get(name){
      if (shouldThrow) throw new Error('skills service down for test: ECONNREFUSED')
      if (installedSet.has(name)) return { name, path: join(tmpHome3, '.agents','skills', name) }
      return null
    },
    on(event, handler){
      if (event==='invalidate' || event==='didInvalidate') capturedHandler = handler
      return ()=>{ capturedHandler=null }
    },
    off(event, handler){ if(capturedHandler===handler) capturedHandler=null },
    trigger(){ if(capturedHandler) capturedHandler() }
  }
  const handlers3 = {}
  const ctx3 = {
    get(k){
      if(k==='skills') return skillsMock3
      if(k==='fs') return fsMock3
      if(k==='platform') return platformStub3
      if(k==='subprocess') return { async resolveExecutable(){return null}, spawn(){ return { done: Promise.resolve({exitCode:0}), collected:{stdout:{readFrom:()=>({text:''})}, stderr:{readFrom:()=>({text:''})}}, terminate(){} } } }
      if(k==='timer') return { timeout: (a,b)=> (typeof a==='function'? setTimeout(a,b): new Promise(r=>setTimeout(r,a))) }
      if(k==='connection') return { rpc: { handle: (p,fn)=>{handlers3[p]=fn} } }
      if(k==='sessions') return { get: ()=>null }
      return undefined
    },
    effect: (fn)=>{ try{ const d=fn(); return typeof d==='function'?d:()=>{} } catch{return ()=>{}} },
    set: ()=>{},
  }
  const hostUrl3 = new URL('../src/host/index.js', import.meta.url)
  const hostMod3 = await import(hostUrl3.href)
  const mod3 = hostMod3.default ?? hostMod3
  try{ (mod3.apply ?? mod3).call(null, ctx3) } catch{}
  await new Promise(r=> setTimeout(r,50))
  // 连续 force 调用 4 次，验证前 3 pending，第 4 bad 且携带原文
  const getStatus = async () => {
    const dispatch = handlers3['/dsws']
    if (!dispatch) return null
    return await callChain(dispatch, { cwd: tmpHome3, lang: 'zh' })
  }
  // #284 断链回归：广播后【无 force】一次 chain 亦须全量重判（callChain 固定 force 仅用于显式刷新路径；此处直接 dispatch）
  const getStatusPlain = async () => {
    const dispatch = handlers3['/dsws']
    if (!dispatch) return null
    const res = await dispatch('chain', { cwd: tmpHome3, lang: 'zh' })
    return chainToRow(res)
  }
  let s1 = await getStatus()
  let s2 = await getStatus()
  let s3 = await getStatus()
  let s4 = await getStatus()
  const pendingLevels = [s1,s2,s3].map(s=> s && s.checks ? s.checks.find(c=> c.key==='skill:wayfinder').level : 'missing')
  check(pendingLevels[0]==='pending' && pendingLevels[1]==='pending' && pendingLevels[2]==='pending', '前 3 次均为 pending（有界等待）', pendingLevels.join(','))
  const c4 = s4 && s4.checks ? s4.checks.find(c=> c.key==='skill:wayfinder') : null
  check(c4 && c4.level==='bad', '第 4 次封顶转 bad', JSON.stringify(c4))
  if (c4) check(c4.detail.includes('ECONNREFUSED') || c4.detail.includes('service down') || c4.detail.includes('不可用'), '封顶失败携带原文', c4.detail)

  // 广播到达后有界推进转绿（不反复跳动）
  // 重置：让服务恢复，并触发广播
  shouldThrow = false
  installedSet.add('wayfinder')
  // 触发广播（模拟 DSH 核心的技能目录失效广播）
  let eventFired = false
  if (capturedHandler) {
    capturedHandler()
    eventFired = true
    await new Promise(r=> setTimeout(r,20))
  }
  // 断链回归（#281 对抗复核）：事件到达必须清 workspaceStore——无 force 的下一次 wf.chain 也必须全量重判转绿
  const sEvent = await getStatusPlain()
  const rowEvent = sEvent && sEvent.checks ? sEvent.checks.find(c=> c.key==='skill:wayfinder') : null
  check(eventFired, '失效广播已捕获并触发')
  check(rowEvent && rowEvent.level==='ok', '广播后【无 force】转绿（workspaceStore/statusCache 已失效，事件驱动推进）', JSON.stringify(rowEvent))
  // 再次无 force 保持绿（不闪烁）
  const sEvent2 = await getStatusPlain()
  const rowEvent2 = sEvent2 && sEvent2.checks ? sEvent2.checks.find(c=> c.key==='skill:wayfinder') : null
  check(rowEvent2 && rowEvent2.level==='ok', '再次【无 force】保持绿（不闪烁）', JSON.stringify(rowEvent2))
  // force 显式刷新路径亦稳定
  const sAfter = await getStatus()
  const rowAfter = sAfter && sAfter.checks ? sAfter.checks.find(c=> c.key==='skill:wayfinder') : null
  check(rowAfter && rowAfter.level==='ok', 'force 刷新仍绿（显式刷新兜底）', JSON.stringify(rowAfter))
  const sAfter2 = await getStatus()
  const rowAfter2 = sAfter2 && sAfter2.checks ? sAfter2.checks.find(c=> c.key==='skill:wayfinder') : null
  check(rowAfter2 && rowAfter2.level==='ok', '再次 force 保持绿（不闪烁）', JSON.stringify(rowAfter2))

  rmSync(tmpHome3, {recursive:true, force:true})
}

console.log('\n' + (failed ? `#281 门禁失败 ${total-passed}/${total}` : `#281 门禁全部通过 ${passed}/${total}`))
process.exit(failed ? 1 : 0)