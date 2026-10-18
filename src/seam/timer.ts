/**
 * seam/timer.ts · B4 timer 绑定（定时语义）
 *
 * R1 接口：timer.schedule(fn, ms): Cancel（内部 timer?.timeout ?? setTimeout）
 *   dev：setTimeout（浏览器全局，始终可用）
 *   pkg：later（timer 服务可用时用 timer.timeout，否则 setTimeout 兜底）
 *
 * 覆盖 D4：缺 timer 服务时的行为分叉。统一 seam = schedule(fn, ms) 返回 Cancel。
 */

// 本域 tsconfig 有意不加载任何类型包（types 为空），setTimeout 没有声明；
// 运行时浏览器与 Node 都有这个全局函数。这里只声明用到的那一面，
// 返回值照实标成未知 —— 原文直接把它的返回值交出去，从不断言具体形状。
declare function setTimeout(fn: (...args: unknown[]) => void, ms: number): unknown

interface PkgCtx {
  get?(name: string): unknown
}

interface TimerService {
  timeout(fn: (...args: unknown[]) => void, ms: number): unknown
}

/** pkg 方言的 timer shim 工厂。 */
export function createPkgTimer(getCtx: () => PkgCtx): {
  schedule(fn: (...args: unknown[]) => void, ms: number): unknown
} {
  return {
    schedule(fn, ms) {
      const ctx = getCtx()
      const timerSvc = (ctx && ctx.get ? ctx.get('timer') : undefined) as TimerService | undefined
      if (timerSvc !== undefined && timerSvc.timeout) return timerSvc.timeout(fn, ms)
      return setTimeout(fn, ms)
    },
  }
}

/** 本绑定说明的形状：只在本文件内用，不导出 —— 跨文件引用会多出层内边（同层禁引），6 份各自写一份。 */
interface SeamDescribe {
  b: string
  name: string
  covers: string[]
  dev: string
  pkg: string
}

export const describe = (): SeamDescribe => ({
  b: 'B4',
  name: 'timer',
  covers: ['D4 缺 timer 时根版丢弃定时 vs npm later setTimeout 兜底'],
  dev: 'setTimeout(fn, ms)（浏览器全局）',
  pkg: 'later：timer?.timeout ?? setTimeout',
})
