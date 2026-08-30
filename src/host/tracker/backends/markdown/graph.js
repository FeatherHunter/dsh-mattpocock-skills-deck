import { parseMd } from './parse.js'
import { readTextFile, readDir, exists } from './read.js'
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
export async function readBlockedBy(ctx, repo, key){
  const plat=getPlatformPath(ctx)
  const norm=String(key).padStart(2,'0')
  // global search
  const dirs=await listEffortDirs(ctx)
  for(const dir of dirs){
    const idir=plat.join(dir,'issues')
    const files=await readDir(ctx,idir)
    for(const f of files){
      const m=/^(\d+)-/.exec(f)
      if(!m) continue
      if(m[1].padStart(2,'0')!==norm) continue
      if(!f.endsWith('.md')) continue
      const full=plat.join(idir,f)
      try{
        const txt=await readTextFile(ctx,full)
        const issue=parseMd(txt,{key:norm,parentKey:'00',isMap:false})
        return{ok:true,data:issue.blockedBy||[]}
      }catch(e){}
    }
  }
  // fallback per-repo
  const idir=issuesDir(repo,ctx)
  try{
    const files=await readDir(ctx,idir)
    for(const f of files){
      const m=/^(\d+)-/.exec(f)
      if(!m) continue
      if(m[1].padStart(2,'0')!==norm) continue
      if(!f.endsWith('.md')) continue
      const full=plat.join(idir,f)
      const txt=await readTextFile(ctx,full)
      const issue=parseMd(txt,{key:norm,parentKey:null,isMap:false})
      return{ok:true,data:issue.blockedBy||[]}
    }
  }catch{}
  // repo.path fallback
  if(repo&&repo.path){
    try{
      const plat2=getPlat(ctx)
      const idir2=plat2.join(repo.path,'issues')
      const files=await readDir(ctx,idir2)
      for(const f of files){
        const m=/^(\d+)-/.exec(f)
        if(!m) continue
        if(m[1].padStart(2,'0')!==norm) continue
        const full=plat2.join(idir2,f)
        const txt=await readTextFile(ctx,full)
        const issue=parseMd(txt,{key:norm,parentKey:null,isMap:false})
        return{ok:true,data:issue.blockedBy||[]}
      }
    }catch{}
  }
  return{ok:false,error:{kind:ERROR_KIND.NOTFOUND,message:'issue '+key+' not-found'}}
}
export async function getDependenciesForKey(ctx, repo, key){
  const plat=getPlatformPath(ctx);const normalizedKey=String(key).padStart(2,'0')
  const r=await readBlockedBy(ctx,repo,normalizedKey)
  if(!r.ok)return r
  const blockedBy=r.data||[]
  if(blockedBy.some(ref=>ref&&ref.key===normalizedKey)){return{ok:false,error:{kind:ERROR_KIND.CONFLICT,message:'self-block '+normalizedKey}}}
  let blocking=[]
  const dirs=await listEffortDirs(ctx)
  const searchDirs = dirs.length ? dirs : [null]
  // 回填 blockedBy 标题（文件约束内满足契约：被引文件首行标题即 title）
  try {
    for(let _i=0; _i<blockedBy.length; _i++){
      const ref=blockedBy[_i]
      if(ref && ref.title) continue
      const rk=ref && ref.key ? String(ref.key).padStart(2,'0') : ''
      if(!rk) continue
      let foundTitle='', foundState=''
      for(const dir of searchDirs){
        let idirTmp
        if(dir) idirTmp=plat.join(dir,'issues')
        else idirTmp=issuesDir(repo,ctx)
        try{
          const filesTmp=await readDir(ctx,idirTmp)
          for(const f of filesTmp){
            const m=/^(\d+)-/.exec(f)
            if(!m) continue
            if(m[1].padStart(2,'0')!==rk) continue
            const fullTmp=plat.join(idirTmp,f)
            try{
              const txtTmp=await readTextFile(ctx,fullTmp)
              const issTmp=parseMd(txtTmp,{key:rk,parentKey:'00',isMap:false})
              foundTitle=issTmp.title||''
              foundState=issTmp.state||''
              break
            }catch{}
          }
          if(foundTitle) break
        }catch{}
      }
      if(!foundTitle && rk==='00'){
        for(const dir of dirs){
          const mapP=plat.join(dir,'map.md')
          try{
            const txtMap=await readTextFile(ctx,mapP)
            const issMap=parseMd(txtMap,{key:'00',parentKey:null,isMap:true})
            foundTitle=issMap.title||''
            foundState=issMap.state||''
            if(foundTitle) break
          }catch{}
        }
      }
      if(foundTitle) ref.title=foundTitle
      if(foundState) ref.state=foundState
    }
  } catch {}
  for(const dir of searchDirs){
    let idir
    if(dir) idir=plat.join(dir,'issues')
    else idir=issuesDir(repo,ctx)
    try{
      const files=await readDir(ctx,idir)
      for(const f of files){
        const m=/^(\d+)-/.exec(f)
        if(!m) continue
        if(!f.endsWith('.md')) continue
        const k=m[1].padStart(2,'0')
        if(k===normalizedKey)continue
        const full=plat.join(idir,f)
        try{
          const txt=await readTextFile(ctx,full)
          const iss=parseMd(txt,{key:k,parentKey:'00',isMap:false})
          const b=iss.blockedBy||[]
          if(b.some(ref=>ref&&ref.key===normalizedKey)){blocking.push({key:k,title:iss.title||'',state:iss.state})}
        }catch{}
      }
    }catch{}
  }
  // also check repo.path fallback if not already covered
  if(repo&&repo.path){
    try{
      const plat2=getPlat(ctx)
      const idir2=plat2.join(repo.path,'issues')
      // avoid duplicate if already in dirs
      const already = dirs.some(d=>d===repo.path)
      if(!already){
        const files=await readDir(ctx,idir2)
        for(const f of files){
          const m=/^(\d+)-/.exec(f)
          if(!m) continue
          if(!f.endsWith('.md')) continue
          const k=m[1].padStart(2,'0')
          if(k===normalizedKey)continue
          if(blocking.some(b=>b.key===k)) continue
          const full=plat2.join(idir2,f)
          try{
            const txt=await readTextFile(ctx,full)
            const iss=parseMd(txt,{key:k,parentKey:'00',isMap:false})
            const b=iss.blockedBy||[]
            if(b.some(ref=>ref&&ref.key===normalizedKey)){blocking.push({key:k,title:iss.title||'',state:iss.state})}
          }catch{}
        }
      }
    }catch{}
  }
  return{ok:true,data:{blockedBy,blocking}}
}
export {getDependenciesForKey as getDependencies}
export default{readBlockedBy,getDependencies:getDependenciesForKey}
