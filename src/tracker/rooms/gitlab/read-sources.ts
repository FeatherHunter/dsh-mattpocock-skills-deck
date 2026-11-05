/**
 * src/tracker/rooms/gitlab/read-sources.ts —— 读来源数据的旧路径：纯转发（#1916、#1921）。
 *
 * 数据已经搬进 support/read-sources.ts。房外仍有读者按这条旧路径取 GITLAB_READ_SOURCES：
 * tests/verify-operation-catalog.ts 拿它逐条核对 12 条读操作的本家通道默认值。这次结构改造
 * 不允许改房外代码，所以本文件只做 re-export：不加逻辑、不包一层、不做副作用。
 * ADR 20261105 的决定三给这条旧路径留了位置。
 *
 * 将来房外读者改完 import 路径之后，删掉本文件只需要删下面这一行导出，不需要把数据搬回来。
 */
export { GITLAB_READ_SOURCES } from './support/read-sources.js'
