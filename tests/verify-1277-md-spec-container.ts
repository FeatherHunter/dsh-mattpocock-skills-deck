// tests/verify-1277-md-spec-container.ts —— #1277 本地 Markdown 后端规格容器：标记、建票、改票、快照兜底的门禁
// 用法：node --import ./scripts/ts-hook.mts tests/verify-1277-md-spec-container.ts，可独立运行。
//
// 断六件事：
//  ① 共享标记包：合法值表、整行判据、文件头/首行读法、剥行；正文里举例的标记不算。
//  ② 本地房读票：文件头有 spec 标记的票读出契约类型 spec；标记写在标题之后不算；ticket 标记不改契约类型。
//  ③ 本地房建票：spec/ticket 的标记落在幂等锚之后、父注释之前；不写 Type: spec；正文里的旧标记被剥掉。
//  ④ 整份替换正文：盘上的标记被搬回、读回来还是 spec；丢掉标记会被核对判坏。
//  ⑤ 快照兜底：类型没标对但文件头有 spec 标记的行，仍被组装成规格容器（实施票挂它下面、不进普通票池）。
//  ⑥ deck 规则侧：spec/ticket 的必备标签是 ready-for-agent，不补进度区；任务票行为不变。
//
// 门禁归属: src/shared/issue-file/src/marker.ts
// 门禁归属: src/tracker/rooms/markdown/parse.ts
// 门禁归属: src/tracker/rooms/markdown/issues-create.ts
// 门禁归属: src/tracker/rooms/markdown/patch-body.ts
// 门禁归属: src/host/tracker/snapshotAssemble.ts
// 门禁归属: src/deck/rules/minimal-spec.ts
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT: string = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const load = (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href)

let failed = false
let total = 0
const check = (ok: boolean, msg: string, detail?: unknown): void => {
  total += 1
  console.log((ok ? '  PASS ' : '  FAIL ') + msg + (ok ? '' : (detail !== undefined && detail !== null ? ' — ' + String(detail).slice(0, 300) : '')))
  if (!ok) failed = true
}

