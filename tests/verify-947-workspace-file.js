// tests/verify-947-workspace-file.js —— 工作区配置文件门禁（947 规格验收）
// 用法：在插件根目录执行 node tests/verify-947-workspace-file.js，可独立运行。
//
// 盯四件事（读链，不含写器；写器顺延 948）：
//   W1 解析只认人选：坏 JSON、错版本、空 id、非 user 来源一律 null。
//   W2 探测顺序：内存绑定 > 工作区文件 > 主锚；未知 id 的层跳过。
//   W3 工具顺序：内存 > 本机记忆H > 文件 > 自动识别；口子缺席照旧走自动识别（旧接线兼容）。
//   W4 落盘形状：四项齐全，不带路径与令牌字样，拼装可往返。
const path = require('path')
const fs = require('fs')
const os = require('os')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg, detail) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg + (ok ? '' : (detail ? ' — ' + String(detail).slice(0, 300) : ''))); if (!ok) failed = true }
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href)

function makeFs() {
  return {
    async resolve(p, opts) { const base = (opts && opts.cwd) || ''; const rel = String(p || '').replace(/\\/g, '/'); return base ? String(base).replace(/\\/g, '/') + '/' + rel : rel },
    async readText(t) { return fs.readFileSync(t, 'utf8') },
    async writeText(t, c) { fs.mkdirSync(path.dirname(t), { recursive: true }); fs.writeFileSync(t, c, 'utf8') },
    async lstat(t) { try { return fs.statSync(t) } catch (e) { return null } },
    async listDir(t) { try { return fs.readdirSync(t) } catch (e) { return [] } },
    async stat(t) { try { return fs.statSync(t) } catch (e) { return null } },
  }
}
function makeGateLedger(gateMod, ledgerMod) {
  const ledger = ledgerMod.createLedger({ now: () => 1700000000000 })
  const gate = gateMod.createGate({ ledger: ledger, logCtx: null, now: () => 1700000000000 })
  ledger.syncServer({ rest: { limit: 5000, remaining: 5000, reset: 1700003600000 }, graphql: { limit: 5000, remaining: 5000, reset: 1700003600000 } }, 1700000000000)
  return gate
}

