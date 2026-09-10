// graph.js —— 以后改阻塞关系读取时改它（预估约 120 行）。
//
// effort 维度（2026-09-09）：阻塞关系只在**同一 effort 内**成立。
//   - blockedBy 里的编号在本票所属 effort 内解析（含 '00' = 本 effort 的地图）；
//   - blocking（反向聚合）只扫同一个 effort 的 issues 目录，不跨 effort 互相干扰。
import { parseMd } from './parse.js'
import { readTextFile, readDir } from './read.js'
import { getPlat, listEfforts, resolveIssueFile, resolveMapFile } from './issues-locate.js'
import { ERROR_KIND } from '../../../../shared/tracker/constants.js'

export async function readBlockedBy(ctx, repo, key){
  const norm=String(key).padStart(2,'0')
  const r=await resolveIssueFile(ctx,repo,norm,{mode:'read'})
  if(!r.ok)return{ok:false,error:r.error}
  try{
    const txt=await readTextFile(ctx,r.path)
    const issue=parseMd(txt,{key:norm,parentKey:'00',isMap:false,effortId:r.effortId})
    return{ok:true,data:issue.blockedBy||[],effortId:r.effortId}
  }catch(e){const kind=e&&e.kind?e.kind:ERROR_KIND.NOTFOUND;return{ok:false,error:{kind,message:e&&e.message?e.message:String(e)}}}
}
export async function getDependenciesForKey(ctx, repo, key){
  const plat=getPlat(ctx)
  const normalizedKey=String(key).padStart(2,'0')
  const r=await readBlockedBy(ctx,repo,normalizedKey)
  if(!r.ok)return r
  const effortId=r.effortId||''
  const blockedBy=r.data||[]
  if(blockedBy.some(ref=>ref&&ref.key===normalizedKey)){return{ok:false,error:{kind:ERROR_KIND.CONFLICT,message:'self-block '+normalizedKey}}}
  // 本 effort 的目录（找不到就退回仓库根 issues 夹具形态）
  const efforts=await listEfforts(ctx)
  const mine=efforts.find(function(e){ return e.effortId===effortId })
  const idirs=mine?[plat.join(mine.dir,'issues')]:[]
  // 回填 blockedBy 的 title/state：同 effort 内解析（'00' 指本 effort 的地图）
  try{
    for(const ref of blockedBy){
      if(!ref || ref.title) continue
      const rk=ref.key?String(ref.key).padStart(2,'0'):''
      if(!rk) continue
      if(rk==='00'){
        const mr=await resolveMapFile(ctx,repo,{effortId, mode:'read'})
        if(mr.ok){
          try{ const t=await readTextFile(ctx,mr.path); const iss=parseMd(t,{key:'00',parentKey:null,isMap:true,effortId}); ref.title=iss.title||''; ref.state=iss.state||'' }catch(e){}
        }
        continue
      }
      const tr=await resolveIssueFile(ctx,repo,rk,{effortId, mode:'read'})
      if(!tr.ok) continue
      try{ const t=await readTextFile(ctx,tr.path); const iss=parseMd(t,{key:rk,parentKey:'00',isMap:false,effortId}); ref.title=iss.title||''; ref.state=iss.state||'' }catch(e){}
    }
  }catch(e){}
  // 反向聚合：只扫本 effort
  const blocking=[]
  for(const idir of idirs){
    let files=[]
    try{ files=await readDir(ctx,idir) }catch(e){ files=[] }
    for(const f of files){
      if(!f||!f.endsWith('.md')) continue
      const m=/^(\d+)-/.exec(f)
      if(!m) continue
      const k=m[1].padStart(2,'0')
      if(k===normalizedKey) continue
      const full=plat.join(idir,f)
      try{
        const txt=await readTextFile(ctx,full)
        const iss=parseMd(txt,{key:k,parentKey:'00',isMap:false,effortId})
        const b=iss.blockedBy||[]
        if(b.some(ref=>ref&&ref.key===normalizedKey)){blocking.push({key:k,title:iss.title||'',state:iss.state})}
      }catch(e){}
    }
  }
  return{ok:true,data:{blockedBy,blocking}}
}
export {getDependenciesForKey as getDependencies}
export default{readBlockedBy,getDependencies:getDependenciesForKey}
