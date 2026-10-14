/**
 * tracker/detection/detectionService.ts — 探测级联编排（~80 行二联骨架 + 增量预留）
 *
 * 第一性原理（#150 7项 + #151 聚合向导式 + #149 9项映射 + #113 + 契约 §2）：
 *  - 四层严格：前端只调 wf.detect/wf.chain（#284：九格目录视图与 wf.status 已退役）；探测零 OS 直碰（仅 platform.fs/exec/path/env）；
 *    后端只暴露 matches/preflight/describe；DetectionService 唯一持有 registry 单例 + buildOpContext
 *  - 三级联：explicit(file) > matches(registry.select 并行，兜底等待缺省 30 秒见 registry/core.ts 的 MATCHES_TIMEOUT_MS + AbortSignal) > fallback(null)；
 *    pending=true 阻塞态必须 surface（不静默 fallback），multiHit 暴露纠正（#150 Q5）
 *  - 轻量化二联版先通 explicit→matches 主路径；preflight 惰性仅命中后调，pending 不缓存（Q6）
 *  - per-workspace：handleKey=cwd|refId 内存 Map<handleKey→Selection> 不落盘（Q3，workspaceStore）
 *  - RPC：wf.detect → DetectionResult{selection,preflights,repoHandle,skillProbes,at,explicit}；检查链真源为 wf.chain（Q7）
 *  - 契约 §2 capability-by-fill：探测不产能力表，能力视图仅诊断不驱动隐藏
 */

import { detectExplicit } from './explicitDetector.js'
import { resolveSelection } from './selection-precedence.js'
import { canonicalWorkspaceKey } from '../../host/workspaceKey.js'
import { ERROR_KIND } from '../contract/vocabulary.js'
import { fail } from '../kernel/preflight.js'
// 判定链上游用的是契约里的形状，本文件跟着用同一份：跨层传的东西自己再抄一份，迟早会与契约对不上。
import type { RepoHandle } from '../contract/contexts.js'
import type { RepositoryRef } from '../contract/entities.js'
import type { Selection } from '../contract/results.js'
import type { ExplicitDetectCtx } from './explicitDetector.js'

