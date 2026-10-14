// issues-read.js —— 以后改列举与读取单据语义时改它（预估约 200 行）。
//
// effort 维度（2026-09-09）：一个仓库可以有多个 effort，每个 effort 的票各自从 01 编号。
// 本文件的职责是「按 effort 范围列出/读取」，每张票与每张地图都带上 effortId；
// 父子关系只在同一 effort 内成立（子票 parentKey='00' 指的是**本 effort 的地图**）。
import { parseMd } from './parse.js'
import { readTextFile, listDir, statFile } from './read.js'
import { mdPath, issuesDir } from './path.js'
import { failAs, failFromError, kindFromError, rawFromError, rawTextOf } from './error-fail.js'
import { ERROR_KIND } from '../../contract/vocabulary.js'
import { idOfParts } from '../../identity-keys.js'
import { getPlat, listEfforts, resolveIssueFile, resolveMapFile, loadIssueFromFile, scopeOf } from './issues-locate.js'
import { loadPaintColorMap, applyLabelColors } from './label-colors-paint.js'
import type { OpContext } from '../../contract/contexts.js'
import type { Issue } from '../../contract/entities.js'
import type { GetOpts, ListFilter } from '../../contract/inputs.js'
import type { RepositoryRef } from '../../contract/entities.js'

// 本地票仓引用：契约 RepositoryRef 之外，旧调用与测试夹具会用 path 直接当仓库根，
// 故在此补一个可选 path（path.ts 的 RepoWithPath 同款，各文件自包含、不跨文件引用）。
type RepoWithPath = RepositoryRef & { path?: string }
// 枚举与列举的过滤器：契约 ListFilter 加上本房的 effort 寻址（counts/page 把 effortId 放在过滤器里透传，见 counts.ts）。
type RowFilter = ListFilter & { effortId?: string | null }
// 枚举选项：今天只有「票文件读不动时收不收集」一个开关（list 静默跳过，counts 收集后整体失败）。
interface EnumerateOpts {
  collectErrors?: boolean
}
// 一条读不动的票文件：编号、文件、判出的档位、给人看的话、原文（调用方据此如实报失败，不许猜数）。
export interface RowReadError {
  key: string
  path: string
  kind: string
  message: string
  raw: string
}

// ── 票行枚举（#691 抽出来）：列举与计数共用这唯一一份口径 ────────────────────────────
/**
 * 按工作单元枚举票行：`listIssues` 与 `countIssues` 共用这一份「这个仓库里有哪些票行」的实现。
 *
 * 为什么必须共用：`counts` 的数要与 `list` 画出来的行同源 —— 数「列举会返回的那些票行」（每个工作
 * 单元目录 `issues/` 下文件名以「编号加短横」开头的 .md），地图容器行分开算、notes.md 这类不算票
 * （#688 的第一手实测结论）。两处各写一遍枚举，日后必然走样。
 *
 * 返回 `{rows, errors}`：
 *   · rows   —— 地图容器行与票行混在一起，顺序与列举一致（先按工作单元排序，每个工作单元先地图后票）；
 *   · errors —— 只有「票文件读不动」这一种，每项 `{key, path, kind, message}`。
 *     默认不收集（`listIssues` 走的既有口径：读不动的票文件静默跳过，行为一个字没变）；
 *     `opts.collectErrors === true` 时收集（`countIssues` 走这条路：有错就如实失败，
 *     绝不静默少一行、绝不回一个偏小的数）。
 *     地图文件读不动不进 errors：它本身不计入票数，票行枚举也不依赖它（工作单元靠 map.md 是否存在
 *     来发现，票行靠列目录）。唯一例外是下面第三种兜底形态：那里的地图读不动会连带不列票，
 *     与列举同形（两边都回空），所以也不额外报错。
 */
