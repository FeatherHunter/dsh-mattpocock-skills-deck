const { createOutboundControl } = require('../src/refresh/rooms/host/outbound-control.ts')
// tests/verify-790-parent-edge.ts —— #790 父子边静默失败专属门禁（不联网）
// 2026-10-15 从 .js 转成 TypeScript：只改文件名与这行注释，判据与断言一条没动。
// 测什么（第一性原理：真 GitHub 只认数据库编号 + -F，票面号 + -f 必 422）：
//   A) graph.setParent 主路走原生旗 `gh issue edit --parent`（按票号，不碰数据库编号）
//   B) 原生旗未知（老版本）时回退裸接口，且用 -F 传数据库编号（不用 -f 传票面号）
//   C) 裸接口拒收票面号时如实失败，不静默成功
//   D) deck_map_link：写成功但读回没挂上 → failed，且顶层带失败摘要（不再“建成 0 条、无话”）
//   E) deck_issue_create：票建成、边没挂上 → partial +“没挂上”，不再报“建好了（父票 X）”
//   G) 写动作回成功、写后读回失败 → 房如实失败，不许自己拼一张「父票已挂上」的票
//   H) 建票回包写着父票、写后读回失败 → partial +“没读到、没确认”（回包不是「盘上有这条边」的证据）
//   I) 正文里提到父票号、读回里没有这条父子 → partial（正文提到票号不是这条边落上的证据）
//   J) 阻塞边写成功、读回失败 → 说“没读回来”，不说“没出现在票上”
//   K) 同一票号的阻塞边出现两次、读回失败 → 重复项也说“没读回来，判不了”（2026-10-15 对抗式审查补）
//   L) 整图建骨架：子票建成、房在票上记着父子边没挂上 → 这张子票记 failed，不报 ok（同上）
//   M) 认领人 / 标签 / 关票：写动作自述成功、写后读回来的票不认 → 逐条 failed（同上）
const path = require('path')
const { pathToFileURL } = require('url')
// 判定出口桩（#1003 单出口）：壳拿不到它时一律回「判定出口这次没装上」，
// 生产装配总会给（deckToolsAssembly 的 decideBackend），夹具照生产接上。
// #1138 起人选只记在工作区文件里，夹具用 chooseWorkspace 给这个工作区写一份写着选了谁的文件，
// 桩直接调生产判定出口读它；理由与两种造法见 tests/lib/deck-decide-stub.js 文件头。
const { makeDecideStub, chooseWorkspace } = require('./lib/deck-decide-stub.js')

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
  // #790 残留：写动作成功之后那一趟读回按需失败（复现「写成功、读不回来」）。
  let wrote = false
  const exec = async (cmd, args) => {
    calls.push(args.join(' '))
    const line = args.join(' ')
    // 取数据库编号（args 里的 --jq .id 是独立参数，行尾还有它，不能按行尾锚匹配）
    let m = line.match(/^api repos\/o\/r\/issues\/(\d+)(?:\s|$)/)
    if (m && line.includes('--jq .id') && !line.includes('sub_issues') && !line.includes('--method')) return { code: 0, stdout: String(DB(m[1])), stderr: '' }
    // GraphQL 读票（含 parent 边）
    if (line.startsWith('api graphql')) {
      if (o.readFailsAfterWrite && wrote) return { code: 1, stdout: '', stderr: 'HTTP 403: API rate limit exceeded' }
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
      wrote = true
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
      wrote = true
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
  return { cwd: '/ws', outbound: createOutboundControl(), platform: { resolveExecutable: async () => '/usr/bin/gh' }, exec: factory.exec }
}

async function main() {
  console.log('#790 父子边静默失败专属门禁（不联网，严格仿真真 GitHub）')
  const graph = await imp('src/tracker/rooms/github/graph.ts')
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

  // G) 写动作回成功、写后读回失败时，本房不许自己拼一张「父票已挂上」的票（#790 残留）
  {
    const f = strictExecFactory({ readFailsAfterWrite: true })
    const r = await graph.setParent(repo, '90', '78', {}, ghCtxFor(f))
    check(r.ok === false, 'G1 写成功但写后读回失败 → 如实回失败，不装成功（实得 ok=' + r.ok + '）')
    check(String((r.error && r.error.message) || '').includes('读回'), 'G2 失败原话里说清是写后读回没成功（实得：' + String((r.error && r.error.message) || '').slice(0, 120) + '）')
    check(!(r.data && String(r.data.parentKey || '') === '78'), 'G3 返回值里不许出现「父票已挂上」的拼票（实得 parentKey=' + String((r.data && r.data.parentKey) || '(无 data)') + '）')
    check(f.parents.get('90') === '78', 'G4 写动作本身确实发出去了（读回失败不改变「写过」这个事实）')
  }

  // D/E) 工具层：写成功但读回没挂上 → failed/partial，且顶层带原因
  {
    const budget = await imp('src/refresh/kernel/host-budget.js')
    const ledgerMod = await imp('src/refresh/rooms/host/quota-ledger.ts')
    const gateMod = await imp('src/refresh/rooms/host/refresh-gate.ts')
    const registryMod = await imp('src/tracker/registry/core.ts')
    const toolCost = await imp('src/refresh/kernel/tool-call-budget.js')
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
          // #1403 起 kind=issue 带父票时，建票前会先读一次父票；父票 78 在这里答成探索地图。
          if (String(key) === '78') return { ok: true, data: { key: '78', title: '地图', state: 'open', type: 'map', body: '', labels: [], assignees: [], parentKey: null } }
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
    chooseWorkspace('/ws/790', 'stub-790')   // 这个工作区选过了：文件里写着 stub-790（旧写法 registry.bind(handle, 'stub-790')）
    const deps = {
      gate, registry, budget, estimate: toolCost.estimateToolCost, costInputFrom: toolCost.toolCostInputFrom,
      handleFor: () => handle, backendCtx: {}, now: () => clock, log: { fire: () => {} }, invalidate: () => {},
      decideBackend: makeDecideStub(registry),
    }
    const linkMod = await imp('src/deck/tools/map-link.ts')
    const createMod = await imp('src/deck/tools/issue-create.ts')
    const link = linkMod.createDeckMapLink(deps)
    const createTool = createMod.createDeckIssueCreate(deps)
    const exec = { agent: { session: { id: 's-790', cwd: '/ws/790' } } }

    const lr = await link.run(exec, { key: '90', parentKey: '78' })
    const item = (lr.items || [])[0] || {}
    check(item.status === 'failed', 'D1 写后读回没父 → 逐条 failed（实得 ' + item.status + '）')
    check(lr.status !== 'ok', 'D2 顶层不再回 ok（实得 ' + lr.status + '）')
    check(String(lr.text || '').includes('失败') && String(lr.text || '').includes('90'), 'D3 顶层带失败摘要（含票号与失败字样）：' + String(lr.text).slice(0, 120))
    check(String(item.evidence || '').length > 0, 'D4 逐条有非空证据：' + String(item.evidence).slice(0, 80))

    const cr = await createTool.run(exec, { title: '带父票的新票', kind: 'issue', parentKey: '78' })
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
    chooseWorkspace('/ws/790', 'stub-790-ok')   // 把工作区文件改写成选了读写一致的那个桩（正向对照）
    const link2 = linkMod.createDeckMapLink(deps)
    const lr2 = await link2.run(exec, { key: '91', parentKey: '78' })
    check(lr2.status === 'ok' && (lr2.items || [])[0].status === 'ok', 'F1 读写一致时仍 ok（回归对照，实得 ' + lr2.status + '）')

    // H) 建票回包里有父票、写后读回失败 → 说「没读到、没确认」，不报 ok
    //    （#790 残留：契约回包是写动作的自我介绍，不是「盘上有这条边」的证据）
    const stubEcho = {
      id: 'stub-790-echo', label: '桩（建票回包写着父票、读回失败）', matches: async () => false,
      create: () => ({
        id: 'stub-790-echo',
        async create(repoArg, input) {
          return { ok: true, data: { key: '92', title: input.title, state: 'open', body: '', labels: [], assignees: [], parentKey: input.parentKey || null } }
        },
        async get(repoArg, key) {
          // #1403 起建票前会先读父票 78：这一读要成功，写后读回 92 才失败，H 测的才是「边没确认」。
          if (String(key) === '78') return { ok: true, data: { key: '78', title: '地图', state: 'open', type: 'map', body: '', labels: [], assignees: [], parentKey: null } }
          return { ok: false, error: { kind: 'network', message: 'HTTP 403: API rate limit exceeded' } }
        },
        async setParent(repoArg, key, parentKey) {
          return { ok: true, data: { key: String(key), title: 't', state: 'open', body: '', labels: [], assignees: [], parentKey: String(parentKey) } }
        },
        async setBlockedBy(repoArg, key, blockers) {
          return { ok: true, data: { key: String(key), title: 't', state: 'open', body: '', labels: [], assignees: [], blockedBy: [] } }
        },
        async getDependencies(repoArg, key) {
          return { ok: false, error: { kind: 'network', message: 'HTTP 403: API rate limit exceeded' } }
        },
      }),
    }
    const dispEcho = registry.register(stubEcho)
    chooseWorkspace('/ws/790', 'stub-790-echo')
    const createEcho = createMod.createDeckIssueCreate(deps)
    const crEcho = await createEcho.run(exec, { title: '回包写着父票、读回失败', kind: 'issue', parentKey: '78' })
    const crEchoItem = (crEcho.items || [])[0] || {}
    check(crEcho.status === 'partial', 'H1 写后读回失败 → partial，不因建票回包写着父票就算落上（实得 ' + crEcho.status + '）')
    check(!String(crEcho.text || '').includes('建好了（父票'), 'H2 不报「建好了（父票 X）」：' + String(crEcho.text).slice(0, 140))
    check(/没读到|没读回|没确认|未确认/.test(String(crEcho.text || '') + ' ' + String(crEchoItem.evidence || '')), 'H3 文案说清「没读到、没确认」：' + String(crEchoItem.evidence || '').slice(0, 120))
    dispEcho.dispose()

    // I) 正文里提到父票号、写后读回里没有这条父子 → 不算落上
    //    （#790 残留：正文里出现「归属 #78」是作者写的字，不是这条边落上的证据）
    const stubBody = {
      id: 'stub-790-body', label: '桩（正文提到父票号、读回没有父子）', matches: async () => false,
      create: () => ({
        id: 'stub-790-body',
        async create(repoArg, input) {
          return { ok: true, data: { key: '93', title: input.title, state: 'open', body: '这一张归属 #78。', labels: [], assignees: [], parentKey: null } }
        },
        async get(repoArg, key) {
          // #1403 起建票前会先读父票 78；读回子票 93 时正文仍写着归属 #78，但 parentKey 是空的。
          if (String(key) === '78') return { ok: true, data: { key: '78', title: '地图', state: 'open', type: 'map', body: '', labels: [], assignees: [], parentKey: null } }
          return { ok: true, data: { key: String(key), title: 't', state: 'open', body: '这一张归属 #78。', labels: [], assignees: [], parentKey: null } }
        },
        async setParent(repoArg, key, parentKey) {
          return { ok: true, data: { key: String(key), title: 't', state: 'open', body: '这一张归属 #78。', labels: [], assignees: [], parentKey: null } }
        },
        async setBlockedBy(repoArg, key, blockers) {
          return { ok: true, data: { key: String(key), title: 't', state: 'open', body: '', labels: [], assignees: [], blockedBy: [] } }
        },
        async getDependencies(repoArg, key) {
          return { ok: true, data: { blockedBy: [], blocking: [] } }
        },
      }),
    }
    const dispBody = registry.register(stubBody)
    chooseWorkspace('/ws/790', 'stub-790-body')
    const createBody = createMod.createDeckIssueCreate(deps)
    const crBody = await createBody.run(exec, { title: '正文提到父票号', kind: 'issue', parentKey: '78' })
    const crBodyItem = (crBody.items || [])[0] || {}
    check(crBody.status === 'partial', 'I1 正文提到父票号不算落上 → partial（实得 ' + crBody.status + '）')
    check(!String(crBody.text || '').includes('（父票'), 'I2 顶层不说「（父票 78）」：' + String(crBody.text).slice(0, 140))
    check(/正文/.test(String(crBodyItem.evidence || '')), 'I3 证据里点明正文提到票号不等于这条边落上：' + String(crBodyItem.evidence || '').slice(0, 140))
    dispBody.dispose()

    // J) 阻塞边：写成功、读回失败 → 说「没读回来」，不说「没出现在票上」
    const stubBlockRead = {
      id: 'stub-790-blockread', label: '桩（阻塞边写成功、读回失败）', matches: async () => false,
      create: () => ({
        id: 'stub-790-blockread',
        async create(repoArg, input) {
          return { ok: true, data: { key: '94', title: input.title, state: 'open', body: '', labels: [], assignees: [], parentKey: null } }
        },
        async get(repoArg, key) {
          return { ok: true, data: { key: String(key), title: 't', state: 'open', body: '', labels: [], assignees: [], parentKey: null } }
        },
        async setParent(repoArg, key, parentKey) {
          return { ok: true, data: { key: String(key), title: 't', state: 'open', body: '', labels: [], assignees: [], parentKey: String(parentKey) } }
        },
        async setBlockedBy(repoArg, key, blockers) {
          return { ok: true, data: { key: String(key), title: 't', state: 'open', body: '', labels: [], assignees: [], blockedBy: [] } }
        },
        async getDependencies(repoArg, key) {
          return { ok: false, error: { kind: 'network', message: 'HTTP 403: API rate limit exceeded' } }
        },
      }),
    }
    const dispBlockRead = registry.register(stubBlockRead)
    chooseWorkspace('/ws/790', 'stub-790-blockread')
    const link3 = linkMod.createDeckMapLink(deps)
    const lrJ = await link3.run(exec, { key: '94', blockedBy: ['78'] })
    const jItem = (lrJ.items || [])[0] || {}
    check(lrJ.status !== 'ok' && jItem.status === 'failed', 'J1 阻塞边读回失败 → 逐条 failed、顶层不是 ok（实得 ' + jItem.status + ' / ' + lrJ.status + '）')
    check(/没读回|没读到|未确认|没确认/.test(String(jItem.evidence || '')) && !/没出现在票上/.test(String(jItem.evidence || '')), 'J2 说「没读回来」而不是「没出现在票上」：' + String(jItem.evidence || '').slice(0, 140))
    // K) 同一票号的阻塞边出现两次、写后读回失败 → 重复项也说「没读回来，判不了」（#790 审查 ②-2）
    //    （重复项分支以前自己重算一次「读回来了、里面没有」，与 J 节同一处不诚实）
    const lrK = await link3.run(exec, { edges: [{ key: '94', blockedBy: ['78'] }, { key: '94', blockedBy: ['79'] }] })
    const kItems = lrK.items || []
    const kDup = kItems[kItems.length - 1] || {}
    check(kItems.length >= 2 && kDup.status === 'failed', 'K1 重复项也逐条 failed（实得 ' + kDup.status + ' / ' + kItems.length + ' 条）')
    check(/没读回|判不了|没确认/.test(String(kDup.evidence || '')) && !/没出现在票上/.test(String(kDup.evidence || '')), 'K2 重复项说「没读回来，判不了」而不是「没出现在票上」：' + String(kDup.evidence || '').slice(0, 140))
    dispBlockRead.dispose()

    // L) 整图建骨架：子票建成了、房在票上记着父子边没挂上 → 这张子票记 failed，不报 ok（#790 审查 ②-3）
    //    （parentError 是房自己的原话，建骨架以前从不读它，于是整图会报 status:'ok' 而边其实一条没挂）
    const stubPlan = {
      id: 'stub-790-plan', label: '桩（子票建成、父子边没挂上）', matches: async () => false,
      create: () => ({
        id: 'stub-790-plan',
        async create(repoArg, input) {
          return { ok: true, data: { key: '97', title: input.title, state: 'open', body: '', labels: [], assignees: [], parentKey: null, parentError: { kind: 'unsupported', message: 'HTTP 422: sub_issue_id must be a database id' } } }
        },
        async get(repoArg, key) { return { ok: true, data: { key: String(key), title: 't', state: 'open', body: '', labels: [], assignees: [], parentKey: null } } },
        async setParent() { return { ok: true, data: {} } },
        async setBlockedBy() { return { ok: true, data: {} } },
        async getDependencies() { return { ok: true, data: { blockedBy: [], blocking: [] } } },
      }),
    }
    const dispPlan = registry.register(stubPlan)
    chooseWorkspace('/ws/790', 'stub-790-plan')
    const planMod = await imp('src/deck/tools/map-plan-create.ts')
    const planTool = planMod.createDeckMapPlanCreate(deps)
    const planRun = await planTool.run(exec, { title: '地图', children: [{ key: 'c1', title: '子票一', kind: 'issue' }], edges: [{ from: '@map', to: 'c1', type: 'parent' }] })
    const childItem = (planRun.items || []).filter((i) => i.role === 'child')[0] || {}
    check(childItem.status === 'failed', 'L1 父子边没挂上 → 这张子票记 failed，不报 ok（实得 ' + childItem.status + '）')
    check(/父子边没挂上/.test(String(childItem.reason || '')), 'L2 原因里点明父子边没挂上：' + String(childItem.reason || '').slice(0, 140))
    dispPlan.dispose()

    // M) 认领人 / 标签 / 关票三步：写动作自述成功、写后读回来的票不认 → 逐条 failed（#790 审查 ①-1、①-2）
    //    （三步以前都只看写动作自己的回包：认领人那一步因为 GitHub 房把回包覆盖成刚提交的那份，
    //     连读回那一支都永远走不到，于是「写命令成功、盘上没记上」被报成 ok）
    const stubSteps = {
      id: 'stub-790-steps', label: '桩（写动作自述成功、读回来的票不认）', matches: async () => false,
      create: () => ({
        id: 'stub-790-steps',
        async get(repoArg, key) { return { ok: true, data: { key: String(key), title: 't', state: 'open', body: '', labels: [], assignees: [], parentKey: null } } },
        async setAssignees(repoArg, key, want) { return { ok: true, data: { key: String(key), title: 't', state: 'open', body: '', labels: [], assignees: want, parentKey: null } } },
        async setLabels(repoArg, key, want) { return { ok: true, data: { key: String(key), title: 't', state: 'open', body: '', labels: want, assignees: [], parentKey: null } } },
        async close(repoArg, key) { return { ok: true, data: { key: String(key), title: 't', state: 'closed', body: '', labels: [], assignees: [], parentKey: null } } },
        async comment() { return { ok: true, data: {} } },
        async setParent() { return { ok: true, data: {} } },
        async setBlockedBy() { return { ok: true, data: {} } },
        async getDependencies() { return { ok: true, data: { blockedBy: [], blocking: [] } } },
      }),
    }
    const dispSteps = registry.register(stubSteps)
    chooseWorkspace('/ws/790', 'stub-790-steps')
    const patchMod = await imp('src/deck/tools/issue-patch.ts')
    const patchTool = patchMod.createDeckIssuePatch(deps)
    const prA = await patchTool.run(exec, { key: '96', assignees: ['alice'] })
    const aItem = (prA.items || [])[0] || {}
    check(aItem.status === 'failed', 'M1 写回包写着认领人、读回来的票上没有 → 这一步 failed（实得 ' + aItem.status + '）')
    check(/没记|没读回|没有这些认领人/.test(String(aItem.reason || '')), 'M2 认领人那一步的原因说清读回来的票上没有：' + String(aItem.reason || '').slice(0, 140))
    const prL = await patchTool.run(exec, { key: '96', addLabels: ['bug'] })
    const lItem = (prL.items || [])[0] || {}
    check(lItem.status === 'failed', 'M3 标签：写回包写着改好了、读回来没有 → 这一步 failed（实得 ' + lItem.status + '）')
    const prC = await patchTool.run(exec, { key: '96', close: true })
    const cItem = (prC.items || [])[0] || {}
    check(cItem.status === 'failed', 'M4 关票：写回包写着已关、读回来还是 open → 这一步 failed（实得 ' + cItem.status + '）')
    dispSteps.dispose()

    disp2.dispose()
    disp.dispose()
  }

  console.log('\n' + (failed ? '存在失败' : '全部通过 — #790（' + total + ' 条）'))
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error('门禁执行异常：' + ((e && e.stack) || e)); process.exit(1) })
