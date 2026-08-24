/**
 * backends/gitlab/client.js — glab CLI 封装。
 *
 * 按 #113 平台抽象 + #144 三底座：resolveExecutable('glab')经 ctx.platform，执行经 ctx.exec。
 * 返回 {stdout,stderr,code} 结构，不throw；调用方按 OpResult 归一（fail 不抛）。
 */

export function glabClient(opCtx) {
  const platform = opCtx && opCtx.platform
  const exec = opCtx && opCtx.exec
  return {
    /**
     * 执行 glab
     * @param {string[]} args
     * @param {{cwd?:string, timeout?:number, signal?:AbortSignal}} [opts]
     * @returns {Promise<{stdout:string,stderr:string,code:number}>}
     */
    async run(args, opts = {}) {
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
      const cwd = opts.cwd || opCtx.cwd || undefined
      const signal = opts.signal || opCtx.signal || undefined
      const timeout = opts.timeout
      try {
        const res = await exec('glab', args, { cwd, signal, timeout })
        // exec 约定返回 {stdout,stderr,code}
        if (res && typeof res.code === 'number') return res
        // 兼容旧签名 {ok, out}
        if (res && typeof res.ok === 'boolean') {
          return { stdout: res.out || '', stderr: res.error ? String(res.error) : '', code: res.ok ? 0 : 1 }
        }
        return { stdout: String(res || ''), stderr: '', code: 0 }
      } catch (e) {
        const msg = e && (e.message || e.stderr || e.stdout) ? String(e.message || e.stderr || e.stdout) : String(e)
        const code = e && typeof e.code === 'number' ? e.code : 1
        return { stdout: e && e.stdout ? String(e.stdout) : '', stderr: msg, code }
      }
    },
    /**
     * glab api 快捷（REST）
     * @param {string} path e.g. projects/123/issues
     * @param {{method?:string, body?:Object, query?:string}} opts
     */
    async api(path, opts = {}, runOpts = {}) {
      const args = ['api', path]
      if (opts.method) args.push('--method', opts.method)
      if (opts.body) {
        const json = JSON.stringify(opts.body)
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
          if (Array.isArray(v)) args.push('-f', `${k}=${v.join(',')}`)
          else if (v != null) args.push('-f', `${k}=${String(v)}`)
        }
      }
      return this.run(args, runOpts)
    },
  }
}

/**
 * 便捷：直接 exec glab（对齐新签名，返回码+输出）
 */
export async function execGlab(opCtx, args, opts = {}) {
  const c = glabClient(opCtx)
  return c.run(args, opts)
}

export default glabClient
