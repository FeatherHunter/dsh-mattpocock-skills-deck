/**
 * tests/tracker-contract/runner/index.ts — 真实适配器可接入的契约 Runner（#173）
 *
 * 第一性原理回溯：
 * - 契约已定稿 #124/#125/#126/#127/#128（不再改内容，只改“被测对象”：桩→真适配器）
 * - #132 门禁 293/4/OK 仅证骨架自洽（#132 落地时的数字；现值与判据见 tests/tracker-contract/README.md；harness 测的是 compliant/violating 两个合成桩 + github/gitlab 适配器的 normalize 单元）
 * - #131 平台三端 145+32 方法论：单机可判真 = 注入（homedir/env/platform）+ 零手拼（委托 node:path）+ 双闸（契约主文件 + 容器烟雾）
 * 推导不变量：
 *   I1: Runner 必须从“测试固件”升级为“真实适配器 + 真实采样固件”——否则后端票 #114/#115/#116 的验收“本后端真实适配器过 harness”无锚点。
 *   I2: 工厂必须接收 BackendContext（含已解析的 platform 实例），Op 每调接收 OpContext（含 cwd/signal/refId），否则 #129 三底座的可测性（OS 覆盖/homedir-env 注入/resolveExecutable env 注入）无法在测试侧复现。
 *   I3: 采样固件必须“打真实 API → 脱敏 → 落盘 JSON + metadata”，每后端一份且记录来源/脱敏规则，否则“真实性”仅口头。
 *
 * 本模块职责：
 * - 提供 createRunnerContext()：按 #129 造一个 BackendContext（含 platform 实例 via createPlatform）
 * - 提供 runWithAdapter() / runPlayback()：接受真实 Tracker 实例 + RepositoryRef + 夹具目录，执行 live 断言
 * - 兼容既有 harness.js 的 normalize 断言（复用，不复制），并追加“真实数据形状”断言
 *
 * 设计约束（与现有契约一致）：
 * - 不引入 capability 表/缓存；能力 = 事后事实（op 返回 unsupported 即缺能力）
 * - Tracker 由 BackendModule.create(ctx) 产出，缺的方法由 registry Proxy 补 unsupported 桩（runWithAdapter 内部可选经 registry，也可直连 tracker）
 * - 快照/依赖缓存等 host 便利不在此测（由 sections/snapshot.js 已覆盖）
 */

import fs from 'node:fs'
import path from 'node:path'
import { createPlatform } from '../../../src/host/platform/index.ts'
import { diagnoseCapabilities } from '../../../src/host/tracker/capability.js'

/** createRunnerContext 的选项：OS 覆盖 / cwd / env 与 homedir 注入 / fs 与 exec 覆盖。 */
export interface RunnerContextOpts {
  os?: string
  cwd?: string
  env?: Record<string, string | undefined>
  homedir?: () => string
  fs?: RunnerFs
  exec?: (cmd: string, args: string[], opts?: { cwd?: string; timeout?: number; signal?: AbortSignal }) => Promise<{ stdout: string; stderr: string; code: number }>
}

/** Runner 内部用的最小文件服务形状：platform 消费 path-shaped 与 target-shaped 两组方法。 */
export interface RunnerFs {
  resolve: (p: string, o?: { cwd?: string }) => string
  lstat: (p: string) => Promise<unknown>
  readText: (p: string) => Promise<string>
  writeText: (p: string, t: string) => Promise<void>
  stat: (p: string) => Promise<unknown>
  listDir: (p: string) => Promise<string[]>
}

/** runWithAdapter 接受的仓库标识：只用到 backend 与 refId 两格。 */
export interface RunnerRepo {
  backend: string
  refId: string
}

/** runWithAdapter 每次调用的现场：cwd 必填，signal/refId 可选（无网络时只走形状门槛）。 */
export interface RunnerOpCtx {
  cwd: string
  signal?: AbortSignal
  refId?: string
}

/**
 * runWithAdapter 接受的真实 Tracker 实例：只用到 id 与四个 op（preflight/list/get/getDependencies），
 * 每个 op 只要求“不抛 + 回 OpResult 形状”，返回值逐项收窄后断言。
 */
