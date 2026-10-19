#!/usr/bin/env node
/**
 * verify-735-chain-restore.ts —— 门禁：工作路线落盘后有人读回（票 #735）
 *
 * 守的是什么：会话↔票工作路线的内存表按进程活，盘是跨进程的唯一副本。
 * `restore` 写好了但生产里没人调（#732 顺手抓到的真缺陷），重启即丢内存：
 * 盘里有旧数据，读数里永远看不见。修法只动接线一处（wiring.js 的 attach 与
 * syncAttention），本门禁钉住那两处调用，真跑一遍“记→重启→回来”。
 *
 * 它怎么判（四段，编号沿用原先四段里的二、三、四，另加第五段直接看返回值）：
 *   原先的第一段是「读 src/** 的源码文本、数 `.restore(` 只出现在哪个文件」的静态形状门禁，
 *   2026-10 按维护者口径整段撤掉：那种断言的对象是手写源码的文本，等价重构（改写法、
 *   搬文件、改注释）就会变红。
 *   二、行为：真接线加真盘，记一笔 → 用同一目录建第二套接线并 focus 那个根
 *      （模拟重启后的新进程第一次切进工作区）→ 读数里必须有那一笔，
 *      且接线里那一次 `restore()` 的返回值要证明真从盘上读回了
 *      （restored 与 entries 都不为 0、cache 是 hit、reason 是 chain.disk-ok）。
 *      2026-10-19 #1083 起不再靠 `sessionTickets.chain` 的 restore 日志判断：那条事件已退役，
 *      接线只把 restore() 的返回值交给注入的探针记下来，本门禁的断言全部对着返回值做。
 *   三、行为：切进工作区按根读回。内存清空后（模拟重启），focus 那个工作区根 →
 *      读数回来；同一个根 focus 两次，按根只许调一次 `restore()`（一根只读一次，
 *      不给高频动作加磁盘读）。
 *   四、负控：裸链实例不调 `restore` 就是空（证明二、三不是恒绿的装饰）。
 *   五、盘面直接覆盖：拿裸的 workRoute 实例把 restore() 返回值在几种盘面上各走一遍 ——
 *      命中（hit）、文件不存在（miss）、坏文件（JSON 解析失败）、形状不对；
 *      另加版本不认与「按根过滤只留这个根」两条。
 *
 * 用法: node --import ./scripts/ts-hook.mts tests/verify-735-chain-restore.ts（在插件根目录）
 * 本文件是 CommonJS：取产品源码走 pathToFileURL + 动态 import，不加静态 import，所以加类型标注不会把它变成 ESM。
 * 退出码：0 = 通过；1 = 有违规。
 */
const fs = require('fs')
const path = require('path')
const os = require('os')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
const url = (rel: string): string => pathToFileURL(path.join(ROOT, rel)).href

/** 日志出口收到的一行：本门禁不再从日志判断读回，这个出口只留给接线当出口用（二、三段的证据改用 restore() 返回值）。 */
interface FiredLog {
  level?: string
  event?: string
  fields?: any
}

let failed = false
let total = 0
const check = (ok: boolean, msg: string, detail?: string): void => {
  total += 1
  console.log((ok ? '  PASS ' : '  FAIL ') + msg + (ok || !detail ? '' : '\n         → ' + detail))
  if (!ok) failed = true
}

/** 等一个条件成立（轮询到为止，超时回空）：接线里的读回是 fire-and-forget，测试靠读数同步，不靠睡固定时长。 */
async function waitFor(fn: () => unknown, timeoutMs?: number): Promise<any> {
  const t0 = Date.now()
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() - t0 > (timeoutMs || 5000)) return null
    await new Promise((r) => setTimeout(r, 25))
  }
}