// ── 本文件用到的外部形状 ──────────────────────────────────────────────────────────
// 按仓里既有口径（样板见 src/host/git-process.ts 头部）：形状按本文件实际用到的部分写，不把别人的
// 类型整包搬进来；从外面进来的东西一律按最小形状收，收不到就按 unknown 挡一道。各字段可选与否
// 跟着本文件的分支走：代码里有「没有就退让」的那几件就是可选的，没有退让分支的就是必需的。
/** 平台层：本文件只碰这几格（文件系统、路径拼接）。 */
interface PlatformLike {
  fs?: FsLike | null
  path?: { join?: (a: string, b: string) => string } | null
}
/** 文件系统能力。每个方法都可选：不同环境下平台层给的形态不一样，下面那些兼容分支就是为这件事写的。 */
interface FsLike {
  resolve?: (p: string, opts?: { cwd?: string }) => Promise<string>
  listDir?: (p: string) => Promise<unknown[]>
  readdir?: (p: string) => Promise<unknown[]>
  lstat?: (p: string) => Promise<unknown>
  stat?: (p: string) => Promise<{ mtimeMs?: number; mtime?: unknown } | null>
}
/** 定时器。注入进来是为了让调用方（含门禁）能换掉时钟。 */
interface TimersLike {
  setTimeout: (fn: () => void, ms?: number) => unknown
  clearTimeout: (id?: number) => void
}
/** 外部命令执行器。最后那个 via 是本文件包的，用来在日志里说清「这条链叫什么」。 */
type ExecLike = (cmd: string, args: readonly string[], opts?: unknown, via?: string) => unknown
/** 日志出口（平台层递进来的那一份）：有 isEnabled 与 fire 两个方法，见 host/platformChannel.js。 */
interface LogCtxLike {
  isEnabled: (level: string) => boolean
  fire: (level: string, event: string, fields: Record<string, unknown>) => void
}
/** 判定句柄：契约里的形状（工作区目录 + 仓库号）。 */
type HandleLike = RepoHandle
/** 后端注册表：本文件只问它这几件事（有没有、拿一个后端、要一段描述、并行匹配）。 */
interface RegistryLike {
  has: (id: string) => boolean
  get: (id: string) => { preflight?: (handle: unknown, ctx: unknown) => Promise<{ ok?: boolean; error?: { kind?: string } } | null> } | null
  describe: (handle: HandleLike, id: string) => RepositoryRef
  select: (handle: HandleLike, ctx: unknown) => Promise<unknown>
}
/** 缓存里那一条判定结果：本文件读它的这几格（结论、预检、文件时间、写入时刻）。 */
interface CachedResultLike {
  selection?: { backendId?: string | null; pending?: boolean; ref?: { refId?: string } | null } | null
  preflight?: { ok?: boolean; error?: { kind?: string } } | null
  fileMs?: number | null
  at?: number
}
/** 工作区缓存：本文件只用到这四件事（取、存、作废、算键）。 */
interface WorkspaceStoreLike {
  get: (handle: HandleLike) => CachedResultLike | null
  set: (handle: HandleLike, value: unknown) => void
  invalidate: (handle: HandleLike) => void
  handleKey: (handle: HandleLike) => string
}
/** 统一判定出口：本文件按这一个形状调它（真源见 backendDecision.ts）。 */
interface DecideBackendLike {
  (cwd: string, opts: Record<string, unknown>): Promise<{ origin?: string } | null>
  selectionFromOutlet?: (answer: unknown, describeOf: (id: string) => unknown) => Selection | null
}
/** 技能探测：名单由探针闭包按范围选（见 host probeSkill）。 */
type SkillProbeLike = (opts: { cwd: string; platform: PlatformLike | null; skillScope: string; force: boolean }) => Promise<unknown>
/** 服务依赖。除 registry 外都可省：省掉的那件按本文件里「没有就退让」的分支走。 */
interface DetectionServiceDeps {
  registry: RegistryLike
  getPlatform?: () => Promise<PlatformLike | null>
  getFs?: () => FsLike | null
  getTimers?: () => TimersLike | null
  workspaceStore?: WorkspaceStoreLike | null
  skillProbe?: SkillProbeLike
  resolveRepoHandle?: (handle: HandleLike) => Promise<{ cwd: string; refId: string }>
  exec?: ExecLike | null
  getChoiceStore?: (() => Promise<unknown>) | null
  logCtx?: LogCtxLike | null
  decideBackend?: DecideBackendLike
}
/** detect 这一次的调用选项。 */
interface DetectOptions {
  force?: boolean
  exec?: ExecLike
  caller?: string
  withOutlet?: boolean
  signal?: unknown
  skipSkillProbes?: boolean
  skillScope?: string
}
/** 一次判定用的操作上下文（BackendContext & {cwd, signal} 的按需形状）。 */
interface OpContextLike {
  cwd: string
  platform: PlatformLike | null
  fs: FsLike | null
  exec: ((cmd: string, args: readonly string[], opts?: unknown) => unknown) | null
  timers: TimersLike
  signal?: unknown
  logEvent?: (level: string, event: string, fields: Record<string, unknown>) => void
  isEnabled?: (level: string) => boolean
  caller?: string
}

// 工作区短指纹（只记散列、不记路径原文）。与 repoKeys.js / logStore.js 同一种取法，各文件自带一份是仓里既有写法。
function hash8(text: unknown) {
  let h = 5381
  const s = String(text || '')
  for (let i = 0; i < s.length; i++) h = (((h << 5) + h + s.charCodeAt(i)) >>> 0)
  return ('0000000' + h.toString(16)).slice(-8)
}

