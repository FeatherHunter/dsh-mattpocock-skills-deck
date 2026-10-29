/**
 * client/kernel/link.ts — 客户端 URL 契约 helper（#227 引入 · #231 模板化重写 · 清尾批终态）。
 *
 * 真源链：后端模块声明 links.{issueUrlTemplate,repoUrlTemplate,searchUrlTemplate,linkPatternSource}
 * → wf.registry / 快照 backendModules 双通道透传 → 本文件按模板渲染，**零 backendId 分支、零品牌 URL 字面量**。
 * 元数据未达（旧宿主/极早窗口）：返回空串 —— 诚实缺该形态（D8：markdown '' UI 按空不渲染；同理适用于一切无据可依场景）。
 * 本文件从 .js 改名而来（改名是搬家线做的）；我补了类型标注与环境声明，
 * 并做了 #1199 的修复：https 分支在没有 window 的环境回假。
 * #1649 补了详情缓存兜底：已关闭票的快照行被瘦身丢 url 时，用详情页取到的 url 取址。
 */
declare const shared: any;
declare function idOfParts(...args: any[]): any;
declare function idOf(...args: any[]): any;
declare function backendPromptFrom(...args: any[]): any;
declare function declaredLangPick(...args: any[]): any;
function __sel(st: any) { return st && (st.selection || (st.snapshot && st.snapshot.selection)) }
function __backendId(st: any) { const s = __sel(st); return s ? s.backendId : null }
function __refIdOf(st: any) {
  const repo = st && st.snapshot && (st.snapshot.repository || st.snapshot.repo)
  const repo2 = st && st.repository
  if (repo && typeof repo.refId === 'string' && repo.refId) return repo.refId
  if (repo && repo.owner && repo.name) return repo.owner + '/' + repo.name
  if (repo2 && typeof repo2.refId === 'string' && repo2.refId) return repo2.refId
  if (repo2 && repo2.owner && repo2.name) return repo2.owner + '/' + repo2.name
  return ''
}
function __metaLinks(st: any) {
  const bid = __backendId(st)
  if (bid == null) return null
  const ms = st && st.backendModules
  if (!Array.isArray(ms)) return null
  for (let i = 0; i < ms.length; i++) {
    const m = ms[i]
    if (m && m.id === bid && m.links && typeof m.links === 'object') return m.links
  }
  return null
}
/** 各后端 links.linkPatternSource 的可用来源：本会话快照优先，回退全局共享缓存。 */
function __patternSources(st: any) {
  const out: any[] = []
  const ms = (st && Array.isArray(st.backendModules)) ? st.backendModules
    : ((typeof shared !== 'undefined' && shared && Array.isArray(shared.backendModules)) ? shared.backendModules : null)
  if (ms) for (let i = 0; i < ms.length; i++) {
    const m = ms[i]
    if (m && m.links && m.links.linkPatternSource) out.push(String(m.links.linkPatternSource))
  }
  return out
}
export const issueUrlFor = (st: any, key: any, effortId?: any): any => {
  // 优先用后端现算的 url（markdown 的盘符路径已在快照 issues[].url 中）；回退到模板渲染（github）
  // 0 是容器行（key 00）的合法编号，不能当空：这里不能用 ||，否则 0 会被压成空串直接回空。
  const n = (key === undefined || key === null) ? '' : String(key).trim()
  if (!n) return ''
  // 快照直取：若当前快照中该 key 已有 url（markdown 文件路径），直接用，避免模板为空时回空。
  // effort 维度：编号在仓库内不再唯一，给了 effortId 就按 (effort, 编号) 精确取，否则退回第一个命中（旧行为）。
  try {
    const snap = st && st.snapshot
    // #1557：容器行（探索地图 / 实施规格）自己也住在快照 maps[] 里 —— 它的 url 是 map.md / spec.md
    // 的路径。以前这里只翻 issues 与 maps[].tickets，容器编号（00）永远查不到地址，
    // 「在跟踪器打开」于是点了没反应（剩下的模板回退对本地后端是空串）。
    const all = snap ? [].concat(snap.issues||[]).concat(snap.maps||[]).concat((snap.maps||[]).flatMap(function(m: any){return m.tickets||[]})) : []
    const wantId = (effortId !== undefined && effortId !== null) ? idOfParts(effortId, String(n).padStart(2,'0')) : ''
    let hit: any = null
    if (wantId) hit = all.find(function(x: any){ return idOf(x) === wantId })
    if (!hit) hit = all.find(function(x: any){ return String(x.key).padStart(2,'0')===String(n).padStart(2,'0') || String(x.number)===String(n) })
    if(hit && hit.url) return String(hit.url)
  } catch {}
  // #1649：已关闭容器里的已关闭子票在快照里只剩瘦身行（thinTickets 只有六样字段，没有 url），
  // Markdown 后端又没有 issueUrlTemplate，快照查找与模板回退都会回空串，rowActionText 于是把
  // 注入文本第二行写成 `#编号`（用户看到的 `#3`）。详情页其实已经拉过这张票的详情，回包里有 url；
  // fetchIssueDetail 按 (effortId, 编号) 写进 st.issueCache，这里用同一把键把那份权威地址取回来。
  // 只认完全相同的 (effort, 编号)：编号归一到数字再拼键（快照里的 key 可能带前导零，缓存键不带），
  // effort 不同的同号票绝不串用。
  try {
    const cache = st && st.issueCache
    const num = Number(n)
    if (cache && Number.isFinite(num)) {
      const cacheKey = idOfParts((effortId === undefined || effortId === null) ? '' : String(effortId), num)
      const entry = cache[cacheKey]
      const detailUrl = entry && entry.data && entry.data.url
      if (detailUrl) return String(detailUrl)
    }
  } catch {}
  const meta = __metaLinks(st)
  if (!meta) return ''
  const tpl = String(meta.issueUrlTemplate || '')
  if (!tpl) return ''
  const refId = __refIdOf(st)
  if (!refId) return ''
  return tpl.split('{refId}').join(refId).split('{key}').join(n)
}
// 统一打开：https 走新页，本地路径走宿主打开（UI 零分支）。
// #1557 起视图不再自己按地址前缀分流，而是先问 openModeFor / 要开就调 openTrackerTarget（见下）。
export const openIssueUrl = function(st: any, key: any, host: any, effortId?: any): any {
  return openTrackerTarget(st, key, host, effortId, 'issue')
}