/**
 * 一套能跑起来的接线依赖：形状照宿主入口传进去的那一份抄，只把目录与日志换成测试的。
 * 第三个参数给了就原样当 `workRoute` 注入（wiring 见 d.workRoute 就直接用，不再自己建），
 * 二、三段用它包一层探针，把接线里那一次 `restore()` 的入参与返回值记下来。
 */
function makeDeps(dir: string, events: FiredLog[], workRoute?: any) {
  return {
    ctx: { on: () => () => {}, get: () => undefined },
    logCtx: {
      isEnabled: () => true,
      fire: (level, event, fields) => { events.push({ level: level, event: event, fields: (typeof fields === 'function') ? fields() : fields }) },
    },
    canonicalKey: async (x) => String(x),
    getCacheDir: async () => dir,
    getTrackerRegistry: async () => ({ describe: () => ({ backend: 'github' }), modules: () => [] }),
    getDetectionService: async () => ({ detect: async () => ({ selection: { backendId: 'github' } }) }),
    getPlatform: async () => ({ os: 'win32', path: path }),
    workRoute: workRoute,
  }
}

/**
 * 给真的 workRoute 包一层探针：接线里每调一次 `restore()`，把入参与返回值抄进 calls，
 * 再把返回值原样交回去（行为不变）。二、三段就靠这份记录证明「读回真发生了」。
 */
function makeRestoreSpy(real: any, calls: Array<{ opts: any; out: any }>): any {
  return Object.assign({}, real, {
    restore: async (opts: any): Promise<any> => {
      const out: any = await real.restore(opts)
      calls.push({ opts: opts, out: out })
      return out
    },
  })
}

/** 这份 restore() 返回值算不算「真读回了这个根的一格」：读到的格与条数都不为 0、缓存命中、落盘形状正常。 */
function restoreHitOf(out: any): boolean {
  return !!out && out.restored >= 1 && out.entries >= 1 && out.cache === 'hit' && out.reason === 'chain.disk-ok'
}

/** 把 restore() 返回值压成一句话，失败详情里直接能看出差在哪一档。 */
function outText(out: any): string {
  if (!out) return '无返回值'
  return 'restored=' + out.restored + '、entries=' + out.entries + '、cache=' + out.cache + '、reason=' + out.reason
}

