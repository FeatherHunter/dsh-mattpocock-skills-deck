/**
 * seam/rpc.ts · B3 rpc 绑定（客户端调用 → 宿主端点）
 *
 * R1 接口：rpc.call(endpoint, args): Promise<value> 统一解包
 *   dev：host.call('wf.' + endpoint, args)（动态 runner 注入，调用方自判 res.ok）
 *   pkg：rpcCall(endpoint, args)（conn.rpc.call(CARRIER_CHANNEL, CARRIER_ENDPOINT, { method, payload })
 *        → RpcResult 解包 → res.value）
 *
 * 关键约束（实测）：两种方言的调用方看到同一形状 —— 宿主 handler 的原始返回值
 * （{ok, ...} 载荷）。动态 host.call 直返 handler 结果；pkg rpcCall 解包 RpcResult 信封
 * 后返回 res.value（= handler 结果）。因此 pkg 侧 host shim 的 call 只需去掉 'wf.' 前缀
 * 并转发给 rpcCall，行为即等价。
 *
 * #596 载体口径：DSH 的 connection.rpc.call 按 `${channel}/${endpoint}` 拼出请求路径。
 * 旧写法（channel='/dsws'）拼出 /dsws/<端点>，落在宿主那条要 webServer 注入的前缀路由上——
 * 注册期必抛 cannot get property "webServer" without inject，通道起不来。
 * 现在走 DSH 公开的 /api 载体：宿主按精确路径 /api/dsws 注册一条路由，客户端把真正的
 * 端点名与入参装进请求体（{method, payload}，与 dsh-im-companion 同构）。
 * 两侧路径必须一致，门禁见 tests/verify-596-rpc-carrier.ts。
 */

/** /api 载体上的通道名与端点名（#596）：拼出的请求路径 = `/api/dsws`，与宿主注册路径同源。 */
export const CARRIER_CHANNEL = '/api'
export const CARRIER_ENDPOINT = 'dsws'

interface PkgCtx {
  get?(name: string): unknown
}

interface RpcConnection {
  rpc: {
    call(channel: string, endpoint: string, body: { method: string; payload: unknown }): Promise<RpcResult>
  }
}

/** RpcResult 信封：ok 时 value 即 handler 原始返回值；不 ok 时看 error。 */
interface RpcResult {
  ok?: unknown
  value?: unknown
  error?: { message?: unknown } | null
}

/**
 * pkg 方言的 host shim 工厂：把动态方言的 host.call('wf.x', args) 映射到 rpcCall。
 * @param getCtx 返回当前 apply 的 ctx（由运行时外壳注入）
 */
export function createPkgHost(getCtx: () => PkgCtx): {
  call(method: string, args: unknown): Promise<unknown>
  _rpcCall(endpoint: string, args: unknown): Promise<unknown>
} {
  const rpcCall = async function (endpoint: string, args: unknown): Promise<unknown> {
    const ctx = getCtx()
    const conn = (ctx && ctx.get && ctx.get('connection')) as RpcConnection | undefined
    if (conn === undefined || conn.rpc === undefined) throw new Error('connection 服务不可用')
    const res = await conn.rpc.call(CARRIER_CHANNEL, CARRIER_ENDPOINT, { method: endpoint, payload: args })
    if (res && res.ok) return res.value
    // error.message 在运行时原样喂给 Error（原文如此：非字符串由 Error 自己转，Symbol 会抛）；
    // 这里只做类型断言、运行时表达式与原文一致 —— 对抗审查结论：加 String() 反而在 Symbol
    // 处改了语义（String(sym) 成功、new Error(sym) 抛），所以断言是唯一零差别的写法。
    throw new Error(((res && res.error && res.error.message) || ('RPC 失败：' + endpoint)) as string)
  }
  return {
    call: (method, args) => rpcCall(method.replace(/^wf\./, ''), args),
    _rpcCall: rpcCall,
  }
}

/** dev 实现说明：host 是 runner 注入的自由变量，直接调用 host.call('wf.'+ep, args）。
 * 本绑定说明的形状只在本文件内用，不导出 —— 跨文件引用会多出层内边（同层禁引），6 份各自写一份。 */
interface SeamDescribe {
  b: string
  name: string
  covers: string[]
  dev: string
  pkg: string
}

export const describe = (): SeamDescribe => ({
  b: 'B3',
  name: 'rpc',
  covers: ['D5 host.call vs rpcCall / RpcResult 解包', '#596 /api 载体交接'],
  dev: 'host.call("wf."+endpoint, args)（runner 注入，自判 res.ok）',
  pkg: "conn.rpc.call('/api', 'dsws', { method, payload }) → res.value（统一解包 + 抛错）",
})
