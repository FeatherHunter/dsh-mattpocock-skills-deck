// views/versionControl/vcRealModel.ts —— 真实页签的纯逻辑层（#1776 M1）
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼回闭包，跨叶用 declare。
//
// 这里只放不碰 React、不发宿主电话的纯函数：初始读数与界面状态、把首屏七片快照换算成壳的种子与失败清单、
// 页签/齿轮/深链/命令面板的跳转与返回、宽度皮肤、提交目标与改动计数。容器（vcRealTab.ts）与事件分派
// （vcRealDelegate.ts）都只调这一层，门禁也能单独调它们量结果。

declare const VC_TAB_PAGES: any[]
declare const VC_MANAGE_INDEX_PAGE: string
declare function vcPageDepthOf(page: any): number
declare function vcDeepLinkOf(key: any): any
declare function vcPaletteTargetOf(capId: any): any
declare const FIRST_SCREEN_SLICES: string[]
declare function vcNewReads(...args: any[]): any
declare function vcNewFirstScreenRead(...args: any[]): any
declare function vcFirstScreenOf(reads: any): any
declare function vcFirstScreenStateOf(reads: any): any
declare function vcFirstScreenReadAtOf(reads: any): any
declare function vcFirstScreenSliceOf(reads: any, id: any): any
declare function vcFirstScreenSliceStateOf(reads: any, id: any): any
declare function vcFirstScreenSliceErrorOf(reads: any, id: any): any
declare function vcFirstScreenFailedSlicesOf(reads: any): any
declare function vcFirstScreenSliceRetryableOf(reads: any, id: any): any
declare function vcFirstScreenScreenOf(reads: any): any
declare const VC_AI_READ_FAIL_KINDS: string[]
// #1860 相对时间：词条与分档都住在 vcText.vcWhenText 里，跨叶只声明，不复制一套。
declare function vcWhenText(t: any, nowMs: any, ms: any): string
// #1860 原因行：判定理由与词条映射由身份行叶子自己算（vcShellIdentity.vcRailReasonsOf），
//   这里只声明，种子只负责把首屏快照交给它。
declare function vcRailReasonsOf(screen: any, t: any): any[]

// 容器的初始界面状态：#842 的旧写操作状态不再需要，新壳要的是「点开的那笔提交 / 那个文件」与一个
//   用来强制重画动作行的计数（动作层把状态放在闭包里，改完敲一下 liveTick 让 React 重算）。
export const vcRealReadsNew = function (cwd: any): any {
  const reads: any = vcNewReads() || {}
  reads.cwd = String(cwd === undefined || cwd === null ? '' : cwd)
  // vcNewReads 是旧形状（screen/diffs/commit/log），首屏七片快照没有它的槽；这里补上 idle 槽，
  //   之后所有首屏读数都只认 reads.firstScreen（与 vcFirstScreen.ts 的函数约定一致）。
  reads.firstScreen = vcNewFirstScreenRead() || { state: 'idle', data: null, error: null }
  return reads
}

export const vcRealInitialUi = function (): any {
  return { fileShown: {}, openDiff: '', openCommit: '', openFile: '', liveTick: 0, historyQuery: '', historyMergeOnly: false, historyMenu: '' }
}

// 新壳的导航状态：当前页、来源链（二级页的返回目标）、打开的浮层、搜索词与落点高亮，
//   pages 是「离开某一页时的筛选与高亮」记忆，返回时从这里还原。
//   来源页不再是单层：#1840 起管理索引自己也有来源页（页签），从索引进分区页时返回链是
//   「分区页 → 索引 → 页签」三段，一次返回退一层，符合原型 page-back 的弹栈语义。
export const vcRealInitialNav = function (): any {
  return { page: 'changes', depth: 1, back: null, open: { branch: false, palette: false, gear: false, surface: '' }, query: '', highlight: '', pages: {} }
}

// 返回链的一帧：{ page, query, highlight, back }。链只记「离开时按了什么」，不判断业务；
//   给每一帧补上自己的 back，才能从分区页退到索引、再退到进来之前的页签。
const vcRealBackFrameOf = function (frame: any): any {
  if (!frame || !frame.page) return null
  return {
    page: String(frame.page),
    query: String(frame.query === undefined || frame.query === null ? '' : frame.query),
    highlight: String(frame.highlight || ''),
    back: vcRealBackFrameOf(frame.back),
  }
}

