// verify-handoff-split.js — 交接分割按钮 + 引导门（需求1·二阶段）
// 用法: node tests/verify-handoff-split.js [file...]（默认 client.js + package/lib/client.js 双源）
//
// 验收标准（2026-08-18 拍板）：
//   a) 分割按钮：一个 capsule 容器（dsws-split）+ 左右半（dsws-split-part）+ 细分隔线（dsws-split-div 1px×14px）；
//   b) store 默认 handoffReady: false；doHandoff（第一击）成功置 st.handoffReady = true；
//   c) doHandoffOpen 引导门：未点过第一击（handoffFile 为 null）先探测磁盘（host/rpc handoffLatest）——
//      有 latest 才放行 + ready=true + 开新会话；没有 → toast 引导（toast.handoffGrey）且不开空会话；
//   d) 原「无文档仍开新会话」糊涂分支已删除（no finish(null, toast.copiedHandoffNoLatest)）；
//   e) 灰/亮双态键：nav.handoffGreyTitle / toast.handoffGrey 双语（zh/en）齐备。
const fs = require('fs')
const assert = require('assert')

const files = process.argv.slice(2).length ? process.argv.slice(2) : ['client.js', 'package/lib/client.js']

// ---- Part A：静态契约 ----
const statChecks = function (src, tag) {
  const ok = (name, cond) => { if (!cond) throw new Error(tag + ' · ' + name); console.log('  PASS ' + tag + ' · ' + name) }
  ok('分割按钮容器 dsws-split', src.includes("className: 'dsws-split'"))
  ok('分割按钮左右半 dsws-split-part ×2', (src.match(/dsws-split-part/g) || []).length >= 2)
  ok('细分隔线 dsws-split-div', src.includes("className: 'dsws-split-div'"))
  ok('分割按钮 CSS 定义', src.includes(".dsws-split{display:inline-flex"))
  ok('左半点击区调用 doHandoff', src.includes('onClick: function (e) { e.stopPropagation(); doHandoff(s) }'))
  ok('右半点击区调用 doHandoffOpen', src.includes('onClick: function (e) { e.stopPropagation(); doHandoffOpen(s) }'))
  ok('store 默认 handoffReady: false', src.includes('handoffReady: false'))
  ok('doHandoff 成功置 handoffReady=true', src.includes('st.handoffReady = true'))
  ok('前置探测（host / rpc handoffLatest）仍在', /handoffLatest/.test(src))
  ok('引导门：无 latest → toast.handoffGrey', src.includes("tr('toast.handoffGrey')"))
  ok('糊涂分支已删：no finish(null, toast.copiedHandoffNoLatest)', !src.includes("finish(null, tr('toast.copiedHandoffNoLatest'))"))
  ok('无历史兜底 toast 键残留（noLatest / handoffNotFound / copiedHandoffFail）', !src.includes("'toast.copiedHandoffNoLatest'") && !src.includes("'toast.handoffNotFound'") && !src.includes("'toast.copiedHandoffFail'"))
  ok('nav.handoffGreyTitle zh', src.includes("'nav.handoffGreyTitle': '尚未生成交接文档"))
  ok('nav.handoffGreyTitle en', src.includes("'nav.handoffGreyTitle': 'No handoff doc yet"))
  ok('toast.handoffGrey zh', src.includes("'toast.handoffGrey': '请先点「交接」生成交接文档"))
  ok('toast.handoffGrey en', src.includes("'toast.handoffGrey': 'Click Handoff first"))
}

