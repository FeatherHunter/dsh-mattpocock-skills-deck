// issues-status.js —— 以后改关闭与重开状态流转时改它；字段行改写小工具也住这，补丁文件共用（预估约 150 行）。
//
// effort 维度（2026-09-09）：关票/重开都按 (effort 范围, 编号) 定位，写模式多命中即 conflict，不猜文件。
import { parseMd } from './parse.js'
import { readTextFile } from './read.js'
import { publishTextFile } from './write.js'
// #1059：这一趟写没写下去的结论线（事件 `issue.write`，与 GitHub 房同一个名字、同一套字段；GitLab 房的写路径还没做）。
import { beginWriteTrail, emitIssueWrite, noteFileWritten } from './write-log.js'
import type { WriteTrail } from './write-log.js'
import { failFromError } from './error-fail.js'
import { resolveIssueFile, resolveMapFile, resolveSpecFile } from './issues-locate.js'
import { loadPaintColorMap, applyLabelColors } from './label-colors-paint.js'
import type { OpContext } from '../../contract/contexts.js'
import type { RepositoryRef, Issue } from '../../contract/entities.js'
import type { CloseOpts } from '../../contract/inputs.js'
// #922：票文件的读—改—写按文件排队（关门/重开也是「读整份、改一行、整份写回」），见 write-queue.js。
import { withFileWriter } from './write-queue.js'

// 仓库引用：path 是本地后端的自有约定（契约不保证），有就多认那个目录（path.ts 的同款，房间里各备一份）。
// mdScene：feature 场景的 00 号是 spec.md，不是 map.md（#1486）。
type RepoWithPath = RepositoryRef & { path?: string; mdScene?: string }

// 本文件交出去的失败形状：与 failAs 落的三段式一致（成功侧各函数自带）。
interface StatusFailure {
  ok: false
  error: { kind: string; message: string; raw: string }
}

/** 字段行改写：补一行，或把已有的那一行换成新的一行。
 *  三条纪律：① 只动同一行内的空白，绝不跨行；② 找不到这一行才新插一行；
 *  ③ **新行插在「标题下面那一段字段行」的末尾**，不紧贴标题。
 *  为什么要写死第 ① 条（#928）：旧写法是 ^\s*字段\s*[:：]\s*.*$，字段值为空时（文件里写成「Blocked by:」
 *  后面直接跟下一行）\s* 会跨过换行、.*$ 再吃掉下一行 —— 补阻塞边会把紧跟其后的 Labels 行整行删掉，
 *  给票打标签会把 ## Comments 标题整行删掉。这与并发无关，单写者、单次调用就会发生。
 *  所以调用方给的 \s+ / \s* 在这里一律收成同一行内的空白，字段名与值都不许跨行。
 *  为什么要写死第 ③ 条（#1174 复核 P1-1 实测）：字段行后面才是正文，改写正文时是按「标题到第一个字段行
 *  之间都算正文」重建的 —— 新行插在标题正下面，就等于插进了正文区，下一次改正文会把它整行丢掉。
 *  这条是关票原因踩出来的（关完票再改一次正文，原因就退回默认的 completed），但凡是后补的字段行都有这个毛病。 */
