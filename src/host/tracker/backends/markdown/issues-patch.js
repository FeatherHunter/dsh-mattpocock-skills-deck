// issues-patch.js —— 以后改打补丁类字段更新时改它（预估约 190 行）。
//
// effort 维度（2026-09-09）：所有写路径按 (effort 范围, 编号) 定位文件，多命中即 conflict。
import { parseMd, stripLabelDecoration, parentKeyFromFile, isWholeIssueBody } from './parse.js'
import { readTextFile } from './read.js'
import { writeTextFile } from './write.js'
import { classifyError } from '../../preflight.js'
import { ERROR_KIND } from '../../../../shared/tracker/constants.js'
import { resolveIssueFile, resolveMapFile } from './issues-locate.js'
import { loadPaintColorMap, applyLabelColors } from './label-colors-paint.js'
import { replaceOrInsertField } from './issues-status.js'
// #922：票文件的读—改—写按文件排队，见 write-queue.js。
import { withFileWriter } from './write-queue.js'

async function resolveTarget(ctx,repo,norm,mode){
  if(norm==='00') return resolveMapFile(ctx,repo,{mode})
  return resolveIssueFile(ctx,repo,norm,{mode})
}
/** 读一份票文件、在内存里改、再整份写回去。
 *  这三步必须排在该文件的单写者队列里跑完（#922）：中间那一次读会让出事件循环，
 *  两路并发改同一张票时会一起读到同一份旧内容，各自改各自的，后写的那一路把先写的那一路的改动整份抹掉
 *  —— 两路都回成功，盘上却少了一半改动。队按文件分：批量补边一次要改很多张票，
 *  它们是不同的文件、彼此不冲突，仍然可以同时做（#919 的并发改造就是照这个口径放宽的）。 */
async function readParseWrite(ctx,repo,r,norm,fn){
  return withFileWriter(ctx,repo,r.path,async function(){
    try{
      let txt=await readTextFile(ctx,r.path)
      const out=fn(txt)
      const next=typeof out==='string'?out:txt
      if(next!==txt)await writeTextFile(ctx,r.path,next, ctx && ctx.sandboxPolicy)
      return{ok:true,txt:next}
    }catch(e){const kind=e&&e.kind?e.kind:classifyError(e);return{ok:false,error:{kind,message:e&&e.message?e.message:String(e)}}}
  })
}
/** 递进来的正文是不是「一整份票文件」：自带 H1 标题（或幂等锚）。
 *  为什么要分开判：下面的插入分支把正文插在现有 H1 之后，认错了盘上就会留下两个 H1、两份正文。
 *  实测：自带 H1、又不带 Status 行的整份正文走了插入分支，票文件被写坏，调用方却收到 ok。 */
function looksLikeWholeDocument(body){
  const t=String(body||'')
  return /^\s*#\s+\S/m.test(t)||/^\s*<!--\s*DSH-IDEMPOTENCY-KEY:/m.test(t)
}
/** 盘上那份文本里的字段行（Status/Type/Blocked by/Labels）：整份替换时用来补齐递进来的正文里缺的字段。 */
function fieldLinesOf(text){
  const out=[]
  const lines=String(text||'').split('\n')
  for(const l of lines){ if(/^\s*(Status|Type|Blocked\s+by|Labels)\s*[:\uFF1A]/i.test(l)) out.push(l.replace(/\s+$/,'')) }
  return out
}
function fieldNameOf(line){ return String(line).split(/[:\uFF1A]/)[0].trim().toLowerCase() }
/** 取票文件里某骨架区整段（标题加内容，到下一个二级标题或文末）：改正文时用来把盘上旧评论搬回新正文。 */
function sectionOf(text, name){
  const re=new RegExp('^##\\s*'+name+'\\s*$[\\s\\S]*?(?=^##\\s|$(?![\\s\\S]))', 'im')
  const m=re.exec(String(text||''))
  return m?m[0].replace(/^\s*/, '').replace(/\s*$/, ''):''
}
function countRe(text, re){ return (String(text||'').match(re)||[]).length }
/** 写坏了没有的快速核对：新正文相对旧正文不许新增重复、不许弄丢锚与骨架，坏了就返回原因（调用方转成如实失败，不落盘）。
 *  缺字段补上（0 到 1）不算坏，那是在治旧数据的缺；翻倍（超过旧数且超过 1 个）才算坏。 */
