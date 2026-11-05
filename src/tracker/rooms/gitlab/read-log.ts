/**
 * src/tracker/rooms/gitlab/read-log.ts —— 读路径日志出口的旧路径：纯转发（#1913、#1921）。
 *
 * 实现已经搬进 support/read-log.ts。房外仍有读者按这条旧路径取登记值与发送函数：
 * tests/verify-1130-gitlab-marker-read.ts 从本文件取 READ_DEGRADED_OPS 与 READ_DEGRADED_REASONS；
 * 房内其余文件已经一律从 support/read-log.ts 直接 import，不再绕这一层。这次结构改造不允许改
 * 房外代码，所以本文件只做 re-export：不加逻辑、不包一层、不设默认值、不做副作用。
 * ADR 20261105 的决定三给这条旧路径留了位置。
 *
 * 将来房外读者改完 import 路径之后，删掉本文件只需要删下面这些导出，不需要把逻辑搬回来。
 */
export {
  emitReadDegraded,
  emitPreflightGatePass,
  emitRepoTier,
  READ_DEGRADED_OPS,
  READ_DEGRADED_REASONS,
  PREFLIGHT_GATES,
  PREFLIGHT_GATE_REASONS,
  isPreflightGate,
} from './support/read-log.js'
export { default } from './support/read-log.js'
