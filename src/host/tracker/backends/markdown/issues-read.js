// issues-read.js —— 以后改列举与读取单据语义时改它（预估约 200 行）。
//
// effort 维度（2026-09-09）：一个仓库可以有多个 effort，每个 effort 的票各自从 01 编号。
// 本文件的职责是「按 effort 范围列出/读取」，每张票与每张地图都带上 effortId；
// 父子关系只在同一 effort 内成立（子票 parentKey='00' 指的是**本 effort 的地图**）。
import { parseMd } from './parse.js'
import { readTextFile, readDir, statFile } from './read.js'
import { mdPath, issuesDir } from './path.js'
import { classifyError } from '../../preflight.js'
import { ERROR_KIND, idOfParts } from '../../../../shared/tracker/constants.js'
import { getPlat, listEfforts, resolveIssueFile, resolveMapFile, loadIssueFromFile, scopeOf } from './issues-locate.js'
import { loadPaintColorMap, applyLabelColors } from './label-colors-paint.js'

export async function listIssues(ctx,repo,filter={}){
  const plat=getPlat(ctx)
  const colorMap=await loadPaintColorMap(ctx)
  const scope=scopeOf(repo, filter)
  try{
    const efforts=await listEfforts(ctx)
    const out=[]
    // 按 effort 逐个列举；scope 给出时只看那一个 effort
    for(const e of efforts){
      if(scope!==undefined && e.effortId!==scope) continue
      try{
        const mapP=plat.join(e.dir,'map.md')
        const txt=await readTextFile(ctx,mapP)
        const st=await statFile(ctx,mapP)
        let mtime=''
        if(st&&st.mtime){try{mtime=new Date(st.mtime).toISOString()}catch{}}
        const iss=parseMd(txt,{key:'00',parentKey:null,isMap:true,effortId:e.effortId,createdAt:mtime,updatedAt:mtime})
        applyLabelColors(iss, colorMap)
        out.push(iss)
      }catch{}
      const idir=plat.join(e.dir,'issues')
      const files=await readDir(ctx,idir)
      for(const f of files){
        const m=/^(\d+)-/.exec(f)
        if(!m) continue
        if(!f.endsWith('.md')) continue
        const key=m[1].padStart(2,'0')
        if(filter&&Array.isArray(filter.keys)&&filter.keys.length&&!filter.keys.includes(key))continue
        const full=plat.join(idir,f)
        try{const iss=await loadIssueFromFile(ctx,repo,full,{parentKey:'00',isMap:false,effortId:e.effortId});applyLabelColors(iss, colorMap);out.push(iss)}catch{}
      }
    }
    // 夹具形态兜底（repo.path 直接当仓库根、没有 .scratch）：仅在全局一个都没找到时走
    if(out.length===0){
      try{
        const mapP=mdPath(repo,'map',undefined,ctx)
        const txt=await readTextFile(ctx,mapP)
        const st=await statFile(ctx,mapP)
        let mtime=''
        if(st&&st.mtime){try{mtime=new Date(st.mtime).toISOString()}catch{}}
        const iss=parseMd(txt,{key:'00',parentKey:null,isMap:true,effortId:scope||'',createdAt:mtime,updatedAt:mtime})
        applyLabelColors(iss, colorMap)
        out.push(iss)
      }catch{}
      const idir=issuesDir(repo,ctx)
      const files=await readDir(ctx,idir)
      for(const f of files){
        const m=/^(\d+)-/.exec(f)
        if(!m) continue
        if(!f.endsWith('.md')) continue
        const key=m[1].padStart(2,'0')
        if(filter&&Array.isArray(filter.keys)&&filter.keys.length&&!filter.keys.includes(key))continue
        const full=plat.join(idir,f)
        try{const iss=await loadIssueFromFile(ctx,repo,full,{parentKey:'00',isMap:false,effortId:scope||''});applyLabelColors(iss, colorMap);out.push(iss)}catch{}
      }
      // also support repo.path case where map is directly at repo.path
      if(out.length===0 && repo&&repo.path){
        try{
          const plat2=getPlat(ctx)
          const mapP=plat2.join(repo.path,'map.md')
          const txt=await readTextFile(ctx,mapP)
          const iss=parseMd(txt,{key:'00',parentKey:null,isMap:true,effortId:scope||''})
          applyLabelColors(iss, colorMap)
          out.push(iss)
          const idir2=plat2.join(repo.path,'issues')
          const files2=await readDir(ctx,idir2)
          for(const f of files2){
            const m=/^(\d+)-/.exec(f)
            if(!m) continue
            if(!f.endsWith('.md')) continue
            const key=m[1].padStart(2,'0')
            const full=plat2.join(idir2,f)
            try{const iss2=await loadIssueFromFile(ctx,repo,full,{parentKey:'00',isMap:false,effortId:scope||''});applyLabelColors(iss2, colorMap);out.push(iss2)}catch{}
          }
        }catch{}
      }
    }
    // A: 回填 blockedBy 的 title/state（文件约束内满足契约：Blocked by 行只存 key，标题从被引文件首行取）
    //    effort 维度：引用只在**本票所属 effort**内解析，跨 effort 同号票不互相污染。
    try {
      const byKey = {}
      out.forEach(function(it){ if(it && it.key) byKey[idOfParts(it.effortId, String(it.key).padStart(2,'0'))] = it })
      out.forEach(function(it){
        if(!it || !Array.isArray(it.blockedBy)) return
        it.blockedBy.forEach(function(ref){
          const k = ref && ref.key ? String(ref.key).padStart(2,'0') : ''
          const target = k ? byKey[idOfParts(it.effortId, k)] : null
          if(target){
            if(!ref.title) ref.title = target.title || ''
            ref.state = target.state || ref.state || 'OPEN'
          }
        })
      })
    } catch {}
    let filtered=out
    if(filter){
      if(filter.type)filtered=filtered.filter(x=>x.type===filter.type)
      if(filter.state)filtered=filtered.filter(x=>x.state===filter.state)
      if(filter.parentKey!==undefined){
        if(filter.parentKey===null)filtered=filtered.filter(x=>x.parentKey===null)
        else filtered=filtered.filter(x=>x.parentKey===filter.parentKey)
      }
      if(Array.isArray(filter.keys)&&filter.keys.length){filtered=filtered.filter(x=>filter.keys.includes(x.key))}
    }
    filtered.sort((a,b)=>String(a.effortId||'').localeCompare(String(b.effortId||''))||a.key.localeCompare(b.key))
    return{ok:true,data:filtered}
  }catch(e){const kind=e&&e.kind?e.kind:classifyError(e);return{ok:false,error:{kind,message:e&&e.message?e.message:String(e)}}}
}
export async function getIssue(ctx,repo,key,opts={}){
  if(!key)return{ok:false,error:{kind:ERROR_KIND.NOTFOUND,message:'missing key'}}
  const norm=String(key).padStart(2,'0')
  const colorMap=await loadPaintColorMap(ctx)
  const scope=scopeOf(repo, opts)
  if(norm==='00'){
    const r=await resolveMapFile(ctx,repo,{effortId: scope, mode:'read'})
    if(r.ok){
      try{
        const txt=await readTextFile(ctx,r.path)
        const st=await statFile(ctx,r.path)
        let mtime=''
        if(st&&st.mtime){try{mtime=new Date(st.mtime).toISOString()}catch{}}
        const iss=parseMd(txt,{key:norm,parentKey:null,isMap:true,effortId:r.effortId,createdAt:mtime,updatedAt:mtime})
        applyLabelColors(iss, colorMap)
        return{ok:true,data:iss}
      }catch(e){const kind=e&&e.kind?e.kind:classifyError(e);return{ok:false,error:{kind,message:e&&e.message?e.message:String(e)}}}
    }
    return{ok:false,error:r.error}
  }
  const r=await resolveIssueFile(ctx,repo,norm,{effortId: scope, mode:'read'})
  if(r.ok){
    try{const iss=await loadIssueFromFile(ctx,repo,r.path,{parentKey:'00',isMap:false,effortId:r.effortId});applyLabelColors(iss, colorMap);return{ok:true,data:iss}}catch(e){const kind=e&&e.kind?e.kind:classifyError(e);return{ok:false,error:{kind,message:e&&e.message?e.message:String(e)}}}
  }
  return{ok:false,error:r.error}
}
