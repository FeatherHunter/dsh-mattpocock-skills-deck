/**
 * backends/gitlab/client.ts — glab CLI 封装。
 *
 * 按 #113 平台抽象 + #144 三底座：resolveExecutable('glab')经 ctx.platform，执行经 ctx.exec。
 * 返回 {stdout,stderr,code} 结构，不throw；调用方按 OpResult 归一（fail 不抛）。
 */

import type { BackendContext, OpContext } from '../../contract/contexts.js'
import type { OpResult } from '../../contract/results.js'
// 本域 tsconfig 有意不加载任何类型包（types 为空），node:async_hooks 的类型声明随 @types/node
// 一起被挡在门外；运行时一定是 Node，这个模块必然存在。与 src/refresh/kernel/step-pricing.ts
// 同一写法：只忽略导入这一行的类型错误，不影响 esbuild 的运行时转译。
// @ts-expect-error 本域类型配置没有加载 @types/node
import { AsyncLocalStorage } from 'node:async_hooks'

// 上下文只取平台与执行器两样且都允许缺失，是因为调用方可能拿半份上下文进来，缺了就按 127 如实回而不是抛。
type GlabCtx = Partial<OpContext> & Partial<BackendContext>

// 单次执行 glab 的入参，cwd 与 signal 优先用本次的，缺了才看上下文上的那份。
export interface GlabRunOpts {
  cwd?: string
  timeout?: number
  signal?: AbortSignal
}

// glab 一次执行的回包三件套，调用方只认这三格，旧签名的另外两格在里面就地转掉。
export interface GlabRunResult {
  stdout: string
  stderr: string
  code: number
}

// glab api 快捷的入参，body 展开成 -f 是因为执行器不透 stdin，传对象比拼字符串更不易丢转义。
export interface GlabApiOpts {
  method?: string
  body?: Record<string, unknown>
  query?: string
}

// 客户端的两个入口：run 是单次执行，api 是 REST 快捷，两者回包形状一致以便调用方统一判。
export interface GlabClient {
  run(args: string[], opts?: GlabRunOpts): Promise<GlabRunResult>
  api(path: string, opts?: GlabApiOpts, runOpts?: GlabRunOpts): Promise<GlabRunResult>
}

/** 一次操作自己的计数器：真正发出去的请求条数与点数。 */
interface GlabUsageBox { requests: number; points: number }

/** AsyncLocalStorage 的最小视图（本域没有 Node 类型，按用到的两格声明，避免 any 扩散）。 */
interface GlabUsageStore {
  // 同步版 run：包装器要在「调用函数的那一瞬」进作用域，不能等拿到承诺再进。
  run<T>(box: GlabUsageBox, fn: () => T): T
  getStore(): GlabUsageBox | undefined
}

const glabUsageStore = new AsyncLocalStorage() as GlabUsageStore

/**
 * 一次 glab 真正起进程时调一次（run 里解析出可执行文件之后、exec 之前）。
 * 请求额度按「一次 glab 调用一条请求」算，点数恒 0：GitLab 的限额不分请求与点数两桶。
 */
function noteGlabUsage(): void {
  const box = glabUsageStore.getStore()
  if (!box) return
  box.requests += 1
}

/**
 * 把房间操作表整体包一层：函数成员在成功信封上补 usage。
 * 只补成功信封，理由与 GitHub 房那份相同：失败信封没有 data，用量跟着失败一起丢掉，
 * 失败那一笔花没花由记账侧按口径定。同步成员（describe / issueAddress）原样交回。
 */
export function attachGlabOpUsage<T extends object>(table: T): T {
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(table)) {
    const value = (table as Record<string, unknown>)[key]
    if (typeof value !== 'function') { out[key] = value; continue }
    out[key] = function (this: unknown, ...args: unknown[]): unknown {
      // 必须在计数器的作用域里「调用」函数，不能先调用再包：操作可能是返回承诺的普通函数，
      // 其中真正发命令的那一段又可能在第一个 await 之前就开始跑；先调用再进作用域会漏掉它。
      const box: GlabUsageBox = { requests: 0, points: 0 }
      const result = glabUsageStore.run(box, function () { return (value as (...a: unknown[]) => unknown).apply(table, args) })
      // 同步成员（describe / issueAddress）原样交回，不把同步函数改成异步。
      if (!result || typeof (result as Promise<unknown>).then !== 'function') return result
      return (result as Promise<unknown>).then(function (envelope) {
        const reply = envelope as OpResult<unknown> | null
        if (reply && reply.ok === true) {
          // 零也照附：零是「量过了，这一笔没有出站」，与「没量」不是一回事。
          return Object.assign({}, reply, { usage: { requests: box.requests, points: box.points } })
        }
        return reply
      })
    }
  }
  return out as T
}

