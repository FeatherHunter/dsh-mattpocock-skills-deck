// issues-status.js —— 以后改关闭与重开状态流转时改它；字段行改写小工具也住这，补丁文件共用（预估约 150 行）。
//
// effort 维度（2026-09-09）：关票/重开都按 (effort 范围, 编号) 定位，写模式多命中即 conflict，不猜文件。
import { parseMd } from './parse.js'
import { readTextFile } from './read.js'
import { writeTextFile } from './write.js'
import { classifyError } from '../../preflight.js'
import { resolveIssueFile, resolveMapFile } from './issues-locate.js'
import { loadPaintColorMap, applyLabelColors } from './label-colors-paint.js'

export function replaceOrInsertField(txt,fieldName,newLine){
  const re=new RegExp('^\\s*'+fieldName+'\\s*[:\uFF1A]\\s*.*$','im')
  if(re.test(txt))return txt.replace(re,newLine)
  const lines=txt.split('\n')
  let insertIdx=1
  for(let i=0;i<lines.length;i++){if(/^#+\s+/.test(lines[i])){insertIdx=i+1;break}}
  lines.splice(insertIdx,0,newLine)
  return lines.join('\n')
}
async function setStatus(ctx,repo,key,statusLine){
  const norm=String(key).padStart(2,'0')
  const colorMap=await loadPaintColorMap(ctx)
  const isMap=norm==='00'
  const r=isMap
    ? await resolveMapFile(ctx,repo,{mode:'write'})
    : await resolveIssueFile(ctx,repo,norm,{mode:'write'})
  if(!r.ok)return{ok:false,error:r.error}
  try{
    let txt=await readTextFile(ctx,r.path)
    txt=replaceOrInsertField(txt,'Status',statusLine)
    await writeTextFile(ctx,r.path,txt)
    const iss=parseMd(txt,{key:norm,parentKey:isMap?null:'00',isMap,effortId:r.effortId})
    applyLabelColors(iss, colorMap)
    return{ok:true,data:iss}
  }catch(e){const kind=e&&e.kind?e.kind:classifyError(e);return{ok:false,error:{kind,message:e&&e.message?e.message:String(e)}}}
}
export async function closeIssue(ctx,repo,key){
  return setStatus(ctx,repo,key,'Status: resolved')
}
export async function reopenIssue(ctx,repo,key){
  return setStatus(ctx,repo,key,'Status: ready-for-agent')
}
