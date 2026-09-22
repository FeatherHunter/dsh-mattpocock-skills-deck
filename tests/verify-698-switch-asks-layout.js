#!/usr/bin/env node
/**
 * verify-698-switch-asks-layout.js — 「切换后端时每次都先问一次域文档布局」门禁（#698）
 *
 * 起因（维护者 2026-09-22 真机）：在工作区里点「切换后端」→ 目标选本地 Markdown → 保持「保留」→
 *   点「确认切换」，弹窗关了，界面上**没有出现**那张问域文档布局的小卡。查下来发现三件事叠在一起：
 *     1. `store-switch.js` 里「已初始化」那一支提前返回，根本不经过注入决策函数 —— 这条路从来没写过这一问；
 *     2. 布局答过之后决策函数也不再问（#674 定的「答过就不问」），而 ADR 与验收清单里都写着应该有；
 *     3. 那张卡当时只渲染在「该工作区尚未初始化」的黄条下面，工作区一旦初始化过就没有地方可画。
 *   维护者拍板：**切换后端时每次都问一次**，与黄条同一套风格（卡上预选着上次那一项，不想改就点确认）。
 *
 * 断七组：
 *   A 源码层：那张卡有自己的位置 —— 界面在 views/SetupCard.js、座位在弹窗座位那一层，
 *     状态栏黄条不再自己拼一份（一个座位上只留一处渲染）。
 *   B 判据单源：整个客户端里「要不要先问布局」只有一个地方判（kernel/prompts-setup.js 的
 *     layoutCardShouldOpen），黄条那条路与切换那条路都走它，且两条都传 askLayout:true。
 *   C 行为层（判据）：真求值那段判据，量「答过也问 / 没答过也问 / 不传 askLayout 时才不问」。
 *   D 行为层（切换那条路）：真求值 store-switch.js 的 confirmSwitchConfirm —— 已初始化与未初始化
 *     两支都先开卡（不再当场注入），提示条说的是「请先回答下面那一问」。
 *   E 行为层（卡答完之后注什么）：真求值 StatusBackend.js 的 settleSwitchCard ——
 *     ① 已初始化 + 改了布局 + 确认 → 后端对齐与布局对齐两条都给；
 *     ② 已初始化 + 没改布局 + 确认 → 只给后端对齐一条；
 *     ③ 已初始化 + 取消 → 后端对齐照旧给（不给布局对齐）；
 *     ④ 链里连「初始化过没有」都没有 → 一个字都不注入，只提示看状态栏；
 *     ⑤ 还没初始化 + 确认 → 交回决策器（不自己拼初始化全文）。
 *   F 同屏只许一张卡：卡开着时不许再开「切换后端」那张窗（提示一句就返回）。
 *   G 反证：把三处实现各做坏一次，对应的断言必须当场变红。
 *
 * 用法：node tests/verify-698-switch-asks-layout.js
 */
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
const read = (rel) => readFileSync(resolve(root, rel), 'utf8')
const url = (rel) => pathToFileURL(resolve(root, rel)).href
let passed = 0
let failed = 0
const check = (ok, msg) => { if (ok) { console.log('  PASS ' + msg); passed++ } else { console.log('  FAIL ' + msg); failed++ } }
const stripExports = (s) => s.replace(/^[ \t]*export[ \t]+/gm, '')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const cardSrc = read('src/client/views/SetupCard.js')
const barSrc = read('src/client/statusbar/StatusBar.js')
const sbSrc = read('src/client/statusbar/StatusBackend.js')
const swSrc = read('src/client/kernel/store-switch.js')
const setupSrc = read('src/client/kernel/prompts-setup.js')
const promptsSrc = read('src/client/kernel/prompts.js')

// ── 公共夹具：真 guide-steps ────────────────────────────────────────────────────────────
const GUIDE = await import(url('src/shared/tracker/guide-steps.js'))
// 链快照两个现场：已初始化（tracker:initialized 绿）与还没初始化（它红，仓库那一步绿）
const CHAIN_INITIALIZED = GUIDE.GUIDE_STEPS.map((s) => ({ id: s.checks[0], status: 'done' }))
const CHAIN_NOT_INIT = GUIDE.GUIDE_STEPS.map((s) => ({ id: s.checks[0], status: s.id === 'tracker:initialized' ? 'fail' : 'done' }))

