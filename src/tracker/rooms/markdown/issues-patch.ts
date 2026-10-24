// issues-patch.js —— 以后改打补丁类字段更新时改它（预估约 190 行）。
//
// effort 维度（2026-09-09）：所有写路径按 (effort 范围, 编号) 定位文件，多命中即 conflict。
import { parseMd, stripLabelDecoration, parentKeyFromFile, isWholeIssueBody, loginOfAssignee } from './parse.js'
import { readTextFile } from './read.js'
import { publishTextFile } from './write.js'
// #1059：整份正文的合并与「写坏没有」的核对搬到了 patch-body.ts（纯文本函数，与写盘无关）；
// 那一路补上结论线之后这份文件越过了 350 有效行的上限，抽出去才回到线内。
import { looksLikeWholeDocument, fieldLinesOf, checkNoWorseForPatch, mergeWholeBodyForPatch, moveLeadingSectionBelowTitle, upsertParentComment, hasExplicitParentComment, normParentKey } from './patch-body.js'
// #1059：这一趟写没写下去的结论线（事件 `issue.write`，与 GitHub 房同一个名字、同一套字段；GitLab 房的写路径还没做）。
import { beginWriteTrail, emitIssueWrite, noteFileWritten } from './write-log.js'
import type { WriteTrail } from './write-log.js'
// #1060：关系与边那一族的结论线（事件 `edge.write` / `edge.cycle`，与 GitHub 房同一个名字、同一套字段）。
import { beginEdgeTrail, emitEdgeWrite } from './edge-log.js'
import type { EdgeTrail } from './edge-log.js'
import { failAs, failFromError } from './error-fail.js'
import { ERROR_KIND } from '../../contract/vocabulary.js'
import { resolveIssueFile, resolveMapFile } from './issues-locate.js'
// #1277：文件头里父注释的插入位置要认得类型标记行 —— 标记紧跟在幂等锚后面，父注释排在标记之后。
import { markerKindOnLine } from '../../../shared/issue-file/src/marker.js'
import { loadPaintColorMap, applyLabelColors } from './label-colors-paint.js'
import { replaceOrInsertField, rewriteTicketText } from './issues-status.js'
// #1489：原文布局的字段原语（隐藏注释、裸字段行、票种类判定），见 original-fields.ts。
import { removeBareField, replaceBareField, ticketFormOf, upsertHiddenComment } from './original-fields.js'
// #1174：写阻塞边之前的全图环检（契约明写「环检是写路径的一部分，不许省」）。
// #922：票文件的读—改—写按文件排队，见 write-queue.js。
import { checkExpectedUpdatedAt, cycleVerdictFor } from './write-guards.js'
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
async function readParseWrite(ctx: OpContext,repo: RepoWithPath | null,r: ResolvedTarget,norm: string,fn: (txt: string) => string | undefined | Promise<string | undefined>, opts?: SetOpts, trail?: WriteTrail, onWritten?: () => void): Promise<{ ok: true; txt: string } | PatchFailure>{
  return withFileWriter(ctx,repo,r.path,async function(){
    try{
      // 写前版本校验必须在队里、在读到这份文件之前（#1174 决策 9）：队外先比一次再进队，
      // 两次之间别人改了什么就比不出来，而这一条的全部意义正是拦住「后写覆盖先写」。
      const guard=await checkExpectedUpdatedAt(ctx,r.path,opts)
      if(!guard.ok)return guard
      let txt=await readTextFile(ctx,r.path)
      const out=await fn(txt)
      const next=typeof out==='string'?out:txt
      if(next!==txt){
        // #1182：整份覆盖写走原子发布（同目录临时文件 + 改名；没有改名原语时退回整份直写）——
        // 写一半崩掉不会把这张票留成半截内容。各路写票文件的地方同一条口径。
        await publishTextFile(ctx,r.path,next, ctx&&(ctx as {sandboxPolicy?: unknown}).sandboxPolicy)
        // 只有真写了才记（#1059）：内容没变那一路一份文件都没写，结论是 noop 而不是 edited。
        noteFileWritten(trail)
        // 关系与边那两条入口要的也是同一件事（#1060）：写盘这一步真做成了，才把 route 与增减记进事实桶。
        // 传「打算改几条」是不行的 —— 写盘抛错那一路分量一条都没落，结论线上却会报「写了 file、挂上一条」。
        if(onWritten)onWritten()
      }
      return{ok:true,txt:next}
    }catch(e){return failFromError(e,ctx,'读—改—写这张票的文件时出错')}
  })
}

