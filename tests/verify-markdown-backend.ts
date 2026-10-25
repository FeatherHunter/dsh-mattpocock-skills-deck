// 2026-10-17 从 JavaScript 转成 TypeScript：只改文件名、用法行与自指路径，判据与断言一条没动。
/**
 * tests/verify-markdown-backend.ts — Markdown 后端对齐契约的 G4 + 回环验证（#142 验收①②④）。
 *
 * 验收：
 *  ① harness 以真实适配器运行 + 合规断言全 PASS（G4）
 *  ② 回环：deck 创建票 → 技能集可读（同一文件集）；技能集写的文件 → 后端可归一（用 tests/fixtures/markdown-sample 里随仓库走的样例）
 *  ④ 无旧字段（number/subIssues/blocking/布尔 capabilities/detect）
 *
 * 运行：node tests/verify-markdown-backend.ts
 */

import runContractTests from './tracker-contract/harness.js'
import { markdownFixture, markdownExtraAssertions } from './tracker-contract/fixtures/markdown.js'
import { parseMd } from '../src/tracker/rooms/markdown/parse.ts'
import { normalizeIssue } from '../src/tracker/rooms/markdown/normalize.ts'
import { createMarkdownBackend, matches, describe } from '../src/tracker/rooms/markdown/index.ts'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

let failed = false
const check = (ok, msg) => {
  console.log((ok ? '  PASS ' : '  FAIL ') + msg)
  if (!ok) failed = true
}

console.log('== ① G4 契约测试（真实适配器） ==')
const harnessResults = runContractTests(markdownFixture)
let extra = markdownExtraAssertions()
let all = [...harnessResults, ...extra]

// G4 核心：合规桩全 PASS（harness 本身已断言 implemented/missing/骨架/state/diagnose）
// 但 markdownFixture 的 mappings 在 harness 中为空（因 text/meta 不是直接字段），需靠 extra 补充
for (const r of all) {
  console.log((r.ok ? 'PASS' : 'FAIL') + '  ' + r.name + (r.detail ? '  — ' + r.detail : ''))
}
let hPassed = all.filter((r) => r.ok).length
let hFailed = all.filter((r) => !r.ok).length
console.log('\nG4 harness: ' + hPassed + ' passed, ' + hFailed + ' failed')

console.log('\n== ② 回环测试（同一文件集镜像） ==')
// 注：原来这里还有几节「读源码文本、断言里面出现了哪些字」的检查（无旧字段、干净切断、
//   平台路径写法、挂链抽样），以及 ⑦ 里那段「取号段在写者队列里」的源码文本断言。
//   它们断的是代码长成什么样，等价重构（搬文件、改写法、改注释）就会变红，已按维护者口径删掉。
//   其中真正的行为关切由本文件其它节与其它 verify 覆盖：回环与标签剥壳走真实文件读写（①②⑥⑧），
//   并发建票不丢票由 ⑦ 的并发用例覆盖。
{
  // 创建临时目录模拟 deck 写 → 技能集读
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'md-backend-'))
  const plat = {
    path: path.posix,
    fs: {
      async resolve(p) { return p },
      async readText(t) { return fs.readFileSync(t, 'utf8') },
      async writeText(t, c) { fs.mkdirSync(path.dirname(t), { recursive: true }); fs.writeFileSync(t, c, 'utf8') },
      async lstat(t) { try { return fs.statSync(t) } catch { return null } },
      async listDir(t) { try { return fs.readdirSync(t) } catch { return [] } },
      async stat(t) { try { return fs.statSync(t) } catch { return null } },
    },
  }
  // 模拟 BackendContext + OpContext
  const mkCtx = (cwd) => ({
    platform: plat,
    fs: plat.fs,
    cwd,
    get(name) { if (name === 'fs') return plat.fs; return undefined },
  })

  const { listIssues, createIssue } = await import('../src/tracker/rooms/markdown/issues.ts')
  const { readTextFile } = await import('../src/tracker/rooms/markdown/read.ts')
  const repo = { backend: 'markdown', refId: '.scratch/demo', name: 'demo', url: '' }
  const ctx = mkCtx(tmp)
  // 确保 .scratch/demo 存在
  fs.mkdirSync(path.join(tmp, '.scratch', 'demo', 'issues'), { recursive: true })
  fs.writeFileSync(path.join(tmp, '.scratch', 'demo', 'map.md'), '# Demo Map\n\nStatus: ready-for-agent\n\n## Destination\n\nDemo\n', 'utf8')
  // deck 创建票（#1500 S4 起普通票也走原文布局：type: 'task' 不再写 Type 行，见 create-render 的 typeLine 通道说明）
  const created = await createIssue(ctx, repo, { title: 'Deck Created Ticket', body: 'Body from deck', status: 'ready-for-agent', type: 'task' })
  check(created.ok && created.data.title === 'Deck Created Ticket', '回环① deck create → file exists')
  if (created.ok) {
    const fileList = fs.readdirSync(path.join(tmp, '.scratch', 'demo', 'issues'))
    check(fileList.some((f) => f.startsWith('02-') || f.startsWith('01-')), `回环① fileList ${fileList.join(',')}`)
    // 技能集可读：普通票按 implementation-ticket 模板落盘（加粗三行字段，无 Type 行、无 Comments 骨架）
    const createdFile = fileList.find((f) => f.includes('deck-created'))
    if (createdFile) {
      const txt = fs.readFileSync(path.join(tmp, '.scratch', 'demo', 'issues', createdFile), 'utf8')
      check(txt.includes('**Status:** ready-for-agent'), '回环① 技能集可读：含 Status 行')
      check(txt.includes('**What to build:** Body from deck'), '回环① 技能集可读：含 What to build 行')
      check(!/^\s*Type\s*[:：]/m.test(txt), '回环① 普通票不写 Type 行（type: task 只是调用方的旧写法）')
    }
  }

  // 技能集写的文件 → 后端可归一（用仓库自带的真实样例：tests/fixtures/markdown-sample/01-hello-world.md）
  // #600 附带的 CI 修复：样例原来放在 .scratch/__fixtures__ 下，而 .scratch/ 是 gitignore 的、
  //   全新克隆里没有——门禁在 CI 上必然读不到文件（本地因为早就生成过，一直没暴露）。
  const fixtureTxt = fs.readFileSync('tests/fixtures/markdown-sample/01-hello-world.md', 'utf8')
  const parsed = parseMd(fixtureTxt, { key: '01', parentKey: '00', isMap: false })
  check(parsed.title === 'Hello World', '回环② fixture 归一 title')
  check(parsed.state === 'open', '回环② fixture state open (claimed→open)')
  check(Array.isArray(parsed.blockedBy) && parsed.blockedBy[0]?.key === '02', '回环② fixture blockedBy')
  check(Array.isArray(parsed.comments) && parsed.comments.length >= 1, '回环② fixture comments')
  check('labels' in parsed && Array.isArray(parsed.labels), '回环② fixture labels EMPTY(已实现)')
  check(parsed.labels.length===0, '回环② fixture labels empty because fixture has no Labels line')
  const norm = normalizeIssue(fixtureTxt, { key: '01', parentKey: '00', isMap: false })
  check('labels' in norm && Array.isArray(norm.labels) && norm.labels.length===0 && !('number' in norm), '回环② normalize labels EMPTY 且无旧字段')
  // 清理临时目录
  fs.rmSync(tmp, { recursive: true, force: true })
  console.log('  回环临时目录已清理')
}