export async function enumerateIssueRows(ctx: OpContext, repo: RepoWithPath, filter: RowFilter = {}, opts: EnumerateOpts = {}): Promise<{ rows: Issue[]; errors: RowReadError[] }> {
  const plat = getPlat(ctx)
  const scope = scopeOf(repo, filter)
  const collectErrors = !!(opts && opts.collectErrors === true)
  const rows: Issue[] = []
  const errors: RowReadError[] = []
  /** 记下一个读不动的票文件：调用方据此如实报失败（编号、文件、错误档位、原文都带上）。 */
  const noteReadError = function (key: string, fullPath: string, err: unknown): void {
    if (!collectErrors) return
    const got = kindFromError(err, ctx)
    // 原文 = 抛上来的那个错误本身（`cause` 里才是文件服务真正吐出的那一句，取法统一在 error-fail.ts）。
    errors.push({ key: String(key), path: String(fullPath || ''), kind: got.kind, message: err && (err as Record<string, unknown>).message ? String((err as Record<string, unknown>).message) : String(err), raw: rawTextOf(rawFromError(err)) })
  }
  /** `filter.keys` 给的是「这几个编号才要」：枚举阶段就跳过别的编号（列举的既有行为，照旧）。 */
  const keyWanted = function (key: string): boolean {
    if (!filter || !Array.isArray(filter.keys) || !filter.keys.length) return true
    return filter.keys.includes(key)
  }
  /** 地图容器行：列举要它，数票不要它。读不动时照旧静默（理由见上面的函数注释）。 */
  const pushMapRow = async function (mapPath: string, effortId: string, withTime: boolean): Promise<void> {
    try {
      const txt = await readTextFile(ctx, mapPath)
      const extra: { createdAt?: string; updatedAt?: string } = {}
      if (withTime) {
        const st = await statFile(ctx, mapPath)
        let mtime = ''
        // stat 回 unknown（各实现字段不一），同 issues-locate.ts 的取法：只为过类型，求值顺序不变。
        const s = st as Record<string, unknown> | null
        if (s && s.mtime) { try { mtime = new Date(s.mtime as string | number | Date).toISOString() } catch {} }
        extra.createdAt = mtime
        extra.updatedAt = mtime
      }
      rows.push(parseMd(txt, Object.assign({ key: '00', parentKey: null, isMap: true, effortId, url: mapPath }, extra)))
    } catch {}
  }
  /** 一个票文件读成一行：读不动时按上面的开关决定「静默跳过」还是「记下错误」。 */
  const pushTicketRow = async function (fullPath: string, key: string, effortId: string): Promise<void> {
    try { rows.push(await loadIssueFromFile(ctx, repo, fullPath, { parentKey: '00', isMap: false, effortId })) }
    catch (err) { noteReadError(key, fullPath, err) }
  }
  /** 把某个 issues/ 目录下的票文件逐个读成行（文件名规则与列举一致：编号加短横开头的 .md 才算票）。
   *  列目录这一层分两种情形，都不许当「这里没有票」：
   *   - 目录**不存在**（这个工作单元还没建过票）→ 正常，就是空；
   *   - 目录**读不出来**（权限、故障）→ 开了错误收集（counts / listPage）就记下这一条由调用方整体失败；
   *     没开（list）就当场抛错，由 listIssues 转成如实失败。 */
  const noteDirReadError = function (idir: string, err: unknown): void {
    const got = kindFromError(err, ctx)
    const detail = err && (err as Record<string, unknown>).message ? String((err as Record<string, unknown>).message) : String(err)
    errors.push({ key: '', path: String(idir || ''), kind: got.kind, message: '这个工作单元的票目录读不出来：' + String(idir || '') + '（' + detail + '）', raw: rawTextOf(rawFromError(err)) })
  }
  const collectTicketsIn = async function (idir: string, effortId: string, useKeyFilter: boolean): Promise<void> {
    // 这里用严格的 `listDir`：宽松口把「读不出来」压成空数组，上面那两条承诺就都落空了
    // （开了收集就把错误记下来、没开就当场抛）—— 而且是在「看起来正常」的样子下落空的。
    let files: string[]
    {
      const listed = await listDir(ctx, idir)
      if (listed.ok) files = listed.names
      else if (listed.missing) files = []
      else {
        if (!collectErrors) throw listed.error
        noteDirReadError(idir, listed.error)
        return
      }
    }
    for (const f of files) {
      const m = /^(\d+)-/.exec(f)
      if (!m) continue
      if (!f.endsWith('.md')) continue
      const key = m[1].padStart(2, '0')
      if (useKeyFilter && !keyWanted(key)) continue
      await pushTicketRow(plat.join(idir, f), key, effortId)
    }
  }

  // 一、按工作单元逐个列举；scope 给出时只看那一个工作单元
  const efforts = await listEfforts(ctx)
  for (const e of efforts) {
    if (scope !== undefined && e.effortId !== scope) continue
    await pushMapRow(plat.join(e.dir, 'map.md'), e.effortId, true)
    await collectTicketsIn(plat.join(e.dir, 'issues'), e.effortId, true)
  }
  // 二、夹具形态兜底（repo.refId 直接当仓库根、没有 .scratch）：仅在全局一个都没找到时走
  if (rows.length === 0) {
    await pushMapRow(mdPath(repo, 'map', undefined, ctx), scope || '', true)
    await collectTicketsIn(issuesDir(repo, ctx), scope || '', true)
    // 第三种夹具形态：repo.path 直接当仓库根（地图与 issues/ 都在它下面）。
    // 这里的「地图读不动就连票也不列」是既有行为（整段共用一个 try），照旧不动。
    if (rows.length === 0 && repo && repo.path) {
      try {
        const mapP = plat.join(repo.path, 'map.md')
        const txt = await readTextFile(ctx, mapP)
        rows.push(parseMd(txt, { key: '00', parentKey: null, isMap: true, effortId: scope || '', url: mapP }))
        await collectTicketsIn(plat.join(repo.path, 'issues'), scope || '', false)
      } catch {}
    }
  }
  return { rows, errors }
}

