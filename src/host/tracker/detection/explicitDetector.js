/**
 * tracker/detection/explicitDetector.js — 显式分支（~40 行）
 *
 * 第一性原理（#150 Q4 + #149 9→契约映射 + #113 平台层）：
 *  - 唯一显式写路径 = `wf.bind(handle, backendId|null) → registry.bind`（Q4 不回写 issue-tracker.md）
 *  - 本模块为「文件显式」：读内存绑定、`docs/agents/workspace.json`、再读 `docs/agents/issue-tracker.md`，经 `platform.fs`（零 OS 直碰），
 *    产内存 `Selection(explicit)`；不写 `byHandle`，避免文件监听竞态（handoff-150 Q4 *不自动 bind* 推荐）
 *  - 若解析出 `explicitBackendId` 且已注册 → 直接回 `Selection`，跳过 `registry.select` 的 matches 并行；
 *    否则返回 null 由调用方落到 `registry.select`（含 bound-explicit > matches > fallback + pending/multiHit）
 *  - 平台层单点：`platform.fs.resolve/readText` + `platform.path.join`（若需拼接），绝不 `process.env`/`path.join` 直调
 */

import { parseIssueTracker, normalizeTrackerText } from './parseIssueTracker.js'
import { parseWorkspaceFile, WORKSPACE_FILE_REL } from '../../../shared/deck-tools/workspace-file.js'

/**
 * 尝试显式分支：读主锚 → 结构化解析 → 已注册则产 Selection
 * @param {{ cwd?: string, refId?: string }} handle RepoHandle（至少含 cwd）
 * @param {{ platform: any, fs?: any }} ctx OpContext/BackendContext 需含 platform.fs
 * @param {{ has: (id: string)=>boolean, describe: (h:any,id:string)=>any }} registry
 * @returns {Promise<{selection: import('../contract.js').Selection|null, raw: string|null, parsed: ReturnType<typeof parseIssueTracker>}>}
 */
export async function detectExplicit(handle, ctx, registry) {
  const cwd = (handle && handle.cwd) || (ctx && ctx.cwd) || ''
  // #947：内存绑定优先（与工具壳同一条：绑过即显式，不读文件）。空串是显式无后端逃生舱，如实透传不落锚文件。
  try {
    if (registry && typeof registry.bound === 'function') {
      const boundId = registry.bound(handle)
      if (boundId === null) return { selection: { backendId: null, source: 'explicit' }, raw: null, parsed: { explicitBackendId: null, rawHint: '', confidence: 'high', reason: 'memory-none' } }
      if (typeof boundId === 'string' && boundId && typeof registry.has === 'function' && registry.has(boundId)) {
        let ref = null
        try { ref = registry.describe(handle, boundId) } catch (eD) { ref = { backend: boundId, refId: (handle && (handle.refId || handle.cwd)) || '', name: (handle && handle.cwd) || boundId, url: '' } }
        return { selection: { backendId: boundId, source: 'explicit', ref: ref }, raw: null, parsed: { explicitBackendId: boundId, rawHint: '', confidence: 'high', reason: 'memory-bound' } }
      }
    }
  } catch (eB) {}
  const platform = ctx && ctx.platform ? ctx.platform : null
  // 无平台则无法安全读（零 OS 直碰红线），回退 null
  if (!platform || !platform.fs || typeof platform.fs.resolve !== 'function' || typeof platform.fs.readText !== 'function') {
    return { selection: null, raw: null, parsed: { explicitBackendId: null, rawHint: '', confidence: 'none', reason: 'no-platform' } }
  }
  // #947：工作区配置文件（人亲手选的默认值）。胜锚文件，输内存绑定与选择记忆 H（H 在检测主流程后判）。
  try {
    const target = await platform.fs.resolve(WORKSPACE_FILE_REL, { cwd })
    const txt = await platform.fs.readText(target)
    const parsed = parseWorkspaceFile(txt)
    if (parsed && registry && typeof registry.has === 'function' && registry.has(parsed.backendId)) {
      let ref = null
      try { ref = registry.describe(handle, parsed.backendId) } catch (eD) { ref = { backend: parsed.backendId, refId: (handle && (handle.refId || handle.cwd)) || '', name: (handle && handle.cwd) || parsed.backendId, url: '' } }
      return { selection: { backendId: parsed.backendId, source: 'explicit', ref: ref }, raw: txt, parsed: { explicitBackendId: parsed.backendId, rawHint: '', confidence: 'high', reason: 'workspace-file' } }
    }
  } catch (eF) {}
  let raw = null
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
    let ref = null
    try { ref = registry.describe(handle, bid) } catch { ref = { backend: bid, refId: handle.refId || handle.cwd || '', name: handle.cwd || bid, url: '' } }
    return { selection: { backendId: bid, source: 'explicit', ref }, raw, parsed }
  }
  return { selection: null, raw, parsed }
}

export default detectExplicit
