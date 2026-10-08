// verify-916-ghauth-unknown-banner.js — #916 查不到≠没登录：pending 出中性横幅+重查，fail 才出登录指引
// 只测外部行为、不测 DOM：bannerChain 沙箱求值（顺序真源用真的 guide-steps.js），喂假链快照断言横幅与按钮去向。
// 用法: node tests/verify-916-ghauth-unknown-banner.js
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')

const root = path.resolve(__dirname, '..')
let failed = false
const ok = (cond, msg) => { if (cond) console.log('  PASS ' + msg); else { failed = true; console.log('  FAIL ' + msg) } }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

async function loadBannerChain() {
  const guide = await import(pathToFileURL(path.join(root, 'src/shared/tracker/guide-steps.js')).href)
  const body = read('src/client/statusbar/bannerChain.js').replace(/^[ \t]*export[ \t]+/gm, '')
  const seen = { injected: [], logged: [], detectCalls: 0, chainReloads: 0, snapReloads: 0 }
  const stepsOf = (st) => (st && st.chainSnapshot && Array.isArray(st.chainSnapshot.steps)) ? st.chainSnapshot.steps : []
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
    loadChain: () => { seen.chainReloads += 1 },
    loadSnapshot: () => { seen.snapReloads += 1 },
    flash: () => {},
    openStatusGate: () => {},
    log: (level, event, fields) => { seen.logged.push({ level, event, fields }) },
    console: { log: function () {}, warn: function () {}, error: function () {} },
  }
  const names = Object.keys(sandbox)
  const factory = new Function(...names, body + '\n;return { guideBannerStep, guideBannerMeta, runGuideMissing }')
  return { mod: factory(...names.map((n) => sandbox[n])), seen, guide }
}

const mk = (chain) => ({ cwd: '/w/demo', selection: { backendId: 'github' }, chainSnapshot: { steps: Object.keys(chain).map((id) => ({ id, status: chain[id] })) } })

async function main() {
  const { mod, seen, guide } = await loadBannerChain()

  console.log('== 1. 确定没登录（fail）→ 还是登录指引那一套 ==')
  const failSt = mk({ 'gh:installed': 'done', 'gh:authed': 'fail' })
  const failStep = mod.guideBannerStep(failSt, false)
  ok(!!failStep && failStep.id === 'gh:authed', 'fail 时选中的仍是登录那一步')
  const failMeta = mod.guideBannerMeta(failSt, failStep)
  ok(failMeta.text === 'banner.ghauth' && failMeta.btn === 'banner.ghauthBtn', 'fail 文案仍是缺登录 + 查看登录指南')
  const beforeFail = seen.injected.length
  ok(mod.runGuideMissing(failSt, failStep) === 'text', 'fail 按钮仍注入登录指引')
  ok(seen.injected.length === beforeFail + 1 && seen.injected[seen.injected.length - 1].indexOf('PROMPT:ghAuthLogin') >= 0, '注入的是登录指引那一段')

  console.log('== 2. 查不到（pending）→ 中性横幅 + 只重查 ==')
  const pendSt = mk({ 'gh:installed': 'done', 'gh:authed': 'pending' })
  const pendStep = mod.guideBannerStep(pendSt, false)
  ok(!!pendStep && pendStep.id === 'gh:authed', 'pending 时选中的仍是登录那一步（顺序不变）')
  const pendMeta = mod.guideBannerMeta(pendSt, pendStep)
  ok(pendMeta.text === 'banner.ghauthUnknown' && pendMeta.btn === 'banner.ghauthUnknownBtn', 'pending 文案换成中性那一套（未知 + 重新检查）')
  ok(pendMeta.text !== 'banner.ghauth', 'pending 不再复用缺登录那句文案')
  const beforeInj = seen.injected.length
  ok(mod.runGuideMissing(pendSt, pendStep) === 'action', 'pending 按钮走重查那一路')
  ok(seen.injected.length === beforeInj, 'pending 一个字都不注入（不给登录指引）')
  ok(seen.detectCalls === 1 && seen.chainReloads === 1 && seen.snapReloads === 1, '重查确实触发了强制重算（detect + 链 + 快照各一次）')
  ok(!!seen.logged.find((l) => l.event === 'guide.inject' && l.fields.step === 'gh:authed' && l.fields.outcome === 'action'), '重查落一行旧格式日志（只记哪一步与哪一类）')

  console.log('== 3. 明确失败的 current 同样走登录指引 ==')
  const curSt = mk({ 'gh:installed': 'done', 'gh:authed': 'current' })
  const curMeta = mod.guideBannerMeta(curSt, mod.guideBannerStep(curSt, false))
  ok(curMeta.text === 'banner.ghauth', 'current 算确定失败，仍是缺登录那句')

  console.log('== 4. 通过（done）→ 不再是登录那条 ==')
  const doneStep = mod.guideBannerStep(mk({ 'gh:installed': 'done', 'gh:authed': 'done', 'gh:remote': 'fail' }), false)
  ok(!!doneStep && doneStep.id !== 'gh:authed', '登录通过后横幅轮到后面那一步')

  console.log('== 5. 词条中英齐全 ==')
  const locale = read('src/client/kernel/locale-panel.js')
  for (const k of ['banner.ghauthUnknown', 'banner.ghauthUnknownBtn']) {
    ok(locale.split("'" + k + "'").length - 1 >= 2, k + ' 中英各一条')
  }
  ok(read('src/shared/tracker/guide-steps.js').indexOf('ghAuthUnknown') >= 0, '中性横幅住在共享清单里（顺序与文案单一真源）')
  ok(read('src/client/statusbar/bannerChain.js').indexOf('guideBannerMeta') >= 0, '横幅文案经分流函数取，不直读清单那条旧文案')

  if (failed) { console.log('\n916 BANNER TESTS FAILED'); process.exit(1) }
  console.log('\n916 BANNER TESTS PASSED')
}

main().catch((e) => { console.log('FAIL 沙箱求值失败：' + String((e && e.message) || e)); process.exit(1) })
