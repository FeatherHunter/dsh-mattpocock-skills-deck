/**
 * src/tracker/rooms/gitlab/idempotency.ts —— 建票幂等锚的旧路径：纯转发（#1913）。
 *
 * 实现已经搬进 issues/idempotency.ts，与票的读写落在同一个概念目录。房外仍按旧路径 import
 * 这三个名字（tests/verify-1827-double-anchor.ts 就取了 withAnchor），这次改造不允许改房外代码，
 * 所以本文件只做 re-export —— 不 import、不建对象、不包一层；default 也由那一份原样转出。
 *
 * 不要往这里加逻辑：ADR 20261105 的决定三要求旧路径文件只有转发，将来房外引用改完之后可以机械删除。
 */
export { withAnchor, lookupByAnchor, describeLookupFailure } from './issues/idempotency.js'
export { default } from './issues/idempotency.js'