console.log('== A 源码层：那张卡有自己的位置（不再挂在黄条下面）==')
{
  check(/const SetupLayoutCard = function/.test(cardSrc), '卡的界面在 views/SetupCard.js（一个独立的叶子模块）')
  check(/className: 'dsws-modal'/.test(cardSrc) && /portalTop\(overlay\)/.test(cardSrc), '卡盖住整个应用（.dsws-modal + portalTop 挂到 body），与面板在不在无关')
  check(/confirmStatusSetupPick\(st\)/.test(cardSrc) && /cancelStatusSetupPick\(st\)/.test(cardSrc), '卡上的两个按钮直接调 StatusBackend.js 那两个动作（不在别处再包一层）')
  check(!/layoutRadios\(/.test(barSrc), '状态栏黄条不再自己拼一份这组单选（一个座位上只留一处渲染）')
  const modalView = read('src/client/kernel/slotRenderer-modal-view.js')
  check(/st\.setupLayoutCardOpen === true\) \{ try \{ return SetupLayoutCard\(/.test(modalView), '弹窗座位按「卡开着」分派到它（座位是它唯一的渲染入口）')
  const decls = (barSrc.match(/const modalSeat = /g) || []).length
  const uses = (barSrc.match(/modalSeat\b/g) || []).length
  check(decls === 1 && uses === 4, '那个座位仍在状态栏里声明一处、三支渲染都用上（收起态 / 无横幅 / 有横幅）—— 实得声明 ' + decls + ' 次、总共 ' + uses + ' 次')
}

console.log('')
console.log('== B 判据单源：整个客户端只有一处判「要不要先问布局」==')
{
  check(/export const layoutCardShouldOpen = function/.test(setupSrc), '判据收在 kernel/prompts-setup.js 的 layoutCardShouldOpen 一份里')
  const hits = []
  // 注释里提到这个名字不算「抄了一份判据」——先把注释剥掉再找（与 verify-locale-completeness 同一做法）
  const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, e.name)
      if (e.isDirectory()) { walk(full); continue }
      if (!e.name.endsWith('.js')) continue
      const rel = full.replace(root + '\\', '').replace(/\\/g, '/')
      if (rel === 'src/client/kernel/prompts-setup.js') continue
      if (/layoutCardShouldOpen/.test(stripComments(readFileSync(full, 'utf8')))) hits.push(rel)
    }
  }
  walk(resolve(root, 'src/client'))
  check(hits.length === 0, '客户端里没有第二处在抄这个判据（实得 ' + hits.length + ' 处' + (hits.length ? '：' + hits.join('、') : '') + '）')
  check(/injectSetupDecision\(s,id,\{allowCard:true, askLayout:true\}\)/.test(sbSrc), '黄条那颗「初始化」按钮每次都问（askLayout:true）')
  const swCode = stripComments(swSrc)
  const swAsks = (swCode.match(/askLayout:\s*true/g) || []).length
  check(swAsks === 2, '切换那条路每次都问：两支各传一次 askLayout:true（已初始化那一支也传）—— 实得 ' + swAsks + ' 处')
  const swSrcFlag = (swCode.match(/source:\s*'switch'/g) || []).length
  check(swSrcFlag === 2, '两支都告诉决策器这一问由切换那条路收尾（source:switch）—— 实得 ' + swSrcFlag + ' 处')
  check(/snapshotSetupLayoutForCard/.test(sbSrc), '开卡时留一份草稿（取消那条路要拿它把答案退回）')
  check(/delete s\.setupPickLayout/.test(sbSrc), '取消时把卡上刚点的那一下作废')
  check(/export const snapshotSetupLayoutForCard = function/.test(sbSrc), '那份草稿只有一处落点（两个入口共用它）')
  check(/snapshotSetupLayoutForCard\(st\)/.test(setupSrc), '开卡那一个分支里记草稿 —— 黄条与切换两条路都经过这里，不会漏记')
}

