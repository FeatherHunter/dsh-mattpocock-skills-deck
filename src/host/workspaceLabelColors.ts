/**
 * src/host/workspaceLabelColors.ts —— 标签配色两条电话的处理体：wf.listLabels / wf.setLabelColors（#627 契约，#957 拆分）。
 *
 * 来源与零变化：本文件由同目录 workspaceLabelColors.js 逐行转写而来，只加类型标注与注释，
 * 没有改任何运行时语义。原来的 .js 文件保留不动，引用方继续写 `./workspaceLabelColors.js`，
 * 由 scripts/ts-hook.mjs 在加载时改指到同名 .ts。
 *
 * 为什么单独成一个文件：src/host/workspaceCwd.js 已经贴着文件粒度门禁的 350 行上限（正好 350 行），
 * 工作区配置文件落盘（#957 首绑人选与保护自动两写）要长进绑定那一侧就放不下了。照仓库惯例（#500 把电话体搬到
 * logPhones.js、#548 把读取器拆到 updateReader.js、#821 把差异电话搬到 versionControlFiles.js）把两条电话体搬成
 * 一个自包含叶子，父文件只留一行动态加载器。归一（normCwd）、上下文组装（opCtxFor）、会话政策（resolveSandboxPolicy）
 * 全由父文件显式传入，所以整个仓库仍然只有一条归一与一条政策算法；本文件不引用父文件（单向引用）。
 *
 * 两条电话的第一步都要把工作区路径归一、第二步都要按工作区问出当前后端。归一与选择由父文件传进来，就地转交
 * 选中的后端即可，不必让别的文件再走一遍这两步（同层互引门禁也不许新开的文件之间互相引用）。
 *
 * 为什么这样标注：
 * 1. 相对导入说明符保留 `.js` 后缀，不改成 `.ts`，改了会绕过钩子的同名解析约定，所以不能动。
 *    本文件本来就没有运行时导入，只有父文件显式传入的能力，所以也没有新增 import 边的空间。
 * 2. 注册表、平台、上下文组装等能力的形状由调用方与契约决定，本文件只负责按约定调用，
 *    所以全部按 `any` 收，类型不替代运行时的能力检测。
 * 3. 中止信号沿用 DOM 自带的 AbortController，不需要 Node 类型声明；
 *    本域 tsconfig 有意不加载任何类型包，运行时一定有 AbortController。
 * 4. 没有新增任何 import 边：只给已有引用加类型，不引入新模块依赖。
 */

/** 父文件注入的依赖：归一、注册表、平台、上下文组装、政策与判定口都在这里，本文件不自取任何环境。 */
export interface WorkspaceLabelColorsDeps {
  normCwd: any
  getTrackerRegistry: any
  getPlatform: any
  opCtxFor: any
  resolveSandboxPolicy: any
  getDecisionFn: any
  getDetectionService: any
}

