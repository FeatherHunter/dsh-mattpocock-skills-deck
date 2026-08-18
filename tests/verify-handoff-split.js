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
  ok('doHandoff 不再直接置 ready=true（文档未成文不亮蓝）', !src.includes('st.handoffReady = true'))
  ok('「点过第一击即放行」旁路已删（no if (handoffFile) {）', !src.includes('if (handoffFile) {'))
  ok('前置探测（host / rpc handoffLatest）仍在', /handoffLatest/.test(src))
  // issue #12 BUG4 · 主路径契约：handoffFile 已设 → handoffResolve（带 name）；否则 → handoffLatest
  const isPkg = tag === 'npm'
  const resolveName = isPkg ? 'handoffResolve' : 'wf.handoffResolve'
  ok('主路径：调 ' + resolveName + ' 带 name=handoffFile', src.includes(resolveName))
  ok('副路径：handoffLatest 兜底（harness.handle / RPC case）', /handoffLatest/.test(src))
  ok('主路径条件分流（handoffFile ? ... : ...）', /handoffFile\s*\?\s*['"]/.test(src) && /['"]/.test(src))
  ok('主路径 args 带 name=handoffFile', /name:\s*handoffFile/.test(src))
  ok('引导门：无 latest → toast.handoffGrey', src.includes("tr('toast.handoffGrey')"))
  ok('糊涂分支已删：no finish(null, toast.copiedHandoffNoLatest)', !src.includes("finish(null, tr('toast.copiedHandoffNoLatest'))"))
  ok('无历史兜底 toast 键残留（noLatest / handoffNotFound / copiedHandoffFail）', !src.includes("'toast.copiedHandoffNoLatest'") && !src.includes("'toast.handoffNotFound'") && !src.includes("'toast.copiedHandoffFail'"))
  ok('nav.handoffGreyTitle zh', src.includes("'nav.handoffGreyTitle': '尚未生成交接文档"))
  ok('nav.handoffGreyTitle en', src.includes("'nav.handoffGreyTitle': 'No handoff doc yet"))
  ok('toast.handoffGrey zh', src.includes("'toast.handoffGrey': '请先点「交接」生成交接文档"))
  ok('toast.handoffGrey en', src.includes("'toast.handoffGrey': 'Click Handoff first"))
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
  const copied = []
  const flashes = []
  const injected = []
  const wsStub = { startSession: function () { started.push('session') } }
  const ctxStub = { get: function (k) { return k === 'workspaces' ? wsStub : null } }
  // probe 接收 (callName, callArg)；向后兼容旧式 `probe: function () { ... }`（忽略参数）
  const probeCall = function (probe, n, a) { return probe ? probe(n, a) : Promise.reject(new Error('no probe')) }
  const hostStub = { call: function (n, a) { calls.push({ name: n, arg: a }); return opt.hostMissing ? Promise.reject(new Error('no host')) : probeCall(opt.probe, n, a) } }
  const $ = new Function(
    'st', 'ctx', 'host', 'conn', 'rpcCall', 'emit', 'timer', 'timeStampStr', 'handoffPrompt',
    'extractHandoffFile', 'inject', 'flash', 'tr', 'copyText', 'handoffReadText', 'pendingDraft', 'handoffFile', 'handoffTs',
    fnSrc + '\n; return { probeHandoffReady: probeHandoffReady, doHandoff: doHandoff, doHandoffOpen: doHandoffOpen }'
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
    null
  )
  const invoke = function (fn, arg) { const r = fn(arg); return r === undefined ? Promise.resolve() : Promise.resolve(r) }
  return invoke(opt.via === 'open' ? fns.doHandoffOpen : opt.via === 'probe' ? fns.probeHandoffReady : fns.doHandoff, st).then(function () {
    return new Promise(function (resolve) {
      setTimeout(function () {
        resolve({ st: st, started: started, copied: copied, flashes: flashes, injected: injected, scheduled: scheduled, emitCount: emitCount, calls: calls })
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
      { name: '开新会话：探测有文档 → 放行 + ready=true', via: 'open',
        opt: { probe: function () { return Promise.resolve({ ok: true, file: 'ABC.md' }) }, hostMissing: false },
        assert: function (r) {
          assert.strictEqual(r.started.length, 1, '开新会话 1 次')
          assert.strictEqual(r.copied.length, 1)
          assert.ok(r.copied[0].text.includes('ABC.md'), '预填读探测到的文档')
          assert.strictEqual(r.st.handoffReady, true, 'ready 置 true')
        } },
      { name: '旁路已删：点过第一击（handoffFile 已设）仍走探测（读到 ABC.md 而非第一击文件）', via: 'open',
        opt: { probe: function () { return Promise.resolve({ ok: true, file: 'ABC.md' }) }, hostMissing: false, handoffFile: '20260818-000000.md' },
        assert: function (r) {
          assert.strictEqual(r.started.length, 1, '开新会话 1 次')
          assert.ok(r.copied[0].text.includes('ABC.md'), '以探测结果优先（不再无脑用第一击文件名）')
          assert.strictEqual(r.st.handoffReady, true)
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
      { name: '第一击：注入模板 + 探测无文档 → ready 保持 false（不再仅凭第一击亮蓝）+ 延迟探测已排程', via: 'handoff',
        opt: { probe: function () { return Promise.resolve({ ok: true, file: null }) }, hostMissing: false },
        assert: function (r) {
          assert.strictEqual(r.injected.length, 1, '注入 1 次')
          assert.strictEqual(r.st.handoffReady, false, '文档未成文 → 不亮蓝（灰/禁用态）')
          assert.ok(r.scheduled.length >= 1, '已排程 10s 延迟再探测')
        } },
      { name: '第一击：探测有文档 → ready 置 true（右半自动亮蓝可点）', via: 'handoff',
        opt: { probe: function () { return Promise.resolve({ ok: true, file: 'ABC.md' }) }, hostMissing: false },
        assert: function (r) {
          assert.strictEqual(r.injected.length, 1, '注入 1 次')
          assert.strictEqual(r.st.handoffReady, true, '探测到文档 → 亮蓝')
          assert.ok(r.scheduled.length >= 1, '延迟探测已排程')
        } },
      { name: '探测助手直连：有文档 → ready=true 并返回文件', via: 'probe',
        opt: { probe: function () { return Promise.resolve({ ok: true, file: 'DEF.md' }) }, hostMissing: false },
        assert: function (r) {
          assert.strictEqual(r.st.handoffReady, true, 'ready 置 true')
          assert.ok(r.emitCount >= 1, '探测后触发重渲染')
        } },
      // ---- issue #12 BUG4 主路径契约 ----
      { name: 'issue #12 主路径：handoffFile 已设 → 调 handoffResolve(name=handoffFile) 而非 handoffLatest（即使 handoffLatest 会返回别的）',
        via: 'open',
        opt: {
          probe: function (n, a) {
            // 模拟 BUG：handoffLatest 会返回 OLD.md（按 mtime 倒挂），但 handoffResolve 接到 handoffFile 时正确返回它
            if (n === 'handoffLatest' || n === 'wf.handoffLatest') return Promise.resolve({ ok: true, file: '20260818-074046.md' })
            if (n === 'handoffResolve' || n === 'wf.handoffResolve') return Promise.resolve({ ok: true, file: a.name })
            return Promise.reject(new Error('unexpected call: ' + n))
          },
          hostMissing: false,
          handoffFile: '20260818-091652.md',  // 第一击刚生成的「新文件」（与 handoffLatest 返回的「老文件」不同）
        },
        assert: function (r) {
          // 验证调的是 handoffResolve 而非 handoffLatest
          const resolveCall = r.calls.find(function (c) { return c.name === 'handoffResolve' || c.name === 'wf.handoffResolve' })
          assert.ok(resolveCall, '必须调 handoffResolve（主路径）')
          assert.strictEqual(resolveCall.arg.name, '20260818-091652.md', 'handoffResolve 必须带 name=handoffFile')
          const latestCall = r.calls.find(function (c) { return c.name === 'handoffLatest' || c.name === 'wf.handoffLatest' })
          assert.ok(!latestCall, 'handoffFile 已设时不得调 handoffLatest（避免 mtime 倒挂 BUG）')
          // 验证预填的是 handoffFile（不是 handoffLatest 返回的老文件）
          assert.ok(r.copied[0].text.includes('20260818-091652.md'), '预填必须用 handoffFile（不是 handoffLatest 返的老文件 074046.md）')
          assert.ok(!r.copied[0].text.includes('20260818-074046.md'), '不得引用老文件（修复前会引用）')
          assert.strictEqual(r.st.handoffReady, true)
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
      { name: 'issue #12 主路径 strict：handoffResolve 返 null（AI 未写 / 文件不存在）→ 不得退到 handoffLatest 取老文件（host 端严格模式 · fix v1.6.2-r1）',
        via: 'open',
        opt: {
          probe: function (n, a) {
            if (n === 'handoffResolve' || n === 'wf.handoffResolve') return Promise.resolve({ ok: true, file: null })  // 期望文件不存在
            if (n === 'handoffLatest' || n === 'wf.handoffLatest') return Promise.resolve({ ok: true, file: '20260818-091652.md' })  // 旧文件仍在
            return Promise.reject(new Error('unexpected call: ' + n))
          },
          hostMissing: false,
          handoffFile: '20260818-132000.md',  // 期望文件（实际未生成）
        },
        assert: function (r) {
          // 必须调的是 handoffResolve（不调 handoffLatest，因为 handoffFile 已设）
          const resolveCall = r.calls.find(function (c) { return c.name === 'handoffResolve' || c.name === 'wf.handoffResolve' })
          assert.ok(resolveCall, 'handoffFile 已设 → 必须调 handoffResolve')
          const latestCall = r.calls.find(function (c) { return c.name === 'handoffLatest' || c.name === 'wf.handoffLatest' })
          assert.ok(!latestCall, 'handoffFile 已设 → 不得退到 handoffLatest（strict 模式）')
          // 期望文件不在目录 → handoffResolve 返 null → ready=false → 引导 toast
          assert.strictEqual(r.st.handoffReady, false, '文件不存在 → ready 保持 false（右半仍灰）')
          assert.strictEqual(r.started.length, 0, '不开空会话')
          const grey = r.flashes.filter(function (f) { return f.msg === 'toast.handoffGrey' })
          assert.ok(grey.length >= 1, '文件不存在 → 引导 toast.handoffGrey')
          // 关键断言：copied.text 不得出现旧文件 091652.md（不能 fallback 到 mtime 最新）
          const copiedText = r.copied.length ? r.copied[0].text : ''
          assert.ok(!copiedText.includes('091652.md'), 'strict 模式：不得 fallback 到 mtime 最新（即使 handoffLatest 会返回 091652）')
          assert.ok(!copiedText.includes('132000.md'), 'strict 模式：文件不存在不预填该文件')
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