function buildOpContextBase(cwd: string, platform: PlatformLike | null, fs: FsLike | null, timers: TimersLike | null, exec: ExecLike | null | undefined, via: string, logCtx: LogCtxLike | null | undefined) {
  // 注意：本文件从前整份被门禁切碎求值，所以一直没写类型标注。裁决顺序抽到 selection-precedence.ts
  // 之后（#1169），那三条门禁改成不再切源码，这里照常写标注。
  const ctx: OpContextLike = {
    cwd,
    platform,
    fs: fs || (platform && platform.fs) || null,
    // OpContext 契约 = BackendContext & {cwd, signal}；BackendContext 必含 exec（src/tracker/contract/contexts.ts）。
    // #幽灵修复：preflight 的 ghClient/glab 依赖 ctx.exec 执行 gh/glab——缺失时假报 env 失败
    // （"ctx.exec unavailable"→被 wf.chain 谓词呈为「gh 未找到」链步）。
    // #606:exec 外面包一层，把「这条链叫什么」传给起进程的接缝，日志才答得出「由谁触发」。
    exec: (typeof exec === 'function') ? function (cmd, args, opts) { return exec(cmd, args, opts, String(via || 'unspecified')) } : null,
    timers: timers || { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (id) => clearTimeout(id) },
    signal: undefined,
  }
  // #1111 决策 9：探测这条路上也要留得下判档轨迹（每次失败判成哪一档、依据哪一档事实）。
  //   logCtx 是平台层递进来的日志出口（有 isEnabled 与 fire 两个方法，见 host/platformChannel.js）。
  //   没递就一个键都不加：判定照常做、只是留不下轨迹——与各房「有 ctx.logEvent 才记」的既有口径一致。
  if (logCtx && typeof logCtx.fire === 'function' && typeof logCtx.isEnabled === 'function') {
    ctx.logEvent = function (level, event, fields) { try { logCtx.fire(level, event, fields) } catch (e) {} }
    ctx.isEnabled = function (level) { try { return logCtx.isEnabled(level) === true } catch (e) { return false } }
  }
  return ctx
}

/**
 * 判定工作区是否已空（#297 失效维度）。
 * 依据：目录本身存在但 listDir/readdir 后 meaningful 为空 → 视为“全部文件已删”，此前持久化选择应失效。
 * 过滤常见无意义占位（.DS_Store 等），保留 .git/.scratch 等有意义条目；平台或 fs 不可用时保守返回 false（不误判 stale，保 #247 防抖）。
 * 兼容多种 fs 形态：优先 listDir+resolve，回退 readdir/readdirSync/lstat 探针，避免单接口缺失导致永远不 stale。
 */
async function isWorkspaceEmpty(cwd: string, platform: PlatformLike | null) {
  try {
    if (!cwd) return false
    const fs = platform && platform.fs
    if (!fs) return false
    // 尝试列目录：优先 listDir+resolve，回退 readdir
    let entries: unknown[] | null = null
    try {
      if (typeof fs.listDir === 'function' && typeof fs.resolve === 'function') {
        let target: string
        try { target = await fs.resolve(cwd) } catch { target = cwd }
        entries = await fs.listDir(target)
      } else if (typeof fs.readdir === 'function') {
        entries = await fs.readdir(cwd)
      } else if (typeof fs.listDir === 'function') {
        entries = await fs.listDir(cwd)
      }
    } catch {}
    if (Array.isArray(entries)) {
      const names = entries.map((e) => typeof e === 'string' ? e : (((e as { name?: string } | null) || {}).name) || '').filter(Boolean)
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
async function workspaceFileMs(cwd: string, platform: PlatformLike | null) {
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
        if (typeof ms === 'number' && Number.isFinite(ms)) return ms
      } catch {}
    }
  } catch {}
  return null
}

