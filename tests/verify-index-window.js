// tests/verify-index-window.js
//
// 门禁：增量索引的时间窗与水印（src/shared/tracker/indexWindow.js）
//
// 为什么必须有这条门禁：
//   把「每次全量扫」改成「只问变化」能省掉大部分等待，但会引入两类**静默错误**——
//   ① 假报：拿全量基线去比一个只含增量的结果，大小天然不同，于是每次都判「变了」，
//      后果是每分钟都触发一次全量重建（比不改还糟）；
//   ② 漏报：窗口起点取错（取了「本次扫描时刻」），两次扫描之间发生的改动永远落在窗口外，
//      后果是面板长期显示旧数据且没有任何报错。
//   这两类都不会自己冒出来，必须由本门禁钉死。

import { scanWindow, mergeDelta, indexDiffers, nextWatermark, indexFromSnapshot, seedFromSnapshot, MAX_WINDOW_MS, SKEW_MS } from '../src/shared/tracker/indexWindow.js'

let failed = 0
let total = 0
function check(ok, msg) {
  total++
  console.log((ok ? '  PASS ' : '  FAIL ') + msg)
  if (!ok) failed++
}

console.log('增量索引时间窗门禁（#indexWindow：只问变化，但不许假报也不许漏报）')

// ---------- 一、没有水印时必须整扫 ----------
{
  const w = scanWindow(null, 1_700_000_000_000)
  check(w.full === true, '从未扫过 → 整扫（无法凭空知道「何时起变了」）')
  check(w.sinceIso === '', '整扫时不带 since 参数')
  check(scanWindow(0, 1_700_000_000_000).full === true, '水印为 0 → 整扫')
  check(scanWindow(undefined, 1_700_000_000_000).full === true, '水印缺失 → 整扫')
}

// ---------- 二、有水印时缩窗，且起点往前退一格 ----------
{
  const now = 1_700_000_000_000
  const wm = now - 5 * 60 * 1000            // 5 分钟前扫过
  const w = scanWindow(wm, now)
  check(w.full === false, '有水印 → 缩窗，不整扫')
  check(w.sinceMs === wm - SKEW_MS, '窗口起点 = 水印再往前退一格（抹时钟偏差），实得 ' + (w.sinceMs - wm) + ' ms')
  check(w.sinceMs < wm, '窗口起点严格早于水印 —— 宁可重叠，不可留缝')
  check(new Date(w.sinceIso).getTime() === w.sinceMs, 'since 参数与起点时刻一致（' + w.sinceIso + '）')
}

// ---------- 三、超长间隙退化成整扫 ----------
{
  const now = 1_700_000_000_000
  check(scanWindow(now - MAX_WINDOW_MS - 1, now).full === true, '间隙超过窗口上限（' + Math.round(MAX_WINDOW_MS / 86400000) + ' 天）→ 整扫，避免一次拉回几乎全量')
  check(scanWindow(now - MAX_WINDOW_MS + 60000, now).full === false, '间隙刚好在上限内 → 仍然缩窗')
}

// ---------- 四、合并：增量并进基线，得到完整索引 ----------
{
  const baseline = { '1': 'OPEN|t1', '2': 'OPEN|t2', '3': 'CLOSED|t3' }
  const delta = { '2': 'CLOSED|t2b' }          // 只有 2 号在窗口内变了
  const merged = mergeDelta(baseline, delta)
  check(Object.keys(merged).length === 3, '合并后仍是 3 条（增量不缩减基线）')
  check(merged['2'] === 'CLOSED|t2b', '窗口内变动的票被新值覆盖')
  check(merged['1'] === 'OPEN|t1' && merged['3'] === 'CLOSED|t3', '窗口外的票原样保留')
  check(Object.keys(baseline).length === 3 && baseline['2'] === 'OPEN|t2', '合并不改动入参（纯函数）')

  const added = mergeDelta(baseline, { '9': 'OPEN|t9' })
  check(Object.keys(added).length === 4, '增量里的新票被加进合并结果')
}

// ---------- 五、假报：窗口内没变动时不许判成「变了」 ----------
{
  const baseline = { '1': 'OPEN|t1', '2': 'OPEN|t2', '3': 'CLOSED|t3' }
  // 这是最容易写错的一处：窗口是空的，或只有一条与基线完全相同的记录
  const mergedEmpty = mergeDelta(baseline, {})
  check(indexDiffers(baseline, mergedEmpty) === false, '空增量 + 基线 → 判「没变」（防假报：每分钟都不许触发重建）')

  const mergedSame = mergeDelta(baseline, { '2': 'OPEN|t2' })
  check(indexDiffers(baseline, mergedSame) === false, '增量与基线逐字相同 → 判「没变」（防假报）')
}

