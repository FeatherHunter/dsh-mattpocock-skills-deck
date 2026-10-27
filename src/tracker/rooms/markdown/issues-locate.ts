// issues-locate.js —— 以后改跨平台路径定位与按编号找文件规则时改它（预估约 200 行）。
//
// effort 维度（2026-09-09）后本文件是**effort 维度的唯一落点**：
//  一个仓库可以有多个 effort（`.scratch/<effort>/`），每个 effort 的票各自从 01 编号，
//  所以「按编号找文件」必须带上 effort 范围。全部读写路径都经本文件的 resolveIssueFile / resolveMapFile，
//  不再各文件自己扫目录（此前 comments.js / graph.js / issues-status.js / issues-patch.js 各有一份拷贝，
//  它们取「按目录顺序第一个命中」，于是给第二个 effort 的票写评论会落到第一个 effort 的同号文件里）。
//
// 范围规则（repo.effortId 或 opts.effortId）：
//  - 给了 effort 标识 → 只在那一个 effort 内找；
//  - 没给（undefined）→ 全仓库找；命中多个 effort 时，**读**按目录顺序回落（保住聊天里 `#01` 链接），
//    **写**返回 conflict 诚实失败，绝不猜（猜错文件是数据损坏，不是显示问题）。
//  - 根级 `.scratch/map.md` 这种扁平历史布局算作 effortId = ''（空串）。
import { parseMd, parentKeyFromFile } from './parse.js'
import { readTextFile, listDir, listDirOrThrow, namesOfListingOrThrow, visibleNamesOf, statFile, exists } from './read.js'
import type { ScratchRootListing } from './scratch-listing.js'
import { issuesDir } from './path.js'
import { ERROR_KIND } from '../../contract/vocabulary.js'
import { failAs, rawJson } from './error-fail.js'
import type { BackendPlatform, OpContext } from '../../contract/contexts.js'
import type { RepositoryRef } from '../../contract/entities.js'
import type { Issue } from '../../contract/entities.js'
// @ts-expect-error 本域 tsconfig 有意不加载任何类型包（types 为空），node:path 的类型声明被挡在外面；
// 运行时一定是 Node，该模块必然存在。忽略这一行导入的类型错误（path.ts 同款，不影响运行时转译）。
import nodePath from 'node:path'

// 运行时的 process 兜底声明：同上因 types 为空而不可见，但 Node 运行时保证存在；
// 只声明本文件实际用到的两个成员（platform/cwd），不产生运行时代码。
declare const process: { cwd(): string; platform: string } | undefined

// 本地票仓引用：契约 RepositoryRef 之外，旧调用与测试夹具会用 path 直接当仓库根，
// 故在此补一个可选 path（path.ts 的 RepoWithPath 同款，各文件自包含、不跨文件引用）。
type RepoWithPath = RepositoryRef & { path?: string; mdScene?: string }
// 定位口的寻址选项：effortId 定范围（null 表显式全仓库），mode 区分读写（写多命中即 conflict）。
interface LocateOpts {
  effortId?: string | null
  mode?: string
}
// 一个命中的文件：路径 + 它所属的 effort（读按目录顺序取第一个，写多命中拒绝猜）。
interface FileHit {
  path: string
  effortId: string
  /** 对外的完整身份串（正常票是两位编号，退化票是 `目录/编号-文件名`）；旧兜底路径给数字编号。 */
  key: string
  /** 命中的是旧版工作区根 issues/ 里的票（读取时留一条兼容日志）。 */
  legacy: boolean
  /** 这张票读回时该带的父容器：有 map.md / spec.md 的工作单元给 '00'，普通票目录给 null。 */
  parentKey: string | null
  /** 这条身份是退化身份（重复编号或文件名没有编号）。 */
  degenerate: boolean
}

