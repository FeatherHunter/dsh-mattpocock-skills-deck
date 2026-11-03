// comments.js —— 以后改评论读写时改它（预估约 110 行）。
//
// effort 维度（2026-09-09）：按编号找文件一律走 issues-locate.js 的解析器（带 effort 范围）。
// 写评论用 mode:'write'：同号票在多个 effort 里都存在、又没指定 effort 时返回 conflict，
// 绝不落到第一个 effort 的同号文件里（此前就是这样写错文件的）。
import { parseMd } from './parse.js'
import { readTextFile } from './read.js'
import { publishTextFile } from './write.js'
// #1059：这一趟写没写下去的结论线（事件 `issue.write`，与 GitHub 房同一个名字、同一套字段；GitLab 房的写路径还没做）。
import { beginWriteTrail, emitIssueWrite, noteFileWritten } from './write-log.js'
import type { WriteTrail } from './write-log.js'
import { failFromError } from './error-fail.js'
import { ERROR_KIND } from '../../contract/vocabulary.js'
import { resolveIssueFile, resolveSpecFile } from './issues-locate.js'
// #1489：原文布局把评论追加到 ## Comments 段的末尾（issue-tracker-local.md:11），不再往段首插；
// 旧布局保持原样（既有门禁钉着那套位置）。
import { appendSectionBlock, ticketFormOf } from './original-fields.js'
// #1859：旧票的评论区锚点与段尾也要用同一套「已知结构段名 + 围栏」判断，不能再把任意 ## 当段尾。
import { COMMENTS_SECTION_TITLE, commentStartsOf, commentsSectionRange } from './comment-format.js'
import type { OpContext } from '../../contract/contexts.js'
import type { RepositoryRef, Comment } from '../../contract/entities.js'
// #922：写评论同样是「读整份 → 在内存里改 → 整份写回」，要排在该票文件的单写者队列里，见 write-queue.js。
import { withFileWriter } from './write-queue.js'

// 仓库引用：path 是本地后端的自有约定（契约不保证），有就多认那个目录（path.ts 的同款，房间里各备一份）。
// mdScene 同理：feature 场景下 00 号指的是 spec.md，不是 map.md（#1486）。
type RepoWithPath = RepositoryRef & { path?: string; mdScene?: string }

// 本文件交出去的失败形状：与 failAs 落的三段式一致（成功侧各函数自带）。
interface CommentsFailure {
  ok: false
  error: { kind: string; message: string; raw: string }
}

/** 找这次评论要落的文件：#1486 起 feature 场景的 00 号是 spec.md（顶层规格容器），
 *  其余编号仍是 `<feature>/issues/NN-*.md`。两套原文都用同一个 00，只靠编号区分不出来。 */
async function locateForWrite(ctx: OpContext, repo: RepoWithPath | null, norm: string) {
  if (norm === '00' && repo && String(repo.mdScene || '') === 'feature') {
    return resolveSpecFile(ctx, repo, { mode: 'write' })
  }
  return resolveIssueFile(ctx, repo, norm, { mode: 'write' })
}

/** 找这次要读评论的文件：与写侧同一套寻址，但按读模式找 ——
 *  旧布局的票只读（#1488 验收③）：评论能读、能列，写评论由写侧如实失败。 */
async function locateForRead(ctx: OpContext, repo: RepoWithPath | null, norm: string) {
  if (norm === '00' && repo && String(repo.mdScene || '') === 'feature') {
    return resolveSpecFile(ctx, repo, { mode: 'read' })
  }
  return resolveIssueFile(ctx, repo, norm, { mode: 'read' })
}

/** 一条评论的文本块：`### <actor> — <ISO 时间>` 加正文。
 *  关票时追加的关闭原因也用这同一个块（见 issues-status.ts），两处格式不许各写一份。 */
export function commentBlockOf(actor: string, body: string, iso: string): string {
  return '### ' + actor + ' \u2014 ' + iso + '\n' + String(body || '').trim() + '\n'
}
export async function listComments(ctx: OpContext,repo: RepoWithPath | null,key: string): Promise<{ok:true,data:Comment[]}|CommentsFailure>{
  const norm=String(key).padStart(2,'0')
  const r=await locateForRead(ctx,repo,norm)
  if(!r.ok)return{ok:false,error:r.error}
  try{const txt=await readTextFile(ctx,r.path);const iss=parseMd(txt,{key:norm,parentKey:'00',isMap:false,effortId:r.effortId});return{ok:true,data:iss.comments||[]}}catch(e){return failFromError(e,ctx,'读这张票的评论时出错')}
}
/** 发评论的入口：先起一个事实桶，这一趟写完后按实况落一行结论（#1059）。
 *  事实（真写了几份文件）由内层填，结论由 write-log.js 的纯函数推导。 */
