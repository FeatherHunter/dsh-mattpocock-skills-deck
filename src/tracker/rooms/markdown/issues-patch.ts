// issues-patch.js —— 以后改打补丁类字段更新时改它（预估约 190 行）。
//
// effort 维度（2026-09-09）：所有写路径按 (effort 范围, 编号) 定位文件，多命中即 conflict。
import { parseMd, stripLabelDecoration, parentKeyFromFile, isWholeIssueBody, loginOfAssignee } from './parse.js'
import { readTextFile, statFile } from './read.js'
import { writeTextFile } from './write.js'
import { failAs, failFromError } from './error-fail.js'
import { ERROR_KIND } from '../../contract/vocabulary.js'
import { resolveIssueFile, resolveMapFile } from './issues-locate.js'
import { loadPaintColorMap, applyLabelColors } from './label-colors-paint.js'
import { replaceOrInsertField } from './issues-status.js'
// #1174：写阻塞边之前的全图环检（契约明写「环检是写路径的一部分，不许省」）。
import { readBlockedByGraph, cycleThrough } from './graph.js'
// #922：票文件的读—改—写按文件排队，见 write-queue.js。
import { withFileWriter } from './write-queue.js'
import type { OpContext } from '../../contract/contexts.js'
import type { RepositoryRef, Issue } from '../../contract/entities.js'
import type { UpdatePatch, LabelInput, AssigneeInput, SetOpts } from '../../contract/inputs.js'

// 仓库引用：path 是本地后端的自有约定（契约不保证），有就多认那个目录（path.ts 的同款，房间里各备一份）。
type RepoWithPath = RepositoryRef & { path?: string }

// 定位到的目标文件（resolveIssueFile/resolveMapFile 的成功侧）：读改写三步都认它。
interface ResolvedTarget {
  ok: true
  path: string
  effortId: string
}

// 本文件交出去的失败形状：与 failAs 落的三段式一致（成功侧各函数自带）。
interface PatchFailure {
  ok: false
  error: { kind: string; message: string; raw: string }
}

async function resolveTarget(ctx: OpContext,repo: RepoWithPath | null,norm: string,mode: string): Promise<ResolvedTarget | PatchFailure>{
  if(norm==='00') return resolveMapFile(ctx,repo,{mode})
  return resolveIssueFile(ctx,repo,norm,{mode})
}
/** 读一份票文件、在内存里改、再整份写回去。
 *  这三步必须排在该文件的单写者队列里跑完（#922）：中间那一次读会让出事件循环，
 *  两路并发改同一张票时会一起读到同一份旧内容，各自改各自的，后写的那一路把先写的那一路的改动整份抹掉
 *  —— 两路都回成功，盘上却少了一半改动。队按文件分：批量补边一次要改很多张票，
 *  它们是不同的文件、彼此不冲突，仍然可以同时做（#919 的并发改造就是照这个口径放宽的）。 */
async function readParseWrite(ctx: OpContext,repo: RepoWithPath | null,r: ResolvedTarget,norm: string,fn: (txt: string) => string | undefined | Promise<string | undefined>, opts?: SetOpts): Promise<{ ok: true; txt: string } | PatchFailure>{
  return withFileWriter(ctx,repo,r.path,async function(){
    try{
      // 写前版本校验必须在队里、在读到这份文件之前（#1174 决策 9）：队外先比一次再进队，
      // 两次之间别人改了什么就比不出来，而这一条的全部意义正是拦住「后写覆盖先写」。
      const guard=await checkExpectedUpdatedAt(ctx,r.path,opts)
      if(!guard.ok)return guard
      let txt=await readTextFile(ctx,r.path)
      const out=await fn(txt)
      const next=typeof out==='string'?out:txt
      if(next!==txt)await writeTextFile(ctx,r.path,next, ctx&&(ctx as {sandboxPolicy?: unknown}).sandboxPolicy)
      return{ok:true,txt:next}
    }catch(e){return failFromError(e,ctx,'读—改—写这张票的文件时出错')}
  })
}
/** 这张票文件当前的「更新时间」：与票的 `updatedAt` 同源——`loadIssueFromFile` 取的就是文件 mtime。
 *  取不到就回 `null`：「拿不到版本」与「版本对得上」是两件事，混成一个值就会把「校验没做成」说成「校验通过」。 */