export function getPlat(ctx: OpContext): BackendPlatform['path'] {if(ctx&&ctx.platform&&ctx.platform.path)return ctx.platform.path;if(ctx&&ctx.path)return ctx.path;if(typeof process!=='undefined'&&process.platform==='win32')return nodePath.win32;return nodePath.posix}
/** 这次调用看到的工作区根目录（宿主把工作区挂在 ctx.cwd 上）。 */
export function getCwd(ctx: OpContext): string {
  return ctx&&typeof ctx.cwd==='string'?ctx.cwd:(typeof process!=='undefined'&&typeof process.cwd==='function'?process.cwd():'.')
}
export async function getScratchRoot(ctx: OpContext): Promise<string> {
  return getPlat(ctx).join(getCwd(ctx),'.scratch')
}
/** 这个目录是不是旧布局的扁平票目录：工作区根 `<cwd>/issues` 或 `<cwd>/.scratch/issues`。
 *
 *  旧布局只读兼容（#1488 验收③：旧版工作区根 issues/ 的票仍可读、只读、不迁移）：票还在原地、读得到、
 *  列得出，但写路径一律如实失败（状态/关闭/改正文/评论/认领/标签都经 resolveIssueFile 的写模式）。
 *  判据只看路径层次，不看文件形状：`.scratch/<feature>/issues/` 是原文布局的新位置，不算旧布局。 */
export function isLegacyTicketDir(ctx: OpContext, dirPath: string): boolean {
  const plat = getPlat(ctx)
  const norm = function (p: string): string { return String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() }
  const want = norm(dirPath)
  if (!want) return false
  const cwd = getCwd(ctx)
  return want === norm(plat.join(cwd, 'issues')) || want === norm(plat.join(cwd, '.scratch', 'issues'))
}
/** 列出本仓库的全部 effort（顺序稳定：根级扁平布局优先，其余按目录名排序）。返回 [{effortId, dir}]。 */
export async function listEfforts(ctx: OpContext): Promise<{ effortId: string; dir: string }[]> {
  const plat=getPlat(ctx)
  const root=await getScratchRoot(ctx)
  const out: { effortId: string; dir: string }[]=[]
  try{ if(await exists(ctx, plat.join(root,'map.md'))) out.push({effortId:'', dir:root}) }catch{}
  // 列不出 `.scratch` 这一层时：目录不存在算空（全新工作区还没有它，这不是故障）；
  // 目录在却读不出来，就抛错由调用方如实失败 —— 把「读不成」当「一个 effort 都没有」，
  // 会让 counts 回 0、list 回空表，正是 #1174 要根治的那类谎话。
  const entries=await listDirOrThrow(ctx, root)
  const names=visibleNamesOf(entries).sort()
  for(const e of names){
    const dirPath=plat.join(root,e)
    const mapP=plat.join(dirPath,'map.md')
    try{ if(await exists(ctx, mapP)) out.push({effortId:String(e), dir:dirPath}) }catch{}
  }
  return out
}

/**
 * 工作单元目录（#1488）：一个目录只要有 map.md、spec.md、issues/ 里任意一个线索，就是「一个工作单元」。
 * 规格原文的三种形态分别对应：
 *  - map.md  → 探索地图（wayfinder 的 effort）；
 *  - spec.md → 规格（一个 feature 一个目录，规格就在目录根）；
 *  - issues/ → 还没有容器的普通票目录（原文允许先写实施票、规格后补）。
 * 这与 #1488 之前「只认 map.md」的发现口不同：只含 spec.md 或 issues/ 的目录以前被当成空工作区，
 * 预检判 not-found（#1476 实测到的缺陷）。这里的判据只认原文写明的三个名字，不猜别的命名。
 */
export type WorkUnitKind = 'map' | 'spec' | 'plain'
export interface WorkUnit {
  effortId: string
  dir: string
  kind: WorkUnitKind
  /** 旧版布局：工作区根 `<cwd>/issues/`（#1486 之前没给工作单元时票落到这里），只读兼容、不参与写入。 */
  legacy?: boolean
}

/** 一个目录属于哪种工作单元；三个线索都没有时回空串（不算工作单元）。线索判断各自包 try：
 *  问不出来（权限等）按「没有」处理，读的工作由后面的列目录去如实失败，不在发现这一步抛。 */
export async function workUnitKindOf(ctx: OpContext, dir: string): Promise<WorkUnitKind | ''> {
  const plat=getPlat(ctx)
  try{ if(await exists(ctx, plat.join(dir,'map.md'))) return 'map' }catch{}
  try{ if(await exists(ctx, plat.join(dir,'spec.md'))) return 'spec' }catch{}
  try{ if(await exists(ctx, plat.join(dir,'issues'))) return 'plain' }catch{}
  return ''
}

