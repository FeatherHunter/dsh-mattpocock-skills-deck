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
//   #1492 新增：
//   G 新算的一趟只做一次写探测、缓存命中只再补一次（补算没有在入口与出口各做一遍）
//   H 补算整体失败：回包带 sessionPatchFailed 标记、是副本、缓存本体没被改；并留一行 warn 日志
//   I 补算超时：卡住的写探测按 pending 返回（不把整条命中路径挂死），detail 说明超时；
//     单项超时不算整趟失败，不打 sessionPatchFailed（那一行是诚实 pending，记成本会话产出也不会传错）
//   J 结构棘轮：外层出口只有一个补算调用，且外层没有提前 return 绕开它（只防结构退化，不假装能证明语义）
//
// 运行：node --import ./scripts/ts-hook.mts tests/verify-1483-chain-session-cache.ts
// 门禁归属: src/refresh/rooms/host/check-chain-evaluation.ts, src/refresh/rooms/host/chain-session-patch.ts, src/refresh/rooms/host/chain-step-rows.ts, src/shared/tracker/check-catalog-dirs.ts, src/shared/tracker/check-catalog-views.ts, src/shared/tracker/chain-types.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
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
  const warnLogs: AnyObj[] = []
  // F 用：把第一次求值的 getPlatform 卡住，好让第二次请求在「第一轮还没跑完」时进来搭车。
  const platformGate: AnyObj = { promise: null, release: null }
  let dedupMode = false
  // G/H/I 用：写探测计数、卡住写探测、整体失败（getPlatform 抛）、超时快档。
  let writeCalls = 0
  let hangWrite = false
  let platformThrows = false
  let fastTimeout = false
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
      // 写探测：G 数次数；I 让它永远不回来（验证出口侧的超时）；只读许可照旧抛沙箱拒信。
      writeText: (_t: string, _d: string, _e: unknown, _f: unknown, policy: AnyObj) => {
        writeCalls += 1
        if (hangWrite) return new Promise(() => undefined)
        if (policy && policy.mode === 'read-only') return Promise.reject(new Error('file access denied: workspace-write sandbox denies this write'))
        return Promise.resolve(undefined)
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
    getPlatform: async () => { if (platformThrows) throw new Error('fake platform unavailable'); return platformGate.promise ? platformGate.promise : fakePlatform },
    getTrackerRegistry: async () => ({ modules: () => [] }),
    getRepoKey: async () => null,
    // I 用：fastTimeout 时 5ms 就判超时；其余场景永不触发（与真实接线「定时器只用来兜超时」同形）。
    timer: { timeout: (ms: number) => (fastTimeout ? new Promise((resolve) => setTimeout(resolve, 5)) : new Promise(() => undefined)) },
    probeSkill: async () => ({ ok: false, level: 'pending' }),
    mdParseOkPredicate: async () => ({ status: 'pass' }),
    getChainCache: () => null,
    setChainCache: () => undefined,
    getChainBackoff: async () => backoff,
    // 记录 chain.cache.hit 的字段函数求值结果；其它事件不关心。
    logCtx: {
      isEnabled: (level: string) => level === 'debug',
      fire: (level: string, event: string, fields: AnyObj | (() => AnyObj)) => {
        if (event === 'host.call.fail') { try { warnLogs.push(typeof fields === 'function' ? (fields as () => AnyObj)() : fields) } catch (eW) {} ; return }
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

  // G. 出口只补算一次：新算的一趟只做一次写探测；缓存命中只再补一次，不会入口补一遍、出口再补一遍。
  dedupMode = true
  platformGate.promise = null
  writeCalls = 0
  const freshReply = await detect.handleChain({ cwd: '/ws', backendId: 'markdown', sessionId: 'writable-session', lang: 'zh' } as any) as AnyObj
  ok(freshReply.ok === true, 'G 新算的一趟拿到回包')
  ok(freshReply.sessionPatchFailed === undefined, 'G 现算的回包不带失败标记（标记只在补算失败时出现，钉住回包形状）', JSON.stringify(freshReply.sessionPatchFailed))
  ok(writeCalls === 1, 'G 新算的一趟只做一次写探测（没有重复补算）', writeCalls)
  dedupMode = false
  const hitReply = await detect.handleChain({ cwd: '/ws', backendId: 'markdown', sessionId: 'writable-session', lang: 'zh' } as any) as AnyObj
  ok(hitReply.ok === true, 'G 缓存命中拿到回包')
  ok(writeCalls === 2, 'G 缓存命中只再补算一次写探测', writeCalls)

  // H. 补算整体失败（取平台时抛）：回包带 sessionPatchFailed 标记、是副本、缓存本体没被改，并留一行 warn。
  platformThrows = true
  const failedPatchReply = await detect.handleChain({ cwd: '/ws', backendId: 'markdown', sessionId: 'readonly-session', lang: 'zh' } as any) as AnyObj
  platformThrows = false
  ok(failedPatchReply.ok === true, 'H 补算失败时照旧回原回包（不把链打成失败）')
  ok(failedPatchReply.sessionPatchFailed === true, 'H 回包带 sessionPatchFailed 标记（客户端据此不写共享缓存）', JSON.stringify(failedPatchReply.sessionPatchFailed))
  ok(failedPatchReply !== cachedReply, 'H 打标记时回包仍是副本（缓存本体不能原地改）')
  ok(JSON.stringify(cachedReply) === cachedBefore, 'H 补算失败也没改共享缓存本体')
  ok(warnLogs.some((w: AnyObj) => String(w.kind || '') === 'chain-session-patch'), 'H 补算整体失败留了一行 warn', JSON.stringify(warnLogs))

  // I. 补算超时：写探测永远不回来时，按 pending 返回，不把命中路径挂死。
  hangWrite = true
  fastTimeout = true
  const timeoutReply = await Promise.race([
    detect.handleChain({ cwd: '/ws', backendId: 'markdown', sessionId: 'readonly-session', lang: 'zh' } as any),
    new Promise((resolve) => setTimeout(() => resolve({ hung: true }), 1000)),
  ]) as AnyObj
  hangWrite = false
  fastTimeout = false
  ok(timeoutReply && timeoutReply.hung !== true && timeoutReply.ok === true, 'I 写探测卡住时补算按时返回（整条命中路径不挂死）')
  const timedRow = (timeoutReply && timeoutReply.backendChain && timeoutReply.backendChain.resolved && timeoutReply.backendChain.resolved['md:scratchWritable']) || {}
  ok(timedRow.status === 'pending', 'I 超时那一行按 pending（诚实未知）', timedRow.status)
  ok(/超时|timed out|timeout/i.test(String(timedRow.detail || '')), 'I detail 说明超时', timedRow.detail)
  ok(timeoutReply.sessionPatchFailed !== true, 'I 单项超时不算整体失败（不打 sessionPatchFailed）')

  // J. 结构棘轮：外层出口只调用一次补算，且外层里没有第二个 return 能提前把回包交出去
  //   （在补算块之前加一句 return 就绕过了补算，这正是票里担心的「以后新增路径再漏一次」）。
  //   这条只防结构退化，不假装能证明每条路径都按本会话算过；语义那部分由 G（同一趟只探测一次）
  //   与 H/I（失败、超时的形状）行为上钉住，剩下靠审查。
  const evalSrc = fs.readFileSync(new URL('../src/refresh/rooms/host/check-chain-evaluation.ts', import.meta.url), 'utf8')
  const patchCalls = (evalSrc.match(/await patchReplyForSession\(/g) || []).length
  ok(patchCalls === 1, 'J 补算只在一处调用（唯一出口）', patchCalls)
  const outerStart = evalSrc.indexOf('async function handleChain(')
  const patchIdx = evalSrc.indexOf('await patchReplyForSession(', outerStart)
  const beforePatch = (outerStart >= 0 && patchIdx > outerStart) ? evalSrc.slice(outerStart, patchIdx) : ''
  const returnsBeforePatch = (beforePatch.match(/\breturn\b/g) || []).length
  ok(returnsBeforePatch === 1, 'J 补算之前只有空目录闸那一个 return，没有提前把回包交出去的岔路', returnsBeforePatch)

  assert.equal(failed, false)
  console.log(failed ? '\n存在失败' : '\n全部通过')
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
