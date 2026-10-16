// tests/verify-947-workspace-file.js —— 工作区配置文件门禁（947 规格验收，#1012 切核后口径）
// 用法：在插件根目录执行 node tests/verify-947-workspace-file.js，可独立运行。
//
// 盯四件事（读链，不含写器；写器顺延 948）：
//   W1 解析只认人选：坏文本、错版本、空 id、非人选来源一律 null；
//      老 JSON（v1）照读（auto 来源照认）；新 YAML（v2）照读（布局缺席允许，auto 不认）；
//      高版本按 null 回（旧版本读不懂新字段，当没有这层）。
//   W2 探测顺序：内存绑定 > 工作区文件 > 主锚；未知 id 的层跳过。
//   W3 工具顺序：内存 > 文件 > 声明 > 自动识别；口子缺席照旧走自动识别。
//      本机记忆这一层自 2026-10-12（维护者拍板）起退出判定，夹具里给的 readChoice 不再作数，见下面 p2。
//   W4 落盘形状：版本 2 的 YAML，字段齐全（布局缺席整段省略），不带路径与令牌字样，拼装可往返。
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
  const wfMod = await imp('src/deck/shell/workspace-anchor.ts')
  const { parseWorkspaceFile, stringifyWorkspaceFile, WORKSPACE_FILE_REL, WORKSPACE_FILE_VERSION } = wfMod

  // —— W1：只认人选（v1 老 JSON 照读，v2 新 YAML 照读，高版本按 null 回） ——
  {
    check(parseWorkspaceFile(JSON.stringify({ version: 1, backendId: 'github', pickedAt: 7, source: 'user' })).backendId === 'github', 'W1 有效文件认出后端')
    check(parseWorkspaceFile('{oops') === null, 'W1 坏文本为 null')
    check(parseWorkspaceFile(JSON.stringify({ version: 2, backendId: 'github', pickedAt: 7, source: 'user', layout: 'multi' })).backendId === 'github', 'W1 版本 2 照认（YAML 新格式）')
    check(parseWorkspaceFile(JSON.stringify({ version: 2, backendId: 'github', pickedAt: 7, source: 'user' })).layout === undefined, 'W1 版本 2 缺布局照读（布局由写入口负责带上）')
    check(parseWorkspaceFile(JSON.stringify({ version: 2, backendId: 'github', pickedAt: 7, source: 'auto' })) === null, 'W1 版本 2 不认 auto（机器的猜不许钉成新文件）')
    check(parseWorkspaceFile(JSON.stringify({ version: 9, backendId: 'github', pickedAt: 7, source: 'user' })) === null, 'W1 高版本为 null（旧版本读不懂新字段，当没有这层）')
    check(parseWorkspaceFile(JSON.stringify({ version: 1, backendId: '', pickedAt: 7, source: 'user' })) === null, 'W1 空 id 为 null')
    check(parseWorkspaceFile(JSON.stringify({ version: 1, backendId: 'github', pickedAt: 7, source: '' })) === null, 'W1 空来源为 null')
    check(parseWorkspaceFile(JSON.stringify({ version: 1, backendId: 'github', source: 'user' })) === null, 'W1 缺档案时间为 null')
    check(parseWorkspaceFile(JSON.stringify({ version: 1, backendId: 'github', pickedAt: 7, source: 'auto' })).source === 'auto', 'W1 保护自动写来源照认（位序不变）')
    check(parseWorkspaceFile(JSON.stringify({ version: 1, backendId: 'github', pickedAt: 7, source: 'probe' })) === null, 'W1 未知来源为 null')
    check(parseWorkspaceFile('\uFEFF' + JSON.stringify({ version: 1, backendId: 'github', pickedAt: 7, source: 'user' })).backendId === 'github', 'W1 带 BOM 照认')
    check(WORKSPACE_FILE_REL === 'docs/agents/workspace.yaml' && WORKSPACE_FILE_VERSION === 2, 'W1 路径与版本钉住（新路径 YAML，版本 2）')
  }

  // —— W2：探测顺序（文件 > 锚） ——
  //   #1138 拿掉了原先排在最前面的那一级「注册表里的进程内绑定」：人选今天只有一份记录，就是工作区文件，
  //   所以探测从文件读起（见 src/tracker/detection/explicitDetector.ts 文件头那段说明）。
  const detMod = await imp('src/tracker/detection/explicitDetector.ts')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wf947-'))
  const anchorOf = (title) => '# Issue tracker: ' + title + '\n\nBody mentions gh issue.\n'
  const regStub = () => ({
    has: (id) => id === 'github' || id === 'markdown',
    describe: (h, id) => ({ backend: id, refId: (h && h.cwd) || '', name: id, url: '' }),
  })
  const platOf = (fss) => ({ path: path.posix, fs: fss })
  {
    const dir = path.join(tmp, 'a'); fs.mkdirSync(path.join(dir, 'docs', 'agents'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'docs', 'agents', 'issue-tracker.md'), anchorOf('GitHub'))
    fs.writeFileSync(path.join(dir, 'docs', 'agents', 'workspace.yaml'), JSON.stringify({ version: 1, backendId: 'markdown', pickedAt: 9, source: 'user' }))
    const fss = makeFs(); const ctx = { platform: platOf(fss), cwd: dir }
    const r2 = await detMod.detectExplicit({ cwd: dir }, ctx, regStub())
    check(r2.selection && r2.selection.backendId === 'markdown', 'W2 文件胜主锚', JSON.stringify(r2.selection).slice(0, 200))
    const r3 = await detMod.detectExplicit({ cwd: dir }, ctx, { has: () => false, describe: () => null })
    check(r3.selection === null, 'W2 未注册 id 的文件层跳过（锚也未注册）', JSON.stringify(r3.selection))
  }

  // —— W3：工具顺序（文件 > 自动识别；口子缺席照旧走自动识别） ——
  //   #1138 起「人亲手选过」只有一种凭据：工作区文件里的那条记录（见 src/host/workspaceCwd.js 的 wf.bind）。
  //   原先排在最前面的「注册表里的进程内绑定」已经整段删除，所以这里不再有「内存胜一切」那一条。
  const shellMod = await imp('src/deck/shell/call-shell.ts')
  const budget = await imp('src/shared/refresh/budget.js')
  const ledgerMod = await imp('src/host/refresh/ledger.ts')
  const gateMod = await imp('src/host/refresh/gate.ts')
  const toolCost = await imp('src/shared/refresh/tool-cost.js')
  const decMod947 = await imp('src/tracker/detection/backendDecision.ts')
  const sOf = (cwd) => ({ cwd: cwd, workspaceKey: 'k947', sessionId: 's947', source: 't', text: '' })
  const shellOf = (reg, extra) => shellMod.createDeckShell(Object.assign({ gate: makeGateLedger(gateMod, ledgerMod), registry: reg, budget: budget, estimate: toolCost.estimateToolCost, costInputFrom: toolCost.toolCostInputFrom, backendCtx: {}, decideBackend: decMod947.decideBackend }, extra || {}))
  const regOf = (matchedId) => ({
    has: (id) => id === 'github' || id === 'markdown',
    describe: (h, id) => ({ backend: id, refId: 'o/n', name: id, url: '' }),
    select: async () => ({ backendId: matchedId, source: 'matches', ref: null }),
  })
  {
    const exec = { agent: { session: { id: 's', cwd: 'D:\\ws' } } }
    const p2 = await shellOf(regOf('github'), { readChoice: async () => ({ backendId: 'markdown', rev: 3 }), parseWorkspaceFile }).pickBackend(exec, sOf('D:\\ws'))
    // 这条原本断言「本机记忆这一层胜文件与自动识别」。按 2026-10-12 维护者拍板的 #1003 契约，
    //   本机记忆已退出判定（出处见 src/tracker/detection/backendDecision.ts 那段中文说明：记忆只用来
    //   把工作区配置文件生成出来一次，此后不再拿它回答判定），所以这里给了 readChoice 也不再作数：
    //   结论落到自动识别的 github。2026-10-16 维护者拍板删掉了工具壳里那道「非亲手选过不放行」的门，
    //   自动识别来的结论照样放行。这条是可判别的：记忆层一旦回来，这里就会变回 ok + markdown，断言当场红。
    check(p2.ok === true && p2.backendId === 'github',
      'W3 本机记忆已退出判定（给了 readChoice 也不作数，结论落到自动识别的 github）——自动识别来的结论照旧放行', JSON.stringify(p2).slice(0, 200))
    const p3 = await shellOf(regOf('github'), { readChoice: async () => null, readWorkspaceFileText: async () => JSON.stringify({ version: 1, backendId: 'markdown', pickedAt: 9, source: 'user' }), parseWorkspaceFile }).pickBackend(exec, sOf('D:\\ws'))
    check(p3.ok && p3.backendId === 'markdown', 'W3 文件胜自动识别', JSON.stringify(p3).slice(0, 200))
    const p4 = await shellOf(regOf('github'), { readChoice: async () => ({ backendId: 'nope', rev: 1 }), readWorkspaceFileText: async () => JSON.stringify({ version: 1, backendId: 'alsono', pickedAt: 9, source: 'user' }), parseWorkspaceFile }).pickBackend(exec, sOf('D:\\ws'))
    // 这条原本断言「回 ok，后端是自动识别来的 github」。文件层里那个没注册的 id（alsono）被跳过，
    //   结论确实落到自动识别上（注册表里只有 github 认得这个工作区）；2026-10-16 起自动识别来的结论照样放行。
    check(p4.ok === true && p4.backendId === 'github',
      'W3 未知 id 的层跳过（结论落到自动识别的 github）——自动识别来的结论照旧放行', JSON.stringify(p4).slice(0, 200))
    const p5 = await shellOf(regOf('github')).pickBackend(exec, sOf('D:\\ws'))
    // 同一条口径：文件口子缺席时，自动识别照样被问到并答了 github，工具壳照样放行；
    //   对照见上面 p3：同一个夹具补上一份写着 markdown 的工作区文件之后，结论换成文件的 markdown。
    check(p5.ok === true && p5.backendId === 'github',
      'W3 口子缺席照旧走自动识别（自动识别被问到并答了 github）——自动识别来的结论照旧放行', JSON.stringify(p5).slice(0, 200))
  }

  // —— W4：落盘形状（版本 2 的 YAML，布局缺席整段省略，无路径无令牌，可往返） ——
  {
    const txt = stringifyWorkspaceFile({ backendId: 'markdown', pickedAt: 123 })
    const back = parseWorkspaceFile(txt)
    check(back && back.backendId === 'markdown' && back.pickedAt === 123, 'W4 拼装可往返')
    check(txt.indexOf('version: 2') >= 0 && txt.indexOf(':\\') === -1 && txt.indexOf('token') === -1, 'W4 写出版本 2 且无路径无令牌字样')
    const withLayout = stringifyWorkspaceFile({ backendId: 'github', pickedAt: 7, source: 'migrated', layout: 'multi' })
    const back2 = parseWorkspaceFile(withLayout)
    check(back2 && back2.layout === 'multi' && back2.source === 'migrated', 'W4 布局与迁移来源可往返')
  }

  console.log(failed ? ('\nFAIL（' + total + ' 条）') : ('\n全部通过（' + total + ' 条）'))
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error('FATAL ' + String((e && e.message) || e)); process.exit(1) })
