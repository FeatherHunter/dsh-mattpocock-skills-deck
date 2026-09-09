import nodePath from 'node:path'
function getPlatformPath(ctx){if(ctx&&ctx.platform&&ctx.platform.path)return ctx.platform.path;if(ctx&&ctx.path)return ctx.path;if(typeof process!=='undefined'&&process.platform==='win32')return nodePath.win32;return nodePath.posix}
function isAbsolute(p,plat){try{return plat.isAbsolute(p)}catch{return nodePath.isAbsolute(p)}}
export function getRoot(repo,ctx){
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
function issueFileName(keyOrSlug){
  let filename=String(keyOrSlug||'')
  if(!filename)return ''
  if(filename.endsWith('.md'))return filename
  if(/^\d+$/.test(filename))return filename.padStart(2,'0')+'-untitled.md'
  if(/^\d+-/.test(filename))return filename+'.md'
  return filename+'.md'
}
export function mdPath(repo,kind,keyOrSlug,ctx){
  if(repo&&repo.path&&!repo.refId){
    const plat=getPlatformPath(ctx)
    const k=kind
    if(k==='spec')return plat.join(repo.path,'spec.md')
    if(k==='map')return plat.join(repo.path,'map.md')
    if(k==='issue'){const f=String(keyOrSlug||'');return plat.join(repo.path,'issues',f.endsWith('.md')?f:f+'.md')}
    return repo.path
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
export function issuesDir(repo,ctx){
  const plat=getPlatformPath(ctx)
  const root=getRoot(repo,ctx)
  return plat.join(root,'issues')
}
// ── effort 维度（2026-09-09）：effort 作用域下的路径 ──
// ref.effortId 给出时，路径一律落在 `<cwd>/.scratch/<effortId>/` 下；effortId 为空串 = 根级扁平布局 `<cwd>/.scratch/`。
// 只在「带 effort 范围的引用」上用，未带范围的旧调用保持原 mdPath/getRoot 语义（夹具与历史布局不受影响）。
function effortDirOf(repo,ctx){
  const plat=getPlatformPath(ctx)
  const cwd=ctx&&typeof ctx.cwd==='string'?ctx.cwd:(typeof process!=='undefined'&&typeof process.cwd==='function'?process.cwd():'.')
  const root=plat.join(cwd,'.scratch')
  const eid=(repo&&repo.effortId!==undefined&&repo.effortId!==null)?String(repo.effortId):''
  return eid?plat.join(root,eid):root
}
export function effortMapPath(repo,ctx){
  return getPlatformPath(ctx).join(effortDirOf(repo,ctx),'map.md')
}
export function effortIssuePath(repo,keyOrSlug,ctx){
  const plat=getPlatformPath(ctx)
  const filename=issueFileName(keyOrSlug)
  if(!filename)return ''
  return plat.join(effortDirOf(repo,ctx),'issues',filename)
}
export default mdPath
