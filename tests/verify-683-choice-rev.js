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
 *
 * 做法：把 src/client/kernel/store-prefs.js 的真身文本喂进沙箱求值（真源 + 假 localStorage/window），
 *   再用改坏的那一份跑同一批断言 —— 该红的必须当场红。
 *
 * 用法：node tests/verify-683-choice-rev.js
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

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
  const factory = new Function('window', 'localStorage', 'log', 'keyOf', 'wsKeyOf', 'emit', 'shared', 'stores', body)
  const api = factory(win, localStorage, function (l, e, f) { logs.push({ l: l, e: e, f: f }) }, wsKey, wsKey, function () {}, {}, {})
  return { api: api, disk: disk, logs: logs }
}

console.log('修订号那条线门禁（#683 F1：写入带版本位、上报带 baseRev、版本位活过一次往返）')

// ── A 用户亲手选的那一条的形状（R2）──────────────────────────────────────────────────
console.log('')
console.log('== A 用户亲手选的那一条：标记 + 点击时刻 + 「从哪个修订号来的」==')
{
  const h = makeHarness(prefsSrc)
  const first = h.api.userPickSelection('markdown', { backend: 'markdown' }, null)
  check(first.backendId === 'markdown' && first.userPicked === true && first.source === 'explicit', '四个写入点用的那个构造函数给出的还是原来那条选择（后端 + 标记 + source）—— 实得 ' + JSON.stringify(first))
  check(typeof first.pickedAt === 'number' && first.pickedAt > 0, '带上了点击时刻 pickedAt（只作档案与淘汰排序用，不参与胜负判定）—— 实得 ' + first.pickedAt)
  check(first.rev === 0, '第一次选（前面还没有任何选择）时 rev 记 0 —— 那种记录只在宿主那边还没有该工作区记录时被采纳一次 —— 实得 ' + first.rev)
  const second = h.api.userPickSelection('github', null, { backendId: 'markdown', source: 'explicit', userPicked: true, rev: 4 })
  check(second.rev === 4, '上一条有版本位时，新选的这一条接着记它（这条选择是基于第 4 版做的）—— 实得 ' + second.rev)
  check(second.ref === null, '没有仓库引用时 ref 记 null（形状不缺字段）')
  const third = h.api.userPickSelection('github', undefined, { backendId: 'markdown', userPicked: true, rev: 4 })
  check(third.ref === null, 'ref 传 undefined 也记 null')
}

// ── B 没有版本位的老记录按 0 处理 ─────────────────────────────────────────────────────
console.log('')
console.log('== B 没有版本位的老记录按 0 处理 ==')
{
  const h = makeHarness(prefsSrc)
  const cases = [
    [{ backendId: 'x', userPicked: true }, 0, '完全没有 rev 字段（老记录）'],
    [{ backendId: 'x', rev: 0 }, 0, 'rev 是 0'],
    [{ backendId: 'x', rev: Number.NaN }, 0, 'rev 是 NaN'],
    [{ backendId: 'x', rev: -3 }, 0, 'rev 是负数'],
    [{ backendId: 'x', rev: '2' }, 0, 'rev 是字符串（不是数字就不认）'],
    [{ backendId: 'x', rev: 9 }, 9, '正常的版本位'],
  ]
  cases.forEach(function (c) {
    const got = h.api.baseRevOf(c[0])
    check(got === c[1], 'baseRevOf：' + c[2] + ' → ' + c[1] + '（实得 ' + got + '）')
  })
  check(h.api.baseRevOf(null) === 0 && h.api.baseRevOf(undefined) === 0, '没有选择时按 0（不抛错）')
}

// ── C 绑定回包里的新修订号要落到本地那条上（§5 接线）────────────────────────────────────
console.log('')
console.log('== C 绑定回包回来之后：把宿主发的新修订号落到本地 ==')
{
  const h = makeHarness(prefsSrc)
  const st = { cwd: 'D:\\X', selection: { backendId: 'markdown', source: 'explicit', userPicked: true, rev: 0, pickedAt: 1 } }
  const got = h.api.adoptBoundRev(st, { ok: true, cwd: 'd:\\X', backendId: 'markdown', rev: 5 })
  check(got === 5 && st.selection.rev === 5, '裸回包（{ok, rev}）→ 回 5 并写进会话里那条 —— 实得 ' + got + ' / ' + st.selection.rev)
  check(h.api.getCachedSelection('D:\\X') && h.api.getCachedSelection('D:\\X').rev === 5, '同时写进本地那份缓存（此后换页面/重开面板也带着它）')
  const st2 = { cwd: 'D:\\Y', selection: { backendId: 'github', source: 'explicit', userPicked: true, rev: 0 } }
  const got2 = h.api.adoptBoundRev(st2, { ok: true, value: { ok: true, rev: 7 } })
  check(got2 === 7 && st2.selection.rev === 7, '包在信封里的回包（{value:{ok,rev}}）同样认 —— 实得 ' + got2)
  const st3 = { cwd: 'D:\\Z', selection: { backendId: 'github', source: 'explicit', userPicked: true, rev: 3 } }
  check(h.api.adoptBoundRev(st3, { ok: true }) === null && st3.selection.rev === 3, '回包里没有 rev 时什么都不动（不把已知的版本位抹成空）')
  const st4 = { cwd: 'D:\\W', selection: { backendId: 'github', source: 'explicit' } }
  check(h.api.adoptBoundRev(st4, { ok: true, rev: 4 }) === null && st4.selection.rev === undefined, '会话里那条不是「用户亲手选的」时不动它（派生值不许凭空获得版本位）')
}

