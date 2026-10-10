#!/usr/bin/env node
// tests/verify-992-readonly-labels.js —— #992 只读仓库标签能力降级专属门禁（不联网）
//
// 测什么（定版“最终方案”第 1–6 项 + Q6/Q7；第 7 项 `gh:labels` 清理属 #1001，不在这里）：
//   A) 分类只修真错的一句：GraphQL 复数权限句（does not have the correct permissions /
//      AddLabelsToLabelable）在 errors.js 与 preflight.js 都归 auth；HTTP 404 仍归 not-found（不动）。
//   B) 权限单源 helper：同批复用只真问一次；问不出来回 null（调用方走“分不清”分支，不瞎猜）。
//   C) setLabels 失败归因：只读仓库上打标失败回 auth，且原因里带仓库 owner/name 与读权限说法，
//      不再是 404 原文或网络错误；有写权限或问不出来时原样返回。
//   D) 建票不再吞标签失败：createIssue 在票上记 labelError（照 parentError 先例，票照样建成 ok:true），
//      且正文带“待补标签（只读未落盘）”区（区名必带“未落盘”，话术按双入口拆）。
//   E) deck_issue_create 按结果说话：标签没挂上 → partial 并写明哪几个标签、为什么，
//      不再报“我替你补了”；挂上了仍 ok 并照说补了（回归对照）。
//   F) 批量改色 N+1 消除：10 个标签同时撞 404，仓库权限只真问一次。
//   G) deck_context 能力位：GitHub 只读时 repo 带权限位 + “这个仓库只读”提示；
//      Markdown 恒可写；GitLab 诚实未知；README 与提示词里有权限前置与 fork 指路。
const path = require('path')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href)
const PERM_SENTENCE = 'GraphQL: u does not have the correct permissions to execute `AddLabelsToLabelable` (addLabelsToLabelable)'

function plat(exec) {
  return { resolveExecutable: async (n) => (n === 'gh' || n === 'git' ? n : null), env: { get: () => '' } }
}

// 脚本化的 gh（只读仓库 acme/demo）：读票走 GraphQL 成功（空标签），打标按权限句失败，
// 查权限回 .permissions，建票/改正文/读回按需成功。
function makeCtx(opts) {
  const o = opts || {}
  const calls = []
  const perms = o.perms === undefined ? { push: false, triage: false, admin: false, maintain: false, pull: true } : o.perms
  const exec = async (cmd, args) => {
    const list = Array.isArray(args) ? args.slice() : []
    calls.push(list.join(' '))
    const line = list.join(' ')
    if (list[0] === 'api' && String(list[1]).indexOf('repos/') === 0 && line.includes('.permissions')) {
      if (o.permsFails) return { code: 1, stdout: '', stderr: 'HTTP 404: Not Found' }
      if (perms === null) return { code: 0, stdout: 'null', stderr: '' }
      return { code: 0, stdout: JSON.stringify(perms), stderr: '' }
    }
    if (list[0] === 'api' && list[1] === 'graphql') {
      const row = { number: 7, title: 't7', state: 'OPEN', body: 'hello', url: '', createdAt: '', updatedAt: '', closedAt: null, author: { login: 'a' }, assignees: { nodes: [] }, labels: { nodes: [] }, milestone: null, comments: { nodes: [] }, parent: null, blockedBy: { nodes: [] } }
      return { code: 0, stdout: JSON.stringify({ data: { repository: { issue: row } } }), stderr: '' }
    }
    if (list[0] === 'issue' && list[1] === 'edit' && line.includes('--add-label')) {
      return { code: 1, stdout: '', stderr: PERM_SENTENCE }
    }
    if (list[0] === 'issue' && list[1] === 'edit' && line.includes('--body')) {
      if (o.bodyFails) return { code: 1, stdout: '', stderr: PERM_SENTENCE }
      return { code: 0, stdout: '', stderr: '' }
    }
    if (list[0] === 'issue' && list[1] === 'view') {
      return { code: 0, stdout: JSON.stringify({ number: 7, title: 't7', state: 'open', body: 'hello\n\n## 待补标签（只读未落盘）\n\n以下标签这次没确认挂上', url: '', created_at: '', updated_at: '', closed_at: null, labels: [], assignees: [] }), stderr: '' }
    }
    if (list[0] === 'api' && String(list[1]).indexOf('repos/') === 0 && line.includes('--method POST')) {
      return { code: 0, stdout: JSON.stringify({ number: 7, title: 't7', body: 'hello', state: 'open', html_url: '', created_at: '', updated_at: '', labels: [], assignees: [] }), stderr: '' }
    }
    return { code: 1, stdout: '', stderr: 'verify-992 假 gh 没脚本化这条命令: ' + line }
  }
  return { ctx: { cwd: '/ws/992', platform: plat(), exec: exec }, calls: calls }
}
const permCalls = (calls) => calls.filter((l) => l.startsWith('api repos/') && l.includes('.permissions'))

