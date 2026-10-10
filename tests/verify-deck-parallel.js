// verify-deck-parallel.js —— 门禁：deck 并发隔离（跨会话/同会话互不影响，同票写不丢）
// 用法：在插件根目录执行 node tests/verify-deck-parallel.js，可独立运行。
//
// 为什么要这一段：deck 工具必须允许大量并发——A 会话与 B 会话毫无关系，
// 同一会话内多笔并行也互不影响。对抗结论：
//   读与单次原子写天然独立（每笔自己的预算壳与记忆，共享的只是出站队列与账本，
//   耽误的只是快慢，不错结果）；同票并发写里的读改写序列（改标签、改进度、补边）
//   会丢一次改动，所以同票写序列走单键锁（src/shared/deck-tools/key-lock.js），
//   不同票、不同仓照旧全并行，读从不拿锁。
// 本文件不联网：后端全是桩，只验“丢不丢、堵不堵、诚实不诚实”。
const path = require('path')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function stubGateLedger(gateMod, ledgerMod) {
  const now = 1700000000000
  const ledger = ledgerMod.createLedger({ now: () => now })
  const gate = gateMod.createGate({ ledger: ledger, now: () => now })
  ledger.syncServer({ rest: { limit: 5000, remaining: 5000, reset: now + 3600000 }, graphql: { limit: 5000, remaining: 5000, reset: now + 3600000 } }, now)
  return { gate: gate }
}

// 带标签状态的桩后端：读改写 races 在这里复现（setLabels 有延迟，交错即丢）。
function labelBackend(state, delayMs) {
  return {
    preflight: async () => ({ ok: true }),
    list: async () => ({ ok: true, data: [] }),
    get: async (repo, key) => ({ ok: true, data: { key: String(key), title: '票', state: 'open', type: 'issue', labels: (state.labels[String(key)] || []).map((n) => ({ name: n })), assignees: [], updatedAt: '', closedAt: '', url: '', body: '# 票\n\n## 进度\n\n- x\n' } }),
    getDependencies: async () => ({ ok: true, data: { blockedBy: [], blocking: [] } }),
    setLabels: async (repo, key, labels) => {
      await sleep(delayMs)
      state.labels[String(key)] = labels.slice()
      return { ok: true, data: { key: String(key) } }
    },
  }
}

function stubRegistry(tracker) {
  const ref = { backend: 'stub', refId: 'o/n', name: 'o/n', url: '' }
  return {
    select: async () => ({ backendId: 'stub', source: 'explicit', ref: ref, pending: false }),
    get: () => tracker,
    has: () => true,
    bound: () => 'stub',
    describe: () => ref,
  }
}

function baseDeps(over) {
  return Object.assign({
    estimate: () => ({ points: 1, requests: 1, tickets: 0, withinCallCap: true, shards: 1, perShard: 60, text: '' }),
    costInputFrom: () => ({ tool: 't' }),
    backendCtx: {},
    handleFor: (s) => ({ cwd: (s && s.cwd) || '' }),
    log: null,
    now: () => Date.now(),
    canonicalKey: async (raw) => raw,
    workspaceKeyOf: (cwd) => 'ws-test',
    toolTimeoutMs: 60000,
    toolMarginMs: 5000,
  }, over || {})
}

const execFor = (cwd) => ({ agent: { session: { id: 's-p', cwd: cwd || 'D:/demo' } } })

