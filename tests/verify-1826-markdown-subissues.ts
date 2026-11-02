/**
 * tests/verify-1826-markdown-subissues.ts —— 本地 Markdown 后端「一张容器的全部子票」门禁（#1826）。
 *
 * 这张票的现场：本地 Markdown 工作区里一张开放的规格容器有 8 张实施票（7 张已关闭、1 张开着），
 * 面板上的进度环却显示 0/1。原因是宿主首屏（src/host/tracker/snapshotWorkingSet.ts）先只取开放票，
 * 再对每个开放容器调 listSubIssues 把已关闭的子票补回来，而本地 Markdown 后端这条操作回的是
 * unsupported，于是开放容器手里只剩开着的子票，分母跟着塌成 1。
 *
 * 本门禁钉四件事：
 *   一、规格容器的子票数得全：7 张已关闭 + 1 张开着 → listSubIssues 回 8 张、按编号升序、
 *      parentKey 与 effortId 都对；宿主快照里这张规格行有 8 张子票、统计 total=8 / open=1 / closed=7
 *      （进度环的分母是 8，不是 1）。同一目录里没有 DSH-PARENT 的旧重复票（#1826 现场的 01-07）
 *      不算它的子票。
 *   二、两类容器同一套口径：地图容器的旧布局子票（按目录归属）与新布局子票（文件头 DSH-PARENT）
 *      都算，新布局但没写 DSH-PARENT 的票不算。
 *   三、编号与范围：容器编号可以写成 '0'；这个范围里没有该编号的容器 → notfound；一个工作区里有
 *      多个 00 号容器又没指定工作单元 → conflict（拒绝猜）。
 *   四、读不动就整体失败：票文件读不动时回失败、消息说清哪些读不动，不返回缺行的清单（进度环少数
 *      一张比整条失败更糟，用户从画面上看不出数是错的）。
 *
 * 门禁归属: src/tracker/rooms/markdown/sub-issues.ts
 * 门禁归属: src/host/tracker/snapshotWorkingSet.ts
 *
 * 运行：node --import ./scripts/ts-hook.mts tests/verify-1826-markdown-subissues.ts
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { createMarkdownBackend } from '../src/tracker/rooms/markdown/index.ts'
import { createSnapshotComposer } from '../src/host/tracker/snapshot.ts'
import { createTicketGrouping } from '../src/host/ticketGrouping.ts'

type LogLine = { level: string; event: string; fields: Record<string, unknown> }
type Ctx = {
  platform: { path: typeof path; fs: Record<string, unknown> }
  fs: Record<string, unknown>
  cwd: string
  opId: string
  events: LogLine[]
  logEvent: (level: string, event: string, fields: Record<string, unknown>) => void
  get: (name: string) => unknown
}

let failed = false
let checked = 0
const check = (ok: boolean, msg: string) => {
  checked += 1
  console.log((ok ? '  PASS ' : '  FAIL ') + msg)
  if (!ok) failed = true
}
const eq = (actual: unknown, expected: unknown, msg: string) => {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  check(a === b, a === b ? msg : msg + '（实际 ' + a + '，期望 ' + b + '）')
}

/** 与 tests/verify-1490 / verify-1058 同一套 fs/platform 适配器：真实文件系统 + 事件收集。
 *  `unreadableFiles` 里的文件名在读的时候抛 EACCES（相当于权限不足 / 读到时已被删 / 被锁住）。 */
function makeCtx(cwd: string, unreadableFiles: string[] = []): Ctx {
  const plat = {
    path: path,
    fs: {
      async resolve(p: string) { return p },
      async readText(t: string) {
        const name = String(t).split(/[\\/]/).pop() as string
        if (unreadableFiles.includes(name)) {
          const e = new Error('EACCES: permission denied, open ' + t) as Error & { code?: string }
          e.code = 'EACCES'
          throw e
        }
        return fs.readFileSync(t, 'utf8')
      },
      async writeText(t: string, c: string) { fs.mkdirSync(path.dirname(t), { recursive: true }); fs.writeFileSync(t, c, 'utf8') },
      async unlink(t: string) { try { fs.unlinkSync(t) } catch {} },
      async lstat(t: string) { try { return fs.statSync(t) } catch { return null } },
      async listDir(t: string) { try { return fs.readdirSync(t) } catch { return [] } },
      async stat(t: string) { try { return fs.statSync(t) } catch { return null } },
    },
  }
  const events: LogLine[] = []
  return {
    platform: plat,
    fs: plat.fs,
    cwd,
    opId: 'test-op-1826',
    events,
    logEvent(level: string, event: string, fields: Record<string, unknown>) { events.push({ level, event, fields }) },
    get(name: string) { if (name === 'fs') return plat.fs; return undefined },
  }
}