console.log('')
console.log('== C 行为层（判据）：答过也问 / 没答过也问 / 不传 askLayout 时才不问 ==')
{
  // 这一段真源会调 readSetupLayout / SETUP_LAYOUT_TEXT_KEYS（都住在 prompts.js，构建时同闭包），
  //   沙箱里照同一口径顶上它们：读会话里那一项，取值不认识就当没答过。
  const layoutKeys = { single: 'setup.layout.single', multi: 'setup.layout.multi' }
  const readLayout = (st) => {
    const t = String((st && st.setupLayout) || '').toLowerCase()
    return (t === 'single' || t === 'multi') ? t : null
  }
  const mod = new Function('readSetupLayout', 'SETUP_LAYOUT_TEXT_KEYS', stripExports(setupSrc) + '\n;return { layoutCardShouldOpen: layoutCardShouldOpen };')(readLayout, layoutKeys)
  check(mod.layoutCardShouldOpen({ setupLayout: 'multi' }, { askLayout: true }) === true, '布局答过（multi）· 传了 askLayout → 照旧问（#698 维护者拍板的那一条）')
  check(mod.layoutCardShouldOpen({ setupLayout: 'single' }, { askLayout: true }) === true, '布局答过（single）· 传了 askLayout → 照旧问')
  check(mod.layoutCardShouldOpen({ setupLayout: null }, { askLayout: true }) === true, '布局没答过 · 传了 askLayout → 问')
  check(mod.layoutCardShouldOpen({}, { askLayout: true }) === true, '布局与缓存都没有 · 传了 askLayout → 问')
  check(mod.layoutCardShouldOpen({ setupLayout: 'multi' }, {}) === false, '布局答过 · **不**传 askLayout → 不问（检查页那颗按钮这条口径不动）')
  check(mod.layoutCardShouldOpen({ setupLayout: null }, {}) === true, '布局没答过 · 不传 askLayout → 仍然问')
}

