// verify-handoff-isolation-787.js — #787 交接会话隔离（TDD 先红后绿）
// 用法: node tests/verify-handoff-isolation-787.js [file...]（默认 client.js + package/lib/client.js 双产物）
//
// 验收来源：#787 正文「对抗式审查与优化后方案」+ Agent Brief v2。
//   P0-1 交接记忆住会话自己身上（时间戳、真实文件名、记下那一刻的目录），读时目录对不上视为无记忆（fail-closed）。
//   P0-2 草稿写进目标会话自己的存放，取完清空，建号失败删孤儿。
//   P0-3 防抖计时放会话自己身上，800 毫秒不动。
//   P0-4 契约与门禁同步（旧全局名删除）。
//   P1-1 时间戳加毫秒，同秒两次各对各的文件。
//
// 本测试不复制业务逻辑：从目标文件提取真实函数源码并在沙箱以忠实替身执行
// （与 verify-handoff-split.js 同范式），能抓住“逻辑改坏 / 双源漂移”两类回归。
const fs = require('fs')
const assert = require('assert')
const { compileFn } = require('./lib/eval-probe.js')

const files = process.argv.slice(2).length ? process.argv.slice(2) : ['client.js', 'package/lib/client.js']
const readSrc = (f) => fs.readFileSync(f, 'utf8')

// ---- 提取：交接执行块（含目录校验助手到 #361 开新会话入口之前）----
function extractHandoffBlock(src) {
  const startMarkers = ['const handoffCwdMatches = function', 'const probeHandoffReady = function']
  let i = -1
  for (const m of startMarkers) { i = src.indexOf(m); if (i >= 0) break }
  if (i < 0) throw new Error('起始锚点缺失: handoffCwdMatches / probeHandoffReady')
  const j = src.indexOf('// #361：在新会话中打开', i)
  if (j < 0) throw new Error('终止锚点缺失: #361 注释')
  return src.slice(i, j)
}

// ---- 提取：单点工厂 createPTCSession ----
function extractFactoryBlock(src) {
  const i = src.indexOf('const createPTCSession = function')
  if (i < 0) throw new Error('起始锚点缺失: createPTCSession')
  const j = src.indexOf('命名守护', i)
  if (j < 0) throw new Error('终止锚点缺失: 命名守护')
  return src.slice(i, j)
}

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

// ---- 会话 store 替身工厂（每个会话独立对象 = 真实 storeOf 语义）----
function mkSt(sid, cwd) {
  return {
    sessionId: sid, cwd: cwd || 'D:/repo',
    handoffTs: null, handoffFile: null, handoffCwd: '',
    handoffReady: false, handoffSearching: false,
    _lastHandoffOpenTs: 0, incomingDraft: null,
  }
}

