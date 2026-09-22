#!/usr/bin/env node
/**
 * verify-669-choice-precedence.js —— 「用户的手动选择 > 锚文件 > 自动识别」那条裁决的门禁（#669 第 6 件 / ADR 20260921）
 *
 * 起因（真机现场）：面板里把后端从 GitHub 切到 Markdown，提示条说切了、弹窗也关了，**仓库标仍是 GitHub**。
 *   查明是判定链的顺序问题：宿主组装快照/链时先问锚文件 `docs/agents/issue-tracker.md`（写着 GitHub），
 *   用户那一下根本轮不到；客户端再把快照给的结论合并回来，把用户的选择盖掉并写进本地缓存。
 *
 * 断五组：
 *   A 行为层（宿主）：真调 detectionService.detect —— 带用户选择时压过锚文件；不带时锚照旧说话；
 *     锚文件不存在时自动识别照旧兜底；未注册的后端 id 忽略（诚实）。每条都配反证。
 *   B 行为层（客户端）：真求值 store-prefs.js 的 userHintOf 与 store-snapshot.js 的 mergeSelection ——
 *     只有带 userPicked 标记的选择才当 hint 上报；宿主回同一条时标记留住，回不同后端时标记消失。
 *   C 行为层（切换之后按场景分流）：真求值 store-switch.js 的 confirmSwitchConfirm，配真 guide-steps ——
 *     已初始化 → 注入 switchAlign（点名 /setup-matt-pocock-skills，带 from/to）；未初始化且仓库就绪 →
 *     走决策器（允许开布局小卡）+ 未初始化那句提示条；未初始化且仓库没就绪 → 一个字都不注入。
 *   D 静态层：那张弹窗上「清除后端选择」没了、迁移/清空两张卡与 GitLab 置灰、中英词条成对。
 *   E 反证：把 A、C 两组的实现各自做坏一次，对应的断言必须当场变红。
 *
 * 用法：node tests/verify-669-choice-precedence.js
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = path.resolve(import.meta.dirname, '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const url = (rel) => pathToFileURL(path.join(ROOT, rel)).href
let passed = 0
let failed = 0
const check = (ok, msg) => { if (ok) { console.log('  PASS ' + msg); passed++ } else { console.log('  FAIL ' + msg); failed++ } }
const stripExports = (s) => s.replace(/^[ \t]*export[ \t]+/gm, '')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const detectionSrc = read('src/host/tracker/detection/detectionService.js')
const prefsSrc = read('src/client/kernel/store-prefs.js')
const snapSrc = read('src/client/kernel/store-snapshot.js')
const switchSrc = read('src/client/kernel/store-switch.js')
const modalSrc = read('src/client/views/shared/SwitchConfirmModal.js')
const wordSrc = read('src/client/kernel/locale-word.js')
const promptsSrc = read('src/client/kernel/prompts.js')

// ── A 组：宿主判定链（真 detectionService + 真注册表 + 真锚文件读）────────────────────────
const tmpDirs = []
const makeWorkspace = function (anchorText) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-choice-'))
  tmpDirs.push(dir)
  if (anchorText) {
    fs.mkdirSync(path.join(dir, 'docs', 'agents'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'docs', 'agents', 'issue-tracker.md'), anchorText, 'utf8')
  }
  return dir
}
const makeDetection = async function (srcText) {
  const { createRegistry } = await import(url('src/host/tracker/registryCore.js'))
  const real = await import(url('src/host/tracker/detection/detectionService.js'))
  const { detectExplicit } = await import(url('src/host/tracker/detection/explicitDetector.js'))
  const { canonicalWorkspaceKey } = await import(url('src/host/workspaceKey.js'))
  const registry = createRegistry(undefined, { matchesTimeout: 500 })
  const mk = (id, matches) => ({ id, label: id, create: () => ({ ok: true }), matches: matches || (async () => false), describe: () => ({ backend: id, refId: id + '-ref', name: id + '-ref', url: '' }) })
  registry.register(mk('github', async () => false))
  registry.register(mk('markdown', async () => false))
  registry.register(mk('gitlab', async () => false))
  const platform = {
    fs: {
      resolve: async (rel, opts) => path.resolve((opts && opts.cwd) || '.', rel),
      readText: async (p) => fs.readFileSync(p, 'utf8'),
      lstat: async (p) => { try { return fs.lstatSync(p) } catch (e) { throw e } },
      stat: async (p) => { try { return fs.statSync(p) } catch (e) { throw e } },
      readdir: async (p) => fs.readdirSync(p),
    },
    path: path,
  }
  // srcText 变了（反证用）就**真的把改坏的那一份求值出来跑**：剥掉两行 import，改由参数注入
  //   （detectExplicit / canonicalWorkspaceKey 都取真身）—— 只比字符串不等、却仍跑真源，等于这道反证是假的
  //   （2026-09-21 对抗式审查指出过一次，这里是整改后的写法）。
  let createDetectionService = real.createDetectionService
  if (srcText && srcText !== detectionSrc) {
    const body = srcText
      .replace(/^import[^\n]*\n/gm, '')
      .replace(/^export default createDetectionService[^\n]*\n?/gm, '')
      .replace(/^[ \t]*export[ \t]+/gm, '')
    createDetectionService = new Function('detectExplicit', 'canonicalWorkspaceKey', body + '\n;return createDetectionService')(detectExplicit, canonicalWorkspaceKey)
  }
  const svc = createDetectionService({ registry, getPlatform: async () => platform, getFs: () => platform.fs, getTimers: () => null, workspaceStore: null, exec: null })
  return svc
}

console.log('== A 行为层（宿主）：带用户选择 → 压过锚文件；不带 → 锚照旧说话 ==')
{
  const ws = makeWorkspace('# Issue tracker: GitHub\n')
  const svc = await makeDetection()
  const withHint = await svc.detect({ cwd: ws }, { skipSkillProbes: true, hintBackendId: 'markdown' })
  const noHint = await svc.detect({ cwd: ws }, { skipSkillProbes: true })
  check(withHint.selection && withHint.selection.backendId === 'markdown', '带用户选择（hint=markdown）时，判定结果是 markdown（锚文件写着 GitHub）—— 实得「' + (withHint.selection && withHint.selection.backendId) + '」')
  check(noHint.selection && noHint.selection.backendId === 'github', '不带用户选择时，锚文件照旧说话（markdown → github 的锚）—— 实得「' + (noHint.selection && noHint.selection.backendId) + '」')
  check(!!withHint.explicit && !!withHint.explicit.raw, '带用户选择的那一次**也照旧读了锚文件**（结果里的 explicit 一栏不空，界面与排查要用）')
  const badHint = await svc.detect({ cwd: ws }, { skipSkillProbes: true, hintBackendId: 'not-a-backend' })
  check(badHint.selection && badHint.selection.backendId === 'github', '未注册的后端 id 被忽略（诚实）→ 落回锚文件 —— 实得「' + (badHint.selection && badHint.selection.backendId) + '」')
  // 锚文件不存在的工作区：用户选择照旧生效（空目录里的蓝条那一下）
  const ws2 = makeWorkspace(null)
  const svc2 = await makeDetection()
  const fresh = await svc2.detect({ cwd: ws2 }, { skipSkillProbes: true, hintBackendId: 'github' })
  check(fresh.selection && fresh.selection.backendId === 'github', '没有锚文件的工作区里，用户选择照旧生效 —— 实得「' + (fresh.selection && fresh.selection.backendId) + '」')
}

// ── B 组：客户端的「什么算用户的选择」闸门 ────────────────────────────────────────────
console.log('')
console.log('== B 行为层（客户端）：只有带 userPicked 的选择才当 hint；宿主回同一条时标记留住 ==')
{
  const hintLine = prefsSrc.split('\n').filter((l) => l.indexOf('export const userHintOf = function') >= 0)[0] || ''
  check(!!hintLine, '取到 store-prefs.js 里的 userHintOf（真身）')
  const userHintOf = new Function('return ' + hintLine.trim().replace(/^export const userHintOf = /, ''))()
  check(userHintOf({ backendId: 'markdown', userPicked: true }) === 'markdown', '用户亲手选的（带标记）→ 当 hint 上报')
  check(userHintOf({ backendId: 'markdown' }) === undefined, '派生出来的（没标记）→ 不当 hint 上报（ADR 攻击 1）')
  check(userHintOf({ backendId: null, userPicked: true }) === undefined, '没有后端 id 时不上报（诚实）')
  check(userHintOf(null) === undefined, '空选择不上报')
  const keepLine = prefsSrc.split('\n').filter((l) => l.indexOf('export const keepUserPick = function') >= 0)[0] || ''
  check(!!keepLine, '取到 store-prefs.js 里的 keepUserPick（真身）')
  const keepUserPick = new Function('return ' + keepLine.trim().replace(/^export const keepUserPick = /, ''))()
  // mergeSelection 的标记留存：宿主回同一条 → 留；回不同后端 → 消失
  const mergeSrc = snapSrc.match(/export const mergeSelection = function \(st, incoming\) \{[\s\S]*?\n    \}/)[0]
  const makeMerge = function () {
    const cache = []
    const fn = new Function('log', 'dswsLogHash', 'dswsLogTrunc', 'setCachedSelection', 'keepUserPick', 'return ' + mergeSrc.replace(/^export const mergeSelection = /, ''))(
      () => {}, () => 'h', (s) => s, (cwd, sel) => cache.push(sel), keepUserPick)
    return { fn, cache }
  }
  const a = makeMerge()
  const stA = { cwd: 'D:\\x', selection: { backendId: 'markdown', source: 'explicit', userPicked: true } }
  a.fn(stA, { backendId: 'markdown', source: 'explicit' })
  check(stA.selection.userPicked === true, '宿主回的同一条（后端相同）→ userPicked 标记留住')
  const b = makeMerge()
  const stB = { cwd: 'D:\\x', selection: { backendId: 'markdown', source: 'explicit', userPicked: true } }
  b.fn(stB, { backendId: 'gitlab', source: 'explicit' })
  check(stB.selection.userPicked !== true && stB.selection.backendId === 'gitlab', '宿主回的是别的后端 → 标记消失、照宿主的来（谁改了锚文件谁是真相）')
}

// ── B2 水合：缓存里那份旧快照不许抹掉用户刚点的那一下（真机上那次「切完仓库标回退」就是在这里丢的）──
console.log('')
console.log('== B2 行为层（水合）：loadSnapshot 第一步 hydrateFromCache 不许把用户刚选的覆盖回旧后端 ==')
{
  const hydrateSrc = snapSrc.match(/export const hydrateFromCache = function \(st\) \{[\s\S]*?\n    \}/)[0]
  const hintLine2 = prefsSrc.split('\n').filter((l) => l.indexOf('export const userHintOf = function') >= 0)[0] || ''
  const keepLine = prefsSrc.split('\n').filter((l) => l.indexOf('export const keepUserPick = function') >= 0)[0] || ''
  const mergeSrc2 = snapSrc.match(/export const mergeSelection = function \(st, incoming\) \{[\s\S]*?\n    \}/)[0]
  const mkHydrate = function (patched) {
    const writes = []
    const userHintOf = new Function('return ' + hintLine2.trim().replace(/^export const userHintOf = /, ''))()
    const keepUserPick = new Function('return ' + keepLine.trim().replace(/^export const keepUserPick = /, ''))()
    const mergeSelection = new Function('log', 'dswsLogHash', 'dswsLogTrunc', 'setCachedSelection', 'keepUserPick', 'return ' + mergeSrc2.replace(/^export const mergeSelection = /, ''))(() => {}, () => 'h', (s) => s, (cwd, sel) => writes.push(sel), keepUserPick)
    const deps = {
      getCachedSnapshot: () => ({ generatedMs: 100, id: '缓存里那份切换前的快照', selection: { backendId: 'github', source: 'explicit' }, repository: { backend: 'github', name: 'r' } }),
      rememberWorkspaceRoot: () => {}, wsKeyOf: (p) => String(p || ''), snapshotByCwd: new Map(), touchLRUClient: () => {},
      mergeSelection, setCachedRepository: () => {}, setPresentationMap: () => {}, getCachedSelection: () => ({ backendId: 'markdown', source: 'explicit', userPicked: true }),
      getCachedRepository: () => null, getCachedChain: () => null, promptLang: () => 'zh', nowStr: () => '', log: () => {}, dswsLogHash: () => 'h',
      userHintOf, setCachedSelection: (cwd, sel) => writes.push(sel),
    }
    const names = Object.keys(deps)
    const body = (patched ? hydrateSrc.replace(patched[0], patched[1]) : hydrateSrc).replace(/^export const hydrateFromCache = /, 'return ')
    const fn = new Function(...names, body)(...names.map((n) => deps[n]))
    return { fn, writes }
  }
  const pick = () => ({ cwd: 'D:\\x', selection: { backendId: 'markdown', source: 'explicit', userPicked: true }, snapshot: { id: '面板上正显示的那一份', generatedMs: 100 } })
  const good = mkHydrate(null)
  const stG = pick()
  good.fn(stG)
  check(stG.selection.backendId === 'markdown' && stG.selection.userPicked === true, '水合之后用户刚点的那一下还在（markdown + 标记没被缓存里那份 github 顶掉）—— 实得 ' + JSON.stringify(stG.selection))
  check(!good.writes.some((s) => s && String(s.backendId) !== 'markdown'), '水合也没有把旧后端写回本地缓存（标记不会随缓存丢）—— 实得 ' + JSON.stringify(good.writes))
  const noPick = mkHydrate(null)
  const stN = { cwd: 'D:\\x', selection: null, snapshot: null }
  noPick.fn(stN)
  check(stN.selection && stN.selection.backendId === 'github', '这段守卫只管「用户亲手选过的那一条」：没有标记时旧快照照旧水合进来（正常秒显不受影响）—— 实得 ' + JSON.stringify(stN.selection))
  const broken = mkHydrate(["&& !(typeof userHintOf === 'function' && userHintOf(st.selection))", '&& true'])
  const stB2 = pick()
  broken.fn(stB2)
  check(stB2.selection.backendId === 'github' && stB2.selection.userPicked !== true, '反证 B2 成立：把这道守卫摘掉之后，同一份现场当场退回 github（正是真机上报的那次回退）—— 实得 ' + JSON.stringify(stB2.selection))
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
const makeSwitch = function (srcText) {
  const seen = { inject: [], decision: [], flash: [], snap: [], chain: [], bind: [] }
  // 「仓库那一步过没过」这条判据住在 prompts.js 里（setupBlockedByGuide），本门禁取它的真身来判，
  //   不去自己抄第二份 —— 否则门禁验证的就不是「切换那条路真的用了同一个判据」了。
  const chainStepsSrc = promptsSrc.match(/const setupChainSteps = function \(st\) \{[\s\S]*?\n    \}/)[0]
  const blockedSrc = promptsSrc.match(/export const setupBlockedByGuide = function \(st, backendId\) \{[\s\S]*?\n    \}/)[0]
  const chainStepsImpl = (st) => (st && st.chainSnapshot && st.chainSnapshot.steps) || []
  const setupChainSteps = new Function('chainSteps', 'return ' + chainStepsSrc.replace(/^const setupChainSteps = /, ''))(chainStepsImpl)
  const setupBlockedByGuide = new Function('guideStepsFor', 'guideStepDone', 'setupChainSteps', 'return ' + blockedSrc.replace(/^export const setupBlockedByGuide = /, ''))(GUIDE.guideStepsFor, GUIDE.guideStepDone, setupChainSteps)
  const sandbox = {
    host: { call: (m, p) => { if (m === 'wf.bind') seen.bind.push(p); return Promise.resolve({ ok: true }) } },
    // 注意：labelOf / openSwitchConfirm / closeSwitchConfirm 这些**本文件自己声明**，不能当参数传进来（会重名）
    builtinLabelOf: (id) => String(id),
    firstBackendIdOf: () => 'github',
    otherFiltered: (l) => (Array.isArray(l) ? l : []),
    tr: (k, params) => { let s = String(k); if (params) s = s + JSON.stringify(params); return s },
    flash: (st, msg, kind) => seen.flash.push({ msg: String(msg), kind: kind || '' }),
    inject: (st, text) => seen.inject.push(String(text)),
    // 决策器按真判据回话：仓库那一步没过 → 'blocked'（真身那边也是这一个返回）；否则这一步先开布局小卡。
    injectSetupDecision: (st, id, opts) => { seen.decision.push({ id: id, allowCard: !!(opts && opts.allowCard) }); return setupBlockedByGuide(st, id) ? 'blocked' : 'setup-card' },
    promptText: (id, params) => (id === 'switchAlign' ? 'ALIGN|' + String((params && params.from) || '') + '->' + String((params && params.to) || '') : ''),
    chainSteps: chainStepsImpl,
    guideStepsFor: GUIDE.guideStepsFor,
    guideStepDone: GUIDE.guideStepDone,
    emit: () => {}, setCachedSelection: () => {}, log: () => {}, dswsLogHash: () => 'h', dswsLogTrunc: (s) => s,
    loadSnapshot: () => seen.snap.push(1), loadChain: () => seen.chain.push(1),
    setTimeout, clearTimeout, console: { log () {}, warn () {}, error () {} },
  }
  const names = Object.keys(sandbox)
  const body = stripExports(srcText) + '\n;return { confirmSwitchConfirm: confirmSwitchConfirm, openSwitchConfirm: openSwitchConfirm }'
  const mod = new Function(...names, body)(...names.map((n) => sandbox[n]))
  return { mod, seen }
}
const runSwitchScenario = async function (srcText, steps, from, to) {
  const s = makeSwitch(srcText)
  const fromId = from || 'github'
  const toId = to || 'markdown'
  const st = { cwd: 'D:\\w', selection: { backendId: fromId, source: 'explicit', userPicked: true }, repository: null, snapshot: null, chainSnapshot: { steps: steps }, switchConfirm: { open: true, curBackendId: fromId, targetBackendId: toId, option: 'keep', criChecks: null, criLoading: false, clearInput: '', confirming: false } }
  s.mod.confirmSwitchConfirm(st)
  await sleep(20)
  return s.seen
}
{
  const initialized = await runSwitchScenario(switchSrc, CHAIN_INITIALIZED)
  const notInitReady = await runSwitchScenario(switchSrc, CHAIN_NOT_INIT_READY)
  // 「没就绪」这一档：从 Markdown 切回 GitHub，而远端仓库那一步还没过
  const notReady = await runSwitchScenario(switchSrc, CHAIN_REPO_NOT_DONE, 'markdown', 'github')
  // 对照：同一个「仓库没过」的现场，但切去的目标是本地 Markdown（它那份清单里没有仓库那一步）→ 照样算就绪
  const toMarkdown = await runSwitchScenario(switchSrc, CHAIN_REPO_NOT_DONE, 'github', 'markdown')
  check(initialized.inject.length === 1 && initialized.inject[0] === 'ALIGN|github->markdown', '已初始化：注入的是 switchAlign（带 切换前→切换后 两个后端）—— 实得 ' + JSON.stringify(initialized.inject))
  check(initialized.decision.length === 0, '已初始化：不走「初始化全文」那条决策器（不重跑初始化）')
  check(/bindOk/.test(initialized.flash.map((f) => f.msg).join('|')), '已初始化：提示条用的是原来那句（旧数据已保留）—— 实得 ' + JSON.stringify(initialized.flash.map((f) => f.msg)))
  check(notInitReady.decision.length === 1 && notInitReady.decision[0].allowCard === true, '未初始化 + 仓库就绪：走决策器且允许开那张布局小卡 —— 实得 ' + JSON.stringify(notInitReady.decision))
  check(notInitReady.inject.length === 0, '未初始化：这一支自己**不**注入长文（注入交给决策器 + 小卡那条路）')
  check(/bindOkFresh/.test(notInitReady.flash.map((f) => f.msg).join('|')), '未初始化 + 就绪：提示条换成「接下来按提示完成初始化」那句 —— 实得 ' + JSON.stringify(notInitReady.flash.map((f) => f.msg)))
  check(notReady.decision.length === 1 && notReady.inject.length === 0, '未初始化 + 目标后端那份清单里的仓库那一步没过（Markdown → GitHub）：仍交给决策器判（判据只有它那一份），自己一个字都不注入 —— 实得 decision=' + notReady.decision.length + ' inject=' + notReady.inject.length)
  check(notReady.flash.filter((f) => /bindOkNotReady/.test(f.msg) && f.kind === 'warn').length === 1, '未初始化 + 没就绪：提示条说的是「先按状态栏那条提示处理」且按警示色 —— 实得 ' + JSON.stringify(notReady.flash))
  check(/bindOkFresh/.test(toMarkdown.flash.map((f) => f.msg).join('|')), '同一个现场切去本地 Markdown：仓库那一步不在 Markdown 的清单里 → 决策器判它没被挡住，提示条是「按提示完成初始化」那句 —— 实得 ' + JSON.stringify(toMarkdown.flash.map((f) => f.msg)))
  check(initialized.bind.length === 1 && notInitReady.bind.length === 1 && notReady.bind.length === 1, '三种场景都照旧打了那通绑定电话（wf.bind）')
  check(initialized.snap.length === 1 && initialized.chain.length === 1, '三种场景都照旧重取快照与链')
  // 链快照还没到（链里连「初始化过没有」这一步都拿不到）：不许猜 —— 一个字不注入，提示条指向状态栏
  const noChain = await runSwitchScenario(switchSrc, null, 'github', 'markdown')
  check(noChain.inject.length === 0 && noChain.decision.length === 0 && /bindOkNotReady/.test(noChain.flash.map((f) => f.msg).join('|')), '链还没到时：不注入、不开卡、不猜（不会把初始化全文注进已经初始化过的仓库），提示条指向状态栏 —— 实得 inject=' + noChain.inject.length + ' decision=' + noChain.decision.length + ' ' + JSON.stringify(noChain.flash))
}

// ── D 静态层：本来只该在仓库里出现一次的东西 ─────────────────────────────────────────
console.log('')
console.log('== D 静态层：删掉的那颗按钮、置灰的三处、中英成对 ==')
{
  check(!/clearBackendBinding/.test(modalSrc) && !/switch\.clearBind/.test(modalSrc), '弹窗里「清除后端选择」那颗按钮没了（连同它的两条词条引用）')
  check(!/clearBackendBinding/.test(switchSrc), '内核里那条路径也退役了（全仓无调用点）')
  check(/OPTION_LOCKED = \{ migrate: 'switch\.optLockedTip', clear: 'switch\.optLockedTip' \}/.test(modalSrc), '「迁移」「清空」两张卡进了置灰名单')
  check(/'data-opt-locked': locked \? 1 : 0/.test(modalSrc) && /data-target-locked/.test(modalSrc), '置灰状态在 DOM 上可查（data-opt-locked / data-target-locked）')
  check(/SWITCH_UNAVAILABLE_BACKENDS = \['gitlab'\]/.test(read('src/client/kernel/builtin-backends.js')), 'GitLab 进「暂不可选」名单（今天能选的是 GitHub 与本地 Markdown）')
  check(/if \(OPTION_LOCKED\[opt\]\) return/.test(modalSrc), '置灰的选项在 onOption 里也挡一道（双保险）')
  const keys = ['switch.bindOk', 'switch.bindOkFresh', 'switch.bindOkNotReady', 'switch.optLockedTip', 'switch.targetLockedTip']
  const zhBlock = wordSrc.slice(0, wordSrc.indexOf('// #529'))
  const enBlock = wordSrc.slice(wordSrc.indexOf("'switch.bindOk': 'Switched to"))
  for (const k of keys) {
    const inZh = new RegExp("'" + k.replace('.', '\\.') + "':").test(zhBlock)
    const inEn = enBlock.indexOf("'" + k + "':") >= 0
    check(inZh && inEn, '词条成对：' + k)
  }
  check(!/switch\.clearBind'/.test(wordSrc) && !/switch\.clearBindTitle/.test(wordSrc) && !/switch\.clearBindOk/.test(wordSrc), '退役的三条 clearBind 词条都不在词表里了')
  check(/"switchAlign": \{ version: 1, placeholders: \['from', 'to'\]/.test(promptsSrc), '新模板 switchAlign 在注册表里（两个占位符 from/to）')
  check(/\/setup-matt-pocock-skills/.test(promptsSrc.slice(promptsSrc.indexOf('"switchAlign"'), promptsSrc.indexOf('"newWayfinder"'))), '新模板点名了 /setup-matt-pocock-skills（维护者要求）')
  // 全仓扫一遍：往宿主上报「这次问的是哪个后端」的每一行都必须过 userHintOf 那道闸 ——
  //   漏一处就等于派生值又能冒充用户意图（2026-09-21 对抗式审查就是这样抓到 ChainRenderer / NoRepoCard 两处的）。
  const offenders = []
  const walkClient = function (dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) { walkClient(full); continue }
      if (!entry.name.endsWith('.js')) continue
      const rel = path.relative(ROOT, full).split(path.sep).join('/')
      fs.readFileSync(full, 'utf8').split(/\r?\n/).forEach(function (line, i) {
        if (!/'wf\.(detect|chain)'/.test(line)) return
        if (!/backendId\s*:/.test(line)) return
        if (!/userHintOf/.test(line)) offenders.push(rel + ':' + (i + 1))
      })
    }
  }
  walkClient(path.join(ROOT, 'src', 'client'))
  check(offenders.length === 0, '客户端里每一处带 backendId 的 wf.detect / wf.chain 都过了 userHintOf 那道闸（漏 ' + offenders.length + ' 处' + (offenders.length ? '：' + offenders.join('、') : '') + '）')
  const dockSrc = read('src/client/panel/Dock.js')
  const barSrc = read('src/client/statusbar/StatusBar.js')
  const sbSrc = read('src/client/statusbar/StatusBackend.js')
  check(/isBackendUnavailable/.test(dockSrc) && /isBackendUnavailable/.test(barSrc) && /isBackendUnavailable/.test(sbSrc), '三个选后端的窗（切换弹窗 / 面板门控 / 状态栏门控）都问同一个「今天能不能选」判据（GitLab 置灰 + 确认时再挡一道）')
  check(!/tr\('switch\.bindOk'/.test(dockSrc) && !/tr\('switch\.bindOk'/.test(sbSrc), '门控窗的提示条不再说「旧数据已保留」（那个窗只在「还没有后端」时开，从来没有旧数据）')
  check(/'data-target-locked'/.test(dockSrc) && /'data-target-locked'/.test(barSrc), '门控窗的置灰状态在 DOM 上可查（data-target-locked）')
}

// ── E 反证：把 A、C 的实现做坏，对应的断言必须当场变红 ──────────────────────────────
console.log('')
console.log('== E 反证：把实现做坏，上面该红的必须当场红 ==')
{
  // C 的反证：把「已初始化」这一问答成永远成立（`_route` 一进门就认为初始化过）
  const brokenC = switchSrc
    .replace("if (_done('tracker:initialized')) {", "if (true) {")
  check(brokenC !== switchSrc, '反证 C 的改法能在真源里落地')
  const brC = await runSwitchScenario(brokenC, CHAIN_NOT_INIT_READY)
  check(brC.inject.length === 1 && brC.decision.length === 0, '反证 C 成立：判定写坏之后，未初始化那份现场也去注入 switchAlign（原本该走决策器）—— 实得 inject=' + brC.inject.length + ' decision=' + brC.decision.length)
  // C 的反证二：把「决策器说这次什么都没给（blocked）」这一支当成「给了」—— 提示条就会骗人
  const brokenC2 = switchSrc.replace("_kind === 'blocked' ? 'switch.bindOkNotReady' : 'switch.bindOkFresh'", "'switch.bindOkFresh'")
  check(brokenC2 !== switchSrc, '反证 C2 的改法能在真源里落地')
  const brC2 = await runSwitchScenario(brokenC2, CHAIN_REPO_NOT_DONE, 'markdown', 'github')
  check(!/bindOkNotReady/.test(brC2.flash.map((f) => f.msg).join('|')) && /bindOkFresh/.test(brC2.flash.map((f) => f.msg).join('|')), '反证 C2 成立：把 blocked 当成功之后，仓库没就绪那一档的提示条也谎称「按提示完成初始化」—— 实得 ' + JSON.stringify(brC2.flash))
  // C 的反证三：把「链里连这一步都没有，不许猜」那道闸摘掉 —— 链还没到就会去开卡/注入
  const brokenC3 = switchSrc.replace('if (!_hasInitStep(_stepsNow())) {', 'if (false) {')
  check(brokenC3 !== switchSrc, '反证 C3 的改法能在真源里落地')
  const brC3 = await runSwitchScenario(brokenC3, null, 'github', 'markdown')
  check(brC3.decision.length === 1 && brC3.inject.length === 0, '反证 C3 成立：那道闸摘掉之后，链还没到就落进「还没初始化」那一支（去开卡 / 注入初始化全文）—— 实得 decision=' + brC3.decision.length + ' inject=' + brC3.inject.length)
  // A 的反证：把 hint 分支关掉（等价于旧顺序：锚先说话）—— 带 hint 的那一次就应当退回锚文件的 github
  const wsA = makeWorkspace('# Issue tracker: GitHub\n')
  const { createDetectionService } = await import(url('src/host/tracker/detection/detectionService.js'))
  const { createRegistry } = await import(url('src/host/tracker/registryCore.js'))
  const regA = createRegistry(undefined, { matchesTimeout: 500 })
  const mkA = (id, matches) => ({ id, label: id, create: () => ({ ok: true }), matches: matches || (async () => false), describe: () => ({ backend: id, refId: id, name: id, url: '' }) })
  regA.register(mkA('github'))
  regA.register(mkA('markdown'))
  const platA = { fs: { resolve: async (rel, o) => path.resolve((o && o.cwd) || '.', rel), readText: async (p) => fs.readFileSync(p, 'utf8'), lstat: async (p) => fs.lstatSync(p), stat: async (p) => fs.statSync(p), readdir: async (p) => fs.readdirSync(p) }, path: path }
  const svcA = createDetectionService({ registry: regA, getPlatform: async () => platA, getFs: () => platA.fs, getTimers: () => null, workspaceStore: null, exec: null })
  // A 的反证：把 hint 分支整段关掉（等价于旧顺序：锚先说话）—— 那一份现场里带 hint 的一次必须退回锚文件的 github
  // 2026-09-22（#683 F1）：hint 那一支改成按修订号判的四档之后，这一刀的落点从 `if (opts.hintBackendId && registry`
  //   换成那句 `const hintUsable = !!(opts.hintBackendId …)` —— 关掉它等于「客户端报上来的选择一律不算数」，意图不变。
  const staleSrc = detectionSrc.replace('const hintUsable = !!(opts.hintBackendId', 'const hintUsable = false && !!(opts.hintBackendId')
  check(staleSrc !== detectionSrc, '反证 A 的改法能在真源里落地（hint 分支关掉）')
  const svcBroken = await makeDetection(staleSrc)
  const hintWins = await svcA.detect({ cwd: wsA }, { skipSkillProbes: true, hintBackendId: 'markdown' })
  check(hintWins.selection.backendId === 'markdown', '（对照）真源里带 hint 时是 markdown —— 下面那一条量的是「把 hint 关掉就退回 github」')
  const hintIgnored = await svcBroken.detect({ cwd: wsA }, { skipSkillProbes: true, hintBackendId: 'markdown' })
  check(hintIgnored.selection && hintIgnored.selection.backendId === 'github', '反证 A 成立：把 hint 那一支关掉之后，同一份现场带着 hint 也退回锚文件的 github —— 实得「' + (hintIgnored.selection && hintIgnored.selection.backendId) + '」（说明这一门量的就是 hint 那一支的优先级）')
  const noHintA = await svcA.detect({ cwd: wsA }, { skipSkillProbes: true })
  check(noHintA.selection.backendId === 'github', '（对照）真源里不带 hint 时也是锚文件的 github')
  // A 的反证二：把 hint 分支挪到锚文件读取**之前**（先判 hint、再读锚）不会改变结论，但把它挪到
  //   `if (!selection)` 兜底里就会「锚赢」——这一条量的是「hint 与锚的先后不许被调换」。
  const lateSrc = detectionSrc.replace('} else if (hintUsable) {', '} else if (hintUsable && !selection) {')
  check(lateSrc !== detectionSrc, '反证 A2 的改法能在真源里落地（hint 分支挪到兜底里）')
  const svcLate = await makeDetection(lateSrc)
  const lateHint = await svcLate.detect({ cwd: wsA }, { skipSkillProbes: true, hintBackendId: 'markdown' })
  check(lateHint.selection && lateHint.selection.backendId === 'github', '反证 A2 成立：hint 挪进兜底之后，锚文件重新压过用户的选择（回到修之前那个毛病）—— 实得「' + (lateHint.selection && lateHint.selection.backendId) + '」')
}

for (const d of tmpDirs) { try { fs.rmSync(d, { recursive: true, force: true }) } catch (e) {} }
console.log('')
console.log(failed ? 'FAIL ' + passed + ' 项通过 / ' + failed + ' 项未过' : 'PASS 全部 ' + passed + ' 项检查通过')
process.exit(failed ? 1 : 0)
