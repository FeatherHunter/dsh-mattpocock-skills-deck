// src/host/tracker/backends/github/parent-repair.js —— REST 树边修复（#895 从 issues.js 移出，原样搬家）
//
// 由 issues.js 纯结构移出（repairParentLinksREST），行为零变化：找出所有 wayfinder:map 票，
// 逐个拉 /sub_issues，把子票 raw.parent 设为 {number}（normalize 的 deriveParentKey 直接消费）。
// 同房间内引用（graph.js 不需要它，只有 issues.js 用），跨房间不许引。
import { ghClient } from './client.js'

export async function repairParentLinksREST(raws, parsed, ctx) {
  const c = ghClient(ctx)
  const maps = raws.filter((x) => (x && Array.isArray(x.labels) && x.labels.some((l) => l && l.name === 'wayfinder:map')))
  if (!maps.length) return raws
  const childToMap = new Map()
  await Promise.all(maps.map(async (m) => {
    try {
      const r = await c.execGh(['api', `repos/${parsed.owner}/${parsed.name}/issues/${m.number}/sub_issues?per_page=100`], { cwd: ctx && ctx.cwd })
      if (!r.ok) return
      let j
      try { j = JSON.parse(r.data.stdout || '') } catch { return }
      if (!Array.isArray(j)) return
      for (const s of j) { if (s && s.number != null) childToMap.set(String(s.number), { number: m.number }) }
    } catch { /* 单 map 子票修复失败不阻塞整体，子树降级为孤儿票（诚实可读） */ }
  }))
  for (const x of raws) {
    const p = childToMap.get(String(x && x.number))
    if (p) x.parent = p
  }
  return raws
}
