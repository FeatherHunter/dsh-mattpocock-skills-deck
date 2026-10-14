// issues-read.js —— 以后改列举与读取单据语义时改它（预估约 200 行）。
//
// effort 维度（2026-09-09）：一个仓库可以有多个 effort，每个 effort 的票各自从 01 编号。
// 本文件的职责是「按 effort 范围列出/读取」，每张票与每张地图都带上 effortId；
// 父子关系只在同一 effort 内成立（子票 parentKey='00' 指的是**本 effort 的地图**）。
import { parseMd } from './parse.js'
import { readTextFile, readDir, statFile } from './read.js'
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
  /** 把某个 issues/ 目录下的票文件逐个读成行（文件名规则与列举一致：编号加短横开头的 .md 才算票）。 */
  const collectTicketsIn = async function (idir: string, effortId: string, useKeyFilter: boolean): Promise<void> {
    const files = await readDir(ctx, idir)
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
    }
    filtered.sort((a,b)=>String(a.effortId||'').localeCompare(String(b.effortId||''))||a.key.localeCompare(b.key))
    return{ok:true,data:filtered}
  }catch(e){return failFromError(e,ctx,'列举这个工作区的票时出错')}
}
// 读单票的选项：契约 GetOpts 加上本房的 effort 寻址（经 scopeOf 透给定位口；不给就看 repo 上的范围）。
type GetIssueOpts = GetOpts & { effortId?: string | null }
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
        return{ok:true,data:iss}
      }catch(e){return failFromError(e,ctx,'读这个工作单元的地图文件时出错')}
    }
    return{ok:false,error:r.error}
  }
  const r=await resolveIssueFile(ctx,repo,norm,{effortId: scope, mode:'read'})
  if(r.ok){
    try{const iss=await loadIssueFromFile(ctx,repo,r.path,{parentKey:'00',isMap:false,effortId:r.effortId});applyLabelColors(iss, colorMap);return{ok:true,data:iss}}catch(e){return failFromError(e,ctx,'读这张票的文件时出错')}
  }
  return{ok:false,error:r.error}
}