/** 造两条标签配色电话的处理体。依赖全部由父文件 createWorkspaceCwd 显式传入，本文件不自取任何环境。 */
export function createWorkspaceLabelColors(deps: any): { handleListLabels: (args: any) => Promise<any>; handleSetLabelColors: (args: any) => Promise<any> } {
  const { normCwd, getTrackerRegistry, getPlatform, opCtxFor, resolveSandboxPolicy, getDecisionFn, getDetectionService }: any = deps
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
  //   选择结果里除了 backendId，还有三样必须看的东西（注册表算好的，出处见 core.ts 的 select）：
  //     ref      注册表算好的仓库引用（后端 describe 的产物）—— 能用它就用它，不自己重算；
  //     multiHit 多个后端同时对应这个工作区（仲裁还没定下来）；
  //     pending  有后端的身份识别超时未决。
  //   「用哪个后端」这件事由客户端说了算，宿主只核验（#631 起）：客户端可以带着「它面板上现在用的是哪个
  //   后端」来问（args.backendId，见下面 declared 那一段）。带了时，这个名字在这次算出来的候选名单里、
  //   且这次没有待定的身份识别，就交给它；核验不过（名字不在名单里，或者身份识别还是待定）就照旧走下面
  //   那条诚实的 conflict 失败，绝不退回「宿主自己挑一个」。
  //   核验通过为什么就算数：客户端说的不是它随手挑的一个，而是宿主上一次算出来、现在显示在面板正文里的那一个。
  //   客户端没带这个名字时，仍按注册表这次算出来的那一个走；「没选定 / 多命中 / 待定」这三种仍然明确失败
  //   （conflict 档），让用户先选定后端再试——绝不许静默挑一个「匹配的赢家」，那可能把颜色改到另一个仓库上去。
  const UNDECIDED: string = '这个工作区使用哪个后端尚未确定：请在面板中选定这个工作区使用的后端，然后重试'
  /**
   * 写用途没凭据时的同一句话（#1003 契约期望行为第 4 条）：这一次的结论不是来自工作区里那份配置文件、
   * 也不是用户这次亲手绑定的（只是仓库说明文件或自动识别算出来的），所以一个字节都不许动外部世界。
   * 读用途（列标签）不查这一条：看票与展示可以用生成结果兜。
   */
  const notPickedYet = function (): any {
    return { ok: false, error: { kind: 'conflict', message: '这个工作区还没选定后端：现在这个结论是按仓库里的说明文件或自动识别得出的，不算你亲手选过，所以这一次没有改任何东西。请先在面板上选定这个工作区使用的后端，然后重试。' } }
  }
  /** 「选中的后端在注册表里找不到」这一档（env）：声明的与注册表算出来的是同一句，措辞只此一处。 */
  const unknownBackend = function (id: any): any {
    return { ok: false, error: { kind: 'env', message: '列出标签与修改标签颜色时插件运行出错：已选定的后端「' + id + '」不在当前可用的后端清单里。这是插件运行环境的问题，不是你的操作有误。' } }
  }
  /**
   * 这次注册表算出来的「认得这个工作区的后端」名单（注册表算好的，出处见 core.ts 的 select）：
   *   多个同时命中时有 multiHit 那份名单；只命中一个（或用户显式绑定了一个）时就是 backendId 那一个；
   *   一个都没有（显式选了「无后端」，或者没有任何后端说自己认得）时是空名单。
   * 这份名单只从注册表的回包里读，本函数不自己另做判定。
   */
  function candidatesOf(sel: any): any {
    if (sel && Array.isArray(sel.multiHit) && sel.multiHit.length > 1) return sel.multiHit
    return (sel && sel.backendId) ? [sel.backendId] : []
  }
  async function pickBackend(cwd: any, caller: any, signal: any, declared: any, needWritable?: any): Promise<any> {
    // #1003 空目录闸：还不知道工作区是哪条时，不探测、不起外部命令，直接说还没就绪。
    if (!cwd || String(cwd).trim() === '') {
      return { ok: false, error: { kind: 'conflict', message: UNDECIDED + '（这个工作区还没就绪，等面板认出工作区后再试）' } };
    }
    const reg: any = await getTrackerRegistry()
    if (!reg) return { ok: false, error: { kind: 'env', message: '插件尚未就绪：还没有可用的后端清单，请稍后重试。这是插件运行环境的问题，不是你的操作有误。' } }
    const platform: any = await getPlatform()
    // #1003 单出口：显式那几层（工作区文件→声明文件）整段交统一判定，自动识别仍由出口内同一注册表跑；
    //   下面只做核验与分档，不再自己判一次。本文件不引用判定服务（同层门禁），函数只经依赖值由工作区入口递进来。
    // #1131 起这一步分两道：先按同一个装配口问「出口装没装上」（探测服务就是从它那儿拿的出口），
    //   再从探测服务取这一次的判定（它管缓存）。前一道只是装配检查，不是第二套判定——少了它，
    //   「出口没装」会被报成「没有拿回结果」，这两句话指的故障不是一回事。
    // 问法用 try 兜住两种坏装配：递进来的口子可能同步抛，也可能回的压根不是 Promise（`await` 都救不了
    //   那种情况），两种都按「没装」处理 —— 这一句只是装配检查，不该把电话本身掀翻。
    let useOutlet: any = null
    try { useOutlet = (typeof getDecisionFn === 'function') ? await getDecisionFn() : null } catch (eD) { useOutlet = null }
    if (!useOutlet || typeof useOutlet.decideBackend !== 'function') {
      // 缺依赖即装配错：如实说插件这边有问题，不抛，不编一个后端出来。
      return { ok: false, error: { kind: 'env', message: '列出标签与修改标签颜色时插件运行出错：判定出口这次没装上，所以没有动仓库里的任何东西。请重试一次；如果仍然失败，请把这条提示原文报告给插件维护者。' } }
    }
    let svc: any = null
    try { svc = (typeof getDetectionService === 'function') ? await getDetectionService() : null } catch (eS) { svc = null }
    if (!svc || typeof svc.detect !== 'function') {
      // 同样按「缺依赖即装配错」办，文案与上面那条一样：这句话要说的就是「判定这一套这次没装上」，
      //   换谁承载它都一样，用户该做的事也一样（重试，不行就把原文报告维护者）。
      return { ok: false, error: { kind: 'env', message: '列出标签与修改标签颜色时插件运行出错：判定出口这次没装上，所以没有动仓库里的任何东西。请重试一次；如果仍然失败，请把这条提示原文报告给插件维护者。' } }
    }
    // #1131：判定整段交探测服务走（每个工作区那份缓存归它管），不再在这里直调出口。
    //   为什么不直调：出口是纯计算，每问一次都要把工作区文件、声明文件、自动识别从头跑一遍；而「这个工作区
    //   现在用哪个后端」面板、deck 工具与改色电话问的是同一件事，就该吃同一份结论 —— 同一个工作区连着两次
    //   改色，第二次一行判定都不该重算（命中没命中看按需日志 detection.cache.hit）。
    //   withOutlet 是必要条件：改色电话还要出口原话里的 canWrite（这一次的结论算不算人亲手选过），
    //   以及 multiHit / pending 两样分档依据，而 selectionFromOutlet 交出来的只有五个字段，带不出它们。
    //   skipSkillProbes：这两条电话只要「用哪个后端」，技能探测是另一件事（面板那条路也这么传）。
    let res: any = null
    try { res = await svc.detect({ cwd: cwd }, { skipSkillProbes: true, caller: caller, signal: signal, withOutlet: true }) } catch (e) { res = null }
    const o: any = (res && res.outlet) || null
    let sel: any = null
    let canWrite0: any = undefined
    {
      const hasId0 = function (id: any): any { try { return !!(id && reg.has(id)); } catch { return false; } };
      canWrite0 = !!(o && o.canWrite === true)
      if (o && o.backendId && hasId0(o.backendId) && !(Array.isArray(o.multiHit) && o.multiHit.length > 1) && !o.pending) {
        const t9: any = reg.get(o.backendId);
        if (t9) { let r9: any = null; try { r9 = reg.describe({ cwd }, o.backendId); } catch { r9 = { backend: o.backendId, refId: '', name: '', url: '' }; } if (needWritable && !canWrite0) return notPickedYet(); return { ok: true, backendId: o.backendId, repoRef: r9, tracker: t9, platform }; }
      }
      // 出口无可用显式答案时：自动识别它已经跑过一次，不再跑第二次，下面只做核验与分档。
      //   多命中与待定落到下面那两条诚实失败（与老路同序：先看 multiHit/pending，再拿 id）。
      // 出口无显式答案时：自动识别它已经跑过一次，不再跑第二次，下面只做核验与分档。
      //   未注册的 id 直接跳过（不把它当答案，落到下面诚实失败）；出口抛错（o 为空）同样落到下面那条失败。
      if (o) {
        sel = o.pending
          ? { backendId: o.backendId || null, source: o.source || 'fallback', multiHit: o.multiHit, pending: true, ref: o.ref || null }
          : { backendId: null, source: 'fallback', multiHit: o.multiHit || undefined, pending: undefined, ref: null }
      } else {
        return { ok: false, error: { kind: 'env', message: '列出标签与修改标签颜色时插件运行出错：判定出口这次没有拿回结果，所以没有动仓库里的任何东西。请重试一次；如果仍然失败，请把这条提示原文报告给插件维护者。' } }
      }
    }
    // 客户端显式声明了它面板上正在用的那个后端 → **核验**它确实在这次算出来的名单里，是就直接交给它。
    //   核验不通过的两种情况，一律照下面那条诚实的失败办（绝不退回「宿主自己挑一个」）：
    //     · 身份识别还没出结果（pending）——这时名单里的那个名字只是注册序的暂时赢家，还没定下来；
    //     · 声明的那个不在名单里（从没听说过的 id，或者这个工作区根本不是它认得的地方）。
    //   为什么核验通过就可以直接用：客户端声明的不是它随便挑的一个，而是宿主上一次算出来、
    //   现在正显示在面板正文里的那一个（取法见客户端 labelColorErrors.js 的 lcPanelBackendOf）；
    //   用户是在看着那个后端的标签点开改色弹窗的，按它改才是用户以为的那件事。
    const want: string = String(declared || '')
    if (want !== '' && !(sel && sel.pending) && candidatesOf(sel).indexOf(want) >= 0) {
      const trackerWant: any = reg.get(want)
      if (!trackerWant) return unknownBackend(want)
      let refWant: any = null
      try { refWant = reg.describe({ cwd: cwd }, want) } catch (e) { refWant = { backend: want, refId: '', name: '', url: '' } }
      if (needWritable && !canWrite0) return notPickedYet()
      return { ok: true, backendId: want, repoRef: refWant, tracker: trackerWant, platform: platform }
    }
    if (sel && Array.isArray(sel.multiHit) && sel.multiHit.length > 1) {
      // 只对用户说两件确定的事：同时对应的个数（用户能对上自己装了几个后端）、以及去面板中选定。
      //   **不列后端 id**：用户看不到 `github` / `gitlab` 这类内部名字，列出来只会让人去猜哪颗按钮对应哪一行。
      return { ok: false, error: { kind: 'conflict', message: UNDECIDED + '（当前有 ' + sel.multiHit.length + ' 个后端同时对应这个工作区，插件无法自己定下来用哪一个。请在面板中选定这个工作区使用的后端，然后重试）' } }
    }
    const backendId: any = sel && sel.backendId
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
    const tracker: any = reg.get(backendId)
    if (!tracker) return unknownBackend(backendId)
    let repoRef: any = (sel && sel.ref) || null
    if (!repoRef) { try { repoRef = reg.describe({ cwd: cwd }, backendId) } catch (e) { repoRef = { backend: backendId, refId: '', name: '', url: '' } } }
    if (needWritable && !canWrite0) return notPickedYet()
    return { ok: true, backendId: backendId, repoRef: repoRef, tracker: tracker, platform: platform }
  }
  // 「插件这边的错」只有一种口径：后端回的形状不符合契约、后端抛异常、宿主自己出错，一律归 env（插件自身/环境问题），
  //   文案必须说清「这是插件这边的问题，不是你操作错了」，否则用户会去翻自己的操作找原因。
  //   network 只留给真正的连不通与超时：那是后端如实给出的，这里原样透传；宿主不自己造 network。
  // 「这一档发生在什么时候」为什么必须说准（#633）：写标签那一档的 catch 兜的是 `await picked.tracker.setLabelColors(...)`
  //   这一句，异常抛出时请求**已经交给后端**——不能说「本次操作未生效」（替后端保证一个字没改），也不能说
  //   「后端在改色时抛出异常」（替它保证确实动过手）；只能说「没拿回结果、改动有没有发生没法确认」，并让用户先去看一眼。
  //   列标签那一档是读操作（没拿回结果 = 读没读成、颜色一个字节没动），`pickBackend` 那一档在交出去**之前**
  //   （那里才能说「没有动仓库里的任何东西」）。三处的话各有各的依据，不能互换。
  function pluginTrouble(opCn: any, why: any, detail?: any): any {
    return { ok: false, error: { kind: 'env', message: opCn + '时插件运行出错：' + why + (detail ? '（' + detail + '）' : '') + '。这是插件运行环境的问题，不是你的操作有误。' } }
  }
  function msgOf(e: any): string { return String((e && e.message) || e) }
  // 后端说的失败原样交给客户端（是哪一档后端自己最清楚）；只有「连失败都没说清」才算插件这边的错。
  function backendFailure(res: any, opCn: any): any {
    if (res && res.error && typeof res.error === 'object') return { ok: false, error: res.error }
    return pluginTrouble(opCn, '后端既未表示成功，也未说明失败原因')
  }
  // 列出这个后端能改色的全部标签及其颜色（契约操作 listLabels）。拿不到就说做不到，
  //   不在这里替后端兜底造数据（能力 = 运行时调用结果）。
  //   形状把关：后端回的 data 必须是一份清单（数组），否则算插件这边的错，不把坏形状漏给客户端。
  //   args.backendId（#631 追加，可缺）：客户端说它面板上现在用的是哪个后端；只做核验，不照单全收（见 pickBackend）。
  async function handleListLabels(args: any): Promise<any> {
    // #1003 空目录不兜进程目录：没给目录就按未知走，pickBackend 会说“还没就绪”，不再拿安装目录去探测。
    const _rawCwd: any = (args && typeof args.cwd === 'string' && args.cwd) ? args.cwd : '';
    const cwd: any = _rawCwd ? await normCwd(_rawCwd) : '';
    const signal: any = new AbortController().signal
    let picked: any = null
    try { picked = await pickBackend(cwd, 'wf.listLabels', signal, args && args.backendId) } catch (e) { return pluginTrouble('修改标签颜色', '插件没能确定这个工作区使用哪个后端这一步出错（内部叫 pickBackend），所以没有动仓库里的任何东西。请重试一次；如果仍然失败，请把这条提示原文报告给插件维护者', msgOf(e)) }
    if (!picked.ok) return picked
    const sb: any = resolveSandboxPolicy(args, cwd)
    let res: any = null
    try { res = await picked.tracker.listLabels(picked.repoRef, opCtxFor(cwd, picked.platform, picked.repoRef, 'wf.listLabels', signal, sb.policy, sb.sessionId)) } catch (e) { return pluginTrouble('修改标签颜色', '插件没有拿回结果，因此无法确认这次读取有没有成功（也就不知道仓库里的标签现在是什么样）：请重试一次；如果仍然失败，请把这条提示原文报告给插件维护者', msgOf(e)) }
    if (!res || res.ok !== true) return backendFailure(res, '列出标签')
    if (!Array.isArray(res.data)) return pluginTrouble('列出标签', '后端返回的标签清单不符合约定格式（应为数组）', typeof res.data)
    return { ok: true, backendId: picked.backendId, labels: res.data }
  }
  // 批量改色（契约操作 setLabelColors）。逐条记账由后端给：这里原样透传 applied 与 failed，
  //   不把「部分成功」改写成整体成败——那正是界面在部分成功时唯一能说实话的依据。
  //   形状把关：两个名单缺一不可（缺了就是后端没按契约回话，算插件这边的错）；
  //   回包只发契约里约定的四个键（ok / backendId / applied / failed），后端多给的字段不往客户端漏。
  async function handleSetLabelColors(args: any): Promise<any> {
    // #1003 空目录不兜进程目录：同上。
    const _rawCwd2: any = (args && typeof args.cwd === 'string' && args.cwd) ? args.cwd : '';
    const cwd: any = _rawCwd2 ? await normCwd(_rawCwd2) : '';
    const changes: any = args && args.changes
    if (!Array.isArray(changes)) return { ok: false, error: { kind: 'parse', message: '修改标签颜色需要一份「标签 → 新颜色」的改动清单（内部把这个清单叫 changes），本次保存带上来的内容不是这种格式。请回到改色弹窗重新保存一次。' } }
    const signal: any = new AbortController().signal
    let picked: any = null
    try { picked = await pickBackend(cwd, 'wf.setLabelColors', signal, args && args.backendId, true) } catch (e) { return pluginTrouble('修改标签颜色', '插件没能确定这个工作区使用哪个后端这一步出错（内部叫 pickBackend），所以没有动仓库里的任何东西。请重试一次；如果仍然失败，请把这条提示原文报告给插件维护者', msgOf(e)) }
    if (!picked.ok) return picked
    const sb: any = resolveSandboxPolicy(args, cwd)
    let res: any = null
    try { res = await picked.tracker.setLabelColors(picked.repoRef, changes, opCtxFor(cwd, picked.platform, picked.repoRef, 'wf.setLabelColors', signal, sb.policy, sb.sessionId)) } catch (e) { return pluginTrouble('修改标签颜色', '插件没有拿回改动结果，所以仓库里的颜色有没有被改动、哪些被改动，现在都无从确认。请先看一眼标签现在的颜色（去仓库或面板里看一眼都行），再重试一次；如果仍然失败，请把这条提示原文报告给插件维护者', msgOf(e)) }
    if (!res || res.ok !== true) return backendFailure(res, '修改标签颜色')
    const data: any = res.data
    if (!data || typeof data !== 'object' || !Array.isArray(data.applied) || !Array.isArray(data.failed)) return pluginTrouble('修改标签颜色', '后端没有说清哪些标签的颜色改成功了、哪些没改成功（内部把这两份清单叫 applied 与 failed）。请重试一次；如果仍然失败，请把这条提示原文报告给插件维护者')
    return { ok: true, backendId: picked.backendId, applied: data.applied, failed: data.failed }
  }
  return { handleListLabels: handleListLabels, handleSetLabelColors: handleSetLabelColors }
}
