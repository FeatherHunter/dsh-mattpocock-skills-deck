#!/usr/bin/env node
// tests/verify-1444-chain.ts —— 门禁：检查链求值改问 Tracker 只读会话（票 #1444）
// 用法：在插件根目录执行 node --import ./scripts/ts-hook.mts tests/verify-1444-chain.ts
//
// 这一票把链求值里三处直调 gh 换成「经只读会话调能力」：登录态与仓库可达问会话的 preflight（一次求值只问一次），
// 取当前登录用户名问 getCurrentUser；求值那一笔记账改走闸上新开的 noteChainEval（闸内仍走 decide、仍记 0 条）。
// 门禁盯五件事：
//   ① 源码里不再有直调 gh、也不再有调用方自己拼的那一笔发送；
//   ② 会话 preflight 的每一种失败档位都落在正确的谓词状态上 —— 尤其是「登录失败」不许显示成「仓库不可达」；
//   ③ viewer/登录名走 getCurrentUser（不是另起一条 gh 命令）；
//   ④ 求值那笔记账仍是一笔零花费（经 noteChainEval，sent 加一、账上条数不动）；
//   ⑤ 退避与在途合并的判据没动（挡下的直接回缓存、同钥匙并发只求值一次）；
//   ⑥ 会话交来的操作上下文（platform/起进程口/日志口）必须原样传进房间 —— 只给 {cwd} 时房间第一关
//      就会回「找不到 gh」，链上登录态两项永远 pending（#1468 回归）。
const nodePath = require('path')
const { pathToFileURL } = require('url')

const ROOT = nodePath.resolve(__dirname, '..')
const url = (rel) => pathToFileURL(nodePath.join(ROOT, rel)).href

let total = 0
const broken = []
function must(cond, invariant, detail) {
  total += 1
  if (cond) { console.log('  PASS ' + invariant); return }
  const line = '  FAIL 不变式破了 —— ' + invariant + (detail ? '【实测：' + detail + '】' : '')
  console.log(line)
  broken.push(line.replace(/^\s+/, ''))
}
function title(t) { console.log('\n' + t) }

const CLOCK = 1700000000000
const PLATFORM = { os: 'win32', path: nodePath, async getHome() { return 'C:/Users/fake' } }

/** 假会话：只提供本票用到的两条读能力，并把每次调用记下来（用来断言「只问一次」「走的是哪条能力」）。 */
function makeSession(opts) {
  const o = opts || {}
  const stats = { preflight: 0, getCurrentUser: 0 }
  const handles = []
  // 记录房间实际收到的第二格（操作上下文）：用来断言会话 ctx 没有被换成 {cwd}（#1468）。
  const ctxs = { preflight: [], getCurrentUser: [] }
  const session = {
    async preflight(handle, ctx) {
      stats.preflight += 1
      handles.push(handle)
      ctxs.preflight.push(ctx)
      if (o.preflightThrows) throw new Error('会话能力抛了')
      return o.preflight || { ok: true }
    },
    async getCurrentUser(repo, ctx) {
      stats.getCurrentUser += 1
      ctxs.getCurrentUser.push(ctx)
      return o.user || { ok: true, data: { login: 'octocat' } }
    },
  }
  return { session: session, stats: stats, handles: handles, ctxs: ctxs }
}

/** 会话交给能力函数的那一份操作上下文（生产里由 session-opener 的 call 拼好）：带可辨认的标记。 */
const SESSION_CTX = { cwd: 'C:/stale', caller: 'refresh', platform: { marker: 'session-ctx-platform' }, exec: Object.assign(function sessionCtxExec() {}, { marker: 'session-ctx-exec' }) }

/** 开会话成功那一份形状：call(fn) 把假会话与一次 opCtx 交给能力函数（与 session-opener.ts 的回包同形）。 */
function openReplyOf(session) {
  return async function () {
    return { ok: true, backendId: 'github', budget: {}, call: function (fn) { return fn(session, SESSION_CTX) } }
  }
}

