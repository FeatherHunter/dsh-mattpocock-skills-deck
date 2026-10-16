#!/usr/bin/env node
/**
 * verify-multilevel-cache.js — #327 多级缓存与上次探测时间门禁
 *
 * 覆盖：
 *  - 特性 A：lastProbeAtByCwd/getProbeAt/touchProbeAt 在场；快照校验（ok/304）与 wf.probe 完成即走针；
 *    状态栏 timeStr 优先取上次探测时间（数据不变也走针）
 *  - 特性 B：IndexedDB 磁盘层（dsws-cache/snapshots，不可用环境静默降级）；setCachedSnapshot 写穿透（内存+磁盘）；
 *    loadSnapshot 内存未命中先查磁盘，命中秒显（不出现可见加载态）且照常发起网络校验
 *  - 双产物一致：client.js 与 package/lib/client.js 均含上述接线
 *
 * 说明：这里全部是「产物里还在不在」的在场检查（indexOf 判子串），不是行为证明——
 * 源码坏了但字面还在，它照样绿。2026-10-17 删掉了原来第 4 段「淘汰逻辑行为模拟」：
 * 那两条断言在门禁里自己造 30 条数据、自己排序，与被测代码无关，源码里真淘汰逻辑废掉它也全绿，
 * 属于一段冒充证据的复刻自测。真要守「超出上限按最旧淘汰」得另立一条行为级门禁（本票不写）。
 */
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
let failed = false
let passed = 0
const ok = (msg) => { passed++; console.log('  PASS', msg) }
const bad = (msg) => { failed = true; console.log('  FAIL', msg) }
// 产物缺失时直接说人话：这两份产物在 .gitignore 里，新克隆的树没跑构建就没它们，
// 抛裸 ENOENT 栈会让人以为是门禁坏了（邻居 verify-kernel.js 是老写法，这里按人话写法）。
function read(rel) {
  const p = path.join(root, rel)
  if (!fs.existsSync(p)) {
    console.error('找不到构建产物 ' + rel + '：请先运行 node scripts/build.mjs 再跑这条门禁。')
    process.exit(1)
  }
  return fs.readFileSync(p, 'utf8')
}
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
  // #653 口径变更（本门禁同步改）：走针广播与探测时间的键从「所选目录的归一键」升级为「工作区根键」，
  // 于是同一个仓库里的子目录会话与根会话共用一条上次探测时间、一起随广播重渲染。
  has(src, 'wsKeyOf(shared.cwd) === k) emit(shared)', name, 'shared 走针广播（按工作区键）')
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
  // #653 口径变更（本门禁同步改）：磁盘层读写都按工作区根键，子目录会话因此能秒显根会话已经写下的那份快照
  has(src, "await diskGetSnapshot(wsKeyOf(st.cwd || ''))", name, '内存未命中先查磁盘（按工作区键）')
  has(src, 'setCachedSnapshot(st.cwd, ent.snapshot)', name, '磁盘命中回填内存缓存')
  has(src, "if (force && !silent && !hasCache) st.snapMode = 'loading'", name, '可见加载态仅限三层全未命中')
  has(src, 'lastProbeAt > getProbeAt(st.cwd)) lastProbeAtByCwd.set', name, '磁盘条目恢复上次探测时间')
  has(src, 'const doLoad = async function () {', name, 'doLoad 支持磁盘异步读')
}

console.log('\n=== 汇总：' + passed + ' PASS / ' + (failed ? 'FAIL' : '0 FAIL') + ' ===')
process.exit(failed ? 1 : 0)
