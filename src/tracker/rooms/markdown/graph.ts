// graph.js —— 以后改阻塞关系读取时改它（预估约 120 行）。
//
// effort 维度（2026-09-09）：阻塞关系只在**同一 effort 内**成立。
//   - blockedBy 里的编号在本票所属 effort 内解析（含 '00' = 本 effort 的地图）；
//   - blocking（反向聚合）只扫同一个 effort 的 issues 目录，不跨 effort 互相干扰。
import { parseMd } from './parse.js'
import { readTextFile, listDirOrThrow } from './read.js'
import { getPlat, listEfforts, resolveIssueFile, resolveMapFile } from './issues-locate.js'
import { failAs, failFromError } from './error-fail.js'
import { ERROR_KIND } from '../../contract/vocabulary.js'
import type { OpContext } from '../../contract/contexts.js'
import type { RepositoryRef, IssueRef } from '../../contract/entities.js'
import type { Dependencies } from '../../contract/results.js'
import type { DepsOpts } from '../../contract/inputs.js'

// 仓库引用：path 是本地后端的自有约定（契约不保证），有就多认那个目录（path.ts 的同款，房间里各备一份）。
type RepoWithPath = RepositoryRef & { path?: string }

// 本文件交出去的失败形状：与 failAs 落的三段式一致（成功侧各函数自带）。
interface GraphFailure {
  ok: false
  error: { kind: string; message: string; raw: string }
}