console.log('')
console.log('== D 行为层（切换那条路）：两支都先开卡，不再当场注入 ==')
async function runSwitch (srcText, steps, from, to) {
  const seen = { inject: [], decision: [], flash: [], bind: [], snap: [], chain: [] }
  const setupChainSteps = (st) => (st && st.chainSnapshot && st.chainSnapshot.steps) || []
  const setupBlockedByGuide = (st, backendId) => {
    const mine = GUIDE.guideStepsFor(backendId) || []
    for (const step of mine) {
      if (!step || step.blocksSetup !== true) continue
      if (!GUIDE.guideStepDone(step, setupChainSteps(st))) return true
    }
    return false
  }
  const sandbox = {
    host: { call: (m, p) => { if (m === 'wf.bind') seen.bind.push(p); return Promise.resolve({ ok: true }) } },
    builtinLabelOf: (id) => String(id),
    firstBackendIdOf: () => 'github',
    otherFiltered: (l) => (Array.isArray(l) ? l : []),
    tr: (k, params) => { let s = String(k); if (params) s = s + '|' + JSON.stringify(params); return s },
    flash: (st, msg, kind) => seen.flash.push({ msg: String(msg), kind: kind || '' }),
    inject: (st, text) => seen.inject.push(String(text)),
    // 决策器真身那一条判据（用真 guide-steps 判「仓库那一步过没过」），返回值按真口径给：
    //   挡住了 → blocked；否则这一步是开卡问布局 → askLayout（只有一个名字，两条路共用）。
    injectSetupDecision: (st, id, opts) => {
      seen.decision.push({ id: id, allowCard: !!(opts && opts.allowCard), askLayout: !!(opts && opts.askLayout), source: String((opts && opts.source) || '') })
      if (setupBlockedByGuide(st, id)) return 'blocked'
      return 'askLayout'
    },
    promptText: (id, params) => id + '|' + String((params && params.from) || '') + '->' + String((params && params.to) || ''),
    chainSteps: setupChainSteps,
    guideStepsFor: GUIDE.guideStepsFor,
    guideStepDone: GUIDE.guideStepDone,
    readSetupLayout: () => 'multi',
    SETUP_LAYOUT_DEFAULT: 'single',
    emit: () => {}, setCachedSelection: () => {}, log: () => {}, isEnabled: () => false,
    dswsLogHash: () => 'h', dswsLogTrunc: (s) => s,
    loadSnapshot: () => seen.snap.push(1), loadChain: () => seen.chain.push(1),
    setTimeout, clearTimeout, console: { log () {}, warn () {}, error () {} },
  }
  const names = Object.keys(sandbox)
  const body = stripExports(srcText) + '\n;return { confirmSwitchConfirm: confirmSwitchConfirm, openSwitchConfirm: openSwitchConfirm }'
  const mod = new Function(...names, body)(...names.map((n) => sandbox[n]))
  const fromId = from || 'github'
  const toId = to || 'markdown'
  const st = { cwd: 'D:\\w', selection: { backendId: fromId, source: 'explicit', userPicked: true }, repository: null, snapshot: null, setupLayout: 'multi', chainSnapshot: { steps: steps }, switchConfirm: { open: true, curBackendId: fromId, targetBackendId: toId, option: 'keep', criChecks: null, criLoading: false, clearInput: '', confirming: false } }
  mod.confirmSwitchConfirm(st)
  await sleep(20)
  return { seen, st, mod }
}
{
  const init = await runSwitch(swSrc, CHAIN_INITIALIZED)
  check(init.seen.decision.length === 1 && init.seen.decision[0].askLayout === true, '已初始化：先开那张布局小卡，而且是「每次都问」—— 实得 ' + JSON.stringify(init.seen.decision))
  check(init.seen.inject.length === 0, '已初始化：这一刻一个字都不注入（等用户答完卡再给）')
  check(/bindOkAskLayout/.test(init.seen.flash.map((f) => f.msg).join('|')), '已初始化：提示条说「请先回答下面那一问」—— 实得 ' + JSON.stringify(init.seen.flash.map((f) => f.msg)))
  check(init.st.switchCardLayoutFrom === 'multi', '开卡前把「改之前是哪个布局」记了下来（收尾时要靠它判改没改）')
  check(init.st.switchAlignDone === false, '开卡前把「后端对齐这条还没给过」记了下来')
  const fresh = await runSwitch(swSrc, CHAIN_NOT_INIT)
  check(fresh.seen.decision.length === 1 && fresh.seen.decision[0].askLayout === true && fresh.seen.decision[0].source === 'switch', '还没初始化：走**同一份判据**（askLayout + source:switch），两边都是每次都问')
  check(fresh.seen.inject.length === 0, '还没初始化：这一刻也不自己注入（等用户答完卡）')
}

