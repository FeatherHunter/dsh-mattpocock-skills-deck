/**
 * src/tracker/rooms/gitlab/capability-register.ts —— 能力登记数据的旧路径：纯转发（#1916、#1921）。
 *
 * 数据已经搬进 support/capability-register.ts。房外仍有读者按这条旧路径取 GITLAB_CAPABILITY_REGISTER：
 * tests/verify-capability-register.ts、tests/verify-1605-map-routing-guard.ts，以及
 * tests/verify-1446-gitlab-budget.ts 的按路径动态加载。这次结构改造不允许改房外代码，所以本文件
 * 只做 re-export：不加逻辑、不包一层、不做副作用。ADR 20261105 的决定三给这条旧路径留了位置。
 *
 * 将来房外读者改完 import 路径之后，删掉本文件只需要删下面这一行导出，不需要把数据搬回来。
 */
export { GITLAB_CAPABILITY_REGISTER } from './support/capability-register.js'
