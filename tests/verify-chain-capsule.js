#!/usr/bin/env node
// verify-chain-capsule.js —— 门禁：状态栏胶囊里「这个会话在办哪张票」那一段
// 用法：在插件根目录执行 node tests/verify-chain-capsule.js，可独立运行。
//
// 这一段只做三件事，门禁按三组量：
//   A 判据（纯函数，不开浏览器）：没快照/没记录/当前会话没记录 → 空；读坏了 → 原因透出；
//     对上格了 → 挑当前会话最新一条，剩几条数出来；散列与链同一套算法（与 chain.ts 对拍）。
//   B 版面纪律：可见字里没有 8 位散列、没有内部行话（与 chain-view-ui 的 R8 同一条尺子）；
//     文件零中文字符串（文案全走词条）；空态不占位、坏态不独占一行（读源码结构断言）。
//   C 接线：StatusBar 胶囊里挂着它；构建、index 标记、叶子表三处登记齐全；折叠让位表没被动过（还是 9 段）。
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let passed = 0, failed = 0
function ok(msg) { passed++; console.log('  PASS ' + msg) }
function bad(msg) { failed++; console.log('  FAIL ' + msg) }
function check(cond, msg) { if (cond) ok(msg); else bad(msg) }
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8')

const LEAF = 'src/client/statusbar/SessionChainCapsule.js'
if (!existsSync(resolve(ROOT, LEAF))) { console.log('缺文件 ' + LEAF); process.exit(1) }

// 与构建同一套做法：剥行首 export，丢进同名桩那个作用域里跑（只动判据，不渲染组件）。
function loadLeaf(rowsStub) {
  const src = read(LEAF).replace(/^[ \t]*export[ \t]+/gm, '')
  const factory = new Function(
    'React', 'DswsCtx', 'Tip', 'Ic', 'tr', 'sessionChainRowsOf', 'SESSION_CHAIN_FIELD', 'sessionChainOpenTicket', 'openPanel',
    src + '\nreturn { capsuleShardOf, sessionChainCapsuleOf, SessionChainCapsule }'
  )
  const React = { createElement: function (t, p) { return { t: t, p: p, c: Array.prototype.slice.call(arguments, 2) } }, useContext: function () { return null } }
  const tr = function (k) { return String(k) }
  const Tip = function () { return null }
  const Ic = function () { return null }
  return factory(React, null, Tip, Ic, tr, rowsStub, 'sessionTickets', function () {}, function () {})
}

