// tests/verify-790-parent-edge.js —— #790 父子边静默失败专属门禁（不联网）
// 测什么（第一性原理：真 GitHub 只认数据库编号 + -F，票面号 + -f 必 422）：
//   A) graph.setParent 主路走原生旗 `gh issue edit --parent`（按票号，不碰数据库编号）
//   B) 原生旗未知（老版本）时回退裸接口，且用 -F 传数据库编号（不用 -f 传票面号）
//   C) 裸接口拒收票面号时如实失败，不静默成功
//   D) deck_map_link：写成功但读回没挂上 → failed，且顶层带失败摘要（不再“建成 0 条、无话”）
//   E) deck_issue_create：票建成、边没挂上 → partial +“没挂上”，不再报“建好了（父票 X）”
const path = require('path')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href)
const DB = (n) => 1000000 + Number(n)

function strictExecFactory(opts) {
  const o = opts || {}
  const calls = []
  const parents = new Map(Object.entries(o.parents || {}))
  const missing = new Set(o.missing || [])
  const exists = (n) => !missing.has(String(n))
  const exec = async (cmd, args) => {
    calls.push(args.join(' '))
    const line = args.join(' ')
    // 取数据库编号（args 里的 --jq .id 是独立参数，行尾还有它，不能按行尾锚匹配）
    let m = line.match(/^api repos\/o\/r\/issues\/(\d+)(?:\s|$)/)
    if (m && line.includes('--jq .id') && !line.includes('sub_issues') && !line.includes('--method')) return { code: 0, stdout: String(DB(m[1])), stderr: '' }
    // GraphQL 读票（含 parent 边）
    if (line.startsWith('api graphql')) {
      const nm = line.match(/number=(\d+)/)
      const n = nm ? nm[1] : '0'
      if (o.missing && o.missing.includes(n)) return { code: 0, stdout: JSON.stringify({ data: { repository: { issue: null } } }), stderr: '' }
      const p = parents.get(String(n))
      const row = { number: Number(n), title: 't' + n, state: 'OPEN', body: '', url: '', createdAt: '', updatedAt: '', closedAt: null, author: { login: 'a' }, assignees: { nodes: [] }, labels: { nodes: [] }, milestone: null, comments: { nodes: [] }, parent: p ? { number: Number(p) } : null, blockedBy: { nodes: [] } }
      return { code: 0, stdout: JSON.stringify({ data: { repository: { issue: row } } }), stderr: '' }
    }
    // 原生旗（真机按票号校验存在性，不存在回 404）
    if (args[0] === 'issue' && args[1] === 'edit' && args.includes('--parent')) {
      if (o.flagBroken) return { code: 1, stdout: '', stderr: 'unknown flag: --parent' }
      const child = String(args[2])
      if (!exists(child)) return { code: 1, stdout: '', stderr: 'HTTP 404: could not resolve to an Issue (# ' + child + ')' }
      const pi = args.indexOf('--parent')
      const parent = String(args[pi + 1])
      if (!exists(parent)) return { code: 1, stdout: '', stderr: 'HTTP 404: could not resolve to an Issue (# ' + parent + ')' }
      if (o.rejectParent && o.rejectParent[child]) return { code: 1, stdout: '', stderr: o.rejectParent[child] }
      parents.set(child, parent)
      return { code: 0, stdout: '', stderr: '' }
    }
    if (args[0] === 'issue' && args[1] === 'edit' && args.includes('--remove-parent')) {
      if (o.flagBroken) return { code: 1, stdout: '', stderr: 'unknown flag: --remove-parent' }
      parents.delete(String(args[2]))
      return { code: 0, stdout: '', stderr: '' }
    }
    // 裸接口：严格校验 -F + 数据库编号
    m = line.match(/^api repos\/o\/r\/issues\/(\d+)\/sub_issues/)
    if (m && line.includes('--method POST')) {
      const hasTyped = args.includes('-F')
      const field = args.find((x) => String(x).startsWith('sub_issue_id='))
      const val = field ? Number(field.split('=')[1]) : NaN
      if (!hasTyped || !(Number.isFinite(val) && val >= 1000000)) return { code: 1, stdout: '', stderr: 'HTTP 422: sub_issue_id must be a database id, got ' + (field || '(missing)') }
      // 按数据库编号反查票面号
      const childNum = String(Math.round(val - 1000000))
      parents.set(childNum, m[1])
      return { code: 0, stdout: '{}', stderr: '' }
    }
    if (m && line.includes('--method DELETE')) {
      const hasTyped = args.includes('-F')
      const field = args.find((x) => String(x).startsWith('sub_issue_id='))
      const val = field ? Number(field.split('=')[1]) : NaN
      if (!hasTyped || !(Number.isFinite(val) && val >= 1000000)) return { code: 1, stdout: '', stderr: 'HTTP 422: sub_issue_id must be a database id' }
      parents.delete(String(Math.round(val - 1000000)))
      return { code: 0, stdout: '{}', stderr: '' }
    }
    return { code: 1, stdout: '', stderr: 'strict-fake unscripted: ' + line }
  }
  return { exec, calls, parents }
}