function checkNoWorseForPatch(oldText, newText){
  const o=String(oldText||''), n=String(newText||'')
  const worse=function(oldC, newC){ return newC>1&&newC>oldC }
  if(worse(countRe(o, /^#[ \t]+\S.*/gm), countRe(n, /^#[ \t]+\S.*/gm))) return '一级标题变多了'
  if(worse(countRe(o, /DSH-IDEMPOTENCY-KEY/g), countRe(n, /DSH-IDEMPOTENCY-KEY/g))) return '幂等锚变多了'
  if(countRe(o, /DSH-IDEMPOTENCY-KEY/g)>=1&&countRe(n, /DSH-IDEMPOTENCY-KEY/g)===0) return '幂等锚丢了'
  if(worse(countRe(o, /^\s*Status\s*[:\uFF1A]/gim), countRe(n, /^\s*Status\s*[:\uFF1A]/gim))) return 'Status 行变多了'
  if(worse(countRe(o, /^\s*Type\s*[:\uFF1A]/gim), countRe(n, /^\s*Type\s*[:\uFF1A]/gim))) return 'Type 行变多了'
  if(worse(countRe(o, /^\s*Blocked\s+by\s*[:\uFF1A]/gim), countRe(n, /^\s*Blocked\s+by\s*[:\uFF1A]/gim))) return 'Blocked by 行变多了'
  if(worse(countRe(o, /^\s*Labels\s*[:\uFF1A]/gim), countRe(n, /^\s*Labels\s*[:\uFF1A]/gim))) return 'Labels 行变多了'
  if(worse(countRe(o, /^##\s*Comments\s*$/gim), countRe(n, /^##\s*Comments\s*$/gim))) return 'Comments 骨架变多了'
  if(worse(countRe(o, /^##\s*Answer\s*$/gim), countRe(n, /^##\s*Answer\s*$/gim))) return 'Answer 骨架变多了'
  if(countRe(o, /^##\s*Comments\s*$/gim)>=1&&countRe(n, /^##\s*Comments\s*$/gim)===0) return 'Comments 骨架丢了'
  if(countRe(o, /^##\s*Answer\s*$/gim)>=1&&countRe(n, /^##\s*Answer\s*$/gim)===0) return 'Answer 骨架丢了'
  return ''
}
/** 整份正文合并：锚一律用盘上旧的，缺一级标题用盘上旧标题补回，缺字段行与骨架区从盘上旧文件搬回（字段插在骨架之前）。 */
function mergeWholeBodyForPatch(incomingRaw, diskText){
  let incoming=String(incomingRaw||'')
  incoming=incoming.replace(/^[ \t]*<!--[ \t]*DSH-IDEMPOTENCY-KEY:.*?-->[ \t]*\r?\n?/gim, '')
  const diskAnchor=(String(diskText||'').match(/^[ \t]*<!--[ \t]*DSH-IDEMPOTENCY-KEY:.*?-->[ \t]*$/m)||[])[0]
  if(diskAnchor) incoming=String(diskAnchor).trim()+'\n'+incoming.replace(/^\s*/, '')
  const h1count=(incoming.match(/^#[ \t]+\S.*/gm)||[]).length
  if(h1count===0){
    const diskH1=(String(diskText||'').match(/^#[ \t]+.*$/m)||[])[0]
    if(diskH1){
      const lines=incoming.split('\n')
      let at=0
      while(at<lines.length&&/^[ \t]*<!--[ \t]*(DSH-IDEMPOTENCY-KEY|parentKey)[ \t]*:/.test(lines[at])) at++
      lines.splice(at, 0, String(diskH1).trim(), '')
      incoming=lines.join('\n')
    }
  }else if(h1count>1){
    let first=true
    incoming=incoming.replace(/^#[ \t]+.*$/gm, function(m){ if(first){ first=false; return m } return '' })
  }
  const have=fieldLinesOf(incoming).map(fieldNameOf)
  const keep=fieldLinesOf(diskText).filter(function(l){ return have.indexOf(fieldNameOf(l))<0 })
  if(keep.length){
    const skelIdx=incoming.search(/^##\s*(Comments|Answer)\s*$/m)
    if(skelIdx>=0) incoming=incoming.slice(0, skelIdx).replace(/\s*$/, '')+'\n\n'+keep.join('\n')+'\n\n'+incoming.slice(skelIdx).replace(/^\s*/, '')
    else incoming=incoming.replace(/\s*$/, '')+'\n\n'+keep.join('\n')+'\n'
  }
  const names=['Comments', 'Answer']
  for(const name of names){
    const hasRe=new RegExp('^##\\s*'+name+'\\s*$', 'm')
    if(!hasRe.test(incoming)){
      const diskSec=sectionOf(diskText, name)
      if(diskSec) incoming=incoming.replace(/\s*$/, '')+'\n\n'+diskSec+'\n'
      else incoming=incoming.replace(/\s*$/, '')+'\n\n## '+name+'\n\n'
    }
  }
  return incoming
}

export async function updateIssue(ctx,repo,key,patch){
  const norm=String(key).padStart(2,'0')
  const colorMap=await loadPaintColorMap(ctx)
  const r=await resolveTarget(ctx,repo,norm,'write')
  if(!r.ok)return{ok:false,error:r.error}
  const res=await readParseWrite(ctx,repo,r,norm,function(txt){
    const fnOldText=String(txt||'')
    let changed=false
    // #972：标题分支必须在正文分支之后：正文的整份替换分支会拿递进来的整份盖掉刚换好的标题。
    // 标题后置 = 同传时以后一步的标题参数为准；只传一边时行为不变。
    const newTitle=(patch&&typeof patch.title==='string')?patch.title.trim():''
    if(patch&&typeof patch.body==='string'){
      if(isWholeIssueBody(patch.body)){
        // 整份正文：读回给的是整份文件，写回也按整份合并（锚与标题保住、字段与骨架搬回），不再猜它是片段。
        txt=mergeWholeBodyForPatch(patch.body, fnOldText);changed=true
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
    if(newTitle){
      if(/^#+\s+.*$/m.test(txt))txt=txt.replace(/^#+\s+.*$/m,'# '+newTitle)
      else txt='# '+newTitle+'\n\n'+txt
      changed=true
    }
    if(patch&&Array.isArray(patch.customFields)){
      for(const cf of patch.customFields){
        if(cf&&cf.name==='Type'&&typeof cf.value==='string'&&cf.value.trim()){
          txt=replaceOrInsertField(txt,'Type','Type: '+String(cf.value).trim().toLowerCase());changed=true
        }
      }
    }
    if(patch&&patch.labels!==undefined){
      // #634：写进去的标签名同样先剥掉外层成对引号/反引号——别人递进来的名字可能带着
      // 照着文档代码写法抄下来的那层引号，落盘时必须是干净的标签名，否则这层脏写法会被写进票面。
      const names=Array.isArray(patch.labels)? patch.labels.map(l=> typeof l==='string'? stripLabelDecoration(l) : (l&&l.name? stripLabelDecoration(l.name):'' )).filter(Boolean) : []
      const line=names.length? 'Labels: '+names.join(', ') : 'Labels:'
      txt=replaceOrInsertField(txt,'Labels',line);changed=true
    }
    // #971 加固：改正文与标签不许顺手把父注释弄丢。整份替换的两条分支会拿递进来的正文盖掉整份文件，
    // 父注释不在字段行里，补不回来，下一次读回父就从 01 掉回 00。这里以盘上旧文件的父为准补回。
    try{
      const oldP=parentKeyFromFile(fnOldText)
      const newP=parentKeyFromFile(txt)
      if(oldP.found&&!newP.found){txt=upsertParentComment(txt,oldP.value);changed=true}
    }catch{}
    // #1002：落盘前核对不许写坏，变坏就抛错转成如实失败（读改写队列里抛错不会落盘）。
    if(changed){
      const worse=checkNoWorseForPatch(fnOldText, txt)
      if(worse) throw {kind:ERROR_KIND.UNSUPPORTED,message:'改正文核对没过（'+worse+'），这次没写：请换一种正文形态再试。'}
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
  const res=await readParseWrite(ctx,repo,r,norm,function(txt){return replaceOrInsertField(txt,'Blocked\\s+by',line)})
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
  const res=await readParseWrite(ctx,repo,r,norm,function(txt){return replaceOrInsertField(txt,'Status',statusLine)})
  if(!res.ok)return{ok:false,error:res.error}
  try{
    const iss=parseMd(res.txt,{key:norm,parentKey:'00',isMap:false,effortId:r.effortId})
    applyLabelColors(iss, colorMap)
    return{ok:true,data:iss}
  }catch(e){const kind=e&&e.kind?e.kind:classifyError(e);return{ok:false,error:{kind,message:e&&e.message?e.message:String(e)}}}
}
/** 把文件顶的父票注释换成新的值，没有这一行就插一行（#971）。
 *
 *  为什么要单独抽出来：改父在本地后端就是改这一行注释，不动文件位置。
 *  幂等锚那一行（DSH-IDEMPOTENCY-KEY）在最前，父注释紧跟在它后面；
 *  没有锚的文件直接插在最前。解除父子（null）写成明确的 null 字样，
 *  这样以后读回来是“没有父票”，而不会回落到老默认值 00。 */
function upsertParentComment(text, want) {
  const line = want === null ? '<!-- parentKey: null -->' : '<!-- parentKey: ' + String(want) + ' -->'
  const raw = String(text || '')
  // 只动文件头的注释：正文里举例写同样的写法不算数（读也只认文件头，这里只换文件头）。
  const h1 = /^#+\s+/m.exec(raw)
  const headEnd = h1 ? h1.index : raw.split('\n').slice(0, 10).join('\n').length
  const head = raw.slice(0, headEnd)
  const rest = raw.slice(headEnd)
  const re = /^[ \t]*<!--[ \t]*parentKey[ \t]*:[ \t]*.*?-->[ \t]*\r?\n?/im
  if (re.test(head)) return head.replace(re, line + '\n') + rest
  const lines = head.split('\n')
  let at = 0
  if (lines.length && /^[ \t]*<!--[ \t]*DSH-IDEMPOTENCY-KEY:/.test(lines[0])) at = 1
  lines.splice(at, 0, line)
  return lines.join('\n') + rest
}
function normParentKey(v) {
  if (v === undefined || v === null) return null
  const t = String(v).trim()
  if (!t) return null
  if (/^null$/i.test(t) || /^none$/i.test(t) || t === '-') return null
  if (/^\d+$/.test(t)) return t.padStart(2, '0')
  return t
}
export async function setParentIssue(ctx,repo,key,parentKey){
  const norm=String(key).padStart(2,'0')
  const want=normParentKey(parentKey)
  const colorMap=await loadPaintColorMap(ctx)
  // 地图文件本身没有父票：只要解除（null）就直接成功，其余一律如实说做不到。
  if(norm==='00'){
    if(want===null){
      const r=await resolveMapFile(ctx,repo,{mode:'read'})
      if(!r.ok)return{ok:false,error:r.error}
      try{
        const txt=await readTextFile(ctx,r.path)
        const iss=parseMd(txt,{key:'00',parentKey:null,isMap:true,effortId:r.effortId})
        applyLabelColors(iss, colorMap)
        return{ok:true,data:iss}
      }catch(e){const kind=e&&e.kind?e.kind:classifyError(e);return{ok:false,error:{kind,message:e&&e.message?e.message:String(e)}}}
    }
    return{ok:false,error:{kind:ERROR_KIND.UNSUPPORTED,message:'markdown setParent unsupported (map has no parent)'}}
  }
  const r=await resolveTarget(ctx,repo,norm,'write')
  if(!r.ok)return{ok:false,error:r.error}
  const childEffort=r.effortId||''
  // 同值比较放在写队列里面做（#922）：队外先读一次再比，两路并发改同一张票时，后写的那一路会把先写的那一路的改动盖掉，
  // 而先读的那一路还按旧值报成功。下面三条写路径都在队内先读 fresh 的那一份，相等就不写直接成功。
  // 解除父子不需要搬文件（同一目录内去掉注释即可），直接成功。
  if(want===null){
    const res=await readParseWrite(ctx,repo,r,norm,function(txt){
      try{
        const cur0=parseMd(txt,{key:norm,parentKey:'00',isMap:false,effortId:childEffort}).parentKey
        const curN=cur0===undefined||cur0===null?null:normParentKey(cur0)
        if(curN===want)return undefined
      }catch{}
      return upsertParentComment(txt, null)
    })
    if(!res.ok)return{ok:false,error:res.error}
    try{
      const iss=parseMd(res.txt,{key:norm,parentKey:'00',isMap:false,effortId:childEffort})
      applyLabelColors(iss, colorMap)
      return{ok:true,data:iss}
    }catch(e){const kind=e&&e.kind?e.kind:classifyError(e);return{ok:false,error:{kind,message:e&&e.message?e.message:String(e)}}}
  }
  // 新父必须在同一个工作单元里（同一个目录树下）：目录即父子，跨目录搬文件不支持，如实失败。
  if(want==='00'){
    const mr=await resolveMapFile(ctx,repo,{effortId:childEffort,mode:'read'})
    if(!mr.ok)return{ok:false,error:{kind:ERROR_KIND.NOTFOUND,message:'parent 00 not-found in effort「'+childEffort+'」'}}
    const res=await readParseWrite(ctx,repo,r,norm,function(txt){
      try{
        const cur0=parseMd(txt,{key:norm,parentKey:'00',isMap:false,effortId:childEffort}).parentKey
        const curN=cur0===undefined||cur0===null?null:normParentKey(cur0)
        if(curN===want)return undefined
      }catch{}
      return upsertParentComment(txt, '00')
    })
    if(!res.ok)return{ok:false,error:res.error}
    try{
      const iss=parseMd(res.txt,{key:norm,parentKey:'00',isMap:false,effortId:childEffort})
      applyLabelColors(iss, colorMap)
      return{ok:true,data:iss}
    }catch(e){const kind=e&&e.kind?e.kind:classifyError(e);return{ok:false,error:{kind,message:e&&e.message?e.message:String(e)}}}
  }
  const pr=await resolveIssueFile(ctx,repo,want,{effortId:childEffort,mode:'read'})
  if(pr.ok&&(pr.effortId||'')===childEffort){
    const res=await readParseWrite(ctx,repo,r,norm,function(txt){
      try{
        const cur0=parseMd(txt,{key:norm,parentKey:'00',isMap:false,effortId:childEffort}).parentKey
        const curN=cur0===undefined||cur0===null?null:normParentKey(cur0)
        if(curN===want)return undefined
      }catch{}
      return upsertParentComment(txt, want)
    })
    if(!res.ok)return{ok:false,error:res.error}
    try{
      const iss=parseMd(res.txt,{key:norm,parentKey:'00',isMap:false,effortId:childEffort})
      applyLabelColors(iss, colorMap)
      return{ok:true,data:iss}
    }catch(e){const kind=e&&e.kind?e.kind:classifyError(e);return{ok:false,error:{kind,message:e&&e.message?e.message:String(e)}}}
  }
  // 同目录里找不到这个父：看它是不是在别的工作单元里，是就是跨目录（不支持），不是就是不存在。
  try{
    const anywhere=await resolveIssueFile(ctx,repo,want,{effortId:null,mode:'read'})
    if(anywhere&&anywhere.ok)return{ok:false,error:{kind:ERROR_KIND.UNSUPPORTED,message:'markdown setParent unsupported (cross-effort '+childEffort+' -> '+(anywhere.effortId||'')+')'}}
  }catch{}
  return{ok:false,error:{kind:ERROR_KIND.NOTFOUND,message:'parent '+want+' not-found'}}
}
export async function setLabelsIssue(ctx,repo,key,labels){
  const norm=String(key).padStart(2,'0')
  const colorMap=await loadPaintColorMap(ctx)
  // #634：与 patch.labels 同口径——落盘的标签名先剥掉外层成对引号/反引号
  const names=Array.isArray(labels)? labels.map(l=> stripLabelDecoration(typeof l==='string'? l : (l&&typeof l.name==='string'? l.name:String(l)))).filter(Boolean) : []
  const r=await resolveTarget(ctx,repo,norm,'write')
  if(!r.ok)return{ok:false,error:r.error}
  const line=names.length? 'Labels: '+names.join(', ') : 'Labels:'
  const res=await readParseWrite(ctx,repo,r,norm,function(txt){return replaceOrInsertField(txt,'Labels',line)})
  if(!res.ok)return{ok:false,error:res.error}
  try{
    const iss=parseMd(res.txt,{key:norm,parentKey: norm==='00'?null:'00',isMap: norm==='00',effortId:r.effortId})
    applyLabelColors(iss, colorMap)
    return{ok:true,data:iss}
  }catch(e){const kind=e&&e.kind?e.kind:classifyError(e);return{ok:false,error:{kind,message:e&&e.message?e.message:String(e)}}}
}
