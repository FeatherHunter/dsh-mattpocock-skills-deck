/**
 * src/tracker/rooms/github/routing/fallback-reason.ts — 降级原因分类（#504 雾证据补强）。
 * #1687 阶段 1：从房间根迁入 routing/。它回答的是「这次降级该记哪个原因」，
 * 属于两条渠道汇合处的判断，读侧与写侧都要用；旧路径 fallback-reason.ts 保留纯转发。
 *
 * 由 `issues.ts` 拆出（单文件 350 行纪律：房内拆文件不拆房）。文件头原写 `backends/github/fallback-reason.js`，
 * 是 #1019 目录归位前的旧路径；#1052 按读路径这一片改成今天的真名。
 * 不再恒写 graphql-error，按失败现场给细分原因，只复用现有事件名与字段，附录不动。
 * 超时文案 → timeout；限流文案或 429 → rate-limit；企业版主机 → ghe-host；其余 → graphql-error。
 * 企业版只看主机名是否非 github.com（GH_HOST 环境变量或报错里的主机名），不记地址原文。
 * 合成探针见 tests/verify-504-github-pr.js（企业版主机/限流/timeout 三合成失败各走各的 reason）。
 */

import type { OpContext } from '../../../contract/contexts.js';

/** 能读 GH_HOST 的最小环境口：契约平台环境口与历史遗留的顶层 env 口都只认这一个方法。 */
interface GhHostEnv {
  get(name: string): string | undefined;
}

/** 读主机名时的最小上下文：契约上下文加历史遗留的顶层 env（老调用方仍在传，拿不准就兼容读）。 */
type GhHostCtx = OpContext & { env?: GhHostEnv | null };

/** 从全局取进程环境：为什么走 globalThis 而不是直写 process——严格模式下没有 node 类型，直写会报找不到名字，走全局取与原来是同一份值，运行时不变。 */
function procEnv(): Record<string, string | undefined> | null {
  const g = globalThis as Record<string, unknown>;
  const p = g.process as { env?: Record<string, string | undefined> } | undefined;
  return (p && p.env) || null;
}

export function readGhHost(ctx: GhHostCtx): string {
  try {
    const env = ctx && ctx.platform && ctx.platform.env && typeof ctx.platform.env.get === 'function' ? ctx.platform.env : null
    const v = env ? String(env.get('GH_HOST') || '') : ''
    if (v) return v
  } catch {}
  try {
    if (ctx && ctx.env && typeof ctx.env.get === 'function') {
      const v2 = String(ctx.env.get('GH_HOST') || '')
      if (v2) return v2
    }
  } catch {}
  try {
    const penv = procEnv();
    if (penv && penv.GH_HOST) return String(penv.GH_HOST)
  } catch {}
  return ''
}

export function isGheHostName(h: unknown): boolean {
  const s = String(h || '').trim().toLowerCase()
  if (!s) return false
  if (s === 'github.com' || s === 'api.github.com' || s.endsWith('.github.com')) return false
  return true
}

/** 降级原因的四种取值：超时、限流、企业版主机、其余统称查询失败，调用方按它记 reason 字段。 */
export type FallbackReason = 'timeout' | 'rate-limit' | 'ghe-host' | 'graphql-error';

export function pickFallbackReason(err: unknown, ctx: GhHostCtx): FallbackReason {
  try {
    // 为什么转成键值袋再读：错误值形状开放，直接读 stderr 会报缺成员；或链保持与原来一致的兜底顺序。
    const bag = (err && typeof err === 'object' ? (err as Record<string, unknown>) : null) as Record<string, unknown> | null;
    const inner = (bag && bag.error && typeof bag.error === 'object' ? (bag.error as Record<string, unknown>) : null) as Record<string, unknown> | null;
    const msg = String((bag && (bag.stderr || bag.message || bag.stdout || (inner && inner.message))) || err || '')
    const s = msg.toLowerCase()
    if (/timeout|timed out|timedout|etimedout/i.test(msg)) return 'timeout'
    if (/rate limit|429|api rate limit exceeded|secondary rate limit/i.test(s)) return 'rate-limit'
    if (isGheHostName(readGhHost(ctx))) return 'ghe-host'
    if (/github enterprise|ghes|enterprise server/i.test(s)) return 'ghe-host'
    const hm = msg.match(/([A-Za-z0-9-]+\.)+(example\.com|local|internal|corp|enterprise)(:\d+)?/i)
    if (hm) return 'ghe-host'
  } catch {}
  return 'graphql-error'
}

export default { readGhHost, isGheHostName, pickFallbackReason }
