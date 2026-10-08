// verify-907-chain-titles.js —— 门禁：处理链那一行的标题查得到（票 #907）
// 用法：node tests/verify-907-chain-titles.js（插件根目录）
//
// 现场与修法（票 #907 的诊断写在 issue 正文里）：
//   已关闭地图的子票不进首屏（#691 的体积取舍），而处理链那一行的标题只从快照给得出的行里查，
//   于是那几行的标题位画成了票号（「#901 #901」）。修法：宿主给这些行另留一份**瘦身行**
//   （thinTickets：票号、标题、状态、是不是地图），界面查标题时也读它；连瘦身行都没有的票号，
//   那一行留白，「标题未取到」只出现在无障碍名（悬停提示）里。
//
// 这一条门禁跑真代码，四件：
//   一、宿主组装：已关闭地图的子票进瘦身行、不进首屏两个筐子；首屏行数与 deck 计数都不受影响。
//   二、信封：瘦身行走的是那一份字段清单，两条电话（wf.snapshot / wf.refresh）的调用点一处不漏。
//   三、界面查标题：按票号查到标题；哪儿都没有的票号仍是空，不凭空编一个。
//   四、画法：有标题画标题；没标题留白、不画第二个票号；那句话只在无障碍名里；那一行仍然点得开。
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')
// 本文件按文本求值统一走共用入口 compileFn：把真源文本配假 React 等零件造成模块（理由与用法见 tests/lib/eval-probe.js 文件头）。
const { compileFn } = require('./lib/eval-probe.js')

const ROOT = path.resolve(__dirname, '..')
let failed = false
const problems = []
const check = function (ok, msg) { console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) { failed = true; problems.push(msg) } }
const read = function (p) { return fs.readFileSync(path.join(ROOT, p), 'utf8') }

/** 把一份「一源两物」的源文件当模块跑起来：剥行首 export，作用域里塞进它在拼接闭包里的邻居（手法照 verify-chain-view.js）。 */
function loadModule(relPath, deps) {
  const src = read(relPath)
  const names = []
  const re = /^[ \t]*export[ \t]+(?:const|let|var|function|class)[ \t]+([A-Za-z_$][\w$]*)/gm
  let m
  while ((m = re.exec(src)) !== null) names.push(m[1])
  if (!names.length) throw new Error(relPath + ' 里没有找到 export 声明')
  const body = src.replace(/^[ \t]*export[ \t]+/gm, '')
  // 真源文本配假零件造模块：改走共用入口 compileFn，参数名取 deps 的键。
  const fn = compileFn(Object.keys(deps), body + '\nreturn { ' + names.join(', ') + ' }')
  return fn.apply(null, Object.keys(deps).map(function (k) { return deps[k] }))
}

/** 最小的假 React：createElement 只搭一棵普通对象树。 */
function makeReact() {
  const flat = function (kids) {
    const out = []
    const walk = function (k) {
      if (Array.isArray(k)) { k.forEach(walk); return }
      if (k === null || k === undefined || k === false) return
      out.push(k)
    }
    walk(kids)
    return out
  }
  return {
    createElement: function (type, props) {
      return { type: type, props: props || {}, children: flat(Array.prototype.slice.call(arguments, 2)) }
    },
    useContext: function () { return null },
  }
}

/** 把一棵假 React 树里的可见文字摊平。 */
function textOf(node) {
  if (node === null || node === undefined || node === false) return ''
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).filter(Boolean).join(' ')
  const parts = []
  if (node.props && node.props.content) parts.push(textOf(node.props.content))
  if (node.p && node.p.content) parts.push(textOf(node.p.content))
  parts.push(textOf(node.c))
  parts.push(textOf(node.children))
  return parts.filter(Boolean).join(' ')
}

/** 某个子串在这段文字里出现了几次（「同一行两遍票号」就是用这把尺子量的）。 */
const countIn = function (text, sub) { return String(text).split(sub).length - 1 }

