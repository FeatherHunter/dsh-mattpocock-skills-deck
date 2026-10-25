// tests/verify-1277-md-spec-container.ts —— #1277 本地 Markdown 后端规格容器：标记、建票、改票、快照兜底的门禁
// 用法：node --import ./scripts/ts-hook.mts tests/verify-1277-md-spec-container.ts，可独立运行。
//
// 断六件事：
//  ① 共享标记包：合法值表、整行判据、文件头/首行读法、剥行；正文里举例的标记不算。
//  ② 本地房读票：文件头有 spec 标记的票读出契约类型 spec；标记写在标题之后不算；ticket 标记不改契约类型。
//  ③ 本地房建票：spec 的标记落在幂等锚之后；规格是顶层容器、不写父注释；不写 Type: spec；正文里的旧标记被剥掉。
//  ④ 整份替换正文：盘上的标记被搬回、读回来还是 spec；丢掉标记会被核对判坏。
//  ⑤ 快照兜底：类型没标对但文件头有 spec 标记的行，仍被组装成规格容器（实施票挂它下面、不进普通票池）。
//  ⑥ deck 规则侧：规格与实施票（spec/spec-ticket）的必备标签是 ready-for-agent，进度区也补（#1403 起所有位置统一）；
//     地图工单（map-ticket）补 wayfinder:task，普通票（issue）不补标签；所有位置都补进度。
//
// 门禁归属: src/shared/issue-file/src/marker.ts
// 门禁归属: src/tracker/rooms/markdown/issues.ts
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
  const HEADER_SPEC = '<!-- DSH-IDEMPOTENCY-KEY: k -->\n<!-- DSH-ISSUE-KIND: spec -->\n# 标题\n\n正文里再写一次 <!-- DSH-ISSUE-KIND: map --> 也不算\n'
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
  const parsedSpec = parseMd(SPEC_FILE, { key: '02', parentKey: null, isMap: false })
  check(parsedSpec.type === 'spec', '文件头 spec 标记读成契约类型 spec', parsedSpec.type)
  check(parsedSpec.parentKey === null, '规格是顶层容器，没有父票', parsedSpec.parentKey)
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
    type: 'spec', parentKey: null, labels: ['ready-for-agent'], idempotencyKey: 'spec-1277-a',
  })
  check(!!(createdSpec && createdSpec.ok), '建规格票成功', createdSpec && createdSpec.error)
  check(!!(createdSpec && createdSpec.ok && createdSpec.data.type === 'spec'), '建票回包按标记读回 spec', createdSpec && createdSpec.ok && createdSpec.data.type)
  // #1486：规格不再占 issues/NN，固定落在 <feature>/spec.md，编号是容器 00。
  const specPath = path.join(tmp, '.scratch', 'demo', 'spec.md')
  check(fs.existsSync(specPath), '规格票落成 spec.md', fs.existsSync(specPath))
  let specText = ''
  if (fs.existsSync(specPath)) {
    specText = fs.readFileSync(specPath, 'utf8')
    const lines = specText.split('\n')
    // #1480：规格没有可见一级标题，标题值放在 DSH-TITLE 注释里；它固定排在 DSH-FORMAT 之后、DSH-STATUS 之前。
    check(/^<!-- DSH-FORMAT: /.test(lines[0]) && /^<!-- DSH-TITLE: 实施地图规格 -->$/.test(lines[1]) && /^<!-- DSH-STATUS: /.test(lines[2]), '文件头：格式、标题、状态依次排列', lines.slice(0, 4))
    check(lines.slice(0, 6).every((l: string) => !/^<!--\s*(?:parentKey|DSH-ISSUE-KIND)/.test(l)), '规格不写父注释、也不再写旧类型标记', lines.slice(0, 6))
    check(!/^\s*Type\s*[:\uFF1A]/.test(specText), '规格票不写 Type: spec 行')
    check((specText.match(/DSH-ISSUE-KIND/g) || []).length === 0, '新布局文件里没有旧类型标记')
  }

  const specKey = '00'
  const createdTicket = await createIssue(ctx, repo, {
    title: '第一张实施票', body: '**What to build:** 先把标记读起来。', status: 'ready-for-agent',
    type: 'ticket', parentKey: specKey, labels: ['ready-for-agent'], idempotencyKey: 'ticket-1277-a',
  })
  check(!!(createdTicket && createdTicket.ok), '建实施票成功', createdTicket && createdTicket.error)
  check(!!(createdTicket && createdTicket.ok && createdTicket.data.parentKey === specKey), '实施票父关系读回来指向规格', createdTicket && createdTicket.ok && createdTicket.data.parentKey)
  const ticketFileName = fs.readdirSync(issuesDir).find((f: string) => /^\d+-/.test(f) && fs.readFileSync(path.join(issuesDir, f), 'utf8').indexOf('ticket-1277-a') >= 0)
  if (ticketFileName) {
    const ticketText = fs.readFileSync(path.join(issuesDir, ticketFileName), 'utf8')
    check(/<!-- DSH-PARENT: 00 -->/.test(ticketText), '实施票文件头用 DSH-PARENT 写父票')
  }

  // 实施票的父必须是规格票（ADR 2.1、#1280 验收②）：没写父时落在同目录唯一规格的 00 下；
  // 父号不是 00、或者目录里只有探索地图没有规格，都要当场失败、盘上不落票。
  const noParent = await createIssue(ctx, repo, {
    title: '没写父票的实施票', body: '**What to build:** 同目录只有一份规格，父就是 00。', status: 'ready-for-agent',
    type: 'ticket', labels: ['ready-for-agent'], idempotencyKey: 'ticket-1277-noparent',
  })
  check(!!(noParent && noParent.ok && noParent.data.parentKey === '00'), '没写父票的实施票落在同目录唯一规格的 00 下', noParent && (noParent.ok ? noParent.data.parentKey : noParent.error.message))
  const mapOnlyDir = path.join(tmp, '.scratch', 'maponly')
  fs.mkdirSync(mapOnlyDir, { recursive: true })
  fs.writeFileSync(path.join(mapOnlyDir, 'map.md'), '# 只有地图\n\nStatus: ready-for-agent\n\n## Destination\n\n演示\n', 'utf8')
  const mapOnlyRepo = { backend: 'markdown', refId: '.scratch/maponly', name: 'maponly', url: '', effortId: 'maponly', mdScene: 'effort' }
  const badTickets = [
    await createIssue(ctx, repo, {
      title: '父号不是 00 的实施票', body: '**What to build:** 不该建出来。', status: 'ready-for-agent',
      type: 'ticket', parentKey: '99', labels: ['ready-for-agent'], idempotencyKey: 'ticket-1277-badparent',
    }),
    await createIssue(ctx, mapOnlyRepo, {
      title: '挂探索地图的实施票', body: '**What to build:** 不该建出来。', status: 'ready-for-agent',
      type: 'ticket', parentKey: '00', labels: ['ready-for-agent'], idempotencyKey: 'ticket-1277-map',
    }),
  ]
  check(badTickets.every((r: any) => r && r.ok === false), '父号不是 00 / 目录里没有规格的实施票都建不出来', badTickets.map((r: any) => r && (r.ok === false ? r.error.message : 'ok')))
  check(badTickets.some((r: any) => r && r.ok === false && String(r.error.message || '').indexOf('规格') >= 0), '失败原因说清父必须是规格票', badTickets.map((r: any) => r && (r.ok === false ? r.error.message : '')))

  // 父注释插入顺序（ADR 2.5 第三处落点）：补父时 parentKey 必须排在锚与已有标记之后。
  // 规格是与地图同级的顶层容器、不能有父票，所以这里改用一张普通票（issue）验证插入顺序：
  // 它建出来时没有父注释，补一个与默认父票（'00'）不同的父号，才会真的走「插入一行」这一支。
  const createdOrder = await createIssue(ctx, repo, {
    title: '父注释插入顺序', body: '', status: 'ready-for-agent',
    type: 'issue', parentKey: null, idempotencyKey: 'issue-1277-order',
  })
  check(!!(createdOrder && createdOrder.ok), '建一张不带父注释的普通票', createdOrder && createdOrder.error)
  if (createdOrder && createdOrder.ok) {
    const { setParentIssue } = await import('../src/tracker/rooms/markdown/issues.ts')
    const orderParent = createdTicket && createdTicket.ok ? createdTicket.data.key : '01'
    const moved = await setParentIssue(ctx, repo, createdOrder.data.key, orderParent)
    check(!!(moved && moved.ok), '给普通票补父注释成功', moved && moved.ok ? undefined : (moved as any).error)
    check(!!(moved && moved.ok && moved.data.parentKey === orderParent), '补上的父号读回来是新的值', moved && moved.ok ? moved.data.parentKey : undefined)
    const orderFileName = fs.readdirSync(issuesDir).find((f: string) => /^\d+-/.test(f) && fs.readFileSync(path.join(issuesDir, f), 'utf8').indexOf('issue-1277-order') >= 0)
    if (orderFileName) {
      const orderLines = fs.readFileSync(path.join(issuesDir, orderFileName), 'utf8').split('\n')
      const h1At = orderLines.findIndex((l: string) => /^#\s+/.test(l))
      // #1489：这张票是插件按原文布局建出来的（文件头有 DSH-FORMAT），父票写在文件头注释
      // `<!-- DSH-PARENT: NN -->` 里；旧布局的手写票才写 `<!-- parentKey: NN -->`。两种都算「父注释这一行」，
      // 这里判的是它排在第一个一级标题之前，不判用哪种写法。
      const parentAt = orderLines.findIndex((l: string) => new RegExp('^<!-- (?:parentKey|DSH-PARENT): ' + orderParent + ' -->').test(l))
      const anchorAt = orderLines.findIndex((l: string) => /^<!-- DSH-IDEMPOTENCY-KEY:/.test(l))
      check(parentAt >= 0 && parentAt < h1At && anchorAt >= 0 && anchorAt < h1At,
        '补父注释后父行与幂等锚都在第一个一级标题之前', orderLines.slice(0, 6))
    }
  }

  const bodyWithMarker = '<!-- DSH-ISSUE-KIND: spec -->\n\n## 问题陈述\n\n正文里也带着标记。'
  const dupRepo = { backend: 'markdown', refId: '.scratch/dupdir', name: 'dupdir', url: '', effortId: 'dupdir', mdScene: 'feature' }
  const createdDup = await createIssue(ctx, dupRepo, {
    title: '带旧标记的正文', body: bodyWithMarker, status: 'ready-for-agent',
    type: 'spec', parentKey: null, idempotencyKey: 'spec-1277-b',
  })
  check(!!(createdDup && createdDup.ok), '带标记的正文能建票', createdDup && createdDup.error)
  const dupPath = path.join(tmp, '.scratch', 'dupdir', 'spec.md')
  if (fs.existsSync(dupPath)) {
    const dupText = fs.readFileSync(dupPath, 'utf8')
    check((dupText.match(/DSH-ISSUE-KIND/g) || []).length === 0, '正文里的旧标记被剥掉、文件里一条都不留', (dupText.match(/DSH-ISSUE-KIND/g) || []).length)
    check(dupText.indexOf('正文里也带着标记。') >= 0, '剥标记时正文内容不丢', dupText.slice(0, 200))
  }

  const createdPlain = await createIssue(ctx, repo, {
    title: '普通票', body: '普通正文', status: 'ready-for-agent', type: 'issue', parentKey: null, idempotencyKey: 'issue-1277-a',
  })
  check(!!(createdPlain && createdPlain.ok && createdPlain.data.type === 'issue'), '普通票（issue）不写类型标记，读回来仍是 issue', createdPlain && createdPlain.ok && createdPlain.data.type)
  const plainFileName = fs.readdirSync(issuesDir).find((f: string) => /^\d+-/.test(f) && fs.readFileSync(path.join(issuesDir, f), 'utf8').indexOf('issue-1277-a') >= 0)
  if (plainFileName) {
    const plainText = fs.readFileSync(path.join(issuesDir, plainFileName), 'utf8')
    check(!/^\s*Type\s*[:\uFF1A]/m.test(plainText), '普通票不写 Type 行（位置值不再落成正文类型行）')
  }

  const zhRepo = { backend: 'markdown', refId: '', name: 'zh-ws', url: '', mdScene: 'feature' }
  const createdChinese = await createIssue(ctx, zhRepo, {
    title: '中文标题的规格票', body: '## 问题陈述\n\n中文标题也要有像样的目录名。', status: 'ready-for-agent',
    type: 'spec', parentKey: null, idempotencyKey: 'spec-1277-zh',
  })
  check(!!(createdChinese && createdChinese.ok), '中文标题能建规格票', createdChinese && createdChinese.error)
  const zhDir = path.join(tmp, '.scratch', '中文标题的规格票')
  check(fs.existsSync(path.join(zhDir, 'spec.md')), '中文标题生成中文目录名、规格仍叫 spec.md', fs.existsSync(zhDir) ? fs.readdirSync(zhDir) : [])

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
    // #1486 起新文件不再写旧类型标记；这一段继续用老文件 fixture 守「老文件整份替换时标记搬回」的兼容行为。
    const merged = mergeWholeBodyForPatch(wholeIncoming, SPEC_FILE)
    check(merged.indexOf('<!-- DSH-ISSUE-KIND: spec -->') >= 0, '整份替换后盘上的标记被搬回')
    check(checkNoWorseForPatch(SPEC_FILE, merged) === '', '搬回标记后的正文通过核对', checkNoWorseForPatch(SPEC_FILE, merged))
    check(parseMd(merged, { key: '02', parentKey: null, isMap: false }).type === 'spec', '整份替换后读回来还是 spec')
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
      { key: '02', number: 2, effortId: 'demo', type: 'issue', state: 'OPEN', title: '规格标题', parentKey: null, body: specBody, isPullRequest: false },
      { key: '03', number: 3, effortId: 'demo', type: 'issue', state: 'OPEN', title: '实施票', parentKey: '02', body: '# 实施票\n\n正文\n', isPullRequest: false },
      { key: '04', number: 4, effortId: 'demo', type: 'issue', state: 'OPEN', title: '普通票', parentKey: null, body: '# 普通票\n\n正文\n', isPullRequest: false },
    ]
    const snap = assembleSnapshot(repo, rows)
    check(snap.maps.length === 2, '地图与兜底规格都进容器数组', snap.maps.map((m: any) => m.key))
    const container = snap.maps.filter((m: any) => String(m.type) === 'spec')[0]
    check(!!container && container.key === '02', '类型没标对的行被兜成规格容器', container && container.key)
    check(!!container && container.parentKey === null, '规格是顶层容器，没有父票', container && container.parentKey)
    check(!!container && container.tickets.length === 1 && container.tickets[0].key === '03', '实施票挂在规格下面', container && container.tickets.map((t: any) => t.key))
    check(!!container && container.sections && container.sections.problem === '要做的事。', '兜底规格也填七段 sections', container && container.sections && container.sections.problem)
    check(snap.issues.length === 1 && snap.issues[0].key === '04', '规格与实施票都不进普通票池', snap.issues.map((i: any) => i.key))

    const markerAfterHeading = Object.assign({}, rows[1], { key: '05', title: '标题后的标记', parentKey: null, body: '# 标题\n\n<!-- DSH-ISSUE-KIND: spec -->\n\n## 问题陈述\n\n正文\n' })
    const snap2 = assembleSnapshot(repo, rows.filter((r: any) => r.key !== '02').concat([markerAfterHeading]))
    check(snap2.maps.length === 1 && snap2.maps[0].type === 'map', '标题之后的标记不触发兜底', snap2.maps.map((m: any) => m.key))
    check(snap2.issues.some((i: any) => i.key === '05') && snap2.issues.some((i: any) => i.key === '04'), '没触发的行仍在普通票池', snap2.issues.map((i: any) => i.key))
  }

  console.log('\n== ⑥ deck 规则侧：各位置的必备标签与正文 ==')
  {
    const specLabels = ensureLabels([], 'spec')
    check(specLabels.labels.length === 1 && specLabels.labels[0] === 'ready-for-agent', '规格票必备标签是 ready-for-agent', specLabels.labels)
    check(specLabels.added.length === 1 && specLabels.added[0] === 'ready-for-agent', '规格票补标签有记录')
    const ticketLabels = ensureLabels(['ready-for-agent'], 'spec-ticket')
    check(ticketLabels.labels.length === 1 && ticketLabels.added.length === 0, '实施票已带必备标签时不重复补', ticketLabels)
    const specBody = ensureBody('## 问题陈述\n\n要做的事。', 'spec')
    check(specBody.body.indexOf('## 进度') >= 0 && specBody.added.join('、') === '## 进度', '规格票也补进度区（#1403 起所有位置统一）', specBody.added)
    const ticketBody = ensureBody('要构建什么：先做这一步。', 'spec-ticket')
    check(ticketBody.body.indexOf('## 进度') >= 0 && ticketBody.added.join('、') === '## 进度', '实施票也补进度区（#1403 起所有位置统一）', ticketBody.added)
    const taskLabels = ensureLabels([], 'map-ticket', 'wayfinder:task')
    check(taskLabels.labels.indexOf('wayfinder:task') >= 0, '地图工单（map-ticket）补 wayfinder:task', taskLabels.labels)
    const taskBody = ensureBody('普通正文', 'map-ticket')
    check(taskBody.body.indexOf('## 进度') >= 0, '地图工单也补进度区', taskBody.added)
    const issueLabels = ensureLabels([], 'issue')
    check(issueLabels.labels.length === 0 && issueLabels.added.length === 0, '普通票（issue）不补任何标签', issueLabels.labels)
  }

  fs.rmSync(tmp, { recursive: true, force: true })
  console.log('\n' + (failed ? '失败' : '全通过') + '：' + total + ' 条断言')
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
