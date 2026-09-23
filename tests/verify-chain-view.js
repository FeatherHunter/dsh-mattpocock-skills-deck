// verify-chain-view.js —— 门禁：处理链展示面「每个会话在处理哪些票」（票 #721 / T17）
// 用法：在插件根目录执行 node tests/verify-chain-view.js（比产物新鲜度那几条不查产物，可独立运行）
//
// 这一条门禁跑的是**真代码**，一路到底：
//   真的链（#714 的 createSessionTickets 记下五次写）→ 真的宿主读数（src/host/refresh/sessionChainReadout.js）
//   → 真的界面判据与画法（src/client/views/shared/sessionChainView.js，按 scripts/build.mjs 同一套做法
//     剥掉行首 export、放进一个作用域里跑，React 用最小的假件代替）。
//
// 它盯五件事：
//   一、**取数路径**：界面读的就是快照里那一个字段（sessionTickets）。真跑一遍：两个会话各几张票，
//      按会话分组不串；界面拿不到会话 id 原文（链只留散列）。
//   二、**读不到就说读不到**：字段被删掉、被改成空、宿主自己说没取到 —— 三种都必须说读不到，
//      而且那一屏里一个数字都不许出现（0 会把「不知道」说成「没有人在处理票」）。
//   三、**宿主说「取到了、就是没有」时整块不画**（票面要求：不猜、不占位、不显示空框）。
//   四、**话都在词条里**：中英两份键集合全等；这一块画的每个字都来自词条（代码里不许有中文串）；
//      动作类别的词条键与链的闭集合 CHAIN_ACTIONS 逐个对上（链上加了新类别而这里没跟上就红）。
//   五、**没有第二个数据来源**（静态断言）：界面代码里不许出现会话事件、命令行解析、链的键构造、
//      链的过滤判定、落盘文件名、任何 host.call / fetch。
//   六、**读不到那句人话**（2026-09-22 维护者定）：主句要短（≤12 字）、没有括号、第一次读就懂；
//      「这次没拿到 ≠ 没人在处理票」这层解释与宿主给的原因代号都归悬停提示；那一行用仓库既有的
//      危险色变量上色（不许写死色值）。这三条判据各自带一次反证，防止判据本身失灵。
//
// 反证（人工做过两次，见回报）：把一句中文写死在界面里、把「读不到」改成显示空列表 —— 都被本门禁打红。
const fs = require('fs')
const path = require('path')
const os = require('os')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
let failed = false
const problems = []
const fail = function (msg) { problems.push(msg); failed = true }

/** 把一份「一源两物」的源文件当模块跑起来：剥行首 export，作用域里塞进它在拼接闭包里的邻居。 */
function loadModule(relPath, deps) {
  const src = fs.readFileSync(path.join(ROOT, relPath), 'utf8')
  const names = []
  const re = /^[ \t]*export[ \t]+(?:const|let|var|function|class)[ \t]+([A-Za-z_$][\w$]*)/gm
  let m
  while ((m = re.exec(src)) !== null) names.push(m[1])
  if (!names.length) throw new Error(relPath + ' 里没有找到 export 声明')
  const body = src.replace(/^[ \t]*export[ \t]+/gm, '')
  const fn = new Function(Object.keys(deps).join(', '), body + '\nreturn { ' + names.join(', ') + ' }')
  return fn.apply(null, Object.keys(deps).map(function (k) { return deps[k] }))
}

/** 去掉注释之后的代码（静态断言只看代码：注释里提到某个名字不算「用了它」）。 */
function codeOnly(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:"])\/\/.*$/gm, '$1')
}

/** 代码里那些「写死的文案」：字符串字面量里出现中日韩字。文案必须走词条，否则这里报出来。 */
function hardcodedTextHits(src) {
  const hits = []
  src.split(/\r?\n/).forEach(function (line, i) {
    const m = line.match(/'[^'\n]*[\u4e00-\u9fff][^'\n]*'|"[^"\n]*[\u4e00-\u9fff][^"\n]*"/g)
    if (m) hits.push((i + 1) + ': ' + m.join(' '))
  })
  return hits
}

