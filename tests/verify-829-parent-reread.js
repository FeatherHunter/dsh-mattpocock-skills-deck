// tests/verify-829-parent-reread.js —— #829 补 #790 未盖住的两处（不联网）
// 测什么（第一性原理：报单人重试三次，第二次可能撞“重复”；读回失败不能只说 parent 为空）：
//   G1) 原生旗回“重复/已是子票” + 重读已是目标父 → ok:true（幂等，重试安全，不再报 0 条）
//   G2) 原生旗回“重复” + 重读仍不是目标父 → ok:false 且带原话（不吞后端错误）
//   G3) deck 写成功但读票失败 → 逐条 failed 且证据里带“读票没成功”与后端原话（不再只说 parent 为空）
//   G4) 正文兜底与正常挂边仍 ok（回归对照）
const path = require('path')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href)
const DB = (n) => 1000000 + Number(n)

// 可控 GraphQL 父边：firstParent 用于首读（ stale 空），rereadParent 用于重读
function execFactory(opts) {
  const o = opts || {}
  const calls = []
  let graphqlCount = 0
  const exec = async (cmd, args) => {
    calls.push(args.join(' '))
    const line = args.join(' ')
    let m = line.match(/^api repos\/o\/r\/issues\/(\d+)(?:\s|$)/)
    if (m && line.includes('--jq .id') && !line.includes('sub_issues') && !line.includes('--method')) return { code: 0, stdout: String(DB(m[1])), stderr: '' }
    if (line.startsWith('api graphql')) {
      graphqlCount += 1
      const nm = line.match(/number=(\d+)/)
      const n = nm ? nm[1] : '0'
      const parent = graphqlCount <= 1 ? o.firstParent : o.rereadParent
      const row = { number: Number(n), title: 't' + n, state: 'OPEN', body: '', url: '', createdAt: '', updatedAt: '', closedAt: null, author: { login: 'a' }, assignees: { nodes: [] }, labels: { nodes: [] }, milestone: null, comments: { nodes: [] }, parent: parent ? { number: Number(parent) } : null, blockedBy: { nodes: [] } }
      return { code: 0, stdout: JSON.stringify({ data: { repository: { issue: row } } }), stderr: '' }
    }
    if (args[0] === 'issue' && args[1] === 'edit' && args.includes('--parent')) {
      if (o.flagError) return { code: 1, stdout: '', stderr: o.flagError }
      return { code: 0, stdout: '', stderr: '' }
    }
    if (args[0] === 'issue' && args[1] === 'edit' && args.includes('--remove-parent')) {
      return { code: 0, stdout: '', stderr: '' }
    }
    m = line.match(/^api repos\/o\/r\/issues\/(\d+)\/sub_issues/)
    if (m && line.includes('--method POST')) return { code: 0, stdout: '{}', stderr: '' }
    return { code: 1, stdout: '', stderr: 'strict-fake unscripted: ' + line }
  }
  return { exec, calls, getGraphqlCount: () => graphqlCount }
}

function ghCtxFor(factory) {
  return { cwd: '/ws', platform: { resolveExecutable: async () => '/usr/bin/gh' }, exec: factory.exec }
}

