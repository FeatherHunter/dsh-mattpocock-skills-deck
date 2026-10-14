// src/host/tracker/backends/github/parent-repair.js —— REST 树边修复（#895 从 issues.js 移出，原样搬家）
//
// 由 issues.js 纯结构移出（repairParentLinksREST），行为零变化：找出所有 wayfinder:map 票，
// 逐个拉 /sub_issues，把子票 raw.parent 设为 {number}（normalize 的 deriveParentKey 直接消费）。
// 同房间内引用（graph.js 不需要它，只有 issues.js 用），跨房间不许引。
import { ghClient } from './client.js'
import type { OpContext } from '../../contract/contexts.js';

/** 仓库坐标：拥有者与仓库名，由调用方（issues 的 REST 兜底）保证形状。 */
interface ParsedRepo {
  owner: string;
  name: string;
}

/** 原始行里读数的最小口：只读 labels/number，写 parent；行可能是空值，空值时按 falsy 短路（与原来一致）。 */
type RawRow = Record<string, unknown>;

export async function repairParentLinksREST(raws: unknown, parsed: ParsedRepo, ctx: OpContext): Promise<unknown> {
  const c = ghClient(ctx)
  // 为什么断言：调用方保证传数组；断言只为过编译，filter 还是调在原来那份值上，运行时不变。
  const rawList = raws as unknown[];
  const maps = rawList.filter((x: unknown) => {
    // 为什么转成袋再读：一行可能是空值，直接读 labels 会报缺成员；有值时袋与原值是同一份引用，读法与原来一致。
    const xb = (x && typeof x === 'object' ? x : null) as RawRow | null;
    return xb !== null && Array.isArray(xb.labels) && (xb.labels as unknown[]).some((l: unknown) => {
      const lb = (l && typeof l === 'object' ? l : null) as RawRow | null;
      return lb !== null && lb.name === 'wayfinder:map'
    })
  })
  if (!maps.length) return raws
  // 为什么标成未知值：键是子票号，值是 {number} 配对，内容原样搬运、不解读。
  const childToMap = new Map<string, unknown>()
  await Promise.all(maps.map(async (m: unknown) => {
    const mb = (m && typeof m === 'object' ? m : {}) as RawRow;
    try {
      const r = await c.execGh(['api', `repos/${parsed.owner}/${parsed.name}/issues/${String(mb.number)}/sub_issues?per_page=100`], { cwd: ctx && ctx.cwd })
      if (!r.ok) return
      let j: unknown
      try { j = JSON.parse(r.data.stdout || '') } catch { return }
      if (!Array.isArray(j)) return
      for (const s of j) { if (s && s.number != null) childToMap.set(String(s.number), { number: mb.number }) }
    } catch { /* 单 map 子票修复失败不阻塞整体，子树降级为孤儿票（诚实可读） */ }
  }))
  for (const x of rawList) {
    // 沿用原来的短路读法：空行时键就是 'null' 之类、查不到自然跳过；有值时读的还是原来那一格。
    const key = String(x && (x as RawRow).number)
    const p = childToMap.get(key)
    if (p) (x as RawRow).parent = p
  }
  return raws
}
