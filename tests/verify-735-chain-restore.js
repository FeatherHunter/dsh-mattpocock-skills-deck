#!/usr/bin/env node
/**
 * verify-735-chain-restore.js —— 门禁：处理链落盘后有人读回（票 #735）
 *
 * 守的是什么：会话↔票处理链的内存表按进程活，盘是跨进程的唯一副本。
 * `restore` 写好了但生产里没人调（#732 顺手抓到的真缺陷），重启即丢内存：
 * 盘里有旧数据，读数里永远看不见。修法只动接线一处（wiring.js 的 attach 与
 * syncAttention），本门禁钉住那两处调用，真跑一遍“记→重启→回来”。
 *
 * 它怎么判（四段）：
 *   一、静态：src 全树里 `.restore(` 只许出现在接线那一个文件（定义文件里只有
 *      `function restore(`，没有带点的调用）；且接线里必须有“按根过滤”形状——
 *      缺了就是没修（启动全量被 350 行上限否决：首见某根时读回已覆盖重启，
 *      见 #735 评论区的瘦身说明）。
 *   二、行为：真接线加真盘，记一笔 → 用同一目录建第二套接线并 focus 那个根
 *      （模拟重启后的新进程第一次切进工作区）→ 读数里必须有那一笔，
 *      且日志里有一行按根的 `kind:restore`。
 *   三、行为：切进工作区按根读回。内存清空后（模拟重启），focus 那个工作区根 →
 *      读数回来；同一个根 focus 两次，按根的 `restore` 日志只许有一行（一根只读一次，
 *      不给高频动作加磁盘读）。
 *   四、负控：裸链实例不调 `restore` 就是空（证明二、三不是恒绿的装饰）。
 *
 * 用法: node tests/verify-735-chain-restore.js（在插件根目录）
 * 退出码：0 = 通过；1 = 有违规。
 */
const fs = require('fs')
const path = require('path')
const os = require('os')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const url = (rel) => pathToFileURL(path.join(ROOT, rel)).href

let failed = false
let total = 0
const check = (ok, msg, detail) => {
  total += 1
  console.log((ok ? '  PASS ' : '  FAIL ') + msg + (ok || !detail ? '' : '\n         → ' + detail))
  if (!ok) failed = true
}

/** 等一个条件成立（轮询到为止，超时回空）：接线里的读回是 fire-and-forget，测试靠日志与读数同步，不靠睡固定时长。 */
async function waitFor(fn, timeoutMs) {
  const t0 = Date.now()
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() - t0 > (timeoutMs || 5000)) return null
    await new Promise((r) => setTimeout(r, 25))
  }
}

function listSrcJs() {
  const out = []
  const walk = (d) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, ent.name)
      if (ent.isDirectory()) walk(p)
      else if (ent.name.endsWith('.js')) out.push(path.relative(ROOT, p).split(path.sep).join('/'))
    }
  }
  walk(path.join(ROOT, 'src'))
  return out.sort()
}

/** 一套能跑起来的接线依赖：形状照宿主入口传进去的那一份抄，只把目录与日志换成测试的。 */
function makeDeps(dir, events) {
  return {
    ctx: { on: () => () => {}, get: () => undefined },
    logCtx: {
      isEnabled: () => true,
      fire: (level, event, fields) => { events.push({ level: level, event: event, fields: (typeof fields === 'function') ? fields() : fields }) },
    },
    canonicalKey: async (x) => String(x),
    getCacheDir: async () => dir,
    getTrackerRegistry: async () => ({ describe: () => ({ backend: 'github' }), modules: () => [] }),
    getDetectionService: async () => ({ detect: async () => ({ selection: { backendId: 'github' } }) }),
    getPlatform: async () => ({ os: 'win32', path: path }),
  }
}

function restoreLogs(events) {
  return events.filter((e) => e.event === 'sessionTickets.chain' && e.fields && e.fields.kind === 'restore')
}