console.log('')
console.log('== E 行为层（卡答完之后注什么）：点确认那一刻重新判一次场景 ==')
function makeSettle (steps, opts) {
  const o = opts || {}
  const seen = { inject: [], flash: [], prompt: [], log: [], decision: [] }
  const sandbox = {
    chainSteps: (st) => (st && st.chainSnapshot && st.chainSnapshot.steps) || [],
    guideStepsFor: GUIDE.guideStepsFor,
    guideStepDone: GUIDE.guideStepDone,
    firstBackendIdOf: () => 'github',
    tr: (k) => String(k),
    flash: (st, msg, kind) => seen.flash.push({ msg: String(msg), kind: kind || '' }),
    inject: (st, text) => seen.inject.push(String(text)),
    promptText: (id, params) => { seen.prompt.push({ id: id, params: params || null }); return id + '|' + String((params && params.from) || '') + '->' + String((params && params.to) || '') },
    injectSetupDecision: (st, id, o2) => { seen.decision.push({ id: id, allowCard: !!(o2 && o2.allowCard) }); return o.blocksSetup ? 'blocked' : 'setup' },
    // 轨迹那一段住在内核（statusbar/ 目录里不许新开日志点），这里顶上真身同形的替身，把记了什么收下来
    logSwitchSettle: (what, st) => seen.log.push({ level: 'debug', event: 'inject.decision', fields: { prompt: 'switchSettle', kind: String(what || ''), layout: String((st && st.setupLayout) || 'unset') } }),
    isEnabled: () => o.debug === true,
    log: (level, event, fields) => seen.log.push({ level: level, event: event, fields: fields || {} }),
    emit: () => {}, setTimeout, clearTimeout, console: { log () {}, warn () {}, error () {} },
  }
  const names = Object.keys(sandbox)
  const body = stripExports(sbSrc) + '\n;return { settleSwitchCard: settleSwitchCard, worktreeInitializedState: worktreeInitializedState, cancelStatusSetupPick: cancelStatusSetupPick, cardOwnedBySwitch: cardOwnedBySwitch }'
  const mod = new Function(...names, body)(...names.map((n) => sandbox[n]))
  const st = { cwd: 'D:\\w', selection: { backendId: 'markdown' }, chainSnapshot: { steps: steps }, setupLayout: 'single', switchCardFrom: 'github', switchCardTo: 'markdown', switchCardLayoutFrom: 'multi', switchAlignDone: false, setupCardOwner: 'switch' }
  return { mod, st, seen }
}
{
  const changed = makeSettle(CHAIN_INITIALIZED, { debug: true })
  changed.mod.settleSwitchCard(changed.st, 'confirm')
  check(changed.seen.inject.length === 2, '已初始化 · 改了布局 · 确认：两条都给（后端对齐 + 布局对齐）—— 实得 ' + JSON.stringify(changed.seen.inject))
  check(changed.seen.inject[0] === 'switchAlign|github->markdown', '第一条是 switchAlign（记录后端的那几处）—— 实得 ' + JSON.stringify(changed.seen.inject[0]))
  check(changed.seen.inject[1] === 'switchLayout|setup.layoutMulti->setup.layoutSingle', '第二条是 switchLayout（改之前那一项 → 改之后那一项）—— 实得 ' + JSON.stringify(changed.seen.inject[1]))
  check(changed.seen.log.some((l) => l.fields && l.fields.kind === 'align-layout'), '布局对齐那一条留了一行轨迹（kind=align-layout）')
  check(changed.seen.log.some((l) => l.fields && l.fields.kind === 'align'), '后端对齐那一条也留了一行（kind=align）—— 与「只开了卡」在日志里分得开')
  check(/不要重跑初始化/.test(promptsSrc.slice(promptsSrc.indexOf('"switchLayout"'))), '新模板里点名了「不要重跑初始化、不要重建已有产物」')
  check(/switchLayout/.test(promptsSrc) && /switchLayout/.test(setupSrc) === false, '模板在提示词表里，取值那一步在 statusbar（模板表与代码各一份，不混）')

  const same = makeSettle(CHAIN_INITIALIZED)
  same.st.setupLayout = 'multi'
  same.mod.settleSwitchCard(same.st, 'confirm')
  check(same.seen.inject.length === 1 && same.seen.inject[0] === 'switchAlign|github->markdown', '已初始化 · 没改布局 · 确认：只注入 switchAlign 一条 —— 实得 ' + JSON.stringify(same.seen.inject))

  // 取消那一档（整条链上量）：卡上点过另一个选项 → 点取消 → 答案要退回开卡前那一份，所以只给后端对齐。
  //   为什么要在整条链上量：卡上那两个单选一点下去经 applyStatusSetupLayout 当场生效（老设计），
  //   所以「取消」必须把答案退回去 —— 上面那个 makeSettle 只发收尾那一步，量不到这一段，得走真链。
  const flow = makeStatusFlow(CHAIN_INITIALIZED, { layout: 'multi' })
  flow.mod.snapshotSetupLayoutForCard(flow.st) // 开卡那一刻（黄条与切换两条路都经过这一个落点）
  flow.apply('single') // 用户在卡上点了另一个选项
  flow.mod.cancelStatusSetupPick(flow.st)
  check(flow.st.setupLayout === 'multi', '卡上点过之后点取消：会话里那份答案退回开卡前那一份（实得 ' + flow.st.setupLayout + '）')
  check(flow.st.setupLayoutCardOpen === false, '取消之后卡关掉了（界面那一边收干净）')
  check(flow.seen.inject.indexOf('switchLayout|setup.layoutSingle->setup.layoutMulti') < 0, '取消之后不补布局对齐那条（卡上点过的那一下已经作废）—— 实得 ' + JSON.stringify(flow.seen.inject))
  check(flow.seen.inject[0] === 'switchAlign|github->markdown', '取消也照旧给后端对齐那一条（不因为多问一句就把本该给的扣下）')
  // 对照：同一份现场点确认 → 答案留住、两条都给（否则上面那几条可能只是「什么都没发生」）
  const flow2 = makeStatusFlow(CHAIN_INITIALIZED, { layout: 'multi' })
  flow2.mod.snapshotSetupLayoutForCard(flow2.st)
  flow2.apply('single')
  flow2.mod.confirmStatusSetupPick(flow2.st)
  check(flow2.st.setupLayout === 'single', '对照：点确认时答案留住了（实得 ' + flow2.st.setupLayout + '）')
  check(flow2.seen.inject.length === 2, '对照：点确认时两条都给（后端对齐 + 布局对齐）—— 实得 ' + JSON.stringify(flow2.seen.inject))

  const fresh = makeSettle(CHAIN_NOT_INIT)
  fresh.mod.settleSwitchCard(fresh.st, 'confirm')
  check(fresh.seen.decision.length === 1 && fresh.seen.decision[0].allowCard === false, '还没初始化 · 确认：把决定交回决策器，且不再开一张卡（allowCard:false）—— 实得 ' + JSON.stringify(fresh.seen.decision))
  check(fresh.seen.inject.length === 0, '还没初始化 · 确认：这一侧自己不拼初始化全文（由决策器给）')

  const noChain = makeSettle(null)
  noChain.mod.settleSwitchCard(noChain.st, 'confirm')
  check(noChain.seen.inject.length === 0 && /bindOkNotReady/.test(noChain.seen.flash.map((f) => f.msg).join('|')), '链里连「初始化过没有」都没有：一个字都不注入，提示条指向状态栏 —— 实得 inject=' + noChain.seen.inject.length)

  const once = makeSettle(CHAIN_INITIALIZED)
  once.st.switchAlignDone = true
  once.mod.settleSwitchCard(once.st, 'confirm')
  check(once.seen.inject.indexOf('switchAlign|github->markdown') < 0, '后端对齐已经给过 → 不再重复注入（只补布局对齐那一条）—— 实得 ' + JSON.stringify(once.seen.inject))

  check(makeSettle(CHAIN_INITIALIZED).mod.cardOwnedBySwitch({ setupCardOwner: 'switch' }) === true, '认得出「这张卡归切换那条路收尾」')
  check(makeSettle(CHAIN_INITIALIZED).mod.cardOwnedBySwitch({}) === false, '黄条 / 检查页开的卡不归切换收尾')
  const plain = makeSettle(CHAIN_INITIALIZED)
  plain.st.setupCardOwner = ''
  plain.mod.cancelStatusSetupPick(plain.st)
  check(plain.seen.inject.length === 0, '黄条那条路开的卡点取消：一个字都不注入（取消还是取消）')
  check(plain.st.setupLayoutCardOpen === false, '取消之后卡关掉了（界面那一边收干净）')
}

