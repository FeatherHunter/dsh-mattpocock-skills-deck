/**
 * seam/timer.js · B4 timer 绑定（定时语义）
 *
 * R1 接口：timer.schedule(fn, ms): Cancel（内部 timer?.timeout ?? setTimeout）
 *   dev：setTimeout（浏览器全局，始终可用）
 *   pkg：later（timer 服务可用时用 timer.timeout，否则 setTimeout 兜底）
 *
 * 覆盖 D4：缺 timer 服务时的行为分叉。统一 seam = schedule(fn, ms) 返回 Cancel。
 */

/** pkg 方言的 timer shim 工厂。 */
export function createPkgTimer(getCtx) {
  return {
    schedule(fn, ms) {
      const ctx = getCtx()
      const timerSvc = ctx && ctx.get ? ctx.get('timer') : undefined
      if (timerSvc !== undefined && timerSvc.timeout) return timerSvc.timeout(fn, ms)
      return setTimeout(fn, ms)
    },
  }
}

export const describe = () => ({
  b: 'B4',
  name: 'timer',
  covers: ['D4 缺 timer 时根版丢弃定时 vs npm later setTimeout 兜底'],
  dev: 'setTimeout(fn, ms)（浏览器全局）',
  pkg: 'later：timer?.timeout ?? setTimeout',
})