// 构造一次调用的客户端：先拿平台与执行器，缺哪个就让这次 run 按 127 回，免得空指针抛到调用方。
export function glabClient(opCtx: GlabCtx): GlabClient {
  const platform = opCtx && opCtx.platform
  const exec = opCtx && opCtx.exec
  async function run(args: string[], opts: GlabRunOpts = {}): Promise<GlabRunResult> {
    if (!platform || typeof platform.resolveExecutable !== 'function') {
      return { stdout: '', stderr: 'platform unavailable', code: 127 }
    }
    if (!exec || typeof exec !== 'function') {
      return { stdout: '', stderr: 'exec unavailable', code: 127 }
    }
    const exe = await platform.resolveExecutable('glab')
    if (!exe) {
      return { stdout: '', stderr: 'glab: command not found', code: 127 }
    }
    const cwd = opts.cwd || opCtx?.cwd || undefined
    const signal = opts.signal || opCtx?.signal || undefined
    const timeout = opts.timeout
    try {
      // 真正起进程了才记一条请求：没装 glab（127）或平台缺执行器时什么都没发出去，不记假账。
      noteGlabUsage()
      const res = await exec('glab', args, { cwd, signal, timeout })
      const bag = res as unknown as Record<string, unknown>
      // exec 约定返回 {stdout,stderr,code}
      if (bag && typeof bag['code'] === 'number') return res as unknown as GlabRunResult
      // 兼容旧签名 {ok, out}
      if (bag && typeof bag['ok'] === 'boolean') {
        const out = typeof bag['out'] === 'string' ? (bag['out'] as string) : ''
        const errText = bag['error'] !== undefined && bag['error'] !== null ? String(bag['error']) : ''
        return { stdout: out, stderr: errText, code: (bag['ok'] as boolean) ? 0 : 1 }
      }
      return { stdout: String((res as unknown) ?? ''), stderr: '', code: 0 }
    } catch (e: unknown) {
      const bag = (e !== null && typeof e === 'object' ? e : {}) as Record<string, unknown>
      const msgSource = bag['message'] ?? bag['stderr'] ?? bag['stdout'] ?? e
      const msg = msgSource ? String(msgSource) : String(e)
      const code = typeof bag['code'] === 'number' ? (bag['code'] as number) : 1
      const out = typeof bag['stdout'] === 'string' ? String(bag['stdout']) : ''
      return { stdout: out, stderr: msg, code }
    }
  }
  async function api(path: string, opts: GlabApiOpts = {}, runOpts: GlabRunOpts = {}): Promise<GlabRunResult> {
    const args: string[] = ['api', path]
    if (opts.method) args.push('--method', opts.method)
    if (opts.body) {
      const json = JSON.stringify(opts.body)
      void json
      args.push('--input', '-')
      // body via stdin handled by exec? glab api --input reads stdin; we pass via exec's input not yet; use -f替代
      // 为保持通用，改为 -f key=value 逐项
      // 但此处已拼好 json，调用方需自行处理 stdin；简化：直接用 -f
    }
    // 简单：若 opts.body 提供，展开为 -f
    if (opts.body && typeof opts.body === 'object') {
      // 已在上方push --input，此处补 -f 形式更稳妥，直接用 -f
      args.length = 2 // reset 已push的 --input
      args.push('--method', opts.method || 'GET')
      for (const [k, v] of Object.entries(opts.body)) {
        if (Array.isArray(v)) args.push('-f', `${k}=${(v as unknown[]).join(',')}`)
        else if (v !== null && v !== undefined) args.push('-f', `${k}=${String(v)}`)
      }
    }
    return run(args, runOpts)
  }
  return { run, api }
}

/**
 * 便捷：直接 exec glab（对齐新签名，返回码+输出）
 */
export async function execGlab(opCtx: GlabCtx, args: string[], opts: GlabRunOpts = {}): Promise<GlabRunResult> {
  const c = glabClient(opCtx)
  return c.run(args, opts)
}

export default glabClient
