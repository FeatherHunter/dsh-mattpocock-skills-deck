/**
 * 改票时对「整份正文」的合并与核对：判一份正文算不算整份票文件、把盘上该保住的行搬回新正文、
 * 以及写之前先核对一遍「改完会不会比原来更糟」。
 *
 * 为什么单独一份文件：这几件事全是纯文本函数（不碰盘、不碰 ctx），原先住在 `issues-patch.ts` 里；
 * #1059 给那一路补上「写没写下去」的结论线之后，那份文件的有效行越过了 350 的上限
 * （`tests/verify-file-granularity.ts` 会判红），于是把这几件与「往盘上写」无关的事整块搬到这里。
 * 判断标准只有一条：这里的每个函数都只吃字符串、只吐字符串或布尔，出错了也由调用方转成如实失败。
 */

import { stripFencedCode } from './parse.js'

/** 递进来的正文是不是「一整份票文件」：自带 H1 标题（或幂等锚）。
 *  为什么要分开判：下面的插入分支把正文插在现有 H1 之后，认错了盘上就会留下两个 H1、两份正文。
 *  实测：自带 H1、又不带 Status 行的整份正文走了插入分支，票文件被写坏，调用方却收到 ok。 */
export function looksLikeWholeDocument(body: unknown): boolean{
  const t=String(body||'')
  return /^\s*#\s+\S/m.test(t)||/^\s*<!--\s*DSH-IDEMPOTENCY-KEY:/m.test(t)
}

/** 盘上那份文本里的字段行（Status/Assignees/Type/Blocked by/Labels/Close reason）：整份替换时用来补齐递进来的正文里缺的字段。 */
/** Assignees 也必须算进来（#1174 决策 12）：不算的话，一次「改正文」的整份替换会把认领人那一行整行抹掉。 */
/** Close reason 同理（#1174 复核 P1-1）：关票原因是事后写上去的一行，不进白名单就会被下一次改正文吃掉。 */
export function fieldLinesOf(text: unknown): string[]{
  const out: string[]=[]
  const lines=String(text||'').split('\n')
  for(const l of lines){ if(/^\s*(Status|Assignees|Type|Blocked\s+by|Labels|Close\s+reason)\s*[:\uFF1A]/i.test(l)) out.push(l.replace(/\s+$/,'')) }
  return out
}
function fieldNameOf(line: string): string{ return String(line).split(/[:\uFF1A]/)[0].trim().toLowerCase() }
/** 取票文件里某骨架区整段（标题加内容，到下一个二级标题或文末）：改正文时用来把盘上旧评论搬回新正文。 */
function sectionOf(text: unknown, name: string): string{
  const re=new RegExp('^##\\s*'+name+'\\s*$[\\s\\S]*?(?=^##\\s|$(?![\\s\\S]))', 'im')
  const m=re.exec(String(text||''))
  return m?m[0].replace(/^\s*/, '').replace(/\s*$/, ''):''
}
function countRe(text: unknown, re: RegExp): number{ return (String(text||'').match(re)||[]).length }
/** 写坏了没有的快速核对：新正文相对旧正文不许新增重复、不许弄丢锚与骨架，坏了就返回原因（调用方转成如实失败，不落盘）。
 *  缺字段补上（0 到 1）不算坏，那是在治旧数据的缺；翻倍（超过旧数且超过 1 个）才算坏。 */
