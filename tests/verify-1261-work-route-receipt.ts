// tests/verify-1261-work-route-receipt.ts —— #1261 起步、#1262 铺满：写一次票就记一条。
//
// 这扇门盯两件事（规格见 #1259 第 1、2、5、8、9、10 条）：
//   存储与读出口（#1261；#1083 加固落盘与隐私）：v3 落盘形状、(会话, 票) 去重、坏文件按空账重写、
//     缺键诚实失败、写失败不抛只报原因；30 天过滤、24 小时现办、30 分钟撞单、空账无摘要、会话只露标签。
//   壳收口（#1262）：五个写工具（上报、建票、改票、建图、连边）成功后各记各的票，
//     一次调用写到的每张票各一条；建图只记这一次真建出来的子票（地图票不记、
//     上次已建这次跳过的子票也不重记）；四个读工具不记；
//     失败（含 partial，信封里 ok 是 false）、被闸推迟、认不出票号不记也不注入；
//     记/读失败时回执备注写实话，不抛、不改其他格。
// 全程固定时钟 + 临时家目录，同一份真实现（不造假口），跑两次结果一字不差。
//
// 用法：在插件根目录执行 node --import ./scripts/ts-hook.mts tests/verify-1261-work-route-receipt.ts
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const imp = (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href)
let failed = false
let total = 0
const check = (ok: boolean, msg: string) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

const T0 = 1700000000000
const DAY = 24 * 60 * 60 * 1000

function memFs(home: string) {
  return {
    readFile: async (p: string) => { try { return fs.readFileSync(p, 'utf8') } catch { return null } },
    writeFile: async (p: string, c: string) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c, 'utf8') },
    mkdir: async (dir: string) => { fs.mkdirSync(dir, { recursive: true }) },
    rename: async (from: string, to: string) => { fs.renameSync(from, to) },
  }
}

