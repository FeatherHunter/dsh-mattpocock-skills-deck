#!/usr/bin/env node
/**
 * verify-683-mirror-write.js —— F1「用户选的后端按工作区存在宿主侧」的客户端那半边：
 * 本地那份镜像表怎么写（ADR docs/adr/20260921-persist-user-choice-host-side.md 的 R7b、R7c）。
 *
 * 量的是什么：这张镜像表（localStorage 里的 dsws.selectionByCwd 与 dsws.setupLayoutByCwd）
 *   从前是把进程内存里那份**整表**序列化写回。同一个访问地址开两个窗口时，后写的那扇窗会把
 *   另一扇窗刚写进去的键整条顶掉 —— 一个窗口里选完后端，另一个窗口一刷新就看不见了。
 *   现在改成「读回磁盘上那张 → 只换本工作区那一条 → 写回」，并监听 storage 事件把磁盘那份合并回内存；
 *   写失败照同文件 saveListPrefs / saveLabelClicks 的先例记一条 storage.fail。
 *
 * 做法：把 src/client/kernel/store-prefs.js 的真身文本喂进一个沙箱求值（真源、假 localStorage 与假 window），
 *   再用改坏的那一份跑同一批断言 —— 该红的必须当场红（只比字符串不等、却仍跑真源，等于这道反证是假的）。
 *
 * 用法：node tests/verify-683-mirror-write.js
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const PREFS_REL = 'src/client/kernel/store-prefs.js'
let passed = 0
let failed = 0
const check = (ok, msg) => { if (ok) { console.log('  PASS ' + msg); passed++ } else { console.log('  FAIL ' + msg); failed++ } }

const prefsSrc = fs.readFileSync(path.join(ROOT, PREFS_REL), 'utf8')
// 还没落地这一步时，先明说缺什么再退出（别让沙箱求值抛个看不懂的 ReferenceError 出来）。
if (!/const writeTableEntry = function/.test(prefsSrc) || !/const onStorageMerge = function/.test(prefsSrc)) {
  console.log('  FAIL 源文件里还没有「按工作区键读-改-写 + 跨窗口合并」那两个函数（writeTableEntry / onStorageMerge）')
  console.log('\n存在失败 — verify-683-mirror-write 未通过')
  process.exit(1)
}
const stripExports = (s) => s.replace(/^[ \t]*export[ \t]+/gm, '')
const TBL_SEL = 'dsws.selectionByCwd'
const TBL_LAYOUT = 'dsws.setupLayoutByCwd'
// 工作区键：真身是 shared:workspaceKey 的 keyOf / wsKeyOf（这里给一个把反斜杠与大小写归一的小替身，
//   只为让断言读起来像真的；这个函数本身在别的门禁里量，不在这一份的范围内）。
const wsKey = (p) => String(p == null ? '' : p).replace(/\\/g, '/').toLowerCase()

const makeHarness = function (srcText, opts) {
  const o = opts || {}
  const disk = {}
  Object.keys(o.disk || {}).forEach((k) => { disk[k] = o.disk[k] })
  const logs = []
  const storageHandlers = []
  const failKeys = o.failKeys || []
  const localStorage = {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(disk, k) ? disk[k] : null },
    setItem: function (k, v) { if (failKeys.indexOf(k) >= 0) throw new Error('quota-exceeded'); disk[k] = String(v) },
    removeItem: function (k) { delete disk[k] },
  }
  const win = { innerHeight: 800, addEventListener: function (name, fn) { storageHandlers.push({ name: name, fn: fn }) } }
  const body = stripExports(srcText) +
    '\n; return { setCachedSelection: setCachedSelection, getCachedSelection: getCachedSelection, selectionByCwd: selectionByCwd,' +
    ' setCachedSetupLayout: setCachedSetupLayout, getCachedSetupLayout: getCachedSetupLayout, setupLayoutByCwd: setupLayoutByCwd,' +
    ' writeTableEntry: writeTableEntry, migrateCachedChoiceToKey: migrateCachedChoiceToKey, SELECTION_BY_CWD_KEY: SELECTION_BY_CWD_KEY, SETUP_LAYOUT_BY_CWD_KEY: SETUP_LAYOUT_BY_CWD_KEY }'
  const factory = new Function('window', 'localStorage', 'log', 'keyOf', 'wsKeyOf', 'emit', 'shared', 'stores', body)
  const api = factory(win, localStorage, function (level, event, fields) { logs.push({ level: level, event: event, fields: fields }) }, wsKey, wsKey, function () {}, {}, {})
  return { api: api, disk: disk, logs: logs, handlers: storageHandlers }
}
const tableOf = (h, key) => { try { return JSON.parse(h.disk[key] || '{}') || {} } catch (e) { return {} } }
const fireStorage = (h, key) => {
  const hs = h.handlers.filter((x) => x.name === 'storage')
  if (!hs.length) return false
  hs.forEach((x) => x.fn({ key: key }))
  return true
}

console.log('镜像表写法门禁（#683 F1：按工作区键读-改-写、跨窗口合并、写失败看得见）')

// ── A 读-改-写：磁盘上别的工作区那一条不许被顶掉 ─────────────────────────────────────────
console.log('')
console.log('== A 按工作区键读-改-写（R7b）==')
{
  const h = makeHarness(prefsSrc, { disk: { [TBL_SEL]: JSON.stringify({ 'd:/other/window': { backendId: 'gitlab', userPicked: true } }) } })
  h.api.setCachedSelection('D:\\Mine', { backendId: 'github', userPicked: true })
  const t = tableOf(h, TBL_SEL)
  check(!!t['d:/other/window'], '写本工作区那一条时，磁盘上别的工作区那一条**还在**（不被整表覆盖顶掉）—— 磁盘上现在有：' + Object.keys(t).join('、'))
  check(!!t['d:/mine'] && t['d:/mine'].backendId === 'github', '本工作区那一条照旧写进去了 —— 实得 ' + JSON.stringify(t['d:/mine']))
  check(h.api.getCachedSelection('D:\\Mine').backendId === 'github', '读回来还是本工作区这条（内存那份没被写盘动作搞坏）')

  const h2 = makeHarness(prefsSrc, { disk: { [TBL_LAYOUT]: JSON.stringify({ 'd:/other/window': 'multi' }) } })
  h2.api.setCachedSetupLayout('D:\\Mine', 'single')
  const t2 = tableOf(h2, TBL_LAYOUT)
  // #683（F1 · R6）：这张表里一条现在存 {layout, pickedAt}（与后端那张同一种形状），读出来还是取值本身。
  check(!!t2['d:/other/window'] && t2['d:/mine'] && t2['d:/mine'].layout === 'single' && typeof t2['d:/mine'].pickedAt === 'number', '布局那张表同例：别的工作区那条留住、本工作区这条写进去（存的是 {layout, pickedAt}）—— 实得 ' + JSON.stringify(t2))
  check(h2.api.getCachedSetupLayout('D:\\Mine') === 'single', '布局读得回来（读出来还是取值本身，形状变了外面看不出来）')
  check(h2.api.getCachedSetupLayout('D:/other/window') === 'multi', '老版本存的裸字符串照旧认得出来（当 pickedAt=0，下一次写盘就换成新形状）')
  h2.api.setCachedSetupLayout('D:\\Mine', '不认识')
  check(tableOf(h2, TBL_LAYOUT)['d:/mine'].layout === 'single', '布局取值只认 single 与 multi（不认识的照旧不写盘）')
  // 两个壳各答一个样时按时刻仲裁：新的覆盖旧的，旧的不许顶掉新的。
  const h3 = makeHarness(prefsSrc, {})
  h3.api.setCachedSetupLayout('D:\\Mine', 'single')
  const atLocal = tableOf(h3, TBL_LAYOUT)['d:/mine'].pickedAt
  h3.api.setCachedSetupLayout('D:\\Mine', { layout: 'multi', pickedAt: atLocal - 1000 })
  check(h3.api.getCachedSetupLayout('D:\\Mine') === 'single', '宿主回填的老值不许顶掉本地更新的那条（时刻旧的输）')
  h3.api.setCachedSetupLayout('D:\\Mine', { layout: 'multi', pickedAt: atLocal + 1000 })
  check(h3.api.getCachedSetupLayout('D:\\Mine') === 'multi', '宿主回填的新值照常收下（时刻新的赢，落后的那扇窗跟上）')
}

// ── B 写失败看得见（R7c）─────────────────────────────────────────────────────────────
console.log('')
console.log('== B 写失败不再一口吞掉（R7c）==')
{
  const h = makeHarness(prefsSrc, { failKeys: [TBL_SEL] })
  h.api.setCachedSelection('D:\\X', { backendId: 'github', userPicked: true })
  const fail = h.logs.filter((l) => l.event === 'storage.fail')
  check(fail.length >= 1, '写失败记了一条 storage.fail —— 实得 ' + JSON.stringify(h.logs))
  check(fail.length >= 1 && fail[0].fields && fail[0].fields.key === TBL_SEL && fail[0].fields.op === 'write', '那条日志带的是这张表的键与 write 这个操作 —— 实得 ' + JSON.stringify(fail[0] && fail[0].fields))
  check(!!h.api.getCachedSelection('D:\\X') && h.api.getCachedSelection('D:\\X').backendId === 'github', '写不进去时降级为仅内存（不崩、本次会话照旧可用）')
}

// ── C 跨窗口合并：storage 事件 ────────────────────────────────────────────────────────
console.log('')
console.log('== C 另一个窗口改了这张表 → 内存里跟上（R7b）==')
{
  const h = makeHarness(prefsSrc, {})
  check(h.handlers.some((x) => x.name === 'storage'), '登记了 storage 事件监听（跨窗口这一半才有人接）')
  h.disk[TBL_SEL] = JSON.stringify({ 'd:/other/window': { backendId: 'gitlab', userPicked: true } })
  const fired = fireStorage(h, TBL_SEL)
  check(fired, 'storage 事件真的被触发到（监听器在）')
  const got = h.api.getCachedSelection('D:/other/window')
  check(!!got && got.backendId === 'gitlab', '别的工作区那一跳出窗口写进来之后，本窗口读得到 —— 实得 ' + JSON.stringify(got))
  h.disk[TBL_LAYOUT] = JSON.stringify({ 'd:/other/window': 'multi' })
  fireStorage(h, TBL_LAYOUT)
  check(h.api.getCachedSetupLayout('D:/other/window') === 'multi', '布局那张表同例：跨窗口合并读得到')
  h.disk[TBL_SEL] = '不是 JSON'
  fireStorage(h, TBL_SEL)
  check(true, '磁盘上那份读不出来时不抛错（按内存里这份继续用）')
}

// ── D 静态：整表覆盖那两行已经不在文件里 ───────────────────────────────────────────────
console.log('')
console.log('== D 静态：整表覆盖的写法已经不在源文件里 ==')
{
  check(!/JSON\.stringify\(selectionByCwd\)/.test(prefsSrc), '源文件里没有「把整张 selectionByCwd 序列化写回」那一句了')
  check(!/JSON\.stringify\(setupLayoutByCwd\)/.test(prefsSrc), '源文件里没有「把整张 setupLayoutByCwd 序列化写回」那一句了')
  const snapSrc = fs.readFileSync(path.join(ROOT, 'src/client/kernel/store-snapshot.js'), 'utf8')
  check(/migrateCachedChoiceToKey\(sk, rk\)/.test(snapSrc), '工作区根认出来的那一刻（store-snapshot.js 的 rememberWorkspaceRoot）会调搬家那一步')
}

// ── E 工作区根后来才认出来：老键上的记录搬到根键（R7d）────────────────────────────────
console.log('')
console.log('== E 工作区根后来才认出来 → 老键上的记录搬到根键（R7d）==')
{
  const h = makeHarness(prefsSrc, {})
  h.api.setCachedSelection('D:\\Repo\\Sub', { backendId: 'markdown', userPicked: true, rev: 2 })
  h.api.setCachedSetupLayout('D:\\Repo\\Sub', 'multi')
  h.api.setCachedSelection('D:\\Other', { backendId: 'gitlab', userPicked: true })
  const moved = h.api.migrateCachedChoiceToKey('d:/repo/sub', 'd:/repo')
  check(moved === true, '认到根时搬家真的做了（回 true）')
  const atRoot = h.api.getCachedSelection('D:\\Repo')
  check(!!atRoot && atRoot.backendId === 'markdown' && atRoot.rev === 2, '根键上现在读得到老键那条选择（连版本位一起搬）—— 实得 ' + JSON.stringify(atRoot))
  check(h.api.getCachedSetupLayout('D:\\Repo') === 'multi', '布局那一栏同样搬到根键上')
  const disk = tableOf(h, TBL_SEL)
  check(!!disk['d:/repo'] && disk['d:/repo'].backendId === 'markdown', '搬过去的也写进了磁盘那张表（不是只在内存里）')
  check(!!disk['d:/other'] && disk['d:/other'].backendId === 'gitlab', '别的工作区那条不受影响')
  // 根键上已经有记录时不覆盖（只补空缺）
  const h2 = makeHarness(prefsSrc, {})
  h2.api.setCachedSelection('D:\\Repo\\Sub', { backendId: 'markdown', userPicked: true, rev: 2 })
  h2.api.setCachedSelection('D:\\Repo', { backendId: 'github', userPicked: true, rev: 9 })
  h2.api.migrateCachedChoiceToKey('d:/repo/sub', 'd:/repo')
  const kept = h2.api.getCachedSelection('D:\\Repo')
  check(!!kept && kept.backendId === 'github' && kept.rev === 9, '根键上已经有记录时不动它（谁在根键上选过就以谁为准）—— 实得 ' + JSON.stringify(kept))
  const h3 = makeHarness(prefsSrc, {})
  check(h3.api.migrateCachedChoiceToKey('d:/same', 'd:/same') === false, '同一个键搬家时什么都不做（回 false）')
  check(h3.api.migrateCachedChoiceToKey('', 'd:/repo') === false, '空的老键不搬家（回 false）')
}

// ── F 反证：把实现做坏，上面该红的必须当场红 ───────────────────────────────────────────
console.log('')
console.log('== F 反证：把实现做坏，对应的那几条必须当场红 ==')
const brokenDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-683-mirror-'))
const loadBroken = function (tag, from, to) {
  if (!prefsSrc.includes(from)) return { bad: '这道反证的改法在真源里找不到落点（源文本已变）' }
  const file = path.join(brokenDir, tag + '.js')
  fs.writeFileSync(file, prefsSrc.replace(from, to), 'utf8')
  return { src: fs.readFileSync(file, 'utf8') }
}
{
  // E1 退回「整表覆盖」：写盘前不再把磁盘上那张读回来
  const b1 = loadBroken('whole-table', "        try { const raw = localStorage.getItem(storeKey); table = raw ? JSON.parse(raw) : null } catch (eR) { table = null }", '')
  check(!b1.bad, '反证 F1 的改法能在真源里落地（写盘前不读回磁盘那张表）' + (b1.bad ? ' —— ' + b1.bad : ''))
  if (b1.src) {
    const h = makeHarness(b1.src, { disk: { [TBL_SEL]: JSON.stringify({ 'd:/other/window': { backendId: 'gitlab', userPicked: true } }) } })
    h.api.setCachedSelection('D:\\Mine', { backendId: 'github', userPicked: true })
    const t = tableOf(h, TBL_SEL)
    check(!t['d:/other/window'], '反证 F1 成立：退回整表覆盖之后，别的工作区那一条当场被顶掉 —— 说明 A 组量的是「读-改-写」这一步')
  }
  // E2 写失败不记日志
  const b2 = loadBroken('silent-fail', "try { log('warn', 'storage.fail', { key: storeKey, op: 'write' }) } catch (eL) {}", 'void 0')
  check(!b2.bad, '反证 F2 的改法能在真源里落地（写失败不再记日志）' + (b2.bad ? ' —— ' + b2.bad : ''))
  if (b2.src) {
    const h = makeHarness(b2.src, { failKeys: [TBL_SEL] })
    h.api.setCachedSelection('D:\\X', { backendId: 'github', userPicked: true })
    check(h.logs.filter((l) => l.event === 'storage.fail').length === 0, '反证 F2 成立：不记日志之后，写失败现场一条痕迹都没有 —— 说明 B 组量的是这条 storage.fail')
  }
  // F3 不登记 storage 监听
  const b3 = loadBroken('no-listener', "window.addEventListener('storage', onStorageMerge)", 'void 0')
  check(!b3.bad, '反证 F3 的改法能在真源里落地（不登记 storage 监听）' + (b3.bad ? ' —— ' + b3.bad : ''))
  if (b3.src) {
    const h = makeHarness(b3.src, {})
    check(!h.handlers.some((x) => x.name === 'storage'), '反证 F3 成立：不登记监听之后，另一个窗口写进来的那条本窗口永远看不见 —— 说明 C 组量的是这个监听')
  }
  // F4 搬家（R7d）从「只补空缺」改成「直接覆盖」
  const b4 = loadBroken('migrate-overwrite', 'if (!(toKey in selectionByCwd)) {', 'if (true) {')
  check(!b4.bad, '反证 F4 的改法能在真源里落地（搬家改成直接覆盖）' + (b4.bad ? ' —— ' + b4.bad : ''))
  if (b4.src) {
    const h = makeHarness(b4.src, {})
    h.api.setCachedSelection('D:\\Repo\\Sub', { backendId: 'markdown', userPicked: true, rev: 2 })
    h.api.setCachedSelection('D:\\Repo', { backendId: 'github', userPicked: true, rev: 9 })
    h.api.migrateCachedChoiceToKey('d:/repo/sub', 'd:/repo')
    const kept = h.api.getCachedSelection('D:\\Repo')
    check(!!kept && kept.backendId === 'markdown', '反证 F4 成立：改成直接覆盖之后，根键上已经有的那条被老键顶掉了 —— 说明 E 组量的就是「只补空缺」这一步')
  }
}

// ── G 客户端拿到快照就回填（选择走 mergeSelection、布局走 setCachedSetupLayout）────────────────
console.log('')
console.log('== G 客户端拿到快照就回填本地镜像 ==')
{
  const probe = fs.readFileSync(path.join(ROOT, 'src/client/kernel/probe-snapshot.js'), 'utf8')
  const i304 = probe.indexOf('snap.notModified===true')
  check(i304 >= 0, 'probe-snapshot.js 里有 304 分支')
  const branch304 = i304 >= 0 ? probe.slice(i304, i304 + 1200) : ''
  check(/mergeSelection\(st, snap\.selection\)/.test(branch304), '304 分支合并回包里的权威选择（版本号没变不代表后端没变）')
  check(/setCachedSetupLayout\(st\.cwd, snap\.setupLayout\)/.test(branch304), '304 分支回填记住的布局')
  check(/st\.snapshot = snap[\s\S]{0,300}setCachedSetupLayout\(st\.cwd, snap\.setupLayout\)/.test(probe), '正常装快照那条路也回填记住的布局')
  // 反证：把 304 分支那两行拿掉 → 上面两条当场红（两处回填都要拿掉，只拿一处不算）
  const backfillRe = /try \{ if \(snap\.setupLayout && typeof setCachedSetupLayout === 'function'\) setCachedSetupLayout\(st\.cwd, snap\.setupLayout\) \} catch \(eSL\) \{\}/g
  const broken = probe.replace(backfillRe, 'void 0')
  check(broken !== probe, '反证 G 的改法能在真源里落地（拿掉回填那两行）')
  check(!/setCachedSetupLayout\(st\.cwd, snap\.setupLayout\)/.test(broken), '反证 G 成立：拿掉之后上面那两条就找不到回填了（说明 G 组量的就是这两行）')
}
try { fs.rmSync(brokenDir, { recursive: true, force: true }) } catch (e) {}

console.log('')
console.log(failed ? '存在失败 — verify-683-mirror-write 未通过（' + passed + ' 项通过、' + failed + ' 项失败）' : '全部通过 — 镜像表写法门禁生效（' + passed + ' 项断言）')
process.exit(failed ? 1 : 0)