// 打开管理索引时的来源页：索引是「临时收起九个分区」的一屏，从哪个分区点齿轮进来都回到那一层页签，
//   不把刚才的分区页塞进返回链（否则第一次返回到一张已经离开的分区页）。找不到页签时返回 null，由调用方兜底。
const vcRealIndexOriginOf = function (cur: any): any {
  let frame: any = cur
  while (frame) {
    if ((VC_TAB_PAGES || []).indexOf(String(frame.page || '')) >= 0) return vcRealBackFrameOf(frame)
    frame = frame.back || null
  }
  return null
}

export const vcRealNavOf = function (nav: any): any {
  const n: any = nav || {}
  const page: string = String(n.page || 'changes')
  return {
    page: page,
    depth: vcPageDepthOf(page),
    back: vcRealBackFrameOf(n.back),
    open: Object.assign({ branch: false, palette: false, gear: false, surface: '' }, n.open || {}),
    query: String(n.query === undefined || n.query === null ? '' : n.query),
    highlight: String(n.highlight || ''),
    pages: n.pages && typeof n.pages === 'object' ? n.pages : {},
  }
}

export const vcRealCwdOf = function (props: any): string {
  const st: any = props && props.st
  const cwd: any = st && st.cwd
  return cwd === undefined || cwd === null ? '' : String(cwd)
}

export const vcRealCwdEmptyOf = function (cwd: any): boolean {
  return String(cwd === undefined || cwd === null ? '' : cwd).trim() === ''
}

// 跳页：走之前把当前页的搜索词记进 pages，进目标页时还原它上次的搜索词；来源页记在 back 链上。
//   管理索引是唯一会换来源记法的页：进它时来源取第一个页签帧（跳过刚离开的分区页），
//   进别的页时把当前页连同它自己的来源页一起接上。页签之间切换不保留来源，由调用方把 back 清掉。
export const vcRealNavTo = function (nav: any, page: any): any {
  const cur: any = vcRealNavOf(nav)
  const next: string = String(page || 'changes')
  if (next === cur.page) return cur
  const pages: any = Object.assign({}, cur.pages)
  pages[cur.page] = { query: cur.query, highlight: cur.highlight }
  const saved: any = pages[next] || {}
  const back: any = next === VC_MANAGE_INDEX_PAGE
    ? (vcRealIndexOriginOf(cur) || { page: cur.page, query: cur.query, highlight: cur.highlight, back: null })
    : { page: cur.page, query: cur.query, highlight: cur.highlight, back: cur.back }
  return {
    page: next,
    depth: vcPageDepthOf(next),
    back: back,
    open: { branch: false, palette: false, gear: false, surface: '' },
    query: String(saved.query === undefined || saved.query === null ? '' : saved.query),
    highlight: String(saved.highlight || ''),
    pages: pages,
  }
}

// 返回来源页：退一层，退到的那一页恢复它自己的来源，搜索词照样从 pages 还原。
//   这样「页签 → 索引 → 分区」两次返回依次回到索引与页签，而不是一步跳到顶。
export const vcRealNavBack = function (nav: any): any {
  const cur: any = vcRealNavOf(nav)
  const frame: any = cur.back
  if (!frame) return cur
  const target: any = vcRealNavTo(cur, frame.page)
  target.back = frame.back || null
  return target
}

// 浮层开合：三个浮层（分支、命令面板、齿轮索引）互斥，开一个就关掉另外两个。
export const vcRealNavToggle = function (nav: any, key: any): any {
  const cur: any = vcRealNavOf(nav)
  const k: string = String(key || '')
  if (k !== 'branch' && k !== 'palette' && k !== 'gear') return cur
  const open: any = { branch: false, palette: false, gear: false, surface: '' }
  open[k] = cur.open[k] !== true
  return Object.assign({}, cur, { open: open })
}

export const vcRealNavCloseAll = function (nav: any): any {
  const cur: any = vcRealNavOf(nav)
  return Object.assign({}, cur, { open: { branch: false, palette: false, gear: false, surface: '' } })
}