/** 从发给界面的后端描述里取本会话的模块清单（st 优先，回退全局共享缓存）。 */
function __backendModules(st: any): any[] {
  const own = (st && Array.isArray(st.backendModules)) ? st.backendModules : null
  if (own) return own
  const sh = (typeof shared !== 'undefined' && shared && Array.isArray(shared.backendModules)) ? shared.backendModules : null
  return sh || []
}
/**
 * 后端声明的打开方式：`kind === 'container'` 看 openContainer，其余看 openIssue。
 * 没声明（旧后端 / 第三方后端 / 旧宿主）回空串——由 openModeFor 按地址回退旧行为。
 */
export function openModeDeclared(st: any, kind?: any): any {
  const bid = __backendId(st)
  if (bid == null) return ''
  const ms = __backendModules(st)
  for (let i = 0; i < ms.length; i++) {
    const m = ms[i]
    if (!m || m.id !== bid) continue
    return kind === 'container' ? String(m.openContainer || '') : String(m.openIssue || '')
  }
  return ''
}
/**
 * 这个地址按哪种方式打开：'url'（浏览器）/ 'file'（宿主开文件）/ 'folder'（宿主开文件所在目录）。
 * 视图用它决定渲染外链 `<a>` 还是按钮；真正打开交给 openTrackerTarget。
 * 回退：后端声明 → 地址像网页就 'url'（旧行为）→ 否则 'file'（旧行为：宿主开路径）。
 */