// 默认那个 `{}` 是照旧留着的入口形状（历史上调用方可以什么都不递）。类型上不假装依赖可选：
// registry 是必需的，省略它在今天也会在第一次用到时当场抛——这一点没有被类型检查改变。
export function createDetectionService({ registry, getPlatform, getFs, getTimers, workspaceStore, skillProbe, resolveRepoHandle, exec, getChoiceStore, logCtx, decideBackend }: DetectionServiceDeps = {} as DetectionServiceDeps) {
  const store = workspaceStore || null
  // skillProbe 为可选：未注入时返回空技能集（正交，复用 host probeSkill 旧逻辑但不在二联版强依赖）
  const probeSkills = typeof skillProbe === 'function' ? skillProbe : async () => ({ ok: true, missing: [], probes: {} })

  /**
   * #1131：判定出口上一次的「原话」，按工作区另存一份，只交给明确要素材的调用方（改色电话）。
   *
   * 为什么改色电话要素材：`selectionFromOutlet` 交出去的永远只有五个字段（backendId / source / ref /
   *   multiHit / pending，见 backendDecision.ts 那一段注释），出口原话里的 `canWrite`（这一次的结论算不算
   *   「人亲手选过」）不在里面，而改色电话的写用途正是按它决定放不放行。从前它自己直调出口，原话当场就有；
   *   现在它改吃这份带缓存的探测结果，就得把原话一并留着，分档依据不许自己再推一遍。
   * 为什么不塞进 detect 的返回或缓存条目里：wf.detect 那条电话把整个结果摊开回给客户端
   *   （src/host/detectChain.ts 的 `{ ok: true, ...res }`），塞进去等于把内部判定细节变成对外结构——
   *   本票边界写明「不动对外返回结构」。所以另存一份，只有带 `withOutlet: true` 来问的那一路拿得到。
   * 读得到的前提与缓存一致：这一份与 store 的写入发生在同一处、同一个键；store 里没有可用条目时，
   *   detect 根本走不到「回原话」那一步，所以过了期的原话不会被读走。
   */
  const outletByKey = new Map()

  async function detect(handle: HandleLike, opts: DetectOptions = {}) {
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
    // #1131：这一次是谁来问的（改色电话填 wf.listLabels / wf.setLabelColors）。判定出口的 ctx、
    //   自动识别那一步的 ctx 与「命中缓存」那一行日志都用它；没给就按本服务的名字记。默认值只留这一处：
    //   从前它在两处硬编码，任何新调用方都会被记成「探测服务自己问的」，事后分不清是谁引发的重算。
    const caller = (typeof opts.caller === 'string' && opts.caller) ? opts.caller : 'detection-service'
    // #1131：只有明确要素材的调用方（改色电话）能拿到判定出口的原话，见上面 outletByKey 的说明。
    const wantOutlet = opts.withOutlet === true
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
            // #1131：命中缓存——这一次不重跑判定链（工作区文件、声明文件、自动识别一次都不问），
            //   直接把上一份结论回给调用方。按需日志记一行：谁问的、哪条工作区、这一格存了多久，
            //   让「改色电话到底吃没吃到缓存」这类问题不用靠反推（存储层那条 workspaceStore.hit 是
            //   1/100 采样，看不准是哪一路问的、也看不见调用方）。
            try {
              if (logCtx && logCtx.isEnabled('debug')) {
                logCtx.fire('debug', 'detection.cache.hit', { cwdHash: hash8(cwd), caller: caller, ageMs: Date.now() - (Number(cached.at) || 0) })
              }
            } catch (eL) {}
            // 出口原话与这份缓存同一次写入（见下面 store.set 那一处），这里按键取回；取不到就回 null，
            //   由调用方按「这一次没拿回判定结果」如实分档（不猜，也不退回第二套判定）。
            if (wantOutlet) {
              let raw = null
              try { raw = outletByKey.has(store.handleKey(handle)) ? outletByKey.get(store.handleKey(handle)) : null } catch (eK) {}
              return Object.assign({}, cached, { outlet: raw })
            }
            return cached
          }
        }
      }
    }

    // ① explicit(file) 分支：读锚文件（声明）。**照旧每次都读** —— 结果里的 explicit 一栏要带给调用方
    //   （界面与排查都用它看「用户仓库里那份文件写的是什么」），与「这一次采用谁」是两件事。
    // 平台层形状按契约收窄：上游递下来的那份可能少几个方法（上面 isWorkspaceEmpty / workspaceFileMs 里的
    // 兼容分支就是为这件事写的），而 detectExplicit 只用 resolve 与 readText 两个（见它的 ExplicitDetectCtx）。
    const explicitRes = await detectExplicit(handle, { platform: platform as ExplicitDetectCtx['platform'], cwd, fs }, registry)
    let selection = explicitRes.selection
    const explicit = { raw: explicitRes.raw, parsed: explicitRes.parsed }

    // ② 唯一真源是工作区里的配置文件，判定顺序由统一判定出口定（工作区文件 → 声明文件 → 自动识别，见
    //   src/tracker/detection/backendDecision.ts）。#1138 之前这里还写着「内存绑定」「本机记忆」两层，两层都已不在判定里。
    //   调用方上报的选择与修订号一律忽略：用户点确认走写入口落文件，不经上报参数；这里再判一次就是第二套答案（#1003 老路径已删）。
    // #1003 单出口：调用方经平台层把统一判定函数递进来时，选择整段交出去；没递时按锚文件结论诚实返回，不另起第二套判定。
    const useOutlet = (typeof decideBackend === 'function') ? decideBackend : null
    const describeOf = function (id: string) { try { return registry.describe(handle, id) } catch (e) { return null } }
    let choiceRev = 0
    const choiceFromHint = false
    // 裁决顺序在 selection-precedence.ts（唯一真源）。这里先把「锚文件的结论」放进去：出口没被问过时，
    //   如实返回锚文件的结论（可能是「不知道」），不产出兜底——与 #1003 之后的行为逐字一致。
    let verdict = resolveSelection({ declared: selection, outletConsulted: false, outlet: null, outletOrigin: null })
    // #1131：出口这一次的原话（带 canWrite 的那一份完整答案），命中缓存时要连同缓存一起回给改色电话，
    //   所以才要按工作区留一份（见 outletByKey 的说明）。出口没装或抛错时它保持 null，调用方如实分档。
    let outletAnswer: { origin?: string } | null = null
    if (useOutlet) {
      // 补全点之一：从这几行往下，opCtx 一定带 `caller`（调用方给了就用调用方的，
      // 没给就填 `detection-service`），形状见契约里的 `EnrichedOpContext`。下游只许读，不许再改。
      const autoHook = async function (h: HandleLike, c: { caller?: string } | null) {
        const opCtx = buildOpContextBase(cwd, platform, fs, timers, execForThisRound, 'detect-select', logCtx)
        if (opts.signal) opCtx.signal = opts.signal
        opCtx.caller = 'detection-service'
        return registry.select(h, Object.assign({}, opCtx, { caller: (c && c.caller) || 'detection-service' }))
      }
      // #1003 契约（2026-10-12）：判定链里已没有「本机记忆」这一层，所以这里也不再为它算「工作区是否已空」，
      //   更不往出口递记忆口子（getChoiceStore）——出口已经不读它了。
      // #1048：把日志出口一并递给统一判定出口 —— 结论线（常驻 detection.detect）与步骤线（按需
      //   detection.step）都在出口那一处发，四条路（面板、deck 工具、改色电话、探测服务）因此说同一件事。
      //   以前是面板那条路自己在 src/host/detectChain.ts 里补发一条结论，出口这一层什么也不记；
      //   出口发得出之后，那条重复的已删。日志出口是可选的：这里没有（平台层没递）就只是留不下轨迹，判定照做。
      const o = await useOutlet(cwd, { registry: registry, platform: platform, fs: fs, caller: caller, signal: opts.signal, autodetect: autoHook, logCtx: logCtx }).catch(function () { return null })
      outletAnswer = o || null
      const mapped = (useOutlet.selectionFromOutlet && o) ? useOutlet.selectionFromOutlet(o, describeOf) : null
      // 出口问过了：这一次采用谁交给 selection-precedence.ts 裁决（出口有答案 → 锚文件 → 出口的无答案那份 → 兜底）。
      // 调用方上报的选择（opts.hintBackendId）不是一层，这里连传都不传——它今天不参与判定。
      verdict = resolveSelection({ declared: selection, outletConsulted: true, outlet: mapped, outletOrigin: (o && o.origin) || null })
    }
    selection = verdict.selection
    const choiceSource = verdict.choiceSource
    // 老路径已删：此处原为上报优先的第二套判定（含修订号四档仲裁），与统一判定出口互为两个真相，现整块移除（#1003）。
    // ③ 自动识别由统一判定出口内含（经递进来的自动识别执行器跑，含超时与中止信号），这里不再另跑一次。
    //   没走出口又没结论时如实返回未知（锚文件那一份），不猜。

    // repoHandle：轻量化复用 getRepoKey 语义中的 handle → describe ref
    let repoHandle: { cwd: string; refId: string } | null = null
    try {
      if (selection && selection.ref) repoHandle = { cwd, refId: selection.ref.refId || '' }
      else if (typeof resolveRepoHandle === 'function') repoHandle = await resolveRepoHandle(handle)
      else repoHandle = { cwd, refId: (selection && selection.backendId) ? (handle.cwd || '') : '' }
    } catch { repoHandle = { cwd, refId: '' } }

    // 惰性 preflight：仅命中且非 pending 时调（Q6）
    let preflight: { ok?: boolean; error?: { kind?: string } } | null = null
    if (selection && selection.backendId && !selection.pending) {
      try {
        const tracker = registry.get(selection.backendId)
        if (tracker && typeof tracker.preflight === 'function') {
          const opCtx2 = buildOpContextBase(cwd, platform, fs, timers, execForThisRound, 'detect-preflight', logCtx)
          if (opts.signal) opCtx2.signal = opts.signal
          // preflight 可能经 ghClient 走 subprocess，需传 platform
          opCtx2.platform = platform
          preflight = await tracker.preflight(repoHandle, opCtx2)
        }
      } catch (e) {
        // 正常路径是「预检失败也返回不抛」，走到这里说明它意外抛了。
        // message 只留一句能让人看懂发生了什么的摘要（头一行、截到 120 字），完整原文交给 fail
        // 放进 error.raw：分类是启发式的、可能猜错，原文是让人自己判断的兜底，混进 message 就再也拿不全了。
        const oneLine = String((((e as { message?: unknown } | null) || {}).message) || e).split('\n')[0].slice(0, 120)
        preflight = fail(ERROR_KIND.NETWORK, '预检意外中断：' + oneLine, e)
      }
    }

    // 技能正交探测（复用 host probeSkill 逻辑；名单由探针闭包按范围选）
    let skillProbes: unknown = null
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
      fileMs: null as number | null,
    }

    // 缓存：pending 不缓存（Q6）；force 重算后仍按同规则决定是否入缓存
    // #195 修复：env 失败不入缓存（见上）
    if (store && selection && !selection.pending) {
      const pf2 = result.preflight
      const isEnvFail2 = pf2 && !pf2.ok && pf2.error && pf2.error.kind === 'env'
      if (!isEnvFail2) {
        try {
          result.fileMs = await workspaceFileMs(cwd, platform)
          store.set(handle, result)
          // #1131：与这份缓存同一次写入出口原话（同一个键）——以后命中这一格时，要素材的调用方
          //   （改色电话）才能拿回「同一次」的判定原话，而不是自己重算一份可能不一样的。
          try { outletByKey.set(store.handleKey(handle), outletAnswer) } catch (eK) {}
        } catch {}
      }
    }
    // #1131：素材只给明确要的那一路（改色电话）。其余调用方拿到的仍是原来那个形状，
    //   wf.detect 那条 `{ ok: true, ...res }` 也就不会多出键来（本票边界：不动对外返回结构）。
    return wantOutlet ? Object.assign({}, result, { outlet: outletAnswer }) : result
  }

  return { detect, handleKey: (h: HandleLike) => (h.cwd || h.refId || String(h)) }
}

export default createDetectionService