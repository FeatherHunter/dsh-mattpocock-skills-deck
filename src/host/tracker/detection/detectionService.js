/**
 * tracker/detection/detectionService.js — 探测级联编排（~80 行二联骨架 + 增量预留）
 *
 * 第一性原理（#150 7项 + #151 聚合向导式 + #149 9项映射 + #113 + 契约 §2）：
 *  - 四层严格：前端只调 wf.detect/wf.chain（#284：九格目录视图与 wf.status 已退役）；探测零 OS 直碰（仅 platform.fs/exec/path/env）；
 *    后端只暴露 matches/preflight/describe；DetectionService 唯一持有 registry 单例 + buildOpContext
 *  - 三级联：explicit(file) > matches(registry.select 并行 3000ms + AbortSignal) > fallback(null)；
 *    pending=true 阻塞态必须 surface（不静默 fallback），multiHit 暴露纠正（#150 Q5）
 *  - 轻量化二联版先通 explicit→matches 主路径；preflight 惰性仅命中后调，pending 不缓存（Q6）
 *  - per-workspace：handleKey=cwd|refId 内存 Map<handleKey→Selection> 不落盘（Q3，workspaceStore）
 *  - RPC：wf.detect → DetectionResult{selection,preflights,repoHandle,skillProbes,at,explicit}；检查链真源为 wf.chain（Q7）
 *  - 契约 §2 capability-by-fill：探测不产能力表，能力视图仅诊断不驱动隐藏
 */

import { detectExplicit } from './explicitDetector.js'
import { canonicalWorkspaceKey } from '../../workspaceKey.js'

function buildOpContextBase(cwd, platform, fs, timers, exec) {
  return {
    cwd,
    platform,
    fs: fs || (platform && platform.fs) || null,
    // OpContext 契约 = BackendContext & {cwd, signal}；BackendContext 必含 exec（contract.js）。
    // #幽灵修复：preflight 的 ghClient/glab 依赖 ctx.exec 执行 gh/glab——缺失时假报 env 失败
    // （"ctx.exec unavailable"→被 wf.chain 谓词呈为「gh 未找到」链步）。
    exec: (typeof exec === 'function') ? exec : null,
    timers: timers || { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (id) => clearTimeout(id) },
    signal: undefined,
  }
}

/**
 * 判定工作区是否已空（#297 失效维度）。
 * 依据：目录本身存在但 listDir/readdir 后 meaningful 为空 → 视为“全部文件已删”，此前持久化选择应失效。
 * 过滤常见无意义占位（.DS_Store 等），保留 .git/.scratch 等有意义条目；平台或 fs 不可用时保守返回 false（不误判 stale，保 #247 防抖）。
 * 兼容多种 fs 形态：优先 listDir+resolve，回退 readdir/readdirSync/lstat 探针，避免单接口缺失导致永远不 stale。
 */
async function isWorkspaceEmpty(cwd, platform) {
  try {
    if (!cwd) return false
    const fs = platform && platform.fs
    if (!fs) return false
    // 尝试列目录：优先 listDir+resolve，回退 readdir
    let entries = null
    try {
      if (typeof fs.listDir === 'function' && typeof fs.resolve === 'function') {
        let target
        try { target = await fs.resolve(cwd) } catch { target = cwd }
        entries = await fs.listDir(target)
      } else if (typeof fs.readdir === 'function') {
        entries = await fs.readdir(cwd)
      } else if (typeof fs.listDir === 'function') {
        entries = await fs.listDir(cwd)
      }
    } catch {}
    if (Array.isArray(entries)) {
      const names = entries.map(e => typeof e === 'string' ? e : (e && e.name) || '').filter(Boolean)
      const ignorable = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini', '.gitkeep'])
      const meaningful = names.filter(n => !ignorable.has(n))
      return meaningful.length === 0
    }
    // 回退：无列目录能力时，探针关键锚点是否存在（任一存在即非空）
    const probes = ['.git', '.scratch', 'docs', 'package.json', 'README.md']
    for (const p of probes) {
      try {
        const full = (platform.path && typeof platform.path.join === 'function') ? platform.path.join(cwd, p) : (cwd + '/' + p)
        let exists = false
        if (typeof fs.lstat === 'function' && typeof fs.resolve === 'function') {
          try { const t = await fs.resolve(full); const st = await fs.lstat(t); exists = !!st } catch {}
        } else if (typeof fs.lstat === 'function') {
          try { const st = await fs.lstat(full); exists = !!st } catch {}
        } else if (typeof fs.stat === 'function') {
          try { const st = await fs.stat(full); exists = !!st } catch {}
        }
        if (exists) return false
      } catch {}
    }
    // 无法判定列目录且锚点均不存在时，保守视为不空（不 stale），避免误判
    return false
  } catch {
    return false
  }
}

