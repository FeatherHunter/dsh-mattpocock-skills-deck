// issues-create.js —— 以后改新建单据落盘格式时改它（预估约 100 行）。
//
// effort 维度（2026-09-09）：建票必须落在**一个明确的 effort** 里，编号按契约「每个 effort 从 01 起」在该 effort 内取 max+1。
//   - repo.effortId 给出 → 就落在那一个 effort；
//   - 仓库只有一个 effort → 自动落它（单 effort 仓库用起来无感）；
//   - 仓库有多个 effort 又没指定 → 返回 conflict 诚实失败，绝不猜（旧实现在所有 effort 之间取全局 max+1，
//     与契约冲突，而且因为少了 getScratchRoot 的 import 从未生效）。
import { parseMd, slugify, stripLabelDecoration, isWholeIssueBody, loginOfAssignee } from './parse.js'
import { listDir, readTextFile, statFile, exists } from './read.js'
import { publishTextFile, ensureDir } from './write.js'
// #1059：这一趟写没写下去的结论线（事件 `issue.write`，与 GitHub 房同一个名字、同一套字段；GitLab 房的写路径还没做）。
import { beginWriteTrail, emitIssueWrite, noteFileWritten } from './write-log.js'
import type { WriteTrail } from './write-log.js'
import { issuesDir } from './path.js'
import { failAs, failFromError } from './error-fail.js'
import { ERROR_KIND } from '../../contract/vocabulary.js'
import { getPlat, listEfforts, findIssueFileInEffort } from './issues-locate.js'
import { loadPaintColorMap, applyLabelColors } from './label-colors-paint.js'
// #712/#922：建票取号的「读目录 → 取号 → 落盘」排队，与写票文件、配色文件共用 write-queue.js 那一份实现。
import { withWorkspaceWriter } from './write-queue.js'
// #711：创建幂等锚。锚那一行长什么样、怎么从票面把锚读回来、回查命中要满足什么条件，
// 全在刷新核心的产物里（唯一一处判据），本文件只负责把锚写进票文件、并从盘上按锚找票。
// #1174：回查的**结论**也交给那份判据（matchAnchor）—— 旧实现自己写了一套「比中锚就算命中」，
// 少了「候选必须还开着」这一条，于是票关掉之后拿同一个锚再提交，会把新活记到那张关着的旧票上。
import { anchorLineFor, checkIdempotencyKey, idempotencyKeyOf, matchAnchor, isAnchorHit, isAnchorUnsupported, anchorUnsupported, describeAnchorFailure } from '../../../shared/refresh/idempotency.js'
import type { AnchorCandidate, AnchorMatch } from '../../../shared/refresh/src/idempotency.js'
import type { OpContext } from '../../contract/contexts.js'
import type { RepositoryRef, Issue } from '../../contract/entities.js'
import type { CreateInput, LabelInput } from '../../contract/inputs.js'

// 仓库引用：path 是本地后端的自有约定（契约不保证），有就多认那个目录（path.ts 的同款，房间里各备一份）。
type RepoWithPath = RepositoryRef & { path?: string }

// 调用方递进来的创建输入：契约只收小写子集，运行时还会带大小写两种写法（Type/Labels）、
// 状态行（status）、阻塞行（blockedBy）与整行字符串的 labels（见 buildIssueText 的读取）；
// 经视图读，不拓契约签名。
type CreateView = Omit<CreateInput, 'labels'> & { labels?: LabelInput[] | string; Type?: unknown; Labels?: unknown; status?: unknown; blockedBy?: unknown }

// 写者队列里取号落盘的结果：成功带落盘位置（命中锚复用旧票也走这里），失败带三段式。
interface CreatePlacement {
  ok: true
  effortId: string
  finalPath: string
  finalKey: string
  reused: boolean
}
interface CreateFailure {
  ok: false
  error: { kind: string; message: string; raw: string }
}

/** 选定这次的票落在哪个 effort（这是**读**，不影响并发，放在写者队列外面）。
 *  - repo.effortId 给出 → 就落在那一个 effort；
 *  - 仓库只有一个 effort → 自动落它；
 *  - 仓库有多个 effort 又没指定 → 返回 conflict 诚实失败，绝不猜；
 *  - 指了 effort 但它不存在 → NOTFOUND 诚实失败，绝不落到根目录
 *    （否则票写进 .scratch/issues/ 面板永远看不见）。 */
