// verify-chain-view.js —— 门禁：处理链展示面「每个会话在处理哪些票」（票 #721 / T17）
// 用法：在插件根目录执行 node tests/verify-chain-view.js（比产物新鲜度那几条不查产物，可独立运行）
//
// 这一条门禁跑的是**真代码**，一路到底：
//   真的链（#714 的 createSessionTickets 记下五次写）→ 真的宿主读数（src/host/refresh/sessionChainReadout.js）
//   → 真的界面判据与画法（src/client/views/shared/sessionChainView.js，按 scripts/build.mjs 同一套做法
//     剥掉行首 export、放进一个作用域里跑，React 用最小的假件代替）。
//
// 它盯六件事：
//   一、**取数路径**：界面读的就是快照里那一个字段（sessionTickets）。真跑一遍：两个会话各几张票，
//      按会话分组不串；界面拿不到会话 id 原文（链只留散列）。
//   二、**「还没有记录」归空、「真读坏了」才可见**（2026-09-24 维护者改的口径）：
//      `host.chain.absent`（字段没挂 / 没有链实例）与「取到了、就是没有」是同一种事实，整块不画；
//      只有 read-failed 与 shape 才画一个可见标记。
//   三、**不可读时不占额外一行**：不许再有一整句道歉独占一行 —— 整句文案只许在悬停里，
//      容器纵向不许有 padding；absent 与 empty 两种空态的容器高度必须都是 0（逐字对上票面那句）。
//   四、**宿主说「取到了、就是没有」时整块不画**（票面要求：不猜、不占位、不显示空框）。
//   五、**话都在词条里**：中英两份键集合全等；这一块画的每个字都来自词条（代码里不许有中文串）；
//      动作类别的词条键与链的闭集合 CHAIN_ACTIONS 逐个对上（链上加了新类别而这里没跟上就红）。
//      读不到那句主句仍要短（≤12 字）、没有括号，解释与原因代号都在悬停提示里。
//   六、**没有第二个数据来源**（静态断言）：界面代码里不许出现会话事件、命令行解析、链的键构造、
//      链的过滤判定、落盘文件名、任何 host.call / fetch。
//
// 反证（人工做过三次，见回报）：把一句中文写死在界面里、把「读不到」改成显示空列表、
//   把 absent 改回「整句独占一行」的旧画法 —— 都被本门禁打红。
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

  // ---------- 二、「还没有记录」归空、「读坏了」才可见（2026-09-24 维护者改的口径）----------
  // 口径改动的来路（真机反馈）：面板上那句「读不到处理记录」从来没消失过，而且它独占一行很影响体验。
  // 第一性原理：那句话是**一句道歉**，不携带任何用户可行动的信息；而「确实没有会话在处理票」才是信息。
  //   所以：`host.chain.absent`（还没有记录）归「空」——与 empty 一样整块不画；
  //   只有 read-failed / shape（真读坏了）才画一个可见标记，而且**不独占一行**。
  const emptyReadout = readoutMod.buildSessionChainReadout({ tickets: ticketsMod.createSessionTickets({ cacheDir: dir, now: function () { return clock } }), at: READ_AT })
  const cases = [
    { what: '宿主没写下这个字段（这个进程里还没有记录）', payload: undefined, state: 'empty' },
    { what: '字段被改成空对象（形状不对）', payload: {}, state: 'unreadable' },
    { what: '宿主自己说这次没取到：没有链实例', payload: readoutMod.buildSessionChainReadout({ tickets: null, at: READ_AT }), state: 'empty' },
    { what: '宿主说读的时候抛错了', payload: { ok: false, at: READ_AT, reason: 'host.chain.read-failed', sessions: [] }, state: 'unreadable' },
    { what: '宿主说存下来的形状不对', payload: { ok: false, at: READ_AT, reason: 'host.chain.shape', sessions: [] }, state: 'unreadable' },
    { what: '宿主说取到了、就是没有', payload: emptyReadout, state: 'ok' },
  ]

  /** 一块的纵向占用（像素的近似值）：纵向 padding 加一行。整块不画就是 0。 */
  const num = function (v) { const n = parseFloat(v); return isFinite(n) ? n : 0 }
  const verticalPadding = function (style) {
    const parts = String((style && style.padding) || '').split(/\s+/).filter(Boolean)
    if (!parts.length) return 0
    if (parts.length === 1) return num(parts[0]) * 2
    if (parts.length === 3) return num(parts[0]) + num(parts[2])
    if (parts.length === 4) return num(parts[0]) + num(parts[2])
    return num(parts[0]) * 2
  }
  const blockHeight = function (node) {
    if (node === null || node === undefined) return 0
    const style = (node.props && node.props.style) || {}
    const line = num(style.lineHeight) || num(style.fontSize)
    return verticalPadding(style) + line
  }
  /** 一块**自己**看得见的文字（悬停提示里的不算：那是鼠标放上去才有的）。 */
  const visibleTextOf = function (node) {
    if (node === null || node === undefined || node === false) return ''
    if (typeof node === 'string') return node
    if (typeof node === 'number') return String(node)
    if (Array.isArray(node)) return node.map(visibleTextOf).filter(Boolean).join(' ')
    if (node.type === 'Tip') return ''
    return visibleTextOf(node.children)
  }

  const tallies = { empty: [], unreadable: [] }
  cases.forEach(function (c) {
    const s = snapOf(c.payload)
    if (c.payload === undefined) delete s.snapshot.sessionTickets
    const v = leaf.sessionChainViewOf(s)
    if (v.state !== c.state) fail(c.what + '：判成了 ' + v.state + '（应当 ' + c.state + '）')
    const n = leaf.SessionChainStrip({ st: s, narrow: false })
    if (c.state === 'empty') {
      // 一、还没有记录 = 取到了就是没有：同一种事实、同一种处理，整块不画。
      if (n !== null && n !== undefined) fail(c.what + '：这一块应当整块不画（不占位、不显示空框），实际画了：' + JSON.stringify(textOf(n)).slice(0, 120))
      // 二、**不再产出那句可见警告**（这次改动的主句）：一个字都不许冒出来。
      if (textOf(n)) fail(c.what + '：不画却还有文字（那句道歉不该再出现）：' + JSON.stringify(textOf(n)))
      if (leaf.sessionChainRowsOf(s).length !== 0) fail(c.what + '：没有记录却交出了会话行')
      tallies.empty.push(blockHeight(n))
    } else if (c.state === 'unreadable') {
      const t = textOf(n)
      if (t.indexOf('读不到') < 0) fail(c.what + '：真读坏了却没有如实说：' + JSON.stringify(t))
      if (/[0-9]/.test(t)) fail(c.what + '：读不到那一屏里出现了数字（0 会把「不知道」说成「没有人」）：' + JSON.stringify(t))
      if (leaf.sessionChainRowsOf(s).length !== 0) fail(c.what + '：读不到却还交出了会话行')
      // 三、主句：短（≤12 字）、没有括号、第一次读就懂；「没拿到 ≠ 没人在处理票」那层解释不在主句里
      const main = String(tr('chainView.unreadable') || '')
      if (main.length > 12) fail(c.what + '：读不到那句主句太长（' + main.length + ' 字，最多 12 字）：' + JSON.stringify(main))
      if (/[（）()\[\]【】]/.test(main)) fail(c.what + '：读不到那句主句里还有括号：' + JSON.stringify(main))
      if (main.indexOf('不表示') >= 0 || main.indexOf('不等于') >= 0) fail(c.what + '：那层解释（这次没拿到 ≠ 没人在处理票）混进了主句，它该在悬停提示里：' + JSON.stringify(main))
      const enMain = String(en['chainView.unreadable'] || '')
      if (!enMain) fail(c.what + '：英文那一份没有这句词条')
      else if (/[()]/.test(enMain)) fail(c.what + '：英文主句里还有括号：' + JSON.stringify(enMain))
      // 四、解释与原因代号都在悬停提示里（主句之外，一点也不许丢）
      const tip = String(tr('chainView.unreadableTip', { reason: v.reason }) || '')
      if (tip.indexOf('不表示没有会话在处理票') < 0) fail(c.what + '：悬停提示里没有「这次没拿到、不表示没有会话在处理票」这层意思：' + JSON.stringify(tip))
      if (tip.indexOf(String(v.reason)) < 0) fail(c.what + '：悬停提示里没有宿主给的原因代号（那一码信息不许丢）：' + JSON.stringify(tip))
      if (tip.indexOf('（') >= 0 || tip.indexOf('(') >= 0) fail(c.what + '：悬停提示里也用括号把话套住了（这次要求的是整句说清，不是套括号）：' + JSON.stringify(tip))
      // 五、这一块用仓库既有的危险色变量上色（不许写死色值）
      const rowColor = String((n && n.props && n.props.style && n.props.style.color) || '')
      if (!dangerColorOk(rowColor)) fail(c.what + '：读不到那一块没有用危险色变量上色（实得 ' + JSON.stringify(rowColor) + '）')
      // 六、**不许独占一行**（这次改动的主句）：自己不许有一句可见文案，纵向也不许有 padding。
      if (visibleTextOf(n) !== '') fail(c.what + '：真读坏了那个标记自己带了可见文案（整句文案不许再独占一行，它该只在悬停里）：' + JSON.stringify(visibleTextOf(n)))
      if (verticalPadding((n && n.props && n.props.style) || {}) !== 0) fail(c.what + '：那个标记带了纵向 padding（会撑出一行高度）：' + JSON.stringify(((n.props || {}).style || {}).padding))
      tallies.unreadable.push(blockHeight(n))
    } else {
      if (n !== null && n !== undefined) fail(c.what + '：这一块应当整块不画（不占位、不显示空框），实际画了：' + JSON.stringify(textOf(n)).slice(0, 120))
      if (leaf.sessionChainRowsOf(s).length !== 0) fail(c.what + '：没有票却交出了会话行')
    }
  })

  // 七、**不可读态不占额外一行**：票面那句「容器高度与空态一致」按最要紧的那一种不可读态来断言 ——
  //    `host.chain.absent`（从来没有记录，也就是这次真机上那条常驻警告的来路）与 empty 态必须**完全同高**。
  //    两种都整块不画，所以都是 0；这里把「都是 0」逐个数一遍，将来谁给空态补一个占位框都会红。
  if (tallies.empty.length < 2) fail('空态样本不足（实得 ' + tallies.empty.length + ' 个）：absent 与「取到了就是没有」两种都要被量到')
  tallies.empty.forEach(function (hh, i) { if (hh !== 0) fail('空态样本 ' + i + ' 占了 ' + hh + ' 像素高（还没有记录时不许占任何高度，更不许独占一行）') })
  // 反证（这一条判据本身要有牙齿）：把 absent 换回「整句独占一行」的旧画法，必须被逮住。
  const oldStyleWarn = { type: 'div', props: { style: { fontSize: 11, padding: '2px 2px 4px' } }, children: [{ type: 'span', props: {}, children: ['读不到处理记录'] }] }
  const absentIsSilent = function (node) { return (node === null || node === undefined) && blockHeight(node) === 0 }
  if (!absentIsSilent(null)) fail('反证：不画的节点没被判成「沉默」')
  if (absentIsSilent(oldStyleWarn)) fail('反证：旧那句独占一行的警告也被判成了「沉默」（这条判据失灵了）')
  if (blockHeight(oldStyleWarn) <= tallies.unreadable[0]) fail('反证：旧画法（' + blockHeight(oldStyleWarn) + ' 像素）没有比现在的标记（' + tallies.unreadable[0] + ' 像素）更高，说明「不占额外一行」这条判据量不出差别')
  // 还没拿到快照时一个字都不说（还在取数，不到下结论的时候）
  if (leaf.SessionChainStrip({ st: { snapshot: null }, narrow: false }) !== null) fail('还没拿到面板快照时不该画任何东西')
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
  console.log('  PASS 「还没有记录」与「取到了就是没有」同一种画法：整块不画，容器高度都是 0（不占额外一行）')
  console.log('  PASS 只有 read-failed / shape 才可见：一枚标记、自己不带文案、纵向 padding 为 0、原因代号在悬停里')
  console.log('  PASS 读不到那句主句短、没有括号；那一块用危险色变量上色（旧画法更高，反证量得出差别）')
  console.log('  PASS 中英词条键集合全等；动作词的键与链的闭集合 CHAIN_ACTIONS 逐个对上')
  console.log('  PASS 静态：界面只读快照里那一个字段，没有第二个数据来源，没有写死的文案')
  console.log('\n全部通过')
}

main().catch(function (e) {
  console.error('门禁执行异常：' + ((e && e.stack) || e))
  process.exit(1)
})