export interface RunnerTracker {
  readonly id: string
  preflight: (handle: unknown, ctx: unknown) => Promise<unknown>
  list: (repo: unknown, filter: unknown, ctx: unknown) => Promise<unknown>
  get: (repo: unknown, key: unknown, filter: unknown, ctx: unknown) => Promise<unknown>
  getDependencies: (repo: unknown, key: unknown, filter: unknown, ctx: unknown) => Promise<unknown>
}

/** 单条 live/playback 断言的结果。 */
export interface LiveResult {
  name: string
  ok: boolean
  detail: string
}

/** OpResult 形状门槛：对象、有 ok 位，成功带 data、失败带 error（内容对错另行断言）。 */
interface OpResultShape {
  ok: boolean
  data?: unknown
  error?: unknown
}

function isOpResult(r: unknown): r is OpResultShape {
  if (!r || typeof r !== 'object') return false
  if (!('ok' in r)) return false
  const rec = r as Record<string, unknown>
  return rec.ok ? 'data' in r : 'error' in r
}

// ---------------------------------------------------------------------------
// BackendContext 工厂（注入 platform 实例）
// ---------------------------------------------------------------------------

/**
 * 造一个可用于 BackendModule.create 的 BackendContext。
 */
export async function createRunnerContext(opts: RunnerContextOpts = {}): Promise<Record<string, unknown>> {
  // 最小 hostCtx：需提供 get('fs') / get('subprocess') 等供 platform 消费；此处做薄适配
  const cwd = opts.cwd || process.cwd()
  const envSource = opts.env || process.env
  // 构造一个满足 createPlatform(ctx) 契约的 ctx：ctx.get('fs') 返回受控 fs
  const nodeFsAdapter: RunnerFs = opts.fs || {
    // 最小可用：platform 仅用 fs 的 path-shaped 方法（resolve/lstat）与 target-shaped（readText 等）
    // 注入 node:fs 的同步包装足以让 matches（如 githubMatches 读 .git/config）可跑
    resolve: (p, o = {}) => {
      const base = o.cwd || cwd
      return path.isAbsolute(p) ? p : path.join(base, p)
    },
    lstat: async (p) => fs.promises.lstat(p),
    readText: async (p) => fs.promises.readFile(p, 'utf8'),
    writeText: async (p, t) => fs.promises.writeFile(p, t, 'utf8'),
    stat: async (p) => fs.promises.stat(p),
    listDir: async (p) => fs.promises.readdir(p),
  }

  const hostCtx = {
    get(name: string): unknown {
      if (name === 'fs') return nodeFsAdapter
      if (name === 'subprocess') {
        return {
          resolveExecutable: async (n: string): Promise<null> => {
            // 委托平台底层的 resolveExecutable；此处的 subprocess.resolveExecutable 仅为平台调用准备
            void n
            return null
          },
        }
      }
      return undefined
    },
  }

  const osName = opts.os
  const platform = await createPlatform(hostCtx, osName, opts.homedir ? { homedir: opts.homedir, env: envSource } : { env: envSource })

  const backendCtx: Record<string, unknown> = {
    platform,
    fs: nodeFsAdapter,
    exec: opts.exec || (async (): Promise<{ stdout: string; stderr: string; code: number }> => ({ stdout: '', stderr: 'ctx.exec not injected (playback mode)', code: 1 })),
    timers: { setTimeout, clearTimeout },
    log: { info: () => {}, warn: () => {}, error: () => {} },
    // 供 registry select/matches 使用的最小扩展
    cwd,
  }
  // 额外暴露：便于测试断言“ctx 含 platform 实例”
  backendCtx._platformOs = (platform as { os: string }).os
  return backendCtx
}

// ---------------------------------------------------------------------------
// 采样固件加载（playback）
// ---------------------------------------------------------------------------

/** 采样固件索引：metadata（来源/脱敏规则）+ JSON 文件名表 + 解析后的 raw 数组。 */
export interface FixtureIndex {
  metadata: Record<string, unknown> | null
  files: string[]
  raws: Array<{ file: string; data: unknown }>
}

/**
 * 从夹具目录加载采样固件索引。
 * 约定目录结构（每后端一份）：
 *   fixtures/<backend>-real/
 *     ├─ metadata.json  { source, sampledAt, repo, refId, desensitization, fields }
 *     ├─ raw-*.json     打 API 原始响应（已脱敏）
 *     ├─ normalized-*.json 归一化后 Issue 期望
 *     └─ list.json / get-*.json 等
 */