async function main() {
  console.log('#992 只读仓库标签能力降级专属门禁（不联网）')
  const { ERROR_KIND } = await imp('src/shared/tracker/constants.js')

  // ── A) 分类 ──
  {
    const { classifyGhError } = await imp('src/host/tracker/backends/github/errors.js')
    const { classifyError } = await imp('src/host/tracker/preflight.js')
    check(classifyGhError({ message: PERM_SENTENCE }) === ERROR_KIND.AUTH, 'A1 errors.js：GraphQL 复数权限句归 auth（实得 ' + classifyGhError({ message: PERM_SENTENCE }) + '）')
    check(classifyError({ message: PERM_SENTENCE }) === ERROR_KIND.AUTH, 'A2 preflight.js：同一句同样归 auth（两处同改，实得 ' + classifyError({ message: PERM_SENTENCE }) + '）')
    const keep404 = classifyGhError({ message: 'HTTP 404: Not Found (https://api.github.com/repos/a/b/labels)' })
    check(keep404 === ERROR_KIND.NOTFOUND, 'A3 404 仍归 not-found（这一档本来就是对的，不动；实得 ' + keep404 + '）')
    const net = classifyGhError({ message: 'dial tcp: lookup api.github.com: no such host' })
    check(net === ERROR_KIND.NETWORK, 'A4 真连不通仍归 network（回归对照；实得 ' + net + '）')
  }

  // ── B) 单源 helper ──
  {
    const { readRepoPermissions, readonlyMessage } = await imp('src/host/tracker/backends/github/repo-permissions.js')
    const f = makeCtx()
    const cache = new Map()
    const p1 = await readRepoPermissions({ execGh: async (a, o) => { const r = await f.ctx.exec('gh', a, o); return r.code === 0 ? { ok: true, data: { stdout: r.stdout } } : { ok: false, error: { kind: 'network', message: r.stderr } } } }, 'acme/demo', f.ctx, cache)
    const p2 = await readRepoPermissions({ execGh: async (a, o) => { const r = await f.ctx.exec('gh', a, o); return r.code === 0 ? { ok: true, data: { stdout: r.stdout } } : { ok: false, error: { kind: 'network', message: r.stderr } } } }, 'acme/demo', f.ctx, cache)
    check(p1 && p1.push === false && p1.triage === false, 'B1 权限读回 {push:false,triage:false}（实得 ' + JSON.stringify(p1) + '）')
    check(permCalls(f.calls).length === 1, 'B2 同批复用：两次问只真发出一次 gh api（实发 ' + permCalls(f.calls).length + ' 次）')
    check(!!p2 && p2.push === false, 'B3 第二次拿的是复用结论（仍是只读）')
    const bad = makeCtx({ permsFails: true })
    const pn = await readRepoPermissions({ execGh: async (a, o) => { const r = await bad.ctx.exec('gh', a, o); return r.code === 0 ? { ok: true, data: { stdout: r.stdout } } : { ok: false, error: { kind: 'network', message: r.stderr } } } }, 'acme/demo', bad.ctx, new Map())
    check(pn === null, 'B4 问不出来回 null（调用方走“分不清”分支，不瞎猜；实得 ' + JSON.stringify(pn) + '）')
    const msg = readonlyMessage('acme/demo', ['bug', 'needs-triage'])
    check(msg.includes('acme/demo') && msg.includes('读权限') && msg.includes('bug'), 'B5 统一说法带仓库名、读权限与标签名：' + msg.slice(0, 60) + '…')
  }

  // ── C) setLabels 归因 ──
  {
    const { setLabels } = await imp('src/host/tracker/backends/github/labels.js')
    const repo = { backend: 'github', refId: 'acme/demo', name: 'demo', url: '' }
    const f = makeCtx()
    const r = await setLabels(repo, '7', [{ name: 'bug' }, { name: 'needs-triage' }], {}, f.ctx)
    check(r.ok === false, 'C1 只读仓库上打标如实失败（ok=false，实得 ok=' + r.ok + '）')
    check(r.ok === false && r.error.kind === 'auth', 'C2 失败归鉴权档，不再是网络错误（实得 ' + (r.ok === false ? r.error.kind : '') + '）')
    const m = r.ok === false ? String(r.error.message) : ''
    check(m.includes('acme/demo') && (m.includes('读权限') || m.includes('写权限')), 'C3 原因里带仓库 owner/name 与权限说法（实得：' + m.slice(0, 80) + '…）')
    check(!/HTTP 404/.test(m), 'C4 不再是 404 原文（实得：' + m.slice(0, 80) + '…）')
    // 有写权限时原样返回（标签真不存在，不瞎说成没权限）
    const f2 = makeCtx({ perms: { push: true, triage: true, admin: false, maintain: false, pull: true } })
    const r2 = await setLabels(repo, '7', [{ name: 'bug' }], {}, f2.ctx)
    check(r2.ok === false && String(r2.error.message).includes('correct permissions'), 'C5 有写权限时原样返回 gh 原文（不瞎改；实得：' + String(r2.ok === false ? r2.error.message : '').slice(0, 60) + '…）')
  }

  // ── D) 建票 labelError + 正文区 ──
  {
    const { createIssue } = await imp('src/host/tracker/backends/github/issues-write.js')
    const repo = { backend: 'github', refId: 'acme/demo', name: 'demo', url: '' }
    const f = makeCtx()
    const r = await createIssue(repo, { title: '只读库建票', body: 'hello', type: 'issue', labels: ['bug'] }, f.ctx)
    check(r.ok === true, 'D1 票照样建成 ok:true（部分成功，整体不失败；实得 ok=' + r.ok + '）')
    check(r.ok === true && !!r.data.labelError, 'D2 票上记了 labelError（不再吞错；实得 ' + JSON.stringify(r.ok === true ? r.data.labelError : r) + '）')
    check(r.ok === true && r.data.labelError && r.data.labelError.kind === 'auth', 'D3 labelError 落鉴权档（实得 ' + (r.ok === true ? r.data.labelError.kind : '') + '）')
    const bodySent = f.calls.find((l) => l.includes('issue edit') && l.includes('--body'))
    check(!!bodySent && bodySent.includes('待补标签') && bodySent.includes('未落盘'), 'D4 尽力把“待补标签（只读未落盘）”区写进正文（实发：' + String(bodySent || '(none)').slice(0, 100) + '…）')
    check(!!bodySent && bodySent.includes('acme/demo') && bodySent.includes('bug'), 'D5 正文区带仓库名与待补标签名，话术含 fork 指路（实发含 origin=' + String(!!bodySent && bodySent.includes('origin')) + '）')
    // 改正文也没权限时：建票仍成，labelError 仍在
    const fb = makeCtx({ bodyFails: true })
    const rb = await createIssue(repo, { title: '只读库建票', body: 'hello', type: 'issue', labels: ['bug'] }, fb.ctx)
    check(rb.ok === true && !!rb.data.labelError, 'D6 改正文也失败时建票仍成、labelError 仍在（尽力写，不挡主路）')
  }

  // ── E) 工具层按结果说话 ──
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
    const labelErr = { kind: 'auth', message: '你在「acme/demo」上只有读权限，没有给票打标签的权限——这次没挂上的标签（bug、needs-triage）没写进去' }
    const mkStub = (withErr) => ({
      id: withErr ? 'stub-992-err' : 'stub-992-ok', label: '桩', matches: async () => false,
      create: () => ({
        id: withErr ? 'stub-992-err' : 'stub-992-ok',
        async create(repoArg, input) {
          const issue = { key: '92', title: input.title, state: 'open', body: String(input.body || ''), labels: [], assignees: [], parentKey: null }
          if (withErr) issue.labelError = labelErr
          return { ok: true, data: issue }
        },
        async get(repoArg, key) { return { ok: true, data: { key: String(key), title: 't', state: 'open', body: '', labels: [], assignees: [], parentKey: null } } },
        async setParent(repoArg, key, parentKey) { return { ok: true, data: { key: String(key), title: 't', state: 'open', body: '', labels: [], assignees: [], parentKey: null } } },
        async setBlockedBy(repoArg, key, blockers) { return { ok: true, data: { key: String(key), title: 't', state: 'open', body: '', labels: [], assignees: [], blockedBy: [] } } },
        async getDependencies(repoArg, key) { return { ok: true, data: { blockedBy: [], blocking: [] } } },
      }),
    })
    const disp = registry.register(mkStub(true))
    const handle = { cwd: '/ws/992', refId: 'o/r' }
    registry.bind(handle, 'stub-992-err')
    const deps = { gate, registry, budget, estimate: toolCost.estimateToolCost, costInputFrom: toolCost.toolCostInputFrom, handleFor: () => handle, backendCtx: {}, now: () => clock, log: { fire: () => {} }, invalidate: () => {} }
    const createMod = await imp('src/host/tools/deckIssueCreate.js')
    const tool = createMod.createDeckIssueCreate(deps)
    const exec = { agent: { session: { id: 's-992', cwd: '/ws/992' } } }
    const cr = await tool.run(exec, { title: '只读库建 bug 票', kind: 'bug' })
    check(cr.status === 'partial', 'E1 标签没挂上 → partial（实得 ' + cr.status + '）')
    check(String(cr.text || '').includes('没挂上') && String(cr.text || '').includes('读权限'), 'E2 写明哪几个标签、为什么（权限）：' + String(cr.text).slice(0, 100) + '…')
    check(!(cr.notes || []).join('').includes('我替你补了必备标签'), 'E3 不再出现“我替你补了”假话')
    const item = (cr.items || []).find((i) => i.step === 'labels') || {}
    check(item.status === 'failed', 'E4 labels 逐条 failed（实得 ' + item.status + '）')
    disp.dispose()
    // 回归对照：挂上了仍 ok 并照说补了
    const disp2 = registry.register(mkStub(false))
    registry.bind(handle, 'stub-992-ok')
    const tool2 = createMod.createDeckIssueCreate(deps)
    const ok2 = await tool2.run(exec, { title: '正常建 bug 票', kind: 'bug' })
    check(ok2.status === 'ok', 'E5 标签挂上时仍 ok（回归对照；实得 ' + ok2.status + '）')
    check((ok2.notes || []).join('').includes('我替你补了必备标签'), 'E6 挂上时照说补了（回归对照）')
    disp2.dispose()
  }

  // ── F) 改色批内只问一次 ──
  {
    const { githubModule } = await imp('src/host/tracker/backends/github/index.js')
    const tracker = githubModule.create({})
    const calls = []
    const ctx = {
      cwd: '/ws/992',
      platform: plat(),
      exec: async (cmd, args) => {
        const list = Array.isArray(args) ? args.slice() : []
        calls.push(list.join(' '))
        const line = list.join(' ')
        if (list[0] === 'api' && String(list[1]).indexOf('repos/') === 0) {
          return { code: 0, stdout: JSON.stringify({ push: false, triage: false, pull: true }), stderr: '' }
        }
        if (list[0] === 'label' && list[1] === 'edit') {
          return { code: 1, stdout: '', stderr: 'HTTP 404: Not Found (https://api.github.com/repos/acme/demo/labels/x)' }
        }
        return { code: 1, stdout: '', stderr: 'verify-992 假 gh 没脚本化: ' + line }
      },
      logEvent: () => {}, isEnabled: () => false,
    }
    const changes = []
    for (let i = 1; i <= 10; i++) changes.push({ name: 'label-' + i, color: '111111' })
    const r = await tracker.setLabelColors({ backend: 'github', refId: 'acme/demo', name: 'demo', url: '' }, changes, ctx)
    const asked = calls.filter((l) => l.startsWith('api repos/') && l.includes('.permissions'))
    check(r.ok === true && r.data.failed.length === 10, 'F1 10 条全失败仍逐条记账（实得 failed=' + (r.ok === true ? r.data.failed.length : JSON.stringify(r)) + '）')
    check(r.ok === true && r.data.failed.every((x) => x.reason.kind === 'auth'), 'F2 只读库上 10 条全落鉴权档')
    check(asked.length === 1, 'F3 仓库权限只真问一次（实发 ' + asked.length + ' 次）')
    check(!calls.some((l) => l.includes('viewerPermission')), 'F4 不再用 viewerPermission 那条旧命令')
  }

  // ── G) 能力位 + 文档 + 提示词 ──
  {
    const fs = require('fs')
    const zh = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8')
    check(zh.includes('push') && zh.includes('triage') && /只读|读权限/.test(zh), 'G1 README 有 push/triage 前置条件（只读时标签链不可用）')
    const en = fs.readFileSync(path.join(ROOT, 'docs', 'README.en.md'), 'utf8')
    check(en.includes('push access') && en.includes('triage'), 'G2 英文 README 同步了权限前置')
    const gh = await imp('src/host/tracker/backends/github/index.js')
    const zhP = gh.prompts.ensureLabels.zh
    const enP = gh.prompts.ensureLabels.en
    check(String(zhP).includes('fork') && String(zhP).includes('origin'), 'G3 补标签弹窗指路 fork（只建议，不代劳改配置）')
    check(!/[\u4e00-\u9fff]/.test(String(enP)) && String(enP).includes('fork'), 'G4 英文弹窗无中文且同样指路 fork')
    check(String(gh.fixes['gh:repoAccess'].hint.zh).includes('fork'), 'G5 检查页 gh:repoAccess 详情同样指路 fork')
    check(!/[\u4e00-\u9fff]/.test(String(gh.fixes['gh:repoAccess'].hint.en)), 'G6 检查页英文详情无中文')
    // deck_context：GitHub 只读 → 能力位 + 提示；可写 → 无提示；无方法 → 未知不抛
    const budget = await imp('src/shared/refresh/budget.js')
    const ledgerMod = await imp('src/host/refresh/ledger.js')
    const gateMod = await imp('src/host/refresh/gate.js')
    const registryMod = await imp('src/host/tracker/registryCore.js')
    const toolCost = await imp('src/shared/refresh/tool-cost.js')
    const ctxMod = await imp('src/host/tools/deckContext.js')
    async function runCtx(stubId, trackerImpl) {
      let clock = 1700000000000
      const ledger = ledgerMod.createLedger({ now: () => clock })
      const gate = gateMod.createGate({ ledger: ledger, now: () => clock })
      ledger.syncServer({ rest: { limit: 5000, remaining: 5000, reset: clock + 3600000 }, graphql: { limit: 5000, remaining: 5000, reset: clock + 3600000 } }, clock)
      const registry = registryMod.createRegistry({ logEvent: () => {}, isEnabled: () => false }, { matchesTimeout: 200 })
      const stub = { id: stubId, label: '桩', matches: async () => false, create: () => trackerImpl }
      const disp = registry.register(stub)
      const handle = { cwd: '/ws/992', refId: 'o/r' }
      registry.bind(handle, stubId)
      const deps = { gate, registry, budget, estimate: toolCost.estimateToolCost, costInputFrom: toolCost.toolCostInputFrom, handleFor: () => handle, backendCtx: {}, now: () => clock, log: { fire: () => {} }, invalidate: () => {} }
      const tool = ctxMod.createDeckContext(deps)
      const out = await tool.run({ agent: { session: { id: 's-992', cwd: '/ws/992' } } }, {})
      disp.dispose()
      return out
    }
    const ro = await runCtx('github', {
      async preflight() { return { ok: true } },
      async list() { return { ok: true, data: [] } },
      async getRepoPermissions() { return { ok: true, data: { push: false, triage: false } } },
    })
    check(ro.status === 'ok' && ro.data && ro.data.repo && ro.data.repo.permissions && ro.data.repo.permissions.push === false, 'G7 GitHub 只读：repo 带权限位 {push:false}（实得 ' + JSON.stringify(ro.data && ro.data.repo && ro.data.repo.permissions) + '）')
    check((ro.notes || []).join('').includes('这个仓库只读：标签与写操作不可用'), 'G8 GitHub 只读：notes 出现“这个仓库只读”那句')
    const wr = await runCtx('github', {
      async preflight() { return { ok: true } },
      async list() { return { ok: true, data: [] } },
      async getRepoPermissions() { return { ok: true, data: { push: true, triage: true } } },
    })
    check(wr.data.repo.permissions.push === true && !(wr.notes || []).join('').includes('这个仓库只读'), 'G9 GitHub 可写：权限位为真且无只读提示')
    const md = await runCtx('markdown', {
      async preflight() { return { ok: true } },
      async list() { return { ok: true, data: [] } },
    })
    check(md.data.repo.permissions && md.data.repo.permissions.push === true, 'G10 Markdown 恒可写（实得 ' + JSON.stringify(md.data.repo.permissions) + '）')
    const gl = await runCtx('gitlab', {
      async preflight() { return { ok: true } },
      async list() { return { ok: true, data: [] } },
    })
    check(gl.status === 'ok' && gl.data.repo.permissions && gl.data.repo.permissions.unknown === true, 'G11 GitLab 诚实未知（不捏造；实得 ' + JSON.stringify(gl.data.repo.permissions) + '）')
  }

  console.log('\n' + (failed ? '存在失败 — #992 门禁未通过' : '全部通过 — #992（' + total + ' 项断言）'))
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error('门禁执行异常：' + ((e && e.stack) || e)); process.exit(1) })
