#!/usr/bin/env node
/**
 * verify-729-force-dedup.ts —— “点刷新不该另起一整趟”门禁（票 #729，一次性方案）
 *
 * 治的是什么：面板上有两条取数路（自动走 wf.snapshot、手动点刷新走 wf.refresh），
 * 从前强制刷新永远不查在途表（sessionSnapshot 里被 if (!isForce) 排除在外），
 * 而刷新路（sessionRefresh）整篇没有任何在途表 —— 在途时再点一次强制必另起一整趟，
 * 工作区越大越明显（52 张地图 / 950 张票 / 9.7MB 快照本机连着 30 秒超时）。
 * 本票把两条路接到同一张在途表（src/host/snapshotInflight.ts），强制语义收敛为
 * “跳过缓存、要新数据”，不再是“再起一趟”。
 *
 * 复用规则（非对称，只拦该拦的）：
 *   强制只搭强制的车（#366：强制恒等于真重建，磁盘回放与 304 都不许冒充新鲜）；
 *   非强制搭任何车（顺风车只会更新鲜，与客户端 probe-stale.js 口径同构）。
 *
 * 覆盖（按票面验收逐条）：
 *   A. 快照路强制撞强制 → 只重建 1 次，且后来者记 dedup.hit（作用域为快照，不新增事件名）。
 *   B. 刷新路强制 x2 并发 → 只重建 1 次（此前整篇无表，必为 2）。
 *   C. 跨路：快照路强制在途 + 刷新路到达 → 共 1 次（只有共享表能过，是本方案区别于止血版的证明）。
 *   D. 口径钉死：强制撞非强制仍为 2（#366 不动）；非强制搭强制为 1；换后端为 2（键能分清）。
 *   E. 反证：把协调器规则拆掉（补丁副本），Take 永不搭车 —— 证明规则行是承重的；
 *      把整单回滚（临摹旧码：强制不查表）→ A/B/C 当场变红。
 *   F. #696 门禁（同一张在途表的另一扇）仍在 verify 链上，本扇与它一起守。
 *   H. 同 tick 并发（零延迟）：Take 到 Park 之间无等待点，确定性仍为 1（延迟 10ms 只是常量，不是遮羞布）。
 *
 *   原先的 E2（读 src/host/sessionSnapshot.ts 与 src/host/sessionRefresh.ts 的源码文本、
 *   断言 Take/Park/Leave 的调用都在）、F 里的「三处 src 文件都在 350 行内」、以及 G 组
 *   （读客户端与宿主源码文本钉 30 秒死线、扫节流防抖字样）都是源码文本门禁，2026-10 按
 *   维护者口径撤掉：断言的对象是手写源码的文本，等价重构就会变红。
 *
 * 测法：真跑 sessionSnapshot / sessionRefresh（计数重建次数，不起外部命令），外加把源码
 *   抠出来改坏后真跑一遍的反证（E 组）。
 *
 * 用法：node --import ./scripts/ts-hook.mts tests/verify-729-force-dedup.ts
 */
const fsx = require('fs')
const fsp = fsx.promises
const nodePath = require('path')
const nodeOs = require('os')
const { pathToFileURL } = require('url')

// 这份门禁用的三样假件形状：迷你表（记缓存条目）、计数桩（数重建次数）、日志出口（收 dedup.hit）。
// 它们只描述本文件自己造的假件，不代表产品契约；产品那边由 src/host/snapshotInflight.ts 定义。
interface CacheEntry { ts: number; snapshot: unknown; error: unknown; cwd: string }
interface FakeTable {
  getCache: (cwd: string) => CacheEntry
  setCache: (v: CacheEntry) => void
}
interface Counter { n: number }
interface FireRecord { level: string; event: string; fields: unknown }

const ROOT = nodePath.resolve(__dirname, '..')
const read = (rel: string) => fsx.readFileSync(nodePath.join(ROOT, rel), 'utf8')
const url = (rel: string) => pathToFileURL(nodePath.join(ROOT, rel)).href
const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