/**
 * 列出全部工作单元（#1488 起读取端统一从这里发现）。顺序稳定：`.scratch` 根级扁平布局优先，
 * 其余按目录名排序；最后补旧版工作区根 `issues/`。
 *
 * 与 listEfforts 的分工：listEfforts 仍是「会写地图的那些单元」的旧口径（写入端与建票取号还要它），
 * 读取端一律用本函数，才能看见只含 spec.md 或 issues/ 的目录。两个口迟早并成一个，等写入端也搬完。
 *
 * #1528：第二个参数允许调用方把**已经列好的** `.scratch` 根目录结果（根路径 + 三态结果，ScratchRootListing）
 *   递进来——一趟环境检查里两项判据要的是同一份名字表，谁先列到就交给后一项，不必再列一次盘。不给就照旧
 *   自己列一次；解析这份结果的口径与 listDirOrThrow 相同（目录本来不存在算空表，其余没读成的照抛）。
 *   根路径对不上时当场抛错：宁可停下，也不拿另一个目录的盘面冒充这一份。
 */
export async function listWorkUnits(ctx: OpContext, prefetchedRootListing?: ScratchRootListing): Promise<WorkUnit[]> {
  const plat=getPlat(ctx)
  const root=await getScratchRoot(ctx)
  if (prefetchedRootListing && prefetchedRootListing.root !== root) {
    throw new TypeError('listWorkUnits 收到的预取列举属于 ' + prefetchedRootListing.root + '，不是 ' + root)
  }
  const out: WorkUnit[]=[]
  const rootKind=await workUnitKindOf(ctx, root)
  if(rootKind) out.push({ effortId:'', dir:root, kind:rootKind })
  // 列不出 `.scratch` 这一层时：目录不存在算空（全新工作区还没有它，这不是故障）；
  // 目录在却读不出来，就抛错由调用方如实失败 —— 把「读不成」当「一个工作单元都没有」，
  // 会让 counts 回 0、list 回空表，正是 #1174 要根治的那类谎话。
  const entries = prefetchedRootListing
    ? namesOfListingOrThrow(prefetchedRootListing.listing)
    : await listDirOrThrow(ctx, root)
  const names=visibleNamesOf(entries).sort()
  for(const e of names){
    const dirPath=plat.join(root,e)
    const kind=await workUnitKindOf(ctx, dirPath)
    if(kind) out.push({ effortId:String(e), dir:dirPath, kind })
  }
  // 旧版布局（#1488 验收③）：#1486 之前没给工作单元时，建票直接落到工作区根 `<cwd>/issues/`。
  // 这些票还在原地，必须照样读得到；标 legacy 只用来在读取时留一条兼容日志，不改变任何行的形状。
  try{
    const cwd=getCwd(ctx)
    const legacyDir=plat.join(cwd,'issues')
    if(await exists(ctx, legacyDir)) out.push({ effortId:'', dir:cwd, kind:'plain', legacy:true })
  }catch{}
  return out
}

/**
 * 票目录里的一个文件，连同它「按目录内编号身份」算出来的寻址串（#1488）。
 *  - 编号在目录里唯一：inner 就是两位编号（`01`），与旧读取行为完全一致；
 *  - 编号重复（同一目录两个 01-*.md）：inner 退化为文件名去掉 .md（`01-买咖啡`），不替用户改号；
 *  - 文件名没有编号：inner 就是文件名去掉 .md（`修复登录`）。
 * degenerate=true 表示这是退化身份，上层拼显示串时要带上工作单元目录名（`目录/编号-文件名`）。
 */
export interface TicketFile {
  file: string
  path: string
  /** 目录内寻址串（不含目录名）。 */
  inner: string
  degenerate: boolean
}

/** 票目录里这几个名字不是票：map.md 是探索地图、spec.md 是规格（容器文件，大小写不敏感）；
 *  notes.md 是旧布局里约定俗成的说明文件（#688 起不算票）。除它们之外的 .md 都当票读——这是
 *  #1488 验收④「文件名里没有编号的手写文件也要有个确定的显示」的落点：没编号的票不丢弃，
 *  退化成文件名本身；只有这三个约定名字继续排除。 */
function isNonTicketFileName(file: string): boolean {
  const n=file.toLowerCase()
  return n==='map.md' || n==='spec.md' || n==='notes.md'
}

/**
 * 把一个票目录里的文件名列表算成每张票的目录内身份（#1488 验收④）。
 * 规则由规格原文 reading.fallbacks 的 duplicate-number 与 enhancements.numbering-display-fallback 定：
 * 同一目录编号重复时不自作主张改号、显示退化为「编号-文件名」；没有编号的把文件名当身份。
 * 两条都只是显示与寻址的退化，不是错误，所以这里不抛错、也不改盘上的文件名。
 */
