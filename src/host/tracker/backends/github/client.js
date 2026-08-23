/**
 * backends/github/client.js — gh CLI 封装。
 *
 * ⌈ 骨架占位 ⌉ #114 实现：resolveExecutable('gh')、30s 超时（timer race + terminate）、
 * 错误归一化。为保持与现有 src/host/index.js 一致，先留签名。
 */

/**
 * 取 gh 客户端。
 * @param {Object} ctx
 * @returns {{ run: (args: string[], cwd: string) => Promise<{ok: boolean, out?: string, error?: unknown}> }}
 */
export function ghClient(ctx) {
  // TODO #114：resolve gh 路径 + runGh 白名单 + 超时 + 错误归一化
  return {
    async run() {
      throw new Error('gh client pending #114')
    },
  }
}

export default ghClient