async function main() {
  console.log('工作区配置文件门禁（947：格式与读链四层）')
  const wfMod = await imp('src/shared/deck-tools/workspace-file.js')
  const { parseWorkspaceFile, stringifyWorkspaceFile, WORKSPACE_FILE_REL, WORKSPACE_FILE_VERSION } = wfMod

  // —— W1：只认人选 ——
  {
    check(parseWorkspaceFile(JSON.stringify({ version: 1, backendId: 'github', pickedAt: 7, source: 'user' })).backendId === 'github', 'W1 有效文件认出后端')
    check(parseWorkspaceFile('{oops') === null, 'W1 坏 JSON 为 null')
    check(parseWorkspaceFile(JSON.stringify({ version: 2, backendId: 'github', pickedAt: 7, source: 'user' })) === null, 'W1 错版本为 null')
    check(parseWorkspaceFile(JSON.stringify({ version: 1, backendId: '', pickedAt: 7, source: 'user' })) === null, 'W1 空 id 为 null')
    check(parseWorkspaceFile(JSON.stringify({ version: 1, backendId: 'github', pickedAt: 7, source: 'auto' })) === null, 'W1 非 user 来源为 null')
    check(parseWorkspaceFile(JSON.stringify({ version: 1, backendId: 'github', source: 'user' })) === null, 'W1 缺档案时间为 null')
    check(parseWorkspaceFile('\uFEFF' + JSON.stringify({ version: 1, backendId: 'github', pickedAt: 7, source: 'user' })).backendId === 'github', 'W1 带 BOM 照认')
    check(WORKSPACE_FILE_REL === 'docs/agents/workspace.json' && WORKSPACE_FILE_VERSION === 1, 'W1 路径与版本钉住')
  }

  // —— W2：探测顺序（内存 > 文件 > 锚） ——
  const detMod = await imp('src/host/tracker/detection/explicitDetector.js')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wf947-'))
  const anchorOf = (title) => '# Issue tracker: ' + title + '\n\nBody mentions gh issue.\n'
  const regStub = (boundId) => ({
    bound: () => boundId,
    has: (id) => id === 'github' || id === 'markdown',
    describe: (h, id) => ({ backend: id, refId: (h && h.cwd) || '', name: id, url: '' }),
  })
  const platOf = (fss) => ({ path: path.posix, fs: fss })
  {
    const dir = path.join(tmp, 'a'); fs.mkdirSync(path.join(dir, 'docs', 'agents'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'docs', 'agents', 'issue-tracker.md'), anchorOf('GitHub'))
    fs.writeFileSync(path.join(dir, 'docs', 'agents', 'workspace.json'), JSON.stringify({ version: 1, backendId: 'markdown', pickedAt: 9, source: 'user' }))
    const fss = makeFs(); const ctx = { platform: platOf(fss), cwd: dir }
    const r1 = await detMod.detectExplicit({ cwd: dir }, ctx, regStub('github'))
    check(r1.selection && r1.selection.backendId === 'github', 'W2 内存绑定胜文件', JSON.stringify(r1.selection).slice(0, 200))
    const r2 = await detMod.detectExplicit({ cwd: dir }, ctx, regStub(undefined))
    check(r2.selection && r2.selection.backendId === 'markdown', 'W2 文件胜主锚', JSON.stringify(r2.selection).slice(0, 200))
    const r3 = await detMod.detectExplicit({ cwd: dir }, ctx, { bound: () => undefined, has: () => false, describe: () => null })
    check(r3.selection === null, 'W2 未注册 id 的文件层跳过（锚也未注册）', JSON.stringify(r3.selection))
  }

  // —— W3：工具顺序（内存 > H > 文件 > 自动识别；缺席口子兼容旧接线） ——
  const shellMod = await imp('src/shared/deck-tools/shell.js')
  const budget = await imp('src/shared/refresh/budget.js')
  const ledgerMod = await imp('src/host/refresh/ledger.js')
  const gateMod = await imp('src/host/refresh/gate.js')
  const toolCost = await imp('src/shared/refresh/tool-cost.js')
  const sOf = (cwd) => ({ cwd: cwd, workspaceKey: 'k947', sessionId: 's947', source: 't', text: '' })
  const shellOf = (reg, extra) => shellMod.createDeckShell(Object.assign({ gate: makeGateLedger(gateMod, ledgerMod), registry: reg, budget: budget, estimate: toolCost.estimateToolCost, costInputFrom: toolCost.toolCostInputFrom, backendCtx: {} }, extra || {}))
  const regOf = (boundId, matchedId) => ({
    bound: () => boundId,
    has: (id) => id === 'github' || id === 'markdown',
    describe: (h, id) => ({ backend: id, refId: 'o/n', name: id, url: '' }),
    select: async () => ({ backendId: matchedId, source: 'matches', ref: null }),
  })
  {
    const exec = { agent: { session: { id: 's', cwd: 'D:\\ws' } } }
    const p1 = await shellOf(regOf('markdown', 'github')).pickBackend(exec, sOf('D:\\ws'))
    check(p1.ok && p1.backendId === 'markdown' && p1.source === 'explicit', 'W3 内存胜一切', JSON.stringify(p1).slice(0, 200))
    const p2 = await shellOf(regOf(undefined, 'github'), { readChoice: async () => ({ backendId: 'markdown', rev: 3 }), parseWorkspaceFile }).pickBackend(exec, sOf('D:\\ws'))
    check(p2.ok && p2.backendId === 'markdown', 'W3 H 胜文件与自动识别', JSON.stringify(p2).slice(0, 200))
    const p3 = await shellOf(regOf(undefined, 'github'), { readChoice: async () => null, readWorkspaceFileText: async () => JSON.stringify({ version: 1, backendId: 'markdown', pickedAt: 9, source: 'user' }), parseWorkspaceFile }).pickBackend(exec, sOf('D:\\ws'))
    check(p3.ok && p3.backendId === 'markdown', 'W3 文件胜自动识别', JSON.stringify(p3).slice(0, 200))
    const p4 = await shellOf(regOf(undefined, 'github'), { readChoice: async () => ({ backendId: 'nope', rev: 1 }), readWorkspaceFileText: async () => JSON.stringify({ version: 1, backendId: 'alsono', pickedAt: 9, source: 'user' }), parseWorkspaceFile }).pickBackend(exec, sOf('D:\\ws'))
    check(p4.ok && p4.backendId === 'github', 'W3 未知 id 的层跳过', JSON.stringify(p4).slice(0, 200))
    const p5 = await shellOf(regOf(undefined, 'github')).pickBackend(exec, sOf('D:\\ws'))
    check(p5.ok && p5.backendId === 'github', 'W3 口子缺席照旧走自动识别', JSON.stringify(p5).slice(0, 200))
  }

  // —— W4：落盘形状（四项齐全，无路径无令牌，可往返） ——
  {
    const txt = stringifyWorkspaceFile({ backendId: 'markdown', pickedAt: 123 })
    const back = parseWorkspaceFile(txt)
    check(back && back.backendId === 'markdown' && back.pickedAt === 123, 'W4 拼装可往返')
    check(txt.indexOf(':\\') === -1 && txt.indexOf('token') === -1, 'W4 无路径无令牌字样')
  }

  console.log(failed ? ('\nFAIL（' + total + ' 条）') : ('\n全部通过（' + total + ' 条）'))
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error('FATAL ' + String((e && e.message) || e)); process.exit(1) })
