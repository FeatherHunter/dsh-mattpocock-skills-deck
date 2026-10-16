// verify-deck-repo-resolve.js —— 门禁：仓库标识补全（#758）
// 用法：在插件根目录执行 node tests/verify-deck-repo-resolve.js，可独立运行。
//
// 为什么要这一段：匹配源常带空标识（注册表只认显式 refId），
// 而房间读写真要它——空着进房间，一律诚实失败（真机在案：
// 地图 0 张、读票 refId missing）。修法是调用方按通用形状自己补：
// 有 getRepoKey 能力的后端（三层兜底）补上，没有的跳过，下游照旧诚实失败。
// 本门禁盯住：空才补、有就不碰、能力缺席跳过、失败超时都诚实、补全走闸。
//
// 为什么判定出口换成共用的桩（2026-10-12 补）
//   工具壳在 `src/deck/shell/call-shell.ts:246` 曾经要求「这个工作区是你亲手选过的」才肯往下做
//   （判定出口回 canWrite:false 时，选后端这一步整体被拒；提交 50bbf472）。
//   2026-10-16 维护者拍板删掉了这道门：壳只认结论，不再查写权限。本门禁盯的是仓库标识补全，
//   不是那道门 —— 夹具的注册表本来就代表「这个工作区已经选好了」，所以照另外九条 deck 门禁的办法，
//   用 `tests/lib/deck-decide-stub.js` 的桩顶上。
//
// #1138（2026-10-14）起这个「代表」怎么造，换了写法
//   以前夹具在 select 的回执里写 canWrite: true，壳照单收下。2026-10-16 之前写用途只认工作区文件里那条记录：
//   壳把判定整段交给统一出口，出口第一层读 docs/agents/workspace.yaml，读到才回 canWrite:true。
//   所以下面每个夹具上场前先用 chooseWorkspace('/ws', 后端名) 给这个工作区「记一份文件」，
//   夹具的 select 退居兜底层（文件缺席时才会被问，本文件这几个用例都不会走到那里）。
//   那道写用途的门如今已经删掉，但这套接法照旧有效（文件层结论优先，本来就是判定顺序），所以保持不动。
//   连带的一处：ref 也不再由 select 给了 —— 壳在出口没给 ref 时改问注册表的 describe()
//   （`src/deck/shell/call-shell.ts:273`），所以各夹具如实补上 describe（生产那一份就是注册表转发的）。
//   写用途拦截本身由六扇 verify-1003 门禁守着，这里不重复守。
//
// #1157（2026-10-14）拆掉了那个「不退出的等待口」
//   它是 #1114 把等待定时器 unref 之后，为「补全 hang 住」那条用例打的绕行：那场竞速只剩一笔等待时，
//   进程会提前收摊，13 条断言只跑到 7 条。产品侧现在自己拿存活租约（src/deck/shell/in-flight-lease.ts，
//   ADR 20261014-process-liveness-lease 第 4 条），绕行没有必要了：这条用例改回跑真的等待口。
const path = require('path')
const { pathToFileURL } = require('url')
const { makeDecideStub, chooseWorkspace } = require('./lib/deck-decide-stub.js')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href)

function baseShellDeps(over) {
  const o = over || {}
  return Object.assign({
    gate: {
      send: async function (req, perform) { await perform(); return { sent: true, requests: 1, points: 0 } },
      admitAiTool: function () { return { admitted: true, reason: 'ai-tool-within-caps', points: 1, requests: 1 } },
    },
    budget: {},
    estimate: function () { return { points: 1, requests: 1, tickets: 0, withinCallCap: true, shards: 1, perShard: 1, text: '' } },
    costInputFrom: function () { return {} },
    resolveTimeoutMs: 50,
    // 这里从前注入过一个「不退出的等待口」，用来绕开 #1114 留下的那个洞：壳自带的 realSleep 是 unref 过的，
    // 而本文件「补全 hang 住」那个用例里唯一还活着的东西就是这笔等待，Node 会在 50ms 到点之前把进程
    // 收掉，后面的断言一条都不跑，整条门禁变成假绿。#1157 落地之后这个绕行拆掉了：产品自己那份存活租约
    // （src/deck/shell/in-flight-lease.ts，ADR 20261014-process-liveness-lease 第 4 条）会拿住进程，
    // 所以这条用例现在跑在真的 realSleep 上，验的就是产品行为本身。
    decideBackend: makeDecideStub(o.registry),
  }, o)
}

function sess(cwd) {
  return { cwd: cwd, workspaceKey: 'ws-' + String(cwd).length, sessionId: 's1', source: 't', text: '' }
}