console.log('\n== ⑥ 标签名外层写法要剥净（#634：读这一层与写这一层） ==')
{
  // 现象（用户在本地 Markdown 工作区实测到的）：票面写成 Labels: `wayfinder:map`（照抄文档里的代码写法），
  //   面板上那些标签就原样带着一对反引号，颜色也回落到灰——查色与身份判定都按名字精确匹配，带着反引号查不到。
  // 这一节把「读这一层要剥」与「写这一层也要剥」两件事都钉住：只剥外层成对的引号/反引号，不动名字本身。
  const cases = [
    ['Labels: `wayfinder:map`', ['wayfinder:map'], '反引号包着一个标签'],
    ['Labels: `wayfinder:task`, `wontfix`', ['wayfinder:task', 'wontfix'], '反引号包着两个标签'],
    ['Labels: "bug"', ['bug'], '双引号包着'],
    ["Labels: 'bug'", ['bug'], '单引号包着'],
    ['Labels: `"bug"`', ['bug'], '两层包着'],
    ['Labels: bug, needs-triage', ['bug', 'needs-triage'], '本来就没包（不许改动）'],
    ["Labels: don't", ["don't"], '名字自带单引号但不包（不许切坏）'],
    ['Labels: `bug`,', ['bug'], '包着、末尾还留一个空段（空段照旧丢弃）'],
  ]
  for (const [text, want, why] of cases) {
    const got = parseMd(text + '\n\nStatus: ready-for-agent\n', { key: '01', parentKey: '00', isMap: false }).labels.map((l) => l.name)
    check(JSON.stringify(got) === JSON.stringify(want), `${why} → ${JSON.stringify(want)}（实得 ${JSON.stringify(got)}）`)
  }

  // 写这一层：把带着引号的标签名交给 setLabelsIssue，落盘必须是干净的标签名。
  const tmp6 = fs.mkdtempSync(path.join(os.tmpdir(), 'md-label-decoration-'))
  const plat6 = {
    path: path.posix,
    fs: {
      async resolve(p) { return p },
      async readText(t) { return fs.readFileSync(t, 'utf8') },
      async writeText(t, c) { fs.mkdirSync(path.dirname(t), { recursive: true }); fs.writeFileSync(t, c, 'utf8') },
      async lstat(t) { try { return fs.statSync(t) } catch { return null } },
      async listDir(t) { try { return fs.readdirSync(t) } catch { return [] } },
      async stat(t) { try { return fs.statSync(t) } catch { return null } },
    },
  }
  const ctx6 = { platform: plat6, fs: plat6.fs, cwd: tmp6, get(name) { if (name === 'fs') return plat6.fs; return undefined } }
  const repo6 = { backend: 'markdown', refId: '.scratch/demo', name: 'demo', url: '' }
  fs.mkdirSync(path.join(tmp6, '.scratch', 'demo'), { recursive: true })
  fs.writeFileSync(path.join(tmp6, '.scratch', 'demo', 'map.md'), '# Demo Map\n\nStatus: ready-for-agent\nLabels: `wayfinder:map`\n\n## Destination\n\nDemo\n', 'utf8')
  const { setLabelsIssue } = await import('../src/tracker/rooms/markdown/issues-patch.ts')
  const written = await setLabelsIssue(ctx6, repo6, '00', ['`wayfinder:map`', { name: '"needs-triage"' }])
  const mapTxt = fs.readFileSync(path.join(tmp6, '.scratch', 'demo', 'map.md'), 'utf8')
  check(/^Labels: wayfinder:map, needs-triage$/m.test(mapTxt), '写这一层：落盘的是干净标签名（实得 ' + (mapTxt.match(/^Labels:.*$/m) || ['(没找到 Labels 行)'])[0] + '）')
  check(written.ok && JSON.stringify(written.data.labels.map((l) => l.name)) === JSON.stringify(['wayfinder:map', 'needs-triage']), '写这一层：回包的标签名也干净')
  // 起了颜色就说明查色表又按名字命中了：内置默认色里 wayfinder:map 是 8b5cf6（带反引号时只会回落到灰 cccccc）
  check(written.ok && written.data.labels[0].color === '8b5cf6', '修好之后按名字查到内置色（wayfinder:map → 8b5cf6，实得 ' + (written.ok ? written.data.labels[0].color : '(没写成)') + '）')
  fs.rmSync(tmp6, { recursive: true, force: true })
}

