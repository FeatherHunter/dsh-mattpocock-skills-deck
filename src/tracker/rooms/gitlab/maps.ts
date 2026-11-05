/**
 * src/tracker/rooms/gitlab/maps.ts —— 地图薄查的旧路径转发；真实现在 issues/maps.ts（#1914）。
 *
 * 为什么留着这个文件：地图清单在 #1907 规格的 9 个旧路径名单里，房外的门禁与测试仍按这个路径
 * import（例如 tests/verify-1605-gitlab-map-list.ts、tests/verify-1605-map-routing-guard.ts）。
 * 这次改造不允许改房外代码，所以旧路径只做纯转发：整个文件只有下面一行 re-export，不加逻辑、
 * 不包一层、不补默认值。将来房外读者改去新路径之后，这个文件可以整份删除。
 *
 * 旧的 maps.ts 本来就没有 default 导出（counts / pages / sub-issues 那三份才有），转发也照原样
 * 只交 listMaps —— 不为了「看起来一致」新造一个对面从来没交过的默认导出。
 */
export { listMaps } from './issues/maps.js'
