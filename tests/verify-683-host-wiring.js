#!/usr/bin/env node
/**
 * verify-683-host-wiring.js —— F1「用户选的后端按工作区存一份在宿主侧」的宿主接线门禁（#683）
 *
 * 量的是 ADR docs/adr/20260921-persist-user-choice-host-side.md 第 8 节里属于「接上判定链」的那几组
 * （#1003 老路径已删：上报优先与修订号四档仲裁已退役，上报一律忽略；H 经统一判定出口的记忆层照旧回答）：
 *   A 上报即忽略：带上报也按锚文件回答，且不再写进 H；无文件无声明时 H 经出口记忆层回答并带修订号；
 *     文件在就听文件的；H 里没有、也没报 → 照旧落回锚文件。
 *   B R5c/R10：文件坏的那一轮既不采纳也不写；工作区已空时记忆视为过期（H 不回答，内容不动）；
 *     H 里那条后端今天不在注册表里 → 当没有。
 *   C R4：快照那三条短路路径与 304 都要带权威 {selection, rev}（只换了后端时客户端才不会继续显示旧后端）。
 *   E R7c：H 写失败要如实回 persisted:false（不许无声失败）。
 *   F 反证：把实现做坏（把上报优先级加回来、把 H 放在选择之后、把短路路的 selection 摘掉），
 *     对应的断言必须当场红。
 *
 * 用法：node tests/verify-683-host-wiring.js
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
// 按文本求值走共用入口，理由与用法见 tests/lib/eval-probe.js 文件头。
import { compileFn } from './lib/eval-probe.js'

const ROOT = path.resolve(import.meta.dirname, '..')
const url = (rel) => pathToFileURL(path.join(ROOT, rel)).href
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
let passed = 0
let failed = 0
const check = (ok, msg) => { if (ok) { console.log('  PASS ' + msg); passed++ } else { console.log('  FAIL ' + msg); failed++ } }
const tmpDirs = []
const makeDir = function (tag) { const d = fs.mkdtempSync(path.join(os.tmpdir(), tag)); tmpDirs.push(d); return d }

const { createDetectionService } = await import(url('src/host/tracker/detection/detectionService.js'))
const { createRegistry } = await import(url('src/host/tracker/registryCore.js'))
const { createChoiceStore } = await import(url('src/host/choiceStore.js'))
const { decideBackend: outletDecideBackend, selectionFromOutlet: outletSelectionFromOutlet } = await import(url('src/host/tracker/detection/backendDecision.js'))
try { outletDecideBackend.selectionFromOutlet = outletSelectionFromOutlet } catch (eAttachOutlet683) {}

// 现场：一个工作区目录（可选放一份锚文件，写着 GitHub），一份真 choiceStore（落在临时主目录上）。
const makeWorkspace = function (anchor) {
  const dir = makeDir('dsh-683-ws-')
  if (anchor) {
    fs.mkdirSync(path.join(dir, 'docs', 'agents'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'docs', 'agents', 'issue-tracker.md'), anchor, 'utf8')
  }
  return dir
}
const makeStore = function (keys) {
  const home = makeDir('dsh-683-home-')
  return createChoiceStore({ homeDir: home, isKnownBackend: function (id) { return keys.indexOf(id) >= 0 } })
}
const makeService = function (store, wsStore) {
  const registry = createRegistry(undefined, { matchesTimeout: 500 })
  const mk = (id) => ({ id: id, label: id, create: () => ({ ok: true }), matches: async () => false, describe: () => ({ backend: id, refId: id + '-ref', name: id + '-ref', url: '' }) })
  registry.register(mk('github'))
  registry.register(mk('markdown'))
  const platform = {
    fs: {
      resolve: async (rel, o) => path.resolve((o && o.cwd) || '.', rel),
      readText: async (p) => fs.readFileSync(p, 'utf8'),
      lstat: async (p) => fs.lstatSync(p),
      stat: async (p) => fs.statSync(p),
      readdir: async (p) => fs.readdirSync(p),
    },
    path: path,
  }
  return createDetectionService({ registry, getPlatform: async () => platform, getFs: () => platform.fs, getTimers: () => null, workspaceStore: wsStore || null, getChoiceStore: async () => store, exec: null, decideBackend: outletDecideBackend })
}
const makeWsStore = function () {
  const m = new Map()
  return { get: (h) => m.get(h.cwd || ''), set: (h, v) => { m.set(h.cwd || '', v) }, invalidate: (h) => { m.delete(h.cwd || '') }, clear: () => m.clear() }
}

console.log('宿主接线门禁（#683 F1：上报即忽略、H 经出口记忆层回答、每条回包都带权威选择、只有一处写记忆）')

// ── A 上报即忽略，H 经出口记忆层回答 ────────────────────────────────────────────────────
console.log('')
console.log('== A 上报即忽略；H 经出口记忆层回答；文件赢 ==')
{
  // 上报一律忽略：H 里没有这条、锚文件写着 GitHub，带上报 markdown 也按锚回答，且不写进 H
  const ws = makeWorkspace('# Issue tracker: GitHub\n')
  const store = makeStore(['github', 'markdown'])
  const svc = makeService(store)
  const a1 = await svc.detect({ cwd: ws }, { skipSkillProbes: true, hintBackendId: 'markdown', baseRev: 0 })
  check(a1.selection && a1.selection.backendId === 'github', '上报的选择不再参与判定（老路径已删），锚文件照旧说话 —— 实得「' + (a1.selection && a1.selection.backendId) + '」')
  check(a1.rev === 0 && a1.fromHint === false, '上报不产生修订号、不标记为上报 —— 实得 rev=' + a1.rev + ' fromHint=' + a1.fromHint)
  const stored = await store.getWorkspace(ws)
  check(stored.found === false, '上报不再写进 H（一次性迁移已随老路径退役）—— 实得 ' + JSON.stringify(stored))

  // #1003 契约（2026-10-12 维护者拍板）：记忆不再参与判定 —— 无文件无声明时，即使 H 里记着 markdown，
  //   判定也如实未知（记录留在机器上不删，只用来把工作区文件生成一次，那条路在工作区入口的迁移里）。
  const wsM = makeWorkspace(null)
  fs.writeFileSync(path.join(wsM, 'README.md'), 'x', 'utf8')
  const memFirst = await store.rememberWorkspace(wsM, 'markdown')
  const aM = await svc.detect({ cwd: wsM }, { skipSkillProbes: true, hintBackendId: 'github' })
  check(!(aM.selection && aM.selection.backendId), '无文件无声明时不再拿 H 回答（如实未知，不猜）—— 实得「' + (aM.selection && aM.selection.backendId) + '」')
  const keptM = await store.getWorkspace(wsM)
  check(keptM.found === true && keptM.backendId === 'markdown', 'H 里那条记录留在机器上不删（只停用不删，文件万一被删还能再生成一次）—— 实得 ' + JSON.stringify({ found: keptM.found, backendId: keptM.backendId, rev: keptM.rev }))
  check((memFirst.rev || 0) > 0, '（布置）记忆里确实有这条带修订号的记录 —— 实得 rev=' + memFirst.rev)

  // 文件赢：锚写着 GitHub、工作区文件里是 markdown → markdown（上报 github 也盖不掉）
  const wsF = makeWorkspace('# Issue tracker: GitHub\n')
  fs.writeFileSync(path.join(wsF, 'docs', 'agents', 'workspace.json'), '{"version":1,"backendId":"markdown","pickedAt":1758500000000,"source":"user"}', 'utf8')
  const storeF = makeStore(['github', 'markdown'])
  const svcF = makeService(storeF)
  const aF = await svcF.detect({ cwd: wsF }, { skipSkillProbes: true, hintBackendId: 'github' })
  check(aF.selection && aF.selection.backendId === 'markdown', '文件在就听文件的（markdown 胜锚 github），上报也盖不掉 —— 实得「' + (aF.selection && aF.selection.backendId) + '」')

  // H 里没有、也没报 → 照旧落回锚文件
  const ws2 = makeWorkspace('# Issue tracker: GitHub\n')
  const store2 = makeStore(['github', 'markdown'])
  const svc2 = makeService(store2)
  const a5 = await svc2.detect({ cwd: ws2 }, { skipSkillProbes: true })
  check(a5.selection && a5.selection.backendId === 'github', 'H 里没有这条、也没报选择时，照旧按锚文件回答（H 不参与）—— 实得「' + (a5.selection && a5.selection.backendId) + '」')
  const a6 = await svc2.detect({ cwd: ws2 }, { skipSkillProbes: true, hintBackendId: 'not-a-backend', baseRev: 0 })
  check(a6.selection && a6.selection.backendId === 'github', '未注册的后端 id 照旧被忽略（诚实）→ 落回锚文件 —— 实得「' + (a6.selection && a6.selection.backendId) + '」')
}

// ── B 坏文件、空工作区、注册表不认的那条 ───────────────────────────────────────────────
console.log('')
console.log('== B R5c/R10：坏文件不采纳也不写、空工作区不回答、注册表不认的当没有 ==')
{
  // 文件坏：这一轮既不采纳 hint、也不写
  const ws = makeWorkspace('# Issue tracker: GitHub\n')
  const home = makeDir('dsh-683-home-')
  fs.mkdirSync(path.join(home, '.dsh', 'mattskillsdeck'), { recursive: true })
  fs.writeFileSync(path.join(home, '.dsh', 'mattskillsdeck', 'choices.json'), '{"version":1,"workspaces":{', 'utf8')
  const store = createChoiceStore({ homeDir: home, isKnownBackend: () => true })
  const svc = makeService(store)
  const b1 = await svc.detect({ cwd: ws }, { skipSkillProbes: true, hintBackendId: 'markdown', baseRev: 0 })
  check(b1.selection && b1.selection.backendId === 'github', '文件坏的那一轮不采纳 hint（落回锚文件）—— 实得「' + (b1.selection && b1.selection.backendId) + '」')
  check(fs.readFileSync(path.join(home, '.dsh', 'mattskillsdeck', 'choices.json'), 'utf8') === '{"version":1,"workspaces":{', '文件坏的那一轮也不写（半截文件一字不动）')

  // 工作区已空（#297）：记忆视为过期，H 不回答；H 的内容不动
  const empty = makeDir('dsh-683-empty-')
  const store2 = makeStore(['github', 'markdown'])
  await store2.rememberWorkspace(empty, 'markdown')
  const svc2 = makeService(store2)
  const b2 = await svc2.detect({ cwd: empty }, { skipSkillProbes: true })
  check(!b2.selection || b2.selection.backendId !== 'markdown', '工作区已空时那份记忆视为过期（H 不回答，不发一个记着的后端出去）—— 实得「' + (b2.selection && b2.selection.backendId) + '」')
  const keptAfter = await store2.getWorkspace(empty)
  check(keptAfter.found === true && keptAfter.backendId === 'markdown', '工作区已空也不动 H 的内容（只是这一轮不拿它回答）—— 实得 ' + JSON.stringify(keptAfter))

  // H 里那条后端今天不在注册表里 → 当没有
  const ws3 = makeWorkspace('# Issue tracker: GitHub\n')
  const home3 = makeDir('dsh-683-home-')
  fs.mkdirSync(path.join(home3, '.dsh', 'mattskillsdeck'), { recursive: true })
  const { hashWorkspaceKey } = await import(url('src/host/choiceStore.js'))
  const rec = { version: 1, workspaces: {}, layouts: {} }
  rec.workspaces[hashWorkspaceKey(ws3)] = { backendId: 'gitlab', rev: 3, pickedAt: 1758500000000, source: 'user' }
  fs.writeFileSync(path.join(home3, '.dsh', 'mattskillsdeck', 'choices.json'), JSON.stringify(rec), 'utf8')
  const store3b = createChoiceStore({ homeDir: home3, isKnownBackend: (id) => id === 'github' || id === 'markdown' })
  const svc3 = makeService(store3b)
  const b3 = await svc3.detect({ cwd: ws3 }, { skipSkillProbes: true })
  check(b3.selection && b3.selection.backendId === 'github', 'H 里那条后端今天不在注册表里时当没有（落回锚文件，不发一个没有模块的后端）—— 实得「' + (b3.selection && b3.selection.backendId) + '」')
}

// ── C R2c：缓存里的选择随那份记忆变旧就必须重算 ─────────────────────────────────────
console.log('')
console.log('== C R2c：缓存里的选择随那份记忆变旧就必须重算 ==')
{
  const ws = makeWorkspace(null)
  fs.writeFileSync(path.join(ws, 'README.md'), 'x', 'utf8')
  const store = makeStore(['github', 'markdown'])
  const wsStore = makeWsStore()
  const svc = makeService(store, wsStore)
  await store.rememberWorkspace(ws, 'markdown') // rev 推到 1
  const c1 = await svc.detect({ cwd: ws }, { skipSkillProbes: true })
  check(!(c1.selection && c1.selection.backendId), '（布置）H 里记着 markdown 时判定也不再拿它回答（#1003 契约：记忆只用来生成一次文件）—— 实得「' + (c1.selection && c1.selection.backendId) + '」')
  const bumped = await store.rememberWorkspace(ws, 'github') // 别的壳把它改成了 github，rev 推到 2
  const c2 = await svc.detect({ cwd: ws }, { skipSkillProbes: true })
  check(!(c2.selection && c2.selection.backendId), '别的壳改过 H 之后同样不回答（判定不看它，所以改它也不影响结论）—— 实得「' + (c2.selection && c2.selection.backendId) + '」')
  check((bumped.rev || 0) > 1, '（布置）H 的修订号确实推到了 2 —— 实得 rev=' + bumped.rev)
  // 甲：手改配置文件即时生效 —— 先落到「没有答案」，文件里手写 markdown，下一轮必须按文件的来（缓存不许挡住）
  fs.mkdirSync(path.join(ws, 'docs', 'agents'), { recursive: true })
  fs.writeFileSync(path.join(ws, 'docs', 'agents', 'workspace.json'), '{"version":1,"backendId":"markdown","pickedAt":1758500000000,"source":"user"}', 'utf8')
  const c3 = await svc.detect({ cwd: ws }, { skipSkillProbes: true })
  check(c3.selection && c3.selection.backendId === 'markdown', '手改配置文件后当轮即按文件的 markdown 回答（不被缓存挡住）—— 实得「' + (c3.selection && c3.selection.backendId) + '」')
}

// ── D R4：快照那几条路都要带权威选择 ───────────────────────────────────────────────────
console.log('')
console.log('== D R4：快照的短路路与 304 都要带权威 {selection, rev} ==')
{
  const { createSessionSnapshot } = await import(url('src/host/sessionSnapshot.js'))
  const cached = { ok: true, generatedMs: 1, maps: [{ number: 1, tickets: [] }], issues: [], labels: [], selection: { backendId: 'github', source: 'auto' } }
  const makeHost = function (sel) {
    const cache = { ts: Date.now(), snapshot: cached, error: null, cwd: 'D:\\ws' }
    return createSessionSnapshot({
      canonicalKey: async (c) => c,
      selectEarly: async () => sel,
      isComposerSelection: () => false,
      getTrackerRegistry: async () => ({ get: () => null, modules: () => [], describe: () => null }),
      getPlatform: async () => ({ fs: {}, path: { join: () => '' }, getHome: async () => '' }),
      ctx: { get: () => undefined },
      getCache: () => cache, setCache: (v) => { Object.assign(cache, v) }, CACHE_MS: 60000,
      cacheSnapshotIsCurrent: async () => false,
      upcaseSnapStates: (s) => s,
      computeLevels: () => ({ byNumber: {}, byKey: {} }),
      groupTickets: () => ({ total: 0, open: 0, closed: 0, frontier: 0, claimed: 0, blocked: 0, levels: [], levelOf: {} }),
      getRepoRoot: async () => 'D:\\ws', getRepoKey: async () => null,
      readDiskCache: async () => null, writeDiskCache: async () => {}, adoptSnapshot: (s) => s,
      detectionExec: async () => ({ stdout: '', stderr: '', code: 0 }), execProc: async () => ({ ok: false }),
      errText: () => '', DEFAULT_CWD: 'D:\\ws', hash8: (s) => String(s).slice(0, 8), logCtx: null,
    })
  }
  const d1 = await makeHost({ backendId: 'markdown', source: 'explicit', rev: 5 }).handleSnapshot({ cwd: 'D:\\ws' })
  check(d1 && d1.selection && d1.selection.backendId === 'markdown' && d1.rev === 5, '内存缓存短路：回包带的是这一轮的权威选择与修订号（不是缓存里那份旧的后端）—— 实得「' + (d1 && d1.selection && d1.selection.backendId) + '」rev=' + (d1 && d1.rev))
  check(d1 && d1.maps === cached.maps, '短路时交付的还是缓存里那份数据（同一个数据数组，没有重新拼）')
  const d2 = await makeHost({ backendId: 'github', source: 'auto' }).handleSnapshot({ cwd: 'D:\\ws' })
  check(d2 === cached, '选择没变时照旧返回缓存里那**同一个对象**（缓存优先那条纪律不许因为这一步被动到）')
  const d3 = await makeHost({ backendId: 'github', source: 'explicit', rev: 2 }).handleSnapshot({ cwd: 'D:\\ws' })
  check(d3 && d3.selection && d3.rev === 2, '同一个后端但修订号变了也要带上新修订号（别处又选过一次）—— 实得 rev=' + (d3 && d3.rev))
}

// ── E R7c：写记忆失败要如实交代 ────────────────────────────────────────────────────────
console.log('')
console.log('== E R7c：写失败如实回 ==')
{
  // R7c：记忆写失败要如实回 persisted:false
  const { createWorkspaceCwd } = await import(url('src/host/workspaceCwd.js'))
  const mkBind = function (storeLike) {
    return createWorkspaceCwd({
      ctx: { get: () => undefined }, DEFAULT_CWD: 'D:\\ws',
      getPlatform: async () => ({ fs: {}, path: path, getHome: async () => '' }),
      getTrackerRegistry: async () => ({ has: () => true, bind: () => {}, get: () => null, describe: () => null }),
      getWorkspaceStore: async () => ({ invalidate: () => {} }),
      getChoiceStore: async () => storeLike,
      canonicalKey: async (c) => c, setCache: () => {}, timer: { timeout: () => null }, detectionExec: async () => ({}), logCtx: null,
    })
  }
  const okStore = { rememberWorkspace: async () => ({ ok: true, rev: 3 }) }
  const failStore = { rememberWorkspace: async () => ({ ok: false, reason: 'write-fail' }) }
  const e1 = await mkBind(okStore).handleBind({ cwd: 'D:\\ws', backendId: 'github' })
  check(e1.ok === true && e1.rev === 3 && e1.persisted === true, '绑定成功时回包带上了宿主发的修订号与 persisted:true（加字段不改形状）—— 实得 rev=' + e1.rev + ' persisted=' + e1.persisted)
  const e2 = await mkBind(failStore).handleBind({ cwd: 'D:\\ws', backendId: 'github' })
  check(e2.ok === true && e2.persisted === false, '记忆写失败时绑定照旧成功，但如实回 persisted:false（界面据此说一句，不许无声失败）—— 实得 ' + JSON.stringify({ ok: e2.ok, persisted: e2.persisted, rev: e2.rev }))
  const e3 = await mkBind(null).handleBind({ cwd: 'D:\\ws', backendId: 'github' })
  check(e3.ok === true && e3.persisted === false && e3.rev === 0, '没有可用的记忆库时也照旧绑定成功、如实回 persisted:false —— 实得 ' + JSON.stringify({ ok: e3.ok, persisted: e3.persisted }))
}

// ── G R6：布局答案那条电话（写进 H、读出来）────────────────────────────────────────────────
console.log('')
console.log('== G R6：wf.setupLayout 写进 H、读得出来；卡片确认与快照都接上了 ==')
{
  const { createWorkspaceCwd } = await import(url('src/host/workspaceCwd.js'))
  const home = makeDir('dsh-683-layout-')
  const store = createChoiceStore({ homeDir: home, isKnownBackend: () => true })
  const ws = makeWorkspace(null)
  const api = createWorkspaceCwd({
    ctx: { get: () => undefined }, DEFAULT_CWD: 'D:\\ws',
    getPlatform: async () => ({ fs: {}, path: path, getHome: async () => '' }),
    getTrackerRegistry: async () => ({ has: () => true, bind: () => {}, get: () => null, describe: () => null }),
    getWorkspaceStore: async () => ({ invalidate: () => {} }),
    getChoiceStore: async () => store,
    canonicalKey: async (c) => c, setCache: () => {}, timer: { timeout: () => null }, detectionExec: async () => ({}), logCtx: null,
  })
  const g1 = await api.handleSetupLayout({ cwd: ws, layout: 'multi' })
  check(g1.ok === true && g1.layout === 'multi' && typeof g1.pickedAt === 'number', '卡片确认打过去 → 写进 H，回包带上取值与时刻 —— 实得 ' + JSON.stringify(g1))
  const got = await store.getLayout(ws)
  check(got.found === true && got.layout === 'multi', 'H 里确实落下了这条（与后端记录同一种形状）')
  const g2 = await api.handleSetupLayout({ cwd: ws })
  check(g2.ok === true && g2.layout === 'multi' && typeof g2.pickedAt === 'number', '没给 layout 就是读：新壳第一次打开靠这一问知道上次选了哪个 —— 实得 ' + JSON.stringify(g2))
  const g3 = await api.handleSetupLayout({ cwd: ws, layout: '不认识' })
  check(g3.ok === false, '不认识的取值不写进去（如实回不成）—— 实得 ' + JSON.stringify(g3))
  const g4 = await api.handleSetupLayout({ cwd: makeWorkspace(null) })
  check(g4.ok === true && g4.layout === null, '没记过的 workspace 读回来是 null（不当成有）')
  // 接线都在场：卡片确认打电话、电话注册了、快照带着这个字段、客户端回填了它。
}

// ── F 反证 ───────────────────────────────────────────────────────────────────────
console.log('')
console.log('== F 反证：把实现做坏，上面该红的必须当场红 ==')
const detectionSrc = read('src/host/tracker/detection/detectionService.js')
const snapSrc = read('src/host/sessionSnapshot.js')
{
  // F1 上报优先级加回来（老路径复活）→ A 组第一条变红
  const from = 'let selection = explicitRes.selection'
  const to = "let selection = (opts && opts.hintBackendId && registry && typeof registry.has === 'function' && registry.has(opts.hintBackendId)) ? { backendId: opts.hintBackendId, source: 'explicit', ref: null } : explicitRes.selection"
  check(detectionSrc.includes(from), '反证 F1 的改法能在真源里落地（上报优先级加回来）')
  if (detectionSrc.includes(from)) {
    // 改坏的那一份**真的求值出来跑**：剥掉那两行 import，改由参数注入（两件都取真身）——
    //   与 tests/verify-669-choice-precedence.js 同一种写法（只比字符串不等却仍跑真源，等于这道反证是假的）。
    const { detectExplicit } = await import(url('src/host/tracker/detection/explicitDetector.js'))
    const { canonicalWorkspaceKey } = await import(url('src/host/workspaceKey.js'))
    const body = detectionSrc.replace(from, to)
      .replace(/^import[^\n]*\n/gm, '')
      .replace(/^export default createDetectionService[^\n]*\n?/gm, '')
      .replace(/^[ \t]*export[ \t]+/gm, '')
    // 这里选 compileFn：与 verify-669-choice-precedence.js 同一种写法，两个依赖名逐个传给共用入口，改坏的那段源码文本原样。
    const createBroken = compileFn(['detectExplicit', 'canonicalWorkspaceKey'], body + '\n;return createDetectionService')(detectExplicit, canonicalWorkspaceKey)
    const ws = makeWorkspace('# Issue tracker: GitHub\n')
    const store = makeStore(['github', 'markdown'])
    await store.rememberWorkspace(ws, 'markdown')
    await store.rememberWorkspace(ws, 'github') // rev 推到 2
    const registry = createRegistry(undefined, { matchesTimeout: 500 })
    const mk = (id) => ({ id: id, label: id, create: () => ({ ok: true }), matches: async () => false, describe: () => ({ backend: id, refId: id, name: id, url: '' }) })
    registry.register(mk('github')); registry.register(mk('markdown'))
    const platform = { fs: { resolve: async (rel, o) => path.resolve((o && o.cwd) || '.', rel), readText: async (p) => fs.readFileSync(p, 'utf8'), lstat: async (p) => fs.lstatSync(p), stat: async (p) => fs.statSync(p), readdir: async (p) => fs.readdirSync(p) }, path: path }
    const svc = createBroken({ registry, getPlatform: async () => platform, getFs: () => platform.fs, getTimers: () => null, workspaceStore: null, getChoiceStore: async () => store, exec: null })
    const r = await svc.detect({ cwd: ws }, { skipSkillProbes: true, hintBackendId: 'markdown', baseRev: 1 })
    check(r.selection && r.selection.backendId === 'markdown', '反证 F1 成立：上报优先级加回来之后，带上报又压过锚文件（正是老路径要结束的那件事）—— 实得「' + (r.selection && r.selection.backendId) + '」')
    const svcTrue = createDetectionService({ registry, getPlatform: async () => platform, getFs: () => platform.fs, getTimers: () => null, workspaceStore: null, getChoiceStore: async () => store, exec: null })
    const rTrue = await svcTrue.detect({ cwd: ws }, { skipSkillProbes: true, hintBackendId: 'markdown', baseRev: 1 })
    check(rTrue.selection && rTrue.selection.backendId === 'github', '（对照）真源里带上报时仍是锚文件的 github —— 实得「' + (rTrue.selection && rTrue.selection.backendId) + '」')
  }
  // F2 短路路不再带上权威选择 —— 跑改坏的那一份，同一份现场就会把旧后端发出去
  const from2 = 'if (sameBackend && prevRev === nowRev && (sameLayout || !_layEarly)) return s'
  check(snapSrc.includes(from2), '反证 F2 的改法能在真源里落地（短路路永远返回缓存里那份、不带新选择）')
  if (snapSrc.includes(from2)) {
    const broken2 = path.join(makeDir('dsh-683-broken2-'), 'sessionSnapshot.mjs')
    fs.writeFileSync(broken2, snapSrc.replace(from2, 'return s'), 'utf8')
    // 这一组跑的是把源文件**复制到临时目录**再改坏的一份。复制过去的那一份，它 import 的兄弟文件
    //   也在新目录里找 —— 所以兄弟文件必须一起带过去，否则这一组连求值都到不了，先在解析阶段就报
    //   ERR_MODULE_NOT_FOUND（那是夹具缺件，不是实现错）。
    //   #723（T19）把快照电话拆了：信封组装搬到了同目录的 ./snapshotEnvelope.js，就是这一次踩到的。
    //   按真源里那些相对 import 逐个带，以后谁再拆一次也不用回来改这里。
    const siblingRe = /^[ \t]*import[^\n]*from[ \t]*['"](\.\/[^'"]+)['"]/gm
    let sm
    while ((sm = siblingRe.exec(snapSrc)) !== null) {
      const fromPath = path.join(ROOT, 'src', 'host', sm[1].replace(/^\.\//, ''))
      if (!fs.existsSync(fromPath)) continue
      fs.copyFileSync(fromPath, path.join(path.dirname(broken2), path.basename(fromPath)))
    }
    const mod2 = await import(pathToFileURL(broken2).href)
    const cached = { ok: true, generatedMs: 1, maps: [], issues: [], labels: [], selection: { backendId: 'github', source: 'auto' } }
    const cache = { ts: Date.now(), snapshot: cached, error: null, cwd: 'D:\\ws' }
    const h = mod2.createSessionSnapshot({
      canonicalKey: async (c) => c, selectEarly: async () => ({ backendId: 'markdown', source: 'explicit', rev: 5 }), isComposerSelection: () => false,
      getTrackerRegistry: async () => ({ get: () => null, modules: () => [], describe: () => null }), getPlatform: async () => ({ fs: {}, path: { join: () => '' }, getHome: async () => '' }),
      ctx: { get: () => undefined }, getCache: () => cache, setCache: (v) => { Object.assign(cache, v) }, CACHE_MS: 60000, cacheSnapshotIsCurrent: async () => false,
      upcaseSnapStates: (s) => s, computeLevels: () => ({ byNumber: {}, byKey: {} }), groupTickets: () => ({ total: 0, open: 0, closed: 0, frontier: 0, claimed: 0, blocked: 0, levels: [], levelOf: {} }),
      getRepoRoot: async () => 'D:\\ws', getRepoKey: async () => null, readDiskCache: async () => null, writeDiskCache: async () => {}, adoptSnapshot: (s) => s,
      detectionExec: async () => ({ stdout: '', stderr: '', code: 0 }), execProc: async () => ({ ok: false }), errText: () => '', DEFAULT_CWD: 'D:\\ws', hash8: (s) => s, logCtx: null,
    })
    const r = await h.handleSnapshot({ cwd: 'D:\\ws' })
    check(r === cached && r.selection.backendId === 'github', '反证 F2 成立：短路路不带新选择时，回包里那条还是旧后端 github（面板头照旧显示旧的，正是 R4 要结束的那件事）—— 实得「' + r.selection.backendId + '」')
  }
}

for (const d of tmpDirs) { try { fs.rmSync(d, { recursive: true, force: true }) } catch (e) {} }
console.log('')
console.log(failed ? '存在失败 — verify-683-host-wiring 未通过（' + passed + ' 项通过、' + failed + ' 项失败）' : '全部通过 — 宿主接线门禁生效（' + passed + ' 项断言）')
process.exit(failed ? 1 : 0)