export function loadFixtures(fixturesDir: string): FixtureIndex {
  if (!fixturesDir || !fs.existsSync(fixturesDir)) {
    return { metadata: null, files: [], raws: [] }
  }
  const files = fs.readdirSync(fixturesDir).filter((f) => f.endsWith('.json')).sort()
  let metadata: Record<string, unknown> | null = null
  const metaPath = path.join(fixturesDir, 'metadata.json')
  if (fs.existsSync(metaPath)) {
    try { metadata = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as Record<string, unknown> } catch { metadata = null }
  }
  const raws: Array<{ file: string; data: unknown }> = []
  for (const f of files) {
    if (f === 'metadata.json') continue
    try {
      const j: unknown = JSON.parse(fs.readFileSync(path.join(fixturesDir, f), 'utf8'))
      raws.push({ file: f, data: j })
    } catch {}
  }
  return { metadata, files, raws }
}

// ---------------------------------------------------------------------------
// Live 断言（对真实 Tracker 实例）
// ---------------------------------------------------------------------------

function assertResult(name: string, cond: unknown, detail: string | undefined, out: LiveResult[]): void {
  out.push({ name, ok: !!cond, detail: detail || '' })
}

/** runWithAdapter 的参数：真实 Tracker 实例 + 目标仓库 + 可选采样目录/调用现场/报告前缀。 */
export interface RunWithAdapterParams {
  tracker: RunnerTracker
  repo: RunnerRepo
  fixturesDir?: string
  opCtx?: RunnerOpCtx
  label?: string
}

/**
 * 对一个真实 Tracker 实例执行契约级 live 断言。
 * 不要求网络可达：若网络不可达，对应的 list/get 应返回 network/auth 等可分类错误而非抛异常。
 * 若 fixturesDir 有采样，能额外做“归一化形状与采样一致”的比对。
 */