// 命令面板输入：只改搜索词，页面与浮层不动；落点高亮跟着清掉（旧高亮和新词不是一回事）。
export const vcRealNavQuery = function (nav: any, query: any): any {
  const cur: any = vcRealNavOf(nav)
  return Object.assign({}, cur, { query: String(query === undefined || query === null ? '' : query), highlight: '' })
}

// 选中一条能力：按 vcPaletteTargetOf 给出的落点跳页并高亮那一条；需要对象上下文的动作只跳转、
//   不在这里执行（executes 恒为 false，执行入口留给能力行自己的确认流程）。
export const vcRealNavSelect = function (nav: any, capId: any): any {
  const target: any = vcPaletteTargetOf(capId)
  const cur: any = vcRealNavOf(nav)
  if (!target) return vcRealNavCloseAll(cur)
  // 命中同页时 vcRealNavTo 会原样返回原来的导航，浮层还开着；选中之后一律关浮层，再落高亮。
  const moved: any = vcRealNavTo(cur, target.page)
  const closed: any = Object.assign({}, moved, { open: { branch: false, palette: false, gear: false, surface: '' } })
  closed.highlight = String(target.capId || '')
  return closed
}

// 键盘 Tabs：左右方向键在四个固定页签之间循环，Home/End 到头尾；其它键不动。
//   返回 { page: '', nav } 表示这次按键不归页签管，调用方别 preventDefault。
export const vcRealTabStepOf = function (nav: any, key: any): any {
  const cur: any = vcRealNavOf(nav)
  const k: string = String(key || '')
  if (k !== 'ArrowLeft' && k !== 'ArrowRight' && k !== 'Home' && k !== 'End') return { page: '', nav: cur }
  const list: any[] = VC_TAB_PAGES || []
  let index: number = list.indexOf(cur.page)
  if (index < 0) index = 0
  if (k === 'ArrowLeft') index = (index + list.length - 1) % list.length
  else if (k === 'ArrowRight') index = (index + 1) % list.length
  else if (k === 'Home') index = 0
  else index = list.length - 1
  const page: string = String(list[index])
  const next: any = vcRealNavTo(cur, page)
  next.back = null
  next.highlight = ''
  return { page: page, nav: next }
}

// 读取时刻印成本地「年-月-日 时:分」，不依赖 Intl（测试机与真机一致）。
export const vcRealWhenTextOf = function (atMs: any): string {
  const ms: number = Number(atMs)
  if (!isFinite(ms) || ms <= 0) return ''
  const d: Date = new Date(ms)
  const pad = function (n: number): string { return n < 10 ? '0' + n : String(n) }
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
}

export const vcRealReadAtMsOf = function (reads: any): number {
  return Number(vcFirstScreenReadAtOf(reads) || 0)
}

// 壳的种子一个对象担两种身份：页面叶子把它当首屏快照（读 slices.*），壳自己当展示种子
//   （seed.branch / seed.remote / seed.when）。所以这里传的是「快照 + 身份行那几样」的合并对象。
// 第四个参数 t 是词条函数：传了就把两个时刻改说相对时间（原型「刚刚」「12 分钟前」）并带上原因行；
//   没传时保持绝对写法与空原因行——静态渲染与旧调用点不该因为容器这一处改动换掉读数形状。
export const vcRealSeedOf = function (reads: any, nav: any, nowMs: any, t: any): any {
  const snapshot: any = vcFirstScreenOf(reads) || {}
  const ws: any = vcFirstScreenSliceOf(reads, 'workspace') || {}
  const identity: any = (ws && ws.data && ws.data.identity) || {}
  const sync: any = vcFirstScreenSliceOf(reads, 'sync') || {}
  const syncData: any = (sync && sync.data) || {}
  const atMs: number = vcRealReadAtMsOf(reads)
  // #1829 身份行要读工作区名、提交号、领先 / 落后与远端依据时间：都从 workspace 片取，缺了给空值，
  //   界面读到空值就少画一格，不拿假数据补位（远端依据时间由同一个时间格式函数统一）。
  const basisMs: number = Number(identity.basisMs || syncData.basisMs || 0)
  const tFn: any = typeof t === 'function' ? t : null
  const nowVal: number = Number(nowMs) > 0 ? Number(nowMs) : Date.now()
  // 两个时刻共用一个格式函数：相对时间窗口只住在 vcWhenText 里（7 天），界面这边不另算一套。
  const whenText = function (ms: number): string { return tFn ? vcWhenText(tFn, nowVal, ms) : vcRealWhenTextOf(ms) }
  return Object.assign({}, snapshot, {
    branch: String(identity.branch || syncData.branch || ''),
    remote: String(syncData.remote || identity.remote || 'origin'),
    when: whenText(atMs),
    nowMs: nowVal,
    query: String(nav && nav.query ? nav.query : ''),
    highlight: String(nav && nav.highlight ? nav.highlight : ''),
    repoDisplay: String(identity.worktreeDisplay || ''),
    worktreePath: String(identity.worktreePath || ''),
    oid: String(identity.oid || ''),
    detached: identity.detached === true,
    ahead: Math.max(0, Number(identity.ahead || syncData.ahead || 0)),
    behind: Math.max(0, Number(identity.behind || syncData.behind || 0)),
    basisWhen: basisMs > 0 ? whenText(basisMs) : '',
    reasons: tFn ? vcRailReasonsOf(vcFirstScreenScreenOf(reads), tFn) : [],
  })
}

