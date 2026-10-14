import { classifyError } from '../../preflight.js'
import { failFromError } from './error-fail.js'
import { ERROR_KIND } from '../../contract/vocabulary.js'
import type { BackendPlatform, OpContext, SandboxFs } from '../../contract/contexts.js'

// 写许可透传上下文：调用方把本次调用的写许可放在 ctx.sandboxPolicy（沙箱政策服务按当前会话算出），
// writeTextFile 原样转交文件服务；契约 OpContext 没有这一格（它是本房写路径的透传约定）。
type WriteOpContext = OpContext & { sandboxPolicy?: unknown }
// 挂载判档与原文的错误：只加类型，运行时仍是同一个 Error 对象。
type TaggedError = Error & { kind: unknown; cause: unknown }
function getFs(ctx: OpContext): SandboxFs | null {if(ctx&&ctx.platform&&ctx.platform.fs)return ctx.platform.fs;if(ctx&&ctx.fs)return ctx.fs;if(ctx&&typeof ctx.get==='function'){try{const f=ctx.get('fs');if(f)return f}catch{}}return null}
function getPlatformPath(ctx: OpContext): BackendPlatform['path'] | null {if(ctx&&ctx.platform&&ctx.platform.path)return ctx.platform.path;if(ctx&&ctx.path)return ctx.path;return null}
export async function ensureDir(ctx: OpContext, dirPath: string): Promise<void> {
  const fs=getFs(ctx);if(!fs)return
  if(typeof fs.mkdir==='function'){try{await fs.mkdir(dirPath,{recursive:true})}catch{}return}
}
/** 写整份文本。
 *  第 4 个参数是「本次调用的政策」（沙箱政策服务按当前会话算出来的那个对象，见 src/host/workspaceCwd.js
 *  的 resolveSandboxPolicy）。它是 DSH 文件服务写方法的第 5 个参数：不传就用部署默认政策，
 *  而部署默认可写根是 DSH 进程所在目录、不是用户工作区，所以往工作区里写必然被拒（研究 #614/#624）。
 *  调用方不传时按原样写（保持既有行为不变）——只有需要往用户工作区写文件的调用方才会传它。
 *  政策里少写 workspaceRoot 时 DSH 会抛一个没有错误码的内部错误，那不是沙箱拒绝，别当权限问题报。 */
