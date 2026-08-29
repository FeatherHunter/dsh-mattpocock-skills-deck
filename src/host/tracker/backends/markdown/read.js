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
  // DSH fs 形状约定（platform/index.js）：lstat 是 path-shaped（吃原始路径）；resolve 返回 target 仅供 readText/stat/listDir 等 target-shaped 调用。
  // 修复：先按文档形状传原始路径；resolve-target 形状仅作兼容回落。原实现先传 target 且 catch 直接 return false，
  // 导致宿主内 exists 恒 false → markdown 枚举 0 → 面板 maps=0（#331 观察的「列表空白」总根因）。
  if(typeof fs.lstat==='function'){try{const st=await fs.lstat(fullPath);return!!st}catch{}}
  if(typeof fs.resolve==='function'&&typeof fs.lstat==='function'){try{const t=await fs.resolve(fullPath);const st=await fs.lstat(t);return!!st}catch{}}
  if(typeof fs.stat==='function'){try{const st=await fs.stat(fullPath);return!!st}catch{}}
  if(typeof fs.access==='function'){try{await fs.access(fullPath);return true}catch{}}
  return false
}
export async function statFile(ctx, fullPath){
  const fs=getFs(ctx);if(!fs)return null
  if(typeof fs.resolve==='function'&&typeof fs.stat==='function'){try{const t=await fs.resolve(fullPath);return await fs.stat(t)}catch{return null}}
  if(typeof fs.stat==='function'){try{return await fs.stat(fullPath)}catch{return null}}
  if(typeof fs.lstat==='function'){try{const t=typeof fs.resolve==='function'?await fs.resolve(fullPath):fullPath;return await fs.lstat(t)}catch{return null}}
  return null
}
export async function readFile(ctx, path){
  try{const txt=await readTextFile(ctx,path);return txt}catch(e){const kind=e&&e.kind?e.kind:classifyError(e);return fail(kind,e&&e.message?e.message:String(e))}
}
export default readFile
