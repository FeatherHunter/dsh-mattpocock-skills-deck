// verify-663-banner-chain.js — #663 状态栏横幅链（前半）：黄条等仓库就绪 · 仓库那一段的按钮开的是建仓弹窗
// 只测外部行为、不测 DOM：把 src/client/statusbar/bannerChain.js 取出来在沙箱里求值
//   （顺序真源用真的 src/shared/tracker/guide-steps.js，动作分发用真的 src/client/kernel/actions.js），
//   喂假会话状态与假链快照，断言「今天该出哪一条横幅」与「那颗按钮点下去干什么」。
// 取源做法照 tests/verify-668-guide-steps-single-source.js 与 tests/verify-655-setup-layout.js。
// 用法: node tests/verify-663-banner-chain.js
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')

const root = path.resolve(__dirname, '..')
let failed = false
let failedN = 0
let total = 0
const ok = (cond, msg) => { total++; if (cond) console.log('  PASS ' + msg); else { failed = true; failedN += 1; console.log('  FAIL ' + msg) } }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

// —— 取真源：bannerChain.js 是 leaf 模块（每行行首 export），去掉 export 后在沙箱里求值 ——
//   闭包里的那些依赖按真形状顶替：链快照读数照产物里的写法从 st.chainSnapshot 取，
//   动作分发用真的 createActionDispatcher（它只认动作词表，不认后端），其余只记下被调过。
async function loadBannerChain() {
  const guide = await import(pathToFileURL(path.join(root, 'src/shared/tracker/guide-steps.js')).href)
  const actions = await import(pathToFileURL(path.join(root, 'src/client/kernel/actions.js')).href)
  const body = read('src/client/statusbar/bannerChain.js').replace(/^[ \t]*export[ \t]+/gm, '')
  const seen = { injected: [], logged: [], forms: [], gateOpened: 0, setupInit: 0 }
  const stepsOf = (st) => (st && st.chainSnapshot && Array.isArray(st.chainSnapshot.steps)) ? st.chainSnapshot.steps : []
  const sandbox = {
    guideStepsFor: guide.guideStepsFor,
    guideStepDone: guide.guideStepDone,
    currentBackendId: (st) => (st && st.selection && st.selection.backendId != null) ? st.selection.backendId : null,
    chainSteps: stepsOf,
    chainStep: (st, id) => stepsOf(st).find((x) => String(x.id) === String(id)) || null,
    checkShowTitle: (show, fallback) => String((show && (show.title || show.fallback || show.desc)) || fallback || ''),
    installSkillsParams: () => ({ probeList: 'wayfinder', probeCount: '1' }),
    promptText: (id) => '提示词全文：' + id,
    promptTextFor: (st, id) => '提示词全文：' + id,
    moduleMetaOf: (st, bid) => ((st && st.backendModules) || []).find((m) => String(m.id) === String(bid)) || null,
    promptLang: () => 'zh',
    onStatusSetupInit: (st) => { seen.setupInit += 1; return (st && ('__setupKind' in st)) ? st.__setupKind : 'setup-card' },
    createActionDispatcher: actions.createActionDispatcher,
    inject: (st, text) => { seen.injected.push(String(text)) },
    openUrl: () => {},
    host: { call: () => Promise.resolve({ ok: true }) },
    openFormModal: (st, payload) => { seen.forms.push(payload) },
    loadChain: () => {},
    loadSnapshot: () => {},
    flash: () => {},
    openStatusGate: () => { seen.gateOpened += 1 },
    log: (level, event, fields) => { seen.logged.push({ level: level, event: event, fields: fields }) },
    console: { log: function () {}, warn: function () {}, error: function () {} },
  }
  const names = Object.keys(sandbox)
  const factory = new Function(...names, body + '\n;return { guideBannerStep: guideBannerStep, guideBannerParams: guideBannerParams, runGuideMissing: runGuideMissing }')
  return { mod: factory(...names.map((n) => sandbox[n])), seen: seen, guide: guide }
}

