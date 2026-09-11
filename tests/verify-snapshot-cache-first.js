// tests/verify-snapshot-cache-first.js
//
// 门禁：手上有新鲜快照缓存时，「面板数据」这条通话必须立刻交付，不许在交付前先联网核对。
//
// 为什么必须有这条：
//   核对一次要把全仓库 issue 扫一遍（实测 505 条、6 页、约 4~5 秒），而结论多数是「没变」，
//   于是那几秒纯属白等——用户看到的现象就是「点开右侧面板一直不出来」。
//   改成「先交付、后核对」之后，这条契约必须被钉住，否则以后有人顺手把核对挪回交付之前，
//   卡顿会无声地回来（不会有任何报错，只有用户觉得慢）。
//
// 契约（2026-09-11 定版）：只要手上有缓存，无论它多旧，都立刻交付、一律不核对。
//   核对完全交给后台那条 60 秒自动探测（它发现变化会把缓存标脏，标脏后自然走不到这条短路）。
//   早期版本曾要求「缓存超过 60 秒就仍要核对」，实践证伪了它：客户端手上那份几乎总是超过
//   60 秒，那个门槛每次都被触发，等于没改。数据新鲜与否由状态胶囊的时间戳表达（超五分钟变红），
//   用户看得见，不需要用「让用户等」来表达。
//
// 用法：node tests/verify-snapshot-cache-first.js

import { createSessionSnapshot } from '../src/host/sessionSnapshot.js'

let failed = 0
let total = 0
function check(ok, msg) {
  total++
  console.log((ok ? '  PASS ' : '  FAIL ') + msg)
  if (!ok) failed++
}

const CWD = 'D:\\dsh-plugin\\dsh-mattpocock-skills-deck'
const snapshot = {
  ok: true,
  generatedMs: 1789000000000,
  maps: [{ number: 1, title: '地图', state: 'OPEN', tickets: [] }],
  issues: [{ number: 2, state: 'OPEN', updatedAt: '2026-09-11T00:00:00Z', title: '票' }],
  labels: [],
  selection: { backendId: 'github', source: 'auto' },
  repository: { refId: 'FeatherHunter/dsh-mattpocock-skills-deck', name: 'FeatherHunter/dsh-mattpocock-skills-deck' },
}

/**
 * 造一个能跑通「读缓存」这条短路的宿主。
 * ageMs 控制缓存看起来有多新；核对桩故意慢，用来证明交付没有等它。
 * 返回的对象里带计数，用来观察有没有真的去联网核对。
 */
const VALIDATE_MS = 400
function makeHost(ageMs) {
  const cache = { ts: Date.now() - ageMs, snapshot: snapshot, error: null, cwd: CWD }
  const probe = { validateCalled: 0 }
  const h = createSessionSnapshot({
    canonicalKey: async (c) => c,
    selectEarly: async () => ({ backendId: 'github', source: 'auto' }),
    isComposerSelection: () => false,          // false = 走 GitHub 那条分支（本次改动所在）
    getTrackerRegistry: async () => ({ get: () => null, modules: () => [], describe: () => null }),
    getPlatform: async () => ({ fs: { resolve: async () => ({}) }, path: { join: () => '' }, getHome: async () => '' }),
    ctx: { get: () => undefined },
    getCache: () => cache,
    setCache: (v) => { Object.assign(cache, v) },
    CACHE_MS: 60000,
    // 故意慢：真实环境里这一步就是那次全仓库扫描（4~5 秒）。这里等 400ms 就够说明问题。
    cacheSnapshotIsCurrent: async () => { probe.validateCalled++; await new Promise((r) => setTimeout(r, VALIDATE_MS)); return true },
    upcaseSnapStates: (s) => s,
    computeLevels: () => ({ byNumber: {}, byKey: {} }),
    groupTickets: () => ({ total: 0, open: 0, closed: 0, frontier: 0, claimed: 0, blocked: 0, levels: [], levelOf: {} }),
    getRepoRoot: async () => CWD,
    getRepoKey: async () => ({ owner: 'FeatherHunter', name: 'dsh-mattpocock-skills-deck' }),
    readDiskCache: async () => null,
    writeDiskCache: async () => {},
    adoptSnapshot: async (s) => s,
    detectionExec: async () => ({ ok: false }),
    getGhPath: () => '',
    getGhLastError: () => '',
    errText: (e) => String(e),
    DEFAULT_CWD: CWD,
    logCtx: null,
  })
  return { h, probe, cache }
}

console.log('快照缓存优先门禁（新鲜缓存必须立刻交付，不许先联网核对）')

// ---------- 一、新鲜缓存：必须立刻交付，且不许联网核对 ----------
{
  const { h, probe } = makeHost(1000)   // 1 秒前生成，远小于 60 秒
  const t0 = Date.now()
  const got = await h.handleSnapshot({ cwd: CWD })
  const ms = Date.now() - t0

  check(got === snapshot, '新鲜缓存：返回的就是缓存里那一份（同对象，不是重新拼的）')
  check(probe.validateCalled === 0, '新鲜缓存：全程没有去联网核对（核对次数 ' + probe.validateCalled + '）')
  check(ms < VALIDATE_MS / 2, '新鲜缓存：交付 ' + ms + ' ms，明显快于那次核对的 ' + VALIDATE_MS + ' ms —— 没有等它')
}

// 边界：缓存有多旧都不影响交付，只验一个明显不同的年龄值即可。
{
  const { h, probe } = makeHost(59000)
  const got = await h.handleSnapshot({ cwd: CWD })
  check(got === snapshot && probe.validateCalled === 0, '边界（59 秒）：同样立刻交付、不核对 —— 年龄不再是判据')
}

// ---------- 三、过期缓存：同样立刻交付，不再核对 ----------
{
  // 这一条是有意改掉的旧契约（原为「缓存超过 60 秒就仍要核对」）。
  // 实践证伪了它：客户端手上那份几乎总是超过 60 秒，于是每次开面板都回到「先核对」的老路，
  // 等于没改。数据新鲜与否改由状态胶囊的时间戳表达（超过五分钟变红），由用户看得见。
  const { h, probe } = makeHost(120000)  // 2 分钟，早已超过 60 秒
  const t0 = Date.now()
  const got = await h.handleSnapshot({ cwd: CWD })
  const ms = Date.now() - t0
  check(got === snapshot, '过期缓存：同样立刻交付手上那份（不再因为它旧就拦下）')
  check(probe.validateCalled === 0, '过期缓存：也没有联网核对（核对次数 ' + probe.validateCalled + '）—— 核对完全交给后台的 60 秒自动探测')
  check(ms < VALIDATE_MS / 2, '过期缓存：交付 ' + ms + ' ms，仍然没有等核对')
}

// ---------- 四、强制重建：不许走缓存短路 ----------
{
  const { h, probe } = makeHost(1000)
  // force 时不该命中缓存短路，而会往下走重建；这里只断言「没有走那条不核对的短路」。
  // 下方重建路径的依赖不完整，允许它抛错，只要不把缓存原样当成结果返回即可。
  let returned = null
  try { returned = await h.handleSnapshot({ cwd: CWD, force: true }) } catch (e) { returned = 'threw' }
  check(returned !== snapshot, '强制重建：没有把手上那份缓存原样当结果返回（实得 ' + String(returned === 'threw' ? '走到重建路径' : returned) + '）')
}

console.log(failed ? '\n快照缓存优先门禁未通过 ' + failed + '/' + total : '\n快照缓存优先门禁全部通过（' + total + ' 项）')
process.exit(failed ? 1 : 0)
