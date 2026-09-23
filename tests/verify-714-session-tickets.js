// verify-714-session-tickets.js —— 门禁：会话↔票 处理链（数据侧，票 #714 / T10）
// 用法：在插件根目录执行 node tests/verify-714-session-tickets.js，可独立运行。
//
// 这张门禁守的是票面点名的那几条，一条都不能少（每一条对应下面的一段断言）：
//   1. **两条链互不覆盖**：会话 A 写 3 张、会话 B 写 2 张，各自数各自的（同一个仓库开着两个会话时
//      串台，是票面点名的失败现场）。
//   2. **重启后从落盘恢复**：丢掉内存、照同一个缓存目录另起一个实例，两格链都回到原样。
//   3. **落盘文件里搜不到原文**：原始工作区路径、命令行原文、票文件路径、会话 id 原文，一个都不许出现
//      （隐私红线：落盘只存散列与票键）。
//   4. **同会话连读 20 张票，链里一张都不增加**：只记写与明确的处理动作；这一条是票面加固补充里
//      点名要补的核心规则（否则链会被噪音灌满，界面显示一堆假任务）。
//   5. 留存规则：去重、时间倒序、每会话 20 张封顶、超过丢最旧的。
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
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

/** 假日志出口：收下每一行与字段键，用来断言「读那一路一条都不记」与字段白名单。 */
function makeLogCtx() {
  const lines = []
  return {
    lines: lines,
    fire: (level, event, fields) => { lines.push({ level: level, event: event, fields: typeof fields === 'function' ? fields() : fields }) },
    isEnabled: (level) => level === 'error' || level === 'warn' || level === 'info',
  }
}

/** 本票认的全部字段（与 489 附录 #78 那一行逐字一致）。 */
const ALLOWED_FIELDS = ['sidHash', 'rootHash', 'kind', 'ok', 'action', 'count']

