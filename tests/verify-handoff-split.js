// verify-handoff-split.js — 交接分割按钮 + 引导门（需求1·二阶段 rev）+ handoffFile 主路径（issue #12 BUG4）
// 用法: node tests/verify-handoff-split.js [file...]（默认 client.js + package/lib/client.js 双源）
//
// 验收标准（2026-08-18 拍板 + rev + issue #12 BUG4）：
//   a) 分割按钮：dsws-split 容器 + 左右半（dsws-split-part）+ 细分隔线（dsws-split-div 1px×14px）；
//      外框边框与细分隔线 hover 时才显示（与 seg 常驻透明一致），hover 背景沿用 seg；
//   b) store 默认 handoffReady: false；灰/亮的真实依据 = 磁盘上确实存在交接文档（probeHandoffReady 探测 .scratch/handoff/）；
//      doHandoff（第一击）只注入模板并触发探测，绝不再仅凭第一击把右半置 ready；
//   c) doHandoffOpen 引导门 v3：无论是否点过第一击，一律先探测磁盘——有 latest 才置 ready + 开新会话并预填；
//      没有 → toast 引导（toast.handoffGrey）且绝不打开空会话（原「点过第一击即放行」旁路已删除）；
//   d) 右半未就绪呈禁用态：灰 + opacity .6 + cursor not-allowed + tooltip nav.handoffGreyTitle；
//   e) 新 i18n 键 nav.handoffGreyTitle / toast.handoffGrey（zh/en）齐备；无被取代的历史 toast 键残留。
//   f) issue #12 BUG4 主路径：probeHandoffReady 在 handoffFile 已设时调 handoffResolve（带 name=handoffFile）；
//      handoffFile=null 时退到 handoffLatest；预填的 file = handoffFile（即使 handoffLatest 会返回别的）。
const fs = require('fs')
const assert = require('assert')

const files = process.argv.slice(2).length ? process.argv.slice(2) : ['client.js', 'package/lib/client.js']