async function main() {
  console.log('#735 处理链落盘读回门禁（按根读回 / 一根一次 / 负控）')

  // ── 一、静态：调用只许在接线一处，且按根形状在 ──
  console.log('\n== 一、restore 的调用只许在接线一处 ==')
  const wiringSrc = read('src/host/refresh/wiring.js')
  check(wiringSrc.indexOf('sessionTickets.restore({ rootKey:') >= 0,
    '接线在切进工作区时按根读回（sessionTickets.restore({ rootKey: … })）',
    '缺这一行 = 重启后内存永远是空的，盘只是摆设')
  const callers = listSrcJs().filter((rel) => read(rel).indexOf('.restore(') >= 0)
  check(callers.length === 1 && callers[0] === 'src/host/refresh/wiring.js',
    'src 全树带点的 .restore( 调用只许在接线文件（实得：' + (callers.join('、') || '无') + '）',
    '多一处就是第二条接线，读回时机就有了两个主人')

  const wiringMod = await import(url('src/host/refresh/wiring.js'))
  const chainMod = await import(url('src/shared/refresh/chain.js'))

  // ── 二、行为：重启后内存回来 ──
  console.log('\n== 二、重启后内存回来（两套接线共用一盘） ==')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't735-restore-'))
  const WS = 'd:\\ws\\735-home'
  const events1 = []
  const w1 = await wiringMod.makeRefreshLoader(makeDeps(dir, events1))()
  const noted = await w1.sessionTickets.note({
    sessionId: 'sess-735', rootHash: chainMod.chainRootHash(WS), backend: 'github',
    tool: 'pwsh', source: 'cli', tier: 'write-confirmed', reason: 'cmd.cli-write',
    verb: 'comment', ticketKey: '735', args: {},
  })
  check(!!noted && noted.recorded === true, '第一套接线记进一笔（735 comment）',
    '记不进去 = 后面“回来”无从谈起：' + JSON.stringify(noted))
  // 第二套接线 = 重启后的新进程：focus 那个根（生产里切进工作区的真路径），不许手工调 restore。
  const events2 = []
  const w2 = await wiringMod.makeRefreshLoader(makeDeps(dir, events2))()
  await w2.focus({ windowId: 'win-1', workspaceRoot: WS, kind: 'focus', visible: true })
  const back = await waitFor(() => {
    const r = w2.chainReadoutOf()
    return (r && r.ok === true && r.sessions.some((s) => s.entries.some((e) => e.ticketKey === '735'))) ? r : null
  })
  check(!!back, '第二套接线 focus 那个根之后读数里有那一笔（重启不丢）',
    '读数里没有 = 盘只是只写不读，修法没生效')
  const bootLogs = restoreLogs(events2)
  check(bootLogs.some((e) => e.fields && e.fields.ok === true),
    '读回留下一行 kind:restore 且 ok:true（' + bootLogs.length + ' 行）',
    '没有这行 = 读回没跑，或跑了但没成')
  try { w1.sessionTickets.drop(); w2.sessionTickets.drop() } catch (e) {}

  // ── 三、行为：按根读回，一根只读一次 ──
  console.log('\n== 三、切进工作区按根读回，一根只读一次 ==')
  const dir3 = fs.mkdtempSync(path.join(os.tmpdir(), 't735-perroot-'))
  const events3 = []
  const w3 = await wiringMod.makeRefreshLoader(makeDeps(dir3, events3))()
  const WS_A = 'd:\\ws\\735-a'
  const H_A = chainMod.chainRootHash(WS_A)
  await w3.sessionTickets.note({
    sessionId: 'sess-a', rootHash: H_A, backend: 'github',
    tool: 'pwsh', source: 'cli', tier: 'write-confirmed', reason: 'cmd.cli-write',
    verb: 'edit', ticketKey: '730', args: {},
  })
  w3.sessionTickets.drop() // 模拟重启：内存清空，盘留着
  const emptyNow = w3.chainReadoutOf()
  check(!!emptyNow && emptyNow.sessions.length === 0, '内存清空后读数是空的（模拟出重启现场）',
    '这一步不空 = 后面“回来”证明不了什么')
  await w3.focus({ windowId: 'win-1', workspaceRoot: WS_A, kind: 'focus', visible: true })
  const backA = await waitFor(() => {
    const r = w3.chainReadoutOf()
    return (r && r.sessions.some((s) => s.entries.some((e) => e.ticketKey === '730'))) ? r : null
  })
  check(!!backA, 'focus 那个工作区根之后读数回来（按根读回生效）',
    '没回来 = 切工作区那条读回没接上')
  const perRootBefore = restoreLogs(events3).filter((e) => e.fields && e.fields.rootHash === H_A).length
  await w3.focus({ windowId: 'win-1', workspaceRoot: WS_A, kind: 'focus', visible: true })
  await new Promise((r) => setTimeout(r, 300)) // 第二次 focus 若违规会再读一次，留 300ms 让它漏出来
  const perRootAfter = restoreLogs(events3).filter((e) => e.fields && e.fields.rootHash === H_A).length
  check(perRootBefore >= 1 && perRootAfter === perRootBefore,
    '同一个根 focus 两次，按根只读回一次（实得 ' + perRootBefore + ' → ' + perRootAfter + '）',
    '多一次 = 每个 focus 都读盘，高频动作被加了磁盘读')

  // ── 四、负控：不调 restore 就是空 ──
  console.log('\n== 四、负控：不调 restore 就是空（门禁非恒绿的证据） ==')
  const ticketsMod = await import(url('src/host/refresh/sessionTickets.js'))
  const readoutMod = await import(url('src/host/refresh/sessionChainReadout.js'))
  const dir4 = fs.mkdtempSync(path.join(os.tmpdir(), 't735-negative-'))
  const raw1 = ticketsMod.createSessionTickets({ cacheDir: dir4, now: () => 1000 })
  await raw1.note({
    sessionId: 'sess-n', rootHash: chainMod.chainRootHash('d:\\ws\\735-n'), backend: 'github',
    tool: 'pwsh', source: 'cli', tier: 'write-confirmed', reason: 'cmd.cli-write',
    verb: 'edit', ticketKey: '731', args: {},
  })
  const raw2 = ticketsMod.createSessionTickets({ cacheDir: dir4, now: () => 2000 })
  const neg = readoutMod.buildSessionChainReadout({ tickets: raw2, at: 2000 })
  check(!!neg && neg.ok === true && neg.sessions.length === 0 && neg.reason === 'host.chain.empty',
    '负控：新实例不调 restore，读数恒空（reason=host.chain.empty）',
    '这条不空 = 上面二、三的断言是恒绿的装饰：' + JSON.stringify(neg).slice(0, 120))

  console.log(failed ? '\n存在失败 — verify-735-chain-restore 未通过（共 ' + total + ' 项）' : '\n全部通过 — 落盘读回门禁生效（共 ' + total + ' 项）')
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error('门禁执行异常：' + ((e && e.stack) || e)); process.exit(1) })
