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
// #1489：原文手写文件也没有 Comments/Answer 骨架（原文模板里只有标题、What to build、Blocked by、Status），
// 整份改写时不能给它补插件骨架 —— 补上去等于每写一次正文就往原文里塞两块原文没有的区。
import { ticketFormOf } from './original-fields.js'
// #1277：票面对象类型标记的判据在共享包里；整份替换正文时盘上的标记要以盘上为准搬回来（ADR 2.5）。
import { countMarkerLines, markerKindOnLine, stripMarkerLines } from '../../../shared/issue-file/src/marker.js'
// #1091：维护者原话区整份替换时要保住（盘上有、递进来的新正文没有时按原位置搬回），
// 位置规则与建票/改票写入共用共享层的那一份实现，这里不另写一套「紧跟目的」的正则。
import { restoreOriginalWordsSection } from '../../../shared/issue-file/src/original-words.js'

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
  // #1486：新布局把字段写成 `**Status:**` 这种加粗形式；两种写法算同一行，整份替换时才不会丢。
  for(const l of lines){ if(/^\s*(?:\*\*)?(Status|Assignees|Type|Blocked\s+by|Labels|Close\s+reason)(?:\*\*)?\s*[:\uFF1A]/i.test(l)) out.push(l.replace(/\s+$/,'')) }
  return out
}
function fieldNameOf(line: string): string{ return String(line).replace(/\*/g,'').split(/[:\uFF1A]/)[0].trim().toLowerCase() }
/** 新布局（#1486）写进文件头的隐藏注释：DSH-FORMAT 以下的插件字段。整份改正文时这些行不在正文里，必须从盘上搬回。
 *  #1480：DSH-TITLE 也在名单里 —— 规格与地图没有可见一级标题，标题只存在这一行；
 *  不搬的话一次「整份改正文」就把标题降级成目录名，改标题时人也就再也改不了自己的标题。 */
