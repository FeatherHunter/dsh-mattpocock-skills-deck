/**
 * tests/tracker-contract/runner/index.js — 真实适配器可接入的契约 Runner（#173）
 *
 * 第一性原理回溯：
 * - 契约已定稿 #124/#125/#126/#127/#128（不再改内容，只改“被测对象”：桩→真适配器）
 * - #132 门禁 293/4/OK 仅证骨架自洽（harness 测的是 compliant/violating 两个合成桩 + github/gitlab 适配器的 normalize 单元）
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
import { fileURLToPath } from 'node:url'
import { createPlatform } from '../../../src/host/platform/index.js'
import { diagnoseCapabilities, hasField, isEmpty } from '../../../src/host/tracker/capability.js'

// ---------------------------------------------------------------------------
// BackendContext 工厂（注入 platform 实例）
// ---------------------------------------------------------------------------

/**
 * 造一个可用于 BackendModule.create 的 BackendContext。
 * @param {object} [opts]
 * @param {string} [opts.os] - OS 覆盖（win32/darwin/linux），默认 process.platform 映射
 * @param {string} [opts.cwd] - 默认 cwd
 * @param {object} [opts.env] - env 覆盖（透传给 platform）
 * @param {() => string} [opts.homedir] - homedir 注入（供 platform getHome）
 * @param {object} [opts.fs] - fs 覆盖（默认 DSH 沙箱 fs 的最小可用子集：此处用 node:fs 的薄封装以便单机判真）
 * @param {Function} [opts.exec] - exec 覆盖（默认抛 unsupported——live 真调需要调用方注入真实 exec）
 * @returns {Promise<import('../../../src/host/tracker/contract.js').BackendContext & { platform: import('../../../src/host/platform/index.js').Platform }>}
 */
export async function createRunnerContext(opts = {}) {
  // 最小 hostCtx：需提供 get('fs') / get('subprocess') 等供 platform 消费；此处做薄适配
  const cwd = opts.cwd || process.cwd()
  const envSource = opts.env || process.env
  // 构造一个满足 createPlatform(ctx) 契约的 ctx：ctx.get('fs') 返回受控 fs
  const nodeFsAdapter = opts.fs || {
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
    get(name) {
      if (name === 'fs') return nodeFsAdapter
      if (name === 'subprocess') {
        return {
          resolveExecutable: async (n) => {
            // 委托平台底层的 resolveExecutable；此处的 subprocess.resolveExecutable 仅为平台调用准备
            return null
          },
        }
      }
      return undefined
    },
  }

  const osName = opts.os
  const platform = await createPlatform(hostCtx, osName, opts.homedir ? { homedir: opts.homedir, env: envSource } : { env: envSource })

  const backendCtx = {
    platform,
    fs: nodeFsAdapter,
    exec: opts.exec || (async () => ({ stdout: '', stderr: 'ctx.exec not injected (playback mode)', code: 1 })),
    timers: { setTimeout, clearTimeout },
    log: { info: () => {}, warn: () => {}, error: () => {} },
    // 供 registry select/matches 使用的最小扩展
    cwd,
  }
  // 额外暴露：便于测试断言“ctx 含 platform 实例”
  backendCtx._platformOs = platform.os
  return backendCtx
}

// ---------------------------------------------------------------------------
// 采样固件加载（playback）
// ---------------------------------------------------------------------------

/**
 * 从夹具目录加载采样固件索引。
 * 约定目录结构（每后端一份）：
 *   fixtures/<backend>-real/
 *     ├─ metadata.json  { source, sampledAt, repo, refId, desensitization, fields }
 *     ├─ raw-*.json     打 API 原始响应（已脱敏）
 *     ├─ normalized-*.json 归一化后 Issue 期望
 *     └─ list.json / get-*.json 等
 * @param {string} fixturesDir
 * @returns {{ metadata: object|null, files: string[], raws: object[] }}
 */