// 单片失败清单：整次读取还在进行（idle/loading）时不报失败；整次失败（state=err）时七片都是
//   load-fail —— 快照可能还留着上一次的旧数据，那几片继续可用，由 veraWholeFailOf 单独报总错。
export const vcRealFailuresOf = function (reads: any): any[] {
  const state: string = String(vcFirstScreenStateOf(reads) || '')
  if (state === 'idle' || state === 'loading') return []
  const ids: any[] = vcFirstScreenFailedSlicesOf(reads) || []
  return ids.map(function (id: any) {
    const err: any = vcFirstScreenSliceErrorOf(reads, id) || {}
    return {
      id: String(id),
      state: String(vcFirstScreenSliceStateOf(reads, id) || ''),
      retryable: vcFirstScreenSliceRetryableOf(reads, id) === true,
      kind: String(err.kind || ''),
      message: String(err.message || ''),
    }
  })
}

// 整次读取失败（电话本身没成功、手里没有可用快照）：给总错与「重试整次」用。
export const vcRealWholeFailOf = function (reads: any): any {
  if (String(vcFirstScreenStateOf(reads) || '') !== 'err') return null
  const err: any = (reads && reads.firstScreen && reads.firstScreen.error) || {}
  return { kind: String(err.kind || 'env'), message: String(err.message || '') }
}

export const vcRealSliceNameKeyOf = function (id: any): string {
  return 'vc.shell.slice.' + String(id || '')
}

// 皮肤只认宿主主题开关：body 上有 data-ds-dark-theme 就是深色（A 工程台账），没有就是浅色（C 纸质便签）。
//   服务端渲染（没有 document）按深色画，与壳自己的缺省一致。
export const vcRealSkinOf = function (bodyEl: any): string {
  if (!bodyEl || typeof bodyEl.hasAttribute !== 'function') return 'dark'
  return bodyEl.hasAttribute('data-ds-dark-theme') ? 'dark' : 'light'
}

// 提交目标：首屏 history 片里已经带了提交清单，容器只把它翻成下拉选项（值仍是完整 oid）。
export const vcRealCommitTargetsOf = function (reads: any): any[] {
  const slice: any = vcFirstScreenSliceOf(reads, 'history') || {}
  const data: any = (slice && slice.data) || {}
  const commits: any[] = Array.isArray(data.commits) ? data.commits : []
  return commits.map(function (c: any) {
    const oid: string = String((c && c.oid) || '')
    const short: string = String((c && c.short) || oid.slice(0, 7))
    return { oid: oid, label: short + ' ' + String((c && c.subject) || '') }
  })
}

