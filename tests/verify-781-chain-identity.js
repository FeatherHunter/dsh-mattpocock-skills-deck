#!/usr/bin/env node
/**
 * verify-781-chain-identity.js —— 门禁：处理链记与读用同一身份（票 #781）
 *
 * 守的是什么：重启后“谁在处理哪张票”对不上，根因是记与读用的不是同一把钥匙
 *   ① 主动上报拿会话所选目录原文算散列，读回按工作区根过滤 —— 同一处换种写法就落两格；
 *   ② 写事件那一路在白名单门后，没聚焦的工作区连链都不进；
 *   ③ 切进工作区时读盘不等结果，第一次快照赶在读完之前，看到空当成丢了。
 *
 * 它怎么判（三段）：
 *   一、note() 先洗根：配了 canonicalKey 时，子目录原文记进去，落在归一化根那一格，
 *      新实例按根读回能拿到（子目录与根同格）。
 *   二、白名单外仍记链：从不 focus（不进白名单）的会话调 handle()，note 照调一次
 *      （根已按归一化值算），而取数那一路仍返回 null（门只管取数，不管记）。
 *   三、读回等落定：读盘拖慢 120ms 时，focus() 落定后读数里立刻有那一笔
 *      （不等的话 focus 先回、读数还是空的）。
 *
 * 用法: node tests/verify-781-chain-identity.js（在插件根目录）
 * 退出码：0 = 通过；1 = 有违规。
 */
const fs = require('fs')
const path = require('path')
const os = require('os')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
const url = (rel) => pathToFileURL(path.join(ROOT, rel)).href

let failed = false
let total = 0
const check = (ok, msg, detail) => {
  total += 1
  console.log((ok ? '  PASS ' : '  FAIL ') + msg + (ok || !detail ? '' : '\n         → ' + detail))
  if (!ok) failed = true
}

