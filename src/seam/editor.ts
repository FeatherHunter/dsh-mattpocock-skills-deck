/**
 * seam/editor.ts · B5 editor 绑定（issuePath 胶囊已彻底移除 · #345）
 *
 * 原「从文本提取 issue 引用 / 记录胶囊路径」能力随状态栏定位标志移除而置空；
 * 保留文件与导出形状以维持 seam 结构完整。
 */

export function extractIssueRefs(_text: unknown): unknown[] {
  return []
}

export function recordIssuePath(_st: unknown, _number: number): void {
}

/** 本绑定说明的形状：只在本文件内用，不导出 —— 跨文件引用会多出层内边（同层禁引），6 份各自写一份。 */
interface SeamDescribe {
  b: string
  name: string
  covers: string[]
  dev: string
  pkg: string
}

export const describe = (): SeamDescribe => ({
  b: 'B5',
  name: 'editor',
  covers: [],
  dev: '',
  pkg: '',
})