/** 一条最小检查链：探测直接回 github，退避恒说「该算」，其余依赖都按测试口径给最少的答复。 */
async function makeChain(opts) {
  const o = opts || {}
  const chainMod = await import(url('src/refresh/rooms/host/check-chain-evaluation.ts'))
  let detects = 0
  const chain = chainMod.createDetectChain({
    canonicalKey: async (raw) => String(raw || ''),
    DEFAULT_CWD: 'D:/demo',
    resetGhCache: () => {},
    getDetectionService: async () => ({ detect: async () => { detects += 1; if (o.detectMs) await new Promise((r) => setTimeout(r, o.detectMs)); return { selection: { backendId: 'github', source: 'auto' } } } }),
    getPlatform: async () => PLATFORM,
    getTrackerRegistry: async () => ({ modules: () => [] }),
    getRepoKey: async () => ({ owner: 'acme', name: 'demo' }),
    timer: { timeout: (ms) => new Promise((r) => setTimeout(r, ms)) },
    probeSkill: async () => ({ ok: true, level: 'ok', detail: 'fake' }),
    mdPredicate: async () => ({ status: 'pass', detail: 'fake' }),
    getChainCache: () => null,
    setChainCache: () => {},
    getChainBackoff: o.backoff || (async () => ({ verdict: async () => ({ needed: true, reason: 'test-always-due', waitMs: 0, cached: null }), note: async () => ({}) })),
    logCtx: o.logCtx || null,
    gate: o.gate || null,
    openSession: o.openSession || null,
  })
  return { chain: chain, detects: () => detects }
}

/** 取这一轮后端段里某一项判定（房间返回的键是检查项 id，不是谓词名）。 */
function resolvedOf(out, id) {
  const pack = out && out.backendChain
  const r = pack && pack.resolved && pack.resolved[id]
  return r || null
}

