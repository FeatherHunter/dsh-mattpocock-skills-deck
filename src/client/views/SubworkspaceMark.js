// views/SubworkspaceMark.js — 面板头部那一枚「当前目录属于工作区 X」的标志（#653 落地 #650 定的形态）
// 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回
// src/client/index.js 的 leaf 标记处（一源两物，标记 id 与本文件名一致）。
// 以后谁改它：改这枚标志的出现条件、浮层文案、点击行为，或改「第一次自动展开」那件事的人改它。
// 接线：Dock.js 面板头部在仓库芯片之后调用一次，参数 { st } 是本会话的 store。
//
// 形态（票 #650 定稿，位置 A · 做法 ③）：
//   面板头部仓库芯片右侧一枚 18 像素的图标，不写字，全部信息放在悬浮浮层里；点一下打开工作区根目录。
//   浮层三行固定：结论（这份数据是谁的）→ 证据（当前目录是它的子目录）→ 动作（点一下打开哪）。
//   只有工作区根还没初始化时才补第四行。
// 三个必须一起落的东西（不然这枚没字的图标等于白放）：
//   ① 第一次在工作区的子目录会话里出现时自动展开一次浮层；用户关掉之后同一个工作区不再自动展开；
//   ② 图标带 aria-label（读屏用户没有「悬停」这个动作，浮层里的三句话合成一句念出来）；
//   ③ 点击打开工作区根目录（复用宿主已有的打开文件夹能力 wf.openFolder）。
//
// 用户可见之处一律说大白话（#649 定的措辞纪律）：界面上不出现「子工作区」「工作区根」这类内部术语，
// 只出现「面板数据来自工作区 …」「当前目录是它的子目录」这种人人看得懂的句子。
//
// #666 修正（2026-09-19）：这枚标志原先读会话状态上的 st.workspaceRoot，而客户端里没有任何地方给那个字段
//   赋过值，于是它自 #653 落地以来一次都没亮过（证据在票 #666）。现在**唯一来源**是面板正在显示的那份快照：
//   宿主从 #652 起在每份快照里带回工作区根（snapshot.workspaceRoot），面板分桶读的也是同一份快照。
//   这里不再另读「所选目录 → 工作区根」那张表：那张表存的是折算过的工作区键（大小写与分隔符都规整过），
//   拿它当显示路径会与「面板数据来自工作区 D:\ilife」这句话对不上；而且那张表是整个工作区共用的，
//   别的会话学到的根会窜到本会话的浮层里。快照里没有工作区根时返回空串：认不出根就不出现，不猜、不谎报。
//
// 渲染之外的决定（取根、该不该出现、相对尾巴怎么拼、显示哪几行）全在这几个纯函数里，组件只负责画与点击 ——
// 门禁因此能直接断言「该不该出现、出现时是哪几行」，不必去渲染一棵 React 树（tests/verify-666-subws-mark-root.js）。
export const subwsMarkRootOf = function (st) {
  try { return (st && st.snapshot && st.snapshot.workspaceRoot) ? String(st.snapshot.workspaceRoot).trim() : '' } catch (e) { return '' }
}
// 折算到同一把键再比较（大小写、分隔符写法不同也算同一条目录）。keyOf 是内核里那把规整函数的单源；
//   真闭包里拿不到它时退回原样比较 —— 两串本就同源同写法，结论仍然对，不会把子目录误判成根。
export const subwsMarkCmpKey = function (v) {
  try { return (typeof keyOf === 'function') ? String(keyOf(v)) : String(v == null ? '' : v) } catch (e) { return '' }
}
// 这枚标志该不该出现：所选目录与工作区根不是同一条目录时才出现。
//   根会话、嵌套仓库（子目录自带 .git，那时工作区根就是它自己）、无仓库目录都不满足这个条件。
export const subwsMarkShows = function (root, cwd) {
  return !!(root && cwd && subwsMarkCmpKey(root) !== subwsMarkCmpKey(cwd))
}
// 相对尾巴：所选目录去掉工作区根前缀的那一段，用 › 连接。绝不把反斜杠原样吐给用户。
export const subwsMarkRelOf = function (root, cwd) {
  try {
    const r = String(root || '').replace(/[\\/]+$/, '')
    let rest = String(cwd || '')
    if (rest.length > r.length && subwsMarkCmpKey(rest.slice(0, r.length)) === subwsMarkCmpKey(r)) rest = rest.slice(r.length)
    const segs = rest.split(/[\\/]+/).filter(function (x) { return !!x })
    return segs.join(' › ')
  } catch (e) { return '' }
}
// 该显示哪几行（空数组＝这枚标志不出现）。四行文案存在 locale 的一个键里、用 \n 分行；
//   取出来先拆行，再把 {root} / {rel} 填上；第四行「{root}还未初始化」只在确实知道根还没初始化时（false）才留。
export const subwsMarkLinesOf = function (root, cwd, rootInitialized) {
  try {
    if (!subwsMarkShows(root, cwd)) return []
    const rel = subwsMarkRelOf(root, cwd)
    const parts = String(tr('panel.wsMarkTip')).split('\n').map(function (s) {
      return s.replace(/\{root\}/g, String(root)).replace(/\{rel\}/g, String(rel))
    })
    return (rootInitialized === false) ? parts : parts.slice(0, 3)
  } catch (e) { return [] }
}
export const SubworkspaceMark = function (props) {
  const p = props || {}
  const st = p.st || null
  const root = subwsMarkRootOf(st)
  const cwd = (st && st.cwd) || ''
  // 「工作区根初始化了没有」——只回答确实知道的那一半，不知道时**不出**第四行：
  //   ① 检查链里那一步（tracker:initialized）求值完成：done 就是已初始化，current/fail 就是还没初始化；
  //      那一步还没跑（链还没加载）时它什么都不说，往下走第 ② 条；
  //   ② 快照里的后端选择是「读到根上的显式声明」（source 为 explicit）→ 根上确实有那份声明文件，算已初始化；
  //   两条都不知道（链还没跑、快照还没到）→ 视为「已初始化」，**不出**第四行。
  //   为什么这样收：链还没加载就直接当成「没初始化」，会在已经初始化好的仓库里多报一句吓人的话，
  //   而 #650 明确要的是「只有工作区根还没初始化时才出现」。拿不准时宁可少说一句，不多报一句。
  //   下面 chainStepOk 这个写法与 probe-chain.js 里那个同名谓词同口径（链那一步的状态是不是 done）。
  const chainStepOk = function (id) {
    try {
      if (typeof chainStep !== 'function') return null
      const s = chainStep(st, id)
      return (s && s.status) ? (s.status === 'done') : null
    } catch (e) { return null }
  }
  const rootIsInitialized = function () { return chainStepOk('tracker:initialized') !== false }
  const inited = rootIsInitialized()
  const shown = subwsMarkLinesOf(root, cwd, inited)
  const isSub = shown.length > 0
  // 「第一次自动展开」按工作区记一份状态：记在工作区根这把键上，同一个工作区只展开一次。
  const AUTO_KEY = 'dsws.subwsAutoShown'
  const readAutoMap = function () {
    try { const raw = localStorage.getItem(AUTO_KEY); const m = raw ? JSON.parse(raw) : null; return (m && typeof m === 'object') ? m : {} } catch (e) { return {} }
  }
  const [autoOpen, setAutoOpen] = React.useState(false)
  const [autoDone, setAutoDone] = React.useState(false)
  React.useEffect(function () {
    if (!isSub || !root) return
    try {
      const m = readAutoMap()
      if (m[subwsMarkCmpKey(root)]) { setAutoDone(true); return } // 这个工作区已经自动展开过，不再打扰
      setAutoOpen(true)
    } catch (e) {}
  }, [isSub, root])
  const markAutoShown = function () {
    try {
      const m = readAutoMap()
      m[subwsMarkCmpKey(root)] = 1
      localStorage.setItem(AUTO_KEY, JSON.stringify(m))
    } catch (e) {}
    setAutoOpen(false)
    setAutoDone(true)
  }
  if (!isSub) return null
  const aria = shown.join('；')
  const dim = { fontSize: 11, lineHeight: '16px', whiteSpace: 'normal', wordBreak: 'break-word' }
  // 渲染时，最后一行是那条「还没初始化」的提醒，用琥珀色；其余灰色。
  const tipContent = h('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } }, shown.map(function (s, i) {
    const isWarn = (!inited && i === shown.length - 1)
    return h('div', { key: 'l' + i, style: Object.assign({}, dim, { color: (i === 0 ? '#e6edf3' : (isWarn ? '#f59e0b' : '#8b8b95')) }) }, s)
  }))
  const iconSvg = h('svg', { viewBox: '0 0 16 16', width: 13, height: 13, fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinejoin: 'round', strokeLinecap: 'round' }, [
    h('path', { d: 'M1.9 5.2A1.3 1.3 0 0 1 3.2 3.9h2.3l1.1 1.3h4.3a1.3 1.3 0 0 1 1.3 1.3v4.3a1.3 1.3 0 0 1-1.3 1.3H3.2a1.3 1.3 0 0 1-1.3-1.3z' }),
    h('rect', { x: 8.1, y: 7.4, width: 3.9, height: 3.9, rx: 1.1, fill: 'currentColor', stroke: 'none' }),
  ])
  const body = h('a', {
    href: 'javascript:void(0)',
    'data-subws-mark-link': 1,
    'aria-label': aria,
    style: { display: 'inline-flex', alignItems: 'center', textDecoration: 'none', flex: 'none' },
    onClick: function (e) {
      try { if (e && e.preventDefault) e.preventDefault() } catch (_) {}
      try { if (typeof host !== 'undefined' && host.call) host.call('wf.openFolder', { cwd: root }) } catch (__) {}
    },
  }, [
    h('span', {
      'data-subws-mark': 1,
      role: 'img',
      style: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 18, height: 18, borderRadius: 5, border: '1px solid rgba(192,132,252,.38)', background: 'rgba(192,132,252,.07)', cursor: 'pointer', flex: 'none' },
    }, [iconSvg]),
  ])
  // 自动展开那一次用受控 visible；关掉（或本来就不再展开）之后交回 HoverTip 自己管（鼠标悬停照常出浮层）。
  const tipProps = { content: tipContent, children: body, mode: 'mouse' }
  if (autoOpen && !autoDone) {
    tipProps.visible = true
    tipProps.onVisibleChange = function (next) { if (!next) markAutoShown() }
  }
  return h(Tip, tipProps)
}