async function main() {
  console.log('#781 处理链记读同身份门禁（洗根 / 门前记链 / 读回等落定）')
  const chainMod = await import(url('src/shared/refresh/chain.js'))
  const ticketsMod = await import(url('src/host/refresh/sessionTickets.js'))
  const writeMod = await import(url('src/host/refresh/writeEvents.js'))
  const wiringMod = await import(url('src/host/refresh/wiring.js'))

  const CANON = 'd:\\ws\\781-home'
  const SUB = 'D:\\ws\\781-home\\sub\\'

  // ── 一、note() 先洗根 ──
  console.log('\n== 一、子目录原文记入，落在归一化根那一格 ==')
  const dir1 = fs.mkdtempSync(path.join(os.tmpdir(), 't781-wash-'))
  const st1 = ticketsMod.createSessionTickets({
    cacheDir: dir1,
    canonicalKey: async (raw) => (String(raw || '').toLowerCase().replace(/\//g, '\\').replace(/\\+$/, '') === 'd:\\ws\\781-home\\sub' ? CANON : String(raw)),
  })
  const noted = await st1.note({
    sessionId: 'sess-781', rootKey: SUB, backend: 'github',
    tool: 'deck_issue_report', source: 'tool-args', tier: 'write-confirmed',
    reason: 'tool.deck-write', verb: 'report', ticketKey: '781', args: { key: '781' },
  })
  check(!!noted && noted.recorded === true, '子目录原文记进链（recorded:true）', JSON.stringify(noted))
  const snap1 = st1.snapshot()
  check(snap1.length === 1 && snap1[0].rootHash === chainMod.chainRootHash(CANON),
    '这一格的根散列等于归一化根的散列（与读回侧同格）',
    '实得：' + JSON.stringify(snap1.map((s) => s.rootHash)))
  const st1b = ticketsMod.createSessionTickets({ cacheDir: dir1 })
  const rr1 = await st1b.restore({ rootKey: CANON })
  check(rr1.entries === 1 && st1b.entriesOf('sess-781').length === 1 &&
    st1b.entriesOf('sess-781')[0].ticketKey === '781',
    '新实例按根读回拿到那一笔（重启不丢）', JSON.stringify({ restored: rr1.entries }))

  // ── 二、白名单外仍记链 ──
  console.log('\n== 二、没聚焦的会话也记链，取数仍受门控 ==')
  const seen = []
  const we = writeMod.createWriteEvents({
    canonicalKey: async () => CANON,
    backendOf: async () => 'github',
    note: async (input) => { seen.push(input); return { recorded: true } },
    gate: null,
  })
  // 注意：全程不调 allowRoot —— 这个会话不在白名单里（后台档）。
  const out = await we.handle(
    { id: 'sess-bg', header: { cwd: SUB } },
    'tools/result', 'deck_issue_report', { key: '781' }, true,
  )
  check(seen.length === 1, '门前喂链一次（note 被调 1 次）', '实得 ' + seen.length + ' 次')
  check(seen.length === 1 && seen[0].rootHash === chainMod.chainRootHash(CANON),
    '喂进去的根是归一化根的散列（读回找得到）',
    '实得：' + JSON.stringify(seen.map((s) => s.rootHash)))
  check(seen.length === 1 && seen[0].ticketKey === '781',
    '喂进去的票号是 781', '实得：' + JSON.stringify(seen.map((s) => s.ticketKey)))
  check(out === null, '取数那一路仍被门挡住（handle 回 null，不取数）', JSON.stringify(out))

  // ── 三、读回等落定 ──
  console.log('\n== 三、focus 落定后读数里立刻有（不等就空） ==')
  const dir3 = fs.mkdtempSync(path.join(os.tmpdir(), 't781-slow-'))
  const slowRead = async (p) => {
    await new Promise((r) => setTimeout(r, 120))
    return await fs.promises.readFile(p, 'utf8')
  }
  const stSlow = ticketsMod.createSessionTickets({
    cacheDir: dir3,
    canonicalKey: async (x) => String(x),
    readText: slowRead,
    writeText: async (p, text) => { await fs.promises.mkdir(path.dirname(p), { recursive: true }); await fs.promises.writeFile(p, text, 'utf8') },
  })
  const rec = await stSlow.note({
    sessionId: 'sess-slow', rootKey: CANON, backend: 'github',
    tool: 'deck_issue_report', source: 'tool-args', tier: 'write-confirmed',
    reason: 'tool.deck-write', verb: 'comment', ticketKey: '781', args: {},
  })
  check(!!rec && rec.recorded === true, '慢盘实例先记一笔', JSON.stringify(rec))
  const deps = {
    ctx: { on: () => () => {}, get: () => undefined },
    logCtx: null,
    canonicalKey: async (x) => String(x),
    getCacheDir: async () => dir3,
    getTrackerRegistry: async () => ({ describe: () => ({ backend: 'github' }), modules: () => [] }),
    getDetectionService: async () => ({ detect: async () => ({ selection: { backendId: 'github' } }) }),
    getPlatform: async () => ({ os: 'win32', path: path }),
    sessionTickets: stSlow,
  }
  const w = await wiringMod.makeRefreshLoader(deps)()
  const t0 = Date.now()
  await w.focus({ windowId: 'win-781', workspaceRoot: CANON, kind: 'focus', visible: true })
  const elapsed = Date.now() - t0
  const readout = w.chainReadoutOf()
  const hasIt = !!(readout && Array.isArray(readout.sessions) &&
    readout.sessions.some((s) => Array.isArray(s.entries) && s.entries.some((e) => e.ticketKey === '781')))
  check(elapsed >= 80, 'focus 等读盘落定（耗时 ' + elapsed + 'ms ≥ 80ms）', '不等的话几毫秒就回了')
  check(hasIt, '落定后读数里立刻有 781（不用第二次快照）', JSON.stringify(readout))

  console.log('\n' + (failed ? '有违规 — #781 门禁变红（共 ' + total + ' 项）' : '全部通过 — #781 记读同身份（共 ' + total + ' 项）'))
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error('门禁执行失败：' + (e && e.stack || e)); process.exit(1) })
