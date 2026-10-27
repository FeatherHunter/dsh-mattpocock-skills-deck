/**
 * data/patches.ts —— 逐行差异的示例内容。
 *
 * 真实实现按需向宿主读补丁；原型不连宿主，展开文件时必须有点东西可看，
 * 否则「逐行差异在 460 宽里怎么排」这个设计问题就没被验证。
 * 每段补丁都标了示例身份（界面上的说明、README 都写清楚），不冒充仓库真实内容。
 */
import type { PatchLine } from './core'

const TS_SAMPLE: PatchLine[] = [
  { kind: 'filehead', text: 'diff --git a/src/client/views/shared/workRouteTable.ts b/src/client/views/shared/workRouteTable.ts' },
  { kind: 'hunk', text: '@@ -18,7 +18,7 @@ export const workRouteTableOf = function (rows) {' },
  { kind: 'context', text: '  const table = new Map()' },
  { kind: 'context', text: '  for (const row of rows) {' },
  { kind: 'del', text: '-    table.set(row.key, row.ticket)' },
  { kind: 'add', text: '+    table.set(row.key, row.ticket ?? row.fallback)' },
  { kind: 'context', text: '  }' },
  { kind: 'context', text: '  return table' },
  { kind: 'context', text: '}' },
]

const TS_SAMPLE_TWO: PatchLine[] = [
  { kind: 'filehead', text: 'diff --git a/src/refresh/rooms/host/outbound-admission.ts b/src/refresh/rooms/host/outbound-admission.ts' },
  { kind: 'hunk', text: '@@ -41,6 +41,10 @@ export const admitOutbound = function (request) {' },
  { kind: 'context', text: '  if (!request.sessionId) return { ok: false, reason: \'no-session\' }' },
  { kind: 'add', text: '+  if (request.retryOf) {' },
  { kind: 'add', text: '+    traces.push({ kind: \'retry\', id: request.retryOf })' },
  { kind: 'add', text: '+  }' },
  { kind: 'context', text: '  const admitted = checkQuota(request)' },
  { kind: 'del', text: '-  return admitted ? allow(request) : deny(request)' },
  { kind: 'add', text: '+  return admitted ? allow(request) : deny(request, { retryable: true })' },
]

const MARKDOWN_SAMPLE: PatchLine[] = [
  { kind: 'filehead', text: 'diff --git a/docs/review/sample.md b/docs/review/sample.md' },
  { kind: 'hunk', text: '@@ -1,4 +1,6 @@' },
  { kind: 'context', text: '# 评审记录' },
  { kind: 'add', text: '+## 结论' },
  { kind: 'add', text: '+两处需要人工确认的边界已经列在下面。' },
  { kind: 'context', text: '' },
  { kind: 'context', text: '## 证据' },
]

const PNG_SAMPLE: PatchLine[] = [
  { kind: 'filehead', text: 'Binary files a/docs/design/md-env-check-chain.png and b/docs/design/md-env-check-chain.png differ' },
  { kind: 'no-newline', text: '原型不渲染二进制差异。' },
]

/** 按扩展名给一段示例补丁；未知扩展名返回 null，界面据此只显示说明。 */
export function samplePatch(path: string): PatchLine[] | null {
  if (path.endsWith('.ts') || path.endsWith('.mts') || path.endsWith('.tsx')) {
    return path.includes('outbound-admission') ? TS_SAMPLE_TWO : TS_SAMPLE
  }
  if (path.endsWith('.md')) return MARKDOWN_SAMPLE
  if (path.endsWith('.png') || path.endsWith('.jpg') || path.endsWith('.webp')) return PNG_SAMPLE
  return null
}
