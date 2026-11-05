/**
 * src/tracker/rooms/gitlab/issues/index.ts —— 票操作子树的统一出口（#1907 评审修复）。
 *
 * 为什么需要这一份：根目录 issues.ts 是给房外旧 import 的纯转发文件。按 ADR 20261105 决定三，
 * 它只许 re-export，不许自己 import 之后再建一个对象；而六个具名函数分住在 ./read.ts 与
 * ./write.ts，房外又有读者按默认导入取这六个名字。所以默认导出在这里按同一份函数引用组装一次，
 * 根目录转发文件用 `export { default } from './issues/index.js'` 原样转出。
 *
 * 这里不养实现：六个名字都从读写两份文件取，改行为仍去那两份文件。新增票操作时先想清楚它属于
 * 读还是写，加进对应文件，再决定要不要出现在默认导出里（对外形状不变是这次改造的硬约束）。
 */
import { listIssues, getIssue } from './read.js'
import { createIssue, closeIssue, reopenIssue, updateIssue } from './write.js'

export { listIssues, getIssue, createIssue, closeIssue, reopenIssue, updateIssue }

export default { listIssues, getIssue, createIssue, closeIssue, reopenIssue, updateIssue }
