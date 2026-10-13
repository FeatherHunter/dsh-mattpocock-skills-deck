// issues.js —— markdown 房单据操作入口：以后改房间对外导出清单时改它（预估约 30 行）。
// 实现按改动理由分住各文件，本文件只转出口，行为与拆分前一致。
export { listIssues, getIssue } from './issues-read.js'
export { createIssue } from './issues-create.js'
export { closeIssue, reopenIssue } from './issues-status.js'
export { updateIssue, setBlockedByIssue, setAssigneesIssue, setParentIssue, setLabelsIssue } from './issues-patch.js'
import { listIssues, getIssue } from './issues-read.js'
import { createIssue } from './issues-create.js'
import { closeIssue, reopenIssue } from './issues-status.js'
import { updateIssue, setBlockedByIssue, setAssigneesIssue, setParentIssue, setLabelsIssue } from './issues-patch.js'
export default { listIssues, getIssue, createIssue, closeIssue, reopenIssue, updateIssue, setBlockedByIssue, setAssigneesIssue, setParentIssue, setLabelsIssue }