let total = 0
const broken: string[] = []
function must(cond: unknown, invariant: string, detail?: string): void {
  total++
  if (cond) { console.log('  PASS ' + invariant); return }
  const line = '  FAIL 不变式破了 —— ' + invariant + (detail ? '【实测：' + detail + '】' : '')
  console.log(line)
  broken.push(line.replace(/^\s+/, ''))
}
function title(t: string): void { console.log('\n' + t) }

const PLATFORM = { os: 'win32', path: nodePath, async getHome() { return nodeOs.homedir() } }
function makeTable(): FakeTable {
  const m = new Map<string, CacheEntry>()
  return {
    getCache(cwd) { const e = m.get(String(cwd)); return e || { ts: 0, snapshot: null, error: null, cwd: String(cwd) } },
    setCache(v) { if (v && v.cwd) m.set(String(v.cwd), v) },
  }
}
const quiet = { fire: () => {}, isEnabled: () => false }

// 真宿主装配：与 src/host/index.js 同形的最小依赖（计数桩 + 80ms 延迟模拟大工作区）。
function snapDeps(table: FakeTable, counter: Counter, fires: FireRecord[], backendOf?: { backendId?: string }) {
  const adopt = (s: unknown, c: string) => { table.setCache({ ts: Date.now(), snapshot: s, error: null, cwd: c }); return s }
  return {
    canonicalKey: async (x) => 'K729',
    selectEarly: async ({ backendId }) => ({ backendId: (backendOf && backendOf.backendId) || backendId || 'github', source: 'auto', rev: 0 }),
    isComposerSelection: () => true,
    getTrackerRegistry: async () => ({
      modules: () => [], describe: () => ({ backend: 'github', refId: 'a/b', name: 'a/b', url: '' }),
      get: () => ({ list: async () => { counter.n++; await delay(80); return { ok: true, data: [] } } }),
    }),
    getPlatform: async () => PLATFORM, ctx: { get: () => undefined },
    getCache: table.getCache, setCache: table.setCache, CACHE_MS: 60000,
    cacheSnapshotIsCurrent: async () => null,
    upcaseSnapStates: (s) => s, computeLevels: () => ({ byNumber: {}, byKey: {} }),
    groupTickets: () => ({ total: 0, open: 0, closed: 0, frontier: 0, claimed: 0, blocked: 0, levels: [], levelOf: {} }),
    getRepoRoot: async (c) => c, getRepoKey: async () => ({ owner: 'a', name: 'b' }),
    readDiskCache: async () => null, writeDiskCache: async () => {},
    adoptSnapshot: adopt,
    detectionExec: async () => ({ ok: false }), getGhPath: () => '', getGhLastError: () => '',
    errText: (e) => String((e && e.message) || e), DEFAULT_CWD: 'K729',
    logCtx: { fire: (l, e, f) => { fires.push({ level: l, event: e, fields: (typeof f === 'function') ? f() : f }) }, isEnabled: () => true },
  }
}
async function refreshDeps(table: FakeTable, counter: Counter, fires: FireRecord[]) {
  const envMod = await import(url('src/host/snapshotEnvelope.ts'))
  const adopt = (s: unknown, c: string) => { table.setCache({ ts: Date.now(), snapshot: s, error: null, cwd: c }); return s }
  const d = snapDeps(table, counter, fires)
  d.resetGhCache = () => {}
  d.envelope = envMod.createSnapshotEnvelope({ getGhPath: () => '', getGhLastError: () => '', adoptSnapshot: adopt, logCtx: quiet })
  return d
}
// 先发车、隔 10ms 再来第二趟（第一趟必已登记在途，不赌微任务顺序），返回重建次数。
async function twoTrips(first: () => Promise<unknown>, second: () => Promise<unknown>) {
  const p1 = first()
  await delay(10)
  const p2 = second()
  await Promise.all([p1, p2])
}