function ghCtxFor(factory) {
  return { cwd: '/ws', platform: { resolveExecutable: async () => '/usr/bin/gh' }, exec: factory.exec }
}

async function main() {
  console.log('#790 父子边静默失败专属门禁（不联网，严格仿真真 GitHub）')
  const graph = await imp('src/host/tracker/backends/github/graph.js')
  const repo = { backend: 'github', refId: 'o/r', name: 'r', url: '' }

  // A) 主路走原生旗
  {
    const f = strictExecFactory({})
    const r = await graph.setParent(repo, '90', '78', {}, ghCtxFor(f))
    check(r.ok === true, 'A1 setParent 主路成功回 ok:true（实得 ok=' + r.ok + '）')
    const flagCall = f.calls.find((l) => l.includes('issue edit') && l.includes('--parent'))
    check(!!flagCall, 'A2 主路走原生旗 gh issue edit --parent（实发：' + (flagCall || f.calls.join(' | ').slice(0, 160)) + '）')
    const rawCall = f.calls.find((l) => l.includes('sub_issues') && l.includes('--method POST'))
    check(!rawCall, 'A3 主路可用时不发裸接口（没发 POST sub_issues）')
    check(f.parents.get('90') === '78', 'A4 读回父票为 78（单父语义）')
  }

  // B) 老版本回退裸接口，且用 -F 传数据库编号
  {
    const f = strictExecFactory({ flagBroken: true })
    const r = await graph.setParent(repo, '90', '78', {}, ghCtxFor(f))
    check(r.ok === true, 'B1 老版本回退仍成功（实得 ok=' + r.ok + ' ' + String((r.error && r.error.message) || '').slice(0, 80) + '）')
    const raw = f.calls.find((l) => l.includes('sub_issues') && l.includes('--method POST'))
    check(!!raw && raw.includes('-F') && raw.includes('sub_issue_id=' + DB(90)), 'B2 回退用 -F 传数据库编号 ' + DB(90) + '（实发：' + (raw || '(none)') + '）')
    check(!(raw || '').split(' ').includes('-f'), 'B3 回退不用小写 -f 传字符串')
  }

  // C) 拒收时如实失败（子票不存在 → 404，不装成功）
  {
    const f = strictExecFactory({ missing: ['90'] })
    const r = await graph.setParent(repo, '90', '78', {}, ghCtxFor(f))
    check(r.ok === false, 'C1 子票不存在时如实失败（ok=false，实得 ok=' + r.ok + '）')
    check(String((r.error && r.error.message) || '').includes('404'), 'C2 错误里带 404（实得：' + String((r.error && r.error.message) || '').slice(0, 80) + '）')
  }

  // D/E) 工具层：写成功但读回没挂上 → failed/partial，且顶层带原因
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
    // 桩后端：setParent 总说成功，但 get 总说没父（复现“回执成功、实查没有”）
    const stub = {
      id: 'stub-790', label: '桩（写成功、读回缺父）', matches: async () => false,
      create: () => ({
        id: 'stub-790',
        async create(repoArg, input) {
          const key = '90'
          return { ok: true, data: { key: key, title: input.title, state: 'open', body: String(input.body || ''), labels: [], assignees: [], parentKey: null, parentError: { kind: 'network', message: 'HTTP 422: sub_issue_id must be a database id' } } }
        },
        async get(repoArg, key) {
          return { ok: true, data: { key: String(key), title: 't', state: 'open', body: '', labels: [], assignees: [], parentKey: null } }
        },
        async setParent(repoArg, key, parentKey) {
          return { ok: true, data: { key: String(key), title: 't', state: 'open', body: '', labels: [], assignees: [], parentKey: null } }
        },
        async setBlockedBy(repoArg, key, blockers) {
          return { ok: true, data: { key: String(key), title: 't', state: 'open', body: '', labels: [], assignees: [], blockedBy: [] } }
        },
        async getDependencies(repoArg, key) {
          return { ok: true, data: { blockedBy: [], blocking: [] } }
        },
      }),
    }
    const disp = registry.register(stub)
    const handle = { cwd: '/ws/790', refId: 'o/r' }
    registry.bind(handle, 'stub-790')
    const deps = {
      gate, registry, budget, estimate: toolCost.estimateToolCost, costInputFrom: toolCost.toolCostInputFrom,
      handleFor: () => handle, backendCtx: {}, now: () => clock, log: { fire: () => {} }, invalidate: () => {},
    }
    const linkMod = await imp('src/host/tools/deckMapLink.js')
    const createMod = await imp('src/host/tools/deckIssueCreate.js')
    const link = linkMod.createDeckMapLink(deps)
    const createTool = createMod.createDeckIssueCreate(deps)
    const exec = { agent: { session: { id: 's-790', cwd: '/ws/790' } } }

    const lr = await link.run(exec, { key: '90', parentKey: '78' })
    const item = (lr.items || [])[0] || {}
    check(item.status === 'failed', 'D1 写后读回没父 → 逐条 failed（实得 ' + item.status + '）')
    check(lr.status !== 'ok', 'D2 顶层不再回 ok（实得 ' + lr.status + '）')
    check(String(lr.text || '').includes('失败') && String(lr.text || '').includes('90'), 'D3 顶层带失败摘要（含票号与失败字样）：' + String(lr.text).slice(0, 120))
    check(String(item.evidence || '').length > 0, 'D4 逐条有非空证据：' + String(item.evidence).slice(0, 80))

    const cr = await createTool.run(exec, { title: '带父票的新票', parentKey: '78' })
    check(cr.status === 'partial', 'E1 票建成、边没挂上 → partial（实得 ' + cr.status + '）')
    check(String(cr.text || '').includes('没挂上') && !String(cr.text || '').includes('建好了（父票'), 'E2 不再报“建好了（父票 X）”，而说没挂上：' + String(cr.text).slice(0, 140))
    const citem = (cr.items || [])[0] || {}
    check(citem.status === 'failed', 'E3 建票回执的边逐条 failed（实得 ' + citem.status + '）')

    // 正向对照：读写一致时仍 ok
    const stubOk = {
      id: 'stub-790-ok', label: '桩（读写一致）', matches: async () => false,
      create: () => ({
        id: 'stub-790-ok',
        async create(repoArg, input) {
          return { ok: true, data: { key: '91', title: input.title, state: 'open', body: '', labels: [], assignees: [], parentKey: input.parentKey || null } }
        },
        async get(repoArg, key) {
          return { ok: true, data: { key: String(key), title: 't', state: 'open', body: '', labels: [], assignees: [], parentKey: '78' } }
        },
        async setParent(repoArg, key, parentKey) {
          return { ok: true, data: { key: String(key), title: 't', state: 'open', body: '', labels: [], assignees: [], parentKey: String(parentKey) } }
        },
        async setBlockedBy(repoArg, key, blockers) {
          return { ok: true, data: { key: String(key), title: 't', state: 'open', body: '', labels: [], assignees: [], blockedBy: [] } }
        },
        async getDependencies(repoArg, key) {
          return { ok: true, data: { blockedBy: [], blocking: [] } }
        },
      }),
    }
    const disp2 = registry.register(stubOk)
    registry.bind(handle, 'stub-790-ok')
    const link2 = linkMod.createDeckMapLink(deps)
    const lr2 = await link2.run(exec, { key: '91', parentKey: '78' })
    check(lr2.status === 'ok' && (lr2.items || [])[0].status === 'ok', 'F1 读写一致时仍 ok（回归对照，实得 ' + lr2.status + '）')
    disp2.dispose()
    disp.dispose()
  }

  console.log('\n' + (failed ? '存在失败' : '全部通过 — #790（' + total + ' 条）'))
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error('门禁执行异常：' + ((e && e.stack) || e)); process.exit(1) })