/** 工作区引用照宿主在真实工作区给的形状：refId 给空，用 effortId 指定工作单元目录。 */
function repoOf(effortId?: string, scene?: string): Record<string, unknown> {
  const repo: Record<string, unknown> = { backend: 'markdown', refId: '', name: '', url: '' }
  if (effortId) repo.effortId = effortId
  if (scene) repo.mdScene = scene
  return repo
}
const writeFileDeep = (file: string, text: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text, 'utf8')
}
/** 只收 read.degraded 那一条线；返回 reason 清单，供逐条对。 */
const degradedReasons = (ctx: Ctx) => ctx.events.filter((e) => e.event === 'read.degraded').map((e) => String(e.fields.reason))

const specBody = [
  '## 目的', '', '把 base 包接到五个仓，并完成整体自动验收。', '',
  '## 背景', '', 'base 包已发布，五仓各自接入。', '',
  '## 范围与顺序', '', '票 08-13 逐仓接入，票 14 真机证据。', '',
  '## 验收口径', '', '每仓门禁全绿，整体证据齐。', '',
].join('\n')

// ======================= 一、规格容器：7 张做完 + 1 张开着 =======================

const tmpA = fs.mkdtempSync(path.join(os.tmpdir(), 'md-1826-spec-'))
try {
  const ctx = makeCtx(tmpA)
  const be: any = createMarkdownBackend(ctx as never)
  const specRepo = repoOf('base-package-rollout', 'feature')

  console.log('-- ① 建出现场：一张开放规格 + 8 张实施票（7 关 1 开）+ 同目录旧重复票 --')
  const spec: any = await be.create(specRepo, {
    title: '五仓接入 base 包（rollout）',
    body: specBody,
    type: 'spec',
    labels: ['ready-for-agent'],
    idempotencyKey: '1826-spec',
  }, ctx)
  check(spec.ok === true && String(spec.data.key) === '00', '规格建在 00 号')
  check(fs.existsSync(path.join(tmpA, '.scratch', 'base-package-rollout', 'spec.md')), '规格落在 .scratch/base-package-rollout/spec.md')

  const childTitles = [
    'dsh-prompt 仓接入并全部测通',
    'deck 仓接入',
    'palette 仓接入（mini-bundler 风险）',
    'im-companion 仓接入',
    'ilife 仓接入',
    '五仓接入整体自动验收',
    'HUMAN-GATE 真机与真实页面证据',
    '页头三件套公共化与群码换发',
  ]
  const childKeys: string[] = []
  for (let i = 0; i < childTitles.length; i++) {
    const made: any = await be.create(specRepo, {
      title: childTitles[i],
      body: '**What to build:** ' + childTitles[i] + '。',
      type: 'issue',
      labels: ['ready-for-agent'],
      parentKey: '00',
      idempotencyKey: '1826-child-' + i,
    }, ctx)
    if (made.ok) childKeys.push(String(made.data.key))
  }
  eq(childKeys, ['01', '02', '03', '04', '05', '06', '07', '08'], '八张实施票按编号 01-08 落在规格目录')
  for (let i = 0; i < 7; i++) {
    const closed: any = await be.close(specRepo, childKeys[i], { reason: '这一仓的活做完了' }, ctx)
    check(closed.ok === true, '实施票 ' + childKeys[i] + ' 关闭成功')
  }
  // 现场里那 7 张旧重复票（01-07）是「新布局、但文件头没有 DSH-PARENT」的票：目录相同也不算子票。
  writeFileDeep(path.join(tmpA, '.scratch', 'base-package-rollout', 'issues', '20-旧重复票.md'), [
    '<!-- DSH-FORMAT: md-v1 -->',
    '<!-- DSH-CREATED: 2026-10-31T02:26:18.808Z -->',
    '# 20: 旧重复票',
    '',
    '**Status:** resolved',
    '',
    '## Body',
    '',
    '同目录但没写 DSH-PARENT，不该被算成这张规格的子票。',
    '',
  ].join('\n'))
  const listedAll: any = await be.list(repoOf(), {}, ctx)
  const allRows: any[] = listedAll.ok ? listedAll.data : []
  const interference = allRows.find((r: any) => String(r.key) === '20' && String(r.effortId) === 'base-package-rollout')
  check(!!interference && interference.parentKey == null, '旧重复票在列表里是一张没有父票的独立票（list 已经这么读）')

  console.log('-- ② listSubIssues：8 张子票全回来，含 7 张已关闭 --')
  const got: any = await be.listSubIssues(specRepo, '00', {}, ctx)
  check(got.ok === true, 'listSubIssues 返回成功 → ' + (got.ok ? '成功' : '失败：' + JSON.stringify(got.error)))
  const items: any[] = got.ok ? got.data.items : []
  eq(items.map((t) => String(t.key)), ['01', '02', '03', '04', '05', '06', '07', '08'], '子票按编号 01-08 升序回来（8 张，旧重复票 20 不在里面）')
  check(items.every((t) => String(t.parentKey) === '00'), '每张子票的 parentKey 都指向容器 00')
  check(items.every((t) => String(t.effortId) === 'base-package-rollout'), '每张子票都带所在工作单元')
  check(items.filter((t) => String(t.state) === 'closed').length === 7, '已关闭的子票有 7 张')
  check(!!items[7] && String(items[7].state) === 'open', '第 8 张子票还开着（HUMAN-GATE 那类）')
  check(got.ok && got.data.total === 8 && got.data.fetched === 8 && got.data.capped === false && got.data.missing === 0 && got.data.dropped === 0,
    '总数 / 取到数 / 截断 / 缺数 / 丢弃 五个字段如实：本地一次读完，没有翻页与截断')
  check(degradedReasons(ctx).length === 0, '干净的读一条降级线都不记 → ' + (degradedReasons(ctx).join(' / ') || '零行'))

  const gotSingleDigit: any = await be.listSubIssues(specRepo, '0', {}, ctx)
  check(gotSingleDigit.ok && gotSingleDigit.data.items.length === 8, '容器编号写成一位数字（0）也认，回 8 张')

  const gotAutoEffort: any = await be.listSubIssues(repoOf(), '00', {}, ctx)
  check(gotAutoEffort.ok === true, '没指定工作单元时：这个工作区里 00 号容器只有一个，自动定下来')
  check(gotAutoEffort.ok && gotAutoEffort.data.items.length === 8, '自动定下工作单元后同样回 8 张')

  console.log('-- ③ 宿主快照：开放规格行的子票是 8 张（进度环分母）--')
  const composer: any = createSnapshotComposer({ get(id: string) { return id === 'markdown' ? be : null } }, { snapshotTtl: 50, depsTtl: 50 })
  const snap: any = await composer.composeSnapshot('markdown', repoOf(), ctx, { force: true })
  check(snap.ok === true, '宿主快照组装成功')
  const snapshot: any = snap.ok ? snap.snapshot : {}
  const maps: any[] = snapshot.maps || []
  const specNode = maps.find((m) => String(m.type) === 'spec' && String(m.effortId) === 'base-package-rollout')
  check(!!specNode, '快照里有一张规格容器，工作单元是 base-package-rollout')
  const rawTickets: any[] = specNode && Array.isArray(specNode.tickets) ? specNode.tickets : []
  const ticketKeys: string[] = rawTickets.map((t: any) => String(t.key)).sort()
  // 顺序不归后端口径管：池里本来就开着的票先入行，补回来的已关闭票按取回顺序追加。首屏只要集合对。
  eq(ticketKeys, ['01', '02', '03', '04', '05', '06', '07', '08'], '快照里这张规格挂着 8 张子票（已关闭的 7 张也补回来了）')
  check(rawTickets.filter((t: any) => String(t.state).toUpperCase() === 'CLOSED').length === 7,
    '这 8 张里 7 张是已关闭状态（面板进度环的分子）')
  // 宿主方法层（src/refresh/rooms/host/session-snapshot-cache.ts:199/216）会把快照里的状态升成大写，
  // 再用同一份 groupTickets 重算每个容器的 stats —— 环上读的是重算后的那份。这里照那条路复算一次。
  const upcased = rawTickets.map((t: any) => Object.assign({}, t, { state: String(t.state || '').toUpperCase() === 'CLOSED' ? 'CLOSED' : 'OPEN' }))
  const ringStats: any = createTicketGrouping().groupTickets(upcased)
  check(ringStats.total === 8 && ringStats.open === 1 && ringStats.closed === 7,
    '宿主方法层重算后的容器统计按 8 张算：总 8 / 开 1 / 关 7（进度环 7/8，不再是 0/1）→ ' + JSON.stringify({ total: ringStats.total, open: ringStats.open, closed: ringStats.closed }))
  const snapIssues: any[] = snapshot.issues || []
  check(snapIssues.every((t: any) => String(t.effortId) !== 'base-package-rollout'), '这 8 张挂在规格行上，没有散落到 issues 列表里')
} finally {
  fs.rmSync(tmpA, { recursive: true, force: true })
}

