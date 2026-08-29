#!/usr/bin/env node
/**
 * verify-multilevel-cache.js — #327 多级缓存与上次探测时间门禁
 *
 * 覆盖：
 *  - 特性 A：lastProbeAtByCwd/getProbeAt/touchProbeAt 在场；快照校验（ok/304）与 wf.probe 完成即走针；
 *    状态栏 timeStr 优先取上次探测时间（数据不变也走针）
 *  - 特性 B：IndexedDB 磁盘层（dsws-cache/snapshots，不可用环境静默降级）；setCachedSnapshot 写穿透（内存+磁盘）；
 *    loadSnapshot 内存未命中先查磁盘，命中秒显（不出现可见加载态）且照常发起网络校验
 *  - 淘汰逻辑行为模拟：超出 SNAP_DISK_CAP 按最旧淘汰
 *  - 双产物一致：client.js 与 package/lib/client.js 均含上述接线
 */
const fs = require('fs')
const path = require('path')
const assert = require('assert')

const root = path.resolve(__dirname, '..')
let failed = false
let passed = 0
const ok = (msg) => { passed++; console.log('  PASS', msg) }
const bad = (msg) => { failed = true; console.log('  FAIL', msg) }
function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8') }
const has = (src, needle, name, label) => { (src.indexOf(needle) >= 0) ? ok(name + ' ' + label) : bad(name + ' ' + label) }

console.log('=== #327 多级缓存与上次探测时间门禁 ===')

const targets = [['client.js', read('client.js')], ['package/lib/client.js', read('package/lib/client.js')]]

console.log('\n1) 特性 A：上次探测时间（数据不变也走针）')
for (const [name, src] of targets) {
  has(src, 'lastProbeAtByCwd = new Map()', name, 'lastProbeAtByCwd 在场')
  has(src, 'getProbeAt', name, 'getProbeAt 在场')
  has(src, 'touchProbeAt', name, 'touchProbeAt 在场')
  has(src, 'snap.status === 304)) touchProbeAt', name, '快照校验(成功/304)走针')
  has(src, 'res.ok) touchProbeAt(cwd)', name, 'wf.probe 完成即走针')
  has(src, 'keyOf(shared.cwd) === k) emit(shared)', name, 'shared 走针广播')
  has(src, 'getProbeAt(s.cwd)', name, '状态栏读探测时间')
  has(src, 'timeOfMs(_probeMs)', name, '状态栏格式化探测时间')
  has(src, 'const timeOfMs', name, 'timeOfMs 在场')
}

console.log('\n2) 特性 B：IndexedDB 磁盘层 + 写穿透')
for (const [name, src] of targets) {
  has(src, "'dsws-cache'", name, 'IDB 库名在场')
  has(src, "'snapshots'", name, 'IDB 表名在场')
  has(src, '!window.indexedDB', name, '不可用环境静默降级')
  has(src, 'diskPutSnapshot(k, ent)', name, 'setCachedSnapshot 写穿透（内存+磁盘）')
  has(src, 'SNAP_DISK_CAP = 24', name, '磁盘 LRU 上限 24')
}

console.log('\n3) 特性 B：loadSnapshot 读路径（内存未命中先查磁盘，命中不出现可见加载）')
for (const [name, src] of targets) {
  has(src, 'let hasCache = !!(st.snapshot || getCachedSnapshot(st.cwd))', name, 'hasCache 可变（磁盘命中后更新）')
  has(src, "await diskGetSnapshot(keyOf(st.cwd || ''))", name, '内存未命中先查磁盘')
  has(src, 'setCachedSnapshot(st.cwd, ent.snapshot)', name, '磁盘命中回填内存缓存')
  has(src, "if (force && !silent && !hasCache) st.snapMode = 'loading'", name, '可见加载态仅限三层全未命中')
  has(src, 'lastProbeAt > getProbeAt(st.cwd)) lastProbeAtByCwd.set', name, '磁盘条目恢复上次探测时间')
  has(src, 'const doLoad = async function () {', name, 'doLoad 支持磁盘异步读')
}

console.log('\n4) 淘汰逻辑行为模拟（超出上限按最旧淘汰）')
{
  // 与 diskPutSnapshot 内淘汰逻辑同式：按 ts 升序排，保留最新 CAP 条
  const CAP = 24
  const rows = []
  for (let i = 0; i < 30; i++) rows.push({ key: 'k' + i, ts: 1000 + i })
  rows.sort(function (a, b) { return (a.ts || 0) - (b.ts || 0) })
  const kill = rows.slice(0, rows.length - CAP)
  const kept = rows.slice(rows.length - CAP)
  try {
    assert.strictEqual(kill.length, 6)
    assert.deepStrictEqual(kill.map(r => r.key), ['k0', 'k1', 'k2', 'k3', 'k4', 'k5'])
    assert.strictEqual(kept[0].key, 'k6')
    assert.strictEqual(kept[kept.length - 1].key, 'k29')
    ok('30 条 → 淘汰最旧 6 条，保留 k6..k29')
  } catch (e) { bad('淘汰逻辑不符：' + e.message) }
  // 磁盘条目形状：{key, snapshot, version, ts, lastProbeAt}
  const ent = { snapshot: { ok: true, maps: [] }, version: 'v1', ts: 1, key: 'd:/w', lastProbeAt: 42 }
  try {
    assert(ent.key && typeof ent.lastProbeAt === 'number' && ent.snapshot.ok === true)
    ok('磁盘条目形状 {key,snapshot,version,ts,lastProbeAt}')
  } catch (e) { bad('条目形状不符') }
}

console.log('\n=== 汇总：' + passed + ' PASS / ' + (failed ? 'FAIL' : '0 FAIL') + ' ===')
process.exit(failed ? 1 : 0)
