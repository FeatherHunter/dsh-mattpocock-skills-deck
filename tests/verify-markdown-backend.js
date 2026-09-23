/**
 * tests/verify-markdown-backend.js — Markdown 后端对齐契约的 G4 + 回环验证（#142 验收①②④）。
 *
 * 验收：
 *  ① harness 以真实适配器运行 + 合规断言全 PASS（G4）
 *  ② 回环：deck 创建票 → 技能集可读（同一文件集）；技能集写的文件 → 后端可归一（用 tests/fixtures/markdown-sample 里随仓库走的样例）
 *  ④ 无旧字段（number/subIssues/blocking/布尔 capabilities/detect）
 *
 * 运行：node tests/verify-markdown-backend.js
 */

import runContractTests from './tracker-contract/harness.js'
import { markdownFixture, markdownExtraAssertions } from './tracker-contract/fixtures/markdown.js'
import { parseMd } from '../src/host/tracker/backends/markdown/parse.js'
import { normalizeIssue } from '../src/host/tracker/backends/markdown/normalize.js'
import { createMarkdownBackend, matches, describe } from '../src/host/tracker/backends/markdown/index.js'
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
console.log(`\nG4 harness: ${hPassed} passed, ${hFailed} failed`)
// 额外：旧字段检查（④）
console.log('\n== ④ 无旧字段检查 ==')
{
  const srcFiles = [
    'src/host/tracker/backends/markdown/index.js',
    'src/host/tracker/backends/markdown/parse.js',
    'src/host/tracker/backends/markdown/normalize.js',
    'src/host/tracker/backends/markdown/path.js',
    'src/host/tracker/backends/markdown/read.js',
    'src/host/tracker/backends/markdown/write.js',
    'src/host/tracker/backends/markdown/issues.js',
    'src/host/tracker/backends/markdown/issues-locate.js',
    // #618：旧的 issues-labels.js（读 docs/agents/triage-labels.md 调色盘表的加载与染色函数）已删除，
    // 换成本地配色文件这条路的几个文件（按「一个文件一件事」拆开，各自都在 350 行以内）。
    'src/host/tracker/backends/markdown/label-colors.js',
    'src/host/tracker/backends/markdown/label-colors-palette.js',
    'src/host/tracker/backends/markdown/label-colors-paint.js',
    'src/host/tracker/backends/markdown/label-colors-ops.js',
    'src/host/tracker/backends/markdown/issues-read.js',
    'src/host/tracker/backends/markdown/issues-create.js',
    'src/host/tracker/backends/markdown/issues-status.js',
    'src/host/tracker/backends/markdown/issues-patch.js',
    'src/host/tracker/backends/markdown/graph.js',
    'src/host/tracker/backends/markdown/comments.js',
  ]
  for (const f of srcFiles) {
    const txt = fs.readFileSync(f, 'utf8')
    check(!/EMPTY_CAPS/.test(txt), `${f} 无 EMPTY_CAPS 布尔能力表`)
    check(!/\bdetect\s*:/.test(txt) || f.includes('matches'), `${f} 无旧 detect 字段（允许 matches）`)
    check(!/\bnumber\s*:\s*null/.test(txt) && !/Issue\.number/.test(txt), `${f} 无 number 旧字段`)
    // 允许防御性 delete 'subIssues' 检查，不视为旧字段
    check(!/subIssues\s*:\s*\[/.test(txt) && !/subIssues\s*=\s*\[/.test(txt), `${f} 无 subIssues 旧字段`)
    // blocking 作为 Issue 字段禁止，但 getDependencies 返回的 blocking 是允许的（仅检查 Issue 形状）
    if (f.endsWith('parse.js') || f.endsWith('normalize.js')) {
      check(!/['"]blocking['"]\s*:/.test(txt) && !/blocking:\s*\[/.test(txt), `${f} 无 blocking 字段（Issue 形状）`)
    }
    check(!/capabilities\s*:\s*\{/.test(txt) || /diagnoseCapabilities/.test(txt), `${f} 无布尔 capabilities 声明`)
  }
  // 平台化：路径拼接必须经 platform.path（通过 plat.join 亦可，plat 来自 platform.path）
  const pathTxt = fs.readFileSync('src/host/tracker/backends/markdown/path.js', 'utf8')
  check(pathTxt.includes('platform.path') || pathTxt.includes('plat.join'), 'path.js 经 platform.path/plat.join')
  check(!/\+ *['"]\/\.scratch/.test(pathTxt), 'path.js 无硬编码 "/.scratch" 拼接')
  check(pathTxt.includes('getRoot'), 'path.js 含 getRoot 抽象')
}

console.log('\n== ② 回环测试（同一文件集镜像） ==')
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

  const { listIssues, createIssue } = await import('../src/host/tracker/backends/markdown/issues.js')
  const { readTextFile } = await import('../src/host/tracker/backends/markdown/read.js')
  const repo = { backend: 'markdown', refId: '.scratch/demo', name: 'demo', url: '' }
  const ctx = mkCtx(tmp)
  // 确保 .scratch/demo 存在
  fs.mkdirSync(path.join(tmp, '.scratch', 'demo', 'issues'), { recursive: true })
  fs.writeFileSync(path.join(tmp, '.scratch', 'demo', 'map.md'), '# Demo Map\n\nStatus: ready-for-agent\n\n## Destination\n\nDemo\n', 'utf8')
  // deck 创建票
  const created = await createIssue(ctx, repo, { title: 'Deck Created Ticket', body: 'Body from deck', status: 'ready-for-agent', type: 'task' })
  check(created.ok && created.data.title === 'Deck Created Ticket', '回环① deck create → file exists')
  if (created.ok) {
    const fileList = fs.readdirSync(path.join(tmp, '.scratch', 'demo', 'issues'))
    check(fileList.some((f) => f.startsWith('02-') || f.startsWith('01-')), `回环① fileList ${fileList.join(',')}`)
    // 技能集可读：原文保留 Status/Type/Blocked by 格式
    const createdFile = fileList.find((f) => f.includes('deck-created'))
    if (createdFile) {
      const txt = fs.readFileSync(path.join(tmp, '.scratch', 'demo', 'issues', createdFile), 'utf8')
      check(txt.includes('Status: ready-for-agent'), '回环① 技能集可读：含 Status 行')
      check(txt.includes('Type: task'), '回环① 技能集可读：含 Type 行')
      check(txt.includes('## Comments'), '回环① 含 ## Comments 段')
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

console.log('\n== ③ 既有 verify 回归（抽样） ==')
{
  // 抽样检查 platform 契约仍通过（与 npm run verify 一致的零手拼断言）
  const platIdx = fs.readFileSync('src/host/platform/index.js', 'utf8')
  check(platIdx.includes("import win32 from './win32/index.js'"), '回归抽样 platform 静态 import 仍存在')
  const deckDerive = fs.readFileSync('src/shared/tracker/deck-derive.js', 'utf8')
  check(deckDerive.includes('parseProgress'), '回归抽样 deck-derive 仍存在')
}

console.log('\n== ⑤ 干净切断：不再读旧的调色盘表（#618） ==')
{
  // 旧的读法（读 docs/agents/triage-labels.md 的调色盘表）连同文件一起删掉了：
  // 这个房间里不该再出现那些函数名与那个文件路径，颜色只从 docs/agents/label-colors.json 来。
  const roomDir = path.join(process.cwd(), 'src/host/tracker/backends/markdown')
  const roomFiles = fs.readdirSync(roomDir).filter((n) => n.endsWith('.js'))
  check(roomFiles.indexOf('issues-labels.js') < 0, '旧的 issues-labels.js 已删除')
  const joined = roomFiles.map((n) => fs.readFileSync(path.join(roomDir, n), 'utf8')).join('\n')
  const code = joined.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  check(!/loadPaletteMap|recolorLabels/.test(code), '房间里不再有 loadPaletteMap / recolorLabels 这两个旧函数')
  check(!/triage-labels\.md/.test(code), '房间里不再引用 docs/agents/triage-labels.md（那个表不读了）')
  check(/label-colors\.json/.test(joined), '房间里读的是新的配色文件 docs/agents/label-colors.json')
  check(roomFiles.indexOf('label-colors.js') >= 0 && roomFiles.indexOf('label-colors-ops.js') >= 0, '本地配色文件这条路的两个文件在位')
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
  const { setLabelsIssue } = await import('../src/host/tracker/backends/markdown/issues-patch.js')
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
  const concApi = await import('../src/host/tracker/backends/markdown/issues.js')
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

  // 静态断言：取号与落盘这一段必须在写者队列里（源码里出现 withLabelColorsWriter 或 withSingleWriter）。
  //   为什么不只看运行结果：运行结果依赖时序，静态断言在 CI 上 100% 稳定，且能防住日后有人把队列拆掉。
  const createTxt = fs.readFileSync('src/host/tracker/backends/markdown/issues-create.js', 'utf8')
  check(/withLabelColorsWriter|withSingleWriter/.test(createTxt),
    '静态断言：issues-create.js 的取号与落盘这一段在写者队列里（源码出现 withLabelColorsWriter/withSingleWriter）')

  fs.rmSync(concTmp, { recursive: true, force: true })
}

if (failed || hFailed > 0) {
  console.log('\n存在失败 — verify-markdown-backend 未通过')
  process.exit(1)
}
console.log('\n全部通过 — Markdown 后端对齐契约（G4+回环+无旧字段）')