/** filter.labels 归一：去掉空白项与重复项，保持原顺序（与 GitHub 那条同一口径）。
 *
 *  住在这一件里、由 counts 再导出，是因为两个读者都在这一层以下：`list` 要用它筛行，
 *  `counts` 与 `page` 要用它数数切页。放在 counts 里会绕成环（counts 已经 import 本文件的枚举函数）。
 *  ⚠️ 空数组按「不过滤」处理 —— 契约对这一格自己写着两句互相矛盾的话（`contract/inputs.ts` 说
 *  「一个标签都不带」，另一处说空集恒真），#1174 规格明确「先复现、复现出来再定」，今天没有调用方
 *  这么传，所以先维持两房一致的老行为，别单方面改一边。 */
export function labelsOf(filter: { labels?: unknown } | undefined | null): string[] {
  const raw = filter && typeof filter === 'object' ? filter.labels : null
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  const seen: Record<string, boolean> = {}
  for (const v of raw) {
    const name = typeof v === 'string' ? v.trim() : ''
    if (!name || seen[name]) continue
    seen[name] = true
    out.push(name)
  }
  return out
}

/** 一张票是不是同时带上了要求的全部标签（本地票面只写标签名，按名字精确比对）。 */
export function hasAllLabels(row: Issue, wanted: string[]): boolean {
  if (!wanted.length) return true
  const names: string[] = []
  const list = row && Array.isArray(row.labels) ? row.labels : []
  for (const lab of list) if (lab && lab.name) names.push(String(lab.name))
  for (const name of wanted) if (!names.includes(name)) return false
  return true
}

export async function listIssues(ctx: OpContext, repo: RepoWithPath, filter: RowFilter = {}): Promise<{ ok: true; data: Issue[] } | { ok: false; error: { kind: string; message: string; raw: string } }> {
  const colorMap=await loadPaintColorMap(ctx)
  try{
    // 枚举这一段与 counts 共用同一份实现；这里不打开错误收集（读不动的票文件静默跳过，既有行为）
    const out=(await enumerateIssueRows(ctx,repo,filter)).rows
    // 票面上色：原来在枚举时逐行上色，抽出来之后统一在这里上，结果与之前一样
    for(const it of out) applyLabelColors(it, colorMap)
    // A: 回填 blockedBy 的 title/state（文件约束内满足契约：Blocked by 行只存 key，标题从被引文件首行取）
    //    effort 维度：引用只在**本票所属 effort**内解析，跨 effort 同号票不互相污染。
    try {
      // 按 (effortId, key) 建索引：阻塞引用只在同 effort 内解析，跨 effort 同号票不互相污染。
      const byKey: Record<string, Issue> = {}
      out.forEach(function(it){ if(it && it.key) byKey[idOfParts(it.effortId, String(it.key).padStart(2,'0'))] = it })
      out.forEach(function(it){
        if(!it || !Array.isArray(it.blockedBy)) return
        it.blockedBy.forEach(function(ref){
          const k = ref && ref.key ? String(ref.key).padStart(2,'0') : ''
          const target = k ? byKey[idOfParts(it.effortId, k)] : null
          if(target){
            if(!ref.title) ref.title = target.title || ''
            // 'OPEN' 是历史兜底：target 来自本批归一后的行（state 恒为 open/closed 非空），
            // 故 || 链恒取前两项之一；断言只为过类型，值不变。
            ref.state = (target.state || ref.state || 'OPEN') as Issue['state']
          }
        })
      })
    } catch {}
    let filtered=out
    if(filter){
      if(filter.type)filtered=filtered.filter(x=>x.type===filter.type)
      if(filter.state)filtered=filtered.filter(x=>x.state===filter.state)
      if(filter.parentKey!==undefined){
        if(filter.parentKey===null)filtered=filtered.filter(x=>x.parentKey===null)
        else filtered=filtered.filter(x=>x.parentKey===filter.parentKey)
      }
      if(Array.isArray(filter.keys)&&filter.keys.length){const keys=filter.keys;filtered=filtered.filter(x=>keys.includes(x.key))}
      // 按标签筛（#1174）：契约的 ListFilter.labels 写的是「必须同时带上这些标签」，本后端的 counts
      // 一直按它筛，list 却把这一项丢了 —— 于是界面上会出现「上面数 3 张、下面列 12 张」这种自相矛盾的画面。
      // 判定用同一份 labelsOf / hasAllLabels，保证数字与行同源。
      const wantedLabels=labelsOf(filter)
      if(wantedLabels.length)filtered=filtered.filter(x=>hasAllLabels(x,wantedLabels))
      // 拉取请求筛选（#1174）：本地票仓里没有「拉取请求」这种东西，每一张票都是普通票。
      // 所以「只要拉取请求」的诚实答案就是空 —— 空也是答案，不是失败（契约对定位口与筛选的同一口径）。
      if(filter.isPullRequest===true)filtered=[]
    }
    filtered.sort((a,b)=>String(a.effortId||'').localeCompare(String(b.effortId||''))||a.key.localeCompare(b.key))
    return{ok:true,data:filtered}
  }catch(e){return failFromError(e,ctx,'列举这个工作区的票时出错')}
}
// 读单票的选项：契约 GetOpts 加上本房的 effort 寻址（经 scopeOf 透给定位口；不给就看 repo 上的范围）。
type GetIssueOpts = GetOpts & { effortId?: string | null }
/** 按 `opts.comments` 取一段评论（#1174 决策 8）。
 *
 *  以前这个选项被**整条丢掉**：调用方说「只要前三条」，拿回去的还是全部评论，而且回的是 ok
 *  （#1174 复核 P2 实跑：`{}` / `{first:1}` / `{first:1,after:'x'}` 三种都回三条，一模一样）。
 *
 *  本地房的游标就是**「已经给过几条」**这一个十进制数：`after:'3'` 表示从第 4 条开始。
 *  为什么不用评论自己的标识当游标：本地票文件里的评论没有稳定标识（契约里 `Comment.id` 是可选的，
 *  本房不产出它），只有先后顺序；拿序号当游标是这里唯一说得清、也不依赖额外状态的做法。
 *  没给 `comments` 就一条不截，与改动之前的行为一样。 */
