#!/usr/bin/env node
/**
 * verify-multilevel-cache.ts — #327 多级缓存与上次探测时间门禁
 *
 * 覆盖：
 *  - 特性 A：lastProbeAtByCwd/getProbeAt/touchProbeAt 在场；快照校验（ok/304）与 wf.probe 完成即走针；
 *    状态栏常驻时刻取快照的取数时刻（与右侧面板头部同源；2026-10-24 起探测时间不再画在胶囊上）
 *  - 特性 B（#1863 起改口径）：客户端不再有 IndexedDB 持久快照，只留内存 LRU 与在途请求；
 *    loadSnapshot 只水合内存缓存，命中不出现可见加载态并照常发起网络校验（首屏的本地数据改由宿主从快照库回放）
 *  - 双产物一致：client.js 与 package/lib/client.js 均含上述接线
 *
 * 说明：这里全部是「产物里还在不在」的在场检查（原来逐条 indexOf 判子串，现在找不到时再按
 * 「去掉空白与注释、单引号折成双引号」比一遍，见下面 has() 的注释；仍是子串在场，不是行为证明——
 * 源码坏了但字面还在，它照样绿。2026-10-17 删掉了原来第 4 段「淘汰逻辑行为模拟」：
 * 那两条断言在门禁里自己造 30 条数据、自己排序，与被测代码无关，源码里真淘汰逻辑废掉它也全绿，
 * 属于一段冒充证据的复刻自测。真要守「超出上限按最旧淘汰」得另立一条行为级门禁（本票不写）。
 */
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
let failed = false
let passed = 0
const ok = (msg: string): void => { passed++; console.log('  PASS', msg) }
const bad = (msg: string): void => { failed = true; console.log('  FAIL', msg) }
// 产物缺失时直接说人话：这两份产物在 .gitignore 里，新克隆的树没跑构建就没它们，
// 抛裸 ENOENT 栈会让人以为是门禁坏了（邻居 verify-kernel.ts 是老写法，这里按人话写法）。
function read(rel: string): string {
  const p = path.join(root, rel)
  if (!fs.existsSync(p)) {
    console.error('找不到构建产物 ' + rel + '：请先运行 node scripts/build.mts 再跑这条门禁。')
    process.exit(1)
  }
  return fs.readFileSync(p, 'utf8')
}
const has = (src: string, needle: string, name: string, label: string): void => {
  (src.indexOf(needle) >= 0 || squashed(src).indexOf(squash(needle)) >= 0) ? ok(name + ' ' + label) : bad(name + ' ' + label)
}
// 反向断言：那一段代码必须已经不在产物里（用于锁住「换掉一条旧路径」的语义变更，防止它被顺手改回来）。
const hasNot = (src: string, needle: string, name: string, label: string): void => {
  (src.indexOf(needle) < 0 && squashed(src).indexOf(squash(needle)) < 0) ? ok(name + ' ' + label) : bad(name + ' ' + label)
}
// 「这一段代码还在产物里」怎么认（#1251 之后产物形状变了，判据本身没放宽）：
//   产物是 esbuild 拼出来的（同名 .js 就是构建产物），与手写真源有两处系统性差异 ——
//   ① 字符串一律输出双引号（真源写单引号）；
//   ② 行内会插标注注释（`const x = /* @__PURE__ */ new Map()`），`function ()` 印成 `function()`。
//   所以比对分两级：先按字面原样找（与旧写法完全一致，命中就走），找不到再把两边都「去掉空白与
//   注释、把单引号折成双引号」后找。折过之后比的仍是同一个 needle 的每个字符按原顺序出现，锚点词
//   一个不少；真要把这段代码删掉、改名或换掉语义，两级都找不到，照样掀红。
function squash(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, '').replace(/'/g, '"')
}
let squashFrom = ''
let squashTo = ''
function squashed(text: string): string {
  if (text !== squashFrom) { squashFrom = text; squashTo = squash(text) }
  return squashTo
}

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
  // 2026-10-24 语义变更（本门禁同步改）：胶囊常驻时刻改为与右侧面板同源的「快照取数时刻」；
  //   上次探测时间只用于新鲜度判断与磁盘条目恢复，不再画在界面上。改回优先探测时间会让两块时间再次互相矛盾。
  has(src, 'timeOf(s.snapshot)', name, '状态栏时刻取快照取数时刻（与面板同源）')
  hasNot(src, 'getProbeAt(s.cwd)', name, '状态栏不再读探测时间')
  hasNot(src, 'timeOfMs(_probeMs)', name, '状态栏不再格式化探测时间')}

console.log('\n2) 特性 B：客户端持久快照退役（#1863）')
for (const [name, src] of targets) {
  // 反向断言锁住语义变更：GitHub 这一端不再产生第二份持久快照。改回 IndexedDB 会让同一屏出现两个本地数据源。
  hasNot(src, "'dsws-cache'", name, '不再引用 IDB 库名 dsws-cache')
  hasNot(src, "'snapshots'", name, '不再引用 IDB 表名 snapshots')
  hasNot(src, 'window.indexedDB', name, '代码里不再碰 IndexedDB')
  hasNot(src, 'diskPutSnapshot', name, '客户端持久快照的写入口已删除（#1870）')
  hasNot(src, 'diskGetSnapshot', name, '客户端持久快照的读入口已删除（#1870）')
  hasNot(src, 'SNAP_DISK_CAP', name, '磁盘 LRU 上限这一格已删除（#1870）')
}

console.log('\n3) 特性 B：loadSnapshot 读路径（只水合内存，命中不出现可见加载）')
for (const [name, src] of targets) {
  has(src, 'let hasCache = !!(st.snapshot || getCachedSnapshot(st.cwd))', name, 'hasCache 只看内存快照')
  hasNot(src, 'await diskGetSnapshot(wsKeyOf', name, '内存未命中不再查磁盘')
  hasNot(src, 'setCachedSnapshot(st.cwd, ent.snapshot)', name, '不再从磁盘条目回填内存缓存')
  hasNot(src, 'lastProbeAt > getProbeAt(st.cwd)) lastProbeAtByCwd.set', name, '不再从磁盘条目恢复上次探测时间')
  has(src, "if (force && !silent && !hasCache) st.snapMode = 'loading'", name, '可见加载态仍只在没有任何缓存时出现')
  has(src, 'const doLoad = async function () {', name, 'doLoad 仍是异步装载函数')
}

console.log('\n=== 汇总：' + passed + ' PASS / ' + (failed ? 'FAIL' : '0 FAIL') + ' ===')
process.exit(failed ? 1 : 0)
