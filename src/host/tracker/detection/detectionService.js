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

export function createDetectionService({ registry, getPlatform, getFs, getTimers, workspaceStore, skillProbe, resolveRepoHandle, exec, getChoiceStore, logCtx } = {}) {
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
    // #683（F1 · ADR 20260921 的 R3/R5c/R10）：读一次宿主侧那份记忆（H，用户选的后端按工作区记着）。
    //   读到的三种结局分得清：H 里有没有这条记录；这次是不是读不到（文件坏 —— 这一轮既不采纳 hint、
    //   也不往里写，见 R5c）。同一个工作区里**没有注册表认得的后端**那条记录也当没有（答出去只会画一个
    //   没有模块的后端）；工作区已空（#297）时那条记忆视为过期、同样不回答（H 的内容不动）。
    //   这一次 detect 里只读一次（几条分支都要用），所以在这里记住结果。
    let _hRead = null
    const readChoiceNow = async function () {
      if (_hRead) return _hRead
      _hRead = { found: false, rev: 0, backendId: null, pickedAt: 0, unreadable: false, reason: 'no-store' }
      try {
        const cs = typeof getChoiceStore === 'function' ? await getChoiceStore() : null
        if (!cs || typeof cs.getWorkspace !== 'function') return _hRead
        const got = await cs.getWorkspace(cwd)
        if (got && got.ok === false) { _hRead = { found: false, rev: 0, backendId: null, pickedAt: 0, unreadable: true, reason: got.reason || 'unreadable' }; return _hRead }
        if (!got || got.found !== true) { _hRead = { found: false, rev: 0, backendId: null, pickedAt: 0, unreadable: false, reason: 'miss' }; return _hRead }
        const known = !!(registry && typeof registry.has === 'function' && registry.has(got.backendId))
        if (!known) { _hRead = { found: false, rev: 0, backendId: null, pickedAt: 0, unreadable: false, reason: 'unregistered' }; return _hRead }
        let empty = false
        try { empty = await isWorkspaceEmpty(cwd, platform) } catch (e) {}
        if (empty) { _hRead = { found: false, rev: 0, backendId: null, pickedAt: 0, unreadable: false, reason: 'workspace-empty' }; return _hRead }
        _hRead = { found: true, rev: Number.isInteger(got.rev) ? got.rev : 0, backendId: got.backendId, pickedAt: got.pickedAt || 0, unreadable: false, reason: '' }
      } catch (e) {}
      return _hRead
    }
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
          // #683（F1 · ADR 的 R2c）：这份缓存里的选择还作不作数，要看那份记忆（H）变过没有。
          //   判据是「当时那条的修订号」与「H 现在的修订号」对不对得上（H 里没有记录时按 0 算）——
          //   对不上就丢掉重算：只换了后端时，其余内容一个字没变，光看快照版本号是看不出来的。
          //   这条比 ADR 写的还严一格：除了「带 hint 的那一次」，连「按锚文件答出来、而别的壳刚绑过」
          //   这一种也一起收进来了（那一种同样会让面板头与链说两个后端）。
          try {
            const hNow = await readChoiceNow()
            const cachedRev = Number.isInteger(cached.selection.rev) ? cached.selection.rev : 0
            const wantedRev = hNow.found ? hNow.rev : 0
            if (cachedRev !== wantedRev) isStale = true
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

    // ② 用户的手动选择（意图）：ADR 20260921 定的顺序是「人的意图 > 人写下过的声明 > 机器推断」——
    //   所以带 hint 的那一次调用**压过锚文件**（此前是「锚有结论时本分支不参与」，那条 2026-08-27 的
    //   顺序在真机上表现成「面板里切了后端，仓库标仍是旧后端」：锚文件写着 GitHub，快照照旧回 GitHub，
    //   客户端再把用户刚选的那一条盖掉）。
    //   谁算「用户的手动选择」：只有客户端能分清 —— 用户亲手点过的那条选择带 userPicked 标记，
    //   客户端只把带标记的那条当 hint 上报；派生出来的选择（快照/链/自动识别的结论）不带标记、不上报。
    //   这一条是 ADR 攻击 1 的整改：不区分来源的话，锚文件的历史结论会被缓存下来冒充用户意图，
    //   之后谁改锚文件都不再生效（比修之前更糟）。宿主这一侧不做判别：上报即信任，判别在客户端那一次写入。
    //   未注册 id 忽略（诚实）→ 落回锚文件。
    //   #297 失效维度：工作区已空（文件全删）时「记忆里的选择」视为过期 —— 那条判定在缓存分支、
    //   本文件那份记忆（H）的读法里，以及 `registry.select` 的记忆侧；带 hint 的这一次是用户当场的选择，照采纳。
    // ②b #683（F1 · ADR 的 R3）：用户的选择有两份存储 —— 客户端报上来的 hint（带它上次收到的修订号
    //   baseRev）与宿主侧那份记忆（H）。两份都会旧，所以按**宿主发号的修订号**判谁说话，四档：
    //   ① H 里没有这条 → 采纳 hint，并把它落进 H（一次性迁移；老记录没有版本位，只在这一档被采纳一次）；
    //   ② hint 的 baseRev 与 H 的 rev 相等 → 采纳 hint（客户端手里就是最新那一版）；
    //   ③ baseRev 更旧、或压根没带版本位 → **不采纳**，按 H 回答并把 H 的值与 rev 回给客户端
    //      （这一档就是维护者点名的「localStorage 还是老状态时不许说话」）；
    //   ④ 客户端没报选择（新壳、清了缓存、换了访问地址）→ 也按 H 回答（跨壳、跨重启不失忆的那一半）。
    //   文件坏的那一轮（R5c）既不采纳 hint、也不写；用户当场点确认的那一通走的是 wf.bind（它先把 H 推到
    //   H.rev+1 再回包），所以下一轮它的 baseRev 与 H.rev 必然相等 —— 当场那一下永远赢，不必在这条路上特判。
    const hintUsable = !!(opts.hintBackendId && registry && typeof registry.has === 'function' && registry.has(opts.hintBackendId))
    const hintRev = (Number.isInteger(opts.baseRev) && opts.baseRev > 0) ? opts.baseRev : 0
    let choiceRev = 0
    let choiceFromHint = false
    let choiceSource = ''
    {
      const h = await readChoiceNow()
      const describeOf = function (id) { try { return registry.describe(handle, id) } catch (e) { return null } }
      const fromH = function () {
        selection = { backendId: h.backendId, source: 'explicit', ref: describeOf(h.backendId), rev: h.rev, pickedAt: h.pickedAt }
        choiceRev = h.rev
        choiceSource = h.reason || 'h'
      }
      if (h.unreadable) {
        // R5c：文件存在但读不出来/形状不对 → 这一轮既不采纳 hint、也不往里写（半截文件不许把浏览器里那份
        //   可能更旧的选择重新灌进来并永久化）。选择保持锚文件读出来的那一份。
        choiceSource = 'file-bad'
      } else if (hintUsable && h.found && hintRev !== h.rev) {
        // 档三：客户端手里那份比宿主记的旧（含没带版本位）→ 按 H 回答。
        //   ADR 的 R11 那条「被更旧的 hint 顶回」：用户报「刚选完又变回去了」时，这是唯一的轨迹。
        try { if (logCtx && logCtx.isEnabled('debug')) logCtx.fire('debug', 'choiceStore.hint.reject', { keyHash: hash8(cwd), baseRev: hintRev, rev: h.rev }) } catch (eL) {}
        fromH()
      } else if (hintUsable) {
        // 档二（以及档一）：采纳用户报上来的这一条
        let ref = null
        try { ref = registry.describe(handle, opts.hintBackendId) } catch {}
        selection = { backendId: opts.hintBackendId, source: 'explicit', ref: ref, rev: hintRev }
        choiceRev = hintRev
        choiceFromHint = true
        if (!h.unreadable && !h.found) {
          // 档一：宿主还没记过这个工作区 → 把这条落进 H（ADR 的 R1 第二条写路：一次性迁移），
          //   并把宿主发的新修订号带上（客户端拿到之后此后上报都带着它）。
          try {
            const cs = typeof getChoiceStore === 'function' ? await getChoiceStore() : null
            if (cs && typeof cs.rememberWorkspace === 'function') {
              const w = await cs.rememberWorkspace(cwd, opts.hintBackendId)
              if (w && w.ok === true) { choiceRev = w.rev || 0; selection.rev = choiceRev; choiceSource = 'migrated' }
            }
          } catch (eMig) {}
        }
      } else if (h.found) {
        fromH() // 档四：客户端没报选择 → 按 H 回答
      }
    }

    // ③ matches > fallback（经 registry.select，含 pending/multiHit + 超时 3000ms + AbortSignal）
    if (!selection) {
      const opCtx = buildOpContextBase(cwd, platform, fs, timers, exec, 'detect-select')
      // 若调用方传 signal，可在此注入 opCtx.signal = opts.signal（registry withTimeout 内部会合并）
      if (opts.signal) opCtx.signal = opts.signal
      opCtx.caller = 'detection-service'; selection = await registry.select(handle, opCtx)
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
          const opCtx2 = buildOpContextBase(cwd, platform, fs, timers, exec, 'detect-preflight')
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
      // #683（F1 · ADR 的 R4）：权威修订号挂在每一次答复上（与 selection.rev 同一个值，另给一处方便调用方取）。
      rev: choiceRev,
      // 这一次的结论是不是「客户端报上来的选择」得出的（R2c）。缓存那一条要用它判新旧，也是 R11 那句
      // 「H 命中 / 未命中 / 被更旧的 hint 顶回」要记的现场。
      fromHint: choiceFromHint,
      choiceSource: choiceSource,
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