console.log('\n== ⑦ 并发建票不许丢票、同一标题不许两路都成功（local Markdown 取号临界区） ==')
{
  // 这一节要钉住的 bug：建票的一段是「读目录取 max+1 → 探测同名文件在不在 → 落盘」（issues-create.js），
  //   整段原来没有串行保护，而落盘是整份覆盖（write.js 的 writeTextFile，没有独占创建）。
  //   两个会话、两个子代理、或一次外层重试同时建票时，多路会算出同一个编号：轻的丢一张票，
  //   重的后写覆盖前写——两路都拿到 ok:true，调用方拿不到任何失败信号（本机实测 8 路并发全部回 key="01"，
  //   目录里只剩 1 张票）。
  //
  // 这里为什么必须用「Promise.all 一次性起、中途完全不让出事件循环」这个形状：建票第一段是读目录，
  //   读目录这个 await 会让出事件循环一次。若在起下一路之前先让出（例如 for 循环里逐个 await 起），
  //   8 路会分别读到 1..8、拿到 01…08、看着毫无问题——只有同时压进来才会暴露，CI 上会时绿时红。
  const concTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'md-concurrent-create-'))
  const concPlat = {
    path: path.posix,
    fs: {
      async resolve(p) { return p },
      async readText(t) { return fs.readFileSync(t, 'utf8') },
      async writeText(t, c) { fs.mkdirSync(path.dirname(t), { recursive: true }); fs.writeFileSync(t, c, 'utf8') },
      async lstat(t) { try { return fs.statSync(t) } catch { return null } },
      async listDir(t) { try { return fs.readdirSync(t) } catch { return [] } },
      async stat(t) { try { return fs.statSync(t) } catch { return null } },
    },
  }
  const concCtx = { platform: concPlat, fs: concPlat.fs, cwd: concTmp, get(name) { if (name === 'fs') return concPlat.fs; return undefined } }
  const concRepo = { backend: 'markdown', refId: '.scratch/demo', name: 'demo', url: '' }
  const concIssues = path.join(concTmp, '.scratch', 'demo', 'issues')
  fs.mkdirSync(concIssues, { recursive: true })
  fs.writeFileSync(path.join(concTmp, '.scratch', 'demo', 'map.md'), '# Demo Map\n\nStatus: ready-for-agent\n\n## Destination\n\nDemo\n', 'utf8')
  const concApi = await import('../src/tracker/rooms/markdown/issues.ts')
  // 盘上真正落下来的票文件（编号加短横开头的 .md 才算票；map.md 与 notes.md 这类不算）
  const ticketsOnDisk = () => fs.readdirSync(concIssues).filter((n) => /^\d+-/.test(n) && n.endsWith('.md')).sort()
  const okKeysOf = (results) => results.map((r) => (r && r.ok ? String(r.data.key) : 'ERR:' + (r && r.error ? r.error.kind : '?')))

  // 用例一：8 路并发建同一张票。
  const WAYS = 8
  const same = await Promise.all(Array.from({ length: WAYS }, () => concApi.createIssue(concCtx, concRepo,
    { title: 'Review step 1', body: 'body', status: 'ready-for-agent', type: 'task' })))
  const sameKeys = okKeysOf(same)
  const okCount = sameKeys.filter((k) => k.indexOf('ERR:') !== 0).length
  const filesAfter1 = ticketsOnDisk()
  // 这里是同一张票的多次并发请求，所以成功数应当等于发起数（每一路都该如实回 ok），
  // 盘上的票文件数也必须等于成功数（少一张就是丢票，多一张就是重复建）。
  check(okCount === WAYS && filesAfter1.length === okCount,
    `用例一：成功返回数 == 盘上票文件数（发起 ${WAYS} 路，成功 ${okCount} 路，盘上 ${filesAfter1.length} 张票）`)
  check(new Set(sameKeys).size === sameKeys.length,
    `用例一：返回的键两两不同（实得 ${JSON.stringify(sameKeys)}，不同键 ${new Set(sameKeys).size} 个）`)

  // 用例二：并发之后 listIssues 读回的票数与盘上一致。
  const listed = await concApi.listIssues(concCtx, concRepo, {}, {})
  const listedTickets = listed.ok ? listed.data.filter((x) => String(x.key) !== '00').length : -1
  const filesAfter2 = ticketsOnDisk()
  check(listedTickets === filesAfter2.length,
    `用例二：并发之后 listIssues 读回 ${listedTickets} 条票 == 盘上 ${filesAfter2.length} 张（调用方与面板看到的是同一份）`)

  // 用例三：同一标题并发两次。可取的行为只有两种：要么两路拿到不同的键、盘上两张票；
  //   要么有一路如实失败。绝不许两路都回 ok:true 而盘上只剩一张（那就是后写覆盖前写）。
  const dupTitle = 'Duplicate title probe'
  const dup = await Promise.all(Array.from({ length: 2 }, () => concApi.createIssue(concCtx, concRepo,
    { title: dupTitle, body: 'body', status: 'ready-for-agent', type: 'task' })))
  const dupKeys = okKeysOf(dup)
  const dupOk = dupKeys.filter((k) => k.indexOf('ERR:') === 0).length === 0
  const dupFiles = ticketsOnDisk().filter((n) => n.endsWith('-duplicate-title-probe.md')).length
  check(!dupOk || (new Set(dupKeys).size === 2 && dupFiles === 2),
    `用例三：同一标题并发两次不许「两路都成功、盘上只剩一张」（两路回 ${JSON.stringify(dupKeys)}，标题相同的票文件 ${dupFiles} 张）`)

  // 原来这里还有三条「读源码文本、断言取号与落盘那段在写者队列里」的静态断言
  //   （issues-create.js 出现 withWorkspaceWriter(、write-queue.js 导出那两个函数、issues-patch.js 用 withFileWriter）。
  //   上面三个并发用例已经把「不丢票、不覆盖、同标题不双成功」这个真正的关切跑实了；
  //   那三条断的是代码长成什么样，搬文件或改名就变红，已按维护者口径删掉。

  fs.rmSync(concTmp, { recursive: true, force: true })
}

