// verify-663-gh-install-inject.js — #663 状态栏横幅链（后半）：装 gh cli 那一颗按钮注入的是维护者给的原话
// 背景：这颗按钮以前取的是链上这一项的 show.hint，而那句话在一次改写里被降成了一句陈述句
//   （「GitHub 助手（gh cli）还没安装，安装后即可继续。」），点一下等于什么都没给。按缺陷修。
// 做法：把 src/client/statusbar/bannerChain.js 取出来在沙箱里求值（顺序真源用真的 guide-steps.js），
//   喂假链快照与假后端声明，断言「注入的到底是哪一段字」与「日志记的是哪一类」。
// 用法: node tests/verify-663-gh-install-inject.js
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')

const root = path.resolve(__dirname, '..')
let failed = false
let failedN = 0
let total = 0
const ok = (cond, msg) => { total++; if (cond) console.log('  PASS ' + msg); else { failed = true; failedN += 1; console.log('  FAIL ' + msg) } }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

// 维护者 2026-09-19 给的那句原话（金样写在本门禁里：谁把清单里那句改了，这里先红）。
const ORIGINAL = '/wizard 帮用户安装gh cli 官方地址：https://cli.github.com/'
// 那句陈述句 —— 旧写法注入的就是它，新流程里一个字都不许再出现在注入路径上。
const OLD_STATEMENT = 'GitHub 助手（gh cli）还没安装，安装后即可继续。'

async function loadBannerChain(overrides) {
  const o = overrides || {}
  const guide = await import(pathToFileURL(path.join(root, 'src/shared/tracker/guide-steps.js')).href)
  const actions = await import(pathToFileURL(path.join(root, 'src/client/kernel/actions.js')).href)
  const body = read('src/client/statusbar/bannerChain.js').replace(/^[ \t]*export[ \t]+/gm, '')
  const seen = { injected: [], logged: [] }
  const stepsOf = (st) => (st && st.chainSnapshot && Array.isArray(st.chainSnapshot.steps)) ? st.chainSnapshot.steps : []
  const sandbox = {
    guideStepsFor: guide.guideStepsFor,
    guideStepDone: guide.guideStepDone,
    currentBackendId: (st) => (st && st.selection && st.selection.backendId != null) ? st.selection.backendId : null,
    chainSteps: stepsOf,
    chainStep: (st, id) => stepsOf(st).find((x) => String(x.id) === String(id)) || null,
    checkShowTitle: (show, fallback) => String((show && (show.title || show.fallback || show.desc)) || fallback || ''),
    installSkillsParams: () => ({ probeList: 'wayfinder', probeCount: '1' }),
    promptText: (id) => (o.promptText === null ? '' : ('提示词全文：' + id)),
    promptTextFor: (st, id) => (o.promptText === null ? '' : ('提示词全文：' + id)),
    moduleMetaOf: (st, bid) => ((st && st.backendModules) || []).find((m) => String(m.id) === String(bid)) || null,
    promptLang: () => 'zh',
    onStatusSetupInit: () => '',
    createActionDispatcher: actions.createActionDispatcher,
    inject: (st, text) => { seen.injected.push(String(text)) },
    openUrl: () => {},
    host: { call: () => Promise.resolve({ ok: true }) },
    openFormModal: () => {},
    loadChain: () => {},
    loadSnapshot: () => {},
    flash: () => {},
    openStatusGate: () => {},
    log: (level, event, fields) => { seen.logged.push({ level: level, event: event, fields: fields }) },
    console: { log: function () {}, warn: function () {}, error: function () {} },
  }
  const names = Object.keys(sandbox)
  const factory = new Function(...names, body + '\n;return { guideBannerStep: guideBannerStep, runGuideMissing: runGuideMissing }')
  return { mod: factory(...names.map((n) => sandbox[n])), seen: seen, guide: guide }
}

// 全新目录的第一步：gh cli 没装（链上这一项 fail，链里带着后端解析出来的那句陈述句 hint）。
const ghMissing = (extra) => ({
  cwd: '/w/demo',
  selection: { backendId: 'github' },
  chainSnapshot: { steps: [{ id: 'gh:installed', status: 'fail', show: { hint: OLD_STATEMENT, desc: OLD_STATEMENT }, actions: [] }, Object.assign({ id: 'gh:authed', status: 'pending' }, extra && extra.authed ? extra.authed : {})] },
})

