// tests/verify-notification-events.ts —— 门禁：通知事件库（票 #1693，规格 #1681 阶段 2）
//
// 为什么要有它：降级与失败现在只有临时提示，关掉面板或重启就丢历史；这张票把通知做成事件库
// （宿主落盘、工作区共享），但铁律是「当前是否降级永远从快照派生，事件库只记历史」。这扇门禁
// 同时守住这两件事，不然改天有人把「读事件库判降级」当成顺手优化，重启时就会配错对。
//
// 它守六件事（票面「做完判据」逐条对应）：
//   ① 四类事件（降级开始、降级恢复、刷新失败、写失败）都落盘，且同一工作区的另一条路径能读回
//      （模拟重启：同一个临时目录再开一个 store 实例）；
//   ② 事件身份 =（仓库、类型、开始时刻）；恢复只配「未闭合且开始时刻最晚」的一条，重启后不配错，
//      跨仓库不配；没有未闭合的开始就不伪造恢复；
//   ③ 去重只合并瞬时事件、清理只清已闭合的历史，未闭合的降级开始一条不少；
//   ④ 当前是否降级只认快照的 fallback:'rest'（复用 fallbackStandingOf），事件库说降级而快照说
//      没降级时按快照，并把「历史与快照不一致」单列出来（负例能红）；
//   ⑤ 时间参数住中央 YAML（保留期 ttl、去重窗 intervals），条数上限与文本上限是代码常量；
//      两个新模块里没有一个定时器（静态扫描 setInterval / setTimeout）；
//   ⑥ 真实接线：createIssueList 的 adoptSnapshot 漏斗、createSessionRefresh 的失败分支、
//      createDeckExec 的写失败分支都真的把事件交给事件库（用假依赖 + 真 store 跑一遍）。
//
// 反例测试（test-the-test）：把「未闭合的降级开始不被清理」那条断言临时改成相反，等它红一次再修回。

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { printGateResult } from './lib/gate-result.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const GATE = 'verify-notification-events'
let total = 0
let failed = 0

function check(ok: unknown, msg: string): void {
  total += 1
  if (ok) {
    console.log('  PASS ' + msg)
    return
  }
  failed += 1
  console.log('  FAIL ' + msg)
}

const srcText = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const exists = (rel: string): boolean => fs.existsSync(path.join(ROOT, rel))
async function imp(rel: string): Promise<any> {
  return await import(pathToFileURL(path.join(ROOT, rel)).href)
}
function section(title: string): void { console.log('\n## ' + title) }

const KERNEL = 'src/refresh/kernel/notification-events.ts'
const STORE = 'src/refresh/rooms/host/notification-store.ts'
const INSTANT = 'refresh-failed'
const WRITE = 'write-failed'
const START = 'degraded-start'
const RECOVERY = 'degraded-recovery'

// ---------------------------------------------------------------------------
// 0. 文件与静态口径：事件库与快照同目录独立文件；两个新模块不排定时器；时间参数走中央 YAML。
// ---------------------------------------------------------------------------
section('0 文件与静态口径')
check(exists(KERNEL), '纯逻辑模块存在：' + KERNEL)
check(exists(STORE), '落盘模块存在：' + STORE)
const kernelSrc = exists(KERNEL) ? srcText(KERNEL) : ''
const storeSrc = exists(STORE) ? srcText(STORE) : ''
check(!/setInterval|setTimeout/.test(kernelSrc), '纯逻辑模块里没有任何定时器（不新增后台节拍）')
check(!/setInterval|setTimeout/.test(storeSrc), '落盘模块里没有任何定时器（清理挂在写入与读取两头）')
check(storeSrc.includes('NOTIFICATION_EVENT_DEDUPE_MS'), '去重窗引用中央生成的常量，不自己写数字')
check(storeSrc.includes('NOTIFICATION_EVENT_RETENTION_MS'), '保留期引用中央生成的常量，不自己写数字')
check(srcText('config/intervals.yaml').includes('notificationEventDedupeMs:'), '去重窗住 config/intervals.yaml')
check(srcText('config/ttl.yaml').includes('notificationEventRetentionMs:'), '保留期住 config/ttl.yaml')
check(srcText('scripts/generate-time-config.mts').includes("'NOTIFICATION_EVENT_DEDUPE_MS'") && srcText('scripts/generate-time-config.mts').includes("'NOTIFICATION_EVENT_RETENTION_MS'"), '两个键都登记进时间配置生成器的 KEYS 表')
const indexSrc = srcText('src/host/index.ts')
check(indexSrc.includes('notification-store'), '宿主入口动态接线事件库（D7：不静态 import）')
check(indexSrc.includes('noteSnapshot'), '宿主入口把降级开始/恢复的记事件口注入列表取数')
check(indexSrc.includes('noteRefreshFailure'), '宿主入口把刷新失败记事件口注入刷新路')
check(indexSrc.includes('noteWriteFailure'), '宿主入口把写失败记事件口注入代执行')
check(srcText('src/refresh/rooms/host/issue-list-fetch.ts').includes('noteSnapshot'), '列表取数的 adoptSnapshot 漏斗会记降级开始/恢复')
check(srcText('src/refresh/kernel/write-event-detection.ts').includes('isDeckWriteTool'), '写工具表对外可判定（isDeckWriteTool）')

