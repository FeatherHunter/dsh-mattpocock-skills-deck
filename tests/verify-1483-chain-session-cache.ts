// tests/verify-1483-chain-session-cache.ts —— #1483：共享链缓存命中时，按当前会话重算依赖沙箱许可的行
//
// 背景：链快照的退避缓存按「工作区 + 后端 + 语言」共享（#324/#653 的设计，子目录会话要秒显）。
//   md:scratchWritable 量的是「当前会话能不能往 .scratch 写」：只读会话量出来是 pending，可写会话是 done。
//   缓存命中直接回上一份快照时，只读会话会看到别的会话量出的「可写」。
//
// 本文件的判据：
//   A 可写会话命中缓存 → 那一行仍是 done（照常重算后通过），回包是副本、缓存本体没被改
//   B 只读会话命中同一份缓存 → 那一行变 pending（诚实未知），三处视图都变：resolved、backendChain.snapshot、fullSnapshot
//   C 只读会话的回包里，同一行的 detail 是「被沙箱拦住」而不是「目录不可写」（别把沙箱限制误报成权限问题）
//   D 再换回可写会话 → 又是 done（重算不串会话）
//   E chain.cache.hit 记了 patched=1（这次命中确实按本会话重算了一项）
//   F 两会话并发首挂：后到的那次搭前一次的车（没有缓存命中可走），拿到回包后同样按自己的会话重算
//     ——只读会话看到 pending、先到的可写会话仍是 done；搭车这件事本身仍被记了一次（dedup）
//
// 运行：node --import ./scripts/ts-hook.mts tests/verify-1483-chain-session-cache.ts
// 门禁归属: src/refresh/rooms/host/check-chain-evaluation.ts, src/refresh/rooms/host/chain-session-patch.ts, src/refresh/rooms/host/chain-step-rows.ts, src/shared/tracker/check-catalog-dirs.ts, src/shared/tracker/check-catalog-views.ts, src/shared/tracker/chain-types.ts
import assert from 'node:assert/strict'
import { createDetectChain } from '../src/refresh/rooms/host/check-chain-evaluation.js'
import { catalogFor } from '../src/shared/tracker/check-catalog-dirs.js'
import { catalogItemToCheckItem } from '../src/shared/tracker/check-catalog-views.js'
import { assembleFullSnapshot, enrichSnap, stepEvalParallel } from '../src/refresh/rooms/host/chain-step-rows.js'

type AnyObj = { [key: string]: any }
let failed = false
const ok = (cond: boolean, msg: string, detail?: unknown): void => {
  if (cond) console.log('  PASS ' + msg)
  else { failed = true; console.log('  FAIL ' + msg + (detail === undefined ? '' : ' — ' + String(detail).slice(0, 400))) }
}