export async function readBlockedBy(ctx: OpContext, repo: RepoWithPath | null, key: string): Promise<{ ok: true; data: IssueRef[]; effortId: string } | GraphFailure>{
  const norm=String(key).padStart(2,'0')
  // 定位这一步会去列 `.scratch`（listEfforts），目录读不出来时它抛错：在这里转成三段式失败。
  let r: Awaited<ReturnType<typeof resolveIssueFile>>
  try{ r=await resolveIssueFile(ctx,repo,norm,{mode:'read'}) }
  catch(e){ return failFromError(e,ctx,'按编号找这张票的文件时出错') }
  if(!r.ok)return{ok:false,error:r.error}
  try{
    const txt=await readTextFile(ctx,r.path)
    const issue=parseMd(txt,{key:norm,parentKey:'00',isMap:false,effortId:r.effortId})
    return{ok:true,data:issue.blockedBy||[],effortId:r.effortId}
  }catch(e){return failFromError(e,ctx,'读这张票的阻塞关系时出错')}
}
export async function getDependenciesForKey(ctx: OpContext, repo: RepoWithPath | null, key: string, opts?: DepsOpts): Promise<{ ok: true; data: Dependencies } | GraphFailure>{
  const plat=getPlat(ctx)
  // 批量键（#1174 决策 8：签名收到的参数要么用上、要么明说不认）：
  // 契约的返回形状是一个 `{blockedBy, blocking}`，只装得下一个编号的依赖关系；`DepsOpts.keys`
  // 想一次问多个编号，本地房没法把多个答案塞进这一个返回值里。与其像别处那样「只回第一个、
  // 其余悄悄丢掉」，不如当场说清：请逐个编号调用。今天没有调用方传它（全仓六处调用点都传空对象）。
  if(opts&&Array.isArray(opts.keys)&&opts.keys.length){
    return failAs(ERROR_KIND.UNSUPPORTED,'markdown getDependencies unsupported (opts.keys)：契约的返回形状只装得下一个编号的依赖关系，要多个请逐个编号调用',JSON.stringify({key:key,keys:opts.keys}))
  }
  const normalizedKey=String(key).padStart(2,'0')
  const r=await readBlockedBy(ctx,repo,normalizedKey)
  if(!r.ok)return r
  const effortId=r.effortId||''
  const blockedBy=r.data||[]
  // 原文 = 这张票自己的编号（没有外部来源的原文：结论是「票面自己把自己列成了阻塞者」）。
  if(blockedBy.some(ref=>ref&&ref.key===normalizedKey)){return failAs(ERROR_KIND.CONFLICT,'self-block '+normalizedKey,normalizedKey)}
  // 本 effort 的目录（找不到就退回仓库根 issues 夹具形态）
  let efforts: Awaited<ReturnType<typeof listEfforts>>
  try{ efforts=await listEfforts(ctx) }
  catch(e){ return failFromError(e,ctx,'列出这个仓库的工作单元时出错') }
  const mine=efforts.find(function(e){ return e.effortId===effortId })
  const idirs=mine?[plat.join(mine.dir,'issues')]:[]
  // 回填 blockedBy 的 title/state：同 effort 内解析（'00' 指本 effort 的地图）
  try{
    for(const ref of blockedBy){
      if(!ref || ref.title) continue
      const rk=ref.key?String(ref.key).padStart(2,'0'):''
      if(!rk) continue
      if(rk==='00'){
        const mr=await resolveMapFile(ctx,repo,{effortId, mode:'read'})
        if(mr.ok){
          // #1676：明确读到状态才写；读不到保持缺省（未知），不补空串冒充两态之一。
          try{ const t=await readTextFile(ctx,mr.path); const iss=parseMd(t,{key:'00',parentKey:null,isMap:true,effortId}); ref.title=iss.title||''; if(iss.state) ref.state=iss.state }catch(e){}
        }
        continue
      }
      const tr=await resolveIssueFile(ctx,repo,rk,{effortId, mode:'read'})
      if(!tr.ok) continue
      // #1676：同上，读不到就是未知。
      try{ const t=await readTextFile(ctx,tr.path); const iss=parseMd(t,{key:rk,parentKey:'00',isMap:false,effortId}); ref.title=iss.title||''; if(iss.state) ref.state=iss.state }catch(e){}
    }
  }catch(e){}
  // 反向聚合：只扫本 effort
  const blocking: IssueRef[]=[]
  for(const idir of idirs){
    let files: string[]=[]
    // 列不出这个工作单元的票目录时如实失败，不当成「这里没有票」：反向聚合少扫一部分，
    // 「谁在等这张票」这个答案会悄悄变少，而它正是判断一张票能不能开工的依据（#1174 根因一）。
    try{ files=await listDirOrThrow(ctx,idir) }
    catch(e){ return failFromError(e,ctx,'读这个工作单元的票目录时出错') }
    for(const f of files){
      if(!f||!f.endsWith('.md')) continue
      const m=/^(\d+)-/.exec(f)
      if(!m) continue
      const k=m[1].padStart(2,'0')
      if(k===normalizedKey) continue
      const full=plat.join(idir,f)
      try{
        const txt=await readTextFile(ctx,full)
        const iss=parseMd(txt,{key:k,parentKey:'00',isMap:false,effortId})
        const b=iss.blockedBy||[]
        if(b.some(ref=>ref&&ref.key===normalizedKey)){blocking.push({key:k,title:iss.title||'',state:iss.state})}
      }catch(e){}
    }
  }
  return{ok:true,data:{blockedBy,blocking}}
}
export {getDependenciesForKey as getDependencies}
export default{readBlockedBy,getDependencies:getDependenciesForKey}

/** 一个工作单元里的全部阻塞边：票号 → 这张票自己列出的阻塞者编号。
 *
 *  这是「这条依赖写下去会不会成环」那一问的输入。契约把环检写成写路径的一部分、还补了一句
 *  「不许省」（`src/tracker/contract/operations.ts` 的 setBlockedBy 那一段），所以写阻塞边之前
 *  必须能看到整张图，而不是只看要改的这两张票。
 *
 *  地图（`00`）也算图上的一个点：票可以被地图阻塞，地图也可以被票阻塞，两边都写在同一个
 *  `Blocked by` 字段里，跳过它就漏掉一类环。
 *
 *  列目录或读某一份票读不出来时**如实失败**，不当成「这里没有这张票」：少读一张票就可能把一个环
 *  看成没有环，而环检出错的方向正好是最不该出错的那一边（写出了环，之后再也解不开）。 */
