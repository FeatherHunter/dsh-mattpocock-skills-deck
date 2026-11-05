/**
 * src/tracker/rooms/gitlab/issues.ts —— 票操作的旧路径：纯转发（#1913）。
 *
 * 实现已经按读写拆进 issues/ 子树：读在 issues/read.ts，写在 issues/write.ts；六个具名函数与
 * 它们组成的默认导出同住在 issues/index.ts。房外仍按旧路径 import 六个名字，这次改造不允许
 * 改房外代码，所以本文件只做 re-export —— 不 import、不建对象、不包一层。
 *
 * 不要往这里加逻辑：ADR 20261105 的决定三要求旧路径文件只有转发，将来房外引用改完之后可以机械删除。
 */
export { listIssues, getIssue } from './issues/read.js'
export { createIssue, closeIssue, reopenIssue, updateIssue } from './issues/write.js'
export { default } from './issues/index.js'