async function main() {
  title('① 源码：求值路径不再直调 gh，也不再自己拼发送')
  {
    const fs = require('fs')
    const src = fs.readFileSync(nodePath.join(ROOT, 'src/refresh/rooms/host/check-chain-evaluation.ts'), 'utf8')
    must(src.indexOf('runGh(') < 0, '求值文件里没有直调 gh（runGh( 零处）', '还有其他调用点')
    must(src.indexOf('gate.send') < 0, '求值文件里没有调用方自己拼的发送（gate.send 零处）', 'gate.send 还在')
    must(src.indexOf('noteChainEval(') >= 0, '求值文件改走闸上的 noteChainEval')
    const gateSrc = fs.readFileSync(nodePath.join(ROOT, 'src/refresh/rooms/host/refresh-gate.ts'), 'utf8')
    must(gateSrc.indexOf('noteChainEval') >= 0, '闸上确实开了 noteChainEval 这个方法')
  }

  title('② preflight 的每一种失败档位都落在正确的谓词上（对照表逐条）')
  {
    // 档位 → 期望状态。ghAuth 一列判「登录态」；repoAccess 一列判「仓库可达」。
    // 关键一条：auth 档只许 ghAuth 失败，repoAccess 必须 pending —— 登录失败不等于仓库不存在。
    const rows = [
      { kind: 'env', ghAuth: 'pending', repoAccess: 'pending' },
      { kind: 'auth', ghAuth: 'fail', repoAccess: 'pending' },
      { kind: 'network', ghAuth: 'pending', repoAccess: 'pending' },
      { kind: 'rate-limit', ghAuth: 'pending', repoAccess: 'pending' },
      { kind: 'conflict', ghAuth: 'pending', repoAccess: 'pending' },
      { kind: 'unsupported', ghAuth: 'pending', repoAccess: 'pending' },
      { kind: 'parse', ghAuth: 'pending', repoAccess: 'pending' },
      { kind: 'not-found', ghAuth: 'pass', repoAccess: 'fail' },
      { kind: 'weird-unknown-kind', ghAuth: 'pending', repoAccess: 'pending' },
    ]
    for (const row of rows) {
      const fx = makeSession({ preflight: { ok: false, error: { kind: row.kind, message: '会话说：' + row.kind, raw: '' } } })
      const c = await makeChain({ openSession: openReplyOf(fx.session) })
      const out = await c.chain.handleChain({ cwd: 'D:/demo', backendId: 'github', lang: 'zh', force: true })
      const ga = resolvedOf(out, 'gh:authed')
      const ra = resolvedOf(out, 'gh:repoAccess')
      must(!!out && out.ok === true, row.kind + '：链求值本身照旧回 ok:true（会话失败只降级成 pending/fail）', 'ok=' + (out && out.ok))
      must(ga && ga.status === row.ghAuth, row.kind + '：登录态那一项是 ' + row.ghAuth, 'gh:authed=' + JSON.stringify(ga))
      must(ra && ra.status === row.repoAccess, row.kind + '：仓库可达那一项是 ' + row.repoAccess, 'gh:repoAccess=' + JSON.stringify(ra))
      if (row.kind === 'auth') {
        must(ra && ra.status !== 'fail', 'auth：登录失败那一档不把仓库显示成不可达（repoAccess 不是 fail）', JSON.stringify(ra))
      }
    }
  }

  title('③ 成功档与开会话失败：两种形状都照旧')
  {
    const fx = makeSession({})
    const c = await makeChain({ openSession: openReplyOf(fx.session) })
    const out = await c.chain.handleChain({ cwd: 'D:/demo', backendId: 'github', lang: 'zh', force: true })
    must(fx.stats.preflight === 1, '一次求值只问会话 preflight 一次（两个谓词共用这一份）', 'preflight=' + fx.stats.preflight)
    must(fx.stats.getCurrentUser === 1, '取当前登录用户名走 getCurrentUser（正好一次）', 'getCurrentUser=' + fx.stats.getCurrentUser)
    must(fx.handles.length === 1 && fx.handles[0].refId === 'acme/demo', 'preflight 带上了本地解析出来的 owner/name', JSON.stringify(fx.handles[0]))
    must(fx.handles.length === 1 && fx.handles[0].backend === 'github', 'preflight 的 handle 标了 github 后端', JSON.stringify(fx.handles[0]))
    must(resolvedOf(out, 'gh:authed').status === 'pass' && resolvedOf(out, 'gh:repoAccess').status === 'pass', 'preflight 成功时两项都判过', JSON.stringify({ authed: resolvedOf(out, 'gh:authed'), repoAccess: resolvedOf(out, 'gh:repoAccess') }))

    for (const [label, opener] of [
      ['openSession 回失败', async () => ({ ok: false, reason: 'no-registry', detail: '还没认出后端' })],
      ['openSession 抛异常', async () => { throw new Error('会话没开出来') }],
    ]) {
      const c2 = await makeChain({ openSession: opener })
      const out2 = await c2.chain.handleChain({ cwd: 'D:/demo', backendId: 'github', lang: 'zh', force: true })
      const ga = resolvedOf(out2, 'gh:authed')
      const ra = resolvedOf(out2, 'gh:repoAccess')
      must(!!out2 && out2.ok === true, label + '：链照旧回 ok:true（上层照旧降级回缓存）', 'ok=' + (out2 && out2.ok) + ' error=' + (out2 && out2.error))
      must(ga && ga.status === 'pending' && ra && ra.status === 'pending', label + '：两项都诚实 pending（不抛、不假装成功）', JSON.stringify({ authed: ga, repoAccess: ra }))
    }

    const fxThrow = makeSession({ preflightThrows: true })
    const c3 = await makeChain({ openSession: openReplyOf(fxThrow.session) })
    const out3 = await c3.chain.handleChain({ cwd: 'D:/demo', backendId: 'github', lang: 'zh', force: true })
    must(!!out3 && out3.ok === true && resolvedOf(out3, 'gh:authed').status === 'pending', '会话能力自己抛异常时也只降级成 pending', JSON.stringify(resolvedOf(out3, 'gh:authed')))
  }

  title('③b 会话的操作上下文原样传进房间（#1468：只给 {cwd} 时房间连 gh 都找不到）')
  {
    const fx = makeSession({})
    const c = await makeChain({ openSession: openReplyOf(fx.session) })
    await c.chain.handleChain({ cwd: 'D:/demo', backendId: 'github', lang: 'zh', force: true })
    const pfCtx = fx.ctxs.preflight[0] || {}
    must(!!(pfCtx.platform && pfCtx.platform.marker === 'session-ctx-platform'), 'preflight 收到会话 ctx 里的 platform（缺了房间第一关就判「找不到 gh」）', JSON.stringify(pfCtx))
    must(!!(pfCtx.exec && pfCtx.exec.marker === 'session-ctx-exec'), 'preflight 收到会话 ctx 里的起进程口（房间要它才发得出 gh）', String(typeof pfCtx.exec))
    must(pfCtx.cwd === 'D:/demo', 'preflight 的 cwd 仍按本次求值目录给', JSON.stringify(pfCtx.cwd))
    const cuCtx = fx.ctxs.getCurrentUser[0] || {}
    must(!!(cuCtx.platform && cuCtx.platform.marker === 'session-ctx-platform'), '取登录名也带会话 ctx 的 platform（不能只给 {cwd}）', JSON.stringify(cuCtx))
    // 静态防退化：上面的模拟是照着会话口 call 的契约写的；契约若被改成只交 session，本小节的断言会假绿。
    const openerSrc = require('fs').readFileSync(nodePath.join(ROOT, 'src/refresh/rooms/host/session-opener.ts'), 'utf8')
    must(openerSrc.indexOf('fn(session, ctx)') >= 0, '会话口的 call 仍把 ctx 交给能力函数（③b 的模拟照这个契约写）', '')
  }

  title('④ 求值那笔记账：经 noteChainEval，仍是一笔零花费')
  {
    const ledgerMod = await import(url('src/refresh/rooms/host/quota-ledger.ts'))
    const gateMod = await import(url('src/refresh/rooms/host/refresh-gate.ts'))
    const ledger = ledgerMod.createLedger({ now: () => CLOCK })
    ledger.syncServer({ rest: { limit: 5000, remaining: 5000, reset: CLOCK + 3600000 }, graphql: { limit: 5000, remaining: 5000, reset: CLOCK + 3600000 } }, CLOCK)
    const gate = gateMod.createGate({ ledger: ledger, now: () => CLOCK })
    must(typeof gate.noteChainEval === 'function', '闸上开了 noteChainEval 这一格')
    const before = gate.stats()
    const c = await makeChain({ gate: gate, openSession: null })
    const out = await c.chain.handleChain({ cwd: 'D:/demo', backendId: 'github', lang: 'zh', force: true })
    const after = gate.stats()
    must(!!out && out.ok === true, '带真闸跑一次求值照旧成功', 'ok=' + (out && out.ok))
    must(after.sent - before.sent === 1, '求值这一笔恰记一次（sent 加一）', 'sent ' + before.sent + ' → ' + after.sent)
    must(after.accounted.requests === before.accounted.requests && after.accounted.points === before.accounted.points, '求值本身零花费（账上条数与点数都不动）', JSON.stringify({ before: before.accounted, after: after.accounted }))
    must((after.byCategory.background || 0) - (before.byCategory.background || 0) === 1, '这一笔记在闸的 background 那一档上（与旧口径一致）', JSON.stringify(after.byCategory))
    const cls = gateMod.classify(out && out.chainSource)
    must(cls.known === true && cls.category === 'background', '求值身份 ' + (out && out.chainSource) + ' 归 background 且已登记', JSON.stringify(cls))

    // 旧闸形状（只有 send、没有 noteChainEval）不许把求值带崩：这是保留旧失败形状的那条边。
    let legacyThrew = null
    const legacy = await makeChain({ gate: { send: async () => { throw new Error('不该被调到') } }, openSession: null })
    let legacyOut = null
    try { legacyOut = await legacy.chain.handleChain({ cwd: 'D:/demo', backendId: 'github', lang: 'zh', force: true }) } catch (e) { legacyThrew = e }
    must(legacyThrew === null && !!legacyOut && legacyOut.ok === true, '旧闸形状（没有 noteChainEval）只跳过记账，不抛、不影响求值', 'threw=' + String(legacyThrew && legacyThrew.message) + ' ok=' + (legacyOut && legacyOut.ok))
  }

  title('⑤ 退避与在途合并的判据不动')
  {
    // 退避挡下：直接回缓存那一份（不另起求值）。
    const CACHED = { ok: false, cachedMarker: 'old-snapshot' }
    const c1 = await makeChain({
      openSession: null,
      backoff: async () => ({ verdict: async () => ({ needed: false, reason: 'backoff-window', waitMs: 5000, cached: CACHED }), note: async () => ({}) }),
    })
    const r1 = await c1.chain.handleChain({ cwd: 'D:/demo', backendId: 'github', lang: 'zh' })
    must(r1 === CACHED, '退避挡下时原样回缓存那一份', 'got=' + JSON.stringify(r1))
    must(c1.detects() === 0, '挡下的那一次没有去求值', 'detects=' + c1.detects())

    // 同钥匙并发：只求值一次，两路拿同一份。
    const c2 = await makeChain({ openSession: null, detectMs: 120 })
    const args = { cwd: 'D:/demo', backendId: 'github', lang: 'zh' }
    const [a, b] = await Promise.all([c2.chain.handleChain(args), c2.chain.handleChain(args)])
    must(c2.detects() === 1, '同钥匙并发两路只求值一次', 'detects=' + c2.detects())
    must(a === b, '同钥匙并发两路拿到同一份回包', 'same=' + (a === b))
  }

  console.log('\n共 ' + total + ' 项，' + (broken.length ? ('破 ' + broken.length + ' 项') : '全绿'))
  if (broken.length) process.exit(1)
}

main().catch((e) => { console.error('门禁抛错：' + String((e && e.stack) || e)); process.exit(1) })