async function currentUpdatedAt(ctx: OpContext, fullPath: string): Promise<string | null> {
  try{
    const st=await statFile(ctx,fullPath) as Record<string, unknown> | null
    if(!st||typeof st!=='object')return null
    const t=st.mtime||st.mtimeMs||st.ctime
    if(t===undefined||t===null||t==='')return null
    if(t instanceof Date)return isNaN(t.getTime())?null:t.toISOString()
    if(typeof t==='number')return isNaN(t)?null:new Date(t).toISOString()
    const s=String(t)
    const d=new Date(s)
    return isNaN(d.getTime())?s:d.toISOString()
  }catch{return null}
}
/** 写前版本校验（#1174 决策 9；契约 `SetOpts.expectedUpdatedAt` 的乐观并发控制）。
 *
 *  四种情形各自诚实，绝不混：
 *   - 调用方**没给**期望值 → 不校验（今天全仓没有调用方传它，这是常态；见本票使用者故事 23）；
 *   - 给了、与盘上文件的更新时间**对得上** → 放行；
 *   - 给了、**对不上** → `conflict`，一个字都不写（这正是「不做后写覆盖先写」那句话的落点）；
 *   - 给了、但**文件时间取不到** → `unsupported`，也一个字都不写 —— 校验没做成就不许放行，
 *     放行等于把「不知道」说成「没被改过」。
 *
 *  原文一律给这次比的两个值（本地就能定论：是这两个串不一样），人据此自己核对。 */
async function checkExpectedUpdatedAt(ctx: OpContext, fullPath: string, opts: SetOpts | undefined): Promise<{ ok: true } | PatchFailure> {
  const want=opts&&typeof opts.expectedUpdatedAt==='string'?opts.expectedUpdatedAt.trim():''
  if(!want)return{ok:true}
  const cur=await currentUpdatedAt(ctx,fullPath)
  if(cur===null){
    return failAs(ERROR_KIND.UNSUPPORTED,'这个后端取不到这张票的更新时间，写前版本校验做不成，所以这次一个字都没写',fullPath)
  }
  if(cur!==want){
    return failAs(ERROR_KIND.CONFLICT,'expectedUpdatedAt mismatch（这张票在你读到它之后已经被改过，所以这次一个字都没写）',JSON.stringify({expected:want,actual:cur}))
  }
  return{ok:true}
}
/** 递进来的正文是不是「一整份票文件」：自带 H1 标题（或幂等锚）。
 *  为什么要分开判：下面的插入分支把正文插在现有 H1 之后，认错了盘上就会留下两个 H1、两份正文。
 *  实测：自带 H1、又不带 Status 行的整份正文走了插入分支，票文件被写坏，调用方却收到 ok。 */
