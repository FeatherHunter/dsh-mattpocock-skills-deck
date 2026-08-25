import { ERROR_KIND } from '../../../../shared/tracker/constants.js'
import { mdPath } from './path.js'
import { parseMd } from './parse.js'
import { normalizeIssue } from './normalize.js'
import { readTextFile, exists } from './read.js'
import { listIssues, getIssue, createIssue, closeIssue, reopenIssue, updateIssue, setBlockedByIssue, setAssigneesIssue, setParentIssue } from './issues.js'
import { getDependenciesForKey } from './graph.js'
import { addComment } from './comments.js'
import nodePath from 'node:path'
function getPlat(ctx){if(ctx&&ctx.platform&&ctx.platform.path)return ctx.platform.path;if(ctx&&ctx.path)return ctx.path;if(typeof process!=='undefined'&&process.platform==='win32')return nodePath.win32;return nodePath.posix}
function isAbsolute(p,plat){try{return plat.isAbsolute(p)}catch{return nodePath.isAbsolute(p)}}
export async function matches(handle, ctx){
  try{
    const cwd=handle&&handle.cwd?String(handle.cwd):(handle&&handle.refId?String(handle.refId):'')
    if(!cwd)return false
    const plat=getPlat(ctx)
    let candidatePaths=[]
    if(handle.refId&&String(handle.refId).includes('.scratch')){
      const p=isAbsolute(String(handle.refId),plat)?String(handle.refId):plat.join(cwd,String(handle.refId))
      candidatePaths.push(plat.join(p,'map.md'))
      candidatePaths.push(p)
    }
    const root=plat.join(cwd,'.scratch')
    candidatePaths.push(plat.join(root,'map.md'))
    try{
      const fs=ctx&&ctx.platform?ctx.platform.fs:(ctx&&ctx.fs)||(ctx&&typeof ctx.get==='function'?ctx.get('fs'):null)
      let entries=[]
      if(fs&&typeof fs.resolve==='function'&&typeof fs.listDir==='function'){try{const t=await fs.resolve(root);entries=await fs.listDir(t)}catch{}}
      else if(fs&&typeof fs.readdir==='function'){try{entries=await fs.readdir(root)}catch{}}
      for(const e of entries){
        const name=typeof e==='string'?e:(e&&e.name)||''
        if(!name||name.startsWith('.'))continue
        candidatePaths.push(plat.join(root,name,'map.md'))
      }
    }catch{}
    for(const p of candidatePaths){if(await exists(ctx,p))return true}
    return false
  }catch{return false}
}
export function describe(handle, backendId){
  const cwd=handle&&handle.cwd?String(handle.cwd):''
  const refId=handle&&handle.refId?String(handle.refId):(cwd?cwd:'')
  const finalRef=refId||cwd||''
  const name=finalRef?finalRef.split(/[\\/]/).pop()||finalRef:backendId
  return{backend:backendId,refId:finalRef,name:name||backendId,url:''}
}
export function createMarkdownBackend(ctx){
  const unsupported=(op)=>({ok:false,error:{kind:ERROR_KIND.UNSUPPORTED,message:'markdown '+op+' unsupported (labels MISSING per #134)'}})
  return{
    id:'markdown',
    preflight: async (handle,opCtx)=>{
      const c=opCtx||ctx
      try{
        const repo=handle&&handle.backend?handle:describe(handle,'markdown')
        const mapP=mdPath(repo,'map',undefined,c)
        if(await exists(c,mapP))return{ok:true}
        const plat=getPlat(c)
        const cwd=(handle&&handle.cwd)||(c&&c.cwd)||''
        if(cwd){
          const root=plat.join(cwd,'.scratch')
          if(await exists(c,plat.join(root,'map.md')))return{ok:true}
        }
        return{ok:false,error:{kind:ERROR_KIND.NOTFOUND,message:'markdown map.md not-found'}}
      }catch(e){const kind=e&&e.kind?e.kind:ERROR_KIND.ENV;return{ok:false,error:{kind,message:e&&e.message?e.message:String(e)}}}
    },
    list:(repo,filter,opCtx)=>listIssues(opCtx||ctx,repo,filter),
    get:(repo,key,opts,opCtx)=>getIssue(opCtx||ctx,repo,key),
    getDependencies:(repo,key,opts,opCtx)=>getDependenciesForKey(opCtx||ctx,repo,key),
    create:(repo,input,opCtx)=>createIssue(opCtx||ctx,repo,input),
    close:(repo,key,opts,opCtx)=>closeIssue(opCtx||ctx,repo,key),
    reopen:(repo,key,opCtx)=>reopenIssue(opCtx||ctx,repo,key),
    comment:(repo,key,body,opCtx)=>addComment(opCtx||ctx,repo,key,body),
    update:(repo,key,patch,opCtx)=>updateIssue(opCtx||ctx,repo,key,patch),
    setLabels:()=>unsupported('setLabels'),
    setAssignees:(repo,key,assignees,opts,opCtx)=>setAssigneesIssue(opCtx||ctx,repo,key,assignees),
    setParent:(repo,key,parentKey,opts,opCtx)=>setParentIssue(opCtx||ctx,repo,key,parentKey),
    setBlockedBy:(repo,key,blockers,opts,opCtx)=>setBlockedByIssue(opCtx||ctx,repo,key,blockers),
    normalize:normalizeIssue,
    parse:parseMd,
  }
}
export const markdownModule = {
  id: 'markdown',
  label: 'Markdown',
  presentation: { color: '#1a7f37' },
  create: createMarkdownBackend,
  matches,
}
export default createMarkdownBackend
