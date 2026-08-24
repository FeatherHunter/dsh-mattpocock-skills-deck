/**
 * examples/demo-mini/matches.js — demo-mini 探测规则（boolean，超时由 registry 托管）
 *
 * 定版：platform.fs 探 cwd/.demo/config.json 或 .scratch/map.md 存在性，boolean，超时 3000ms
 * - 仅读 cwd/fs，不抛异常，不确定→false（registry 侧 withTimeout 吞错→false，超时→pending）
 * - 收到 signal.aborted 尽早退出（文案提示，性能优化）
 */

export async function demoMatches(handle, ctx) {
  try {
    if (ctx && ctx.signal && ctx.signal.aborted) return false
    const cwd = (handle && typeof handle.cwd === 'string' && handle.cwd) ? handle.cwd : (ctx && typeof ctx.cwd === 'string' ? ctx.cwd : '')
    if (!cwd) return false
    const platform = ctx && ctx.platform ? ctx.platform : null
    const fs = (platform && platform.fs) ? platform.fs : (ctx && ctx.fs ? ctx.fs : null)
    if (!fs || !platform || !platform.path) return false

    const tryExists = async (p) => {
      if (ctx && ctx.signal && ctx.signal.aborted) return false
      try {
        if (typeof fs.lstat === 'function') { await fs.lstat(p); return true }
      } catch {}
      try {
        if (typeof fs.stat === 'function') { await fs.stat(p); return true }
      } catch {}
      try {
        if (typeof fs.readText === 'function') { await fs.readText(p); return true }
      } catch {}
      return false
    }

    // 候选 1：cwd/.demo/config.json
    const p1 = platform.path.join(cwd, '.demo', 'config.json')
    if (await tryExists(p1)) return true

    // 候选 2：cwd/.scratch/map.md（与 markdown 后端正交：demo 探 config，markdown 探 map.md 集合，互不抢 match）
    const p2 = platform.path.join(cwd, '.scratch', 'map.md')
    if (await tryExists(p2)) return true

    // 兼容：若 fs 提供 resolve（path-shaped），再试 resolve 后的路径
    if (typeof fs.resolve === 'function') {
      try {
        const r1 = await fs.resolve(p1)
        if (r1 !== p1 && await tryExists(r1)) return true
      } catch {}
      try {
        const r2 = await fs.resolve(p2)
        if (r2 !== p2 && await tryExists(r2)) return true
      } catch {}
    }

    return false
  } catch {
    return false
  }
}

export default demoMatches
