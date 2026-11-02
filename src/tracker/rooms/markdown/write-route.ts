/** 按「票所在目录的路线」决定可见字段写到文件哪里。
 *
 * 为什么单独一个文件：`.scratch/<目录>` 的形状决定一张票是地图子票、实施票还是普通票（#1788），
 * 而写父票、写阻塞边这两件事都要先认路线再挑字段样式（加粗行 / 裸行）。放在这里，
 * 让 issues-patch.ts 只负责「读—改—写」的流程，路线相关的取舍集中一处。
 *
 * 两条约定：
 *  · route 是空串表示这张票不在任何工作单元里，只可能是旧扁平布局；旧布局的写已在定位那一步拦下，
 *    这里的旧布局分支只为保住既有文件形状，不再新增入口。
 *  · 加粗行与裸行同时存在时，按票种类挑一种写，绝不同时写两份 —— 否则同一份文件里会出现两条
 *    互相矛盾的记录，读回来是哪一个全看解析顺序。
 *
 * 术语区分：本文件的「路线」指票所在目录的形状（map / spec / plain / 旧扁平），与 GLOSSARY.md 里
 * 讲「哪些会话在处理哪些票」的「工作路线」不是一回事；也与 write-log.ts 的 WriteRoute（这一趟写没写盘）无关。
 */
import { replaceOrInsertField } from './issues-status.js'
import type { TicketRoute } from './issues-locate.js'
import { fieldStyleOf, removeBareField, replaceBareField, replaceBoldField, ticketFormOf, upsertHiddenComment } from './original-fields.js'
import { upsertParentComment } from './patch-body.js'
/** 父票这条边落在文件的哪里：原文布局写文件头隐藏注释 DSH-PARENT（#1489），
 *  旧布局继续写旧的 parentKey 注释 —— 两种注释解析都认，但写的时候按文件自己的形状来，
 *  免得一份文件里同时留着「parentKey: 00」与「DSH-PARENT: 02」两条互相矛盾的父票记录。
 *  #1788：形状改由路线决定（route 为空串 = 不在任何工作单元里，只可能是旧布局），不再看文件文字。 */
export function parentCommentOf(txt: string,want: string | null,route: TicketRoute): string{
  if(!route)return upsertParentComment(txt,want)
  return upsertHiddenComment(txt,'DSH-PARENT',want)
}
/** 阻塞边落在文件里的两处（原文布局）：可见行按路线与字段样式写，隐藏注释 DSH-BLOCKED-BY 与它成对更新。
 *  #1788：路线决定语义（地图子票的裸行 / 普通票的字段行），字段样式决定写加粗还是裸行，避免同一份文件里
 *  出现两行互相矛盾的 Blocked by。旧布局（route 为空串）保持原来的可见行写法。
 *  00 号容器不在这里：容器文件（map.md / spec.md 本身）的原文布局没有 Blocked by 字段，写入口已经
 *  如实拒绝，不再把可见行塞进正文段 —— 那行会在下一次「整段正文重建」时被当成正文吞掉
 *  （见 issues-patch.ts 的 setBlockedByInner）。 */
export function writeBlockedByLine(txt: string,blockers: string[],route: TicketRoute): string{
  const keys=blockers.map(k=>String(k).padStart(2,'0'))
  if(!route){
    const line=blockers.length?'Blocked by: '+blockers.map(k=>'#'+String(k).padStart(2,'0')).join(', '):'Blocked by:'
    return replaceOrInsertField(txt,'Blocked\\s+by',line)
  }
  const out=upsertHiddenComment(txt,'DSH-BLOCKED-BY',keys.length?keys.join(', '):null)
  // 加粗行与其它字段同一套写法：值带 #（地图子票原文的加粗行也这么写），清空时写 None (can start immediately)。
  const writeBold=function(): string{
    return replaceBoldField(out,'Blocked by',keys.length?keys.map(k=>'#'+k).join(', '):'None (can start immediately)')
  }
  if(route==='map'){
    // 地图子票：原文的可见行是裸行、值是不带 # 的编号。文件里已经有加粗行时按加粗行的写法改，
    // 不再另插一条裸行 —— 同一份文件里出现两行互相矛盾的 Blocked by，读回来是哪一个全看解析顺序。
    if(fieldStyleOf(out,'Blocked by')==='bold')return writeBold()
    return keys.length?replaceBareField(out,'Blocked by',keys.join(', ')):removeBareField(out,'Blocked by')
  }
  // 规格 / 普通路线：按文件已有的字段样式写。文件里两种样式都没有时，加粗实施票补加粗行、手写票补裸行。
  const style=fieldStyleOf(out,'Blocked by')||(ticketFormOf(out)==='impl-ticket'?'bold':'bare')
  if(style==='bold')return writeBold()
  return keys.length?replaceBareField(out,'Blocked by',keys.map(k=>'#'+k).join(', ')):removeBareField(out,'Blocked by')
}