/** 改票的入口：先起一个事实桶，这一趟写完后按实况落一行结论（#1059）。 */
export async function updateIssue(ctx: OpContext,repo: RepoWithPath | null,key: string,patch: UpdatePatch,opts?: SetOpts): Promise<{ ok: true; data: Issue } | PatchFailure>{
  const t0=Date.now()
  const trail=beginWriteTrail()
  const r=await updateIssueInner(ctx,repo,key,patch,opts,trail)
  emitIssueWrite(ctx,'update',trail,r,t0)
  return r
}
async function updateIssueInner(ctx: OpContext,repo: RepoWithPath | null,key: string,patch: UpdatePatch,opts?: SetOpts,trail?: WriteTrail): Promise<{ ok: true; data: Issue } | PatchFailure>{
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
        txt=moveLeadingSectionBelowTitle(mergeWholeBodyForPatch(patch.body, fnOldText));changed=true
      }else{
        const lines=txt.split('\n')
        const titleIdx=lines.findIndex(l=>/^#+\s+/.test(l))
        let insertAt=titleIdx>=0?titleIdx+1:0
        while(insertAt<lines.length&&lines[insertAt].trim()==='')insertAt++
        // 正文区的范围是「标题之后」到「第一条字段行之前」。字段名要认全（含 Assignees 与 Close reason）：
        // 漏一个，那一条就会被划进正文区、被这次改写整行丢掉（#1174 复核 P1-1）。
        let fieldIdx=lines.findIndex((l,i)=>i>=insertAt&&/^\s*(Status|Assignees|Type|Blocked\s+by|Labels|Close\s+reason)\s*[:\uFF1A]/i.test(l))
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
      // 只认「有没有给里程碑」，不认它长什么样：契约里它的形状是 `{name}`（别的后端也可能只给编号或一串名字），
      // 而本地票文件里根本没有放里程碑的地方 —— 给了就一律如实回不支持。
      // （#1174 复核 P1-2：这里早先只读 `title`，于是契约自己的形状 `{name:'v1'}` 反而被静默丢掉还回一句成功。）
      const ms=(patch as { milestone?: unknown }).milestone
      const msLabel=typeof ms==='string'?ms:String((ms as { name?: unknown })?.name||(ms as { title?: unknown })?.title||(ms as { number?: unknown })?.number||'')
      throw {kind:ERROR_KIND.UNSUPPORTED,message:'markdown update unsupported (milestone'+(msLabel.trim()?' '+msLabel.trim():'')+')：本地票文件里没有放里程碑的地方'}
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
  },opts,trail)
  if(!res.ok)return{ok:false,error:res.error}
  try{
    const iss=parseMd(res.txt,{key:norm,parentKey: norm==='00'?null:'00',isMap: norm==='00',effortId:r.effortId,url:r.path})
    applyLabelColors(iss, colorMap)
    return{ok:true,data:iss}
  }catch(e){return failFromError(e,ctx,'改这张票的字段时出错')}
}
/** 一条边在「读回来的形状」里长什么样：读路径把它补成了 `{key,title,state}` 三格，写路径拿到的却是裸编号。
 *  对账要在同一把尺子上比，就先统一取那一格 key —— 照着对象去比，两边永远不相等，差集会把每条边都算成「新挂」。 */