/**
 * 「读不到」那一行的红色判据：只认仓库既有的危险色变量（var(--dsw-alias-state-error-primary,…)）。
 * 写死色值（'#f87171' 这种）不算通过 —— 换主题时写死的那个不会跟着走。
 */
function dangerColorOk(color) {
  return /^var\(--dsw-alias-state-error-primary,/.test(String(color || ''))
}

/** 最小的假 React：createElement 只搭一棵普通对象树，useContext 一律返回空（组件就会退回 React.createElement）。 */
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

/** 把一棵假 React 树里的可见文字摊平（含 Tip 的悬浮内容：读不到那句的原因代号就在那里）。 */
function textOf(node) {
  if (node === null || node === undefined || node === false) return ''
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).filter(Boolean).join(' ')
  const parts = []
  if (node.props && node.props.content) parts.push(textOf(node.props.content))
  parts.push(textOf(node.children))
  return parts.filter(Boolean).join(' ')
}

async function main() {
  console.log('#721 处理链展示面门禁（取数路径 / 读不到就说读不到 / 空态不画 / 词条 / 没有第二个来源）')
  const chain = await import(pathToFileURL(path.join(ROOT, 'src', 'shared', 'refresh', 'chain.js')).href)
  const ticketsMod = await import(pathToFileURL(path.join(ROOT, 'src', 'host', 'refresh', 'sessionTickets.js')).href)
  const readoutMod = await import(pathToFileURL(path.join(ROOT, 'src', 'host', 'refresh', 'sessionChainReadout.js')).href)

  // ---------- 词条（中英两份，与界面读的是同一份文件）----------
  const locales = loadModule('src/client/kernel/locale-pages.js', {})
  const zh = locales.L_PAGES.zh
  const en = locales.L_PAGES.en
  const tr = function (key, params) {
    let s = zh[key]
    if (s === undefined) { fail('界面引用了没有的词条：' + key); return key }
    Object.keys(params || {}).forEach(function (k) { s = s.split('{' + k + '}').join(String(params[k])) })
    return s
  }

  // ---------- 一、真代码：链 → 宿主读数 → 界面判据 ----------
  const LEAF = 'src/client/views/shared/sessionChainView.js'
  const pushed = []
  const leaf = loadModule(LEAF, {
    React: makeReact(),
    DswsCtx: null,
    tr: tr,
    Ic: function (props) { return { type: 'Ic', props: props || {}, children: [] } },
    Tip: function (props, child) { return { type: 'Tip', props: props || {}, children: child === undefined ? [] : [child] } },
    pushNav: function (st, kind, n, effortId) { pushed.push({ kind: kind, n: n, effortId: effortId }) },
  })
  const READ_AT = new Date(2026, 0, 1, 12, 4, 0).getTime()
  const ROOT_KEY = 'D:\\proj\\deck'
  const SID_A = 'sess-aaaa-1111-2222'
  const SID_B = 'sess-bbbb-3333-4444'
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-721-'))
  let clock = 1700000000000
  const app = ticketsMod.createSessionTickets({ cacheDir: dir, now: function () { return (clock += 1000) } })
  const w = function (input) { return app.note(Object.assign({ rootKey: ROOT_KEY, backend: 'github' }, input)) }
  await w({ sessionId: SID_A, source: 'tool-args', tool: 'deck_issue_create', tier: 'write-confirmed', args: { issue: 701 } })
  await w({ sessionId: SID_A, source: 'tool-args', tool: 'deck_issue_patch', tier: 'write-confirmed', args: { number: 702 } })
  await w({ sessionId: SID_A, source: 'cli', tool: 'pwsh', tier: 'write-confirmed', reason: 'cmd.gh-write', verb: 'comment', ticketKey: '703' })
  await w({ sessionId: SID_B, source: 'tool-args', tool: 'deck_issue_create', tier: 'write-confirmed', args: { issue: 801 } })
  await w({ sessionId: SID_B, source: 'tool-args', tool: 'deck_map_link', tier: 'write-confirmed', args: { child: 802 } })
  const readout = readoutMod.buildSessionChainReadout({ tickets: app, at: READ_AT })
  if (readout.ok !== true || readout.sessions.length !== 2) fail('宿主读数没把两个会话都交出来：' + JSON.stringify(readout).slice(0, 200))
  if (leaf.SESSION_CHAIN_FIELD !== readoutMod.SESSION_CHAIN_FIELD) fail('界面与宿主对「挂在哪个字段」的说法不一致：' + leaf.SESSION_CHAIN_FIELD + ' vs ' + readoutMod.SESSION_CHAIN_FIELD)
  const shardA = chain.chainSessionShardId(SID_A)
  const snapOf = function (payload) {
    return {
      snapshot: {
        sessionTickets: payload,
        issues: [
          { number: 701, title: '甲票标题', effortId: '' },
          { number: 703, title: '丙票标题', effortId: '' },
          { number: 801, title: '远处那张票', effortId: '' },
        ],
      },
      tab: 'checks',
    }
  }
  const st = snapOf(readout)
  const view = leaf.sessionChainViewOf(st)
  if (view.state !== 'ok') fail('有链数据时判成了 ' + view.state + '（应当 ok）')
  const rows = leaf.sessionChainRowsOf(st)
  const rowsOf = function (shardId) { const r = rows.filter(function (x) { return x.shardId === shardId })[0]; return r ? r.entries : null }
  const A = rowsOf(shardA) || []
  const B = rowsOf(chain.chainSessionShardId(SID_B)) || []
  const rowA = rows.filter(function (x) { return x.shardId === shardA })[0] || null
  if (A.map(function (e) { return e.ticketKey }).join(',') !== '703,702,701') fail('会话 A 的票不对或顺序不对：' + A.map(function (e) { return e.ticketKey }).join(','))
  if (B.map(function (e) { return e.ticketKey }).join(',') !== '802,801') fail('会话 B 的票不对或顺序不对：' + B.map(function (e) { return e.ticketKey }).join(','))
  const crossTalk = A.filter(function (e) { return B.some(function (b) { return b.ticketKey === e.ticketKey }) })
  if (crossTalk.length) fail('两个会话的票串了：' + JSON.stringify(crossTalk))
  if (A[0].actionKey !== 'chainView.action.comment' || A[2].actionKey !== 'chainView.action.create') fail('动作类别没有翻成词条键：' + JSON.stringify(A.map(function (e) { return e.actionKey })))
  if (A[2].ticketTitle !== '甲票标题') fail('标题没有从已经拿到的票列表里查出来：' + JSON.stringify(A[2].ticketTitle))
  if (A[1].ticketTitle !== '') fail('快照里没有的票不该凭空有个标题：' + JSON.stringify(A[1].ticketTitle))
  // 时间显示的是宿主记下的那一刻（条目里的 at），不是渲染的那一刻
  const wantClock = (function (ms) { const d = new Date(ms); const pad = function (n) { return (n < 10 ? '0' : '') + n }; return pad(d.getHours()) + ':' + pad(d.getMinutes()) })(A[0].at)
  if (A[0].time !== wantClock) fail('时间没有按宿主记下的那一刻显示：' + A[0].time + '（应当是 ' + wantClock + '）')
  if (JSON.stringify(rows).indexOf(SID_A) >= 0 || JSON.stringify(rows).indexOf(SID_B) >= 0) fail('会话 id 原文漏到了界面这一侧（链只留散列）')
  if (!rowA || rowA.label !== shardA.slice(0, 8)) fail('会话那一行的标识不是分格散列前 8 位：' + JSON.stringify(rowA && rowA.label))

  // 渲染：真组件吐出来的那棵树，按会话分段，各段里只有自己那几张票
  const node = leaf.SessionChainStrip({ st: st, narrow: false })
  const text = textOf(node)
  if (!text || text.indexOf('每个会话在处理哪些票') < 0) fail('这一块没有画出它自己的标题：' + JSON.stringify(text).slice(0, 120))
  const labelA = tr('chainView.session', { id: shardA.slice(0, 8) })
  const labelB = tr('chainView.session', { id: chain.chainSessionShardId(SID_B).slice(0, 8) })
  const segs = []
  ;(node.children || []).forEach(function (c) {
    const t = textOf(c)
    if (t === labelA || t === labelB) segs.push({ label: t, rows: [] })
    else if (segs.length) segs[segs.length - 1].rows.push(t)
  })
  if (segs.length !== 2) fail('画出来的会话段不是两段（实得 ' + segs.length + '）：' + JSON.stringify(segs).slice(0, 200))
  segs.forEach(function (sg) {
    const mine = sg.label === labelA ? ['703', '702', '701'] : ['802', '801']
    const other = sg.label === labelA ? ['801', '802'] : ['701', '702', '703']
    mine.forEach(function (k) { if (!sg.rows.some(function (r) { return r.indexOf('#' + k) >= 0 })) fail(sg.label + ' 这一段里少了 #' + k) })
    other.forEach(function (k) { if (sg.rows.some(function (r) { return r.indexOf('#' + k) >= 0 })) fail(sg.label + ' 这一段里混进了另一会话的 #' + k) })
  })
  // 点一行跳到那张票（用的是链记下的票号）
  pushed.length = 0
  const rowNodes = (function collect(n, out) {
    if (!n || typeof n !== 'object') return out
    if (n.props && n.props.className === 'dsws-chainview-row') out.push(n)
    const kids = Array.isArray(n.children) ? n.children : []
    for (let i = 0; i < kids.length; i++) collect(kids[i], out)
    return out
  })(node, [])
  if (rowNodes.length !== 5) fail('画出来的可点行不是五条（两个会话共五张票）：' + rowNodes.length)
  const row703 = rowNodes.filter(function (r) { return textOf(r).indexOf('#703') === 0 })[0] || null
  if (!row703) fail('没有画出 #703 那一行（点一行要能跳到那张票）')
  else { row703.props.onClick(); if (st.tab !== 'list') fail('点了那一行没有切回列表页'); if (!pushed.length || pushed[0].n !== 703 || pushed[0].kind !== 'issue') fail('点了 #703 那一行没有跳到链记下的那张票：' + JSON.stringify(pushed)) }

  // ---------- 二、读不到就说读不到（三种都要说，且那一屏一个数字都不许有）----------
  const emptyReadout = readoutMod.buildSessionChainReadout({ tickets: ticketsMod.createSessionTickets({ cacheDir: dir, now: function () { return clock } }), at: READ_AT })
  const cases = [
    { what: '宿主没写下这个字段（还没接上）', payload: undefined, state: 'unreadable' },
    { what: '字段被改成空对象', payload: {}, state: 'unreadable' },
    { what: '宿主自己说这次没取到', payload: readoutMod.buildSessionChainReadout({ tickets: null, at: READ_AT }), state: 'unreadable' },
    { what: '宿主说取到了、就是没有', payload: emptyReadout, state: 'ok' },
  ]
  cases.forEach(function (c) {
    const s = snapOf(c.payload)
    if (c.payload === undefined) delete s.snapshot.sessionTickets
    const v = leaf.sessionChainViewOf(s)
    if (v.state !== c.state) fail(c.what + '：判成了 ' + v.state + '（应当 ' + c.state + '）')
    const n = leaf.SessionChainStrip({ st: s, narrow: false })
    if (c.state === 'unreadable') {
      const t = textOf(n)
      if (t.indexOf('读不到') < 0) fail(c.what + '：没有如实说读不到：' + JSON.stringify(t))
      if (/[0-9]/.test(t)) fail(c.what + '：读不到那一屏里出现了数字（0 会把「不知道」说成「没有人」）：' + JSON.stringify(t))
      if (leaf.sessionChainRowsOf(s).length !== 0) fail(c.what + '：读不到却还交出了会话行')
      // 六之一、主句：短（≤12 字）、没有括号、第一次读就懂；「没拿到 ≠ 没人在处理票」那层解释不在主句里
      const main = String(tr('chainView.unreadable') || '')
      if (main.length > 12) fail(c.what + '：读不到那句主句太长（' + main.length + ' 字，最多 12 字）：' + JSON.stringify(main))
      if (/[（）()\[\]【】]/.test(main)) fail(c.what + '：读不到那句主句里还有括号：' + JSON.stringify(main))
      if (main.indexOf('不表示') >= 0 || main.indexOf('不等于') >= 0) fail(c.what + '：那层解释（这次没拿到 ≠ 没人在处理票）混进了主句，它该在悬停提示里：' + JSON.stringify(main))
      const enMain = String(en['chainView.unreadable'] || '')
      if (!enMain) fail(c.what + '：英文那一份没有这句词条')
      else if (/[()]/.test(enMain)) fail(c.what + '：英文主句里还有括号：' + JSON.stringify(enMain))
      // 六之二、解释与原因代号都在悬停提示里（主句之外，一点也不许丢）
      const tip = String(tr('chainView.unreadableTip', { reason: v.reason }) || '')
      if (tip.indexOf('不表示没有会话在处理票') < 0) fail(c.what + '：悬停提示里没有「这次没拿到、不表示没有会话在处理票」这层意思：' + JSON.stringify(tip))
      if (tip.indexOf(String(v.reason)) < 0) fail(c.what + '：悬停提示里没有宿主给的原因代号（那一码信息不许丢）：' + JSON.stringify(tip))
      if (tip.indexOf('（') >= 0 || tip.indexOf('(') >= 0) fail(c.what + '：悬停提示里也用括号把话套住了（这次要求的是整句说清，不是套括号）：' + JSON.stringify(tip))
      // 六之三、这一行用仓库既有的危险色变量上色（不许写死色值）
      const rowColor = String((n && n.props && n.props.style && n.props.style.color) || '')
      if (!dangerColorOk(rowColor)) fail(c.what + '：读不到那一行没有用危险色变量上色（实得 ' + JSON.stringify(rowColor) + '）')
    } else {
      if (n !== null && n !== undefined) fail(c.what + '：这一块应当整块不画（不占位、不显示空框），实际画了：' + JSON.stringify(textOf(n)).slice(0, 120))
      if (leaf.sessionChainRowsOf(s).length !== 0) fail(c.what + '：没有票却交出了会话行')
    }
  })
  // 还没拿到快照时一个字都不说（还在取数，不到说读不到的时候）
  if (leaf.SessionChainStrip({ st: { snapshot: null }, narrow: false }) !== null) fail('还没拿到面板快照时不该画读不到那一句')
  // 危险色那条判据本身要有牙齿：合规写法必过，写死色值与灰色说明都不许过
  if (!dangerColorOk('var(--dsw-alias-state-error-primary,#f87171)')) fail('反证：合规的危险色变量写法没被判通过')
  if (dangerColorOk('#f87171')) fail('反证：写死色值也被判成合规（危险色那条判据失灵了）')
  if (dangerColorOk('var(--dsws-label-caption,#8b8b95)')) fail('反证：灰色说明那种写法也被判成危险色（判据失灵了）')
  // 空读数的来历也要对：宿主没拿到链实例时说 ok:false，界面照它说的报
  if (emptyReadout.ok !== true || emptyReadout.reason !== 'host.chain.empty') fail('空读数的形状不对：' + JSON.stringify(emptyReadout).slice(0, 120))

  // ---------- 三、词条：中英全等、动作词条覆盖闭集合、键都有真实读取点 ----------
  const zhKeys = Object.keys(zh).sort()
  const enKeys = Object.keys(en).sort()
  if (zhKeys.join(',') !== enKeys.join(',')) fail('中英词条键集合不全等：多了 ' + zhKeys.filter(function (k) { return enKeys.indexOf(k) < 0 }).join('、') + '；少了 ' + enKeys.filter(function (k) { return zhKeys.indexOf(k) < 0 }).join('、'))
  const mapCodes = Object.keys(leaf.SESSION_CHAIN_ACTION_KEYS).sort()
  const chainCodes = chain.CHAIN_ACTIONS.slice().sort()
  if (mapCodes.join(',') !== chainCodes.join(',')) fail('动作类别的词条键与链的闭集合不是一套：界面 ' + mapCodes.join('、') + ' / 链 ' + chainCodes.join('、'))
  chainCodes.forEach(function (code) {
    const k = leaf.SESSION_CHAIN_ACTION_KEYS[code]
    if (!zh[k] || !en[k]) fail('动作类别 ' + code + ' 的中英词条缺一个：' + k)
  })
  const leafSrc = fs.readFileSync(path.join(ROOT, LEAF), 'utf8')
  const keysInLeaf = zhKeys.filter(function (k) { return k.indexOf('chainView.') === 0 })
  if (keysInLeaf.length < 8) fail('界面那一半没有自己的词条（chainView.*）：实得 ' + keysInLeaf.length + ' 条')
  keysInLeaf.forEach(function (k) { if (leafSrc.indexOf("'" + k + "'") < 0) fail('词条写了没人读：' + k) })
  if (leaf.sessionChainActionKeyOf('made-up-action') !== '') fail('认不出的动作类别被翻成了一个像样的词（那就是编事实）')
  if (leaf.sessionChainActionKeyOf('state') !== 'chainView.action.state') fail('动作类别的挑词入口坏了')

  // ---------- 四、没有第二个数据来源（静态断言，只看代码不看注释）----------
  const code = codeOnly(LEAF)
  const banned = [
    ['tool/result', '会话事件'], ['tool/call', '会话事件'], ['ptc-dispatch', '会话事件'],
    ['sessionQuery', '直接读会话'], ['listSessions', '直接读会话'],
    ['gh issue', '自己解析命令行'], ['glab ', '自己解析命令行'], ['--json', '自己解析命令行'],
    ['chainEntryKey', '自己拼链的键'], ['chainRootHash', '自己拼链的键'], ['chainSessionShardId', '自己拼链的键'],
    ['chainVerdictOf', '自己判读与写'], ['mergeEntries', '自己重排链'],
    ['session-tickets.json', '自己去读落盘那份'], ['readFileSync', '自己去读文件'], ['require(', '自己去读文件'],
    ['host.call', '新增取数调用'], ['fetch(', '新增取数调用'], ['XMLHttpRequest', '新增取数调用'],
  ]
  banned.forEach(function (b) { if (code.indexOf(b[0]) >= 0) fail('界面代码里出现了「' + b[1] + '」的痕迹（' + b[0] + '）—— 这一块只许读宿主写下的那一份读数') })
  const fieldLit = code.match(/'sessionTickets'/g) || []
  if (fieldLit.length !== 1) fail('字段名在界面里出现了 ' + fieldLit.length + ' 次（应当只有常量那一处）')
  if (code.indexOf('snap[SESSION_CHAIN_FIELD]') < 0) fail('界面没有从那个常量去读快照字段（取数路径的口径就不唯一了）')
  const hard = hardcodedTextHits(code)
  if (hard.length) fail('界面代码里写死了文案（一个字都不许写死，必须走词条）：' + hard.join(' | '))
  // 这条静态判据本身要有牙齿：造一份坏样本，它必须报出来
  const badSample = "export const x = function () { return tr('chainView.title') + '这里是写死的一句中文' }\n"
  if (!hardcodedTextHits(badSample).length) fail('反证：写死中文的坏样本没有被静态判据逮住（判据本身失灵了）')
  const badSource = "export const y = function (st) { return st.snapshot['sessionTickets'] + host.call('wf.x', {}) }\n"
  if (badSource.indexOf('host.call') < 0) fail('反证：取数调用的坏样本没有被判据逮住')

  try { fs.rmSync(dir, { recursive: true, force: true }) } catch (e) { /* 临时目录清不掉不影响结论 */ }

  if (failed) { problems.forEach(function (p) { console.log('  FAIL ' + p) }); console.log('\n存在失败'); process.exit(1) }
  console.log('  PASS 真代码一路到底：链 → 宿主读数 → 界面判据（两个会话各三张/两张，不串）')
  console.log('  PASS 点一行跳到链记下的那张票（票号取自读数，不是界面猜的）')
  console.log('  PASS 读不到就说读不到（字段删掉 / 改成空 / 宿主说没取到），那一屏一个数字都没有')
  console.log('  PASS 读不到那句主句短、没有括号，解释与原因代号都在悬停提示里，那一行用危险色变量上色')
  console.log('  PASS 宿主说「取到了、就是没有」时整块不画；还没拿到快照时一个字都不说')
  console.log('  PASS 中英词条键集合全等；动作词的键与链的闭集合 CHAIN_ACTIONS 逐个对上')
  console.log('  PASS 静态：界面只读快照里那一个字段，没有第二个数据来源，没有写死的文案')
  console.log('\n全部通过')
}

main().catch(function (e) {
  console.error('门禁执行异常：' + ((e && e.stack) || e))
  process.exit(1)
})
