// tests/verify-957-workspace-writer.ts —— 工作区文件写器门禁（957 规格验收）
// 用法：在插件根目录执行 node --import ./scripts/ts-hook.mts tests/verify-957-workspace-writer.ts，可独立运行。
//
// 盯一块（写器，不含读链；读链见 verify-947-workspace-file.js）：
//   B 首绑落盘：人选 backendId 落盘（来源 user），显式无后端不写，文件已在不覆盖，写失败不回滚绑定但如实回。
const path = require('path')
const fs = require('fs')
const os = require('os')
const { pathToFileURL } = require('url')

const ROOT: string = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok: boolean, msg: string, detail?: unknown): void => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg + (ok ? '' : (detail ? ' — ' + String(detail).slice(0, 300) : ''))); if (!ok) failed = true }
const imp = (rel: string): Promise<any> => import(pathToFileURL(path.join(ROOT, rel)).href)

function makeTemp(): string { return fs.mkdtempSync(path.join(os.tmpdir(), 'wf957-')) }
function posix(p: unknown): string { return String(p || '').replace(/\\/g, '/') }

function platformFor(dir: string, opts?: any) {
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
  console.log('工作区文件写器门禁（957：首绑落盘）')
  const wfMod = await imp('src/deck/shell/workspace-anchor.ts')
  const { parseWorkspaceFile } = wfMod

  // —— B：首绑落盘（经宿主 wf.bind） ——
  const { createWorkspaceCwd } = await imp('src/host/workspaceCwd.js')
  const mkBind = (dir, extra) => createWorkspaceCwd(Object.assign({
    ctx: { get: (k) => undefined },
    DEFAULT_CWD: dir,
    getPlatform: async () => platformFor(dir, extra),
    getTrackerRegistry: async () => ({ has: (id) => id === 'github' || id === 'markdown', get: () => null, describe: (h, id) => ({ backend: id, refId: '', name: id, url: '' }) }),
    getWorkspaceStore: async () => ({ invalidate: () => {} }),
    getChoiceStore: async () => ({ rememberWorkspace: async () => ({ ok: true, rev: 1 }) }),
    canonicalKey: async (c) => c, setCache: () => {}, timer: { timeout: () => null }, detectionExec: async () => ({}), logCtx: null,
  }, extra && extra.deps || {}))

  {
    const dir = makeTemp()
    const api = mkBind(dir)
    const r = await api.handleBind({ cwd: dir, backendId: 'github' })
    check(r.ok === true && r.backendId === 'github', 'B1 首绑成功回包不变（绑定本身不受写器影响）')
    const fp = path.join(dir, 'docs', 'agents', 'workspace.yaml')
    let body = '';
    try { body = fs.readFileSync(fp, 'utf8') } catch (e) { body = '' }
    check(body.includes('backendId: github') && body.includes('source: user') && body.includes('version: 2'), 'B1 首绑落盘（人选，来源 user，新格式 YAML 版本 2）', body.slice(0, 200))
    check(r.workspaceFile && r.workspaceFile.ok === true && r.workspaceFile.placed === true, 'B1 回包如实带上落盘结果（placed:true）', JSON.stringify(r.workspaceFile))
  }
  {
    const dir = makeTemp()
    fs.mkdirSync(path.join(dir, 'docs', 'agents'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'docs', 'agents', 'workspace.yaml'), JSON.stringify({ version: 1, backendId: 'markdown', pickedAt: 7, source: 'user' }))
    const api = mkBind(dir)
    const r = await api.handleBind({ cwd: dir, backendId: 'github' })
    const body = fs.readFileSync(path.join(dir, 'docs', 'agents', 'workspace.yaml'), 'utf8')
    // #1003 唯一真源：用户明确选择时必须能覆盖文件（旧“文件已在就不覆盖”已废）。
    check(body.includes('backendId: github'), 'B2 文件已在时用户新选覆盖（唯一真源可改写）', body.slice(0, 200))
    check(r.ok === true && r.backendId === 'github' && r.workspaceFile && r.workspaceFile.placed === true && r.workspaceFile.reason === 'overwritten', 'B2 回包说明已覆盖（placed:true, overwritten），绑定是这次选的 github', JSON.stringify(r.workspaceFile))
  }
  {
    // #1138：工作区文件里只能写一个后端名（backendId 强制非空，见 src/shared/config-store/src/workspace.ts），
    //   所以「明确不要后端」这条状态今天没有地方可以记下来 —— 那就如实回失败，不许回一句 ok 却什么都没写
    //   （那会变成「界面说选好了、其实哪份记录里都没有」）。这条状态今天也没有活着的界面入口：
    //   那颗「清除后端选择」在 #669 第 6 件已退役（见 src/client/kernel/store-switch.js）。
    const dir = makeTemp()
    const api = mkBind(dir)
    const r = await api.handleBind({ cwd: dir, backendId: null })
    check(r.ok === false && r.kind === 'no-record-for-none', 'B3 明确不要后端：没有地方记这条选择，如实回失败', JSON.stringify(r).slice(0, 200))
    check(!fs.existsSync(path.join(dir, 'docs', 'agents', 'workspace.yaml')), 'B3 明确不要后端不写文件')
    check(typeof r.error === 'string' && /没有地方可以记下来/.test(r.error), 'B3 失败回包用一句人话讲清为什么，并给出下一步', String(r.error))
  }
  {
    // #1138 的核心改口径：**写成功才算这次选择生效**。以前这里同时写进程内绑定、本机记忆与工作区文件三处，
    //   顶层 ok 却恒为真 —— 文件写失败照样回 ok，界面显示「已切换」，重启后又变回原来的后端。
    const dir = makeTemp()
    let hCalls = 0
    const api = mkBind(dir, { failWrite: true, deps: { getChoiceStore: async () => ({ rememberWorkspace: async () => { hCalls += 1; return { ok: true, rev: 1 } } }) } })
    const r = await api.handleBind({ cwd: dir, backendId: 'github' })
    check(r.ok === false && r.kind === 'workspace-file-failed', 'B4 写不进文件就是没生效：顶层如实回失败（不再回 ok）', JSON.stringify({ ok: r.ok, kind: r.kind }))
    check(!fs.existsSync(path.join(dir, 'docs', 'agents', 'workspace.yaml')), 'B4 确实没写下文件')
    check(hCalls === 0, 'B4 写失败时不落本机记忆：那份备份只跟着已经生效的选择走', String(hCalls))
    check(typeof r.error === 'string' && /没能把选择写进这个工作区里的配置文件/.test(r.error) && !/绑定/.test(r.error), 'B4 失败文案说清「没写进去、这次选择没有生效」，不再说「绑定与本机记忆不受影响」', String(r.error))
    check(typeof r.errorKind === 'string' && r.errorKind.length > 0, 'B4 回包带上失败原因分类（供排查与日志）', String(r.errorKind))
  }

  // —— P：双命中保护写口已退役（#1147 决策 10b） ——
  //   装配层不再提供 protectDoubleHit（`createDoubleHitProtector` 已删），壳也不再读它：
  //   多命中一律由调用方诚实拒绝并引导去面板选一次。下面 S1 守的就是这一条。
  //   （这里原来有 P1–P6 直验那个空函数，空函数删掉后这些断言无物可验，一并退役。）

  // —— S：工具壳多命中诚实拒绝（不依赖任何保护写口） ——
  {
    const shellMod = await imp('src/deck/shell/call-shell.ts')
    const budget = await imp('src/shared/refresh/budget.js')
    const ledgerMod = await imp('src/host/refresh/ledger.ts')
    const gateMod = await imp('src/host/refresh/gate.ts')
    const toolCost = await imp('src/shared/refresh/tool-cost.js')
    const decMod957 = await imp('src/tracker/detection/backendDecision.ts')
    const ledger = ledgerMod.createLedger({ now: () => 1700000000000 })
    const gate = gateMod.createGate({ ledger: ledger, logCtx: null, now: () => 1700000000000 })
    ledger.syncServer({ rest: { limit: 5000, remaining: 5000, reset: 1700003600000 }, graphql: { limit: 5000, remaining: 5000, reset: 1700003600000 } }, 1700000000000)
    const sOf = (cwd) => ({ cwd: cwd, workspaceKey: 'k957', sessionId: 's957', source: 't', text: '' })
    const mkShell = (reg, extra) => shellMod.createDeckShell(Object.assign({ gate: gate, registry: reg, budget: budget, estimate: toolCost.estimateToolCost, costInputFrom: toolCost.toolCostInputFrom, backendCtx: {}, decideBackend: decMod957.decideBackend }, extra || {}))
    const doubleReg = { bound: () => undefined, has: (id) => id === 'github' || id === 'markdown', describe: (h, id) => ({ backend: id, refId: 'o/n', name: id, url: '' }), select: async () => ({ backendId: 'github', source: 'matches', ref: null, multiHit: ['github', 'markdown'] }) }
    const exec = { agent: { session: { id: 's', cwd: 'D:\\ws' } } }
    const pNoProt = await mkShell(doubleReg).pickBackend(exec, sOf('D:\\ws'))
    check(pNoProt.ok === false, 'S1 多命中无保护写口可接：照旧诚实报错', JSON.stringify(pNoProt).slice(0, 160))
    // #1147 决策 10b：装配层不再提供 protectDoubleHit，壳也不读它。即使有人误传这一格，
    //   也必须当作未知键忽略，多命中照旧诚实拒绝（不能复活任何自动写）。
    const pProt = await mkShell(doubleReg, { protectDoubleHit: async () => ({ backendId: 'github', source: 'auto', ref: null, pending: false }) }).pickBackend(exec, sOf('D:\\ws'))
    check(pProt.ok === false, 'S2 误传的保护写口被忽略，多命中照旧诚实报错', JSON.stringify(pProt).slice(0, 160))
  }

  console.log(failed ? ('\nFAIL（' + total + ' 条）') : ('\n全部通过（' + total + ' 条）'))
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error('FATAL ' + String((e && e.message) || e)); process.exit(1) })