// ======================= 二、地图容器：旧布局按目录、新布局按 DSH-PARENT =======================

const tmpB = fs.mkdtempSync(path.join(os.tmpdir(), 'md-1826-map-'))
try {
  console.log('-- ④ 地图容器：两种归属来源都算，没写父票的不算 --')
  const unitDir = path.join(tmpB, '.scratch', 'effort-a')
  writeFileDeep(path.join(unitDir, 'map.md'), [
    '<!-- DSH-FORMAT: md-v1 -->',
    '<!-- DSH-TITLE: 探索地图甲 -->',
    '<!-- DSH-STATUS: ready-for-agent -->',
    '',
    '## Destination',
    '',
    '先把旧数据摸清。',
    '',
  ].join('\n'))
  writeFileDeep(path.join(unitDir, 'issues', '01-旧布局子票.md'), [
    '# 01: 旧布局子票',
    '',
    '**Status:** resolved',
    '',
    '## Body',
    '',
    '没有 DSH-FORMAT 行：旧布局按目录归属，是这张地图的子票。',
    '',
  ].join('\n'))
  writeFileDeep(path.join(unitDir, 'issues', '02-新布局子票.md'), [
    '<!-- DSH-FORMAT: md-v1 -->',
    '<!-- DSH-PARENT: 00 -->',
    '<!-- DSH-CREATED: 2026-11-01T00:00:00.000Z -->',
    '# 02: 新布局子票',
    '',
    '**Status:** claimed',
    '',
    '## Question',
    '',
    '新布局靠文件头 DSH-PARENT 归属。',
    '',
  ].join('\n'))
  writeFileDeep(path.join(unitDir, 'issues', '03-没写父票.md'), [
    '<!-- DSH-FORMAT: md-v1 -->',
    '<!-- DSH-CREATED: 2026-11-01T00:00:00.000Z -->',
    '# 03: 没写父票',
    '',
    '**Status:** ready-for-agent',
    '',
    '## Body',
    '',
    '新布局又没写 DSH-PARENT：不是这张地图的子票。',
    '',
  ].join('\n'))

  const ctx = makeCtx(tmpB)
  const be: any = createMarkdownBackend(ctx as never)
  const got: any = await be.listSubIssues(repoOf('effort-a'), '00', {}, ctx)
  check(got.ok === true, '地图容器的 listSubIssues 返回成功')
  const keys: string[] = got.ok ? got.data.items.map((t: any) => String(t.key)) : []
  eq(keys, ['01', '02'], '地图子票来自两处：旧布局 01（按目录归属）与新布局 02（DSH-PARENT: 00）；03 没写父票不算')
} finally {
  fs.rmSync(tmpB, { recursive: true, force: true })
}

