// views/versionControl/vcInView.js —— 「还能显示更多」那几处什么时候接着显示（#997 新增）
// 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回 src/client/index.js 的 leaf 标记处（一源两物）。
//
// 为什么单独一份：本页有三处「还能显示更多」——改动页每个文件分组一句、工作树页一句、提交历史页一句。
//   入口组件（VersionControlTab.js）贴着 350 行上限（tests/verify-file-granularity.js），塞不下第三段观察器；
//   而三处各写一套必然漂移（#997 之前就是两套：提交历史用 IntersectionObserver，工作树页只能点）。
//
// 规则只有一条：**这句话在视野里、而且还有没显示出来的，就接着显示下一批**；显示完再判一次，
//   直到它离开视野或没有更多。首屏就看得见它，是这条规则的特例，不为它单开一支。
//
// 两条不许踩的线：
//   1) 一个定时器都不加（#709 的不变量）：进入视野是浏览器推给我们的事件，不轮询、不排一次性回调。
//   2) 不许靠「副作用依赖抖动重建观察器」做级联 —— 提交历史页原来那段就是这么写的，而新观察器一定会为
//      看得见的节点投递一次初始回调，于是读取失败时也一轮一轮地重发宿主调用（失败 → 依赖变 → 重建 →
//      初始回调说「还看得见」 → 再发一枪）。这里改成显式：画完一批之后在**渲染落地之后**（布局效果里）
//      重新观察一次，让它自己再报一次当前状态；报回来先过一遍纯判定，失败态与「没有更多」都停住。
//
// 取值口径：`hasMore` 是「还有没有没显示出来的」这一个布尔（改动页那句句子里要写数字，但规则层不需要数字）；
//   提交历史那处是真去读更早的提交，「还有没有」在第一次读数回来之前是**未知**的 —— 未知按「有」处理
//   （原来那段就是这样触发的），由宿主回的 hasMore 收口。注意 vcData 的 vcReadStatus 不写 log.hasMore，
//   所以不能拿初始那份 false 当「没有了」。

/** 这一步该不该接着显示下一批：'draw' 画、'wait' 等上一批落地、'stop' 不再自动显示。 */
export const vcMoreStepOf = function (s) {
  if (s && s.failed === true) return 'stop'
  if (!s || s.hasMore !== true) return 'stop'
  if (s.pending === true) return 'wait'
  return 'draw'
}

/**
 * 从块清单与读数里抽出各处「还有没有没显示的」。键就是界面上的落点：
 *   staged / conflict / unstaged —— 改动页三个文件分组；other —— 工作树页；commits —— 提交历史页。
 * 块没被画出来（比如那个分组是空的、或者这会儿在别的视图里）就没有对应的键，也就不会被触发。
 */
export const vcMoreStateOf = function (blocks, reads) {
  const out = {}
  const list = Array.isArray(blocks) ? blocks : []
  const log = (reads && reads.log) || {}
  list.forEach(function (b) {
    if (!b) return
    if (b.kind === 'changes' && Array.isArray(b.groups)) {
      b.groups.forEach(function (g) {
        if (g && g.key) out[String(g.key)] = { hasMore: (Number(g.moreCount) || 0) > 0 }
      })
      return
    }
    if (b.kind === 'other') { out.other = { hasMore: (Number(b.moreCount) || 0) > 0 }; return }
    if (b.kind === 'commits') {
      // 第一次读数回来之前按「还有」处理（见文件头那条口径）；'ok' 用它回的 hasMore 收口；
      //   'err' 是失败态 —— 不自己重试，交给那一句失败提示与它的重试按钮。
      out.commits = { hasMore: log.state === 'ok' ? log.hasMore !== false : true, failed: log.state === 'err' }
    }
  })
  return out
}

/**
 * 再显示一批：改动页三个分组与工作树页都是「把已经取回来的行多画一批」——本地动作，不发任何取数。
 * 用函数式更新（与 #853 换视图那处同一写法）：同期别的 setUi 不会被这一笔顶掉。
 */
export const vcMoreShownOf = function (setUi, key) {
  setUi(function (cur) {
    const t0 = (cur && cur.fileShown) || {}
    const n = Math.floor(Number(t0[key]))
    const shown = (isFinite(n) && n > 0) ? n : VC_FILE_ROWS_FIRST
    const next = Object.assign({}, t0)
    next[key] = shown + VC_FILE_ROWS_BATCH
    return Object.assign({}, cur, { fileShown: next })
  })
}

/**
 * 接线：调用方交上来「某处还有没有」（stateOf）与「画一批」（draw），拿回去一个按落点取 callback ref 的函数，
 * 把它挂到那句提示的节点上（ref: refOf('unstaged') 这样）。
 *   - 进入视野（含首屏时本来就在视野里）就按纯判定走一次；
 *   - 画过东西就在渲染落地之后重新观察一次 —— 长面板下这句话可能还在视野里，那就继续；
 *   - 画不动（没有更多、失败态、上一批还没落地）就什么都不做，也不重试。
 * callback ref 按落点缓存身份：每次渲染换一个新函数会让 React 反复 ref(null) / ref(el)，观察器就会被反复拆建。
 */
export const vcUseMoreSightOf = function (opts) {
  const nodesRef = React.useRef({})
  const iosRef = React.useRef({})
  const cbsRef = React.useRef({})
  const drawnRef = React.useRef(false)
  const optsRef = React.useRef(opts)
  optsRef.current = opts
  // 级联的显式写法（见文件头第 2 条）：布局效果在 DOM 更新之后同步跑，一定早于浏览器投递下一次观察结果，
  //   于是「上一批已经落地」由这里保证，而不是靠猜时序。
  React.useLayoutEffect(function () {
    if (drawnRef.current !== true) return
    drawnRef.current = false
    const ios = iosRef.current
    const nodes = nodesRef.current
    Object.keys(ios).forEach(function (k) {
      try { const io = ios[k]; const el = nodes[k]; if (io && el) { io.unobserve(el); io.observe(el) } } catch (e) { /* 忽略 */ }
    })
  })
  const bind = function (k, el) {
    try { if (iosRef.current[k]) iosRef.current[k].disconnect() } catch (e) { /* 忽略 */ }
    delete iosRef.current[k]
    nodesRef.current[k] = el || null
    // 渲染环境没有这个观察器时就不接线：那句提示照旧可以点（退路不变），只是不自动接着显示。
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(function (entries) {
      const e0 = entries[0]
      if (!e0 || e0.isIntersecting !== true) return
      const o = optsRef.current || {}
      const st = (typeof o.stateOf === 'function' ? o.stateOf(k) : null) || {}
      if (vcMoreStepOf({ hasMore: st.hasMore, failed: st.failed, pending: drawnRef.current }) !== 'draw') return
      const drew = (typeof o.draw === 'function') ? o.draw(k) : false
      if (drew !== false) drawnRef.current = true
    })
    io.observe(el)
    iosRef.current[k] = io
  }
  const refOf = function (k) {
    if (!cbsRef.current[k]) cbsRef.current[k] = function (el) { bind(k, el) }
    return cbsRef.current[k]
  }
  // 卸载时把观察器全断开（本页既有约定：不留下还在看的观察器，也不留定时器）。
  React.useEffect(function () {
    return function () {
      Object.keys(iosRef.current).forEach(function (k) { try { iosRef.current[k].disconnect() } catch (e) { /* 忽略 */ } })
      iosRef.current = {}
    }
  }, [])
  return { refOf: refOf }
}