// ── D 版本位活过一次快照往返（R2b）───────────────────────────────────────────────────
console.log('')
console.log('== D 版本位必须活过一次快照合并（R2b）==')
{
  const h = makeHarness(prefsSrc)
  const mine = { backendId: 'markdown', source: 'explicit', userPicked: true, rev: 6, pickedAt: 111 }
  const noRev = h.api.keepUserPick(mine, { backendId: 'markdown', source: 'explicit', ref: null })
  check(noRev.userPicked === true && noRev.rev === 6 && noRev.pickedAt === 111, '宿主这次没带 rev/pickedAt 时，本地那份留住（标记 + 版本位 + 时刻）—— 实得 ' + JSON.stringify(noRev))
  const withRev = h.api.keepUserPick(mine, { backendId: 'markdown', source: 'explicit', rev: 8, pickedAt: 222 })
  check(withRev.rev === 8 && withRev.pickedAt === 222, '宿主带了就以宿主的为准（宿主是发号的那一方）—— 实得 ' + JSON.stringify(withRev))
  const other = h.api.keepUserPick(mine, { backendId: 'gitlab', source: 'explicit', rev: 9 })
  check(other.userPicked !== true && other.backendId === 'gitlab', '宿主回的是别的后端时标记照旧消失（#669 既有行为不许破）')
  const stale = h.api.keepUserPick({ backendId: 'markdown', userPicked: true, rev: 6 }, { backendId: 'markdown', source: 'explicit', rev: 4, pickedAt: 222 })
  check(stale.rev === 4, '宿主明确带了下一位修订号时不许拿本地那份去顶（宿主的答复算数）—— 实得 ' + stale.rev)
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
    // 手写那条四字段形状只许作为那个三元的兜底出现（前面紧挨着 userPickSelection(...)：这是仓里通用的
    //   「内核函数可能不在场」防御写法）。单独一处手写 = 那条选择没有版本位，上报时会被宿主当最旧的顶回。
    const alone = /\{[^}]*userPicked:\s*true\s*\}/.test(src) && !/userPickSelection\([^)]*\)\s*:\s*\{[^}]*userPicked:\s*true\s*\}/.test(src)
    check(!alone, w[1] + '里没有「单独手写四个字段」的写法（只作为 userPickSelection 的兜底）')
  })
}

// ── G R6b：那个「回读本地镜像」的第三档只许在宿主回过话之前生效 ─────────────────────────────
console.log('')
console.log('== G R6b：宿主回过话之后不再回头看本地镜像 ==')
{
  const promptsSrc = read('src/client/kernel/prompts.js')
  const m = promptsSrc.match(/export const currentBackendId = function \(st\) \{[\s\S]*?\n    \}/)
  const fnSrc = m ? m[0] : ''
  check(!!fnSrc, '取到 prompts.js 里的 currentBackendId（真身，整段取出）')
  const mk = function (srcText, cached) {
    const body = srcText.trim().replace(/^export const currentBackendId = /, '')
    return new Function('getCachedSelection', 'return ' + body)(() => cached)
  }
  const cachedSel = { backendId: 'markdown', source: 'explicit', userPicked: true, rev: 2 }
  const fn = mk(fnSrc, cachedSel)
  check(fn({ cwd: 'D:\\x', selection: { backendId: 'github' }, snapshot: null }) === 'github', '会话里已经答过就以会话为准（不看镜像）')
  check(fn({ cwd: 'D:\\x', selection: null, snapshot: { selection: { backendId: 'gitlab' } } }) === 'gitlab', '会话没答过但快照里带着后端时以快照为准')
  check(fn({ cwd: 'D:\\x', selection: null, snapshot: null }) === 'markdown', '宿主一次都还没回过话（一份快照都没有）时，拿本地镜像垫一下（刷新页面不闪「还没有设置」）')
  check(fn({ cwd: 'D:\\x', selection: null, snapshot: { selection: null } }) === null, '宿主已经回过话（有快照，只是这条没后端）时不再回头看镜像 —— 否则会把宿主说的「没有后端」重新变成镜像里那个')
  // 反证：把「一份快照都没有」这个前提摘掉 → 上面最后一条当场红
  const stripped = fnSrc.replace('!(st && st.snapshot) && ', '')
  check(stripped !== fnSrc, '反证 G 的改法能在真源里落地（摘掉「一份快照都没有」这个前提）')
  const broken = mk(stripped, cachedSel)
  check(broken({ cwd: 'D:\\x', selection: null, snapshot: { selection: null } }) === 'markdown', '反证 G 成立：前提摘掉之后，宿主明明回过「没有后端」也会被镜像顶成 markdown —— 说明 G 组量的就是这道前提')
}