export function replaceOrInsertField(txt: string,fieldName: string,newLine: string): string{
  const inline=String(fieldName).replace(/\\s\+/g,'[ \t]+').replace(/\\s\*/g,'[ \t]*')
  const re=new RegExp('^[ \t]*'+inline+'[ \t]*[:：][ \t]*[^\\r\\n]*$','im')
  if(re.test(txt))return txt.replace(re,newLine)
  const lines=txt.split('\n')
  let h1Idx=-1
  for(let i=0;i<lines.length;i++){if(/^#+\s+/.test(lines[i])){h1Idx=i;break}}
  const insertIdx=h1Idx<0?0:h1Idx+1
  // 字段块在哪：本房的票文件布局是「标题 → 正文 → 字段行 → 骨架区」，字段行并不紧挨着标题。
  // 新行要接在**最后一条字段行**后面，才算长在字段块里；插在标题下面等于插进了正文区，
  // 下一次改写正文时会按「标题到第一条字段行之间都算正文」重建，把它整行丢掉
  // （#1174 复核 P1-1 实测：关票原因就是这么没的）。认哪些名字与 issues-patch.ts 的字段白名单同一套。
  const isFieldLine=function(l: string): boolean{ return /^[ \t]*(Status|Assignees|Type|Blocked\s+by|Labels|Close\s+reason)[ \t]*[:：]/i.test(l) }
  let lastField=-1
  for(let i=0;i<lines.length;i++){ if(isFieldLine(lines[i])) lastField=i }
  lines.splice(lastField>=0?lastField+1:insertIdx,0,newLine)
  return lines.join('\n')
}
/** 改状态，可选再补一行（关票原因走这条）。
 *
 *  `extraLine` 为什么单独开一行、而不是拼进状态那一行：状态那一行的取值是「这张票现在是什么状态」，
 *  全房都按它判开还是关（`parse.ts` 认 `resolved` 就记成已关闭），把原因拼进去，
 *  每一个读它的人都得先拆一遍字符串才能判断状态。 */
async function setStatus(ctx: OpContext,repo: RepoWithPath | null,key: string,statusLine: string,extraLine?: string,trail?: WriteTrail): Promise<{ok:true;data:Issue}|StatusFailure>{
  const norm=String(key).padStart(2,'0')
  const colorMap=await loadPaintColorMap(ctx)
  const isSpec=norm==='00' && !!repo && String((repo as RepoWithPath).mdScene||'')==='feature'
  const isMap=norm==='00' && !isSpec
  const r=isSpec
    ? await resolveSpecFile(ctx,repo,{mode:'write'})
    : (isMap
      ? await resolveMapFile(ctx,repo,{mode:'write'})
      : await resolveIssueFile(ctx,repo,norm,{mode:'write'}))
  if(!r.ok)return{ok:false,error:r.error}
  // 关门/重开同样是「读整份 → 改一行 → 整份写回」，所以要排在该文件的单写者队列里（#922）：
  // 不排队的话，同一张票上一次改状态与一次改标签并发时，后写的那次会把前一次的改动整份抹掉。
  return withFileWriter(ctx,repo,r.path,async function(){
    try{
      const before=await readTextFile(ctx,r.path)
      let txt: string
      if(isSpec){
        // 规格文件的状态只写在文件头那行隐藏注释里（YAML 的 DSH-STATUS）：正文模板没有可见的 Status 行，
        // 往正文里塞一行会破坏原文形状，下一次按模板读回就对不上了。
        const value=/resolved|closed/i.test(statusLine)?'closed':(/ready-for-agent|open/i.test(statusLine)?'ready-for-agent':'open')
        const line='<!-- DSH-STATUS: '+value+' -->'
        const re=/^[ \t]*<!--[ \t]*DSH-STATUS[ \t]*:[ \t]*.*?-->/im
        if(re.test(before)){
          txt=before.replace(re,line)
        }else{
          // 老规格或人工删过状态行：补在最后一行隐藏注释后面，仍然在第一个一级标题之前。
          const lines=before.split('\n')
          let at=0
          for(let i=0;i<lines.length;i++){ if(/^[ \t]*<!--[ \t]*DSH-/.test(lines[i])) at=i+1 }
          lines.splice(at,0,line)
          txt=lines.join('\n')
        }
      }else{
        txt=replaceOrInsertField(before,'Status',statusLine)
        if(extraLine)txt=replaceOrInsertField(txt,'Close\\s+reason',extraLine)
      }
      // 一处没改就不写盘（#1059）：关一张已经关着的票、重开一张本来就开着的票，改出来的整份文本与盘上
      // 一字不差 —— 照旧写回去只会换掉文件的修改时间（本地房的创建时间对老票就回落在这上面，翻页顺序会跟着动），
      // 而这一趟在结论线上必须是 noop 而不是 edited。与 issues-patch.ts 的读—改—写是同一条口径。
      if(txt!==before){
        // #1182：这一份走原子发布（同目录临时文件 + 改名；没有改名原语时退回整份直写），与同房另几条写票路同口径。
        await publishTextFile(ctx,r.path,txt, ctx&&(ctx as {sandboxPolicy?: unknown}).sandboxPolicy)
        noteFileWritten(trail)
      }
      const iss=parseMd(txt,{key:norm,parentKey:isSpec?null:(isMap?null:'00'),isMap,kind:isSpec?'spec':undefined,effortId:r.effortId,url:r.path})
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
  const t0=Date.now()
  const trail=beginWriteTrail()
  const r=await setStatus(ctx,repo,key,'Status: resolved',reason?'Close reason: '+reason:undefined,trail)
  emitIssueWrite(ctx,'close',trail,r,t0)
  return r
}
export async function reopenIssue(ctx: OpContext,repo: RepoWithPath | null,key: string): Promise<{ok:true;data:Issue}|StatusFailure>{
  const t0=Date.now()
  const trail=beginWriteTrail()
  const r=await setStatus(ctx,repo,key,'Status: ready-for-agent',undefined,trail)
  emitIssueWrite(ctx,'reopen',trail,r,t0)
  return r
}
