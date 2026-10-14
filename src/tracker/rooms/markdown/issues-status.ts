// issues-status.js —— 以后改关闭与重开状态流转时改它；字段行改写小工具也住这，补丁文件共用（预估约 150 行）。
//
// effort 维度（2026-09-09）：关票/重开都按 (effort 范围, 编号) 定位，写模式多命中即 conflict，不猜文件。
import { parseMd } from './parse.js'
import { readTextFile } from './read.js'
import { writeTextFile } from './write.js'
import { failFromError } from './error-fail.js'
import { resolveIssueFile, resolveMapFile } from './issues-locate.js'
import { loadPaintColorMap, applyLabelColors } from './label-colors-paint.js'
import type { OpContext } from '../../contract/contexts.js'
import type { RepositoryRef, Issue } from '../../contract/entities.js'
import type { CloseOpts } from '../../contract/inputs.js'
// #922：票文件的读—改—写按文件排队（关门/重开也是「读整份、改一行、整份写回」），见 write-queue.js。
import { withFileWriter } from './write-queue.js'

// 仓库引用：path 是本地后端的自有约定（契约不保证），有就多认那个目录（path.ts 的同款，房间里各备一份）。
type RepoWithPath = RepositoryRef & { path?: string }

// 本文件交出去的失败形状：与 failAs 落的三段式一致（成功侧各函数自带）。
interface StatusFailure {
  ok: false
  error: { kind: string; message: string; raw: string }
}

/** 字段行改写：补一行，或把已有的那一行换成新的一行。
 *  两条纪律：① 只动同一行内的空白，绝不跨行；② 找不到这一行才新插一行（插在标题下面）。
 *  为什么要写死第 ① 条（#928）：旧写法是 ^\s*字段\s*[:：]\s*.*$，字段值为空时（文件里写成「Blocked by:」
 *  后面直接跟下一行）\s* 会跨过换行、.*$ 再吃掉下一行 —— 补阻塞边会把紧跟其后的 Labels 行整行删掉，
 *  给票打标签会把 ## Comments 标题整行删掉。这与并发无关，单写者、单次调用就会发生。
 *  所以调用方给的 \s+ / \s* 在这里一律收成同一行内的空白，字段名与值都不许跨行。 */
export function replaceOrInsertField(txt: string,fieldName: string,newLine: string): string{
  const inline=String(fieldName).replace(/\\s\+/g,'[ \t]+').replace(/\\s\*/g,'[ \t]*')
  const re=new RegExp('^[ \t]*'+inline+'[ \t]*[:：][ \t]*[^\\r\\n]*$','im')
  if(re.test(txt))return txt.replace(re,newLine)
  const lines=txt.split('\n')
  let insertIdx=1
  for(let i=0;i<lines.length;i++){if(/^#+\s+/.test(lines[i])){insertIdx=i+1;break}}
  lines.splice(insertIdx,0,newLine)
  return lines.join('\n')
}
/** 改状态，可选再补一行（关票原因走这条）。
 *
 *  `extraLine` 为什么单独开一行、而不是拼进状态那一行：状态那一行的取值是「这张票现在是什么状态」，
 *  全房都按它判开还是关（`parse.ts` 认 `resolved` 就记成已关闭），把原因拼进去，
 *  每一个读它的人都得先拆一遍字符串才能判断状态。 */
async function setStatus(ctx: OpContext,repo: RepoWithPath | null,key: string,statusLine: string,extraLine?: string): Promise<{ok:true;data:Issue}|StatusFailure>{
  const norm=String(key).padStart(2,'0')
  const colorMap=await loadPaintColorMap(ctx)
  const isMap=norm==='00'
  const r=isMap
    ? await resolveMapFile(ctx,repo,{mode:'write'})
    : await resolveIssueFile(ctx,repo,norm,{mode:'write'})
  if(!r.ok)return{ok:false,error:r.error}
  // 关门/重开同样是「读整份 → 改一行 → 整份写回」，所以要排在该文件的单写者队列里（#922）：
  // 不排队的话，同一张票上一次改状态与一次改标签并发时，后写的那次会把前一次的改动整份抹掉。
  return withFileWriter(ctx,repo,r.path,async function(){
    try{
      let txt=await readTextFile(ctx,r.path)
      txt=replaceOrInsertField(txt,'Status',statusLine)
      if(extraLine)txt=replaceOrInsertField(txt,'Close\\s+reason',extraLine)
      await writeTextFile(ctx,r.path,txt, ctx&&(ctx as {sandboxPolicy?: unknown}).sandboxPolicy)
      const iss=parseMd(txt,{key:norm,parentKey:isMap?null:'00',isMap,effortId:r.effortId,url:r.path})
      applyLabelColors(iss, colorMap)
      return{ok:true,data:iss}
    }catch(e){return failFromError(e,ctx,'改这张票的状态时出错')}
  })
}
export async function closeIssue(ctx: OpContext,repo: RepoWithPath | null,key: string,opts?: CloseOpts): Promise<{ok:true;data:Issue}|StatusFailure>{
  // 调用方给了原因就原样记下来（契约说这是开放字符串，不在这里分支：插件只认得 completed 与 duplicate，
  // GitHub 那边还会有 not_planned，照原样展示即可）；没给就一个字节都不写这一行，
  // 读回来按后端默认 `completed` —— 也就是这次改动之前的老行为，一字不变。
  const reason=opts&&typeof opts.reason==='string'?opts.reason.trim():''
  return setStatus(ctx,repo,key,'Status: resolved',reason?'Close reason: '+reason:undefined)
}
export async function reopenIssue(ctx: OpContext,repo: RepoWithPath | null,key: string): Promise<{ok:true;data:Issue}|StatusFailure>{
  return setStatus(ctx,repo,key,'Status: ready-for-agent')
}