async function main() {
  const snapMod = await import(url('src/refresh/rooms/host/session-snapshot-cache.ts'))
  const refMod = await import(url('src/refresh/rooms/host/session-refresh-schedule.ts'))

  title('A) 快照路：强制撞强制只重建 1 次，且后来者记 dedup.hit')
  {
    const counter = { n: 0 }
    const fires = []
    const table = makeTable()
    const h = snapMod.createSessionSnapshot(snapDeps(table, counter, fires))
    table.setCache({ ts: 0, snapshot: null, error: null, cwd: 'K729' })
    await twoTrips(() => h.handleSnapshot({ cwd: 'K729', force: true }), () => h.handleSnapshot({ cwd: 'K729', force: true }))
    must(counter.n === 1, '快照路强制撞强制只重建一次', 'builds=' + counter.n)
    must(fires.some((f) => f.event === 'dedup.hit' && f.fields && f.fields.scope === 'snapshot'),
      '后来者记复用事件 dedup.hit（作用域为快照，不新增事件名）', JSON.stringify(fires.filter((f) => f.event === 'dedup.hit')))
  }

  title('B) 刷新路：强制 x2 并发只重建 1 次（此前整篇无表，必为 2）')
  {
    const counter = { n: 0 }
    const fires = []
    const table = makeTable()
    const h = refMod.createSessionRefresh(await refreshDeps(table, counter, fires))
    await twoTrips(() => h.handleRefresh({ cwd: 'K729' }), () => h.handleRefresh({ cwd: 'K729' }))
    must(counter.n === 1, '刷新路强制 x2 并发只重建一次', 'builds=' + counter.n)
    must(fires.some((f) => f.event === 'dedup.hit' && f.fields && f.fields.scope === 'snapshot'),
      '刷新路后来者同样记 dedup.hit（作用域为快照，不新增事件名）', JSON.stringify(fires.filter((f) => f.event === 'dedup.hit')))
  }

  title('C) 跨路：快照路强制在途 + 刷新路到达，共 1 次（共享表的证明）')
  {
    const counter = { n: 0 }
    const fires = []
    const table = makeTable()
    const hs = snapMod.createSessionSnapshot(snapDeps(table, counter, fires))
    const hr = refMod.createSessionRefresh(await refreshDeps(table, counter, fires))
    table.setCache({ ts: 0, snapshot: null, error: null, cwd: 'K729' })
    await twoTrips(() => hs.handleSnapshot({ cwd: 'K729', force: true }), () => hr.handleRefresh({ cwd: 'K729' }))
    must(counter.n === 1, '跨路强制撞强制只重建一次（两张表做不到这一条）', 'builds=' + counter.n)
  }

  title('D) 口径钉死：该分开的一律分开')
  {
    // D1：强制撞非强制仍为 2（#366 不动：强制恒等于真重建）
    {
      const counter = { n: 0 }
      const fires = []
      const table = makeTable()
      const h = snapMod.createSessionSnapshot(snapDeps(table, counter, fires))
      table.setCache({ ts: 0, snapshot: null, error: null, cwd: 'K729' })
      await twoTrips(() => h.handleSnapshot({ cwd: 'K729' }), () => h.handleSnapshot({ cwd: 'K729', force: true }))
      must(counter.n === 2, '强制撞非强制在途仍另起一趟（#366 口径不动）', 'builds=' + counter.n)
    }
    // D2：非强制搭强制的车为 1（顺风车只会更新鲜）
    {
      const counter = { n: 0 }
      const fires = []
      const table = makeTable()
      const h = snapMod.createSessionSnapshot(snapDeps(table, counter, fires))
      table.setCache({ ts: 0, snapshot: null, error: null, cwd: 'K729' })
      await twoTrips(() => h.handleSnapshot({ cwd: 'K729', force: true }), () => h.handleSnapshot({ cwd: 'K729' }))
      must(counter.n === 1, '非强制搭上在途强制那一趟（只重建一次）', 'builds=' + counter.n)
    }
    // D3：换后端是另一把键，为 2（#669 的切换保护在宿主侧同构）
    {
      const counter = { n: 0 }
      const fires = []
      const table = makeTable()
      const h = snapMod.createSessionSnapshot(snapDeps(table, counter, fires))
      table.setCache({ ts: 0, snapshot: null, error: null, cwd: 'K729' })
      await twoTrips(
        () => h.handleSnapshot({ cwd: 'K729', force: true, backendId: 'github', baseRev: 1 }),
        () => h.handleSnapshot({ cwd: 'K729', force: true, backendId: 'markdown', baseRev: 1 }))
      must(counter.n === 2, '换后端的强制各跑各的一趟（键能分清）', 'builds=' + counter.n)
    }
  }

  title('E) 反证：拆掉复用，当场变红')
  {
    // E1：协调器规则被拆（补丁副本）→ 永不搭车。模块零依赖，可独立加载副本验证。
    const tmp = fsx.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'anti729-'))
    try {
      const src = read('src/host/snapshotInflight.ts')
      must(src.indexOf('ongoing.isForce === true || !isForce') >= 0, '真源里找得到非对称规则那一行（反证靶点存在）')
      const patched = src.split('ongoing.isForce === true || !isForce').join('false')
      // 夹具内容是 .ts 源码，写成 .mjs 的话 Node 不会剥类型，import 时会在解析阶段就 SyntaxError；
      //   写成 .ts 交给 Node 自己的类型剥离（与生产侧同一套源码），改坏的那三行判据一字未动。
      const copyPath = nodePath.join(tmp, 'snapshotInflight-broken.ts')
      fsx.writeFileSync(copyPath, patched)
      const brokenMod = await import(pathToFileURL(copyPath).href)
      const goodMod = await import(url('src/host/snapshotInflight.ts'))
      const k = goodMod.snapshotDedupKeyOf({ cwd: 'K', backendId: 'github', lang: '', baseRev: 0, version: '' })
      const parked = goodMod.snapshotInflightPark(k, true, Promise.resolve({ ok: true, marker: 'x' }))
      try {
        must(await goodMod.snapshotInflightTake(k, true, () => {}) !== null, '真模块：同键强制搭上强制（规则行生效）')
      } finally { goodMod.snapshotInflightLeave(k, parked) }
      const k2 = 'anti729|github|||0|'
      const parked2 = brokenMod.snapshotInflightPark(k2, true, Promise.resolve({ ok: true, marker: 'x' }))
      try {
        must(await brokenMod.snapshotInflightTake(k2, true, () => {}) === null, '反证成立：规则拆掉后永不搭车（补丁副本当场验证）')
      } finally { brokenMod.snapshotInflightLeave(k2, parked2) }
    } finally { try { fsx.rmSync(tmp, { recursive: true, force: true }) } catch (eRm) {} }
    // E3：整单回滚——临摹“强制不查表”的旧码（只拆协调器规则一行），真电话路重跑 A/B/C 必须全红（全为 2）。
    const tmpTree = fsx.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'rollback729-'))
    try {
      fsx.cpSync(nodePath.join(ROOT, 'src'), nodePath.join(tmpTree, 'src'), { recursive: true })
      const brokenTreePath = nodePath.join(tmpTree, 'src', 'host', 'snapshotInflight.ts')
      const brokenTreeSrc = fsx.readFileSync(brokenTreePath, 'utf8')
      fsx.writeFileSync(brokenTreePath, brokenTreeSrc.split('ongoing.isForce === true || !isForce').join('false'))
      const treeUrl = (rel: string) => pathToFileURL(nodePath.join(tmpTree, rel)).href
      const snapRolled = await import(treeUrl('src/refresh/rooms/host/session-snapshot-cache.ts'))
      const refRolled = await import(treeUrl('src/refresh/rooms/host/session-refresh-schedule.ts'))
      {
        const counter = { n: 0 }
        const table = makeTable()
        const h = snapRolled.createSessionSnapshot(snapDeps(table, counter, []))
        table.setCache({ ts: 0, snapshot: null, error: null, cwd: 'K729' })
        await twoTrips(() => h.handleSnapshot({ cwd: 'K729', force: true }), () => h.handleSnapshot({ cwd: 'K729', force: true }))
        must(counter.n === 2, '反证 A 成立：回滚后快照路强制撞强制回到 2 次', 'builds=' + counter.n)
      }
      {
        const counter = { n: 0 }
        const table = makeTable()
        const h = refRolled.createSessionRefresh(await refreshDeps(table, counter, []))
        await twoTrips(() => h.handleRefresh({ cwd: 'K729' }), () => h.handleRefresh({ cwd: 'K729' }))
        must(counter.n === 2, '反证 B 成立：回滚后刷新路强制 x2 回到 2 次', 'builds=' + counter.n)
      }
      {
        const counter = { n: 0 }
        const table = makeTable()
        const hs = snapRolled.createSessionSnapshot(snapDeps(table, counter, []))
        const hr = refRolled.createSessionRefresh(await refreshDeps(table, counter, []))
        table.setCache({ ts: 0, snapshot: null, error: null, cwd: 'K729' })
        await twoTrips(() => hs.handleSnapshot({ cwd: 'K729', force: true }), () => hr.handleRefresh({ cwd: 'K729' }))
        must(counter.n === 2, '反证 C 成立：回滚后跨路回到 2 次', 'builds=' + counter.n)
      }
    } finally { try { fsx.rmSync(tmpTree, { recursive: true, force: true }) } catch (eRm2) {} }
  }

  title('F) 门禁入链与文件纪律')
  {
    // #1125 起问规划函数（执行器读的同一份），不再读 package.json 长串。
    // 这里只留「#696 仍在链上」这一条：#1125 的门禁覆盖检查只保证「磁盘上的文件要么进链、要么在排除表」，
    // 管不到「文件还在、却被塞进 verify-stages.json 的 exclude」，而本门禁与 #696 是同一张表的两个变体，
    // 那一扇掉队时必须有人喊。原先另外四条（本门禁自己在链上、两条同层边已记基线、日志白名单里还有
    // dedup.hit 字样）各有更强的继任者，2026-10-17 的对抗式审查逐条核实后裁掉：
    // 本门禁在链上由 tests/verify-1125-gate-coverage.ts 更泛地保证；同层边由 tests/verify-dependency-rules.ts
    // 拦硬方向（它读同一份基线，且违规不在白名单里就判红）；dedup.hit 的字段与落点由 tests/verify-log-fields.ts
    // 的 218 条断言守着，而「在源码里搜字符串」按既定口径本来就不算牙齿。
    const { isGatePlanned } = require('../scripts/lib/discover-gates.ts')
    must(isGatePlanned(ROOT, 'tests/verify-696-shared-cache.ts'), '既有 #696 门禁仍在链上（与本门禁一起守）', '696 missing')
  }


  title('H) 同 tick 并发（零延迟）：Take 到 Park 之间无等待点，确定性仍为 1')
  {
    {
      const counter = { n: 0 }
      const table = makeTable()
      const h = snapMod.createSessionSnapshot(snapDeps(table, counter, []))
      table.setCache({ ts: 0, snapshot: null, error: null, cwd: 'K729' })
      await Promise.all([h.handleSnapshot({ cwd: 'K729', force: true }), h.handleSnapshot({ cwd: 'K729', force: true })])
      must(counter.n === 1, '快照路同 tick 强制撞强制仍只重建一次', 'builds=' + counter.n)
    }
    {
      const counter = { n: 0 }
      const table = makeTable()
      const h = refMod.createSessionRefresh(await refreshDeps(table, counter, []))
      await Promise.all([h.handleRefresh({ cwd: 'K729' }), h.handleRefresh({ cwd: 'K729' })])
      must(counter.n === 1, '刷新路同 tick 强制撞强制仍只重建一次', 'builds=' + counter.n)
    }
    {
      const counter = { n: 0 }
      const table = makeTable()
      const hs = snapMod.createSessionSnapshot(snapDeps(table, counter, []))
      const hr = refMod.createSessionRefresh(await refreshDeps(table, counter, []))
      table.setCache({ ts: 0, snapshot: null, error: null, cwd: 'K729' })
      await Promise.all([hs.handleSnapshot({ cwd: 'K729', force: true }), hr.handleRefresh({ cwd: 'K729' })])
      must(counter.n === 1, '跨路同 tick 强制撞强制仍只重建一次（谁先谁后都是 1）', 'builds=' + counter.n)
    }
  }

  console.log('\n=== 汇总 ===')
  console.log(total + ' 条判据，' + (broken.length ? broken.length + ' 条不变式破了' : '全部守住'))
  if (broken.length) { console.log('\n破了的不变式：'); for (const b of broken) console.log('  ' + b); process.exit(1) }
  console.log('全部通过 ✅ — 在途时再点强制，重建次数仍是 1')
}

main().catch(function (e) { console.error('RUNNER ERROR:', e && e.stack || e); process.exit(2) })