export function ticketEntriesOf(ctx: OpContext, idir: string, names: string[]): TicketFile[] {
  const plat=getPlat(ctx)
  const md=names.filter(function(f: string){
    return !!f && !f.startsWith('.') && f.toLowerCase().endsWith('.md') && !isNonTicketFileName(f)
  })
  const counts: Record<string, number>={}
  for(const f of md){
    const m=/^(\d+)-/.exec(f)
    if(!m) continue
    const n=m[1].padStart(2,'0')
    counts[n]=(counts[n]||0)+1
  }
  const used: Record<string, boolean>={}
  const out: TicketFile[]=[]
  for(const f of md.sort()){
    const m=/^(\d+)-/.exec(f)
    const n=m?m[1].padStart(2,'0'):''
    let inner=''
    let degenerate=false
    if(n && counts[n]===1) inner=n
    else { inner=f.replace(/\.md$/i,''); degenerate=true }
    // 兜底：两条不同的退化身份不小心撞成同一串时（理论上文件名唯一不会发生），
    // 加序号保证寻址唯一；规则固定为按文件名排序后的第 n 条缀 `-n`。
    let unique=inner
    let seq=1
    while(used[unique]){ seq++; unique=inner+'-'+seq }
    used[unique]=true
    out.push({ file:f, path:plat.join(idir,f), inner:unique, degenerate })
  }
  return out
}

/** 列一个票目录并算出每张票的身份。三态与 read.ts 的 listDir 对齐：missing 表示目录不存在（算空），
 *  其余列不出来要由调用方如实失败（与旧 collectTicketsIn 的严格口径一致）。 */
export type TicketListing =
  | { ok: true; files: TicketFile[] }
  | { ok: false; missing: boolean; error?: unknown }
export async function listTicketFiles(ctx: OpContext, idir: string): Promise<TicketListing> {
  const listing=await listDir(ctx, idir)
  if(listing.ok) return { ok:true, files:ticketEntriesOf(ctx,idir,listing.names) }
  if(listing.missing) return { ok:false, missing:true }
  return { ok:false, missing:false, error:listing.error }
}

/** 一张票对外的 key（#1488）：正常编号保持两位编号（旧行为不变）；退化身份带上工作单元目录名，
 *  界面画出来就是维护者要的 `#目录/编号-文件名`，同一串也用于按 key 读取（内部寻址一起退化）。 */
export function ticketKey(effortId: string, tf: TicketFile): string {
  if(!tf.degenerate) return tf.inner
  return effortId ? effortId+'/'+tf.inner : tf.inner
}

/** 把调用方给的 key 拆成「工作单元前缀 + 目录内身份」（#1488）。正常编号没有斜杠；
 *  退化身份带 `目录/` 前缀，按 key 读取时从这串里找回工作单元范围。 */
export function splitTicketKey(key: string | number): { effortFromKey: string; inner: string } {
  const s=String(key)
  const i=s.indexOf('/')
  return i>=0 ? { effortFromKey:s.slice(0,i), inner:s.slice(i+1) } : { effortFromKey:'', inner:s }
}

/** 兼容旧调用：只要目录路径列表（顺序与 listEfforts 一致）。 */
export async function listEffortDirs(ctx: OpContext): Promise<string[]> {
  return (await listEfforts(ctx)).map(function(e){ return e.dir })
}
/**
 * 取本次调用的 effort 寻址范围（唯一实现，issues-read 也用它，避免两份口径分叉）：
 *  - `opts.effortId` 给出字符串 → 只看这一个 effort；
 *  - `opts.effortId === null` → 明确「全仓库」，连 repo 上的范围也不看（调用方显式要求时的逃生口）；
 *  - 都没给 → 看 `repo.effortId`；仍没有 → 全仓库（undefined）。
 */