// ---- 沙箱：跑真实 probeHandoffReady + doHandoff + doHandoffOpen ----
function runHandoffSandbox(fnSrc, opt) {
  const st = opt.st
  const calls = []
  const copied = []
  const flashes = []
  const injected = []
  const opened = []
  const storeMap = opt.storeMap || {}
  const storeOfStub = function (sid) {
    if (!storeMap[sid]) storeMap[sid] = mkSt(sid, st.cwd)
    return storeMap[sid]
  }
  const sessionsStub = {
    create: function (o) { const sid = 'sid-new-' + (Object.keys(storeMap).length + 1); opened.push({ sid: sid, opts: o }); return Promise.resolve(sid) },
    open: function () {},
    list: { getSnapshot: function () { return { byId: {} } } },
    scope: function () { return {} },
    sessionOf: function () { return { rename: async function () { return { ok: true, value: { title: 'ok' } } } } },
  }
  const ctxStub = { get: function (k) { if (k === 'sessions') return sessionsStub; return null } }
  const hostStub = { call: function (n, a) { calls.push({ name: n, arg: a }); return opt.probe(n, a) } }
  const mockOpen = opt.mockOpen || function (s_, text_, title_) {
    opened.push({ text: text_, title: title_ })
    return sessionsStub.create({ workspaceId: 'ws-test', agentPreset: 'ptc' }).then(function (sid) {
      storeOfStub(sid).incomingDraft = text_
      return sid
    })
  }
  const prelude =
    'var openTextInNewSession = mockOpen;\n' +
    'var buildCreateOpts = function(wid,cwd){ return wid?{workspaceId:wid,agentPreset:"ptc"}:{cwd:cwd,agentPreset:"ptc"}};\n' +
    'var createPTCSession = function(sess,wid,cwd,txt){ var opts=buildCreateOpts(wid,cwd); return sess.create(opts).then(function(sid){ return sid }) };\n' +
    'var getCwdSync = function(){ return null }; var keyOf=function(s){ return String(s||"").toLowerCase().split("\\\\").join("/").replace(/\\/+$/,"") };\n' +
    'var storeOf = storeOfStub; var hydrateFromCache=function(){return false}; var getCachedSnapshot=function(){return null};\n' +
    'var namingHintOf=function(){return null}; var isNewPlaceholderTitle=function(){return false}; var namingGuardianKick=function(){};\n' +
    'var isReusableBlank=function(){return false}; var getRowPreset=function(){return "ptc"}; var isHealthyPreset=function(){return true};\n'
  // 本文件选 compileFn：三处原来都是「把依赖名当参数、把从产物里切出来的源码当函数体」造函数再调用，
  //   依赖本来就全部显式传参（切出来的代码读不到本文件作用域），与共用入口用法一一对应。
  const $ = compileFn(
    ['st', 'ctx', 'host', 'emit', 'timer', 'timeStampStr', 'handoffPrompt',
      'inject', 'flash', 'tr', 'copyText', 'handoffReadText', 'mockOpen', 'storeOfStub'],
    prelude + fnSrc + '\n; return { probeHandoffReady: probeHandoffReady, doHandoff: doHandoff, doHandoffOpen: doHandoffOpen }'
  )
  const fns = $(
    st, ctxStub, hostStub,
    function () {},
    { timeout: function (fn) { return -1 } },
    opt.timeStampStr || function () { return '20260930-000000-000' },
    function (ts) { return '/handoff 写到 .scratch/handoff/' + ts + '.md' },
    function (st_, text) { injected.push(text) },
    function (st_, msg, kind) { flashes.push({ msg: msg, kind: kind }) },
    function (k) { return k },
    function (st_, text, msg) { copied.push({ text: text, msg: msg }) },
    function (file) { return '/read .scratch/handoff/' + (file || 'latest.md') },
    mockOpen, storeOfStub
  )
  const invoke = function (which) {
    if (which === 'open') return fns.doHandoffOpen(st)
    if (which === 'probe') return fns.probeHandoffReady(st)
    return fns.doHandoff(st)
  }
  return Promise.resolve(invoke(opt.via)).then(function () {
    return new Promise(function (resolve) { setTimeout(function () { resolve({ st: st, calls: calls, copied: copied, flashes: flashes, injected: injected, opened: opened, storeMap: storeMap }) }, 15) })
  })
}

// ---- 沙箱：跑真实 createPTCSession（双会话连续创建，断言草稿各归各）----
// sidValue 非空缺省时 create 依次返回 sid-factory-N；传入（含空串）则每次都返回它。
function runFactorySandbox(factorySrc, texts, sidValue) {
  const storeMap = {}
  const storeOfStub = function (sid) {
    if (!storeMap[sid]) storeMap[sid] = { incomingDraft: null }
    return storeMap[sid]
  }
  let n = 0
  const sessionsStub = { create: function () { n++; return Promise.resolve(sidValue !== undefined ? sidValue : ('sid-factory-' + n)) } }
  const prelude = 'var buildCreateOpts = function(wid,cwd){ return wid?{workspaceId:wid,agentPreset:"ptc"}:{cwd:cwd,agentPreset:"ptc"}};\nvar storeOf = storeOfStub;\n'
  // 同上：单点工厂这一处的两个依赖也是逐字传参。
  const g = compileFn(['sessions', 'storeOfStub'], prelude + factorySrc + '\n; return createPTCSession')
  const factory = g(sessionsStub, storeOfStub)
  let p = Promise.resolve()
  const out = []
  texts.forEach(function (t) {
    p = p.then(function () { return factory(sessionsStub, null, 'D:/repo', t).then(function (sid) { out.push(sid) }) })
  })
  return p.then(function () { return { storeMap: storeMap, sids: out } })
}

let failed = false
let total = 0
function check(ok, msg) {
  total++
  console.log((ok ? '  PASS ' : '  FAIL ') + msg)
  if (!ok) failed = true
}

