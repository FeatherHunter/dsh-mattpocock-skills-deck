/**
 * seam/rpc.js · B3 rpc 绑定（客户端调用 → 宿主端点）
 *
 * R1 接口：rpc.call(endpoint, args): Promise<value> 统一解包
 *   dev：host.call('wf.' + endpoint, args)（动态 runner 注入，调用方自判 res.ok）
 *   pkg：rpcCall(endpoint, args)（conn.rpc.call('/dsws', endpoint, args) → RpcResult 解包 → res.value）
 *
 * 关键约束（实测）：两种方言的调用方看到同一形状 —— 宿主 handler 的原始返回值
 * （{ok, ...} 载荷）。动态 host.call 直返 handler 结果；pkg rpcCall 解包 RpcResult 信封
 * 后返回 res.value（= handler 结果）。因此 pkg 侧 host shim 的 call 只需去掉 'wf.' 前缀
 * 并转发给 rpcCall，行为即等价。
 */

/**
 * pkg 方言的 host shim 工厂：把动态方言的 host.call('wf.x', args) 映射到 rpcCall。
 * @param {() => object} getCtx 返回当前 apply 的 ctx（由运行时外壳注入）
 */
export function createPkgHost(getCtx) {
  const rpcCall = async function (endpoint, args) {
    const ctx = getCtx()
    const conn = ctx && ctx.get && ctx.get('connection')
    if (conn === undefined || conn.rpc === undefined) throw new Error('connection 服务不可用')
    const res = await conn.rpc.call('/dsws', endpoint, args)
    if (res && res.ok) return res.value
    throw new Error((res && res.error && res.error.message) || ('RPC 失败：' + endpoint))
  }
  return {
    call: (method, args) => rpcCall(method.replace(/^wf\./, ''), args),
    _rpcCall: rpcCall,
  }
}

/** dev 实现说明：host 是 runner 注入的自由变量，直接调用 host.call('wf.'+ep, args)。 */
export const describe = () => ({
  b: 'B3',
  name: 'rpc',
  covers: ['D5 host.call vs rpcCall / RpcResult 解包'],
  dev: 'host.call("wf."+endpoint, args)（runner 注入，自判 res.ok）',
  pkg: 'conn.rpc.call("/dsws", endpoint, args) → res.value（统一解包 + 抛错）',
})
