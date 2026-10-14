import { classifyError } from '../../kernel/preflight.js'
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
/**
 * 列一个目录的结果，分三种。**这是本房唯一一处「列目录」的口径。**
 *
 * 为什么不是「回一个数组」：数组把「没读成」与「本来就没有」压成了同一个值（空表）。下游于是把
 * 读盘失败读成「这里本来没有票」，长出来的全是谎话——建票前的回查找不到锚就照常再建一张
 * （重复建票）、计数回三个 0、翻页回一页假的空白。这三件事在 #1174 里就是最重的四条，
 * 根因都是这一个值被合并。所以这里把两件事在**类型上**分开：
 * 拿到 `{ok:false, missing:false}` 的调用方必须如实失败，不许当空表用。
 *
 * 三种各自的意思：
 *  - `{ok:true, names}`     —— 列出来了，names 可能是空数组（目录在，里面没东西）；
 *  - `{ok:false, missing:true}`  —— 这个目录本来就**不存在**。全新工作区还没有 `.scratch/issues`
 *    目录是正常状态，调用方按空表处理即可，不算故障；
 *  - `{ok:false, missing:false, error}` —— 目录在、或者说不清在不在，总之**没读成**。这一种
 *    任何调用方都不许当空表，必须如实失败（档位与原文都在 error 上）。
 */
export type DirListing =
  | { ok: true; names: string[] }
  | { ok: false; missing: true }
  | { ok: false; missing: false; error: TaggedError }

/** 把一个原始错误包成带规范档位的错误：与 readTextFile 三条支路同一套做法（kind 让人判档、cause 留原文）。 */
function tagError(e: unknown, kind: unknown): TaggedError {
  const err=new Error(errText(e)) as TaggedError
  err.kind=kind
  try{err.cause=e}catch{}
  return err
}
/** 沙箱 listDir / readdir 的契约类型是 unknown[]，运行时里装的是文件名串；统一成名字串（既有约定，不改值）。
 *  三种形状按原样认：串（就是名字）、带 name 的对象（取 name）、别的（String 一下）。 */
function nameOfEntry(x: unknown): string {
  if(typeof x==='string') return x
  const name=x&&typeof x==='object'?(x as Record<string, unknown>).name:undefined
  return typeof name==='string'&&name?name:String(x)
}

/**
 * 列目录失败时，这一次究竟算「这个目录本来就不存在」还是「没读成」。
 *
 * 判断顺序是固定的，**先问盘、再问错误码**：
 *   1. 错误码明说「不给看」（`EACCES` / `EPERM`）→ 一律算「没读成」。权限问题最容易伪装成「没有」。
 *   2. `exists()` 说这个路径在 → 一律算「没读成」。目录明明在、却列不出来，那是权限或故障，绝不能当空。
 *   3. 错误码是 `ENOENT` / `ENOTDIR`，或者盘上确实问得出「不在」→ 算「本来就不存在」。
 *   4. 再不行才退回跟踪器层那张规则表（沙箱可能把错误包装过一层），判出来是 `NOTFOUND` 才算不存在。
 *
 * 为什么先问盘：错误码换个沙箱实现就可能换一种说法，单靠它判会悄悄失效 —— 仓库里有过先例
 * （`src/host/tracker/predicatePrimitives.js` 记着 #284：「.scratch 明明是目录却报 not found」）。
 * #1174 复核 P1-4 抓到过这里代码与注释相反：注释写着「exists() 优先」，代码却先按错误码返回了，
 * 于是真实存在、但读不出来的目录会被贴上「本来就不存在」的标签。
 */
async function treatListingFailureAsMissing(ctx: OpContext, dirPath: string, e: unknown): Promise<boolean> {
  const codeOf=function(x: unknown): string{ return x&&typeof x==='object'?String((x as Record<string, unknown>).code||''):'' }
  const codes=[codeOf(e), codeOf(e&&(e as {cause?: unknown}).cause)]
  if(codes.indexOf('EACCES')>=0||codes.indexOf('EPERM')>=0) return false
  let present: boolean|null=null
  try{ present=(await exists(ctx,dirPath))?true:false }catch{ present=null }
  if(present===true) return false
  if(codes.indexOf('ENOENT')>=0||codes.indexOf('ENOTDIR')>=0) return true
  if(present===false) return true
  try{ return classifyError(e, ctx)===ERROR_KIND.NOTFOUND }catch{ return false }
}

/**
 * 列目录（本房唯一实现）：按 `resolve + listDir` → `readdir` → `listDir` 三路依次尝试，
 * 谁先成功用谁；三路都失败再判「本来就不存在」还是「没读成」，如实回报三种结果之一。
 * 取不到文件服务时算「没读成」——那不是「这个目录是空的」，而是根本没法看。
 */
