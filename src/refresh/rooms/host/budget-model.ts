// src/refresh/rooms/host/budget-model.ts —— 后端额度口径的异步解析与同步读（#1852）
//
// 为什么单独一份：闸的裁决与记账都同步读「这个后端按什么口径花钱」（refresh-gate.ts 的 slotOf），
// 而注册表是宿主异步加载出来的（src/host/index.ts:80 的 getTrackerRegistry 返回 Promise）。
// 从前 refresh-runtime.ts 直接同步调它，Promise 上读不到 modules，口径恒为「未知」：
// 两桶水位不参与裁决、真实出站只记请求数落进不存在的桶（与 #1839 同一条根因，那是读数链、这里是闸链）。
//
// 这里把「一次异步解析 + 缓存 + 同步读」收在一处，让刷新接线保持同步读的形状：
//   · ensure() 只解析一次，成功后写缓存；同步抛错或 reject 一律回 null，不抛给调用方。
//   · budgetModelOf() 同步读缓存（闸的裁决口与记账口都读它）；缓存还没就绪时给同步注册表留兜底，
//     只接受非 Promise 的返回值 —— 门禁与单测注入的同步假件继续可用。
//   · 注册表取不到、或这个后端没登记，一律回 { kind: 'unknown' }：闸据此只记请求数，不凭空判两桶。
//
// 反例：把 ensure() 挪进裁决口里同步等 —— 裁决口必须同步回，等不了；把 Promise 当注册表用 —— 那就是本票。

/** 建一份预算口径读取器：deps.getTrackerRegistry 是宿主接进来的取注册表口（同步假件与异步真件都收）。 */
export function createBudgetModel(deps?: any): any {
  const o: any = deps || {}
  let cache: any = null
  let ready: Promise<any> | null = null

  /** 解析一次注册表并缓存（幂等）；失败回 null，调用方按「未知口径」记账。 */
  function ensure(): Promise<any> {
    if (ready) return ready
    ready = Promise.resolve().then(function (): any {
      let got: any = null
      try { got = (typeof o.getTrackerRegistry === 'function') ? o.getTrackerRegistry() : null } catch (eGet: any) { cache = null; return null }
      return Promise.resolve(got).then(function (v: any): any { cache = v || null; return cache }, function (): any { cache = null; return null })
    })
    return ready
  }

  /** 同步读「这个后端按什么口径花钱」；缓存就绪前只认同步注册表，其余一律未知口径。 */
  function budgetModelOf(backendId: string): any {
    try {
      let reg: any = cache
      if (!reg && typeof o.getTrackerRegistry === 'function') {
        const got: any = o.getTrackerRegistry()
        // 生产这里拿到的是 Promise（交给 ensure() 解析，这里只防它被当成注册表读）；同步假件直接采用。
        if (got && typeof got.then === 'function') { try { got.catch(function (): void {}) } catch (eC: any) {} } else if (got) reg = got
      }
      const mods: any[] = (reg && typeof reg.modules === 'function') ? reg.modules() : []
      for (let i = 0; i < mods.length; i += 1) if (mods[i] && mods[i].id === backendId) return mods[i].budget || { kind: 'unknown' }
    } catch (e) { /* 取不到声明不拦本次调用，按未知口径记账 */ }
    return { kind: 'unknown' }
  }

  return { ensure: ensure, budgetModelOf: budgetModelOf }
}