async function main(): Promise<void> {
  console.log('#735 工作路线落盘读回门禁（按根读回 / 一根一次 / 负控 / 盘面返回值）')

  const wiringMod = await import(url('src/host/refresh/wiring.js'))
  const chainMod = await import(url('src/shared/refresh/chain.js'))
  const ticketsMod = await import(url('src/host/refresh/workRoute.ts'))
  const createWorkRoute: any = ticketsMod.createWorkRoute

  // ── 二、行为：重启后内存回来 ──
  console.log('\n== 二、重启后内存回来（两套接线共用一盘） ==')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't735-restore-'))
  const WS = 'd:\\ws\\735-home'
  const events1 = []
  const w1 = await wiringMod.makeRefreshLoader(makeDeps(dir, events1))()
  const noted = await w1.workRoute.note({
    sessionId: 'sess-735', rootHash: chainMod.chainRootHash(WS), backend: 'github',
    tool: 'pwsh', source: 'cli', tier: 'write-confirmed', reason: 'cmd.cli-write',
    verb: 'comment', ticketKey: '735', args: {},
  })
  check(!!noted && noted.recorded === true, '第一套接线记进一笔（735 comment）',
    '记不进去 = 后面“回来”无从谈起：' + JSON.stringify(noted))
  // 第二套接线 = 重启后的新进程：focus 那个根（生产里切进工作区的真路径），不许手工调 restore。
  // 探针包在真的 workRoute 外面：接线里那次 restore() 的入参与返回值都留在 restoreCalls2 里当证据。
  const events2 = []
  const real2 = createWorkRoute({ cacheDir: dir })
  const restoreCalls2: Array<{ opts: any; out: any }> = []
  const w2 = await wiringMod.makeRefreshLoader(makeDeps(dir, events2, makeRestoreSpy(real2, restoreCalls2)))()
  await w2.focus({ windowId: 'win-1', workspaceRoot: WS, kind: 'focus', visible: true })
  const back = await waitFor(() => {
    const r = w2.chainReadoutOf()
    return (r && r.ok === true && r.sessions.some((s) => s.entries.some((e) => e.ticketKey === '735'))) ? r : null
  })
  check(!!back, '第二套接线 focus 那个根之后读数里有那一笔（重启不丢）',
    '读数里没有 = 盘只是只写不读，修法没生效')
  const callsOfW2Root = restoreCalls2.filter((c) => !!c.opts && chainMod.chainRootHash(String(c.opts.rootKey)) === chainMod.chainRootHash(WS))
  const bootCall = callsOfW2Root.length > 0 ? callsOfW2Root[0] : null
  check(callsOfW2Root.length === 1,
    '接线对这个工作区根调了一次 restore()（实得 ' + callsOfW2Root.length + ' 次）',
    '没调 = 重启后没人读盘；调多次 = 一根一次被破坏')
  check(!!bootCall && restoreHitOf(bootCall.out),
    'restore() 返回值证明真从盘上读回（' + outText(bootCall && bootCall.out) + '）',
    '返回值不是「读回一格」= 磁盘读没命中或形状不对：' + JSON.stringify(bootCall && bootCall.out))
  try { w1.workRoute.drop(); w2.workRoute.drop() } catch (e) {}

  // ── 三、行为：按根读回，一根只读一次 ──
  console.log('\n== 三、切进工作区按根读回，一根只读一次 ==')
  const dir3 = fs.mkdtempSync(path.join(os.tmpdir(), 't735-perroot-'))
  const events3 = []
  const real3 = createWorkRoute({ cacheDir: dir3 })
  const restoreCalls3: Array<{ opts: any; out: any }> = []
  const w3 = await wiringMod.makeRefreshLoader(makeDeps(dir3, events3, makeRestoreSpy(real3, restoreCalls3)))()
  const WS_A = 'd:\\ws\\735-a'
  const H_A = chainMod.chainRootHash(WS_A)
  await w3.workRoute.note({
    sessionId: 'sess-a', rootHash: H_A, backend: 'github',
    tool: 'pwsh', source: 'cli', tier: 'write-confirmed', reason: 'cmd.cli-write',
    verb: 'edit', ticketKey: '730', args: {},
  })
  w3.workRoute.drop() // 模拟重启：内存清空，盘留着
  const emptyNow = w3.chainReadoutOf()
  check(!!emptyNow && emptyNow.sessions.length === 0, '内存清空后读数是空的（模拟出重启现场）',
    '这一步不空 = 后面“回来”证明不了什么')
  await w3.focus({ windowId: 'win-1', workspaceRoot: WS_A, kind: 'focus', visible: true })
  const backA = await waitFor(() => {
    const r = w3.chainReadoutOf()
    return (r && r.sessions.some((s) => s.entries.some((e) => e.ticketKey === '730'))) ? r : null
  })
  check(!!backA, 'focus 那个工作区根之后读数回来（按根读回生效）',
    '没回来 = 切工作区那条读回没接上')
  const callsOfRootA = (): Array<{ opts: any; out: any }> => restoreCalls3.filter((c) => !!c.opts && chainMod.chainRootHash(String(c.opts.rootKey)) === H_A)
  const perRootBefore = callsOfRootA().length
  const firstOfRootA = perRootBefore > 0 ? callsOfRootA()[0] : null
  check(perRootBefore >= 1 && !!firstOfRootA && restoreHitOf(firstOfRootA.out),
    '按这个根读回一次，restore() 返回值证明读回（' + outText(firstOfRootA && firstOfRootA.out) + '）',
    '没读到 = 按根读回没生效：' + JSON.stringify(restoreCalls3.map((c) => c.out)))
  await w3.focus({ windowId: 'win-1', workspaceRoot: WS_A, kind: 'focus', visible: true })
  await new Promise((r) => setTimeout(r, 300)) // 第二次 focus 若违规会再读一次，留 300ms 让它漏出来
  const perRootAfter = callsOfRootA().length
  check(perRootBefore >= 1 && perRootAfter === perRootBefore,
    '同一个根 focus 两次，按根只读回一次（实得 ' + perRootBefore + ' → ' + perRootAfter + '）',
    '多一次 = 每个 focus 都读盘，高频动作被加了磁盘读')

  // ── 四、负控：不调 restore 就是空 ──
  console.log('\n== 四、负控：不调 restore 就是空（门禁非恒绿的证据） ==')
  const readoutMod = await import(url('src/host/refresh/sessionChainReadout.js'))
  const dir4 = fs.mkdtempSync(path.join(os.tmpdir(), 't735-negative-'))
  const raw1 = createWorkRoute({ cacheDir: dir4, now: () => 1000 })
  await raw1.note({
    sessionId: 'sess-n', rootHash: chainMod.chainRootHash('d:\\ws\\735-n'), backend: 'github',
    tool: 'pwsh', source: 'cli', tier: 'write-confirmed', reason: 'cmd.cli-write',
    verb: 'edit', ticketKey: '731', args: {},
  })
  const raw2 = createWorkRoute({ cacheDir: dir4, now: () => 2000 })
  const neg = readoutMod.buildSessionChainReadout({ tickets: raw2, at: 2000 })
  check(!!neg && neg.ok === true && neg.sessions.length === 0 && neg.reason === 'host.chain.empty',
    '负控：新实例不调 restore，读数恒空（reason=host.chain.empty）',
    '这条不空 = 上面二、三的断言是恒绿的装饰：' + JSON.stringify(neg).slice(0, 120))

  // ── 五、盘面直接覆盖：restore() 返回值对准每一种盘面 ──
  // 这一段不经过接线，直接拿裸的 workRoute 实例读盘，把二、三段依赖的判据逐档钉住：
  // 命中必须真的数出格数与条数；读不到、文件坏、形状不对、版本不认必须如实说明白。
  console.log('\n== 五、restore() 返回值覆盖各种盘面（命中 / 不存在 / 坏文件 / 形状 / 版本） ==')

  // 命中：先记一笔（note 会当场落盘），再用同一目录的新实例读回这个根。
  const dir5 = fs.mkdtempSync(path.join(os.tmpdir(), 't735-hit-'))
  const ROOT_HIT = 'd:\\ws\\735-hit'
  const hitWriter = createWorkRoute({ cacheDir: dir5, now: () => 1000 })
  await hitWriter.note({
    sessionId: 'sess-hit', rootHash: chainMod.chainRootHash(ROOT_HIT), backend: 'github',
    tool: 'pwsh', source: 'cli', tier: 'write-confirmed', reason: 'cmd.cli-write',
    verb: 'comment', ticketKey: '736', args: {},
  })
  const hitReader = createWorkRoute({ cacheDir: dir5, now: () => 2000 })
  const hitOut = await hitReader.restore({ rootKey: ROOT_HIT })
  check(!!hitOut && hitOut.restored >= 1 && hitOut.entries >= 1 && hitOut.cache === 'hit' && hitOut.reason === 'chain.disk-ok',
    '命中：restore() 返回值证明这个根从盘上读回（' + outText(hitOut) + '）',
    '期望 restored>=1、entries>=1、cache=hit、reason=chain.disk-ok，实得 ' + JSON.stringify(hitOut))

  // 按根过滤：盘上那一份全是别的工作区的格子，新实例读回来一格都不收（缓存目录是进程级的）。
  const otherReader = createWorkRoute({ cacheDir: dir5, now: () => 3000 })
  const otherOut = await otherReader.restore({ rootKey: 'd:\\ws\\735-other' })
  check(!!otherOut && otherOut.restored === 0 && otherOut.entries === 0 && otherOut.cache === 'hit' && otherOut.reason === 'chain.disk-ok',
    '按根过滤：盘上有别的工作区的格子，读回来一格都不收（' + outText(otherOut) + '）',
    '收到格了 = 按根过滤失效：' + JSON.stringify(otherOut))

  // 文件不存在：空目录里没有落盘文件，读端说 miss + chain.disk-empty，不抛错。
  const dir6 = fs.mkdtempSync(path.join(os.tmpdir(), 't735-miss-'))
  const missOut = await createWorkRoute({ cacheDir: dir6 }).restore({})
  check(!!missOut && missOut.restored === 0 && missOut.entries === 0 && missOut.cache === 'miss' && missOut.reason === 'chain.disk-empty',
    '文件不存在：restore() 说 cache=miss、reason=chain.disk-empty（' + outText(missOut) + '）',
    '空盘说法不对 = 首次启动会被当成读失败：' + JSON.stringify(missOut))

  // 坏文件：JSON 解析不过不算命中，如实说 cache=bad + chain.disk-shape，不抛错。
  const dir7 = fs.mkdtempSync(path.join(os.tmpdir(), 't735-bad-'))
  fs.writeFileSync(path.join(dir7, 'session-tickets.json'), 'not json {')
  const badOut = await createWorkRoute({ cacheDir: dir7 }).restore({})
  check(!!badOut && badOut.restored === 0 && badOut.entries === 0 && badOut.cache === 'bad' && badOut.reason === 'chain.disk-shape',
    '坏文件：JSON 解析不过不算命中，如实说 cache=bad、reason=chain.disk-shape（' + outText(badOut) + '）',
    '坏文件被当成命中或抛错 = 坏盘会让重启崩：' + JSON.stringify(badOut))

  // 形状不对：合法 JSON 但 shards 不是数组，读端说 chain.disk-shape，一格不收。
  const dir8 = fs.mkdtempSync(path.join(os.tmpdir(), 't735-shape-'))
  fs.writeFileSync(path.join(dir8, 'session-tickets.json'), JSON.stringify({ v: 1, at: 1, shards: 'nope' }))
  const shapeOut = await createWorkRoute({ cacheDir: dir8 }).restore({})
  check(!!shapeOut && shapeOut.restored === 0 && shapeOut.entries === 0 && shapeOut.cache === 'hit' && shapeOut.reason === 'chain.disk-shape',
    '形状不对：合法 JSON 但 shards 不是数组，读端说 chain.disk-shape（' + outText(shapeOut) + '）',
    '形状不对被当成读回或抛错 = 坏盘会让重启崩：' + JSON.stringify(shapeOut))

  // 版本不认：v 既不是 1 也不是当前版本 2，整份丢掉并说 chain.disk-version（v:2 是合法版本，不能拿来测这一档）。
  const dir9 = fs.mkdtempSync(path.join(os.tmpdir(), 't735-version-'))
  fs.writeFileSync(path.join(dir9, 'session-tickets.json'), JSON.stringify({ v: 3, at: 1, shards: [] }))
  const verOut = await createWorkRoute({ cacheDir: dir9 }).restore({})
  check(!!verOut && verOut.restored === 0 && verOut.entries === 0 && verOut.cache === 'hit' && verOut.reason === 'chain.disk-version',
    '版本不认：v 既不是 1 也不是当前版本，读端说 chain.disk-version（' + outText(verOut) + '）',
    '版本不认被当成读回或抛错 = 旧盘会让新版本重启崩：' + JSON.stringify(verOut))

  console.log(failed ? '\n存在失败 — verify-735-chain-restore 未通过（共 ' + total + ' 项）' : '\n全部通过 — 落盘读回门禁生效（共 ' + total + ' 项）')
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error('门禁执行异常：' + ((e && e.stack) || e)); process.exit(1) })
