import { parseMd } from './parse.js'
export function normalizeIssue(text, meta){
  const issue=parseMd(text,meta)
  if('milestone' in issue)delete issue.milestone
  if('author' in issue)delete issue.author
  if('number' in issue)delete issue.number
  if('subIssues' in issue)delete issue.subIssues
  if('blocking' in issue)delete issue.blocking
  if(typeof issue.key!=='string')issue.key=String((meta&&meta.key)||'00')
  // effort 维度：effortId 是核心字段（永远存在）；扁平布局与单 effort 后端为 ''（EMPTY）
  if(typeof issue.effortId!=='string')issue.effortId=String((meta&&meta.effortId)||'')
  if(typeof issue.type!=='string')issue.type=meta&&meta.isMap?'map':'issue'
  if(typeof issue.title!=='string')issue.title=''
  if(typeof issue.state!=='string')issue.state='open'
  if(typeof issue.body!=='string')issue.body=String(text||'')
  if(typeof issue.url!=='string')issue.url=''
  if(typeof issue.createdAt!=='string')issue.createdAt=''
  if(typeof issue.updatedAt!=='string')issue.updatedAt=''
  if(!('closedAt' in issue))issue.closedAt=issue.state==='closed'?'':null
  if(!('parentKey' in issue))issue.parentKey=(meta&&meta.parentKey!==undefined)?meta.parentKey:null
  if(!('blockedBy' in issue)||!Array.isArray(issue.blockedBy))issue.blockedBy=[]
  if(!('comments' in issue)||!Array.isArray(issue.comments))issue.comments=[]
  if(!('reason' in issue)){issue.reason=issue.state==='closed'?'completed':''}
  // labels 按 #312 定版为能力字段但已实现：票里 Labels 行只写名、色在总表，未收录回灰，缺行按空 []（不再 MISSING）
  if(!('labels' in issue)||!Array.isArray(issue.labels))issue.labels=[]
  return issue
}
export default normalizeIssue
