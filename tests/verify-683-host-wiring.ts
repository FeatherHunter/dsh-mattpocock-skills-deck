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
 * 用法：node tests/verify-683-host-wiring.ts
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
// 按文本求值走共用入口，理由与用法见 tests/lib/eval-probe.js 文件头。
import { compileFn } from './lib/eval-probe.js'

const ROOT = path.resolve(import.meta.dirname, '..')
const url = (rel: string): string => pathToFileURL(path.join(ROOT, rel)).href
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8')
let passed = 0
let failed = 0
const check = (ok: unknown, msg: string): void => { if (ok) { console.log('  PASS ' + msg); passed++ } else { console.log('  FAIL ' + msg); failed++ } }
const tmpDirs: string[] = []
const makeDir = function (tag: string): string { const d = fs.mkdtempSync(path.join(os.tmpdir(), tag)); tmpDirs.push(d); return d }

const { createDetectionService } = await import(url('src/tracker/detection/detectionService.ts'))
const { createRegistry } = await import(url('src/tracker/registry/core.ts'))
const { createChoiceStore } = await import(url('src/host/choiceStore.ts'))
const { decideBackend: outletDecideBackend, selectionFromOutlet: outletSelectionFromOutlet } = await import(url('src/tracker/detection/backendDecision.ts'))
try { outletDecideBackend.selectionFromOutlet = outletSelectionFromOutlet } catch (eAttachOutlet683) {}