// 改动页的种子：计数来自首屏 changes 片；values 是表单当前值（由容器持有，动作层按它拼电话参数）。
export const vcRealChangesSeedOf = function (reads: any): any {
  const slice: any = vcFirstScreenSliceOf(reads, 'changes') || {}
  const data: any = (slice && slice.data) || {}
  const unstaged: any[] = Array.isArray(data.unstaged) ? data.unstaged : []
  let untracked: number = 0
  for (let i = 0; i < unstaged.length; i += 1) {
    const row: any = unstaged[i] || {}
    const status: string = String(row.status || row.kind || '')
    if (row.untracked === true || status === '??' || status.indexOf('untracked') >= 0) untracked += 1
  }
  // #1829 文件行要逐行读数：把片里两组 FileEntry 归一成同一形状再交给界面；
  //   缺字段给缺省值（change 缺省 modified、增删行数缺省 null 表示「不知道」），
  //   一个文件同时有暂存与未暂存两边改动时会在两组各出现一行——这正是原型的两组，不在界面里合并。
  const normOf = function (row: any, inStaged: boolean): any {
    const change: string = String((row && row.change) || 'modified')
    return {
      path: String((row && row.path) || ''),
      origPath: String((row && row.origPath) || ''),
      staged: inStaged ? true : row && row.staged === true,
      unstaged: inStaged ? false : true,
      change: change,
      conflict: !!(row && row.conflict === true),
      addedLines: row && typeof row.addedLines === 'number' ? row.addedLines : null,
      deletedLines: row && typeof row.deletedLines === 'number' ? row.deletedLines : null,
      untracked: change === 'untracked' || !!(row && row.untracked === true),
    }
  }
  const stagedRows: any[] = Array.isArray(data.staged) ? data.staged : []
  return {
    counts: {
      staged: Number(data.stagedCount || 0),
      unstaged: Number(data.unstagedCount || 0),
      untracked: untracked,
      conflicts: Number(data.conflictCount || 0),
    },
    values: { path: '', from: '', to: '', hunks: '', hunkIndex: '', filter: 'all' },
    files: {
      staged: stagedRows.map(function (row: any) { return normOf(row, true) }),
      unstaged: unstaged.map(function (row: any) { return normOf(row, false) }),
    },
  }
}

// 四个页签后面的计数（#1776 M4d，规格第 22 与 335 行）：一律用首屏真实读数，不再用能力账本条数。
//   读数还没到（idle / loading / 某一片 err）时给 unknown，页签上画「—」，不拿 0 冒充已知的零。
export const vcRealTabCountsOf = function (reads: any): any {
  const knownOf = function (id: string): boolean {
    return String(vcFirstScreenSliceStateOf(reads, id) || '') === 'ok'
  }
  const dataOf = function (id: string): any {
    const slice: any = vcFirstScreenSliceOf(reads, id) || {}
    return slice.data || {}
  }
  // 改动片：按路径去重数工作区文件；宿主只给计数没给清单时退回两个计数相加。
  const filesOf = function (data: any): number {
    const seen: any = {}
    const add = function (list: any): void {
      if (!Array.isArray(list)) return
      for (let i = 0; i < list.length; i += 1) {
        const row: any = list[i] || {}
        seen[String(row.path || row.file || i)] = 1
      }
    }
    add(data.staged)
    add(data.unstaged)
    const n: number = Object.keys(seen).length
    if (n > 0 || Array.isArray(data.staged) || Array.isArray(data.unstaged)) return n
    return Number(data.stagedCount || 0) + Number(data.unstagedCount || 0)
  }
  const one = function (id: string, count: any): any {
    const known: boolean = knownOf(id)
    return { n: known ? Number(count(dataOf(id)) || 0) : 0, state: known ? 'ok' : 'unknown' }
  }
  return {
    changes: one('changes', filesOf),
    commits: one('history', function (data: any): number { return Array.isArray(data.commits) ? data.commits.length : 0 }),
    worktrees: one('worktrees', function (data: any): number { return Array.isArray(data.others) ? data.others.length : 0 }),
    stash: one('stashes', function (data: any): number { return Array.isArray(data.entries) ? data.entries.length : 0 }),
  }
}

// 顶栏额外入口（#1586 的 VC_DEEP_LINKS 里页签与齿轮覆盖不到的那几个）：全库搜索页、任务页、
//   变基页、冲突页；其余深链落在管理与页签上，已由页签与齿轮覆盖，不重复画按钮。
export const VC_REAL_EXTRA_LINKS: string[] = ['palette', 'task', 'rebase', 'conflicts']