// ── H R7c：四个绑定确认点都要把 persisted:false 说出来 ──────────────────────────────────────
console.log('')
console.log('== H R7c：绑定成了但宿主侧没记住 → 按 bindFail 那条路如实说一句 ==')
{
  const bindSites = [
    ['src/client/kernel/store-switch.js', '切换弹窗'],
    ['src/client/statusbar/StatusBackend.js', '状态栏门控窗'],
    ['src/client/panel/Dock.js', '面板门控窗'],
    ['src/client/panel/OverlayGate.js', '那个当前没有调用点的叶'],
  ]
  bindSites.forEach(function (w) {
    const src = read(w[0])
    check(/persisted\s*===\s*false/.test(src), w[1] + '里认回包里的 persisted:false（只认明确的 false，老宿主没这个字段时不吭声）')
    check(/persisted\s*===\s*false[\s\S]{0,400}switch\.bindFail/.test(src), w[1] + '里 persisted:false 走的是现成的 bindFail 那条提示路')
  })
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
  // F1 新选的那一条不再记「从哪个修订号来的」
  const b1 = loadBroken('no-rev', "rev: baseRevOf(prevSelection)", 'rev: 0')
  check(!b1.bad, '反证 F1 的改法能在真源里落地（新选的那条不再记版本位）' + (b1.bad ? ' —— ' + b1.bad : ''))
  if (b1.src) {
    const h = makeHarness(b1.src)
    const second = h.api.userPickSelection('github', null, { backendId: 'markdown', userPicked: true, rev: 4 })
    check(second.rev === 0, '反证 F1 成立：不记版本位之后，新选的那一条总是 0（上报时会被宿主当成最旧的一版顶回）—— 说明 A 组量的就是这一步')
  }
  // F2 keepUserPick 不再留住版本位
  const b2 = loadBroken('no-carry', "if (!(typeof out.rev === 'number' && isFinite(out.rev)) && typeof cur.rev === 'number' && isFinite(cur.rev)) out.rev = cur.rev;", '')
  check(!b2.bad, '反证 F2 的改法能在真源里落地（合并时不留住版本位）' + (b2.bad ? ' —— ' + b2.bad : ''))
  if (b2.src) {
    const h = makeHarness(b2.src)
    const out = h.api.keepUserPick({ backendId: 'markdown', userPicked: true, rev: 6, pickedAt: 111 }, { backendId: 'markdown', source: 'explicit' })
    check(out.rev === undefined, '反证 F2 成立：不留住之后，第一次快照合并就把版本位抹掉了（此后上报都是「没带版本位」）—— 说明 D 组量的就是这一步')
  }
  // F3 绑定的新版本号不写进本地缓存
  const b3 = loadBroken('no-cache', "if (st.cwd) { try { setCachedSelection(st.cwd, st.selection) } catch (eC) {} }", 'void 0')
  check(!b3.bad, '反证 F3 的改法能在真源里落地（新版本号不写进本地缓存）' + (b3.bad ? ' —— ' + b3.bad : ''))
  if (b3.src) {
    const h = makeHarness(b3.src)
    const st = { cwd: 'D:\\X', selection: { backendId: 'markdown', source: 'explicit', userPicked: true, rev: 0 } }
    h.api.adoptBoundRev(st, { ok: true, rev: 5 })
    const cached = h.api.getCachedSelection('D:\\X')
    check(!cached || cached.rev !== 5, '反证 F3 成立：不写缓存之后，重开面板就回到 rev=0（版本位活不过一次重开）—— 说明 C 组量的就是这一步')
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