async function main() {
  console.log('仓库标识补全门禁（#758：空才补，不逐后端写分支）')

  const shell = await imp('src/deck/shell/call-shell.ts')

  // ── 1. 空标识补上，有标识不动 ──
  // 这个夹具的工作区根是 /ws，所有用例都在它上面跑：先记一份「用户选的是 github」
  // （等价于工作区文件里那一行），否则壳按「没选定后端」在选后端那一步就拒了。
  chooseWorkspace('/ws', 'github')
  let resolveCalls = 0
  const withCap = {
    has: function () { return true },
    select: async function () { return { backendId: 'github', source: 'matches', ref: { backend: 'github', refId: '', name: 'ws', url: '' }, canWrite: true } },
    describe: function () { return { backend: 'github', refId: '', name: 'ws', url: '' } },
    get: function () {
      return {
        getRepoKey: async function (cwd) {
          resolveCalls += 1
          if (cwd !== '/ws') throw new Error('目录没递过去')
          return { owner: 'acme', name: 'box' }
        },
      }
    },
  }
  const sh1 = shell.createDeckShell(baseShellDeps({ registry: withCap }))
  const p1 = await sh1.pickBackend({ agent: { session: { cwd: '/ws' } } }, sess('/ws'))
  check(p1 && p1.ok === true && p1.ref && p1.ref.refId === 'acme/box', '空标识补成 owner/name')
  check(p1 && p1.ref && p1.ref.url === 'https://github.com/acme/box', '补上同时给出仓库地址')
  check(resolveCalls === 1, '补全只调一次')

  const keepRef = {
    has: function () { return true },
    select: async function () { return { backendId: 'github', source: 'explicit', ref: { backend: 'github', refId: 'keep/me', name: 'keep/me', url: '' }, canWrite: true } },
    // 「有标识不动」这条现在由 describe 交出来的 refId 决定（壳在出口没给 ref 时问它）：
    // 这里如实给一个非空 refId，壳就不会再去调补全（夹具那个 getRepoKey 正是用来盯这点的）。
    describe: function () { return { backend: 'github', refId: 'keep/me', name: 'keep/me', url: '' } },
    get: function () {
      return { getRepoKey: async function () { throw new Error('不该调到这里') } }
    },
  }
  const sh2 = shell.createDeckShell(baseShellDeps({ registry: keepRef }))
  const p2 = await sh2.pickBackend({ agent: { session: { cwd: '/ws' } } }, sess('/ws'))
  check(p2 && p2.ok === true && p2.ref && p2.ref.refId === 'keep/me', '有标识不动，不调补全')

  // ── 2. 没能力的后端跳过，下游照旧 ──
  // 这个夹具要的是 markdown，工作区文件里那一行也得跟着换（文件里写谁，壳就认谁）。
  chooseWorkspace('/ws', 'markdown')
  const noCap = {
    has: function () { return true },
    select: async function () { return { backendId: 'markdown', source: 'matches', ref: { backend: 'markdown', refId: '', name: 'ws', url: '' }, canWrite: true } },
    describe: function () { return { backend: 'markdown', refId: '', name: 'ws', url: '' } },
    get: function () { return {} },
  }
  const sh3 = shell.createDeckShell(baseShellDeps({ registry: noCap }))
  const p3 = await sh3.pickBackend({ agent: { session: { cwd: '/ws' } } }, sess('/ws'))
  check(p3 && p3.ok === true && p3.ref && p3.ref.refId === '', '没能力的后端跳过，空着交下去（下游诚实失败）')

  // ── 3. 补全失败、超时、被闸推迟，都诚实 ──
  chooseWorkspace('/ws', 'github')   // 下面五个夹具都回到 github（同上：文件里那一行跟着换）
  const failResolve = {
    has: function () { return true },
    select: async function () { return { backendId: 'github', source: 'matches', ref: { backend: 'github', refId: '', name: 'ws', url: '' }, canWrite: true } },
    describe: function () { return { backend: 'github', refId: '', name: 'ws', url: '' } },
    get: function () { return { getRepoKey: async function () { return null } } },
  }
  const sh4 = shell.createDeckShell(baseShellDeps({ registry: failResolve }))
  const p4 = await sh4.pickBackend({ agent: { session: { cwd: '/ws' } } }, sess('/ws'))
  check(p4 && p4.ok === true && p4.ref.refId === '', '解析不出空着交下去，不抛')
  const throwResolve = {
    has: function () { return true },
    select: async function () { return { backendId: 'github', source: 'matches', ref: { backend: 'github', refId: '', name: 'ws', url: '' }, canWrite: true } },
    describe: function () { return { backend: 'github', refId: '', name: 'ws', url: '' } },
    get: function () { return { getRepoKey: async function () { throw new Error('炸了') } } },
  }
  const sh5 = shell.createDeckShell(baseShellDeps({ registry: throwResolve }))
  const p5 = await sh5.pickBackend({ agent: { session: { cwd: '/ws' } } }, sess('/ws'))
  check(p5 && p5.ok === true, '补全抛错吞掉，选后端本身不受影响')
  const hangResolve = {
    has: function () { return true },
    select: async function () { return { backendId: 'github', source: 'matches', ref: { backend: 'github', refId: '', name: 'ws', url: '' }, canWrite: true } },
    describe: function () { return { backend: 'github', refId: '', name: 'ws', url: '' } },
    get: function () { return { getRepoKey: function () { return new Promise(function () {}) } } },
  }
  const sh6 = shell.createDeckShell(baseShellDeps({ registry: hangResolve }))
  const t0 = Date.now()
  const p6 = await sh6.pickBackend({ agent: { session: { cwd: '/ws' } } }, sess('/ws'))
  check(p6 && p6.ok === true && (Date.now() - t0) < 5000, '补全 hang 住有时限兜底（测试配 50ms）')
  const deferGate = {
    send: async function (req, perform) {
      if (req && req.plan && req.plan[0] && req.plan[0].phase === 'resolve') return { sent: false, verdict: 'defer', reason: 'reserve-kept-for-writes', detail: '读让路' }
      await perform()
      return { sent: true, requests: 1, points: 0 }
    },
    admitAiTool: function () { return { admitted: true, reason: 'ai-tool-within-caps', points: 1, requests: 1 } },
  }
  let deferResolveCalls = 0
  const deferReg = {
    has: function () { return true },
    select: async function () { return { backendId: 'github', source: 'matches', ref: { backend: 'github', refId: '', name: 'ws', url: '' }, canWrite: true } },
    describe: function () { return { backend: 'github', refId: '', name: 'ws', url: '' } },
    get: function () { return { getRepoKey: async function () { deferResolveCalls += 1; return { owner: 'a', name: 'b' } } } },
  }
  const sh7 = shell.createDeckShell(baseShellDeps({ gate: deferGate, registry: deferReg }))
  const p7 = await sh7.pickBackend({ agent: { session: { cwd: '/ws' } } }, sess('/ws'))
  check(p7 && p7.ok === true && p7.ref.refId === '' && deferResolveCalls === 0, '补全被闸推迟就不补（尊重裁决，空着交下去）')

  // ── 4. 补全走闸（读探针一格，可归因）──
  const kinds = []
  const recordGate = {
    send: async function (req, perform) { kinds.push(req && req.kind); await perform(); return { sent: true, requests: 1, points: 0 } },
    admitAiTool: function () { return { admitted: true, reason: 'ai-tool-within-caps', points: 1, requests: 1 } },
  }
  const sh8 = shell.createDeckShell(baseShellDeps({ gate: recordGate, registry: withCap }))
  await sh8.pickBackend({ agent: { session: { cwd: '/ws' } } }, sess('/ws'))
  check(kinds.join(',') === 'probe,probe', '选后端与补全各走一次读探针（两笔都记账）')

  // ── 5. 真房间把口子开出来（github created 后端带 getRepoKey）──
  const backendMod = await imp('src/tracker/rooms/github/backend.ts')
  check(backendMod && typeof backendMod.createGithubBackend === 'function', '房间交出装配函数')
  const fakeCtx = {
    platform: { resolveExecutable: async function (name) { return String(name) === 'git' ? 'git' : null } },
    exec: async function (cmd, args) {
      if (String(cmd) === 'git') return { stdout: 'https://github.com/real-owner/real-name.git\n' }
      throw new Error('unexpected')
    },
  }
  const backend = backendMod.createGithubBackend(fakeCtx)
  check(backend && typeof backend.getRepoKey === 'function', '装好的后端带补全口')
  const key = await backend.getRepoKey('/ws', { cwd: '/ws', platform: fakeCtx.platform, exec: fakeCtx.exec })
  check(key && key.owner === 'real-owner' && key.name === 'real-name', '真房间 Tier1 解析出 owner/name（本地 remote，不联网）')

  console.log('\n' + total + ' 条断言，' + (failed ? '失败' : '通过'))
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error('门禁抛错：' + ((e && e.stack) || e)); process.exit(1) })