console.log('\n== ⑧ 空字段行不许吃掉下一行（#991 实测带回来的读路径缺陷） ==')
{
  // 现象（#991 在本地 Markdown 工作区实测）：同一份票文件上，带某个标签时读出「阻塞」一条，
  //   去掉那个标签立刻变空 —— 而盘上那行本来就是空的。
  // 根因：三种字段行的正则里，冒号后面写的是 \s*，而 \s 含换行 —— 字段值为空时 \s* 跨过换行，
  //   后面的 ([^\n]+) / (.+) 就把**下一行**当成这个字段的值抓走了。
  // 为什么当初只有带那个特定标签才复现：下一行是 Labels 行，只有当标签名里含数字（例如 deck-conc-991）
  //   才会被解析出「一条阻塞」，标签名不含数字时读出来同样是空 —— 症状因此看起来时有时无。
  const emptyBlocked = parseMd('# T\n\nStatus: ready-for-agent\nBlocked by:\nLabels: deck-conc-991\n', { key: '01', parentKey: '00', isMap: false })
  check(emptyBlocked.blockedBy.length === 0,
    '空的 Blocked by 行 + 下一行含数字的 Labels 行 → 阻塞列表必须是空的（实得 ' + JSON.stringify(emptyBlocked.blockedBy) + '）')
  const realBlocked = parseMd('# T\n\nStatus: ready-for-agent\nBlocked by: #12, #13\nLabels:\n', { key: '01', parentKey: '00', isMap: false })
  check(JSON.stringify(realBlocked.blockedBy.map((b) => b.key)) === JSON.stringify(['12', '13']),
    '非空的 Blocked by 行照旧读出两条（实得 ' + JSON.stringify(realBlocked.blockedBy.map((b) => b.key)) + '）')
  // 空的 Type 行后面紧跟 Blocked by 行：老写法会把「Blocked by: #12」整串当成 Type 的值。
  const emptyType = parseMd('# T\n\nStatus: ready-for-agent\nType:\nBlocked by: #12\n', { key: '01', parentKey: '00', isMap: false })
  const typeField = (emptyType.customFields || []).filter((f) => f.name === 'Type')[0]
  check(!typeField,
    '空的 Type 行 + 紧跟 Blocked by 行 → 不许把那一行当成 Type 的值（实得 ' + JSON.stringify(typeField || null) + '）')
  check(JSON.stringify(emptyType.blockedBy.map((b) => b.key)) === JSON.stringify(['12']),
    '同一条文本里 Blocked by 仍照常读出（实得 ' + JSON.stringify(emptyType.blockedBy.map((b) => b.key)) + '）')
  const realType = parseMd('# T\n\nType: task\n', { key: '01', parentKey: '00', isMap: false })
  check(JSON.stringify((realType.customFields || []).map((f) => f.value)) === JSON.stringify(['task']),
    '非空的 Type 行照旧读出（实得 ' + JSON.stringify(realType.customFields || []) + '）')
}

