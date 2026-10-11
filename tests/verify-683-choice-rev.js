#!/usr/bin/env node
/**
 * verify-683-choice-rev.js —— F1 的「修订号那条线」：客户端这一半（ADR 的 R2、R2b、§5 接线）。
 *
 * 为什么要有修订号：用户的选择现在两份存储（浏览器本地一份、宿主侧一份），两边都会旧。
 *   谁更新不能靠时间戳比大小（同一毫秒落笔、NTP 校时、两个壳同毫秒各选一个，这三种可达情况下时间比较
 *   都会让面板跟着旧值走），所以用**宿主发号的修订号**：宿主每接受一次用户选择 +1，客户端把它一路带着走，
 *   上报时用 baseRev 这个名字回给宿主。这一份量的是客户端这一半有没有把版本位带好：
 *   - A：用户亲手选的那一条长什么样（带 pickedAt、带「从哪个修订号来的」）；
 *   - B：没有版本位的老记录按 0 处理；
 *   - C：绑定回包里宿主发的新修订号要落到本地那条上、并写进本地缓存；
 *   - D：版本位必须活过一次快照往返（宿主这次没带时不许把它抹掉）；
 *   - E：全仓扫描 —— 每一处把 hint 报给宿主的调用点都要同时带 baseRev（漏一处就等于那一条上报时会冒充最新版）。
 *   - H：R7c 那条「绑定成了，但宿主没把这次选择记住」的提示 —— 四个绑定确认点都要说，而且理由那句话走词条
 *        （原先四个点各写一份硬编码中文：英文界面上直接印中文，中文那边又与「切换失败：{err}」这个模板
 *        拼成一句自相矛盾的话）。
 *
 * 做法：把 src/client/kernel/store-prefs.js 的真身文本喂进沙箱求值（真源 + 假 localStorage/window），
 *   再用改坏的那一份跑同一批断言 —— 该红的必须当场红。
 *
 * 用法：node tests/verify-683-choice-rev.js
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
// 本文件按文本求值统一走共用入口 compileFn：把 store-prefs.js 真身与假 window/localStorage 一起求值（理由与用法见 tests/lib/eval-probe.js 文件头）。
import { compileFn } from './lib/eval-probe.js'

const ROOT = path.resolve(import.meta.dirname, '..')
const PREFS_REL = 'src/client/kernel/store-prefs.js'
let passed = 0
let failed = 0
const check = (ok, msg) => { if (ok) { console.log('  PASS ' + msg); passed++ } else { console.log('  FAIL ' + msg); failed++ } }
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

const prefsSrc = read(PREFS_REL)
for (const need of ['export const baseRevOf', 'export const userPickSelection', 'export const adoptBoundRev']) {
  if (!prefsSrc.includes(need)) {
    console.log('  FAIL store-prefs.js 里还没有 ' + need + ' —— 修订号那条线还没落地')
    console.log('\n存在失败 — verify-683-choice-rev 未通过')
    process.exit(1)
  }
}
const stripExports = (s) => s.replace(/^[ \t]*export[ \t]+/gm, '')
const wsKey = (p) => String(p == null ? '' : p).replace(/\\/g, '/').toLowerCase()

const makeHarness = function (srcText, opts) {
  const o = opts || {}
  const disk = {}
  Object.keys(o.disk || {}).forEach((k) => { disk[k] = o.disk[k] })
  const logs = []
  const localStorage = {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(disk, k) ? disk[k] : null },
    setItem: function (k, v) { disk[k] = String(v) },
    removeItem: function (k) { delete disk[k] },
  }
  const win = { innerHeight: 800, addEventListener: function () {} }
  const body = stripExports(srcText) +
    '\n; return { baseRevOf: baseRevOf, userPickSelection: userPickSelection, adoptBoundRev: adoptBoundRev, keepUserPick: keepUserPick,' +
    ' userHintOf: userHintOf, getCachedSelection: getCachedSelection, selectionByCwd: selectionByCwd, SELECTION_BY_CWD_KEY: SELECTION_BY_CWD_KEY }'
  // 真源文本配假 window/localStorage：改走共用入口 compileFn，参数名逐个列出。
  const factory = compileFn(['window', 'localStorage', 'log', 'keyOf', 'wsKeyOf', 'emit', 'shared', 'stores'], body)
  const api = factory(win, localStorage, function (l, e, f) { logs.push({ l: l, e: e, f: f }) }, wsKey, wsKey, function () {}, {}, {})
  return { api: api, disk: disk, logs: logs }
}

console.log('修订号那条线已退役门禁（#1003：无标记、无版本位；宿主读文件）')

// ── A 乐观选择的形状：后端 + 引用 + 点击时刻（R2 作废）──────────────────────────
console.log('')
console.log('== A 用户点的那一条：后端 + 引用 + 点击时刻（无标记无版本位）==')
{
  const h = makeHarness(prefsSrc)
  const first = h.api.userPickSelection('markdown', { backend: 'markdown' }, null)
  check(first.backendId === 'markdown' && first.source === 'explicit', '构造函数给出后端 + source —— 实得 ' + JSON.stringify(first))
  check(first.userPicked !== true && first.rev === undefined, '不再盖亲手标记、不带版本位 —— 实得 ' + JSON.stringify(first))
  check(typeof first.pickedAt === 'number' && first.pickedAt > 0, '带上点击时刻 pickedAt（水合守卫认它）—— 实得 ' + first.pickedAt)
  const second = h.api.userPickSelection('github', null, { backendId: 'markdown', source: 'explicit', rev: 4 })
  check(second.rev === undefined, '上一条的版本位不再带到新选的那条上 —— 实得 ' + second.rev)
  check(second.ref === null, '没有仓库引用时 ref 记 null（形状不缺字段）')
  const third = h.api.userPickSelection('github', undefined, { backendId: 'markdown', rev: 4 })
  check(third.ref === null, 'ref 传 undefined 也记 null')
}

// ── B baseRevOf 恒 0（R2 作废：无版本位可上报） ──────────────────────────────────
console.log('')
console.log('== B baseRevOf 恒 0 ==')
{
  const h = makeHarness(prefsSrc)
  const cases = [
    [{ backendId: 'x', userPicked: true }, 0, '老形状照旧传进来'],
    [{ backendId: 'x', rev: 9 }, 0, '带版本位的老形状'],
    [{ backendId: 'x', rev: 0 }, 0, 'rev 是 0'],
  ]
  cases.forEach(function (c) {
    const got = h.api.baseRevOf(c[0])
    check(got === c[1], 'baseRevOf：' + c[2] + ' → ' + c[1] + '（实得 ' + got + '）')
  })
  check(h.api.baseRevOf(null) === 0 && h.api.baseRevOf(undefined) === 0, '没有选择时按 0（不抛错）')
}

// ── C adoptBoundRev 恒空（§5 接线作废：本地无镜像可落）───────────────────────────
console.log('')
console.log('== C 绑定回包不再往本地落版本 ==')
{
  const h = makeHarness(prefsSrc)
  const st = { cwd: 'D:\\X', selection: { backendId: 'markdown', source: 'explicit', pickedAt: 1 } }
  check(h.api.adoptBoundRev(st, { ok: true, cwd: 'd:\\X', backendId: 'markdown', rev: 5 }) === null, '裸回包也回空（无处可落）')
  check(h.api.adoptBoundRev(st, { ok: true, value: { ok: true, rev: 7 } }) === null, '信封回包同样回空')
  check(st.selection.rev === undefined, '会话里那条不被加上版本位 —— 实得 ' + st.selection.rev)
}

// ── D keepUserPick 原样透传（R2b 作废：无标记可留）────────────────────────────────
console.log('')
console.log('== D keepUserPick 原样透传 ==')
{
  const h = makeHarness(prefsSrc)
  const incoming = { backendId: 'markdown', source: 'explicit', ref: null }
  check(h.api.keepUserPick({ backendId: 'markdown', pickedAt: 111 }, incoming) === incoming, '宿主回包原样透传')
  check(h.api.keepUserPick({ backendId: 'markdown' }, { backendId: 'gitlab', source: 'explicit' }).backendId === 'gitlab', '宿主回别的后端照旧用宿主的')
}

// ── E 全仓扫描：上报 hint 的地方都要带 baseRev ───────────────────────────────────────
console.log('')
console.log('== E 全仓扫描：每一处把 hint 报给宿主的调用点都带 baseRev ==')
{
  const offenders = []
  const walkClient = function (dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) { walkClient(full); continue }
      if (!entry.name.endsWith('.js')) continue
      const rel = path.relative(ROOT, full).split(path.sep).join('/')
      fs.readFileSync(full, 'utf8').split(/\r?\n/).forEach(function (line, i) {
        if (!/'wf\.(detect|chain)'/.test(line)) return
        if (!/backendId\s*:/.test(line)) return
        if (!/baseRev/.test(line)) offenders.push(rel + ':' + (i + 1))
      })
    }
  }
  walkClient(path.join(ROOT, 'src', 'client'))
  check(offenders.length === 0, '一行写完的那些调用点（无仓卡 / 检查页 / 横幅 / 链渲染器 / 弹窗叶 / 仓库同步两处）都带上了 baseRev（漏 ' + offenders.length + ' 处' + (offenders.length ? '：' + offenders.join('、') : '') + '）')
  // 三处参数是先装进变量再发出去的（同一行里看不到那个调用），单独点名。
  const named = [
    ['src/client/kernel/probe-snapshot.js', /_hintBid \? \{ backendId: _hintBid, baseRev: _hintRev \}/, '面板快照（wf.snapshot / wf.refresh）'],
    ['src/client/kernel/probe-chain.js', /_hintBid \? \{ backendId: _hintBid, baseRev: _hintRev \}/, '检查链（wf.chain）'],
    ['src/client/kernel/store-switch.js', /backendId: userHintOf\(st\.selection\), baseRev: \(typeof baseRevOf === 'function' \? baseRevOf\(st\.selection\) : 0\)/, '切换弹窗那条 CRI 链'],
  ]
  named.forEach(function (n) {
    check(n[1].test(read(n[0])), n[2] + '这一路的 hint 旁边带着 baseRev（' + n[0] + '）')
  })
  const writeSites = [
    ['src/client/kernel/store-switch.js', '切换弹窗'],
    ['src/client/statusbar/StatusBackend.js', '状态栏门控窗'],
    ['src/client/panel/Dock.js', '面板门控窗'],
    ['src/client/panel/OverlayGate.js', '那个当前没有调用点的叶'],
  ]
  writeSites.forEach(function (w) {
    const src = read(w[0])
    check(/userPickSelection/.test(src), w[1] + '写选择时用的是同一个构造函数（userPickSelection）—— 实得 ' + (w[0].split('/').pop()))
    // #1003 过渡态：四个点里的 userPickSelection 兜底还带着 userPicked:true 字样（调用方在本次范围外，留字免崩；
    //   构造函数本身已不再产出该字段，宿主也不再读它）。这里只钉“手写形状里不许带版本位”。
    const handRev = /\{[^}]*backendId[^}]*\brev\s*:/.test(src)
    check(!handRev, w[1] + '里没有手写带版本位的选择形状（版本位已无处可去）')
  })
}

// ── G R6b：镜像垫底已撤（#1003）── 三档剩两档，第三档恒空 ─────────────────────────
console.log('')
console.log('== G R6b：本地镜像不再垫底 ==')
{
  const promptsSrc = read('src/client/kernel/prompts.js')
  const m = promptsSrc.match(/export const currentBackendId = function \(st\) \{[\s\S]*?\n    \}/)
  const fnSrc = m ? m[0] : ''
  check(!!fnSrc, '取到 prompts.js 里的 currentBackendId（真身，整段取出）')
  const mk = function (srcText) {
    const body = srcText.trim().replace(/^export const currentBackendId = /, '')
    // 回读函数按生产行为恒空（镜像已退役）：改走共用入口 compileFn。
    return compileFn(['getCachedSelection'], 'return ' + body)(() => null)
  }
  const fn = mk(fnSrc)
  check(fn({ cwd: 'D:\\x', selection: { backendId: 'github' }, snapshot: null }) === 'github', '会话里已经答过就以会话为准（不看镜像）')
  check(fn({ cwd: 'D:\\x', selection: null, snapshot: { selection: { backendId: 'gitlab' } } }) === 'gitlab', '会话没答过但快照里带着后端时以快照为准')
  check(fn({ cwd: 'D:\\x', selection: null, snapshot: null }) === null, '都没回话时不再拿镜像垫（镜像已空；秒显走快照缓存那条路）')
  check(fn({ cwd: 'D:\\x', selection: null, snapshot: { selection: null } }) === null, '宿主回过“没有后端”时以宿主为准')
}

// ── H R7c：四个绑定确认点都要把 persisted:false 说出来 ──────────────────────────────────────
console.log('')
console.log('== H R7c：绑定成了但宿主侧没记住 → 按 bindFail 那条路如实说一句，理由走词条 ==')
{
  const bindSites = [
    ['src/client/kernel/store-switch.js', '切换弹窗'],
    ['src/client/statusbar/StatusBackend.js', '状态栏门控窗'],
    ['src/client/panel/Dock.js', '面板门控窗'],
    ['src/client/panel/OverlayGate.js', '那个当前没有调用点的叶'],
  ]
  // 理由那句话的文本（接在 switch.bindFail 的 {err} 位置上）不许再写死在客户端文件里：
  //   写死的那一版在英文界面上直接印中文，中文那边又与「切换失败：」拼成一句前后打架的话。
  const HARDCODED_CJK_ERR = /err\s*:\s*'[^']*[\u4e00-\u9fff]/
  bindSites.forEach(function (w) {
    const src = read(w[0])
    check(/persisted\s*===\s*false/.test(src), w[1] + '里认回包里的 persisted:false（只认明确的 false，老宿主没这个字段时不吭声）')
    check(/persisted\s*===\s*false[\s\S]{0,400}switch\.bindFail/.test(src), w[1] + '里 persisted:false 走的是现成的 bindFail 那条提示路')
    check(/persisted\s*===\s*false[\s\S]{0,400}switch\.bindNotPersisted/.test(src), w[1] + '里那一支的理由走词条 switch.bindNotPersisted')
    check(!HARDCODED_CJK_ERR.test(src), w[1] + '里不许再把中文理由写死在代码里（写死的在英文界面上会直接印出中文）')
  })
  // 词条本体：中英各一份（少一份，英文界面会印出键名或空着）
  const wordSrc = read('src/client/kernel/locale-word.js')
  const nKey = wordSrc.split("'switch.bindNotPersisted':").length - 1
  check(nKey === 2, 'switch.bindNotPersisted 在词条表里 zh/en 各一条（实得 ' + nKey + ' 条）')
  // 反证 V1：把写死的那份中文放回 Dock.js 那一处 → 「不许硬编码」那条必须当场红
  const dockSrc = read('src/client/panel/Dock.js')
  const putBack = dockSrc.replace("err:tr('switch.bindNotPersisted')", "err:'已切换，但宿主侧这次没能记住：下次重启或换个地址打开可能要再选一次'")
  check(putBack !== dockSrc, '反证 V1 的改法能在真源里落地（把写死的中文理由放回 Dock.js 那一处）')
  check(HARDCODED_CJK_ERR.test(putBack), '反证 V1 成立：放回去之后「不许硬编码」那条当场变红 —— 说明它量的就是这一处')
  check(!HARDCODED_CJK_ERR.test(dockSrc), '反证 V1 对照：现在的真源里同一处不再命中')
}

// ── F 反证：把实现做坏，上面该红的必须当场红 ──────────────────────────────────────────
console.log('')
console.log('== F 反证：把实现做坏，对应的那几条必须当场红 ==')
const brokenDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-683-rev-'))
const loadBroken = function (tag, from, to) {
  if (!prefsSrc.includes(from)) return { bad: '这道反证的改法在真源里找不到落点（源文本已变）' }
  const file = path.join(brokenDir, tag + '.js')
  fs.writeFileSync(file, prefsSrc.replace(from, to), 'utf8')
  return { src: fs.readFileSync(file, 'utf8') }
}
{
  // F1 构造函数里加回版本位 → A 组“无版本位”那条当场红
  const b1 = loadBroken('has-rev', 'ref: (ref === undefined ? null : ref), pickedAt: Date.now()', 'ref: (ref === undefined ? null : ref), pickedAt: Date.now(), rev: 1')
  check(!b1.bad, '反证 F1 的改法能在真源里落地（给乐观选择加回版本位）' + (b1.bad ? ' —— ' + b1.bad : ''))
  if (b1.src) {
    const h = makeHarness(b1.src)
    const second = h.api.userPickSelection('github', null, { backendId: 'markdown' })
    check(second.rev === 1, '反证 F1 成立：加回去之后构造出来的选择又带版本位了 —— 说明 A 组量的就是“无版本位”')
  }
  // F2 读数不再恒空
  const b2 = loadBroken('read-back', 'export const getCachedSelection = function (cwd) { return null }', 'export const getCachedSelection = function (cwd) { return { backendId: "github" } }')
  check(!b2.bad, '反证 F2 的改法能在真源里落地（把选择读数加回去）' + (b2.bad ? ' —— ' + b2.bad : ''))
  if (b2.src) {
    const h = makeHarness(b2.src)
    check(h.api.getCachedSelection('D:\\X') !== null, '反证 F2 成立：加回去之后读恒不为空 —— 说明退役门禁量的就是“读恒空”')
  }
}
// F4 扫描本身能抓到漏改：把某处的 baseRev 去掉，E 组那条扫描必须点名点出来
{
  const fakeLine = "              else if (typeof host !== 'undefined' && host.call) { await host.call('wf.detect', { cwd: st.cwd||'', force:true, backendId:(typeof userHintOf === 'function' ? userHintOf(st.selection) : undefined) || undefined }); }"
  const scan = (line) => (/'wf\.(detect|chain)'/.test(line) && /backendId\s*:/.test(line) && !/baseRev/.test(line))
  check(scan(fakeLine) === true, '反证 F4 成立：一道「带 backendId 但没带 baseRev」的 wf.detect 会被扫描当场点出来（说明 E 组不是走过场）')
}
try { fs.rmSync(brokenDir, { recursive: true, force: true }) } catch (e) {}

console.log('')
console.log(failed ? '存在失败 — verify-683-choice-rev 未通过（' + passed + ' 项通过、' + failed + ' 项失败）' : '全部通过 — 修订号那条线门禁生效（' + passed + ' 项断言）')
process.exit(failed ? 1 : 0)