async function main(): Promise<void> {
  const marker = await load('src/shared/issue-file/src/marker.ts')
  const { parseMd } = await import('../src/tracker/rooms/markdown/parse.ts')
  const { mergeWholeBodyForPatch, checkNoWorseForPatch } = await import('../src/tracker/rooms/markdown/patch-body.ts')
  const { assembleSnapshot } = await import('../src/host/tracker/snapshotAssemble.ts')
  const { ensureLabels, ensureBody } = await import('../src/deck/rules/minimal-spec.ts')

  console.log('\n== ① 共享标记包：语法、文件头读法、剥行 ==')
  check(marker.OBJECT_KINDS.length === 9, '合法值有九种', marker.OBJECT_KINDS)
  check(marker.isObjectKind('spec') && marker.isObjectKind('ticket'), 'spec 与 ticket 是合法值')
  check(!marker.isObjectKind('specs') && !marker.isObjectKind(''), '拼错的值不是合法值')
  check(marker.markerLineFor('spec') === '<!-- DSH-ISSUE-KIND: spec -->\n', '写出来的标记行形状固定')
  check(marker.markerLineFor('specs') === '', '非法类型不写标记')
  check(marker.markerKindOnLine('<!-- DSH-ISSUE-KIND: spec -->') === 'spec', '整行标记认得出')
  check(marker.markerKindOnLine('  <!-- DSH-ISSUE-KIND: ticket -->  ') === 'ticket', '前后空白不影响整行判据')
  check(marker.markerKindOnLine('正文明说 <!-- DSH-ISSUE-KIND: spec --> 这样写') === null, '行里夹着别的话不算标记')
  check(marker.markerKindOnLine('<!-- DSH-ISSUE-KIND: unknown -->') === null, '未知类型不算标记')
  const HEADER_SPEC = '<!-- DSH-IDEMPOTENCY-KEY: k -->\n<!-- DSH-ISSUE-KIND: spec -->\n<!-- parentKey: 00 -->\n# 标题\n\n正文里再写一次 <!-- DSH-ISSUE-KIND: map --> 也不算\n'
  check(marker.markerKindInHeader(HEADER_SPEC) === 'spec', '文件头标记认得出，正文里的不算')
  check(marker.markerKindInHeader('# 标题\n\n<!-- DSH-ISSUE-KIND: spec -->\n') === null, '标题之后写的标记不算文件头')
  check(marker.markerKindInHeader('<!-- DSH-ISSUE-KIND: spec -->\n# 标题\n') === 'spec', '标题之前的标记算文件头')
  check(marker.markerKindAtStart('\n\n<!-- DSH-ISSUE-KIND: ticket -->\n# 标题\n') === 'ticket', '首个非空行的标记认得出')
  check(marker.markerKindAtStart('<!-- DSH-IDEMPOTENCY-KEY: k -->\n<!-- DSH-ISSUE-KIND: ticket -->\n') === null, '首行不是标记就不算首行标记')
  const stripped = marker.stripMarkerLines('<!-- DSH-ISSUE-KIND: spec -->\n<!-- DSH-IDEMPOTENCY-KEY: k -->\n# 标题\n')
  check(stripped.indexOf('DSH-ISSUE-KIND') < 0 && stripped.indexOf('DSH-IDEMPOTENCY-KEY') >= 0, '剥标记只剥标记行、别的注释留着')
  check(marker.stripMarkerLines(HEADER_SPEC).indexOf('正文里再写一次') >= 0, '正文里那句引用不算标记、原样留着')

  console.log('\n== ② 本地房读票：文件头标记决定契约类型 ==')
  const SPEC_FILE = [
    '<!-- DSH-IDEMPOTENCY-KEY: spec-1 -->',
    '<!-- DSH-ISSUE-KIND: spec -->',
    '<!-- parentKey: 00 -->',
    '# 实施地图规格',
    '',
    '## 问题陈述',
    '现在改一处规格要翻三个文件。',
    '',
    '## 解决方案',
    '把规格当成一张票。',
    'Status: ready-for-agent',
    'Blocked by:',
    'Labels: ready-for-agent',
    '',
    '## Comments',
    '',
    '',
    '## Answer',
    '',
  ].join('\n')
  const parsedSpec = parseMd(SPEC_FILE, { key: '02', parentKey: '00', isMap: false })
  check(parsedSpec.type === 'spec', '文件头 spec 标记读成契约类型 spec', parsedSpec.type)
  check(parsedSpec.parentKey === '00', '规格的父票从文件头读出来', parsedSpec.parentKey)
  const afterHeading = '<!-- DSH-IDEMPOTENCY-KEY: k -->\n# 标题\n\n<!-- DSH-ISSUE-KIND: spec -->\n\n正文\n'
  check(parseMd(afterHeading, { key: '03', parentKey: '00', isMap: false }).type === 'issue', '标题之后的标记不改类型')
  const ticketFile = '<!-- DSH-ISSUE-KIND: ticket -->\n# 实施票\n\n正文\n'
  check(parseMd(ticketFile, { key: '03', parentKey: '02', isMap: false }).type === 'issue', 'ticket 标记不改契约类型（契约只有三种）')
  const typeOnly = '<!-- DSH-IDEMPOTENCY-KEY: k -->\n# 标题\n\nType: spec\n\n正文\n'
  check(parseMd(typeOnly, { key: '04', parentKey: '00', isMap: false }).type === 'issue', '只写 Type: spec 不再当规格')

  console.log('\n== ③ 本地房建票：写标记、剥重复、不写 Type 行 ==')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'md-spec-1277-'))
  const plat = {
    path: path.posix,
    fs: {
      async resolve(p: string) { return p },
      async readText(t: string) { return fs.readFileSync(t, 'utf8') },
      async writeText(t: string, c: string) { fs.mkdirSync(path.dirname(t), { recursive: true }); fs.writeFileSync(t, c, 'utf8') },
      async lstat(t: string) { try { return fs.statSync(t) } catch { return null } },
      async listDir(t: string) { try { return fs.readdirSync(t) } catch { return [] } },
      async stat(t: string) { try { return fs.statSync(t) } catch { return null } },
    },
  }
  const mkCtx = (cwd: string) => ({
    platform: plat,
    fs: plat.fs,
    cwd,
    get(name: string) { if (name === 'fs') return plat.fs; return undefined },
  })
  const repo = { backend: 'markdown', refId: '.scratch/demo', name: 'demo', url: '' }
  const ctx = mkCtx(tmp)
  const issuesDir = path.join(tmp, '.scratch', 'demo', 'issues')
  fs.mkdirSync(issuesDir, { recursive: true })
  fs.writeFileSync(path.join(tmp, '.scratch', 'demo', 'map.md'), '# Demo Map\n\nStatus: ready-for-agent\n\n## Destination\n\nDemo\n', 'utf8')
  const { createIssue } = await import('../src/tracker/rooms/markdown/issues.ts')

  const createdSpec = await createIssue(ctx, repo, {
    title: '实施地图规格', body: '## 问题陈述\n\n要做的事。', status: 'ready-for-agent',
    type: 'spec', parentKey: '00', labels: ['ready-for-agent'], idempotencyKey: 'spec-1277-a',
  })
  check(!!(createdSpec && createdSpec.ok), '建规格票成功', createdSpec && createdSpec.error)
  check(!!(createdSpec && createdSpec.ok && createdSpec.data.type === 'spec'), '建票回包按标记读回 spec', createdSpec && createdSpec.ok && createdSpec.data.type)
  const specFileName = fs.readdirSync(issuesDir).find((f: string) => /^\d+-/.test(f) && fs.readFileSync(path.join(issuesDir, f), 'utf8').indexOf('spec-1277-a') >= 0)
  check(!!specFileName, '规格票落成 issues/NN-slug.md', fs.readdirSync(issuesDir))
  let specText = ''
  if (specFileName) {
    specText = fs.readFileSync(path.join(issuesDir, specFileName), 'utf8')
    const lines = specText.split('\n')
    check(/^<!-- DSH-IDEMPOTENCY-KEY:/.test(lines[0]) && /^<!-- DSH-ISSUE-KIND: spec -->$/.test(lines[1]), '文件头顺序：幂等锚之后紧跟标记', lines.slice(0, 4))
    check(/^<!-- parentKey: 00 -->$/.test(lines[2]) && /^<!-- created: /.test(lines[3]), '父注释与建票时间都在标记之后', lines.slice(0, 4))
    check(!/^\s*Type\s*[:\uFF1A]/.test(specText), '规格票不写 Type: spec 行')
    check((specText.match(/DSH-ISSUE-KIND/g) || []).length === 1, '文件里只有一条标记')
  }

  const specKey = specFileName ? (specFileName.match(/^(\d+)-/) || [])[1] : '02'
  const createdTicket = await createIssue(ctx, repo, {
    title: '第一张实施票', body: '要构建什么：先把标记读起来。', status: 'ready-for-agent',
    type: 'ticket', parentKey: specKey, labels: ['ready-for-agent'], idempotencyKey: 'ticket-1277-a',
  })
  check(!!(createdTicket && createdTicket.ok), '建实施票成功', createdTicket && createdTicket.error)
  check(!!(createdTicket && createdTicket.ok && createdTicket.data.parentKey === specKey), '实施票父关系读回来指向规格', createdTicket && createdTicket.ok && createdTicket.data.parentKey)
  const ticketFileName = fs.readdirSync(issuesDir).find((f: string) => /^\d+-/.test(f) && fs.readFileSync(path.join(issuesDir, f), 'utf8').indexOf('ticket-1277-a') >= 0)
  if (ticketFileName) {
    const ticketText = fs.readFileSync(path.join(issuesDir, ticketFileName), 'utf8')
    check(/<!-- DSH-ISSUE-KIND: ticket -->/.test(ticketText), '实施票文件头写 ticket 标记')
  }

  const bodyWithMarker = '<!-- DSH-ISSUE-KIND: spec -->\n\n## 问题陈述\n\n正文里也带着标记。'
  const createdDup = await createIssue(ctx, repo, {
    title: '带旧标记的正文', body: bodyWithMarker, status: 'ready-for-agent',
    type: 'spec', parentKey: '00', idempotencyKey: 'spec-1277-b',
  })
  check(!!(createdDup && createdDup.ok), '带标记的正文能建票', createdDup && createdDup.error)
  const dupFileName = fs.readdirSync(issuesDir).find((f: string) => /^\d+-/.test(f) && fs.readFileSync(path.join(issuesDir, f), 'utf8').indexOf('spec-1277-b') >= 0)
  if (dupFileName) {
    const dupText = fs.readFileSync(path.join(issuesDir, dupFileName), 'utf8')
    check((dupText.match(/DSH-ISSUE-KIND/g) || []).length === 1, '正文里重复的标记被剥掉、只留文件头一条', (dupText.match(/DSH-ISSUE-KIND/g) || []).length)
  }

  const createdTask = await createIssue(ctx, repo, {
    title: '普通任务票', body: '普通正文', status: 'ready-for-agent', type: 'task', idempotencyKey: 'task-1277-a',
  })
  check(!!(createdTask && createdTask.ok && createdTask.data.type === 'issue'), '任务票行为不变', createdTask && createdTask.ok && createdTask.data.type)

  const createdChinese = await createIssue(ctx, repo, {
    title: '中文标题的规格票', body: '## 问题陈述\n\n中文标题也要有像样的文件名。', status: 'ready-for-agent',
    type: 'spec', parentKey: '00', idempotencyKey: 'spec-1277-zh',
  })
  check(!!(createdChinese && createdChinese.ok), '中文标题能建规格票', createdChinese && createdChinese.error)
  const zhFileName = fs.readdirSync(issuesDir).find((f: string) => /^\d+-/.test(f) && fs.readFileSync(path.join(issuesDir, f), 'utf8').indexOf('spec-1277-zh') >= 0)
  check(!!zhFileName && /^\d+-中文标题的规格票\.md$/.test(String(zhFileName)),
    '中文标题保留中文、不落成 NN-untitled.md（#1280 验收）', zhFileName)

  console.log('\n== ④ 整份替换正文：盘上的标记搬回、丢标记判坏 ==')
  {
    const wholeIncoming = [
      '# 实施地图规格',
      '',
      '## 问题陈述',
      '换过一遍的问题陈述。',
      '',
      'Status: ready-for-agent',
      'Blocked by:',
      'Labels: ready-for-agent',
      '',
      '## Comments',
      '',
      '',
      '## Answer',
      '',
    ].join('\n')
    const merged = mergeWholeBodyForPatch(wholeIncoming, specText)
    check(merged.indexOf('<!-- DSH-ISSUE-KIND: spec -->') >= 0, '整份替换后盘上的标记被搬回')
    check(checkNoWorseForPatch(specText, merged) === '', '搬回标记后的正文通过核对', checkNoWorseForPatch(specText, merged))
    check(parseMd(merged, { key: '02', parentKey: '00', isMap: false }).type === 'spec', '整份替换后读回来还是 spec')
    const bad = checkNoWorseForPatch('<!-- DSH-ISSUE-KIND: spec -->\n# 标题\n\nStatus: open\nBlocked by:\nLabels:\n', '# 标题\n\nStatus: open\nBlocked by:\nLabels:\n')
    check(bad === '类型标记丢了', '整份替换丢掉标记会被核对判坏', bad)
    const doubled = merged.replace('## Comments', '<!-- DSH-ISSUE-KIND: spec -->\n\n## Comments')
    check(checkNoWorseForPatch(merged, doubled) !== '', '标记翻倍会被核对判坏')
  }

  console.log('\n== ⑤ 快照兜底：类型没标对、但文件头有标记的行仍当规格容器 ==')
  {
    const specBody = '<!-- DSH-ISSUE-KIND: spec -->\n# 规格标题\n\n## 问题陈述\n\n要做的事。\n\n## 解决方案\n\n把规格当容器。\n'
    const rows = [
      { key: '00', number: 0, effortId: 'demo', type: 'map', state: 'OPEN', title: '探索地图', parentKey: null, body: '# Demo Map\n\n## Destination\n\nDemo\n', isPullRequest: false },
      { key: '02', number: 2, effortId: 'demo', type: 'issue', state: 'OPEN', title: '规格标题', parentKey: '00', body: specBody, isPullRequest: false },
      { key: '03', number: 3, effortId: 'demo', type: 'issue', state: 'OPEN', title: '实施票', parentKey: '02', body: '# 实施票\n\n正文\n', isPullRequest: false },
      { key: '04', number: 4, effortId: 'demo', type: 'issue', state: 'OPEN', title: '普通票', parentKey: null, body: '# 普通票\n\n正文\n', isPullRequest: false },
    ]
    const snap = assembleSnapshot(repo, rows)
    check(snap.maps.length === 2, '地图与兜底规格都进容器数组', snap.maps.map((m: any) => m.key))
    const container = snap.maps.filter((m: any) => String(m.type) === 'spec')[0]
    check(!!container && container.key === '02', '类型没标对的行被兜成规格容器', container && container.key)
    check(!!container && container.tickets.length === 1 && container.tickets[0].key === '03', '实施票挂在规格下面', container && container.tickets.map((t: any) => t.key))
    check(!!container && container.sections && container.sections.problem === '要做的事。', '兜底规格也填七段 sections', container && container.sections && container.sections.problem)
    check(snap.issues.length === 1 && snap.issues[0].key === '04', '规格与实施票都不进普通票池', snap.issues.map((i: any) => i.key))

    const markerAfterHeading = Object.assign({}, rows[1], { key: '05', title: '标题后的标记', parentKey: null, body: '# 标题\n\n<!-- DSH-ISSUE-KIND: spec -->\n\n## 问题陈述\n\n正文\n' })
    const snap2 = assembleSnapshot(repo, rows.filter((r: any) => r.key !== '02').concat([markerAfterHeading]))
    check(snap2.maps.length === 1 && snap2.maps[0].type === 'map', '标题之后的标记不触发兜底', snap2.maps.map((m: any) => m.key))
    check(snap2.issues.some((i: any) => i.key === '05') && snap2.issues.some((i: any) => i.key === '04'), '没触发的行仍在普通票池', snap2.issues.map((i: any) => i.key))
  }

  console.log('\n== ⑥ deck 规则侧：spec/ticket 的必备标签与正文 ==')
  {
    const specLabels = ensureLabels([], 'spec')
    check(specLabels.labels.length === 1 && specLabels.labels[0] === 'ready-for-agent', '规格票必备标签是 ready-for-agent', specLabels.labels)
    check(specLabels.added.length === 1 && specLabels.added[0] === 'ready-for-agent', '规格票补标签有记录')
    const ticketLabels = ensureLabels(['ready-for-agent'], 'ticket')
    check(ticketLabels.labels.length === 1 && ticketLabels.added.length === 0, '实施票已带必备标签时不重复补', ticketLabels)
    const specBody = ensureBody('## 问题陈述\n\n要做的事。', 'spec')
    check(specBody.body.indexOf('## 进度') < 0 && specBody.added.length === 0, '规格票不补进度区', specBody)
    const ticketBody = ensureBody('要构建什么：先做这一步。', 'ticket')
    check(ticketBody.body.indexOf('## 进度') < 0 && ticketBody.added.length === 0, '实施票不补进度区', ticketBody)
    const taskLabels = ensureLabels([], 'task')
    check(taskLabels.labels.indexOf('wayfinder:task') >= 0, '任务票行为不变（仍补 wayfinder:task）', taskLabels.labels)
    const taskBody = ensureBody('普通正文', 'task')
    check(taskBody.body.indexOf('## 进度') >= 0, '任务票行为不变（仍补进度区）', taskBody.added)
  }

  fs.rmSync(tmp, { recursive: true, force: true })
  console.log('\n' + (failed ? '失败' : '全通过') + '：' + total + ' 条断言')
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