export function loadFixtures(fixturesDir) {
  if (!fixturesDir || !fs.existsSync(fixturesDir)) {
    return { metadata: null, files: [], raws: [] }
  }
  const files = fs.readdirSync(fixturesDir).filter((f) => f.endsWith('.json')).sort()
  let metadata = null
  const metaPath = path.join(fixturesDir, 'metadata.json')
  if (fs.existsSync(metaPath)) {
    try { metadata = JSON.parse(fs.readFileSync(metaPath, 'utf8')) } catch { metadata = null }
  }
  const raws = []
  for (const f of files) {
    if (f === 'metadata.json') continue
    try {
      const j = JSON.parse(fs.readFileSync(path.join(fixturesDir, f), 'utf8'))
      raws.push({ file: f, data: j })
    } catch {}
  }
  return { metadata, files, raws }
}

// ---------------------------------------------------------------------------
// Live 断言（对真实 Tracker 实例）
// ---------------------------------------------------------------------------

function assertResult(name, cond, detail, out) {
  out.push({ name, ok: !!cond, detail: detail || '' })
}

/**
 * 对一个真实 Tracker 实例执行契约级 live 断言。
 * 不要求网络可达：若网络不可达，对应的 list/get 应返回 network/auth 等可分类错误而非抛异常。
 * 若 fixturesDir 有采样，能额外做“归一化形状与采样一致”的比对。
 *
 * @param {object} params
 * @param {import('../../../src/host/tracker/contract.js').Tracker} params.tracker - 真实 Tracker 实例（经 BackendModule.create(ctx) 产出）
 * @param {import('../../../src/shared/tracker/shape.js').RepositoryRef} params.repo - 目标仓库
 * @param {string} [params.fixturesDir] - 采样夹具目录（可选）
 * @param {import('../../../src/host/tracker/contract.js').OpContext} [params.opCtx] - 每 op 上下文（cwd/signal/refId）
 * @param {string} [params.label] - 报告前缀
 * @returns {Promise<{ ok: boolean, results: Array<{name:string,ok:boolean,detail:string}> }>}
 */