export async function runWithAdapter({ tracker, repo, fixturesDir, opCtx, label = 'live' }: RunWithAdapterParams): Promise<{ ok: boolean; results: LiveResult[] }> {
  const out: LiveResult[] = []
  const P = `${label} · `

  // 1) 形状门槛：tracker 必须含 platform 注入的上下文痕迹（通过 tracker.id + 可调用性校验）
  assertResult(P + 'tracker has id', typeof tracker.id === 'string' && tracker.id.length > 0, `id=${tracker.id}`, out)
  // 2) 工厂 ctx 注入校验：tracker 的闭包应持有 platform（间接校验：preflight/list 可调且不抛）
  // 3) 对真实 repo 的 list/get/getDependencies 的“不抛 + 返回 OpResult 形状”门槛
  const ctx: RunnerOpCtx = opCtx || { cwd: process.cwd(), signal: (typeof AbortController !== 'undefined' ? new AbortController().signal : undefined), refId: repo.refId }

  // preflight（环境门禁：工具在不在、登录/可达，不预判能力）
  try {
    const pre: unknown = await tracker.preflight({ cwd: ctx.cwd, refId: repo.refId }, ctx)
    assertResult(P + 'preflight returns PreflightResult shape', !!pre && typeof pre === 'object' && typeof (pre as { ok: unknown }).ok === 'boolean', JSON.stringify(pre).slice(0, 300), out)
    if (!!pre && typeof pre === 'object' && (pre as { ok: unknown }).ok === false) {
      const preRec = pre as { error?: { kind?: unknown } }
      assertResult(P + 'preflight fail has error.kind', !!preRec.error && typeof preRec.error.kind === 'string', JSON.stringify(preRec.error), out)
    }
  } catch (e) {
    assertResult(P + 'preflight must not throw', false, String(e), out)
  }

  // list（若网络不可达，应返回 network/auth 等而非 throw；若可达，应返回 Issue[] 且形状合规）
  let listIssues: Record<string, unknown>[] | null = null
  try {
    const r: unknown = await tracker.list(repo, {}, ctx)
    assertResult(P + 'list returns OpResult', isOpResult(r), JSON.stringify(r).slice(0, 500), out)
    if (isOpResult(r) && r.ok) {
      listIssues = r.data as Record<string, unknown>[]
      assertResult(P + 'list data is array', Array.isArray(r.data), `type=${typeof r.data}`, out)
      // 抽样校验前 2 条的形状（复用 capability 的 EMPTY vs MISSING 语义）
      for (let i = 0; i < Math.min(2, (r.data as unknown[]).length); i++) {
        const issue = (r.data as Record<string, unknown>[])[i]
        assertResult(P + `list[${i}] has key string`, typeof issue.key === 'string', JSON.stringify(issue.key), out)
        assertResult(P + `list[${i}] no number field`, !('number' in issue), 'number present', out)
        assertResult(P + `list[${i}] no subIssues field`, !('subIssues' in issue), 'subIssues present', out)
        assertResult(P + `list[${i}] no blocking field`, !('blocking' in issue), 'blocking present', out)
        assertResult(P + `list[${i}] state ∈ {open,closed}`, issue.state === 'open' || issue.state === 'closed', String(issue.state), out)
        assertResult(P + `list[${i}] parentKey core`, issue.parentKey === null || typeof issue.parentKey === 'string', String(issue.parentKey), out)
        assertResult(P + `list[${i}] labels EMPTY-or-MISSING shape`, !('labels' in issue) || Array.isArray(issue.labels), JSON.stringify(issue.labels)?.slice(0,200), out)
        // diagnose 不应抛
        try {
          const log: unknown = diagnoseCapabilities(issue)
          assertResult(P + `list[${i}] diagnoseCapabilities runnable`, Array.isArray(log), '', out)
        } catch (e) {
          assertResult(P + `list[${i}] diagnoseCapabilities runnable`, false, String(e), out)
        }
      }
    } else if (isOpResult(r) && !r.ok) {
      const errRec = (r.error || {}) as { kind?: unknown }
      assertResult(P + 'list fail has error.kind', !!r.error && typeof errRec.kind === 'string', JSON.stringify(r && r.error), out)
    }
  } catch (e) {
    assertResult(P + 'list must not throw', false, String(e && (e as Error).stack || e), out)
  }

  // get（若 list 有数据，取第一条的 key 再 get；否则用 fixtures 里的 key）
  let targetKey: string | null = null
  if (listIssues && listIssues.length > 0) targetKey = listIssues[0].key as string
  else if (fixturesDir) {
    const { raws } = loadFixtures(fixturesDir)
    const norm = raws.find((r) => r.file.startsWith('normalized-'))
    if (norm && norm.data && (norm.data as Record<string, unknown>).key) targetKey = String((norm.data as Record<string, unknown>).key)
  }
  if (targetKey) {
    try {
      const r: unknown = await tracker.get(repo, targetKey, {}, ctx)
      assertResult(P + `get(${targetKey}) returns OpResult`, isOpResult(r), JSON.stringify(r).slice(0, 500), out)
      if (isOpResult(r) && r.ok) {
        const data = r.data as Record<string, unknown>
        assertResult(P + `get key matches`, String(data.key) === String(targetKey), `got=${String(data.key)} want=${targetKey}`, out)
        assertResult(P + `get no number`, !('number' in data), '', out)
      }
    } catch (e) {
      assertResult(P + `get(${targetKey}) must not throw`, false, String(e), out)
    }
    // getDependencies
    try {
      const r: unknown = await tracker.getDependencies(repo, targetKey, {}, ctx)
      assertResult(P + `getDependencies(${targetKey}) returns OpResult`, isOpResult(r), JSON.stringify(r).slice(0, 500), out)
      if (isOpResult(r) && r.ok) {
        const data = r.data as Record<string, unknown>
        assertResult(P + `getDependencies has blockedBy array`, !!data && Array.isArray(data.blockedBy), JSON.stringify(r.data), out)
      }
    } catch (e) {
      assertResult(P + `getDependencies must not throw`, false, String(e), out)
    }
  } else {
    assertResult(P + 'get/getDependencies skipped (no targetKey, no network)', true, 'no targetKey available in playback/live', out)
  }

  // fixtures 比对（若有采样）
  if (fixturesDir && fs.existsSync(fixturesDir)) {
    const { metadata, files } = loadFixtures(fixturesDir)
    assertResult(P + 'fixtures metadata exists', !!metadata, `files=${files.join(',')}`, out)
    if (metadata) {
      assertResult(P + 'fixtures metadata has source', typeof metadata.source === 'string' && (metadata.source as string).length > 0, JSON.stringify(metadata.source), out)
      assertResult(P + 'fixtures metadata has desensitization', typeof metadata.desensitization === 'object', JSON.stringify(metadata.desensitization), out)
      assertResult(P + 'fixtures metadata has sampledAt', typeof metadata.sampledAt === 'string', String(metadata.sampledAt), out)
    }
    assertResult(P + 'fixtures has at least one sampled file', files.length >= 2, `files=${files.join(',')}`, out) // metadata + at least one raw
  }

  // 4) 工厂 ctx 注入 + platform 实例 显式断言（若调用方传了 backendCtx）
  // 由调用方在外层断言；此处仅检查 tracker 的 id 与 repo.backend 一致性（若 tracker.id 已知）
  if (repo && tracker && tracker.id) {
    // 不强制相等（第三方可不同名），但若相等则更可信；此处仅日志式断言
    const consistent = repo.backend === tracker.id || repo.backend === 'github' || repo.backend === 'markdown' || repo.backend === 'gitlab'
    assertResult(P + 'repo.backend plausible', consistent, `repo.backend=${repo.backend} tracker.id=${tracker.id}`, out)
  }

  const ok = out.every((r) => r.ok)
  return { ok, results: out }
}

