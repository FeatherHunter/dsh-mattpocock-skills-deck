// tests/verify-1039-rules-pure.ts —— #1039：纯规则侧能脱离宿主直接单测
//
// 这一条回答的问题只有一句：**不造会话、不造闸、不造假后端，能不能直接测这一层的规则？**
// 能，就说明规则真的搬干净了；要先把世界造出来才测得动，就说明还有东西没搬。
// 所以本文件里没有任何桩：不 import 工具入口、不 import 壳、不起进程、不读磁盘，
// 只 import src/deck/rules/ 下的几份纯文件，喂字符串与对象、看返回值。
// （唯一的替身是 workspace-file 的编解码器：那两段本来就是由宿主注入的，测试当然自己给一个。）
//
// 覆盖的是 #1038 定版划给纯侧的那几件，逐件对着它在票面上的职责：
//   minimal-spec   必备标签、进度区、整份/片段判据
//   anchor         幂等锚：档位、同档同锚、跨档不同锚（时刻一律传参，模块自己不读钟）
//   edge-landing   落点判定、正文引用判据、写后读回的判定（说不好时不许升成「原生层级」）
//   dependency-graph  环检测、整批成环预检（拒的是那条闭合成环的边）
//   tool-table     装表：坏的工厂不装、缺的如实列出来、顺序照 DECK_TOOL_ORDER
//   workspace-file 文本与字段表的互转（编解码器注入）
// 另有一条静态扫描：纯侧源码里不许出现读钟、读文件、起进程的写法。
//
// 用法：在插件根目录执行 node tests/verify-1039-rules-pure.ts，可独立运行。
// 手工跑要自己挂装载钩子（`node --import ./scripts/ts-hook.mjs tests/verify-1039-rules-pure.ts`）：
// 纯侧源码之间写的是 `./tool-order.js` 这类说明符，靠钩子改指同名 .ts。
// 挂进 npm test / verify:parallel / verify-all / test:smoke 四个入口时，钩子由那几处自动加上，不用自己写。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const imp = (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href)
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

