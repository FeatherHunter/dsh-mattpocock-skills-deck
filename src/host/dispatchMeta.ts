/**
 * src/host/dispatchMeta.ts —— 分发异常行的两个纯函数（来源：src/host/dispatchMeta.js，H7 #515 从 host/index.js 搬出，逐行原样、行为零变化；本次只加类型标注与注释，逻辑一行未动）。
 *
 * 为什么要有它（一句话）：分发电话抛错时记一行可排查的日志，既要让排查的人看出是哪一通电话、哪一类错，又不能把入参原文记进日志，所以入参只记散列、类别按统一口径归档。
 *
 * 两条不能改的约定（改之前先看调用点 src/host/index.js 的分发异常行）：
 * 1. 入参散列口径不能改：先把入参转成 JSON 字符串、只取前两千字，再用同一套哈希算法算出八位十六进制散列。调用点拿散列对日志，算法变了旧日志就对不上。
 * 2. 错误归类口径不能改：按错误信息里的关键字分成五档（权限、网络、退出码、找不到、其它），顺序也不能调，因为一条信息可能同时命中多档，先命中的赢。
 * 反例：如果把入参原文记进日志，就会把工作区路径与令牌带进日志文件，违反日志纪律里可重放凭证永不落盘那条红线。
 */

// ---------------------------------------------------------------------------
// 类型（本次转 TypeScript：只写类型不写实现）。
//
// 为什么标成这样：两个函数都是纯函数，进出都是字符串与未知错误对象，不依赖任何外部服务，所以参数按最宽的 unknown 收，内部用 String() 与类型守卫收窄，类型不替代那些运行时判断。
// ---------------------------------------------------------------------------

/**
 * 组装分发异常行的两个纯函数（无外部依赖，调用点只从这里拿这两个函数）。
 *
 * 为什么：分发层只有这一处算散列与分档，其它地方直接用这一份结果记日志，不各写各的口径。
 * 什么约定不能改：返回对象的两个字段名（短散列函数与错误归类函数）是调用点按名取的，改名调用点就拿不到。
 */
export function createDispatchMeta(): { shortArgHash: (args: unknown) => string; dispatchErrorKind: (e: unknown) => string } {
    // 分发异常行（#499 自监控 46）：电话抛错记 error 行；电话名是固定枚举可记原文，入参只记散列，类别沿错误归一口径。
    function shortArgHash(args: unknown): string {
      try {
        const s: string = String(JSON.stringify(args) || '').slice(0, 2000)
        let h: number = 5381
        for (let i: number = 0; i < s.length; i++) h = (((h << 5) + h + s.charCodeAt(i)) >>> 0)
        return ('0000000' + h.toString(16)).slice(-8)
      } catch (_e: unknown) { return 'unknown' }
    }
    function dispatchErrorKind(e: unknown): string {
      const m: string = String(((e as { message?: unknown } | null | undefined) && (e as { message?: unknown }).message) || (e as unknown) || '')
      if (/auth|token|denied|401|403/i.test(m)) return 'auth'
      if (/network|timeout|ECONN|ENOTFOUND|fetch failed/i.test(m)) return 'network'
      if (/exit\s*code|exitCode/i.test(m)) return 'exit'
      if (/not found|ENOENT|404/i.test(m)) return 'notfound'
      return 'internal'
    }
    return { shortArgHash: shortArgHash, dispatchErrorKind: dispatchErrorKind }
}
