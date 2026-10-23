// verify-1438-banner-recheck-button.ts — #1438 登录失败那条横幅多一颗「重新检查」
// 为什么要有这一扇：那条横幅说的是「没登录」，可人往往是到插件外面把登录修好才回来的；
//   修好以后这条横幅上原来没有一颗点了会重查的按钮，只能自己绕到「环境检查」页去点。
// 判据分两半：
//   行为半 —— bannerChain 在沙箱里求值（顺序真源用真的 guide-steps.js），喂假链快照，断言
//     「哪条横幅带第二颗按钮」「点下去走哪条通道」「别的横幅不许多出来」「重查没回来前不假装已好」；
//   形状半 —— 状态栏那段源码里第二颗按钮的接线（点击日志、进行中置灰与转圈、叉没被多画）与
//     「仍然是一次性重查、没有新增自续定时器」。
// 用法: node --import ./scripts/ts-hook.mts tests/verify-1438-banner-recheck-button.ts
const path = require('path')
const { pathToFileURL } = require('url')
const { spliceableJs, sourceText } = require('./lib/source-text.ts')
const { compileFn } = require('./lib/eval-probe.js')
const { readCopyConfig } = require('../scripts/lib/copy-config.mts')

const root = path.resolve(__dirname, '..')
let failed = false
const ok = (cond, msg) => { if (cond) console.log('  PASS ' + msg); else { failed = true; console.log('  FAIL ' + msg) } }

const stepsOf = (st) => (st && st.chainSnapshot && Array.isArray(st.chainSnapshot.steps)) ? st.chainSnapshot.steps : []
const mk = (chain) => ({ cwd: '/w/demo', selection: { backendId: 'github' }, chainSnapshot: { steps: Object.keys(chain).map((id) => ({ id, status: chain[id] })) } })

async function loadBannerChain(opts) {
  const o = opts || {}
  const guide = await import(pathToFileURL(path.join(root, 'src/shared/tracker/guide-steps.js')).href)
  const body = spliceableJs('src/client/statusbar/bannerChain.js')
  const seen = { injected: [], logged: [], refreshAll: 0, refreshAllSt: null, detectCalls: 0, chainReloads: 0, snapReloads: 0, recheckTrigger: null }
  const sandbox = {
    guideStepsFor: guide.guideStepsFor,
    guideStepDone: guide.guideStepDone,
    guideBannerOf: guide.guideBannerOf,
    guideMissingOf: guide.guideMissingOf,
    currentBackendId: (st) => (st && st.selection && st.selection.backendId != null) ? st.selection.backendId : null,
    chainSteps: stepsOf,
    chainStep: (st, id) => stepsOf(st).find((x) => String(x.id) === String(id)) || null,
    checkShowTitle: () => '',
    installSkillsParams: () => ({}),
    promptText: (id) => 'PROMPT:' + id,
    promptTextFor: (st, id) => 'PROMPT:' + id,
    moduleMetaOf: () => null,
    promptLang: () => 'en',
    onStatusSetupInit: () => 'askLayout',
    createActionDispatcher: () => ({ dispatch: () => {} }),
    inject: (st, text) => { seen.injected.push(String(text)) },
    openUrl: () => {},
    host: { call: () => { seen.detectCalls += 1; return Promise.resolve({ ok: true }) } },
    openFormModal: () => {},
    chainEventRefresh: (st, why) => { seen.chainReloads += 1; seen.recheckTrigger = String(why); return Promise.resolve(null) },
    loadChain: () => { seen.chainReloads += 1; return Promise.resolve(null) },
    loadSnapshot: () => { seen.snapReloads += 1 },
    flash: () => {},
    openStatusGate: () => {},
    log: (level, event, fields) => { seen.logged.push({ level, event, fields }) },
    console: { log: function () {}, warn: function () {}, error: function () {} },
    // 检查页那颗「重新检查」的真身；这一档故意可关，用来量「那条路不在时退回同一条重查」。
    refreshAll: o.refreshAll === false ? undefined : (st) => { seen.refreshAll += 1; seen.refreshAllSt = st },
  }
  const names = Object.keys(sandbox)
  const factory = compileFn(names, body + '\n;return { guideBannerStep, guideBannerMeta, runGuideMissing, runGuideRecheck }')
  return { mod: factory(...names.map((n) => sandbox[n])), seen, guide }
}

