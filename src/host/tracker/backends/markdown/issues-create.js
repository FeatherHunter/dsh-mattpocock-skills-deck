// issues-create.js —— 以后改新建单据落盘格式时改它（预估约 100 行）。
//
// effort 维度（2026-09-09）：建票必须落在**一个明确的 effort** 里，编号按契约「每个 effort 从 01 起」在该 effort 内取 max+1。
//   - repo.effortId 给出 → 就落在那一个 effort；
//   - 仓库只有一个 effort → 自动落它（单 effort 仓库用起来无感）；
//   - 仓库有多个 effort 又没指定 → 返回 conflict 诚实失败，绝不猜（旧实现在所有 effort 之间取全局 max+1，
//     与契约冲突，而且因为少了 getScratchRoot 的 import 从未生效）。
import { parseMd, slugify } from './parse.js'
import { readDir, statFile, exists } from './read.js'
import { writeTextFile, ensureDir } from './write.js'
import { issuesDir } from './path.js'
import { classifyError } from '../../preflight.js'
import { ERROR_KIND } from '../../../../shared/tracker/constants.js'
import { getPlat, listEfforts, findIssueFileInEffort } from './issues-locate.js'
import { loadPaintColorMap, applyLabelColors } from './label-colors-paint.js'

export async function createIssue(ctx,repo,input){
  const plat=getPlat(ctx)
  const colorMap=await loadPaintColorMap(ctx)
  if(!input||typeof input.title!=='string'||!input.title.trim()){return{ok:false,error:{kind:ERROR_KIND.PARSE,message:'title required'}}}
  try{
    const efforts=await listEfforts(ctx)
    const scope=(repo&&repo.effortId!==undefined&&repo.effortId!==null)?String(repo.effortId):undefined
    let target=null
    if(scope!==undefined){
      target=efforts.find(function(e){ return e.effortId===scope })||null
      // 指了 effort 但这个 effort 不存在 → 诚实失败，绝不落到根目录（否则票写进 .scratch/issues/ 面板永远看不见）
      if(!target){
        const have=efforts.map(function(e){ return e.effortId||'(根)' }).join('、')||'（本仓库还没有 effort）'
        return{ok:false,error:{kind:ERROR_KIND.NOTFOUND,message:'找不到 effort「'+scope+'」；本仓库现有：'+have}}
      }
    }else if(efforts.length===1){
      target=efforts[0]
    }else if(efforts.length>1){
      return{ok:false,error:{kind:ERROR_KIND.CONFLICT,message:'本仓库有 '+efforts.length+' 个 effort（'+efforts.map(function(e){return e.effortId||'(根)'}).join('、')+'），新建票据必须指定 effortId'}}
    }
    const effortId=target?target.effortId:''
    const idir=target?plat.join(target.dir,'issues'):issuesDir(repo,ctx)
    await ensureDir(ctx,idir)
    // 编号：只在目标 effort 内取 max+1（契约：每个 effort 从 01 起）
    let max=0
    const filesSelf=await readDir(ctx,idir)
    for(const f of filesSelf){ const m=/^(\d+)-/.exec(f); if(m){ const n=parseInt(m[1],10); if(!isNaN(n)&&n>max) max=n } }
    let next=max+1
    let attempt=0
    let finalPath=''
    let finalKey=''
    while(attempt<5){
      const keyStr=String(next).padStart(2,'0')
      const slug=slugify(input.title)
      const filename=keyStr+'-'+slug+'.md'
      const full=plat.join(idir,filename)
      const ex=await findIssueFileInEffort(ctx,{effortId},keyStr)
      if(ex){next++;attempt++;continue}
      finalPath=full;finalKey=keyStr;break
    }
    if(!finalPath)return{ok:false,error:{kind:ERROR_KIND.CONFLICT,message:'create NN conflict'}}
    const blockedByStr=Array.isArray(input.blockedBy)&&input.blockedBy.length?input.blockedBy.map(k=>'#'+String(k).padStart(2,'0')).join(', '):(typeof input.blockedBy==='string'?input.blockedBy:'')
    const typeField=input.type?String(input.type):(input.Type?String(input.Type):'')
    const labelsInput = Array.isArray(input.labels) ? input.labels : (Array.isArray(input.Labels)? input.Labels : null)
    let labelsStr=''
    if(labelsInput && labelsInput.length){
      const names=labelsInput.map(l=>{
        if(typeof l==='string') return l.trim()
        if(l&&typeof l.name==='string') return l.name.trim()
        return ''
      }).filter(Boolean)
      if(names.length) labelsStr=names.join(', ')
    } else if(typeof input.labels==='string' && input.labels.trim()){
      labelsStr=String(input.labels).trim()
    }
    const bodyPart=input.body?String(input.body).trim():''
    const title=String(input.title).trim()
    let content='# '+title+'\n\n'
    if(bodyPart)content+=bodyPart+'\n\n'
    content+='Status: '+(input.status||'ready-for-agent')+'\n'
    if(typeField)content+='Type: '+typeField+'\n'
    if(blockedByStr)content+='Blocked by: '+blockedByStr+'\n'
    else content+='Blocked by:\n'
    if(labelsStr) content+='Labels: '+labelsStr+'\n'
    else content+='Labels:\n'
    content+='\n## Comments\n\n\n## Answer\n\n'
    if(input.parentKey)content='<!-- parentKey: '+input.parentKey+' -->\n'+content
    await writeTextFile(ctx,finalPath,content)
    const st=await statFile(ctx,finalPath)
    let mtime=new Date().toISOString()
    if(st&&st.mtime){try{mtime=new Date(st.mtime).toISOString()}catch{}}
    const iss=parseMd(content,{key:finalKey,parentKey:input.parentKey||'00',isMap:false,effortId,createdAt:mtime,updatedAt:mtime})
    applyLabelColors(iss, colorMap)
    return{ok:true,data:iss}
  }catch(e){const kind=e&&e.kind?e.kind:classifyError(e);return{ok:false,error:{kind,message:e&&e.message?e.message:String(e)}}}
}
