// src/host/workspaceCwd.js —— 工作区归一与绑定选择（H5 #449 从 host/index.js 302–388 搬出电话体，纯结构、行为零变化）。
// 以后谁改它：改工作区路径归一、后端绑定选择，或「取到后端之后转交它的标签配色两条电话（#627）」的人。预估约 200 行，超 350 打回。
// 接线：由 index.js 动态 import 加载；normCwd 由本文件单一持有，评论线程经 index 转供给复用；本文件不引用其他新文件。
export function createWorkspaceCwd(deps) {
  const { ctx, DEFAULT_CWD, getPlatform, getTrackerRegistry, getWorkspaceStore, canonicalKey, setCache, logCtx, timer, detectionExec } = deps
  // #176 + #190 修复：cwd 归一（绝对直通 + 相对尝试 fs.resolve + home 试探）
  // 根因：workspaces 服务在 client runtime 暴露的 item.path 可能是相对名（如 "matt-demo-markdown"），
  // 传给 wf.selection 后 select() 三级联中 markdown.matches 收到相对 cwd，plat.join(cwd,...) 仍是相对，
  // fs.resolve 默认基于进程 cwd 解析失败 → matches false → fallback → UI "未绑定"。
  // 归一后所有 handler 收到绝对 cwd，markdown.matches 命中 docs/agents/issue-tracker.md → Markdown 自动。
  async function normCwd(raw){
    if(!raw) return DEFAULT_CWD
    try{
      const plat=await getPlatform()
      if(plat&&plat.path&&typeof plat.path.isAbsolute==='function'&&plat.path.isAbsolute(raw)) return plat.path.normalize(raw)
    }catch{}
    // 相对：DSH fs.resolve 试探（DSH 平台 fs 可能感知 workspaces 根）
    try{
      const fss=ctx.get('fs')
      if(fss&&typeof fss.resolve==='function'){
        const t=await fss.resolve(raw)
        const target=(t&&typeof t==='object')?(t.path||t.target):t
        if(typeof target==='string'&&target&&(/^[A-Za-z]:[\\/]/.test(target)||/^\//.test(target))) return target
      }
    }catch{}
    // home 试探（windows + posix）
    try{
      const plat=await getPlatform()
      const home=plat&&typeof plat.getHome==='function'?await plat.getHome():null
      if(home&&plat.path) return plat.path.join(home,raw)
    }catch{}
    return raw
  }
  // #155 + #152：后端绑定（per-workspace 覆盖，唯一写路径不回写 issue-tracker.md）+ 注册表查询 + detection 缓存失效
  async function handleBind(args) {
    const cwd = await canonicalKey((args && args.cwd) || DEFAULT_CWD)
    const backendId = args && ('backendId' in args ? args.backendId : args.backend)
    try {
      const reg = await getTrackerRegistry()
      if (!reg) return { ok: false, error: 'registry unavailable' }
      const handle = { cwd: cwd }
      // null = 显式无后端（Other 逃生舱）；'other' 已弃用按 registry 拒绝
      reg.bind(handle, backendId === undefined ? null : backendId)
      // 失效快照 + 状态 + 探测三缓存（per-workspace 切换不串台，Q3；workspaceStore 内存单例失效）
      setCache({ ts: 0, snapshot: null, error: null, cwd: null })
      try { const ws = await getWorkspaceStore(); ws.invalidate(handle) } catch {}
      // H1 #445 恒空留守省略：原 _detectionService 空检查为无动作分支，有无值行为一致，搬出时省略。
      return { ok: true, cwd: cwd, backendId: backendId === undefined ? null : backendId }
    } catch (e) {
      const msg = String((e && e.message) || e)
      if (/unknown-backend/.test(msg)) return { ok: false, error: msg, kind: 'unknown-backend' }
      return { ok: false, error: msg }
    }
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
      const cwd = (args && args.cwd) || DEFAULT_CWD
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
  // 为什么住在本文件：两条电话的第一步都要把工作区路径归一（normCwd 是本文件单一持有者），
  //   第二步都要按工作区问出当前后端。归一与选择都在本文件，就地转交选中的后端即可，
  //   不必让别的文件再走一遍这两步（同层互引门禁也不许新开的文件之间互相引用）。
  // 交给后端的「本次调用上下文」（契约 OpContext）：工作区、平台、沙箱 fs、本次调用的中止信号、
  //   本次用的记录器、起外部程序的执行器（房内 gh/glab 命令走它，每次调用落一条 exec.run 日志），
  //   以及可中断的定时器。
  // 为什么必须带 signal（不能省）：契约的 OpContext 就写着这一项，而后端真的会读它 ——
  //   GitHub 后端调外部命令时用 `opts.signal || ctx.signal` 当超时中止信号，GitLab 后端发起鉴权预检时
  //   也要 `ctx.signal` 才能被中断。少了这一项，这两条电话调后端时那些命令就没有中止信号可用。
  // 传同一个 signal 给两步（先是问当前后端，再把上下文交给后端执行）是为了两次调用一致。
  // 失败怎么分档（用户看到的文案随之不同，所以口径要死）：
  //   后端发现自己做不了 / 没登录 / 限速 / 标签不存在 → 后端自己如实给的档，这里原样透传；
  //   真正的连不通与超时 → network，也是后端给的，宿主不自己造 network；
  //   后端回的形状不符合契约、后端抛异常、宿主自己出错 → env，文案必须说清「这是插件这边的问题，
  //     不是你操作错了」；
  //   没选定后端 / 多个后端同时命中 / 身份识别还没定下来 → conflict，让用户先选定后端再试。
  // 两条电话的日志 kind 与交给后端执行器用的 via 统一写成 'label-colors'（同一件事只有一个叫法）。
  function opCtxFor(cwd, platform, repoRef, caller, signal) {
    return {
      cwd: cwd,
      refId: (repoRef && repoRef.refId) || '',
      signal: signal,
      platform: platform,
      fs: ctx.get('fs'),
      caller: caller,
      timers: { setTimeout: function (fn, ms) { return timer.timeout(fn, ms) }, clearTimeout: function (id) { try { clearTimeout(id) } catch (e) {} } },
      exec: function (cmd, args, opts) { return detectionExec(cmd, args, opts, 'label-colors') },
      logEvent: function (level, event, fields) { try { if (logCtx && typeof logCtx.fire === 'function') logCtx.fire(level, event, fields) } catch (e) {} },
      isEnabled: function (level) { try { return (logCtx && typeof logCtx.isEnabled === 'function') ? logCtx.isEnabled(level) === true : (level === 'error' || level === 'warn') } catch (e) { return level === 'error' || level === 'warn' } },
    }
  }
  // 两条电话共用的第一步：把工作区解析成「当前后端 + 它的仓库引用 + 它的适配器」。
  //   失败一律返回 {ok:false, error:{kind, message}}（失败返回而非抛，与契约同款）。
  //   选择结果里除了 backendId，还有三样必须看的东西（注册表算好的，出处见 registryCore.js 的 select）：
  //     ref      注册表算好的仓库引用（后端 describe 的产物）—— 能拿到就用它，不自己重算；
  //     multiHit 多个后端同时认领这个工作区（仲裁还没定下来）；
  //     pending  有后端的身份识别超时未决。
  //   「没选定 / 多命中 / 待定」三种一律明确失败（conflict 档），让用户先选定后端再试；
  //   绝不许静默挑一个「匹配的赢家」——那可能把颜色改到另一个仓库上去。
  const UNDECIDED = '还没定下要给哪个后端改标签配色：先在面板里选定这个工作区用哪个后端，再试一次'
  async function pickBackend(cwd, caller, signal) {
    const reg = await getTrackerRegistry()
    if (!reg) return { ok: false, error: { kind: 'env', message: '插件这边还没准备好：后端注册表还没就绪，稍后再试（这是插件这边的问题，不是你操作错了）' } }
    const platform = await getPlatform()
    const sel = await reg.select({ cwd: cwd }, { cwd: cwd, platform: platform, fs: ctx.get('fs'), caller: caller, signal: signal })
    if (sel && Array.isArray(sel.multiHit) && sel.multiHit.length > 1) {
      return { ok: false, error: { kind: 'conflict', message: UNDECIDED + '（现在有 ' + sel.multiHit.length + ' 个后端同时认领这个工作区：' + sel.multiHit.join('、') + '）' } }
    }
    const backendId = sel && sel.backendId
    if (!backendId) {
      return { ok: false, error: { kind: 'conflict', message: UNDECIDED + (sel && sel.pending ? '（有后端的身份识别还没出结果，稍等片刻再试）' : '（这个工作区现在没有后端）') } }
    }
    if (sel && sel.pending) return { ok: false, error: { kind: 'conflict', message: UNDECIDED + '（有后端的身份识别还没出结果，稍等片刻再试）' } }
    const tracker = reg.get(backendId)
    if (!tracker) return { ok: false, error: { kind: 'env', message: '列标签与改色时插件这边出了问题：选中的后端「' + backendId + '」在注册表里找不到。这是插件这边的问题，不是你操作错了。' } }
    let repoRef = (sel && sel.ref) || null
    if (!repoRef) { try { repoRef = reg.describe({ cwd: cwd }, backendId) } catch (e) { repoRef = { backend: backendId, refId: '', name: '', url: '' } } }
    return { ok: true, backendId: backendId, repoRef: repoRef, tracker: tracker, platform: platform }
  }
  // 「插件这边的错」只有一种口径：后端回的形状不符合契约、后端抛异常、宿主自己出错，一律归 env（插件自身/环境问题），
  //   文案必须说清「这是插件这边的问题，不是你操作错了」，否则用户会去翻自己的操作找原因。
  //   network 只留给真正的连不通与超时：那是后端如实给出的，这里原样透传；宿主不自己造 network。
  function pluginTrouble(opCn, why, detail) {
    return { ok: false, error: { kind: 'env', message: opCn + '时插件这边出了问题：' + why + '。这是插件这边的问题，不是你操作错了' + (detail ? '（' + detail + '）' : '') + '。' } }
  }
  function msgOf(e) { return String((e && e.message) || e) }
  // 后端说的失败原样交给客户端（是哪一档后端自己最清楚）；只有「连失败都没说清」才算插件这边的错。
  function backendFailure(res, opCn) {
    if (res && res.error && typeof res.error === 'object') return { ok: false, error: res.error }
    return pluginTrouble(opCn, '后端既没说自己成功、也没说为什么没成')
  }
  // 列出这个后端能改色的全部标签及其颜色（契约操作 listLabels）。拿不到就说做不到，
  //   不在这里替后端兜底造数据（能力 = 运行时调用结果）。
  //   形状把关：后端回的 data 必须是一份清单（数组），否则算插件这边的错，不把坏形状漏给客户端。
  async function handleListLabels(args) {
    const cwd = await normCwd((args && args.cwd) || DEFAULT_CWD)
    const signal = new AbortController().signal
    let picked = null
    try { picked = await pickBackend(cwd, 'wf.listLabels', signal) } catch (e) { return pluginTrouble('列出标签', '问「这个工作区当前用哪个后端」这一步出错', msgOf(e)) }
    if (!picked.ok) return picked
    let res = null
    try { res = await picked.tracker.listLabels(picked.repoRef, opCtxFor(cwd, picked.platform, picked.repoRef, 'wf.listLabels', signal)) } catch (e) { return pluginTrouble('列出标签', '后端在列标签时抛了异常', msgOf(e)) }
    if (!res || res.ok !== true) return backendFailure(res, '列出标签')
    if (!Array.isArray(res.data)) return pluginTrouble('列出标签', '后端回的标签清单不是一份清单（应当是一个数组）', typeof res.data)
    return { ok: true, backendId: picked.backendId, labels: res.data }
  }
  // 批量改色（契约操作 setLabelColors）。逐条记账由后端给：这里原样透传 applied 与 failed，
  //   不把「部分成功」改写成整体成败——那正是界面在部分成功时唯一能说实话的依据。
  //   形状把关：两个名单缺一不可（缺了就是后端没按契约回话，算插件这边的错）；
  //   回包只发契约里约定的四个键（ok / backendId / applied / failed），后端多给的字段不往客户端漏。
  async function handleSetLabelColors(args) {
    const cwd = await normCwd((args && args.cwd) || DEFAULT_CWD)
    const changes = args && args.changes
    if (!Array.isArray(changes)) return { ok: false, error: { kind: 'parse', message: '批量改色要一批「标签 → 新颜色」（changes 数组），这次收到的不像一批改动' } }
    const signal = new AbortController().signal
    let picked = null
    try { picked = await pickBackend(cwd, 'wf.setLabelColors', signal) } catch (e) { return pluginTrouble('批量改色', '问「这个工作区当前用哪个后端」这一步出错', msgOf(e)) }
    if (!picked.ok) return picked
    let res = null
    try { res = await picked.tracker.setLabelColors(picked.repoRef, changes, opCtxFor(cwd, picked.platform, picked.repoRef, 'wf.setLabelColors', signal)) } catch (e) { return pluginTrouble('批量改色', '后端在改色时抛了异常', msgOf(e)) }
    if (!res || res.ok !== true) return backendFailure(res, '批量改色')
    const data = res.data
    if (!data || typeof data !== 'object' || !Array.isArray(data.applied) || !Array.isArray(data.failed)) return pluginTrouble('批量改色', '后端回的记账里少了「改成功的清单」（applied）或「没改成功的清单」（failed）')
    return { ok: true, backendId: picked.backendId, applied: data.applied, failed: data.failed }
  }
  function hash8(s) { try { const t = String(s || ''); let h = 5381; for (let i = 0; i < t.length; i++) h = (((h << 5) + h + t.charCodeAt(i)) >>> 0); return ('0000000' + h.toString(16)).slice(-8) } catch (e) { return '00000000' } }
  function phoneLog(method, kind, t0, res, err) {
    try {
    if (err !== undefined && err !== null) { if (logCtx) logCtx.fire('warn', 'host.call.fail', { method: method, kind: kind, errorHash: hash8(String((err && err.message) || err)) }) }
    else if (res && res.ok) { if (logCtx) logCtx.fire('info', 'host.call', { method: method, latencyMs: Date.now() - t0, ok: true, kind: kind }) }
    else if (logCtx) logCtx.fire('warn', 'host.call.fail', { method: method, kind: kind, errorHash: hash8(String((res && (res.error || res.errorKind)) || 'workspace-not-ok')) }) } catch (eL) {} }
  function loggedPhone(method, kind, fn) { return async function () { const t0 = Date.now(); try { const r = await fn.apply(null, arguments); phoneLog(method, kind, t0, r); return r } catch (e) { phoneLog(method, kind, t0, null, e); throw e } } }
  return { normCwd: normCwd, handleBind: loggedPhone('wf.bind', 'bind', handleBind), handleBindings: loggedPhone('wf.bindings', 'bindings', handleBindings), handleRegistry: loggedPhone('wf.registry', 'registry', handleRegistry), handleSelection: loggedPhone('wf.selection', 'selection', handleSelection), handleListLabels: loggedPhone('wf.listLabels', 'label-colors', handleListLabels), handleSetLabelColors: loggedPhone('wf.setLabelColors', 'label-colors', handleSetLabelColors) }
}