export function scopeOf(repo: RepoWithPath | null | undefined, opts: LocateOpts | undefined): string | undefined {
  if(opts && opts.effortId !== undefined) return opts.effortId === null ? undefined : String(opts.effortId)
  if(repo && repo.effortId !== undefined && repo.effortId !== null) return String(repo.effortId)
  return undefined
}
function conflict(key: string, hits: FileHit[]): { ok: false; error: { kind: string; message: string; raw: string } } {
  // 原文 = 命中的那几个文件与它们各自属于哪个 effort（本地就能定论：同名编号出现在多处）。
  // 这段原文正是人判断「该给哪个 effort 加范围」的依据，所以不许省。
  return failAs(ERROR_KIND.CONFLICT, 'issue '+key+' 在 '+hits.length+' 个 effort 里都存在，但没指定 effortId（拒绝猜目标文件）', rawJson(hits))
}
/** 按 (工作单元范围, 编号) 找票文件（#1488 起编号身份由 issues-locate 的目录内身份规则决定）。
 *  o.mode='write' 时多命中即 conflict；返回 {ok,path,effortId,key,legacy} 或 {ok:false,error}。
 *  key 是对外的完整身份串：正常票就是两位编号；退化票是 `目录/编号-文件名`。 */
export async function resolveIssueFile(ctx: OpContext, repo: RepoWithPath | null, key: string, o: LocateOpts = {}): Promise<{ ok: true; path: string; effortId: string; key: string; legacy: boolean; parentKey: string | null; degenerate: boolean } | { ok: false; error: { kind: string; message: string; raw: string } }> {
  const plat=getPlat(ctx)
  const parsed=splitTicketKey(key)
  // 调用方给的编号：纯数字的照旧归一成两位（01 / 1 都认）；退化身份原样当目录内寻址串比对。
  const norm=/^\d+$/.test(parsed.inner)?parsed.inner.padStart(2,'0'):parsed.inner
  let scope=scopeOf(repo, o)
  // 退化身份自带工作单元前缀（`买咖啡积分/01-手写`）：调用方没显式给范围时，从前缀里找回范围。
  if(parsed.effortFromKey && scope===undefined) scope=parsed.effortFromKey
  // 两档命中：exact 是身份串完全相等（正确寻址）；approx 是旧聊天链接 `#01` 落在重复编号目录里的
  // 数字前缀命中 —— 读按目录顺序取第一个（保住旧链接），写多命中照旧 conflict。
  const exact: FileHit[]=[]
  const approx: FileHit[]=[]
  const units=await listWorkUnits(ctx)
  const seenEfforts: string[]=[]
  for(const u of units){
    seenEfforts.push(u.effortId+(u.legacy?'(legacy)':''))
    if(scope!==undefined && u.effortId!==scope) continue
    const idir=plat.join(u.dir,'issues')
    // 票目录不存在算空（这个工作单元还没建过票），读不出来则抛错如实失败（同上）。
    const listing=await listTicketFiles(ctx, idir)
    if(!listing.ok){ if(listing.missing) continue; throw listing.error }
    for(const tf of listing.files){
      const displayKey=ticketKey(u.effortId, tf)
      if(tf.inner===norm || displayKey===String(key)){
        exact.push({ path:tf.path, effortId:u.effortId, key:displayKey, legacy:!!u.legacy, parentKey:(u.kind==='plain'||u.legacy)?null:'00', degenerate:tf.degenerate })
        continue
      }
      // 旧 `#01` 链接：目录里编号重复或没有编号时，按数字前缀找旧编号（只读兜底）。
      if(/^\d+$/.test(norm)){
        const m=/^(\d+)-/.exec(tf.file)
        if(m && m[1].padStart(2,'0')===norm) approx.push({ path:tf.path, effortId:u.effortId, key:displayKey, legacy:!!u.legacy, parentKey:(u.kind==='plain'||u.legacy)?null:'00', degenerate:tf.degenerate })
      }
    }
  }
  // #1486：规格目录（<feature>/spec.md，没有 map.md）也要能按编号读回实施票。
  // listWorkUnits 已经覆盖所有带 issues/ 的目录，这里只补「调用方点名、但目录连 issues/ 都还没有」的形态。
  if(!units.some(function(u){ return u.effortId===scope }) && scope!==undefined){
    const root=await getScratchRoot(ctx)
    const probeDir=plat.join(root, scope)
    const probeKind=await workUnitKindOf(ctx, probeDir)
    const probeParent=probeKind===''||probeKind==='plain'?null:'00'
    const idir=plat.join(probeDir,'issues')
    const listing=await listTicketFiles(ctx, idir)
    if(listing.ok){
      for(const tf of listing.files){
        const displayKey=ticketKey(scope, tf)
        if(tf.inner===norm || displayKey===String(key)) exact.push({ path:tf.path, effortId:scope, key:displayKey, legacy:false, parentKey:probeParent, degenerate:tf.degenerate })
        else if(/^\d+$/.test(norm)){
          const m=/^(\d+)-/.exec(tf.file)
          if(m && m[1].padStart(2,'0')===norm) approx.push({ path:tf.path, effortId:scope, key:displayKey, legacy:false, parentKey:probeParent, degenerate:tf.degenerate })
        }
      }
    }
  }
  const hits=exact.length?exact:approx
  // 兜底要试的那两个目录先声明在函数作用域里：失败时它们要进原文，人才能看出「都找过哪儿」。
  const cands: string[]=[]
  if(hits.length===0){
    // 夹具形态兜底：repo.refId / repo.path 直接当仓库根（单 effort、无 .scratch）
    try{ cands.push(issuesDir(repo,ctx)) }catch{}
    if(repo && repo.path){ try{ cands.push(plat.join(repo.path,'issues')) }catch{} }
    for(const idir of cands){
      const files=await listDirOrThrow(ctx, idir)
      for(const f of files){
        if(!f || !f.endsWith('.md')) continue
        const m=/^(\d+)-/.exec(f)
        if(!m) continue
        if(m[1].padStart(2,'0')!==norm) continue
        hits.push({ path: plat.join(idir,f), effortId: scope!==undefined?scope:'', key:norm, legacy:isLegacyTicketDir(ctx,idir), parentKey:'00', degenerate:false })
      }
      if(hits.length) break
    }
  }
  // 原文 = 这次找的范围、见过哪些工作单元、两个兜底目录各是什么。
  // 本地就能定论（这些地方都没有这个编号的文件），但「找过哪儿」是原文，缺了人只能重猜一遍。
  if(hits.length===0) return failAs(ERROR_KIND.NOTFOUND, 'issue '+norm+' not-found', rawJson({ key:norm, effortId: scope===undefined?null:scope, efforts: seenEfforts, fallbackDirs: cands }))
  if(hits.length>1 && o.mode==='write') return conflict(norm, hits)
  const hit=hits[0]
  // #1480 两轴评审修（#1488 验收③「旧布局只读兼容、不迁移」）：读路径一个字节不变，写路径在这里如实失败。
  // 拦在定位这一层，是因为状态、关闭、改正文、评论、认领、标签全都经 resolveIssueFile 的写模式找文件。
  if(o.mode==='write' && (hit.legacy || isLegacyTicketDir(ctx, plat.dirname(hit.path)))) {
    return failAs(ERROR_KIND.UNSUPPORTED, '旧布局的票只读：'+hit.path+' 落在旧版工作区根或「.scratch」的 issues/ 扁平目录里，本次一个字都没写；迁移另行处理', rawJson({key:norm,path:hit.path,legacy:true}))
  }
  return { ok:true, path:hit.path, effortId:hit.effortId, key:hit.key, legacy:!!hit.legacy, parentKey:hit.parentKey, degenerate:!!hit.degenerate }
}
/** 按 effort 范围找地图文件（map.md）。未给范围且多命中时，读取第一个、写报 conflict。 */
export async function resolveMapFile(ctx: OpContext, repo: RepoWithPath | null, o: LocateOpts = {}): Promise<{ ok: true; path: string; effortId: string } | { ok: false; error: { kind: string; message: string; raw: string } }> {
  const plat=getPlat(ctx)
  const scope=scopeOf(repo, o)
  const hits: FileHit[]=[]
  const efforts=await listEfforts(ctx)
  for(const e of efforts){
    if(scope!==undefined && e.effortId!==scope) continue
    hits.push({ path: plat.join(e.dir,'map.md'), effortId: e.effortId, key:'00', legacy:false, parentKey:null, degenerate:false })
  }
  if(hits.length===0){
    try{
      const mapP=plat.join(issuesDir(repo,ctx),'..','map.md')
      if(await exists(ctx,mapP)) hits.push({ path:mapP, effortId: scope!==undefined?scope:'', key:'00', legacy:false, parentKey:null, degenerate:false })
    }catch{}
    if(!hits.length && repo && repo.path){
      try{ const mapP=plat.join(repo.path,'map.md'); if(await exists(ctx,mapP)) hits.push({ path:mapP, effortId: scope!==undefined?scope:'', key:'00', legacy:false, parentKey:null, degenerate:false }) }catch{}
    }
  }
  // 原文 = 这次找的范围与仓库里现有的 effort（本地就能定论：这个范围里没有地图文件）。
  if(hits.length===0) return failAs(ERROR_KIND.NOTFOUND, 'map.md not-found', rawJson({ effortId: scope===undefined?null:scope, efforts: efforts.map(function(e){return e.effortId}) }))
  if(hits.length>1 && o.mode==='write') return conflict('00', hits)
  return { ok:true, path:hits[0].path, effortId:hits[0].effortId }
}
/** 按 effort 范围找规格文件（`<feature>/spec.md`）。#1486 起规格是「00 号容器」的另一种形状：
 *
 *  旧布局里 00 是探索地图（map.md），新布局里一个 feature 目录也可以只有 spec.md。
 *  调用方用 `mdScene` 说明自己说的是哪套词汇（feature 找 spec、effort 找 map）；没说明时先找 spec、
 *  找不到再回落 map，保证老工作区的 `#00` 链接照旧打开地图。
 *
 *  未给范围且多命中时，读按目录顺序取第一个、写报 conflict —— 与 resolveMapFile 同一口径。 */