export function checkNoWorseForPatch(oldText: string, newText: string): string{
  const o=String(oldText||''), n=String(newText||'')
  // 字段行按「票面」计数（围栏代码块里的举例不算）：与 parse.ts 读字段行是同一把尺子。
  // 不这么分的话，正文里写一段包含 `Close reason: …` 的示例就会被当成「多出来一个字段」而拒绝写入 ——
  // 一条给读者看的样例把人挡住，那是尺子不对，不是人写错了（#1174 复核 P1-3）。
  // 标题、幂等锚、骨架区仍按整份原文计数：那几处读的就是原文，与围栏无关。
  const of=stripFencedCode(o), nf=stripFencedCode(n)
  const worse=function(oldC: number, newC: number): boolean{ return newC>1&&newC>oldC }
  if(worse(countRe(o, /^#[ \t]+\S.*/gm), countRe(n, /^#[ \t]+\S.*/gm))) return '一级标题变多了'
  if(worse(countRe(o, /DSH-IDEMPOTENCY-KEY/g), countRe(n, /DSH-IDEMPOTENCY-KEY/g))) return '幂等锚变多了'
  if(countRe(o, /DSH-IDEMPOTENCY-KEY/g)>=1&&countRe(n, /DSH-IDEMPOTENCY-KEY/g)===0) return '幂等锚丢了'
  if(worse(countRe(of, /^\s*Status\s*[:\uFF1A]/gim), countRe(nf, /^\s*Status\s*[:\uFF1A]/gim))) return 'Status 行变多了'
  if(worse(countRe(of, /^\s*Type\s*[:\uFF1A]/gim), countRe(nf, /^\s*Type\s*[:\uFF1A]/gim))) return 'Type 行变多了'
  if(worse(countRe(of, /^\s*Blocked\s+by\s*[:\uFF1A]/gim), countRe(nf, /^\s*Blocked\s+by\s*[:\uFF1A]/gim))) return 'Blocked by 行变多了'
  if(worse(countRe(of, /^\s*Labels\s*[:\uFF1A]/gim), countRe(nf, /^\s*Labels\s*[:\uFF1A]/gim))) return 'Labels 行变多了'
  if(worse(countRe(o, /^##\s*Comments\s*$/gim), countRe(n, /^##\s*Comments\s*$/gim))) return 'Comments 骨架变多了'
  if(worse(countRe(o, /^##\s*Answer\s*$/gim), countRe(n, /^##\s*Answer\s*$/gim))) return 'Answer 骨架变多了'
  if(countRe(o, /^##\s*Comments\s*$/gim)>=1&&countRe(n, /^##\s*Comments\s*$/gim)===0) return 'Comments 骨架丢了'
  if(countRe(o, /^##\s*Answer\s*$/gim)>=1&&countRe(n, /^##\s*Answer\s*$/gim)===0) return 'Answer 骨架丢了'
  // 认领人那一行（#1174 决策 12）：与 Status 同样按行数核对，翻倍才算坏。
  if(worse(countRe(of, /^\s*Assignees\s*[:\uFF1A]/gim), countRe(nf, /^\s*Assignees\s*[:\uFF1A]/gim))) return 'Assignees 行变多了'
  // 关票原因那一行（#1174 复核 P1-1）：同上。它是 close 之后才出现的一行，改正文时必须按字段保住。
  if(worse(countRe(of, /^\s*Close\s+reason\s*[:\uFF1A]/gim), countRe(nf, /^\s*Close\s+reason\s*[:\uFF1A]/gim))) return 'Close reason 行变多了'
  return ''
}
/** 整份正文合并：锚一律用盘上旧的，缺一级标题用盘上旧标题补回，缺字段行与骨架区从盘上旧文件搬回（字段插在骨架之前）。 */
export function mergeWholeBodyForPatch(incomingRaw: unknown, diskText: unknown): string{
  let incoming=String(incomingRaw||'')
  incoming=incoming.replace(/^[ \t]*<!--[ \t]*DSH-IDEMPOTENCY-KEY:.*?-->[ \t]*\r?\n?/gim, '')
  const diskAnchor=(String(diskText||'').match(/^[ \t]*<!--[ \t]*DSH-IDEMPOTENCY-KEY:.*?-->[ \t]*$/m)||[])[0]
  if(diskAnchor) incoming=String(diskAnchor).trim()+'\n'+incoming.replace(/^\s*/, '')
  // created 那行（#1174 决策 10）与锚同理：递进来的正文里没有，就把盘上那一行搬回来。
  // 不搬的话，一次「改正文」会让建票时间掉回文件修改时间，翻页顺序也跟着变（决策 11）。
  const diskCreated=(String(diskText||'').match(/^[ \t]*<!--[ \t]*created[ \t]*:.*?-->[ \t]*$/m)||[])[0]
  if(diskCreated&&!/<!--[ \t]*created[ \t]*:/.test(incoming)) incoming=String(diskCreated).trim()+'\n'+incoming
  const h1count=(incoming.match(/^#[ \t]+\S.*/gm)||[]).length
  if(h1count===0){
    const diskH1=(String(diskText||'').match(/^#[ \t]+.*$/m)||[])[0]
    if(diskH1){
      const lines=incoming.split('\n')
      let at=0
      // created 那行（#1174 决策 10）也是文件头注释：漏了它，标题会被插在它前面，
      // 于是「建票时间」掉出文件头、读不回来，创建时间又变回文件修改时间。
      while(at<lines.length&&/^[ \t]*<!--[ \t]*(DSH-IDEMPOTENCY-KEY|parentKey|created)[ \t]*:/.test(lines[at])) at++
      lines.splice(at, 0, String(diskH1).trim(), '')
      incoming=lines.join('\n')
    }
  }else if(h1count>1){
    let first=true
    incoming=incoming.replace(/^#[ \t]+.*$/gm, function(m){ if(first){ first=false; return m } return '' })
  }
  const have=fieldLinesOf(incoming).map(fieldNameOf)
  const keep=fieldLinesOf(diskText).filter(function(l){ return have.indexOf(fieldNameOf(l))<0 })
  if(keep.length){
    const skelIdx=incoming.search(/^##\s*(Comments|Answer)\s*$/m)
    if(skelIdx>=0) incoming=incoming.slice(0, skelIdx).replace(/\s*$/, '')+'\n\n'+keep.join('\n')+'\n\n'+incoming.slice(skelIdx).replace(/^\s*/, '')
    else incoming=incoming.replace(/\s*$/, '')+'\n\n'+keep.join('\n')+'\n'
  }
  const names=['Comments', 'Answer']
  for(const name of names){
    const hasRe=new RegExp('^##\\s*'+name+'\\s*$', 'm')
    if(!hasRe.test(incoming)){
      const diskSec=sectionOf(diskText, name)
      if(diskSec) incoming=incoming.replace(/\s*$/, '')+'\n\n'+diskSec+'\n'
      else incoming=incoming.replace(/\s*$/, '')+'\n\n## '+name+'\n\n'
    }
  }
  return incoming
}