export function createDetectionService({ registry, getPlatform, getFs, getTimers, workspaceStore, skillProbe, resolveRepoHandle, exec } = {}) {
  const store = workspaceStore || null
  // skillProbe 为可选：未注入时返回空技能集（正交，复用 host probeSkill 旧逻辑但不在二联版强依赖）
  const probeSkills = typeof skillProbe === 'function' ? skillProbe : async () => ({ ok: true, missing: [], probes: {} })

  async function detect(handle, opts = {}) {
    // 规整钥匙（地图 #278 A 方案）：workspaceStore 按 handleKey=cwd|refId 分桶，写读删必须同形。
    // 入口先洗 cwd（空值保持空串——上层 handler 已回退 DEFAULT_CWD；洗钥匙异常则回退原串）。
    if (handle && typeof handle.cwd === 'string' && handle.cwd) {
      try {
        const ck = await canonicalWorkspaceKey(handle.cwd, { getPlatform, getFs })
        if (ck) handle = Object.assign({}, handle, { cwd: ck })
      } catch (e) {}
    }
    const cwd = (handle && handle.cwd) || ''
    const force = !!opts.force
    const platform = getPlatform ? await getPlatform() : null
    const fs = getFs ? getFs() : (platform && platform.fs) || null
    const timers = getTimers ? getTimers() : null
    // per-workspace 缓存（Q6 pending 不缓存；force 直通）
    // #195 修复：env 失败不缓存（gh 可随时安装，缓存会导致“已装仍报未装”）；仅 pending 已在上游跳过，此处追加 env 守卫
    // #297 失效维度：若工作区已空（全部文件已删），已缓存的显式选择视为过期，不直接返回
    if (!force && store) {
      const cached = store.get(handle)
      if (cached && cached.selection && !cached.selection.pending) {
        const pf = cached.preflight
        const isEnvFail = pf && !pf.ok && pf.error && pf.error.kind === 'env'
        if (!isEnvFail) {
          let isStale = false
          try {
            if (cached.selection.backendId) {
              isStale = await isWorkspaceEmpty(cwd, platform)
            }
          } catch {}
          if (isStale) {
            try { store.invalidate(handle) } catch {}
          } else {
            return cached
          }
        }
      }
    }

    // ① explicit(file) 分支
    const explicitRes = await detectExplicit(handle, { platform, cwd, fs }, registry)
    let selection = explicitRes.selection
    const explicit = { raw: explicitRes.raw, parsed: explicitRes.parsed }

    // ② 用户显式选择（持久化意图，2026-08-28 拍板层级：主锚 > 用户选择 > 自动识别(matches) > 兜底）
    //    客户端持久化绑定经 opts.hintBackendId 上报——与 registry.select 的 explicit(bind 记忆) 同权，并跨重启可用；
    //    未注册 id 忽略（诚实）→ 落 matches；主锚有结论时本分支不参与（锚即真相优先）。
    //    #297 失效维度：若工作区已空（全部文件已删），此前持久化选择视为过期意图，不采纳 hint，直接视为显式无后端（让蓝条重现）
    if (!selection && opts.hintBackendId && registry && typeof registry.has === 'function' && registry.has(opts.hintBackendId)) {
      let isStaleHint = false
      try { isStaleHint = await isWorkspaceEmpty(cwd, platform) } catch {}
      if (isStaleHint) {
        selection = { backendId: null, source: 'explicit' }
      } else {
        try {
          let ref = null
          try { ref = registry.describe(handle, opts.hintBackendId) } catch {}
          selection = { backendId: opts.hintBackendId, source: 'explicit', ref }
        } catch (eHint) {}
      }
    }

    // ③ matches > fallback（经 registry.select，含 pending/multiHit + 超时 3000ms + AbortSignal）
    if (!selection) {
      const opCtx = buildOpContextBase(cwd, platform, fs, timers, exec)
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
          const opCtx2 = buildOpContextBase(cwd, platform, fs, timers, exec)
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
    // #284：wf.chain 只取 selection，跳过 25 名技能探测（避免等待计数被链加载外的轮次推进；计数仅随真实探针轮次推进）
    if (!opts.skipSkillProbes) { try { skillProbes = await probeSkills({ cwd, platform }) } catch { skillProbes = null } }

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
    // #195 修复：env 失败不入缓存（见上）
    if (store && selection && !selection.pending) {
      const pf2 = result.preflight
      const isEnvFail2 = pf2 && !pf2.ok && pf2.error && pf2.error.kind === 'env'
      if (!isEnvFail2) { try { store.set(handle, result) } catch {} }
    }
    return result
  }

  return { detect, handleKey: (h) => (h.cwd || h.refId || String(h)) }
}

export default createDetectionService