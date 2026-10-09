// src/host/workspaceCwd.js —— 工作区归一、绑定选择与工作区配置文件落盘（H5 #449 从 host/index.js 302–388 搬出电话体，纯结构、行为零变化；#957 起标签配色两条电话搬到 ./workspaceLabelColors.js）。
// 以后谁改它：改工作区路径归一、后端绑定选择、工作区配置文件落盘（#957 首绑人选与保护自动两写）的人。标签配色两条电话（#627）已搬到 ./workspaceLabelColors.js，改那两条去那边。预估约 200 行，超 350 打回。
// 接线：由 index.js 动态 import 加载；normCwd 由本文件单一持有，评论线程经 index 转供给复用；改色叶子经本文件动态加载（单向，基线有记录），工作区文件纯函数经静态引用（跨层允许）；目录取法调 shared 共用函数（#730）。
import { resolveSessionCwd } from '../shared/session-cwd.js'
import { parseWorkspaceFile, stringifyWorkspaceFile, WORKSPACE_FILE_REL } from '../shared/deck-tools/workspace-file.js'
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
      let workspaceFile = null
      try { workspaceFile = await writeWorkspaceFileOnFirstBind(cwd, persistedBackendId, args) } catch (eW) { workspaceFile = { ok: false, error: { kind: 'env', message: msgOf(eW) } } }
      const out = { ok: true, cwd: cwd, backendId: persistedBackendId, labelColorsFile: labelColorsFile, workspaceFile: workspaceFile, rev: (wr && wr.ok === true) ? (wr.rev || 0) : 0, persisted: !!(wr && wr.ok === true) }
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
  // #957 拆分：改色两条电话住自包含叶子（./workspaceLabelColors.js），本文件只做装配与日志包装（动态加载、单向，同一出口、同一信封、同一 loggedPhone）。
  let _labelColorsP = null
  function labelColorsPhones() { if (!_labelColorsP) _labelColorsP = import('./workspaceLabelColors.js').then(function (m) { return m.createWorkspaceLabelColors({ normCwd: normCwd, getTrackerRegistry: getTrackerRegistry, getPlatform: getPlatform, ctx: ctx, opCtxFor: opCtxFor, resolveSandboxPolicy: resolveSandboxPolicy }) }); return _labelColorsP }
  async function handleListLabels(args) { const p = await labelColorsPhones(); return p.handleListLabels(args) }
  async function handleSetLabelColors(args) { const p = await labelColorsPhones(); return p.handleSetLabelColors(args) }
  function msgOf(e) { return String((e && e.message) || e) }
  // #957 首绑落盘：用户亲手选定的这一下，顺手在工作区里存一份默认后端（幂等：文件已在就一个字都不改）。
  //   只记人选：入参是空（显式无后端逃生舱）不写；文件已在（能读出后端）不覆盖——之后个人切换只写本机记忆 H，工作区默认值保持第一次那个。
  //   写走正规文件通道加本次写许可（与配色文件同一条路：platform.fs + 按会话算的政策）；失败不回滚绑定与 H，但如实放进回包（workspaceFile 一项）。
  async function writeWorkspaceFileOnFirstBind(cwd, backendId, args) {
    if (!backendId || typeof backendId !== 'string' || backendId.trim() === '') return { ok: true, skipped: 'explicit-none' }
    try {
      const reg = await getTrackerRegistry()
      if (!reg || typeof reg.has !== 'function' || !reg.has(backendId)) return { ok: true, skipped: 'unregistered' }
    } catch (e) { return { ok: true, skipped: 'registry-unavailable' } }
    let fsSvc = null
    try {
      const platform = await getPlatform()
      fsSvc = (platform && platform.fs) || null
      if (!fsSvc && ctx && typeof ctx.get === 'function') { try { fsSvc = ctx.get('fs') } catch (eG) { fsSvc = null } }
      if (!fsSvc || typeof fsSvc.resolve !== 'function' || typeof fsSvc.readText !== 'function' || typeof fsSvc.writeText !== 'function') return { ok: false, error: { kind: 'env', message: '首选后端已记下，但工作区配置文件没能存进工作区（这次没拿到可用的文件通道）。绑定与本机记忆不受影响，仍按这次选定的后端走。' } }
      try {
        const target = await fsSvc.resolve(WORKSPACE_FILE_REL, { cwd: cwd })
        const txt = await fsSvc.readText(target)
        const parsed = parseWorkspaceFile(txt)
        if (parsed && typeof parsed.backendId === 'string' && parsed.backendId) return { ok: true, placed: false, reason: 'exists' }
      } catch (eR) {}
      const text = stringifyWorkspaceFile({ backendId: backendId, pickedAt: Date.now(), source: 'user' })
      const sb = resolveSandboxPolicy(args, cwd)
      const target2 = await fsSvc.resolve(WORKSPACE_FILE_REL, { cwd: cwd })
      try {
        const platPath = await getPlatform().then(function (p) { return (p && p.path) || null }).catch(function () { return null })
        if (platPath && typeof platPath.dirname === 'function' && typeof fsSvc.mkdir === 'function') { try { await fsSvc.mkdir(platPath.dirname(target2), { recursive: true }) } catch (eM) {} }
      } catch (eD) {}
      await fsSvc.writeText(target2, text, undefined, undefined, sb.policy)
      return { ok: true, placed: true, reason: 'created' }
    } catch (eW) { return { ok: false, error: { kind: 'env', message: '首选后端已记下，但工作区配置文件没能存进工作区（' + msgOf(eW).slice(0, 120) + '）。绑定与本机记忆不受影响，仍按这次选定的后端走。' } } }
  }
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
        const c = resolveSessionCwd(s) // #730：与电话体同一套取法（从前只认 header.cwd 等 2 个字段会漏读）
        if (!c) continue
        const k = pathKeyOf(c)
        if (!k) continue
        if (inside) { if (k !== want && k.indexOf(prefix) === 0) hits.push(s) }
        else if (k === want) hits.push(s)
      }
      return hits
    } catch (e) { return [] }
  }
  // 政策服务算政策：有归属会话才按会话算（含会话自己的模式）；找不到归属会话就不调服务（#730），
  //   回 undefined 让后端如实报失败，不拿默认政策静默写。
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
      if (!session) return { policy: undefined, sessionId: '' } // #730：无归属会话不取默认政策，免静默落错档
      return { policy: svc.resolve({ session: session }), sessionId: session.id ? String(session.id) : '' }
    } catch (e) { return { policy: undefined, sessionId: '' } }
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