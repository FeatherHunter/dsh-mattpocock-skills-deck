/**
 * src/tracker/rooms/gitlab/graph-membership.ts —— 旧路径的纯转发文件（亲缘挂载与指派这一份）。
 *
 * 为什么还留在这里（#1920）：房外有测试按这条旧路径 import 这份文件的公开名字
 * （tests/verify-1785-assign-unknown.ts 从 ./graph-membership.ts 取 setAssignees），而这次结构
 * 改造的约束是不改房外代码。ADR 20261105 决定三给这类旧名字留 9 个纯转发文件，本文件是其中之一：
 * 文件里只许 re-export，不加逻辑、不包一层、不设默认值、不做副作用。
 *
 * 实现在 graph/membership.ts（#1920 搬进去）：隐藏标记挂载与用户名换编号的唯一实现在那里。
 * 这份旧文件本来就没有 default 导出，转发也照原样只交两个具名函数 —— 不为了「看起来一致」
 * 新造一个对面从来没交过的默认导出。
 *
 * 将来房外读者改完 import 路径之后，删掉本文件只需要删下面这一行导出，不需要把逻辑搬回来。
 */
export { setParent, setAssignees } from './graph/membership.js'