export function openModeFor(st: any, kind: any, url: any): any {
  const declared = openModeDeclared(st, kind)
  if (declared === 'url' || declared === 'file' || declared === 'folder') return declared
  return /^https?:\/\//i.test(String(url || '')) ? 'url' : 'file'
}
/**
 * 统一打开「票 / 容器」：按后端声明的方式分派（#1557），视图只调它，不再各自复制 http 分支。
 * - 'url'：浏览器新页；没有 window 的环境诚实回 false（#1199 的约定）。
 * - 'file'：宿主 wf.openPath 打开票文件（本地 Markdown 的票就是一个 .md 文件）。
 * - 'folder'：宿主 wf.openFolder 打开容器文件所在目录；父目录由宿主用平台能力解析
 *   （客户端拿不到平台对象，见 src/host/pickerShell.ts 的 handleOpenFolder 注释）。
 * 地址为空 → false（不发无意义的电话）；打开失败的日志由宿主电话统一记 host.call.fail，界面不重复记。
 */
export const openTrackerTarget = function(st: any, key: any, host: any, effortId?: any, kind?: any): any {
  const u = issueUrlFor(st, key, effortId)
  if (!u) return false
  const mode = openModeFor(st, kind, u)
  if (mode === 'url') { if (typeof window === 'undefined') return false; try { window.open(u, '_blank', 'noreferrer') } catch (e) {} return true }
  try {
    if (!host || typeof host.call !== 'function') return false
    if (mode === 'folder') host.call('wf.openFolder', { file: u })
    else host.call('wf.openPath', { path: u })
    return true
  } catch (e) {}
  return false
}
export const searchUrlFor = (st: any, name: any): any => {
  const n = String(name || '').trim()
  if (!n) return ''
  const meta = __metaLinks(st)
  if (!meta) return ''
  const tpl = String(meta.searchUrlTemplate || '')
  if (!tpl) return ''
  return tpl.split('{q}').join(encodeURIComponent(n))
}
export const repoUrlFor = (st: any): any => {
  // 宿主 describe 产出的 url 是权威值：任何后端、只要给 url 就直用
  const repoFirst = st && (st.snapshot && (st.snapshot.repository || st.snapshot.repo))
  if (repoFirst && repoFirst.url) return repoFirst.url
  const meta = __metaLinks(st)
  if (!meta) return ''
  const tpl = String(meta.repoUrlTemplate || '')
  if (!tpl) return ''
  const refId = __refIdOf(st)
  if (!refId) return ''
  return tpl.split('{refId}').join(refId)
}
/** 新会话锚点/提及识别（#231 清尾终态）：扫描式样只来自各后端 links.linkPatternSource 声明；无数据 → 无识别（诚实）。 */
export function issueRefNumbersFrom(text: any, st: any): any {
  const s = String(text || '')
  if (!s) return []
  const srcs = __patternSources(st)
  if (!srcs.length) return []
  const out: any[] = []
  const have: any = {}
  for (let k = 0; k < srcs.length; k++) {
    try {
      const re = new RegExp(srcs[k], 'g')
      let m: any
      while ((m = re.exec(s)) !== null) { const n = Number(m[1]); if (!have[n]) { have[n] = true; out.push(n) } }
    } catch (e) {}
  }
  return out
}

// #684：「体检」这条提示词条目的 {subject} 占位符 —— 后端在 src/host/tracker/backends/<id>/index.js 的
//   prompts.healthCheck 里声明自己那份科目（GitHub 是游离的开放票归位、GitLab 照同一套、本地 Markdown 是两条
//   文件级判据）；client 只按当前后端查表填空，零 backendId 字面量分支 —— 与 subIssue 同一条路。
//   后端没声明该键（含快照里没有这个后端）时返回空串：总纲照旧完整，只是少一节后端自己的科目。
//   住在这里而不是 prompts.js：那个文件已经贴着 350 行上限（仓库的文件行数门禁）。
export const healthCheckParamsFrom = function (modules: any, backendId: any): any {
  const dict = backendPromptFrom(modules, backendId, 'healthCheck')
  return { subject: declaredLangPick(dict, promptLang()) }
}
