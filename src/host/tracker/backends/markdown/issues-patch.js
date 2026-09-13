// issues-patch.js —— 以后改打补丁类字段更新时改它（预估约 190 行）。
//
// effort 维度（2026-09-09）：所有写路径按 (effort 范围, 编号) 定位文件，多命中即 conflict。
import { parseMd } from './parse.js'
import { readTextFile } from './read.js'
import { writeTextFile } from './write.js'
import { classifyError } from '../../preflight.js'
import { ERROR_KIND } from '../../../../shared/tracker/constants.js'
import { resolveIssueFile, resolveMapFile } from './issues-locate.js'
import { loadPaintColorMap, applyLabelColors } from './label-colors-paint.js'
import { replaceOrInsertField } from './issues-status.js'

async function resolveTarget(ctx,repo,norm,mode){
  if(norm==='00') return resolveMapFile(ctx,repo,{mode})
  return resolveIssueFile(ctx,repo,norm,{mode})
}
async function readParseWrite(ctx,r,norm,fn){
  try{
    let txt=await readTextFile(ctx,r.path)
    const out=fn(txt)
    const next=typeof out==='string'?out:txt
    if(next!==txt)await writeTextFile(ctx,r.path,next)
    return{ok:true,txt:next}
  }catch(e){const kind=e&&e.kind?e.kind:classifyError(e);return{ok:false,error:{kind,message:e&&e.message?e.message:String(e)}}}
}
export async function updateIssue(ctx,repo,key,patch){
  const norm=String(key).padStart(2,'0')
  const colorMap=await loadPaintColorMap(ctx)
  const r=await resolveTarget(ctx,repo,norm,'write')
  if(!r.ok)return{ok:false,error:r.error}
  const res=await readParseWrite(ctx,r,norm,function(txt){
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
    return changed?txt:undefined
  })
  if(!res.ok)return{ok:false,error:res.error}
  try{
    const iss=parseMd(res.txt,{key:norm,parentKey: norm==='00'?null:'00',isMap: norm==='00',effortId:r.effortId})
    applyLabelColors(iss, colorMap)
    return{ok:true,data:iss}
  }catch(e){const kind=e&&e.kind?e.kind:classifyError(e);return{ok:false,error:{kind,message:e&&e.message?e.message:String(e)}}}
}
export async function setBlockedByIssue(ctx,repo,key,blockers){
  const norm=String(key).padStart(2,'0')
  const colorMap=await loadPaintColorMap(ctx)
  if(Array.isArray(blockers)&&blockers.map(k=>String(k).padStart(2,'0')).includes(norm)){return{ok:false,error:{kind:ERROR_KIND.CONFLICT,message:'self-block '+norm}}}
  const r=await resolveTarget(ctx,repo,norm,'write')
  if(!r.ok)return{ok:false,error:r.error}
  const arr=Array.isArray(blockers)?blockers:[]
  const line=arr.length?'Blocked by: '+arr.map(k=>'#'+String(k).padStart(2,'0')).join(', '):'Blocked by:'
  const res=await readParseWrite(ctx,r,norm,function(txt){return replaceOrInsertField(txt,'Blocked\\s+by',line)})
  if(!res.ok)return{ok:false,error:res.error}
  try{
    const iss=parseMd(res.txt,{key:norm,parentKey:'00',isMap:false,effortId:r.effortId})
    applyLabelColors(iss, colorMap)
    return{ok:true,data:iss}
  }catch(e){const kind=e&&e.kind?e.kind:classifyError(e);return{ok:false,error:{kind,message:e&&e.message?e.message:String(e)}}}
}
export async function setAssigneesIssue(ctx,repo,key,assignees){
  const norm=String(key).padStart(2,'0')
  const colorMap=await loadPaintColorMap(ctx)
  const r=await resolveTarget(ctx,repo,norm,'write')
  if(!r.ok)return{ok:false,error:r.error}
  const hasAssignee=Array.isArray(assignees)&&assignees.length>0
  const statusLine=hasAssignee?'Status: claimed':'Status: ready-for-agent'
  const res=await readParseWrite(ctx,r,norm,function(txt){return replaceOrInsertField(txt,'Status',statusLine)})
  if(!res.ok)return{ok:false,error:res.error}
  try{
    const iss=parseMd(res.txt,{key:norm,parentKey:'00',isMap:false,effortId:r.effortId})
    applyLabelColors(iss, colorMap)
    return{ok:true,data:iss}
  }catch(e){const kind=e&&e.kind?e.kind:classifyError(e);return{ok:false,error:{kind,message:e&&e.message?e.message:String(e)}}}
}
export async function setParentIssue(ctx,repo,key,parentKey){
  return{ok:false,error:{kind:ERROR_KIND.UNSUPPORTED,message:'markdown setParent unsupported (single-root)'}}
}
export async function setLabelsIssue(ctx,repo,key,labels){
  const norm=String(key).padStart(2,'0')
  const colorMap=await loadPaintColorMap(ctx)
  const names=Array.isArray(labels)? labels.map(l=> typeof l==='string'? l.trim() : (l&&typeof l.name==='string'? l.name.trim():String(l).trim())).filter(Boolean) : []
  const r=await resolveTarget(ctx,repo,norm,'write')
  if(!r.ok)return{ok:false,error:r.error}
  const line=names.length? 'Labels: '+names.join(', ') : 'Labels:'
  const res=await readParseWrite(ctx,r,norm,function(txt){return replaceOrInsertField(txt,'Labels',line)})
  if(!res.ok)return{ok:false,error:res.error}
  try{
    const iss=parseMd(res.txt,{key:norm,parentKey: norm==='00'?null:'00',isMap: norm==='00',effortId:r.effortId})
    applyLabelColors(iss, colorMap)
    return{ok:true,data:iss}
  }catch(e){const kind=e&&e.kind?e.kind:classifyError(e);return{ok:false,error:{kind,message:e&&e.message?e.message:String(e)}}}
}