async function main() {
  const { mod, seen, guide } = await loadBannerChain()

  console.log('== 1. 确定没登录：主按钮照旧，旁边多一颗「重新检查」 ==')
  const failSt = mk({ 'gh:installed': 'done', 'gh:authed': 'fail' })
  const failStep = mod.guideBannerStep(failSt, false)
  ok(!!failStep && failStep.id === 'gh:authed', '失败时选中的仍是登录那一步')
  const failMeta = mod.guideBannerMeta(failSt, failStep)
  ok(failMeta.text === 'banner.ghauth' && failMeta.btn === 'banner.ghauthBtn', '主按钮还是「查看登录指南」那一条（原文案与图标键没动）')
  ok(failMeta.recheckBtn === 'banner.ghauthUnknownBtn', '第二颗按钮声明了「重新检查」的词条键（实得 ' + String(failMeta.recheckBtn) + '）')

  console.log('== 2. 本来就是重新检查的那一条：仍然只有一颗按钮 ==')
  const pendSt = mk({ 'gh:installed': 'done', 'gh:authed': 'pending' })
  const pendMeta = mod.guideBannerMeta(pendSt, mod.guideBannerStep(pendSt, false))
  ok(pendMeta.text === 'banner.ghauthUnknown' && pendMeta.btn === 'banner.ghauthUnknownBtn', '「登录状态暂时确认不了」那版照旧（未知 + 重新检查）')
  ok(pendMeta.recheckBtn === undefined, '那版没有第二颗按钮（不并排两颗重新检查）')
  ok(failMeta.recheckBtn === pendMeta.btn, '两处的「重新检查」是同一句话（复用同一个词条，不另造第三个说法）')
  const unreadSt = mk({ 'gh:installed': 'done' })
  const unreadStep = mod.guideBannerStep(unreadSt, false)
  ok(!!unreadStep && unreadStep.id === 'chain:unread', '链快照缺挡路行时出的仍是中性那条')
  ok(mod.guideBannerMeta(unreadSt, unreadStep).recheckBtn === undefined, '中性那条本来就只有重查一颗，也没有第二颗')

  console.log('== 3. 其它横幅不许多出来 ==')
  const cliSt = mk({ 'gh:installed': 'fail' })
  const cliStep = mod.guideBannerStep(cliSt, false)
  ok(!!cliStep && mod.guideBannerMeta(cliSt, cliStep).text === 'banner.ghcli', '缺 gh 那条还是缺 gh')
  ok(mod.guideBannerMeta(cliSt, cliStep).recheckBtn === undefined, '缺 gh 那条没有第二颗按钮')
  const repoSt = mk({ 'gh:installed': 'done', 'gh:authed': 'done', 'gh:remote': 'fail' })
  const repoStep = mod.guideBannerStep(repoSt, false)
  ok(!!repoStep && mod.guideBannerMeta(repoSt, repoStep).text === 'banner.repo', '缺仓库那条还是缺仓库')
  ok(mod.guideBannerMeta(repoSt, repoStep).recheckBtn === undefined, '缺仓库那条没有第二颗按钮')

  console.log('== 4. 点第二颗按钮：走环境检查页同一条重查通道 ==')
  const beforeInj = seen.injected.length
  ok(mod.runGuideRecheck(failSt, 'gh:authed') === 'action', '点下去记的是「动了一次」这一类')
  ok(seen.refreshAll === 1 && seen.refreshAllSt === failSt, '走的是 refreshAll（环境检查页那颗「重新检查」同一条路）')
  ok(seen.injected.length === beforeInj, '不注入登录指引（注入是主按钮那件事）')
  ok(stepsOf(failSt).filter((x) => x.id === 'gh:authed')[0].status === 'fail', '重查还没回来前不改链快照（不先把红的改绿）')
  ok(!!mod.guideBannerStep(failSt, false) && mod.guideBannerStep(failSt, false).id === 'gh:authed', '重查还没回来前横幅照旧在（不先藏起来）')
  ok(!!seen.logged.find((l) => l.event === 'guide.inject' && l.fields.step === 'gh:authed' && l.fields.outcome === 'action'), '日志沿用 guide.inject（没有新增事件名）')

  console.log('== 5. 没有 refreshAll 的沙箱：退回同一条带标记的重查 ==')
  const bare = await loadBannerChain({ refreshAll: false })
  const bareSt = mk({ 'gh:installed': 'done', 'gh:authed': 'fail' })
  bare.mod.runGuideRecheck(bareSt, 'gh:authed')
  ok(bare.seen.detectCalls === 1 && bare.seen.chainReloads === 1 && bare.seen.snapReloads === 1, '链与快照各重取一次（detect + 链 + 快照）')
  ok(bare.seen.recheckTrigger === 'user-recheck', '退回那一路也带「人亲手点的」令牌（不被退避挡回）')
  ok(!!bare.seen.logged.find((l) => l.event === 'guide.inject' && l.fields.outcome === 'action'), '退回那一路同样落日志')

  console.log('== 6. 声明只有一处、词条真的在词表里 ==')
  ok(guide.GUIDE_STEPS.filter((s) => s.banner && s.banner.recheckBtn).length === 1, 'GUIDE_STEPS 里带第二颗按钮的步骤恰好一条')
  const ghStep = guide.GUIDE_STEPS.filter((s) => s.id === 'gh:authed')[0]
  ok(!!ghStep && !!ghStep.banner && ghStep.banner.recheckBtn === 'banner.ghauthUnknownBtn', '那一条就是登录那一步，键仍是「重新检查」那一句')
  const cfg = readCopyConfig(root)
  const panel = cfg.families.filter((f) => f.family === 'panel')[0]
  const langs = Object.keys(cfg.languages.languages)
  ok(!!panel && langs.length > 0, '词表可读（panel 词族与语言清单都在）')
  const zh = (panel && panel.texts['zh']) || {}
  ok(zh['banner.ghauthUnknownBtn'] === '重新检查', '中文词条就是「重新检查」（复用既有词条，没新增说法）')
  for (const lang of langs) {
    const dict = (panel && panel.texts[lang]) || {}
    ok(typeof dict['banner.ghauthUnknownBtn'] === 'string' && dict['banner.ghauthUnknownBtn'] !== '', '语言 ' + lang + ' 里查得到这个键')
  }

  console.log('== 7. 状态栏接线（源码形状）与「仍然没有自续定时器」 ==')
  const barSrc = sourceText('src/client/statusbar/StatusBar.js')
  ok(barSrc.indexOf('meta.recheckBtn ?') >= 0, '状态栏按声明决定要不要多画第二颗（有才画）')
  ok(barSrc.indexOf('runGuideRecheck(s, bannerStep.id)') >= 0, '第二颗点下去走 bannerChain 的重查入口')
  const altLine = (barSrc.match(/alt \? h\('button'[^\n]*/) || [''])[0]
  ok(altLine.indexOf("'data-log': 'status.banner.recheck'") >= 0, '第二颗按钮接了点击日志（#1335 界面反馈）')
  ok(altLine.indexOf('disabled: !!alt.busy') >= 0 && altLine.indexOf("alt.busy ? ' dsws-spin'") >= 0, '进行中置灰并转圈（点不出第二趟，也看得见在动）')
  ok((barSrc.match(/'data-log': 'status.banner.fold'/g) || []).length === 1, '黄条那颗叉还是只有一颗（收起语义没动）')
  const chainSrc = sourceText('src/client/statusbar/bannerChain.js')
  ok(chainSrc.indexOf('setInterval') < 0 && chainSrc.indexOf('setTimeout') < 0, '重查仍是一次性的：没有新增自续定时器')

  if (failed) { console.log('\n1438 BANNER RECHECK TESTS FAILED'); process.exit(1) }
  console.log('\n1438 BANNER RECHECK TESTS PASSED')
}

main().catch((e) => { console.log('FAIL 沙箱求值失败：' + String((e && e.message) || e)); process.exit(1) })