/** 数正文里有几条真正的进度标题（与 tools/issue-patch 同款口径：带百分比的也算）。 */
function countProgressHeaders(s) {
  const m = String(s).match(/^##\s*(?:进度|Progress)(?:\s*[：:]\s*\d{1,3}\s*%?)?\s*$/gm)
  return m ? m.length : 0
}

async function minimalSpec() {
  const ms = await imp('src/deck/rules/minimal-spec.ts')
  console.log('— 强制最小规范')

  // 必备标签：地图、任务、缺陷三种各有各的；已经有的不重复加，大小写不同也算已经有。
  const map = ms.ensureLabels([], 'map')
  check(map.labels.includes('wayfinder:map') && map.added.includes('wayfinder:map'), '地图票补上 wayfinder:map 并如实说补了什么')
  const task = ms.ensureLabels(['wayfinder:task'], 'task')
  check(task.added.length === 0 && task.labels.length === 1, '任务票已有标签时不重复加')
  const bug = ms.ensureLabels([{ name: 'BUG' }], 'bug')
  check(bug.added.includes('needs-triage') && !bug.added.includes('bug'), '缺陷票补 needs-triage；大小写不同的 bug 算已经有')
  const odd = ms.ensureLabels(undefined, '认不出的种类')
  check(odd.labels.includes('wayfinder:task'), '认不出的种类按任务票补（不抛错）')

  // 进度区：没有就补一段；已经有了（含带百分比的标题）就不再补。
  const added = ms.ensureBody('## Question\n\nx\n', 'task')
  check(added.added.includes('## 进度') && countProgressHeaders(added.body) === 1, '任务票没有进度区时补一段')
  const kept = ms.ensureBody('## 进度：80%\nold\n', 'task')
  check(kept.added.length === 0 && countProgressHeaders(kept.body) === 1, '已经有带百分比的进度标题时不再补')
  const empty = ms.ensureBody('', 'task')
  check(countProgressHeaders(empty.body) === 1 && empty.body.indexOf('## 进度') === 0, '空正文也补一段进度，且不留下开头的空行')

  // 地图：五个区块缺哪个补哪个，一个都不缺时不重复补。
  const mapBody = ms.ensureBody('## Destination\n\n去哪\n', 'map')
  check(mapBody.added.length === 4, '地图缺四个区块时如实说补了四个（实际 ' + mapBody.added.length + '）')
  const allFive = '## Destination\n\nx\n\n## Notes\n\nx\n\n## Decisions so far\n\nx\n\n## Not yet specified\n\nx\n\n## Out of scope\n\nx\n'
  check(ms.ensureBody(allFive, 'map').added.length === 0, '五个区块都在时不补（判据按区块标题原文判）')

  // 整份/片段：两条写路径共用同一条判据，四种形态都算整份。
  check(ms.isWholeIssueBody('<!-- DSH-IDEMPOTENCY-KEY: x -->\n# 标题\n\n## 进度\n'), '带一级标题与锚的算整份')
  check(ms.isWholeIssueBody('Status: ready-for-agent\nBlocked by:\nLabels: bug\n'), '只带字段行的也算整份（#1002 实测的那一种）')
  check(ms.isWholeIssueBody('## Comments\n\nx\n\n## Answer\n\nx\n'), '只带骨架标题的也算整份')
  check(!ms.isWholeIssueBody('这是一小段片段，既没有标题也没有锚。'), '普通片段不算整份')
}

async function anchor() {
  const a = await imp('src/deck/rules/anchor.ts')
  console.log('— 幂等锚（时刻传参，模块自己不读钟）')

  const T0 = 1_700_000_000_000
  const w = a.ANCHOR_WINDOW_MS
  const bucket = a.anchorBucket(T0)
  check(Number.isFinite(bucket) && bucket === Math.floor(T0 / w), '档位就是「时刻 ÷ 窗口宽度」的整数部分（宽度 ' + w + ' 毫秒）')
  // 窗口的边界由档位本身划出来（第 n 档 = [n×宽度, (n+1)×宽度)），不是从某个起点开始每满一个宽度切一刀。
  const windowStart = bucket * w
  check(a.anchorBucket(windowStart) === bucket && a.anchorBucket(windowStart + (w - 1)) === bucket, '同一个窗口里的两个时刻算到同一档（重试窗口之内）')
  check(a.anchorBucket(windowStart + w) === bucket + 1, '跨一个窗口就是下一档（重试窗口之外）')

  const parts = { tool: 'deck_issue_create', sessionId: 's1', title: '标题', labels: ['b', 'a'], now: T0 }
  const same = a.anchorKeyFor(parts)
  check(same === a.anchorKeyFor(parts), '同一份输入永远算得出同一个锚（纯函数，不读钟）')
  check(same.startsWith('deck-') && same.endsWith('-' + bucket), '锚的形状是 deck-<八位十六进制>-<档位>，末尾能一眼看出是哪一档')
  check(a.anchorKeyFor(Object.assign({}, parts, { now: T0 + w })) !== same, '换到下一档就换锚')
  check(a.anchorKeyFor(Object.assign({}, parts, { title: '另一个标题' })) !== same, '换个标题就换锚')
  check(a.anchorKeyFor(Object.assign({}, parts, { labels: ['b', 'a', 'c'] })) !== same, '多一个标签就换锚')
  check(a.anchorKeyFor(Object.assign({}, parts, { labels: ['a', 'b'] })) !== same, '标签顺序换了就是另一个锚（不重排，重排会让本该复用的那次变成新建）')
  const noSession = a.anchorKeyFor(Object.assign({}, parts, { sessionId: undefined, workspaceKey: 'w1' }))
  check(noSession !== same && noSession.endsWith('-' + bucket), '会话缺席时退到工作区标识，算出来的是另一个锚（档位照旧）')
}

async function edgeLanding() {
  const e = await imp('src/deck/rules/edge-landing.ts')
  console.log('— 边的落点判定')

  check(e.landingOf('block', { kind: 'native' }) === e.EDGE_LANDING.NATIVE_BLOCK, '证据说原生 → 阻塞边报原生依赖边')
  check(e.landingOf('parent', { kind: 'peer-link' }) === e.EDGE_LANDING.PEER_LINK, '证据说平级链接 → 报平级链接')
  check(e.landingOf('parent', { kind: 'contract' }) === e.EDGE_LANDING.CONTRACT_PARENT_FIELD, '只知道契约字段有 → 报「契约的父子列」而不是原生层级')
  check(e.landingOf('parent', undefined) === e.EDGE_LANDING.UNKNOWN, '没有证据 → 报说不好（绝不默认升成原生层级）')
  check(e.landingOf('block', { kind: 'unsupported' }) === e.EDGE_LANDING.UNSUPPORTED, '后端说做不到 → 照实报做不到')

  // 正文引用：只认带标记的引用，不认随便出现的数字（幂等锚里全是数字，松判会全判成正文行）。
  check(e.bodyRefersTo('Blocked by: #3\n', '3'), '正文里的 #3 算引用')
  check(e.bodyRefersTo('见 issues/12 那条', '12'), 'issues/12 也算引用')
  check(!e.bodyRefersTo('锚是 deck-97b3025e-5973030', '3'), '锚里的数字不算引用（松判会把每条边都判成正文行）')
  check(!e.bodyRefersTo('正文里写着 31 这个数', '3'), '数字后紧跟别的数字时不算引用')
  check(!e.bodyRefersTo('', '3') && !e.bodyRefersTo('正文', ''), '空正文或空票号一律不算')

  // 写后读回：结构字段里有、正文里没有 → 原生；两处都有 → 正文行；两处都没有 → 说不好。
  const native = e.classifyEdgeLanding('block', '3', { issue: { body: '没有引用', parentKey: '' }, dependencies: { blockedBy: [{ key: '3' }] } })
  check(native.kind === 'native', '阻塞边：字段里有、正文里没有 → 原生依赖边')
  const bodyLine = e.classifyEdgeLanding('block', '3', { issue: { body: 'Blocked by: #3', parentKey: '' }, dependencies: { blockedBy: [{ key: '3' }] } })
  check(bodyLine.kind === 'body-line', '阻塞边：字段里与正文里都有 → 正文行')
  const missing = e.classifyEdgeLanding('block', '3', { issue: { body: 'x' }, dependencies: { blockedBy: [] } })
  check(missing.kind === 'missing', '阻塞边：读回来了、两处都没有 → 「不在票上」（不再混成「没读回来」）')
  check(e.landingOf('block', { kind: 'missing' }) === e.EDGE_LANDING.READ_BACK_MISSING, '「读回来了、没有」这一档有自己的话，不说成「没读回来」')
  // #790：正文里出现票号只是「作者写了这行字」，不是「这条边在盘上」的证据。
  const bodyOnly = e.classifyEdgeLanding('block', '3', { issue: { body: 'Blocked by: #3', parentKey: '' }, dependencies: { blockedBy: [] } })
  check(bodyOnly.kind === 'missing', '阻塞边：字段里没有、只有正文提到 → 不算落上')
  const parentBodyOnly = e.classifyEdgeLanding('parent', '7', { issue: { body: '这一张归属 #7', parentKey: '' } })
  check(parentBodyOnly.kind === 'missing', '父子边：字段里没有、只有正文提到 → 不算落上')
  const parent = e.classifyEdgeLanding('parent', '7', { issue: { body: 'x', parentKey: '7' } })
  check(parent.kind === 'contract', '父子边：只报到契约的父子列，不硬猜原生层级')

  // 三态判据（#790）：只有写后读回的结构字段能确认一条边落上了；没读到就说没确认。
  check(e.edgeVerdict('parent', '7', { issue: { parentKey: '7' } }) === 'landed', '读回里 parentKey = 目标 → 落上')
  check(e.edgeVerdict('parent', '7', { issue: { parentKey: '', body: '这一张归属 #7' } }) === 'not-landed', '读回来了、没有这条父子 → 没落上（正文提到也不算）')
  check(e.edgeVerdict('parent', '7', null) === 'unconfirmed', '没读到 → 没确认（既不算成功，也不说没落上）')
  check(e.edgeVerdict('parent', '7', { issue: null, dependencies: null }) === 'unconfirmed', '读回失败（issue 为 null）→ 没确认')
  check(e.edgeVerdict('block', '3', { dependencies: { blockedBy: [{ key: '3' }] } }) === 'landed', '读回里 blockedBy 有目标 → 落上')
  check(e.edgeVerdict('block', '3', { dependencies: { blockedBy: [] } }) === 'not-landed', '读回来了、blockedBy 里没有 → 没落上')
  check(e.edgeVerdict('block', '3', { issue: { body: 'Blocked by: #3' }, dependencies: { blockedBy: [] } }) === 'not-landed', '只有正文提到 → 没落上')
  check(e.edgeVerdict('parent', '', { issue: { parentKey: '' } }) === 'unconfirmed', '没给目标 → 没确认（不猜）')
  // 2026-10-15 对抗式审查补：直接给票本身（带 parentKey / blockedBy 的行）也算「读回来了」，
  // 以前只认 {issue, dependencies} 与 body，字段明明对得上的读回会被判成「没读到」。
  check(e.edgeVerdict('parent', '7', { parentKey: '7' }) === 'landed', '直接给票本身、parentKey = 目标 → 落上')
  check(e.edgeVerdict('block', '3', { blockedBy: [{ key: '3' }] }) === 'landed', '直接给票本身、blockedBy 里有目标 → 落上')

  // #829 的教训：读回失败（issue 为 null）不许抛错，只能判说不好。
  let threw = false
  let res = null
  try { res = e.classifyEdgeLanding('block', '3', { issue: null, dependencies: null }) } catch (err) { threw = true }
  check(!threw && res && res.kind === 'unknown', '读回失败时判说不好而不是抛错（#829 那条崩溃的回归）')

  const rel = e.relationsOf({ parentKey: 9, blockedBy: ['1', { key: '2' }] }, null)
  check(rel.parentKey === '9' && rel.blockedBy.join(',') === '1,2', '读关系字段：票号一律收成字符串，对象形态也认')
}

async function dependencyGraph() {
  const d = await imp('src/deck/rules/dependency-graph.ts')
  console.log('— 依赖图上的算法')

  const diamond = new Map([['a', ['b', 'c']], ['b', ['d']], ['c', ['d']], ['d', []]])
  check(d.hasCycleInAdj(diamond) === false, '菱形依赖不算环（两色判法会在这里误判）')
  check(d.hasCycleInAdj(new Map([['a', ['b']], ['b', ['a']]])) === true, 'a 被 b 挡着、b 又被 a 挡着 → 判成环')
  check(d.hasCycleInAdj(new Map([['a', ['a']]])) === true, '自己挡自己也算环')

  // 整批预检：盘上已有 1 挡 3、3 挡 2（1 是 3 的阻塞方，3 是 2 的阻塞方）；
  // 这批要给 1 写「被 3 挡着」，于是 1→3→2→1 闭合成环 → 拒 1。
  const graph = new Map([['1', []], ['2', ['3']], ['3', ['1']]])
  const refused = d.refuseCyclicBlockBatch({ graph: graph, keyOrder: ['1'], blockedBy: new Map([['1', ['3']]]) })
  check(refused.refused.has('1'), '整批预检：会把图闭合的那条边被拒（拒的是 1）')
  check(String(refused.refused.get('1')).includes('成环'), '拒的理由写清了是成环，且带上要写的目标')
  // 自环（自己挡自己）在试放前就滤掉：契约层自己拒它，这里算成环会抢它的活。
  const self = d.refuseCyclicBlockBatch({ graph: new Map(), keyOrder: ['9'], blockedBy: new Map([['9', ['9']]]) })
  check(self.refused.size === 0, '自己挡自己不在这里拒（那是契约层的活）')
  // 不成环的一批照写：图上 3 挡着 2，这批给 4 写「被 2 挡着」，4 谁都不挡。
  const ok = d.refuseCyclicBlockBatch({ graph: graph, keyOrder: ['4'], blockedBy: new Map([['4', ['2']]]) })
  check(ok.refused.size === 0, '不成环的边一律放行（判据本身不无中生有）')
  // 判定顺序也是判据：同一批里两条边只有一条能留时，拒的是先试放的那一条（调用方给什么顺序就用什么顺序）。
  const order = d.refuseCyclicBlockBatch({ graph: graph, keyOrder: ['1', '2'], blockedBy: new Map([['1', ['3']], ['2', []]]) })
  check(order.refused.size === 1 && order.refused.has('1'), '同一批里拒的是那条闭合成环的边，别的边照写')
}

async function toolTable() {
  const t = await imp('src/deck/rules/tool-table.ts')
  console.log('— 装表')

  check(t.DECK_TOOL_ORDER.length === 9 && t.DECK_TOOL_ORDER[0] === 'deck_context', '九个工具的装配顺序钉住（第一个是 deck_context）')
  const good = { definition: { name: 'deck_context' }, run: () => 'ok' }
  const halfBaked = { definition: { name: 'deck_issue_get' }, run: '不是函数' }
  const table = t.createDeckTools([good, halfBaked, null])
  check(table.names.join(',') === 'deck_context', '只把形状完整的工具装进表（半个的不装）')
  check(table.missing.length === 8 && table.missing.includes('deck_issue_get'), '缺的八个如实列在 missing 里，不补假桩')
  const throwing = t.createDeckTools([() => { throw new Error('装不起来') }])
  check(throwing.names.length === 0 && throwing.missing.length === 9, '工厂抛错时不影响别的、也不崩（一个都不装并如实报缺）')
}

async function workspaceFile() {
  const w = await imp('src/deck/rules/workspace-file.ts')
  console.log('— 工作区配置的字符串翻译（编解码器注入）')

  // 替身编解码器：只认一种极简文本，够验「翻译这一段」的行为即可（真编解码器在宿主侧接核）。
  const codec = {
    parse(text) {
      const m = /^backend=(\S+)\nversion=(\d+)\n/.exec(text)
      if (!m) return { ok: false, message: '形状不对' }
      return { ok: true, value: { backendId: m[1], pickedAt: 1700000000000, version: Number(m[2]), source: 'user' } }
    },
    encode(fields) {
      if (fields.version !== 1 && fields.version !== 2) return { ok: false, message: '版本必须是 1 或 2' }
      return { ok: true, text: 'backend=' + fields.backendId + '\nversion=' + fields.version + '\n' }
    },
  }
  const parsed = w.parseWorkspaceFile('backend=github\nversion=2\n', codec)
  check(parsed && parsed.backendId === 'github' && parsed.pickedAt === 1700000000000, '读：文本 → 人选后端候选')
  check(w.parseWorkspaceFile('这不是配置', codec) === null, '读：坏文本回 null，不抛错（调用方按没有这层继续）')
  check(w.parseWorkspaceFile('backend=github\nversion=2\n', { parse: () => ({ ok: true, readonly: true, value: {} }), encode: codec.encode }) === null, '读：只读的（版本高于认识的）也回 null')
  check(w.parseWorkspaceFile('backend=github\nversion=2\n', { parse: () => ({ ok: true, value: { backendId: 'github', pickedAt: 'x' } }), encode: codec.encode }) === null, '读：档案时间不是有限数字的回 null')

  const text = w.stringifyWorkspaceFile({ backendId: ' github ', source: 'user' }, codec, 2, 'user')
  check(text === 'backend=github\nversion=2\n', '写：后端 id 去空白、版本缺席默认用调用方给的当前版')
  let threw = false
  try { w.stringifyWorkspaceFile({ backendId: 'x', version: 99 }, codec, 2, 'user') } catch (e) { threw = true }
  check(threw, '写：编解码器说不行时如实抛错（由调用方的 try 接住并回报，不静默）')
  check(w.WORKSPACE_FILE_SOURCE_AUTO === 'auto', '读老文件照认的 auto 常量还在（新文件不再产出它）')
}

/**
 * 纯侧禁用的写法表：每一条都配一个「必须命中」的最小例子与一个「不许命中」的反例。
 *
 * 为什么要配例子：表里任何一条写错（正则转义漏了、词边界写宽了），它就成了一条永不命中的死条目，
 * 而外面那条断言只会更绿 —— 这正是「假门禁」的典型形状，所以每条都要当场证明自己是活的
 * （selfCheckPatterns 跑的就是这件事）。
 */
const PURITY_PATTERNS: Array<{ re: RegExp, label: string, hit: string, miss: string }> = [
  { re: /Date\.now|new Date\(|performance\.now/, label: '读钟', hit: 'const t = Date.now()', miss: 'const dateLabel = 1' },
  { re: /require\(['"]node:/, label: '起 Node 能力', hit: "require('node:fs')", miss: "require('./x')" },
  { re: /from\s+['"]node:/, label: '起 Node 能力', hit: "import fs from 'node:fs'", miss: "import x from './x.js'" },
  { re: /process\./, label: '看环境', hit: 'process.env', miss: 'const processed = 1' },
  { re: /fs\.(readFile|writeFile|readdir)/, label: '读写文件', hit: 'fs.readFile(p)', miss: 'const fsLike = 1' },
  { re: /child_process/, label: '起进程', hit: "require('child_process')", miss: 'const childProcessName = 1' },
  // 下面四条是「严档」补齐的：它们都不产生 import 边，依赖图门禁看不见，
  // 而按 #1038 的口径「等待」与「随机」同样算碰世界（同样的输入不再给同样的输出）。
  { re: /Math\.random/, label: '随机', hit: 'Math.random()', miss: 'const randomish = 1' },
  { re: /setTimeout|setInterval|setImmediate/, label: '等待', hit: 'setTimeout(f, 1)', miss: 'const timeoutLabel = 1' },
  { re: /\bfetch\s*\(/, label: '联网', hit: "fetch('u')", miss: 'const fetchLabel = 1' },
  { re: /globalThis/, label: '全局对象', hit: 'globalThis.x', miss: 'const globalObject = 1' },
  // 最后两条是「编译期溜得过去」那五样里剩下的两样：eval 与 new Function 能凭一个字符串
  // 拿到任何全局（包括 process 与 fs），是纯侧唯一能绕过上面所有入口的写法。
  { re: /\beval\s*\(/, label: '动态求值', hit: "eval('1')", miss: 'const evaluate = 1' },
  { re: /\bnew\s+Function\s*\(/, label: '动态构造函数', hit: "new Function('return 1')", miss: 'const funcFactory = 1' },
]

/**
 * 静态扫描：纯侧源码里不许出现读钟、读随机、看环境、起进程、读写文件、等待、联网、动态求值
 * 这类碰世界的写法。这一条是「编译期门禁为主、这条为辅」里的辅：依赖图门禁管得住 import 边，
 * 管不住 `Date.now()` 这种**没有 import 边的全局调用**，所以补一条文本扫描
 *（与 AGENTS.md 里「时钟等待都算碰世界」的严档口径对齐）。
 *
 * 这张表要盖的范围是有界的，可以数清楚（2026-10-14 用 11 个探针文件实测）：纯侧那份 tsconfig
 * 是 lib ES2020 且 types 为空，于是 console、fetch、process、setTimeout、performance、node:fs
 * 这些**有名字的世界入口在编译期就报「找不到这个名字」**，压根写不进纯侧；能在编译期溜过去的
 * 只有 ES2020 语言与标准库里那五样：Date.now()、Math.random()、eval()、new Function()、
 * 以及裸的 globalThis。上面那张表就是照着这五样列的 —— 它今天不是「一张尽量全的黑名单」，
 * 而是「编译期剩下那个缺口的封条」。谁改了纯侧那份 tsconfig（例如加了 @types/node 或 DOM 库），
 * 就是把这五样之外的入口重新打开，那时这张表要跟着重数一遍。
 *
 * 它仍然是写法匹配、不是形式化证明。要更进一步，是反演成白名单（只许用明确列出的纯全局）
 * 或上语法树检查 —— 这两条记在 #1039 收尾评论的「可改」里。
 */
function selfCheckPatterns() {
  console.log('— 禁用写法表自己是不是活的')
  for (const p of PURITY_PATTERNS) {
    check(p.re.test(p.hit), '禁用写法表里这条真的会命中：' + p.label + '（' + p.hit + '）')
    check(!p.re.test(p.miss), '禁用写法表里这条不误伤正常写法：' + p.label + '（' + p.miss + '）')
  }
}

async function staticPurity() {
  console.log('— 纯侧源码不许碰世界（静态扫描）')
  selfCheckPatterns()
  const dir = path.join(ROOT, 'src', 'deck', 'rules')
  const names = fs.readdirSync(dir).filter((n) => n.endsWith('.ts'))
  check(names.length >= 9, '纯侧至少九份文件（实际 ' + names.length + '）')
  const bad = []
  for (const name of names) {
    const text = fs.readFileSync(path.join(dir, name), 'utf8')
    // 注释里会出现这些词（讲清楚为什么不许用），所以先把注释剔掉再扫。
    const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    const hits = PURITY_PATTERNS.filter((p) => p.re.test(code)).map((p) => p.label)
    if (hits.length) bad.push(name + '：' + hits.join('、'))
  }
  check(bad.length === 0, bad.length ? '纯侧有碰世界的写法：' + bad.join('；') : names.length + ' 份纯文件里没有读钟、读随机、看环境、起进程、读写文件、等待、联网、动态求值的写法')
}

async function main() {
  console.log('#1039 纯规则侧单测（不造宿主、不起桩）')
  await minimalSpec()
  await anchor()
  await edgeLanding()
  await dependencyGraph()
  await toolTable()
  await workspaceFile()
  await staticPurity()
  console.log('共 ' + total + ' 项，' + (failed ? '有失败' : '全部通过'))
  if (failed) process.exit(1)
}

main().catch((e) => { console.error('  FAIL 异常：' + ((e && e.stack) || e)); process.exit(1) })
