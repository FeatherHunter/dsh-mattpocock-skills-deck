// tests/verify-1870-index-baseline.ts
//
// 门禁：重启后的第一次索引扫描用本地快照库里的基线，不再整仓枚举（#1870）。
//
// 为什么必须有这条门禁：
//   整份磁盘快照退役之后，水印与基线在进程重启时会一起清空，如果没人接住，
//   用户每次开面板的第一拍都会把整个仓库翻一遍（本仓库实测 6~7 页、7 秒左右）。
//   这条回退不会自己冒出来——面板照样能用，只是每重启一次就多发几页请求，
//   所以必须由门禁钉住三件事：
//     ① 库里有数据时，第一次扫描带 since（缩窗），不是整仓枚举；
//     ② 起点就是库里的那一份：窗口内只回几条变化时，扫描交回的仍是完整索引，
//        不会因为窗口小就被判成「一大批票被删掉」；
//     ③ 库为空、库打不开、那份数据太旧时，照旧整仓枚举（宁可多花一次请求，也不许
//        拿一个陈旧的起点把中间发生的改动漏掉）。
//
// 跑法：node --import ./scripts/ts-hook.mts tests/verify-1870-index-baseline.ts

import { createIssueIndexScan } from '../src/refresh/rooms/host/issue-index-scan.js'
import { MAX_WINDOW_MS, SKEW_MS } from '../src/refresh/kernel/index-window-rules.js'

let failed = 0
let total = 0
function check(ok, msg) {
  total++
  console.log((ok ? '  PASS ' : '  FAIL ') + msg)
  if (!ok) failed++
}

const CWD = 'D:\\ws\\demo'
const REPO = { owner: 'o', name: 'r' }
const NOW = Date.now()
const GEN = NOW - 60 * 1000 // 库里那份数据是一分钟前取的
const ISO_A = '2026-11-04T10:00:00Z'
const ISO_B = '2026-11-04T11:00:00Z'

/** 库回放出来的快照：与 assembleSnapshot 同形（issues 放未挂图票，maps 放容器与子票）。 */
function librarySnapshot() {
  return {
    issues: [{ number: 1, state: 'OPEN', updatedAt: ISO_A }],
    maps: [
      { number: 2, state: 'OPEN', updatedAt: ISO_A, tickets: [{ number: 3, state: 'CLOSED', updatedAt: ISO_A }] },
    ],
  }
}

/**
 * 造一份待验的扫描件。
 * answer(sinceIso) 决定远端这一趟回什么（模拟「窗口内只回变化的几条」）。
 * library() 决定库这一趟交回什么（null = 库里没有可用数据）。
 */
function build(opts) {
  const seen = { since: [], libraryCalls: 0, pages: 0 }
  const scan = createIssueIndexScan({
    getRepoKey: async function () { return REPO },
    fetchIssueIndex: async function (cwd, sinceIso) {
      seen.pages += 1
      seen.since.push(String(sinceIso || ''))
      return { ok: true, repo: REPO, index: opts.answer(String(sinceIso || '')), count: 0 }
    },
    readLibrarySnapshot: async function () {
      seen.libraryCalls += 1
      return typeof opts.library === 'function' ? opts.library() : null
    },
  })
  return { scan, seen }
}

console.log('重启后的索引扫描起点门禁（#1870：基线来自本地快照库，不整仓枚举）')

// ---------- 一、库里有数据 → 第一次扫描就缩窗 ----------
{
  const w = build({ library: () => ({ snapshot: librarySnapshot(), lastKnownAtMs: GEN }), answer: () => ({}) })
  const r = await w.scan.fetchIssueIndexWindowed(CWD)
  check(r.ok === true, 'A1 有库起点时扫描成功')
  check(w.seen.since[0] !== '', 'A2 第一次扫描带 since（重启后不再整仓枚举）')
  check(r.windowed === true, 'A3 回包自报这是缩窗扫描（不是整仓枚举）')
  check(Date.parse(w.seen.since[0]) === GEN - SKEW_MS, 'A4 窗口起点 = 库里的数据时刻再往前退一格（抹时钟偏差），实得 ' + w.seen.since[0])
}

// ---------- 二、起点就是库里的那一份：窗口小不等于「一大批票被删」 ----------
{
  // 远端只回了 2 号这一条变化，1 号与 3 号都不在窗口里。
  const w = build({ library: () => ({ snapshot: librarySnapshot(), lastKnownAtMs: GEN }), answer: () => ({ '2': 'CLOSED|' + ISO_B }) })
  const r = await w.scan.fetchIssueIndexWindowed(CWD)
  check(r.ok === true && r.count === 3, 'B1 合并后仍是 3 条（基线没被窗口里的那一条挤掉），实得 ' + r.count)
  check(r.index['1'] === 'OPEN|' + ISO_A && r.index['3'] === 'CLOSED|' + ISO_A, 'B2 窗口外的两条原样保留（库里的值就是基线）')
  check(r.index['2'] === 'CLOSED|' + ISO_B, 'B3 窗口内变化的那条被新值覆盖')
  check(r.changed === true, 'B4 真变了 → 判「变了」')
}

