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
import { parseMd } from './parse.js'
import { readTextFile, listDirOrMissingIsEmpty, statFile, exists } from './read.js'
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
type RepoWithPath = RepositoryRef & { path?: string }
// 定位口的寻址选项：effortId 定范围（null 表显式全仓库），mode 区分读写（写多命中即 conflict）。
interface LocateOpts {
  effortId?: string | null
  mode?: string
}
// 一个命中的文件：路径 + 它所属的 effort（读按目录顺序取第一个，写多命中拒绝猜）。
interface FileHit {
  path: string
  effortId: string
}

export function getPlat(ctx: OpContext): BackendPlatform['path'] {if(ctx&&ctx.platform&&ctx.platform.path)return ctx.platform.path;if(ctx&&ctx.path)return ctx.path;if(typeof process!=='undefined'&&process.platform==='win32')return nodePath.win32;return nodePath.posix}
export async function getScratchRoot(ctx: OpContext): Promise<string> {
  const plat=getPlat(ctx)
  const cwd=ctx&&typeof ctx.cwd==='string'?ctx.cwd:(typeof process!=='undefined'&&typeof process.cwd==='function'?process.cwd():'.')
  return plat.join(cwd,'.scratch')
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
  const entries=await listDirOrMissingIsEmpty(ctx, root)
  const names=entries.filter(function(e: string){ return e && !e.startsWith('.') }).sort()
  for(const e of names){
    const dirPath=plat.join(root,e)
    const mapP=plat.join(dirPath,'map.md')
    try{ if(await exists(ctx, mapP)) out.push({effortId:String(e), dir:dirPath}) }catch{}
  }
  return out
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
/** 按 (effort 范围, 编号) 找票文件。o.mode='write' 时多命中即 conflict；返回 {ok,path,effortId} 或 {ok:false,error}。 */
export async function resolveIssueFile(ctx: OpContext, repo: RepoWithPath | null, key: string, o: LocateOpts = {}): Promise<{ ok: true; path: string; effortId: string } | { ok: false; error: { kind: string; message: string; raw: string } }> {
  const plat=getPlat(ctx)
  const norm=String(key).padStart(2,'0')
  const scope=scopeOf(repo, o)
  const hits: FileHit[]=[]
  const efforts=await listEfforts(ctx)
  for(const e of efforts){
    if(scope!==undefined && e.effortId!==scope) continue
    const idir=plat.join(e.dir,'issues')
    // 票目录不存在算空（这个 effort 还没建过票），读不出来则抛错如实失败（同上）。
    const files=await listDirOrMissingIsEmpty(ctx, idir)
    for(const f of files){
      if(!f || !f.endsWith('.md')) continue
      const m=/^(\d+)-/.exec(f)
      if(!m) continue
      if(m[1].padStart(2,'0')!==norm) continue
      hits.push({ path: plat.join(idir,f), effortId: e.effortId })
    }
  }
  // 兜底要试的那两个目录先声明在函数作用域里：失败时它们要进原文，人才能看出「都找过哪儿」。
  const cands: string[]=[]
  if(hits.length===0){
    // 夹具形态兜底：repo.refId / repo.path 直接当仓库根（单 effort、无 .scratch）
    try{ cands.push(issuesDir(repo,ctx)) }catch{}
    if(repo && repo.path){ try{ cands.push(plat.join(repo.path,'issues')) }catch{} }
    for(const idir of cands){
      const files=await listDirOrMissingIsEmpty(ctx, idir)
      for(const f of files){
        if(!f || !f.endsWith('.md')) continue
        const m=/^(\d+)-/.exec(f)
        if(!m) continue
        if(m[1].padStart(2,'0')!==norm) continue
        hits.push({ path: plat.join(idir,f), effortId: scope!==undefined?scope:'' })
      }
      if(hits.length) break
    }
  }
  // 原文 = 这次找的范围、见过哪些 effort、两个兜底目录各是什么。
  // 本地就能定论（这些地方都没有这个编号的文件），但「找过哪儿」是原文，缺了人只能重猜一遍。
  if(hits.length===0) return failAs(ERROR_KIND.NOTFOUND, 'issue '+norm+' not-found', rawJson({ key:norm, effortId: scope===undefined?null:scope, efforts: efforts.map(function(e){return e.effortId}), fallbackDirs: cands }))
  if(hits.length>1 && o.mode==='write') return conflict(norm, hits)
  return { ok:true, path:hits[0].path, effortId:hits[0].effortId }
}
/** 按 effort 范围找地图文件（map.md）。未给范围且多命中时，读取第一个、写报 conflict。 */
export async function resolveMapFile(ctx: OpContext, repo: RepoWithPath | null, o: LocateOpts = {}): Promise<{ ok: true; path: string; effortId: string } | { ok: false; error: { kind: string; message: string; raw: string } }> {
  const plat=getPlat(ctx)
  const scope=scopeOf(repo, o)
  const hits: FileHit[]=[]
  const efforts=await listEfforts(ctx)
  for(const e of efforts){
    if(scope!==undefined && e.effortId!==scope) continue
    hits.push({ path: plat.join(e.dir,'map.md'), effortId: e.effortId })
  }
  if(hits.length===0){
    try{
      const mapP=plat.join(issuesDir(repo,ctx),'..','map.md')
      if(await exists(ctx,mapP)) hits.push({ path:mapP, effortId: scope!==undefined?scope:'' })
    }catch{}
    if(!hits.length && repo && repo.path){
      try{ const mapP=plat.join(repo.path,'map.md'); if(await exists(ctx,mapP)) hits.push({ path:mapP, effortId: scope!==undefined?scope:'' }) }catch{}
    }
  }
  // 原文 = 这次找的范围与仓库里现有的 effort（本地就能定论：这个范围里没有地图文件）。
  if(hits.length===0) return failAs(ERROR_KIND.NOTFOUND, 'map.md not-found', rawJson({ effortId: scope===undefined?null:scope, efforts: efforts.map(function(e){return e.effortId}) }))
  if(hits.length>1 && o.mode==='write') return conflict('00', hits)
  return { ok:true, path:hits[0].path, effortId:hits[0].effortId }
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
  const key=km?km[1].padStart(2,'0'):String(metaExtra.key||'00').padStart(2,'0')
  const parentKey=metaExtra.parentKey!==undefined?metaExtra.parentKey:null
  const isMap=!!metaExtra.isMap
  const effortId=metaExtra.effortId!==undefined?metaExtra.effortId:''
  // 地址（#1142）：这张票的地址就是刚读的这个文件的路径。读文件这一层是唯一同时知道「是哪张票」与
  // 「它在盘上叫什么名字」的地方，所以在这里把它交给 parseMd；上层（列举、读单张、分页）不必各自再算一遍。
  return parseMd(txt,{key,parentKey,isMap,effortId,createdAt:mtime,updatedAt:mtime,url:fullPath})
}