function isSandboxDeny(e: unknown): boolean { const f=e as Record<string, unknown> | null | undefined; const m=String((e&&f&&(f.message||f.stderr||f.stdout))||e||''); return /file access denied|workspace-write|read-only mode|FS_SANDBOX_DENIED/i.test(m) }
function sandboxDenyError(e: unknown, hasPolicy: boolean): TaggedError {
  const err=new Error(hasPolicy ? '写不进工作区里的票文件：插件这次带上了本次调用的写许可，但文件服务仍然拒绝了这次写入（可能是会话是只读，或目录本身不可写）。请换一个允许写入的会话，或检查目录权限，然后重试。' : '写不进工作区里的票文件：插件这次没有拿到本次调用的写许可（没有找到归属会话），所以文件服务按默认政策拒绝了这次写入。这不是目录权限问题，改文件权限没有帮助。请换一个允许写入的会话，然后重试。') as TaggedError;
  err.kind=ERROR_KIND.ENV; try{ err.cause=e }catch{}
  return err
}
export async function writeTextFile(ctx: WriteOpContext, fullPath: string, content: string, sandboxPolicy?: unknown): Promise<void> {
  const fs=getFs(ctx);const plat=getPlatformPath(ctx);if(!fs)throw Object.assign(new Error('fs unavailable'),{kind:ERROR_KIND.ENV})
  if(plat){try{await ensureDir(ctx,plat.dirname(fullPath))}catch{}}
  const hasPolicy = !!(sandboxPolicy || (ctx && ctx.sandboxPolicy))
  const policy = (sandboxPolicy !== undefined) ? sandboxPolicy : (ctx && ctx.sandboxPolicy)
  // 下三路的 catch 皆同构：沙箱拒绝走固定话术透出，其余先沿用错误自带的档位、没有才判档；
  // `as Record<string, unknown>` 只为过类型，求值顺序与原表达式逐字相同。
  if(typeof fs.resolve==='function'&&typeof fs.writeText==='function'){try{const t=await fs.resolve(fullPath);await fs.writeText(t,String(content),undefined,undefined,policy);return}catch(e){ if(isSandboxDeny(e)) throw sandboxDenyError(e, hasPolicy); const kind=e&&(e as Record<string, unknown>).kind?(e as Record<string, unknown>).kind:classifyError(e, ctx);const err=new Error(e&&(e as Record<string, unknown>).message?String((e as Record<string, unknown>).message):String(e)) as TaggedError;err.kind=kind;try{err.cause=e}catch{}throw err}}
  if(typeof fs.writeFile==='function'){try{await fs.writeFile(fullPath,String(content),'utf8');return}catch(e){ if(isSandboxDeny(e)) throw sandboxDenyError(e, hasPolicy); const kind=e&&(e as Record<string, unknown>).kind?(e as Record<string, unknown>).kind:classifyError(e, ctx);const err=new Error(e&&(e as Record<string, unknown>).message?String((e as Record<string, unknown>).message):String(e)) as TaggedError;err.kind=kind;try{err.cause=e}catch{}throw err}}
  if(typeof fs.writeText==='function'){try{await fs.writeText(fullPath,String(content));return}catch(e){ if(isSandboxDeny(e)) throw sandboxDenyError(e, hasPolicy); const kind=e&&(e as Record<string, unknown>).kind?(e as Record<string, unknown>).kind:classifyError(e, ctx);const err=new Error(e&&(e as Record<string, unknown>).message?String((e as Record<string, unknown>).message):String(e)) as TaggedError;err.kind=kind;try{err.cause=e}catch{}throw err}}
  throw Object.assign(new Error('fs.write not supported'),{kind:ERROR_KIND.ENV})
}
export async function renameFile(ctx: OpContext, fromPath: string, toPath: string): Promise<void> {
  const fs=getFs(ctx);const plat=getPlatformPath(ctx);if(!fs)throw Object.assign(new Error('fs unavailable'),{kind:ERROR_KIND.ENV})
  if(plat){try{await ensureDir(ctx,plat.dirname(toPath))}catch{}}
  if(typeof fs.rename==='function'){try{await fs.rename(fromPath,toPath);return}catch(e){const kind=classifyError(e, ctx);const err=new Error(e&&(e as Record<string, unknown>).message?String((e as Record<string, unknown>).message):String(e)) as TaggedError;err.kind=kind;try{err.cause=e}catch{}throw err}}
  if(typeof fs.resolve==='function'&&typeof fs.writeText==='function'&&typeof fs.readText==='function'){try{const srcT=await fs.resolve(fromPath);const txt=await fs.readText(srcT);const dstT=await fs.resolve(toPath);await fs.writeText(dstT,String(txt));if(typeof fs.unlink==='function'){try{await fs.unlink(srcT)}catch{}}else if(typeof fs.rm==='function'){try{await fs.rm(fromPath)}catch{}}return}catch(e){const kind=classifyError(e, ctx);const err=new Error(e&&(e as Record<string, unknown>).message?String((e as Record<string, unknown>).message):String(e)) as TaggedError;err.kind=kind;try{err.cause=e}catch{}throw err}}
  throw Object.assign(new Error('fs.rename not supported'),{kind:ERROR_KIND.ENV})
}
export async function writeFile(ctx: WriteOpContext, path: string, content: string): Promise<{ ok: true } | { ok: false; error: { kind: string; message: string; raw: string } }> {
  // 原文 = 抛上来的那个错误本身（写不进去时文件服务到底说了什么，全在这一份里）。
  try{await writeTextFile(ctx,path,content);return{ok:true}}catch(e){return failFromError(e, ctx, e&&(e as Record<string, unknown>).message?String((e as Record<string, unknown>).message):String(e))}
}
export default writeFile
