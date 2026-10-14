// comments.js —— 以后改评论读写时改它（预估约 110 行）。
//
// effort 维度（2026-09-09）：按编号找文件一律走 issues-locate.js 的解析器（带 effort 范围）。
// 写评论用 mode:'write'：同号票在多个 effort 里都存在、又没指定 effort 时返回 conflict，
// 绝不落到第一个 effort 的同号文件里（此前就是这样写错文件的）。
import { parseMd } from './parse.js'
import { readTextFile } from './read.js'
import { writeTextFile } from './write.js'
// #1059：这一趟写没写下去的结论线（事件 `issue.write`，与另两房同一个名字、同一套字段）。
import { beginWriteTrail, emitIssueWrite, noteFileWritten } from './write-log.js'
import type { WriteTrail } from './write-log.js'
import { failFromError } from './error-fail.js'
import { ERROR_KIND } from '../../contract/vocabulary.js'
import { resolveIssueFile } from './issues-locate.js'
import type { OpContext } from '../../contract/contexts.js'
import type { RepositoryRef, Comment } from '../../contract/entities.js'
// #922：写评论同样是「读整份 → 在内存里改 → 整份写回」，要排在该票文件的单写者队列里，见 write-queue.js。
import { withFileWriter } from './write-queue.js'

// 仓库引用：path 是本地后端的自有约定（契约不保证），有就多认那个目录（path.ts 的同款，房间里各备一份）。
type RepoWithPath = RepositoryRef & { path?: string }

// 本文件交出去的失败形状：与 failAs 落的三段式一致（成功侧各函数自带）。
interface CommentsFailure {
  ok: false
  error: { kind: string; message: string; raw: string }
}

export async function listComments(ctx: OpContext,repo: RepoWithPath | null,key: string): Promise<{ok:true,data:Comment[]}|CommentsFailure>{
  const norm=String(key).padStart(2,'0')
  const r=await resolveIssueFile(ctx,repo,norm,{mode:'read'})
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
  const r=await resolveIssueFile(ctx,repo,norm,{mode:'write'})
  if(!r.ok)return{ok:false,error:r.error}
  // 读—改—写整段排在该票文件的队列里（#922）：不排队的话，同一张票上「发评论」与「关门」并发时，
  // 后写的那一路会把前一路的改动整份抹掉（评论没了，或状态被抹回 ready-for-agent）。
  return withFileWriter(ctx,repo,r.path,async function(){
    try{
      let txt=await readTextFile(ctx,r.path)
      const nowIso=new Date().toISOString()
      // actor 与 sandboxPolicy 不在契约 OpContext 上（宿主按会话透传的扩展键）：经视图读，不拓签名。
      const actor=String((ctx&&(ctx as {actor?: unknown}).actor)||'local')
      const block='### '+actor+' \u2014 '+nowIso+'\n'+String(body||'').trim()+'\n'
      const re=/^\s*##\s*Comments\s*$/im
      const m=re.exec(txt)
      if(m){
        const start=m.index+m[0].length
        const after=txt.slice(start)
        const nextH2=/^\s*##\s+/m.exec(after)
        if(nextH2){
          const insertPos=start+nextH2.index
          txt=txt.slice(0,insertPos)+'\n'+block+'\n'+txt.slice(insertPos)
        }else{
          if(!txt.endsWith('\n'))txt+='\n'
          txt+='\n'+block+'\n'
        }
      }else{
        if(!txt.endsWith('\n'))txt+='\n'
        txt+='\n## Comments\n\n'+block+'\n'
      }
      await writeTextFile(ctx,r.path,txt, ctx&&(ctx as {sandboxPolicy?: unknown}).sandboxPolicy)
      // 这一份真写到盘上了，记进事实桶（#1059）。
      noteFileWritten(trail)
      const comment: Comment={author:{login:actor},authorAssociation:'',body:String(body||''),createdAt:nowIso,updatedAt:nowIso}
      return{ok:true,data:comment}
    }catch(e){return failFromError(e,ctx,'把评论写进这张票的文件时出错')}
  })
}
export default{listComments,addComment}
