import { classifyError, fail } from '../../preflight.js'
import { ERROR_KIND } from '../../../../shared/tracker/constants.js'
function getFs(ctx){if(ctx&&ctx.platform&&ctx.platform.fs)return ctx.platform.fs;if(ctx&&ctx.fs)return ctx.fs;if(ctx&&typeof ctx.get==='function'){try{const f=ctx.get('fs');if(f)return f}catch{}}return null}
export async function readTextFile(ctx, fullPath){
  const fs=getFs(ctx);if(!fs)throw Object.assign(new Error('fs unavailable'),{kind:ERROR_KIND.ENV})
  if(typeof fs.resolve==='function'&&typeof fs.readText==='function'){try{const t=await fs.resolve(fullPath);const txt=await fs.readText(t);return String(txt??'')}catch(e){const kind=classifyError(e);const err=new Error(e&&e.message?e.message:String(e));err.kind=kind;err.cause=e;throw err}}
  if(typeof fs.readFile==='function'){try{const txt=await fs.readFile(fullPath,'utf8');return String(txt??'')}catch(e){const kind=classifyError(e);const err=new Error(e&&e.message?e.message:String(e));err.kind=kind;err.cause=e;throw err}}
  if(typeof fs.readText==='function'){try{const txt=await fs.readText(fullPath);return String(txt??'')}catch(e){const kind=classifyError(e);const err=new Error(e&&e.message?e.message:String(e));err.kind=kind;err.cause=e;throw err}}
  throw Object.assign(new Error('fs.read not supported'),{kind:ERROR_KIND.ENV})
}
export async function readDir(ctx, dirPath){
  const fs=getFs(ctx);if(!fs)return[]
  if(typeof fs.resolve==='function'&&typeof fs.listDir==='function'){try{const t=await fs.resolve(dirPath);const list=await fs.listDir(t);if(Array.isArray(list))return list.map(x=>typeof x==='string'?x:(x&&x.name)||String(x));return[]}catch{return[]}}
  if(typeof fs.readdir==='function'){try{const list=await fs.readdir(dirPath);return Array.isArray(list)?list:[]}catch{return[]}}
  if(typeof fs.listDir==='function'){try{const list=await fs.listDir(dirPath);return Array.isArray(list)?list:[]}catch{return[]}}
  return[]
}
export async function exists(ctx, fullPath){
  const fs=getFs(ctx);if(!fs)return false
  // DSH 文件沙箱区分两种形状：lstat 是“路径形”（直接吃字符串路径），stat / listDir / readText 是“目标形”（需先 resolve 成 handle）。
  // 原实现误将 lstat 当目标形（resolve 后再 lstat），导致 DSH 侧抛 path.trim 异常并直接返回 false，Markdown 永远找不到 map.md。
  // 修复：按形状正确分流，且失败时透传尝试下一分支，不提前 return false。
  if(typeof fs.lstat==='function'){
    try{ const st=await fs.lstat(fullPath); if(st) return true; }catch{}
    // 兼容：某些环境 lstat 可能需要 handle 形态（虽与契约不符），尝试 resolve 后再 lstat
    if(typeof fs.resolve==='function'){
      try{ const t=await fs.resolve(fullPath); const st2=await fs.lstat(t); if(st2) return true; }catch{}
    }
  }
  if(typeof fs.stat==='function'){
    if(typeof fs.resolve==='function'){
      try{ const t=await fs.resolve(fullPath); const st=await fs.stat(t); if(st) return true; }catch{}
    }
    try{ const st=await fs.stat(fullPath); if(st) return true; }catch{}
  }
  if(typeof fs.access==='function'){try{await fs.access(fullPath);return true}catch{return false}}
  // 兜底：尝试直接读一字节判断存在（对只读沙箱最宽容）
  try{ await readTextFile(ctx, fullPath); return true; }catch{ return false; }
}
export async function statFile(ctx, fullPath){
  const fs=getFs(ctx);if(!fs)return null
  if(typeof fs.resolve==='function'&&typeof fs.stat==='function'){try{const t=await fs.resolve(fullPath);return await fs.stat(t)}catch{return null}}
  if(typeof fs.stat==='function'){try{return await fs.stat(fullPath)}catch{return null}}
  if(typeof fs.lstat==='function'){try{return await fs.lstat(fullPath)}catch{try{const t=typeof fs.resolve==='function'?await fs.resolve(fullPath):fullPath;return await fs.lstat(t)}catch{return null}}}
  return null
}
export async function readFile(ctx, path){
  try{const txt=await readTextFile(ctx,path);return txt}catch(e){const kind=e&&e.kind?e.kind:classifyError(e);return fail(kind,e&&e.message?e.message:String(e))}
}
export default readFile