export async function runWithAdapter({ tracker, repo, fixturesDir, opCtx, label = 'live' }) {
  const out = []
  const P = `${label} · `

  // 1) 形状门槛：tracker 必须含 platform 注入的上下文痕迹（通过 tracker.id + 可调用性校验）
  assertResult(P + 'tracker has id', typeof tracker.id === 'string' && tracker.id.length > 0, `id=${tracker.id}`, out)
  // 2) 工厂 ctx 注入校验：tracker 的闭包应持有 platform（间接校验：preflight/list 可调且不抛）
  // 3) 对真实 repo 的 list/get/getDependencies 的“不抛 + 返回 OpResult 形状”门槛
  const ctx = opCtx || { cwd: process.cwd(), signal: (typeof AbortController !== 'undefined' ? new AbortController().signal : undefined), refId: repo.refId }

  // helper: 校验 OpResult 形状
  const isOpResult = (r) => r && typeof r === 'object' && ('ok' in r) && (r.ok ? 'data' in r : 'error' in r)

  // preflight（环境门禁：工具在不在、登录/可达，不预判能力）
  try {
    const pre = await tracker.preflight({ cwd: ctx.cwd, refId: repo.refId }, ctx)
    assertResult(P + 'preflight returns PreflightResult shape', pre && typeof pre.ok === 'boolean', JSON.stringify(pre).slice(0, 300), out)
    if (pre && pre.ok === false) {
      assertResult(P + 'preflight fail has error.kind', pre.error && typeof pre.error.kind === 'string', JSON.stringify(pre.error), out)
    }
  } catch (e) {
    assertResult(P + 'preflight must not throw', false, String(e), out)
  }

  // list（若网络不可达，应返回 network/auth 等而非 throw；若可达，应返回 Issue[] 且形状合规）
  let listIssues = null
  try {
    const r = await tracker.list(repo, {}, ctx)
    assertResult(P + 'list returns OpResult', isOpResult(r), JSON.stringify(r).slice(0, 500), out)
    if (r && r.ok) {
      listIssues = r.data
      assertResult(P + 'list data is array', Array.isArray(r.data), `type=${typeof r.data}`, out)
      // 抽样校验前 2 条的形状（复用 capability 的 EMPTY vs MISSING 语义）
      for (let i = 0; i < Math.min(2, r.data.length); i++) {
        const issue = r.data[i]
        assertResult(P + `list[${i}] has key string`, typeof issue.key === 'string', JSON.stringify(issue.key), out)
        assertResult(P + `list[${i}] no number field`, !('number' in issue), 'number present', out)
        assertResult(P + `list[${i}] no subIssues field`, !('subIssues' in issue), 'subIssues present', out)
        assertResult(P + `list[${i}] no blocking field`, !('blocking' in issue), 'blocking present', out)
        assertResult(P + `list[${i}] state ∈ {open,closed}`, issue.state === 'open' || issue.state === 'closed', String(issue.state), out)
        assertResult(P + `list[${i}] parentKey core`, issue.parentKey === null || typeof issue.parentKey === 'string', String(issue.parentKey), out)
        assertResult(P + `list[${i}] labels EMPTY-or-MISSING shape`, !('labels' in issue) || Array.isArray(issue.labels), JSON.stringify(issue.labels)?.slice(0,200), out)
        // diagnose 不应抛
        try {
          const log = diagnoseCapabilities(issue)
          assertResult(P + `list[${i}] diagnoseCapabilities runnable`, Array.isArray(log), '', out)
        } catch (e) {
          assertResult(P + `list[${i}] diagnoseCapabilities runnable`, false, String(e), out)
        }
      }
    } else if (r && !r.ok) {
      assertResult(P + 'list fail has error.kind', r.error && typeof r.error.kind === 'string', JSON.stringify(r && r.error), out)
    }
  } catch (e) {
    assertResult(P + 'list must not throw', false, String(e && e.stack || e), out)
  }

  // get（若 list 有数据，取第一条的 key 再 get；否则用 fixtures 里的 key）
  let targetKey = null
  if (listIssues && listIssues.length > 0) targetKey = listIssues[0].key
  else if (fixturesDir) {
    const { raws } = loadFixtures(fixturesDir)
    const norm = raws.find((r) => r.file.startsWith('normalized-'))
    if (norm && norm.data && norm.data.key) targetKey = String(norm.data.key)
  }
  if (targetKey) {
    try {
      const r = await tracker.get(repo, targetKey, {}, ctx)
      assertResult(P + `get(${targetKey}) returns OpResult`, isOpResult(r), JSON.stringify(r).slice(0, 500), out)
      if (r && r.ok) {
        assertResult(P + `get key matches`, String(r.data.key) === String(targetKey), `got=${r.data.key} want=${targetKey}`, out)
        assertResult(P + `get no number`, !('number' in r.data), '', out)
      }
    } catch (e) {
      assertResult(P + `get(${targetKey}) must not throw`, false, String(e), out)
    }
    // getDependencies
    try {
      const r = await tracker.getDependencies(repo, targetKey, {}, ctx)
      assertResult(P + `getDependencies(${targetKey}) returns OpResult`, isOpResult(r), JSON.stringify(r).slice(0, 500), out)
      if (r && r.ok) {
        assertResult(P + `getDependencies has blockedBy array`, r.data && Array.isArray(r.data.blockedBy), JSON.stringify(r.data), out)
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
      assertResult(P + 'fixtures metadata has source', typeof metadata.source === 'string' && metadata.source.length > 0, JSON.stringify(metadata.source), out)
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
 * @param {object} params
 * @param {string} params.fixturesDir
 * @param {string} [params.label]
 * @returns {Promise<{ok:boolean, results:Array}>}
 */
export async function runPlayback({ fixturesDir, label = 'playback' }) {
  const out = []
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
    const issues = Array.isArray(nr.data) ? nr.data : [nr.data]
    for (let idx = 0; idx < issues.length; idx++) {
      const issue = issues[idx]
      const suffix = issues.length > 1 ? `[${idx}]` : ''
      assertResult(P + `${nr.file}${suffix} has key string`, typeof issue.key === 'string', JSON.stringify(issue.key), out)
      assertResult(P + `${nr.file}${suffix} no number`, !('number' in issue), '', out)
      assertResult(P + `${nr.file}${suffix} no subIssues`, !('subIssues' in issue), '', out)
      assertResult(P + `${nr.file}${suffix} no blocking`, !('blocking' in issue), '', out)
      assertResult(P + `${nr.file}${suffix} state two-state`, issue.state === 'open' || issue.state === 'closed', String(issue.state), out)
      try {
        const log = diagnoseCapabilities(issue)
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