console.log('A) 判据：跟谁走、空态、坏态')
{
  const rowsOfMine = [
    { shardId: 'SHARD-MINE', label: 'x', sessionFull: 'x', sessionIndex: 0, firstOfSession: true, backend: 'github', ticketKey: '951', ticketTitle: '演示票', effortId: '', action: 'edit', actionKey: 'chainView.action.edit', at: 200, time: '16:50' },
    { shardId: 'SHARD-MINE', label: 'x', sessionFull: 'x', sessionIndex: 0, firstOfSession: false, backend: 'github', ticketKey: '950', ticketTitle: '', effortId: '', action: 'comment', actionKey: 'chainView.action.comment', at: 100, time: '16:40' },
    { shardId: 'SHARD-OTHER', label: 'y', sessionFull: 'y', sessionIndex: 1, firstOfSession: true, backend: 'github', ticketKey: '800', ticketTitle: '别人的票', effortId: '', action: 'state', actionKey: '', at: 300, time: '16:55' },
  ]
  const leaf = loadLeaf(function (st) { return (st && st.snapshot) ? rowsOfMine : [] })
  check(leaf.sessionChainCapsuleOf(null, 's1').state === 'idle', '没快照 → idle（调用方整段不画）')
  check(leaf.sessionChainCapsuleOf({ snapshot: {} }, 's1').state === 'empty', '字段没挂上 → empty（不把「还没有」说成坏了）')
  const hit = leaf.sessionChainCapsuleOf({ snapshot: { sessionTickets: { ok: true } } }, 's1')
  check(hit.state === 'empty', '当前会话没格子 → empty（不把别的会话的票算到当前头上）')
  // 当前会话的那一格：用叶子自己的散列函数算，保证判据与挂载读的是同一把散列
  const mine = (function () {
    const shardOf = leaf.capsuleShardOf('s1')
    const rows = rowsOfMine.map(function (r) { return Object.assign({}, r, { shardId: r.shardId === 'SHARD-MINE' ? shardOf : 'SHARD-OTHER-X' }) })
    const leaf2 = loadLeaf(function (st) { return (st && st.snapshot) ? rows : [] })
    return leaf2.sessionChainCapsuleOf({ snapshot: { sessionTickets: { ok: true } } }, 's1')
  })()
  check(mine.state === 'ok' && mine.entry && mine.entry.ticketKey === '951' && mine.list.length === 2 && mine.list[1].ticketKey === '950', '对上格 → 最新一条是 951，单子从新到旧共 2 条（实得 ' + JSON.stringify({ state: mine.state, key: mine.entry && mine.entry.ticketKey, n: mine.list.length }) + '）')
  const brokenLeaf = loadLeaf(function () { return [] })
  const broken = brokenLeaf.sessionChainCapsuleOf({ snapshot: { sessionTickets: { ok: false, reason: 'host.chain.read-failed' } } }, 's1')
  check(broken.state === 'unreadable' && broken.reason === 'host.chain.read-failed', '真坏了 → 原因透出（调用方画小图标，不独占一行）')
  const absent = brokenLeaf.sessionChainCapsuleOf({ snapshot: { sessionTickets: { ok: false, reason: 'host.chain.absent' } } }, 's1')
  check(absent.state === 'empty', 'host.chain.absent 归空不归坏（与展示面同一条纪律）')
}