async function main(): Promise<void> {
  // 用真实的 markdown 后端目录搭出后端链：md:scratchWritable 带 sessionScoped，md:parseOk 不带。
  const chain: AnyObj[] = catalogFor('markdown')
    .filter((c: AnyObj) => c.scope === 'backend' && c.id !== 'gh:labels')
    .map((c: AnyObj) => catalogItemToCheckItem(c as any) as AnyObj)

  const cachedResolved: AnyObj = {}
  const cachedEval: AnyObj = {}
  for (const item of chain) {
    cachedResolved[item.id] = { status: 'pass', detail: '缓存里上一次求值的结论' }
    cachedEval[item.id] = 'pass'
  }
  const cachedBackendSnap = enrichSnap(stepEvalParallel(chain as any, cachedEval), cachedResolved as any)
  const cachedFull = assembleFullSnapshot(cachedBackendSnap!.steps as any)
  // 缓存的完整回包（形状与宿主 result 一致；内容取自「可写会话」上一次的求值）。
  const cachedReply: AnyObj = {
    ok: true,
    backendId: 'markdown',
    chain: [],
    resolved: {},
    snapshot: null,
    backendChain: { chain: chain, resolved: cachedResolved, snapshot: cachedBackendSnap, errors: [] },
    fullChain: chain,
    fullSnapshot: cachedFull,
    chainSource: 'background',
  }
  const cachedBefore = JSON.stringify(cachedReply)

  const logHits: AnyObj[] = []
  // F 用：把第一次求值的 getPlatform 卡住，好让第二次请求在「第一轮还没跑完」时进来搭车。
  const platformGate: AnyObj = { promise: null, release: null }
  let dedupMode = false
  const backoff = {
    verdict: async () => (dedupMode
      ? { needed: true, reason: 'due', waitMs: 0, cached: null }
      : { needed: false, reason: 'all-green', waitMs: 60000, cached: cachedReply }),
    note: async () => ({}),
  }

  // 假的平台层：目录存在；写探测按本次调用带的沙箱许可决定成败（只读许可抛的错与 DSH 沙箱拒信同形）。
  const fakePlatform: AnyObj = {
    path: { join: (...parts: string[]) => parts.join('/') },
    env: { get: () => undefined, has: () => false },
    fs: {
      resolve: async (p: string, o: AnyObj) => (o && o.cwd ? String(o.cwd) + '/' + String(p) : String(p)),
      exists: async (t: string) => /\.scratch$/.test(String(t)),
      listDir: async () => [],
      stat: async () => ({ isDirectory: () => true }),
      writeText: async (_t: string, _d: string, _e: unknown, _f: unknown, policy: AnyObj) => {
        if (policy && policy.mode === 'read-only') throw new Error('file access denied: workspace-write sandbox denies this write')
        return undefined
      },
      unlink: async () => undefined,
      readText: async () => '',
    },
  }

  const detect = createDetectChain({
    canonicalKey: async (c: string) => c,
    DEFAULT_CWD: '/ws',
    resetGhCache: () => undefined,
    getDetectionService: async () => ({ detect: async () => ({ selection: { backendId: 'markdown' }, explicit: null }) }),
    getPlatform: async () => (platformGate.promise ? platformGate.promise : fakePlatform),
    getTrackerRegistry: async () => ({ modules: () => [] }),
    getRepoKey: async () => null,
    timer: { timeout: () => new Promise(() => undefined) },
    probeSkill: async () => ({ ok: false, level: 'pending' }),
    mdParseOkPredicate: async () => ({ status: 'pass' }),
    getChainCache: () => null,
    setChainCache: () => undefined,
    getChainBackoff: async () => backoff,
    // 记录 chain.cache.hit 的字段函数求值结果；其它事件不关心。
    logCtx: {
      isEnabled: (level: string) => level === 'debug',
      fire: (level: string, event: string, fields: AnyObj | (() => AnyObj)) => {
        if (event !== 'chain.cache.hit') return
        try { logHits.push(typeof fields === 'function' ? (fields as () => AnyObj)() : fields) } catch (e) {}
      },
    } as any,
    gate: null,
    sandboxPolicyFor: async (info: { cwd: string; sessionId: string }) => ({
      policy: { mode: info.sessionId === 'readonly-session' ? 'read-only' : 'workspace-write' },
      sessionId: info.sessionId,
    }),
  } as any)

  const stepOf = (snap: AnyObj | null, id: string): AnyObj | null => {
    const steps: AnyObj[] = (snap && Array.isArray(snap.steps)) ? snap.steps : []
    return steps.find((s: AnyObj) => String(s.id) === id) || null
  }

  // A. 可写会话：命中缓存，重算后仍是 done；回包是副本，缓存本体没被改
  const writableReply = await detect.handleChain({ cwd: '/ws', backendId: 'markdown', sessionId: 'writable-session', lang: 'zh' } as any)
  ok(!!writableReply && writableReply.ok === true, 'A 可写会话拿到回包', JSON.stringify(writableReply && (writableReply as AnyObj).error))
  ok(writableReply !== cachedReply, 'A 回包是副本（没有把缓存对象原样交出去）')
  ok(((writableReply as AnyObj).backendChain.resolved['md:scratchWritable'] || {}).status === 'pass', 'A 可写会话：md:scratchWritable 仍是 pass')
  ok((stepOf((writableReply as AnyObj).backendChain.snapshot, 'md:scratchWritable') || {}).status === 'done', 'A 可写会话：backendChain.snapshot 里是 done')
  ok((stepOf((writableReply as AnyObj).fullSnapshot, 'md:scratchWritable') || {}).status === 'done', 'A 可写会话：fullSnapshot 里是 done')

  // B/C. 只读会话：同一份缓存，那一行变 pending（诚实未知），三处视图都变，detail 说的是沙箱拦住
  const readonlyReply = await detect.handleChain({ cwd: '/ws', backendId: 'markdown', sessionId: 'readonly-session', lang: 'zh' } as any) as AnyObj
  ok(readonlyReply.ok === true, 'B 只读会话拿到回包', JSON.stringify(readonlyReply.error))
  const roResolved = readonlyReply.backendChain.resolved['md:scratchWritable'] || {}
  ok(roResolved.status === 'pending', 'B 只读会话：resolved 里 md:scratchWritable 变 pending（实得 ' + roResolved.status + '）')
  ok((stepOf(readonlyReply.backendChain.snapshot, 'md:scratchWritable') || {}).status === 'pending', 'B 只读会话：backendChain.snapshot 里变 pending')
  ok((stepOf(readonlyReply.fullSnapshot, 'md:scratchWritable') || {}).status === 'pending', 'B 只读会话：fullSnapshot 里变 pending')
  ok(/沙箱|sandbox/i.test(String(roResolved.detail || '')), 'C 只读会话：detail 说的是被沙箱拦住，不是目录不可写', roResolved.detail)
  ok((stepOf(readonlyReply.fullSnapshot, 'md:parseOk') || {}).status === 'done', 'B 非会话相关项沿用缓存判定（md:parseOk 仍是 done）')

  // D. 换回可写会话：又是 done（重算不串会话），缓存仍未被改
  const writableAgain = await detect.handleChain({ cwd: '/ws', backendId: 'markdown', sessionId: 'writable-session', lang: 'zh' } as any) as AnyObj
  ok(((writableAgain.backendChain.resolved['md:scratchWritable'] || {}).status) === 'pass', 'D 再换回可写会话：又是 pass')
  ok(JSON.stringify(cachedReply) === cachedBefore, 'D 整个过程共享缓存本体一个字没被改')
  ok(cachedReply.backendChain.resolved['md:scratchWritable'].status === 'pass', 'D 缓存里那一行仍是当初可写会话量出的 pass')

  // E. 日志：每次命中都记 patched=1（有一项按本会话重算过）
  ok(logHits.length >= 3, 'E 三次命中都落了 chain.cache.hit', logHits.length)
  ok(logHits.every((h: AnyObj) => h.patched === 1), 'E chain.cache.hit 记 patched=1', JSON.stringify(logHits.map((h: AnyObj) => h.patched)))

  // F. 并发首挂：没有缓存可命中，后到的第二次请求搭前一次的车；搭车拿到的回包必须按本会话重算
  dedupMode = true
  platformGate.promise = new Promise((resolve) => { platformGate.release = resolve })
  const firstReply = detect.handleChain({ cwd: '/ws', backendId: 'markdown', sessionId: 'writable-session', lang: 'zh' } as any)
  // 等第一轮把车停进搭车表（此时它卡在 getPlatform 上，车还没跑完）
  for (let i = 0; i < 200 && detect.rideStats().inflight < 1; i++) await new Promise((r) => setTimeout(r, 5))
  ok(detect.rideStats().inflight >= 1, 'F 第一轮已停进搭车表（并发请求能搭上车）')
  const secondReply = detect.handleChain({ cwd: '/ws', backendId: 'markdown', sessionId: 'readonly-session', lang: 'zh' } as any)
  await new Promise((r) => setTimeout(r, 20))
  platformGate.promise = null
  platformGate.release(fakePlatform)
  const [first, second] = await Promise.all([firstReply, secondReply]) as AnyObj[]
  ok(detect.rideStats().merged >= 1, 'F 第二次请求确实搭了车（没有另起一轮求值）', JSON.stringify(detect.rideStats()))
  ok(((first.backendChain.resolved['md:scratchWritable'] || {}).status) === 'pass', 'F 先到的可写会话仍是 pass')
  ok(((second.backendChain.resolved['md:scratchWritable'] || {}).status) === 'pending', 'F 搭车的只读会话按自己许可重算成 pending（实得 ' + ((second.backendChain.resolved['md:scratchWritable'] || {}).status) + '）')
  ok((stepOf(second.backendChain.snapshot, 'md:scratchWritable') || {}).status === 'pending', 'F 搭车回包的 backendChain.snapshot 也变 pending')
  ok((stepOf(second.fullSnapshot, 'md:scratchWritable') || {}).status === 'pending', 'F 搭车回包的 fullSnapshot 也变 pending')
  ok(first !== second, 'F 两次回包是两个对象（搭车那次拿到的是重算后的副本）')

  assert.equal(failed, false)
  console.log(failed ? '\n存在失败' : '\n全部通过')
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