// ---------------------------------------------------------------------------
// 1. 纯逻辑：身份、配对、去重、清理、解析、当前状态从快照派生
// ---------------------------------------------------------------------------
section('1 纯逻辑：身份与恢复配对')
let K: any = null
try { K = await imp(KERNEL) } catch (e) { console.log('  （纯逻辑模块加载失败：' + String(e) + '）') }
check(!!K, '纯逻辑模块能被加载')
if (K) {
  check(K.NOTIFICATION_EVENT_SCHEMA === 1, '事件文件版本是 1（与快照信封同一种版本口径）')
  check(Array.isArray(K.NOTIFICATION_EVENT_TYPES) && K.NOTIFICATION_EVENT_TYPES.length === 4, '四类事件都在类型表里')
  check(K.NOTIFICATION_EVENT_TYPES.join(',') === [START, RECOVERY, INSTANT, WRITE].join(','), '四类事件的名字与票面一致')
  check(K.NOTIFICATION_EVENT_MAX_EVENTS === 500, '条数上限是代码常量 500（票面：上限不用时间配置）')
  check(K.NOTIFICATION_EVENT_MAX_TEXT === 200, '文本裁剪上限是代码常量 200（日志不落长原文）')

  const id1 = K.eventIdOf('acme/demo', WRITE, 1000)
  check(typeof id1 === 'string' && id1.length > 0, '事件身份能拼出字符串')
  check(id1 === K.eventIdOf('acme/demo', WRITE, 1000), '同三要素（仓库、类型、开始时刻）恒等')
  check(id1 !== K.eventIdOf('acme/demo', INSTANT, 1000), '类型不同即不同身份')
  check(id1 !== K.eventIdOf('other/repo', WRITE, 1000), '仓库不同即不同身份')
  check(id1 !== K.eventIdOf('acme/demo', WRITE, 1001), '开始时刻不同即不同身份')

  const startAt = (now: number, repo?: string) => ({ repo: repo || 'acme/demo', now: now, summary: '数据源降级', detail: '主路失败' })
  check(K.openDegradedStartOf([]) === null, '空历史里没有未闭合的降级开始')
  let evs = K.appendDegradedStart([], startAt(1000))
  check(evs.length === 1 && evs[0].type === START && evs[0].repo === 'acme/demo', '降级开始落一条事件')
  check(evs[0].endedAt === null && evs[0].count === 1, '降级开始默认未闭合、次数 1')
  check(K.appendDegradedStart(evs, startAt(1500)).length === 1, '已有一条未闭合的降级开始时不重复记（同一段降级只有一个开始）')
  evs = K.appendDegradedStart(evs, startAt(1600))
  evs = K.appendDegradedRecovery(evs, startAt(2000))
  check(evs.filter((e: any) => e.type === START).length === 1 && evs.filter((e: any) => e.type === RECOVERY).length === 1, '恢复时开始闭合、另记一条恢复事件')
  check(evs[0].endedAt === 2000, '被闭合的开始带上恢复时刻')
  const rec = evs.filter((e: any) => e.type === RECOVERY)[0]
  check(rec && rec.startedAt === evs[0].endedAt, '恢复事件与它配对的那条开始用同一时刻，重启后能对上')
  check(K.appendDegradedRecovery(evs, startAt(2100)).length === evs.length, '没有未闭合的开始时不伪造恢复')
  evs = K.appendDegradedStart(evs, startAt(2200))
  check(K.openDegradedStartOf(evs) !== null && K.openDegradedStartOf(evs).startedAt === 2200, '新一段降级重新开一条未闭合的开始')

  const openEvent = (at: number) => ({ id: K.eventIdOf('acme/demo', START, at), type: START, repo: 'acme/demo', startedAt: at, endedAt: null, count: 1, summary: '降级', detail: '', updatedAt: at })
  const two = [openEvent(1000), openEvent(2000)]
  const open = K.openDegradedStartOf(two)
  check(open !== null && open.startedAt === 2000, '有两条未闭合时只挑开始时刻最晚的那条配对')
  const closedLater = K.appendDegradedRecovery(two, startAt(2500))
  check(closedLater.filter((e: any) => e.type === START && e.startedAt === 2000)[0].endedAt === 2500, '恢复只闭合最晚那条开始')
  check(closedLater.filter((e: any) => e.type === START && e.startedAt === 1000)[0].endedAt === null, '更早那条未闭合的开始原样保留')
  const closedAll = K.appendDegradedRecovery(closedLater, startAt(2600))
  check(closedAll.filter((e: any) => e.type === START).every((e: any) => e.endedAt !== null), '再来一次恢复把剩下那条也闭合')
  check(K.appendDegradedRecovery(K.appendDegradedStart([], startAt(1000)), startAt(1100, 'other/repo')).filter((e: any) => e.repo === 'acme/demo')[0].endedAt === null, '跨仓库的恢复不会误配别人的降级开始')

  section('1b 纯逻辑：去重与清理')
  const inst = (now: number, dedupeMs?: number) => ({ repo: 'acme/demo', now: now, type: INSTANT, summary: '刷新失败', detail: '超时', dedupeMs: dedupeMs || 600 })
  let dedup = K.appendInstant([], inst(1000))
  check(dedup.length === 1 && dedup[0].count === 1, '第一条瞬时事件落一条')
  dedup = K.appendInstant(dedup, inst(1500))
  check(dedup.length === 1 && dedup[0].count === 2, '去重窗内重复出现并入上一条：只把次数加一')
  check(dedup[0].startedAt === 1000 && dedup[0].updatedAt === 1500, '并入时保留首次开始时刻、更新最后时刻')
  dedup = K.appendInstant(dedup, inst(2100))
  check(dedup.length === 2, '超出去重窗后再出现记新的一条')
  const mixed = K.appendInstant(K.appendInstant([], inst(1000)), { repo: 'acme/demo', now: 1001, type: WRITE, summary: '写失败', detail: '拒绝', dedupeMs: 600 })
  check(mixed.length === 2, '不同类型的瞬时事件不互相合并')

  const closed = { id: K.eventIdOf('acme/demo', INSTANT, 1000), type: INSTANT, repo: 'acme/demo', startedAt: 1000, endedAt: 1100, count: 1, summary: '旧', detail: '', updatedAt: 1100 }
  const openOld = { id: K.eventIdOf('acme/demo', START, 1200), type: START, repo: 'acme/demo', startedAt: 1200, endedAt: null, count: 1, summary: '降级', detail: '', updatedAt: 1200 }
  const pruned = K.pruneNotificationEvents([closed, openOld], { now: 100000, retentionMs: 10000, maxEvents: 500 })
  check(pruned.length === 1 && pruned[0].type === START, '按保留期清掉过期的已闭合事件')
  check(pruned[0].endedAt === null, '未闭合的降级开始即使很旧也一条不少（恢复配对只认它）')
  const many = []
  for (let i = 1; i <= 5; i += 1) many.push({ id: K.eventIdOf('acme/demo', INSTANT, i * 1000), type: INSTANT, repo: 'acme/demo', startedAt: i * 1000, endedAt: i * 1000 + 10, count: 1, summary: 'x', detail: '', updatedAt: i * 1000 })
  const capped = K.pruneNotificationEvents(many, { now: 6000, retentionMs: 100000, maxEvents: 3 })
  check(capped.length === 3, '条数超过上限时从最旧的已闭合事件开始删')
  check(capped[capped.length - 1].startedAt === 5000, '留下的都是较新的事件（最新的那条一定在）')
  const cappedOpen = K.pruneNotificationEvents([openOld, many[0]], { now: 6000, retentionMs: 100000, maxEvents: 1 })
  check(cappedOpen.some((e: any) => e.type === START), '上限收紧到 1 时也不删未闭合的降级开始')

  section('1c 纯逻辑：读回、坏文件与当前状态')
  const goodFile = { schema: 1, repo: 'acme/demo', events: [openOld], writtenAtMs: 1200 }
  check(K.parseNotificationEventFile('nope', 'acme/demo').length === 0, '不是对象的文件当空历史（不崩）')
  check(K.parseNotificationEventFile({ schema: 99, repo: 'acme/demo', events: [openOld] }, 'acme/demo').length === 0, '版本不认识的文件当空历史（下一次写入重写）')
  check(K.parseNotificationEventFile(goodFile, 'acme/demo').length === 1, '合法文件能完整读回历史')
  check(K.parseNotificationEventFile({ schema: 1, repo: 'acme/demo', events: [openOld, { ...openOld, repo: 'other/repo' }] }, 'acme/demo').length === 1, '别的仓库的事件不混进本仓库历史')
  check(K.parseNotificationEventFile({ schema: 1, repo: 'acme/demo', events: [openOld, { ...openOld, type: 'bogus' }] }, 'acme/demo').length === 1, '类型不认识的条目丢弃，不影响其余历史')
  const built = K.buildNotificationEventFile('acme/demo', [openOld], 1234)
  check(built.schema === 1 && built.repo === 'acme/demo' && built.writtenAtMs === 1234 && built.events.length === 1, '落盘文件形状：版本、仓库、事件、写入时刻')
  const healthy = { fallback: 'github' }
  check(K.currentDegradedOf({ fallback: 'rest' }, []).degraded === true, '当前是否降级只认快照的 fallback:rest')
  check(K.currentDegradedOf({ fallback: 'rest' }, []).historyMismatch === true, '快照说降级、历史里却没有未闭合开始时单列「不一致」，不伪造开始')
  const snapHealthyEventOpen = K.currentDegradedOf(healthy, [openOld])
  check(snapHealthyEventOpen.degraded === false, '快照说没降级时不从事件库读降级（按快照）')
  check(snapHealthyEventOpen.historyMismatch === true, '快照与历史不一致时如实标出来（负例的判据）')
  check(K.currentDegradedOf({ fallback: 'rest' }, [openOld]).historyMismatch === false, '快照与历史一致时不误报不一致')
  check(K.normalizeRepoKey({ owner: 'Acme', name: 'Demo' }) === 'Acme/Demo' && K.normalizeRepoKey('acme/demo') === 'acme/demo', '仓库键统一成 owner/name 字符串')
  check(K.normalizeRepoKey(null) === '' && K.normalizeRepoKey('') === '', '拿不到仓库时回空串（没有仓库就不产事件）')
  check(K.clipNotificationText('  a   b  ', 10) === 'a b', '事件文本压成一行并去首尾空白')
  check(K.clipNotificationText('x'.repeat(500), 20).length === 20, '事件文本超长按上限裁剪（长原文不落盘）')
}