function looksLikeWholeDocument(body: unknown): boolean{
  const t=String(body||'')
  return /^\s*#\s+\S/m.test(t)||/^\s*<!--\s*DSH-IDEMPOTENCY-KEY:/m.test(t)
}
/** 盘上那份文本里的字段行（Status/Type/Blocked by/Labels）：整份替换时用来补齐递进来的正文里缺的字段。 */
/** Assignees 也必须算进来（#1174 决策 12）：不算的话，一次「改正文」的整份替换会把认领人那一行整行抹掉。 */
function fieldLinesOf(text: unknown): string[]{
  const out: string[]=[]
  const lines=String(text||'').split('\n')
  for(const l of lines){ if(/^\s*(Status|Assignees|Type|Blocked\s+by|Labels)\s*[:\uFF1A]/i.test(l)) out.push(l.replace(/\s+$/,'')) }
  return out
}
function fieldNameOf(line: string): string{ return String(line).split(/[:\uFF1A]/)[0].trim().toLowerCase() }
/** 取票文件里某骨架区整段（标题加内容，到下一个二级标题或文末）：改正文时用来把盘上旧评论搬回新正文。 */
function sectionOf(text: unknown, name: string): string{
  const re=new RegExp('^##\\s*'+name+'\\s*$[\\s\\S]*?(?=^##\\s|$(?![\\s\\S]))', 'im')
  const m=re.exec(String(text||''))
  return m?m[0].replace(/^\s*/, '').replace(/\s*$/, ''):''
}
function countRe(text: unknown, re: RegExp): number{ return (String(text||'').match(re)||[]).length }
/** 写坏了没有的快速核对：新正文相对旧正文不许新增重复、不许弄丢锚与骨架，坏了就返回原因（调用方转成如实失败，不落盘）。
 *  缺字段补上（0 到 1）不算坏，那是在治旧数据的缺；翻倍（超过旧数且超过 1 个）才算坏。 */