async function main() {
  console.log('deck 并发隔离门禁（同票不丢、异票并行、锁超时诚实）')
  const gateMod = await imp('src/host/refresh/gate.js')
  const ledgerMod = await imp('src/host/refresh/ledger.js')
  const keyLock = await imp('src/shared/deck-tools/key-lock.js')
  const patchMod = await imp('src/host/tools/deckIssuePatch.js')

  // ① 同票并发改标签不丢改动（锁把读改写 serial 化）
  {
    const state = { labels: { 7: [] } }
    const g = stubGateLedger(gateMod, ledgerMod)
    const tool = patchMod.createDeckIssuePatch(baseDeps({ gate: g.gate, registry: stubRegistry(labelBackend(state, 120)), budget: await imp('src/shared/refresh/budget.js') }))
    const repo = { backend: 'stub', refId: 'o/n' }
    void repo
    const p1 = tool.run(execFor(), { key: '7', addLabels: ['alpha'] })
    const p2 = tool.run(execFor(), { key: '7', addLabels: ['beta'] })
    const [r1, r2] = await Promise.all([p1, p2])
    const ok1 = r1 && r1.status === 'ok'
    const ok2 = r2 && r2.status === 'ok'
    check(ok1 && ok2, '同票并发改标签两笔都成（实得 ' + ((r1 && r1.status) || '?') + '/' + ((r2 && r2.status) || '?') + '）')
    const final = state.labels['7'] || []
    check(final.indexOf('alpha') >= 0 && final.indexOf('beta') >= 0, '两次改动都没丢（实得 [' + final.join(',') + ']）')
  }

  // ② 不同票并行互不影响（各改各的，都成）
  {
    const state = { labels: { 11: [], 12: [] } }
    const g = stubGateLedger(gateMod, ledgerMod)
    const tool = patchMod.createDeckIssuePatch(baseDeps({ gate: g.gate, registry: stubRegistry(labelBackend(state, 60)), budget: await imp('src/shared/refresh/budget.js') }))
    const [r1, r2] = await Promise.all([
      tool.run(execFor(), { key: '11', addLabels: ['x'] }),
      tool.run(execFor(), { key: '12', addLabels: ['y'] }),
    ])
    check(r1 && r1.status === 'ok' && r2 && r2.status === 'ok', '不同票并行两笔都成')
    check((state.labels['11'] || []).indexOf('x') >= 0 && (state.labels['12'] || []).indexOf('y') >= 0, '不同票各改各的不串')
  }

  // ③ 锁等不到诚实回（持锁 800ms，等待上限 100ms），持锁那笔照样成
  {
    const state = { labels: { 21: [] } }
    const g = stubGateLedger(gateMod, ledgerMod)
    const budget = await imp('src/shared/refresh/budget.js')
    const tool = patchMod.createDeckIssuePatch(baseDeps({ gate: g.gate, registry: stubRegistry(labelBackend(state, 800)), budget: budget, keyLockTimeoutMs: 100 }))
    const p1 = tool.run(execFor(), { key: '21', addLabels: ['slow'] })
    await sleep(60)
    const r2 = await tool.run(execFor(), { key: '21', addLabels: ['fast'] })
    const r1 = await p1
    check(r1 && r1.status === 'ok', '持锁那笔照样成')
    const v2 = r2 && r2.status !== undefined ? r2 : null
    const failedHonest = v2 && v2.status !== 'ok' && JSON.stringify(v2.items || []).indexOf('正被另一次调用改着') >= 0
    check(failedHonest, '等锁超时逐项诚实记（不是静默丢，也不是抛）')
  }

  // ④ 同键不同仓互不阻塞（键含仓库身份）
  {
    const repoA = { backend: 'stub', refId: 'aaa/one' }
    const repoB = { backend: 'stub', refId: 'bbb/two' }
    const slow = keyLock.withKeyLock(repoA, '1', async () => { await sleep(250); return { ok: true, who: 'slow' } })
    const fast = await keyLock.withKeyLock(repoB, '1', async () => ({ ok: true, who: 'fast' }))
    check(fast && fast.ok === true, '不同仓同键不等锁')
    const s = await slow
    check(s && s.ok === true, '持锁序列正常交回')
  }

  // ⑤ 持锁 fn 抛错原样抛、锁照样放行（后继能进）
  {
    const repo = { backend: 'stub', refId: 'o/n' }
    let threw = null
    try {
      await keyLock.withKeyLock(repo, '9', async () => { throw new Error('里面坏了') })
    } catch (e) { threw = e }
    check(threw && /里面坏了/.test(String((threw && threw.message) || threw)), '持锁抛错原样抛')
    const next = await keyLock.withKeyLock(repo, '9', async () => ({ ok: true }), { timeoutMs: 1000 })
    check(next && next.ok === true, '抛错后锁已放行')
  }

  // ⑥ 锁表不泄漏（键用完即删）
  {
    const snap = keyLock.keyLockSnapshot()
    check(snap.keys === 0, '锁表无残留（实得 ' + snap.keys + ' 键/' + snap.waiters + ' 等待）')
  }

  console.log('\n' + total + ' 条断言，' + (failed ? '失败' : '通过'))
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error('门禁抛错：' + ((e && e.stack) || e)); process.exit(1) })
