// tests/verify-1261-work-route-receipt.ts —— #1261：上报一次，回执见在办，盘上有记录。
//
// 这扇门只盯 #1261 自己的形状（规格见 #1259 第 1、2、8、9、10 条）：
//   存储：v3 落盘形状、(会话, 票) 去重、坏文件按空账重写、缺键诚实失败、写失败不抛只报原因；
//   读出口：30 天过滤、24 小时现办、30 分钟撞单、空账无摘要、会话只露标签；
//   壳收口：记/读失败时回执备注写「这次没落上」，不抛、不改其他格。
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
  const home3 = fs.mkdtempSync(path.join(os.tmpdir(), 'wproute-1261c-'))
  let clock3 = T0
  const store3 = bindingsMod.createWorkRouteBindings(Object.assign({ homeDir: home3, now: () => clock3 }, memFs(home3)))
  await store3.note({ rootKey: 'ws-c', sessionId: 's-a', sessionLabel: '', backend: 'markdown', ticketKey: '801', effortId: '', title: '丙票', action: 'report', source: 'reported' })
  clock3 = T0 + 10 * 60 * 1000
  await store3.note({ rootKey: 'ws-c', sessionId: 's-b', sessionLabel: '', backend: 'markdown', ticketKey: '801', effortId: '', title: '丙票', action: 'report', source: 'reported' })
  const readC: any = await store3.read({ sessionId: 's-a', rootKey: 'ws-c', at: clock3 })
  check(readC.ok === true && readC.readout.entries.length === 2
    && Array.isArray(readC.readout.collisions) && readC.readout.collisions.length === 1
    && readC.readout.collisions[0].ticketKey === '801' && typeof readC.readout.collisions[0].sessionLabel === 'string',
    '10 分钟内两会话同票：撞单行出现：' + JSON.stringify(readC.readout.collisions))
  // 隔 31 分钟再记：超出窗口，不算撞单。
  const home4 = fs.mkdtempSync(path.join(os.tmpdir(), 'wproute-1261d-'))
  let clock4 = T0
  const store4 = bindingsMod.createWorkRouteBindings(Object.assign({ homeDir: home4, now: () => clock4 }, memFs(home4)))
  await store4.note({ rootKey: 'ws-d', sessionId: 's-a', sessionLabel: '', backend: 'markdown', ticketKey: '802', effortId: '', title: '丁票', action: 'report', source: 'reported' })
  clock4 = T0 + 31 * 60 * 1000
  await store4.note({ rootKey: 'ws-d', sessionId: 's-b', sessionLabel: '', backend: 'markdown', ticketKey: '802', effortId: '', title: '丁票', action: 'report', source: 'reported' })
  const readD: any = await store4.read({ sessionId: 's-a', rootKey: 'ws-d', at: clock4 })
  check(readD.ok === true && readD.collisions === undefined && readD.readout.collisions === undefined, '超 30 分钟的两条：不算撞单（collisions 键不出现）')

  // ── 四、壳收口：记失败 / 读失败时备注写「这次没落上」，不抛、不改其他格 ──
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
    && vFail.notes[1].indexOf('工作路线这次没落上') === 0 && vFail.notes[1].indexOf('下次上报会重新读盘再补上') >= 0,
    '写失败：备注写「这次没落上」，旧备注与其他格不动：' + JSON.stringify(vFail.notes[1]))
  // 非上报工具与失败回执：壳直接跳过，一个字不加。
  const vOther: any = { status: 'ok', data: { key: '701' }, notes: [] }
  await recordMod.noteWorkRoute(
    { workRouteNote: (i: unknown) => store.note(i), workRouteRead: (i: unknown) => store.read(i), now: () => T0 },
    'deck_issue_get', { sessionId: 's-a', workspaceKey: 'ws-1261', cwd: 'x' }, 'markdown', vOther)
  check(!vOther.data.workRoute && vOther.notes.length === 0, '读工具成功也不记（只认上报）')
  const vBad: any = { status: 'unsupported', data: { key: '999999' }, notes: [] }
  await recordMod.noteWorkRoute(
    { workRouteNote: (i: unknown) => store.note(i), workRouteRead: (i: unknown) => store.read(i), now: () => T0 },
    'deck_issue_report', { sessionId: 's-a', workspaceKey: 'ws-1261', cwd: 'x' }, 'markdown', vBad)
  check(!vBad.data.workRoute && vBad.notes.length === 0, '失败回执不记（连备注都不加）')

  for (const h of [home1, home3, home4]) { try { fs.rmSync(h, { recursive: true, force: true }) } catch { /* 忽略 */ } }
  console.log('共 ' + total + ' 项，' + (failed ? '有失败' : '全部通过'))
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error('  FAIL 异常：' + ((e && e.stack) || e)); process.exit(1) })
