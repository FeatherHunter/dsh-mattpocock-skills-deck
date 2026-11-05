/**
 * src/tracker/rooms/gitlab/issues/shared.ts —— 票读与票写共用的回包收尾助手（#1907 评审修复）。
 *
 * 为什么单独一份：read.ts 与 write.ts 搬家时逐字各养了一份同样的助手（parseJsonSafe、errMsg、
 * ApiError、toApiError、apiJson，约 45 行，连注释）。同一把尺子留两处，改失败兜底或解析容错时
 * 迟早会两边漂，所以这次收进这里，两份文件都从 './shared.js' 取。
 *
 * 这里只做「请求已经发出之后」的事：非零退出码按原来那句话术抛错、零退出码按旧的容错解析。
 * 请求本身仍由根目录 requests.ts 的具名函数发出；method、路径与表单字段只在那一处。
 * 写请求专用的 apiPut（兜底话术多一个 PUT）只被 write.ts 使用，留在 write.ts，不在这里多养一份。
 *
 * 行为与搬家前逐字一致：错误消息、原文挂在 Error 上的形状、解析失败回 null 都沿用旧写法。
 */

import type { GlabRunResult } from '../client.js'

export function parseJsonSafe(s: string): unknown {
  try {
    return JSON.parse(s) as unknown
  } catch {
    return null
  }
}

export function errMsg(err: unknown): string {
  if (err !== null && typeof err === 'object' && 'message' in (err as Record<string, unknown>)) {
    const m = (err as Record<string, unknown>)['message']
    if (typeof m === 'string' && m) return m
  }
  return String(err)
}

// 抛出去的错要带原始回包，是因为上层只 catch 到一个 Error，原文得躺在错身上才拿得到。
export interface ApiError extends Error {
  stderr?: string
  stdout?: string
  code?: number
}

export function toApiError(message: string, stderr: string, stdout: string, code: number): ApiError {
  const err = { message, stderr, stdout, code }
  return Object.assign(new Error(err.message), err) as ApiError
}

/**
 * 把一次已经发出去的请求收成 JSON。
 *
 * 请求本身由根目录 requests.ts 发出；本函数只处理回来的三件套：非零退出码按原来那句话术抛出
 * （message 优先用 stderr，其次 stdout，两者都空才用 path 兜底），零退出码按旧的容错解析。
 * path 只用来拼那句兜底失败消息，不参与发请求 —— 请求函数自己从 refId 与票号拼路径。
 *
 * @param request 已经发出的那次请求的承诺（调用请求函数时请求就开始了）
 * @param path 这次请求的路径（只在 stderr 与 stdout 都为空时用来兜底）
 * @returns 解析出来的值；回包不是 JSON 时回 null（旧行为）
 */
export async function apiJson(request: Promise<GlabRunResult>, path: string): Promise<unknown> {
  const res = await request
  if (res.code !== 0) {
    throw toApiError(res.stderr || res.stdout || `api ${path} failed`, res.stderr, res.stdout, res.code)
  }
  return parseJsonSafe(res.stdout)
}