// ---- Part A：静态契约 ----
const statChecks = function (src, tag) {
  const ok = (name, cond) => { if (!cond) throw new Error(tag + ' · ' + name); console.log('  PASS ' + tag + ' · ' + name) }
  ok('分割按钮容器 dsws-split', src.includes("className: 'dsws-split'"))
  ok('分割按钮左右半 dsws-split-part ×2', (src.match(/dsws-split-part/g) || []).length >= 2)
  ok('细分隔线 dsws-split-div', src.includes("className: 'dsws-split-div'"))
  ok('分割按钮外框 hover 才有边框', src.includes(".dsws-split{display:inline-flex") && src.includes("border:1px solid transparent"))
  ok('分割按钮 hover 边框 + 分隔线浮现', src.includes('.dsws-split:hover{border-color') && src.includes('.dsws-split:hover .dsws-split-div{opacity:1'))
  ok('左半点击区调用 doHandoff', src.includes('onClick: function (e) { e.stopPropagation(); doHandoff(s) }'))
  ok('右半点击区调用 doHandoffOpen', src.includes('onClick: function (e) { e.stopPropagation(); doHandoffOpen(s) }'))
  ok('右半未就绪禁用态：无系统红圈（cursor default）', src.includes("cursor: 'default'") && !src.includes("cursor: 'not-allowed'"))
  ok('禁用态自定义 SVG 图标 handoff-off 定义', src.includes("case 'handoff-off'"))
  ok('右半图标按就绪态切换（handoff-open / handoff-off）', src.includes("s.handoffReady ? 'handoff-open' : 'handoff-off'"))
  ok('store 默认 handoffReady: false', src.includes('handoffReady: false'))
  ok('探测助手 probeHandoffReady 定义', src.includes('const probeHandoffReady'))
  ok('StatusBar 挂载即探测', src.includes('probeHandoffReady(s)'))
  ok('第一击后触发探测（doHandoff 内 probeHandoffReady(st)）', src.includes('probeHandoffReady(st)'))
  // r2：doHandoff 现在通过 probeHandoffReady 的 handoffFile 短路亮蓝（不是直接置 ready=true），
  //       "不再直接置 ready=true" 旧契约依然成立 —— 不再有「点第一击立即放行开新会话」的旁路
  ok('doHandoff 不再直接置 ready=true（文档未成文不亮蓝 · r2 通过 probeHandoffReady 间接置）', !src.includes('st.handoffReady = true'))
  ok('「点过第一击即放行」旁路已删（no if (handoffFile) {）', !src.includes('if (handoffFile) {'))
  ok('前置探测（host / rpc handoffLatest）仍在（副路径）', /handoffLatest/.test(src))
  // issue #12 BUG4 · r2 主路径契约：handoffFile 已设 → 直接 return done(handoffFile)（不查磁盘）
  //       与初版/r1 不同：r2 不再调 handoffResolve，prompt 与第一击模板时间戳一致（保证两段文本版本一致）
  ok('r2 主路径：handoffFile 已设直接 done(handoffFile)（不查磁盘）', /if\s*\(handoffFile\)\s*return\s+Promise\.resolve\(done\(handoffFile\)\)/.test(src))
  ok('r2 主路径不再传 name（no `name: handoffFile` in probeHandoffReady）', !/name:\s*handoffFile/.test(src))
  ok('r2 副路径：handoffFile=null 走 handoffLatest', /handoffFile/.test(src) && /handoffLatest/.test(src))
  ok('引导门：无 latest → toast.handoffGrey', src.includes("tr('toast.handoffGrey')"))
  ok('糊涂分支已删：no finish(null, toast.copiedHandoffNoLatest)', !src.includes("finish(null, tr('toast.copiedHandoffNoLatest'))"))
  ok('无历史兜底 toast 键残留（noLatest / handoffNotFound / copiedHandoffFail）', !src.includes("'toast.copiedHandoffNoLatest'") && !src.includes("'toast.handoffNotFound'") && !src.includes("'toast.copiedHandoffFail'"))
  ok('nav.handoffGreyTitle zh', src.includes("'nav.handoffGreyTitle': '尚未生成交接文档"))
  ok('nav.handoffGreyTitle en', src.includes("'nav.handoffGreyTitle': 'No handoff doc yet"))
  ok('toast.handoffGrey zh', src.includes("'toast.handoffGrey': '请先点「交接」生成交接文档"))
  ok('toast.handoffGrey en', src.includes("'toast.handoffGrey': 'Click Handoff first"))
  ok('doHandoffOpen 经统一单点工厂 openTextInNewSession（PTC+工作区+首条原子化）', src.includes('openTextInNewSession(st, text'))
  ok('doHandoffOpen 不再裸调 ws.startSession（旧路径已移除）', (src.match(/ws\.startSession\(\)/g)||[]).length===0)
}