// ---------- 六、真变动必须被检出 ----------
{
  const baseline = { '1': 'OPEN|t1', '2': 'OPEN|t2', '3': 'CLOSED|t3' }
  check(indexDiffers(baseline, mergeDelta(baseline, { '2': 'CLOSED|t2b' })) === true, '状态变了（开→关）→ 判「变了」')
  check(indexDiffers(baseline, mergeDelta(baseline, { '2': 'OPEN|t2c' })) === true, '只有更新时间变了（加了评论）→ 判「变了」')
  check(indexDiffers(baseline, mergeDelta(baseline, { '4': 'OPEN|t4' })) === true, '新增一条 → 判「变了」')
  check(indexDiffers(baseline, { '1': 'OPEN|t1', '3': 'CLOSED|t3' }) === true, '少一条（被删除）→ 判「变了」')
}

// ---------- 七、没有基线时必须判「变了」（否则首轮不建基线） ----------
{
  check(indexDiffers(null, { '1': 'OPEN|t1' }) === true, '无基线 → 判「变了」，首轮才会建基线')
}

// ---------- 八、水印取「扫描发起前」，保证两轮重叠 ----------
{
  const started = 1_700_000_000_000
  const wm = nextWatermark(started)
  check(wm === started, '新水印 = 本次扫描发起的时刻（不是结束时刻）')
  // 关键性质：下一轮的窗口起点必须早于本次扫描的结束时刻，否则两次扫描之间会留缝
  const next = scanWindow(wm, started + 9000)   // 假设本轮扫了 9 秒
  check(next.sinceMs < started + 9000, '下一轮窗口起点早于本轮结束时刻 —— 两轮之间不留缝（防漏报）')
  check(next.sinceMs <= started, '下一轮窗口起点不晚于本轮起始 —— 改动必然落在某一轮窗口内')
}

// ---------- 九、从快照取基线（解决「重启后第一次必整扫」）----------
{
  // 关键：快照里的 issues 数组并不保证包含全部票，地图容器与子票可能只挂在地图下面。
  // 少算哪一条，那条票的关闭/删除就永远不会被检出——静默漏报，比慢一点严重得多。
  const snap = {
    generatedMs: 1_700_000_000_000,
    issues: [{ number: 1, state: 'open', updatedAt: '2026-09-11T04:54:05Z' }],
    maps: [
      { number: 2, state: 'OPEN', updatedAt: '2026-09-11T04:54:06Z', tickets: [{ number: 3, state: 'CLOSED', updatedAt: '2026-09-11T04:54:07Z' }] },
    ],
  }
  const idx = indexFromSnapshot(snap)
  check(!!idx && Object.keys(idx).length === 3, '取基线：issues + 地图容器 + 地图子票三类都算进来（实得 ' + (idx ? Object.keys(idx).length : 0) + ' 条）')
  check(idx['1'] === 'OPEN|2026-09-11T04:54:05Z', '取基线：口径与索引扫描逐字一致（状态大写 + 竖线 + 更新时间）')
  check(idx['3'] === 'CLOSED|2026-09-11T04:54:07Z', '取基线：地图子票也在内（漏掉它就等于那条票的关闭永远查不出来）')
  check(indexFromSnapshot(null) === null, '取基线：空快照返回 null（调用方据此退回整扫）')
  check(indexFromSnapshot({}) === null, '取基线：没有票的快照返回 null')
}

// ---------- 十、用快照给重启后的第一次扫描立起点 ----------
{
  const gen = 1_700_000_000_000
  const snap = { generatedMs: gen, issues: [{ number: 1, state: 'OPEN', updatedAt: 't1' }] }
  const seeded = seedFromSnapshot(snap, gen + 5 * 60 * 1000)
  check(!!seeded && seeded.watermarkMs === gen, '立起点：水印 = 快照生成时刻（快照就是那一刻的真实状态）')
  check(!!seeded && seeded.baseline['1'] === 'OPEN|t1', '立起点：基线来自快照本身')

  // 有起点之后，本次扫描应当是缩窗的 —— 这正是「重启后第一次不再整扫」的关键
  const w = scanWindow(seeded.watermarkMs, gen + 5 * 60 * 1000)
  check(w.full === false, '立起点后本次扫描缩窗（重启后第一次不再整扫，这是收益所在）')

  check(seedFromSnapshot({ generatedMs: gen, issues: [{ number: 1, state: 'OPEN', updatedAt: 't1' }] }, gen + MAX_WINDOW_MS + 1) === null,
    '立起点：快照太旧（超过窗口上限）→ 不给起点，退回整扫')
  check(seedFromSnapshot(null, gen) === null, '立起点：没有快照 → 不给起点')
  check(seedFromSnapshot({ generatedMs: 0, issues: [{ number: 1 }] }, gen) === null, '立起点：快照没有生成时刻 → 不给起点')
  check(seedFromSnapshot({ generatedMs: gen, issues: [] }, gen) === null, '立起点：快照里一条票都没有 → 不给起点')
  check(seedFromSnapshot({ generatedMs: gen + 999999, issues: [{ number: 1 }] }, gen) === null, '立起点：生成时刻在将来（时钟异常）→ 不给起点')
}

console.log(failed ? '\n增量索引时间窗门禁未通过 ' + failed + '/' + total : '\n增量索引时间窗门禁全部通过（' + total + ' 项）')
process.exit(failed ? 1 : 0)
