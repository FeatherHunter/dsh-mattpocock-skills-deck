import { parseMd } from './parse.js'
import { readTextFile, readDir, exists } from './read.js'
import { writeTextFile } from './write.js'
import { issuesDir } from './path.js'
import { classifyError } from '../../preflight.js'
import { ERROR_KIND } from '../../../../shared/tracker/constants.js'
import nodePath from 'node:path'
function getPlatformPath(ctx){if(ctx&&ctx.platform&&ctx.platform.path)return ctx.platform.path;if(ctx&&ctx.path)return ctx.path;if(typeof process!=='undefined'&&process.platform==='win32')return nodePath.win32;return nodePath.posix}
function getPlat(ctx){if(ctx&&ctx.platform&&ctx.platform.path)return ctx.platform.path;if(ctx&&ctx.path)return ctx.path;if(typeof process!=='undefined'&&process.platform==='win32')return nodePath.win32;return nodePath.posix}
async function getScratchRoot(ctx){
  const plat=getPlat(ctx)
  const cwd=ctx&&typeof ctx.cwd==='string'?ctx.cwd:(typeof process!=='undefined'&&typeof process.cwd==='function'?process.cwd():'.')
  return plat.join(cwd,'.scratch')
}
async function listEffortDirs(ctx){
  const plat=getPlat(ctx)
  const root=await getScratchRoot(ctx)
  const out=[]
  try{ if(await exists(ctx, plat.join(root,'map.md'))) out.push(root) }catch{}
  let entries=[]
  try{ entries=await readDir(ctx, root) }catch{ entries=[] }
  for(const e of entries){
    if(!e || e.startsWith('.')) continue
    const dirPath=plat.join(root,e)
    const mapP=plat.join(dirPath,'map.md')
    try{ if(await exists(ctx, mapP)) out.push(dirPath) }catch{}
  }
  return out
}
async function findIssueFile(ctx,repo,key){
  const plat=getPlatformPath(ctx)
  const norm=String(key).padStart(2,'0')
  const dirs=await listEffortDirs(ctx)
  for(const dir of dirs){
    const idir=plat.join(dir,'issues')
    const files=await readDir(ctx,idir)
    for(const f of files){
      const m=/^(\d+)-/.exec(f)
      if(!m) continue
      if(m[1].padStart(2,'0')!==norm) continue
      if(!f.endsWith('.md')) continue
      return plat.join(idir,f)
    }
  }
  const idir=issuesDir(repo,ctx)
  try{
    const files=await readDir(ctx,idir)
    for(const f of files){
      const m=/^(\d+)-/.exec(f)
      if(!m) continue
      if(m[1].padStart(2,'0')!==norm) continue
      if(!f.endsWith('.md')) continue
      return plat.join(idir,f)
    }
  }catch{}
  if(repo&&repo.path){
    try{
      const plat2=getPlat(ctx)
      const idir2=plat2.join(repo.path,'issues')
      const files=await readDir(ctx,idir2)
      for(const f of files){
        const m=/^(\d+)-/.exec(f)
        if(!m) continue
        if(m[1].padStart(2,'0')!==norm) continue
        if(!f.endsWith('.md')) continue
        return plat2.join(idir2,f)
      }
    }catch{}
  }
  return null
}
export async function listComments(ctx,repo,key){
  const full=await findIssueFile(ctx,repo,key)
  if(!full)return{ok:false,error:{kind:ERROR_KIND.NOTFOUND,message:'issue '+key+' not-found'}}
  try{const txt=await readTextFile(ctx,full);const iss=parseMd(txt,{key:String(key).padStart(2,'0'),parentKey:'00',isMap:false});return{ok:true,data:iss.comments||[]}}catch(e){const kind=e&&e.kind?e.kind:classifyError(e);return{ok:false,error:{kind,message:e&&e.message?e.message:String(e)}}}
}
export async function addComment(ctx,repo,key,body){
  const full=await findIssueFile(ctx,repo,key)
  if(!full)return{ok:false,error:{kind:ERROR_KIND.NOTFOUND,message:'issue '+key+' not-found'}}
  try{
    let txt=await readTextFile(ctx,full)
    const nowIso=new Date().toISOString()
    const actor=(ctx&&ctx.actor)||'local'
    const block='### '+actor+' \u2014 '+nowIso+'\n'+String(body||'').trim()+'\n'
    const re=/^\s*##\s*Comments\s*$/im
    const m=re.exec(txt)
    if(m){
      const start=m.index+m[0].length
      const after=txt.slice(start)
      const nextH2=/^\s*##\s+/m.exec(after)
      if(nextH2){
        const insertPos=start+nextH2.index
        txt=txt.slice(0,insertPos)+'\n'+block+'\n'+txt.slice(insertPos)
      }else{
        if(!txt.endsWith('\n'))txt+='\n'
        txt+='\n'+block+'\n'
      }
    }else{
      if(!txt.endsWith('\n'))txt+='\n'
      txt+='\n## Comments\n\n'+block+'\n'
    }
    await writeTextFile(ctx,full,txt)
    const comment={author:{login:actor},authorAssociation:'',body:String(body||''),createdAt:nowIso,updatedAt:nowIso}
    return{ok:true,data:comment}
  }catch(e){const kind=e&&e.kind?e.kind:classifyError(e);return{ok:false,error:{kind,message:e&&e.message?e.message:String(e)}}}
}
export default{listComments,addComment}
