// tests/verify-957-workspace-writer.js —— 工作区文件写器门禁（957 规格验收）
// 用法：在插件根目录执行 node tests/verify-957-workspace-writer.js，可独立运行。
//
// 盯两块（写器，不含读链；读链见 verify-947-workspace-file.js）：
//   B 首绑落盘：人选 backendId 落盘（来源 user），显式无后端不写，文件已在不覆盖，写失败不回滚绑定但如实回。
//   P 双命中保护：无文件且双命中含 GitHub 时自动存一份（来源 auto）并照此走；单命中不写，无 GitHub 照旧报错，有待定不写，文件已在不覆盖，写失败诚实返回空。
const path = require('path')
const fs = require('fs')
const os = require('os')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg, detail) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg + (ok ? '' : (detail ? ' — ' + String(detail).slice(0, 300) : ''))); if (!ok) failed = true }
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href)

function makeTemp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'wf957-')) }
function posix(p) { return String(p || '').replace(/\\/g, '/') }

function platformFor(dir, opts) {
  opts = opts || {}
  const failWrite = !!opts.failWrite
  return {
    path: path.posix,
    fs: {
      async resolve(p, o) { const cwd = (o && o.cwd) || ''; const rel = String(p || '').replace(/\\/g, '/'); return cwd ? String(cwd).replace(/\\/g, '/') + '/' + rel : rel },
      async readText(t) { return fs.readFileSync(t, 'utf8') },
      async writeText(t, c) { if (failWrite) { const e = new Error('file access denied under read-only mode'); throw e } fs.mkdirSync(path.dirname(t), { recursive: true }); fs.writeFileSync(t, String(c), 'utf8') },
      async mkdir(d, o) { fs.mkdirSync(d, { recursive: true }) },
    },
  }
}

