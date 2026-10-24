// issues-status.ts —— 以后改关闭与重开状态流转时改它；字段行改写小工具也住这，补丁文件共用。
//
// effort 维度（2026-09-09）：关票/重开都按 (effort 范围, 编号) 定位，写模式多命中即 conflict，不猜文件。
//
// #1489：同一张票的「状态」在原文布局里写在三个不同位置，按文件形状分派：
//  · 实施票（to-tickets 模板）：可见的加粗行 `**Status:** ready-for-agent`，原地改这一行；
//  · 探索地图子票：裸行 `Status: claimed` / `Status: resolved`，完成时答案写进 `## Answer`；
//  · 容器（规格 spec.md / 探索地图 map.md）：正文模板里没有状态行，只写文件头隐藏注释 DSH-STATUS。
// 旧布局（可见 Status + Close reason 行）的行为一个字都不变：老文件与既有门禁还靠它。
import { parseMd } from './parse.js'
import { readTextFile } from './read.js'
import { publishTextFile } from './write.js'
// #1059：这一趟写没写下去的结论线（事件 `issue.write`，与 GitHub 房同一个名字、同一套字段；GitLab 房的写路径还没做）。
import { beginWriteTrail, emitIssueWrite, noteFileWritten } from './write-log.js'
import type { WriteTrail } from './write-log.js'
import { failFromError } from './error-fail.js'
import { getPlat, resolveIssueFile, resolveMapFile, resolveSpecFile } from './issues-locate.js'
import { loadPaintColorMap, applyLabelColors } from './label-colors-paint.js'
import type { OpContext } from '../../contract/contexts.js'
import type { RepositoryRef, Issue } from '../../contract/entities.js'
import type { CloseOpts } from '../../contract/inputs.js'
// #922：票文件的读—改—写按文件排队（关门/重开也是「读整份、改一行、整份写回」），见 write-queue.js。
import { withFileWriter } from './write-queue.js'
// #1489：原文布局（加粗字段行 / 裸字段行 / 隐藏注释）的读写原语，见 original-fields.ts。
import {
  appendSectionBlock,
  hiddenCommentOf,
  removeBareField,
  replaceBareField,
  replaceBoldField,
  ticketFormOf,
  upsertHiddenComment,
} from './original-fields.js'
import { commentBlockOf } from './comments.js'

// 仓库引用：path 是本地后端的自有约定（契约不保证），有就多认那个目录（path.ts 的同款，房间里各备一份）。
// mdScene：feature 场景的 00 号是 spec.md，不是 map.md（#1486）。
type RepoWithPath = RepositoryRef & { path?: string; mdScene?: string }

// 本文件交出去的失败形状：与 failAs 落的三段式一致（成功侧各函数自带）。
interface StatusFailure {
  ok: false
  error: { kind: string; message: string; raw: string }
}

/** 这次写的文件是谁：spec/map 是容器（00 号），null 是普通票。 */
interface WriteTarget {
  path: string
  effortId: string
  container: 'spec' | 'map' | null
}

/** 字段行改写：补一行，或把已有的那一行换成新的一行。
 *  三条纪律：① 只动同一行内的空白，绝不跨行；② 找不到这一行才新插一行；
 *  ③ **新行插在「标题下面那一段字段行」的末尾**，不紧贴标题。
 *  为什么要写死第 ① 条（#928）：旧写法是 ^\s*字段\s*[:：]\s*.*$，字段值为空时（文件里写成「Blocked by:」
 *  后面直接跟下一行）\s* 会跨过换行、.*$ 再吃掉下一行 —— 补阻塞边会把紧跟其后的 Labels 行整行删掉，
 *  给票打标签会把 ## Comments 标题整行删掉。这与并发无关，单写者、单次调用就会发生。
 *  所以调用方给的 \s+ / \s* 在这里一律收成同一行内的空白，字段名与值都不许跨行。
 *  为什么要写死第 ③ 条（#1174 复核 P1-1 实测）：字段行后面才是正文，改写正文时是按「标题到第一个字段行
 *  之间都算正文」重建的 —— 新行插在标题正下面，就等于插进了正文区，下一次改正文会把它整行丢掉。
 *  这条是关票原因踩出来的（关完票再改一次正文，原因就退回默认的 completed），但凡是后补的字段行都有这个毛病。
 *  旧布局继续用它；原文布局的字段行由 original-fields.ts 的原语原地改（格式不同）。 */