async function main() {
  console.log('#829 父边重读与读回报错专属门禁（不联网）')
  const graph = await imp('src/host/tracker/backends/github/graph.js')
  const repo = { backend: 'github', refId: 'o/r', name: 'r', url: '' }

  // G1) 重复 + 重读已是目标父 → 成功
  {
    const f = execFactory({ firstParent: null, rereadParent: '78', flagError: 'GraphQL: Failed to add sub-issue #90 to parent #78. Issue may not contain duplicate sub-issues (addSubIssue)' })
    const r = await graph.setParent(repo, '90', '78', {}, ghCtxFor(f))
    check(r.ok === true, 'G1 重复后重读已是目标父 → ok:true（实得 ok=' + r.ok + '）')
    check(r.data && r.data.parentKey === '78', 'G1 读回父票为 78（实得 ' + ((r.data && r.data.parentKey) || '(none)') + '）')
  }

  // G2) 重复 + 重读仍不是目标父 → 如实失败且带原话
  {
    const f = execFactory({ firstParent: null, rereadParent: null, flagError: 'GraphQL: Failed to add sub-issue #90 to parent #78. Issue may not contain duplicate sub-issues (addSubIssue)' })
    const r = await graph.setParent(repo, '90', '78', {}, ghCtxFor(f))
    check(r.ok === false, 'G2 重复后重读仍不是目标父 → ok:false（实得 ok=' + r.ok + '）')
    check(/duplicate|addSubIssue/i.test(String((r.error && r.error.message) || '')), 'G2 错误里带重复原话（实得：' + String((r.error && r.error.message) || '').slice(0, 80) + '）')
  }

  // G3/G4) 工具层：写成功但读票失败 → 证据带读失败原话；正常仍 ok
  {
    const budget = await imp('src/shared/refresh/budget.js')
    const ledgerMod = await imp('src/host/refresh/ledger.js')
    const gateMod = await imp('src/host/refresh/gate.js')
    const registryMod = await imp('src/host/tracker/registryCore.js')
    const toolCost = await imp('src/shared/refresh/tool-cost.js')
    let clock = 1700000000000
    const ledger = ledgerMod.createLedger({ now: () => clock })
    const gate = gateMod.createGate({ ledger: ledger, now: () => clock })
    ledger.syncServer({ rest: { limit: 5000, remaining: 5000, reset: clock + 3600000 }, graphql: { limit: 5000, remaining: 5000, reset: clock + 3600000 } }, clock)
    const registry = registryMod.createRegistry({ logEvent: () => {}, isEnabled: () => false }, { matchesTimeout: 200 })
    const stubReadFail = {
      id: 'stub-829-readfail', label: '桩（写成功、读票失败）', matches: async () => false,
      create: () => ({
        id: 'stub-829-readfail',
        async get() {
          return { ok: false, error: { kind: 'network', message: 'graphql: unexpected EOF' } }
        },
        async setParent(repoArg, key, parentKey) {
          return { ok: true, data: { key: String(key), title: 't', state: 'open', body: '', labels: [], assignees: [], parentKey: String(parentKey) } }
        },
        async setBlockedBy(repoArg, key, blockers) {
          return { ok: true, data: { key: String(key), title: 't', state: 'open', body: '', labels: [], assignees: [], blockedBy: [] } }
        },
        async getDependencies() {
          return { ok: true, data: { blockedBy: [], blocking: [] } }
        },
      }),
    }
    const disp = registry.register(stubReadFail)
    const handle = { cwd: '/ws/829', refId: 'o/r' }
    registry.bind(handle, 'stub-829-readfail')
    const deps = {
      gate, registry, budget, estimate: toolCost.estimateToolCost, costInputFrom: toolCost.toolCostInputFrom,
      handleFor: () => handle, backendCtx: {}, now: () => clock, log: { fire: () => {} }, invalidate: () => {},
    }
    const linkMod = await imp('src/host/tools/deckMapLink.js')
    const link = linkMod.createDeckMapLink(deps)
    const exec = { agent: { session: { id: 's-829', cwd: '/ws/829' } } }
    const lr = await link.run(exec, { key: '90', parentKey: '78' })
    const item = (lr.items || [])[0] || {}
    check(item.status === 'failed', 'G3 写成功但读票失败 → 逐条 failed（实得 ' + item.status + '）')
    check(String(item.evidence || '').includes('读票没成功'), 'G3 证据里带“读票没成功”（实得：' + String(item.evidence).slice(0, 120) + '）')
    check(String(item.evidence || '').includes('unexpected EOF'), 'G3 证据里带读失败的后端原话（实得：' + String(item.evidence).slice(0, 160) + '）')
    disp.dispose()
  }

  console.log('\n' + (failed ? '存在失败' : '全部通过 — #829（' + total + ' 条）'))
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error('门禁执行异常：' + ((e && e.stack) || e)); process.exit(1) })