// ---------- 三、窗口里没有任何变化 → 不许假报「变了」 ----------
{
  const w = build({ library: () => ({ snapshot: librarySnapshot(), lastKnownAtMs: GEN }), answer: () => ({}) })
  const r = await w.scan.fetchIssueIndexWindowed(CWD)
  check(r.changed === false, 'C1 空窗口 → 判「没变」（假报会让面板每一拍都整池重建）')
  check(r.count === 3, 'C2 没变化时交回的仍是库里的完整索引')
}

// ---------- 四、库里没有数据 → 照旧整仓枚举 ----------
{
  const w = build({ library: () => null, answer: () => ({ '1': 'OPEN|' + ISO_A, '2': 'OPEN|' + ISO_A, '3': 'CLOSED|' + ISO_A }) })
  const r = await w.scan.fetchIssueIndexWindowed(CWD)
  check(w.seen.since[0] === '', 'D1 库为空 → 不带 since（整仓枚举），实得「' + w.seen.since[0] + '」')
  check(r.windowed === false, 'D2 回包如实说这是整仓枚举')
  check(r.changed === true, 'D3 没有基线 → 判「变了」（首轮据此立基线）')
}

// ---------- 五、库打不开（取起点抛错）→ 不许把扫描带崩 ----------
{
  const w = build({ library: () => { throw new Error('库打不开') }, answer: () => ({}) })
  const r = await w.scan.fetchIssueIndexWindowed(CWD)
  check(r.ok === true, 'E1 取起点抛错时扫描照常跑完（不把整条探测带崩）')
  check(w.seen.since[0] === '', 'E2 取不到起点 → 退回整仓枚举')
}

// ---------- 六、库里那份太旧 → 宁可整扫，也不许漏掉中间那段 ----------
{
  const w = build({ library: () => ({ snapshot: librarySnapshot(), lastKnownAtMs: NOW - MAX_WINDOW_MS - 60000 }), answer: () => ({}) })
  const r = await w.scan.fetchIssueIndexWindowed(CWD)
  check(w.seen.since[0] === '', 'F1 数据旧到超出窗口上限（' + Math.round(MAX_WINDOW_MS / 86400000) + ' 天）→ 整扫')
  check(r.ok === true, 'F2 这一档仍然正常回包')
}

// ---------- 七、起点只问一次库；水印推进后窗口跟着走 ----------
{
  const w = build({ library: () => ({ snapshot: librarySnapshot(), lastKnownAtMs: GEN }), answer: () => ({}) })
  await w.scan.fetchIssueIndexWindowed(CWD)
  await w.scan.fetchIssueIndexWindowed(CWD)
  check(w.seen.libraryCalls === 1, 'G1 起点只在没有水印时问一次库（内存里有了就不重复开库），实得 ' + w.seen.libraryCalls)
  await w.scan.commitIssueIndex(CWD, NOW, { '1': 'OPEN|' + ISO_A })
  await w.scan.fetchIssueIndexWindowed(CWD)
  check(Date.parse(w.seen.since[2]) === NOW - SKEW_MS, 'G2 水印推进之后，第三次扫描的窗口跟着前进（实得 ' + w.seen.since[2] + '）')
  check(w.seen.libraryCalls === 1, 'G3 水印在内存里时不再问库')
}

// ---------- 八、拉取请求不进基线（远端索引的来源本来就不含 PR）----------
{
  const snapWithPr = { issues: [
    { number: 1, state: 'OPEN', updatedAt: ISO_A },
    { number: 9, state: 'OPEN', updatedAt: ISO_A, isPullRequest: true },
  ] }
  const w = build({ library: () => ({ snapshot: snapWithPr, lastKnownAtMs: GEN }), answer: () => ({}) })
  const r = await w.scan.fetchIssueIndexWindowed(CWD)
  check(r.ok === true && r.count === 1, 'H1 起点里不含拉取请求（库里有它，索引不该算它），实得 ' + r.count)
  check(r.changed === false, 'H2 远端没回变化时不假报（PR 不会被判成「被删除」）')
}

console.log('')
console.log(failed === 0 ? '全部通过（' + total + ' 项）' : ('失败 ' + failed + ' / ' + total + ' 项'))
process.exit(failed === 0 ? 0 : 1)