// 整条链的夹具：真 StatusBackend（含 snapshot/cancel/confirm/settle）+ 内核那一侧被调到的几样。
//   给「卡上点过一个选项之后点取消」这类要跨好几个函数才量得准的现场用。
function makeStatusFlow (steps, opts) {
  const o = opts || {}
  const seen = { inject: [], flash: [], log: [], decision: [], host: [] }
  const sandbox = {
    chainSteps: (st) => (st && st.chainSnapshot && st.chainSnapshot.steps) || [],
    guideStepsFor: GUIDE.guideStepsFor,
    guideStepDone: GUIDE.guideStepDone,
    firstBackendIdOf: () => 'github',
    // 注意：labelOf / presentationById 这些**由 StatusBackend.js 自己声明**，不能当参数传进来（会重名报错），
    //   它自己那一份已经够用（presentationById 为空 → 落到 builtinLabelOf，缺省返回后端 id 字符串）。
    tr: (k) => String(k),
    flash: (st, msg, kind) => seen.flash.push({ msg: String(msg), kind: kind || '' }),
    inject: (st, text) => seen.inject.push(String(text)),
    promptText: (id, params) => id + '|' + String((params && params.from) || '') + '->' + String((params && params.to) || ''),
    injectSetupDecision: (st, id, o2) => { seen.decision.push({ id: id, allowCard: !!(o2 && o2.allowCard) }); return 'setup' },
    logSwitchSettle: (what) => seen.log.push({ kind: String(what || '') }),
    isEnabled: () => false,
    log: () => {},
    emit: () => {},
    host: { call: (m, p) => { seen.host.push({ m: m, p: p }); return Promise.resolve({ ok: true }) } },
    getCachedSetupLayout: () => null,
    setCachedSetupLayout: () => {},
  }
  const names = Object.keys(sandbox)
  const body = stripExports(sbSrc) + '\n;return { StatusBackendForTest: { snapshotSetupLayoutForCard: snapshotSetupLayoutForCard, cancelStatusSetupPick: cancelStatusSetupPick, confirmStatusSetupPick: confirmStatusSetupPick, applyStatusSetupLayout: applyStatusSetupLayout, layoutSelectionOf: layoutSelectionOf } };'
  const mod = new Function(...names, body)(...names.map((n) => sandbox[n])).StatusBackendForTest
  const st = { cwd: 'D:\\w', selection: { backendId: 'markdown' }, chainSnapshot: { steps: steps }, setupLayout: o.layout || 'single', setupLayoutCardOpen: true, switchCardFrom: 'github', switchCardTo: 'markdown', switchCardLayoutFrom: o.layout || 'single', switchAlignDone: false, setupCardOwner: 'switch' }
  return { mod, st, seen, apply: (v) => mod.applyStatusSetupLayout(st, v) }
}

