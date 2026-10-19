// verify-714-session-tickets.ts —— 门禁：会话↔票 工作路线（数据侧，票 #714 / T10；#1083 改留存规则）
// 用法：在插件根目录执行 node --import ./scripts/ts-hook.mts tests/verify-714-session-tickets.ts，可独立运行。
//
// 这张门禁守的是票面点名的那几条，一条都不能少（每一条对应下面的一段断言）：
//   1. **两条链互不覆盖**：会话 A 写 3 张、会话 B 写 2 张，各自数各自的（同一个仓库开着两个会话时
//      串台，是票面点名的失败现场）。
//   2. **重启后从落盘恢复**：丢掉内存、照同一个缓存目录另起一个实例，两格链都回到原样。
//   3. **落盘文件里搜不到原文**：原始工作区路径、命令行原文、票文件路径、会话 id 原文，一个都不许出现
//      （旧缓存自己的隐私红线：落盘只存散列与票键；新存档换了白名单口径，见 ADR 20261019）。
//   4. **同会话连读 20 张票，链里一张都不增加**：只记写与明确的处理动作；这一条是票面加固补充里
//      点名要补的核心规则（否则链会被噪音灌满，界面显示一堆假任务）。
//   5. 留存规则（#1083 改口径）：去重、时间倒序；**没有每会话条数上限**；超过 30 天的条目在下一次
//      落盘前清掉，整份仍超过 2MB 就按时间从旧到新裁到 2MB 以下。
//
// 旧事件退役：#1083 起这一路的写入不再发 sessionTickets.chain，新存档（work-path-store）另发
// workRoute.write / workRoute.read；事件与字段的守门在 tests/verify-log-fields.ts 与
// tests/verify-log-count.ts，行为与隐私在 tests/verify-1083-work-path-persist.ts。
//
// 门禁归属: src/shared/refresh/src/chain-prune.ts（30 天/2MB 两条线与共用二分住在这里）
// 门禁归属: src/host/refresh/workRoute.ts（链的落盘前裁剪 chainPrune 住在这里）
//
// 反证（每次运行都跑，见文末「反证」一段）：门禁的判据本身会被坏实现打红 ——
//   ① 键里少了会话段（那正是「同根多会话互相覆盖」的那个坏实现）→ 记不进去；
//   ② 读工具那一路被当成写（那正是「链被噪音灌满」的那个坏实现）→ 20 张读会多出 20 条；
//   ③ 落盘那份里混进路径原文 → 隐私自检必须认出来。
const fs = require('fs')
const os = require('os')
const path = require('path')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok: boolean, msg: string): void => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

