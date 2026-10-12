// views/SubworkspaceMark.js — 面板头部那一枚「当前目录属于工作区 X」的标志（#653 落地 #650 定的形态）
// 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回
// src/client/index.js 的 leaf 标记处（一源两物，标记 id 与本文件名一致）。
// 以后谁改它：改这枚标志的出现条件、浮层文案、点击行为，或改「第一次自动展开」那件事的人改它。
// 接线：Dock.js 面板头部在仓库芯片之后调用一次，参数 { st } 是本会话的 store。
//
// 形态（票 #650 定稿，位置 A · 做法 ③）：
//   面板头部仓库芯片右侧一枚 16 像素的图标（外框与左右两颗邻居按钮齐平 —— 定稿时写的是 18，见下面 #666 那一段），
//   不写字，全部信息放在悬浮浮层里；点一下打开工作区根目录。
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
//   这里不再另读「所选目录 → 工作区根」那张表：那张表是整个工作区共用的，别的会话学到的根会窜到本会话的
//   浮层里；快照里的根是本会话自己的。快照里没有工作区根时返回空串：认不出根就不出现，不猜、不谎报。
//   注意快照里那个值是**折算过的键**（小写、正斜杠），不能直接显示给用户看 —— 显示用的写法由下面的
//   subwsMarkRootShown 按会话原始目录还原。
//
// #1012 后续修复（2026-10-12）：这份「以前自动展开过没有」的记录搬到本机设置文件之后是**异步读来的**，
//   挂载那一刻文档往往还在路上。所以这一次判断必须先问 kernel/settings-view-state.js 的 viewFlagReadyNow()：
//   文档还在路上就先不弹，等它到手（或判定问不到）重跑再判。不这么等，就会拿旧 localStorage 键那一版答案
//   当场弹一次 —— 那个工作区每进一次子目录会话都白弹一次，#650 承诺的「同一个工作区只弹一次」就没了。
//   三档判决（等 / 弹 / 不弹）见下面的 subwsMarkAutoDecide，怎么重跑见下面那个订阅效果。
//
// 渲染之外的决定（取根、该不该出现、相对尾巴怎么拼、显示哪几行、显示成哪种写法）全在这几个纯函数里，
//   组件只负责画与点击。门禁既直接跑这几个纯函数，也把组件真的渲染一次（tests/verify-666-subws-mark-root.js
//   的 A～D 组跑纯函数，E 组渲染组件）—— 因为本票的缺陷是「纯函数全对、组件却每次都返回 null」，
//   只断纯函数拦不住它。
export const subwsMarkRootOf = function (st) {
  try {
    if (!st) return ''
    // ① 首选：面板正在显示的那份快照里的工作区根。它是显示用的原始数据源，也最权威。
    const fromSnap = (st.snapshot && st.snapshot.workspaceRoot) ? String(st.snapshot.workspaceRoot).trim() : ''
    if (fromSnap) return fromSnap
    // ② 退一步：wf.cwd 那条轻电话顺手带回来的工作区根（2026-09-19 加）。
    //   它存在的唯一理由是「早」—— 快照要等一整份仓库数据（缓存没命中时几十秒），这一条几百毫秒就有。
    //   于是面板一打开这枚标志就能出现，不必陪着快照一起等。
    //   ③ 两个都没有就返回空串：认不出根就不出现，不猜。这一条没变。
    return (st.sessionWorkspaceRoot) ? String(st.sessionWorkspaceRoot).trim() : ''
  } catch (e) { return '' }
}
// 显示用的工作区根：把宿主那份快照里的根，按本会话所选目录的写法还原出来。
//   为什么需要这一步：宿主放进快照的那个值是**折算过的键**（`canonicalWorkspaceKey`：Windows 上小写折叠、
//   反斜杠转正斜杠），于是直接拿它显示会说出「面板数据来自工作区 d:\ilife」—— 而 #650 定稿的文案是
//   `D:\ilife`，维护者看到的就是后者。客户端的 `st.cwd` 是会话原始目录（走 wf.cwd 拿的 header.cwd），
//   写法是用户自己的那一种，所以按它逐段还原；**比对该用键、显示该用原样**（与设置页工作区总览同一条规矩）。
//   比对仍然只用折算后的键，绝不按字符切目录名（`D:\ilife-other` 那种会切出残留片段）。
//   还原不出来（两侧根本不是同一条目录，或写法对不齐）就原样回退回那个键 —— 宁可与规格差一点，也不猜。
//   如实写明这条还原的边界（2026-10-12 按平台口径改准）：它靠「逐段拼回去」实现，而绝对路径开头那个
//   斜杠不是一段，所以 POSIX 上永远拼不回来（/home/u/p 拼出来是 home/u/p），那里交回的就是折算键；
//   盘符开头的 Windows 路径与它自己的 UNC 写法同样按段拼，UNC 开头那两个反斜杠也拼不回来。
//   这些情形下浮层里显示的是折算键 —— 它仍是一条人认得出的路径，不是一个散列。
export const subwsMarkRootShown = function (root, cwd) {
  try {
    const key = subwsMarkCmpKey(root)
    if (!key) return ''
    const segsOf = function (v) { return String(v || '').split(/[\\/]+/).filter(function (x) { return !!x }) }
    const cs = segsOf(cwd)
    const rs = segsOf(root)
    if (cs.length <= rs.length) return String(root)
    // 从根那一段往外逐段试着取（取几段就是几段，不去按字符切），谁折算出来的键等于根，谁就是它
    const sep = subwsMarkSepOf()
    for (let take = rs.length; take < cs.length; take++) {
      const cand = cs.slice(0, take).join(sep)
      if (subwsMarkCmpKey(cand) === key) return cand
    }
    return String(root)
  } catch (e) { return String(root == null ? '' : root) }
}
// 拼回可读写法时用哪个分隔符：按平台判，不按「这一条路径里有没有反斜杠」判（2026-10-12 改准）。
//   反斜杠在 POSIX 上也是合法的文件名字符（/home/u/a\b 就是一个目录名），拿它当「这台机器是 Windows」
//   的证据会判错平台。平台的真源是 src/shared/workspaceKey.js 的 currentOs()，与 keyOf 判平台同一处口径；
//   这一组纯函数会被单独求值出来喂给门禁（参数表只有 keyOf 与 tr），拿不到 currentOs 时退回进程平台，
//   再拿不到就按 POSIX 拼 —— 与 currentOs() 认不出平台时给的默认值一致，不另立一套默认。
export const subwsMarkSepOf = function () {
  try { if (typeof currentOs === 'function') return (currentOs() === 'win32') ? '\\' : '/' } catch (e) {}
  try { if (typeof process !== 'undefined' && process && process.platform) return (process.platform === 'win32') ? '\\' : '/' } catch (e1) {}
  return '/'
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
//   必须按「一段目录」比，不能按「一串字符」比：`D:\ilife-other` 与 `D:\ilife2` 的前几个字符
//   恰好是根的写法，按字符串前缀切会把它们切成 `-other` / `2` 这种看不出所以然的东西。
//   所以逐段走出去，只有整段对得上才算「在根下面」；对不上（不是子目录、或大小写与斜杠写法不同
//   导致切成两段不好对齐）就整段列出，别切。
export const subwsMarkRelOf = function (root, cwd) {
  try {
    const segsOf = function (v) {
      return String(v || '').split(/[\\/]+/).map(function (x) { return x.trim() }).filter(function (x) { return !!x })
    }
    const rs = segsOf(root)
    const cs = segsOf(cwd)
    // 先按原样逐段比；对不上再用同一把规整钥匙逐段比（大小写、斜杠写法不同也算同一条目录）
    const sameSeg = function (a, b) { return a === b || subwsMarkCmpKey(a) === subwsMarkCmpKey(b) }
    let under = rs.length > 0 && cs.length > rs.length
    for (let i = 0; under && i < rs.length; i++) under = sameSeg(rs[i], cs[i])
    if (!under) return cs.join(' › ')
    return cs.slice(rs.length).join(' › ')
  } catch (e) { return '' }
}
// 该显示哪几行（空数组＝这枚标志不出现）。四行文案存在 locale 的一个键里、用 \n 分行；
//   取出来先拆行，再把 {root} / {rel} 填上；第四行「{root}还未初始化」只在确实知道根还没初始化时（false）才留。
export const subwsMarkLinesOf = function (root, cwd, rootInitialized) {
  try {
    if (!subwsMarkShows(root, cwd)) return []
    const rel = subwsMarkRelOf(root, cwd)
    const shownRoot = subwsMarkRootShown(root, cwd)
    const parts = String(tr('panel.wsMarkTip')).split('\n').map(function (s) {
      return s.replace(/\{root\}/g, String(shownRoot)).replace(/\{rel\}/g, String(rel))
    })
    return (rootInitialized === false) ? parts : parts.slice(0, 3)
  } catch (e) { return [] }
}
// 该不该自动展开这一次浮层？三选一，'wait'（等）必须与 'skip'（不弹）分开 —— 这两件事在界面上完全不同：
//   'wait' ＝ 设置文档还在路上，这一次先不弹，等它到手（或判定问不到）之后重跑再判；
//   'skip' ＝ 问过真源了，这个工作区以前自动展开过，不再打扰；
//   'open' ＝ 问过真源了，以前没展开过，弹这一次。
// 为什么必须有 'wait' 这一档：文档是异步读来的，挂载那一刻往往还没到手，那时读口只能按旧 localStorage
//   键答（旧键是兜底），拿这个答案去弹就成了「每进一次子目录会话都白弹一次」—— #650 要的是同一个工作区只弹一次。
// 「问过真源了没有」由调用方去问 kernel/settings-view-state.js 的 viewFlagReadyNow() 再传进来，本函数自己不去问：
//   这样它是纯函数，门禁可以直接喂它几组输入把三档判决钉住，不必渲染 React。
export const subwsMarkAutoDecide = function (ready, shownBefore) {
  if (ready !== true) return 'wait'
  return (shownBefore === true) ? 'skip' : 'open'
}
// 「这个工作区以前自动展开过没有」这道判断的纯函数形态（门禁从真源里切出来验，见 tests/verify-settings-view.js）：
//   设置视图答得出这一格（文件里查得到这个工作区这一条记录，或按会话目录认得出的根那一格）就以它为准 ——
//   搬进文件之后它是唯一真源；它答不出（认不出根、文档读失败、文件是更高版本）时才看旧表那一份。旧表按
//   工作区根记，而本组件自己认得出根（subwsMarkRootOf 那一路），迁移前正是靠旧表判的；不这么退一步，
//   这个工作区就会在每次挂载时白弹一次浮层 —— 与 #650 承诺的「同一个工作区只自动展开一次」正好相反。
export const subwsMarkShownBefore = function (docAnswer, docCanAnswer, legacyShown) {
  if (docCanAnswer === true) return docAnswer === true
  return legacyShown === true
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
  //   下面 chainStepOk 这个写法与 probe-chain.js 里那个同名谓词同口径（链那一步的状态是不是 done）；
  //   区别只在「那一步根本不存在」时两者怎么办：内核那边算没通过，这里返回「不知道」而不当没通过 ——
  //   链还没加载就在已经初始化好的仓库里多报一句「还未初始化」太吓人，宁可少说一句。
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
  //   #1012 起这份状态的真源是本机设置文件（kernel/settings-view.js 的 viewFlagOf / setViewFlag，
  //   键取工作区根的可读路径），下面这两个函数只是过渡：新模块不在（老产物、或渲染替身里）、
  //   或它接不下这一笔（还没认出工作区根、文档问不到、文件只读）时才用。
  //   说准这一手兜得住什么：设置文件里已经有这个工作区的记录时，写进旧键这一份读不回来
  //   （读侧以文件里那条为准），它只在本窗口内充当记性；真正让这次改动不丢的是新模块的待写队列
  //   （写失败时留着那一格，下一趟写再试一次）。
  const AUTO_KEY = 'dsws.subwsAutoShown'
  const readAutoMap = function () {
    try { const raw = localStorage.getItem(AUTO_KEY); const m = raw ? JSON.parse(raw) : null; return (m && typeof m === 'object') ? m : {} } catch (e) { return {} }
  }
  // 这个工作区以前自动展开过没有：先问新模块；它认不出这个工作区的根（或这一片不在）时读旧键兜底
  //   （旧键按工作区根那把折算键记）。判断本身在纯函数 subwsMarkShownBefore 里，这里只负责把三样东西凑齐。
  //   同一次调用有两种含义：文档还在路上时它只能按旧表答，那一次调用真正的作用是把「读一次设置文档」
  //   这件事叫起来，答出来的值不作数；要等 viewFlagReadyNow() 说就绪了，再拿它下判断（见下面那个效果）。
  const autoShownBefore = function () {
    let docAnswer = false
    let docCanAnswer = false
    try {
      if (typeof viewFlagOfRoot === 'function') {
        // 按本组件手上这个根读（2026-10-12 复核 Q2）：这一格的状态是「按工作区记」的，而内核那把
        //   「所选目录 → 工作区根」的表是快照缓存，同一条目录的根变过时它可能还留着旧条目 —— 视图认出的
        //   就是另一个根，于是同一份记录读在一把键上、写在另一把键上：文件里明明记过，判据却认为
        //   「问不出这一格」，退回空的旧表，用户每开一次窗就白弹一次（搬迁前只弹一次，这是比搬迁前差）。
        //   本组件自己认得出根（subwsMarkRootOf 那一路），读写都按这把根走，两边就是同一把键。
        //   known 的含义：文件里查得到这个工作区这一条记录 —— 查得到就以它为准（文件是唯一真源）；
        //   查不到（文件还没建、这一条还没写过、读失败、更高版本）才退回旧表那一份。
        const ans = viewFlagOfRoot(root, 'subwsMarkAutoShown')
        docAnswer = !!(ans && ans.value === true)
        docCanAnswer = !!(ans && ans.known === true)
      } else if (typeof viewFlagOf === 'function') {
        // 老产物（或渲染替身）没有按根读的口子：退回原来的会话目录路，判据仍要求「视图认出的根与本组件
        //   手上这个根是同一条目录」；两边认的不是同一个根就退回旧表那一份。
        docAnswer = viewFlagOf(cwd, 'subwsMarkAutoShown') === true
        docCanAnswer = (typeof viewFlagWriteKeyOf === 'function')
          ? (subwsMarkCmpKey(viewFlagWriteKeyOf(cwd)) === subwsMarkCmpKey(root))
          : true
      }
    } catch (eN) {}
    let legacyShown = false
    try { legacyShown = !!readAutoMap()[subwsMarkCmpKey(root)] } catch (e) {}
    return subwsMarkShownBefore(docAnswer, docCanAnswer, legacyShown)
  }
  const [autoOpen, setAutoOpen] = React.useState(false)
  const [autoDone, setAutoDone] = React.useState(false)
  // 「设置文档问完了没有」这件事推动的计数：文档到手、或判定问不到时加一，下面那个自动展开效果依赖它重跑一次。
  //   没有它，挂载那一刻文档还在路上，判断就永远停在旧 localStorage 键那一版上，再也不会按真源重判。
  const [flagTick, setFlagTick] = React.useState(0)
  // 只挂一次的效果：登记「问完了叫我一声」，卸载时取消登记。找不到那个口子（老产物、渲染替身里没有这一片）
  //   就不登记，下面那个效果按「这道门不存在」照旧判断（那时读口本来也只有旧表那一条路）。
  React.useEffect(function () {
    try {
      if (typeof viewFlagSubscribe === 'function') {
        return viewFlagSubscribe(function () { setFlagTick(function (n) { return n + 1 }) })
      }
    } catch (e) {}
    return undefined
  }, [])
  React.useEffect(function () {
    if (!isSub || !root) return
    try {
      // 先问一句「以前自动展开过没有」：这一次问话顺手把设置文档读起来（第一次用到时才问宿主一次）。
      const shownBefore = autoShownBefore()
      // 读口在不在（老产物、渲染替身）决定「就绪这道门有没有」：没有就当作已经问过真源，照旧判断。
      const ready = (typeof viewFlagReadyNow === 'function') ? (viewFlagReadyNow() === true) : true
      const verdict = subwsMarkAutoDecide(ready, shownBefore)
      if (verdict === 'wait') return // 文档还在路上：这一次先不弹，等加载结束重跑再判
      if (verdict === 'skip') { setAutoDone(true); return } // 这个工作区已经自动展开过，不再打扰
      setAutoOpen(true)
    } catch (e) {}
  }, [isSub, root, flagTick])
  const markAutoShown = function () {
    // 交给新模块写，而且按本组件手上这个根写（与上面读的那把键同一把，见 autoShownBefore 的说明）：
    // 它接下了就不再写旧键（写成功那条路上一个字都不写旧键）；它接不下（还没认出工作区根、文档问不到、
    // 文件只读）或不在时，才照老办法写旧键 —— 与搬迁前的行为一致，只是这一次暂时不落新家。
    // 第四个参数是会话目录，只用来在文件里新建这条记录时从旧表种上另外那几格（见 kernel/settings-view.js
    // 的 viewFlagSetInDoc）：横幅折叠那一格按会话目录记，不传它就种不准。
    let handled = false
    try { if (typeof setViewFlagRoot === 'function') handled = (setViewFlagRoot(root, 'subwsMarkAutoShown', true, cwd) === true) } catch (eRoot) { handled = false }
    if (!handled) {
      try { if (typeof setViewFlag === 'function') handled = (setViewFlag(cwd, 'subwsMarkAutoShown', true) === true) } catch (eNew) { handled = false }
    }
    if (!handled) {
      try {
        const m = readAutoMap()
        m[subwsMarkCmpKey(root)] = 1
        localStorage.setItem(AUTO_KEY, JSON.stringify(m))
      } catch (e) {}
    }
    setAutoOpen(false)
    setAutoDone(true)
  }
  if (!isSub) return null
  const aria = shown.join('；')
  // 显示与点击都用还原过写法的那一条：浮层里写着「点一下打开 D:\ilife」，点下去就不该打开另一条写法
  const shownRoot = subwsMarkRootShown(root, cwd)
  const dim = { fontSize: 11, lineHeight: '16px', whiteSpace: 'normal', wordBreak: 'break-word' }
  // 渲染时，最后一行是那条「还没初始化」的提醒，用琥珀色；其余灰色。
  const tipContent = h('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } }, shown.map(function (s, i) {
    const isWarn = (!inited && i === shown.length - 1)
    return h('div', { key: 'l' + i, style: Object.assign({}, dim, { color: (i === 0 ? '#e6edf3' : (isWarn ? '#f59e0b' : '#8b8b95')) }) }, s)
  }))
  // 图形颜色写死成与边框同一个红 #f85149（2026-09-19 维护者定）：原先用的是 currentColor，
  //   跟着所在那一行的字色走 —— 头部那行字色是浅色的，于是画出来是个橙色文件夹配一个红边框，两截颜色。
  //   写死之后框与图形是同一个红，不随外层字色漂移。
  const MARK_RED = '#f85149'
  const iconSvg = h('svg', { key: 'icon', viewBox: '0 0 16 16', width: 13, height: 13, fill: 'none', stroke: MARK_RED, strokeWidth: 1.3, strokeLinejoin: 'round', strokeLinecap: 'round' }, [
    h('path', { key: 'folder', d: 'M1.9 5.2A1.3 1.3 0 0 1 3.2 3.9h2.3l1.1 1.3h4.3a1.3 1.3 0 0 1 1.3 1.3v4.3a1.3 1.3 0 0 1-1.3 1.3H3.2a1.3 1.3 0 0 1-1.3-1.3z' }),
    h('rect', { key: 'block', x: 8.1, y: 7.4, width: 3.9, height: 3.9, rx: 1.1, fill: MARK_RED, stroke: 'none' }),
  ])
  // 下面几处把子元素写成数组（iconSvg 里面的 [path, rect]、[iconSvg]、[span]），数组里每个元素都要带 key：
  //   React 19 对「当子元素传进来的数组」逐个要 key，**哪怕数组里只有一个元素**，缺了就在控制台留一行警告。
  //   这里原先都没带，是这枚标志自带的开发期噪音（不影响画出来的样子，但会多一行查问题时要跳过的东西）。
  const body = h('a', {
    href: 'javascript:void(0)',
    'data-subws-mark-link': 1,
    'aria-label': aria,
    style: { display: 'inline-flex', alignItems: 'center', textDecoration: 'none', flex: 'none' },
    onClick: function (e) {
      try { if (e && e.preventDefault) e.preventDefault() } catch (_) {}
      try { if (typeof host !== 'undefined' && host.call) host.call('wf.openFolder', { cwd: shownRoot }) } catch (__) {}
    },
  }, [
    h('span', {
      key: 'icon',
      'data-subws-mark': 1,
      role: 'img',
      // 外框尺寸必须与面板头部左右两颗邻居按钮逐字一致，三颗的规格只有一份：
      //   **外框 16×16、圆角 4、1 像素描边、box-sizing: border-box**。
      //   2026-09-24 更正（这条注释原先算错了一道算术）：本站默认 box-sizing 是 content-box，
      //   「width/height 16 + 1 像素边框」在 content-box 下算出来的外框是 **16 + 1 + 1 = 18×18**，
      //   不是 16×16。此前这里照着「邻居外框是 16」把本枚标志设成 16×16，而邻居们实际画的是 18×18 ——
      //   于是红色这颗比左右两颗各小 2 像素，同一排里看着不齐（维护者 2026-09-24 按截图指出）。
      //   现在统一成 border-box 16×16：本枚本来就是 16，另两颗补上 box-sizing 后跟着收到 16。
      //   圆角也统一成 4（本枚此前是 5）。
      //
      // 底色与边框（维护者 2026-09-19 在真机上定，尺寸之外不变）：
      //   底色**纯透明**，不用那层淡紫 rgba(192,132,252,.07)（叠在深色底上泛粉紫，同排颜色不统一）；
      //   边框用本仓的红色档 #f85149，与右边蓝色那颗「切换后端」、木色那颗「标签配色」在颜色上区分开。
      style: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box', width: 16, height: 16, borderRadius: 4, border: '1px solid ' + MARK_RED, background: 'transparent', cursor: 'pointer', flex: 'none' },
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