async function main() {
  console.log('工作区文件写器门禁（957：首绑落盘与双命中保护）')
  const wfMod = await imp('src/shared/deck-tools/workspace-file.js')
  const { parseWorkspaceFile } = wfMod

  // —— B：首绑落盘（经宿主 wf.bind） ——
  const { createWorkspaceCwd } = await imp('src/host/workspaceCwd.js')
  const mkBind = (dir, extra) => createWorkspaceCwd(Object.assign({
    ctx: { get: (k) => undefined },
    DEFAULT_CWD: dir,
    getPlatform: async () => platformFor(dir, extra),
    getTrackerRegistry: async () => ({ has: (id) => id === 'github' || id === 'markdown', bind: () => {}, get: () => null, describe: (h, id) => ({ backend: id, refId: '', name: id, url: '' }) }),
    getWorkspaceStore: async () => ({ invalidate: () => {} }),
    getChoiceStore: async () => ({ rememberWorkspace: async () => ({ ok: true, rev: 1 }) }),
    canonicalKey: async (c) => c, setCache: () => {}, timer: { timeout: () => null }, detectionExec: async () => ({}), logCtx: null,
  }, extra && extra.deps || {}))

  {
    const dir = makeTemp()
    const api = mkBind(dir)
    const r = await api.handleBind({ cwd: dir, backendId: 'github' })
    check(r.ok === true && r.backendId === 'github', 'B1 首绑成功回包不变（绑定本身不受写器影响）')
    const fp = path.join(dir, 'docs', 'agents', 'workspace.json')
    let obj = null
    try { obj = JSON.parse(fs.readFileSync(fp, 'utf8')) } catch (e) { obj = null }
    check(obj && obj.backendId === 'github' && obj.source === 'user' && obj.version === 1 && typeof obj.pickedAt === 'number', 'B1 首绑落盘（人选，来源 user，四项齐全）', JSON.stringify(obj))
    check(r.workspaceFile && r.workspaceFile.ok === true && r.workspaceFile.placed === true, 'B1 回包如实带上落盘结果（placed:true）', JSON.stringify(r.workspaceFile))
  }
  {
    const dir = makeTemp()
    fs.mkdirSync(path.join(dir, 'docs', 'agents'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'docs', 'agents', 'workspace.json'), JSON.stringify({ version: 1, backendId: 'markdown', pickedAt: 7, source: 'user' }))
    const api = mkBind(dir)
    const r = await api.handleBind({ cwd: dir, backendId: 'github' })
    const obj = JSON.parse(fs.readFileSync(path.join(dir, 'docs', 'agents', 'workspace.json'), 'utf8'))
    check(obj.backendId === 'markdown', 'B2 文件已在不覆盖（工作区默认值保持第一次那个）', JSON.stringify(obj))
    check(r.ok === true && r.backendId === 'github' && r.workspaceFile && r.workspaceFile.placed === false, 'B2 回包说明没覆盖（placed:false），绑定仍是这次选的 github', JSON.stringify(r.workspaceFile))
  }
  {
    const dir = makeTemp()
    const api = mkBind(dir)
    const r = await api.handleBind({ cwd: dir, backendId: null })
    check(r.ok === true && r.backendId === null, 'B3 显式无后端绑定照旧成功')
    check(!fs.existsSync(path.join(dir, 'docs', 'agents', 'workspace.json')), 'B3 显式无后端不持久化（不写文件）')
    check(r.workspaceFile && r.workspaceFile.skipped === 'explicit-none', 'B3 回包说明跳过原因', JSON.stringify(r.workspaceFile))
  }
  {
    const dir = makeTemp()
    const api = mkBind(dir, { failWrite: true })
    const r = await api.handleBind({ cwd: dir, backendId: 'github' })
    check(r.ok === true && r.backendId === 'github' && r.persisted === true, 'B4 写失败不回滚绑定与本机记忆（照旧成功）', JSON.stringify({ ok: r.ok, persisted: r.persisted }))
    check(r.workspaceFile && r.workspaceFile.ok === false, 'B4 回包如实带上写失败（不无声）', JSON.stringify(r.workspaceFile))
  }

  // —— P：双命中保护（经装配口的写口直验逻辑） ——
  const { createDoubleHitProtector } = await imp('src/host/platform/deckToolsAssembly.js')
  const mkProt = (dir, extra) => {
    const plat = platformFor(dir, extra)
    return createDoubleHitProtector({
      readWorkspaceFileText: async (rootCwd) => { try { return fs.readFileSync(path.join(String(rootCwd), 'docs', 'agents', 'workspace.json'), 'utf8') } catch (e) { return null } },
      parseWorkspaceFile: parseWorkspaceFile,
      backendCtx: () => ({ platform: plat, fs: plat.fs }),
      sandboxPolicyFor: async () => ({ POLICY: 1 }),
    })
  }
  {
    const dir = makeTemp()
    const prot = mkProt(dir)
    const out = await prot(posix(dir), 's1', { backendId: 'github', source: 'matches', multiHit: ['github', 'markdown'] })
    check(out && out.backendId === 'github', 'P1 无文件双命中含 GitHub 时照此走（github）')
    check(out && out.source === 'auto', 'P1 回包来源如实为自动（不是人选，回包与落盘一致）', JSON.stringify(out))
    const obj = JSON.parse(fs.readFileSync(path.join(dir, 'docs', 'agents', 'workspace.json'), 'utf8'))
    check(obj.backendId === 'github' && obj.source === 'auto', 'P1 自动存的标记为自动（不是人选，如实）', JSON.stringify(obj))
  }
  {
    const dir = makeTemp()
    const prot = mkProt(dir)
    const out = await prot(posix(dir), 's1', { backendId: 'markdown', source: 'matches', multiHit: undefined })
    check(out === null, 'P2 单命中不写（免得每个仓库都脏一次）')
    check(!fs.existsSync(path.join(dir, 'docs', 'agents', 'workspace.json')), 'P2 单命中确实没写文件')
  }
  {
    const dir = makeTemp()
    const prot = mkProt(dir)
    const out = await prot(posix(dir), 's1', { backendId: 'markdown', source: 'matches', multiHit: ['markdown', 'gitlab'] })
    check(out === null, 'P3 双命中里没有 GitHub 时仍返回空（调用方诚实报错）')
    check(!fs.existsSync(path.join(dir, 'docs', 'agents', 'workspace.json')), 'P3 没写文件')
  }
  {
    const dir = makeTemp()
    const prot = mkProt(dir)
    const out = await prot(posix(dir), 's1', { backendId: 'github', source: 'matches', multiHit: ['github', 'markdown'], pending: true })
    check(out === null, 'P4 有待定时不写（仲裁未完成，诚实等待）')
  }
  {
    const dir = makeTemp()
    fs.mkdirSync(path.join(dir, 'docs', 'agents'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'docs', 'agents', 'workspace.json'), JSON.stringify({ version: 1, backendId: 'markdown', pickedAt: 7, source: 'user' }))
    const prot = mkProt(dir)
    const out = await prot(posix(dir), 's1', { backendId: 'github', source: 'matches', multiHit: ['github', 'markdown'] })
    check(out === null, 'P5 文件已在不覆盖（保护不顶掉已有默认值）')
    const obj = JSON.parse(fs.readFileSync(path.join(dir, 'docs', 'agents', 'workspace.json'), 'utf8'))
    check(obj.backendId === 'markdown', 'P5 文件内容不动', JSON.stringify(obj))
  }
  {
    const dir = makeTemp()
    const prot = mkProt(dir, { failWrite: true })
    const out = await prot(posix(dir), 's1', { backendId: 'github', source: 'matches', multiHit: ['github', 'markdown'] })
    check(out === null, 'P6 写失败返回空（调用方诚实报错，不静默放行）')
  }

  // —— S：工具壳接上保护写口（缺席跳过，有就照此走） ——
  {
    const shellMod = await imp('src/shared/deck-tools/shell.js')
    const budget = await imp('src/shared/refresh/budget.js')
    const ledgerMod = await imp('src/host/refresh/ledger.js')
    const gateMod = await imp('src/host/refresh/gate.js')
    const toolCost = await imp('src/shared/refresh/tool-cost.js')
    const ledger = ledgerMod.createLedger({ now: () => 1700000000000 })
    const gate = gateMod.createGate({ ledger: ledger, logCtx: null, now: () => 1700000000000 })
    ledger.syncServer({ rest: { limit: 5000, remaining: 5000, reset: 1700003600000 }, graphql: { limit: 5000, remaining: 5000, reset: 1700003600000 } }, 1700000000000)
    const sOf = (cwd) => ({ cwd: cwd, workspaceKey: 'k957', sessionId: 's957', source: 't', text: '' })
    const mkShell = (reg, extra) => shellMod.createDeckShell(Object.assign({ gate: gate, registry: reg, budget: budget, estimate: toolCost.estimateToolCost, costInputFrom: toolCost.toolCostInputFrom, backendCtx: {} }, extra || {}))
    const doubleReg = { bound: () => undefined, has: (id) => id === 'github' || id === 'markdown', describe: (h, id) => ({ backend: id, refId: 'o/n', name: id, url: '' }), select: async () => ({ backendId: 'github', source: 'matches', ref: null, multiHit: ['github', 'markdown'] }) }
    const exec = { agent: { session: { id: 's', cwd: 'D:\\ws' } } }
    const pNoProt = await mkShell(doubleReg).pickBackend(exec, sOf('D:\\ws'))
    check(pNoProt.ok === false, 'S1 保护缺席时双命中照旧诚实报错（旧接线兼容）', JSON.stringify(pNoProt).slice(0, 160))
    const pProt = await mkShell(doubleReg, { protectDoubleHit: async () => ({ backendId: 'github', source: 'auto', ref: null, pending: false }) }).pickBackend(exec, sOf('D:\\ws'))
    check(pProt.ok === true && pProt.backendId === 'github', 'S2 有保护写口时双命中照此走（github）', JSON.stringify(pProt).slice(0, 160))
  }

  console.log(failed ? ('\nFAIL（' + total + ' 条）') : ('\n全部通过（' + total + ' 条）'))
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error('FATAL ' + String((e && e.message) || e)); process.exit(1) })