async function main() {
  console.log('会话↔票 工作路线门禁（#714 / #1083：按会话分格、只记写、30 天与 2MB 两条留存线、落盘只存散列与票键、重启能恢复）')
  const chain = await import(pathToFileURL(path.join(ROOT, 'src', 'shared', 'refresh', 'chain.js')).href)
  const chainPruneMod = await import(pathToFileURL(path.join(ROOT, 'src', 'shared', 'refresh', 'chain-prune.js')).href)
  const mod = await import(pathToFileURL(path.join(ROOT, 'src', 'host', 'refresh', 'workRoute.js')).href)
  const chainPruneFn = mod.chainPrune
  check(typeof mod.createWorkRoute === 'function', '宿主半导出 createWorkRoute（内存表与落盘在 JS 这一侧）')
  check(chain.CHAIN_SESSION_CAP === undefined, '每会话 20 张的旧上限已删除（不再有 CHAIN_SESSION_CAP）')
  check(chainPruneMod.CHAIN_KEEP_MS === 30 * 24 * 60 * 60 * 1000 && chainPruneMod.CHAIN_MAX_BYTES === 2 * 1024 * 1024,
    '留存两条线在纯逻辑里只有一处（30 天 / 2MB，实得 ' + chainPruneMod.CHAIN_KEEP_MS + ' 毫秒、' + chainPruneMod.CHAIN_MAX_BYTES + ' 字节）')

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-714-'))
  const ROOT_KEY = 'D:\\proj\\deck'                    // 工作区根原文：只该以散列形态出现
  const CMD_A = 'gh issue comment 703 --body "见 #12 的讨论"'  // 命令原文：一个字都不许落盘
  const TICKET_FILE = 'D:\\proj\\deck\\docs\\issues\\0009-改名票.md' // markdown 后端的票文件路径
  const SID_A = 'sess-aaaa-1111-2222'
  const SID_B = 'sess-bbbb-3333-4444'
  let clock = 1700000000000
  const now = (): number => (clock += 1000)
  const app = mod.createWorkRoute({ cacheDir: dir, now: now })

  // ── 一、会话 A 写 3 张、会话 B 写 2 张：三个来源各走一遍 ────────────────────────
  const w = (input: Record<string, unknown>) => app.note(Object.assign({ rootKey: ROOT_KEY, backend: 'github' }, input))
  const a1 = await w({ sessionId: SID_A, source: 'tool-args', tool: 'deck_issue_create', tier: 'write-confirmed', args: { issue: 701 } })
  const a2 = await w({ sessionId: SID_A, source: 'tool-args', tool: 'deck_issue_patch', tier: 'write-confirmed', args: { number: 702 } })
  const a3 = await w({ sessionId: SID_A, source: 'cli', tool: 'pwsh', tier: 'write-confirmed', reason: 'cmd.gh-write', verb: 'comment', ticketKey: '703' })
  const b1 = await w({ sessionId: SID_B, source: 'tool-args', tool: 'deck_issue_create', tier: 'write-confirmed', args: { issue: 801 } })
  const b2 = await w({ sessionId: SID_B, source: 'tool-args', tool: 'deck_map_link', tier: 'write-confirmed', args: { child: 802 } })
  check(a1.recorded && a2.recorded && a3.recorded && b1.recorded && b2.recorded, '五条写各记进链（' + [a1, a2, a3, b1, b2].map((r) => r.action).join('、') + '）')
  check(app.sizeOf(SID_A) === 3 && app.sizeOf(SID_B) === 2, '两条链互不覆盖：会话 A 3 张、会话 B 2 张（实得 A ' + app.sizeOf(SID_A) + ' 张、B ' + app.sizeOf(SID_B) + ' 张）')
  check(chain.chainSessionShardId(SID_A) !== chain.chainSessionShardId(SID_B), '两个会话落在两个格子里（分格散列不同）')
  const ea = app.entriesOf(SID_A)
  check(ea.map((e) => e.ticketKey).join(',') === '703,702,701', '按时间倒序（最新在前）且票键归一（实得 ' + ea.map((e) => e.ticketKey).join(',') + '）')
  check(ea[0].action === 'comment' && ea[1].action === 'edit' && ea[2].action === 'create', '动作类别记下来了（' + ea.map((e) => e.action).join('、') + '）')

  // ── 二、只记写不记读：连读 20 张票，链里一张都不增加 ────────────────────────
  const beforeReads = app.sizeOf(SID_A)
  const shardsBeforeReads = app.snapshot().length
  for (let i = 0; i < 20; i++) {
    await w({ sessionId: SID_A, source: 'tool-args', tool: 'deck_issue_get', tier: 'default-tick', reason: 'tool.deck-read', args: { issue: 900 + i } })
  }
  await w({ sessionId: SID_A, source: 'cli', tool: 'pwsh', tier: 'default-tick', reason: 'cmd.gh-read', verb: 'view', ticketKey: '905' })
  await w({ sessionId: SID_A, source: 'markdown-file', tool: 'read', tier: 'default-tick', reason: 'tool.local-read', path: TICKET_FILE })
  check(app.sizeOf(SID_A) === beforeReads, '同会话连读 20 张票之后链里一张都不增加（读前 ' + beforeReads + ' 张、读后 ' + app.sizeOf(SID_A) + ' 张）')
  check(app.snapshot().length === shardsBeforeReads, '读那一路连一格链都不新增（读前 ' + shardsBeforeReads + ' 格、读后 ' + app.snapshot().length + ' 格）')
  check(app.stats().filtered >= 22, '这些读都被记成「过滤掉了」而不是没看见（filtered ' + app.stats().filtered + '）')

  // ── 三、markdown 后端那条来源：改票文件是写，看票文件还是读 ──────────────────
  const mdWrite = await w({ sessionId: SID_A, backend: 'markdown', source: 'markdown-file', tool: 'write', path: TICKET_FILE })
  check(mdWrite.recorded && mdWrite.ticketKey === '9' && mdWrite.action === 'file-write', 'markdown 后端：改票文件从路径里认出编号并记成写（票键 ' + mdWrite.ticketKey + '、类别 ' + mdWrite.action + '）')
  const mdReadAfter = await w({ sessionId: SID_A, backend: 'markdown', source: 'markdown-file', tool: 'read', path: TICKET_FILE })
  check(!mdReadAfter.recorded && mdReadAfter.reason === 'chain.read-excluded', 'markdown 后端：看票文件仍然不记（' + mdReadAfter.reason + '）')

  // ── 四、去重与「不再按张数封顶」：同一张票只留一条，25 张全留 ──────────────────
  await w({ sessionId: SID_A, source: 'tool-args', tool: 'deck_issue_patch', tier: 'write-confirmed', args: { issue: 701 } })
  const afterDedupe = app.entriesOf(SID_A)
  check(afterDedupe.length === 4, '同一张票再写一次不新增一条（去重后 4 条）')
  check(afterDedupe[0].ticketKey === '701' && afterDedupe[0].action === 'edit', '重复出现的那张票挪到最前并刷新动作（' + afterDedupe[0].ticketKey + ' / ' + afterDedupe[0].action + '）')
  const SID_C = 'sess-cccc-5555-6666'
  for (let i = 1; i <= 25; i++) await w({ sessionId: SID_C, source: 'tool-args', tool: 'deck_issue_create', tier: 'write-confirmed', args: { issue: 1000 + i } })
  const ec = app.entriesOf(SID_C)
  check(ec.length === 25, '不再按每会话 20 张封顶：写了 25 张留 25 张（实得 ' + ec.length + ' 张）')
  check(ec[0].ticketKey === '1025' && ec[24].ticketKey === '1001', '按时间倒序全留（最新 ' + ec[0].ticketKey + '、最旧 ' + ec[24].ticketKey + '）')

  // ── 五、落盘：只存散列与票键，原文一个都搜不到 ──────────────────────────────
  const file = path.join(dir, mod.SESSION_TICKETS_FILE)
  check(fs.existsSync(file), '缓存落在工作区缓存目录下的 ' + mod.SESSION_TICKETS_FILE)
  const text = fs.readFileSync(file, 'utf8')
  const notFound = (needle: string, what: string) => check(text.indexOf(needle) < 0, '落盘文件里搜不到' + what + '（' + JSON.stringify(needle.slice(0, 28)) + '）')
  notFound(ROOT_KEY, '原始工作区路径')
  notFound('D:\\proj', '路径的目录段')
  notFound(CMD_A, '命令行原文')
  notFound('gh issue', '命令的原文片段')
  notFound(TICKET_FILE, 'markdown 票文件路径')
  notFound('0009-', '票文件名的标题段')
  notFound(SID_A, '会话 id 原文')
  notFound(SID_B, '另一个会话的 id 原文')
  check(text.indexOf(chain.chainSessionShardId(SID_A)) >= 0, '落盘里留着会话的散列（恢复靠它认回是哪一格）')
  const parsed = JSON.parse(text)
  check(parsed.v === chain.CHAIN_DISK_VERSION && Array.isArray(parsed.shards) && parsed.shards.length === 3, '落盘形状：版本号 + 三格链（' + parsed.shards.length + ' 格）')
  const row = parsed.shards[0].e[0]
  check(Array.isArray(row) && row.length === 4 && typeof row[0] === 'string' && typeof row[1] === 'string' && typeof row[2] === 'number' && typeof row[3] === 'string',
    '每一条只存四样：票键、工作单元、时间、动作类别（' + JSON.stringify(row) + '）')
  // #783：老版本三元组仍能读回（工作单元按空串处理）；形状不对与版本不认识仍整份丢弃。
  const oldPayload = { v: 1, at: 0, shards: [{ s: chain.chainSessionShardId(SID_A), r: chain.chainRootHash(ROOT_KEY), b: 'github', e: [['701', 1700000000000, 'create']] }] }
  const oldRead = chain.chainFromDisk(oldPayload)
  check(oldRead.state && oldRead.entries === 1 && oldRead.shards === 1, '老落盘三元组仍能读回（v1 兼容）')
  const oldEntries = chain.chainEntriesOf(oldRead.state, SID_A)
  check(oldEntries.length === 1 && oldEntries[0].ticketKey === '701' && oldEntries[0].effortId === '', '老记录的工作单元按空串处理（' + JSON.stringify(oldEntries[0]) + '）')

  // ── 六、重启：丢掉内存、照同一个缓存目录另起一个实例，从落盘恢复 ────────────────
  const revived = mod.createWorkRoute({ cacheDir: dir, now: now })
  check(revived.sizeOf(SID_A) === 0, '新实例刚起来时内存是空的（重启现场）')
  const r = await revived.restore({ rootKey: ROOT_KEY })
  check(r.cache === 'hit' && r.restored === 3, '从落盘读回三格链（cache ' + r.cache + '、格数 ' + r.restored + '）')
  check(revived.sizeOf(SID_A) === 4 && revived.sizeOf(SID_B) === 2 && revived.sizeOf(SID_C) === 25,
    '重启后两条链都回到原样（A ' + revived.sizeOf(SID_A) + ' 张、B ' + revived.sizeOf(SID_B) + ' 张、C ' + revived.sizeOf(SID_C) + ' 张）')
  check(revived.entriesOf(SID_A)[0].ticketKey === '701' && revived.entriesOf(SID_A)[3].ticketKey === '702',
    '恢复后顺序与动作类别都还在（' + revived.entriesOf(SID_A).map((e) => e.ticketKey + ':' + e.action).join('、') + '）')

  // ── 七、留存口径与日志（#1083：30 天 / 2MB 两条线；旧事件已退役）────────────────
  const st = app.stats()
  check(st.keepMs === chainPruneMod.CHAIN_KEEP_MS && st.maxBytes === chainPruneMod.CHAIN_MAX_BYTES, 'stats() 报出两条留存线（' + st.keepMs + ' 毫秒 / ' + st.maxBytes + ' 字节）')
  // 30 天清理走公开路径：拨过 30 天再落一次盘，旧条目清掉、返回里带裁掉的条数。
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-714-prune-'))
  let clock2 = 1700000000000
  const app2 = mod.createWorkRoute({ cacheDir: dir2, now: () => clock2 })
  const SID_D = 'sess-dddd-7777-8888'
  const dw = (issue: number) => app2.note({ rootKey: ROOT_KEY, backend: 'github', sessionId: SID_D, source: 'tool-args', tool: 'deck_issue_create', tier: 'write-confirmed', args: { issue: issue } })
  await dw(1101)
  await dw(1102)
  clock2 = 1700000000000 + 31 * 24 * 60 * 60 * 1000
  const flushed = await app2.flush()
  check(flushed.ok === true && flushed.pruned === 2, '超过 30 天的条目在下一次落盘前清掉（pruned ' + flushed.pruned + ' 条，落盘 ' + flushed.reason + '）')
  check(app2.sizeOf(SID_D) === 0, '清掉以后内存里也不留（实得 ' + app2.sizeOf(SID_D) + ' 张）')
  // 2MB 那条线在纯逻辑上直测：300 条压到 1200 字节上限，最新的必须还在。
  const SID_E = 'sess-eeee-9999-0000'
  let big = chain.createChainState()
  for (let i = 1; i <= 300; i++) {
    big = chain.chainRecord(big, { sessionId: SID_E, rootHash: chain.chainRootHash(ROOT_KEY), backend: 'github', ticketKey: String(i), action: 'create', at: 1700000000000 + i }).state
  }
  const capped = chainPruneFn(big, { at: 1700000000000 + 400, maxBytes: 1200 })
  const cappedEntries = chain.chainEntriesOf(capped.state, SID_E)
  check(capped.bytes <= 1200 && capped.dropped > 0 && cappedEntries.length > 0 && cappedEntries[0].ticketKey === '300',
    '整份超过上限时按时间从旧到新裁：最新的在、旧的不在（' + capped.bytes + ' 字节 ≤ 1200，裁掉 ' + capped.dropped + ' 条）')

  // ── 八、反证：门禁的判据能被坏实现打红（每次运行都跑）────────────────────────
  check(chain.chainEntryKey({ rootHash: chain.chainRootHash(ROOT_KEY), backend: 'github', ticketKey: '701' }) === '',
    '反证①：键里少了会话段就不成立 —— 那正是「同根多会话互相覆盖」的坏实现，会被这一步挡住')
  const noSession = await app.note({ rootKey: ROOT_KEY, backend: 'github', source: 'tool-args', tool: 'deck_issue_create', tier: 'write-confirmed', args: { issue: 777 } })
  check(!noSession.recorded && noSession.reason === 'chain.bad-shard', '反证①（续）：说不出是哪个会话就不记（' + noSession.reason + '）')
  const verdictRead = chain.chainVerdictOf({ source: 'tool-args', tool: 'deck_issue_get', tier: 'default-tick', reason: 'tool.deck-read', args: { issue: 901 } })
  const verdictWrite = chain.chainVerdictOf({ source: 'tool-args', tool: 'deck_issue_create', tier: 'write-confirmed', args: { issue: 901 } })
  check(verdictRead.record === false && verdictWrite.record === true,
    '反证②：同一个票号，读不记、写才记 —— 坏实现（把读也记上）会让 20 张读多出 20 条，本门禁第 2 条立刻红')
  const dirty = chain.chainPrivacyViolations({ v: 1, shards: [{ s: 'x', r: 'D:\\proj\\deck', b: 'github', e: [['701', 1, 'create']] }] })
  check(dirty.length === 1 && /路径原文/.test(dirty[0]), '反证③：隐私自检认得出混进落盘那份里的路径原文（' + dirty[0] + '）')
  const cleanOut = chain.chainToDisk({ shards: { z: { shardId: 'z', sessionId: SID_A, rootHash: ROOT_KEY, backend: 'github', entries: [{ ticketKey: '1', at: 1, action: 'create' }] } } })
  check(cleanOut.shards.length === 0, '反证③（续）：根那一栏放的是路径原文时，落盘形状直接把它丢掉（写不出原文）')

  try { fs.rmSync(dir, { recursive: true, force: true }) } catch (e) { /* 临时目录清不掉不影响结论 */ }
  try { fs.rmSync(dir2, { recursive: true, force: true }) } catch (e) { /* 同上 */ }
  console.log(failed ? '\n存在失败 — verify-714-session-tickets 未通过' : '\n全部通过 — 会话↔票 工作路线门禁生效（' + total + ' 项断言）')
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error('门禁执行异常：' + ((e && e.stack) || e))
  process.exit(1)
})
