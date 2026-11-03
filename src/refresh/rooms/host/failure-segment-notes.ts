/**
 * 失败段记历史：同一段失败只写一条通知历史。
 *
 * 为什么需要：宿主每 5 秒探一次、客户端失败后也会持续重试；如果按拍记，连续失败会把事件库刷满
 * （500 条上限、7 天保留），而人真正要查的是「这一段什么时候开始的、哪个环节、什么原因」。所以
 * 每次失败先问「这个工作区这一段记过没有」，记过就跳过；任何一次真正的成功调 clear，下一段失败
 * 才重新记。
 *
 * 边界：这里不管「什么算成功」——那由调用方按自己的回包判（探测成功要真的发过请求，快照成功要
 * 回的是快照）。记历史失败不能影响主流程：不 await、异常吞掉（与宿主刷新失败那条路同一口径）。
 */
export function createFailureSegmentNotes(noteRefreshFailure: any): {
  fail: (cwd: any, stage: string, kind: any) => void
  clear: (cwd: any) => void
} {
  const notedByCwd: Record<string, boolean> = {}
  function fail(cwd: any, stage: string, kind: any): void {
    const key = String(cwd == null ? '' : cwd)
    if (!key || notedByCwd[key]) return
    notedByCwd[key] = true
    try {
      if (typeof noteRefreshFailure !== 'function') return
      const p: any = noteRefreshFailure(key, null, { stage: stage, kind: String(kind == null ? '' : kind) })
      if (p && typeof p.catch === 'function') p.catch(function (): void {})
    } catch (e) { /* 记历史失败不能影响探测或取数本身 */ }
  }
  function clear(cwd: any): void {
    const key = String(cwd == null ? '' : cwd)
    if (key) delete notedByCwd[key]
  }
  return { fail: fail, clear: clear }
}
