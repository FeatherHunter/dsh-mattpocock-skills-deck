// verify-deck-repo-resolve.ts —— 门禁：仓库标识补全（#758）
// 用法：在插件根目录执行 node tests/verify-deck-repo-resolve.ts，可独立运行。
// 写法保持 require 风格：require 与 __dirname 照 CommonJS 形态工作，类型只做标注（与 tests/verify-leaves.ts 同形）；
// 行为与改名前一字不差。
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
//   用 `tests/lib/deck-decide-stub.ts` 的桩顶上。
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
const check = (ok: unknown, msg: string): void => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const imp = (rel: string): Promise<any> => import(pathToFileURL(path.join(ROOT, rel)).href)

function baseShellDeps(over?: any): any {
  const o = over || {}
  return Object.assign({
    gate: {
      send: async function (req: any, perform: any): Promise<any> { await perform(); return { sent: true, requests: 1, points: 0 } },
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

function sess(cwd: string): any {
  return { cwd: cwd, workspaceKey: 'ws-' + String(cwd).length, sessionId: 's1', source: 't', text: '' }
}

async function main() {
  console.log('仓库标识补全门禁（#758：空才补，不逐后端写分支）')

  const sessionMod = await imp('src/deck/tools/tracker-session.ts')
  const EST = { points: 1, requests: 1, tickets: 0, withinCallCap: true, shards: 1, perShard: 1, text: '' }
  const GH_BUDGET = { kind: 'two-buckets', countsRequests: true, countsPoints: true, independentBuckets: true }
  const MD_BUDGET = { kind: 'requests-only', countsRequests: true, countsPoints: false, independentBuckets: false }
  // #1443 起打开会话要读注册表的预算声明（openTracker 按它建会话）：这几个桩注册表只为选后端与补全而造，
  // 在这里统一补上两份预算声明，桩本身的 select / describe / get 一字不动。
  const withModules = (reg) => Object.assign({ modules: () => [{ id: 'github', budget: GH_BUDGET }, { id: 'markdown', budget: MD_BUDGET }] }, reg)
  const openedOf = (reg, gate) => sessionMod.openDeckSession({ deps: baseShellDeps(Object.assign({ registry: withModules(reg) }, gate ? { gate: gate } : {})), exec: { agent: { session: { cwd: '/ws' } } }, session: sess('/ws'), estimate: EST, tool: 'test', kind: 'op' })

  // ── 1. 空标识补上，有标识不动 ──
  // 这个夹具的工作区根是 /ws，所有用例都在它上面跑：先记一份「用户选的是 github」
  // （等价于工作区文件里那一行），否则壳按「没选定后端」在选后端那一步就拒了。
  chooseWorkspace('/ws', 'github')
  let resolveCalls = 0
  // #1583 起，会话的 describe 定位口按「模块优先、实例兜底」装配，实例上这份要按真后端口径回答：
  // 拿到 owner/name 形态的 refId 就带上仓库地址；补身份的第三步（拿到 owner/name 后再问一次 describe）
  // 靠它产出完整身份，所以这里不能永远回空壳。
  const githubDescribe = function (handle: any): any {
    const refId = (handle && typeof handle.refId === 'string') ? handle.refId : ''
    return { backend: 'github', refId: refId, name: refId || 'ws', url: refId ? 'https://github.com/' + refId : '' }
  }
  const withCap = {
    has: function () { return true },
    select: async function () { return { backendId: 'github', source: 'matches', ref: { backend: 'github', refId: '', name: 'ws', url: '' }, canWrite: true } },
    // 判定出口取 ref 时也会问注册表这一份（只给目录，只能回空壳——正是要验的起点）。
    describe: function () { return githubDescribe({}) },
    get: function () {
      return {
        describe: githubDescribe,
        getRepoKey: async function (cwd: string): Promise<any> {
          resolveCalls += 1
          if (cwd !== '/ws') throw new Error('目录没递过去')
          return { owner: 'acme', name: 'box' }
        },
      }
    },
  }
  const p1 = await openedOf(withCap)
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
  const p2 = await openedOf(keepRef)
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
  const p3 = await openedOf(noCap)
  check(p3 && p3.ok === true && p3.ref && p3.ref.refId === '', '没能力的后端跳过，空着交下去（下游诚实失败）')

  // ── 3. 补全失败、超时、被闸推迟，都诚实 ──
  chooseWorkspace('/ws', 'github')   // 下面五个夹具都回到 github（同上：文件里那一行跟着换）
  const failResolve = {
    has: function () { return true },
    select: async function () { return { backendId: 'github', source: 'matches', ref: { backend: 'github', refId: '', name: 'ws', url: '' }, canWrite: true } },
    describe: function () { return { backend: 'github', refId: '', name: 'ws', url: '' } },
    get: function () { return { getRepoKey: async function () { return null } } },
  }
  const p4 = await openedOf(failResolve)
  check(p4 && p4.ok === true && p4.ref.refId === '', '解析不出空着交下去，不抛')
  const throwResolve = {
    has: function () { return true },
    select: async function () { return { backendId: 'github', source: 'matches', ref: { backend: 'github', refId: '', name: 'ws', url: '' }, canWrite: true } },
    describe: function () { return { backend: 'github', refId: '', name: 'ws', url: '' } },
    get: function () { return { getRepoKey: async function () { throw new Error('炸了') } } },
  }
  const p5 = await openedOf(throwResolve)
  check(p5 && p5.ok === true, '补全抛错吞掉，选后端本身不受影响')
  const hangResolve = {
    has: function () { return true },
    select: async function () { return { backendId: 'github', source: 'matches', ref: { backend: 'github', refId: '', name: 'ws', url: '' }, canWrite: true } },
    describe: function () { return { backend: 'github', refId: '', name: 'ws', url: '' } },
    get: function () { return { getRepoKey: function () { return new Promise(function () {}) } } },
  }
  const t0 = Date.now()
  const p6 = await openedOf(hangResolve)
  check(p6 && p6.ok === true && (Date.now() - t0) < 5000, '补全 hang 住有时限兜底（测试配 50ms）')
  const deferGate = {
    send: async function (req: any, perform: any): Promise<any> {
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
  // #1443 起补全不再走闸的发送接口：新路的仓库标识补全是「房间直调 getRepoKey 与等待口的竞速」，不再经过
  // gate.send 的读探针，所以发送口的推迟（defer）拦不住它；裁决只看 admitAiTool（这里放行），放行就补全。
  const p7 = await openedOf(deferReg, deferGate)
  check(p7 && p7.ok === true && p7.ref.refId === 'a/b' && deferResolveCalls === 1, '新路补全不经发送口：admitAiTool 放行就竞速补全（defer 只活在旧路的发送接口里）')

  // ── 4. 补全走闸（读探针一格，可归因）──
  // #1443 起选后端不再调闸的发送接口：读探针（quota.read / resolve）随旧路退役，裁决走 admitAiTool 两笔
  // （打开会话前的余量探针与整单的批量裁决）。记账仍在管线里，不丢笔数。
  const kinds: unknown[] = []
  let admitCalls = 0
  const recordGate = {
    send: async function (req: any, perform: any): Promise<any> { kinds.push(req && req.kind); await perform(); return { sent: true, requests: 1, points: 0 } },
    admitAiTool: function () { admitCalls += 1; return { admitted: true, reason: 'ai-tool-within-caps', points: 1, requests: 1 } },
  }
  await openedOf(withCap, recordGate)
  check(kinds.join(',') === '', '选后端与补全都不再走闸的发送接口（读探针已退役）')
  check(admitCalls === 2, '裁决走 admitAiTool 两笔（余量探针与整单批量，实得 ' + admitCalls + ' 笔）')

  // ── 5. 真房间把口子开出来（github created 后端带 getRepoKey）──
  const backendMod = await imp('src/tracker/rooms/github/room/backend.ts')
  check(backendMod && typeof backendMod.createGithubBackend === 'function', '房间交出装配函数')
  const fakeCtx = {
    platform: { resolveExecutable: async function (name: string): Promise<string | null> { return String(name) === 'git' ? 'git' : null } },
    exec: async function (cmd: unknown, args: unknown): Promise<any> {
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

main().catch((e: unknown) => { console.error('门禁抛错：' + (e instanceof Error ? (e.stack || e.message) : String(e))); process.exit(1) })
