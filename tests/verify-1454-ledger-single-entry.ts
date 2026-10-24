// tests/verify-1454-ledger-single-entry.ts —— 门禁：账本只有操作管线 account 一条写入口（#1454）
// 用法：在插件根目录执行 node --import ./scripts/ts-hook.mts tests/verify-1454-ledger-single-entry.ts，可独立运行。
//
// 为什么要有这一扇：#1446 把账本按「后端 + 桶」分键之后，写账的地方却还有两处——刷新闸
// （src/refresh/rooms/host/refresh-gate.ts）自己写一本，deck 工具桥（src/refresh/registry/deck-tool-bridge.ts）
// 的 account 是空函数。于是同一笔用量可能记两处，也可能一处都不记。本门禁钉住三件事：
//   ① 静态：全仓 src 里 `ledger.spend(` 只出现一处，就在 src/refresh/kernel/backend-accounting.ts；
//      闸、会话入口、桥里都不许再写账。桥的 account 也不再是空函数。
//   ② 行为：唯一的写入口 createAccountPort 在四种预算口径下的金额与桶，与 #1446 的口径一致
//      （双桶按请求 / 点数分桶、只计请求只记条数、未知只记请求、离网一笔不记）；
//      后端还没建桶时，第一次记账会按这次的口径补建桶，不许静默丢账。
//   ③ 行为：deck 工具那条路真记 'ai-tool' 档，刷新后台那条路真记 'plugin' 档，两档各记各的。
//
// 本门禁按 tests/ 目录的自动扫描规则登记进 tests/gate-map.json（verify-* 都会被收进归属表）；
// 它只做静态扫描与纯函数 / 会话装配层的行为断言，不连远端、不起进程。
const path = require('path')
const fs = require('node:fs')
const { pathToFileURL } = require('url')

const ROOT: string = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok: boolean, msg: string): void => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const show = (v: any): string => JSON.stringify(v)

/** 去掉注释再扫：注释里写 `ledger.spend(...)` 不该被当成一处写入。 */
function stripComments(text: string): string {
  return String(text).replace(/\/\*[\s\S]*?\*\//g, '').split(/\r?\n/).map(function (l: string) { const i = l.indexOf('//'); return i >= 0 ? l.slice(0, i) : l }).join('\n')
}
function listTs(dir: string): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue
    const abs = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push.apply(out, listTs(abs));
    else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) out.push(abs)
  }
  return out
}
function relOf(abs: string): string { return path.relative(ROOT, abs).replace(/\\/g, '/') }
function codeOf(rel: string): string { return stripComments(fs.readFileSync(path.join(ROOT, rel), 'utf8')) }

