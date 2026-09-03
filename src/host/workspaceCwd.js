// src/host/workspaceCwd.js —— 工作区归一与绑定选择（H5 #449 从 host/index.js 302–388 搬出电话体，纯结构、行为零变化）。
// 以后谁改它：改工作区路径归一或后端绑定选择的人。预估约120行，超 350 打回。
// 接线：由 index.js 动态 import 加载；normCwd 由本文件单一持有，评论线程经 index 转供给复用；本文件不引用其他新文件。
export function createWorkspaceCwd(deps) {
  const { ctx, DEFAULT_CWD, getPlatform, getTrackerRegistry, getWorkspaceStore, canonicalKey, setCache } = deps
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
      const sel = await reg.select({ cwd: cwd }, { cwd: cwd, platform: await getPlatform(), fs: ctx.get('fs') })
      let repoRef = null
      if (sel && sel.backendId) { try { repoRef = reg.describe({ cwd: cwd }, sel.backendId) } catch {} }
      return { ok: true, selection: sel, repository: repoRef }
    } catch (e) { return { ok: false, error: String((e && e.message) || e) } }
  }
  return { normCwd, handleBind, handleBindings, handleRegistry, handleSelection }
}
