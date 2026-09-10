// comments.js —— 以后改评论读写时改它（预估约 110 行）。
//
// effort 维度（2026-09-09）：按编号找文件一律走 issues-locate.js 的解析器（带 effort 范围）。
// 写评论用 mode:'write'：同号票在多个 effort 里都存在、又没指定 effort 时返回 conflict，
// 绝不落到第一个 effort 的同号文件里（此前就是这样写错文件的）。
import { parseMd } from './parse.js'
import { readTextFile } from './read.js'
import { writeTextFile } from './write.js'
import { classifyError } from '../../preflight.js'
import { ERROR_KIND } from '../../../../shared/tracker/constants.js'
import { resolveIssueFile } from './issues-locate.js'

export async function listComments(ctx,repo,key){
  const norm=String(key).padStart(2,'0')
  const r=await resolveIssueFile(ctx,repo,norm,{mode:'read'})
  if(!r.ok)return{ok:false,error:r.error}
  try{const txt=await readTextFile(ctx,r.path);const iss=parseMd(txt,{key:norm,parentKey:'00',isMap:false,effortId:r.effortId});return{ok:true,data:iss.comments||[]}}catch(e){const kind=e&&e.kind?e.kind:classifyError(e);return{ok:false,error:{kind,message:e&&e.message?e.message:String(e)}}}
}
export async function addComment(ctx,repo,key,body){
  const norm=String(key).padStart(2,'0')
  const r=await resolveIssueFile(ctx,repo,norm,{mode:'write'})
  if(!r.ok)return{ok:false,error:r.error}
  try{
    let txt=await readTextFile(ctx,r.path)
    const nowIso=new Date().toISOString()
    const actor=(ctx&&ctx.actor)||'local'
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
    await writeTextFile(ctx,r.path,txt)
    const comment={author:{login:actor},authorAssociation:'',body:String(body||''),createdAt:nowIso,updatedAt:nowIso}
    return{ok:true,data:comment}
  }catch(e){const kind=e&&e.kind?e.kind:classifyError(e);return{ok:false,error:{kind,message:e&&e.message?e.message:String(e)}}}
}
export default{listComments,addComment}
