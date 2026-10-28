// verify-663-gh-install-inject.ts — #663 状态栏横幅链（后半）：装 gh cli 那一颗按钮注入的是维护者给的原话
// 背景：这颗按钮以前取的是链上这一项的 show.hint，而那句话在一次改写里被降成了一句陈述句
//   （「GitHub 助手（gh cli）还没安装，安装后即可继续。」），点一下等于什么都没给。按缺陷修。
// 做法：把 src/client/statusbar/bannerChain.js 取出来在沙箱里求值（顺序真源用真的 guide-steps.js），
//   喂假链快照与假后端声明，断言「注入的到底是哪一段字」与「日志记的是哪一类」。
// 用法: node --import ./scripts/ts-hook.mts tests/verify-663-gh-install-inject.ts
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')
const { compileFn } = require('./lib/eval-probe.js')
// 取源走共用入口：bannerChain 的真源已经是 .ts，要当函数体求值，所以用 spliceableJs
// （按构建同一套口径转译、已去掉每行行首的 export，原文里的类型标注不会被当成语法错误）。
const { spliceableJs } = require('./lib/source-text.ts')

const root = path.resolve(__dirname, '..')
let failed = false
let failedN = 0
let total = 0
const ok = (cond: unknown, msg: string) => { total++; if (cond) console.log('  PASS ' + msg); else { failed = true; failedN += 1; console.log('  FAIL ' + msg) } }
const read = (rel: string): string => fs.readFileSync(path.join(root, rel), 'utf8')

// 维护者 2026-09-19 给的那句原话（金样写在本门禁里：谁把那句改了，这里先红）。
// #716：这句话从共享清单 src/shared/tracker/guide-steps.js 挪回了 GitHub 后端声明（prompts.cliInstall）——
//   它是「怎么装 gh」，只跟 GitHub 有关，不该住在三个后端共用的清单里。清单那一步现在只留键名。
const ORIGINAL = '/wizard 帮用户安装gh cli 官方地址：https://cli.github.com/'
// 清单里那一步声明的提示词键名（注入哪段话由清单说了算，话本身在后端声明里）。
const INSTALL_PROMPT_KEY = 'cliInstall'
// 那句陈述句 —— 旧写法注入的就是它，新流程里一个字都不许再出现在注入路径上。
const OLD_STATEMENT = 'GitHub 助手（gh cli）还没安装，安装后即可继续。'

// 沙箱里的改写开关：只用 promptText 一处（两处提示词都取不到的那一档喂 null），其余形状照旧。
async function loadBannerChain(overrides?: { promptText?: string | null }): Promise<{ mod: any; seen: ChainSeen; guide: any }> {
  const o = overrides || {}
  const guide = await import(pathToFileURL(path.join(root, 'src/shared/tracker/guide-steps.js')).href)
  const actions = await import(pathToFileURL(path.join(root, 'src/client/kernel/actions.js')).href)
  const body = spliceableJs('src/client/statusbar/bannerChain.js')
  const seen: ChainSeen = { injected: [], logged: [] }
  const stepsOf = (st: any) => (st && st.chainSnapshot && Array.isArray(st.chainSnapshot.steps)) ? st.chainSnapshot.steps : []
  const sandbox = {
    guideStepsFor: guide.guideStepsFor,
    guideStepDone: guide.guideStepDone,
    currentBackendId: (st: any) => (st && st.selection && st.selection.backendId != null) ? st.selection.backendId : null,
    chainSteps: stepsOf,
    chainStep: (st: any, id: string) => stepsOf(st).find((x: any) => String(x.id) === String(id)) || null,
    checkShowTitle: (show: any, fallback: string) => String((show && (show.title || show.fallback || show.desc)) || fallback || ''),
    installSkillsParams: () => ({ probeList: 'wayfinder', probeCount: '1' }),
    promptText: (id: string) => (o.promptText === null ? '' : ('提示词全文：' + id)),
    promptTextFor: (st: any, id: string) => (o.promptText === null ? '' : ('提示词全文：' + id)),
    moduleMetaOf: (st: any, bid: string) => ((st && st.backendModules) || []).find((m: any) => String(m.id) === String(bid)) || null,
    promptLang: () => 'zh',
    onStatusSetupInit: () => '',
    createActionDispatcher: actions.createActionDispatcher,
    inject: (st: any, text: any) => { seen.injected.push(String(text)) },
    openUrl: () => {},
    host: { call: () => Promise.resolve({ ok: true }) },
    openFormModal: () => {},
    loadChain: () => {},
    loadSnapshot: () => {},
    flash: () => {},
    openStatusGate: () => {},
    log: (level: string, event: string, fields: Record<string, any>) => { seen.logged.push({ level: level, event: event, fields: fields }) },
    console: { log: function () {}, warn: function () {}, error: function () {} },
  }
  const names = Object.keys(sandbox)
  // 本文件选 compileFn：那批依赖名是当场从沙箱对象上取出来的，正好对应「展开成参数表」那种写法，
  //   被造的代码只看这些参数（切出来的 bannerChain 源码读不到本文件作用域），语义一一对应。
  const factory = compileFn(names, body + '\n;return { guideBannerStep: guideBannerStep, runGuideMissing: runGuideMissing }')
  return { mod: factory(...names.map((n) => (sandbox as Record<string, any>)[n])), seen: seen, guide: guide }
}

