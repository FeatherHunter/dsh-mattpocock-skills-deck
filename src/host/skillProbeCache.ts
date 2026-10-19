/**
 * src/host/skillProbeCache.ts —— 技能探测按需缓存（#968 · T4）。
 *
 * 来源与零变化：本文件由同目录 skillProbeCache.js 逐行转写而来，只加类型标注与注释，
 * 没有改任何运行时语义。原来的 .js 文件保留不动，引用方继续写 `./x.js` 说明符，
 * 由 scripts/ts-hook.mjs 在加载时改指到同名 .ts。
 *
 * 为什么这样标注：
 * 1. 相对导入说明符保留 `.js` 后缀（`../shared/time-config/src/values.js` 不改成 `.ts`），
 *    改了反而会绕过钩子的同名解析约定，所以这一条不能动。
 * 2. 缓存键与探测结果的形状是调用方与被缓存探测共同决定的，本文件不拥有它们，
 *    所以全部按 `any` 收，类型不替代运行时的判空与判形逻辑。
 * 3. 两个 Map 的类型参数（键是字符串、值是缓存条目与在途承诺）只存在于类型层面，
 *    转译时会被整体剥离，不会留下任何运行时痕迹。
 * 4. 没有新增任何 import 边：中央常量沿用原来的那一行导入，不引入新模块依赖。
 */

// 查到的结果短时缓存 10 秒：值住中央 YAML（config/ttl.yaml 的 skillProbeCacheCacheMs 键，这里直接引用中央常量，调时间改 YAML）。
// 中央常量与本文件的导出同名，直接 import 原名再导出，免得自己引自己。
// 路径走域构建产物写法，值由 tests/verify-time-config.ts 看守一致。
import { SKILL_PROBE_CACHE_MS } from '../shared/time-config/src/values.js'
export { SKILL_PROBE_CACHE_MS }

/** 探测缓存的形状：按工作区键查、按工作区清，只存判为成功的探测结果。 */
export interface SkillProbeCache {
  get(name: any, lang: any, cwd: any): any
  run(name: any, lang: any, cwd: any, probe: any): Promise<any>
  invalidateWorkspace(cwd: any): number
  stats(): { size: number; inflight: number; hits: number; coalesced: number }
  ttlMs: number
}

/** 造一份进程内探测缓存：纯内存，不读盘、不联网、不起定时器，过期按读取时比对时间戳懒淘汰。 */
export function createSkillProbeCache(opts: any): SkillProbeCache {
  const o: any = opts || {}
  const now: () => number = typeof o.now === 'function' ? o.now : Date.now
  const ttlMs: number = (typeof o.ttlMs === 'number' && o.ttlMs > 0) ? o.ttlMs : SKILL_PROBE_CACHE_MS
  // 类型参数只描述“键是字符串、值是什么”，运行时仍是普通的 Map，不会影响并发复用逻辑。
  const entries = new Map<string, any>()
  const inflight = new Map<string, Promise<any>>()
  let hits: number = 0
  let coalesced: number = 0

  /** 缓存键：名字、语言与工作区三段拼起来，缺段按空串算，与原来逐行对应。 */
  function keyOf(name: any, lang: any, cwd: any): string {
    return String(name || '') + '|' + String(lang || '') + '|' + String(cwd || '')
  }

  /** 只有判为成功的结果才值得缓存，失败与未查出来一律不存，免得把“没有”继续骗下去。 */
  function isOkResult(res: any): boolean { return !!(res && (res.ok === true || res.level === 'ok')) }

  function get(name: any, lang: any, cwd: any): any {
    const k: string = keyOf(name, lang, cwd)
    const e: any = entries.get(k)
    if (!e) return null
    if (now() - e.at >= ttlMs) { entries.delete(k); return null }
    hits += 1
    return e.value
  }

  async function run(name: any, lang: any, cwd: any, probe: any): Promise<any> {
    const k: string = keyOf(name, lang, cwd)
    const ongoing: any = inflight.get(k)
    if (ongoing) { coalesced += 1; return ongoing }
    const p: Promise<any> = Promise.resolve().then(probe).then(function (res: any) {
      inflight.delete(k)
      if (isOkResult(res)) entries.set(k, { value: res, at: now() })
      return res
    }, function (e: any) { inflight.delete(k); throw e })
    inflight.set(k, p)
    return p
  }

  /** 按工作区分桶清：只删这一个工作区的条目，没有带工作区时不动，靠超时自愈。 */
  function invalidateWorkspace(cwd: any): number {
    const target: string = String(cwd == null ? '' : cwd)
    if (!target) return 0
    const suffix: string = '|' + target
    let n: number = 0
    entries.forEach(function (_v: any, k: any) { if (String(k).endsWith(suffix)) { entries.delete(k); n += 1 } })
    return n
  }

  function stats(): { size: number; inflight: number; hits: number; coalesced: number } { return { size: entries.size, inflight: inflight.size, hits: hits, coalesced: coalesced } }

  return { get: get, run: run, invalidateWorkspace: invalidateWorkspace, stats: stats, ttlMs: ttlMs }
}

export default createSkillProbeCache