async function main() {
  console.log('#907 处理链标题门禁（瘦身行 / 首屏口径不变 / 留白 / 词条）')

  // ---------- 一、宿主组装：真编排器跑一遍 ----------
  const snapMod = await import(pathToFileURL(path.join(ROOT, 'src', 'host', 'tracker', 'snapshot.js')).href)
  const mk = function (key, extra) {
    return Object.assign({ key: String(key), number: Number(key), state: 'open', type: 'issue', title: '票 ' + key, isPullRequest: false, labels: [], body: '' }, extra)
  }
  const all = [
    mk(100, { type: 'map', state: 'closed', title: '已关闭的地图' }),
    mk(101, { parentKey: '100', state: 'closed', title: '子票甲' }),
    mk(102, { parentKey: '100', state: 'closed', title: '子票乙' }),
    mk(200, { state: 'open', title: '独立的票' }),
    mk(300, { type: 'map', state: 'open', title: '还开着的地图' }),
    mk(301, { parentKey: '300', state: 'open', title: '开着的地图里的子票' }),
  ]
  const tracker = {
    list: async function () { return { ok: true, data: all.map(function (x) { return Object.assign({}, x) }) } },
    counts: async function () { return { ok: true, data: { open: 3, closed: 3, total: 6 } } },
  }
  const composer = snapMod.createSnapshotComposer({ get: function () { return tracker } }, { snapshotTtl: 1 })
  const ref = { backend: 'github', refId: 'o/r', name: 'o/r', url: 'https://github.com/o/r' }
  const res = await composer.composeSnapshot('github', ref, {}, { force: true })
  check(res.ok === true, '编排器照常给出一份快照（实得 ' + JSON.stringify(res.ok ? 'ok' : res.error) + '）')
  const snap = res.ok ? res.snapshot : { maps: [], issues: [], thinTickets: [] }
  const ids = function (rows) { return (rows || []).map(function (x) { return String(x.key) }).sort() }
  const map100 = (snap.maps || []).filter(function (m) { return String(m.key) === '100' })[0] || {}
  const map300 = (snap.maps || []).filter(function (m) { return String(m.key) === '300' })[0] || {}
  check(ids(map100.tickets).length === 0, '已关闭地图的子票不进首屏（实得 ' + JSON.stringify(ids(map100.tickets)) + '）')
  check(ids(snap.issues).join(',') === '200', '首屏未挂图的票只有那张独立的（实得 ' + JSON.stringify(ids(snap.issues)) + '）')
  check(ids(map300.tickets).join(',') === '301', '还开着的地图的子票照旧留在图上（实得 ' + JSON.stringify(ids(map300.tickets)) + '）')
  check(ids(snap.thinTickets).join(',') === '101,102', '已关闭地图的子票另有一份瘦身行（实得 ' + JSON.stringify(ids(snap.thinTickets)) + '）')
  const thin101 = (snap.thinTickets || []).filter(function (x) { return String(x.key) === '101' })[0] || {}
  check(thin101.title === '子票甲' && String(thin101.state).toLowerCase() === 'closed' && thin101.number === 101 && thin101.type === 'issue',
    '瘦身行带齐票号、标题、状态与类型（实得 ' + JSON.stringify({ title: thin101.title, state: thin101.state, number: thin101.number, type: thin101.type }) + '）')
  check(Object.keys(thin101).sort().join(',') === 'effortId,key,number,state,title,type',
    '瘦身行只留这么几样，正文与评论不带进来（实得 ' + JSON.stringify(Object.keys(thin101).sort()) + '）')
  const poolRows = [].concat(map100.tickets || [], map300.tickets || [], snap.issues || []).filter(function (x) { return x.isPullRequest !== true })
  check(poolRows.length === 2, '首屏池子里只有两行票，瘦身行没被算法数进去（实得 ' + poolRows.length + '）')
  check(!!snap.deck && !!snap.deck.counts && snap.deck.counts.total === 6, 'deck 计数照旧来自后端（实得 ' + JSON.stringify(snap.deck && snap.deck.counts) + '）')

  // ---------- 二、信封：字段清单只有一处，两条电话都不漏 ----------
  const envMod = await import(pathToFileURL(path.join(ROOT, 'src', 'host', 'snapshotEnvelope.js')).href)
  const env = envMod.createSnapshotEnvelope({ getGhPath: function () { return '' }, getGhLastError: function () { return null }, adoptSnapshot: function (s) { return s }, logCtx: null })
  const viaEnv = env.buildSnap({ maps: [], issues: [], thinTickets: [{ key: '101' }], labels: [] })
  check(Array.isArray(viaEnv.thinTickets) && viaEnv.thinTickets.length === 1, '信封把瘦身行挂进快照（实得 ' + JSON.stringify(viaEnv.thinTickets) + '）')
  ;['src/host/sessionSnapshot.js', 'src/host/sessionRefresh.js'].forEach(function (f) {
    const n = (read(f).match(/thinTickets/g) || []).length
    check(n >= 4, f + ' 的四个信封调用点都带上了瘦身行（实得 ' + n + ' 处）')
  })

  // ---------- 三、界面查标题（真代码：判据层）----------
  const locales = loadModule('src/client/kernel/locale-pages.js', {})
  const zh = locales.L_PAGES.zh
  const en = locales.L_PAGES.en
  check(zh['chainView.titleMissing'] !== undefined && en['chainView.titleMissing'] !== undefined, '「标题未取到」中英各有一条词条')
  check(zh['chainView.titleMissing'] === '标题未取到', '中文词条是给人读的一句话（实得 ' + JSON.stringify(zh['chainView.titleMissing']) + '）')
  // 词条桩：认得的给译文，认不得的原样回键名（「认不得」这一件由 verify-locale-completeness 那份门禁管，
  //   这里只量「那句话进不进无障碍名」）。
  const tr = function (key) { return zh[key] !== undefined ? String(zh[key]) : key }
  const leaf = loadModule('src/client/views/shared/sessionChainView.js', {
    React: makeReact(),
    DswsCtx: null,
    tr: tr,
    Ic: function (p) { return { type: 'Ic', props: p || {}, children: [] } },
    Tip: function (p, c) { return { type: 'Tip', props: p || {}, children: c === undefined ? [] : [c] } },
    pushNav: function () {},
    findMapByIdentity: function () { return null },
  })

  // ---------- 四、画法：留白 + 那句话只进无障碍名 ----------
  const capSrc = read('src/client/statusbar/SessionChainCapsule.js').replace(/^[ \t]*export[ \t]+/gm, '')
  const h = function (t, p) { return { t: t, p: p, c: Array.prototype.slice.call(arguments, 2) } }
  const opened = []
  // 同一手法：真源文本配假零件，统一走共用入口 compileFn，参数名逐个列出。
  const factory = compileFn(['React', 'DswsCtx', 'Tip', 'Ic', 'tr', 'sessionChainRowsOf', 'SESSION_CHAIN_FIELD', 'sessionChainOpenTicket', 'openPanel', 'PortalOverlay', 'placeStatusOverlay', 'clearStatusClose', 'scheduleStatusClose', 'emit'],
    capSrc + '\nreturn { SessionChainCapsule, capsuleShardOf }')
  const capLeaf = factory(
    { createElement: h, useContext: function () { return { h: h } }, useRef: function (v) { return { current: v } }, useState: function (v) { return [v, function () {}] } },
    { h: h },
    function () { return null },
    function () { return null },
    tr,
    function (s) { return leaf.sessionChainRowsOf(s) },
    'sessionTickets',
    function (st, row) { opened.push(row.ticketKey) },
    function () {},
    function (o, kids) { return { overlay: true, props: o, children: kids } },
    function () { return { left: 1, bottom: 2 } },
    function () {},
    function (r, fn) { fn() },
    function () {}
  )
  const sid = 'sess-907-aaaa'
  const shard = capLeaf.capsuleShardOf(sid)
  const readoutMod = await import(pathToFileURL(path.join(ROOT, 'src', 'host', 'refresh', 'sessionChainReadout.js')).href)
  const at = new Date(2026, 9, 8, 10, 4, 0).getTime()
  const readout = readoutMod.buildSessionChainReadout({
    at: at,
    tickets: { snapshot: function () { return [{ shardId: shard, backend: 'github', entries: [
      { ticketKey: '101', action: 'report', at: at },
      { ticketKey: '999', action: 'report', at: at },
    ] }] } },
  })
  const st = { snapshot: Object.assign({}, snap, { sessionTickets: readout }), chainMenuOpen: true, chainMenuPos: { left: 1, bottom: 2 } }
  const rows = leaf.sessionChainRowsOf(st)
  const row101 = rows.filter(function (r) { return r.ticketKey === '101' })[0]
  check(!!row101 && row101.ticketTitle === '子票甲', '已关闭地图的子票那一行查到了标题（实得 ' + JSON.stringify(row101 && row101.ticketTitle) + '）')
  check(!!row101 && row101.ticketState === 'CLOSED' && row101.isMap === false, '状态与「不是地图」也一起查到了（实得 ' + JSON.stringify({ state: row101 && row101.ticketState, isMap: row101 && row101.isMap }) + '）')
  const row999 = rows.filter(function (r) { return r.ticketKey === '999' })[0]
  check(!!row999 && row999.ticketTitle === '', '哪儿都没有的票号仍是空标题，不凭空编一个（实得 ' + JSON.stringify(row999 && row999.ticketTitle) + '）')

  const tree = capLeaf.SessionChainCapsule({ st: st, sid: sid })
  const rowNodes = []
  ;(function walk(n) {
    if (n === null || n === undefined) return
    if (Array.isArray(n)) { n.forEach(walk); return }
    if (typeof n !== 'object') return
    if (String((n.p && n.p.className) || '').indexOf('dsws-chainmenu-row') >= 0) rowNodes.push(n)
    // 假 React 的普通节点用 c，悬浮层（PortalOverlay 桩）用 children，两条都要走。
    ;[].concat(n.c || [], n.children || []).forEach(walk)
  })(tree)
  check(rowNodes.length === 2, '悬停单子里两行都在（实得 ' + rowNodes.length + '）')
  const rowOf = function (key) { return rowNodes.filter(function (r) { return String((r.p && r.p['aria-label']) || '').indexOf('#' + key) >= 0 })[0] || null }
  const r101 = rowOf('101')
  const t101 = r101 ? textOf(r101.c || []) : ''
  check(!!r101 && t101.indexOf('子票甲') >= 0, '有标题那一行把标题画出来了（实得 ' + JSON.stringify(t101) + '）')
  check(countIn(t101, '#101') === 1, '那一行只有一个票号，不再画第二遍（实得 ' + countIn(t101, '#101') + ' 个）')
  check(!!r101 && String(r101.p['aria-label']).indexOf('子票甲') >= 0, '无障碍名里带着标题（实得 ' + JSON.stringify(r101 && r101.p['aria-label']) + '）')
  const r999 = rowOf('999')
  const t999 = r999 ? textOf(r999.c || []) : ''
  check(!!r999 && countIn(t999, '#999') === 1, '没标题那一行留白：只剩徽章那一个票号（实得 ' + JSON.stringify(t999) + '）')
  check(!!r999 && String(r999.p['aria-label']).indexOf(String(zh['chainView.titleMissing'])) >= 0, '「标题未取到」出现在无障碍名里（实得 ' + JSON.stringify(r999 && r999.p['aria-label']) + '）')
  check(!!r999 && t999.indexOf(String(zh['chainView.titleMissing'])) < 0, '版面（可见文字）里没有那句话：留白就是留白（实得 ' + JSON.stringify(t999) + '）')
  check(!!r999 && String(r999.p['aria-label']).indexOf('#999') >= 0, '无障碍名里仍报得出票号（实得 ' + JSON.stringify(r999 && r999.p['aria-label']) + '）')
  if (r999) { try { r999.p.onClick({ stopPropagation: function () {} }) } catch (e) {} }
  check(opened.indexOf('999') >= 0, '没标题那一行仍然点得开那张票（实得 ' + JSON.stringify(opened) + '）')

  console.log(failed ? '\n存在失败：' + problems.length + ' 条' : '\n全部通过')
  process.exit(failed ? 1 : 0)
}

main().catch(function (e) { console.log('  FAIL 门禁自己跑挂了：' + (e && e.stack ? e.stack : e)); process.exit(1) })
