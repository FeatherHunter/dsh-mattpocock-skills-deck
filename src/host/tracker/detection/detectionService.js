/**
 * tracker/detection/detectionService.js — 探测级联编排（~80 行二联骨架 + 增量预留）
 *
 * 第一性原理（#150 7项 + #151 聚合向导式 + #149 9项映射 + #113 + 契约 §2）：
 *  - 四层严格：前端只调 wf.detect/wf.status；探测零 OS 直碰（仅 platform.fs/exec/path/env）；
 *    后端只暴露 matches/preflight/describe；DetectionService 唯一持有 registry 单例 + buildOpContext
 *  - 三级联：explicit(file) > matches(registry.select 并行 3000ms + AbortSignal) > fallback(null)；
 *    pending=true 阻塞态必须 surface（不静默 fallback），multiHit 暴露纠正（#150 Q5）
 *  - 轻量化二联版先通 explicit→matches 主路径；preflight 惰性仅命中后调，pending 不缓存（Q6）
 *  - per-workspace：handleKey=cwd|refId 内存 Map<handleKey→Selection> 不落盘（Q3，workspaceStore）
 *  - RPC：wf.detect → DetectionResult{selection,preflights,repoHandle,skillProbes,at,explicit}，wf.status 薄兼容 9 checks（Q7）
 *  - 契约 §2 capability-by-fill：探测不产能力表，能力视图仅诊断不驱动隐藏
 */

import { detectExplicit } from './explicitDetector.js'

function buildOpContextBase(cwd, platform, fs, timers) {
  return {
    cwd,
    platform,
    fs: fs || (platform && platform.fs) || null,
    timers: timers || { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (id) => clearTimeout(id) },
    signal: undefined,
  }
}

export function createDetectionService({ registry, getPlatform, getFs, getTimers, workspaceStore, skillProbe, resolveRepoHandle } = {}) {
  const store = workspaceStore || null
  // skillProbe 为可选：未注入时返回空技能集（正交，复用 host probeSkill 旧逻辑但不在二联版强依赖）
  const probeSkills = typeof skillProbe === 'function' ? skillProbe : async () => ({ ok: true, missing: [], probes: {} })

  async function detect(handle, opts = {}) {
    const cwd = (handle && handle.cwd) || ''
    const force = !!opts.force
    // per-workspace 缓存（Q6 pending 不缓存；force 直通）
    if (!force && store) {
      const cached = store.get(handle)
      if (cached && cached.selection && !cached.selection.pending) return cached
    }

    const platform = getPlatform ? await getPlatform() : null
    const fs = getFs ? getFs() : (platform && platform.fs) || null
    const timers = getTimers ? getTimers() : null

    // ① explicit(file) 分支
    const explicitRes = await detectExplicit(handle, { platform, cwd, fs }, registry)
    let selection = explicitRes.selection
    const explicit = { raw: explicitRes.raw, parsed: explicitRes.parsed }

    // ② matches > fallback（经 registry.select，含 pending/multiHit + 超时 3000ms + AbortSignal）
    if (!selection) {
      const opCtx = buildOpContextBase(cwd, platform, fs, timers)
      // 若调用方传 signal，可在此注入 opCtx.signal = opts.signal（registry withTimeout 内部会合并）
      if (opts.signal) opCtx.signal = opts.signal
      selection = await registry.select(handle, opCtx)
    }

    // repoHandle：轻量化复用 getRepoKey 语义中的 handle → describe ref
    let repoHandle = null
    try {
      if (selection && selection.ref) repoHandle = { cwd, refId: selection.ref.refId || '' }
      else if (typeof resolveRepoHandle === 'function') repoHandle = await resolveRepoHandle(handle)
      else repoHandle = { cwd, refId: (selection && selection.backendId) ? (handle.cwd || '') : '' }
    } catch { repoHandle = { cwd, refId: '' } }

    // 惰性 preflight：仅命中且非 pending 时调（Q6）
    let preflight = null
    if (selection && selection.backendId && !selection.pending) {
      try {
        const tracker = registry.get(selection.backendId)
        if (tracker && typeof tracker.preflight === 'function') {
          const opCtx2 = buildOpContextBase(cwd, platform, fs, timers)
          if (opts.signal) opCtx2.signal = opts.signal
          // preflight 可能经 ghClient 走 subprocess，需传 platform
          opCtx2.platform = platform
          preflight = await tracker.preflight(repoHandle, opCtx2)
        }
      } catch (e) {
        preflight = { ok: false, error: { kind: 'network', message: String((e && e.message) || e).slice(0, 300) } }
      }
    }

    // 技能正交探测（10 名，含 setup-matt-pocock-skills 正位；复用 host probeSkill 逻辑）
    let skillProbes = null
    try { skillProbes = await probeSkills({ cwd, platform }) } catch { skillProbes = null }

    const result = {
      handle: { cwd },
      selection,
      repoHandle,
      explicit,
      preflight,
      skillProbes,
      at: Date.now(),
    }

    // 缓存：pending 不缓存（Q6）；force 重算后仍按同规则决定是否入缓存
    if (store && selection && !selection.pending) {
      try { store.set(handle, result) } catch {}
    }
    return result
  }

  return { detect, handleKey: (h) => (h.cwd || h.refId || String(h)) }
}

export default createDetectionService
