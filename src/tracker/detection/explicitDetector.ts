/**
 * tracker/detection/explicitDetector.ts — 显式分支（~40 行）
 *
 * 第一性原理（#150 Q4 + #149 9→契约映射 + #113 平台层）：
 *  - 显式这一层只有一份记录：工作区配置文件 `docs/agents/workspace.yaml`（#1138 起；
 *    以前还有一份注册表里的进程内绑定，与它记的是同一件事，已整段删除）
 *  - 本模块为「文件显式」：读 `docs/agents/workspace.json`、`docs/agents/workspace.yaml`，再读 `docs/agents/issue-tracker.md`，经 `platform.fs`（零 OS 直碰），
 *    产内存 `Selection(explicit)`；不写 `byHandle`，避免文件监听竞态（handoff-150 Q4 *不自动 bind* 推荐）
 *  - 若解析出 `explicitBackendId` 且已注册 → 直接回 `Selection`，跳过 `registry.select` 的 matches 并行；
 *    否则返回 null 由调用方落到 `registry.select`（matches > fallback + pending/multiHit）
 *  - 平台层单点：`platform.fs.resolve/readText` + `platform.path.join`（若需拼接），绝不 `process.env`/`path.join` 直调
 */

import { parseIssueTracker, normalizeTrackerText } from './parseIssueTracker.js'
import type { ParsedIssueTracker } from './parseIssueTracker.js'
import { parseWorkspaceFile, WORKSPACE_FILE_REL } from '../../deck/shell/workspace-anchor.js'
import type { RepoHandle, SandboxFs } from '../contract/contexts.js'
import type { RepositoryRef } from '../contract/entities.js'
import type { Selection } from '../contract/results.js'

/**
 * 显式探测的入参上下文：只用到 cwd 与平台文件服务，其余一律不碰。
 * 收成小形状是因为真实调用方只给这两样（检测服务给 { platform, cwd, fs }，宿主兜底给 { platform, cwd, fs }），
 * 按完整 OpContext 收会把调用处卡死；文件读写只用 resolve/readText 两格，按契约沙箱取。
 * fs 这一格是调用方顺手递的直连文件服务（与 platform.fs 同源），这里只收下不读——
 * 检测服务每次都带它，不收这一格它那处传参编译不过。
 */
export interface ExplicitDetectCtx {
  cwd?: string
  platform?: { fs?: Pick<SandboxFs, 'resolve' | 'readText'> } | null
  fs?: unknown
}

/**
 * 显式探测要用的注册表两格：问有没有、要身份。只收这两格，不把整座注册表拽进来。
 */
export interface ExplicitRegistry {
  has(id: string): boolean
  describe(handle: RepoHandle, backendId: string): RepositoryRef
}

/**
 * 显式探测的结果：结论（有就给，没有就是 null）加读到的原文与结构化解析。
 */
export interface ExplicitResult {
  selection: Selection | null
  raw: string | null
  parsed: ParsedIssueTracker
}

/**
 * 尝试显式分支：读主锚 → 结构化解析 → 已注册则产 Selection
 * @param handle RepoHandle（至少含 cwd）
 * @param ctx 含 platform.fs 与 cwd 的最小上下文（见 ExplicitDetectCtx）
 * @param registry 注册表的 has/describe 两格
 * @returns 显式结论加原文与解析（见 ExplicitResult）
 */
export async function detectExplicit(handle: RepoHandle, ctx: ExplicitDetectCtx, registry: ExplicitRegistry): Promise<ExplicitResult> {
  const cwd = (handle && handle.cwd) || (ctx && ctx.cwd) || ''
  // #1138：这里原来先读一遍注册表里的进程内绑定（绑过即显式，不读文件）。那份副本已删——
  //   人选的唯一真源是工作区文件，所以本函数直接从文件读起，与统一判定出口读的是同一份。
  const platform = ctx && ctx.platform ? ctx.platform : null
  // 无平台则无法安全读（零 OS 直碰红线），回退 null
  if (!platform || !platform.fs || typeof platform.fs.resolve !== 'function' || typeof platform.fs.readText !== 'function') {
    return { selection: null, raw: null, parsed: { explicitBackendId: null, rawHint: '', confidence: 'none', reason: 'no-platform' } }
  }
  // #947 + #1138：工作区配置文件（人亲手选的默认值），今天是人选唯一的记录。胜锚文件；
  //   本机记忆 H 只用来把这份文件生成一次，判定里没有它那一层（见 backendDecision.ts 的注释）。
  try {
    const target = await platform.fs.resolve(WORKSPACE_FILE_REL, { cwd })
    const txt = await platform.fs.readText(target)
    const parsed = parseWorkspaceFile(txt)
    if (parsed && registry && typeof registry.has === 'function' && registry.has(parsed.backendId)) {
      let ref: RepositoryRef
      try { ref = registry.describe(handle, parsed.backendId) } catch (eD) { ref = { backend: parsed.backendId, refId: (handle && (handle.refId || handle.cwd)) || '', name: (handle && handle.cwd) || parsed.backendId, url: '' } }
      return { selection: { backendId: parsed.backendId, source: 'explicit', ref: ref }, raw: txt, parsed: { explicitBackendId: parsed.backendId, rawHint: '', confidence: 'high', reason: 'workspace-file' } }
    }
  } catch (eF) {}
  let raw: string | null = null
  try {
    const target = await platform.fs.resolve('docs/agents/issue-tracker.md', { cwd })
    raw = await platform.fs.readText(target)
  } catch {
    return { selection: null, raw: null, parsed: { explicitBackendId: null, rawHint: '', confidence: 'none', reason: 'read-failed' } }
  }
  const text = normalizeTrackerText(raw)
  const parsed = parseIssueTracker(text)
  const bid = parsed.explicitBackendId
  if (bid && registry && typeof registry.has === 'function' && registry.has(bid)) {
    let ref: RepositoryRef
    try { ref = registry.describe(handle, bid) } catch { ref = { backend: bid, refId: handle.refId || handle.cwd || '', name: handle.cwd || bid, url: '' } }
    return { selection: { backendId: bid, source: 'explicit', ref }, raw, parsed }
  }
  return { selection: null, raw, parsed }
}

export default detectExplicit