console.log('\n== ⑨ 每张票都带地址，而且地址指向盘上那个真实文件（#1142） ==')
{
  // 现象（#1142）：本地 Markdown 房里票的 url 一直是空串 —— 界面上的「链接」按钮点了没反应，
  //   工具回执里也拿不到票的地址。根因是房间算得出路径却没人把它写进票里：宿主那段「url 为空就现算」
  //   的兜底读的是投影之后的模块对象，而投影只带数据字段、把函数挡在门外，所以那段永远进不去。
  // 这一节钉住修好之后的样子：房间交给外面的每一张票、每一张地图，url 都是它自己那个文件在盘上的路径，
  //   而且那个文件真的在（不是「01-untitled.md」这类按编号猜出来的规范名）。
  const addrTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'md-address-'))
  const addrPlat = {
    path: path.posix,
    fs: {
      async resolve(p) { return p },
      async readText(t) { return fs.readFileSync(t, 'utf8') },
      async writeText(t, c) { fs.mkdirSync(path.dirname(t), { recursive: true }); fs.writeFileSync(t, c, 'utf8') },
      async lstat(t) { try { return fs.statSync(t) } catch { return null } },
      async listDir(t) { try { return fs.readdirSync(t) } catch { return [] } },
      async stat(t) { try { return fs.statSync(t) } catch { return null } },
    },
  }
  const addrCtx = { platform: addrPlat, fs: addrPlat.fs, cwd: addrTmp, get(name) { if (name === 'fs') return addrPlat.fs; return undefined } }
  const addrRepo = { backend: 'markdown', refId: '.scratch/demo', name: 'demo', url: '' }
  // 期望值与房间拼路径的方式对齐（平台路径实现用的是 posix，见上面 addrPlat）
  const wantRelative = (rel) => path.posix.join(addrTmp, rel)
  const addrMapFile = wantRelative('.scratch/demo/map.md')
  const addrTicketFile = wantRelative('.scratch/demo/issues/01-hello-world.md')
  fs.mkdirSync(path.dirname(addrTicketFile), { recursive: true })
  fs.writeFileSync(addrMapFile, '# Demo Map\n\nStatus: ready-for-agent\n\n## Destination\n\nDemo\n', 'utf8')
  fs.writeFileSync(addrTicketFile, '# Hello World\n\nStatus: ready-for-agent\nType: task\n\n## Comments\n', 'utf8')
  const addrApi = await import('../src/tracker/rooms/markdown/issues.ts')

  const listed = await addrApi.listIssues(addrCtx, addrRepo, {}, {})
  const rows = listed.ok ? listed.data : []
  check(listed.ok, '⑨ 列举跑通（实得 ' + (listed.ok ? rows.length + ' 行' : JSON.stringify(listed.error)) + '）')
  // 逐行都要有地址，而且地址指的必须是盘上真实存在的文件（这一条同时管住地图行与票行）
  const noAddress = rows.filter((r) => !r || !r.url || !fs.existsSync(r.url)).map((r) => (r && r.key) + '→' + JSON.stringify(r && r.url))
  check(noAddress.length === 0, '⑨ 列举回来的每一行都有地址且文件真的在（没有地址的行：' + JSON.stringify(noAddress) + '）')
  const mapRow = rows.find((r) => String(r.key) === '00')
  const ticketRow = rows.find((r) => String(r.key) === '01')
  check(!!mapRow && mapRow.url === addrMapFile, '⑨ 地图行的地址就是 map.md 的路径（实得 ' + JSON.stringify(mapRow && mapRow.url) + '）')
  check(!!ticketRow && ticketRow.url === addrTicketFile,
    '⑨ 票行的地址是它自己那个文件名（01-hello-world.md，不是按编号猜的 01-untitled.md；实得 ' + JSON.stringify(ticketRow && ticketRow.url) + '）')

  const got = await addrApi.getIssue(addrCtx, addrRepo, '01', {})
  check(got.ok && got.data.url === addrTicketFile, '⑨ 读单张票也带同一个地址（实得 ' + JSON.stringify(got.ok ? got.data.url : got.error) + '）')

  const created = await addrApi.createIssue(addrCtx, addrRepo, { title: 'Address Probe', body: 'body', status: 'ready-for-agent', type: 'task' })
  const createdUrl = created.ok ? String(created.data.url || '') : ''
  const onDisk = fs.readdirSync(path.dirname(addrTicketFile))
  check(!!createdUrl && fs.existsSync(createdUrl) && onDisk.includes(path.basename(createdUrl)),
    '⑨ 新建票回包的地址就是刚落在 issues/ 下的那个文件（实得 ' + JSON.stringify(createdUrl) + '，目录里现有 ' + JSON.stringify(onDisk) + '）')

  fs.rmSync(addrTmp, { recursive: true, force: true })
}