// ---- Part B：引导门行为（沙箱执行真实 probeHandoffReady + doHandoff + doHandoffOpen）----
const extractBlock = function (src) {
  const i = src.indexOf('const probeHandoffReady')
  const j = src.indexOf('// #361：在新会话中打开')
  if (i < 0 || j < 0 || j < i) throw new Error('提取锚点缺失')
  return src.slice(i, j)
}
const runHarness = function (fnSrc, opt) {
  let emitCount = 0
  const scheduled = []
  const calls = []  // 记录实际调用的 RPC 名称 + 参数（issue #12 BUG4 验证用）
  const st = { cwd: 'D:/repo', handoffReady: false, injector: null }
  const started = []
  const createdOpts = []
  const copied = []
  const flashes = []
  const injected = []
  const sessionsStub = {
    create: function (opts) { createdOpts.push(opts); const sid='sid-handoff-'+(createdOpts.length); started.push(sid); return Promise.resolve(sid) },
    open: function(sid){ },
    list: { getSnapshot: function(){ return { byId: {} } } },
    scope: function(){ return {} },
    sessionOf: function(){ return { rename: async function(){ return {ok:true, value:{title:'ok'}}}} }
  }
  const wsStub = {
    startSession: function () { started.push('session-ws-legacy'); },
    list: { getSnapshot: function(){ return { items: [{ path: 'D:/repo', workspaceId: 'ws-test' }] } } },
    create: async function(){ return { workspaceId: 'ws-test'} }
  }
  const workspacesStub = wsStub
  const ctxStub = { get: function (k) { if(k==='sessions') return sessionsStub; if(k==='workspaces') return workspacesStub; return null } }
  const mockOpenCalls = []
  const mockOpen = function(s_, text_, title_){
    mockOpenCalls.push({text:text_, title:title_});
    const cwd = s_.cwd || 'D:/repo';
    return sessionsStub.create({ workspaceId: 'ws-test', agentPreset: 'ptc' }).then(function(sid){ return sid })
  }
  // probe 接收 (callName, callArg)；向后兼容旧式 `probe: function () { ... }`（忽略参数）
  const probeCall = function (probe, n, a) { return probe ? probe(n, a) : Promise.reject(new Error('no probe')) }
  const hostStub = { call: function (n, a) { calls.push({ name: n, arg: a }); return opt.hostMissing ? Promise.reject(new Error('no host')) : probeCall(opt.probe, n, a) } }
  const fnSrcWithMock = 'var openTextInNewSession = mockOpen;\n' +
    'var buildCreateOpts = function(wid,cwd){ return wid?{workspaceId:wid,agentPreset:"ptc"}:{cwd:cwd,agentPreset:"ptc"}};\n' +
    'var createPTCSession = function(sess,wid,cwd,txt){ var opts=buildCreateOpts(wid,cwd); return sess.create(opts).then(function(sid){ return sid }) };\n' +
    'var getCwdSync = function(){ return "D:/repo" }; var keyOf=function(s){ return String(s||"").toLowerCase() }; var storeOf=function(){return {cwd:"D:/repo"}}; var hydrateFromCache=function(){return false}; var getCachedSnapshot=function(){return null}; var namingHintOf=function(){return null}; var isNewPlaceholderTitle=function(){return false}; var namingGuardianKick=function(){}; var isReusableBlank=function(){return false}; var getRowPreset=function(){return "ptc"}; var isHealthyPreset=function(){return true};\n' + fnSrc;
  const $ = new Function(
    'st', 'ctx', 'host', 'conn', 'rpcCall', 'emit', 'timer', 'timeStampStr', 'handoffPrompt',
    'extractHandoffFile', 'inject', 'flash', 'tr', 'copyText', 'handoffReadText', 'pendingDraft', 'handoffFile', 'handoffTs', 'mockOpen',
    fnSrcWithMock + '\n; return { probeHandoffReady: probeHandoffReady, doHandoff: doHandoff, doHandoffOpen: doHandoffOpen }'
  )
  const fns = $(
    st, ctxStub, hostStub, { rpc: true },
    function (n, a) { calls.push({ name: n, arg: a }); return opt.hostMissing ? Promise.reject(new Error('no rpc')) : probeCall(opt.probe, n, a) },
    function () { emitCount++ },
    { timeout: function (fn) { scheduled.push(fn); return -1 } },
    function () { return '20260818-000000' },
    function (ts) { return '/handoff 写到 .scratch/handoff/' + ts + '.md（含结论/未完成/建议 skill）' },
    function (text) { const m = String(text || '').match(/\.scratch\/handoff\/([^\s"']+\.md)/); return m ? m[1] : null },
    function (st_, text) { injected.push(text); flashes.push({ msg: 'injected', kind: 'ok' }) },
    function (st_, msg, kind) { flashes.push({ msg: msg, kind: kind }) },
    function (k) { return k },
    function (st_, text, msg) { copied.push({ text: text, msg: msg }) },
    function (file) { return '/read .scratch/handoff/' + (file || 'latest.md') },
    null,
    opt.handoffFile === undefined ? null : opt.handoffFile,
    null,
    mockOpen
  )
  const invoke = function (fn, arg) { const r = fn(arg); return r === undefined ? Promise.resolve() : Promise.resolve(r) }
  return invoke(opt.via === 'open' ? fns.doHandoffOpen : opt.via === 'probe' ? fns.probeHandoffReady : fns.doHandoff, st).then(function () {
    return new Promise(function (resolve) {
      setTimeout(function () {
        resolve({ st: st, started: started, createdOpts: createdOpts, mockOpenCalls: mockOpenCalls, copied: copied, flashes: flashes, injected: injected, scheduled: scheduled, emitCount: emitCount, calls: calls })
      }, 15)
    })
  })
}

const main = async function () {
  let failed = false
  for (const file of files) {
    const tag = file.indexOf('package/') >= 0 ? 'npm' : 'dyn'
    console.log('=== ' + file + ' ===')
    const src = fs.readFileSync(file, 'utf8')
    console.log('-- Part A 静态契约 --')
    try { statChecks(src, tag) }
    catch (e) { failed = true; console.log('  FAIL ' + tag + ' Part A — ' + e.message); continue }
    console.log('-- Part B 引导门行为 --')
    let fnSrc
    try { fnSrc = extractBlock(src) } catch (e) { failed = true; console.log('  FAIL ' + tag + ' 提取异常 — ' + e.message); continue }
    const scenarios = [
      { name: '开新会话：探测有文档 → 放行 + ready=true（经单点工厂 PTC）', via: 'open',
        opt: { probe: function () { return Promise.resolve({ ok: true, file: 'ABC.md' }) }, hostMissing: false },
        assert: function (r) {
          const hit = r.mockOpenCalls && r.mockOpenCalls.length===1 ? r.mockOpenCalls[0] : null;
          assert.ok(hit || r.createdOpts.length>=1, '开新会话 1 次（mockOpen 或 sessions.create）')
          if(hit) assert.ok(hit.text.includes('ABC.md'), '预填读探测到的文档')
          else assert.ok(r.createdOpts[0] && r.createdOpts[0].agentPreset==='ptc', '创建入参显式 ptc')
          if(r.createdOpts.length) assert.strictEqual(r.createdOpts[0].agentPreset,'ptc','显式 ptc')
          assert.strictEqual(r.copied.length, 1)
          if(hit) assert.ok(hit.text.includes('ABC.md') || r.copied[0].text.includes('ABC.md'), '预填读探测到的文档')
          else assert.ok(r.copied[0].text.includes('ABC.md'), '预填读探测到的文档')
          assert.strictEqual(r.st.handoffReady, true, 'ready 置 true')
        } },
      { name: 'r2 替代旁路：handoffFile 已设 → prompt 直接用 handoffFile（不查磁盘；即使 host 探到 ABC.md 也不引用）', via: 'open',
        opt: { probe: function () { return Promise.reject(new Error('r2：handoffFile 已设 → 不应调 host')) }, hostMissing: false, handoffFile: '20260818-000000.md' },
        assert: function (r) {
          assert.strictEqual(r.calls.length, 0, 'r2：handoffFile 已设 → 不调 host probe')
          const hit = r.mockOpenCalls && r.mockOpenCalls[0];
          if(hit) {
            assert.ok(hit.text.includes('20260818-000000.md'), 'prompt 用 handoffFile（与第一击模板时间戳一致 · r2）')
            assert.ok(!hit.text.includes('ABC.md'), 'r2：即使磁盘上有更新的文件也不引用（保证 prompt 与第一击一致）')
          } else {
            assert.strictEqual(r.started.length, 1, '开新会话 1 次')
            assert.ok(r.copied[0].text.includes('20260818-000000.md'), 'prompt 用 handoffFile（与第一击模板时间戳一致 · r2）')
            assert.ok(!r.copied[0].text.includes('ABC.md'), 'r2：即使磁盘上有更新的文件也不引用（保证 prompt 与第一击一致）')
          }
          assert.strictEqual(r.st.handoffReady, true, 'handoffFile 已设 → ready=true（亮蓝）')
        } },
      { name: '开新会话：探测无文档 → 引导 toast，绝不开空会话 + ready=false', via: 'open',
        opt: { probe: function () { return Promise.resolve({ ok: true, file: null }) }, hostMissing: false },
        assert: function (r) {
          assert.strictEqual(r.started.length, 0, '不开空会话')
          assert.strictEqual(r.copied.length, 0, '不复制')
          const grey = r.flashes.filter(function (f) { return f.msg === 'toast.handoffGrey' })
          assert.ok(grey.length >= 1, 'toast.handoffGrey 引导出现')
          assert.strictEqual(r.st.handoffReady, false, 'ready 保持 false（右半仍灰/禁用态）')
        } },
      { name: '开新会话：探测失败 → 引导 toast，绝不开空会话 + ready=false', via: 'open',
        opt: { probe: function () { return Promise.reject(new Error('boom')) }, hostMissing: false },
        assert: function (r) {
          assert.strictEqual(r.started.length, 0, '不开空会话')
          const grey = r.flashes.filter(function (f) { return f.msg === 'toast.handoffGrey' })
          assert.ok(grey.length >= 1, 'toast.handoffGrey 引导出现')
          assert.strictEqual(r.st.handoffReady, false)
        } },
      { name: '开新会话：宿主通道不可用 → 引导 toast，绝不开空会话 + ready=false', via: 'open',
        opt: { probe: null, hostMissing: true },
        assert: function (r) {
          assert.strictEqual(r.started.length, 0, '不开空会话')
          const grey = r.flashes.filter(function (f) { return f.msg === 'toast.handoffGrey' })
          assert.ok(grey.length >= 1, 'toast.handoffGrey 引导出现')
          assert.strictEqual(r.st.handoffReady, false)
        } },
      { name: '第一击：注入模板后探测按 {handoffTs}-*.md 前缀发现真实文件名（含短标题）', via: 'handoff',
        opt: {
          probe: function (n, a) {
            if (n === 'wf.handoffResolve' || n === 'handoffResolve') return Promise.resolve({ ok: true, file: '20260818-000000-修复提示词.md' })
            return Promise.reject(new Error('第一击探测应按前缀发现文件名: ' + n))
          },
          hostMissing: false,
        },
        assert: function (r) {
          assert.strictEqual(r.injected.length, 1, '注入 1 次')
          const res = r.calls.find(function (c) { return c.name === 'wf.handoffResolve' || c.name === 'handoffResolve' })
          assert.ok(res, '第一击后应调 wf.handoffResolve 前缀探测')
          assert.strictEqual(res.arg.name, '20260818-000000*', '按 {handoffTs}-*.md 前缀匹配')
          assert.strictEqual(r.st.handoffReady, true, '探测到真实文件名（含短标题）→ ready=true（亮蓝）')
        } },
      { name: '第一击：host 不可用 / 未探测到文档 → 右半灰（不亮蓝）', via: 'handoff',
        opt: { probe: null, hostMissing: true },
        assert: function (r) {
          assert.strictEqual(r.injected.length, 1, '注入 1 次')
          assert.strictEqual(r.st.handoffReady, false, 'host 不可用 / 无文档 → 不亮蓝（等探测到真实名）')
        } },
      { name: '探测助手直连：有文档 → ready=true 并返回文件', via: 'probe',
        opt: { probe: function () { return Promise.resolve({ ok: true, file: 'DEF.md' }) }, hostMissing: false },
        assert: function (r) {
          assert.strictEqual(r.st.handoffReady, true, 'ready 置 true')
          assert.ok(r.emitCount >= 1, '探测后触发重渲染')
        } },
      // ---- issue #12 BUG4 主路径契约（r2 终极形态）----
      { name: 'issue #12 r2 主路径：handoffFile 已设 → prompt 直接用 handoffFile（不调 host；不引用 mtime 最新）',
        via: 'open',
        opt: {
          // r2：handoffFile 设了就不调 host probe；这里 reject 任何调用以暴露误调
          probe: function (n, a) { return Promise.reject(new Error('r2：handoffFile 已设 → 客户端不应调任何 host probe；误调 = ' + n)) },
          hostMissing: false,
          handoffFile: '20260818-091652.md',  // 第一击刚生成的「新文件」（与磁盘上 mtime 最新的「老文件」不同）
        },
        assert: function (r) {
          assert.strictEqual(r.calls.length, 0, 'r2：handoffFile 已设 → 不调 host probe（不查磁盘）')
          // 验证预填的是 handoffFile（不是 mtime 最新）
          assert.ok(r.copied[0].text.includes('20260818-091652.md'), 'r2：预填必须用 handoffFile（与第一击模板时间戳一致）')
          assert.ok(!r.copied[0].text.includes('20260818-074046.md'), 'r2：不得引用 mtime 最新的「老文件」')
          assert.strictEqual(r.st.handoffReady, true, 'handoffFile 已设 → ready=true')
        } },
      { name: 'issue #12 副路径：handoffFile=null（未点过第一击）→ 仍走 handoffLatest（降级兼容）',
        via: 'open',
        opt: {
          probe: function (n, a) {
            if (n === 'handoffLatest' || n === 'wf.handoffLatest') return Promise.resolve({ ok: true, file: 'LATEST.md' })
            return Promise.reject(new Error('未点过第一击不该调 handoffResolve: ' + n))
          },
          hostMissing: false,
          // handoffFile 不传（保持默认 null）
        },
        assert: function (r) {
          const latestCall = r.calls.find(function (c) { return c.name === 'handoffLatest' || c.name === 'wf.handoffLatest' })
          assert.ok(latestCall, 'handoffFile=null 时必须调 handoffLatest（降级路径）')
          const resolveCall = r.calls.find(function (c) { return c.name === 'handoffResolve' || c.name === 'wf.handoffResolve' })
          assert.ok(!resolveCall, 'handoffFile=null 时不该调 handoffResolve')
          assert.ok(r.copied[0].text.includes('LATEST.md'), '预填用 handoffLatest 返回的文件')
          assert.strictEqual(r.st.handoffReady, true)
        } },
      { name: 'issue #12 r2 两段 prompt 一致性：handoffFile 已设 → prompt 直接用 handoffFile（不查磁盘；与第一击 `/handoff` 模板时间戳一致 · fix v1.6.2-r2）',
        via: 'open',
        opt: {
          probe: function (n, a) {
            // r2 客户端已不再调 handoffResolve / handoffLatest —— handoffFile 设了就直接 return done(handoffFile)
            // 若误调（说明没部署 r2）→ reject 暴露
            return Promise.reject(new Error('r2: 客户端不应再调任何 host probe（handoffFile 已设应直接返回）；误调 = ' + n))
          },
          hostMissing: false,
          handoffFile: '20260818-132000.md',  // 期望文件（实际未生成）
        },
        assert: function (r) {
          // r2 关键：probe 函数里 reject 任何调用都没触发 → 客户端没调任何 host probe
          assert.strictEqual(r.calls.length, 0, 'r2：handoffFile 已设 → 客户端不调任何 host probe（不查磁盘）')
          // prompt 必须用 handoffFile（与第一击模板时间戳一致），不引用任何旧文件
          assert.strictEqual(r.started.length, 1, 'r2：handoffFile 已设 → 必开新会话（保证 prompt 内容存在）')
          assert.ok(r.copied.length >= 1, 'r2：预填 prompt 已生成')
          const copiedText = r.copied[0].text
          assert.ok(copiedText.includes('20260818-132000.md'), 'r2：prompt 用 handoffFile（与第一击模板一致）')
          assert.ok(!copiedText.includes('091652.md'), 'r2：不得 fallback 到 mtime 最新（旧文件）')
          assert.ok(!copiedText.includes('074046.md'), 'r2：不得引用任何其他历史文件')
          // 右半亮/灰：r2 不查磁盘 → ready=true（handoffFile 已设即视为 ready，保证可点）
          assert.strictEqual(r.st.handoffReady, true, 'r2：handoffFile 已设 → ready=true（右半亮蓝，可点）')
          // 不应触发引导 toast（r2 不再有「文件不存在 → 引导」分支）
          const grey = r.flashes.filter(function (f) { return f.msg === 'toast.handoffGrey' })
          assert.strictEqual(grey.length, 0, 'r2：handoffFile 已设 → 不触发 handoffGrey toast（避免误导「请先点交接」）')
        } },
    ]
    for (const s of scenarios) {
      try {
        const r = await runHarness(fnSrc, Object.assign({ via: s.via }, s.opt))
        s.assert(r)
        console.log('  PASS ' + tag + ' · ' + s.name)
      } catch (e) { failed = true; console.log('  FAIL ' + tag + ' · ' + s.name + ' — ' + e.message) }
    }
  }
  if (failed) { console.log('\n存在失败'); process.exit(1) }
  console.log('\n全部通过')
}
main()