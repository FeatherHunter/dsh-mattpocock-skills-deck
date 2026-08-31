/**
 * seam/editor.js · B5 editor 绑定（issuePath 胶囊已彻底移除 · #345）
 *
 * 原「从文本提取 issue 引用 / 记录胶囊路径」能力随状态栏定位标志移除而置空；
 * 保留文件与导出形状以维持 seam 结构完整。
 */

export function extractIssueRefs(text) {
  return []
}

export function recordIssuePath(st, number) {
}

export const describe = () => ({
  b: 'B5',
  name: 'editor',
  covers: [],
  dev: '',
  pkg: '',
})