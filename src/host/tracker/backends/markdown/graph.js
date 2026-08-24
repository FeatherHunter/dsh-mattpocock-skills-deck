import { parseMd } from './parse.js'
import { readTextFile, readDir } from './read.js'
import { issuesDir } from './path.js'
import { classifyError } from '../../preflight.js'
import { ERROR_KIND } from '../../../../shared/tracker/constants.js'
import nodePath from 'node:path'
function getPlatformPath(ctx){if(ctx&&ctx.platform&&ctx.platform.path)return ctx.platform.path;if(ctx&&ctx.path)return ctx.path;if(typeof process!=='undefined'&&process.platform==='win32')return nodePath.win32;return nodePath.posix}
export async function readBlockedBy(ctx, repo, key){
  const plat=getPlatformPath(ctx);const idir=issuesDir(repo,ctx)
  try{
    const files=await readDir(ctx,idir)
    const prefix=String(key).padStart(2,'0')+'-'
    const hit=files.find(f=>f.startsWith(prefix)&&f.endsWith('.md'))
    if(!hit)return{ok:false,error:{kind:ERROR_KIND.NOTFOUND,message:'issue '+key+' not-found'}}
    const full=plat.join(idir,hit)
    const txt=await readTextFile(ctx,full)
    const issue=parseMd(txt,{key:String(key).padStart(2,'0'),parentKey:null,isMap:false})
    return{ok:true,data:issue.blockedBy||[]}
  }catch(e){const kind=e&&e.kind?e.kind:classifyError(e);return{ok:false,error:{kind,message:e&&e.message?e.message:String(e)}}}
}
export async function getDependenciesForKey(ctx, repo, key){
  const plat=getPlatformPath(ctx);const normalizedKey=String(key).padStart(2,'0')
  const r=await readBlockedBy(ctx,repo,normalizedKey)
  if(!r.ok)return r
  const blockedBy=r.data||[]
  if(blockedBy.some(ref=>ref&&ref.key===normalizedKey)){return{ok:false,error:{kind:ERROR_KIND.CONFLICT,message:'self-block '+normalizedKey}}}
  const idir=issuesDir(repo,ctx)
  let blocking=[]
  try{
    const files=await readDir(ctx,idir)
    for(const f of files){
      if(!/^\d+-/.test(f)||!f.endsWith('.md'))continue
      const k=f.slice(0,2)
      if(k===normalizedKey)continue
      const full=plat.join(idir,f)
      try{
        const txt=await readTextFile(ctx,full)
        const iss=parseMd(txt,{key:k,parentKey:null,isMap:false})
        const b=iss.blockedBy||[]
        if(b.some(ref=>ref&&ref.key===normalizedKey)){blocking.push({key:k,title:iss.title||'',state:iss.state})}
      }catch{}
    }
  }catch{}
  return{ok:true,data:{blockedBy,blocking}}
}
export {getDependenciesForKey as getDependencies}
export default{readBlockedBy,getDependencies:getDependenciesForKey}
