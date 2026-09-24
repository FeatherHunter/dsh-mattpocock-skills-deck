// src/host/workspaceCwd.js —— 工作区归一与绑定选择（H5 #449 从 host/index.js 302–388 搬出电话体，纯结构、行为零变化）。
// 以后谁改它：改工作区路径归一、后端绑定选择，或「取到后端之后转交它的标签配色两条电话（#627）」的人。预估约 200 行，超 350 打回。
// 接线：由 index.js 动态 import 加载；normCwd 由本文件单一持有，评论线程经 index 转供给复用；本文件不引用其他新文件；目录取法调 shared 共用函数（#730）。
import { resolveSessionCwd } from '../shared/session-cwd.js'
export function createWorkspaceCwd(deps) {
  const { ctx, DEFAULT_CWD, getPlatform, getTrackerRegistry, getWorkspaceStore, getChoiceStore, canonicalKey, setCache, logCtx, timer, detectionExec } = deps
  // #176 + #190 修复：cwd 归一（绝对直通 + 相对尝试 fs.resolve + home 试探）
  // 根因：workspaces 服务在 client runtime 暴露的 item.path 可能是相对名（如 "matt-demo-markdown"），
  // 传给 wf.selection 后 select() 三级联中 markdown.matches 收到相对 cwd，plat.join(cwd,...) 仍是相对，
  // fs.resolve 默认基于进程 cwd 解析失败 → matches false → fallback → UI "未绑定"。
  // 归一后所有 handler 收到绝对 cwd，markdown.matches 命中 docs/agents/issue-tracker.md → Markdown 自动。
  // #652 起：上面三步回退连同「往上锚到工作区根」一起收进 canonicalWorkspaceKey 这一个出口 （源码在 src/host/workspaceKey.js，本文件只转交）。理由两条：① 钥匙只能有一个出口，读写删三侧 同形才删得中（#301 踩过的坑）；② 锚根正是本文件每条电话都要的——后端选择、后端绑定、配色文件 落点、标签读写全该按工作区根算。与旧行为的差别只有一条：会话选在子目录里时算出的是工作区根。
  async function normCwd(raw){
    try { return await canonicalKey(raw || DEFAULT_CWD) } catch (e) { return raw || DEFAULT_CWD }
  }
  // #155 + #152：后端绑定（per-workspace 覆盖，唯一写路径不回写 issue-tracker.md）+ 注册表查询 + detection 缓存失效
  // #618：用户为工作区选定后端这一步，顺手在工作区里放一份默认配色文件（幂等：文件在就一个字都不改）。
  // 只有 Markdown 系后端放：GitHub 的颜色是仓库标签的实体数据，没有这份文件；GitLab 这一轮不动。
  // 怎么认出「Markdown 系」：后端自己实现 ensureLabelColorsFile 这个方法，host 只问它愿不愿意放， 不在这里写死文件路径与后端 id（路径与内容是这个后端自己的事）。GitHub / GitLab 按 id 明确跳过。
  // 放失败不影响绑定本身（用户这次是来选后端的），但**不能无声**：失败要记一条日志，并且把结果如实 放进 bind 的回包里（labelColorsFile 一项），让界面与排查的人都能看见「这次没放上、为什么」。
  //   真正要用这份文件的时候（打开改色弹窗）会再试一次，那时按写失败分档如实报「写不进去」。
  async function placeLabelColorsFile(cwd, backendId) {
    if (!backendId || backendId === 'github' || backendId === 'gitlab') return { ok: true, skipped: 'not-markdown' }
    try {
      const reg = await getTrackerRegistry()
      if (!reg) return { ok: false, error: { kind: 'env', message: '插件尚未就绪：还没有可用的后端清单，这次没能看清要不要放配色文件。请重试一次；如果仍然失败，请把这条提示原文报告给插件维护者。' } }
      const tracker = reg.get(backendId)
      if (!tracker || typeof tracker.ensureLabelColorsFile !== 'function') return { ok: true, skipped: 'backend-wants-no-file' }
      const platform = await getPlatform()
      let ref = null
      try { ref = reg.describe({ cwd: cwd }, backendId) } catch (e) { ref = { backend: backendId, refId: '', name: '', url: '' } }
      const sb = resolveSandboxPolicy(null, cwd)
      const placed = await tracker.ensureLabelColorsFile(ref, opCtxFor(cwd, platform, ref, 'wf.bind', new AbortController().signal, sb.policy, sb.sessionId))
      if (placed && placed.ok === true) return { ok: true, placed: placed.placed === true, reason: placed.reason || '' }
      return { ok: false, error: (placed && placed.error) || { kind: 'env', message: '后端既没有说这次要不要放配色文件，也没有说明原因。请重试一次；如果仍然失败，请把这条提示原文报告给插件维护者。' } }
    } catch (e) {
      return { ok: false, error: { kind: 'env', message: '插件没能把标签配色文件放进这个工作区（放入这一步出错），所以这个工作区里现在可能还没有这份文件。请重试一次；如果仍然失败，请把这条提示原文报告给插件维护者。' } }
    }
  }
  async function handleBind(args) {
    const cwd = await canonicalKey((args && args.cwd) || DEFAULT_CWD)
    const backendId = args && ('backendId' in args ? args.backendId : args.backend)
    try {
      const reg = await getTrackerRegistry()
      if (!reg) return { ok: false, error: 'registry unavailable' }
      const handle = { cwd: cwd }
      // null = 显式无后端（Other 逃生舱）；'other' 已弃用按 registry 拒绝
      reg.bind(handle, backendId === undefined ? null : backendId)
      // #696 只清自己根那条（手上有目录）；失效快照+状态+探测三缓存，切换不串台
      setCache({ ts: 0, snapshot: null, error: null, cwd: cwd })
      try { const ws = await getWorkspaceStore(); ws.invalidate(handle) } catch {}
      // #618：选好之后顺手放一份默认配色文件（幂等）。失败不回滚绑定，但如实放进回包并在日志里留痕。
      let labelColorsFile = null
      try { labelColorsFile = await placeLabelColorsFile(cwd, backendId === undefined ? null : backendId) } catch (e) { labelColorsFile = { ok: false, error: { kind: 'env', message: msgOf(e) } } }
      if (labelColorsFile && labelColorsFile.ok !== true && labelColorsFile.skipped === undefined) {
        try {
          if (logCtx && typeof logCtx.fire === 'function') logCtx.fire('warn', 'labelColors.write', { cwdHash: hash8(String(cwd)), count: 0, ok: false, reason: 'place-fail' })
        } catch (eL) {}
      }
      // H1 #445 恒空留守省略：原 _detectionService 空检查为无动作分支，有无值行为一致，搬出时省略。
      // #683（F1 · ADR 20260921 的 R1/R2/R7c）：用户亲手选的这一下多存一份在宿主侧（跨 DSH 重启、跨访问地址、跨桌面端/浏览器都不失忆）；修订号由宿主发号，写不成功要如实回（persisted:false），不许无声失败。
      const persistedBackendId = backendId === undefined ? null : backendId
      const cw = (typeof getChoiceStore === 'function') ? await getChoiceStore().catch(function () { return null }) : null
      const wr = (cw && typeof cw.rememberWorkspace === 'function') ? await cw.rememberWorkspace(cwd, persistedBackendId).catch(function () { return null }) : null
      const out = { ok: true, cwd: cwd, backendId: persistedBackendId, labelColorsFile: labelColorsFile, rev: (wr && wr.ok === true) ? (wr.rev || 0) : 0, persisted: !!(wr && wr.ok === true) }
      return out
    } catch (e) {
      const msg = String((e && e.message) || e)
      if (/unknown-backend/.test(msg)) return { ok: false, error: msg, kind: 'unknown-backend' }
      return { ok: false, error: msg }
    }
  }
  // #683（F1 · ADR 的 R6）：卡片确认写的是「卡上当时显示的那一个」—— 同时写 H（宿主侧那份记忆）与 C（本地那份）；layout 没给就是读：新壳/新地址第一次打开时，就靠这一问知道上次选了 single 还是 multi。
  async function handleSetupLayout(args) {
    const cwd = await normCwd((args && args.cwd) || '')
    const cs = (typeof getChoiceStore === 'function') ? await getChoiceStore().catch(function () { return null }) : null
    const v = args ? args.layout : undefined
    if (v == null) { const r = (cs && typeof cs.getLayout === 'function') ? await cs.getLayout(cwd).catch(function () { return null }) : null; return (r && r.found === true) ? { ok: true, cwd: cwd, layout: r.layout, pickedAt: r.pickedAt } : { ok: true, cwd: cwd, layout: null, pickedAt: 0 } }
    const w = (cs && typeof cs.rememberLayout === 'function') ? await cs.rememberLayout(cwd, String(v).toLowerCase()).catch(function () { return null }) : null
    return (w && w.ok === true) ? { ok: true, cwd: cwd, layout: String(v).toLowerCase(), pickedAt: w.pickedAt } : { ok: false, cwd: cwd, error: 'not-stored' }
  }
  async function handleBindings() {
    try {
      const reg = await getTrackerRegistry()
      if (!reg) return { ok: false, error: 'registry unavailable' }
      const list = typeof reg.allBindings === 'function' ? reg.allBindings() : []
      const bindings = await Promise.all(list.map(async function (b) {
        const rawCwd = b.cwd || (b.handle && b.handle.cwd) || ''
        const cwd = await normCwd(rawCwd)
        let ref = null
        if (b.backendId) { try { ref = reg.describe({ cwd: cwd }, b.backendId) } catch {} }
        return { cwd: cwd, backendId: b.backendId, source: 'explicit', ref: ref }
      }))
      return { ok: true, bindings: bindings }
    } catch (e) { return { ok: false, error: String((e && e.message) || e) } }
  }
  async function handleRegistry(args) {
    try {
      const reg = await getTrackerRegistry()
      if (!reg) return { ok: false, error: 'registry unavailable' }
      const mods = reg.modules().map(function(m){ return Object.assign({ id: m.id, label: m.label, presentation: m.presentation }, m.setupPrompt ? { setupPrompt: m.setupPrompt } : {}, m.labelPalette ? { labelPalette: m.labelPalette } : {}, m.links ? { links: m.links } : {}, m.capabilities ? { capabilities: m.capabilities } : {}, m.prompts ? { prompts: m.prompts } : {}, m.openRepository ? { openRepository: m.openRepository } : {}) })
      // #652：这一条问的是「这个工作区绑了哪个后端」，所以入参要先洗成与绑定同一把钥匙。 旧写法把 args.cwd 原样交给 reg.bound()，而 wf.bind 用的是规整后的钥匙——同一条目录两把钥匙，
      //   绑定写进一个桶、这里读另一个桶，回包一直看不到那份绑定（研究 #648 第四节的实测在案）。
      const cwd = await normCwd((args && args.cwd) || DEFAULT_CWD)
      let bound = undefined
      try { bound = reg.bound({ cwd: cwd }) } catch {}
      return { ok: true, modules: mods, bound: bound }
    } catch (e) { return { ok: false, error: String((e && e.message) || e) } }
  }
  async function handleSelection(args) {
    const cwd = await normCwd((args && args.cwd) || DEFAULT_CWD)
    try {
      const reg = await getTrackerRegistry()
      if (!reg) return { ok: false, error: 'registry unavailable' }
      const sel = await reg.select({ cwd: cwd }, { cwd: cwd, platform: await getPlatform(), fs: ctx.get('fs'), caller: 'wf.selection' })
      let repoRef = null
      if (sel && sel.backendId) { try { repoRef = reg.describe({ cwd: cwd }, sel.backendId) } catch {} }
      return { ok: true, selection: sel, repository: repoRef }
    } catch (e) { return { ok: false, error: String((e && e.message) || e) } }
  }
  // ============ 标签配色两条电话（#627 契约票）============
  // 「列出标签与颜色」与「批量改色」两个契约操作，界面经下面两条电话调到。
  // 为什么住在本文件：两条电话的第一步都要把工作区路径归一（normCwd 是本文件单一持有者）， 第二步都要按工作区问出当前后端。归一与选择都在本文件，就地转交选中的后端即可，
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
  function opCtxFor(cwd, platform, repoRef, caller, signal, sandboxPolicy, sessionId) {
    return {
      cwd: cwd,
      refId: (repoRef && repoRef.refId) || '',
      signal: signal,
      platform: platform,
      fs: ctx.get('fs'),
      caller: caller,
      // 写文件要用的「本次调用的政策」（会话政策）：由沙箱政策服务按会话算，这里只传不算。
      // 后端把它当写方法的第 5 个参数交给 DSH 的文件服务 —— 不传就等于用部署默认政策，
      // 而部署默认可写根是 DSH 进程所在目录，不是用户工作区，所以往工作区写必然被拒（研究 #614/#624）。
      sandboxPolicy: sandboxPolicy,
      // 这份政策是按哪个会话算的（给日志与排查用；拿不到会话时是空串）。
      sessionId: sessionId || '',
      timers: { setTimeout: function (fn, ms) { return timer.timeout(fn, ms) }, clearTimeout: function (id) { try { clearTimeout(id) } catch (e) {} } },
      exec: function (cmd, args, opts) { return detectionExec(cmd, args, opts, 'label-colors') },
      logEvent: function (level, event, fields) { try { if (logCtx && typeof logCtx.fire === 'function') logCtx.fire(level, event, fields) } catch (e) {} },
      isEnabled: function (level) { try { return (logCtx && typeof logCtx.isEnabled === 'function') ? logCtx.isEnabled(level) === true : (level === 'error' || level === 'warn') } catch (e) { return level === 'error' || level === 'warn' } },
    }
  }
  // ── 会话政策：写用户工作区时那条正规口子的两半（研究 #624）────────────────────
  // 一半是「政策」：调沙箱政策服务按某个会话算，它把会话头里的工作目录当可写根。
  // 另一半是「会话号」：客户端那条 wf.cwd 路径已经在带会话号，这两条电话照样收 args.sessionId。
  // 没带会话号时怎么办：找这个工作区名下活着的会话，正好一个就用它；找不到（或不止一个，无法确定
  // 是哪一次操作）就不猜、也不自己拼政策——退回让 DSH 按部署默认政策判，写不进用户工作区就如实报失败。
  // 为什么不猜：会话模式可以不一样（有的是只读），猜错等于替用户绕开他自己选的那档限制。
  function pathKeyOf(p) { return String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() }
  function sessionById(sid) {
    if (!sid) return null
    try {
      const svc = ctx.get('sessions')
      if (!svc || typeof svc.get !== 'function') return null
      return svc.get(String(sid)) || null
    } catch (e) { return null }
  }
  // 找「这个工作区名下活着的会话」。两种匹配，先精确、后包含（#652 补了后一种）：
  //   精确＝会话自己的目录就是这一条（根会话）；包含＝会话开在这个工作区根下面的某条子目录里。
  //   包含只在精确一个都没有时才用——顺序反了会让根会话被下面的子目录会话挤掉。
  function sessionsOfWorkspace(cwd, inside) {
    try {
      const svc = ctx.get('sessions')
      if (!svc || typeof svc.list !== 'function') return []
      const want = pathKeyOf(cwd)
      if (!want) return []
      const prefix = want + '/'
      const all = svc.list() || []
      const hits = []
      for (const s of all) {
        const c = resolveSessionCwd(s) // #730：与电话体同一套取法（从前只认 header.cwd 等 2 个槽位会漏读）
        if (!c) continue
        const k = pathKeyOf(c)
        if (!k) continue
        if (inside) { if (k !== want && k.indexOf(prefix) === 0) hits.push(s) }
        else if (k === want) hits.push(s)
      }
      return hits
    } catch (e) { return [] }
  }
  // 政策服务算政策：有会话就按会话算（含会话自己的模式），没有会话就交给它兜底。
  // 取不到政策服务时返回 undefined —— 后端拿到 undefined 就不传第 5 个参数，维持现状并如实报失败，
  // 绝不在插件这边自己拼一个宽松政策。
  // #652：传进来的 cwd 现在是工作区根，而子目录会话自己仍挂在子目录上，所以「按同一条目录找」之外
  //   还要能「按这个根找它下面的会话」（sessionsOfWorkspace 的第二个参数），否则子目录会话写文件拿不到政策。
  function resolveSandboxPolicy(args, cwd) {
    try {
      const svc = ctx.get('sandboxPolicy')
      if (!svc || typeof svc.resolve !== 'function') return { policy: undefined, sessionId: '' }
      let session = sessionById(args && args.sessionId)
      if (!session) {
        const hits = sessionsOfWorkspace(cwd, false)
        if (hits.length === 1) session = hits[0]
        else if (hits.length === 0) {
          const inside = sessionsOfWorkspace(cwd, true)
          if (inside.length === 1) session = inside[0]
        }
      }
      const policy = svc.resolve(session ? { session: session } : {})
      return { policy: policy, sessionId: (session && session.id) ? String(session.id) : '' }
    } catch (e) { return { policy: undefined, sessionId: '' } }
  }
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
  function hash8(s) { try { const t = String(s || ''); let h = 5381; for (let i = 0; i < t.length; i++) h = (((h << 5) + h + t.charCodeAt(i)) >>> 0); return ('0000000' + h.toString(16)).slice(-8) } catch (e) { return '00000000' } }
  function phoneLog(method, kind, t0, res, err) {
    try {
    if (err !== undefined && err !== null) { if (logCtx) logCtx.fire('warn', 'host.call.fail', { method: method, kind: kind, errorHash: hash8(String((err && err.message) || err)) }) }
    else if (res && res.ok) { if (logCtx) logCtx.fire('info', 'host.call', { method: method, latencyMs: Date.now() - t0, ok: true, kind: kind }) }
    else if (logCtx) logCtx.fire('warn', 'host.call.fail', { method: method, kind: kind, errorHash: hash8(String((res && (res.error || res.errorKind)) || 'workspace-not-ok')) }) } catch (eL) {} }
  function loggedPhone(method, kind, fn) { return async function () { const t0 = Date.now(); try { const r = await fn.apply(null, arguments); phoneLog(method, kind, t0, r); return r } catch (e) { phoneLog(method, kind, t0, null, e); throw e } } }
  return { normCwd: normCwd, handleBind: loggedPhone('wf.bind', 'bind', handleBind), handleSetupLayout: loggedPhone('wf.setupLayout', 'setup-layout', handleSetupLayout), handleBindings: loggedPhone('wf.bindings', 'bindings', handleBindings), handleRegistry: loggedPhone('wf.registry', 'registry', handleRegistry), handleSelection: loggedPhone('wf.selection', 'selection', handleSelection), handleListLabels: loggedPhone('wf.listLabels', 'label-colors', handleListLabels), handleSetLabelColors: loggedPhone('wf.setLabelColors', 'label-colors', handleSetLabelColors) }
}
