// tests/verify-1083-work-path-persist.ts —— #1083：工作路线落盘在并发与时间下可信，日志与隐私口径收口。
//
// 门禁归属: src/deck/shell/work-path-store.ts
// 门禁归属: src/deck/shell/work-path-ledger.ts
// 门禁归属: src/deck/shell/work-path-privacy.ts
// 门禁归属: src/deck/shell/work-path-bindings.ts
// 门禁归属: src/deck/shell/work-path-record.ts
// 门禁归属: src/refresh/kernel/refresh-chain.ts
// 门禁归属: src/refresh/kernel/chain-pruning.ts
//（原先另有一行「门禁归属: src/host/refresh/workRoute.ts」：旧链的 chainPrune 曾住在那里，#1271 整份删掉；
//  30 天与 2MB 两条留存线由本门禁第二、三节直接在新账上守，不再经旧链反证。）
//
// 这张门禁守票面七条验收里的六条（第 ⑤ 条的「旧事件退役」由三处日志门禁守，
// 这里只验新事件真的上线、字段真的封闭）：
//   ① 两个存储实例交替写同一工作区，谁的记录都不丢；写后读回能解析；
//   ② 30 天以前的条目在下一次写入时清掉；超过 2MB 时按时间从旧到新裁到 2MB 以下、最新的还在；
//   ③ 文件读不出来时当空文件继续写、不抛错，回执备注说明；
//   ④ 后端从 github 换成 markdown 后旧文件改名留档，新文件不混旧条目；
//   ⑤ 新事件 workRoute.write（四类 kind）与 workRoute.read 上线、字段只有白名单那八格/五格；
//   ⑥ 隐私检查改字段白名单加凭证形状：标题快照可落盘，凭证原文永不落盘；
//   ⑦ 共享纯逻辑里「每会话 20 条」上限已删除，留存改按 30 天与 2MB 两条线。
//
// 全程固定时钟 + 临时家目录 + 真存储（不造假口），跑两次结果一字不差。
// 用法：在插件根目录执行 node --import ./scripts/ts-hook.mts tests/verify-1083-work-path-persist.ts
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
const MB2 = 2 * 1024 * 1024

interface LogLine { level: string; event: string; fields: Record<string, unknown> }

/** 真文件读写 + 改名（与宿主接线给的真实现同一套：读不到回 null，写前建目录）。 */
function realIo() {
  return {
    readFile: async (p: string) => { try { return fs.readFileSync(p, 'utf8') } catch { return null } },
    writeFile: async (p: string, c: string) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c, 'utf8') },
    mkdir: async (dir: string) => { fs.mkdirSync(dir, { recursive: true }) },
    rename: async (from: string, to: string) => { fs.renameSync(from, to) },
  }
}

/** 收日志的假出口：每行保留级别、事件名、字段，用来断言事件上线、kind 齐全与字段封闭。 */
function makeLog(): { lines: LogLine[]; sink: { fire: (level: string, event: string, fields: Record<string, unknown>) => void } } {
  const lines: LogLine[] = []
  return { lines: lines, sink: { fire: (level, event, fields) => { lines.push({ level: level, event: event, fields: fields }) } } }
}

function tmpHome(tag: string): string { return fs.mkdtempSync(path.join(os.tmpdir(), 'wp1083-' + tag + '-')) }

