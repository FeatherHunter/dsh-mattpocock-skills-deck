#!/usr/bin/env node
/**
 * verify-cap-fold.js — 状态栏胶囊那条横条「随宽度一格一格变短」的门禁（#725，维护者 2026-09-24 定）
 *
 * 维护者这一轮的原话：「品牌字默认折叠；内容平铺在这一条里；变窄时字一个一个减少（先消失非核心的），
 *   直到只剩图标」。落到代码上，这一票要四件事，本文件按四组量它们：
 *
 *   A 判据层（纯函数，不开浏览器）：statusbar/capFold.js 那条阶梯 —— 第 0 档已经按 pinned 收过
 *     （品牌那段是空的）、每往下一档只少一个单位（char 少一个字 / word 少一整段词）、
 *     所有词都空之后就再也没有台阶（计数器与图标是载荷，不许撤）、档号超界停在最后一档。
 *   B 源码与产物层：判据与机器都真的拼进两份产物；那条 2 秒轮询确实退役了；
 *     接线（状态栏把胶囊交给机器、每次提交后重算一次、两条 ResizeObserver + fonts.ready 还在）；
 *     平铺那两条 CSS（胶囊两端分布、品牌段吃余量且列间距有上限）真的落地了。
 *   C 真渲染层（真 Chromium + 真产物 + 真数据）：宽度 900 → 240 每 6 像素扫一档，逐档量
 *     「档号、每一段还在几个单位、胶囊溢不溢出、计数器数字还在不在」，核心断言是那句原话的可执行版：
 *     **每往下一档，版面上恰好多让掉一个单位**（档号涨几，可见单位就少几）。
 *   D 去掉 2 秒轮询之后的两条兜底证据（这是本票删掉那个轮询时必须补上的）：
 *     ① 宽度改完等 2200 毫秒再量一次，仍然正确（不是靠某一帧碰巧量对）；
 *     ② 外来的文字写入（真实场景里就是 React 重渲染把收短过的那串换回完整的一串）会被机器当成
 *        新的事实重新排一遍阶梯 —— 这正是当年那个轮询兜的事，现在由「每次提交后重算一次」接管。
 *
 * 为什么核心判据量的是「档」而不是「相邻两次宽度采样」：宽度每走 6 像素，机器可能一次走过两档
 *   （下一段要收的那点宽度比这 6 像素还窄的时候就是这样，不是缺陷）；「一档只让掉一点」这句话说的是
 *   档与档之间的关系，所以本文件按档号算：档号涨了几，可见单位就必须少几 —— 多让一点都不许。
 *
 * 依赖：playwright（含 chromium）与 esbuild，都在本仓 devDependencies。全程本机，不碰真仓库、不用登录令牌。
 * 运行：node tests/verify-cap-fold.js（先 node scripts/build.mjs 生成产物）
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { createServer } from 'node:http'

let passed = 0, failed = 0
function ok(msg) { passed++; console.log('  PASS ' + msg) }
function bad(msg) { failed++; console.log('  FAIL ' + msg) }
function check(cond, msg) { if (cond) ok(msg); else bad(msg) }

const read = (rel) => readFileSync(resolve(rel), 'utf8')
const CAPFOLD = 'src/client/statusbar/capFold.js'
const CAPMACHINE = 'src/client/statusbar/capFoldMachine.js'
const STATUSBAR = 'src/client/statusbar/StatusBar.js'
const STYLES = 'src/client/kernel/styles.js'
const ARTIFACTS = ['client.js', 'package/lib/client.js']

console.log('=== #725 状态栏胶囊：随宽度一格一格变短（品牌默认折叠 / 内容平铺 / 只让一个单位）===')
console.log('')
console.log('A) 判据层：那一条阶梯本身（纯函数，不开浏览器）')

// 与 scripts/build.mjs 拼接时同一套做法：剥掉行首 export，丢进同一个作用域里跑。
const capFold = (function () {
  if (!existsSync(resolve(CAPFOLD))) return null
  try {
    return new Function(read(CAPFOLD).replace(/^[ \t]*export[ \t]+/gm, '') +
      '\nreturn { CAP_FOLD_POLICY, capFoldLadderOf, capFoldStateAt, capFoldStepCount }')()
  } catch (e) { return null }
})()
if (!capFold) {
  bad('A 读不到 ' + CAPFOLD + '，或者它跑不起来')
} else {
  const POLICY = capFold.CAP_FOLD_POLICY
  const ids = ['1', '2', '3', '4', '5', '6', '7', '8', '9']
  const polOk = !!POLICY && ids.every((p) => !!POLICY[p]) &&
    POLICY['1'].cut === 'char' && POLICY['1'].pinned === true &&
    POLICY['9'].cut === 'char' &&
    ['2', '3', '4', '5', '6', '7', '8'].every((p) => POLICY[p].cut === 'word' && POLICY[p].pinned !== true) &&
    Object.keys(POLICY).length === 9
  check(polOk, 'A1 让位表就是维护者定的那张：1=品牌（char + pinned，默认收起）· 2–8=七段词（word）· 9=时间串（char）（实测 ' + JSON.stringify(POLICY) + '）')

  // 一份与真机同形的样本：号码与状态栏那九个挂点一一对应，字用中文那一套（一个字 12 像素，尺子分得清）。
  const SAMPLE = { items: [
    { priority: 1, word: 'MattSkills' },
    { priority: 2, word: '沉淀' }, { priority: 3, word: '交接' }, { priority: 4, word: '更新' },
    { priority: 5, word: '可接' }, { priority: 6, word: 'BUG' }, { priority: 7, word: '诊断' }, { priority: 8, word: '环境' },
    { priority: 9, word: ' 12:34:56' },
  ] }
  const unitsOf = function (text, cut) {
    const s = String(text === undefined || text === null ? '' : text)
    if (cut !== 'word') return s.length // char 口径：一个字符算一个单位（阶梯就是这么收的，收的是末尾那个字）
    return s.trim() === '' ? 0 : s.trim().split(/\s+/).length // word 口径：一整段词算一个单位
  }
  const ladderOf = function (sample) {
    const ladder = capFold.capFoldLadderOf(sample)
    const steps = ladder.steps || []
    const rungs = steps.map(function (s, i) { return { tier: i, words: capFold.capFoldStateAt(ladder, i).words } })
    return { ladder: ladder, rungs: rungs }
  }
  // 这把尺子：逐档核对「相邻两档之间只有一个单位被让掉，而且方向只有一个 —— 只会少，不会多也不会换」。
  const violationsOf = function (run, sample) {
    const out = []
    const cutOf = {}
    ;(sample.items || []).forEach(function (it) { cutOf[String(it.priority)] = (POLICY[String(it.priority)] || {}).cut || 'word' })
    for (let i = 1; i < run.rungs.length; i++) {
      const a = run.rungs[i - 1].words, b = run.rungs[i].words
      const changed = Object.keys(a).filter(function (k) { return a[k] !== b[k] })
      if (changed.length !== 1) { out.push('第' + i + '档一次动了 ' + changed.length + ' 段（' + changed.join(',') + '）'); continue }
      const k = changed[0]
      if (unitsOf(b[k], cutOf[k]) > unitsOf(a[k], cutOf[k])) out.push('第' + i + '档那一段变长了（' + k + '）')
      const drop = unitsOf(a[k], cutOf[k]) - unitsOf(b[k], cutOf[k])
      if (drop !== 1) out.push('第' + i + '档一次让掉 ' + drop + ' 个单位（' + k + '：' + JSON.stringify(a[k]) + ' → ' + JSON.stringify(b[k]) + '）')
    }
    return out
  }
  const zhRun = ladderOf(SAMPLE)
  const vZh = violationsOf(zhRun, SAMPLE)
  const first = zhRun.rungs[0].words
  const lastRung = zhRun.rungs[zhRun.rungs.length - 1]

  check(first['1'] === '' && first['2'] === '沉淀' && first['9'] === ' 12:34:56',
    'A2 第 0 档（最宽那一档）已经按 pinned 收过：品牌那段是空的，其余各段都是完整的那串字（实测 ' + JSON.stringify(first) + '）')
  check(vZh.length === 0,
    'A3 每往下一档只让掉一个单位（一个字，或一整段词），别的段一个字都不动（实测 ' + zhRun.rungs.length + ' 档，违反 ' + vZh.length + ' 处' + (vZh.length ? '：' + vZh.join('；') : '') + '）')
  check(ids.every((p) => lastRung.words[p] === '') && capFold.capFoldStepCount(zhRun.ladder) === 1 + 7 + 9,
    'A4 收到底：最后一档所有段都空了，档数恰是「第 0 档 + 七段词各一步 + 时间串九个字九步」= 17（实测 ' + capFold.capFoldStepCount(zhRun.ladder) + ' 档）')
  check(capFold.capFoldStepCount(zhRun.ladder) === zhRun.rungs.length,
    'A5 capFoldStepCount 说的档数与真排出来的档数一致（实测 ' + capFold.capFoldStepCount(zhRun.ladder) + '）')
  const below = capFold.capFoldStateAt(zhRun.ladder, -5)
  const above = capFold.capFoldStateAt(zhRun.ladder, 999)
  check(below.tier === 0 && below.words['2'] === '沉淀',
    'A6 档号算小了（-5）停在最宽那一档（实测 tier ' + below.tier + '）')
  check(above.tier === zhRun.rungs.length - 1 && ids.every((p) => above.words[p] === ''),
    'A7 档号算大了（999）停在最后一档、不越界（收到底之后不再撤；实测 tier ' + above.tier + '）')
  const order = (zhRun.ladder.ids || []).join(',')
  check(order === ids.join(','), 'A8 让位次序就是号码升序（小号先让位，实测 ' + order + '）')

  // 英文那一套也跑一遍：多词的那几段按「一整段词」让位，所以一次少一整个词，不是少一个字母。
  const EN = { items: [
    { priority: 1, word: 'MattSkills' },
    { priority: 2, word: 'Handoff new session' }, { priority: 3, word: 'Handoff' },
    { priority: 4, word: 'Refresh' }, { priority: 5, word: 'Takeable' }, { priority: 6, word: 'BUG' },
    { priority: 7, word: 'Triage' }, { priority: 8, word: 'Env' },
    { priority: 9, word: ' 12:34:56' },
  ] }
  const enRun = ladderOf(EN)
  const vEn = violationsOf(enRun, EN)
  const enRung0 = enRun.rungs[0].words
  const enRung1 = enRun.rungs[1].words
  check(vEn.length === 0 && enRung0['2'] === 'Handoff new session' && enRung1['2'] === 'Handoff new',
    'A9 英文那一套同样只让一个单位，而且多词的那段一次只少一整个词（实测 ' + JSON.stringify(enRung0['2']) + ' → ' + JSON.stringify(enRung1['2']) + '，违反 ' + vEn.length + ' 处）')

  // 自带反证：一把尺子抓不住坏阶梯就是假绿。造两条坏样子喂进去 ——
  //   ① 同一段一步掉三个字（时间串那一段本该一个字一个字地让）；
  //   ② 一步动了两段（两个号码同时被收掉，台阶上就少了一格）。
  const brokenChars = {
    ladder: { steps: [], ids: ids },
    rungs: [
      { tier: 0, words: { '1': '', '2': '沉淀', '9': ' 12:34:56' } },
      { tier: 1, words: { '1': '', '2': '沉淀', '9': ' 12:3' } },
      { tier: 2, words: { '1': '', '2': '沉淀', '9': '' } },
    ],
  }
  const brokenTwo = {
    ladder: { steps: [], ids: ids },
    rungs: [
      { tier: 0, words: { '1': '', '2': '沉淀', '3': '交接' } },
      { tier: 1, words: { '1': '', '2': '', '3': '' } },
    ],
  }
  const vBrokenChars = violationsOf(brokenChars, SAMPLE)
  const vBrokenTwo = violationsOf(brokenTwo, SAMPLE)
  check(vBrokenChars.length >= 1 && vBrokenTwo.length >= 1,
    'A10 自带反证：一步掉好几个字、一步动两段的坏阶梯都会被这把尺子抓住（实测 ' + vBrokenChars.length + ' / ' + vBrokenTwo.length + ' 处）')
}

console.log('')
console.log('B) 源码与产物层：判据与机器都拼进去了，那条 2 秒轮询确实退役了')

const missing = [CAPFOLD, CAPMACHINE, STATUSBAR, STYLES, ...ARTIFACTS].filter((rel) => !existsSync(resolve(rel)))
for (const rel of missing) bad(rel + ' 读不到' + (ARTIFACTS.indexOf(rel) >= 0 ? '（先跑 node scripts/build.mjs 重建产物）' : ''))
const artifacts = {}
for (const rel of ARTIFACTS) artifacts[rel] = existsSync(resolve(rel)) ? read(rel) : ''
for (const rel of ARTIFACTS) {
  const t = artifacts[rel]
  if (!t) continue
  check(t.indexOf('capFoldStateAt') >= 0 && t.indexOf('capFoldLadderOf') >= 0, rel + ' 里拼进了判据（capFoldLadderOf / capFoldStateAt）')
  check(t.indexOf('runCapFold') >= 0 && t.indexOf('dataset.foldTier') >= 0, rel + ' 里拼进了机器（runCapFold 与档号锚点）')
  check(!t.includes('setInterval(applyAll, 2000)'), rel + ' 里已经没有那条 2 秒轮询（#725 退役）')
  check(t.indexOf("'data-fold-priority': 1") >= 0 || t.indexOf("'data-fold-priority':1") >= 0, rel + ' 里九个挂点还在（品牌那段仍是优先级 1）')
}
const barSrc = existsSync(resolve(STATUSBAR)) ? read(STATUSBAR) : ''
check(/runCapFold\(cap, foldKeep\.current\)/.test(barSrc), '状态栏只留接线：把胶囊与两张跨调用带着走的表交给阶梯机（statusbar/capFoldMachine.js）')
check(/React\.useEffect\(function \(\) \{ applyFold\(\) \}\)/.test(barSrc), '每次提交之后重算一次（那条 2 秒轮询的位置由它接管）')
check(/new ResizeObserver\(function \(\) \{ applyFold\(\) \}\)[\s\S]{0,300}roFold\.observe\(foldRef\.current\)/.test(barSrc) && /roParent\.observe/.test(barSrc),
  '两条 ResizeObserver（胶囊自己 + 它的父容器）仍是宽度的第一信号源')
check(/document\.fonts\.ready\.then\(applyFold\)/.test(barSrc), '字体加载完再重算一次（防字体宽差误判）')
const stylesSrc = existsSync(resolve(STYLES)) ? read(STYLES) : ''
const flatRules = function (src) {
  return /\.dsws-capsule\s*\{[^}]*justify-content:\s*space-between/.test(src) &&
    /\.dsws-capsule\s+\.dsws-capsule-word[^{]*\{[^}]*flex:1 1 auto/.test(src) &&
    /\.dsws-capsule\s+\.dsws-capsule-word[^{]*\{[^}]*min-width:0/.test(src) &&
    /\.dsws-capsule\s+\.dsws-capsule-word[^{]*\{[^}]*justify-content:flex-start/.test(src) &&
    /\.dsws-capsule\s+\.dsws-capsule-word[^{]*\{[^}]*column-gap:clamp\(/.test(src)
}
check(flatRules(stylesSrc), '平铺那几条 CSS 在 styles.js 里（胶囊两端分布；品牌段 flex:1 1 auto + min-width:0 + 左对齐 + 列间距 clamp 上限）')
check(ARTIFACTS.every((rel) => !artifacts[rel] || flatRules(artifacts[rel])), '两份产物里带着同一套平铺 CSS（改完 src 忘了重建产物就红在这里）')

// ---------- 真渲染层：真 Chromium + 真产物 ----------
const CLIENT = 'package/lib/client.js'
if (!existsSync(resolve(CLIENT))) {
  console.log('')
  console.log('产物缺失，C/D 两组跳过')
  console.log(passed + ' 条通过，' + failed + ' 条失败')
  process.exit(1)
}
const CWD = 'D:\\ilife\\packages\\skill-calorie'
const SNAP = {
  ok: true, version: 'verify-cap-fold', generatedMs: Date.now() - 3 * 60 * 1000,
  workspaceRoot: 'd:/ilife', maps: [], checks: null, isLocal: false, tickets: [], groups: {},
  repository: { name: 'FeatherHunter/dsh-mattpocock-skills-deck', url: 'https://github.com/FeatherHunter/dsh-mattpocock-skills-deck', backend: 'github' },
  selection: { backendId: 'github', source: 'explicit' },
}
const ENTRY = `
import React from 'react'
import * as ReactDOMClient from 'react-dom/client'
window.React = React
window.__RDOM__ = ReactDOMClient
const CWD = window.__CWD__
const SNAP = window.__SNAP__
let loaded = null
window.__ModuleLoader__ = { load(spec) { loaded = spec; return spec } }
window.eval(window.__CLIENT_SRC__)
const dict = {}
const trFn = (k, p) => {
  let s = dict[k] !== undefined ? dict[k] : k
  if (p) s = s.replace(/\\{(\\w+)\\}/g, (m, n) => (n in p ? String(p[n]) : m))
  return s
}
const regs = []
const reply = (method) => {
  if (method === 'cwd') return { ok: true, cwd: CWD }
  if (method === 'snapshot' || method === 'refresh') return SNAP
  if (method === 'chain') return { ok: true, snapshot: { steps: [] }, chain: [], fullChain: null, resolved: [] }
  if (method === 'registry') return { ok: true, modules: [{ id: 'github', label: 'GitHub' }, { id: 'markdown', label: 'Markdown' }] }
  return { ok: true }
}
const services = {
  slots: { register: (m, c) => { regs.push({ m, c }); return () => {} }, inject: (n, f) => { try { f() } catch (e) {} } },
  sidebarRightTabs: { register: () => () => {} },
  connection: { rpc: { call: async (channel, endpoint, body) => ({ ok: true, value: reply(body && body.method) }) } },
  // 只用中文那一半词条：这段阶梯按「一个字 / 一整段词」让位，中文那一套一个字至少 12 像素，尺子分得清。
  locale: { register: (ns, d) => { Object.assign(dict, (d && d.zh) || {}); return () => {} }, bind: () => trFn },
  workspaces: { list: async () => [] },
  sessions: { list: async () => [] },
  timer: { timeout: (f, ms) => setTimeout(f, ms) },
}
const ctx = { get: (k) => services[k], effect: (f) => { f(); return () => {} }, inject: (deps, cb) => { cb(ctx); return { dispose: () => {} } } }
loaded.factory((m) => (m === 'react' ? React : m === 'react-dom' ? ReactDOMClient : {})).apply(ctx)
const capsuleComp = regs.filter((r) => r.m && r.m.name === 'conversation.input.dock')[0]
window.__WAIT__ = (pred, ms) => new Promise((res) => {
  const t0 = Date.now()
  const tick = () => { if (pred() || Date.now() - t0 > ms) res(!!pred()); else setTimeout(tick, 25) }
  tick()
})
// 档位稳定 = 连续三次读到同一个档号（机器按真实可用宽度算，没有写死的阈值）。
window.__SETTLE__ = async function () {
  const cap = document.querySelector('.dsws-capsule')
  if (!cap) return null
  let last = null, same = 0
  for (let i = 0; i < 90; i++) {
    await new Promise(function (r) { requestAnimationFrame(function () { setTimeout(r, 16) }) })
    const cur = cap.getAttribute('data-fold-tier')
    if (cur === last) { same++; if (same >= 3) return cur } else { last = cur; same = 0 }
  }
  return last
}
window.__MOUNT__ = async function (w) {
  const host = document.createElement('div')
  host.id = 'capHost'
  host.style.cssText = 'width:' + w + 'px'
  document.body.appendChild(host)
  window.__HOST__ = host
  if (!capsuleComp) return { error: 'no statusbar registration', names: regs.map((r) => r.m && r.m.name) }
  const props = Object.assign(
    capsuleComp.m.inject ? capsuleComp.m.inject('sess-1') : { sessionId: 'sess-1' },
    { session: { cwd: CWD }, useSessions: () => null, inputActions: null },
  )
  let thrown = null
  try {
    window.__RDOM__.createRoot(host).render(React.createElement(capsuleComp.c, props))
  } catch (e) { thrown = String((e && e.message) || e) }
  const arrived = await window.__WAIT__(() => !!host.querySelector('.dsws-capsule'), 8000)
  await window.__SETTLE__()
  return { ok: !!host.querySelector('.dsws-capsule'), arrived: arrived, thrown: thrown }
}
window.__SET_W__ = async function (w) {
  const host = window.__HOST__
  if (!host) return { error: 'not mounted' }
  host.style.width = w + 'px'
  const tier = await window.__SETTLE__()
  return { tier: tier }
}
window.__MEASURE__ = function () {
  const cap = document.querySelector('.dsws-capsule')
  if (!cap) return { error: 'no capsule' }
  const vis = function (el) {
    if (!el) return false
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }
  const items = Array.from(cap.querySelectorAll('[data-fold-priority]')).map(function (el) {
    const box = el.parentElement
    return {
      p: String(el.getAttribute('data-fold-priority') || ''),
      text: String(el.textContent || ''),
      visible: vis(el),
      folded: el.classList.contains('dsws-folded'),
      // 那一段旁边的图标（数字或字形）：它是载荷，任何宽度都该在。
      iconVisible: vis(box ? box.querySelector('svg') : null),
    }
  })
  const nums = Array.from(cap.querySelectorAll('.dsws-num')).map(function (el) {
    return { text: String(el.textContent || ''), visible: vis(el) }
  })
  const wordEl = cap.querySelector('.dsws-capsule-word')
  return {
    tier: Number(cap.getAttribute('data-fold-tier')),
    foldCount: Number(cap.getAttribute('data-fold')),
    width: Math.round(cap.getBoundingClientRect().width),
    clientW: cap.clientWidth, scrollW: cap.scrollWidth, overflow: cap.scrollWidth - cap.clientWidth,
    wordVisible: vis(wordEl), wordHasIcon: !!(wordEl && wordEl.querySelector('svg')),
    items: items, nums: nums,
  }
}
// D 组用：像 React 那样把一段字整串换掉（真实场景里就是时间串每秒在变），再叫醒机器一次。
window.__WRITE_TEXT__ = function (p, text) {
  const el = document.querySelector('.dsws-capsule [data-fold-priority="' + p + '"]')
  if (!el) return { error: 'no element ' + p }
  el.textContent = text
  window.dispatchEvent(new Event('resize'))
  return { ok: true, wrote: text }
}
window.__PROBE_READY__ = true
`
const { build } = await import('esbuild')
const bundled = await build({
  stdin: { contents: ENTRY, resolveDir: resolve('.'), sourcefile: 'verify-cap-fold-probe.js', loader: 'js' },
  bundle: true, format: 'iife', platform: 'browser', target: 'chrome120', write: false, logLevel: 'error',
})
const probeJs = bundled.outputFiles[0].text
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;background:#10131a}
#capHost{display:block}
</style></head>
<body>
<script>window.__CLIENT_SRC__ = ${JSON.stringify(artifacts[CLIENT] || read(CLIENT))};</script>
<script>window.__CWD__ = ${JSON.stringify(CWD)};window.__SNAP__ = ${JSON.stringify(SNAP)};</script>
<script>${probeJs}</script></body></html>`
const server = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(html)
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const origin = 'http://127.0.0.1:' + server.address().port + '/'
const { chromium } = await import('playwright')
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 700 } })
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push('pageerror: ' + (e && e.message)))
  page.on('console', (m) => { if (m.type() === 'error') pageErrors.push('console: ' + m.text()) })
  await page.goto(origin, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__PROBE_READY__ === true, null, { timeout: 15000 })

  console.log('')
  console.log('C) 真渲染层：宽度 900 → 240 每 6 像素扫一档（真产物 + 真词条）')
  const mounted = await page.evaluate(() => window.__MOUNT__(900))
  if (!mounted || !mounted.ok) {
    bad('C 状态胶囊栏没挂起来：' + JSON.stringify(mounted) + ' / 页面错误 ' + JSON.stringify(pageErrors.slice(0, 3)))
  } else {
    ok('C0 状态胶囊栏挂起来了（真产物 + 真 rpc 载体）')
    const unitsOf = function (text, cut) { const s = String(text || ''); return cut !== 'word' ? s.length : (s.trim() === '' ? 0 : s.trim().split(/\s+/).length) }
    const cutOf = (p) => ((capFold && capFold.CAP_FOLD_POLICY[p]) || {}).cut || 'word'
    const unitsOfSample = function (m) {
      let n = 0
      const per = {}
      m.items.forEach(function (it) { per[it.p] = unitsOf(it.folded ? '' : it.text, cutOf(it.p)); n += per[it.p] })
      return { total: n, per: per }
    }
    const samples = []
    let err = null
    for (let w = 900; w >= 240; w -= 6) {
      const set = await page.evaluate((x) => window.__SET_W__(x), w)
      if (!set || set.error) { err = set; break }
      const m = await page.evaluate(() => window.__MEASURE__())
      if (!m || m.error) { err = m; break }
      samples.push({ w: w, m: m, u: unitsOfSample(m) })
    }
    if (err) {
      bad('C 宽度扫描中断：' + JSON.stringify(err))
    } else {
      // 先把这个宽度扫出来的实况打印出来（报告里那张表就是它的出处）。
      const firstAt = {}
      samples.forEach((s) => { if (!(s.m.tier in firstAt)) firstAt[s.m.tier] = s })
      console.log('     （宽度 → 渲染成什么；每档第一次出现的那一处）')
      Object.keys(firstAt).map(Number).sort((a, b) => a - b).forEach((t) => {
        const s = firstAt[t]
        const parts = s.m.items.map((it) => it.p + ':' + (it.folded ? '（收）' : JSON.stringify(it.text))).join(' ')
        console.log('       第 ' + t + ' 档 @ ' + s.w + 'px：单位合计 ' + s.u.total + ' / 溢 ' + s.m.overflow + ' / ' + parts)
      })
      console.log('     （最窄那几档实况：宽度 档号 单位合计 溢出 clientWidth/scrollWidth 数字个数）')
      samples.slice(-8).forEach((s) => {
        console.log('       ' + s.w + 'px 第' + s.m.tier + '档 单位' + s.u.total + ' 溢' + s.m.overflow + ' cw' + s.m.clientW + ' sw' + s.m.scrollW + ' 数字' + s.m.nums.length)
      })

      const maxTier = samples.reduce((n, s) => Math.max(n, s.m.tier), 0)
      // 一、档号只升不降（同一个宽度上不来回跳）
      let monotone = true
      for (let i = 1; i < samples.length; i++) if (samples[i].m.tier < samples[i - 1].m.tier) monotone = false
      check(monotone, 'C1 面板越窄档号只升不降（实测档号 ' + samples.map((s) => s.m.tier).join(',') + '）')
      // 二、核心判据：档号涨几，可见单位就少几 —— 每往下一档恰好多让掉一个单位
      let worst = null
      for (let i = 1; i < samples.length; i++) {
        const a = samples[i - 1], b = samples[i]
        const drop = a.u.total - b.u.total
        const rungs = b.m.tier - a.m.tier
        const bad1 = drop < 0 || drop !== rungs
        if (bad1 && (!worst || Math.abs(drop - rungs) > Math.abs(worst.d) )) worst = { w: b.w, drop: drop, rungs: rungs, d: drop - rungs }
      }
      check(!worst, 'C2 每往下一档恰好多让掉一个单位（档号涨几、可见单位就少几；实测最多对不上的地方 ' + (worst ? JSON.stringify(worst) : '一处都没有') + '）')
      // 三、每一档要么放得下，要么已经收到底（所有可让的字都让完了；剩下的图标与数字是载荷，不撤）
      const wrong = samples.filter((s) => s.m.overflow > 1 && s.m.tier < maxTier).map((s) => s.w + 'px(第' + s.m.tier + '档,溢' + s.m.overflow + ')')
      check(wrong.length === 0, 'C3 每一档要么放得下、要么已经收到底（实测先于最后一档就溢出的宽度：' + JSON.stringify(wrong) + '；最窄 240 像素实测第 ' + samples[samples.length - 1].m.tier + ' 档、溢出 ' + samples[samples.length - 1].m.overflow + '）')
      const widest = samples[0]
      check(widest.m.overflow <= 1, 'C4 最宽那一档（900 像素）放得下（实测溢 ' + widest.m.overflow + '）')
      // 四、计数器数字永不消失；品牌那段默认折叠（任何宽度都不放出来），那枚品牌图标一直都在
      const numBad = []
      samples.forEach((s) => s.m.nums.forEach((n, i) => { if (!n.visible) numBad.push(s.w + 'px#' + i) }))
      check(samples[0].m.nums.length >= 3 && numBad.length === 0,
        'C5 每一档的计数器数字都还在（实测共 ' + samples[0].m.nums.length + ' 枚；看不见的：' + JSON.stringify(numBad) + '）')
      const brandBad = samples.filter((s) => {
        const b = s.m.items.filter((it) => it.p === '1')[0]
        return !b || !b.folded || String(b.text).trim() !== ''
      }).map((s) => s.w)
      check(brandBad.length === 0, 'C6 品牌那一段默认折叠：任何宽度都不放出来（实测放出来的宽度 ' + JSON.stringify(brandBad) + '）')
      const iconBad = samples.filter((s) => !s.m.wordVisible || !s.m.wordHasIcon).map((s) => s.w)
      check(iconBad.length === 0, 'C7 品牌那一段的挂点与那枚图标在任何宽度都还在（实测丢掉的宽度 ' + JSON.stringify(iconBad) + '）')
      // 五、每档至少让掉一点：档号涨了，可见单位必须跟着少（没有空转的档）
      const stall = []
      for (let i = 1; i < samples.length; i++) {
        if (samples[i].m.tier > samples[i - 1].m.tier && samples[i].u.total === samples[i - 1].u.total) stall.push(samples[i].w)
      }
      check(stall.length === 0, 'C8 没有空转的档：档号一涨，版面上确实少了东西（实测空转的宽度 ' + JSON.stringify(stall) + '）')
      // 六、收到底之后不再撤：最后一档之后，档号与可见单位都不再变
      const bottom = samples.filter((s) => s.m.tier === maxTier)
      const bottomUnits = bottom.map((s) => s.u.total)
      check(bottomUnits.every((n) => n === bottomUnits[0]),
        'C9 收到底之后不再撤：最后那一档的可见单位数恒定（实测 ' + JSON.stringify(bottomUnits) + '）')

      console.log('')
      console.log('D) 去掉 2 秒轮询之后的两条兜底证据')
      // ① 改完宽度等 2200 毫秒再量一次：那个轮询当年兜的就是「某一帧之后还有人来动它」，
      //    现在没有轮询了，这里就得证明「等两秒之后仍然正确」，而不是靠某一次测量碰巧量对。
      const picks = [samples[0], samples[Math.floor(samples.length / 2)], samples[samples.length - 1]]
      for (const s of picks) {
        await page.evaluate((x) => window.__SET_W__(x), s.w)
        await page.waitForTimeout(2200)
        const late = await page.evaluate(() => window.__MEASURE__())
        const lateU = unitsOfSample(late)
        check(late.tier === s.m.tier && lateU.total === s.u.total && (late.overflow <= 1 || late.tier === maxTier),
          'D1 改完宽度等 2200 毫秒仍然正确（' + s.w + 'px：刚量到第 ' + s.m.tier + ' 档 / 单位 ' + s.u.total + '，两秒后第 ' + late.tier + ' 档 / 单位 ' + lateU.total + '、溢 ' + late.overflow + '）')
      }
      // ② 外来的文字写入：真实场景里就是 React 重渲染把收短过的那串换回完整的一串（时间串一直在变）。
      //    这里模拟一次那笔写入，再叫醒机器 —— 它必须把这串当成**新的事实**重新排一遍阶梯，
      //    而不是拿手里那张旧表硬收（那样会越收越短、再也展不开）。这正是当年那个轮询兜的事。
      //    判据写成「重排之后版面上剩下的那串，是从**新写进去的那串**的前面截的」：
      //    写进去的是一串字母，旧的那张表里根本没有这些字，所以只要画面上出现它们，就说明机器换了事实。
      const WROTE = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
      await page.evaluate((x) => window.__SET_W__(x), 900)
      const wrote = await page.evaluate((s) => window.__WRITE_TEXT__('9', s), WROTE)
      await page.evaluate(() => window.__SETTLE__())
      const after = await page.evaluate(() => window.__MEASURE__())
      const nine = after.items.filter((it) => it.p === '9')[0] || null
      const allGiven = after.items.every((it) => String(it.text).trim() === '')
      check(!!wrote && !!wrote.ok && (after.overflow <= 1 || allGiven),
        'D2 外来写入之后这一条横条照旧不溢出（要么放得下、要么所有可让的字都让完了；实测溢 ' + after.overflow + '、全让完 ' + allGiven + '）')
      check(!!nine && String(nine.text).indexOf(' ABC') === 0,
        'D3 那笔写入被当成新的事实重新排了一遍阶梯（版面上剩下的是新那串的前缀；实测 ' + JSON.stringify(nine && nine.text) + '）')
      // 页面里不许有未捕获的报错（这一条是硬断言）。控制台告警另算：状态栏自己那几个列表
      //   （品牌那一段的两个孩子等）本来就没有 key，React 会照例告警 —— 那是本票没碰的地方，
      //   照原样打印出来，但不判红；出现别的控制台报错才红。
      const thrown = pageErrors.filter((e) => e.indexOf('pageerror:') === 0)
      const consoleErrs = pageErrors.filter((e) => e.indexOf('console:') === 0)
      const known = consoleErrs.filter((e) => e.indexOf('unique "key" prop') < 0)
      check(thrown.length === 0, 'D4 整段扫描期间页面没有未捕获的报错（实测 ' + thrown.length + ' 条' + (thrown.length ? '：' + JSON.stringify(thrown.slice(0, 3)) : '') + '）')
      check(known.length === 0, 'D5 控制台里没有那条「key 缺失」之外的报错（实测 ' + known.length + ' 条' + (known.length ? '：' + JSON.stringify(known.slice(0, 3)) : '；本票没碰的 key 告警 ' + consoleErrs.length + ' 条，照原样留着') + '）')
    }
  }
} finally {
  await browser.close()
  server.close()
}
console.log('')
console.log(passed + ' 条通过，' + failed + ' 条失败')
process.exit(failed ? 1 : 0)