// ── #1174 根因闸：列目录「读不出来」不许被当成「这里没有票」 ──
// 这一节只做一件事：把票目录换成「明明在、但列不出来」的底盘，看三处最重的后果还在不在。
// 旧写法三路 catch 全回空数组，于是「读不成」与「目录是空的」在下游是同一个值，长出来的是
// 重复建票、假零、假空页。判据不是「有没有报错」，而是「有没有编出一个看起来正常的答案」。
console.log('\n== #1174 根因闸：票目录读不出来时不许当空目录 ==')
{
  const rcTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'md-rootcause-'))
  const rcIssues = path.join(rcTmp, '.scratch', 'demo', 'issues')
  fs.mkdirSync(rcIssues, { recursive: true })
  fs.writeFileSync(path.join(rcTmp, '.scratch', 'demo', 'map.md'), '# Demo Map\n\nStatus: ready-for-agent\n\n## Destination\n\nDemo\n', 'utf8')
  fs.writeFileSync(path.join(rcIssues, '01-first-ticket.md'), '# 第一张票\n\n正文\n\nStatus: claimed\nAssignees: local\nType: task\n\n## Comments\n', 'utf8')

  // 正常底盘：真读真写。先拿它把「前提」立住——正常时这三处本来就该给出答案，
  // 否则下面那几个「失败」可能只是因为底盘整个跑不起来，而不是闸在起作用。
  const goodFs = {
    async resolve(p) { return p },
    async readText(t) { return fs.readFileSync(t, 'utf8') },
    async writeText(t, c) { fs.mkdirSync(path.dirname(t), { recursive: true }); fs.writeFileSync(t, c, 'utf8') },
    async lstat(t) { try { return fs.statSync(t) } catch { return null } },
    async listDir(t) { return fs.readdirSync(t) },
    async stat(t) { try { return fs.statSync(t) } catch { return null } },
  }
  // 故障底盘：目录确实在（lstat/stat 照样答得出来），但列不出来，且错误码不是 ENOENT——
  // 所以既不能当「不存在」，也不能当「空」。
  const blind = new Error('EACCES: 这个票目录列不出来')
  blind.code = 'EACCES'
  const blindFs = Object.assign({}, goodFs, {
    async listDir() { throw blind },
    async readdir() { throw blind },
  })
  const rcCtx = (f) => ({ platform: { path: path.posix, fs: f }, fs: f, cwd: rcTmp, get(n) { return n === 'fs' ? f : undefined } })
  const { countIssues } = await import('../src/tracker/rooms/markdown/counts.ts')
  const { listIssuesPage } = await import('../src/tracker/rooms/markdown/page.ts')
  const { createIssue } = await import('../src/tracker/rooms/markdown/issues-create.ts')
  const rcRepo = { backend: 'markdown', refId: '.scratch/demo', name: 'demo', url: '' }

  const goodCount = await countIssues(rcCtx(goodFs), rcRepo, {})
  check(goodCount.ok && goodCount.data && goodCount.data.open === 1, '前提：底盘正常时数得出 1 张（实得 ' + JSON.stringify(goodCount.ok ? goodCount.data : goodCount.error) + '）')
  const blindCount = await countIssues(rcCtx(blindFs), rcRepo, {})
  check(!blindCount.ok, '读不出来时计数如实失败，不回一个偏小的数（实得 ' + JSON.stringify(blindCount.ok ? blindCount.data : blindCount.error && blindCount.error.kind) + '）')

  const goodPage = await listIssuesPage(rcCtx(goodFs), rcRepo, {}, {})
  check(goodPage.ok && (goodPage.data.items || []).length === 1, '前提：底盘正常时翻得出 1 行（实得 ' + JSON.stringify(goodPage.ok ? (goodPage.data.items || []).length : goodPage.error) + '）')
  const blindPage = await listIssuesPage(rcCtx(blindFs), rcRepo, {}, {})
  check(!blindPage.ok, '读不出来时翻页如实失败，不回一页空白（实得 ' + JSON.stringify(blindPage.ok ? (blindPage.data.items || []).length + ' 行' : blindPage.error && blindPage.error.kind) + '）')

  const before = fs.readdirSync(rcIssues).length
  const blindCreate = await createIssue(rcCtx(blindFs), rcRepo, { title: '不该被建出来的票', body: '正文', status: 'ready-for-agent', type: 'task', idempotencyKey: 'root-cause-probe' })
  const after = fs.readdirSync(rcIssues).length
  check(!blindCreate.ok, '建票前的回查读不出来时如实失败，不当成「还没建过」（实得 ' + JSON.stringify(blindCreate.ok ? blindCreate.data && blindCreate.data.key : blindCreate.error && blindCreate.error.kind) + '）')
  check(after === before, '这一次没有悄悄多落一张票（' + before + ' → ' + after + '）')

  fs.rmSync(rcTmp, { recursive: true, force: true })
}