export async function resolveSpecFile(ctx: OpContext, repo: RepoWithPath | null, o: LocateOpts = {}): Promise<{ ok: true; path: string; effortId: string } | { ok: false; error: { kind: string; message: string; raw: string } }> {
  const plat=getPlat(ctx)
  const scope=scopeOf(repo, o)
  const scratch=await getScratchRoot(ctx)
  const hits: FileHit[]=[]
  if(scope!==undefined){
    const p=plat.join(scratch, scope, 'spec.md')
    try{ if(await exists(ctx,p)) hits.push({ path:p, effortId:scope, key:'00', legacy:false, parentKey:null, degenerate:false }) }catch{}
  } else {
    // 根级扁平布局（repo.path / refId 直接当仓库根）也要认。
    try{ const p=plat.join(issuesDir(repo,ctx),'..','spec.md'); if(await exists(ctx,p)) hits.push({ path:p, effortId:'', key:'00', legacy:false, parentKey:null, degenerate:false }) }catch{}
    if(!hits.length && repo && repo.path){
      try{ const p=plat.join(repo.path,'spec.md'); if(await exists(ctx,p)) hits.push({ path:p, effortId:'', key:'00', legacy:false, parentKey:null, degenerate:false }) }catch{}
    }
    if(!hits.length){
      const entries=await listDirOrThrow(ctx, scratch)
      const names=visibleNamesOf(entries).sort()
      for(const e of names){
        const p=plat.join(scratch,e,'spec.md')
        try{ if(await exists(ctx,p)) hits.push({ path:p, effortId:String(e), key:'00', legacy:false, parentKey:null, degenerate:false }) }catch{}
      }
    }
  }
  if(hits.length===0) return failAs(ERROR_KIND.NOTFOUND, 'spec.md not-found', rawJson({ effortId: scope===undefined?null:scope }))
  if(hits.length>1 && o.mode==='write') return conflict('00', hits)
  return { ok:true, path:hits[0].path, effortId:hits[0].effortId }
}
/** 00 号容器（规格或地图）的定位：读取侧与写入侧共用同一顺序（#1480 两轴评审确认的偏差收口）。
 *
 *  读取侧不带范围时先找 spec、再找 map；写入侧以前不带 mdScene 就一律当 map，于是
 *  「不带 feature 参数读到的规格」关不掉、或被当成地图改。顺序收在这一处，两边不再各抄一遍：
 *   · mdScene==='effort' 只认地图；mdScene==='feature' 只认规格；
 *   · 没给：先找规格（按 mode），成功即规格；再找地图，成功即地图；
 *   · 都失败：按读取侧优先级报错（点明 feature 就报规格的错，否则报地图的错）。
 *  调用方靠 container 决定读回时给 parseMd 递 isMap/kind。 */
