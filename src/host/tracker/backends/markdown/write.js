import { classifyError, fail } from '../../preflight.js'
import { ERROR_KIND } from '../../../../shared/tracker/constants.js'
function getFs(ctx){if(ctx&&ctx.platform&&ctx.platform.fs)return ctx.platform.fs;if(ctx&&ctx.fs)return ctx.fs;if(ctx&&typeof ctx.get==='function'){try{const f=ctx.get('fs');if(f)return f}catch{}}return null}
function getPlatformPath(ctx){if(ctx&&ctx.platform&&ctx.platform.path)return ctx.platform.path;if(ctx&&ctx.path)return ctx.path;return null}
export async function ensureDir(ctx, dirPath){
  const fs=getFs(ctx);if(!fs)return
  if(typeof fs.mkdir==='function'){try{await fs.mkdir(dirPath,{recursive:true})}catch{}return}
}
/** 写整份文本。
 *  第 4 个参数是「本次调用的政策」（沙箱政策服务按当前会话算出来的那个对象，见 src/host/workspaceCwd.js
 *  的 resolveSandboxPolicy）。它是 DSH 文件服务写方法的第 5 个参数：不传就用部署默认政策，
 *  而部署默认可写根是 DSH 进程所在目录、不是用户工作区，所以往工作区里写必然被拒（研究 #614/#624）。
 *  调用方不传时按原样写（保持既有行为不变）——只有需要往用户工作区写文件的调用方才会传它。
 *  政策里少写 workspaceRoot 时 DSH 会抛一个没有错误码的内部错误，那不是沙箱拒绝，别当权限问题报。 */
export async function writeTextFile(ctx, fullPath, content, sandboxPolicy){
  const fs=getFs(ctx);const plat=getPlatformPath(ctx);if(!fs)throw Object.assign(new Error('fs unavailable'),{kind:ERROR_KIND.ENV})
  if(plat){try{await ensureDir(ctx,plat.dirname(fullPath))}catch{}}
  if(typeof fs.resolve==='function'&&typeof fs.writeText==='function'){try{const t=await fs.resolve(fullPath);await fs.writeText(t,String(content),undefined,undefined,sandboxPolicy);return}catch(e){const kind=e&&e.kind?e.kind:classifyError(e);const err=new Error(e&&e.message?e.message:String(e));err.kind=kind;throw err}}
  if(typeof fs.writeFile==='function'){try{await fs.writeFile(fullPath,String(content),'utf8');return}catch(e){const kind=classifyError(e);const err=new Error(e&&e.message?e.message:String(e));err.kind=kind;throw err}}
  if(typeof fs.writeText==='function'){try{await fs.writeText(fullPath,String(content));return}catch(e){const kind=classifyError(e);const err=new Error(e&&e.message?e.message:String(e));err.kind=kind;throw err}}
  throw Object.assign(new Error('fs.write not supported'),{kind:ERROR_KIND.ENV})
}
export async function renameFile(ctx, fromPath, toPath){
  const fs=getFs(ctx);const plat=getPlatformPath(ctx);if(!fs)throw Object.assign(new Error('fs unavailable'),{kind:ERROR_KIND.ENV})
  if(plat){try{await ensureDir(ctx,plat.dirname(toPath))}catch{}}
  if(typeof fs.rename==='function'){try{await fs.rename(fromPath,toPath);return}catch(e){const kind=classifyError(e);const err=new Error(e&&e.message?e.message:String(e));err.kind=kind;throw err}}
  if(typeof fs.resolve==='function'&&typeof fs.writeText==='function'&&typeof fs.readText==='function'){try{const srcT=await fs.resolve(fromPath);const txt=await fs.readText(srcT);const dstT=await fs.resolve(toPath);await fs.writeText(dstT,String(txt));if(typeof fs.unlink==='function'){try{await fs.unlink(srcT)}catch{}}else if(typeof fs.rm==='function'){try{await fs.rm(fromPath)}catch{}}return}catch(e){const kind=classifyError(e);const err=new Error(e&&e.message?e.message:String(e));err.kind=kind;throw err}}
  throw Object.assign(new Error('fs.rename not supported'),{kind:ERROR_KIND.ENV})
}
export async function writeFile(ctx, path, content){
  try{await writeTextFile(ctx,path,content);return{ok:true}}catch(e){const kind=e&&e.kind?e.kind:classifyError(e);return fail(kind,e&&e.message?e.message:String(e))}
}
export default writeFile