async function main() {
  console.log('#1083 工作路线落盘：并发可信、时间与体积留存、换后端留档、日志与隐私口径')
  const bindingsMod = await imp('src/deck/shell/work-path-bindings.ts') as any
  const storeMod = await imp('src/deck/shell/work-path-store.ts') as any
  const privacyMod = await imp('src/deck/shell/work-path-privacy.ts') as any
  const recordMod = await imp('src/deck/shell/work-path-record.js') as any
  const chainMod = await imp('src/refresh/kernel/refresh-chain.js') as any
  const pruneMod = await imp('src/refresh/kernel/chain-pruning.js') as any
  const homes: string[] = []
  const mk = (tag: string) => { const h = tmpHome(tag); homes.push(h); return h }
  const fileOf = (home: string, rootKey: string) => home + '/.dsh/mattskillsdeck/work-path/' + chainMod.chainRootHash(rootKey) + '.json'

  // ── 一、两个存储实例交替写同一工作区：谁的记录都不丢（验收①）───────────────
  const home1 = mk('shared')
  const log1 = makeLog()
  const io1 = realIo()
  const ROOT_KEY = 'ws-1083-shared'
  const instA = bindingsMod.createWorkRouteBindings(Object.assign({ homeDir: home1, now: () => T0, log: log1.sink }, io1))
  const instB = bindingsMod.createWorkRouteBindings(Object.assign({ homeDir: home1, now: () => T0 + 1000, log: log1.sink }, io1))
  const nA1 = await instA.note({ rootKey: ROOT_KEY, sessionId: 'sess-a-1083', sessionLabel: '', backend: 'markdown', ticketKey: '901', effortId: '', title: '甲票', action: 'report', source: 'reported' })
  const nB1 = await instB.note({ rootKey: ROOT_KEY, sessionId: 'sess-b-1083', sessionLabel: '', backend: 'markdown', ticketKey: '902', effortId: '', title: '乙票', action: 'report', source: 'reported' })
  const nA2 = await instA.note({ rootKey: ROOT_KEY, sessionId: 'sess-a-1083', sessionLabel: '', backend: 'markdown', ticketKey: '903', effortId: '', title: '丙票', action: 'report', source: 'reported' })
  check(nA1.ok === true && nB1.ok === true && nA2.ok === true, '两个实例交替写：三笔都记成功，谁也没抛错')
  check(nA2.count === 2 && nB1.count === 1, '各自的本会话条数对（A 2 条、B 1 条）')
  const instC = bindingsMod.createWorkRouteBindings(Object.assign({ homeDir: home1, now: () => T0 + 2000 }, io1))
  const readShared: any = await instC.read({ sessionId: 'sess-a-1083', rootKey: ROOT_KEY, at: T0 + 2000 })
  const keysShared = readShared.ok ? readShared.readout.entries.map((e: any) => e.ticketKey).sort().join(',') : ''
  check(keysShared === '901,902,903', '第三个实例读回三条全在（A 写的 901/903 与 B 写的 902，实得 ' + keysShared + '）')
  const diskShared = JSON.parse(fs.readFileSync(fileOf(home1, ROOT_KEY), 'utf8'))
  check(diskShared.v === 3 && diskShared.workers.length === 2, '盘上两页（两个会话各一页），写后读回能解析')
  check(log1.lines.every((l) => l.event === 'workRoute.write' || l.event === 'workRoute.read'), '日志里只有 workRoute.write / workRoute.read 两个事件（旧事件不再出现）')

  // ── 二、30 天清理与「没有每会话 20 条上限」（验收②前半、⑦）────────────────
  const home2 = mk('retain')
  const log2 = makeLog()
  let clock2 = T0
  const store2 = storeMod.createWorkPathStore(Object.assign({ homeDir: home2, now: () => clock2, log: log2.sink }, realIo()))
  for (let i = 0; i < 25; i++) {
    await store2.note({ rootKey: 'ws-1083-retain', sessionId: 'sess-many', backend: 'markdown', ticketKey: String(2000 + i), action: 'report', source: 'reported' })
  }
  const manyNow: any = await store2.readSnapshot({ rootKey: 'ws-1083-retain', sessionId: 'sess-many' })
  check(manyNow && manyNow.workers[0].entries.length === 25, '同一会话连写 25 张：一条不裁（没有 20 条上限，实得 ' + (manyNow ? manyNow.workers[0].entries.length : '?') + ' 条）')
  check(chainMod.CHAIN_SESSION_CAP === undefined, '共享纯逻辑里 CHAIN_SESSION_CAP 已删除（旧上限不再存在）')
  // 保留期现在是中央配置（config/ttl.yaml 的 chainKeepMs）：断言它等于中央值，再锁一句今天就是 30 天。
  // 没有第二份手抄副本——改 YAML 之后要连 31 天这个场景一起想，报错会指到中央键。
  const timeMod: any = await imp('src/shared/time-config/values.js')
  check(pruneMod.CHAIN_KEEP_MS === timeMod.CHAIN_KEEP_MS && timeMod.CHAIN_KEEP_MS === 30 * DAY && pruneMod.CHAIN_MAX_BYTES === MB2,
    '共享纯逻辑的保留期取中央配置 chainKeepMs（今天 30 天；改 config/ttl.yaml 时连本节 31 天场景一起改）与 2MB 两条线')
  clock2 = T0 + 31 * DAY
  const prunedNote: any = await store2.note({ rootKey: 'ws-1083-retain', sessionId: 'sess-many', backend: 'markdown', ticketKey: '2099', action: 'report', source: 'reported' })
  const afterPrune: any = await store2.readSnapshot({ rootKey: 'ws-1083-retain', sessionId: 'sess-many' })
  check(afterPrune && afterPrune.workers[0].entries.length === 1 && afterPrune.workers[0].entries[0].ticketKey === '2099',
    '31 天后再写：30 天以前的条目在下一次写入时清掉，只剩新的一条')
  check(prunedNote.ok === true && prunedNote.count === 1, '回执报的条数是裁剪之后的（本次 1 条，旧实现会把清掉的 25 条也算进去）')
  const pruneLines = log2.lines.filter((l) => l.fields && l.fields.kind === 'prune')
  check(pruneLines.length === 1 && pruneLines[0].fields.count === 25 && pruneLines[0].fields.ok === true, '清理记一条 workRoute.write（kind=prune，count=清掉的 25 条）')

  // ── 三、超过 2MB：按时间从旧到新裁到 2MB 以下，最新的还在（验收②后半）──────
  const home3 = mk('bytes')
  const log3 = makeLog()
  const bigRoot = 'ws-1083-big'
  const bigFile = fileOf(home3, bigRoot)
  fs.mkdirSync(path.dirname(bigFile), { recursive: true })
  const bigEntries: any[] = []
  for (let i = 0; i < 4000; i++) {
    bigEntries.push({ ticketKey: 'BIG-' + String(i).padStart(5, '0'), effortId: '', title: 'x'.repeat(600), action: 'report', actionAt: T0 + i, source: 'reported' })
  }
  fs.writeFileSync(bigFile, JSON.stringify({ v: 3, at: T0, backend: 'markdown', workers: [{ session: 'sess-big', label: '', labelAt: T0, entries: bigEntries }] }), 'utf8')
  const store3 = storeMod.createWorkPathStore(Object.assign({ homeDir: home3, now: () => T0 + 5000, log: log3.sink }, realIo()))
  const bigNote: any = await store3.note({ rootKey: bigRoot, sessionId: 'sess-new', backend: 'markdown', ticketKey: 'NEWEST', action: 'report', source: 'reported' })
  const bigText = fs.readFileSync(bigFile, 'utf8')
  const bigDisk = JSON.parse(bigText)
  const keptBig = bigDisk.workers.reduce((n: number, w: any) => n + w.entries.length, 0)
  check(bigNote.ok === true, '超过 2MB 的账再写一笔：照样落上（没抛错）')
  check(pruneMod.utf8Bytes(bigText) <= MB2, '裁剪后整份不超过 2MB（实得 ' + pruneMod.utf8Bytes(bigText) + ' 字节）')
  check(bigDisk.workers.some((w: any) => w.entries.some((e: any) => e.ticketKey === 'NEWEST')), '最新的一条还在')
  check(bigDisk.workers.some((w: any) => w.entries.some((e: any) => e.ticketKey === 'BIG-03999')), '被裁后最新的旧条目也还在（按时间从旧到新裁）')
  check(!bigDisk.workers.some((w: any) => w.entries.some((e: any) => e.ticketKey === 'BIG-00000')), '最旧的一条被裁掉')
  const bigPrune = log3.lines.filter((l) => l.fields && l.fields.kind === 'prune')
  check(bigPrune.length === 1 && bigPrune[0].fields.count === 4001 - keptBig, '清理日志记下裁掉的条数（' + (bigPrune[0] ? bigPrune[0].fields.count : '?') + ' = 4001 - ' + keptBig + '）')

  // ── 四、文件坏 / 读不出来：当空账继续写、不抛错、回执 notes 说明（验收③）──
  const home4 = mk('bad')
  const badFile = fileOf(home4, 'ws-1083-bad')
  fs.mkdirSync(path.dirname(badFile), { recursive: true })
  fs.writeFileSync(badFile, '{ 这不是 JSON', 'utf8')
  const log4 = makeLog()
  const instBad = bindingsMod.createWorkRouteBindings(Object.assign({ homeDir: home4, now: () => T0, log: log4.sink }, realIo()))
  const vBad: any = { status: 'ok', data: { key: '704', effortId: '', title: '坏文件票' }, notes: [] }
  await recordMod.recordWorkRoute({ workRouteNote: (i: unknown) => instBad.note(i), workRouteRead: (i: unknown) => instBad.read(i), now: () => T0 }, 'deck_issue_report', { sessionId: 'sess-a-1083', workspaceKey: 'ws-1083-bad', cwd: 'x' }, 'markdown', vBad)
  check(!vBad.data || !('workRoute' in vBad.data), '坏文件时写回执不再带在办表（#1561：要看调 deck_work_route）；记条目本身不抛错')
  check(vBad.notes.some((n: string) => n.indexOf('读不出来') >= 0), '回执备注说明盘上旧文件读不出来、按空账重写：' + JSON.stringify(vBad.notes))
  const badAfter = JSON.parse(fs.readFileSync(badFile, 'utf8'))
  check(badAfter.workers.length === 1 && badAfter.workers[0].entries.length === 1 && badAfter.workers[0].entries[0].ticketKey === '704', '坏文件被整份重写成只含这次这一条的新账')
  // 读文件这一下临时失败（比如被占用）：当空账继续，读回成功，备注说明，日志记 record ok=false。
  const home4b = mk('bad-transient')
  const log4b = makeLog()
  let reads = 0
  const transientIo = Object.assign({}, realIo(), {
    readFile: async (p: string) => {
      reads += 1
      if (reads === 1) throw new Error('文件被占用（探针）')
      try { return fs.readFileSync(p, 'utf8') } catch { return null }
    },
  })
  const instTransient = storeMod.createWorkPathStore(Object.assign({ homeDir: home4b, now: () => T0, log: log4b.sink }, transientIo))
  const transientNote: any = await instTransient.note({ rootKey: 'ws-1083-transient', sessionId: 'sess-a-1083', backend: 'markdown', ticketKey: '705', action: 'report', source: 'reported' })
  check(transientNote.ok === true && Array.isArray(transientNote.warnings) && transientNote.warnings.length === 1 && transientNote.warnings[0].indexOf('没读出来') >= 0,
    '读文件临时失败：当空账继续写、不抛错，成功结果带 warnings')
  const recordLines = log4b.lines.filter((l) => l.fields && l.fields.kind === 'record')
  check(recordLines.length === 1 && recordLines[0].fields.ok === false, '读旧文件失败时 record 那条日志如实记 ok=false')
  // 读出口读失败：workRoute.read 记一行 ok=false，读出口回空表而不是抛错。
  const home4c = mk('read-fail')
  const log4c = makeLog()
  const readFailFile = fileOf(home4c, 'ws-1083-readfail')
  fs.mkdirSync(path.dirname(readFailFile), { recursive: true })
  fs.writeFileSync(readFailFile, 'not json at all', 'utf8')
  const instReadFail = bindingsMod.createWorkRouteBindings(Object.assign({ homeDir: home4c, now: () => T0, log: log4c.sink }, realIo()))
  const readFail: any = await instReadFail.read({ sessionId: 'sess-a-1083', rootKey: 'ws-1083-readfail', at: T0 })
  const readLines = log4c.lines.filter((l) => l.event === 'workRoute.read')
  check(readFail.ok === false && readFail.reason === 'read-failed', '读出口遇到坏文件：如实回 ok=false（不拿空表冒充「这个工作区没在办票」）')
  check(readLines.length === 1 && readLines[0].fields.ok === false, '读出口失败记一行 workRoute.read（ok=false）')

  // ── 五、换后端：旧文件改名留档，新文件不混旧条目（验收④）──────────────
  const home5 = mk('switch')
  const log5 = makeLog()
  let clock5 = T0
  const store5 = storeMod.createWorkPathStore(Object.assign({ homeDir: home5, now: () => clock5, log: log5.sink }, realIo()))
  const root5 = 'ws-1083-switch'
  const main5 = fileOf(home5, root5)
  await store5.note({ rootKey: root5, sessionId: 'sess-a-1083', backend: 'github', ticketKey: '901', action: 'report', source: 'reported' })
  clock5 = T0 + 1000
  const switched: any = await store5.note({ rootKey: root5, sessionId: 'sess-a-1083', backend: 'markdown', ticketKey: '902', action: 'report', source: 'reported' })
  check(switched.ok === true && Array.isArray(switched.warnings) && switched.warnings[0].indexOf('留档') >= 0, '换后端：这次照样落上，warnings 说明旧记录已改名留档')
  const legacy5 = main5.slice(0, -5) + '.github.json'
  check(fs.existsSync(legacy5), '旧后端那份改名留档（<根散列>.github.json）')
  const legacyDisk = JSON.parse(fs.readFileSync(legacy5, 'utf8'))
  check(legacyDisk.backend === 'github' && legacyDisk.workers.some((w: any) => w.entries.some((e: any) => e.ticketKey === '901')), '留档文件里是旧后端的记录（901 在）')
  const newDisk = JSON.parse(fs.readFileSync(main5, 'utf8'))
  check(newDisk.backend === 'markdown' && !newDisk.workers.some((w: any) => w.entries.some((e: any) => e.ticketKey === '901')), '新文件不混旧条目（901 不在 markdown 账里）')
  clock5 = T0 + 2000
  await store5.note({ rootKey: root5, sessionId: 'sess-a-1083', backend: 'markdown', ticketKey: '903', action: 'report', source: 'reported' })
  const newDisk2 = JSON.parse(fs.readFileSync(main5, 'utf8'))
  check(!newDisk2.workers.some((w: any) => w.entries.some((e: any) => e.ticketKey === '901')), '换后端以后旧文件不再被读进来（再写一笔也不复活 901）')

  // ── 六、隐私：字段白名单 + 凭证形状；标题可落盘、凭证永不落盘（验收⑥）────
  const home6 = mk('privacy')
  const log6 = makeLog()
  const store6 = storeMod.createWorkPathStore(Object.assign({ homeDir: home6, now: () => T0, log: log6.sink }, realIo()))
  const root6 = 'ws-1083-privacy'
  const humanTitle = '修 #1083 的落盘：标题带空白和中文，也允许'
  const humanNote: any = await store6.note({ rootKey: root6, sessionId: 'sess-a-1083', backend: 'markdown', ticketKey: '901', title: humanTitle, action: 'report', source: 'reported' })
  check(humanNote.ok === true, '带空白与中文的标题快照允许落盘（旧「含空白即整份拒绝」的尺子不再用）')
  const humanDisk = fs.readFileSync(fileOf(home6, root6), 'utf8')
  check(humanDisk.indexOf(humanTitle) >= 0, '盘上确实留着标题快照原文（人读得懂的名字）')
  const token = 'ghp_' + 'a'.repeat(36)
  const tokenNote: any = await store6.note({ rootKey: root6, sessionId: 'sess-a-1083', backend: 'markdown', ticketKey: '902', title: '令牌 ' + token, action: 'report', source: 'reported' })
  check(tokenNote.ok === false && tokenNote.reason === 'privacy', '标题里带凭证形状：整份不写，诚实回 reason=privacy（实得 ' + tokenNote.reason + '）')
  const afterTokenDisk = fs.readFileSync(fileOf(home6, root6), 'utf8')
  check(afterTokenDisk.indexOf('ghp_') < 0 && afterTokenDisk.indexOf(humanTitle) >= 0, '凭证原文没有落盘，盘上还是上一次那份干净的账')
  check(privacyMod.credentialKind(token) !== '' && privacyMod.credentialKind('Authorization: Bearer abcdefghijklmnop') !== '' && privacyMod.credentialKind('sk-' + 'b'.repeat(24)) !== '', '凭证形状认得出 GitHub 令牌、授权头与 API 密钥')
  const clean = { v: 3, at: T0, backend: 'markdown', workers: [{ session: 'sess', label: '会话标题', labelAt: T0, entries: [{ ticketKey: '1', effortId: '', title: humanTitle, action: 'report', actionAt: T0, source: 'reported' }] }] }
  check(privacyMod.privacyViolations(clean).length === 0, '白名单里那 15 个字段名组成的账自检干净')
  const dirtyName = privacyMod.privacyViolations({ v: 3, command: 'gh issue list' })
  check(dirtyName.length === 1 && dirtyName[0].indexOf('不在白名单') >= 0, '出现白名单以外的字段名：当场拦下并指到字段（' + dirtyName[0] + '）')
  const dirtyValue = privacyMod.privacyViolations({ workers: [{ title: token }] })
  check(dirtyValue.length === 1 && dirtyValue[0].indexOf('GitHub 令牌') >= 0, '白名单字段里的凭证原文也会被内容检查认出来（' + dirtyValue[0] + '）')

  // ── 七、日志：新事件上线、四类 kind 齐全、字段封闭（验收⑤）──────────────
  const writeLines = log1.lines.filter((l) => l.event === 'workRoute.write')
  const kinds: Record<string, boolean> = {}
  for (const l of writeLines) kinds[String(l.fields.kind)] = true
  check(['record', 'persist', 'readback'].every((k) => kinds[k] === true), 'workRoute.write 的三类常规 kind 都出现过：' + Object.keys(kinds).join('、'))
  check(log2.lines.some((l) => l.event === 'workRoute.write' && l.fields.kind === 'prune'), '清理时出现第四类 kind=prune')
  const allWriteKeys = ['sidHash', 'rootHash', 'kind', 'ok', 'action', 'count', 'why', 'detail']
  const badWriteKeys: string[] = []
  for (const l of log1.lines) for (const k of Object.keys(l.fields || {})) if (allWriteKeys.indexOf(k) < 0) badWriteKeys.push(l.event + ':' + k)
  check(badWriteKeys.length === 0, 'write 每条只有八个白名单字段（' + allWriteKeys.join('、') + '），超出：' + (badWriteKeys.join('、') || '无'))
  const privacyLine: any = log6.lines.filter((l) => l.event === 'workRoute.write' && l.fields.kind === 'persist' && l.fields.ok === false).pop()
  check(privacyLine && privacyLine.fields.why === 'privacy' && String(privacyLine.fields.detail).indexOf('$.') >= 0 && String(privacyLine.fields.detail).indexOf('ghp_') < 0,
    '隐私命中那条日志的原因与字段路径都写下来了，且不带被拦下的令牌（' + (privacyLine ? privacyLine.fields.why + ' / ' + privacyLine.fields.detail : '?') + '）')
  const readLine = log4c.lines.filter((l) => l.event === 'workRoute.read')[0]
  check(readLine && Object.keys(readLine.fields).sort().join(',') === 'detail,ok,rootHash,sidHash,why', 'read 那行只有 sidHash / rootHash / ok / why / detail 五格')
  check(readLine && readLine.fields.why === 'bad-shape', '读出口遇到坏文件：日志写明原因是 bad-shape（实得 ' + (readLine ? readLine.fields.why : '?') + '）')
  const logText = JSON.stringify(log1.lines) + JSON.stringify(log2.lines) + JSON.stringify(log4c.lines) + JSON.stringify(log5.lines)
  check(logText.indexOf(ROOT_KEY) < 0 && logText.indexOf('ws-1083-retain') < 0 && logText.indexOf('sess-a-1083') < 0, '日志里没有工作区键原文与会话 id 原文（只有散列）')

  // ── 八、反证：判据本身打得红（每次运行都跑）─────────────────────────────
  // ① 若实现退回「内存真源、不读盘」，第二个实例先写的内容会被第一个实例整份盖掉 —— 第一条就会红。
  const home7 = mk('counter')
  const io7 = realIo()
  const instX = bindingsMod.createWorkRouteBindings(Object.assign({ homeDir: home7, now: () => T0 }, io7))
  const instY = bindingsMod.createWorkRouteBindings(Object.assign({ homeDir: home7, now: () => T0 + 1000 }, io7))
  await instX.note({ rootKey: 'ws-1083-counter', sessionId: 'sess-x', backend: 'markdown', ticketKey: '1', action: 'report', source: 'reported' })
  await instY.note({ rootKey: 'ws-1083-counter', sessionId: 'sess-y', backend: 'markdown', ticketKey: '2', action: 'report', source: 'reported' })
  const disk7 = JSON.parse(fs.readFileSync(fileOf(home7, 'ws-1083-counter'), 'utf8'))
  const keys7 = disk7.workers.reduce((a: string[], w: any) => a.concat(w.entries.map((e: any) => e.ticketKey)), []).sort().join(',')
  check(keys7 === '1,2', '反证①：两个实例各写一张，盘上两张都在（内存真源那种坏实现会只剩后一张）')
  // （原先的反证②在这里用旧链的 chainPrune 验 30 天与体积两条线：#1271 把旧链整份删掉，
  //   这两条线改由本门禁第二、三节直接在新账上守，不再经旧链反证。）

  for (const h of homes) { try { fs.rmSync(h, { recursive: true, force: true }) } catch { /* 忽略 */ } }
  console.log('共 ' + total + ' 项，' + (failed ? '有失败' : '全部通过'))
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error('  FAIL 异常：' + ((e && e.stack) || e)); process.exit(1) })