async function main() {
  console.log('#1261 上报一次，回执见在办，盘上有记录')
  const bindingsMod = await imp('src/deck/shell/work-path-bindings.ts') as { createWorkRouteBindings: (io: unknown) => any }
  const recordMod = await imp('src/deck/shell/work-path-record.js') as { noteWorkRoute: (...a: any[]) => Promise<void> }
  const chainMod = await imp('src/shared/refresh/chain.js') as { chainRootHash: (k: string) => string }
  const readoutMod = await imp('src/deck/shell/work-path-readout.ts') as {
    buildWorkPathReadout: (l: unknown, o: { sessionId: string, at: number }) => any,
    buildWorkPathSummary: (r: unknown) => string | null,
  }

  // ── 一、存储：v3 落盘，去重键是 (会话, 票) ──
  const home1 = fs.mkdtempSync(path.join(os.tmpdir(), 'wproute-1261-'))
  const store = bindingsMod.createWorkRouteBindings(Object.assign({ homeDir: home1, now: () => T0 }, memFs(home1)))
  const rootKey = 'ws-1261'
  const noted = await store.note({ rootKey: rootKey, sessionId: 's-a', sessionLabel: '', backend: 'markdown', ticketKey: '701', effortId: '', title: '甲票', action: 'report', source: 'reported' })
  check(noted && noted.ok === true && noted.ticketKey === '701' && noted.count === 1, '记一笔成功（票 701，本会话第 1 条）')
  const diskFile = home1 + '/.dsh/mattskillsdeck/work-path/' + chainMod.chainRootHash(rootKey) + '.json'
  check(fs.existsSync(diskFile), '文件落在 <家目录>/.dsh/mattskillsdeck/work-path/<根散列>.json')
  const disk = JSON.parse(fs.readFileSync(diskFile, 'utf8'))
  check(disk && disk.v === 3 && typeof disk.at === 'number' && disk.backend === 'markdown'
    && Array.isArray(disk.workers) && disk.workers.length === 1
    && disk.workers[0].session === 's-a' && typeof disk.workers[0].label === 'string'
    && Array.isArray(disk.workers[0].entries) && disk.workers[0].entries.length === 1
    && disk.workers[0].entries[0].ticketKey === '701' && disk.workers[0].entries[0].action === 'report'
    && disk.workers[0].entries[0].source === 'reported' && typeof disk.workers[0].entries[0].actionAt === 'number',
    '盘上是 v3 形状（版本、时间、后端、会话页、条目全字段都在）')
  // 同一会话同一票再报：后来居上，只留一条。
  await store.note({ rootKey: rootKey, sessionId: 's-a', sessionLabel: '', backend: 'markdown', ticketKey: '701', effortId: '', title: '甲票改名', action: 'report', source: 'reported' })
  const disk2 = JSON.parse(fs.readFileSync(diskFile, 'utf8'))
  check(disk2.workers[0].entries.length === 1 && disk2.workers[0].entries[0].title === '甲票改名', '同一会话同一票再报：只留一条，标题后来居上')
  // 缺键诚实失败。
  const noRoot = await store.note({ rootKey: '', sessionId: 's-a', ticketKey: '701', action: 'report', source: 'reported' })
  const noSession = await store.note({ rootKey: rootKey, sessionId: '', ticketKey: '701', action: 'report', source: 'reported' })
  const noTicket = await store.note({ rootKey: rootKey, sessionId: 's-a', ticketKey: '', action: 'report', source: 'reported' })
  check(noRoot.ok === false && noSession.ok === false && noTicket.ok === false, '缺工作区键 / 会话 / 票号都诚实失败（不落盘不抛）')
  // #1083 起没有内存真源：读盘每次现读，坏文件当空账，这次写下去就是整份新账（旧内容不再复活）。
  fs.writeFileSync(diskFile, '{ 这不是 JSON', 'utf8')
  const notedAfterBad = await store.note({ rootKey: rootKey, sessionId: 's-a', sessionLabel: '', backend: 'markdown', ticketKey: '702', effortId: '', title: '乙票', action: 'report', source: 'reported' })
  check(notedAfterBad.ok === true && Array.isArray(notedAfterBad.warnings) && notedAfterBad.warnings.length === 1
    && notedAfterBad.warnings[0].indexOf('读不出来') >= 0, '盘上文件坏了：当空账处理，这次照样记上，并在回执备注里说明')
  const disk3 = JSON.parse(fs.readFileSync(diskFile, 'utf8'))
  check(disk3.v === 3 && disk3.workers[0].entries.length === 1 && disk3.workers[0].entries[0].ticketKey === '702',
    '坏文件被整份重写成只含这一条的新账（旧条目不再复活）')
  // 把 701 补回来，后面读出口的断言仍按两条算。
  await store.note({ rootKey: rootKey, sessionId: 's-a', sessionLabel: '', backend: 'markdown', ticketKey: '701', effortId: '', title: '甲票', action: 'report', source: 'reported' })

  // ── 二、读出口：窗口、现办、撞单、摘要 ──
  const read1: any = await store.read({ sessionId: 's-a', rootKey: rootKey, at: T0 })
  check(read1.ok === true && read1.readout.entries.length === 2 && read1.readout.staleCount === 0 && read1.readout.collisions === undefined,
    '两条都在 30 天内、都现办、单会话无 collisions 键')
  check(typeof read1.readout.at === 'string' && read1.readout.at.endsWith('Z'), '回执时间是 ISO Z 串')
  check(typeof read1.summary === 'string' && read1.summary.indexOf('工作路线摘要 · 本工作区在办 2 条（最近 2 条：') === 0,
    '摘要一句话（当前会话优先、按时间倒序）：' + read1.summary)
  // 原始会话 id 只进盘：回执全文没有，盘上有。
  check(JSON.stringify(read1.readout).indexOf('s-a') < 0 && JSON.stringify(disk3).indexOf('s-a') >= 0, '原始会话 id 只进盘不进回执')
  // 30 天外的条目读不出来；超过 1 天未动的标 stale，摘要里另说。
  const readOld: any = await store.read({ sessionId: 's-a', rootKey: rootKey, at: T0 + 31 * DAY })
  check(readOld.ok === true && readOld.readout.entries.length === 0 && readOld.readout.staleCount === 0 && readOld.summary === null,
    '31 天后再读：在办表空了，摘要也不写')
  const readStale: any = await store.read({ sessionId: 's-a', rootKey: rootKey, at: T0 + 2 * DAY })
  check(readStale.ok === true && readStale.readout.entries.length === 2 && readStale.readout.entries.every((e: any) => e.active === false)
    && readStale.readout.staleCount === 2 && (readStale.summary || '').indexOf('其中 2 条超过 1 天未动') >= 0,
    '2 天后再读：两条都不现办，摘要里另说：' + readStale.summary)
  // 空账：读出来是空表，摘要为 null。
  const storeEmpty = bindingsMod.createWorkRouteBindings(Object.assign({ homeDir: fs.mkdtempSync(path.join(os.tmpdir(), 'wproute-1261e-')), now: () => T0 }, memFs(home1)))
  const readEmpty: any = await storeEmpty.read({ sessionId: 's-x', rootKey: 'ws-never-noted', at: T0 })
  check(readEmpty.ok === true && readEmpty.readout.entries.length === 0 && readEmpty.summary === null, '没记过的账：读出来是空表，无摘要')
  check(readoutMod.buildWorkPathSummary(null) === null && readoutMod.buildWorkPathSummary({ entries: [] }) === null, '摘要：没在办时回 null')

  // ── 三、撞单：同一票 30 分钟内被两个会话记过 ──
  // 会话 id 用长一点的：回执里只露散列前 6 位，而 s-a / s-b 这种短串经 djb2 散列后
  // 前 6 位恰好相同（0b88a2），会把「是不是另一个会话」这条断言变成永远不成立的空测。
  const A_ID = 'sess-1261-alpha-1a2b3c4d'
  const B_ID = 'sess-1261-bravo-5e6f7a8b'
  const C_ID = 'sess-1261-charlie-9c0d1e2f'
  const home3 = fs.mkdtempSync(path.join(os.tmpdir(), 'wproute-1261c-'))
  let clock3 = T0
  const store3 = bindingsMod.createWorkRouteBindings(Object.assign({ homeDir: home3, now: () => clock3 }, memFs(home3)))
  await store3.note({ rootKey: 'ws-c', sessionId: A_ID, sessionLabel: '', backend: 'markdown', ticketKey: '801', effortId: '', title: '丙票', action: 'report', source: 'reported' })
  clock3 = T0 + 10 * 60 * 1000
  await store3.note({ rootKey: 'ws-c', sessionId: B_ID, sessionLabel: '', backend: 'markdown', ticketKey: '801', effortId: '', title: '丙票', action: 'report', source: 'reported' })
  // 会话标识只在回执里露「会话 ××」：用同一把尺子算期望值，不抄实现里的散列。
  const labelOf = (sid: string) => readoutMod.workPathSessionLabel('', sid)
  const readC: any = await store3.read({ sessionId: A_ID, rootKey: 'ws-c', at: clock3 })
  check(readC.ok === true && readC.readout.entries.length === 2
    && Array.isArray(readC.readout.collisions) && readC.readout.collisions.length === 1
    && readC.readout.collisions[0].ticketKey === '801'
    && readC.readout.collisions[0].sessionLabel === labelOf(B_ID)
    && readC.readout.collisions[0].sessionLabel !== labelOf(A_ID)
    && readC.readout.collisions[0].actionAt === new Date(T0 + 10 * 60 * 1000).toISOString(),
    '10 分钟内两会话同票：撞单行给的是另一个会话的标识与它记的时间，不是当前会话自己：' + JSON.stringify(readC.readout.collisions))
  // 隔 31 分钟再记：超出窗口，不算撞单。
  const home4 = fs.mkdtempSync(path.join(os.tmpdir(), 'wproute-1261d-'))
  let clock4 = T0
  const store4 = bindingsMod.createWorkRouteBindings(Object.assign({ homeDir: home4, now: () => clock4 }, memFs(home4)))
  await store4.note({ rootKey: 'ws-d', sessionId: 's-a', sessionLabel: '', backend: 'markdown', ticketKey: '802', effortId: '', title: '丁票', action: 'report', source: 'reported' })
  clock4 = T0 + 31 * 60 * 1000
  await store4.note({ rootKey: 'ws-d', sessionId: 's-b', sessionLabel: '', backend: 'markdown', ticketKey: '802', effortId: '', title: '丁票', action: 'report', source: 'reported' })
  const readD: any = await store4.read({ sessionId: 's-a', rootKey: 'ws-d', at: clock4 })
  check(readD.ok === true && readD.collisions === undefined && readD.readout.collisions === undefined, '超 30 分钟的两条：不算撞单（collisions 键不出现）')
  // 三会话：A=0、B=20、C=35 分钟。C 读时 B 只差 15 分钟，该报；A 与 C 差 35 分钟，不报。
  // 这条专门钉住「按最早—最晚总跨度判断」的错法：A 到 C 跨 35 分钟，那一版会把整票漏掉。
  const home4b = fs.mkdtempSync(path.join(os.tmpdir(), 'wproute-1261d3-'))
  let clock4b = T0
  const store4b = bindingsMod.createWorkRouteBindings(Object.assign({ homeDir: home4b, now: () => clock4b }, memFs(home4b)))
  const note4b = (sid: string) => store4b.note({ rootKey: 'ws-e', sessionId: sid, sessionLabel: '', backend: 'markdown', ticketKey: '803', effortId: '', title: '戊票', action: 'report', source: 'reported' })
  await note4b(A_ID)
  clock4b = T0 + 20 * 60 * 1000
  await note4b(B_ID)
  clock4b = T0 + 35 * 60 * 1000
  await note4b(C_ID)
  const readC2: any = await store4b.read({ sessionId: C_ID, rootKey: 'ws-e', at: clock4b })
  const coll2 = readC2.readout.collisions
  check(readC2.ok === true && Array.isArray(coll2) && coll2.length === 1
    && coll2[0].ticketKey === '803' && coll2[0].sessionLabel === labelOf(B_ID)
    && coll2[0].sessionLabel !== labelOf(C_ID)
    && coll2[0].actionAt === new Date(T0 + 20 * 60 * 1000).toISOString(),
    '三会话 A=0/B=20/C=35 分钟：C 只报差 15 分钟的 B，不报差 35 分钟的 A：' + JSON.stringify(coll2))

  // ── 四、壳收口：五个写工具各记各的，读工具不记 ──
  const home5 = fs.mkdtempSync(path.join(os.tmpdir(), 'wproute-1262-'))
  let clock5 = T0
  const store5 = bindingsMod.createWorkRouteBindings(Object.assign({ homeDir: home5, now: () => clock5 }, memFs(home5)))
  const deps5 = {
    workRouteNote: (i: unknown) => store5.note(i),
    workRouteRead: (i: unknown) => store5.read(i),
    now: () => clock5,
  }
  const sess5 = { sessionId: 's-w', workspaceKey: 'ws-w', cwd: 'x' }
  // 每调一次把钟往前拨一秒，并把这一次用的时刻还给调用方——验收②要断言「时间也是最近一次」。
  const call5 = async (tool: string, value: any) => { clock5 += 1000; await recordMod.noteWorkRoute(deps5, tool, sess5, 'markdown', value); return clock5 }
  const entryOf = (v: any, key: string) => (((v.data && v.data.workRoute && v.data.workRoute.entries) || []) as any[]).filter((e: any) => e.ticketKey === key)
  const diskRows = (home: string, rootKey: string) => {
    const file = home + '/.dsh/mattskillsdeck/work-path/' + chainMod.chainRootHash(rootKey) + '.json'
    const out: any[] = []
    for (const w of JSON.parse(fs.readFileSync(file, 'utf8')).workers) for (const e of w.entries) out.push(Object.assign({ session: w.session }, e))
    return out
  }

  // 上报：记一条，动作与来源如实写，在办表与摘要一起带回。
  const vReport: any = { status: 'ok', data: { key: '701', title: '甲票', effortId: '' }, notes: [] }
  await call5('deck_issue_report', vReport)
  check(vReport.data.workRoute && entryOf(vReport, '701').length === 1
    && entryOf(vReport, '701')[0].action === 'report' && entryOf(vReport, '701')[0].source === 'reported'
    && entryOf(vReport, '701')[0].title === '甲票' && entryOf(vReport, '701')[0].currentSession === true,
    '上报：盘上记一条，回执 data.workRoute 里能看到自己这张票')
  check(vReport.notes.length === 1 && vReport.notes[0].indexOf('工作路线摘要 · 本工作区在办 1 条') === 0, '上报：notes 里带一句摘要')
  check(entryOf(vReport, '701')[0].actionAt === new Date(clock5).toISOString(), '上报：回执里的动作时间就是这一次的时刻')

  // 建票：动作 create、来源 auto，标题与工作单元从 data.ticket 取。
  const vCreate: any = { status: 'ok', data: { ticket: { key: '901', title: '新票甲', effortId: 'eff-1' }, kind: 'task' }, touched: ['901'], notes: [] }
  await call5('deck_issue_create', vCreate)
  const diskCreate = diskRows(home5, 'ws-w').filter((e: any) => e.ticketKey === '901')
  check(vCreate.data.workRoute && entryOf(vCreate, '901').length === 1
    && entryOf(vCreate, '901')[0].action === 'create' && entryOf(vCreate, '901')[0].source === 'auto',
    '建票：记一条，动作 create、来源 auto')
  check(diskCreate.length === 1 && diskCreate[0].title === '新票甲' && diskCreate[0].effortId === 'eff-1', '建票：标题与工作单元写进盘上')

  // 改票：同一会话同一票后来居上，只留一条（动作换成 edit）。
  const vPatch: any = { status: 'ok', data: { requested: { title: true }, ticket: { key: '901', title: '新票甲改名', effortId: 'eff-1' } }, touched: ['901'], notes: [] }
  await call5('deck_issue_patch', vPatch)
  const patchRows = diskRows(home5, 'ws-w').filter((e: any) => e.ticketKey === '901')
  check(patchRows.length === 1 && patchRows[0].action === 'edit' && patchRows[0].source === 'auto' && patchRows[0].title === '新票甲改名',
    '改票：同一票只留一条（后来居上，动作与标题更新）')
  check(entryOf(vPatch, '901').length === 1 && entryOf(vPatch, '901')[0].action === 'edit', '改票：回执里也是最新那一条')

  // 建图：只记这一次真建出来的子票。地图票是容器、不记；续跑时上次已建这次跳过的子票
  // （skipped:true）也不重记——记了会刷新它的动作时间，在办表会说谎。
  const vPlan: any = {
    status: 'ok',
    data: { planId: 'plan-1', mapKey: '950', durable: true, builtKeys: ['950', '951', '952'], skippedKeys: ['953'], restKeys: [], edges: [], counts: {}, shards: 1, nextCall: null },
    items: [
      { key: '950', role: 'map', title: '地图甲', status: 'ok' },
      { key: '951', role: 'child', title: '子票甲', status: 'ok' },
      { key: '952', role: 'child', title: '子票乙', status: 'ok' },
      { key: '953', role: 'child', title: '上次已建的子票', status: 'ok', skipped: true },
    ],
    touched: ['950', '951', '952', '953'],
    notes: [],
  }
  const tPlan = await call5('deck_map_plan_create', vPlan)
  const planRows = diskRows(home5, 'ws-w').filter((e: any) => ['950', '951', '952', '953'].indexOf(e.ticketKey) >= 0)
  check(planRows.length === 2 && planRows.every((e: any) => e.action === 'plan' && e.source === 'auto')
    && planRows.filter((e: any) => e.title === '子票甲').length === 1 && planRows.filter((e: any) => e.title === '子票乙').length === 1,
    '建图：只记这次建出的两张子票（地图不在内，跳过的那张也不在内）')
  check(planRows.every((e: any) => e.actionAt === tPlan), '建图：动作时间是这一次的时刻')
  check(!entryOf(vPlan, '950').length && !entryOf(vPlan, '953').length, '建图：回执在办表里没有地图票与跳过票')
  check(vPlan.data.workRoute && vPlan.data.workRoute.entries.length === 4, '建图：回执在办表把这一批都带上（此前两张 + 这次两张）')

  // 连边：没有标题可取，动作 link、来源 auto，照样记；旧标题不被空串抹掉。
  const vLink: any = { status: 'ok', data: { requested: {}, done: [], jobs: [] }, touched: ['901'], notes: [] }
  await call5('deck_map_link', vLink)
  const linkRows = diskRows(home5, 'ws-w').filter((e: any) => e.ticketKey === '901')
  check(linkRows.length === 1 && linkRows[0].action === 'link' && linkRows[0].source === 'auto' && linkRows[0].title === '新票甲改名',
    '连边：记一条（标题沿用上一次，不被空串抹掉）')

  // 四个读工具：成功也不记、不注入。
  const readBefore = diskRows(home5, 'ws-w').length
  for (const tool of ['deck_context', 'deck_issue_get', 'deck_issue_list', 'deck_map_snapshot']) {
    const vRead: any = { status: 'ok', data: { ticket: { key: '777', title: '读回来的票' }, key: '777' }, touched: [], notes: [] }
    await call5(tool, vRead)
    check(!vRead.data.workRoute && vRead.notes.length === 0, '读工具 ' + tool + '：不记不注入')
  }
  check(diskRows(home5, 'ws-w').length === readBefore, '四个读工具轮完，盘上条数不变')

  // 部分成功（partial）：信封里 ok 是 false，按失败办——不记、不注入、备注一个字不动。
  const vPartial: any = { status: 'partial', data: { ticket: { key: '903', title: '半成票', effortId: '' } }, touched: ['903'], notes: ['父子边没落上'] }
  await call5('deck_issue_create', vPartial)
  check(!vPartial.data.workRoute && vPartial.notes.length === 1 && vPartial.notes[0] === '父子边没落上',
    '部分成功（partial）：不记不注入，原有备注原样保留')
  check(diskRows(home5, 'ws-w').filter((e: any) => e.ticketKey === '903').length === 0, '部分成功（partial）：盘上没有这张票')

  // 失败、认不出票号：不记不注入，也不加备注。五个写工具各验一次失败回执。
  const failBefore = diskRows(home5, 'ws-w').length
  const failures: any[] = [
    { tool: 'deck_issue_report', value: { status: 'unsupported', data: { key: '999999' }, notes: [] } },
    { tool: 'deck_issue_create', value: { status: 'unsupported', data: { ticket: { key: '904', title: '没建成' } }, touched: ['904'], notes: [] } },
    { tool: 'deck_issue_patch', value: { status: 'unsupported', data: { requested: { title: true } }, touched: ['901'], notes: [] } },
    { tool: 'deck_map_plan_create', value: { status: 'unsupported', data: { planId: 'p2' }, items: [{ key: '905', role: 'child', title: '没建成', status: 'ok' }], touched: ['905'], notes: [] } },
    { tool: 'deck_map_link', value: { status: 'unsupported', data: { requested: {} }, touched: ['901'], notes: [] } },
  ]
  for (const f of failures) {
    await call5(f.tool, f.value)
    check(!f.value.data.workRoute && f.value.notes.length === 0, '失败回执不记不注入：' + f.tool)
  }
  check(diskRows(home5, 'ws-w').length === failBefore, '五条失败回执轮完，盘上条数不变')
  const vNoKey: any = { status: 'ok', data: { planId: 'p' }, touched: [], notes: [] }
  await call5('deck_map_plan_create', vNoKey)
  check(!vNoKey.data.workRoute && vNoKey.notes.length === 0, '认不出票号的调用不记不注入')

  // 撞车：同一张票 30 分钟内另一个会话也记过，回执里列出票号、那个会话的标识与它记的时间。
  const tOther = clock5
  await store5.note({ rootKey: 'ws-w', sessionId: 's-other', sessionLabel: '', backend: 'markdown', ticketKey: '701', effortId: '', title: '甲票', action: 'edit', source: 'auto' })
  const vColl: any = { status: 'ok', data: { ticket: { key: '701', title: '甲票', effortId: '' } }, touched: ['701'], notes: [] }
  clock5 += 60 * 1000
  const tColl = clock5
  await recordMod.noteWorkRoute(deps5, 'deck_issue_patch', sess5, 'markdown', vColl)
  const coll = vColl.data.workRoute && vColl.data.workRoute.collisions
  check(Array.isArray(coll) && coll.length === 1 && coll[0].ticketKey === '701'
    && coll[0].sessionLabel === readoutMod.workPathSessionLabel('', 's-other')
    && coll[0].sessionLabel !== readoutMod.workPathSessionLabel('', 's-w')
    && coll[0].actionAt === new Date(tOther).toISOString(),
    '撞车：同票 30 分钟内两个会话记过，回执列出票号、另一个会话的标识与它记的时间（不是当前会话自己）：' + JSON.stringify(coll))
  const sameTicket = diskRows(home5, 'ws-w').filter((e: any) => e.session === 's-w' && e.ticketKey === '701')
  check(sameTicket.length === 1 && sameTicket[0].action === 'edit' && sameTicket[0].source === 'auto'
    && sameTicket[0].actionAt === tColl,
    '先上报再改票：同一会话同一票盘上仍只一条，动作、时间、来源都是最近这一次')
  const mine = entryOf(vColl, '701').filter((e: any) => e.currentSession)
  check(mine.length === 1 && mine[0].action === 'edit' && mine[0].source === 'auto'
    && mine[0].actionAt === new Date(tColl).toISOString(),
    '撞车那次回执里，这张票也是最近一次的动作、时间、来源')

  // 记失败 / 读失败：备注写实话，不抛、不改其他格。
  const failWrite = bindingsMod.createWorkRouteBindings({
    homeDir: home1, now: () => T0,
    readFile: async () => null,
    writeFile: async () => { throw new Error('磁盘满了（探针）') },
    mkdir: async () => {},
  })
  const vFail: any = { status: 'ok', data: { key: '701', effortId: '', title: '甲票' }, notes: ['旧备注'] }
  await recordMod.noteWorkRoute(
    { workRouteNote: (i: unknown) => failWrite.note(i), workRouteRead: (i: unknown) => failWrite.read(i), now: () => T0 },
    'deck_issue_report', { sessionId: 's-a', workspaceKey: 'ws-1261', cwd: 'x' }, 'markdown', vFail)
  check(!vFail.data.workRoute && vFail.notes.length === 2 && vFail.notes[0] === '旧备注'
    && vFail.notes[1].indexOf('工作路线这次没落上') === 0 && vFail.notes[1].indexOf('下一次写票会重新读盘再补上') >= 0,
    '写失败：备注写「这次没落上」，旧备注与其他格不动：' + JSON.stringify(vFail.notes[1]))
  const failRead = {
    workRouteNote: async () => ({ ok: true, ticketKey: '701', count: 1 }),
    workRouteRead: async () => ({ ok: false, reason: 'probe-read-failed' }),
  }
  const vRF: any = { status: 'ok', data: { key: '701', title: '甲票' }, notes: [] }
  await recordMod.noteWorkRoute(failRead, 'deck_issue_report', { sessionId: 's-a', workspaceKey: 'ws-1261', cwd: 'x' }, 'markdown', vRF)
  check(!vRF.data.workRoute && vRF.notes.length === 1 && vRF.notes[0].indexOf('工作路线这次读不出来（probe-read-failed）') === 0,
    '读失败：备注说这次读不出来，回执不带 data.workRoute：' + JSON.stringify(vRF.notes[0]))

  for (const h of [home1, home3, home4, home4b, home5]) { try { fs.rmSync(h, { recursive: true, force: true }) } catch { /* 忽略 */ } }
  console.log('共 ' + total + ' 项，' + (failed ? '有失败' : '全部通过'))
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error('  FAIL 异常：' + ((e && e.stack) || e)); process.exit(1) })
