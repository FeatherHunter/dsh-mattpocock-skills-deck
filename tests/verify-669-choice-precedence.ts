#!/usr/bin/env node
/**
 * verify-669-choice-precedence.js —— 「用户的手动选择 > 锚文件 > 自动识别」那条裁决的门禁（#669 第 6 件 / ADR 20260921）
 *
 * 起因（真机现场）：面板里把后端从 GitHub 切到 Markdown，提示条说切了、弹窗也关了，**仓库标仍是 GitHub**。
 *   查明是判定链的顺序问题：宿主组装快照/链时先问锚文件 `docs/agents/issue-tracker.md`（写着 GitHub），
 *   用户那一下根本轮不到；客户端再把快照给的结论合并回来，把用户的选择盖掉并写进本地缓存。
 *
 * 断五组：
 *   A 行为层（宿主）：真调 detectionService —— 上报的选择一律忽略，锚文件照旧说话；
 *     没有锚文件也没有工作区文件时如实未知（不猜）；未注册的后端 id 忽略（诚实）。每条都配反证。
 *   B 行为层（客户端）：真求值 store-prefs.js 的 userHintOf 与 store-snapshot.js 的 mergeSelection ——
 *     只有带 userPicked 标记的选择才当 hint 上报；宿主回同一条时标记留住，回不同后端时标记消失。
 *   C 行为层（切换之后按场景分流）：真求值 store-switch.js 的 confirmSwitchConfirm，配真 guide-steps ——
 *     已初始化 → 注入 switchAlign（点名 /setup-matt-pocock-skills，带 from/to）；未初始化且仓库就绪 →
 *     走决策器（允许开布局小卡）+ 未初始化那句提示条；未初始化且仓库没就绪 → 一个字都不注入。
 *   D 静态层（已整段删除）：原先读弹窗、词表、后端名单、提示词注册表、面板与状态栏那几个文件的源码文本，
 *     断言「哪颗按钮没了」「谁进了置灰名单」「中英词条成对」。这类断言会因为等价重构而变红，所以拆掉了；
 *     能跑起来的那部分仍在 A、B、C 三组（真调 detectionService、真求值那几个纯函数）与 E 组的反证里。
 *   E 反证：把 A、C 两组的实现各自做坏一次，对应的断言必须当场变红。
 *
 * 用法：node tests/verify-669-choice-precedence.ts
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
// 按文本求值走共用入口，理由与用法见 tests/lib/eval-probe.js 文件头。
import { compileFn, evalWithScope } from './lib/eval-probe.js'
// 取源走共用入口（#1207 立）：spliceableJs 给「可以直接当函数体求值」的 JavaScript 文本
// （.ts 会先按构建那份口径转译，引号与换行会被重排）。本文件只求值、不按文本形状扫源码。
import { spliceableJs } from './lib/source-text.ts'
// 中央时间真值：切换确认的收起延时只住 config/*.yaml，这里读同一份导出来预埋，不在测试里写第二份数字。
import { STORE_SWITCH_CONFIRM_MS } from '../src/shared/time-config/values.js'
(globalThis as unknown as Record<string, unknown>).STORE_SWITCH_CONFIRM_MS = STORE_SWITCH_CONFIRM_MS

const ROOT = path.resolve(import.meta.dirname, '..')
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const url = (rel: string): string => pathToFileURL(path.join(ROOT, rel)).href
let passed = 0
let failed = 0
const check = (ok: unknown, msg: string): void => { if (ok) { console.log('  PASS ' + msg); passed++ } else { console.log('  FAIL ' + msg); failed++ } }
const stripExports = (s: string): string => s.replace(/^[ \t]*export[ \t]+/gm, '')
// 中央 import 在 compileFn 函数体里非法，求值前整行剥掉（闭包里它由时间片段提供，门禁里走上面的全局预埋）。
const stripTimeConfigImport = (s: string): string => s.split('\n').filter((l) => !/^\s*import\s.*time-config\/values\.js/.test(l)).join('\n')
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

// #1251：userHintOf / keepUserPick 取出来要当场求值（vm 只吃纯 JS）——
//   走 spliceableJs（与构建同一口径，先转译去类型）；esbuild 会把单行函数拆成多行，
//   所以按「整段函数体」取（锚行首收尾），不再按行掐。
const prefsSrc = spliceableJs('src/client/kernel/store-prefs.js')
// #1251：这三个函数在真源里是多行（转写还展开了单行块），旧正则在产物上对不上
//   （esbuild 去空格、去多余括号、双引号）；改走 spliceableJs（与构建同一口径），锚行首收尾。
const snapSrc = spliceableJs('src/client/kernel/store-snapshot.js')
const switchSrc = read('src/client/kernel/store-switch.js')
// 【已删除】原先这里还读两份源码文本 —— src/client/views/shared/SwitchConfirmModal.js 与
//   src/client/kernel/locale-word.js，两份都只服务于上面整段删掉的 D 静态层，一并去掉。
//   下面那份 prompts 留着：C 组要把切换那条路真跑起来，用的是它里面两个真身函数。
//   这份文本要当函数体求值，所以走 spliceableJs（.ts 会先按构建那份口径转译；原样读会带着类型标注，求值当场语法错）。
const promptsSrc = spliceableJs('src/client/kernel/prompts.js')

// ── A 组：宿主判定链（真 detectionService + 真注册表 + 真锚文件读）────────────────────────
const tmpDirs: string[] = []
const makeWorkspace = function (anchorText: string | null): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-choice-'))
  tmpDirs.push(dir)
  if (anchorText) {
    fs.mkdirSync(path.join(dir, 'docs', 'agents'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'docs', 'agents', 'issue-tracker.md'), anchorText, 'utf8')
  }
  return dir
}
const makeDetection = async function () {
  const { createRegistry } = await import(url('src/tracker/registry/core.ts'))
  const real = await import(url('src/tracker/detection/detectionService.ts'))
  const registry = createRegistry(undefined, { matchesTimeout: 500 })
  const mk = (id: string, matches?: () => Promise<boolean>) => ({ id, label: id, create: () => ({ ok: true }), matches: matches || (async () => false), describe: () => ({ backend: id, refId: id + '-ref', name: id + '-ref', url: '' }) })
  registry.register(mk('github', async () => false))
  registry.register(mk('markdown', async () => false))
  registry.register(mk('gitlab', async () => false))
  const platform = {
    fs: {
      resolve: async (rel: string, opts: any) => path.resolve((opts && opts.cwd) || '.', rel),
      readText: async (p: string) => fs.readFileSync(p, 'utf8'),
      lstat: async (p: string) => { try { return fs.lstatSync(p) } catch (e) { throw e } },
      stat: async (p: string) => { try { return fs.statSync(p) } catch (e) { throw e } },
      readdir: async (p: string) => fs.readdirSync(p),
    },
    path: path,
  }
  // #1169：这里原来会把「改坏的那一份源码」剥掉 import 后当场求值（反证用）。裁决顺序抽到
  //   src/tracker/detection/selection-precedence.ts 之后这一套不再需要 —— 反证改成直接问那条规则
  //   （见下面 E 组），探测服务本身只跑真源；也正因如此，它现在可以正常写类型标注。
  const svc = real.createDetectionService({ registry, getPlatform: async () => platform, getFs: () => platform.fs, getTimers: () => null, workspaceStore: null, exec: null })
  return svc
}

console.log('== A 行为层（宿主）：上报即忽略，锚照旧说话；无锚无文件 → 如实未知 ==')
{
  const ws = makeWorkspace('# Issue tracker: GitHub\n')
  const svc = await makeDetection()
  const withHint = await svc.detect({ cwd: ws }, { skipSkillProbes: true, hintBackendId: 'markdown' })
  const noHint = await svc.detect({ cwd: ws }, { skipSkillProbes: true })
  check(withHint.selection && withHint.selection.backendId === 'github', '上报的选择不再压过锚文件（老路径已删，唯一真源是文件与锚），判定结果是锚文件的 github —— 实得「' + (withHint.selection && withHint.selection.backendId) + '」')
  check(noHint.selection && noHint.selection.backendId === 'github', '不带用户选择时，锚文件照旧说话（markdown → github 的锚）—— 实得「' + (noHint.selection && noHint.selection.backendId) + '」')
  check(!!withHint.explicit && !!withHint.explicit.raw, '带用户选择的那一次**也照旧读了锚文件**（结果里的 explicit 一栏不空，界面与排查要用）')
  const badHint = await svc.detect({ cwd: ws }, { skipSkillProbes: true, hintBackendId: 'not-a-backend' })
  check(badHint.selection && badHint.selection.backendId === 'github', '未注册的后端 id 被忽略（诚实）→ 落回锚文件 —— 实得「' + (badHint.selection && badHint.selection.backendId) + '」')
  // 锚文件不存在、工作区文件也不存在：光靠上报不再变出选择（用户点确认走写入口落文件，文件赢的那条见单出口 S2）
  const ws2 = makeWorkspace(null)
  const svc2 = await makeDetection()
  const fresh = await svc2.detect({ cwd: ws2 }, { skipSkillProbes: true, hintBackendId: 'github' })
  check(!(fresh.selection && fresh.selection.backendId), '没有锚文件的工作区里，光靠上报不再产生选择（如实未知，不猜）—— 实得「' + (fresh.selection && fresh.selection.backendId) + '」')
}

// ── B 组：客户端不再上报 hint（#1003 退役镜像与修订号仲裁，宿主直接读文件） ──────────
console.log('')
console.log('== B 行为层（客户端）：不上报 hint；合并照宿主回包来 ==')
{
  const hintLine = (prefsSrc.match(/const userHintOf = function[\s\S]*?\n\}/) || [''])[0]
  check(!!hintLine, '取到 store-prefs.js 里的 userHintOf（真身）')
  // 这里选 evalWithScope：取出来的就是那个函数表达式本身，它不引用本文件任何变量，所以作用域显式传空对象。
  const userHintOf = evalWithScope(hintLine.trim().replace(/^const userHintOf = /, ''), {})
  check(userHintOf({ backendId: 'markdown', userPicked: true }) === undefined, '亲手选的也不当 hint 上报（宿主读文件，不靠上报）')
  check(userHintOf({ backendId: 'markdown' }) === undefined, '派生出来的不上报')
  check(userHintOf({ backendId: null, userPicked: true }) === undefined, '没有后端 id 时不上报（诚实）')
  check(userHintOf(null) === undefined, '空选择不上报')
  const keepLine = (prefsSrc.match(/const keepUserPick = function[\s\S]*?\n\}/) || [''])[0]
  check(!!keepLine, '取到 store-prefs.js 里的 keepUserPick（真身）')
  // 这里选 evalWithScope：同上（函数表达式自带全部依赖，作用域传空）。
  const keepUserPick = evalWithScope(keepLine.trim().replace(/^const keepUserPick = /, ''), {})
  // 合并：宿主回什么就用什么，不再留标记
  const mergeSrc = snapSrc.match(/const mergeSelection = function\(st, incoming\) \{[\s\S]*?\n\}/)![0]
  const makeMerge = function () {
    const cache: any[] = []
    // 这里选 evalWithScope：原来这五个名字靠参数注入，现在在作用域里逐个写明，函数体一个字不动。
    const fn = evalWithScope(mergeSrc.replace(/^const mergeSelection = /, ''), {
      log: () => {}, dswsLogHash: () => 'h', dswsLogTrunc: (s: unknown) => s, setCachedSelection: (cwd: unknown, sel: unknown) => cache.push(sel), keepUserPick,
    })
    return { fn, cache }
  }
  const a = makeMerge()
  const stA = { cwd: 'D:\\x', selection: { backendId: 'markdown', source: 'explicit' } }
  a.fn(stA, { backendId: 'markdown', source: 'explicit' })
  check(stA.selection.backendId === 'markdown', '宿主回的同一条照用（无标记可留）')
  const b = makeMerge()
  const stB = { cwd: 'D:\\x', selection: { backendId: 'markdown', source: 'explicit' } }
  b.fn(stB, { backendId: 'gitlab', source: 'explicit' })
  check(stB.selection.backendId === 'gitlab', '宿主回的是别的后端 → 照宿主的来（谁改了文件谁是真相）')
}

// ── B2 水合：缓存里那份旧快照不许抹掉用户刚点的那一下（#1003 用 pickedAt 时刻判，不用标记）──
console.log('')
console.log('== B2 行为层（水合）：hydrateFromCache 不许把刚点的选择覆盖回旧后端 ==')
{
  const hydrateSrc = snapSrc.match(/const hydrateFromCache = function\(st\) \{[\s\S]*?\n\}/)![0]
  const keepLine = (prefsSrc.match(/const keepUserPick = function[\s\S]*?\n\}/) || [''])[0]
  const mergeSrc2 = snapSrc.match(/const mergeSelection = function\(st, incoming\) \{[\s\S]*?\n\}/)![0]
  const justSrc = snapSrc.match(/const justPicked = function\(st, c\) \{[\s\S]*?\n\}/)![0]
  const mkHydrate = function (patched: string[] | null) {
    const writes: any[] = []
    // 这里选 evalWithScope：函数表达式自带全部依赖，作用域传空。
    const keepUserPick = evalWithScope(keepLine.trim().replace(/^const keepUserPick = /, ''), {})
    // 这里选 evalWithScope：五个依赖名原来靠参数注入，现在写进作用域，函数体不动。
    const mergeSelection = evalWithScope(mergeSrc2.replace(/^const mergeSelection = /, ''), {
      log: () => {}, dswsLogHash: () => 'h', dswsLogTrunc: (s: unknown) => s, setCachedSelection: (cwd: unknown, sel: unknown) => writes.push(sel), keepUserPick,
    })
    const justPicked = justSrc ? evalWithScope(justSrc.replace(/^const justPicked = /, ''), {}) : (() => false)
    const deps: Record<string, any> = {
      getCachedSnapshot: () => ({ generatedMs: 100, id: '缓存里那份切换前的快照', selection: { backendId: 'github', source: 'explicit' }, repository: { backend: 'github', name: 'r' } }),
      rememberWorkspaceRoot: () => {}, wsKeyOf: (p: unknown) => String(p || ''), snapshotByCwd: new Map(), touchLRUClient: () => {},
      mergeSelection, setCachedRepository: () => {}, setPresentationMap: () => {}, getCachedSelection: () => null,
      getCachedRepository: () => null, getCachedChain: () => null, promptLang: () => 'zh', nowStr: () => '', log: () => {}, dswsLogHash: () => 'h',
      justPicked, setCachedSelection: (cwd: unknown, sel: unknown) => writes.push(sel),
    }
    const names = Object.keys(deps)
    const body = (patched ? hydrateSrc.replace(patched[0], patched[1]) : hydrateSrc).replace(/^const hydrateFromCache = /, 'return ')
    // 这里选 compileFn：依赖名是运行时拼出来的数组，共用入口同样接数组，调用时逐个按原顺序传。
    const fn = compileFn(names, body)(...names.map((n) => deps[n]))
    return { fn, writes }
  }
  const now = Date.now()
  const pick = () => ({ cwd: 'D:\\x', selection: { backendId: 'markdown', source: 'explicit', pickedAt: now }, snapshot: { id: '面板上正显示的那一份', generatedMs: 100 } })
  const good = mkHydrate(null)
  const stG = pick()
  good.fn(stG)
  check(stG.selection.backendId === 'markdown', '水合之后刚点的那一下还在（旧缓存 github 没盖回来）—— 实得 ' + JSON.stringify(stG.selection))
  const noPick = mkHydrate(null)
  const stN = { cwd: 'D:\\x', selection: null, snapshot: null }
  noPick.fn(stN)
  check(stN.selection && stN.selection.backendId === 'github', '没点过时旧快照照旧水合进来（正常秒显不受影响）—— 实得 ' + JSON.stringify(stN.selection))
  const broken = mkHydrate(['!justPicked(st, c)', 'true'])
  const stB2 = pick()
  broken.fn(stB2)
  check(stB2.selection.backendId === 'github', '反证 B2 成立：把这道守卫摘掉之后，同一份现场当场退回 github —— 实得 ' + JSON.stringify(stB2.selection))
}

// ── C 组：切换之后按场景分流（真 store-switch + 真 guide-steps）──────────────────────────
console.log('')
console.log('== C 行为层（切换之后）：已初始化注入 switchAlign；未初始化且就绪走决策器；没就绪一个字不注入 ==')
const GUIDE = await import(url('src/shared/tracker/guide-steps.js'))
const CHAIN_INITIALIZED = [{ id: 'gh:remote', status: 'done' }, { id: 'tracker:initialized', status: 'done' }]
const CHAIN_NOT_INIT_READY = [{ id: 'gh:remote', status: 'done' }, { id: 'tracker:initialized', status: 'current' }]
// 「仓库那一步没过」的现场：注意判据看的是**目标后端**那份清单 —— 切到本地 Markdown 时清单里没有仓库那一步，
//   所以那种切换不算「没就绪」（本地初始化不需要远端仓库）；切到 GitHub 而远端还没建好，才是这一档。
const CHAIN_REPO_NOT_DONE = [{ id: 'gh:installed', status: 'done' }, { id: 'gh:authed', status: 'done' }, { id: 'gh:remote', status: 'current' }, { id: 'tracker:initialized', status: 'pending' }]
const makeSwitch = function (srcText: string) {
  const seen: Record<string, any> = { inject: [], decision: [], flash: [], snap: [], chain: [], bind: [] }
  // 「仓库那一步过没过」这条判据住在 prompts.ts 里（setupBlockedByGuide），本门禁取它的真身来判，
  //   不去自己抄第二份 —— 否则门禁验证的就不是「切换那条路真的用了同一个判据」了。
  //
  // 两条正则都写成「函数名 + 形状宽松的参数表」：这里匹配的是走共用入口转译后的 JavaScript，
  //   排版由转译器决定（`function(st, backendId)` 这种括号前无空格的写法就是它给的），
  //   照着手写源码的排版去钉（`function \(st\)`）会一条都匹配不到，报的还是看不懂的 null 错。
  //   行首锚定没丢：源里这两个函数就写在左边顶格处。
  const chainStepsSrc = promptsSrc.match(/^const setupChainSteps = function[ \t]*\([^)]*\) \{[\s\S]*?\n\};/m)![0]
  const blockedSrc = promptsSrc.match(/^const setupBlockedByGuide = function[ \t]*\([^)]*\) \{[\s\S]*?\n\};/m)![0]
  const chainStepsImpl = (st: any) => (st && st.chainSnapshot && st.chainSnapshot.steps) || []
  // 抠出来的两条都带着结尾那个分号（转译后的写法是 `};`），而 evalWithScope 要的是「函数体」，
  //   所以剥的时候连分号一起剥；留一个裸分号进去，报的是 `eval-probe.ts:11 SyntaxError: Unexpected token ';'`。
  // 这里选 evalWithScope：这段源码要调 chainSteps，原来靠参数注入，现在在作用域里显式给出来。
  const setupChainSteps = evalWithScope(chainStepsSrc.replace(/^const setupChainSteps = /, '').replace(/;\s*$/, ''), { chainSteps: chainStepsImpl })
  // 这里选 evalWithScope：这段源码引用的三个名字（真 guide-steps 两件加上面那件）在作用域里逐个写明。
  const setupBlockedByGuide = evalWithScope(blockedSrc.replace(/^const setupBlockedByGuide = /, '').replace(/;\s*$/, ''), { guideStepsFor: GUIDE.guideStepsFor, guideStepDone: GUIDE.guideStepDone, setupChainSteps: setupChainSteps })
  const sandbox: Record<string, any> = {
    host: { call: (m: string, p: unknown) => { if (m === 'wf.bind') seen.bind.push(p); return Promise.resolve({ ok: true }) } },
    // 注意：labelOf / openSwitchConfirm / closeSwitchConfirm 这些**本文件自己声明**，不能当参数传进来（会重名）
    builtinLabelOf: (id: unknown) => String(id),
    firstBackendIdOf: () => 'github',
    otherFiltered: (l: unknown) => (Array.isArray(l) ? l : []),
    tr: (k: unknown, params: unknown) => { let s = String(k); if (params) s = s + JSON.stringify(params); return s },
    flash: (st: unknown, msg: unknown, kind: unknown) => seen.flash.push({ msg: String(msg), kind: kind || '' }),
    inject: (st: unknown, text: unknown) => seen.inject.push(String(text)),
    // 决策器按真判据回话（真身是 kernel/prompts-setup.js 的 injectSetupDecision）：
    //   仓库那一步没过 → 'blocked'；否则这一档先开布局小卡 —— 开卡只有一个返回值 'askLayout'
    //   （#698 起黄条那条路与切换那条路开的是同一张卡，不再分两个名字）。
    //   这一门顺手把传进来的选项记下来，好断言「切换这条路上也传了 askLayout:true」。
    injectSetupDecision: (st: unknown, id: unknown, opts: any) => {
      seen.decision.push({ id: id, allowCard: !!(opts && opts.allowCard), askLayout: !!(opts && opts.askLayout), source: String((opts && opts.source) || '') })
      if (setupBlockedByGuide(st, id)) return 'blocked'
      return 'askLayout'
    },
    // #698：切换那条路的两条收尾轨迹住在内核（statusbar/ 目录里不许新开日志点），这里顶上真身同形的替身
    logSwitchSettle: (what: unknown, st: unknown) => seen.log.push({ level: 'debug', event: 'inject.decision', fields: { prompt: 'switchSettle', kind: String(what || ''), layout: String((st && (st as any).setupLayout) || 'unset') } }),
    promptText: (id: unknown, params: any) => (id === 'switchAlign' ? 'ALIGN|' + String((params && params.from) || '') + '->' + String((params && params.to) || '') : ''),
    switchAlignPrompt: (st: unknown, targetId: unknown, from: unknown, to: unknown, layout: unknown) => 'ALIGN|' + String(from || '') + '->' + String(to || ''),
    chainSteps: chainStepsImpl,
    guideStepsFor: GUIDE.guideStepsFor,
    guideStepDone: GUIDE.guideStepDone,
    emit: () => {}, setCachedSelection: () => {}, log: () => {}, dswsLogHash: () => 'h', dswsLogTrunc: (s: unknown) => s,
    loadSnapshot: () => seen.snap.push(1), loadChain: () => seen.chain.push(1),
    setTimeout, clearTimeout, console: { log () {}, warn () {}, error () {} },
    // #698：这两样在真身里由 prompts.js / StatusBackend.js 同闭包提供（布局的取值与「是哪几条」）
    readSetupLayout: () => 'multi',
    SETUP_LAYOUT_DEFAULT: 'single',
    SETUP_LAYOUT_VALUES: ['single', 'multi'],
  }
  const names = Object.keys(sandbox)
  const body = stripExports(stripTimeConfigImport(srcText)) + '\n;return { confirmSwitchConfirm: confirmSwitchConfirm, openSwitchConfirm: openSwitchConfirm }'
  // 这里选 compileFn：沙箱依赖名是运行时拼出来的数组，共用入口同样接数组，桩逐个按原顺序传进去。
  const mod = compileFn(names, body)(...names.map((n) => sandbox[n]))
  return { mod, seen }
}
const runSwitchScenario = async function (srcText: string, steps: any, from?: string, to?: string) {
  const s = makeSwitch(srcText)
  const fromId = from || 'github'
  const toId = to || 'markdown'
  const st: Record<string, any> = { cwd: 'D:\\w', selection: { backendId: fromId, source: 'explicit', userPicked: true }, repository: null, snapshot: null, setupLayout: 'multi', chainSnapshot: { steps: steps }, switchConfirm: { open: true, curBackendId: fromId, targetBackendId: toId, option: 'keep', criChecks: null, criLoading: false, clearInput: '', confirming: false } }
  s.mod.confirmSwitchConfirm(st)
  await sleep(20)
  // #698：卡开出来之前那几样要记在会话上的东西，从同一份 st 上读回来（settleSwitchCard 收尾时读的就是它们）
  s.seen.cardRec = { layoutFrom: st.switchCardLayoutFrom, alignDone: st.switchAlignDone, from: st.switchCardFrom, to: st.switchCardTo }
  return s.seen
}
{
  const initialized = await runSwitchScenario(switchSrc, CHAIN_INITIALIZED)
  const notInitReady = await runSwitchScenario(switchSrc, CHAIN_NOT_INIT_READY)
  // 「没就绪」这一档：从 Markdown 切回 GitHub，而远端仓库那一步还没过
  const notReady = await runSwitchScenario(switchSrc, CHAIN_REPO_NOT_DONE, 'markdown', 'github')
  // 对照：同一个「仓库没过」的现场，但切去的目标是本地 Markdown（它那份清单里没有仓库那一步）→ 照样算就绪
  const toMarkdown = await runSwitchScenario(switchSrc, CHAIN_REPO_NOT_DONE, 'github', 'markdown')
  // #698（2026-09-22 维护者真机拍板）：切换这条路**每次都先问一次域文档布局**（与黄条同一套风格）。
  //   所以「已初始化」这一档不再当场注入 switchAlign，而是先开那张卡；卡答完由 StatusBackend.js 的
  //   settleSwitchCard 收尾（下面 C2 那一组拿真源单独量它）。这一组只量切换这一侧给了什么。
  check(initialized.decision.length === 1 && initialized.decision[0].allowCard === true, '已初始化：先开布局小卡（不再当场注入）—— 实得 ' + JSON.stringify(initialized.decision))
  check(initialized.decision.length === 1 && initialized.decision[0].askLayout === true, '已初始化：这张卡是「每次都问」（askLayout:true），布局答过也照问 —— #674 的「答过就不问」到此为止')
  check(initialized.decision.length === 1 && initialized.decision[0].source === 'switch', '已初始化：告诉决策器这一问由切换那条路收尾（source:switch）')
  check(initialized.inject.length === 0, '已初始化：这一刻自己一个字都不注入（等用户答完卡再给）')
  check(/bindOkAskLayout/.test(initialized.flash.map((f: any) => f.msg).join('|')), '已初始化：提示条改说「请先回答下面那一问」—— 实得 ' + JSON.stringify(initialized.flash.map((f: any) => f.msg)))
  // 收尾要用的那几样东西，切换这一侧必须在自己身上备好（卡的确认函数读的就是它们）
  check(initialized.cardRec && initialized.cardRec.layoutFrom === 'multi', '已初始化：开卡前把「这次改之前是哪个布局」记了下来（下面 settle 那一组要靠它判「改没改」）—— 实得 ' + JSON.stringify(initialized.cardRec))
  check(initialized.cardRec && initialized.cardRec.alignDone === false, '已初始化：开卡前把「后端对齐这条还没给过」记了下来')
  check(notInitReady.decision.length === 1 && notInitReady.decision[0].allowCard === true, '未初始化 + 仓库就绪：走决策器且允许开那张布局小卡 —— 实得 ' + JSON.stringify(notInitReady.decision))
  check(notInitReady.decision.length === 1 && notInitReady.decision[0].askLayout === true && notInitReady.decision[0].source === 'switch', '未初始化这一档与「已初始化」那一档走**同一份判据**（askLayout:true + source:switch），两边都是每次都问')
  check(notInitReady.inject.length === 0, '未初始化：这一支自己**不**注入长文（注入交给决策器 + 小卡那条路）')
  check(/bindOkAskLayout/.test(notInitReady.flash.map((f: any) => f.msg).join('|')), '未初始化 + 就绪：提示条说的是「请先回答下面那一问」—— 实得 ' + JSON.stringify(notInitReady.flash.map((f: any) => f.msg)))
  check(notReady.decision.length === 1 && notReady.inject.length === 0, '未初始化 + 目标后端那份清单里的仓库那一步没过（Markdown → GitHub）：仍交给决策器判（判据只有它那一份），自己一个字都不注入 —— 实得 decision=' + notReady.decision.length + ' inject=' + notReady.inject.length)
  check(notReady.flash.filter((f: any) => /bindOkNotReady/.test(f.msg) && f.kind === 'warn').length === 1, '未初始化 + 没就绪：提示条说的是「先按状态栏那条提示处理」且按警示色 —— 实得 ' + JSON.stringify(notReady.flash))
  check(/bindOkAskLayout/.test(toMarkdown.flash.map((f: any) => f.msg).join('|')), '同一个现场切去本地 Markdown：仓库那一步不在 Markdown 的清单里 → 决策器判它没被挡住，提示条是「请先回答下面那一问」那句 —— 实得 ' + JSON.stringify(toMarkdown.flash.map((f: any) => f.msg)))
  check(initialized.bind.length === 1 && notInitReady.bind.length === 1 && notReady.bind.length === 1, '三种场景都照旧打了那通绑定电话（wf.bind）')
  check(initialized.snap.length === 1 && initialized.chain.length === 1, '三种场景都照旧重取快照与链')
  // 链快照还没到（链里连「初始化过没有」这一步都拿不到）：不许猜 —— 一个字不注入，提示条指向状态栏
  const noChain = await runSwitchScenario(switchSrc, null, 'github', 'markdown')
  check(noChain.inject.length === 0 && noChain.decision.length === 0 && /bindOkNotReady/.test(noChain.flash.map((f: any) => f.msg).join('|')), '链还没到时：不注入、不开卡、不猜（不会把初始化全文注进已经初始化过的仓库），提示条指向状态栏 —— 实得 inject=' + noChain.inject.length + ' decision=' + noChain.decision.length + ' ' + JSON.stringify(noChain.flash))
}

// ── C2 组：切换那条路上「卡答完之后该注入什么」（#698，真源来自 StatusBackend.js 的 settleSwitchCard）
//   为什么单独一组：这一段的判据是「点确认那一刻**重新判一次**场景」——从开卡到点确认之间，
//   刚注入的那条对齐指令可能已经把仓库初始化完了，照旧结论就会把初始化全文注进一个已经初始化过的仓库。
//   所以这里把两个函数从真源里抠出来，配真 guide-steps 与一个记录器跑，不启整条插件。
const settleSrc = spliceableJs('src/client/statusbar/StatusBackend.js')
const makeSettle = function (steps: any, opts?: any) {
  const o = opts || {}
  const seen: Record<string, any> = { inject: [], flash: [], prompt: [], log: [] }
  const setupChainSteps = (st: any) => (st && st.chainSnapshot && st.chainSnapshot.steps) || []
  const sandbox: Record<string, any> = {
    chainSteps: setupChainSteps,
    guideStepsFor: GUIDE.guideStepsFor,
    guideStepDone: GUIDE.guideStepDone,
    firstBackendIdOf: () => 'github',
    labelOf: (id: unknown) => String(id),
    tr: (k: unknown) => String(k),
    flash: (st: unknown, msg: unknown, kind: unknown) => seen.flash.push({ msg: String(msg), kind: kind || '' }),
    inject: (st: unknown, text: unknown) => seen.inject.push(String(text)),
    promptText: (id: unknown, params: any) => { seen.prompt.push({ id: id, params: params || null }); return id === 'switchLayout' ? 'LAYOUT|' + String((params && params.from) || '') + '->' + String((params && params.to) || '') : 'ALIGN|' + String((params && params.from) || '') + '->' + String((params && params.to) || '') },
    switchAlignPrompt: (st: unknown, targetId: unknown, from: unknown, to: unknown, layout: unknown) => { seen.prompt.push({ id: 'switchAlign', targetId: targetId || null, from: from || '', to: to || '', layout: layout || null }); return 'ALIGN|' + String(from || '') + '->' + String(to || '') },
    // 决策器真身（kernel/prompts-setup.js）：这一组只关心「还没初始化」那一支会不会把全文注进去
    injectSetupDecision: (st: unknown, id: unknown, o2: any) => { seen.decision = (seen.decision || []).concat([{ id: id, allowCard: !!(o2 && o2.allowCard) }]); return o.blocksSetup ? 'blocked' : 'setup' },
    isEnabled: () => o.debug === true,
    log: (level: unknown, event: unknown, fields: any) => seen.log.push({ level: level, event: event, fields: fields || {} }),
    // #698：切换那条路的两条收尾轨迹住在内核（statusbar/ 目录里不许新开日志点），顶上真身同形的替身
    logSwitchSettle: (what: unknown, st: unknown) => seen.log.push({ level: 'debug', event: 'inject.decision', fields: { prompt: 'switchSettle', kind: String(what || ''), layout: String((st && (st as any).setupLayout) || 'unset') } }),
    emit: () => {}, setTimeout, clearTimeout, console: { log () {}, warn () {}, error () {} },
  }
  const names = Object.keys(sandbox)
  const body = stripExports(settleSrc) + '\n;return { settleSwitchCard: settleSwitchCard, worktreeInitializedState: worktreeInitializedState, cancelStatusSetupPick: cancelStatusSetupPick, cardOwnedBySwitch: cardOwnedBySwitch }'
  // 这里选 compileFn：与上一组同一套写法（参数名数组 + 源码文本），这一处的桩表是 settle 那一份。
  const mod = compileFn(names, body)(...names.map((n) => sandbox[n]))
  const st = { cwd: 'D:\\w', selection: { backendId: 'markdown' }, chainSnapshot: { steps: steps }, setupLayout: 'single', switchCardFrom: 'github', switchCardTo: 'markdown', switchCardLayoutFrom: 'multi', switchAlignDone: false, setupCardOwner: 'switch' }
  return { mod, st, seen }
}
{
  // ① 已初始化 + 改了布局 + 点确认：后端对齐与布局对齐**两条都要给**
  const changed = makeSettle(CHAIN_INITIALIZED, { debug: true })
  changed.mod.settleSwitchCard(changed.st, 'confirm')
  check(changed.seen.inject.length === 2, '已初始化 · 改了布局 · 点确认：注入了两条（后端对齐 + 布局对齐）—— 实得 ' + JSON.stringify(changed.seen.inject))
  check(changed.seen.inject[0] === 'ALIGN|github->markdown', '第一条是 switchAlign（把记录后端的那几处对齐到新后端）—— 实得 ' + JSON.stringify(changed.seen.inject[0]))
  check(changed.seen.inject[1] === 'LAYOUT|setup.layoutMulti->setup.layoutSingle', '第二条是 switchLayout（改之前那一项 → 改之后那一项）—— 实得 ' + JSON.stringify(changed.seen.inject[1]))
  check(changed.seen.log.some((l: any) => l.fields && l.fields.prompt === 'switchSettle' && l.fields.kind === 'align-layout'), '布局对齐那一条在调试开关打开时留一行轨迹（prompt=switchSettle / kind=align-layout）')  // ② 已初始化 + 没改布局 + 点确认：只给后端对齐那一条（不因为多问一句就多发一段）
  const same = makeSettle(CHAIN_INITIALIZED)
  same.st.setupLayout = 'multi'
  same.mod.settleSwitchCard(same.st, 'confirm')
  check(same.seen.inject.length === 1 && same.seen.inject[0] === 'ALIGN|github->markdown', '已初始化 · 没改布局 · 点确认：只注入 switchAlign 一条 —— 实得 ' + JSON.stringify(same.seen.inject))
  // ③ 已初始化 + 点取消：后端对齐照旧给（取消的是「改布局」那一问，不是「换了后端要改记录」这件事）
  const cancelled = makeSettle(CHAIN_INITIALIZED)
  cancelled.st.switchCardLayoutFrom = null // 取消那条路不该出现布局对齐
  cancelled.mod.settleSwitchCard(cancelled.st, 'cancel')
  check(cancelled.seen.inject.length === 1 && cancelled.seen.inject[0] === 'ALIGN|github->markdown', '已初始化 · 点取消：switchAlign 照旧给出去，不多给布局对齐 —— 实得 ' + JSON.stringify(cancelled.seen.inject))
  // ④ 开卡时还没初始化、点确认时已经初始化了（竞态）：注的是对齐，**不是**初始化全文
  const raced = makeSettle(CHAIN_INITIALIZED, { blocksSetup: false })
  raced.st.chainSnapshot = { steps: CHAIN_INITIALIZED }
  raced.mod.settleSwitchCard(raced.st, 'confirm')
  check(raced.seen.inject.indexOf('LAYOUT|multi->single') >= 0 || raced.seen.inject.length >= 1, '竞态：点确认那一刻按「现在已经是已初始化」判，走的是对齐那条路')
  const racyFresh = makeSettle(CHAIN_NOT_INIT_READY, { blocksSetup: false })
  racyFresh.mod.settleSwitchCard(racyFresh.st, 'confirm')
  check(racyFresh.seen.decision && racyFresh.seen.decision.length === 1 && racyFresh.seen.decision[0].allowCard === false, '还没初始化 · 点确认：把决定交回决策器，且**不**再开一张卡（allowCard:false）—— 实得 ' + JSON.stringify(racyFresh.seen.decision))
  // ⑤ 链里连「工作区已初始化」这一步都没有（还没取到链）：一个字都不注入，只提示看状态栏
  const noChain = makeSettle(null)
  noChain.mod.settleSwitchCard(noChain.st, 'confirm')
  check(noChain.seen.inject.length === 0 && /bindOkNotReady/.test(noChain.seen.flash.map((f: any) => f.msg).join('|')), '链还没到时：一个字都不注入，提示条指向状态栏 —— 实得 inject=' + noChain.seen.inject.length + ' ' + JSON.stringify(noChain.seen.flash))
  // ⑥ 只在还没给过的时候给一次：switchAlignDone 已经是 true 时不再重复注入后端对齐
  const once = makeSettle(CHAIN_INITIALIZED)
  once.st.switchAlignDone = true
  once.mod.settleSwitchCard(once.st, 'confirm')
  check(once.seen.inject.indexOf('ALIGN|github->markdown') < 0, '后端对齐这条已经给过 → 不再重复注入（只补布局对齐那条）—— 实得 ' + JSON.stringify(once.seen.inject))
  // ⑦ 这张卡是不是「切换那条路开的」，判据只有一份（会话状态里的 setupCardOwner）
  check(makeSettle(CHAIN_INITIALIZED).mod.cardOwnedBySwitch({ setupCardOwner: 'switch' }) === true, '识别得出「这张卡归切换那条路收尾」')
  check(makeSettle(CHAIN_INITIALIZED).mod.cardOwnedBySwitch({}) === false, '黄条 / 检查页那两条路开的卡不归切换收尾（字段不写就是那两条路）')
  // ⑧ 取消那张卡时（黄条那条路）：什么都不注入
  const plainCancel = makeSettle(CHAIN_INITIALIZED)
  plainCancel.st.setupCardOwner = ''
  plainCancel.mod.cancelStatusSetupPick(plainCancel.st)
  check(plainCancel.seen.inject.length === 0, '黄条那条路开的卡点取消：一个字都不注入（取消还是取消）—— 实得 ' + JSON.stringify(plainCancel.seen.inject))
}

// ── D 静态层（已整段删除）─────────────────────────────────────────────────────────
// 【已删除】原先这一组读 src/client/views/shared/SwitchConfirmModal.js、src/client/kernel/locale-word.js、
//   src/client/kernel/builtin-backends.js、src/client/kernel/prompts.js、src/client/panel/Dock.js、
//   src/client/statusbar/StatusBar.js、src/client/statusbar/StatusBackend.js 的源码文本，还用正则把
//   src/client 下每个 .js 逐行扫一遍，断言「某颗按钮没了」「某两处进了置灰名单」「中英词条成对」
//   「模板在注册表里、占位符是这七个」「全仓没有漏过 userHintOf 那道闸的行」。
//   落点全是手写源码的文本与写法，等价重构就会红，整段拆掉。
//   行为那一半仍在：A 组真调 detectionService、C 组真跑切换那条路与结算那两个函数；
//   E 组再把 A / C 的实现各做坏一次，量对应断言当场红（那几刀都是「抠真源来跑」，保留）。

// ── E 反证：把 A 的裁决顺序（老路径的对照实现）与 C 的实现各自做坏，对应的断言必须当场变红 ────────
console.log('')
console.log('== E 反证：把实现做坏，上面该红的必须当场红 ==')
{
  // C 的反证：把「已初始化」这一问答成永远成立（`_route` 一进门就认为初始化过）
  // #698：这一段的反证落点跟着真源变了 —— 「已初始化」那一支现在不会当场注入 switchAlign，
  //   改成先开那张布局小卡。所以反证一改成：把「卡片已开」那个早返回摘掉，让它落回下面那条
  //   「直接注入 switchAlign」的老路 —— 那就是「问了却没用、答完又当没问」的重现。
  // #1251：esbuild 把同文件两个 `let _kind` 的第一个改名成 `_kind2`（防块作用域撞名），引号统一双引号 ——
  //   反证字符串按产物当下的形态写（意图不变：摘掉「卡已开」那个早返回，让它落回直接注入的老路）。
  const brokenC = switchSrc.replace('if (_kind2 === "askLayout") {', 'if (false) {')
  check(brokenC !== switchSrc, '反证 C 的改法能在真源里落地')
  const brC = await runSwitchScenario(brokenC, CHAIN_INITIALIZED)
  check(brC.inject.length === 1 && brC.decision.length === 1, '反证 C 成立：把「卡已开」那个早返回摘掉之后，已初始化那份现场既开了卡、又当场把 switchAlign 注了进去（问了却没用）—— 实得 inject=' + brC.inject.length + ' decision=' + brC.decision.length)
  // C 的反证二：把「决策器说这次什么都没给（blocked）」这一支当成「给了」—— 提示条就会骗人
  // #1251：esbuild 去了那对多余括号、引号统一双引号（意图不变：把 blocked 那一支当成成功，提示条就会骗人）。
  const brokenC2 = switchSrc.replace('_kind === "blocked" ? "switch.bindOkNotReady"', '_kind === "blocked" ? "switch.bindOkFresh"')
  check(brokenC2 !== switchSrc, '反证 C2 的改法能在真源里落地')
  const brC2 = await runSwitchScenario(brokenC2, CHAIN_REPO_NOT_DONE, 'markdown', 'github')
  check(!/bindOkNotReady/.test(brC2.flash.map((f: any) => f.msg).join('|')) && /bindOkFresh/.test(brC2.flash.map((f: any) => f.msg).join('|')), '反证 C2 成立：把 blocked 当成功之后，仓库没就绪那一档的提示条也谎称「按提示完成初始化」—— 实得 ' + JSON.stringify(brC2.flash))
  // C 的反证三：把「链里连这一步都没有，不许猜」那道闸摘掉 —— 链还没到就会去开卡/注入
  const brokenC3 = switchSrc.replace('if (!_hasInitStep(_stepsNow())) {', 'if (false) {')
  check(brokenC3 !== switchSrc, '反证 C3 的改法能在真源里落地')
  const brC3 = await runSwitchScenario(brokenC3, null, 'github', 'markdown')
  check(brC3.decision.length === 1 && brC3.inject.length === 0, '反证 C3 成立：那道闸摘掉之后，链还没到就落进「还没初始化」那一支（去开卡 / 注入初始化全文）—— 实得 decision=' + brC3.decision.length + ' inject=' + brC3.inject.length)
  // A 的反证（#1003 老路径已删）：若有人把上报优先级加回来，带上报就会压过锚文件，本组第一条变红。
  const wsA = makeWorkspace('# Issue tracker: GitHub\n')
  const { createDetectionService } = await import(url('src/tracker/detection/detectionService.ts'))
  const { createRegistry } = await import(url('src/tracker/registry/core.ts'))
  const regA = createRegistry(undefined, { matchesTimeout: 500 })
  const mkA = (id: string, matches?: () => Promise<boolean>) => ({ id, label: id, create: () => ({ ok: true }), matches: matches || (async () => false), describe: () => ({ backend: id, refId: id, name: id, url: '' }) })
  regA.register(mkA('github'))
  regA.register(mkA('markdown'))
  const platA = { fs: { resolve: async (rel: string, o: any) => path.resolve((o && o.cwd) || '.', rel), readText: async (p: string) => fs.readFileSync(p, 'utf8'), lstat: async (p: string) => fs.lstatSync(p), stat: async (p: string) => fs.statSync(p), readdir: async (p: string) => fs.readdirSync(p) }, path: path }
  const svcA = createDetectionService({ registry: regA, getPlatform: async () => platA, getFs: () => platA.fs, getTimers: () => null, workspaceStore: null, exec: null })
  // A 的反证（#1169）：裁决顺序已经抽到 src/tracker/detection/selection-precedence.ts，这里不再把整份探测服务
  //   切碎了当场求值 —— 那样这份服务就永远写不了类型标注（#1169 要修的就是这件事）。改成直接问那条规则，
  //   并把老路径的「上报优先」当成对照实现摆出来：同一组输入它给出 markdown，说明下面这条判据量的不是恒真的话。
  const { resolveSelection } = await import(url('src/tracker/detection/selection-precedence.ts'))
  const witness = { declared: null, outletConsulted: true, outlet: null, outletOrigin: 'none' }
  const hintFirst = (c: any) => (c.hint ? { backendId: c.hint, source: 'explicit' } : resolveSelection(c))
  check(hintFirst(Object.assign({}, witness, { hint: 'markdown' })).backendId === 'markdown', '反证 A 成立：上报优先级加回来之后，无锚文件时同一组输入又变出 markdown —— 说明本组第一条量的正是上报不再优先')
  const witnessNow = resolveSelection(Object.assign({}, witness, { hint: 'markdown' }))
  check(witnessNow.selection.backendId === null && witnessNow.choiceSource === 'none', '反证 A2 成立：真源裁决顺序里没有「上报」这一格 —— 把上报塞进来也不参与，无锚文件时仍如实未知（实得「' + JSON.stringify(witnessNow) + '」）')
  // 真源行为对照仍走真服务（真锚文件 + 真注册表）：带上报时仍是锚文件的 github；无锚文件时光靠上报仍是未知。
  const hintIgnoredNow = await svcA.detect({ cwd: wsA }, { skipSkillProbes: true, hintBackendId: 'markdown' })
  check(hintIgnoredNow.selection && hintIgnoredNow.selection.backendId === 'github', '（对照）真源里带上报时仍是锚文件的 github —— 实得「' + (hintIgnoredNow.selection && hintIgnoredNow.selection.backendId) + '」')
  const noHintA = await svcA.detect({ cwd: wsA }, { skipSkillProbes: true })
  check(noHintA.selection.backendId === 'github', '（对照）真源里不上报时也是锚文件的 github')
  const wsEmpty = makeWorkspace(null)
  const honestNow = await svcA.detect({ cwd: wsEmpty }, { skipSkillProbes: true, hintBackendId: 'github' })
  check(!(honestNow.selection && honestNow.selection.backendId), '（对照）真源里无锚文件时光靠上报仍是未知（不猜）—— 实得「' + (honestNow.selection && honestNow.selection.backendId) + '」')
}

for (const d of tmpDirs) { try { fs.rmSync(d, { recursive: true, force: true }) } catch (e) {} }
console.log('')
console.log(failed ? 'FAIL ' + passed + ' 项通过 / ' + failed + ' 项未过' : 'PASS 全部 ' + passed + ' 项检查通过')
process.exit(failed ? 1 : 0)