async function main() {
  console.log('会话↔票 处理链门禁（#714：按会话分格、只记写、留 20 张、落盘只存散列与票键、重启能恢复）')
  const chain = await import(pathToFileURL(path.join(ROOT, 'src', 'shared', 'refresh', 'chain.js')).href)
  const mod = await import(pathToFileURL(path.join(ROOT, 'src', 'host', 'refresh', 'sessionTickets.js')).href)
  check(typeof mod.createSessionTickets === 'function', '宿主半导出 createSessionTickets（内存表与落盘在 JS 这一侧）')
  check(chain.CHAIN_SESSION_CAP === 20, '每会话 20 张这个数在纯逻辑里只有一处（实得 ' + chain.CHAIN_SESSION_CAP + '）')

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-714-'))
  const ROOT_KEY = 'D:\\proj\\deck'                    // 工作区根原文：只该以散列形态出现
  const CMD_A = 'gh issue comment 703 --body "见 #12 的讨论"'  // 命令原文：一个字都不许落盘
  const TICKET_FILE = 'D:\\proj\\deck\\docs\\issues\\0009-改名票.md' // markdown 后端的票文件路径
  const SID_A = 'sess-aaaa-1111-2222'
  const SID_B = 'sess-bbbb-3333-4444'
  let clock = 1700000000000
  const now = () => (clock += 1000)
  const logCtx = makeLogCtx()
  const app = mod.createSessionTickets({ cacheDir: dir, now: now, logCtx: logCtx })

  // ── 一、会话 A 写 3 张、会话 B 写 2 张：三个来源各走一遍 ────────────────────────
  const w = (input) => app.note(Object.assign({ rootKey: ROOT_KEY, backend: 'github' }, input))
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
  const linesBeforeReads = logCtx.lines.length
  for (let i = 0; i < 20; i++) {
    await w({ sessionId: SID_A, source: 'tool-args', tool: 'deck_issue_get', tier: 'default-tick', reason: 'tool.deck-read', args: { issue: 900 + i } })
  }
  await w({ sessionId: SID_A, source: 'cli', tool: 'pwsh', tier: 'default-tick', reason: 'cmd.gh-read', verb: 'view', ticketKey: '905' })
  await w({ sessionId: SID_A, source: 'markdown-file', tool: 'read', tier: 'default-tick', reason: 'tool.local-read', path: TICKET_FILE })
  check(app.sizeOf(SID_A) === beforeReads, '同会话连读 20 张票之后链里一张都不增加（读前 ' + beforeReads + ' 张、读后 ' + app.sizeOf(SID_A) + ' 张）')
  check(logCtx.lines.length === linesBeforeReads, '读那一路连日志都不落一行（读前 ' + linesBeforeReads + ' 行、读后 ' + logCtx.lines.length + ' 行）')
  check(app.stats().filtered >= 22, '这些读都被记成「过滤掉了」而不是没看见（filtered ' + app.stats().filtered + '）')

  // ── 三、markdown 后端那条来源：改票文件是写，看票文件还是读 ──────────────────
  const mdWrite = await w({ sessionId: SID_A, backend: 'markdown', source: 'markdown-file', tool: 'write', path: TICKET_FILE })
  check(mdWrite.recorded && mdWrite.ticketKey === '9' && mdWrite.action === 'file-write', 'markdown 后端：改票文件从路径里认出编号并记成写（票键 ' + mdWrite.ticketKey + '、类别 ' + mdWrite.action + '）')
  const mdReadAfter = await w({ sessionId: SID_A, backend: 'markdown', source: 'markdown-file', tool: 'read', path: TICKET_FILE })
  check(!mdReadAfter.recorded && mdReadAfter.reason === 'chain.read-excluded', 'markdown 后端：看票文件仍然不记（' + mdReadAfter.reason + '）')

  // ── 四、去重与封顶：同一张票只留一条，超过 20 张丢最旧的 ──────────────────────
  await w({ sessionId: SID_A, source: 'tool-args', tool: 'deck_issue_patch', tier: 'write-confirmed', args: { issue: 701 } })
  const afterDedupe = app.entriesOf(SID_A)
  check(afterDedupe.length === 4, '同一张票再写一次不新增一条（去重后 4 条）')
  check(afterDedupe[0].ticketKey === '701' && afterDedupe[0].action === 'edit', '重复出现的那张票挪到最前并刷新动作（' + afterDedupe[0].ticketKey + ' / ' + afterDedupe[0].action + '）')
  const SID_C = 'sess-cccc-5555-6666'
  for (let i = 1; i <= 25; i++) await w({ sessionId: SID_C, source: 'tool-args', tool: 'deck_issue_create', tier: 'write-confirmed', args: { issue: 1000 + i } })
  const ec = app.entriesOf(SID_C)
  check(ec.length === 20, '每会话留最近 20 张（写了 25 张，实得 ' + ec.length + ' 张）')
  check(ec[0].ticketKey === '1025' && ec[19].ticketKey === '1006', '留下的是最近 20 张、丢的是最旧的 5 张（最新 ' + ec[0].ticketKey + '、最旧 ' + ec[19].ticketKey + '）')

  // ── 五、落盘：只存散列与票键，原文一个都搜不到 ──────────────────────────────
  const file = path.join(dir, mod.SESSION_TICKETS_FILE)
  check(fs.existsSync(file), '缓存落在工作区缓存目录下的 ' + mod.SESSION_TICKETS_FILE)
  const text = fs.readFileSync(file, 'utf8')
  const notFound = (needle, what) => check(text.indexOf(needle) < 0, '落盘文件里搜不到' + what + '（' + JSON.stringify(needle.slice(0, 28)) + '）')
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
  check(Array.isArray(row) && row.length === 3 && typeof row[0] === 'string' && typeof row[1] === 'number' && typeof row[2] === 'string',
    '每一条只存三样：票键、时间、动作类别（' + JSON.stringify(row) + '）')

  // ── 六、重启：丢掉内存、照同一个缓存目录另起一个实例，从落盘恢复 ────────────────
  const logCtx2 = makeLogCtx()
  const revived = mod.createSessionTickets({ cacheDir: dir, now: now, logCtx: logCtx2 })
  check(revived.sizeOf(SID_A) === 0, '新实例刚起来时内存是空的（重启现场）')
  const r = await revived.restore({ rootKey: ROOT_KEY })
  check(r.cache === 'hit' && r.restored === 3, '从落盘读回三格链（cache ' + r.cache + '、格数 ' + r.restored + '）')
  check(revived.sizeOf(SID_A) === 4 && revived.sizeOf(SID_B) === 2 && revived.sizeOf(SID_C) === 20,
    '重启后两条链都回到原样（A ' + revived.sizeOf(SID_A) + ' 张、B ' + revived.sizeOf(SID_B) + ' 张、C ' + revived.sizeOf(SID_C) + ' 张）')
  check(revived.entriesOf(SID_A)[0].ticketKey === '701' && revived.entriesOf(SID_A)[3].ticketKey === '702',
    '恢复后顺序与动作类别都还在（' + revived.entriesOf(SID_A).map((e) => e.ticketKey + ':' + e.action).join('、') + '）')

  // ── 七、日志：只记写那一侧，字段只有白名单里的那几个 ─────────────────────────
  // 一条一条数：A 三张 + B 两张 + markdown 改票文件一张 + 701 再写一次 + 会话 C 那 25 张 = 32 条。
  const recordLines = logCtx.lines.filter((l) => l.fields && l.fields.kind === 'record')
  check(recordLines.length === 32, '三十二条写各落一行「记进链」（' + recordLines.length + ' 行）')
  const badKeys = []
  for (const l of logCtx.lines) {
    check(l.event === 'sessionTickets.chain', '事件名只有 sessionTickets.chain 一个（' + l.event + '）')
    for (const k of Object.keys(l.fields || {})) if (ALLOWED_FIELDS.indexOf(k) < 0) badKeys.push(k)
  }
  check(badKeys.length === 0, '每一行的字段都在白名单里（' + ALLOWED_FIELDS.join('、') + '），超出：' + (badKeys.join('、') || '无'))
  const lineText = JSON.stringify(logCtx.lines)
  check(lineText.indexOf('proj') < 0 && lineText.indexOf('gh issue') < 0 && lineText.indexOf(SID_A) < 0 && lineText.indexOf('.md') < 0,
    '日志行里没有路径原文、命令原文、会话 id 原文与票文件路径')
  check(logCtx.lines.every((l) => l.level === 'info'), '这一族记信息级常驻（写票是低频动作，不等人先打开调试开关）')

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
  console.log(failed ? '\n存在失败 — verify-714-session-tickets 未通过' : '\n全部通过 — 会话↔票 处理链门禁生效（' + total + ' 项断言）')
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error('门禁执行异常：' + ((e && e.stack) || e))
  process.exit(1)
})