export function replaceOrInsertField(txt: string,fieldName: string,newLine: string): string{
  const inline=String(fieldName).replace(/\\s\+/g,'[ \t]+').replace(/\\s\*/g,'[ \t]*')
  const re=new RegExp('^[ \t]*'+inline+'[ \t]*[:：][ \t]*[^\r\n]*$','im')
  if(re.test(txt))return txt.replace(re,newLine)
  const lines=txt.split('\n')
  let h1Idx=-1
  for(let i=0;i<lines.length;i++){if(/^#+\s+/.test(lines[i])){h1Idx=i;break}}
  const insertIdx=h1Idx<0?0:h1Idx+1
  // 字段块在哪：本房的票文件布局是「标题 → 正文 → 字段行 → 骨架区」，字段行并不紧挨着标题。
  // 新行要接在**最后一条字段行**后面，才算长在字段块里；插在标题下面等于插进了正文区，
  // 下一次改写正文时会按「标题到第一条字段行之间都算正文」重建，把它整行丢掉
  // （#1174 复核 P1-1 实测：关票原因就是这么没的）。认哪些名字与 issues-patch.ts 的字段白名单同一套。
  const isFieldLine=function(l: string): boolean{ return /^[ \t]*(Status|Assignees|Type|Blocked\s+by|Labels|Close\s+reason)[ \t]*[:：]/i.test(l) }
  let lastField=-1
  for(let i=0;i<lines.length;i++){ if(isFieldLine(lines[i])) lastField=i }
  lines.splice(lastField>=0?lastField+1:insertIdx,0,newLine)
  return lines.join('\n')
}

/** 状态行传进来的是整行（`Status: resolved`），这里取出它的值（`resolved`）。 */
function statusValueOf(statusLine: string): string {
  const m = /^[ \t]*(?:\*\*)?Status(?:\*\*)?[ \t]*[:：][ \t]*(.*)$/i.exec(String(statusLine))
  return String(m ? m[1] : statusLine).trim()
}
/** 容器的状态值只认注释里的三档（YAML 的 DSH-STATUS 约定：closed / ready-for-agent / open）。 */
function containerStatusValue(statusLine: string): string {
  if (/resolved|closed/i.test(statusLine)) return 'closed'
  if (/ready-for-agent|open/i.test(statusLine)) return 'ready-for-agent'
  return 'open'
}
/** 这张票文件里有没有「认领人」的记录（隐藏注释或旧布局的可见 Assignees 行）。
 *  地图子票重开时用：原文只有 claimed/resolved 两档，派了人就回 claimed，没派就删掉状态行回到未认领。 */
function hasAssigneeRecord(text: string): boolean {
  const hidden = hiddenCommentOf(text, 'DSH-ASSIGNEES')
  if (hidden.found && hidden.value.trim()) return true
  return /^[ \t]*Assignees[ \t]*[:：][ \t]*\S/m.test(text)
}
/** 定位这次要写的文件，并说清它是不是 00 号容器。 */
async function locateWriteTarget(ctx: OpContext, repo: RepoWithPath | null, key: string): Promise<{ ok: true; data: WriteTarget } | StatusFailure> {
  const norm = String(key).padStart(2, '0')
  const isSpec = norm === '00' && !!repo && String(repo.mdScene || '') === 'feature'
  const isMap = norm === '00' && !isSpec
  const r = isSpec
    ? await resolveSpecFile(ctx, repo, { mode: 'write' })
    : (isMap ? await resolveMapFile(ctx, repo, { mode: 'write' }) : await resolveIssueFile(ctx, repo, norm, { mode: 'write' }))
  if (!r.ok) return { ok: false, error: r.error }
  return { ok: true, data: { path: r.path, effortId: r.effortId, container: isSpec ? 'spec' : (isMap ? 'map' : null) } }
}
/** 读回的元数据：容器的父票固定 null，普通票的父票由目录结构兜底成 00（与旧读法一致）。 */
function metaOf(norm: string, target: WriteTarget) {
  return {
    key: norm,
    parentKey: target.container ? null : '00',
    isMap: target.container === 'map',
    kind: target.container === 'spec' ? 'spec' as const : undefined,
    effortId: target.effortId,
    url: target.path,
  }
}
/** 票文件的公共写入口：读整份 → apply 在内存里改 → 有变化才写回 → 按新文本读回。
 *  为什么要一个公共入口（#1489）：关票一次要同时改状态行、追加答案/评论，必须一次写盘；
 *  分两次写会出现「状态改了但答案没写」的半截状态，也会多写一份文件、多记一条写日志。
 *  没改出差异就不写盘（#1059）：关一张已经关着的票、重开一张本来就开着的票，改出来的整份文本与盘上
 *  一字不差 —— 照旧写回去只会换掉文件的修改时间（本地房的创建时间对老票就回落在这上面，翻页顺序会跟着动），
 *  而这一趟在结论线上必须是 noop 而不是 edited。 */
export async function rewriteTicketText(
  ctx: OpContext,
  repo: RepoWithPath | null,
  key: string,
  apply: (before: string, target: WriteTarget) => string,
  trail?: WriteTrail,
): Promise<{ ok: true; data: Issue } | StatusFailure> {
  const norm = String(key).padStart(2, '0')
  const loc = await locateWriteTarget(ctx, repo, norm)
  if (!loc.ok) return loc
  const target = loc.data
  const colorMap = await loadPaintColorMap(ctx)
  return withFileWriter(ctx, repo, target.path, async function () {
    try {
      const before = await readTextFile(ctx, target.path)
      const txt = apply(before, target)
      if (txt !== before) {
        // #1182：这一份走原子发布（同目录临时文件 + 改名；没有改名原语时退回整份直写），与同房另几条写票路同口径。
        await publishTextFile(ctx, target.path, txt, ctx && (ctx as { sandboxPolicy?: unknown }).sandboxPolicy)
        noteFileWritten(trail)
      }
      const iss = parseMd(txt, metaOf(norm, target))
      applyLabelColors(iss, colorMap)
      return { ok: true, data: iss }
    } catch (e) {
      return failFromError(e, ctx, '改这张票的文件时出错')
    }
  })
}
/** 改状态：按文件形状分派，可选再补一行（旧布局的关票原因走这条）。 */
async function setStatus(ctx: OpContext, repo: RepoWithPath | null, key: string, statusLine: string, extraLine?: string, trail?: WriteTrail): Promise<{ ok: true; data: Issue } | StatusFailure> {
  return rewriteTicketText(ctx, repo, key, function (txt, target) {
    if (target.container) return upsertHiddenComment(txt, 'DSH-STATUS', containerStatusValue(statusLine))
    const form = ticketFormOf(txt)
    const value = statusValueOf(statusLine)
    if (form === 'impl-ticket') return replaceBoldField(txt, 'Status', value)
    if (form === 'map-ticket') {
      if (/^(ready-for-agent|open)$/i.test(value)) {
        return hasAssigneeRecord(txt) ? replaceBareField(txt, 'Status', 'claimed') : removeBareField(txt, 'Status')
      }
      return replaceBareField(txt, 'Status', value)
    }
    // 旧布局：可见 Status 行 + 关票原因行，行为与 #1489 之前一字不差。
    let out = replaceOrInsertField(txt, 'Status', statusLine)
    if (extraLine) out = replaceOrInsertField(out, 'Close\\s+reason', extraLine)
    return out
  }, trail)
}
/** 从子票正文的 ## Answer 段取第一条内容当「决策」；没有就交回调用方给的关闭原因。 */
function answerGist(ticket: Issue): string {
  const body=ticket&&typeof ticket.body==='string'?ticket.body:''
  const at=body.search(/^##\s*Answer\s*$/m)
  if(at<0)return''
  for(const raw of body.slice(at).split('\n').slice(1)){
    if(/^##\s/.test(raw))break
    const line=raw.trim().replace(/^[-*]\s+/,'').trim()
    if(line)return line.length>120?line.slice(0,120)+'…':line
  }
  return''
}
/** 地图子票完成时，按原文往同一目录 map.md 的 Decisions so far 追加一条指针（#1487 验收③）。
 *
 *  判据只看「票文件同目录有没有 map.md」：原文地图子票就住在 map.md 同目录的 issues/ 下，
 *  手写的、没有插件注释的文件同样适用，不靠隐藏注释判断身份。
 *  指针一行是 `- [标题](issues/NN-slug.md): 一句话决策`：决策优先取子票 ## Answer 的第一条内容，
 *  没有就取这次关闭原因，再没有才用标题 —— 原文要求这里记的是「已经定下来的事」，不能留空。
 *  写入失败整个吞掉：票已经关成功，指针只是地图上的索引；写不进去不该把关闭报成失败，
 *  重开再关时会重新补上，不会留下半截状态。 */
async function appendMapDecisionPointer(ctx: OpContext,repo: RepoWithPath | null,ticket: Issue,reason: string,trail?: WriteTrail): Promise<void>{
  const url=ticket&&ticket.url?String(ticket.url):''
  if(!url)return
  const plat=getPlat(ctx)
  const mapPath=plat.join(plat.dirname(plat.dirname(url)),'map.md')
  // 同目录没有 map.md 就是普通票目录：不是地图子票，什么都不做。
  try{ await readTextFile(ctx,mapPath) }catch{ return }
  // basename 在平台接口上是可选成员（有的宿主只给 path 的少数方法），自己按两种分隔符取末段最稳。
  const fileName=String(url).split(/[\\/]/).filter(Boolean).pop()||''
  const link='issues/'+fileName
  const title=String(ticket.title||'').trim().replace(/^\d{1,3}:\s*/,'')||String(ticket.key||'')
  try{
    await withFileWriter(ctx,repo,mapPath,async function(){
      let before: string
      try{ before=await readTextFile(ctx,mapPath) }catch{ return }
      // 同一张子票在地图上只留一条指针：重复关闭、重开后再关都不再追加。
      if(before.indexOf(']('+link+')')>=0)return
      const gist=answerGist(ticket)||reason||title
      const line='- ['+title+']('+link+'): '+gist
      const lines=before.split('\n')
      const start=lines.findIndex(function(one: string){ return /^##\s*Decisions so far\s*$/.test(one) })
      // 手写地图可能没有这一段（原文五段之一，但人可能改了标题）：找不到就不硬加，
      // 宁可少一条索引，也不改坏别人的文件。
      if(start<0)return
      let end=start+1
      while(end<lines.length&&!/^##\s/.test(lines[end]))end+=1
      // 段尾去掉空行再插：指针要长在 Decisions so far 的最后一条后面，不能插在下个标题的空白里。
      let at=end
      while(at>start+1&&lines[at-1].trim()==='')at-=1
      lines.splice(at,0,line)
      const after=lines.join('\n')
      if(after===before)return
      await publishTextFile(ctx,mapPath,after,ctx&&(ctx as {sandboxPolicy?: unknown}).sandboxPolicy)
      noteFileWritten(trail)
    })
  }catch{ /* 地图指针是附加索引，关票已经成功：写不进去不该把关闭报成失败。 */ }
}
/** 实施票关闭时，把关闭原因按原文追加成一条评论（不写 ## Answer、不写 Close reason 行）。
 *  最后一条评论的正文就是同一个原因时不再追加：重复关闭是幂等的，不该越关评论越多。 */
function appendClosingComment(ctx: OpContext, txt: string, reason: string, key: string): string {
  const comments = parseMd(txt, { key }).comments || []
  const last = comments.length ? comments[comments.length - 1] : null
  if (last && String(last.body || '').trim() === reason) return txt
  const actor = String((ctx && (ctx as { actor?: unknown }).actor) || 'local')
  return appendSectionBlock(txt, 'Comments', commentBlockOf(actor, reason, new Date().toISOString()))
}
export async function closeIssue(ctx: OpContext,repo: RepoWithPath | null,key: string,opts?: CloseOpts): Promise<{ok:true;data:Issue}|StatusFailure>{
  // 调用方给了原因就原样记下来（契约说这是开放字符串，不在这里分支：插件只认得 completed 与 duplicate，
  // GitHub 那边还会有 not_planned，照原样展示即可）；没给就一个字都不写。
  const reason=opts&&typeof opts.reason==='string'?opts.reason.trim():''
  const t0=Date.now()
  const trail=beginWriteTrail()
  const norm=String(key).padStart(2,'0')
  const r=await rewriteTicketText(ctx,repo,key,function(txt,target){
    if(target.container)return upsertHiddenComment(txt,'DSH-STATUS',containerStatusValue('Status: resolved'))
    const form=ticketFormOf(txt)
    if(form==='impl-ticket'){
      // 实施票完成：只改可见的加粗状态行；原因作为一条评论追加在文件底部（原文 issue-tracker-local.md:10-11），
      // 不写 ## Answer —— 原文只要求探索地图子票把答案写进 ## Answer（同文件 :30）。
      let out=replaceBoldField(txt,'Status','resolved')
      if(reason)out=appendClosingComment(ctx,out,reason,norm)
      return out
    }
    if(form==='map-ticket'){
      // 地图子票完成：答案写进 ## Answer、状态改 resolved；指针由下面 appendMapDecisionPointer 追加。
      let out=replaceBareField(txt,'Status','resolved')
      if(reason)out=appendSectionBlock(out,'Answer',reason)
      return out
    }
    // 旧布局：可见 Status 行 + Close reason 行，与 #1489 之前一字不差。
    let out=replaceOrInsertField(txt,'Status','Status: resolved')
    if(reason)out=replaceOrInsertField(out,'Close\\s+reason','Close reason: '+reason)
    return out
  },trail)
  if(r.ok)await appendMapDecisionPointer(ctx,repo,r.data,reason,trail)
  emitIssueWrite(ctx,'close',trail,r,t0)
  return r
}
export async function reopenIssue(ctx: OpContext,repo: RepoWithPath | null,key: string): Promise<{ok:true;data:Issue}|StatusFailure>{
  const t0=Date.now()
  const trail=beginWriteTrail()
  const r=await setStatus(ctx,repo,key,'Status: ready-for-agent',undefined,trail)
  emitIssueWrite(ctx,'reopen',trail,r,t0)
  return r
}
