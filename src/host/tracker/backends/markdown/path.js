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
    let filename=String(keyOrSlug)
    if(filename.endsWith('.md'))return plat.join(root,'issues',filename)
    if(/^\d+$/.test(filename)){filename=filename.padStart(2,'0')+'-untitled.md';return plat.join(root,'issues',filename)}
    if(/^\d+-/.test(filename))return plat.join(root,'issues',filename+'.md')
    return plat.join(root,'issues',filename+'.md')
  }
  throw new Error('mdPath: unknown kind '+kind)
}
export function issuesDir(repo,ctx){
  const plat=getPlatformPath(ctx)
  const root=getRoot(repo,ctx)
  return plat.join(root,'issues')
}
export default mdPath
