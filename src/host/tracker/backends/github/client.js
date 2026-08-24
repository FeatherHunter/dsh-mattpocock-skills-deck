/**
 * backends/github/client.js — gh CLI 封装（契约对齐版）。
 *
 * 定版依据：#138 §1.3 + #129 平台三底座（BackendContext.platform 已解析实例注入）。
 * - gh 可执行经 `platform.resolveExecutable('gh')`（null → env fail，不抛）
 * - 命令执行经 `ctx.exec('gh', args, {cwd, timeout, signal})`（timeout 30s，signal abort）
 * - 超时/signal 与 timers 竞速由 ctx.exec 内部托管（此处只透传 opts）
 * - stdout 解析在调用方（issues/comments 等）；此处只做 exec+错误归一化，不产 parse kind（parse 由 JSON 层）
 * - 返回 OpResult，不 throw；错误经 classifyGhError 归一（env/auth/rate-limit/not-found/network）
 */

import { ERROR_KIND } from '../../../../shared/tracker/constants.js'
import { fail } from '../../preflight.js'
import { classifyGhError } from './errors.js'

const TIMEOUT_MS = 30000

function getExec(ctx) {
  if (ctx && typeof ctx.exec === 'function') return ctx.exec.bind(ctx)
  // 兼容：BackendContext.platform + fs/timers 注入时，exec 可能在 ctx 上或 ctx.platform 上
  if (ctx && ctx.platform && typeof ctx.platform.exec === 'function') return ctx.platform.exec.bind(ctx.platform)
  return null
}

function getPlatform(ctx) {
  if (ctx && ctx.platform && typeof ctx.platform.resolveExecutable === 'function') return ctx.platform
  if (ctx && typeof ctx.resolveExecutable === 'function') return ctx
  return null
}

function getCwd(ctx, explicitCwd) {
  if (explicitCwd) return explicitCwd
  if (ctx && typeof ctx.cwd === 'string' && ctx.cwd) return ctx.cwd
  return undefined
}

export function ghClient(ctx) {
  const platform = getPlatform(ctx)
  const exec = getExec(ctx)

  async function resolveGh(cwd) {
    if (!platform) {
      // platform 缺失 → env（按 contract §2，capability-by-fill 不可静默成功）
      return { ok: false, error: fail(ERROR_KIND.ENV, 'gh not found: platform.resolveExecutable unavailable').error }
    }
    try {
      const p = await platform.resolveExecutable('gh')
      if (!p) return { ok: false, error: { kind: ERROR_KIND.ENV, message: 'gh not found: platform.resolveExecutable returned null' } }
      return { ok: true, ghPath: p }
    } catch (e) {
      return { ok: false, error: { kind: ERROR_KIND.ENV, message: String((e && e.message) || e || 'gh not found') } }
    }
  }

  /**
   * 执行 gh 命令，返回 OpResult<{ stdout: string, stderr: string, code: number }>
   * 不做 JSON 解析；调用方自行 runJson / 解析 .out
   */
  async function execGh(args, opts = {}) {
    const cwd = getCwd(ctx, opts.cwd)
    const resolved = await resolveGh(cwd)
    if (!resolved.ok) return { ok: false, error: resolved.error }

    if (!exec) {
      return { ok: false, error: { kind: ERROR_KIND.ENV, message: 'ctx.exec unavailable' } }
    }

    const signal = opts.signal || (ctx && ctx.signal) || undefined
    const timeout = opts.timeout != null ? opts.timeout : TIMEOUT_MS

    try {
      const result = await exec('gh', args, { cwd, timeout, signal })
      // DSH ctx.exec 契约：{stdout, stderr, code}
      const code = result && typeof result.code === 'number' ? result.code : 0
      const stdout = result && typeof result.stdout === 'string' ? result.stdout : (result && result.text ? result.text : '')
      const stderr = result && typeof result.stderr === 'string' ? result.stderr : ''
      if (code !== 0) {
        const err = { message: stderr || stdout || `gh exit ${code}`, stderr: stderr || stdout, code, stdout }
        const kind = classifyGhError(err)
        return { ok: false, error: { kind, message: String(stderr || stdout || err.message).slice(0, 800) } }
      }
      return { ok: true, data: { stdout, stderr, code } }
    } catch (e) {
      // exec 抛的错误（timeout/network 等）→ 归一化
      const kind = classifyGhError(e)
      const message = String((e && (e.message || e.stderr)) || e || 'gh exec failed').slice(0, 800)
      return { ok: false, error: { kind, message } }
    }
  }

  /**
   * 执行 gh 并解析 JSON（gh --json / gh api --jq . 场景）。
   * 若 --json 输出，需 GH 输出纯 JSON；若 gh api 场景，需 stdout 为 JSON
   */
  async function execJson(args, opts = {}) {
    const r = await execGh(args, opts)
    if (!r.ok) return r
    const text = (r.data.stdout || '').trim()
    if (!text) return { ok: true, data: null }
    try {
      const parsed = JSON.parse(text)
      return { ok: true, data: parsed }
    } catch (e) {
      return { ok: false, error: { kind: ERROR_KIND.PARSE, message: `invalid json from gh: ${String(e.message).slice(0, 200)}` } }
    }
  }

  // 兼容旧签名 run / runJson（供 labels.js 等旧调用方过渡；新代码优先 execGh/execJson）
  async function run(args, cwdOrId) {
    // 旧 labels.js 调用：c.run(['issue','view',...], repoId) → repoId 此时作 cwd 兼容（若为 owner/repo 则忽略，用 ctx.cwd）
    // 为兼容，将 cwdOrId 仅在为路径（含 / 或 \ 或 :）时透传，否则忽略
    const cwd = typeof cwdOrId === 'string' && /[/\\]/.test(cwdOrId) ? cwdOrId : getCwd(ctx, undefined)
    return execGh(args, { cwd })
  }

  return {
    execGh,
    execJson,
    run, // 兼容旧调用
    // 便捷：gh api --paginate 模拟（简单封装，调用方传 --paginate 时由 execGh 直接交 gh 处理）
  }
}

export default ghClient
