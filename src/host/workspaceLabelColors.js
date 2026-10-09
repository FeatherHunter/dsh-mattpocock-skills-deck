// src/host/workspaceLabelColors.js —— 标签配色两条电话的处理体：wf.listLabels / wf.setLabelColors（#627 契约，#957 拆分）
//
// 为什么单独成一个文件：src/host/workspaceCwd.js 已经贴着文件粒度门禁的 350 行上限（正好 350 行），
// 工作区配置文件落盘（#957 首绑人选与保护自动两写）要长进绑定那一侧就放不下了。照仓库惯例（#500 把电话体搬到
// logPhones.js、#548 把读取器拆到 updateReader.js、#821 把差异电话搬到 versionControlFiles.js）把两条电话体搬成
// 一个自包含叶子，父文件只留一行动态加载器。归一（normCwd）、上下文组装（opCtxFor）、会话政策（resolveSandboxPolicy）
// 全由父文件显式传入，所以整个仓库仍然只有一条归一与一条政策算法；本文件不引用父文件（单向引用）。
//
// 两条电话的第一步都要把工作区路径归一、第二步都要按工作区问出当前后端。归一与选择由父文件传进来，就地转交
// 选中的后端即可，不必让别的文件再走一遍这两步（同层互引门禁也不许新开的文件之间互相引用）。
/** 造两条标签配色电话的处理体。依赖全部由父文件 createWorkspaceCwd 显式传入，本文件不自取任何环境。 */
export function createWorkspaceLabelColors(deps) {
  const { normCwd, getTrackerRegistry, getPlatform, ctx, opCtxFor, resolveSandboxPolicy } = deps
  // ============ 标签配色两条电话（#627 契约票）============
  // 「列出标签与颜色」与「批量改色」两个契约操作，界面经下面两条电话调到。
  // 为什么曾住在绑定文件、现搬成叶子：两条电话的第一步都要把工作区路径归一、第二步都要按工作区问出当前后端。归一（normCwd）与上下文（opCtxFor、政策）由父文件显式传进来，就地转交选中的后端即可，
  //   不必让别的文件再走一遍这两步（同层互引门禁也不许新开的文件之间互相引用）。
  // 交给后端的「本次调用上下文」（契约 OpContext）：工作区、平台、沙箱 fs、本次调用的中止信号、 本次用的记录器、起外部程序的执行器（房内 gh/glab 命令走它，每次调用落一条 exec.run 日志），
  //   以及可中断的定时器。
  // 为什么必须带 signal（不能省）：契约的 OpContext 就写着这一项，而后端真的会读它 —— GitHub 后端调外部命令时用 `opts.signal || ctx.signal` 当超时中止信号，GitLab 后端发起鉴权预检时
  //   也要 `ctx.signal` 才能被中断。少了这一项，这两条电话调后端时那些命令就没有中止信号可用。
  // 传同一个 signal 给两步（先是问当前后端，再把上下文交给后端执行）是为了两次调用一致。
  // 失败怎么分档（用户看到的文案随之不同，所以口径要死）：
  //   后端发现自己做不了 / 没登录 / 限速 / 标签不存在 → 后端自己如实给的档，这里原样透传；
  //   真正的连不通与超时 → network，也是后端给的，宿主不自己造 network；
  //   后端回的形状不符合契约、后端抛异常、宿主自己出错 → env，文案必须说清「这是插件这边的问题，
  //     不是你操作错了」；
  //   没选定后端 / 多个后端同时命中 / 身份识别还没定下来 → conflict，让用户先选定后端再试。
  // 两条电话的日志 kind 与交给后端执行器用的 via 统一写成 'label-colors'（同一件事只有一个叫法）。
  // 两条电话共用的第一步：把工作区解析成「当前后端 + 它的仓库引用 + 它的适配器」。
  //   失败一律返回 {ok:false, error:{kind, message}}（失败返回而非抛，与契约同款）。
  //   选择结果里除了 backendId，还有三样必须看的东西（注册表算好的，出处见 registryCore.js 的 select）：
  //     ref      注册表算好的仓库引用（后端 describe 的产物）—— 能拿到就用它，不自己重算；
  //     multiHit 多个后端同时对应这个工作区（仲裁还没定下来）；
  //     pending  有后端的身份识别超时未决。
  //   「用哪个后端」这件事由客户端说了算，宿主只核验（#631 起）：客户端可以带着「它面板上现在用的是哪个
  //   后端」来问（args.backendId，见下面 declared 那一段）。带了时，这个名字在本次算出来的候选名单里、
  //   且这次没有待定的身份识别，就交给它；核验不过（名字不在名单里，或者身份识别还是待定）就照旧走下面
  //   那条诚实的 conflict 失败，绝不退回「宿主自己挑一个」。
  //   核验通过为什么就算数：客户端说的不是它随手挑的一个，而是宿主上一次算出来、正显示在面板正文里的那一个。
  //   客户端没带这个名字时，仍按注册表这次算出来的那一个走；「没选定 / 多命中 / 待定」这三种仍然明确失败
  //   （conflict 档），让用户先选定后端再试——绝不许静默挑一个「匹配的赢家」，那可能把颜色改到另一个仓库上去。
  const UNDECIDED = '这个工作区使用哪个后端尚未确定：请在面板中选定这个工作区使用的后端，然后重试'
  /** 「选中的后端在注册表里找不到」这一档（env）：声明的与注册表算出来的是同一句，措辞只此一处。 */
  const unknownBackend = function (id) {
    return { ok: false, error: { kind: 'env', message: '列出标签与修改标签颜色时插件运行出错：已选定的后端「' + id + '」不在当前可用的后端清单里。这是插件运行环境的问题，不是你的操作有误。' } }
  }
  /**
   * 这次注册表算出来的「认得这个工作区的后端」名单（注册表算好的，出处见 registryCore.js 的 select）：
   *   多个同时命中时有 multiHit 那份名单；只命中一个（或用户显式绑定了一个）时就是 backendId 那一个；
   *   一个都没有（显式选了「无后端」，或者没有任何后端说自己认得）时是空名单。
   * 这份名单只从注册表的回包里读，本函数不自己另做判定。
   */
  function candidatesOf(sel) {
    if (sel && Array.isArray(sel.multiHit) && sel.multiHit.length > 1) return sel.multiHit
    return (sel && sel.backendId) ? [sel.backendId] : []
  }
  async function pickBackend(cwd, caller, signal, declared) {
    const reg = await getTrackerRegistry()
    if (!reg) return { ok: false, error: { kind: 'env', message: '插件尚未就绪：还没有可用的后端清单，请稍后重试。这是插件运行环境的问题，不是你的操作有误。' } }
    const platform = await getPlatform()
    const sel = await reg.select({ cwd: cwd }, { cwd: cwd, platform: platform, fs: ctx.get('fs'), caller: caller, signal: signal })
    // 客户端显式声明了它面板上正在用的那个后端 → **核验**它确实在这次算出来的名单里，是就直接交给它。
    //   核验不通过的两种情况，一律照下面那条诚实的失败办（绝不退回「宿主自己挑一个」）：
    //     · 身份识别还没出结果（pending）——这时名单里的那个名字只是注册序的暂时赢家，还没定下来；
    //     · 声明的那个不在名单里（从没听说过的 id，或者这个工作区根本不是它认得的地方）。
    //   为什么核验通过就可以直接用：客户端声明的不是它随便挑的一个，而是宿主上一次算出来、
    //   现在正显示在面板正文里的那一个（取法见客户端 labelColorErrors.js 的 lcPanelBackendOf）；
    //   用户是在看着那个后端的标签点开改色弹窗的，按它改才是用户以为的那件事。
    const want = String(declared || '')
    if (want !== '' && !(sel && sel.pending) && candidatesOf(sel).indexOf(want) >= 0) {
      const trackerWant = reg.get(want)
      if (!trackerWant) return unknownBackend(want)
      let refWant = null
      try { refWant = reg.describe({ cwd: cwd }, want) } catch (e) { refWant = { backend: want, refId: '', name: '', url: '' } }
      return { ok: true, backendId: want, repoRef: refWant, tracker: trackerWant, platform: platform }
    }
    if (sel && Array.isArray(sel.multiHit) && sel.multiHit.length > 1) {
      // 只对用户说两件确定的事：同时对应的个数（用户能对上自己装了几个后端）、以及去面板中选定。
      //   **不列后端 id**：用户看不到 `github` / `gitlab` 这类内部名字，列出来只会让人去猜哪颗按钮对应哪一行。
      return { ok: false, error: { kind: 'conflict', message: UNDECIDED + '（当前有 ' + sel.multiHit.length + ' 个后端同时对应这个工作区，插件无法自己定下来用哪一个。请在面板中选定这个工作区使用的后端，然后重试）' } }
    }
    const backendId = sel && sel.backendId
    if (!backendId) {
      // 走到这里 = 这一轮没有后端被定下来：select ① 用户自己选了「无后端」（backendId 为 null），或 ③ 一轮
      //   识别下来没有后端认这个工作区；两档分别是「已决」与「还有待定（pending）」。
      //   都不是「这台机器上没有后端」，用户要做的动作也一样（在面板里为这个工作区选定后端），
      //   所以两句都只说：现在是什么状态、你接下来做什么。「识别」用的是客户端同一档词条
      //   （locale-labels.js 的 lc.errWaitBackend）的说法，两边读到的是同一件事；待定时不带后端名字：
      //   那时名单里的名字只是注册序的暂时赢家，还没定下来。（下面那条 :280 是 ② 命中但同轮仍有待定。）
      return { ok: false, error: { kind: 'conflict', message: UNDECIDED + (sel && sel.pending ? '（后端尚未识别完成，请等识别完成后再重试）' : '（这个工作区尚未选定后端，请在面板中选定这个工作区使用的后端，然后重试）') } }
    }
    if (sel && sel.pending) return { ok: false, error: { kind: 'conflict', message: UNDECIDED + '（后端尚未识别完成，请等识别完成后再重试）' } }
    const tracker = reg.get(backendId)
    if (!tracker) return unknownBackend(backendId)
    let repoRef = (sel && sel.ref) || null
    if (!repoRef) { try { repoRef = reg.describe({ cwd: cwd }, backendId) } catch (e) { repoRef = { backend: backendId, refId: '', name: '', url: '' } } }
    return { ok: true, backendId: backendId, repoRef: repoRef, tracker: tracker, platform: platform }
  }
  // 「插件这边的错」只有一种口径：后端回的形状不符合契约、后端抛异常、宿主自己出错，一律归 env（插件自身/环境问题），
  //   文案必须说清「这是插件这边的问题，不是你操作错了」，否则用户会去翻自己的操作找原因。
  //   network 只留给真正的连不通与超时：那是后端如实给出的，这里原样透传；宿主不自己造 network。
  // 「这一档发生在什么时刻」为什么必须说准（#633）：写标签那一档的 catch 兜的是 `await picked.tracker.setLabelColors(...)`
  //   这一句，异常抛出时请求**已经交给后端**——不能说「本次操作未生效」（替后端保证一个字没改），也不能说
  //   「后端在改色时抛出异常」（替它保证确实动过手）；只能说「没拿回结果、改动有没有发生没法确认」，并让用户先去看一眼。
  //   列标签那一档是读操作（没拿回结果 = 读没读成、颜色一个字节没动），`pickBackend` 那一档在交出去**之前**
  //   （那里才能说「没有动仓库里的任何东西」）。三处的话各有各的依据，不能互换。
  function pluginTrouble(opCn, why, detail) {
    return { ok: false, error: { kind: 'env', message: opCn + '时插件运行出错：' + why + (detail ? '（' + detail + '）' : '') + '。这是插件运行环境的问题，不是你的操作有误。' } }
  }
  function msgOf(e) { return String((e && e.message) || e) }
  // 后端说的失败原样交给客户端（是哪一档后端自己最清楚）；只有「连失败都没说清」才算插件这边的错。
  function backendFailure(res, opCn) {
    if (res && res.error && typeof res.error === 'object') return { ok: false, error: res.error }
    return pluginTrouble(opCn, '后端既未表示成功，也未说明失败原因')
  }
  // 列出这个后端能改色的全部标签及其颜色（契约操作 listLabels）。拿不到就说做不到，
  //   不在这里替后端兜底造数据（能力 = 运行时调用结果）。
  //   形状把关：后端回的 data 必须是一份清单（数组），否则算插件这边的错，不把坏形状漏给客户端。
  //   args.backendId（#631 追加，可缺）：客户端说它面板上现在用的是哪个后端；只做核验，不照单全收（见 pickBackend）。
  async function handleListLabels(args) {
    const cwd = await normCwd((args && args.cwd) || DEFAULT_CWD)
    const signal = new AbortController().signal
    let picked = null
    try { picked = await pickBackend(cwd, 'wf.listLabels', signal, args && args.backendId) } catch (e) { return pluginTrouble('修改标签颜色', '插件没能确定这个工作区使用哪个后端这一步出错（内部叫 pickBackend），所以没有动仓库里的任何东西。请重试一次；如果仍然失败，请把这条提示原文报告给插件维护者', msgOf(e)) }
    if (!picked.ok) return picked
    const sb = resolveSandboxPolicy(args, cwd)
    let res = null
    try { res = await picked.tracker.listLabels(picked.repoRef, opCtxFor(cwd, picked.platform, picked.repoRef, 'wf.listLabels', signal, sb.policy, sb.sessionId)) } catch (e) { return pluginTrouble('修改标签颜色', '插件没有拿回结果，因此无法确认这次读取有没有成功（也就不知道仓库里的标签现在是什么样）：请重试一次；如果仍然失败，请把这条提示原文报告给插件维护者', msgOf(e)) }
    if (!res || res.ok !== true) return backendFailure(res, '列出标签')
    if (!Array.isArray(res.data)) return pluginTrouble('列出标签', '后端返回的标签清单不符合约定格式（应为数组）', typeof res.data)
    return { ok: true, backendId: picked.backendId, labels: res.data }
  }
  // 批量改色（契约操作 setLabelColors）。逐条记账由后端给：这里原样透传 applied 与 failed，
  //   不把「部分成功」改写成整体成败——那正是界面在部分成功时唯一能说实话的依据。
  //   形状把关：两个名单缺一不可（缺了就是后端没按契约回话，算插件这边的错）；
  //   回包只发契约里约定的四个键（ok / backendId / applied / failed），后端多给的字段不往客户端漏。
  async function handleSetLabelColors(args) {
    const cwd = await normCwd((args && args.cwd) || DEFAULT_CWD)
    const changes = args && args.changes
    if (!Array.isArray(changes)) return { ok: false, error: { kind: 'parse', message: '修改标签颜色需要一份「标签 → 新颜色」的改动清单（内部把这个清单叫 changes），本次保存带上来的内容不是这种格式。请回到改色弹窗重新保存一次。' } }
    const signal = new AbortController().signal
    let picked = null
    try { picked = await pickBackend(cwd, 'wf.setLabelColors', signal, args && args.backendId) } catch (e) { return pluginTrouble('修改标签颜色', '插件没能确定这个工作区使用哪个后端这一步出错（内部叫 pickBackend），所以没有动仓库里的任何东西。请重试一次；如果仍然失败，请把这条提示原文报告给插件维护者', msgOf(e)) }
    if (!picked.ok) return picked
    const sb = resolveSandboxPolicy(args, cwd)
    let res = null
    try { res = await picked.tracker.setLabelColors(picked.repoRef, changes, opCtxFor(cwd, picked.platform, picked.repoRef, 'wf.setLabelColors', signal, sb.policy, sb.sessionId)) } catch (e) { return pluginTrouble('修改标签颜色', '插件没有拿回改动结果，所以仓库里的颜色有没有被改动、哪些被改动，现在都无从确认。请先看一眼标签现在的颜色（去仓库或面板里看一眼都行），再重试一次；如果仍然失败，请把这条提示原文报告给插件维护者', msgOf(e)) }
    if (!res || res.ok !== true) return backendFailure(res, '修改标签颜色')
    const data = res.data
    if (!data || typeof data !== 'object' || !Array.isArray(data.applied) || !Array.isArray(data.failed)) return pluginTrouble('修改标签颜色', '后端没有说清哪些标签的颜色改成功了、哪些没改成功（内部把这两份清单叫 applied 与 failed）。请重试一次；如果仍然失败，请把这条提示原文报告给插件维护者')
    return { ok: true, backendId: picked.backendId, applied: data.applied, failed: data.failed }
  }
  return { handleListLabels: handleListLabels, handleSetLabelColors: handleSetLabelColors }
}