export async function listDir(ctx: OpContext, dirPath: string): Promise<DirListing> {
  const fs=getFs(ctx)
  if(!fs) return { ok:false, missing:false, error:tagError(new Error('fs unavailable'), ERROR_KIND.ENV) }
  const attempts: Array<() => Promise<unknown>>=[]
  // 先取出可用的那几个方法再来回调用：`fs.resolve` 这类可选成员在闭包里不再保持「刚才 typeof 过」的收窄，
  // 直接写进箭头函数会报「可能是 undefined」。绑定 this 之后行为与原来 `fs.resolve(...)` 完全一样。
  const resolveFn = typeof fs.resolve === 'function' ? fs.resolve.bind(fs) : null
  const listDirFn = typeof fs.listDir === 'function' ? fs.listDir.bind(fs) : null
  const readdirFn = typeof fs.readdir === 'function' ? fs.readdir.bind(fs) : null
  if(resolveFn&&listDirFn) attempts.push(async()=>await listDirFn(await resolveFn(dirPath)))
  if(readdirFn) attempts.push(async()=>await readdirFn(dirPath))
  if(listDirFn) attempts.push(async()=>await listDirFn(dirPath))
  if(!attempts.length) return { ok:false, missing:false, error:tagError(new Error('fs.list not supported'), ERROR_KIND.ENV) }
  let last: unknown=null
  for(const run of attempts){
    try{ const list=await run(); return { ok:true, names:(Array.isArray(list)?list:[]).map(nameOfEntry) } }
    catch(e){ last=e }
  }
  if(await treatListingFailureAsMissing(ctx,dirPath,last)) return { ok:false, missing:true }
  return { ok:false, missing:false, error:tagError(last, classifyError(last, ctx)) }
}

/**
 * 列一个「可能有、也可能还没有」的目录的名字：**只要没列成，一律当空表**（老口径，保留）。
 *
 * 什么时候用它：调用方只想列出名字，而「这个目录现在没有」确实是正常状态，而且**它不打算为
 * 「没读成」单独交代**（例如全新工作区还没有 `issues/` 目录、按编号找票时逐个工作单元去试）。
 * 什么时候别用它：调用方必须分清「读不成」——那就直接用 `listDir`，按 `missing` 分两种处理
 * （建票回查、计数、翻页这三处就是这种，它们必须如实失败：读不动就不能当「这里没有票」）。
 *
 * 为什么这里不抛错（#1174 实现时改过一次、又改回来）：这一条是**读路径上的宽松口**，用它的人
 * 有十几处，都不接异常。让它在 fs 拿不到时抛「fs unavailable」，等于把宽松口变成硬失败，
 * 第一次跑就撞了契约测试台的 labels 段。要严格就用 listDir，两条 API 各管一种意图，别混。
 */
export async function listDirOrMissingIsEmpty(ctx: OpContext, dirPath: string): Promise<string[]> {
  const r=await listDir(ctx,dirPath)
  return r.ok ? r.names : []
}
/**
 * 列一个目录，**只有「这个目录本来就不存在」才当空表，其余没读成的一律抛出**。
 *
 * 这是「我必须数清楚」的那些调用方要用的口：建票回查找锚、取下一个编号、票目录汇总（计数与翻页）、
 * 反向聚合看谁在等这张票、配色文件读不出来时判「取不全」……它们共同的处境是——**少看见一张票
 * 就会给出一个错的答案**（重复建票、撞号、少算、少列、假装没有配色），而错的答案长得和正确答案一样。
 *
 * 与隔壁 `listDirOrMissingIsEmpty` 的分工要记牢：那一条是读路径上的宽松口，用在「这里没有确实是
 * 正常状态、而且调用方不为『没读成』单独交代」的地方；两条 API 各管一种意图，别互相顶替。
 * 抛出的是 `listDir` 挂在 `{ok:false,missing:false}` 上的那个错误（带 kind 与原始 cause），
 * 调用方用 try/catch 转成自己那一层的失败形状即可。
 */
export async function listDirOrThrow(ctx: OpContext, dirPath: string): Promise<string[]> {
  const r=await listDir(ctx,dirPath)
  if(r.ok) return r.names
  if(r.missing) return []
  throw r.error
}
/** 这次调用有没有文件服务（platform.fs → ctx.fs → ctx.get('fs') 那三处任一）。
 *
 *  给那些「没有文件服务时另有答案」的调用方用：本地 Markdown 房在#618 定过一条约定——
 *  没有文件服务时照内置调色盘回答（界面刚起来、沙箱还没接上的那一瞬间就靠它）。
 *  所以「压根没有文件服务」与「有文件服务、但读不出来」是两回事：前者按内置答案走，
 *  后者才是取不全、必须整体失败。这个判断放在 `read.ts` 一处，免得各调用方各写一份。 */
export function hasFs(ctx: OpContext): boolean {
  return !!getFs(ctx)
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