export const vcRealDeeplinkPageOf = function (key: any): string {
  const link: any = vcDeepLinkOf(key)
  return link && link.page ? String(link.page) : ''
}

// 深链来源：容器 props.deeplink 优先（宿主或门禁可以直接给），否则读地址栏里的 ?vc=... 参数；
//   服务端渲染没有 window 时回空串。深链只负责打开位置，不执行任何写动作。
export const vcRealDeepLinkOf = function (props: any): string {
  const p: any = props || {}
  const given: string = String(p.deeplink || '')
  if (given) return given
  if (typeof window === 'undefined' || !window.location) return ''
  const m = /[?&]vc=([^&]+)/.exec(String(window.location.search || ''))
  if (!m) return ''
  try { return decodeURIComponent(m[1]) } catch (e) { return '' }
}

// 深链落成初始导航：认得出的键跳到对应页并记下来源；认不出回 null，容器保持默认首页。
export const vcRealDeepLinkNavOf = function (key: any): any {
  const page: string = vcRealDeeplinkPageOf(key)
  if (!page) return null
  return vcRealNavTo(vcRealInitialNav(), page)
}

// 「让 AI 帮我解决」的候选（规格 48-50、79、387、440）：只在面板解决不了或诊断需要外带时出现。
//   每条给一句具体难处（冲突、进行中的操作、读失败里值得外带的五档、工作树边界），文案全部走既有词条；
//   塞进 prompt 的事实由 vcAiHandoffOf 从首屏快照里取，这里只决定「什么时候给这个入口」。
export const vcRealAiEntriesOf = function (reads: any, nav: any, t: any): any[] {
  const out: any[] = []
  const screen: any = vcFirstScreenScreenOf(reads)
  const repo: any = (screen && screen.repo) || {}
  const data: any = (vcFirstScreenSliceOf(reads, 'changes') || {}).data || {}
  const conflicts: number = Number((screen && (screen as any).conflictCount) || data.conflictCount || 0) || 0
  if (conflicts > 0) {
    let detail: string = t('vc.conflicts.other')
    if (repo.merging === true) detail = t('vc.conflicts.merge')
    else if (repo.rebasing === true) detail = t('vc.conflicts.rebase')
    out.push({ kind: 'conflict', summary: t('vc.conflicts.count', { n: conflicts }), detail: detail })
  }
  const midos: string[] = []
  if (repo.merging === true) midos.push(t('vc.band.merge'))
  if (repo.rebasing === true) midos.push(t('vc.band.rebase'))
  if (repo.cherryPicking === true) midos.push(t('vc.band.cherryPick'))
  if (repo.reverting === true) midos.push(t('vc.band.revert'))
  if (midos.length) out.push({ kind: 'midop', summary: midos.join('、'), detail: t('vc.band.terminalTip') })
  const err: any = (reads && reads.firstScreen && reads.firstScreen.error) || {}
  const failKind: string = String(err.kind || '')
  if (String(vcFirstScreenStateOf(reads) || '') === 'err' && VC_AI_READ_FAIL_KINDS.indexOf(failKind) >= 0) {
    const summary: string = t('vc.fail.' + failKind)
    out.push({
      kind: 'read-fail',
      summary: summary === 'vc.fail.' + failKind ? t('vc.fail.unknown') : summary,
      detail: err.message ? t('vc.fail.raw', { msg: String(err.message) }) : '',
    })
  }
  // 工作区页的交接入口在页面底部（vcWorktreesView 的 wt-foot，原型 worktrees.ts 第 58 行同位置），
  //   顶部这条无条件兜底条会让每个干净的工作区页都多出一个原型没有的区块，所以不再在这里出。
  return out
}

export const vcRealIsMainPageOf = function (page: any): boolean {
  return (VC_TAB_PAGES || []).indexOf(String(page || '')) >= 0
}

// 真源标识：门禁按这一行找本文件，改路径要一起改门禁。
export const VC_REAL_MODEL_SOURCE = 'src/client/views/versionControl/vcRealModel.ts'
