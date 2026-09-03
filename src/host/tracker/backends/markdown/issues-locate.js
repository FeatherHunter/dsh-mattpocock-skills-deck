// issues-locate.js —— 以后改跨平台路径定位与按编号找文件规则时改它（预估约 115 行）。
import { parseMd } from './parse.js'
import { readTextFile, readDir, statFile, exists } from './read.js'
import { issuesDir } from './path.js'
import nodePath from 'node:path'

export function getPlat(ctx){if(ctx&&ctx.platform&&ctx.platform.path)return ctx.platform.path;if(ctx&&ctx.path)return ctx.path;if(typeof process!=='undefined'&&process.platform==='win32')return nodePath.win32;return nodePath.posix}
export async function getScratchRoot(ctx){
  const plat=getPlat(ctx)
  const cwd=ctx&&typeof ctx.cwd==='string'?ctx.cwd:(typeof process!=='undefined'&&typeof process.cwd==='function'?process.cwd():'.')
  return plat.join(cwd,'.scratch')
}
export async function listEffortDirs(ctx){
  const plat=getPlat(ctx)
  const root=await getScratchRoot(ctx)
  const out=[]
  try{ if(await exists(ctx, plat.join(root,'map.md'))) out.push(root) }catch{}
  let entries=[]
  try{ entries=await readDir(ctx, root) }catch{ entries=[] }
  for(const e of entries){
    if(!e || e.startsWith('.')) continue
    const dirPath=plat.join(root,e)
    const mapP=plat.join(dirPath,'map.md')
    try{ if(await exists(ctx, mapP)) out.push(dirPath) }catch{}
  }
  return out
}
export async function findIssueFileGlobal(ctx, key){
  const plat=getPlat(ctx)
  const norm=String(key).padStart(2,'0')
  const dirs=await listEffortDirs(ctx)
  for(const dir of dirs){
    const idir=plat.join(dir,'issues')
    const files=await readDir(ctx, idir)
    for(const f of files){
      const m=/^(\d+)-/.exec(f)
      if(!m) continue
      if(!f.endsWith('.md')) continue
      const k=m[1].padStart(2,'0')
      if(k===norm){
        return plat.join(idir,f)
      }
    }
  }
  return null
}
export async function findIssueFileInEffort(ctx, repo, key){
  const plat=getPlat(ctx)
  const idir=issuesDir(repo,ctx)
  const files=await readDir(ctx, idir)
  const norm=String(key).padStart(2,'0')
  for(const f of files){
    const m=/^(\d+)-/.exec(f)
    if(!m) continue
    if(!f.endsWith('.md')) continue
    const k=m[1].padStart(2,'0')
    if(k===norm) return plat.join(idir,f)
  }
  return null
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
  return parseMd(txt,{key,parentKey,isMap,createdAt:mtime,updatedAt:mtime})
}