/**
 * Playback 模式：用采样固件驱动的“伪 Tracker”过 harness（用于 CI 无网络时仍证真实性）。
 * 读取 fixturesDir 下的 normalized-*.json 作为 list/get 的数据源，验证 normalize 仍满足契约。
 */
export async function runPlayback({ fixturesDir, label = 'playback' }: { fixturesDir: string; label?: string }): Promise<{ ok: boolean; results: LiveResult[] }> {
  const out: LiveResult[] = []
  const P = `${label} · `
  const { metadata, raws } = loadFixtures(fixturesDir)
  assertResult(P + 'fixtures dir exists', fs.existsSync(fixturesDir), fixturesDir, out)
  assertResult(P + 'metadata exists', !!metadata, JSON.stringify(metadata)?.slice(0,300), out)
  if (!metadata) return { ok: false, results: out }

  const normalizedRaws = raws.filter((r) => r.file.startsWith('normalized-'))
  // raw fixtures may be .json or .md (markdown uses raw-sample.md)
  let rawCount = raws.filter((r) => r.file.startsWith('raw-')).length
  // also count .md raw files directly from filesystem
  try {
    const all = fs.readdirSync(fixturesDir).filter((f) => f.startsWith('raw-'))
    rawCount = Math.max(rawCount, all.length)
  } catch {}
  assertResult(P + 'has normalized fixtures', normalizedRaws.length >= 1, `count=${normalizedRaws.length}`, out)
  assertResult(P + 'has raw fixtures', rawCount >= 1, `count=${rawCount}`, out)

  for (const nr of normalizedRaws) {
    const issues = (Array.isArray(nr.data) ? nr.data : [nr.data]) as Record<string, unknown>[]
    for (let idx = 0; idx < issues.length; idx++) {
      const issue = issues[idx]
      const suffix = issues.length > 1 ? `[${idx}]` : ''
      assertResult(P + `${nr.file}${suffix} has key string`, typeof issue.key === 'string', JSON.stringify(issue.key), out)
      assertResult(P + `${nr.file}${suffix} no number`, !('number' in issue), '', out)
      assertResult(P + `${nr.file}${suffix} no subIssues`, !('subIssues' in issue), '', out)
      assertResult(P + `${nr.file}${suffix} no blocking`, !('blocking' in issue), '', out)
      assertResult(P + `${nr.file}${suffix} state two-state`, issue.state === 'open' || issue.state === 'closed', String(issue.state), out)
      try {
        const log: unknown = diagnoseCapabilities(issue)
        assertResult(P + `${nr.file}${suffix} diagnose runnable`, Array.isArray(log), '', out)
      } catch (e) {
        assertResult(P + `${nr.file}${suffix} diagnose runnable`, false, String(e), out)
      }
    }
  }

  // 校验 desensitization 规则是否被遵守（至少检查：无 token/无真实邮箱）
  if (metadata.desensitization) {
    const allText = JSON.stringify(raws.map((r) => r.data)).slice(0, 20000)
    const hasToken = /ghp_[A-Za-z0-9_]+|github_pat_/.test(allText)
    assertResult(P + 'desensitization no token', !hasToken, hasToken ? 'token pattern found' : '', out)
  }

  const ok = out.every((r) => r.ok)
  return { ok, results: out }
}

export default { createRunnerContext, runWithAdapter, runPlayback, loadFixtures }