function keyOfRef(k: unknown): string{
  if(k&&typeof k==='object'){ const r=k as { key?: unknown }; return r.key===undefined||r.key===null?'':String(r.key) }
  return k===undefined||k===null?'':String(k)
}
/** 一批边编号归一：补成两位、去掉重复。
 *
 *  为什么要把重复去掉：同一张票在入参里写两遍，落到票文件上就是一条边（`Blocked by: #02, #02` 与 `#02` 是同一件事）。
 *  结论线要报「真挂上去几条」，就得与写出来的那一行同一把尺子量。 */
function uniqueKeysOf(keys: unknown[]): string[]{
  const out: string[]=[]
  for(const k of keys){
    const t=keyOfRef(k).padStart(2,'0')
    if(t&&out.indexOf(t)<0)out.push(t)
  }
  return out
}
/** 盘上这张票现在挂着哪几条阻塞边：从刚读到的这一份文本里解析，与读路径用同一把尺子。
 *
 *  解析不动时按「一条都没有」算：对账只是为了让结论线说实话，不许因为它把一次本来能写成的改动拦下来。 */
function keysOfBlockedBy(txt: string,key: string,effortId: string): string[]{
  try{
    const iss=parseMd(txt,{key:key,parentKey:'00',isMap:false,effortId:effortId})
    return uniqueKeysOf(iss.blockedBy||[])
  }catch{return []}
}
/** 改阻塞边的入口：先起一个事实桶，这一趟写完后按实况落一行结论（#1060，事件 `edge.write`）。 */
export async function setBlockedByIssue(ctx: OpContext,repo: RepoWithPath | null,key: string,blockers: string[],opts?: SetOpts): Promise<{ ok: true; data: Issue } | PatchFailure>{
  const t0=Date.now()
  const trail=beginEdgeTrail()
  const r=await setBlockedByInner(ctx,repo,key,blockers,opts,trail)
  emitEdgeWrite(ctx,'block',trail,r,t0)
  return r
}
async function setBlockedByInner(ctx: OpContext,repo: RepoWithPath | null,key: string,blockers: string[],opts?: SetOpts,trail?: EdgeTrail): Promise<{ ok: true; data: Issue } | PatchFailure>{
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
  // 这一趟真写下去时该记的增减：先在队内算出来放这里，等 readParseWrite 说「文件真写成了」才记进事实桶。
  // 为什么不能算完就记：写盘那一步会抛错（目录没权限、文件被占），那一路份量一条都没落，
  // 结论线上必须报 route=none、增减全 0，才与附录里「失败那一趟说的正是『一个字都没写』」对得上。
  let pending: { added: number; removed: number } | null=null
  const res=await readParseWrite(ctx,repo,r,norm,async function(txt){
    const verdict=await cycleVerdictFor(ctx,repo,r.effortId,norm,arr)
    if(!verdict.ok){ cycleFailure=verdict; return undefined }
    // 写前逐条对账（#1060）：盘上这张票现在挂着哪几条边，与这次要写的那几条比一次差集。
    // 为什么在写者队列里面、拿刚读到的这一份算：队外先读一次再比，两路并发改同一张票时比的是旧值，
    // 结论线就会把「已经撤下去的边」记成还在位。
    const oldKeys=keysOfBlockedBy(txt,norm,r.effortId)
    const wantKeys=uniqueKeysOf(arr)
    const added=wantKeys.filter(k=>oldKeys.indexOf(k)<0)
    const removed=oldKeys.filter(k=>wantKeys.indexOf(k)<0)
    // kept 当场就记：它说的是「读回来的这一份里本来就有几条边」，与这一趟写没写成无关。
    if(trail)trail.kept=wantKeys.length-added.length
    // 差集为空：盘上本来挂的就是这几条边，这一趟一处都不用改（结论线记 noop、route 停在 none）。
    if(!added.length&&!removed.length)return undefined
    pending={ added: added.length, removed: removed.length }
    return replaceOrInsertField(txt,'Blocked\\s+by',line)
  },opts,undefined,function(){
    if(!trail||!pending)return
    trail.route='file'
    trail.added=pending.added
    trail.removed=pending.removed
  })
  if(cycleFailure)return cycleFailure
  if(!res.ok)return{ok:false,error:res.error}
  try{
    const iss=parseMd(res.txt,{key:norm,parentKey:'00',isMap:false,effortId:r.effortId,url:r.path})
    applyLabelColors(iss, colorMap)
    return{ok:true,data:iss}
  }catch(e){return failFromError(e,ctx,'改这张票的阻塞关系时出错')}
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
/** 改认领的入口：先起一个事实桶，这一趟写完后按实况落一行结论（#1059）。 */
export async function setAssigneesIssue(ctx: OpContext,repo: RepoWithPath | null,key: string,assignees: AssigneeInput[],opts?: SetOpts): Promise<{ ok: true; data: Issue } | PatchFailure>{
  const t0=Date.now()
  const trail=beginWriteTrail()
  const r=await setAssigneesInner(ctx,repo,key,assignees,opts,trail)
  emitIssueWrite(ctx,'setAssignees',trail,r,t0)
  return r
}
async function setAssigneesInner(ctx: OpContext,repo: RepoWithPath | null,key: string,assignees: AssigneeInput[],opts?: SetOpts,trail?: WriteTrail): Promise<{ ok: true; data: Issue } | PatchFailure>{
  const norm=String(key).padStart(2,'0')
  // 认领人**原样落盘**（#1174 决策 12）：以前只按「给没给」写一个 claimed/ready 状态，谁认领的没有地方放，
  // 回读只能给一个 @me 占位符 —— 调用方看到的名字，既不是自己给的那个、也不是本地用户名。
  const names=Array.isArray(assignees)?assignees.map(loginOfAssignee).filter(Boolean):[]
  // #1489：原文布局里认领人只写文件头隐藏注释 DSH-ASSIGNEES（原文没有 Assignees 行），可见状态行按票种类决定——
  //  · 实施票的 **Status:** 原文只有 ready-for-agent/resolved 两档，认领不改它（写 claimed 读回来也认不出这个值）；
  //  · 地图子票的裸 Status 原文两档就是 claimed/resolved：派了人写 claimed，撤空则删掉这一行回到「没人派」。
  // 旧布局（没有原文标记的老文件）继续写可见 Status + Assignees 行，行为与 #1489 之前一字不差。
  const res=await rewriteTicketText(ctx,repo,norm,function(txt,target){
    if(target.container||ticketFormOf(txt)!=='legacy'){
      const hidden=names.length?names.join(', '):null
      if(target.container)return upsertHiddenComment(txt,'DSH-ASSIGNEES',hidden)
      if(ticketFormOf(txt)==='map-ticket'){
        let out=upsertHiddenComment(txt,'DSH-ASSIGNEES',hidden)
        if(names.length) out=replaceBareField(out,'Status','claimed')
        else if(/^[ \t]*Status[ \t]*[:：][ \t]*claimed[ \t]*$/im.test(out)) out=removeBareField(out,'Status')
        return out
      }
      // 实施票：只动隐藏注释，可见加粗状态行原样留着（认领不是原文里的一种状态）。
      return upsertHiddenComment(txt,'DSH-ASSIGNEES',hidden)
    }
    const statusLine=names.length?'Status: claimed':'Status: ready-for-agent'
    const assigneeLine=names.length?'Assignees: '+names.join(', '):'Assignees:'
    return insertFieldAfter(replaceOrInsertField(txt,'Status',statusLine),'Status',assigneeLine)
  },trail,opts)
  if(!res.ok)return{ok:false,error:res.error}
  return res
}
/** 改父子的入口：先起一个事实桶，这一趟写完后按实况落一行结论（#1060，事件 `edge.write`）。 */
export async function setParentIssue(ctx: OpContext,repo: RepoWithPath | null,key: string,parentKey: string | null,opts?: SetOpts): Promise<{ ok: true; data: Issue } | PatchFailure>{
  const t0=Date.now()
  const trail=beginEdgeTrail()
  const r=await setParentInner(ctx,repo,key,parentKey,opts,trail)
  emitEdgeWrite(ctx,'parent',trail,r,t0)
  return r
}
/** 盘上这张票现在的父票编号，外加「这个编号是明写的还是结构给的默认值」。
 *
 *  为什么要分「认没认出来」与「认出来的值」两格：老写法把文本解析失败吞掉之后照样往下写，
 *  这里保持同一条行为——认不出来当作「与目标值不等」，绝不当作「已经等于目标值」，否则会漏写一次本该有的改动（#922）。
 *  为什么还要第三格 explicit：没写父注释的票读回来是默认父票（地图 '00'），那不是盘上记着的一条边（见 hasExplicitParentComment）。 */
function currentParentOf(txt: string,key: string,effortId: string): { known: boolean; key: string | null; explicit: boolean }{
  try{
    const cur0=parseMd(txt,{key:key,parentKey:'00',isMap:false,effortId:effortId}).parentKey
    return{known:true,key:cur0===undefined||cur0===null?null:normParentKey(cur0),explicit:hasExplicitParentComment(txt)}
  }catch{return{known:false,key:null,explicit:false}}
}
/** 挂父 / 改挂 / 解除父子共用的那一趟读—改—写，顺手把这一趟边上的事实记进事实桶（#1060）。
 *
 *  三种走法（挂到地图上、挂到同一工作单元的某张票上、去掉父注释）做的都是同一件事：换掉正文里那一行父注释。
 *  差别只在「要不要写」与「撤几条挂几条」：目标那条边已经在位就一处不改（挂父那一趟记 kept 一笔），
 *  本来没有父就是新挂（记 added 一笔），原来是别的父就是改挂（撤一条、挂一条，结论线上记 diff，见下）。
 *  怎么算「撤下来一条」按 #1060 定下的口径：只有盘上**真明写着**另一条父注释才算；
 *  没写父注释的票读回来落在默认父票（地图 '00'）上，那是结构给的默认值、不是盘上记着的一条边，
 *  所以「挂到某张票上」记 added=1、removed=0。解析不出来那一趟按「与目标值不等」照旧往下写，
 *  但既然盘上有没有边都认不出来，就不记 removed（与 kept 同一层意思：看不见的边不当成撤下来了）。
 *  增减等 readParseWrite 说「文件真写成了」才记（#1182）：写盘那一步会抛错（目录没权限、文件被占），
 *  那一路份量一条都没落，结论线上必须报 route=none、增减全 0，才与附录里
 *  「失败那一趟说的正是『一个字都没写』」对得上。 */
async function writeParentLink(ctx: OpContext,repo: RepoWithPath | null,r: Parameters<typeof readParseWrite>[2],norm: string,childEffort: string,want: string | null,opts: SetOpts | undefined,colorMap: Awaited<ReturnType<typeof loadPaintColorMap>>,trail?: EdgeTrail): Promise<{ ok: true; data: Issue } | PatchFailure>{
  // 真写下去时该记的增减：先算出来放这里，等 readParseWrite 回话说「文件写成了」才记进事实桶。
  let pending: { added: number; removed: number } | null=null
  const res=await readParseWrite(ctx,repo,r,norm,function(txt){
    const cur=currentParentOf(txt,norm,childEffort)
    if(cur.known&&cur.key===want){
      // 挂父那一趟是真有一条边在位（kept 记一笔）；解除那一趟是本来就没有边可撤（kept 记 0，免得把「没有边」说成「边在位」）。
      if(trail&&want!==null)trail.kept=1
      return undefined
    }
    const added=want!==null?1:0
    // 只有「盘上真明写着另一条父注释」才算撤下来一条：默认父票（地图 '00'）不是盘上记着的一条边，
    // 解析不出来那一趟也看不见边在哪，两种都不记 removed（#1060 口径，与 hasExplicitParentComment 的说明同一件事）。
    const removed=(want===null)?1:((cur.known&&cur.explicit&&cur.key!==null)?1:0)
    pending={ added: added, removed: removed }
    return upsertParentComment(txt, want)
  },opts,undefined,function(){
    if(!trail||!pending)return
    trail.route='file'
    trail.added=pending.added
    trail.removed=pending.removed
  })
  if(!res.ok)return{ok:false,error:res.error}
  try{
    const iss=parseMd(res.txt,{key:norm,parentKey:'00',isMap:false,effortId:childEffort,url:r.path})
    applyLabelColors(iss, colorMap)
    return{ok:true,data:iss}
  }catch(e){return failFromError(e,ctx,'改这张票的父子关系时出错')}
}
async function setParentInner(ctx: OpContext,repo: RepoWithPath | null,key: string,parentKey: string | null,opts?: SetOpts,trail?: EdgeTrail): Promise<{ ok: true; data: Issue } | PatchFailure>{
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
    return writeParentLink(ctx,repo,r,norm,childEffort,want,opts,colorMap,trail)
  }
  // 新父必须在同一个工作单元里（同一个目录树下）：目录即父子，跨目录搬文件不支持，如实失败。
  if(want==='00'){
    const mr=await resolveMapFile(ctx,repo,{effortId:childEffort,mode:'read'})
    // 原文 = 这次请求的入参与目标工作单元（本地就能定论：这个单元里没有地图文件，父票无从查起）。
    if(!mr.ok)return failAs(ERROR_KIND.NOTFOUND,'parent 00 not-found in effort「'+childEffort+'」',JSON.stringify({key:norm,parentKey:String(parentKey),effortId:childEffort}))
    return writeParentLink(ctx,repo,r,norm,childEffort,want,opts,colorMap,trail)
  }
  const pr=await resolveIssueFile(ctx,repo,want,{effortId:childEffort,mode:'read'})
  if(pr.ok&&(pr.effortId||'')===childEffort){
    return writeParentLink(ctx,repo,r,norm,childEffort,want,opts,colorMap,trail)
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
/** 贴标签的入口：先起一个事实桶，这一趟写完后按实况落一行结论（#1059）。 */
export async function setLabelsIssue(ctx: OpContext,repo: RepoWithPath | null,key: string,labels: LabelInput[],opts?: SetOpts): Promise<{ ok: true; data: Issue } | PatchFailure>{
  const t0=Date.now()
  const trail=beginWriteTrail()
  const r=await setLabelsInner(ctx,repo,key,labels,opts,trail)
  emitIssueWrite(ctx,'setLabels',trail,r,t0)
  return r
}
async function setLabelsInner(ctx: OpContext,repo: RepoWithPath | null,key: string,labels: LabelInput[],opts?: SetOpts,trail?: WriteTrail): Promise<{ ok: true; data: Issue } | PatchFailure>{
  const norm=String(key).padStart(2,'0')
  // #634：与 patch.labels 同口径——落盘的标签名先剥掉外层成对引号/反引号
  const names=Array.isArray(labels)? labels.map(l=> stripLabelDecoration(typeof l==='string'? l : (l&&typeof l.name==='string'? l.name:String(l)))).filter(Boolean) : []
  // #1489：原文布局没有可见 Labels 行，标签写文件头隐藏注释 DSH-LABELS；旧布局继续写可见 Labels 行不变。
  // 手写文件里人自己补过可见 Labels 行时两处一起改：解析以可见行为准，只改隐藏注释会读回旧值。
  const res=await rewriteTicketText(ctx,repo,norm,function(txt,target){
    const line=names.length? 'Labels: '+names.join(', ') : 'Labels:'
    if(!target.container&&ticketFormOf(txt)==='legacy')return replaceOrInsertField(txt,'Labels',line)
    let out=upsertHiddenComment(txt,'DSH-LABELS',names.length?names.join(', '):null)
    if(/^[ \t]*(?:\*\*)?Labels(?:\*\*)?[ \t]*[:：]/im.test(out)) out=replaceOrInsertField(out,'Labels',line)
    return out
  },trail,opts)
  if(!res.ok)return{ok:false,error:res.error}
  return res
}