export async function addComment(ctx: OpContext,repo: RepoWithPath | null,key: string,body: string): Promise<{ok:true;data:Comment}|CommentsFailure>{
  const t0=Date.now()
  const trail=beginWriteTrail()
  const r=await addCommentInner(ctx,repo,key,body,trail)
  emitIssueWrite(ctx,'comment',trail,r,t0)
  return r
}
async function addCommentInner(ctx: OpContext,repo: RepoWithPath | null,key: string,body: string,trail: WriteTrail): Promise<{ok:true,data:Comment}|CommentsFailure>{
  const norm=String(key).padStart(2,'0')
  const r=await locateForWrite(ctx,repo,norm)
  if(!r.ok)return{ok:false,error:r.error}
  // 读—改—写整段排在该票文件的队列里（#922）：不排队的话，同一张票上「发评论」与「关门」并发时，
  // 后写的那一路会把前一路的改动整份抹掉（评论没了，或状态被抹回 ready-for-agent）。
  return withFileWriter(ctx,repo,r.path,async function(){
    try{
      let txt=await readTextFile(ctx,r.path)
      const nowIso=new Date().toISOString()
      // actor 与 sandboxPolicy 不在契约 OpContext 上（宿主按会话透传的扩展键）：经视图读，不拓签名。
      const actor=String((ctx&&(ctx as {actor?: unknown}).actor)||'local')
      const block=commentBlockOf(actor,String(body||''),nowIso)
      // #1489：原文布局（实施票、地图子票、插件建的新文件）往 ## Comments 段末尾追加；
      // 旧布局保留「插在段首」的既有行为，不改它的位置。
      if(ticketFormOf(txt)!=='legacy'){
        const next=appendSectionBlock(txt,COMMENTS_SECTION_TITLE,block)
        await publishTextFile(ctx,r.path,next, ctx&&(ctx as {sandboxPolicy?: unknown}).sandboxPolicy)
        noteFileWritten(trail)
        const comment: Comment={author:{login:actor},authorAssociation:'',body:String(body||''),createdAt:nowIso,updatedAt:nowIso}
        return{ok:true,data:comment}
      }
      const range=commentsSectionRange(txt)
      if(range){
        // 旧布局保留「插在段首」的既有位置；但旧手写评论头（没有 ISO 时间）不能排在新评论头后面，
        // 否则读侧只认第一个真实头之前的旧头，旧评论会整段读不到。三种落点：
        //   · 段首已经是真实评论头：照旧插在段首；
        //   · 段首是旧手写头：插到第一个真实头之前（旧头仍排在新头前面）；
        //   · 整段只有旧手写头：插到段尾，新头排在旧头后面。
        const lines=txt.split('\n')
        const starts=commentStartsOf(txt)
        let at=range.start+1
        if(starts.length){
          if(starts[0].strong)at=starts[0].at
          else{
            const firstStrong=starts.find(function(one){return one.strong})
            at=firstStrong?firstStrong.at:range.end
          }
        }
        while(at>range.start+1&&lines[at-1].trim()===''){
          lines.splice(at-1,1)
          at-=1
        }
        lines.splice(at,0,'',block.trim(),'')
        txt=lines.join('\n')
      }else{
        if(!txt.endsWith('\n'))txt+='\n'
        txt+='\n## '+COMMENTS_SECTION_TITLE+'\n\n'+block.trim()+'\n'
      }
      // #1182：评论追加进票文件同样走原子发布（同目录临时文件 + 改名；没有改名原语时退回整份直写）。
      await publishTextFile(ctx,r.path,txt, ctx&&(ctx as {sandboxPolicy?: unknown}).sandboxPolicy)
      // 这一份真写到盘上了，记进事实桶（#1059）。
      noteFileWritten(trail)
      const comment: Comment={author:{login:actor},authorAssociation:'',body:String(body||''),createdAt:nowIso,updatedAt:nowIso}
      return{ok:true,data:comment}
    }catch(e){return failFromError(e,ctx,'把评论写进这张票的文件时出错')}
  })
}
export default{listComments,addComment}