export async function readBlockedByGraph(ctx: OpContext, repo: RepoWithPath | null, effortId: string): Promise<{ ok: true; graph: Map<string, string[]> } | GraphFailure>{
  const plat=getPlat(ctx)
  let efforts: Awaited<ReturnType<typeof listEfforts>>
  try{ efforts=await listEfforts(ctx) }
  catch(e){ return failFromError(e,ctx,'列出这个仓库的工作单元时出错') }
  const mine=efforts.find(function(e){ return e.effortId===(effortId||'') })
  const graph=new Map<string,string[]>()
  if(!mine)return{ok:true,graph:graph}
  const idirs=[plat.join(mine.dir,'issues')]
  for(const idir of idirs){
    let files: string[]
    try{ files=await listDirOrThrow(ctx,idir) }
    catch(e){ return failFromError(e,ctx,'读这个工作单元的票目录时出错') }
    for(const f of files){
      if(!f||!f.endsWith('.md'))continue
      const m=/^(\d+)-/.exec(f)
      if(!m)continue
      const k=m[1].padStart(2,'0')
      try{
        const txt=await readTextFile(ctx,plat.join(idir,f))
        const iss=parseMd(txt,{key:k,parentKey:'00',isMap:false,effortId:effortId||''})
        graph.set(k,(iss.blockedBy||[]).map(function(ref){ return String(ref&&ref.key?ref.key:'').padStart(2,'0') }).filter(Boolean))
      }catch(e){ return failFromError(e,ctx,'读这个工作单元里的票时出错（环检要读全图，读不全就不判）') }
    }
  }
  // 地图自己也可能写着 Blocked by：它在工作单元根目录，单独读一次。
  try{
    const mr=await resolveMapFile(ctx,repo,{effortId:effortId||'',mode:'read'})
    if(mr.ok){
      const txt=await readTextFile(ctx,mr.path)
      const iss=parseMd(txt,{key:'00',parentKey:null,isMap:true,effortId:effortId||''})
      graph.set('00',(iss.blockedBy||[]).map(function(ref){ return String(ref&&ref.key?ref.key:'').padStart(2,'0') }).filter(Boolean))
    }
  }catch(e){ return failFromError(e,ctx,'读这个工作单元的地图时出错（环检要读全图，读不全就不判）') }
  return{ok:true,graph:graph}
}

/** 从 `start` 出发顺着「阻塞者」方向走，走得回 `start` 就是成环；把环上经过的点按顺序交出来
 *  （首尾都是 `start`）。没有环回 `null`。
 *
 *  为什么从 `start` 出发就够：这次要写的边全部以 `start` 为起点（「这张票改由这几张票阻塞」），
 *  新出现的环一定经过 `start`，不经过 `start` 的环在改之前就有、不是这次写出来的。
 *
 *  走法是最普通的深度优先加三色标记：在**当前这条路上**走过的点记下来（灰），走完退回去的点
 *  记成已完成（黑）。踩到灰点就是找到了环，环就是从那个灰点第一次出现的位置到现在的这条路径。
 *  深度上界是一个工作单元里的票数（同目录下互不相同的编号），本后端的规模下用递归足够。 */
export function cycleThrough(graph: Map<string, string[]>, start: string): string[] | null{
  const path: string[]=[]
  const onPath=new Set<string>()
  const done=new Set<string>()
  const walk=function(node: string): string[] | null{
    if(onPath.has(node)){
      const at=path.indexOf(node)
      return path.slice(at).concat(node)
    }
    if(done.has(node))return null
    onPath.add(node);path.push(node)
    const next=graph.get(node)||[]
    for(const n of next){
      const found=walk(n)
      if(found)return found
    }
    path.pop();onPath.delete(node);done.add(node)
    return null
  }
  return walk(start)
}