// 现场：一个工作区目录（可选放一份锚文件，写着 GitHub），一份真 choiceStore（落在临时主目录上）。
const makeWorkspace = function (anchor: string | null): string {
  const dir = makeDir('dsh-683-ws-')
  if (anchor) {
    fs.mkdirSync(path.join(dir, 'docs', 'agents'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'docs', 'agents', 'issue-tracker.md'), anchor, 'utf8')
  }
  return dir
}
const makeStore = function (keys: string[]) {
  const home = makeDir('dsh-683-home-')
  return createChoiceStore({ homeDir: home, isKnownBackend: function (id: string) { return keys.indexOf(id) >= 0 } })
}
const makeService = function (store: any, wsStore?: any) {
  const registry = createRegistry(undefined, { matchesTimeout: 500 })
  // 假后端只用来走宿主接线，不会被真正调用，所以按离网口径声明（注册表只验形状，不按口径限流）。
  const mk = (id: string) => ({ id: id, label: id, budget: { kind: 'off-network', countsRequests: false, countsPoints: false, independentBuckets: false }, create: () => ({ ok: true }), matches: async () => false, describe: () => ({ backend: id, refId: id + '-ref', name: id + '-ref', url: '' }) })
  registry.register(mk('github'))
  registry.register(mk('markdown'))
  const platform = {
    fs: {
      resolve: async (rel: string, o: any) => path.resolve((o && o.cwd) || '.', rel),
      readText: async (p: string) => fs.readFileSync(p, 'utf8'),
      lstat: async (p: string) => { try { return fs.lstatSync(p) } catch (e) { throw e } },
      stat: async (p: string) => { try { return fs.statSync(p) } catch (e) { throw e } },
      readdir: async (p: string) => fs.readdirSync(p),
    },
    path: path,
  }
  return createDetectionService({ registry, getPlatform: async () => platform, getFs: () => platform.fs, getTimers: () => null, workspaceStore: wsStore || null, getChoiceStore: async () => store, exec: null, decideBackend: outletDecideBackend })
}
const makeWsStore = function () {
  const m = new Map()
  return { get: (h: any) => m.get(h.cwd || ''), set: (h: any, v: any) => { m.set(h.cwd || '', v) }, invalidate: (h: any) => { m.delete(h.cwd || '') }, clear: () => m.clear() }
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
  const { hashWorkspaceKey } = await import(url('src/host/choiceStore.ts'))
  const rec: { version: number; workspaces: Record<string, any>; layouts: Record<string, any> } = { version: 1, workspaces: {}, layouts: {} }
  rec.workspaces[hashWorkspaceKey(ws3)] = { backendId: 'gitlab', rev: 3, pickedAt: 1758500000000, source: 'user' }
  fs.writeFileSync(path.join(home3, '.dsh', 'mattskillsdeck', 'choices.json'), JSON.stringify(rec), 'utf8')
  const store3b = createChoiceStore({ homeDir: home3, isKnownBackend: (id: string) => id === 'github' || id === 'markdown' })
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
  const { createSessionSnapshot } = await import(url('src/refresh/rooms/host/session-snapshot-cache.ts'))
  const cached = { ok: true, generatedMs: 1, maps: [{ number: 1, tickets: [] }], issues: [], labels: [], selection: { backendId: 'github', source: 'auto' } }
  const makeHost = function (sel: any) {
    const cache = { ts: Date.now(), snapshot: cached, error: null, cwd: 'D:\\ws' }
    return createSessionSnapshot({
      canonicalKey: async (c: any) => c,
      selectEarly: async () => sel,
      isComposerSelection: () => false,
      getTrackerRegistry: async () => ({ get: () => null, modules: () => [], describe: () => null }),
      getPlatform: async () => ({ fs: {}, path: { join: () => '' }, getHome: async () => '' }),
      ctx: { get: () => undefined },
      getCache: () => cache, setCache: (v: any) => { Object.assign(cache, v) }, CACHE_MS: 60000,
      cacheSnapshotIsCurrent: async () => false,
      upcaseSnapStates: (s: any) => s,
      computeLevels: () => ({ byNumber: {}, byKey: {} }),
      groupTickets: () => ({ total: 0, open: 0, closed: 0, frontier: 0, claimed: 0, blocked: 0, levels: [], levelOf: {} }),
      getRepoRoot: async () => 'D:\\ws', getRepoKey: async () => null,
      readDiskCache: async () => null, writeDiskCache: async () => {}, adoptSnapshot: (s: any) => s,
      detectionExec: async () => ({ stdout: '', stderr: '', code: 0 }), execProc: async () => ({ ok: false }),
      errText: () => '', DEFAULT_CWD: 'D:\\ws', hash8: (s: any) => String(s).slice(0, 8), logCtx: null,
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
  // R7c：记忆（H）写失败要如实回 persisted:false。
  //   #1138：写工作区文件这一步必须先成功 —— 那才是「这次选择生效」的标志；H 只是备份，
  //   它写不成照旧回 persisted:false 如实说（界面据此出一句信息级提示）。所以夹具要给一条
  //   真能写的文件通道（临时目录 + 真文件），否则 bind 会先因为文件写不成而如实失败。
  const { createWorkspaceCwd } = await import(url('src/host/workspaceCwd.js'))
  const fsSvcOf = function (dir: string) {
    return {
      async resolve(p: unknown, o: any) { const cwd = (o && o.cwd) || ''; const rel = String(p || '').replace(/\\/g, '/'); return cwd ? String(cwd).replace(/\\/g, '/') + '/' + rel : rel },
      async readText(t: string) { return fs.readFileSync(t, 'utf8') },
      async writeText(t: string, c: unknown) { fs.mkdirSync(path.dirname(t), { recursive: true }); fs.writeFileSync(t, String(c), 'utf8') },
      async mkdir(d: string) { fs.mkdirSync(d, { recursive: true }) },
    }
  }
  const bindIn = async function (storeLike: any, backendId: string) {
    const dir = makeDir('v683e-')
    const api = createWorkspaceCwd({
      ctx: { get: () => undefined }, DEFAULT_CWD: dir,
      getPlatform: async () => ({ fs: fsSvcOf(dir), path: path, getHome: async () => '' }),
      getTrackerRegistry: async () => ({ has: () => true, get: () => null, describe: () => null }),
      getWorkspaceStore: async () => ({ invalidate: () => {} }),
      getChoiceStore: async () => storeLike,
      canonicalKey: async (c: any) => c, setCache: () => {}, timer: { timeout: () => null }, detectionExec: async () => ({}), logCtx: null,
    })
    return await api.handleBind({ cwd: dir, backendId: backendId })
  }
  const okStore = { rememberWorkspace: async () => ({ ok: true, rev: 3 }) }
  const failStore = { rememberWorkspace: async () => ({ ok: false, reason: 'write-fail' }) }
  const e1 = await bindIn(okStore, 'github')
  check(e1.ok === true && e1.rev === 3 && e1.persisted === true, '绑定成功时回包带上了宿主发的修订号与 persisted:true（加字段不改形状）—— 实得 rev=' + e1.rev + ' persisted=' + e1.persisted)
  const e2 = await bindIn(failStore, 'github')
  check(e2.ok === true && e2.persisted === false, '记忆写失败时这次选择照旧生效（工作区文件写成了），但如实回 persisted:false（界面据此说一句，不许无声失败）—— 实得 ' + JSON.stringify({ ok: e2.ok, persisted: e2.persisted, rev: e2.rev }))
  const e3 = await bindIn(null, 'github')
  check(e3.ok === true && e3.persisted === false && e3.rev === 0, '没有可用的记忆库时也照旧生效、如实回 persisted:false —— 实得 ' + JSON.stringify({ ok: e3.ok, persisted: e3.persisted }))
}

// ── G 布局答案那条电话（#1449：只写/只读工作区文件，不再写 H）──────────────────────────────
console.log('')
console.log('== G wf.setupLayout 只写/只读工作区文件 ==')
{
  const { createWorkspaceCwd } = await import(url('src/host/workspaceCwd.js'))
  const ws = makeWorkspace(null)
  const wsFile = path.join(ws, 'docs', 'agents', 'workspace.yaml')
  fs.mkdirSync(path.dirname(wsFile), { recursive: true })
  fs.writeFileSync(wsFile, 'version: 2\nbackendId: github\npickedAt: 1\nsource: user\n', 'utf8')
  const fsSvc = {
    async resolve(p: unknown, o: any) { const cwd = (o && o.cwd) || ''; const rel = String(p || '').replace(/\\/g, '/'); return cwd ? String(cwd).replace(/\\/g, '/') + '/' + rel : rel },
    async readText(t: string) { return fs.readFileSync(t, 'utf8') },
    async writeText(t: string, c: unknown) { fs.mkdirSync(path.dirname(t), { recursive: true }); fs.writeFileSync(t, String(c), 'utf8') },
    async mkdir(d: string) { fs.mkdirSync(d, { recursive: true }) },
  }
  const mkApi = (fsOf: any) => createWorkspaceCwd({
    ctx: { get: () => undefined }, DEFAULT_CWD: 'D:\\ws',
    getPlatform: async () => ({ fs: fsOf, path: path, getHome: async () => '' }),
    getTrackerRegistry: async () => ({ has: () => true, bind: () => {}, get: () => null, describe: () => null }),
    getWorkspaceStore: async () => ({ invalidate: () => {} }),
    getChoiceStore: async () => null,
    canonicalKey: async (c: any) => c, setCache: () => {}, timer: { timeout: () => null }, detectionExec: async () => ({}), logCtx: null,
  })
  const api = mkApi(fsSvc)
  const g1 = await api.handleSetupLayout({ cwd: ws, layout: 'multi' })
  check(g1.ok === true && g1.workspaceFile === 'written' && g1.layout === 'multi', '文件通道可用时卡片确认写进工作区文件 —— 实得 ' + JSON.stringify(g1))
  check(/layout: multi/.test(fs.readFileSync(wsFile, 'utf8')), '文件里确实出现 layout: multi')
  const g2 = await api.handleSetupLayout({ cwd: ws })
  check(g2.ok === true && g2.layout === 'multi' && g2.pickedAt === 0, '没给 layout 就是读：从工作区文件读回 multi —— 实得 ' + JSON.stringify(g2))
  fs.writeFileSync(wsFile, 'version: 2\nbackendId: github\npickedAt: 1\nsource: user\n', 'utf8')
  const g3 = await api.handleSetupLayout({ cwd: ws })
  check(g3.ok === true && g3.layout === null, '文件里没有布局时读回来是 null（还没答过，不是本机记忆里的旧值）—— 实得 ' + JSON.stringify(g3))
  const g4 = await api.handleSetupLayout({ cwd: ws, layout: '不认识' })
  check(g4.ok === false && g4.error === 'not-stored', '不认识的取值不写进去（如实回 not-stored）—— 实得 ' + JSON.stringify(g4))
  const g5 = await mkApi({}).handleSetupLayout({ cwd: ws, layout: 'multi' })
  check(g5.ok === false && g5.workspaceFile === 'no-channel' && /没有生效/.test(String(g5.error)), '文件通道不可用时如实回失败：这次选择没有生效（不再留本机备份）—— 实得 ' + JSON.stringify(g5))
}

// ── F 反证 ───────────────────────────────────────────────────────────────────────
console.log('')
console.log('== F 反证：把实现做坏，上面该红的必须当场红 ==')
const snapSrc = read('src/refresh/rooms/host/session-snapshot-cache.ts')
{
  // F1 上报优先级加回来（老路径复活）→ A 组第一条变红
  //   #1169：裁决顺序已经抽到 src/tracker/detection/selection-precedence.ts，这里不再把整份探测服务
  //   切碎了当场求值（那样这份服务就永远写不了类型标注）。反证改成直接问那条规则：把老路径的
  //   「上报优先」当成对照实现摆出来，同一组输入它给出 markdown；真源裁决顺序里没有「上报」这一格。
  {
    const { resolveSelection } = await import(url('src/tracker/detection/selection-precedence.ts'))
    const witness = { declared: null, outletConsulted: true, outlet: null, outletOrigin: 'none' }
    const hintFirst = (c: any) => (c.hint ? { backendId: c.hint, source: 'explicit' } : resolveSelection(c))
    check(hintFirst(Object.assign({}, witness, { hint: 'markdown' })).backendId === 'markdown', '反证 F1 成立：上报优先级加回来之后，无锚文件时同一组输入又变出 markdown（正是老路径要结束的那件事）')
    check(resolveSelection(Object.assign({}, witness, { hint: 'markdown' })).selection.backendId === null, '（对照）真源裁决顺序里没有「上报」这一格：把上报塞进来也不参与')
    const ws = makeWorkspace('# Issue tracker: GitHub\n')
    const store = makeStore(['github', 'markdown'])
    await store.rememberWorkspace(ws, 'markdown')
    await store.rememberWorkspace(ws, 'github') // rev 推到 2
    const registry = createRegistry(undefined, { matchesTimeout: 500 })
    // 这一组的假后端同样只走判定，不断言额度，所以按离网口径声明。
    const mk = (id: string) => ({ id: id, label: id, budget: { kind: 'off-network', countsRequests: false, countsPoints: false, independentBuckets: false }, create: () => ({ ok: true }), matches: async () => false, describe: () => ({ backend: id, refId: id, name: id, url: '' }) })
    registry.register(mk('github')); registry.register(mk('markdown'))
    const platform = { fs: { resolve: async (rel: string, o: any) => path.resolve((o && o.cwd) || '.', rel), readText: async (p: string) => fs.readFileSync(p, 'utf8'), lstat: async (p: string) => fs.lstatSync(p), stat: async (p: string) => fs.statSync(p), readdir: async (p: string) => fs.readdirSync(p) }, path: path }
    const svcTrue = createDetectionService({ registry, getPlatform: async () => platform, getFs: () => platform.fs, getTimers: () => null, workspaceStore: null, getChoiceStore: async () => store, exec: null })
    const rTrue = await svcTrue.detect({ cwd: ws }, { skipSkillProbes: true, hintBackendId: 'markdown', baseRev: 1 })
    check(rTrue.selection && rTrue.selection.backendId === 'github', '（对照）真源里带上报时仍是锚文件的 github —— 实得「' + (rTrue.selection && rTrue.selection.backendId) + '」')
  }
  // F2 短路路不再带上权威选择 —— 跑改坏的那一份，同一份现场就会把旧后端发出去
  // 合并 #1433 之后这一行只判 sameLayout（布局以这一轮为准：本轮没有布局就把缓存里那份旧答案抹掉，
  // 不再像 #683 早期那样用 !_layEarly 把旧答案留下）。反证的落点跟着真源走，形状不变。
  const from2 = 'if (sameBackend && prevRev === nowRev && sameLayout) return s'
  check(snapSrc.includes(from2), '反证 F2 的改法能在真源里落地（短路路永远返回缓存里那份、不带新选择）')
  if (snapSrc.includes(from2)) {
    // 这一组跑的是把源文件**复制到临时目录**再改坏的一份。复制过去的那一份，它 import 的兄弟文件
    //   也在新目录里找 —— 所以那份 import 闭包必须一起带过去，否则这一组连求值都到不了，先在解析阶段就报
    //   ERR_MODULE_NOT_FOUND（那是夹具缺件，不是实现错）。
    //   #723（T19）把快照电话拆了：信封组装搬到了同目录的 ./snapshotEnvelope.js，就是那一次踩到的。
    //   #1139 又从宿主跨目录引了 ../tracker/ui-description.js：所以这里改成按真源里**所有相对 import**
    //   （./ 与 ../ 都算）连目录结构一起镜像到夹具目录，以后谁再拆一次、再跨一次目录，都不用回来改这段。
    const mirror = makeDir('dsh-683-broken2-')
    // 夹具目录不在仓库里，被镜像过来的模块若 import 裸包（例如 shared 配置核 import 的 'yaml'），
    // 从临时目录向上找不到 node_modules。给夹具接一条指向仓库 node_modules 的 junction，
    // 让夹具与真源按同一套依赖求值；窗口下 junction 不需要管理员权限。
    try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(mirror, 'node_modules'), 'junction') } catch (eLink683) {}
    const mirrored = new Set()
    const mirrorOne = function (relFromSrc: string) {
      if (mirrored.has(relFromSrc)) return
      mirrored.add(relFromSrc)
      const fromPath = path.join(ROOT, 'src', relFromSrc)
      if (!fs.existsSync(fromPath)) return
      const toPath = path.join(mirror, relFromSrc)
      fs.mkdirSync(path.dirname(toPath), { recursive: true })
      fs.copyFileSync(fromPath, toPath)
      const text = fs.readFileSync(fromPath, 'utf8')
      // import 子句可能跨多行（import { 换行 若干项 换行 } from '...'）：从 import 起吃到 from，
      // 但不越过下一条 import，免得把无关的说明符串进来。#1433 之后快照文件多引了 workspace-anchor，
      // 它的 import 就是多行写法。
      const re = /^[ \t]*import\s+(?!type\b)(?:(?!^[ \t]*import\s)[\s\S])*?from[ \t]*['"](\.\.?\/[^'"]+)['"]/gm
      let im
      while ((im = re.exec(text)) !== null) {
        // 说明符写的是 .js，磁盘上住的常常是同名 .ts（ts-hook 的规则），两样都试一遍再镜像。
        // 2026-10-19 第三阶段起共享层的域产物搬到了仓库根的 .build/shared/ 下，源码树里对应的真源
        // 住在 <域>/src/ 里：夹具里那份被改坏的宿主模块 import 的仍是 <域>/<名>.js，装载钩子会把它
        // 按「<目标目录>/src/<名>.ts」回落解析，所以镜像也要照着这条回落把真源搬到同一形状的位置。
        const joined = path.posix.normalize(path.posix.join(path.posix.dirname(relFromSrc), im[1]))
        const underSrc = joined.replace(/^(shared\/[^/]+\/)([^/]+)\.js$/, '$1src/$2.ts')
        const cand = [joined.replace(/\.js$/, '.ts'), underSrc, joined]
        mirrorOne(cand.find(function (c) { return fs.existsSync(path.join(ROOT, 'src', c)) }) || joined)
      }
    }
    mirrorOne('refresh/rooms/host/session-snapshot-cache.ts')
    const broken2 = path.join(mirror, 'refresh', 'rooms', 'host', 'session-snapshot-cache.mjs')
    // 快照源文件是 .ts（#1155 起带类型标注）：写进 .mjs 之前先按仓库自己的转译口径剥掉类型，否则这一份
    //   改坏了的源码会在解析阶段就 SyntaxError，反证根本跑不到比较那一步。转译参数只写在
    //   scripts/lib/transpile-unit.mts 那一份，这里取现成的，与生产侧同一套口径。
    const { TRANSPILE_OPTIONS } = await import('../scripts/lib/transpile-unit.mts')
    const broken2Src = (await import('esbuild')).transformSync(snapSrc, TRANSPILE_OPTIONS).code
    fs.writeFileSync(broken2, broken2Src.replace(from2, 'return s'), 'utf8')
    const mod2 = await import(pathToFileURL(broken2).href)
    const cached = { ok: true, generatedMs: 1, maps: [], issues: [], labels: [], selection: { backendId: 'github', source: 'auto' } }
    const cache = { ts: Date.now(), snapshot: cached, error: null, cwd: 'D:\\ws' }
    const h = mod2.createSessionSnapshot({
      canonicalKey: async (c: any) => c, selectEarly: async () => ({ backendId: 'markdown', source: 'explicit', rev: 5 }), isComposerSelection: () => false,
      getTrackerRegistry: async () => ({ get: () => null, modules: () => [], describe: () => null }), getPlatform: async () => ({ fs: {}, path: { join: () => '' }, getHome: async () => '' }),
      ctx: { get: () => undefined }, getCache: () => cache, setCache: (v: any) => { Object.assign(cache, v) }, CACHE_MS: 60000, cacheSnapshotIsCurrent: async () => false,
      upcaseSnapStates: (s: any) => s, computeLevels: () => ({ byNumber: {}, byKey: {} }), groupTickets: () => ({ total: 0, open: 0, closed: 0, frontier: 0, claimed: 0, blocked: 0, levels: [], levelOf: {} }),
      getRepoRoot: async () => 'D:\\ws', getRepoKey: async () => null, readDiskCache: async () => null, writeDiskCache: async () => {}, adoptSnapshot: (s: any) => s,
      detectionExec: async () => ({ stdout: '', stderr: '', code: 0 }), execProc: async () => ({ ok: false }), errText: () => '', DEFAULT_CWD: 'D:\\ws', hash8: (s: any) => s, logCtx: null,
    })
    const r = await h.handleSnapshot({ cwd: 'D:\\ws' })
    check(r === cached && r.selection.backendId === 'github', '反证 F2 成立：短路路不带新选择时，回包里那条还是旧后端 github（面板头照旧显示旧的，正是 R4 要结束的那件事）—— 实得「' + r.selection.backendId + '」')
  }
}

for (const d of tmpDirs) { try { fs.rmSync(d, { recursive: true, force: true }) } catch (e) {} }
console.log('')
console.log(failed ? '存在失败 — verify-683-host-wiring 未通过（' + passed + ' 项通过、' + failed + ' 项失败）' : '全部通过 — 宿主接线门禁生效（' + passed + ' 项断言）')
process.exit(failed ? 1 : 0)