// 链快照替身：喂「某个检查项什么状态」，其余不出现的项就当快照里没有（渲染与宿主都只认快照里有的那些）。
const chainOf = (statusMap) => ({ steps: Object.keys(statusMap).map((id) => ({ id: id, status: statusMap[id] })) })
const stOf = (opts) => {
  const o = opts || {}
  const st = { cwd: '/w/demo', selection: { backendId: o.backend === undefined ? 'github' : o.backend } }
  if (o.chain) st.chainSnapshot = chainOf(o.chain)
  if (o.actions) st.chainSnapshot.steps = st.chainSnapshot.steps.map((s) => o.actions[s.id] ? Object.assign({}, s, { actions: o.actions[s.id] }) : s)
  return st
}
// 一条「装了 gh、也登录了、但还没有远端仓库」的 GitHub 链（全新目录走到第 4 步的样子）。
const GH_NO_REPO = { 'gh:installed': 'done', 'gh:authed': 'done', 'gh:remote': 'fail', 'tracker:initialized': 'fail', 'skill:wayfinder': 'fail', 'env:home': 'done' }

async function main() {
  const { mod, seen, guide } = await loadBannerChain()
  const stepIdOf = (st, gateOpen) => { const s = mod.guideBannerStep(st, gateOpen); return s ? s.id : null }

  console.log('== 1. 链快照还没到：一条横幅都不出（不把「还没查到」当「没过」）==')
  ok(stepIdOf(stOf({ backend: 'github' }), false) === null, '后端已定、链快照还没到 → 不出横幅（不闪黄条）')
  ok(stepIdOf(stOf({ backend: 'markdown' }), false) === null, '本地 Markdown 同样不出')

  console.log('== 2. 黄条等仓库就绪：仓库没过 → 出的是「还没有远端仓库」那一段 ==')
  const noRepo = stOf({ backend: 'github', chain: GH_NO_REPO })
  const noRepoStep = mod.guideBannerStep(noRepo, false)
  ok(!!noRepoStep && noRepoStep.id === 'gh:remote', '已登录、缺仓库、也未初始化 → 轮到「已关联 GitHub 仓库」那一步（实得 ' + stepIdOf(noRepo, false) + '）')
  ok(!!noRepoStep && noRepoStep.banner.text === 'banner.repo' && noRepoStep.banner.btn === 'banner.repoBtn', '那一步的横幅用新加的那对词条键（banner.repo / banner.repoBtn）')
  ok(!!noRepoStep && noRepoStep.banner.text !== 'banner.setup', '此时出的不是「该工作区尚未初始化」那条黄条（这就是「黄条等仓库就绪」）')

  console.log('== 3. 仓库过了、初始化没过 → 才轮到黄条 ==')
  const repoReady = Object.assign({}, GH_NO_REPO, { 'gh:remote': 'done' })
  const setupStep = mod.guideBannerStep(stOf({ backend: 'github', chain: repoReady }), false)
  ok(!!setupStep && setupStep.id === 'tracker:initialized', '仓库就绪后出的是初始化那一步（实得 ' + (setupStep && setupStep.id) + '）')
  ok(!!setupStep && setupStep.banner.text === 'banner.setup', '那一步的横幅就是「该工作区尚未初始化」黄条')

  console.log('== 4. 顺序就是清单那一条：gh cli → 登录 → 仓库 → 初始化 → 技能 ==')
  const order = [
    [{ 'gh:installed': 'fail' }, 'gh:installed'],
    [{ 'gh:installed': 'done', 'gh:authed': 'fail' }, 'gh:authed'],
    [GH_NO_REPO, 'gh:remote'],
    [repoReady, 'tracker:initialized'],
    [Object.assign({}, repoReady, { 'tracker:initialized': 'done' }), 'skill:wayfinder'],
  ]
  for (const row of order) {
    const got = stepIdOf(stOf({ backend: 'github', chain: row[0] }), false)
    ok(got === row[1], '缺 ' + row[1] + ' 时出的是它（实得 ' + got + '）')
  }
  ok(stepIdOf(stOf({ backend: 'github', chain: Object.assign({}, repoReady, { 'tracker:initialized': 'done', 'skill:wayfinder': 'done', 'skill:setup-matt-pocock-skills': 'done', 'skill:ask-matt': 'done' }) }), false) === null, '六步全过 → 一条横幅都不出')
  ok(stepIdOf(stOf({ backend: 'github', chain: Object.assign({}, repoReady, { 'tracker:initialized': 'done' }) }), false) === 'skill:wayfinder', '技能那一步一条横幅管三项：任一项没过就出技能那条')

  console.log('== 5. 本地 Markdown 不插仓库那一段 ==')
  const mdChain = { 'tracker:initialized': 'fail', 'skill:wayfinder': 'fail', 'md:scratchWritable': 'fail' }
  const mdStep = mod.guideBannerStep(stOf({ backend: 'markdown', chain: mdChain }), false)
  ok(!!mdStep && mdStep.id === 'tracker:initialized', 'Markdown 缺初始化 → 直接出黄条（它的清单里没有仓库那一步）')
  ok(mdStep !== null && mdStep.banner.text === 'banner.setup', 'Markdown 出的也是那条黄条，不是仓库段')

  console.log('== 6. 门控那一档：后端没选定 → 蓝条那一步 ==')
  const undecided = stOf({ backend: null, chain: GH_NO_REPO })
  const gateStep = mod.guideBannerStep(undecided, true)
  ok(!!gateStep && gateStep.id === 'selection:backendSelected', '后端没定下来 → 出的是「已选择后端」那一步（实得 ' + (gateStep && gateStep.id) + '）')
  ok(!!gateStep && gateStep.banner.tone === 'info', '那一步的横幅是蓝条（tone 为 info）')

  console.log('== 7. 仓库那一段的按钮：开的是那个两步建仓弹窗，不再注入缺仓长文 ==')
  const wizard = { type: 'wizard', label: { zh: '创建并发布', en: 'Create & publish' }, steps: [{ title: { zh: '仓库信息' }, schema: [{ name: 'name', type: 'text' }] }, { title: { zh: '可见性' }, schema: [{ name: 'visibility', type: 'single' }] }], submitAction: { type: 'rpc', method: 'wf.initPublish', params: {} } }
  const stRepo = stOf({ backend: 'github', chain: GH_NO_REPO, actions: { 'gh:remote': [wizard, { type: 'refresh', target: 'chain' }] } })
  const before = seen.injected.length
  const outRepo = mod.runGuideMissing(stRepo, mod.guideBannerStep(stRepo, false))
  await new Promise((r) => setTimeout(r, 0))
  ok(outRepo === 'action', '仓那一步的按钮归到「交给弹窗那类端点动作」（实得 ' + outRepo + '）')
  ok(seen.injected.length === before, '一个字都没注入（缺仓长文那条老路到此结束）')
  ok(seen.forms.length === 1, '建仓弹窗被真开了一次（实得 ' + seen.forms.length + ' 次）')
  ok(seen.forms[0] && seen.forms[0].type === 'wizard' && Array.isArray(seen.forms[0].steps) && seen.forms[0].steps.length === 2, '开出来的是那个两步弹窗（仓库名 → 可见性）')
  ok(seen.forms[0] && seen.forms[0].submitAction && seen.forms[0].submitAction.method === 'wf.initPublish', '提交动作仍是后端声明的那条电话 wf.initPublish')
  ok(!!seen.logged.find((l) => l.event === 'guide.inject' && l.fields.step === 'gh:remote' && l.fields.outcome === 'action'), '日志里记下「哪一步、给出去的是哪一类」')

  console.log('== 8. 门控那个窗：点确认只把后端定下来，不注入、也不记布局 ==')
  const sbSrc = read('src/client/statusbar/StatusBackend.js').replace(/^[ \t]*export[ \t]+/gm, '')
  const sbSeen = { injected: [], decisions: [], bound: [] }
  const sbSandbox = {
    tr: (k) => String(k),
    emit: () => {},
    firstBackendIdOf: () => 'github',
    setCachedSelection: () => {},
    setPresentationMap: () => {},
    labelOf: (id) => String(id),
    flash: () => {},
    loadSnapshot: () => {},
    moduleMetaOf: () => null,
    injectSetupDecision: (st, id, opts) => { sbSeen.decisions.push({ id: id, allowCard: !!(opts && opts.allowCard), askLayout: !!(opts && opts.askLayout) }); return 'setup-card' },
    host: { call: (method, params) => { sbSeen.bound.push({ method: method, params: params }); return Promise.resolve({ ok: true }) } },
    console: { log: function () {}, warn: function () {}, error: function () {} },
  }
  const sbNames = Object.keys(sbSandbox)
  const sbMod = new Function(...sbNames, sbSrc + '\n;return { confirmStatusGate: confirmStatusGate, onStatusSetupInit: onStatusSetupInit, layoutRadios: layoutRadios }')(...sbNames.map((n) => sbSandbox[n]))
  const stGate = { cwd: '/w/demo', selection: null, snapshot: null, gateModalOpen: true, gateModalSource: 'status', gateSelected: 'github' }
  sbMod.confirmStatusGate(stGate)
  await new Promise((r) => setTimeout(r, 0))
  ok(stGate.selection && stGate.selection.backendId === 'github', '点确认把后端定下来了')
  ok(sbSeen.bound.length === 1 && sbSeen.bound[0].method === 'wf.bind' && sbSeen.bound[0].params.backendId === 'github', '仍然照旧调那条绑定电话')
  ok(sbSeen.decisions.length === 0, '确认这条路上一次注入决策都没有走（此前会顺手注入一段长文）')
  ok(stGate.setupLayout === undefined && stGate.setupLayoutCardOpen !== true, '也没顺手记布局、没弹那张小卡（撤单选与撤注入一起做了，不留一张没有座位的卡）')
  ok(stGate.gateModalOpen === false, '窗关掉了')

  console.log('== 9. 黄条那颗按钮的走法不变：布局没答过弹小卡、答过直接注入 ==')
  const stSetupCard = Object.assign({ __setupKind: 'setup-card' }, stOf({ backend: 'github', chain: repoReady }))
  const outCard = mod.runGuideMissing(stSetupCard, mod.guideBannerStep(stSetupCard, false))
  ok(seen.setupInit === 1 && outCard === 'action', '布局没答过 → 只开小卡（归到「交给弹窗那类」），一个字的注入都没有')
  const stSetupText = Object.assign({ __setupKind: 'setup' }, stOf({ backend: 'github', chain: repoReady }))
  const beforeSetup = seen.injected.length
  const outText = mod.runGuideMissing(stSetupText, mod.guideBannerStep(stSetupText, false))
  ok(outText === 'text' && seen.injected.length === beforeSetup, '布局已答过 → 交给那条既有的注入漏斗去做（本文件自己不注入）')
  const stOther = Object.assign({ __setupKind: '' }, stOf({ backend: 'github', chain: repoReady }))
  ok(mod.runGuideMissing(stOther, mod.guideBannerStep(stOther, false)) === 'none', '漏斗什么都没给出来（例如仓库没就绪被挡下）→ 记成「没有文案可注入」')
  const sbSetup = { cwd: '/w/demo', selection: { backendId: 'github' } }
  const kind = sbMod.onStatusSetupInit(sbSetup)
  ok(kind === 'setup-card', 'StatusBackend 的那个入口把决定结果回了给调用处（实得 ' + kind + '）')
  ok(sbSeen.decisions.length === 1 && sbSeen.decisions[0].allowCard === true, '初始化那颗按钮仍然只走允许弹小卡的那条入口（#655 的漏斗没动）')
  ok(sbSeen.decisions.length === 1 && sbSeen.decisions[0].askLayout === true, '而且黄条这一颗每次都要先问布局（askLayout:true，2026-09-21 维护者拍板 A）')

  console.log('== 10. 接线：状态栏真的用了它，旧的手写优先级没了 ==')
  const barSrc = read('src/client/statusbar/StatusBar.js')
  const sumSrc = read('src/client/statusbar/checksums.js')
  ok(barSrc.indexOf('guideBannerStep(s,') >= 0 && barSrc.indexOf('runGuideMissing(s, bannerStep)') >= 0, '状态栏按清单取那一步，按钮点下去走统一入口')
  ok(barSrc.indexOf('guideBannerParams(s, bannerStep)') >= 0, '横幅正文的占位符也照清单那一步取（技能那条的 {list}）')
  ok(barSrc.indexOf('firstBlock') < 0 && sumSrc.indexOf('ghCliBad') < 0 && sumSrc.indexOf('ghAuthBad') < 0, '手写的那串优先级与它那几个布尔读数都删了')
  ok((barSrc.match(/layoutRadios\(s, h\)/g) || []).length === 1, '布局那组单选只剩初始化那张小卡一处（门控窗里那处撤了）')
  const clientBundle = read('client.js')
  const pkgBundle = read('package/lib/client.js')
  ok(clientBundle.indexOf('const guideBannerStep = function') >= 0 && pkgBundle.indexOf('const guideBannerStep = function') >= 0, '双产物里都带着这份横幅链（已随构建拼进闭包）')
  ok(clientBundle.indexOf("'guide.inject'") >= 0 && pkgBundle.indexOf("'guide.inject'") >= 0, '双产物里都带着那条常驻注入日志的落点')
  ok(guide.GUIDE_STEPS.filter((s) => s.id === 'gh:remote' && s.blocksSetup === true).length === 1, '顺序真源那边「仓库那一步挡初始化全文」仍然成立（本票只消费它）')

  console.log(failed ? 'FAIL ' + total + ' 项检查里有 ' + failedN + ' 项未过' : 'PASS 全部 ' + total + ' 项检查通过')
  process.exit(failed ? 1 : 0)
}

main().catch(function (e) { console.error('RUNNER ERROR:', e); process.exit(1) })
