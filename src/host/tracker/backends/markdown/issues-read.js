// issues-read.js —— 以后改列举与读取单据语义时改它（预估约 195 行）。
import { parseMd } from './parse.js'
import { readTextFile, readDir, statFile } from './read.js'
import { mdPath, issuesDir } from './path.js'
import { classifyError } from '../../preflight.js'
import { ERROR_KIND } from '../../../../shared/tracker/constants.js'
import { getPlat, listEffortDirs, findIssueFileGlobal, findIssueFileInEffort, loadIssueFromFile } from './issues-locate.js'
import { loadPaletteMap, recolorLabels } from './issues-labels.js'

export async function listIssues(ctx,repo,filter={}){
  const plat=getPlat(ctx)
  const paletteMap=await loadPaletteMap(ctx)
  try{
    const effortDirs=await listEffortDirs(ctx)
    const out=[]
    // Global enumeration path
    if(effortDirs.length>0){
      for(const effortPath of effortDirs){
        try{
          const mapP=plat.join(effortPath,'map.md')
          const txt=await readTextFile(ctx,mapP)
          const st=await statFile(ctx,mapP)
          let mtime=''
          if(st&&st.mtime){try{mtime=new Date(st.mtime).toISOString()}catch{}}
          const iss=parseMd(txt,{key:'00',parentKey:null,isMap:true,createdAt:mtime,updatedAt:mtime})
          recolorLabels(iss, paletteMap)
          out.push(iss)
        }catch{}
        const idir=plat.join(effortPath,'issues')
        const files=await readDir(ctx,idir)
        for(const f of files){
          const m=/^(\d+)-/.exec(f)
          if(!m) continue
          if(!f.endsWith('.md')) continue
          const key=m[1].padStart(2,'0')
          if(filter&&Array.isArray(filter.keys)&&filter.keys.length&&!filter.keys.includes(key))continue
          const full=plat.join(idir,f)
          try{const iss=await loadIssueFromFile(ctx,repo,full,{parentKey:'00',isMap:false});recolorLabels(iss, paletteMap);out.push(iss)}catch{}
        }
      }
    }
    // Fallback for repo.path based fixture (tests use repo.path = demo-full) — when global found nothing, try repo direct
    if(out.length===0){
      try{
        const mapP=mdPath(repo,'map',undefined,ctx)
        const txt=await readTextFile(ctx,mapP)
        const st=await statFile(ctx,mapP)
        let mtime=''
        if(st&&st.mtime){try{mtime=new Date(st.mtime).toISOString()}catch{}}
        const iss=parseMd(txt,{key:'00',parentKey:null,isMap:true,createdAt:mtime,updatedAt:mtime})
        recolorLabels(iss, paletteMap)
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
        try{const iss=await loadIssueFromFile(ctx,repo,full,{parentKey:'00',isMap:false});recolorLabels(iss, paletteMap);out.push(iss)}catch{}
      }
      // also support repo.path case where map is directly at repo.path
      if(out.length===0 && repo&&repo.path){
        try{
          const plat2=getPlat(ctx)
          const mapP=plat2.join(repo.path,'map.md')
          const txt=await readTextFile(ctx,mapP)
          const iss=parseMd(txt,{key:'00',parentKey:null,isMap:true})
          recolorLabels(iss, paletteMap)
          out.push(iss)
          const idir2=plat2.join(repo.path,'issues')
          const files2=await readDir(ctx,idir2)
          for(const f of files2){
            const m=/^(\d+)-/.exec(f)
            if(!m) continue
            if(!f.endsWith('.md')) continue
            const key=m[1].padStart(2,'0')
            const full=plat2.join(idir2,f)
            try{const iss2=await loadIssueFromFile(ctx,repo,full,{parentKey:'00',isMap:false});recolorLabels(iss2, paletteMap);out.push(iss2)}catch{}
          }
        }catch{}
      }
    }
    // A: 回填 blockedBy 的 title/state（文件约束内满足契约：Blocked by 行只存 key，标题从被引文件首行取）
    try {
      const byKey = {}
      out.forEach(function(it){ if(it && it.key) byKey[String(it.key).padStart(2,'0')] = it })
      out.forEach(function(it){
        if(!it || !Array.isArray(it.blockedBy)) return
        it.blockedBy.forEach(function(ref){
          const k = ref && ref.key ? String(ref.key).padStart(2,'0') : ''
          const target = k ? byKey[k] : null
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
    filtered.sort((a,b)=>a.key.localeCompare(b.key))
    return{ok:true,data:filtered}
  }catch(e){const kind=e&&e.kind?e.kind:classifyError(e);return{ok:false,error:{kind,message:e&&e.message?e.message:String(e)}}}
}
export async function getIssue(ctx,repo,key){
  if(!key)return{ok:false,error:{kind:ERROR_KIND.NOTFOUND,message:'missing key'}}
  const norm=String(key).padStart(2,'0')
  const paletteMap=await loadPaletteMap(ctx)
  if(norm==='00'){
    const dirs=await listEffortDirs(ctx)
    for(const d of dirs){
      try{
        const plat=getPlat(ctx)
        const mapP=plat.join(d,'map.md')
        const txt=await readTextFile(ctx,mapP)
        const st=await statFile(ctx,mapP)
        let mtime=''
        if(st&&st.mtime){try{mtime=new Date(st.mtime).toISOString()}catch{}}
        const iss=parseMd(txt,{key:norm,parentKey:null,isMap:true,createdAt:mtime,updatedAt:mtime})
        recolorLabels(iss, paletteMap)
        return{ok:true,data:iss}
      }catch{}
    }
    try{
      const mapP=mdPath(repo,'map',undefined,ctx)
      const txt=await readTextFile(ctx,mapP)
      const st=await statFile(ctx,mapP)
      let mtime=''
      if(st&&st.mtime){try{mtime=new Date(st.mtime).toISOString()}catch{}}
      const iss=parseMd(txt,{key:norm,parentKey:null,isMap:true,createdAt:mtime,updatedAt:mtime})
      return{ok:true,data:iss}
    }catch{}
    // also repo.path fallback
    if(repo&&repo.path){
      try{
        const plat=getPlat(ctx)
        const mapP=plat.join(repo.path,'map.md')
        const txt=await readTextFile(ctx,mapP)
        const iss=parseMd(txt,{key:norm,parentKey:null,isMap:true})
        return{ok:true,data:iss}
      }catch{}
    }
  }
  const full=await findIssueFileGlobal(ctx,norm)
  if(full){
    try{const iss=await loadIssueFromFile(ctx,repo,full,{parentKey:'00',isMap:false});recolorLabels(iss, paletteMap);return{ok:true,data:iss}}catch(e){const kind=e&&e.kind?e.kind:classifyError(e);return{ok:false,error:{kind,message:e&&e.message?e.message:String(e)}}}
  }
  // fallback per-repo
  const per=await findIssueFileInEffort(ctx,repo,norm)
  if(per){
    try{const iss=await loadIssueFromFile(ctx,repo,per,{parentKey:'00',isMap:false});recolorLabels(iss, paletteMap);return{ok:true,data:iss}}catch(e){const kind=e&&e.kind?e.kind:classifyError(e);return{ok:false,error:{kind,message:e&&e.message?e.message:String(e)}}}
  }
  // repo.path fallback
  if(repo&&repo.path){
    try{
      const plat=getPlat(ctx)
      const cand=plat.join(repo.path,'issues',norm+'-')
      const files=await readDir(ctx, plat.join(repo.path,'issues'))
      const hit=files.find(f=>f.startsWith(norm+'-')&&f.endsWith('.md'))
      if(hit){
        const full2=plat.join(repo.path,'issues',hit)
        const iss=await loadIssueFromFile(ctx,repo,full2,{parentKey:'00',isMap:false})
        recolorLabels(iss, paletteMap)
        return{ok:true,data:iss}
      }
      // also unpadded fallback
      for(const f of files){
        const m=/^(\d+)-/.exec(f)
        if(!m) continue
        if(m[1].padStart(2,'0')===norm){
          const full2=plat.join(repo.path,'issues',f)
          const iss=await loadIssueFromFile(ctx,repo,full2,{parentKey:'00',isMap:false})
          recolorLabels(iss, paletteMap)
          return{ok:true,data:iss}
        }
      }
    }catch{}
  }
  return{ok:false,error:{kind:ERROR_KIND.NOTFOUND,message:'issue '+norm+' not-found'}}
}
