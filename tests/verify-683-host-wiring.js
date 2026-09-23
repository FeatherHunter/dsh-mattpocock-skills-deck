#!/usr/bin/env node
/**
 * verify-683-host-wiring.js —— F1「用户选的后端按工作区存一份在宿主侧」的宿主接线门禁（#683）
 *
 * 量的是 ADR docs/adr/20260921-persist-user-choice-host-side.md 第 8 节里属于「接上判定链」的那几组：
 *   A R3 四档：H（宿主侧那份记忆）里没有这条 → 采纳客户端报上来的选择并写进 H（一次性迁移）；
 *     baseRev 与 H 的修订号相等 → 采纳；更旧或没带 → 被 H 顶回、按 H 回答；没报选择 → 按 H 回答；
 *     H 里没有、也没报 → 照旧落回锚文件。
 *   B R5c/R10：文件坏的那一轮既不采纳也不写；工作区已空时记忆视为过期（H 不回答，内容不动）；
 *     H 里那条后端今天不在注册表里 → 当没有。
 *   C R4：快照那三条短路路径与 304 都要带权威 {selection, rev}（只换了后端时客户端才不会继续显示旧后端）。
 *   D R1（静态）：全仓只有两处会写 H —— 用户点确认那通 wf.bind、以及档一那次一次性迁移。
 *   E R7c：H 写失败要如实回 persisted:false（不许无声失败）。
 *   F 反证：把实现做坏（把「没带版本位就采纳」写回去、把 H 放在选择之后、把短路路的 selection 摘掉），
 *     对应的断言必须当场红。
 *
 * 用法：node tests/verify-683-host-wiring.js
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

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
  return createDetectionService({ registry, getPlatform: async () => platform, getFs: () => platform.fs, getTimers: () => null, workspaceStore: wsStore || null, getChoiceStore: async () => store, exec: null })
}
const makeWsStore = function () {
  const m = new Map()
  return { get: (h) => m.get(h.cwd || ''), set: (h, v) => { m.set(h.cwd || '', v) }, invalidate: (h) => { m.delete(h.cwd || '') }, clear: () => m.clear() }
}

console.log('宿主接线门禁（#683 F1：四档判定、坏文件与空工作区、每条回包都带权威选择、只有两处写记忆）')

// ── A R3 四档 ─────────────────────────────────────────────────────────────────────
console.log('')
console.log('== A R3 四档：谁说话 ==')
{
  // 档一：H 里没有这条 → 采纳客户端报上来的选择，并写进 H（一次性迁移），答复带新的修订号
  const ws = makeWorkspace('# Issue tracker: GitHub\n')
  const store = makeStore(['github', 'markdown'])
  const svc = makeService(store)
  const a1 = await svc.detect({ cwd: ws }, { skipSkillProbes: true, hintBackendId: 'markdown', baseRev: 0 })
  check(a1.selection && a1.selection.backendId === 'markdown', '档一：H 里没有这条时采纳客户端报上来的选择（锚文件写着 GitHub）—— 实得「' + (a1.selection && a1.selection.backendId) + '」')
  check(a1.rev === 1 && a1.selection.rev === 1, '档一：这条同时被写进 H（一次性迁移），宿主发号 rev=1 并随答复回去 —— 实得 rev=' + a1.rev)
  const stored = await store.getWorkspace(ws)
  check(stored.found === true && stored.backendId === 'markdown' && stored.rev === 1, '档一：H 里确实落下了这条（后端 + rev）—— 实得 ' + JSON.stringify(stored))

  // 档二：baseRev 与 H 的修订号相等 → 采纳客户端那条
  const a2 = await svc.detect({ cwd: ws }, { skipSkillProbes: true, hintBackendId: 'markdown', baseRev: 1 })
  check(a2.selection && a2.selection.backendId === 'markdown' && a2.rev === 1, '档二：版本位对得上时采纳客户端那条、答复带同一个修订号 —— 实得 rev=' + a2.rev)

  // 档三：客户端手里那份更旧（或没带版本位）→ 不采纳，按 H 回答
  const bumped = await store.rememberWorkspace(ws, 'github') // 别的壳把它改成了 github，rev 推到 2
  check(bumped.ok === true && bumped.rev === 2, '（布置）另一个壳把这个工作区改成了 github，H 的修订号推到 2 —— 实得 rev=' + bumped.rev)
  const a3 = await svc.detect({ cwd: ws }, { skipSkillProbes: true, hintBackendId: 'markdown', baseRev: 1 })
  check(a3.selection && a3.selection.backendId === 'github', '档三：客户端手里是旧的那一版时**不采纳**它，按 H 回答（这就是「localStorage 还是老状态时不许说话」）—— 实得「' + (a3.selection && a3.selection.backendId) + '」')
  check(a3.rev === 2, '档三：答复带的是 H 的修订号（客户端据此覆盖本地那份）—— 实得 rev=' + a3.rev)
  const a3b = await svc.detect({ cwd: ws }, { skipSkillProbes: true, hintBackendId: 'markdown' })
  check(a3b.selection && a3b.selection.backendId === 'github', '档三（没带版本位的老客户端）：同样被 H 顶回 —— 实得「' + (a3b.selection && a3b.selection.backendId) + '」')

  // 档四：客户端没报选择（新壳、清了缓存、换了访问地址）→ 按 H 回答
  const a4 = await svc.detect({ cwd: ws }, { skipSkillProbes: true })
  check(a4.selection && a4.selection.backendId === 'github' && a4.rev === 2, '档四：客户端什么都没报时按 H 回答（跨壳、跨重启不失忆的那一半）—— 实得「' + (a4.selection && a4.selection.backendId) + '」rev=' + a4.rev)

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

// ── C R2c：带 hint 的那一次结果不许当通用答案端出去 ─────────────────────────────────────
console.log('')
console.log('== C R2c：缓存里的选择随那份记忆变旧就必须重算 ==')
{
  const ws = makeWorkspace('# Issue tracker: GitHub\n')
  const store = makeStore(['github', 'markdown'])
  const wsStore = makeWsStore()
  const svc = makeService(store, wsStore)
  const c1 = await svc.detect({ cwd: ws }, { skipSkillProbes: true, hintBackendId: 'markdown', baseRev: 0 })
  check(c1.selection && c1.selection.backendId === 'markdown', '（布置）第一次带 hint 的探测结论是 markdown')
  const bumped = await store.rememberWorkspace(ws, 'github')
  const c2 = await svc.detect({ cwd: ws }, { skipSkillProbes: true })
  check(c2.selection && c2.selection.backendId === 'github' && c2.rev === (bumped.rev || 0), '别的壳改过 H 之后，第二次（没带 hint）读缓存也要重算、按新的 H 回答 —— 实得「' + (c2.selection && c2.selection.backendId) + '」rev=' + c2.rev)
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

// ── E R1 静态 + R7c：写记忆的两处与写失败的如实交代 ──────────────────────────────────────
console.log('')
console.log('== E R1（静态）与 R7c：只有两处写记忆；写失败如实回 ==')
{
  const callers = []
  const walk = function (dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) { walk(p); continue }
      if (!e.name.endsWith('.js')) continue
      const rel = path.relative(ROOT, p).split(path.sep).join('/')
      read(rel).split(/\r?\n/).forEach(function (line, i) {
        if (/rememberWorkspace\s*\(/.test(line) && !/function rememberWorkspace|choiceStore\.js/.test(line) && rel !== 'src/host/choiceStore.js') callers.push(rel + ':' + (i + 1))
      })
    }
  }
  walk(path.join(ROOT, 'src'))
  const allowed = ['src/host/workspaceCwd.js', 'src/host/tracker/detection/detectionService.js']
  const bad = callers.filter((c) => allowed.indexOf(c.split(':')[0]) < 0)
  check(bad.length === 0, '全仓只有两处会往那份记忆里写（用户点确认那通 wf.bind、以及档一那次一次性迁移）—— 多出来的：' + (bad.join('、') || '无'))
  check(callers.length === 2, '这两处都在场、各一处（实得 ' + callers.length + ' 处：' + callers.join('、') + '）')

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
  check(/host\.call\('wf\.setupLayout'/.test(read('src/client/statusbar/StatusBackend.js')), '卡片确认（confirmStatusSetupPick）同时打 wf.setupLayout（写 H 与写 C 在同一处）')
  check(/harness\.handle\('wf\.setupLayout'/.test(read('src/host/index.js')), 'wf.setupLayout 注册了（电话总数门禁见 verify-log-coverage）')
  check(/setupLayout: _layEarly/.test(read('src/host/sessionSnapshot.js')), '快照带着记住的布局（四处组装点都带，落后的窗靠它跟上）')
  check(/setCachedSetupLayout\(st\.cwd, snap\.setupLayout\)/.test(read('src/client/kernel/probe-snapshot.js')), '客户端拿到快照就回填本地那份镜像')
}

// ── F 反证 ───────────────────────────────────────────────────────────────────────
console.log('')
console.log('== F 反证：把实现做坏，上面该红的必须当场红 ==')
const detectionSrc = read('src/host/tracker/detection/detectionService.js')
const snapSrc = read('src/host/sessionSnapshot.js')
{
  // F1 把「没带版本位就采纳」写回去（档三失效）
  const from = '} else if (hintUsable && h.found && hintRev !== h.rev) {'
  const to = '} else if (false) {'
  check(detectionSrc.includes(from), '反证 F1 的改法能在真源里落地（把「被 H 顶回」那一档关掉）')
  if (detectionSrc.includes(from)) {
    // 改坏的那一份**真的求值出来跑**：剥掉那两行 import，改由参数注入（两件都取真身）——
    //   与 tests/verify-669-choice-precedence.js 同一种写法（只比字符串不等却仍跑真源，等于这道反证是假的）。
    const { detectExplicit } = await import(url('src/host/tracker/detection/explicitDetector.js'))
    const { canonicalWorkspaceKey } = await import(url('src/host/workspaceKey.js'))
    const body = detectionSrc.replace(from, to)
      .replace(/^import[^\n]*\n/gm, '')
      .replace(/^export default createDetectionService[^\n]*\n?/gm, '')
      .replace(/^[ \t]*export[ \t]+/gm, '')
    const createBroken = new Function('detectExplicit', 'canonicalWorkspaceKey', body + '\n;return createDetectionService')(detectExplicit, canonicalWorkspaceKey)
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
    check(r.selection && r.selection.backendId === 'markdown', '反证 F1 成立：关掉那一档之后，旧的那一版又把新的顶掉了（正是本票要避免的错乱）—— 实得「' + (r.selection && r.selection.backendId) + '」')
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