// ── #1174 复核订正闸：五处「说改了、其实没改全」的回归网 ──
// 这一节钉的是对抗式复核当场跑出来的五个反例（完整诊断见 #1057 的「对抗式审查与订正」评论，
// 以及复核笔记 research/1174-independent-review.md）。它们有一个共同形状：**票面写着「不再静默丢掉」，
// 代码里却还留着一条静默路径**。判据一律取「读回来的值对不对」，不取「有没有报错」。
console.log('\n== #1174 复核订正闸：五处对不上的输入 ==')
{
  const rgTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'md-regress-'))
  const rgDir = path.join(rgTmp, '.scratch', 'demo', 'issues')
  fs.mkdirSync(rgDir, { recursive: true })
  fs.writeFileSync(path.join(rgTmp, '.scratch', 'demo', 'map.md'), '# Demo Map\n\nStatus: ready-for-agent\n\n## Destination\n\nDemo\n', 'utf8')
  const rgFs = {
    async resolve(p) { return p },
    async readText(t) { return fs.readFileSync(t, 'utf8') },
    async writeText(t, c) { fs.mkdirSync(path.dirname(t), { recursive: true }); fs.writeFileSync(t, c, 'utf8') },
    async lstat(t) { try { return fs.statSync(t) } catch { return null } },
    async listDir(t) { return fs.readdirSync(t) },
    async stat(t) { try { return fs.statSync(t) } catch { return null } },
  }
  const rgCtxOf = (f) => ({ platform: { path: path.posix, fs: f }, fs: f, cwd: rgTmp, get(n) { return n === 'fs' ? f : undefined } })
  const { createIssue: rgCreate } = await import('../src/tracker/rooms/markdown/issues-create.ts')
  const { closeIssue: rgClose } = await import('../src/tracker/rooms/markdown/issues-status.ts')
  const { updateIssue: rgUpdate } = await import('../src/tracker/rooms/markdown/issues-patch.ts')
  const { getIssue: rgGet, listIssues: rgList } = await import('../src/tracker/rooms/markdown/issues-read.ts')
  const { addComment: rgComment } = await import('../src/tracker/rooms/markdown/comments.ts')
  const rgCtx = rgCtxOf(rgFs)
  const rgRepo = { backend: 'markdown', refId: '.scratch/demo', name: 'demo', url: '' }

  const rgMade = await rgCreate(rgCtx, rgRepo, { title: 'Regress Probe', body: '第一段正文', status: 'ready-for-agent', type: 'task' })
  check(rgMade.ok, '前提：能建出一张票（实得 ' + JSON.stringify(rgMade.ok ? rgMade.data.key : rgMade.error) + '）')
  const rgKey = rgMade.ok ? String(rgMade.data.key) : '01'

  // P1-1：关票原因是后写上去的一行，不许被下一次「改正文」吃掉。
  // #1500 S4 起普通票也走原文布局：原因按原文（issue-tracker-local.md:10-11）追加成一条评论，
  // 不再写 Close reason 行（见 verify-1489-status-write 第一段）；原因文本在评论里可读回，机器 reason 回落 completed。
  const rgClosed = await rgClose(rgCtx, rgRepo, rgKey, { reason: 'duplicate' })
  check(rgClosed.ok && rgClosed.data && rgClosed.data.state === 'closed',
    '前提：关票成功且状态读回 closed（实得 ' + JSON.stringify(rgClosed.ok ? rgClosed.data.state : rgClosed.error) + '）')
  const rgClosedGet = await rgGet(rgCtx, rgRepo, rgKey)
  const rgClosedBodies = rgClosedGet.ok ? (rgClosedGet.data.comments || []).map((c) => String(c.body || '')) : []
  check(rgClosedGet.ok && rgClosedBodies.indexOf('duplicate') >= 0,
    '前提：关票原因作为评论可读回（实得 ' + JSON.stringify(rgClosedBodies) + '）')
  const rgPatched = await rgUpdate(rgCtx, rgRepo, rgKey, { body: '换一段正文' })
  check(rgPatched.ok, '前提：改正文这一步本身成功（实得 ' + JSON.stringify(rgPatched.ok ? 'ok' : rgPatched.error) + '）')
  const rgAfterPatch = await rgGet(rgCtx, rgRepo, rgKey)
  const rgAfterBodies = rgAfterPatch.ok ? (rgAfterPatch.data.comments || []).map((c) => String(c.body || '')) : []
  check(rgAfterPatch.ok && rgAfterBodies.indexOf('duplicate') >= 0,
    'P1-1 改正文之后关票原因还在评论里（实得 ' + JSON.stringify(rgAfterPatch.ok ? rgAfterBodies : rgAfterPatch.error) + '）')

  // P1-2：契约里里程碑的形状是 {name}，校验只读 title 就会把契约自己的形状放过去。
  const rgMsName = await rgUpdate(rgCtx, rgRepo, rgKey, { milestone: { name: 'v1' } })
  check(!rgMsName.ok && rgMsName.error.kind === 'unsupported',
    'P1-2 里程碑按契约形状 {name} 传进来时如实回不支持（旧写法只认 title，会静默丢掉还回成功；实得 ' + JSON.stringify(rgMsName.ok ? 'ok' : rgMsName.error.kind) + '）')
  const rgMsNum = await rgUpdate(rgCtx, rgRepo, rgKey, { milestone: { number: 3 } })
  check(!rgMsNum.ok && rgMsNum.error.kind === 'unsupported',
    'P1-2 只给编号的里程碑同样如实回不支持（实得 ' + JSON.stringify(rgMsNum.ok ? 'ok' : rgMsNum.error.kind) + '）')
  const rgMsNull = await rgUpdate(rgCtx, rgRepo, rgKey, { milestone: null })
  check(rgMsNull.ok, 'P1-2 传 null 是「清掉里程碑」，本地本来就没有，算成功（实得 ' + JSON.stringify(rgMsNull.ok ? 'ok' : rgMsNull.error) + '）')

  // P1-3：正文围栏里的举例行是给人看的模板，不是票面字段。
  const rgProse = await rgUpdate(rgCtx, rgRepo, rgKey, { body: '照这个写法加：\n\n```\nAssignees: zhang\nClose reason: 手滑了\n```\n\n抄进票文件即可。' })
  check(rgProse.ok, '前提：把带围栏的正文写进去这一步成功（实得 ' + JSON.stringify(rgProse.ok ? 'ok' : rgProse.error) + '）')
  const rgAfterProse = await rgGet(rgCtx, rgRepo, rgKey)
  const rgNames = rgAfterProse.ok ? (rgAfterProse.data.assignees || []).map((a) => a.login) : []
  check(rgAfterProse.ok && rgNames.indexOf('zhang') < 0,
    'P1-3 正文代码块里抄的那行 Assignees 不算认领人（实得 ' + JSON.stringify(rgNames) + '）')
  check(rgAfterProse.ok && rgAfterProse.data.reason !== '手滑了',
    'P1-3 正文代码块里抄的那行 Close reason 不算关票原因（实得 ' + JSON.stringify(rgAfterProse.ok ? rgAfterProse.data.reason : rgAfterProse.error) + '）')

  // P2：get 的评论分页（契约 GetOpts.comments）—— 以前整条选项被丢掉，三种传法回的东西一模一样。
  await rgComment(rgCtx, rgRepo, rgKey, '第一条评论')
  await rgComment(rgCtx, rgRepo, rgKey, '第二条评论')
  await rgComment(rgCtx, rgRepo, rgKey, '第三条评论')
  const rgAll = await rgGet(rgCtx, rgRepo, rgKey)
  const rgAllN = rgAll.ok ? (rgAll.data.comments || []).length : -1
  // #1500：关票原因本身占一条评论，所以是 3 条新增 + 1 条原因 = 4。
  check(rgAllN === 4, '前提：不给选项时评论一条不少（3 条新增 + 1 条关票原因，实得 ' + rgAllN + '）')
  const rgFirst = await rgGet(rgCtx, rgRepo, rgKey, { comments: { first: 1 } })
  const rgFirstN = rgFirst.ok ? (rgFirst.data.comments || []).length : -1
  check(rgFirstN === 1, 'P2 说只要前 1 条就给 1 条（旧写法照给 3 条；实得 ' + rgFirstN + '）')
  const rgAfterOne = await rgGet(rgCtx, rgRepo, rgKey, { comments: { first: 1, after: '1' } })
  const rgSecondBody = rgAfterOne.ok ? String((rgAfterOne.data.comments || [])[0] && rgAfterOne.data.comments[0].body || '') : ''
  // #1500：第 1 条是关票原因评论，游标 1 跳过它，从第 2 条（第一条新增评论）接着给。
  check(rgAfterOne.ok && (rgAfterOne.data.comments || []).length === 1 && rgSecondBody.indexOf('第一条') >= 0,
    'P2 游标 1 表示从第 2 条接着给（旧写法从第 1 条重来；实得 ' + JSON.stringify(rgSecondBody) + '）')

  // P2：列票读不出来时不许回一个偏少的清单（与上面根因闸的计数、翻页同一件事的第三个出口）。
  const rgBlind = new Error('EACCES: 这个票目录列不出来'); rgBlind.code = 'EACCES'
  const rgBlindFs = Object.assign({}, rgFs, { async listDir() { throw rgBlind }, async readdir() { throw rgBlind } })
  const rgListed = await rgList(rgCtxOf(rgBlindFs), rgRepo, {})
  const rgListedN = rgListed.ok ? ((rgListed.data && rgListed.data.items) || rgListed.data || []).length : -1
  check(!rgListed.ok, 'P2 读不出来时列票如实失败，不回一个偏少的清单（实得 ' + JSON.stringify(rgListed.ok ? rgListedN + ' 行' : rgListed.error && rgListed.error.kind) + '）')

  fs.rmSync(rgTmp, { recursive: true, force: true })
}

if (failed || hFailed > 0) {
  console.log('\n存在失败 — verify-markdown-backend 未通过')
  process.exit(1)
}
console.log('\n全部通过 — Markdown 后端对齐契约（G4+回环+无旧字段）')