// ---- Part B：引导门行为（沙箱执行真实 doHandoffOpen）----
const extractDoHandoffOpen = function (src) {
  const i = src.indexOf('const doHandoffOpen = function (st) {')
  const j = src.indexOf('// #361：在新会话中打开')
  if (i < 0 || j < 0 || j < i) throw new Error('提取锚点缺失')
  return src.slice(i, j)
}
const runHarness = function (fnSrc, opt) {
  let emitCount = 0
  const st = { cwd: 'D:/repo', handoffReady: false, injector: null }
  const started = []
  const copied = []
  const flashes = []
  const wsStub = { startSession: function () { started.push('session') } }
  const ctxStub = { get: function (k) { return k === 'workspaces' ? wsStub : null } }
  const probeCall = function (probe) { return probe ? probe() : Promise.reject(new Error('no probe')) }
  const hostStub = { call: function (n, a) { return opt.hostMissing ? Promise.reject(new Error('no host')) : probeCall(opt.probe) } }
  const $ = new Function(
    'st', 'ctx', 'host', 'conn', 'handoffFile', 'handoffReadText', 'copyText', 'tr', 'flash', 'emit', 'pendingDraft', 'rpcCall',
    fnSrc + '\n; return doHandoffOpen'
  )
  const doHandoffOpen = $(st, ctxStub, hostStub, { rpc: true }, opt.handoffFile,
    function (file) { return '/read .scratch/handoff/' + (file || 'latest.md') },
    function (st_, text, msg) { copied.push({ text: text, msg: msg }) },
    function (k) { return k },
    function (st_, msg, kind) { flashes.push({ msg: msg, kind: kind }) },
    function () { emitCount++ },
    null,
    function (n, a) { return opt.hostMissing ? Promise.reject(new Error('no rpc')) : probeCall(opt.probe) }
  )
  // 真实 doHandoffOpen 是 fire-and-forget（不返回 promise）——这里不 await 其返回值，
  // 而是等一个 macrotask 让 probe 的微任务链跑完，再读捕获状态。
  doHandoffOpen(st)
  return new Promise(function (resolve) {
    setTimeout(function () { resolve({ st: st, started: started, copied: copied, flashes: flashes, emitCount: emitCount }) }, 15)
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
    try { fnSrc = extractDoHandoffOpen(src) } catch (e) { failed = true; console.log('  FAIL ' + tag + ' 提取异常 — ' + e.message); continue }
    const ch = fnSrc.indexOf('rpcCall') >= 0 ? 'rpc' : 'host'
    const scenarios = [
      { name: '已点第一击 → 复用第一击文件', opt: { handoffFile: '20260818-000000.md', probe: null, hostMissing: true },
        assert: function (r) {
          assert.strictEqual(r.copied.length, 1, '复制 1 次')
          assert.ok(r.copied[0].text.includes('20260818-000000.md'), '文本用第一击文件名')
          assert.strictEqual(r.started.length, 1, '开新会话')
          assert.strictEqual(r.st.handoffReady, false, '第一击路径不改 ready（该值来自 doHandoff 已置 true）')
        } },
      { name: '未点第一击 + 磁盘有 latest → 放行开新会话', opt: { handoffFile: null, probe: function () { return Promise.resolve({ ok: true, file: 'ABC.md' }) } },
        assert: function (r) {
          assert.strictEqual(r.copied.length, 1, '复制 1 次')
          assert.ok(r.copied[0].text.includes('ABC.md'), '文本用探测到的文件')
          assert.strictEqual(r.started.length, 1, '开新会话')
          assert.strictEqual(r.st.handoffReady, true, 'ready 置 true（右半亮蓝）')
        } },
      { name: '未点第一击 + 磁盘无 latest → 引导且不开空会话', opt: { handoffFile: null, probe: function () { return Promise.resolve({ ok: true, file: null }) } },
        assert: function (r) {
          assert.strictEqual(r.copied.length, 0, '不复制')
          assert.strictEqual(r.started.length, 0, '不开空会话（原糊涂分支已删）')
          assert.strictEqual(r.flashes.length, 1, 'toast 引导 1 次')
          assert.strictEqual(r.flashes[0].msg, 'toast.handoffGrey', '引导键 toast.handoffGrey')
          assert.strictEqual(r.st.handoffReady, false, 'ready 保持 false（右半仍灰）')
        } },
      { name: '未点第一击 + 探测失败 → 引导且不开空会话', opt: { handoffFile: null, probe: function () { return Promise.reject(new Error('boom')) } },
        assert: function (r) {
          assert.strictEqual(r.copied.length, 0, '不复制')
          assert.strictEqual(r.started.length, 0, '不开空会话')
          assert.strictEqual(r.flashes.length, 1, 'toast 引导 1 次')
          assert.strictEqual(r.st.handoffReady, false, 'ready 保持 false')
        } },
    ]
    if (ch === 'host') scenarios.push({
      name: '宿主通道不可用（host 缺失）→ 引导且不开空会话', opt: { handoffFile: null, probe: null, hostMissing: true },
      assert: function (r) {
        assert.strictEqual(r.started.length, 0, '不开空会话')
        assert.strictEqual(r.flashes.length, 1, 'toast 引导 1 次')
        assert.strictEqual(r.st.handoffReady, false, 'ready 保持 false')
      } })
    for (const s of scenarios) {
      try {
        const r = await runHarness(fnSrc, s.opt)
        s.assert(r)
        console.log('  PASS ' + tag + ' · ' + s.name)
      } catch (e) { failed = true; console.log('  FAIL ' + tag + ' · ' + s.name + ' — ' + e.message) }
    }
  }
  if (failed) { console.log('\n存在失败'); process.exit(1) }
  console.log('\n全部通过')
}
main()