// ---------------------------------------------------------------------------
// 2. 落盘：同目录独立文件、工作区共享、模拟重启、去重、清理、坏文件
// ---------------------------------------------------------------------------
section('2 落盘与工作区共享')
let S: any = null
let tmp = ''
try { S = await imp(STORE) } catch (e) { console.log('  （落盘模块加载失败：' + String(e) + '）') }
check(!!S, '落盘模块能被加载')
if (S) {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'notif-1693-'))
  let clock = 1000000
  const repoKeys: Record<string, any> = { '/ws': { owner: 'acme', name: 'demo' }, '/ws2': { owner: 'other', name: 'repo' } }
  const fsFacade = {
    resolve: async (p: string) => p,
    readText: async (p: string) => { try { return fs.readFileSync(p, 'utf8') } catch (e) { return '' } },
    writeText: async (p: string, t: string) => { fs.writeFileSync(p, t) },
  }
  const platform = { fs: { resolve: async (p: string) => p }, path: { join: (...xs: string[]) => path.join(...xs) } }
  const depsOf = (extra?: any) => Object.assign({
    fs: fsFacade,
    getPlatform: async () => platform,
    getCacheDir: async () => tmp,
    getRepoKey: async (cwd: string) => (repoKeys[cwd] ? repoKeys[cwd] : null),
    logCtx: null,
    now: () => clock,
    retentionMs: 600000,
    dedupeMs: 60000,
    maxEvents: 10,
  }, extra || {})
  const store = S.createNotificationStore(depsOf())
  const fileOf = (owner: string, name: string) => path.join(tmp, 'notification-events__' + owner + '__' + name + '.json')

  await store.noteSnapshot({ fallback: 'rest', fallbackReason: '主路失败' }, '/ws')
  check(fs.existsSync(fileOf('acme', 'demo')), '事件库落在缓存目录，独立成文件')
  check(fs.readdirSync(tmp).filter((x: string) => x.indexOf('notification-events__acme__demo') === 0).length === 1, '一个仓库一份文件')
  const text1 = fs.readFileSync(fileOf('acme', 'demo'), 'utf8')
  let parsed: any = null
  try { parsed = JSON.parse(text1) } catch (e) {}
  check(parsed && parsed.schema === 1 && parsed.repo === 'acme/demo', '落盘内容是带版本与仓库的文件（复用快照信封的版本语义）')
  let ev = await store.read('/ws')
  check(ev.length === 1 && ev[0].type === START && ev[0].endedAt === null, '降级开始读得回来且未闭合')
  check(typeof ev[0].detail === 'string' && ev[0].detail.indexOf('主路失败') >= 0, '降级原因带进事件详情（只记短文本）')
  await store.noteSnapshot({ fallback: 'rest' }, '/ws')
  ev = await store.read('/ws')
  check(ev.length === 1, '降级常驻期间反复写快照不重复记开始')
  await store.noteSnapshot({ fallback: 'github' }, '/ws')
  ev = await store.read('/ws')
  check(ev.length === 2 && ev.filter((e: any) => e.type === START)[0].endedAt !== null, '恢复时开始闭合并另记一条恢复')
  check(ev.filter((e: any) => e.type === RECOVERY).length === 1, '恢复事件只有一条')

  section('2b 模拟重启：新实例读同一目录、配对不配错')
  clock += 1000
  const store2 = S.createNotificationStore(depsOf())
  const reread = await store2.read('/ws')
  check(reread.length === 2, '重启后（新实例）能读回同一份历史')
  await store2.noteSnapshot({ fallback: 'rest' }, '/ws')
  let ev2 = await store2.read('/ws')
  check(ev2.filter((e: any) => e.type === START && e.endedAt === null).length === 1, '重启后新的降级能重新开一条未闭合的开始')
  clock += 500
  await S.createNotificationStore(depsOf()).noteSnapshot({ fallback: 'github' }, '/ws')
  ev2 = await store2.read('/ws')
  const reopened = ev2.filter((e: any) => e.type === START && e.endedAt === null)
  check(reopened.length === 0, '重启后恢复只配未闭合且开始时刻最晚的一条，不配错对')
  check(ev2.filter((e: any) => e.type === RECOVERY).length === 2, '两段降级各得一条恢复')

  section('2c 去重与写失败')
  clock += 1000
  await store.noteRefreshFailure('/ws', new Error('超时'))
  await store.noteRefreshFailure('/ws', new Error('超时'))
  let ev3 = await store.read('/ws')
  let refreshEvents = ev3.filter((e: any) => e.type === INSTANT)
  check(refreshEvents.length === 1 && refreshEvents[0].count === 2, '去重窗内两次刷新失败合并成一条、次数 2')
  clock += 120000
  await store.noteRefreshFailure('/ws', new Error('又超时'))
  ev3 = await store.read('/ws')
  refreshEvents = ev3.filter((e: any) => e.type === INSTANT)
  check(refreshEvents.length === 2, '超出去重窗后再记一条')
  await store.noteWriteFailure({ tool: 'deck_issue_patch', cwd: '/ws', status: 'failed', reason: '被拒绝' })
  ev3 = await store.read('/ws')
  const writeEvents = ev3.filter((e: any) => e.type === WRITE)
  check(writeEvents.length === 1 && writeEvents[0].detail.indexOf('deck_issue_patch') >= 0, '写失败落盘且带上工具名')
  check(writeEvents[0].summary.length <= 200 && writeEvents[0].detail.length <= 200, '事件摘要与详情都按上限裁剪')

  section('2d 工作区隔离、拿不到仓库、坏文件、清理')
  await store.noteSnapshot({ fallback: 'rest' }, '/ws2')
  const evOther = await store.read('/ws2')
  check(evOther.length === 1 && evOther[0].repo === 'other/repo', '另一个仓库的事件落在自己的文件里（按工作区共享、互不串）')
  check(fs.existsSync(fileOf('other', 'repo')), '第二个仓库也有自己的事件文件')
  const evWsStill = await store.read('/ws')
  check(evWsStill.filter((e: any) => e.type === START && e.endedAt === null).length === 0, '另一个仓库记降级不影响本仓库未闭合状态')
  const noRepoEvents = await store.noteRefreshFailure('/no-repo', new Error('x'))
  check(noRepoEvents === null, '拿不到仓库坐标时不产事件（markdown 这类没有 GitHub 仓库的后端不记历史）')
  check((await store.read('/no-repo')).length === 0, '拿不到仓库时读回空历史')
  fs.writeFileSync(fileOf('acme', 'demo'), '{ this is not json')
  check((await store.read('/ws')).length === 0, '坏 JSON 当空历史，不崩')
  await store.noteRefreshFailure('/ws', new Error('坏文件后第一条'))
  const rewritten = JSON.parse(fs.readFileSync(fileOf('acme', 'demo'), 'utf8'))
  check(rewritten.schema === 1 && Array.isArray(rewritten.events) && rewritten.events.length === 1, '坏文件之后的下一笔写入重写成合法文件')

  clock += 1000000
  fs.writeFileSync(fileOf('acme', 'demo'), JSON.stringify({ schema: 1, repo: 'acme/demo', events: [
    { id: K.eventIdOf('acme/demo', INSTANT, 1000), type: INSTANT, repo: 'acme/demo', startedAt: 1000, endedAt: 1100, count: 1, summary: '旧', detail: '', updatedAt: 1100 },
  ], writtenAtMs: 1100 }))
  const prunedOnRead = await store.read('/ws')
  check(prunedOnRead.length === 0, '读取时清理：已闭合且超过保留期的历史不再返回')
  const afterReadFile = JSON.parse(fs.readFileSync(fileOf('acme', 'demo'), 'utf8'))
  check(afterReadFile.events.length === 0, '清理挂在读取节拍上：清理结果当场落盘')

  section('2e 并发串行走一条链、写入失败不抛')
  const store3 = S.createNotificationStore(depsOf())
  clock += 5000
  await Promise.all([store3.noteRefreshFailure('/ws', new Error('并发')), store3.noteRefreshFailure('/ws', new Error('并发')), store3.noteRefreshFailure('/ws', new Error('并发')), store3.noteRefreshFailure('/ws', new Error('并发')), store3.noteRefreshFailure('/ws', new Error('并发'))])
  const evCon = (await store3.read('/ws')).filter((e: any) => e.type === INSTANT)
  check(evCon.length === 1 && evCon[0].count === 5, '并发写入串成一条链：五次瞬时事件合并成一条、次数 5')
  const storeBroken = S.createNotificationStore(depsOf({ fs: { resolve: async (p: string) => p, readText: async () => { throw new Error('read down') }, writeText: async () => { throw new Error('write down') } } }))
  const brokenNote = await storeBroken.noteRefreshFailure('/ws', new Error('x'))
  check(brokenNote === null, '事件库读写失败时安静返回，不影响主流程')
  check((await storeBroken.read('/ws')).length === 0, '读盘失败时回空历史，不抛')
}