console.log('')
console.log('== F 同屏只许一张卡：卡开着时不许再开「切换后端」那张窗 ==')
{
  check(/if \(st\.setupLayoutCardOpen === true\) \{/.test(swSrc), 'openSwitchConfirm 里有一道「卡还开着」的闸')
  const m = swSrc.slice(swSrc.indexOf('export const openSwitchConfirm'), swSrc.indexOf('export const closeSwitchConfirm'))
  check(/flash\(st, tr\('switch\.setupCardOpen'\)/.test(m), '被挡住时说一句人话（词条 switch.setupCardOpen）')
  check(/return false/.test(m), '挡下来是「没开成」（返回 false），不是装作开了')
  const wordSrc = read('src/client/kernel/locale-word.js')
  const zh = wordSrc.slice(0, wordSrc.indexOf('// #529'))
  const en = wordSrc.slice(wordSrc.indexOf("'switch.bindOk': 'Switched to"))
  check(zh.indexOf("'switch.setupCardOpen':") >= 0 && en.indexOf("'switch.setupCardOpen':") >= 0, '那条词条中英各一份')
  check(zh.indexOf("'switch.bindOkAskLayout':") >= 0 && en.indexOf("'switch.bindOkAskLayout':") >= 0, '「请先回答下面那一问」那条提示中英各一份')
}

console.log('')
console.log('== G 反证：三处实现各做坏一次，对应的断言必须当场变红 ==')
{
  // ① 把「每次都问」改回「答过就不问」—— C 组那条要当场红
  const brokenJudge = setupSrc.replace('return !!(opts && opts.askLayout === true) || !readSetupLayout(st)', 'return !readSetupLayout(st)')
  check(brokenJudge !== setupSrc, '反证 ① 的改法能在真源里落地')
  const modB = new Function('readSetupLayout', 'SETUP_LAYOUT_TEXT_KEYS', stripExports(brokenJudge) + '\n;return { layoutCardShouldOpen: layoutCardShouldOpen };')((st) => {
    const t = String((st && st.setupLayout) || '').toLowerCase()
    return (t === 'single' || t === 'multi') ? t : null
  }, { single: 'setup.layout.single', multi: 'setup.layout.multi' })
  check(modB.layoutCardShouldOpen({ setupLayout: 'multi' }, { askLayout: true }) === false, '反证 ① 成立：改回「答过就不问」之后，答过布局的那一档不再问（正是本票要结束的那个行为）')

  // ② 把「点确认那一刻重判」改掉（照开卡时的旧结论办）—— E 组「还没初始化 + 确认」那条要当场红
  const brokenSettle = sbSrc.replace("if(state==='fresh'){", 'if (false) {')
  check(brokenSettle !== sbSrc, '反证 ② 的改法能在真源里落地')
  const seen2 = { inject: [], flash: [], decision: [] }
  const sb2 = {
    chainSteps: (st) => st.chainSnapshot.steps, guideStepsFor: GUIDE.guideStepsFor, guideStepDone: GUIDE.guideStepDone,
    firstBackendIdOf: () => 'github', tr: (k) => String(k),
    flash: () => {}, inject: (st, t) => seen2.inject.push(String(t)),
    promptText: (id) => id + '|x->y', injectSetupDecision: (st, id, o) => { seen2.decision.push({ allowCard: !!(o && o.allowCard) }); return 'setup' },
    logSwitchSettle: () => {}, isEnabled: () => false, log: () => {}, emit: () => {}, setTimeout, clearTimeout, console: { log () {}, warn () {}, error () {} },
  }
  const names2 = Object.keys(sb2)
  const mod2 = new Function(...names2, stripExports(brokenSettle) + '\n;return { settleSwitchCard: settleSwitchCard };')(...names2.map((n) => sb2[n]))
  const st2 = { selection: { backendId: 'markdown' }, chainSnapshot: { steps: CHAIN_NOT_INIT }, setupLayout: 'single', switchCardFrom: 'github', switchCardTo: 'markdown', switchCardLayoutFrom: 'multi', switchAlignDone: false }
  mod2.settleSwitchCard(st2, 'confirm')
  check(seen2.inject.length === 2 && seen2.decision.length === 0, '反证 ② 成立：不重判场景之后，还没初始化那份现场直接去注入对齐那两条（本该交回决策器、一个字都不自己发）—— 实得 inject=' + seen2.inject.length + ' decision=' + seen2.decision.length)

  // ③ 把「卡还开着」那道闸摘掉 —— F 组那条要当场红
  const brokenGate = swSrc.replace("if (st.setupLayoutCardOpen === true) {", 'if (false) {')
  check(brokenGate !== swSrc, '反证 ③ 的改法能在真源里落地')
  // 探针：openSwitchConfirm 真开成时会把 switchConfirm 状态写进 st（并去拉 CRI）。这里不去顶替 loadSwitchCri
  //   （它与 store-switch.js 自己的声明重名，不能当参数传），改成看会话状态上有没有那一笔。
  const swSandbox = {
    flash: () => {}, emit: () => {}, host: { call: () => Promise.resolve({ ok: true }) }, tr: () => '',
  }
  const names3 = Object.keys(swSandbox)
  const mod3 = new Function(...names3, stripExports(brokenGate) + '\n;return { openSwitchConfirm: openSwitchConfirm };')(...names3.map((n) => swSandbox[n]))
  const st3 = { selection: { backendId: 'github' }, setupLayoutCardOpen: true }
  const opened = mod3.openSwitchConfirm(st3, 'markdown')
  check(opened === true && !!st3.switchConfirm && st3.switchConfirm.open === true, '反证 ③ 成立：那道闸摘掉之后，卡还开着也能把「切换后端」那张窗开出来（同屏两张问句）')
}

console.log('')
console.log(failed ? 'FAIL ' + passed + ' 项通过 / ' + failed + ' 项未过' : 'PASS 全部 ' + passed + ' 项检查通过')
process.exit(failed ? 1 : 0)