// ======================= 三、编号、找不到与歧义 =======================

const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'md-1826-scope-'))
try {
  console.log('-- ⑤ 编号不认识、容器不存在、多个 00 号容器不猜 --')
  for (const effortId of ['unit-a', 'unit-b']) {
    const dir = path.join(tmpC, '.scratch', effortId)
    writeFileDeep(path.join(dir, 'map.md'), '<!-- DSH-FORMAT: md-v1 -->\n<!-- DSH-TITLE: ' + effortId + ' 的地图 -->\n\n## Destination\n\n夹具。\n')
    writeFileDeep(path.join(dir, 'issues', '01-子票.md'), '<!-- DSH-FORMAT: md-v1 -->\n<!-- DSH-PARENT: 00 -->\n# 01: 子票\n\n**Status:** resolved\n\n## Body\n\n夹具。\n')
  }
  const ctxC = makeCtx(tmpC)
  const beC: any = createMarkdownBackend(ctxC as never)

  const badKey: any = await beC.listSubIssues(repoOf(), 'abc', {}, ctxC)
  check(badKey.ok === false && badKey.error.kind === 'parse', '容器编号不是数字 → parse 失败（不是静默空清单）')
  check(badKey.ok === false && badKey.error.stage === 'input-refused', '坏编号标成「输入被拒」，回执据此提示改输入')
  check(degradedReasons(ctxC).includes('listSubIssues:bad-key'), '坏编号落一行 listSubIssues:bad-key')

  const missing: any = await beC.listSubIssues(repoOf(), '09', {}, ctxC)
  check(missing.ok === false && missing.error.kind === 'not-found', '这个范围里没有 09 号容器 → not-found')
  check(degradedReasons(ctxC).includes('listSubIssues:notfound'), '找不到容器落一行 listSubIssues:notfound')

  const ambiguous: any = await beC.listSubIssues(repoOf(), '00', {}, ctxC)
  check(ambiguous.ok === false && ambiguous.error.kind === 'conflict', '两个工作单元都有 00 号容器、又没指定工作单元 → conflict（拒绝猜）')
  check(ambiguous.ok === false && ambiguous.error.stage === 'input-refused', '歧义标成「输入被拒」')
  check(degradedReasons(ctxC).includes('listSubIssues:ambiguous'), '歧义落一行 listSubIssues:ambiguous')

  const scoped: any = await beC.listSubIssues(repoOf('unit-a'), '00', {}, ctxC)
  check(scoped.ok === true && scoped.data.items.length === 1, '指定工作单元 unit-a 后只回它的 1 张子票')
} finally {
  fs.rmSync(tmpC, { recursive: true, force: true })
}

