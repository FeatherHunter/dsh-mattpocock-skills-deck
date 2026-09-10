// issues-locate.js —— 以后改跨平台路径定位与按编号找文件规则时改它（预估约 200 行）。
//
// effort 维度（2026-09-09）后本文件是**effort 维度的唯一落点**：
//  一个仓库可以有多个 effort（`.scratch/<effort>/`），每个 effort 的票各自从 01 编号，
//  所以「按编号找文件」必须带上 effort 范围。全部读写路径都经本文件的 resolveIssueFile / resolveMapFile，
//  不再各文件自己扫目录（此前 comments.js / graph.js / issues-status.js / issues-patch.js 各有一份拷贝，
//  它们取「按目录顺序第一个命中」，于是给第二个 effort 的票写评论会落到第一个 effort 的同号文件里）。
//
// 范围规则（repo.effortId 或 opts.effortId）：
//  - 给了 effort 标识 → 只在那一个 effort 内找；
//  - 没给（undefined）→ 全仓库找；命中多个 effort 时，**读**按目录顺序回落（保住聊天里 `#01` 链接），
//    **写**返回 conflict 诚实失败，绝不猜（猜错文件是数据损坏，不是显示问题）。
//  - 根级 `.scratch/map.md` 这种扁平历史布局算作 effortId = ''（空串）。
import { parseMd } from './parse.js'
import { readTextFile, readDir, statFile, exists } from './read.js'
import { issuesDir } from './path.js'
import { ERROR_KIND } from '../../../../shared/tracker/constants.js'
import nodePath from 'node:path'

export function getPlat(ctx){if(ctx&&ctx.platform&&ctx.platform.path)return ctx.platform.path;if(ctx&&ctx.path)return ctx.path;if(typeof process!=='undefined'&&process.platform==='win32')return nodePath.win32;return nodePath.posix}
export async function getScratchRoot(ctx){
  const plat=getPlat(ctx)
  const cwd=ctx&&typeof ctx.cwd==='string'?ctx.cwd:(typeof process!=='undefined'&&typeof process.cwd==='function'?process.cwd():'.')
  return plat.join(cwd,'.scratch')
}
/** 列出本仓库的全部 effort（顺序稳定：根级扁平布局优先，其余按目录名排序）。返回 [{effortId, dir}]。 */
export async function listEfforts(ctx){
  const plat=getPlat(ctx)
  const root=await getScratchRoot(ctx)
  const out=[]
  try{ if(await exists(ctx, plat.join(root,'map.md'))) out.push({effortId:'', dir:root}) }catch{}
  let entries=[]
  try{ entries=await readDir(ctx, root) }catch{ entries=[] }
  const names=entries.filter(function(e){ return e && !e.startsWith('.') }).sort()
  for(const e of names){
    const dirPath=plat.join(root,e)
    const mapP=plat.join(dirPath,'map.md')
    try{ if(await exists(ctx, mapP)) out.push({effortId:String(e), dir:dirPath}) }catch{}
  }
  return out
}
/** 兼容旧调用：只要目录路径列表（顺序与 listEfforts 一致）。 */
export async function listEffortDirs(ctx){
  return (await listEfforts(ctx)).map(function(e){ return e.dir })
}
/**
 * 取本次调用的 effort 寻址范围（唯一实现，issues-read 也用它，避免两份口径分叉）：
 *  - `opts.effortId` 给出字符串 → 只看这一个 effort；
 *  - `opts.effortId === null` → 明确「全仓库」，连 repo 上的范围也不看（调用方显式要求时的逃生口）；
 *  - 都没给 → 看 `repo.effortId`；仍没有 → 全仓库（undefined）。
 */
