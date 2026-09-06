// src/host/dispatchMeta.js —— 分发异常行的两个纯函数（H7 #515 从 host/index.js 搬出，逐行原样、行为零变化）。
// 以后谁改它：改分发异常日志的入参散列口径或错误归类口径的人。预估约30行，超 350 打回。
// 接线：由 index.js 动态 import 加载（D7 禁止静态 import）；纯函数、零外部依赖；本文件不引用其他新文件。
export function createDispatchMeta() {
    // 分发异常行（#499 自监控 46）：电话抛错记 error 行；电话名是固定枚举可记原文，入参只记散列，类别沿错误归一口径。
    function shortArgHash(args) {
      try {
        const s = String(JSON.stringify(args) || '').slice(0, 2000)
        let h = 5381
        for (let i = 0; i < s.length; i++) h = (((h << 5) + h + s.charCodeAt(i)) >>> 0)
        return ('0000000' + h.toString(16)).slice(-8)
      } catch (e) { return 'unknown' }
    }
    function dispatchErrorKind(e) {
      const m = String((e && e.message) || e || '')
      if (/auth|token|denied|401|403/i.test(m)) return 'auth'
      if (/network|timeout|ECONN|ENOTFOUND|fetch failed/i.test(m)) return 'network'
      if (/exit\s*code|exitCode/i.test(m)) return 'exit'
      if (/not found|ENOENT|404/i.test(m)) return 'notfound'
      return 'internal'
    }
    return { shortArgHash: shortArgHash, dispatchErrorKind: dispatchErrorKind }
}