// ======================= 四、读不动就整体失败 =======================

const tmpD = fs.mkdtempSync(path.join(os.tmpdir(), 'md-1826-fail-'))
try {
  console.log('-- ⑥ 票文件读不动：整体失败，不回缺行的清单 --')
  const dir = path.join(tmpD, '.scratch', 'demo')
  writeFileDeep(path.join(dir, 'map.md'), '<!-- DSH-FORMAT: md-v1 -->\n<!-- DSH-TITLE: 夹具地图 -->\n\n## Destination\n\n夹具。\n')
  writeFileDeep(path.join(dir, 'issues', '01-好票.md'), '<!-- DSH-FORMAT: md-v1 -->\n<!-- DSH-PARENT: 00 -->\n# 01: 好票\n\n**Status:** resolved\n\n## Body\n\n能读。\n')
  writeFileDeep(path.join(dir, 'issues', '02-坏票.md'), '<!-- DSH-FORMAT: md-v1 -->\n<!-- DSH-PARENT: 00 -->\n# 02: 坏票\n\n**Status:** resolved\n\n## Body\n\n读不动。\n')

  const ctxD = makeCtx(tmpD, ['02-坏票.md'])
  const beD: any = createMarkdownBackend(ctxD as never)
  const broken: any = await beD.listSubIssues(repoOf('demo'), '00', {}, ctxD)
  check(broken.ok === false, '有票文件读不动时整体失败，不返回只有 1 张的清单')
  if (!broken.ok) {
    check(String(broken.error.message).indexOf('本地 Markdown 有票文件或票目录读不动') === 0,
      '失败消息直说「有票文件或票目录读不动，子票清单不完整」→ ' + String(broken.error.message).slice(0, 60))
    check(String(broken.error.message).includes('02-坏票.md'), '失败消息点名是哪一张读不动（用户能照着去查）')
  }
  check(degradedReasons(ctxD).includes('listSubIssues:read-fail'), '票读不动落一行 listSubIssues:read-fail')

  const ctxMapBad = makeCtx(tmpD, ['map.md'])
  const beMapBad: any = createMarkdownBackend(ctxMapBad as never)
  const noContainer: any = await beMapBad.listSubIssues(repoOf('demo'), '00', {}, ctxMapBad)
  check(noContainer.ok === false && noContainer.error.kind === 'not-found', '容器文件读不动时如实回「没找到这个容器」（读不出来就是读不出来）')
  check(degradedReasons(ctxMapBad).includes('listSubIssues:map-read-fail'), '容器文件读不动落一行 listSubIssues:map-read-fail')

  const ctxThrow = makeCtx(tmpD)
  const realPath = ctxThrow.platform.path
  ctxThrow.platform.path = {
    ...realPath,
    join() { throw new Error('boom: join 抛了（模拟这一趟自己折了）') },
  } as typeof realPath
  const beThrow: any = createMarkdownBackend(ctxThrow as never)
  const threw: any = await beThrow.listSubIssues(repoOf('demo'), '00', {}, ctxThrow)
  check(threw.ok === false, '枚举这一趟自己折了 → 如实回失败，不吞成空清单')
  check(degradedReasons(ctxThrow).includes('listSubIssues:fs-fail'), '整趟折了落一行 listSubIssues:fs-fail')
} finally {
  fs.rmSync(tmpD, { recursive: true, force: true })
}

console.log('\n共 ' + checked + ' 条断言')
console.log(failed ? '\n存在失败 — verify-1826-markdown-subissues 未通过' : '\n全部通过 — 本地 Markdown 后端的容器子票数得全')
process.exit(failed ? 1 : 0)