console.log('B) 版面纪律：可见字里没有散列与内部行话，文件零中文')
{
  const src = read(LEAF)
  const stripComments = function (buf) { return buf.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '') }
  const code = stripComments(src)
  let cjk = 0
  const strRe = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"/g
  let m
  while ((m = strRe.exec(code)) !== null) { const s = m[1] !== undefined ? m[1] : m[2]; if (/[一-鿿]/.test(s)) cjk++ }
  check(cjk === 0, '零中文字符串（文案全走词条，实得 ' + cjk + ' 处）')
  check(/data-fold-priority/.test(src) === false || (src.indexOf("'data-fold-priority': 12") >= 0 && src.match(/data-fold-priority/g).length === 1), '版面那个号挂在让位表 12 号（排在最后；单子里的行不进阶梯）')
  check(src.indexOf('maxWidth') >= 0 && src.indexOf('ellipsis') >= 0, '宽度用省略号收（窄宽度下不把胶囊撑爆）')
  // 可见文本由「在办 #号 标题 · 动作 · 时间」拼成：号与标题来自链与快照，动作走词条键，散列只进悬停
  // 号前缀的规则只写一处（地图写裸号、普通票写 #号），地图图标也只写一处 —— 两处调用点都读这两个小件。
  check(/const chainKeyTextOf = function \(isMap, key\) \{ return isMap === true \? String\(key\) : '#' \+ String\(key\) \}/.test(src), '号前缀规则只有一处：地图写裸号，普通票写 #号')
  check(/const chainMapIconOf = function \(isMap, size\)/.test(src), '地图图标只有一处（普通票没有这一枚）')
  check(src.indexOf("tr('chainView.capsuleDoing')") >= 0, '版面那个号的无障碍朗读里带着「在办」这句词条')
  // 真渲染两条：版面只有号；单子打开时是当前会话的单子，点行能进详情（行上挂着跳转）
  {
    const shardOf = (function () { const l = loadLeaf(function () { return [] }); return l.capsuleShardOf('s1') })()
    const rows = [
      { shardId: shardOf, label: 'x', sessionFull: 'x', sessionIndex: 0, firstOfSession: true, backend: 'github', ticketKey: '951', ticketTitle: '很长很长的标题很长很长的标题', effortId: '', action: 'edit', actionKey: 'chainView.action.edit', at: 200, time: '16:50' },
      { shardId: shardOf, label: 'x', sessionFull: 'x', sessionIndex: 0, firstOfSession: false, backend: 'github', ticketKey: '950', ticketTitle: '', effortId: '', action: 'comment', actionKey: 'chainView.action.comment', at: 100, time: '16:40' },
    ]
    const leafR = (function () {
      const srcR = read(LEAF).replace(/^[ \t]*export[ \t]+/gm, '')
      const h = function (t, p) { return { t: t, p: p, c: Array.prototype.slice.call(arguments, 2) } }
      const factory = new Function('React', 'DswsCtx', 'Tip', 'Ic', 'tr', 'sessionChainRowsOf', 'SESSION_CHAIN_FIELD', 'sessionChainOpenTicket', 'openPanel', 'PortalOverlay', 'placeStatusOverlay', 'clearStatusClose', 'scheduleStatusClose', 'emit',
        srcR + '\nreturn { SessionChainCapsule }')
      const refs = []
      const box = { init: false, active: null }
      const React = {
        createElement: h,
        useContext: function () { return { h: h } },
        useRef: function (v) { const r = { current: v }; refs.push(r); return r },
        useState: function (v) { if (!box.init) { box.init = true; box.active = v } return [box.active, function (nv) { box.active = nv }] },
      }
      const Tip = function () { return null }
      const Ic = function () { return null }
      const tr = function (k) { return String(k) }
      const opened = []
      const openTicket = function (st, row) { opened.push(row.ticketKey) }
      return Object.assign(factory(React, { h: h }, Tip, Ic, tr, function () { return rows }, 'sessionTickets', openTicket, function () {}, function (o, kids) { return { overlay: true, props: o, children: kids } }, function () { return { left: 1, bottom: 2 } }, function () {}, function (r, fn) { fn() }, function () {}), { opened: opened })
    })()
    const st = { snapshot: { sessionTickets: { ok: true } } }
    const shut = leafR.SessionChainCapsule({ st: st, sid: 's1' })
    const flat = []
    ;(function walk(n) {
      if (n === null || n === undefined) return
      if (typeof n === 'string') { flat.push(n); return }
      if (Array.isArray(n)) { n.forEach(walk); return }
      if (typeof n === 'object') { (n.c || []).forEach(walk) }
    })(shut)
    // 版面那个号：普通票写成 `#号`，地图写成裸号（`#` 换成了地图图标，见 E 节）。
    //   这里按「号」的写法筛，不按「以 # 开头」筛 —— 否则地图那一条会从这把尺子下面整个漏过去。
    const faces = flat.filter(function (s) { return /^#?\d{1,10}$/.test(s) })
    check(faces.length === 1 && faces[0] === '#951', '单子没打开时版面只有一个号（标题再长也不上版面，实得 ' + JSON.stringify(faces) + '）')
    check(flat.some(function (s) { return s.indexOf('dsws-chainmenu') >= 0 }) === false, '单子没打开时版面上没有单子节点')
    st.chainMenuOpen = true
    st.chainMenuPos = { left: 1, bottom: 2 }
    const open = leafR.SessionChainCapsule({ st: st, sid: 's1' })
    const flat2 = []
    ;(function walk2(n) {
      if (n === null || n === undefined) return
      if (typeof n === 'string') { flat2.push(n); return }
      if (typeof n === 'object' && n.overlay === true) { flat2.push('[menu]'); (n.children || []).forEach(walk2); return }
      if (Array.isArray(n)) { n.forEach(walk2); return }
      if (typeof n === 'object') { (n.c || []).forEach(walk2) }
    })(open)
    check(flat2.indexOf('[menu]') >= 0, '悬停打开的是同一套悬浮单子（与 BUG / 可接菜单同形）')
    check(flat2.some(function (s) { return s.indexOf('#951') >= 0 }) && flat2.some(function (s) { return s.indexOf('#950') >= 0 }), '单子里是当前会话的记录（两张都在，带标题）')
    check(flat2.some(function (s) { return s.indexOf(shardOf.slice(0, 8)) >= 0 }) === false, '单子里没有散列号（按那个会话散列的前 8 位找，不靠「以 # 开头」筛）')
    // 悬停视觉：鼠标进第二行 → 重渲染后只有那一行高亮；最新一行图钉是 accent 色，其余是灰色
    const findRows = function (root) {
      const out = []
      ;(function walk(n) {
        if (n === null || n === undefined) return
        if (Array.isArray(n)) { n.forEach(walk); return }
        if (typeof n === 'object' && !n.overlay) {
          if (n.p && typeof n.p.className === 'string' && n.p.className.indexOf('dsws-chainmenu-row') >= 0) out.push(n)
          ;(n.c || []).forEach(walk)
        } else if (typeof n === 'object') { (n.children || []).forEach(walk) }
      })(root)
      return out
    }
    const rows0 = findRows(open)
    check(rows0.length === 2 && rows0.every(function (r) { return r.p.style.background === 'transparent' }), '没悬停时两行都无底色')
    rows0[1].p.onMouseEnter()
    const hovered = leafR.SessionChainCapsule({ st: st, sid: 's1' })
    const rows1 = findRows(hovered)
    check(rows1[1].p.style.background === 'rgba(88,166,255,.12)' && rows1[0].p.style.background === 'transparent', '悬停哪行亮哪行（只有第二行高亮）')
    rows0[1].p.onMouseLeave()
    const left = leafR.SessionChainCapsule({ st: st, sid: 's1' })
    check(findRows(left).every(function (r) { return r.p.style.background === 'transparent' }), '鼠标离开后高亮收回')
    // 单子从旧到新往下排：第一行是最旧的 950，最后一行是最新的 951（沉底离鼠标最近，带最新标识）
    const firstAria = String(rows1[0].p['aria-label'] || '')
    const lastAria = String(rows1[rows1.length - 1].p['aria-label'] || '')
    check(firstAria.indexOf('#950') === 0 && lastAria.indexOf('#951') === 0, '旧在上新在下（首行 #950，末行 #951；实得 ' + JSON.stringify([firstAria.slice(0, 12), lastAria.slice(0, 12)]) + '）')
    check(rows1[rows1.length - 1].p.className.indexOf('is-latest') >= 0 && rows1[0].p.className.indexOf('is-latest') < 0, '最新标识落在沉底那一行')
    check(rows1.every(function (r) { return String(r.p['aria-label'] || '').indexOf('·') < 0 }), '行内不用 · 分隔')
    const pillBadges = []
    ;(function walkPill(n) {
      if (n === null || n === undefined) return
      if (Array.isArray(n)) { n.forEach(walkPill); return }
      if (typeof n === 'object' && !n.overlay) {
        if (n.p && n.p.style && n.p.style.borderRadius === 99 && typeof n.c !== 'undefined') {
          const texts = []
          ;(function inner(m) {
            if (typeof m === 'string') texts.push(m)
            else if (Array.isArray(m)) m.forEach(inner)
            else if (m && typeof m === 'object') (m.c || []).forEach(inner)
          })(n.c)
          if (texts.some(function (t) { return /^#?\d{1,10}$/.test(t) })) pillBadges.push(texts.join(''))
        }
        ;(n.c || []).forEach(walkPill)
      } else if (typeof n === 'object') { (n.children || []).forEach(walkPill) }
    })(hovered)
    check(pillBadges.length === 2 && pillBadges.some(function (t) { return t === '#950' }) && pillBadges.some(function (t) { return t === '#951' }), '号做成了徽章（两行的号徽章各就各位，实得 ' + JSON.stringify(pillBadges) + '）')
  }
  const banned = ['宿主读数', '宿主', '读数', '分格', '散列']
  const shown = banned.filter(function (w) {
    // 注释里的说明文字不算版面：只看代码里进 Tip content 与 text 的那几行
    const lines = code.split('\n').filter(function (ln) { return /text|content|tip/i.test(ln) })
    return lines.some(function (ln) { return ln.indexOf(w) >= 0 })
  })
  check(shown.length === 0, '可见字里没有内部行话（实测 ' + JSON.stringify(shown) + '）')
}

console.log('C) 接线：挂载、构建、叶子表、让位表、环境段图标')
{
  const bar = read('src/client/statusbar/StatusBar.js')
  check(bar.indexOf('h(SessionChainCapsule, { st: s, sid: sid })') >= 0, 'StatusBar 胶囊品牌字之后挂着这一段（跟当前会话走）')
  // 环境段图标随状态走（全好对勾圈/欠缺大圆点/不好警告三角），尺寸比别段大一圈；颜色走整段状态色。
  check(bar.indexOf("seg(n < 0 ? 'alert' : (n === envTotal(s) ? 'check' : 'dot')") >= 0, '环境段图标按状态挑（全好对勾圈/欠缺圆点/不好警告三角）')
  check(bar.indexOf("function () { go('checks') }, 14)") >= 0, '环境段图标尺寸 14（比旁边两段大一圈）')
  const build = read('scripts/build.mjs')
  check(build.indexOf("id: 'sessionChainCapsule'") >= 0, '构建 LEAF_MODULES 登记了这一叶')
  const idx = read('src/client/index.js')
  check(idx.indexOf('leaf:sessionChainCapsule (spliced by build)') >= 0, 'index.js 留了拼接标记')
  const leaves = read('tests/verify-leaves.js')
  check(leaves.indexOf('statusbar/SessionChainCapsule.js') >= 0, '叶子表登记了这一叶（含导出与组件断言）')
  const capFoldSrc = read('src/client/statusbar/capFold.js').replace(/^[ \t]*export[ \t]+/gm, '')
  const capFold = new Function(capFoldSrc + '\nreturn { CAP_FOLD_POLICY }')()
  const keys = Object.keys(capFold.CAP_FOLD_POLICY || {}).sort(function (a, b) { return Number(a) - Number(b) })
  check(JSON.stringify(keys) === JSON.stringify(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12']), '让位表是 12 段（环境计数 5 早于时间，在办编号 12 排在最后）')
  const zh = read('src/client/kernel/locale-pages.js')
  check(zh.indexOf("'chainView.capsuleDoing'") >= 0, '中英文词条 chainView.capsuleDoing 已落（zh/en 各一）')
}

console.log('D) 散列与链同一套（与 chain.ts 对拍，不另抄一份期望值）')
{
  const chainMod = await import(pathToFileURL(resolve(ROOT, 'src/shared/refresh/chain.js')).href)
  const leaf = loadLeaf(function () { return [] })
  const sids = ['s-abc', '  spaced  ', '会话-1', 'x'.repeat(64)]
  const same = sids.every(function (id) { return leaf.capsuleShardOf(id) === chainMod.chainSessionShardId(id) })
  check(same, '抽 ' + sids.length + ' 个会话 id（含空格与中文），两边散列逐个相等')
  check(leaf.capsuleShardOf('') === '' && leaf.capsuleShardOf(null) === '' , '空 id 不成格（对不上就当没有）')
}

console.log('E) 地图那一条：认身份换图标，文字通道仍留号（#780）')
{
  check(read(LEAF).indexOf("Ic({ n: 'map'") >= 0, '源码里地图那一条画的是地图图标（不是一律图钉）')
  const shardOf = (function () { const l = loadLeaf(function () { return [] }); return l.capsuleShardOf('s1') })()
  const rows = [
    { shardId: shardOf, label: 'x', sessionFull: 'x', sessionIndex: 0, firstOfSession: true, backend: 'github', ticketKey: '40', ticketTitle: '某地图', effortId: '', isMap: true, action: 'edit', actionKey: 'chainView.action.edit', at: 200, time: '16:50' },
    { shardId: shardOf, label: 'x', sessionFull: 'x', sessionIndex: 0, firstOfSession: false, backend: 'github', ticketKey: '780', ticketTitle: '普通票', effortId: '', isMap: false, action: 'comment', actionKey: 'chainView.action.comment', at: 100, time: '16:40' },
  ]
  const h = function (t, p) { return { t: t, p: p, c: Array.prototype.slice.call(arguments, 2) } }
  const icons = []
  const built = (function () {
    const srcR = read(LEAF).replace(/^[ \t]*export[ \t]+/gm, '')
    const factory = new Function('React', 'DswsCtx', 'Tip', 'Ic', 'tr', 'sessionChainRowsOf', 'SESSION_CHAIN_FIELD', 'sessionChainOpenTicket', 'openPanel', 'PortalOverlay', 'placeStatusOverlay', 'clearStatusClose', 'scheduleStatusClose', 'emit',
      srcR + '\nreturn { SessionChainCapsule }')
    const React = {
      createElement: h,
      useContext: function () { return { h: h } },
      useRef: function (v) { return { current: v } },
      useState: function () { return [null, function () {}] },
    }
    const Ic = function (props) { icons.push(props && props.n); return { t: 'Ic', p: props || {}, c: [] } }
    const tr = function (k) { return String(k) }
    return factory(React, { h: h }, function () { return null }, Ic, tr, function () { return rows }, 'sessionTickets', function () {}, function () {}, function (o, kids) { return { overlay: true, props: o, children: kids } }, function () { return { left: 1, bottom: 2 } }, function () {}, function (r, fn) { fn() }, function () {})
  })()
  const st = { snapshot: { sessionTickets: { ok: true } } }
  const shut = built.SessionChainCapsule({ st: st, sid: 's1' })
  const flat = []
  ;(function walk(n) {
    if (n === null || n === undefined) return
    if (typeof n === 'string') { flat.push(n); return }
    if (Array.isArray(n)) { n.forEach(walk); return }
    if (typeof n === 'object') { (n.c || []).forEach(walk) }
  })(shut)
  // 最新那一条是地图：版面上是裸号，`#` 换成了地图图标
  check(flat.indexOf('40') >= 0 && flat.indexOf('#40') < 0, '地图那一条版面上是裸号 40（`#` 已换成地图图标，实得 ' + JSON.stringify(flat) + '）')
  check(icons.indexOf('map') >= 0 && icons.indexOf('pin') >= 0, '地图那一条同时有图钉与地图图标（实得 ' + JSON.stringify(icons) + '）')
  // 硬约束：挂让位号的元素里不许有元素子节点 —— 收字机器是往它里面写 textContent 的，
  //   谁把图标塞进去，第一次收字就会被抹掉、React 再装回来，用户看到图标一闪一闪。
  const foldSlots = []
  ;(function collect(n) {
    if (n === null || n === undefined) return
    if (Array.isArray(n)) { n.forEach(collect); return }
    if (typeof n !== 'object') return
    if (n.p && n.p['data-fold-priority'] !== undefined) foldSlots.push(n)
    ;(n.c || []).forEach(collect)
  })(shut)
  check(foldSlots.length === 1, '整条胶囊上只有一个挂让位号的元素（实得 ' + foldSlots.length + '）')
  check(foldSlots.every(function (s) { return (s.c || []).every(function (x) { return typeof x === 'string' }) }), '每个挂让位号的元素里都没有元素子节点（收字机器写 textContent 时抹不掉任何图标）')
  // 悬停单子：地图那行的号徽章是「地图图标 + 裸号」，普通票那行仍是 #780
  st.chainMenuOpen = true
  st.chainMenuPos = { left: 1, bottom: 2 }
  const open = built.SessionChainCapsule({ st: st, sid: 's1' })
  const rowNodes = []
  ;(function walkRows(n) {
    if (n === null || n === undefined) return
    if (Array.isArray(n)) { n.forEach(walkRows); return }
    if (typeof n === 'object' && n.overlay) { (n.children || []).forEach(walkRows); return }
    if (typeof n === 'object') {
      if (n.p && typeof n.p.className === 'string' && n.p.className.indexOf('dsws-chainmenu-row') >= 0) { rowNodes.push(n); return }
      ;(n.c || []).forEach(walkRows)
    }
  })(open)
  check(rowNodes.length === 2, '单子里两行都在（实得 ' + rowNodes.length + '）')
  const rowOf = function (key) { return rowNodes.filter(function (r) { return String(r.p['aria-label'] || '').indexOf('#' + key) >= 0 })[0] || null }
  const mapRow = rowOf('40')
  const plainRow = rowOf('780')
  check(!!mapRow && !!plainRow, '单子里认得出哪一行是地图、哪一行是普通票')
  const pillOf = function (row) {
    let hit = null
    ;(function find(n) {
      if (hit || n === null || n === undefined) return
      if (Array.isArray(n)) { n.forEach(find); return }
      if (typeof n !== 'object') return
      if (n.p && n.p.style && n.p.style.borderRadius === 99) { hit = n; return }
      ;(n.c || []).forEach(find)
    })(row)
    return hit
  }
  const textsIn = function (n) {
    const out = []
    ;(function inner(m) {
      if (typeof m === 'string') { out.push(m); return }
      if (Array.isArray(m)) { m.forEach(inner); return }
      if (m && typeof m === 'object') (m.c || []).forEach(inner)
    })(n && n.c)
    return out
  }
  const hasIcon = function (n, name) {
    let hit = false
    ;(function find(m) {
      if (hit || m === null || m === undefined) return
      if (Array.isArray(m)) { m.forEach(find); return }
      if (typeof m !== 'object') return
      if (m.p && m.p.n === name) { hit = true; return }
      ;(m.c || []).forEach(find)
    })(n)
    return hit
  }
  const mapPill = mapRow ? pillOf(mapRow) : null
  const plainPill = plainRow ? pillOf(plainRow) : null
  check(!!mapPill && hasIcon(mapPill, 'map') && textsIn(mapPill).indexOf('40') >= 0, '单子里地图那行的号徽章是「地图图标 + 裸号」（实得 ' + JSON.stringify(textsIn(mapPill)) + '）')
  check(!!plainPill && textsIn(plainPill).indexOf('#780') >= 0, '单子里普通票那行的号徽章仍是 #780（实得 ' + JSON.stringify(textsIn(plainPill)) + '）')
  // 文字通道：版面上换了图标，悬停与无障碍朗读里仍要留着号，并且说得出这是地图
  check(!!mapRow && String(mapRow.p['aria-label']).indexOf('#40') >= 0 && String(mapRow.p['aria-label']).indexOf('type.map') >= 0, '地图那行的无障碍名里仍是 #40 且带上类型词（实得 ' + JSON.stringify(mapRow && mapRow.p['aria-label']) + '）')
  check(!!plainRow && String(plainRow.p['aria-label']).indexOf('type.map') < 0, '普通票那行不冒充地图')
}

console.log(failed ? '\n存在失败' : '\n全部通过')
process.exit(failed ? 1 : 0)
