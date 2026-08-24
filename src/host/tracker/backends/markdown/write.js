import { classifyError, fail } from '../../preflight.js'
import { ERROR_KIND } from '../../../../shared/tracker/constants.js'
function getFs(ctx){if(ctx&&ctx.platform&&ctx.platform.fs)return ctx.platform.fs;if(ctx&&ctx.fs)return ctx.fs;if(ctx&&typeof ctx.get==='function'){try{const f=ctx.get('fs');if(f)return f}catch{}}return null}
function getPlatformPath(ctx){if(ctx&&ctx.platform&&ctx.platform.path)return ctx.platform.path;if(ctx&&ctx.path)return ctx.path;return null}
export async function ensureDir(ctx, dirPath){
  const fs=getFs(ctx);if(!fs)return
  if(typeof fs.mkdir==='function'){try{await fs.mkdir(dirPath,{recursive:true})}catch{}return}
}
export async function writeTextFile(ctx, fullPath, content){
  const fs=getFs(ctx);const plat=getPlatformPath(ctx);if(!fs)throw Object.assign(new Error('fs unavailable'),{kind:ERROR_KIND.ENV})
  if(plat){try{await ensureDir(ctx,plat.dirname(fullPath))}catch{}}
  if(typeof fs.resolve==='function'&&typeof fs.writeText==='function'){try{const t=await fs.resolve(fullPath);await fs.writeText(t,String(content));return}catch(e){const kind=e&&e.kind?e.kind:classifyError(e);const err=new Error(e&&e.message?e.message:String(e));err.kind=kind;throw err}}
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