// ---------------------------------------------------------------------------
// 3. 真实接线：三个漏斗把事件交给事件库（假依赖 + 真 store）
// ---------------------------------------------------------------------------
section('3 真实接线：降级开始/恢复、刷新失败、写失败')
if (S) {
  let clock = 5000000
  const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'notif-wire-1693-'))
  const fsFacade = {
    resolve: async (p: string) => p,
    readText: async (p: string) => { try { return fs.readFileSync(p, 'utf8') } catch (e) { return '' } },
    writeText: async (p: string, t: string) => { fs.writeFileSync(p, t) },
  }
  const platform = { fs: { resolve: async (p: string) => p }, path: { join: (...xs: string[]) => path.join(...xs) } }
  const wireStore = S.createNotificationStore({ fs: fsFacade, getPlatform: async () => platform, getCacheDir: async () => tmp2, getRepoKey: async () => ({ owner: 'acme', name: 'demo' }), logCtx: null, now: () => clock, retentionMs: 600000, dedupeMs: 60000, maxEvents: 10 })
  const repo = { owner: 'acme', name: 'demo' }

  const listMod = await imp('src/refresh/rooms/host/issue-list-fetch.ts')
  const list = listMod.createIssueList({
    getRepoKey: async () => repo,
    setCache: () => {},
    issueIndexFromSnapshot: () => [],
    issueIndexChanged: () => false,
    rememberIssueIndex: () => {},
    readDiskCache: () => null,
    logCtx: null,
    noteSnapshot: async (snap: any, cwd: any) => await wireStore.noteSnapshot(snap, cwd),
  })
  await list.adoptSnapshot({ repo: repo, fallback: 'rest', fallbackReason: '主路失败' }, '/ws')
  let wireEvents = await wireStore.read('/ws')
  check(wireEvents.filter((e: any) => e.type === START && e.endedAt === null).length === 1, '列表取数采纳降级快照时会记一条未闭合的降级开始')
  await list.adoptSnapshot({ repo: repo }, '/ws')
  wireEvents = await wireStore.read('/ws')
  check(wireEvents.filter((e: any) => e.type === RECOVERY).length === 1, '采纳恢复正常后的快照时记一条恢复（与当前状态同一个派生口）')

  const refreshMod = await imp('src/refresh/rooms/host/session-refresh-schedule.ts')
  const refresh = refreshMod.createSessionRefresh({
    canonicalKey: async (c: string) => c,
    selectEarly: async () => { throw new Error('早选失败') },
    errText: (e: any) => String((e && e.message) || e),
    getCache: () => null,
    setCache: () => {},
    logCtx: null,
    envelope: { buildSnap: () => ({}), withWorkRouteTable: async (r: any) => r },
    noteRefreshFailure: async (cwd: any, err: any) => await wireStore.noteRefreshFailure(cwd, err),
  })
  const refreshed = await refresh.handleRefresh({ cwd: '/ws' })
  check(refreshed && refreshed.ok === false, '刷新失败仍然如实回失败（不假装成功）')
  wireEvents = await wireStore.read('/ws')
  check(wireEvents.filter((e: any) => e.type === INSTANT).length === 1, '刷新失败会记进事件库')
  check(wireEvents.filter((e: any) => e.type === INSTANT)[0].detail.indexOf('早选失败') >= 0, '刷新失败的原因带进事件详情')

  const deckMod = await imp('src/deck/registration/host-delegate.ts')
  const failingTable = async () => ({ tools: {
    deck_issue_patch: { run: async () => ({ status: 'failed', text: '拒绝', reason: 'nope' }) },
    deck_issue_get: { run: async () => ({ status: 'failed', text: '拒绝', reason: 'nope' }) },
  } })
  const deck = deckMod.createDeckExec({ getTable: failingTable, logCtx: null, noteWriteFailure: async (info: any) => await wireStore.noteWriteFailure(info) })
  await deck.handleDeckExec({ tool: 'deck_issue_patch', args: {}, session: { cwd: '/ws' } })
  let deckEvents = (await wireStore.read('/ws')).filter((e: any) => e.type === WRITE)
  check(deckEvents.length === 1 && deckEvents[0].detail.indexOf('deck_issue_patch') >= 0, '写工具失败会记进事件库（写失败一类）')
  await deck.handleDeckExec({ tool: 'deck_issue_get', args: {}, session: { cwd: '/ws' } })
  deckEvents = (await wireStore.read('/ws')).filter((e: any) => e.type === WRITE)
  check(deckEvents.length === 1, '读工具失败不记成写失败（只记写工具）')
  const deckSilent = deckMod.createDeckExec({ getTable: failingTable, logCtx: null })
  await deckSilent.handleDeckExec({ tool: 'deck_issue_patch', args: {}, session: { cwd: '/ws' } })
  check((await wireStore.read('/ws')).filter((e: any) => e.type === WRITE).length === 1, '没有接事件库时写失败静默跳过，不影响失败回执')
}

console.log('\nverify-notification-events：共 ' + total + ' 条断言，失败 ' + failed + ' 条')
printGateResult(GATE, total, failed ? 1 : 0)
process.exit(failed ? 1 : 0)
