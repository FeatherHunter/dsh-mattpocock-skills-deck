import type { BackendPlatform, OpContext } from '../../contract/contexts.js'
import type { RepositoryRef } from '../../contract/entities.js'
// @ts-expect-error 本域 tsconfig 有意不加载任何类型包（types 为空），
// node:path 的类型声明随 @types/node 被挡在外面；运行时一定是 Node，该模块必然存在。
// 忽略这一行导入的类型错误（纯类型层面，不影响 esbuild 的运行时转译）。
// issues-locate.ts 与 index.ts 的同名导入同理，各自加一行忽略。
import nodePath from 'node:path'

// 运行时的 process 兜底声明：同上因 types 为空而不可见，但 Node 运行时保证存在；
// 只声明本文件实际用到的两个成员（platform/cwd），不产生运行时代码。
declare const process: { cwd(): string; platform: string } | undefined

// 本地票仓引用：契约 RepositoryRef 之外，旧调用与测试夹具会用 path 直接当仓库根
// （见 mdPath 首分支与 issues-read.ts 的夹具兜底），故在此补一个可选 path。
type RepoWithPath = RepositoryRef & { path?: string }
function getPlatformPath(ctx: OpContext | undefined): BackendPlatform['path'] {if(ctx&&ctx.platform&&ctx.platform.path)return ctx.platform.path;if(ctx&&ctx.path)return ctx.path;if(typeof process!=='undefined'&&process.platform==='win32')return nodePath.win32;return nodePath.posix}
function isAbsolute(p: string, plat: BackendPlatform['path']): boolean {try{return plat.isAbsolute(p)}catch{return nodePath.isAbsolute(p)}}
// 全局定位（findIssueFileGlobal）传 null 表「不限仓库」：getRoot 本就全程判空，
// 签名放宽到 null 只为过类型，运行时路径不变。
export function getRoot(repo: RepositoryRef | null, ctx: OpContext | undefined): string {
  const plat=getPlatformPath(ctx)
  const cwd=ctx&&typeof ctx.cwd==='string'?ctx.cwd:(typeof process!=='undefined'&&typeof process.cwd==='function'?process.cwd():'.')
  if(repo&&typeof repo.refId==='string'&&repo.refId.trim()!==''){
    const r=repo.refId.trim()
    if(isAbsolute(r,plat))return r
    return plat.join(cwd,r)
  }
  if(repo&&typeof repo.name==='string'&&repo.name.trim()&&repo.name!==repo.refId){return plat.join(cwd,'.scratch',repo.name)}
  return plat.join(cwd,'.scratch')
}
/** 票文件名规则（唯一实现，mdPath 与 effortIssuePath 共用；两条路径过去各写一份、已经分叉过）。 */
function issueFileName(keyOrSlug: string): string {
  let filename=String(keyOrSlug||'')
  if(!filename)return ''
  if(filename.endsWith('.md'))return filename
  if(/^\d+$/.test(filename))return filename.padStart(2,'0')+'-untitled.md'
  if(/^\d+-/.test(filename))return filename+'.md'
  return filename+'.md'
}
export function mdPath(repo: RepoWithPath | RepositoryRef, kind: string, keyOrSlug: string | undefined, ctx: OpContext | undefined): string {
  // path 是本地后端的自有约定（契约的 RepositoryRef 不带它）：调用方可能只给契约引用
  // （index.ts 里 describe 产的引用就没有 path）；缺 path 时直达分支不成立，经 getRoot 回落。
  // `as` 只为读到 path 这一个键，求值（`direct.path` 为空即走回落）与原来逐字相同。
  const direct=repo as RepoWithPath
  if(repo&&direct.path&&!repo.refId){
    const plat=getPlatformPath(ctx)
    const k=kind
    if(k==='spec')return plat.join(direct.path,'spec.md')
    if(k==='map')return plat.join(direct.path,'map.md')
    if(k==='issue'){const f=String(keyOrSlug||'');return plat.join(direct.path,'issues',f.endsWith('.md')?f:f+'.md')}
    return direct.path
  }
  const plat=getPlatformPath(ctx)
  const root=getRoot(repo,ctx)
  if(kind==='spec')return plat.join(root,'spec.md')
  if(kind==='map')return plat.join(root,'map.md')
  if(kind==='issue'){
    if(!keyOrSlug)throw new Error('mdPath: issue kind requires keyOrSlug')
    return plat.join(root,'issues',issueFileName(keyOrSlug))
  }
  throw new Error('mdPath: unknown kind '+kind)
}
export function issuesDir(repo: RepositoryRef | null, ctx: OpContext | undefined): string {
  const plat=getPlatformPath(ctx)
  const root=getRoot(repo,ctx)
  return plat.join(root,'issues')
}
// ── effort 维度（2026-09-09）：effort 作用域下的路径 ──
// ref.effortId 给出时，路径一律落在 `<cwd>/.scratch/<effortId>/` 下；effortId 为空串 = 根级扁平布局 `<cwd>/.scratch/`。
// 只在「带 effort 范围的引用」上用，未带范围的旧调用保持原 mdPath/getRoot 语义（夹具与历史布局不受影响）。
function effortDirOf(repo: RepositoryRef, ctx: OpContext | undefined): string {
  const plat=getPlatformPath(ctx)
  const cwd=ctx&&typeof ctx.cwd==='string'?ctx.cwd:(typeof process!=='undefined'&&typeof process.cwd==='function'?process.cwd():'.')
  const root=plat.join(cwd,'.scratch')
  const eid=(repo&&repo.effortId!==undefined&&repo.effortId!==null)?String(repo.effortId):''
  return eid?plat.join(root,eid):root
}
export function effortMapPath(repo: RepositoryRef, ctx: OpContext | undefined): string {
  return getPlatformPath(ctx).join(effortDirOf(repo,ctx),'map.md')
}
export function effortIssuePath(repo: RepositoryRef, keyOrSlug: string, ctx: OpContext | undefined): string {
  const plat=getPlatformPath(ctx)
  const filename=issueFileName(keyOrSlug)
  if(!filename)return ''
  return plat.join(effortDirOf(repo,ctx),'issues',filename)
}
export default mdPath