async function main() {
  for (const file of files) {
    const tag = file.indexOf('package/') >= 0 ? 'npm' : (file.indexOf('src/') >= 0 ? 'src' : 'dyn')
    console.log('=== ' + file + ' ===')
    let src
    try { src = readSrc(file) } catch (e) { check(false, tag + ' 可读 — ' + e.message); continue }
    const code = stripComments(src)

    // ---- Part S：静态契约（新形状已落定，旧全局名已删除）----
    try {
      check(!/(^|[^.\w])(export\s+)?let\s+handoffTs\b/.test(src), tag + ' · 旧全局 handoffTs 已删除')
      check(!/(^|[^.\w])(export\s+)?let\s+handoffFile\b/.test(src), tag + ' · 旧全局 handoffFile 已删除')
      check(!/(^|[^.\w])(export\s+)?let\s+pendingDraft\b/.test(src), tag + ' · 旧全局 pendingDraft 已删除')
      check(!/(^|[^.\w])(export\s+)?let\s+pendingDraftTargetSid\b/.test(src), tag + ' · 旧全局 pendingDraftTargetSid 已删除')
      check(!/(^|[^.\w])let\s+lastHandoffOpenTs\b/.test(code), tag + ' · 旧全局 lastHandoffOpenTs 已删除')
      check(/(^|[^.\w])handoffTs\s*=[^=]/.test(code) === false || /st\.handoffTs\s*=/.test(code), tag + ' · 交接时间戳只写会话自己身上')
      check(!/(^|[^.\w])handoffFile\s*=[^=]/.test(code), tag + ' · 真实文件名无裸写（只许 st.handoffFile）')
      check(!/(^|[^.\w])pendingDraft\s*=[^=]/.test(code), tag + ' · 草稿无裸写（只许目标 store 的 incomingDraft）')
      check(!/(^|[^.\w])pendingDraftTargetSid\s*=[^=]/.test(code), tag + ' · 目标编号无裸写（单槽门已退役）')
      check(/st\._lastHandoffOpenTs/.test(code), tag + ' · 防抖计时在会话自己身上')
      check(/incomingDraft\s*=/.test(code), tag + ' · 草稿写进目标会话存放')
      check(/handoffCwdMatches/.test(code) && /handoffMemoryValid/.test(code), tag + ' · 目录校验助手与记忆有效判断存在')
      check(/handoffCwd/.test(code), tag + ' · 记下那一刻的目录有地方存')
    } catch (e) { check(false, tag + ' 静态契约异常 — ' + e.message) }

    // ---- Part B：行为（双会话沙箱）----
    let fnSrc
    try { fnSrc = extractHandoffBlock(src) }
    catch (e) { check(false, tag + ' 交接块可提取 — ' + e.message); continue }
    const prefixProbe = function (n, a) {
      if (n === 'wf.handoffResolve') {
        const name = (a && a.name) || ''
        if (name.indexOf('TS-A') === 0) return Promise.resolve({ ok: true, file: 'TS-A-doc.md' })
        if (name.indexOf('TS-B') === 0) return Promise.resolve({ ok: true, file: 'TS-B-doc.md' })
        return Promise.resolve({ ok: true, file: null })
      }
      if (n === 'wf.handoffLatest') return Promise.resolve({ ok: true, file: 'LATEST.md' })
      return Promise.reject(new Error('unexpected probe ' + n))
    }
    try {
      // B1 会话隔离：A 记后 B 记，回 A 发仍是 A 的
      const stA = mkSt('sess-A', 'D:/repo'); stA.handoffTs = 'TS-A'; stA.handoffCwd = 'D:/repo'
      const stB = mkSt('sess-B', 'D:/repo'); stB.handoffTs = 'TS-B'; stB.handoffCwd = 'D:/repo'
      const rA = await runHandoffSandbox(fnSrc, { st: stA, via: 'open', probe: prefixProbe })
      const hitA = (rA.copied[0] && rA.copied[0].text) || ''
      check(hitA.indexOf('TS-A-doc.md') >= 0 && hitA.indexOf('TS-B-doc.md') < 0, tag + ' · B1 A 记后 B 记，回 A 发仍是 A 的')
      const rB = await runHandoffSandbox(fnSrc, { st: stB, via: 'open', probe: prefixProbe })
      const hitB = (rB.copied[0] && rB.copied[0].text) || ''
      check(hitB.indexOf('TS-B-doc.md') >= 0 && hitB.indexOf('TS-A-doc.md') < 0, tag + ' · B1 B 发是 B 的（互不可见）')
    } catch (e) { check(false, tag + ' · B1 会话隔离 — ' + e.message) }
    try {
      // B2 同会话后记覆盖先记：记 TS-1 后再记 TS-2，发出去是 TS-2
      const st = mkSt('sess-C', 'D:/repo'); st.handoffTs = 'TS-OLD'; st.handoffCwd = 'D:/repo'
      let tick = 0
      const tsMock = function () { tick++; return tick === 1 ? 'TS-OLD2' : 'TS-NEW' }
      const probe2 = function (n, a) {
        if (n === 'wf.handoffResolve') {
          const name = (a && a.name) || ''
          if (name.indexOf('TS-NEW') === 0) return Promise.resolve({ ok: true, file: 'TS-NEW-doc.md' })
          return Promise.resolve({ ok: true, file: null })
        }
        if (n === 'wf.handoffLatest') return Promise.resolve({ ok: true, file: null })
        return Promise.reject(new Error('unexpected ' + n))
      }
      await runHandoffSandbox(fnSrc, { st: st, via: 'handoff', probe: probe2, timeStampStr: tsMock })
      check(st.handoffTs === 'TS-OLD2' || st.handoffTs === 'TS-NEW', tag + ' · B2 第一击记下自己会话的时间戳')
      st.handoffTs = 'TS-NEW'; st.handoffCwd = 'D:/repo'
      const r = await runHandoffSandbox(fnSrc, { st: st, via: 'open', probe: probe2 })
      const hit = (r.copied[0] && r.copied[0].text) || ''
      check(hit.indexOf('TS-NEW-doc.md') >= 0, tag + ' · B2 同会话后记覆盖先记，发出去是新的')
    } catch (e) { check(false, tag + ' · B2 后记覆盖 — ' + e.message) }
    try {
      // B3 防抖按会话分：A 点后紧接着 B 点，B 不被吞；同会话连点则被挡
      const stA = mkSt('sess-A', 'D:/repo'); stA.handoffFile = 'TS-A-doc.md'; stA.handoffCwd = 'D:/repo'
      const stB = mkSt('sess-B', 'D:/repo'); stB.handoffFile = 'TS-B-doc.md'; stB.handoffCwd = 'D:/repo'
      const noProbe = function () { return Promise.reject(new Error('不应调 host（文件已记下应直接返回）')) }
      const rA = await runHandoffSandbox(fnSrc, { st: stA, via: 'open', probe: noProbe })
      const rB = await runHandoffSandbox(fnSrc, { st: stB, via: 'open', probe: noProbe })
      check(rA.copied.length === 1 && rB.copied.length === 1, tag + ' · B3 跨会话短窗口不互吞（A、B 各发 1 次）')
      const rA2 = await runHandoffSandbox(fnSrc, { st: stA, via: 'open', probe: noProbe })
      check(rA2.copied.length === 0, tag + ' · B3 同会话短窗口连点仍被挡')
    } catch (e) { check(false, tag + ' · B3 防抖隔离 — ' + e.message) }
    try {
      // B4 切目录 fail-closed：当时目录与当前目录不一致 → 灰加引导，不开会话
      const st = mkSt('sess-D', 'D:/repo-B'); st.handoffTs = 'TS-A'; st.handoffCwd = 'D:/repo-A'
      let hostCalls = 0
      const r = await runHandoffSandbox(fnSrc, { st: st, via: 'open', probe: function () { hostCalls++; return Promise.resolve({ ok: true, file: 'UNRELATED.md' }) } })
      check(r.opened.length === 0, tag + ' · B4 切目录不开会话')
      check(r.flashes.some(function (f) { return f.msg === 'toast.handoffGrey' }), tag + ' · B4 切目录灰加引导')
      check(r.copied.length === 0, tag + ' · B4 切目录不复制无关文档')
    } catch (e) { check(false, tag + ' · B4 切目录 fail-closed — ' + e.message) }
    try {
      // B5 刷新路径不断连：无记忆时走最新开一次，下次直接用记下的文件（不再查磁盘）
      const st = mkSt('sess-E', 'D:/repo')
      const r1 = await runHandoffSandbox(fnSrc, { st: st, via: 'open', probe: function (n) {
        if (n === 'wf.handoffLatest') return Promise.resolve({ ok: true, file: 'L.txt' })
        return Promise.reject(new Error('unexpected ' + n))
      } })
      check(((r1.copied[0] && r1.copied[0].text) || '').indexOf('L.txt') >= 0, tag + ' · B5 无记忆走最新开一次')
      st._lastHandoffOpenTs = 0  // 模拟时间流过，排除防抖干扰，只验记忆
      const r2 = await runHandoffSandbox(fnSrc, { st: st, via: 'open', probe: function (n) {
        return Promise.reject(new Error('已记住文件，不应再查磁盘：' + n))
      } })
      const hit2 = (r2.copied[0] && r2.copied[0].text) || ''
      check(r2.calls.length === 0 && hit2.indexOf('L.txt') >= 0, tag + ' · B5 下次直接用记下的文件（目录已随文件记下）')
    } catch (e) { check(false, tag + ' · B5 刷新路径复用 — ' + e.message) }

    // ---- Part T：时间戳毫秒唯一性（P1-1：同秒两次各对各的文件）----
    try {
      check(/getMilliseconds/.test(src), tag + ' · 时间戳带毫秒（同秒碰撞窗口压到毫秒级）')
      const grabTs = function () {
        const m = src.match(/const\s+timeStampStr\s*=\s*\(\)\s*=>\s*\{/)
        if (!m) throw new Error('timeStampStr 未在源中找到')
        const openIdx = src.indexOf('{', m.index)
        let depth = 1
        let i = openIdx + 1
        while (i < src.length && depth > 0) {
          const c = src[i]
          if (c === '{') depth++
          else if (c === '}') depth--
          i++
        }
        return src.slice(m.index, i)
      }
      const tsSrc = grabTs()
      const RealDate = Date
      const fakeDate = function () {
        return {
          getFullYear: () => 2026, getMonth: () => 8, getDate: () => 30,
          getHours: () => 9, getMinutes: () => 32, getSeconds: () => 4, getMilliseconds: () => 42,
        }
      }
      // 同上：时间戳这一处只把假 Date 传进去，实参一个字没变。
      const tsFn = compileFn(['Date'], tsSrc + '\n; return timeStampStr()')
      const out = tsFn(fakeDate)
      check(out === '20260930-093204-042', tag + ' · 时间戳形状 YYYYMMDD-HHMMSS-mmm（实得 ' + out + '）')
      global.Date = RealDate
    } catch (e) { try { global.Date = Date } catch (e2) {}; check(false, tag + ' · T 时间戳毫秒 — ' + e.message) }

    // ---- Part F：单点工厂草稿各归各 ----
    try {
      const fSrc = extractFactoryBlock(src)
      const fCode = stripComments(fSrc)
      check(!/(^|[^.\w])pendingDraft\s*=[^=]/.test(fCode), tag + ' · 工厂无裸草稿写（只许 store 写入）')
      check(/incomingDraft/.test(fCode), tag + ' · 工厂写目标会话存放')
      const res = await runFactorySandbox(fSrc, ['草稿甲', '草稿乙'])
      const got = res.sids.map(function (sid) { return storeOfText(res.storeMap, sid) })
      check(got[0] === '草稿甲' && got[1] === '草稿乙', tag + ' · F 草稿各归各（连续两次创建不覆盖）')
      // F2 空编号不污染共用：建号返回空时链照走，目标 store 无写入
      const resEmpty = await runFactorySandbox(fSrc, ['孤儿草稿'], '')
      check(resEmpty.sids[0] === '' && Object.keys(resEmpty.storeMap).length === 0, tag + ' · F2 空编号不写共用 store')
    } catch (e) { check(false, tag + ' · F 工厂草稿隔离 — ' + e.message) }
  }
  if (failed) { console.log('\n存在失败'); process.exit(1) }
  console.log('\n全部通过（共 ' + total + ' 项）')
}

function storeOfText(map, sid) {
  return map && map[sid] ? map[sid].incomingDraft : undefined
}

main().catch(function (e) { console.error(e); process.exit(1) })