function sliceComments(iss: Issue, opts: GetIssueOpts): Issue {
  const want=opts&&opts.comments
  if(!want)return iss
  const all=Array.isArray(iss.comments)?iss.comments:[]
  const rawFirst=(want as {first?: unknown}).first
  const first=typeof rawFirst==='number'&&isFinite(rawFirst)&&rawFirst>=0?Math.floor(rawFirst):all.length
  const rawAfter=(want as {after?: unknown}).after
  let start=0
  if(typeof rawAfter==='string'&&rawAfter.trim()){
    const n=Number(rawAfter.trim())
    start=isFinite(n)&&n>0?Math.floor(n):0
  }
  return {...iss,comments:all.slice(start,start+first)}
}

export async function getIssue(ctx: OpContext, repo: RepoWithPath, key: string, opts: GetIssueOpts = {}): Promise<{ ok: true; data: Issue } | { ok: false; error: { kind: string; message: string; raw: string } }> {
  // 原文给空串：这条支路一个文件都没碰过，没有外部来源的原文可取。
  if(!key)return failAs(ERROR_KIND.NOTFOUND,'missing key','')
  const norm=String(key).padStart(2,'0')
  const colorMap=await loadPaintColorMap(ctx)
  const scope=scopeOf(repo, opts)
  if(norm==='00'){
    const r=await resolveMapFile(ctx,repo,{effortId: scope, mode:'read'})
    if(r.ok){
      try{
        const txt=await readTextFile(ctx,r.path)
        const st=await statFile(ctx,r.path)
        let mtime=''
        // stat 回 unknown（各实现字段不一），同本文件 pushMapRow 的取法：只为过类型，求值顺序不变。
        const s=st as Record<string, unknown> | null
        if(s&&s.mtime){try{mtime=new Date(s.mtime as string | number | Date).toISOString()}catch{}}
        const iss=parseMd(txt,{key:norm,parentKey:null,isMap:true,effortId:r.effortId,createdAt:mtime,updatedAt:mtime,url:r.path})
        applyLabelColors(iss, colorMap)
        return{ok:true,data:sliceComments(iss,opts)}
      }catch(e){return failFromError(e,ctx,'读这个工作单元的地图文件时出错')}
    }
    return{ok:false,error:r.error}
  }
  const r=await resolveIssueFile(ctx,repo,norm,{effortId: scope, mode:'read'})
  if(r.ok){
    try{const iss=await loadIssueFromFile(ctx,repo,r.path,{parentKey:'00',isMap:false,effortId:r.effortId});applyLabelColors(iss, colorMap);return{ok:true,data:sliceComments(iss,opts)}}catch(e){return failFromError(e,ctx,'读这张票的文件时出错')}
  }
  return{ok:false,error:r.error}
}