async function resolveCreateTarget(ctx: OpContext, repo: RepositoryRef | null): Promise<{ ok: true; effortId: string; idir: string } | CreateFailure>{
  const efforts=await listEfforts(ctx)
  const scope=(repo&&repo.effortId!==undefined&&repo.effortId!==null)?String(repo.effortId):undefined
  let target: { effortId: string; dir: string } | null=null
  if(scope!==undefined){
    target=efforts.find(function(e){ return e.effortId===scope })||null
    if(!target){
      const have=efforts.map(function(e){ return e.effortId||'(根)' }).join('、')||'（本仓库还没有 effort）'
      return failAs(ERROR_KIND.NOTFOUND,'找不到 effort「'+scope+'」；本仓库现有：'+have,JSON.stringify({effortId:scope,have:have}))
    }
  }else if(efforts.length===1){
    target=efforts[0]
  }else if(efforts.length>1){
    return failAs(ERROR_KIND.CONFLICT,'本仓库有 '+efforts.length+' 个 effort（'+efforts.map(function(e){return e.effortId||'(根)'}).join('、')+'），新建票据必须指定 effortId',JSON.stringify(efforts.map(function(e){return e.effortId||'(根)'})))
  }
  return{ok:true,effortId:target?target.effortId:'',idir:target?getPlat(ctx).join(target.dir,'issues'):issuesDir(repo,ctx)}
}

/** 票面正文（落盘内容）。单独抽出来是因为落盘要在写者队列里做、回包还要按同一份内容解析，
 *  两处必须是同一份文本，不能各拼一遍（拼两遍迟早走样）。
 *
 *  #711：锚是这份正文的**第一行**（HTML 注释，渲染后看不见）。为什么放第一行：有人用编辑器打开
 *  这个文件时一眼能看到它、知道这一行是插件写的别删；写在正文中间或末尾，手改正文的人多半会把它
 *  当多余的东西删掉，删掉之后回查就再也找不到这张票了。
 *
 *  #1002：递进来的正文可能是片段，也可能是整份票文件（读回原样再建）。整份用共享判据认出来后，
 *  先把里面的旧锚、旧父注释、旧一级标题、旧字段行、旧骨架区都剥掉，再按新票的标题与字段重建一份，
 *  文件顶的锚一律用本次创建自己的。这样读回原样写回不会翻倍，新票也不会抄走旧票的评论与身份。 */
