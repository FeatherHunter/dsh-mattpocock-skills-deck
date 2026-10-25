// issues-create.ts —— 建票入口（只做标题与锚键检查 + 调 create-layout + 按盘回包）。
// 落盘格式本身住在 create-layout.ts 与 create-render.ts，改渲染去那两件。
//
// effort 维度（2026-09-09）：建票必须落在**一个明确的 effort** 里，编号按契约「每个 effort 从 01 起」在该 effort 内取 max+1。
//   - repo.effortId 给出 → 就落在那一个 effort；
//   - 仓库只有一个 effort → 自动落它（单 effort 仓库用起来无感）；
//   - 仓库有多个 effort 又没指定 → 返回 conflict 诚实失败，绝不猜（旧实现在所有 effort 之间取全局 max+1，
//     与契约冲突，而且因为少了 getScratchRoot 的 import 从未生效）。
import { parseMd } from './parse.js'
// #1277：票面对象类型标记（唯一真源）的读写判据全在共享包里；建票这一层只负责把它放到文件头。
import { readTextFile, statFile } from './read.js'
// #1059：这一趟写没写下去的结论线（事件 `issue.write`，与 GitHub 房同一个名字、同一套字段；GitLab 房的写路径还没做）。
import { beginWriteTrail, emitIssueWrite, noteFileWritten } from './write-log.js'
import type { WriteTrail } from './write-log.js'
import { failAs, failFromError } from './error-fail.js'
import { ERROR_KIND } from '../../contract/vocabulary.js'

import { loadPaintColorMap, applyLabelColors } from './label-colors-paint.js'
// #1486/#1487：六种票的原文形状落盘（spec.md、map.md、issues/NN-slug.md）住在 create-layout.ts，
// 本文件只做入口（标题与锚键格式检查）与回包解析，不拼正文、不取号、不落盘。
import { originalKindOf } from './create-render.js'
import { createInOriginalLayout } from './create-layout.js'
// #712/#922：取号落盘的写者队列住在 create-layout.ts 那一侧（与写票文件、配色文件共用同一份实现）。

// #711：创建幂等锚。锚的形状与回查判据全在刷新核心的产物里（唯一一处判据），本文件只做键格式检查，
// 写入、回查与回读核对都在 create-layout.ts 那一侧。
// #1174：回查的**结论**也交给那份判据（matchAnchor）—— 旧实现自己写了一套「比中锚就算命中」，
// 少了「候选必须还开着」这一条，于是票关掉之后拿同一个锚再提交，会把新活记到那张关着的旧票上。
import { checkIdempotencyKey } from '../../../refresh/contract/idempotency-keys.js'
import type { OpContext } from '../../contract/contexts.js'
import type { RepositoryRef, Issue } from '../../contract/entities.js'
import type { CreateInput } from '../../contract/inputs.js'

// 仓库引用：path 是本地后端的自有约定（契约不保证），有就多认那个目录（path.ts 的同款，房间里各备一份）。
type RepoWithPath = RepositoryRef & { path?: string }

interface CreateFailure {
  ok: false
  error: { kind: string; message: string; raw: string }
}
/** 建票落盘的唯一实现住在 create-layout.ts（#1500 S4 起旧的自拼分支已删，本文件只做入口与回包）。 */

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
  const colorMap=await loadPaintColorMap(ctx)
  if(!input||typeof input.title!=='string'||!input.title.trim()){return failAs(ERROR_KIND.PARSE,'title required','')}
  // #711：带锚的创建。检查放在最前面、而且是当场失败：键不合规（空、超长、带换行或注释收尾符）
  // 绝不能落到票面上 —— 落下去会把正文写坏，而且第二次提交的键与第一次不是同一个串，「幂等」就成了运气。
  const keyCheck=input.idempotencyKey===undefined||input.idempotencyKey===null?null:checkIdempotencyKey(input.idempotencyKey)
  // 原文 = 这次用不了的那个键本身（判据不成立的原因在 message 里，原文让人看见实际给的是什么）。
  if(keyCheck&&!keyCheck.ok)return failAs(ERROR_KIND.PARSE,'idempotencyKey 不能用：'+keyCheck.reason,String(input.idempotencyKey))
  const idemKey=keyCheck?keyCheck.key:''
  try{
    // #1486/#1487：六种票全部走原文布局（#1500 S4 起 originalKindOf 不再回空，旧的自拼分支已删）。
    const originalKind=originalKindOf(input)
    const placement=await createInOriginalLayout(ctx,repo,input,originalKind,idemKey)
    if(!placement.ok)return placement
    // 只有真新写了一份才记；幂等命中复用旧票时这一趟没改盘。
    if(!placement.reused)noteFileWritten(trail)
    // 回包按盘上那一份解析。
    const content=await readTextFile(ctx,placement.path)
    const st=await statFile(ctx,placement.path)
    let mtime=new Date().toISOString()
    const stMtime=st&&(st as {mtime?: unknown}).mtime
    if(stMtime){try{mtime=new Date(stMtime as string).toISOString()}catch{}}
    // 规格与地图是顶层容器，没有父票；实施票与地图子票的父票恒为同目录的 00；
    // 普通票有就写、没有就是根级。
    const wantedParent=(input.parentKey!==undefined&&input.parentKey!==null)?String(input.parentKey).trim():''
    const fallbackParent=(originalKind==='spec'||originalKind==='map')
      ?null
      :(originalKind==='spec-ticket'||originalKind==='map-ticket'
        ?'00'
        :(wantedParent?(/^\d+$/.test(wantedParent)?wantedParent.padStart(2,'0'):wantedParent):null))
    const iss=parseMd(content,{key:placement.key,parentKey:fallbackParent,isMap:originalKind==='map',effortId:placement.effortId,createdAt:placement.createdAt,updatedAt:mtime,url:placement.path,kind:originalKind==='spec'?'spec':(originalKind==='map'?'map':'issue')})
    applyLabelColors(iss,colorMap)
    return{ok:true,data:iss}
  }catch(e){return failFromError(e,ctx,'建这张票时出错')}
}