async function main() {
  console.log('账本单入口门禁（#1454：写账只剩 createAccountPort 一处，两条路真记账）')

  // ---------- ① 静态：写入口只一处 ----------
  const allTs = listTs(path.join(ROOT, 'src'))
  const writers: { file: string; count: number }[] = []
  for (const abs of allTs) {
    const n = (codeOf(relOf(abs)).match(/ledger\.spend\s*\(/g) || []).length
    if (n > 0) writers.push({ file: relOf(abs), count: n })
  }
  check(writers.length === 1 && writers[0].file === 'src/refresh/kernel/backend-accounting.ts',
    '全仓 src 里调 ledger.spend 的只有 backend-accounting.ts 一个文件（实得：' + show(writers) + '）')
  check(writers.length === 1 && writers[0].count === 1, '而且只有一处（一处写入 = 一条写入口，实得 ' + (writers[0] ? writers[0].count : 0) + ' 处）')

  const gateSrc = codeOf('src/refresh/rooms/host/refresh-gate.ts')
  check(gateSrc.indexOf('.spend(') < 0 && gateSrc.indexOf('ACCOUNT_OF_CATEGORY') < 0,
    '闸不再写账本（refresh-gate 里没有 .spend( 与类别→档位表）')
  check(gateSrc.indexOf('stats.accounted') >= 0, '闸仍把实测条数记进自己的对账累计 stats.accounted（只对账，不写账本）')

  const openerSrc = codeOf('src/refresh/rooms/host/session-opener.ts')
  check(openerSrc.indexOf('ledger.spend') < 0 && openerSrc.indexOf('createAccountPort') >= 0,
    '刷新后台经 createAccountPort 记账，自己不再直调 ledger.spend')

  const bridgeSrc = codeOf('src/refresh/registry/deck-tool-bridge.ts')
  check(bridgeSrc.indexOf('createAccountPort') >= 0 && bridgeSrc.indexOf('accountPort(input') >= 0,
    'deck 工具桥的 account 落到 createAccountPort，不再是空函数')
  check(bridgeSrc.indexOf('各操作真实用量 1443 才进账本') < 0, '桥里那句「记账等 1443」的占位注释已删')

  // ---------- ② 行为：四种口径的金额与桶 ----------
  const accountMod = await import(pathToFileURL(path.join(ROOT, 'src', 'refresh', 'kernel', 'backend-accounting.ts')).href)
  const ledgerMod = await import(pathToFileURL(path.join(ROOT, 'src', 'refresh', 'rooms', 'host', 'quota-ledger.ts')).href)
  const bridgeMod = await import(pathToFileURL(path.join(ROOT, 'src', 'refresh', 'registry', 'deck-tool-bridge.ts')).href)
  const openerMod = await import(pathToFileURL(path.join(ROOT, 'src', 'refresh', 'rooms', 'host', 'session-opener.ts')).href)

  const clock = 1700000000000
  const newLedger = (): any => ledgerMod.createLedger({ now: () => clock })
  const TWO = { kind: 'two-buckets', countsRequests: true, countsPoints: true, independentBuckets: true }
  const REQUESTS = { kind: 'requests-only', countsRequests: true, countsPoints: false, independentBuckets: false }
  const UNKNOWN = { kind: 'unknown', countsRequests: true, countsPoints: false, independentBuckets: false }
  const OFF = { kind: 'off-network', countsRequests: false, countsPoints: false, independentBuckets: false }
  const usage = (requests: number, points: number): any => ({ ok: true, usage: { requests: requests, points: points }, data: {} })

  {
    // 双桶：请求进 rest，点数进 graphql；账本上还没有这个后端，第一次记账要自己把桶补出来。
    const l = newLedger()
    const port = accountMod.createAccountPort({ ledger: l, account: 'ai-tool' })
    await port({ op: 'list', budget: TWO, result: usage(5, 3), backendId: 'github' })
    check(l.bucketsOf('github').join(',') === 'rest,graphql', '首笔记账补建双桶（实得 ' + l.bucketsOf('github').join(',') + '）')
    check(l.hour('ai-tool', 'github/rest').requests === 5,
      '双桶口径：5 条请求记进 github/rest（' + show(l.hour('ai-tool', 'github/rest')) + '）')
    check(l.hour('ai-tool', 'github/graphql').points === 3,
      '双桶口径：3 点记进 github/graphql（' + show(l.hour('ai-tool', 'github/graphql')) + '）')
    check(l.snapshot().total.requests === 5 && l.snapshot().total.points === 3,
      '总账与桶一致（' + show(l.snapshot().total) + '）')
    check(l.snapshot().byAccount['ai-tool'].hour.requests === 5 && l.snapshot().byAccount['ai-tool'].hour.points === 3,
      '这笔记在 ai-tool 档（' + show(l.snapshot().byAccount['ai-tool'].hour) + '）')
    check(l.snapshot().byAccount['plugin'].hour.requests === 0 && l.snapshot().byAccount['plugin'].hour.points === 0,
      '没有顺手记到 plugin 档（两档分开记）')
  }

  {
    // 只计请求：点数不进账，只记请求数。
    const l = newLedger()
    await accountMod.createAccountPort({ ledger: l, account: 'ai-tool' })({ op: 'list', budget: REQUESTS, result: usage(4, 9), backendId: 'gitlab' })
    check(l.bucketsOf('gitlab').join(',') === 'requests', '只计请求的后端只建 requests 一桶（实得 ' + l.bucketsOf('gitlab').join(',') + '）')
    check(l.hour('ai-tool', 'gitlab/requests').requests === 4 && l.snapshot().total.points === 0,
      '只计请求口径：4 条入账、9 点不记（' + show(l.hour('ai-tool', 'gitlab/requests')) + '，total.points=' + l.snapshot().total.points + '）')
  }

  {
    // 未知口径：只记请求数，落在 requests 桶；点数不记。
    const l = newLedger()
    await accountMod.createAccountPort({ ledger: l, account: 'ai-tool' })({ op: 'list', budget: UNKNOWN, result: usage(2, 7), backendId: 'bitbucket' })
    check(l.bucketsOf('bitbucket').join(',') === 'requests' && l.hour('ai-tool', 'bitbucket/requests').requests === 2 && l.snapshot().total.points === 0,
      '未知口径：只记 2 条请求到 requests 桶，点数不记（' + show(l.snapshot().total) + '）')
  }

  {
    // 离网：一笔都不记，也不建桶。
    const l = newLedger()
    await accountMod.createAccountPort({ ledger: l, account: 'ai-tool' })({ op: 'list', budget: OFF, result: usage(5, 5), backendId: 'markdown' })
    check(l.bucketsOf('markdown').length === 0 && l.snapshot().total.requests === 0 && l.snapshot().total.points === 0,
      '离网口径：不建桶、一笔不记（' + show(l.snapshot().total) + '）')
    // 没有后端编号 / 失败信封 / 读操作没自报数：都不记，也不编一格账。
    await accountMod.createAccountPort({ ledger: l, account: 'ai-tool' })({ op: 'list', budget: TWO, result: usage(1, 1) })
    await accountMod.createAccountPort({ ledger: l, account: 'ai-tool' })({ op: 'list', budget: TWO, result: { ok: false, usage: { requests: 1, points: 1 } }, backendId: 'github' })
    check(l.snapshot().total.requests === 0 && l.snapshot().total.points === 0 && l.bucketsOf('github').length === 0,
      '没有后端编号、或失败信封：不记账也不建桶（' + show(l.snapshot().total) + '）')
  }

  // ---------- ③ deck 工具路径：真记 ai-tool 档 ----------
  {
    const l = newLedger()
    const ports = bridgeMod.buildTrackerPorts({ ledger: l })
    await ports.account({ op: 'list', budget: TWO, result: usage(2, 1), backendId: 'github' })
    check(l.hour('ai-tool', 'github/rest').requests === 2 && l.hour('ai-tool', 'github/graphql').points === 1,
      'deck 工具路径的用量真进账本，记 ai-tool 档（' + show(l.snapshot().byAccount['ai-tool'].hour) + '）')
    check(l.bucketsOf('github').join(',') === 'rest,graphql', 'deck 路径首笔记账也补建桶（实得 ' + l.bucketsOf('github').join(',') + '）')
  }

  // ---------- ④ 刷新后台路径：真记 plugin 档 ----------
  {
    const l = newLedger()
    const room = {
      list: async (): Promise<any> => ({ ok: true, usage: { requests: 3, points: 2 }, data: { items: [] } }),
    }
    const registry = {
      select: async (): Promise<any> => ({ backendId: 'github', source: 'explicit', canWrite: true, reason: '门禁夹具', ref: { backend: 'github', refId: 'acme/repo', name: 'acme/repo', url: 'https://github.com/acme/repo' } }),
      get: (id: string): any => (id === 'github' ? room : undefined),
      modules: (): any[] => [{ id: 'github', budget: TWO }],
    }
    const opener = openerMod.createSessionOpener({ getTrackerRegistry: async () => registry, ledger: l, backendCtx: () => ({}) })
    const opened = await opener('D:/tmp/wt-1454')
    check(opened.ok === true, '刷新后台能开会话（' + show(opened.ok ? opened.backendId : opened.reason) + '）')
    const result: any = await opened.call((s: any) => s.list())
    check(result && result.ok === true, '经管线调一次房间操作（回执 ok=' + show(result && result.ok) + '）')
    check(l.hour('plugin', 'github/rest').requests === 3 && l.hour('plugin', 'github/graphql').points === 2,
      '刷新后台路径的用量真进账本，记 plugin 档（' + show(l.snapshot().byAccount['plugin'].hour) + '）')
    check(l.snapshot().byAccount['ai-tool'].hour.requests === 0,
      '刷新后台这笔没有记到 ai-tool 档（' + show(l.snapshot().byAccount['ai-tool'].hour) + '）')
  }

  console.log(failed ? ('\n' + total + ' 条断言，失败') : ('\n' + total + ' 条断言，全部通过')); process.exit(failed ? 1 : 0)
}

main().catch(function (e: any) { console.log('  FAIL 门禁抛错：' + String((e && e.message) || e)); process.exit(1) })
