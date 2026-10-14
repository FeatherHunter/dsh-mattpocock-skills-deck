import { classifyError } from '../../preflight.js'
import { failFromError } from './error-fail.js'
import { ERROR_KIND } from '../../contract/vocabulary.js'
import type { OpContext, SandboxFs } from '../../contract/contexts.js'

// 取沙箱文件服务：platform.fs → ctx.fs → ctx.get('fs') 的顺序是既有约定（index.ts 同款），只加类型。
function getFs(ctx: OpContext): SandboxFs | null {if(ctx&&ctx.platform&&ctx.platform.fs)return ctx.platform.fs;if(ctx&&ctx.fs)return ctx.fs;if(ctx&&typeof ctx.get==='function'){try{const f=ctx.get('fs');if(f)return f}catch{}}return null}
// 挂载判档与原文的错误：kind 是 classifyError 判出的八档之一，cause 留原始错误给上层取原文；只加类型。
type TaggedError = Error & { kind: unknown; cause: unknown }
// 从未知错误值里取一句话：与原来 `e&&e.message?e.message:String(e)` 逐字同义，cast 只为过类型。
function errText(e: unknown): string { return e&&(e as Record<string, unknown>).message?String((e as Record<string, unknown>).message):String(e) }
export async function readTextFile(ctx: OpContext, fullPath: string): Promise<string> {
  const fs=getFs(ctx);if(!fs)throw Object.assign(new Error('fs unavailable'),{kind:ERROR_KIND.ENV})
  if(typeof fs.resolve==='function'&&typeof fs.readText==='function'){try{const t=await fs.resolve(fullPath);const txt=await fs.readText(t);return String(txt??'')}catch(e){const kind=classifyError(e, ctx);const err=new Error(errText(e)) as TaggedError;err.kind=kind;try{err.cause=e}catch{}throw err}}
  if(typeof fs.readFile==='function'){try{const txt=await fs.readFile(fullPath,'utf8');return String(txt??'')}catch(e){const kind=classifyError(e, ctx);const err=new Error(errText(e)) as TaggedError;err.kind=kind;try{err.cause=e}catch{}throw err}}
  if(typeof fs.readText==='function'){try{const txt=await fs.readText(fullPath);return String(txt??'')}catch(e){const kind=classifyError(e, ctx);const err=new Error(errText(e)) as TaggedError;err.kind=kind;try{err.cause=e}catch{}throw err}}
  throw Object.assign(new Error('fs.read not supported'),{kind:ERROR_KIND.ENV})
}
export async function readDir(ctx: OpContext, dirPath: string): Promise<string[]> {
  const fs=getFs(ctx);if(!fs)return[]
  // 下列三路都承诺回文件名串数组（调用方直接拿去拼路径）：沙箱 readdir/listDir 的契约类型是 unknown[]，
  // 运行时里装的是文件名串；cast 只为把这一既有约定写进类型，不改返回的数组本身。
  if(typeof fs.resolve==='function'&&typeof fs.listDir==='function'){try{const t=await fs.resolve(dirPath);const list=await fs.listDir(t);if(Array.isArray(list))return list.map(x=>typeof x==='string'?x:(x&&(x as Record<string, unknown>).name)||String(x)) as string[];return[]}catch{return[]}}
  if(typeof fs.readdir==='function'){try{const list=await fs.readdir(dirPath);return (Array.isArray(list)?list:[]) as string[]}catch{return[]}}
  if(typeof fs.listDir==='function'){try{const list=await fs.listDir(dirPath);return (Array.isArray(list)?list:[]) as string[]}catch{return[]}}
  return[]
}
export async function exists(ctx: OpContext, fullPath: string): Promise<boolean> {
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
export async function statFile(ctx: OpContext, fullPath: string): Promise<unknown> {
  const fs=getFs(ctx);if(!fs)return null
  if(typeof fs.resolve==='function'&&typeof fs.stat==='function'){try{const t=await fs.resolve(fullPath);return await fs.stat(t)}catch{return null}}
  if(typeof fs.stat==='function'){try{return await fs.stat(fullPath)}catch{return null}}
  if(typeof fs.lstat==='function'){try{return await fs.lstat(fullPath)}catch{try{const t=typeof fs.resolve==='function'?await fs.resolve(fullPath):fullPath;return await fs.lstat(t)}catch{return null}}}
  return null
}
export async function readFile(ctx: OpContext, path: string): Promise<string | { ok: false; error: { kind: string; message: string; raw: string } }> {
  // 原文 = 抛上来的那个错误本身。读取这一层已经把原始错误挂在 `cause` 上（见上面三个分支），
  // 所以这里给 `e.cause || e`：`fail()` 按统一口径取 message/stderr/stdout，人据此看实际情况。
  try{const txt=await readTextFile(ctx,path);return txt}catch(e){return failFromError(e, ctx, errText(e))}
}
export default readFile