function checkNoWorseForPatch(oldText: string, newText: string): string{
  const o=String(oldText||''), n=String(newText||'')
  const worse=function(oldC: number, newC: number): boolean{ return newC>1&&newC>oldC }
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
  // 认领人那一行（#1174 决策 12）：与 Status 同样按行数核对，翻倍才算坏。
  if(worse(countRe(o, /^\s*Assignees\s*[:\uFF1A]/gim), countRe(n, /^\s*Assignees\s*[:\uFF1A]/gim))) return 'Assignees 行变多了'
  return ''
}
/** 整份正文合并：锚一律用盘上旧的，缺一级标题用盘上旧标题补回，缺字段行与骨架区从盘上旧文件搬回（字段插在骨架之前）。 */
function mergeWholeBodyForPatch(incomingRaw: unknown, diskText: unknown): string{
  let incoming=String(incomingRaw||'')
  incoming=incoming.replace(/^[ \t]*<!--[ \t]*DSH-IDEMPOTENCY-KEY:.*?-->[ \t]*\r?\n?/gim, '')
  const diskAnchor=(String(diskText||'').match(/^[ \t]*<!--[ \t]*DSH-IDEMPOTENCY-KEY:.*?-->[ \t]*$/m)||[])[0]
  if(diskAnchor) incoming=String(diskAnchor).trim()+'\n'+incoming.replace(/^\s*/, '')
  // created 那行（#1174 决策 10）与锚同理：递进来的正文里没有，就把盘上那一行搬回来。
  // 不搬的话，一次「改正文」会让建票时间掉回文件修改时间，翻页顺序也跟着变（决策 11）。
  const diskCreated=(String(diskText||'').match(/^[ \t]*<!--[ \t]*created[ \t]*:.*?-->[ \t]*$/m)||[])[0]
  if(diskCreated&&!/<!--[ \t]*created[ \t]*:/.test(incoming)) incoming=String(diskCreated).trim()+'\n'+incoming
  const h1count=(incoming.match(/^#[ \t]+\S.*/gm)||[]).length
  if(h1count===0){
    const diskH1=(String(diskText||'').match(/^#[ \t]+.*$/m)||[])[0]
    if(diskH1){
      const lines=incoming.split('\n')
      let at=0
      // created 那行（#1174 决策 10）也是文件头注释：漏了它，标题会被插在它前面，
      // 于是「建票时间」掉出文件头、读不回来，创建时间又变回文件修改时间。
      while(at<lines.length&&/^[ \t]*<!--[ \t]*(DSH-IDEMPOTENCY-KEY|parentKey|created)[ \t]*:/.test(lines[at])) at++
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

export async function updateIssue(ctx: OpContext,repo: RepoWithPath | null,key: string,patch: UpdatePatch,opts?: SetOpts): Promise<{ ok: true; data: Issue } | PatchFailure>{
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
    // #1174：里程碑以前是被**静默丢掉**的 —— 调用方递进来、照样回成功，它以为写上了。
    // 本地票文件里没有放里程碑的地方，所以如实回「不支持」，而不是假装成功。
    // 传 null 是「清掉里程碑」，本地本来就没有，等同于要的结果，算成功。
    if(patch&&(patch as { milestone?: unknown }).milestone!==undefined&&(patch as { milestone?: unknown }).milestone!==null){
      const ms=(patch as { milestone?: unknown }).milestone
      const msTitle=typeof ms==='string'?ms:String((ms as { title?: unknown })?.title||'')
      if(msTitle.trim()) throw {kind:ERROR_KIND.UNSUPPORTED,message:'markdown update unsupported (milestone)：本地票文件里没有放里程碑的地方'}
    }
    if(patch&&Array.isArray(patch.customFields)){
      // #1174：契约里的自定义字段是开放形状（一个名字加一个值），本地票只有 `Type:` 这一行能放。
      // 以前是把不认识的字段悄悄丢掉、照样回成功。现在只认 Type，其余如实回不支持。
      const unknown=patch.customFields.filter(cf=>!(cf&&cf.name==='Type'&&typeof cf.value==='string'&&cf.value.trim()))
      if(unknown.length) throw {kind:ERROR_KIND.UNSUPPORTED,message:'markdown update unsupported (customFields '+unknown.map(cf=>String(cf&&cf.name)).join(', ')+')：本地票只有 Type 这一行能放，其余字段没有地方存'}
      for(const cf of patch.customFields){
        if(cf&&cf.name==='Type'&&typeof cf.value==='string'&&cf.value.trim()){
          txt=replaceOrInsertField(txt,'Type','Type: '+String(cf.value).trim().toLowerCase());changed=true
        }
      }
    }
    if(patch&&(patch as UpdatePatch & { labels?: unknown }).labels!==undefined){
      // patch.labels 不在契约 UpdatePatch 里（调用方把覆盖式改标签塞进补丁一并递进来，见 setLabelsIssue）：
      // 经视图读，不拓契约签名；求值与原来逐字相同。
      const patchLabels=(patch as UpdatePatch & { labels?: unknown }).labels
      // #634：写进去的标签名同样先剥掉外层成对引号/反引号——别人递进来的名字可能带着
      // 照着文档代码写法抄下来的那层引号，落盘时必须是干净的标签名，否则这层脏写法会被写进票面。
      const names=Array.isArray(patchLabels)? patchLabels.map(l=> typeof l==='string'? stripLabelDecoration(l) : (l&&l.name? stripLabelDecoration(l.name):'' )).filter(Boolean) : []
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
  },opts)
  if(!res.ok)return{ok:false,error:res.error}
  try{
    const iss=parseMd(res.txt,{key:norm,parentKey: norm==='00'?null:'00',isMap: norm==='00',effortId:r.effortId,url:r.path})
    applyLabelColors(iss, colorMap)
    return{ok:true,data:iss}
  }catch(e){return failFromError(e,ctx,'改这张票的字段时出错')}
}
export async function setBlockedByIssue(ctx: OpContext,repo: RepoWithPath | null,key: string,blockers: string[],opts?: SetOpts): Promise<{ ok: true; data: Issue } | PatchFailure>{
  const norm=String(key).padStart(2,'0')
  const colorMap=await loadPaintColorMap(ctx)
  // 原文 = 这张票自己的编号（结论是「入参自己和自己打架」，没有外部来源的原文）。
  if(Array.isArray(blockers)&&blockers.map(k=>String(k).padStart(2,'0')).includes(norm)){return failAs(ERROR_KIND.CONFLICT,'self-block '+norm,norm)}
  const r=await resolveTarget(ctx,repo,norm,'write')
  if(!r.ok)return{ok:false,error:r.error}
  const arr=Array.isArray(blockers)?blockers:[]
  const line=arr.length?'Blocked by: '+arr.map(k=>'#'+String(k).padStart(2,'0')).join(', '):'Blocked by:'
  // 全图环检（#1174；契约 operations.ts 的 setBlockedBy 一段写着「环检是写路径的一部分，不许省」）。
  // 放在写者队列里面：判环要读整张图，读完到落盘之间不许有本进程的别的写插进来。
  // 成环时 fn 返回 undefined —— 这一份文件一个字都不改，由下面把那次判定的失败原样交出去。
  let cycleFailure: PatchFailure | null=null
  const res=await readParseWrite(ctx,repo,r,norm,async function(txt){
    const verdict=await cycleVerdictFor(ctx,repo,r.effortId,norm,arr)
    if(!verdict.ok){ cycleFailure=verdict; return undefined }
    return replaceOrInsertField(txt,'Blocked\\s+by',line)
  },opts)
  if(cycleFailure)return cycleFailure
  if(!res.ok)return{ok:false,error:res.error}
  try{
    const iss=parseMd(res.txt,{key:norm,parentKey:'00',isMap:false,effortId:r.effortId,url:r.path})
    applyLabelColors(iss, colorMap)
    return{ok:true,data:iss}
  }catch(e){return failFromError(e,ctx,'改这张票的阻塞关系时出错')}
}
/** 把「这张票改成由这批票阻塞」代进整张图，判一次有没有成环。
 *
 *  两种结论：没有环 → 放行；有环 → `conflict`，并把环上经过的点按顺序写进原文给人看
 *  （只说「成环了」而不说哪几张票，人还得自己再去图上找一遍）。
 *  图读不全（列目录读不出来、某份票读不出来）时同样不放行：这时候「没看到环」不等于「没有环」。 */
async function cycleVerdictFor(ctx: OpContext, repo: RepoWithPath | null, effortId: string, key: string, blockers: unknown[]): Promise<{ ok: true } | PatchFailure>{
  const g=await readBlockedByGraph(ctx,repo,effortId)
  if(!g.ok)return{ok:false,error:g.error}
  const graph=new Map<string,string[]>(g.graph)
  graph.set(key,blockers.map(function(k){ return String(k).padStart(2,'0') }).filter(Boolean))
  const cycle=cycleThrough(graph,key)
  if(!cycle)return{ok:true}
  return failAs(ERROR_KIND.CONFLICT,'这条依赖写下去会成环（'+cycle.join(' → ')+'），所以这次一个字都没写',JSON.stringify({key:key,blockers:blockers,cycle:cycle}))
}
/** 在某个字段行的下一行插入一行；找不到那个字段就退回「插在标题下面」的通用写法。
 *
 *  为什么不用 replaceOrInsertField 直接插：它把新行插在文件第 1 行之后，而票文件第 0 行往往是幂等锚、
 *  第 1 行是标题。这样插出来的 Assignees 会跑到标题上面、夹在文件头注释里，下次改父票往头里插注释时更乱。 */
function insertFieldAfter(txt: string,afterName: string,newLine: string): string{
  const re=new RegExp('^[ \\t]*'+afterName+'[ \\t]*[:\\uFF1A][^\\r\\n]*$','im')
  const lines=String(txt||'').split('\n')
  for(let i=0;i<lines.length;i++){ if(re.test(lines[i])){ lines.splice(i+1,0,newLine); return lines.join('\n') } }
  return replaceOrInsertField(txt,afterName,newLine)
}
export async function setAssigneesIssue(ctx: OpContext,repo: RepoWithPath | null,key: string,assignees: AssigneeInput[],opts?: SetOpts): Promise<{ ok: true; data: Issue } | PatchFailure>{
  const norm=String(key).padStart(2,'0')
  const colorMap=await loadPaintColorMap(ctx)
  const r=await resolveTarget(ctx,repo,norm,'write')
  if(!r.ok)return{ok:false,error:r.error}
  // 认领人**原样落盘**（#1174 决策 12）：以前只按「给没给」写一个 claimed/ready 状态，谁认领的没有地方放，
  // 回读只能给一个 `@me` 占位符 —— 调用方看到的名字，既不是自己给的那个、也不是本地用户名。
  // 现在把名字写进 `Assignees:` 那一行；取消认领（给空数组、或根本没给）写一行空的，
  // 读回来是「明确没人认领」，与「这份文件没记下是谁」（老票、没有这一行）区分开。
  // 认领与否仍然写进 `Status:` —— 全房判开/关、判 frontier 都按那一行，不能改它的含义。
  const names=Array.isArray(assignees)?assignees.map(loginOfAssignee).filter(Boolean):[]
  const statusLine=names.length?'Status: claimed':'Status: ready-for-agent'
  const assigneeLine=names.length?'Assignees: '+names.join(', '):'Assignees:'
  const res=await readParseWrite(ctx,repo,r,norm,function(txt){
    return insertFieldAfter(replaceOrInsertField(txt,'Status',statusLine),'Status',assigneeLine)
  },opts)
  if(!res.ok)return{ok:false,error:res.error}
  try{
    const iss=parseMd(res.txt,{key:norm,parentKey:'00',isMap:false,effortId:r.effortId,url:r.path})
    applyLabelColors(iss, colorMap)
    return{ok:true,data:iss}
  }catch(e){return failFromError(e,ctx,'改这张票的认领人时出错')}
}
/** 把文件顶的父票注释换成新的值，没有这一行就插一行（#971）。
 *
 *  为什么要单独抽出来：改父在本地后端就是改这一行注释，不动文件位置。
 *  幂等锚那一行（DSH-IDEMPOTENCY-KEY）在最前，父注释紧跟在它后面；
 *  没有锚的文件直接插在最前。解除父子（null）写成明确的 null 字样，
 *  这样以后读回来是“没有父票”，而不会回落到老默认值 00。 */
function upsertParentComment(text: string, want: unknown): string {
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
function normParentKey(v: unknown): string | null {
  if (v === undefined || v === null) return null
  const t = String(v).trim()
  if (!t) return null
  if (/^null$/i.test(t) || /^none$/i.test(t) || t === '-') return null
  if (/^\d+$/.test(t)) return t.padStart(2, '0')
  return t
}
export async function setParentIssue(ctx: OpContext,repo: RepoWithPath | null,key: string,parentKey: string | null,opts?: SetOpts): Promise<{ ok: true; data: Issue } | PatchFailure>{
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
        const iss=parseMd(txt,{key:'00',parentKey:null,isMap:true,effortId:r.effortId,url:r.path})
        applyLabelColors(iss, colorMap)
        return{ok:true,data:iss}
      }catch(e){return failFromError(e,ctx,'改这张票的父子关系时出错')}
    }
    // 原文给空串：这一支一个文件都没写出去（地图票的父是结构上没有的东西）。
    return failAs(ERROR_KIND.UNSUPPORTED,'markdown setParent unsupported (map has no parent)','')
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
    },opts)
    if(!res.ok)return{ok:false,error:res.error}
    try{
      const iss=parseMd(res.txt,{key:norm,parentKey:'00',isMap:false,effortId:childEffort,url:r.path})
      applyLabelColors(iss, colorMap)
      return{ok:true,data:iss}
    }catch(e){return failFromError(e,ctx,'改这张票的父子关系时出错')}
  }
  // 新父必须在同一个工作单元里（同一个目录树下）：目录即父子，跨目录搬文件不支持，如实失败。
  if(want==='00'){
    const mr=await resolveMapFile(ctx,repo,{effortId:childEffort,mode:'read'})
    // 原文 = 这次请求的入参与目标工作单元（本地就能定论：这个单元里没有地图文件，父票无从查起）。
    if(!mr.ok)return failAs(ERROR_KIND.NOTFOUND,'parent 00 not-found in effort「'+childEffort+'」',JSON.stringify({key:norm,parentKey:String(parentKey),effortId:childEffort}))
    const res=await readParseWrite(ctx,repo,r,norm,function(txt){
      try{
        const cur0=parseMd(txt,{key:norm,parentKey:'00',isMap:false,effortId:childEffort}).parentKey
        const curN=cur0===undefined||cur0===null?null:normParentKey(cur0)
        if(curN===want)return undefined
      }catch{}
      return upsertParentComment(txt, '00')
    },opts)
    if(!res.ok)return{ok:false,error:res.error}
    try{
      const iss=parseMd(res.txt,{key:norm,parentKey:'00',isMap:false,effortId:childEffort,url:r.path})
      applyLabelColors(iss, colorMap)
      return{ok:true,data:iss}
    }catch(e){return failFromError(e,ctx,'改这张票的父子关系时出错')}
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
    },opts)
    if(!res.ok)return{ok:false,error:res.error}
    try{
      const iss=parseMd(res.txt,{key:norm,parentKey:'00',isMap:false,effortId:childEffort,url:r.path})
      applyLabelColors(iss, colorMap)
      return{ok:true,data:iss}
    }catch(e){return failFromError(e,ctx,'改这张票的父子关系时出错')}
  }
  // 同目录里找不到这个父：看它是不是在别的工作单元里，是就是跨目录（不支持），不是就是不存在。
  try{
    const anywhere=await resolveIssueFile(ctx,repo,want,{effortId:null,mode:'read'})
    // 原文 = 这次请求的入参与实际找到的那个工作单元（人据此自己核对为什么判成跨工作单元）。
    if(anywhere&&anywhere.ok)return failAs(ERROR_KIND.UNSUPPORTED,'markdown setParent unsupported (cross-effort '+childEffort+' -> '+(anywhere.effortId||'')+')',JSON.stringify({key:norm,parentKey:String(parentKey),childEffort:childEffort,parentEffort:anywhere.effortId||''}))
  }catch{}
  // 原文 = 那个找不到的父编号（本地就能定论：把它拿去找过、没找到）。
  return failAs(ERROR_KIND.NOTFOUND,'parent '+want+' not-found',String(want))
}
export async function setLabelsIssue(ctx: OpContext,repo: RepoWithPath | null,key: string,labels: LabelInput[],opts?: SetOpts): Promise<{ ok: true; data: Issue } | PatchFailure>{
  const norm=String(key).padStart(2,'0')
  const colorMap=await loadPaintColorMap(ctx)
  // #634：与 patch.labels 同口径——落盘的标签名先剥掉外层成对引号/反引号
  const names=Array.isArray(labels)? labels.map(l=> stripLabelDecoration(typeof l==='string'? l : (l&&typeof l.name==='string'? l.name:String(l)))).filter(Boolean) : []
  const r=await resolveTarget(ctx,repo,norm,'write')
  if(!r.ok)return{ok:false,error:r.error}
  const line=names.length? 'Labels: '+names.join(', ') : 'Labels:'
  const res=await readParseWrite(ctx,repo,r,norm,function(txt){return replaceOrInsertField(txt,'Labels',line)},opts)
  if(!res.ok)return{ok:false,error:res.error}
  try{
    const iss=parseMd(res.txt,{key:norm,parentKey: norm==='00'?null:'00',isMap: norm==='00',effortId:r.effortId,url:r.path})
    applyLabelColors(iss, colorMap)
    return{ok:true,data:iss}
  }catch(e){return failFromError(e,ctx,'改这张票的标签时出错')}
}
