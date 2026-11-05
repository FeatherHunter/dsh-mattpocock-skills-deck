/**
 * src/tracker/rooms/gitlab/normalize.ts —— 回包归一的旧路径：纯转发（#1921 收口）。
 *
 * 实现已经搬进 model/normalize.ts；票面正文标记的六个函数由 model/description-markers.ts 提供
 * （#1911 把标记规则收成一处）。房外仍有读者按这条旧路径 import：契约夹具、快照门禁、字段三态
 * 门禁与 tests/verify-1599-gitlab-hidden-markers.ts（从本文件取那六个标记函数）。这次结构改造
 * 不允许改房外代码，所以本文件只做 re-export：不加逻辑、不包一层、不设默认值、不做副作用。
 * ADR 20261105 的决定三给这条旧路径留了位置。
 *
 * 将来房外读者改完 import 路径之后，删掉本文件只需要删下面这些导出，不需要把逻辑搬回来。
 */
export { normalizeIssue } from './model/normalize.js'
export {
  parseBlockedByFallback,
  parseHiddenBlockedBy,
  parseHiddenParent,
  parseLegacyPartOf,
  rewriteDescriptionWithBlockedPair,
  rewriteDescriptionWithHiddenParent,
} from './model/description-markers.js'
export { default } from './model/normalize.js'