export function scopeOf(repo, opts){
  if(opts && opts.effortId !== undefined) return opts.effortId === null ? undefined : String(opts.effortId)
  if(repo && repo.effortId !== undefined && repo.effortId !== null) return String(repo.effortId)
  return undefined
}
function conflict(key, hits){
  return { ok:false, error:{ kind:ERROR_KIND.CONFLICT, message:'issue '+key+' 在 '+hits.length+' 个 effort 里都存在，但没指定 effortId（拒绝猜目标文件）' } }
}
/** 按 (effort 范围, 编号) 找票文件。o.mode='write' 时多命中即 conflict；返回 {ok,path,effortId} 或 {ok:false,error}。 */
export async function resolveIssueFile(ctx, repo, key, o={}){
  const plat=getPlat(ctx)
  const norm=String(key).padStart(2,'0')
  const scope=scopeOf(repo, o)
  const hits=[]
  const efforts=await listEfforts(ctx)
  for(const e of efforts){
    if(scope!==undefined && e.effortId!==scope) continue
    const idir=plat.join(e.dir,'issues')
    const files=await readDir(ctx, idir)
    for(const f of files){
      if(!f || !f.endsWith('.md')) continue
      const m=/^(\d+)-/.exec(f)
      if(!m) continue
      if(m[1].padStart(2,'0')!==norm) continue
      hits.push({ path: plat.join(idir,f), effortId: e.effortId })
    }
  }
  if(hits.length===0){
    // 夹具形态兜底：repo.refId / repo.path 直接当仓库根（单 effort、无 .scratch）
    const cands=[]
    try{ cands.push(issuesDir(repo,ctx)) }catch{}
    if(repo && repo.path){ try{ cands.push(plat.join(repo.path,'issues')) }catch{} }
    for(const idir of cands){
      const files=await readDir(ctx, idir)
      for(const f of files){
        if(!f || !f.endsWith('.md')) continue
        const m=/^(\d+)-/.exec(f)
        if(!m) continue
        if(m[1].padStart(2,'0')!==norm) continue
        hits.push({ path: plat.join(idir,f), effortId: scope!==undefined?scope:'' })
      }
      if(hits.length) break
    }
  }
  if(hits.length===0) return { ok:false, error:{ kind:ERROR_KIND.NOTFOUND, message:'issue '+norm+' not-found' } }
  if(hits.length>1 && o.mode==='write') return conflict(norm, hits)
  return { ok:true, path:hits[0].path, effortId:hits[0].effortId }
}
/** 按 effort 范围找地图文件（map.md）。未给范围且多命中时，读取第一个、写报 conflict。 */
export async function resolveMapFile(ctx, repo, o={}){
  const plat=getPlat(ctx)
  const scope=scopeOf(repo, o)
  const hits=[]
  const efforts=await listEfforts(ctx)
  for(const e of efforts){
    if(scope!==undefined && e.effortId!==scope) continue
    hits.push({ path: plat.join(e.dir,'map.md'), effortId: e.effortId })
  }
  if(hits.length===0){
    try{
      const mapP=plat.join(issuesDir(repo,ctx),'..','map.md')
      if(await exists(ctx,mapP)) hits.push({ path:mapP, effortId: scope!==undefined?scope:'' })
    }catch{}
    if(!hits.length && repo && repo.path){
      try{ const mapP=plat.join(repo.path,'map.md'); if(await exists(ctx,mapP)) hits.push({ path:mapP, effortId: scope!==undefined?scope:'' }) }catch{}
    }
  }
  if(hits.length===0) return { ok:false, error:{ kind:ERROR_KIND.NOTFOUND, message:'map.md not-found' } }
  if(hits.length>1 && o.mode==='write') return conflict('00', hits)
  return { ok:true, path:hits[0].path, effortId:hits[0].effortId }
}
/** 兼容旧接口：全局按编号找（读语义，取第一个命中）。新代码请用 resolveIssueFile。 */
export async function findIssueFileGlobal(ctx, key){
  const r=await resolveIssueFile(ctx, null, key, { mode:'read' })
  return r.ok?r.path:null
}
/** 兼容旧接口：按仓库/effort 找（读语义）。新代码请用 resolveIssueFile。 */
export async function findIssueFileInEffort(ctx, repo, key){
  const r=await resolveIssueFile(ctx, repo, key, { mode:'read' })
  return r.ok?r.path:null
}

export async function loadIssueFromFile(ctx,repo,fullPath,metaExtra={}){
  const txt=await readTextFile(ctx,fullPath)
  const st=await statFile(ctx,fullPath)
  let mtime=''
  if(st){
    const t=st.mtime||st.mtimeMs||st.ctime
    if(t){try{mtime=new Date(t).toISOString()}catch{} if(!mtime&&typeof t==='number'){try{mtime=new Date(t).toISOString()}catch{}}}
    if(!mtime&&st.mtime)mtime=String(st.mtime)
  }
  const base=fullPath.split(/[\\/]/).pop()||''
  const km=/^(\d+)-/.exec(base)
  const key=km?km[1].padStart(2,'0'):String(metaExtra.key||'00').padStart(2,'0')
  const parentKey=metaExtra.parentKey!==undefined?metaExtra.parentKey:null
  const isMap=!!metaExtra.isMap
  const effortId=metaExtra.effortId!==undefined?metaExtra.effortId:''
  return parseMd(txt,{key,parentKey,isMap,effortId,createdAt:mtime,updatedAt:mtime})
}