// 沙箱记账：只记注入与日志两本账，组顺序（1→7）不许重排，重排会改计数。
interface ChainSeen {
  injected: string[]
  logged: Array<{ level: string; event: string; fields: Record<string, any> }>
}

// 全新目录的第一步：gh cli 没装（链上这一项 fail，链里带着后端解析出来的那句陈述句 hint）。
const ghMissing = (extra?: { authed?: Record<string, unknown> }): any => ({
  cwd: '/w/demo',
  selection: { backendId: 'github' },
  chainSnapshot: { steps: [{ id: 'gh:installed', status: 'fail', show: { hint: OLD_STATEMENT, desc: OLD_STATEMENT }, actions: [] }, Object.assign({ id: 'gh:authed', status: 'pending' }, extra && extra.authed ? extra.authed : {})] },
})

async function main() {
  const { mod, seen, guide } = await loadBannerChain()
  const ghMod = await import(pathToFileURL(path.join(root, 'src/tracker/rooms/github/index.ts')).href)
  const ghPrompts = ghMod.prompts
  const ghStep = guide.GUIDE_STEPS.find((s: any) => s.id === 'gh:installed')
  ok(!!ghStep, '清单里有「gh cli 已安装」这一步')

  console.log('== 1. 清单只说注哪条提示词，那句话在后端声明里逐字等于维护者给的那一句 ==')
  ok(!!ghStep && ghStep.missing && ghStep.missing.type === 'inject', '这一步的 missing 是一次注入')
  ok(!!ghStep && ghStep.missing.prompt === INSTALL_PROMPT_KEY, '清单这一步指向的提示词键是 ' + INSTALL_PROMPT_KEY + '（清单不再自带那段话）')
  ok(!!ghPrompts && !!ghPrompts[INSTALL_PROMPT_KEY] && ghPrompts[INSTALL_PROMPT_KEY].zh === ORIGINAL, '后端声明里那句原话逐字等于维护者给的那一句（一个字不差）')

  console.log('== 2. 点那颗按钮：注入的是那句原话，不是链上那句陈述句 ==')
  const st = ghMissing()
  st.backendModules = [{ id: 'github', prompts: ghPrompts }]
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
  // #1190：登录这一步按通用键 cliLogin 注入（后端声明里 cliLogin 与 ghAuthLogin 同文，旧键保留做回退）。
  const stAuth = { cwd: '/w/demo', selection: { backendId: 'github' }, backendModules: [{ id: 'github', prompts: { cliLogin: { zh: '请为本机完成 GitHub CLI 登录', en: 'Sign in' } } }], chainSnapshot: { steps: [{ id: 'gh:installed', status: 'done' }, { id: 'gh:authed', status: 'fail' }] } }
  const authStep = mod.guideBannerStep(stAuth, false)
  ok(!!authStep && authStep.id === 'gh:authed', '装了 gh、没登录 → 出的是登录那一步（实得 ' + (authStep && authStep.id) + '）')
  const outAuth = mod.runGuideMissing(stAuth, authStep)
  ok(outAuth === 'text' && seen.injected[seen.injected.length - 1] === '请为本机完成 GitHub CLI 登录', '登录那条注入的仍是后端声明的那一份（口径没被顺手改掉）')

  console.log('== 5. 没文案可注入时：什么都不注入，日志记成「没有文案可注入」==')
  // 这一个沙箱两处提示词都取不到（后端没声明、提示词表也空），于是「按前端解析一段文案」这条路会空手而归。
  const bare = await loadBannerChain({ promptText: null })
  const stBare = { cwd: '/w/demo', selection: { backendId: 'github' }, chainSnapshot: { steps: [{ id: 'gh:installed', status: 'done' }, { id: 'gh:authed', status: 'fail' }] } }
  const authBare = bare.guide.GUIDE_STEPS.find((s: any) => s.id === 'gh:authed')
  bare.seen.injected.length = 0
  const outNone = bare.mod.runGuideMissing(stBare, authBare)
  ok(outNone === 'none', '解析不出文案时归到「没有文案可注入」（实得 ' + outNone + '）')
  ok(bare.seen.injected.length === 0, '一个字的注入都没有')
  const lastLog = bare.seen.logged[bare.seen.logged.length - 1]
  ok(lastLog && lastLog.event === 'guide.inject' && lastLog.fields.step === 'gh:authed' && lastLog.fields.outcome === 'none', '日志把这一回记成 none，不是静默')

  console.log('== 6. 那句话只有一份：界面从后端声明要文本，产物里带着那个键名 ==')
  // 【已删除】原先这里读 GitHub 后端声明的源码文本、扫五个客户端源码文件里有没有第二份字面量，
  //   以及断言后端声明里不再出现 noGhPrompt:（第 7 组末尾那条）。断言对象都是手写源码的文本，
  //   改个写法、挪个位置、换个引号就变红，整段撤掉；「那句话只有一份」由第 1、2、7 组的运行结果守着。
  // 产物引号口径：手写源码里的单引号经 esbuild 进产物统一变双引号（slots 门禁 :271 同款），
  // 判的是「键名在产物里」不是「引号形状」，两种都认。
  const clientSrc = read('client.js')
  ok(clientSrc.indexOf("'" + INSTALL_PROMPT_KEY + "'") >= 0 || clientSrc.indexOf('"' + INSTALL_PROMPT_KEY + '"') >= 0, '客户端产物里带着那个提示词键名（界面据此向后端声明要文本，界面读得到）')

  console.log('== 7. 检查页那一行的按钮也注入同一句原话（#664 补：同一个缺失状态只有一份说明）==')
  // 状态栏那条横幅与检查页那一行的按钮是两个落点，注入的必须是同一句话；先说那一行给的是什么。
  const fixMod = await import(pathToFileURL(path.join(root, 'src/tracker/fix-contract.ts')).href)
  const rowItems = fixMod.attachFixContract(ghMod.GITHUB_CHECKS, ghMod.githubModule, 'zh', { cwd: '/w/demo' })
  const ghInstallRow = rowItems.find((x: any) => x && x.id === 'gh:installed')
  const installAction = (ghInstallRow && ghInstallRow.onFail && Array.isArray(ghInstallRow.onFail.actions))
    ? ghInstallRow.onFail.actions.find((a: any) => a && a.type === 'inject-prompt') : null
  // 这一行给出去的要么是那句原话本身（fixContract 把键解析成文本），要么是那条键名（界面再向后端声明要文本）；
  // 两种都算「两边同一份说明」，但都不许是别的东西。
  const installGiven = installAction ? String(installAction.prompt) : ''
  ok(installGiven === ORIGINAL || installGiven === INSTALL_PROMPT_KEY, '检查页 gh:installed 那一行的按钮指向的仍是同一份说明（实得「' + installGiven.slice(0, 60) + '」）')
  ok(!!installAction && String(installAction.prompt).indexOf('winget') < 0 && String(installAction.prompt).indexOf('brew') < 0, '不是那段按系统分平台的安装长文')

  console.log(failed ? 'FAIL ' + total + ' 项检查里有 ' + failedN + ' 项未过' : 'PASS 全部 ' + total + ' 项检查通过')
  process.exit(failed ? 1 : 0)
}

main().catch(function (e: any) { console.error('RUNNER ERROR:', e); process.exit(1) })