async function main() {
  const { mod, seen, guide } = await loadBannerChain()
  const ghStep = guide.GUIDE_STEPS.find((s) => s.id === 'gh:installed')
  ok(!!ghStep, '清单里有「gh cli 已安装」这一步')

  console.log('== 1. 清单里那句原话逐字等于维护者给的那一句 ==')
  ok(!!ghStep && ghStep.missing && ghStep.missing.type === 'inject', '这一步的 missing 是一次注入')
  ok(!!ghStep && ghStep.missing.text === ORIGINAL, '注入的就是那句原话（逐字比对，一个字不差）')

  console.log('== 2. 点那颗按钮：注入的是那句原话，不是链上那句陈述句 ==')
  const st = ghMissing()
  ok(mod.guideBannerStep(st, false).id === 'gh:installed', '缺 gh cli 时出的就是这一步的横幅')
  const out = mod.runGuideMissing(st, ghStep)
  ok(out === 'text', '归到「注入了一段文案」（实得 ' + out + '）')
  ok(seen.injected.length === 1, '恰好注入一次（实得 ' + seen.injected.length + ' 次）')
  ok(seen.injected[0] === ORIGINAL, '注入的正文逐字等于那句原话')
  ok(seen.injected[0].indexOf(OLD_STATEMENT) < 0, '没有把链上那句陈述句注入进去（旧写法注入的就是它）')
  ok(seen.injected[0].indexOf('winget') < 0 && seen.injected[0].indexOf('brew') < 0, '也没夹带那段按系统分平台的安装长文（那份说明已按新流程退役）')

  console.log('== 3. 日志：新立的那一条常驻事件，两个短枚举 ==')
  const logged = seen.logged.filter((l) => l.event === 'guide.inject')
  ok(logged.length === 1, '这一次点击恰好落一行（实得 ' + logged.length + ' 行）')
  ok(logged[0].level === 'info', '级别是信息（常驻那一类：默认落盘，不等调试开关）')
  ok(logged[0].fields.step === 'gh:installed' && logged[0].fields.outcome === 'text', '两个字段是「哪一步」与「给出去的是哪一类」')
  ok(Object.keys(logged[0].fields).length === 2, '字段就这两个，没有多记正文或路径')
  ok(!seen.logged.find((l) => l.event === 'inject.decision'), '没有沿用初始化那条漏斗的事件（那条记的是另一件事）')

  console.log('== 4. 只改这一颗：登录那条仍然注入后端声明的登录指引 ==')
  const stAuth = { cwd: '/w/demo', selection: { backendId: 'github' }, backendModules: [{ id: 'github', prompts: { ghAuthLogin: { zh: '请为本机完成 GitHub CLI 登录', en: 'Sign in' } } }], chainSnapshot: { steps: [{ id: 'gh:installed', status: 'done' }, { id: 'gh:authed', status: 'fail' }] } }
  const authStep = mod.guideBannerStep(stAuth, false)
  ok(!!authStep && authStep.id === 'gh:authed', '装了 gh、没登录 → 出的是登录那一步（实得 ' + (authStep && authStep.id) + '）')
  const outAuth = mod.runGuideMissing(stAuth, authStep)
  ok(outAuth === 'text' && seen.injected[seen.injected.length - 1] === '请为本机完成 GitHub CLI 登录', '登录那条注入的仍是后端声明的那一份（口径没被顺手改掉）')

  console.log('== 5. 没文案可注入时：什么都不注入，日志记成「没有文案可注入」==')
  // 这一个沙箱两处提示词都取不到（后端没声明、提示词表也空），于是「按前端解析一段文案」这条路会空手而归。
  const bare = await loadBannerChain({ promptText: null })
  const stBare = { cwd: '/w/demo', selection: { backendId: 'github' }, chainSnapshot: { steps: [{ id: 'gh:installed', status: 'done' }, { id: 'gh:authed', status: 'fail' }] } }
  const authBare = bare.guide.GUIDE_STEPS.find((s) => s.id === 'gh:authed')
  bare.seen.injected.length = 0
  const outNone = bare.mod.runGuideMissing(stBare, authBare)
  ok(outNone === 'none', '解析不出文案时归到「没有文案可注入」（实得 ' + outNone + '）')
  ok(bare.seen.injected.length === 0, '一个字的注入都没有')
  const lastLog = bare.seen.logged[bare.seen.logged.length - 1]
  ok(lastLog && lastLog.event === 'guide.inject' && lastLog.fields.step === 'gh:authed' && lastLog.fields.outcome === 'none', '日志把这一回记成 none，不是静默')

  console.log('== 6. 那句话只有一份：住在共享清单里，客户端源码不许再抄一份 ==')
  ok(read('src/shared/tracker/guide-steps.js').indexOf(ORIGINAL) >= 0, '原话住在共享清单里')
  const clientFiles = ['src/client/statusbar/StatusBar.js', 'src/client/statusbar/bannerChain.js', 'src/client/statusbar/checksums.js', 'src/client/views/ChecksTab.js']
  const copies = clientFiles.filter((f) => read(f).indexOf(ORIGINAL) >= 0)
  ok(copies.length === 0, '客户端源码里没有第二份字面量' + (copies.length ? '（多出：' + copies.join('、') + '）' : ''))
  ok(read('client.js').indexOf(ORIGINAL) >= 0, '客户端产物里带着它（随构建拼进闭包，界面读得到）')

  console.log(failed ? 'FAIL ' + total + ' 项检查里有 ' + failedN + ' 项未过' : 'PASS 全部 ' + total + ' 项检查通过')
  process.exit(failed ? 1 : 0)
}

main().catch(function (e) { console.error('RUNNER ERROR:', e); process.exit(1) })