export async function locateContainerFile(ctx: OpContext, repo: RepoWithPath | null, mode: string): Promise<{ ok: true; path: string; effortId: string; container: 'spec' | 'map' } | { ok: false; error: { kind: string; message: string; raw: string } }> {
  const scene = String(repo && repo.mdScene || '')
  let specError: { kind: string; message: string; raw: string } | null = null
  if (scene !== 'effort') {
    const spec = await resolveSpecFile(ctx, repo, { mode })
    if (spec.ok) return { ok: true, path: spec.path, effortId: spec.effortId, container: 'spec' }
    specError = spec.error || null
  }
  const map = await resolveMapFile(ctx, repo, { mode })
  if (map.ok) return { ok: true, path: map.path, effortId: map.effortId, container: 'map' }
  return { ok: false, error: (scene === 'feature' && specError) ? specError : map.error }
}
/** 兼容旧接口：全局按编号找（读语义，取第一个命中）。新代码请用 resolveIssueFile。 */
export async function findIssueFileGlobal(ctx: OpContext, key: string): Promise<string | null> {
  const r=await resolveIssueFile(ctx, null, key, { mode:'read' })
  return r.ok?r.path:null
}
/** 兼容旧接口：按仓库/effort 找（读语义）。新代码请用 resolveIssueFile。 */
export async function findIssueFileInEffort(ctx: OpContext, repo: RepoWithPath | { effortId?: string | null } | null, key: string): Promise<string | null> {
  // 建票探测时用目标 effort 现拼 `{effortId}`（issues-create.js）：解析器只读 effortId/path/refId
  // （读不到就回落，见 resolveIssueFile），断言只收类型视野，运行时还是原来那个对象。
  const r=await resolveIssueFile(ctx, repo as RepoWithPath | null, key, { mode:'read' })
  return r.ok?r.path:null
}

