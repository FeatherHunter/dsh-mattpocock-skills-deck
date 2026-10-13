// issues-status.js —— 以后改关闭与重开状态流转时改它；字段行改写小工具也住这，补丁文件共用（预估约 150 行）。
//
// effort 维度（2026-09-09）：关票/重开都按 (effort 范围, 编号) 定位，写模式多命中即 conflict，不猜文件。
import { parseMd } from './parse.js'
import { readTextFile } from './read.js'
import { writeTextFile } from './write.js'
import { classifyError } from '../../preflight.js'
import { resolveIssueFile, resolveMapFile } from './issues-locate.js'
import { loadPaintColorMap, applyLabelColors } from './label-colors-paint.js'
// #922：票文件的读—改—写按文件排队（关门/重开也是「读整份、改一行、整份写回」），见 write-queue.js。
import { withFileWriter } from './write-queue.js'

/** 字段行改写：补一行，或把已有的那一行换成新的一行。
 *  两条纪律：① 只动同一行内的空白，绝不跨行；② 找不到这一行才新插一行（插在标题下面）。
 *  为什么要写死第 ① 条（#928）：旧写法是 ^\s*字段\s*[:：]\s*.*$，字段值为空时（文件里写成「Blocked by:」
 *  后面直接跟下一行）\s* 会跨过换行、.*$ 再吃掉下一行 —— 补阻塞边会把紧跟其后的 Labels 行整行删掉，
 *  给票打标签会把 ## Comments 标题整行删掉。这与并发无关，单写者、单次调用就会发生。
 *  所以调用方给的 \s+ / \s* 在这里一律收成同一行内的空白，字段名与值都不许跨行。 */
export function replaceOrInsertField(txt,fieldName,newLine){
  const inline=String(fieldName).replace(/\\s\+/g,'[ \t]+').replace(/\\s\*/g,'[ \t]*')
  const re=new RegExp('^[ \t]*'+inline+'[ \t]*[:：][ \t]*[^\\r\\n]*$','im')
  if(re.test(txt))return txt.replace(re,newLine)
  const lines=txt.split('\n')
  let insertIdx=1
  for(let i=0;i<lines.length;i++){if(/^#+\s+/.test(lines[i])){insertIdx=i+1;break}}
  lines.splice(insertIdx,0,newLine)
  return lines.join('\n')
}
async function setStatus(ctx,repo,key,statusLine){
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
      await writeTextFile(ctx,r.path,txt, ctx && ctx.sandboxPolicy)
      const iss=parseMd(txt,{key:norm,parentKey:isMap?null:'00',isMap,effortId:r.effortId})
      applyLabelColors(iss, colorMap)
      return{ok:true,data:iss}
    }catch(e){const kind=e&&e.kind?e.kind:classifyError(e);return{ok:false,error:{kind,message:e&&e.message?e.message:String(e)}}}
  })
}
export async function closeIssue(ctx,repo,key){
  return setStatus(ctx,repo,key,'Status: resolved')
}
export async function reopenIssue(ctx,repo,key){
  return setStatus(ctx,repo,key,'Status: ready-for-agent')
}