const HIDDEN_FIELD_RE=/^[ \t]*<!--[ \t]*(DSH-FORMAT|DSH-TITLE|DSH-STATUS|DSH-PARENT|DSH-ASSIGNEES|DSH-LABELS|DSH-BLOCKED-BY)[ \t]*:/
function hiddenFieldsOf(text: unknown): string[]{
  return String(text||'').split('\n').filter(function(l){ return HIDDEN_FIELD_RE.test(l) }).map(function(l){ return l.replace(/\s+$/,'') })
}
function hiddenFieldNameOf(line: string): string{ const m=HIDDEN_FIELD_RE.exec(String(line)); return m?m[1]:'' }
/** 这一行是不是插件自己的文件头注释：新布局的 DSH-* 与旧布局的幂等锚/父票/建票时间。 */
function isFileHeaderCommentLine(line: unknown): boolean{
  const text=String(line||'')
  if(markerKindOnLine(text)) return true
  return /^[ \t]*<!--[ \t]*(DSH-[A-Z0-9-]+|parentKey|created)[ \t]*:/.test(text)
}
/** 取文本里第一条合法类型标记行（去掉首尾空白）；没有就回空串。整份替换时用它把盘上的标记搬回。 */
function firstMarkerLine(text: unknown): string{
  for(const l of String(text||'').split('\n')){ if(markerKindOnLine(l)) return l.trim() }
  return ''
}
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
  // #1277：对象类型标记与幂等锚同一条纪律 —— 变多、或者盘上有的标记被改丢，都算写坏，
  // 因为标记是「这张票是哪一种对象」的唯一真源（ADR 2.5），丢了规格就降级成普通票。
  // 数的是整行标记（共享包判据），正文里引用一句标记写法不算数。
  if(worse(countMarkerLines(o), countMarkerLines(n))) return '类型标记行变多了'
  if(countMarkerLines(o)>=1&&countMarkerLines(n)===0) return '类型标记丢了'
  // #1489：原文布局的字段行是加粗的（名字前一对星号、冒号后一对星号），计数必须与 parse.ts 同一把尺子；
  // 只数裸写法的话，一张加粗字段被改丢也判不出「写坏了」。
  if(worse(countRe(of, /^\s*(?:\*\*)?Status(?:\*\*)?\s*[:\uFF1A]/gim), countRe(nf, /^\s*(?:\*\*)?Status(?:\*\*)?\s*[:\uFF1A]/gim))) return 'Status 行变多了'
  if(worse(countRe(of, /^\s*(?:\*\*)?Type(?:\*\*)?\s*[:\uFF1A]/gim), countRe(nf, /^\s*(?:\*\*)?Type(?:\*\*)?\s*[:\uFF1A]/gim))) return 'Type 行变多了'
  if(worse(countRe(of, /^\s*(?:\*\*)?Blocked\s+by(?:\*\*)?\s*[:\uFF1A]/gim), countRe(nf, /^\s*(?:\*\*)?Blocked\s+by(?:\*\*)?\s*[:\uFF1A]/gim))) return 'Blocked by 行变多了'
  if(worse(countRe(of, /^\s*(?:\*\*)?Labels(?:\*\*)?\s*[:\uFF1A]/gim), countRe(nf, /^\s*(?:\*\*)?Labels(?:\*\*)?\s*[:\uFF1A]/gim))) return 'Labels 行变多了'
  if(worse(countRe(o, /^##\s*Comments\s*$/gim), countRe(n, /^##\s*Comments\s*$/gim))) return 'Comments 骨架变多了'
  if(worse(countRe(o, /^##\s*Answer\s*$/gim), countRe(n, /^##\s*Answer\s*$/gim))) return 'Answer 骨架变多了'
  if(countRe(o, /^##\s*Comments\s*$/gim)>=1&&countRe(n, /^##\s*Comments\s*$/gim)===0) return 'Comments 骨架丢了'
  if(countRe(o, /^##\s*Answer\s*$/gim)>=1&&countRe(n, /^##\s*Answer\s*$/gim)===0) return 'Answer 骨架丢了'
  // #1091：维护者原话区与 Comments/Answer 同一条纪律 —— 变多算写坏（重复标题），盘上有的被改丢也算写坏。
  // 这一条是「整份替换时到底有没有保住原话」的直接判据：下面的 merge 会搬回，搬不回来时就不许落盘。
  if(worse(countRe(o, /^##\s*维护者原话\s*$/gim), countRe(n, /^##\s*维护者原话\s*$/gim))) return '维护者原话区变多了'
  if(countRe(o, /^##\s*维护者原话\s*$/gim)>=1&&countRe(n, /^##\s*维护者原话\s*$/gim)===0) return '维护者原话区丢了'
  // 认领人那一行（#1174 决策 12）：与 Status 同样按行数核对，翻倍才算坏。
  if(worse(countRe(of, /^\s*(?:\*\*)?Assignees(?:\*\*)?\s*[:\uFF1A]/gim), countRe(nf, /^\s*(?:\*\*)?Assignees(?:\*\*)?\s*[:\uFF1A]/gim))) return 'Assignees 行变多了'
  // 关票原因那一行（#1174 复核 P1-1）：同上。它是 close 之后才出现的一行，改正文时必须按字段保住。
  if(worse(countRe(of, /^\s*(?:\*\*)?Close\s+reason(?:\*\*)?\s*[:\uFF1A]/gim), countRe(nf, /^\s*(?:\*\*)?Close\s+reason(?:\*\*)?\s*[:\uFF1A]/gim))) return 'Close reason 行变多了'
  return ''
}
/** 整份正文合并：锚一律用盘上旧的，缺一级标题用盘上旧标题补回，缺字段行与骨架区从盘上旧文件搬回（字段插在骨架之前）。 */
export function mergeWholeBodyForPatch(incomingRaw: unknown, diskText: unknown): string{
  let incoming=String(incomingRaw||'')
  incoming=stripMarkerLines(incoming)
  // #1486：新布局的文件头按原文顺序写（DSH-FORMAT 在最前），幂等锚不再固定在第一行。
  // 整份改写时如果递进来的正文已经带着锚，就**原地换成盘上那一行**，不再把它搬到最前 ——
  // 否则每改一次正文，文件头顺序都会变，读回来的「进度区以外逐字未动」也跟着判红。
  const newFormat=/<!--\s*DSH-FORMAT\s*:/.test(String(diskText||''))
  const anchorRe=/^[ \t]*<!--[ \t]*DSH-IDEMPOTENCY-KEY:.*?-->[ \t]*$/m
  const diskAnchor=(String(diskText||'').match(anchorRe)||[])[0]
  const incomingAnchor=(incoming.match(anchorRe)||[])[0]
  if(diskAnchor&&incomingAnchor) incoming=incoming.replace(anchorRe,String(diskAnchor).trim())
  else if(diskAnchor){
    incoming=incoming.replace(/^[ \t]*<!--[ \t]*DSH-IDEMPOTENCY-KEY:.*?-->[ \t]*\r?\n?/gim, '')
    incoming=String(diskAnchor).trim()+'\n'+incoming.replace(/^\s*/, '')
  }
  // created 那行（#1174 决策 10）与锚同理：递进来的正文里没有，就把盘上那一行搬回来。
  // 不搬的话，一次「改正文」会让建票时间掉回文件修改时间，翻页顺序也跟着变（决策 11）。
  const diskCreated=(String(diskText||'').match(/^[ \t]*<!--[ \t]*created[ \t]*:.*?-->[ \t]*$/m)||[])[0]
  if(diskCreated&&!/<!--[ \t]*created[ \t]*:/.test(incoming)) incoming=String(diskCreated).trim()+'\n'+incoming
  // #1486：新布局的状态、父票、认领人、标签、阻塞边都在文件头隐藏注释里；整份改正文时递进来的正文没有这些行，
  // 不搬回来就会被一次「改正文」整段抹掉。按字段名去重，只补缺的，原有行一律不动。
  const haveHidden=hiddenFieldsOf(incoming).map(hiddenFieldNameOf)
  const keepHidden=hiddenFieldsOf(diskText).filter(function(l){ return haveHidden.indexOf(hiddenFieldNameOf(l))<0 })
  if(keepHidden.length){
    const lines=incoming.split('\n')
    let at=0
    while(at<lines.length&&isFileHeaderCommentLine(lines[at])) at++
    lines.splice(at,0,...keepHidden)
    incoming=lines.join('\n')
  }
  const h1count=(incoming.match(/^#[ \t]+\S.*/gm)||[]).length
  if(h1count===0){
    const diskH1=(String(diskText||'').match(/^#[ \t]+.*$/m)||[])[0]
    if(diskH1){
      const lines=incoming.split('\n')
      let at=0
      // created 那行（#1174 决策 10）也是文件头注释：漏了它，标题会被插在它前面，
      // 于是「建票时间」掉出文件头、读不回来，创建时间又变回文件修改时间。
      while(at<lines.length&&isFileHeaderCommentLine(lines[at])) at++
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
  // #1486：新布局的正文按原文模板写，模板里没有 Comments/Answer 骨架；别人按原文写的文件也没有。
  // 这里只对老格式文件补骨架 —— 新文件补上去，就等于每次改正文都往原文里多塞两块模板没有的区。
  // #1489：判「新布局」不只看 DSH-FORMAT：原文手写文件（加粗字段行 / 地图子票的 ## Question）同样没有骨架，
  // 它一旦被补上骨架，进度区就被挤到骨架之上，读回核对也会判「进度区以外的正文跟写前对不上」。
  const originalLayout=newFormat||ticketFormOf(String(diskText||''))!=='legacy'
  if(!originalLayout)for(const name of names){
    const hasRe=new RegExp('^##\\s*'+name+'\\s*$', 'm')
    if(!hasRe.test(incoming)){
      const diskSec=sectionOf(diskText, name)
      if(diskSec) incoming=incoming.replace(/\s*$/, '')+'\n\n'+diskSec+'\n'
      else incoming=incoming.replace(/\s*$/, '')+'\n\n## '+name+'\n\n'
    }
  }
  // #1091：维护者原话区不在上面那张名单里，因为它不能像 Comments/Answer 一样补在文末 ——
  // 它必须紧跟「## 目的」（没有目的区就放正文最前），位置规则只有共享层那一份实现。
  // 盘上有、递进来的新正文没有时搬回来（内容原样，一个字不改）；两边都有时不动新正文。
  incoming=restoreOriginalWordsSection(incoming, diskText)
  // #1277：类型标记以盘上为准搬回（ADR 2.5 的「整份替换正文时从盘上搬回」）。插在文件头注释带里：
  // 有幂等锚就紧跟锚（与建票落盘顺序一致），没有锚就插在那几行文件头注释之后、一级标题之前。
  const diskMarker=firstMarkerLine(diskText)
  if(diskMarker&&firstMarkerLine(incoming)===''){
    const lines=incoming.split('\n')
    let at=0
    if(/^[ \t]*<!--[ \t]*DSH-IDEMPOTENCY-KEY:/.test(lines[0]||'')) at=1
    else{ while(at<lines.length&&isFileHeaderCommentLine(lines[at])) at++ }
    lines.splice(at, 0, diskMarker)
    incoming=lines.join('\n')
  }
  return incoming
}

/** #1486：整份正文里的「正文最前」区跑到了标题前时，搬回标题与字段行之后。
 *  实现住在 shared/issue-file，deck 工具那条路用的是同一份；这里只转出去给 issues-patch 用。 */
export { moveLeadingSectionBelowTitle } from '../../../shared/issue-file/src/body-layout.js'

/** 把文件顶的父票注释换成新的值，没有这一行就插一行（#971）。
 *
 *  为什么要单独抽出来：改父在本地后端就是改这一行注释，不动文件位置。
 *  幂等锚那一行（DSH-IDEMPOTENCY-KEY）在最前，父注释紧跟在它后面；
 *  没有锚的文件直接插在最前。解除父子（null）写成明确的 null 字样，
 *  这样以后读回来是“没有父票”，而不会回落到老默认值 00。 */
export function upsertParentComment(text: string, want: unknown): string {
  const line = want === null ? '<!-- parentKey: null -->' : '<!-- parentKey: ' + String(want) + ' -->'
  const raw = String(text || '')
  // 只动文件头的注释：正文里举例写同样的写法不算数（读也只认文件头，这里只换文件头）。
  const { head, rest } = headOf(raw)
  const re = /^[ \t]*<!--[ \t]*parentKey[ \t]*:[ \t]*.*?-->[ \t]*\r?\n?/im
  if (re.test(head)) return head.replace(re, line + '\n') + rest
  const lines = head.split('\n')
  let at = 0
  if (lines.length && /^[ \t]*<!--[ \t]*DSH-IDEMPOTENCY-KEY:/.test(lines[0])) at = 1
  // #1277：类型标记行紧跟在幂等锚之后（建票落盘顺序：锚 → 标记 → 父注释 → created）。
  // 父注释要插在标记之后；不跳过标记的话，补父会把 parentKey 排到标记前面，文件头顺序与建票时不一致。
  while (at < lines.length && markerKindOnLine(lines[at])) at++
  lines.splice(at, 0, line)
  return lines.join('\n') + rest
}
/** 文件头那一截（第一个标题之前）与其余部分：父注释只认这一段，正文里举例写同样的写法不算数。 */
function headOf(raw: string): { head: string; rest: string } {
  const h1 = /^#+\s+/m.exec(raw)
  const headEnd = h1 ? h1.index : raw.split('\n').slice(0, 10).join('\n').length
  return { head: raw.slice(0, headEnd), rest: raw.slice(headEnd) }
}
/** 这份文本里**明写着**父注释没有（有 `<!-- parentKey: ... -->` 那一行才算）。
 *
 *  为什么要分「明写」与「没写」：这一房没写父注释的票读回来落在默认父票（地图 '00'）上，
 *  那是结构给的默认值，不是盘上真记着的一条边。结论线要报「这一趟撤下来几条边」，
 *  就不能把这条默认值算成撤了一条 —— 绝大多数「挂到某张票上」的票本来就没写过父注释（#1060 定下的口径）。 */
export function hasExplicitParentComment(txt: string): boolean {
  // #1489：原文布局的父边写 DSH-PARENT，与旧 parentKey 注释是同一件事的两种写法，都算「盘上明写着」。
  return /^[ \t]*<!--[ \t]*(?:parentKey|DSH-PARENT)[ \t]*:[ \t]*.*?-->/im.test(headOf(String(txt || '')).head)
}
export function normParentKey(v: unknown): string | null {
  if (v === undefined || v === null) return null
  const t = String(v).trim()
  if (!t) return null
  if (/^null$/i.test(t) || /^none$/i.test(t) || t === '-') return null
  if (/^\d+$/.test(t)) return t.padStart(2, '0')
  return t
}