// 读单票文件的元数据：调用方只给零散线索（编号/父子/effort），地址由 fullPath 直接给；
// 形状与 ParseMeta 对齐（多出的键一律不收，免得调用方把无关东西塞进解析）。
interface FileMetaExtra {
  key?: string | number
  parentKey?: string | null
  isMap?: boolean
  effortId?: string
}
export async function loadIssueFromFile(ctx: OpContext, repo: RepoWithPath | null, fullPath: string, metaExtra: FileMetaExtra = {}): Promise<Issue> {
  const txt=await readTextFile(ctx,fullPath)
  const st=await statFile(ctx,fullPath)
  let mtime=''
  if(st){
    // stat 的契约类型是 unknown（各实现给出的字段不一）；运行时刻读 mtime/mtimeMs/ctime 三路回落，cast 只为过类型。
    const s=st as Record<string, unknown>
    const t=s.mtime||s.mtimeMs||s.ctime
    if(t){try{mtime=new Date(t as string | number | Date).toISOString()}catch{} if(!mtime&&typeof t==='number'){try{mtime=new Date(t).toISOString()}catch{}}}
    if(!mtime&&s.mtime)mtime=String(s.mtime)
  }
  const base=fullPath.split(/[\\/]/).pop()||''
  const km=/^(\d+)-/.exec(base)
  // #1488：退化身份（重复编号的 `01-文件名`、没有编号的 `修复登录`）由调用方按目录内身份算好放进 metaExtra.key；
  // 它可以出现在文件名开头是数字的票上，所以调用方给了就以它为准。没给才按旧规则从文件名推编号。
  const key=metaExtra.key!==undefined?String(metaExtra.key):(km?km[1].padStart(2,'0'):'00')
  const parentKey=metaExtra.parentKey!==undefined?metaExtra.parentKey:null
  // #1486：老布局的票没有父注释时，调用方按 effort 补 parentKey='00'（地图子票的旧约定）。
  // 新布局（文件头有 DSH-FORMAT）必须只认文件里的 DSH-PARENT：同一目录里普通票不是规格的子票，
  // 再按调用方补 00 会把普通票算成规格子票，收口核对就会多数一张、关不掉规格。
  const newLayout=/<!--[ \t]*DSH-FORMAT[ \t]*:/i.test(txt)
  const fileParent=parentKeyFromFile(txt)
  const effectiveParent=newLayout?(fileParent.found?fileParent.value:null):parentKey
  const isMap=!!metaExtra.isMap
  const effortId=metaExtra.effortId!==undefined?metaExtra.effortId:''
  // 地址（#1142）：这张票的地址就是刚读的这个文件的路径。读文件这一层是唯一同时知道「是哪张票」与
  // 「它在盘上叫什么名字」的地方，所以在这里把它交给 parseMd；上层（列举、读单张、分页）不必各自再算一遍。
  // #1486：新布局不再写 DSH-ISSUE-KIND，文件名就是身份线索：spec.md 是规格容器。
  const kind=base.toLowerCase()==='spec.md'?'spec':''
  return parseMd(txt,{key,parentKey:effectiveParent,isMap,effortId,createdAt:mtime,updatedAt:mtime,url:fullPath,kind})
}