function cleanWholeBodyForCreate(rawBody: string): string{
  let clean=String(rawBody||'')
  clean=clean.replace(/^[ \t]*<!--[ \t]*DSH-IDEMPOTENCY-KEY:.*?-->[ \t]*\r?\n?/gim, '')
  clean=clean.replace(/^[ \t]*<!--[ \t]*parentKey[ \t]*:.*?-->[ \t]*\r?\n?/gim, '')
  clean=clean.replace(/^#[ \t]+.*(?:\r?\n)?/gm, '')
  clean=clean.replace(/^##\s*Comments\s*$[\s\S]*?(?=^##\s|$(?![\s\S]))/gim, '')
  clean=clean.replace(/^##\s*Answer\s*$[\s\S]*?(?=^##\s|$(?![\s\S]))/gim, '')
  clean=clean.split('\n').filter(function(l){ return !/^\s*(Status|Type|Blocked\s+by|Labels)\s*[:\uFF1A]/i.test(l) }).join('\n')
  return clean.trim()
}
/** 落盘前核对单例：新票必须恰好一个一级标题、一个锚、一套字段行、一套骨架，做不到就返回原因（调用方转成如实失败）。 */
function checkSingletonsForCreate(content: string, wantAnchor: boolean): string{
  const h1=(String(content).match(/^#[ \t]+\S.*/gm)||[]).length
  if(h1!==1) return '一级标题有 '+h1+' 个，想要 1 个'
  const anchors=(String(content).match(/DSH-IDEMPOTENCY-KEY/g)||[]).length
  if(wantAnchor&&anchors!==1) return '幂等锚有 '+anchors+' 个，想要 1 个'
  if(!wantAnchor&&anchors>1) return '幂等锚有 '+anchors+' 个，想要至多 1 个'
  const count=function(re: RegExp): number{ return (String(content).match(re)||[]).length }
  if(count(/^\s*Status\s*[:\uFF1A]/gim)!==1) return 'Status 行不是 1 个'
  if(count(/^\s*Blocked\s+by\s*[:\uFF1A]/gim)!==1) return 'Blocked by 行不是 1 个'
  if(count(/^\s*Labels\s*[:\uFF1A]/gim)!==1) return 'Labels 行不是 1 个'
  if(count(/^##\s*Comments\s*$/gim)!==1) return 'Comments 骨架不是 1 个'
  if(count(/^##\s*Answer\s*$/gim)!==1) return 'Answer 骨架不是 1 个'
  if(count(/^\s*Type\s*[:\uFF1A]/gim)>1) return 'Type 行翻倍了'
  if(count(/^\s*Assignees\s*[:\uFF1A]/gim)>1) return 'Assignees 行翻倍了'
  return ''
}
/** 建票时刻：本仓房间层的既有做法就是取真实时钟（comments.ts 那条评论时间同款），不另立时钟源。 */
function builtAtIso(): string { return new Date().toISOString() }
function buildIssueText(input: CreateView){
  const blockedByStr=Array.isArray(input.blockedBy)&&input.blockedBy.length?input.blockedBy.map(k=>'#'+String(k).padStart(2,'0')).join(', '):(typeof input.blockedBy==='string'?input.blockedBy:'')
  const typeField=input.type?String(input.type):(input.Type?String(input.Type):'')
  const labelsInput = Array.isArray(input.labels) ? input.labels : (Array.isArray(input.Labels)? input.Labels : null)
  let labelsStr=''
  if(labelsInput && labelsInput.length){
    // #634：落盘的标签名先剥掉外层成对引号/反引号（调用方递进来的名字可能带着照抄文档代码写法的那层）
    const names=labelsInput.map(l=>{
      if(typeof l==='string') return stripLabelDecoration(l)
      if(l&&typeof l.name==='string') return stripLabelDecoration(l.name)
      return ''
    }).filter(Boolean)
    if(names.length) labelsStr=names.join(', ')
  } else if(typeof input.labels==='string' && input.labels.trim()){
    // 整行直接给字符串时，同样逐个剥净：这是「一次贴一整行」的用法，最容易把引号一起带进来
    labelsStr=String(input.labels).split(/[,\uFF0C]+/).map(function(s){return stripLabelDecoration(s)}).filter(Boolean).join(', ')
  }
  const rawBody=input.body?String(input.body):''
  const bodyPart=isWholeIssueBody(rawBody)?cleanWholeBodyForCreate(rawBody):rawBody.trim()
  const title=String(input.title).trim()
  // 建票时的指派人（#1174 决策 8）：契约的 `CreateInput.assignees` 以前被静默丢掉 —— 调用方以为指派了，
  // 票面上一个字都没有。现在原样写进 `Assignees:` 那一行；给了人就同时把状态记成「已认领」，
  // 与 setAssignees 同一个口径（那边也是「有名字 ⇒ claimed」）。
  const assigneeNames=Array.isArray(input.assignees)?input.assignees.map(loginOfAssignee).filter(Boolean):[]
  let content='# '+title+'\n\n'
  if(bodyPart)content+=bodyPart+'\n\n'
  content+='Status: '+((input.status as string)||(assigneeNames.length?'claimed':'ready-for-agent'))+'\n'
  if(assigneeNames.length)content+='Assignees: '+assigneeNames.join(', ')+'\n'
  if(typeField)content+='Type: '+typeField+'\n'
  if(blockedByStr)content+='Blocked by: '+blockedByStr+'\n'
  else content+='Blocked by:\n'
  if(labelsStr) content+='Labels: '+labelsStr+'\n'
  else content+='Labels:\n'
  content+='\n## Comments\n\n\n## Answer\n\n'
  // #1174 决策 10：建票时刻写进文件顶的那一行注释（写在标题之前）。为什么要写下来：契约要求按页取票
  // 的排序键是「创建时间倒序」，而本地这一侧一直拿**文件修改时间**当创建时间 —— 改一次票就换一个时间，
  // 翻页期间有人改票会让票在页与页之间挪位置，正是契约要防的那件事。写下来之后它就不动了。
  // 老票没有这一行，继续回落到文件修改时间（见 parse.ts 的 createdStampFromFile，那里也不回填）。
  content='<!-- created: '+builtAtIso()+' -->\n'+content
  if(input.parentKey)content='<!-- parentKey: '+input.parentKey+' -->\n'+content
  // 锚在最前（含它自己的换行）：parentKey 那行若也在，紧跟在锚后面，两行都是看不见的注释。
  if(input.idempotencyKey)content=anchorLineFor(String(input.idempotencyKey))+content
  return content
}

/** 按锚在盘上找那张票（#711 的回查）。这是**读**：建票时它在写者队列里面跑、建完的回读核对也在队列里，
 *  读到的都是盘上真实的内容，不看任何内存表。
 *
 *  三种结论，判据一条不自己写，全部交给刷新核心那份共享判据（`shared/refresh` 的 `matchAnchor`）：
 *   - `hit`          —— 那张票的票面上真写着这个锚，**而且它还开着**（已关闭的票不算命中：
 *                       一个锚对应一件要做完的事，那件事已经做完了，调用方这次要的是新建）；
 *   - `miss`         —— 按锚找遍了没有，那就是「还没建过」，照常建；
 *   - `unsupported`  —— **回查做不成**（列目录读不出来、某份票文件读不出来）。这一档必须如实失败，
 *                       绝不降级成「没找到」：「读不出来」被当成「没有」正是重复建票的来路，
 *                       而且是在看起来成功了的样子下发生的（契约 contract-idempotency 第 35-37 行
 *                       点名了这一档，并指定 error.kind 用 unsupported）。
 *
 *  性能：先用「文件内容里有没有锚」粗筛（每份读一次、不解析），只有锚对上的才解析成候选取态。 */
type AnchorLookup =
  | { status: 'hit'; path: string; key: string; text: string }
  | { status: 'miss' }
  | { status: 'unsupported'; reason: string }
async function findAnchoredTicket(ctx: OpContext,idir: string,key: string): Promise<AnchorLookup>{
  if(!idir)return{status:'miss'}
  const plat=getPlat(ctx)
  // 列目录：**这里必须用严格的 `listDir`，不能用宽松的 `listDirOrMissingIsEmpty`**。
  // 宽松口把「读不出来」压成空数组，回查于是把「没读成」读成「一张都没建过」，照常再建一张 ——
  // 重复建票就是这么来的。严格口把三种结果分开：目录本来就不存在（全新工作单元，算空表）、
  // 列出来了（可能是空数组）、以及**没读成**（这一种必须如实失败，进上面的 `unsupported` 档）。
  let files: string[]
  {
    const listed=await listDir(ctx,idir)
    if(listed.ok) files=listed.names
    else if(listed.missing) files=[]
    else return{status:'unsupported',reason:'回查要列这个工作单元的票目录，但列不出来：'+idir+'（'+String((listed.error as Error)?.message||listed.error)+'）'}
  }
  const candidates: Array<{ path: string; key: string; text: string; candidate: AnchorCandidate }>=[]
  for(const f of files){
    if(!f||!f.endsWith('.md'))continue
    const km=/^(\d+)-/.exec(f)
    if(!km)continue
    const full=plat.join(idir,f)
    let txt: string
    // 单份票文件读不出来同样算「回查做不成」（旧的注释这么写，但当时列目录那一路根本不抛，
    // 所以这句话只在单文件这条路上成立；现在两条路都成立）。
    try{ txt=await readTextFile(ctx,full) }
    catch(e){ return{status:'unsupported',reason:'回查要读票文件，但读不出来：'+full+'（'+String((e as Error)?.message||e)+'）'} }
    if(idempotencyKeyOf(txt)!==String(key))continue
    const k=km[1].padStart(2,'0')
    const iss=parseMd(txt,{key:k,parentKey:'00',isMap:false})
    candidates.push({ path:full, key:k, text:txt, candidate:{ key:k, body:txt, state:iss.state } })
  }
  if(!candidates.length)return{status:'miss'}
  // 仓库同不同这一条本房不用传 refId：候选全部来自同一个工作区，不存在跨仓库候选。
  // 值实现来自构建产物 .js（无类型），回查结论以源码 .ts 的 AnchorMatch 为准，只收敛类型不改逻辑
  // （GitLab 房同款做法，见 rooms/gitlab/idempotency.ts 的注释）。
  const verdict=matchAnchor(candidates.map(function(c){ return c.candidate }),undefined,String(key)) as unknown as AnchorMatch
  if(isAnchorHit(verdict)){
    const hit=candidates.find(function(c){ return c.key===verdict.key })||candidates[0]
    return{status:'hit',path:hit.path,key:hit.key,text:hit.text}
  }
  if(isAnchorUnsupported(verdict))return{status:'unsupported',reason:verdict.reason}
  // mismatch：候选都在，但没一个同时满足「锚对得上 + 还开着」。按共享判据的口径这等于没命中，照常建。
  return{status:'miss'}
}

/** 建票的入口：先起一个事实桶，这一趟建完（或失败）后按实况落一行结论（#1059）。
 *  事实（真写了几份文件）由内层填，结论由 write-log.js 的纯函数推导 —— 内层没有 reason 可写。 */
export async function createIssue(ctx: OpContext,repo: RepoWithPath | null,input: CreateInput): Promise<{ ok: true; data: Issue } | CreateFailure>{
  const t0=Date.now()
  const trail=beginWriteTrail()
  const r=await createIssueInner(ctx,repo,input,trail)
  emitIssueWrite(ctx,'create',trail,r,t0)
  return r
}
async function createIssueInner(ctx: OpContext,repo: RepoWithPath | null,input: CreateInput,trail: WriteTrail): Promise<{ ok: true; data: Issue } | CreateFailure>{
  const plat=getPlat(ctx)
  const colorMap=await loadPaintColorMap(ctx)
  if(!input||typeof input.title!=='string'||!input.title.trim()){return failAs(ERROR_KIND.PARSE,'title required','')}
  // #711：带锚的创建。检查放在最前面、而且是当场失败：键不合规（空、超长、带换行或注释收尾符）
  // 绝不能落到票面上 —— 落下去会把正文写坏，而且第二次提交的键与第一次不是同一个串，「幂等」就成了运气。
  const keyCheck=input.idempotencyKey===undefined||input.idempotencyKey===null?null:checkIdempotencyKey(input.idempotencyKey)
  // 原文 = 这次用不了的那个键本身（判据不成立的原因在 message 里，原文让人看见实际给的是什么）。
  if(keyCheck&&!keyCheck.ok)return failAs(ERROR_KIND.PARSE,'idempotencyKey 不能用：'+keyCheck.reason,String(input.idempotencyKey))
  const idemKey=keyCheck?keyCheck.key:''
  try{
    // 取号 → 探测 → 落盘这三段必须在**同一个按工作区串行的写者队列**里跑完（#712）。
    // 为什么：取号是「读目录取 max+1」（下面 readDir 那一段），落盘是整份覆盖
    // （write.js 的 publishTextFile：整份覆盖写，没有独占创建），而读目录这个 await 会让出事件循环 ——
    // 多个会话/子代理同时建票时，多路会读到同一个 max、算出同一个编号、都探测到「这个编号还没人占」，
    // 然后互相覆盖，最后盘上只剩一张，而每一路都回了 ok:true（本机实测 8 路并发全部回 key="01"）。
    // 队列钥匙按工作区归一（write-queue.js 的 workspaceWriteKey），与配色文件那条写路径共用同一条队，
    // 所以「同一个工作区里要读整个目录才知道该写哪一份」这类操作，在插件内部是彼此排队、不交错的。
    // #711 的锚回查与落盘后的回读核对也在这条队里：#712 解决「同一个进程里两路同时建」，锚解决
    // 「跨进程、跨重试再建一次」；两件事都要做，而且都必须发生在握着队列的时候 —— 在队列外面先查一遍盘、
    // 再进队列建票的话，两次查询之间有别人刚建好一张，这一路就查不到了。
    const r=await withWorkspaceWriter(ctx,repo,async function(): Promise<CreatePlacement | CreateFailure>{
      const target=await resolveCreateTarget(ctx,repo)
      if(!target.ok)return target
      const effortId=target.effortId
      const idir=target.idir
      await ensureDir(ctx,idir)
      // ① 先按锚回查盘上有没有这张票（回查看的是票文件里的锚，不是内存里的表）。命中就复用它：
      //    不取号、不落盘、不改任何文件，返回同一个 key。
      if(idemKey){
        const look=await findAnchoredTicket(ctx,idir,idemKey)
        // 回查做不成（列目录读不出来、票文件读不出来）：如实失败，绝不降级成「没找到」再建一张。
        // 档位按契约 contract-idempotency 第 35-37 行定成 unsupported；话术用共享判据那一句
        // （它把「这不是『已经建过』的意思」和接下来能怎么办一并说清）。
        if(look.status==='unsupported'){
          return failAs(ERROR_KIND.UNSUPPORTED, describeAnchorFailure(anchorUnsupported(look.reason)), look.reason)
        }
        if(look.status==='hit'){
          const st=await statFile(ctx,look.path)
          let hitMtime=new Date().toISOString()
          // stat 的契约类型是 unknown（各实现给出的字段不一，locate.js 里同款读法）：
          // 经视图读 mtime，坏值进 catch 回默认；cast 只为过类型，求值与原来逐字相同。
          const hitStMtime=st&&(st as {mtime?: unknown}).mtime
          if(hitStMtime){try{hitMtime=new Date(hitStMtime as string).toISOString()}catch{}}
          // #971：回落值给 00（老单根工作区的地图），文件顶有注释就以注释为准，没有注释但正文写着 Type: map 的视作没有父票。
          // 这里原来写死 null，复用老票时会把本该是 00 的子票读成没有父票；现在交给 parseMd 按注释与类型判。
          const hitIss=parseMd(look.text,{key:look.key,parentKey:'00',isMap:false,effortId,createdAt:hitMtime,updatedAt:hitMtime})
          applyLabelColors(hitIss, colorMap)
          return{ok:true,effortId,finalPath:look.path,finalKey:look.key,reused:true}
        }
      }
      // 编号：只在目标 effort 内取 max+1（契约：每个 effort 从 01 起）。
      // 列目录读不出来时如实失败（不吞成空表）：吞掉就等于「这里一个号都没占」，
      // 取出来的号会与盘上已有的票撞车（#1174 决策 6）。这里同样用严格的 `listDir`：
      // 目录本来就不存在才当空表（全新工作单元），「没读成」必须当场失败。
      let filesSelf: string[]
      {
        const listed=await listDir(ctx,idir)
        if(listed.ok) filesSelf=listed.names
        else if(listed.missing) filesSelf=[]
        else return failAs(ERROR_KIND.ENV,'建这张票要列票目录来取号，但目录读不出来：'+idir+'（'+String((listed.error as Error)?.message||listed.error)+'）',String((listed.error as Error)?.message||listed.error))
      }
      let max=0
      for(const f of filesSelf){ const m=/^(\d+)-/.exec(f); if(m){ const n=parseInt(m[1],10); if(!isNaN(n)&&n>max) max=n } }
      let next=max+1
      let attempt=0
      let finalPath=''
      let finalKey=''
      // 探测（findIssueFileInEffort）到「这个编号确实没人占」为止。串行化后前面的并发调用都已经落完盘，
      // 所以这里数出来的 max 一定包含它们刚建出来的票，取到的号不会与任何一路重复；
      // 就算真有同名编号存在（旧数据、手工建的文件），也在这里往后跳过，绝不覆盖。
      while(attempt<5){
        const keyStr=String(next).padStart(2,'0')
        const slug=slugify(input.title)
        const filename=keyStr+'-'+slug+'.md'
        const full=plat.join(idir,filename)
        const ex=await findIssueFileInEffort(ctx,{effortId},keyStr)
        if(ex){next++;attempt++;continue}
        finalPath=full;finalKey=keyStr;break
      }
      if(!finalPath)return failAs(ERROR_KIND.CONFLICT,'create NN conflict','')
      // 内容拼装与落盘同样留在队列里：落盘这一步必须发生在**还握着队列**的时候，
      // 否则下一路会在「这一路已经取到号、但还没写下去」的缝里读目录，又读不到这张票、又取到同一个号。
      const builtText=buildIssueText(input)
      // #1002：落盘前核对单例，拼坏了就如实失败不落盘（静默写坏比失败更贵）。
      const builtBad=checkSingletonsForCreate(builtText, !!idemKey)
      if(builtBad)return failAs(ERROR_KIND.UNSUPPORTED,'建票内容拼装后核对没过（'+builtBad+'），这次没落盘：请换一种正文形态再试。',String(builtBad))
      // #1182：票文件走原子发布（同目录临时文件 + 改名；没有改名原语时退回整份直写）：建到一半崩掉
      // 不会在盘上留一张半截的票 —— 半截的票读回来是一张缺字段的票，比这次建票失败更贵。
      await publishTextFile(ctx,finalPath,builtText, ctx&&(ctx as {sandboxPolicy?: unknown}).sandboxPolicy)
      // 这一份真写到盘上了，记进事实桶（#1059）：幂等命中复用那一路走不到这里，于是结论是 reuse 而不是 fresh。
      noteFileWritten(trail)
      // ② 落盘之后当场回读核对（#711）：确认锚真的写进了这个文件。只写不核对的话，
      //    写入被拒、写了一半、被别的进程覆盖回去这类情况会以「建票成功」的样子交回去，
      //    而锚没落上去意味着下一次重试再也找不到这张票（重复建票的根就没被切断）。
      if(idemKey){
        const back=await readTextFile(ctx,finalPath)
        if(idempotencyKeyOf(back)!==idemKey){
          return failAs(ERROR_KIND.UNSUPPORTED,'票已经写到 '+finalPath+'，但回读时没读到刚写进去的锚，所以这次不能算幂等创建成功。请检查这个工作区里的票文件是不是被别的东西改写了。',JSON.stringify({path:finalPath,wantAnchor:idemKey,gotAnchor:String(idempotencyKeyOf(back))}))
        }
      }
      return{ok:true,effortId,finalPath,finalKey,reused:false}
    })
    if(!r.ok)return r
    const {effortId,finalPath,finalKey}=r
    // 回包按**盘上那一份**解析（不再用手里拼的字符串）：复用旧票与新建走的是同一条回包路，
    // 两边给出来的都是盘上真实的内容。
    const content=await readTextFile(ctx,finalPath)
    const st=await statFile(ctx,finalPath)
    let mtime=new Date().toISOString()
    // 同上：stat 视图读 mtime，坏值进 catch 回默认。
    const stMtime=st&&(st as {mtime?: unknown}).mtime
    if(stMtime){try{mtime=new Date(stMtime as string).toISOString()}catch{}}
    // #971：地图本身没有父票（恒为空），其余票有父就用父、没给就回落到 00（老单根工作区的地图）。
    // 这里原来对地图也回落到 00，导致新建的地图 01 被读成 00 的子票，按 01 筛选恒为 0。
    // 显式传 null（解除父子）同样视作没有父票，不回落到 00。
    // input.Type 是调用方递大小写两种写法的遗留（见文件头 CreateView）：经视图读，不拓契约签名。
    const _isMapType = String((input && (input.type || (input as CreateView).Type)) || '').trim().toLowerCase() === 'map'
    const _fallbackParent = (input && input.parentKey !== undefined && input.parentKey !== null && String(input.parentKey).trim() !== '')
      ? String(input.parentKey).trim()
      : (_isMapType || (input && input.parentKey === null) ? null : '00')
    const iss=parseMd(content,{key:finalKey,parentKey:_fallbackParent,isMap:false,effortId,createdAt:mtime,updatedAt:mtime,url:finalPath})
    applyLabelColors(iss, colorMap)
    return{ok:true,data:iss}
  }catch(e){return failFromError(e,ctx,'建这张票时出错')}
}
