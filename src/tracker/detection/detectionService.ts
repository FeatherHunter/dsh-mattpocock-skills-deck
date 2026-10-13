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
import { canonicalWorkspaceKey } from '../../host/workspaceKey.js'

// 工作区短指纹（只记散列、不记路径原文）。与 repoKeys.js / logStore.js 同一种取法，各文件自带一份是仓里既有写法。
function hash8(text) {
  let h = 5381
  const s = String(text || '')
  for (let i = 0; i < s.length; i++) h = (((h << 5) + h + s.charCodeAt(i)) >>> 0)
  return ('0000000' + h.toString(16)).slice(-8)
}

function buildOpContextBase(cwd, platform, fs, timers, exec, via) {
  return {
    cwd,
    platform,
    fs: fs || (platform && platform.fs) || null,
    // OpContext 契约 = BackendContext & {cwd, signal}；BackendContext 必含 exec（contract.js）。
    // #幽灵修复：preflight 的 ghClient/glab 依赖 ctx.exec 执行 gh/glab——缺失时假报 env 失败
    // （"ctx.exec unavailable"→被 wf.chain 谓词呈为「gh 未找到」链步）。
    // #606:exec 外面包一层，把「这条链叫什么」传给起进程的接缝，日志才答得出「由谁触发」。
    exec: (typeof exec === 'function') ? function (cmd, args, opts) { return exec(cmd, args, opts, String(via || 'unspecified')) } : null,
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

/**
 * 取工作区配置文件的修改时间（手改文件即时生效的判据，#1003 甲）。
 * 依次看新 yaml 与老 json，任一能取到即回；取不到回 null（调用方按“判不了”处理，不误判）。
 * 只读时间不读内容，不碰令牌与路径原文。
 */
async function workspaceFileMs(cwd, platform) {
  try {
    if (!cwd) return null
    const fs = platform && platform.fs
    if (!fs || typeof fs.resolve !== 'function' || typeof fs.stat !== 'function') return null
    const rels = ['docs/agents/workspace.yaml', 'docs/agents/workspace.json']
    for (const rel of rels) {
      try {
        const target = await fs.resolve(rel, { cwd })
        const st = await fs.stat(target)
        const ms = st && (st.mtimeMs || (st.mtime && Number(st.mtime)))
        if (Number.isFinite(ms)) return ms
      } catch {}
    }
  } catch {}
  return null
}

export function createDetectionService({ registry, getPlatform, getFs, getTimers, workspaceStore, skillProbe, resolveRepoHandle, exec, getChoiceStore, logCtx, decideBackend } = {}) {
  const store = workspaceStore || null
  // skillProbe 为可选：未注入时返回空技能集（正交，复用 host probeSkill 旧逻辑但不在二联版强依赖）
  const probeSkills = typeof skillProbe === 'function' ? skillProbe : async () => ({ ok: true, missing: [], probes: {} })

  async function detect(handle, opts = {}) {
    // #709（T5 补）一次评估里环境预检只花一次：调用方可以为自己这一次求值交来一个「外部命令执行器」，
    //   本函数这一整轮（含下面那次 preflight）都用它。检查链那边交来的是一个包过的执行器，
    //   同一轮里成名的两条预检命令（登录态、仓库可达）因此只真问一次，后端链的谓词复用同一份结论。
    //   没交（其它调用方，例如 wf.detect）就照原样用注入进来的那个 exec —— 少省那两条，行为不变。
    const execForThisRound = (typeof opts.exec === 'function') ? opts.exec : exec
    // 规整钥匙（地图 #278 A 方案）：workspaceStore 按 handleKey=cwd|refId 分桶，写读删必须同形。
    // 入口先洗 cwd（空值保持空串——上层 handler 已回退 DEFAULT_CWD；洗钥匙异常则回退原串）。
    if (handle && typeof handle.cwd === 'string' && handle.cwd) {
      try {
        const ck = await canonicalWorkspaceKey(handle.cwd, { getPlatform, getFs })
        if (ck) handle = Object.assign({}, handle, { cwd: ck })
      } catch (e) {}
    }
    const cwd = (handle && handle.cwd) || ''
    // #1003 空目录语义：拿不到目录时按未知处理——不产出“没有后端”的结论、不起任何外部命令。
    //   调用方（面板）据此显示“工作区还没就绪”，就绪后自行恢复。
    if (!cwd) {
      return { handle: { cwd: '' }, selection: null, repoHandle: { cwd: '', refId: '' }, explicit: { raw: null, parsed: { explicitBackendId: null, rawHint: '', confidence: 'none', reason: 'empty-cwd' } }, preflight: null, skillProbes: null, at: Date.now(), rev: 0, fromHint: false, choiceSource: 'empty-cwd' };
    }
    const force = !!opts.force
    const platform = getPlatform ? await getPlatform() : null
    const fs = getFs ? getFs() : (platform && platform.fs) || null
    const timers = getTimers ? getTimers() : null
    // #1003 契约（2026-10-12 维护者拍板）：本机记忆（H）已从判定链里退出——它只用来把工作区配置文件
    //   生成一次（那条路在工作区入口的迁移里），此后不再参与判定，也不再作缓存作废的判据。
    //   所以这里不再读它；缓存作废只看两条：工作区是否已空、配置文件有没有被改过（下面那段）。
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
          // 原来这里还有一条「按记忆修订号作废缓存」的判据（#683 R2c）：记忆已退出判定（#1003 契约
          //   2026-10-12），判据一并撤掉——留着它会让缓存每次都被判过期（缓存里的修订号恒为 0，
          //   而记忆里那条的修订号非 0），等于缓存白做。
          // 手改配置文件即时生效（#1003 甲）：缓存时记下了文件的修改时间，对不上就重算；
          // 取不到时间（无文件、读不出）按“判不了”处理，不误判（出现与消失照样算对不上）。
          try {
            if (cached.fileMs !== undefined) {
              const nowMs = await workspaceFileMs(cwd, platform)
              if (nowMs !== cached.fileMs) isStale = true
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

    // ① explicit(file) 分支：读锚文件（声明）。**照旧每次都读** —— 结果里的 explicit 一栏要带给调用方
    //   （界面与排查都用它看「用户仓库里那份文件写的是什么」），与「这一次采用谁」是两件事。
    const explicitRes = await detectExplicit(handle, { platform, cwd, fs }, registry)
    let selection = explicitRes.selection
    const explicit = { raw: explicitRes.raw, parsed: explicitRes.parsed }

    // ② 唯一真源是工作区里的配置文件，判定顺序由统一判定出口定（内存绑定 → 工作区文件 → 声明文件 → 本机记忆 → 自动识别）。
    //   调用方上报的选择与修订号一律忽略：用户点确认走写入口落文件，不经上报参数；这里再判一次就是第二套答案（#1003 老路径已删）。
    // #1003 单出口：调用方经平台层把统一判定函数递进来时，选择整段交出去；没递时按锚文件结论诚实返回，不另起第二套判定。
    const useOutlet = (typeof decideBackend === 'function') ? decideBackend : null
    const describeOf = function (id) { try { return registry.describe(handle, id) } catch (e) { return null } }
    let choiceRev = 0
    const choiceFromHint = false
    let choiceSource = ''
    if (useOutlet) {
      const autoHook = async function (h, c) {
        const opCtx = buildOpContextBase(cwd, platform, fs, timers, execForThisRound, 'detect-select')
        if (opts.signal) opCtx.signal = opts.signal
        opCtx.caller = 'detection-service'
        return registry.select(h, Object.assign({}, opCtx, { caller: (c && c.caller) || 'detection-service' }))
      }
      // #1003 契约（2026-10-12）：判定链里已没有「本机记忆」这一层，所以这里也不再为它算「工作区是否已空」，
      //   更不往出口递记忆口子（getChoiceStore）——出口已经不读它了。
      const o = await useOutlet(cwd, { registry: registry, platform: platform, fs: fs, caller: 'detection-service', signal: opts.signal, autodetect: autoHook }).catch(function () { return null })
      const mapped = (useOutlet.selectionFromOutlet && o) ? useOutlet.selectionFromOutlet(o, describeOf) : null
      if (mapped && mapped.backendId) {
        selection = mapped
        choiceSource = (o.origin || '')
      } else if (!selection) {
        selection = mapped || { backendId: null, source: 'fallback' }
        choiceSource = (o && o.origin) || 'none'
      }
    }
    // 老路径已删：此处原为上报优先的第二套判定（含修订号四档仲裁），与统一判定出口互为两个真相，现整块移除（#1003）。
    // ③ 自动识别由统一判定出口内含（经递进来的自动识别执行器跑，含超时与中止信号），这里不再另跑一次。
    //   没走出口又没结论时如实返回未知（锚文件那一份），不猜。

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
          const opCtx2 = buildOpContextBase(cwd, platform, fs, timers, execForThisRound, 'detect-preflight')
          if (opts.signal) opCtx2.signal = opts.signal
          // preflight 可能经 ghClient 走 subprocess，需传 platform
          opCtx2.platform = platform
          preflight = await tracker.preflight(repoHandle, opCtx2)
        }
      } catch (e) {
        preflight = { ok: false, error: { kind: 'network', message: String((e && e.message) || e).slice(0, 300) } }
      }
    }

    // 技能正交探测（复用 host probeSkill 逻辑；名单由探针闭包按范围选）
    let skillProbes = null
    // #284：wf.chain 只取 selection，跳过技能探测（避免等待计数被链加载外的轮次推进；计数仅随真实探针轮次推进）
    // #968 技能按需：调用方明确说要全量就问全量，人亲手重查（force）问全量，其余平时只问链条要的三项。
    // 范围与重查标记一起交过去：重查的那一次单项探测绕过短时记住，刚装好的技能立即可见。
    if (!opts.skipSkillProbes) { try { skillProbes = await probeSkills({ cwd, platform, skillScope: opts.skillScope || (force ? 'full' : 'chain'), force: force }) } catch { skillProbes = null } }

    const result = {
      handle: { cwd },
      selection,
      repoHandle,
      explicit,
      preflight,
      skillProbes,
      at: Date.now(),
      // #683（F1 · ADR 的 R4）：权威修订号挂在每一次答复上（与 selection.rev 同一个值，另给一处方便调用方取）。
      rev: choiceRev,
      // 这一次的结论是不是「客户端报上来的选择」得出的：老路径已删，恒为 false（上报不再参与判定）。
      fromHint: choiceFromHint,
      choiceSource: choiceSource,
      // 手改配置文件即时生效的判据（#1003 甲）：缓存校验用，调用方按普通元数据忽略。
      fileMs: null,
    }

    // 缓存：pending 不缓存（Q6）；force 重算后仍按同规则决定是否入缓存
    // #195 修复：env 失败不入缓存（见上）
    if (store && selection && !selection.pending) {
      const pf2 = result.preflight
      const isEnvFail2 = pf2 && !pf2.ok && pf2.error && pf2.error.kind === 'env'
      if (!isEnvFail2) { try { result.fileMs = await workspaceFileMs(cwd, platform); store.set(handle, result) } catch {} }
    }
    return result
  }

  return { detect, handleKey: (h) => (h.cwd || h.refId || String(h)) }
}

export default createDetectionService