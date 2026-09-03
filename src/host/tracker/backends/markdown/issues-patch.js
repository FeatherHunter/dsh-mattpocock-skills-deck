// issues-patch.js —— 以后改打补丁类字段更新时改它（预估约 195 行）。
import { parseMd } from './parse.js'
import { readTextFile, readDir, exists } from './read.js'
import { writeTextFile } from './write.js'
import { mdPath } from './path.js'
import { classifyError } from '../../preflight.js'
import { ERROR_KIND } from '../../../../shared/tracker/constants.js'
import { getPlat, listEffortDirs, findIssueFileGlobal, findIssueFileInEffort } from './issues-locate.js'
import { loadPaletteMap, recolorLabels } from './issues-labels.js'
import { replaceOrInsertField } from './issues-status.js'

export async function updateIssue(ctx,repo,key,patch){
  const norm=String(key).padStart(2,'0')
  const paletteMap=await loadPaletteMap(ctx)
  let full=await findIssueFileGlobal(ctx,norm)
  if(!full) full=await findIssueFileInEffort(ctx,repo,norm)
  if(!full && repo&&repo.path){
    try{
      const plat=getPlat(ctx)
      const files=await readDir(ctx, plat.join(repo.path,'issues'))
      for(const f of files){
        const m=/^(\d+)-/.exec(f)
        if(m && m[1].padStart(2,'0')===norm && f.endsWith('.md')){ full=plat.join(repo.path,'issues',f); break }
      }
    }catch{}
  }
  if(!full)return{ok:false,error:{kind:ERROR_KIND.NOTFOUND,message:'issue '+norm+' not-found'}}
  try{
    let txt=await readTextFile(ctx,full)
    let changed=false
    if(patch&&typeof patch.title==='string'){
      const newTitle=patch.title.trim()
      if(newTitle){
        if(/^#+\s+.*$/m.test(txt))txt=txt.replace(/^#+\s+.*$/m,'# '+newTitle)
        else txt='# '+newTitle+'\n\n'+txt
        changed=true
      }
    }
    if(patch&&typeof patch.body==='string'){
      if(/^\s*Status\s*[:\uFF1A]/im.test(patch.body)){
        txt=String(patch.body);changed=true
      }else{
        const lines=txt.split('\n')
        const titleIdx=lines.findIndex(l=>/^#+\s+/.test(l))
        let insertAt=titleIdx>=0?titleIdx+1:0
        while(insertAt<lines.length&&lines[insertAt].trim()==='')insertAt++
        let fieldIdx=lines.findIndex((l,i)=>i>=insertAt&&/^\s*(Status|Type|Blocked\s+by|Labels)\s*[:\uFF1A]/i.test(l))
        if(fieldIdx<0)fieldIdx=lines.length
        const before=lines.slice(0,insertAt).join('\n')
        const after=lines.slice(fieldIdx).join('\n')
        const bodyBlock=String(patch.body).trim()
        txt=before+(before?'\n\n':'')+bodyBlock+'\n\n'+after
        changed=true
      }
    }
    if(patch&&Array.isArray(patch.customFields)){
      for(const cf of patch.customFields){
        if(cf&&cf.name==='Type'&&typeof cf.value==='string'&&cf.value.trim()){
          txt=replaceOrInsertField(txt,'Type','Type: '+String(cf.value).trim().toLowerCase());changed=true
        }
      }
    }
    if(patch&&patch.labels!==undefined){
      const names=Array.isArray(patch.labels)? patch.labels.map(l=> typeof l==='string'? l.trim() : (l&&l.name? String(l.name).trim():'' )).filter(Boolean) : []
      const line=names.length? 'Labels: '+names.join(', ') : 'Labels:'
      txt=replaceOrInsertField(txt,'Labels',line);changed=true
    }
    if(changed)await writeTextFile(ctx,full,txt)
    const iss=parseMd(txt,{key:norm,parentKey:'00',isMap:false})
    recolorLabels(iss, paletteMap)
    return{ok:true,data:iss}
  }catch(e){const kind=e&&e.kind?e.kind:classifyError(e);return{ok:false,error:{kind,message:e&&e.message?e.message:String(e)}}}
}
export async function setBlockedByIssue(ctx,repo,key,blockers){
  const norm=String(key).padStart(2,'0')
  const paletteMap=await loadPaletteMap(ctx)
  if(Array.isArray(blockers)&&blockers.map(k=>String(k).padStart(2,'0')).includes(norm)){return{ok:false,error:{kind:ERROR_KIND.CONFLICT,message:'self-block '+norm}}}
  let full=await findIssueFileGlobal(ctx,norm)
  if(!full) full=await findIssueFileInEffort(ctx,repo,norm)
  if(!full && repo&&repo.path){
    try{
      const plat=getPlat(ctx)
      const files=await readDir(ctx, plat.join(repo.path,'issues'))
      for(const f of files){
        const m=/^(\d+)-/.exec(f)
        if(m && m[1].padStart(2,'0')===norm && f.endsWith('.md')){ full=plat.join(repo.path,'issues',f); break }
      }
    }catch{}
  }
  if(!full)return{ok:false,error:{kind:ERROR_KIND.NOTFOUND,message:'issue '+norm+' not-found'}}
  try{
    let txt=await readTextFile(ctx,full)
    const arr=Array.isArray(blockers)?blockers:[]
    const line=arr.length?'Blocked by: '+arr.map(k=>'#'+String(k).padStart(2,'0')).join(', '):'Blocked by:'
    txt=replaceOrInsertField(txt,'Blocked\\s+by',line)
    await writeTextFile(ctx,full,txt)
    const iss=parseMd(txt,{key:norm,parentKey:'00',isMap:false})
    recolorLabels(iss, paletteMap)
    return{ok:true,data:iss}
  }catch(e){const kind=e&&e.kind?e.kind:classifyError(e);return{ok:false,error:{kind,message:e&&e.message?e.message:String(e)}}}
}
export async function setAssigneesIssue(ctx,repo,key,assignees){
  const norm=String(key).padStart(2,'0')
  const paletteMap=await loadPaletteMap(ctx)
  let full=await findIssueFileGlobal(ctx,norm)
  if(!full) full=await findIssueFileInEffort(ctx,repo,norm)
  if(!full && repo&&repo.path){
    try{
      const plat=getPlat(ctx)
      const files=await readDir(ctx, plat.join(repo.path,'issues'))
      for(const f of files){
        const m=/^(\d+)-/.exec(f)
        if(m && m[1].padStart(2,'0')===norm && f.endsWith('.md')){ full=plat.join(repo.path,'issues',f); break }
      }
    }catch{}
  }
  if(!full)return{ok:false,error:{kind:ERROR_KIND.NOTFOUND,message:'issue '+norm+' not-found'}}
  try{
    let txt=await readTextFile(ctx,full)
    const hasAssignee=Array.isArray(assignees)&&assignees.length>0
    const statusLine=hasAssignee?'Status: claimed':'Status: ready-for-agent'
    txt=replaceOrInsertField(txt,'Status',statusLine)
    await writeTextFile(ctx,full,txt)
    const iss=parseMd(txt,{key:norm,parentKey:'00',isMap:false})
    recolorLabels(iss, paletteMap)
    return{ok:true,data:iss}
  }catch(e){const kind=e&&e.kind?e.kind:classifyError(e);return{ok:false,error:{kind,message:e&&e.message?e.message:String(e)}}}
}
export async function setParentIssue(ctx,repo,key,parentKey){
  return{ok:false,error:{kind:ERROR_KIND.UNSUPPORTED,message:'markdown setParent unsupported (single-root)'}}
}
export async function setLabelsIssue(ctx,repo,key,labels){
  const norm=String(key).padStart(2,'0')
  const paletteMap=await loadPaletteMap(ctx)
  const names=Array.isArray(labels)? labels.map(l=> typeof l==='string'? l.trim() : (l&&typeof l.name==='string'? l.name.trim():String(l).trim())).filter(Boolean) : []
  let full=null
  // try map first if key 00
  if(norm==='00'){
    const dirs=await listEffortDirs(ctx)
    for(const d of dirs){
      const plat=getPlat(ctx)
      const mapP=plat.join(d,'map.md')
      try{
        if(await exists(ctx,mapP)){
          full=mapP
          break
        }
      }catch{}
    }
    if(!full){
      try{
        const mapP=mdPath(repo,'map',undefined,ctx)
        if(await exists(ctx,mapP)) full=mapP
      }catch{}
    }
    if(!full && repo&&repo.path){
      const plat=getPlat(ctx)
      const cand=plat.join(repo.path,'map.md')
      try{ if(await exists(ctx,cand)) full=cand }catch{}
    }
  } else {
    full=await findIssueFileGlobal(ctx,norm)
    if(!full) full=await findIssueFileInEffort(ctx,repo,norm)
    if(!full && repo&&repo.path){
      try{
        const plat=getPlat(ctx)
        const files=await readDir(ctx, plat.join(repo.path,'issues'))
        for(const f of files){
          const m=/^(\d+)-/.exec(f)
          if(m && m[1].padStart(2,'0')===norm && f.endsWith('.md')){ full=plat.join(repo.path,'issues',f); break }
        }
      }catch{}
    }
  }
  if(!full)return{ok:false,error:{kind:ERROR_KIND.NOTFOUND,message:'issue '+norm+' not-found'}}
  try{
    let txt=await readTextFile(ctx,full)
    const line=names.length? 'Labels: '+names.join(', ') : 'Labels:'
    txt=replaceOrInsertField(txt,'Labels',line)
    await writeTextFile(ctx,full,txt)
    const iss=parseMd(txt,{key:norm,parentKey: norm==='00'? null : '00', isMap: norm==='00'})
    recolorLabels(iss, paletteMap)
    return{ok:true,data:iss}
  }catch(e){const kind=e&&e.kind?e.kind:classifyError(e);return{ok:false,error:{kind,message:e&&e.message?e.message:String(e)}}}
}
