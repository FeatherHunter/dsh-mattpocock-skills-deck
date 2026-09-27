// verify-deck-repo-resolve.js —— 门禁：仓库标识补全（#758）
// 用法：在插件根目录执行 node tests/verify-deck-repo-resolve.js，可独立运行。
//
// 为什么要这一段：匹配源常带空标识（注册表只认显式 refId），
// 而房间读写真要它——空着进房间，一律诚实失败（真机在案：
// 地图 0 张、读票 refId missing）。修法是调用方按通用形状自己补：
// 有 getRepoKey 能力的后端（三层兜底）补上，没有的跳过，下游照旧诚实失败。
// 本门禁盯住：空才补、有就不碰、能力缺席跳过、失败超时都诚实、补全走闸。
const path = require('path')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href)

function baseShellDeps(over) {
  return Object.assign({
    gate: {
      send: async function (req, perform) { await perform(); return { sent: true, requests: 1, points: 0 } },
      admitAiTool: function () { return { admitted: true, reason: 'ai-tool-within-caps', points: 1, requests: 1 } },
    },
    budget: {},
    estimate: function () { return { points: 1, requests: 1, tickets: 0, withinCallCap: true, shards: 1, perShard: 1, text: '' } },
    costInputFrom: function () { return {} },
    resolveTimeoutMs: 50,
  }, over || {})
}

function sess(cwd) {
  return { cwd: cwd, workspaceKey: 'ws-' + String(cwd).length, sessionId: 's1', source: 't', text: '' }
}

async function main() {
  console.log('仓库标识补全门禁（#758：空才补，不逐后端写分支）')

  const shell = await imp('src/shared/deck-tools/shell.js')

  // ── 1. 空标识补上，有标识不动 ──
  let resolveCalls = 0
  const withCap = {
    select: async function () { return { backendId: 'github', source: 'matches', ref: { backend: 'github', refId: '', name: 'ws', url: '' } } },
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
    select: async function () { return { backendId: 'github', source: 'explicit', ref: { backend: 'github', refId: 'keep/me', name: 'keep/me', url: '' } } },
    get: function () {
      return { getRepoKey: async function () { throw new Error('不该调到这里') } }
    },
  }
  const sh2 = shell.createDeckShell(baseShellDeps({ registry: keepRef }))
  const p2 = await sh2.pickBackend({ agent: { session: { cwd: '/ws' } } }, sess('/ws'))
  check(p2 && p2.ok === true && p2.ref && p2.ref.refId === 'keep/me', '有标识不动，不调补全')

  // ── 2. 没能力的后端跳过，下游照旧 ──
  const noCap = {
    select: async function () { return { backendId: 'markdown', source: 'matches', ref: { backend: 'markdown', refId: '', name: 'ws', url: '' } } },
    get: function () { return {} },
  }
  const sh3 = shell.createDeckShell(baseShellDeps({ registry: noCap }))
  const p3 = await sh3.pickBackend({ agent: { session: { cwd: '/ws' } } }, sess('/ws'))
  check(p3 && p3.ok === true && p3.ref && p3.ref.refId === '', '没能力的后端跳过，空着交下去（下游诚实失败）')

  // ── 3. 补全失败、超时、被闸推迟，都诚实 ──
  const failResolve = {
    select: async function () { return { backendId: 'github', source: 'matches', ref: { backend: 'github', refId: '', name: 'ws', url: '' } } },
    get: function () { return { getRepoKey: async function () { return null } } },
  }
  const sh4 = shell.createDeckShell(baseShellDeps({ registry: failResolve }))
  const p4 = await sh4.pickBackend({ agent: { session: { cwd: '/ws' } } }, sess('/ws'))
  check(p4 && p4.ok === true && p4.ref.refId === '', '解析不出空着交下去，不抛')
  const throwResolve = {
    select: async function () { return { backendId: 'github', source: 'matches', ref: { backend: 'github', refId: '', name: 'ws', url: '' } } },
    get: function () { return { getRepoKey: async function () { throw new Error('炸了') } } },
  }
  const sh5 = shell.createDeckShell(baseShellDeps({ registry: throwResolve }))
  const p5 = await sh5.pickBackend({ agent: { session: { cwd: '/ws' } } }, sess('/ws'))
  check(p5 && p5.ok === true, '补全抛错吞掉，选后端本身不受影响')
  const hangResolve = {
    select: async function () { return { backendId: 'github', source: 'matches', ref: { backend: 'github', refId: '', name: 'ws', url: '' } } },
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
    select: async function () { return { backendId: 'github', source: 'matches', ref: { backend: 'github', refId: '', name: 'ws', url: '' } } },
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
  const backendMod = await imp('src/host/tracker/backends/github/backend.js')
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
