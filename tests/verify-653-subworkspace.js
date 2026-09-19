#!/usr/bin/env node
/**
 * verify-653-subworkspace.js — 子目录工作区场景门禁（#653 验收）
 *
 * 治的是什么：客户端那五样抽屉（面板快照、检查链快照、在途去重、后端选择镜像、仓库引用）此前按
 * 「会话所选目录」分桶。同一个仓库里，仓库根会话与子目录会话因此各占一桶、互不相认——子目录会话
 * 打开面板看不到根会话已经取好的数据。本票把它们改成按**工作区根**分桶（规则见票 #649 定版记录）。
 *
 * 覆盖（判据按任务票 #653 的「要求」一节逐条来）：
 *   A. 工作区键解析：子目录会话与它的工作区根算同一把键；根会话、嵌套仓库、无仓库目录各归自己
 *      ——行为级，直接跑内核里的 wsKeyOf 真函数（去掉行首 export 后 as 纯函数加载）。
 *   B. 落盘/读取只有一把键：同一份快照按子目录存进去，根会话按根就读得出来（不再双写两个桶）。
 *   C. 污染判定的白名单已删除：两个工作区的目录互为祖先时，仍然判为污染（#45 同类问题）。
 *   D. 归属标志：只在「所选目录 ≠ 工作区根」时出现，浮层文本按定稿四行的顺序拼出来。
 *   E. 双产物一致：client.js 与 package/lib/client.js 都带着这套接线。
 */
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
let failed = false
let passed = 0
const ok = (msg) => { passed++; console.log('  PASS ' + msg) }
const bad = (msg) => { failed = true; console.log('  FAIL ' + msg) }

const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')
const noExport = (s) => s.replace(/^\s*export\s+/gm, '')

console.log('=== #653 子目录工作区场景门禁 ===')

// ── A. 工作区键解析（行为级）──────────────────────────────────────────────
// 把 store-snapshot.js 里「工作区键」那一小段原样取出来当纯函数跑：keyOf 用真件（shared 单源），
// snapshotByCwd 用空 Map。这样测的是内核里真正在用的那几行，不是一个另写的仿制品。
console.log('\nA) 工作区键解析（子目录 → 工作区根）')
const keysSrc = read('src/client/kernel/store-snapshot.js')
const wsKeyBlock = noExport(
  keysSrc.slice(
    keysSrc.indexOf('export const workspaceRootByCwd'),
    keysSrc.indexOf('export const shared = makeStore()')
  )
)
const keyOfSrc = read('src/shared/workspaceKey.js')
const keyOfFn = new Function(noExport(keyOfSrc) + '\nreturn keyOf')()

const KEY = new Function(
  'keyOf', 'snapshotByCwd', 's',
  wsKeyBlock + '\nreturn { wsKeyOf: wsKeyOf, rememberWorkspaceRoot: rememberWorkspaceRoot, table: workspaceRootByCwd }'
)(keyOfFn, new Map(), 's')

const ROOT_DIR = 'D:\\ilife'
const SUB_DIR = 'D:\\ilife\\packages\\skill-calorie'

// 还没学到根：一律回所选目录本身（诚实失败，不猜）
ok('未学到根时 wsKeyOf(子目录) 回所选目录自己:' + (KEY.wsKeyOf(SUB_DIR) === keyOfFn(SUB_DIR) ? '是' : '否'))
if (KEY.wsKeyOf(SUB_DIR) !== keyOfFn(SUB_DIR)) bad('未学到根时不应猜一个根出来')

// 宿主报回根之后：子目录与根算同一把键（这就是「同桶」）
KEY.rememberWorkspaceRoot(SUB_DIR, ROOT_DIR)
if (KEY.wsKeyOf(SUB_DIR) === KEY.wsKeyOf(ROOT_DIR) && KEY.wsKeyOf(SUB_DIR) === keyOfFn(ROOT_DIR)) {
  ok('学到根之后：子目录与工作区根算出同一把键（同桶）')
} else bad('学到根之后子目录与根没算到同一把键：sub=' + KEY.wsKeyOf(SUB_DIR) + ' root=' + KEY.wsKeyOf(ROOT_DIR))

// 嵌套仓库：子目录自带 .git 时宿主报回的根就是它自己 → 它自己的键
const NESTED = 'D:\\ilife\\vendor\\other-repo'
KEY.rememberWorkspaceRoot(NESTED, NESTED)
if (KEY.wsKeyOf(NESTED) === keyOfFn(NESTED) && KEY.wsKeyOf(NESTED) !== KEY.wsKeyOf(ROOT_DIR)) {
  ok('嵌套仓库自成一把键，不被外层仓库吞掉')
} else bad('嵌套仓库的键不对')

// 无仓库目录：根就是自己
const NOREPO = 'C:\\Users'
KEY.rememberWorkspaceRoot(NOREPO, NOREPO)
if (KEY.wsKeyOf(NOREPO) === keyOfFn(NOREPO)) ok('无仓库目录的工作区键就是它自己')
else bad('无仓库目录的工作区键不对')

// 同一目录的几种写法都归到同一把键（Windows 折大小写、统一斜杠、去尾斜杠）
KEY.rememberWorkspaceRoot('D:\\ilife\\packages', ROOT_DIR)
const wroteSame = KEY.wsKeyOf('d:/ilife/packages/') === KEY.wsKeyOf('D:\\ilife\\packages')
if (wroteSame) ok('同一目录的几种写法归到同一把键')
else bad('同一目录的不同写法没归到同一把键')

// ── B. 缓存分级：写入与读取只有一把键 ────────────────────────────────────
console.log('\nB) 缓存只有一把键（不再双写「仓库根」与「所选目录」两个桶）')
const probeSrc = read('src/client/kernel/probe-snapshot.js')
if (!/const c = snap\.repoRoot \|\| st\.cwd; if \(c\) setCachedSnapshot\(c, snap\)/.test(probeSrc)) {
  ok('旧的双写已删除（不再先按 repoRoot 存一把、再按所选目录存一把）')
} else bad('probe-snapshot.js 仍在按两个键双写同一份快照')
if (/setCachedSnapshot\(st\.cwd, snap\)/.test(probeSrc)) ok('安装快照时只调一次 setCachedSnapshot(st.cwd, snap)')
else bad('没找到单次落缓存的调用')

const storeSrc = read('src/client/kernel/store-snapshot.js')
const storeBlock = noExport(
  storeSrc.slice(storeSrc.indexOf('export const getCachedSnapshot'), storeSrc.indexOf('export const lastProbeAtByCwd'))
)
const probeBlock = noExport(
  storeSrc.slice(storeSrc.indexOf('export const lastProbeAtByCwd'), storeSrc.indexOf('export const SNAP_DISK_CAP'))
)
const CACHE = new Function(
  'keyOf', 'wsKeyOf', 'snapshotByCwd', 'dswsLogHash', 'isEnabled', 'log', 'touchLRUClient', 'getProbeAt', 'diskPutSnapshot', 'SNAP_CWD_LRU_MAX',
  storeBlock + '\nreturn { getCachedSnapshot: getCachedSnapshot, setCachedSnapshot: setCachedSnapshot, table: snapshotByCwd }'
)(
  keyOfFn, KEY.wsKeyOf, new Map(), () => 'h', () => false, () => {}, (m, k, v) => m.set(k, v), () => 0, () => {}, 20
)
const snap = { ok: true, maps: [], workspaceRoot: ROOT_DIR, generatedMs: 1 }
CACHE.setCachedSnapshot(SUB_DIR, snap)
if (CACHE.getCachedSnapshot(ROOT_DIR) === snap && CACHE.getCachedSnapshot(SUB_DIR) === snap) {
  ok('按子目录存进去的快照，根会话与子目录会话都读得出来（同桶）')
} else bad('子目录存进去的快照根会话读不出来：root=' + !!CACHE.getCachedSnapshot(ROOT_DIR) + ' sub=' + !!CACHE.getCachedSnapshot(SUB_DIR))
if (CACHE.table.size === 1) ok('落缓存只占一把键（不再一份数据两个桶）')
else bad('落缓存占了 ' + CACHE.table.size + ' 把键，应只有 1 把')

// ── C. 污染判定：白名单已删除 ─────────────────────────────────────────────
console.log('\nC) 污染判定不再放过「两个工作区互为祖先」')
const dockSrc = read('src/client/panel/DockSync.js')
const isPolluted = new Function(
  'keyOf', 'wsKeyOf', 'cwdBasename',
  noExport(dockSrc.slice(dockSrc.indexOf('export const isPollutedSnapshot'), dockSrc.indexOf('export const useDockSync'))) +
  '\nreturn isPollutedSnapshot'
)(
  keyOfFn, KEY.wsKeyOf,
  (c) => { const s = String(c || '').split(/[\\/]/); for (let i = s.length - 1; i >= 0; i--) if (s[i]) return s[i]; return 'repo' }
)
if (dockSrc.indexOf("startsWith(rr + '/')") < 0) ok('旧白名单（互为祖先就放行）已从代码里删除')
else bad('DockSync.js 里仍留着「互为祖先就放行」的旧白名单')

// 两个工作区互为祖先：都认得出来且不相同 → 判为污染
if (isPolluted({ ok: true, maps: [], workspaceRoot: ROOT_DIR }, NESTED) === true) {
  ok('两个工作区互为祖先时判为污染（#45 同类问题不再从这条缝漏过）')
} else bad('互为祖先的两个工作区没判成污染')

// 子目录会话读工作区根的数据：不算污染（这正是本票要允许的情形）
if (isPolluted({ ok: true, maps: [], workspaceRoot: ROOT_DIR }, SUB_DIR) !== true) {
  ok('子目录会话读工作区根的数据不算污染')
} else bad('子目录会话读根的数据被误判成污染')

// 同一个工作区：一定不判污染
if (isPolluted({ ok: true, maps: [], workspaceRoot: ROOT_DIR }, ROOT_DIR) === false) ok('同一个工作区不判污染')
else bad('同一个工作区被判成污染')

// 认不出根（旧快照没带这个字段）：退回按仓库名判，口径与改动前一致
if (isPolluted({ ok: true, maps: [], repository: { name: 'owner/skill-calorie' } }, 'D:\\ilife\\other-dir') === true) {
  ok('认不出根时按仓库名判（旧口径保留）')
} else bad('认不出根时按仓库名的旧口径丢了')
if (isPolluted({ ok: true, maps: [], repository: { name: 'D:\\ilife\\packages\\skill-calorie' } }, SUB_DIR) === false) {
  ok('文件路径形态的仓库名不参与误判')
} else bad('文件路径形态的仓库名被误判成污染')

// ── D. 归属标志的出现条件与文案 ──────────────────────────────────────────
console.log('\nD) 归属标志只在子目录会话里出现')
const markSrc = read('src/client/views/SubworkspaceMark.js')
// 出现条件那一段（取根 + 「该不该出现」）单独跑：给不同 store 看它认不认。
// #666 起这两个决定住在纯函数里（组件只负责画），所以这里把它们从真源里取来跑，不再照抄组件内部的小助手；
// 更详尽的用例（含「显示哪几行」与中英两条文案）在 tests/verify-666-subws-mark-root.js，这里只守本票那四条判据。
const markBlock = noExport(
  markSrc.slice(markSrc.indexOf('export const subwsMarkRootOf'), markSrc.indexOf('export const SubworkspaceMark'))
)
const markApi = new Function('keyOf', 'tr', markBlock + '\nreturn { shows: subwsMarkShows }')(keyOfFn, (k) => k)
const isSubOf = function (root, cwd) { try { return markApi.shows(root, cwd) === true } catch (e) { return false } }
if (isSubOf(ROOT_DIR, SUB_DIR) === true) ok('子目录会话：出现（所选目录 ≠ 工作区根）')
else bad('子目录会话没出现标志')
if (isSubOf(ROOT_DIR, ROOT_DIR) === false) ok('根会话：不出现')
else bad('根会话出现了标志')
if (isSubOf(SUB_DIR, SUB_DIR) === false) ok('嵌套仓库：不出现（那时根就是它自己）')
else bad('嵌套仓库出现了标志')
if (isSubOf('', SUB_DIR) === false) ok('宿主还没回话（没有工作区根）：不出现')
else bad('没有工作区根时出现了标志')

// 浮层文案：一个键装四行，顺序固定 结论 → 证据 → 动作 → 提醒
const locSrc = read('src/client/kernel/locale-panel.js')
const tipLines = [...locSrc.matchAll(/'panel\.wsMarkTip':\s*'((?:[^'\\]|\\.)*)'/g)].map((m) => m[1])
if (tipLines.length === 2) ok('浮层文案中英各一套（panel.wsMarkTip 出现 2 次）')
else bad('浮层文案不是中英各一套（实得 ' + tipLines.length + ' 次）')
const zhTip = tipLines.find((s) => s.indexOf('面板数据来自工作区') === 0) || ''
const zhParts = zhTip.split('\\n')
if (zhParts.length === 4) ok('中文浮层四行齐全')
else bad('中文浮层不是四行，实得 ' + zhParts.length + ' 行：' + zhTip)
const orderOk = zhParts[0] && zhParts[0].indexOf('面板数据来自工作区 {root}') === 0 &&
  zhParts[1] && zhParts[1].indexOf('当前目录是它的子目录：{rel}') === 0 &&
  zhParts[2] && zhParts[2].indexOf('点一下打开 {root}') === 0 &&
  zhParts[3] && zhParts[3].indexOf('{root}还未初始化') === 0
if (orderOk) ok('四行顺序固定：结论 → 证据 → 动作 → 提醒')
else bad('浮层四行顺序不符定稿：' + JSON.stringify(zhParts))
if (!/子工作区|工作区根/.test(zhTip)) ok('用户可见文案里没有「子工作区」「工作区根」这类内部术语')
else bad('用户可见文案里出现了内部术语')

// 七种情形对照表里要求「只在这个条件下出现」的两处硬判据
if (/chainStepOk\('tracker:initialized'\)/.test(markSrc) && /!== false/.test(markSrc)) ok('第四行按工作区根是否已初始化决定是否显示（拿不准时不出，不吓人）')
else bad('没有按初始化状态决定第四行')
if (/wf\.openFolder/.test(markSrc)) ok('点击动作复用宿主已有的打开文件夹能力（wf.openFolder）')
else bad('点击动作没有接打开文件夹')
if (/aria-label/.test(markSrc)) ok('图标带 aria-label（读屏用户没有悬停这个动作）')
else bad('图标没有 aria-label')

// ── E. 单条链路走到底：宿主报回根 → 客户端三张表都落同一把键 ────────────
// 这是本门禁最要紧的一条：不是为了断言某个函数对不对，而是把「子目录会话打开面板要秒显根工作区的缓存」
// 这件事从宿主回包一路走到客户端的三张表，看它们是不是真的落到同一把键上（任何一个环节另起一把键，
// 这条就会红）。用的是内核里真正在用的那几段代码，不是另写的仿制品。
console.log('\nE) 宿主报回根之后，客户端三张表落在同一把键上')
const chainKeyBlock = noExport(
  storeSrc.slice(storeSrc.indexOf('export const getChainCacheKey'), storeSrc.indexOf('export const hydrateFromCache'))
)
// E 这一段把「读快照、读链、读探测时间」三张表装进同一个闭包跑。
// 注意：快照表与链表是在被切出来的代码块**外面**声明的（那两行不在块里），所以得从这里传进去；
// 探测时间表在块内，再传同名参数会与块内声明冲名，所以不传。
const TABLES = new Function(
  'keyOf', 'wsKeyOf', 'snapshotByCwd', 'chainByCwd', 'dswsLogHash', 'isEnabled', 'log', 'touchLRUClient', 'diskPutSnapshot', 'SNAP_CWD_LRU_MAX',
  storeBlock + '\n' + probeBlock + '\n' +
  chainKeyBlock + '\n' +
  'return { getCachedSnapshot: getCachedSnapshot, setCachedSnapshot: setCachedSnapshot, getChainCacheKey: getChainCacheKey,' +
  ' getCachedChain: getCachedChain, setCachedChain: setCachedChain, getProbeAt: getProbeAt, touchProbeAt: touchProbeAt }'
)(
  keyOfFn, KEY.wsKeyOf, new Map(), new Map(), () => 'h', () => false, () => {}, (m, k, v) => m.set(k, v), () => {}, 20
)
// 模拟宿主：子目录会话问一次快照，宿主回包里带着工作区根（#652 起由 canonicalKey 算出，这里直接给）
const hostSnap = { ok: true, maps: [], issues: [], labels: [], workspaceRoot: ROOT_DIR, generatedMs: Date.now() }
KEY.rememberWorkspaceRoot(SUB_DIR, hostSnap.workspaceRoot)   // 客户端学到根（就是 loadSnapshot 里那一步）
TABLES.setCachedSnapshot(SUB_DIR, hostSnap)                  // 面板快照落缓存
TABLES.setCachedChain(SUB_DIR, 'github', 'zh', { steps: [] }) // 检查链快照落缓存
TABLES.touchProbeAt(SUB_DIR, 12345)                           // 上次探测时间走针
const sameSnap = TABLES.getCachedSnapshot(ROOT_DIR) === hostSnap
const sameChainKey = TABLES.getChainCacheKey(SUB_DIR, 'github', 'zh') === TABLES.getChainCacheKey(ROOT_DIR, 'github', 'zh')
const sameChain = TABLES.getCachedChain(ROOT_DIR, 'github', 'zh') !== null
const sameProbe = TABLES.getProbeAt(ROOT_DIR) === 12345
if (sameSnap) ok('面板快照：子目录存进去，根会话读得到（秒显根工作区的缓存）')
else bad('面板快照没落到同一把键：根会话读不到子目录装进去的那份')
if (sameChainKey && sameChain) ok('检查链快照：子目录与根共用同一把键、同一个答案')
else bad('检查链快照没落到同一把键（keySame=' + sameChainKey + ' readable=' + sameChain + '）')
if (sameProbe) ok('上次探测时间：子目录走针，根会话读得到同一个时间')
else bad('上次探测时间没落到同一把键：根会话读到 ' + TABLES.getProbeAt(ROOT_DIR))

// ── F. 双产物一致 ────────────────────────────────────────────────────────
console.log('\nF) 双产物一致')
for (const f of ['client.js', 'package/lib/client.js']) {
  const s = read(f)
  if (s.includes('wsKeyOf') && s.includes('workspaceRootByCwd')) ok(f + ' 含工作区键解析')
  else bad(f + ' 缺工作区键解析（请先 node scripts/build.mjs）')
  if (s.includes('SubworkspaceMark')) ok(f + ' 含归属标志')
  else bad(f + ' 缺归属标志')
  if (s.includes('isPollutedSnapshot')) ok(f + ' 含新的污染判定')
  else bad(f + ' 缺新的污染判定')
}

console.log('\n=== 汇总 ===')
console.log(passed + ' 通过，' + (failed ? '存在失败' : '全部通过'))
if (failed) process.exit(1)
console.log('全部通过 ✅ — 子目录会话与工作区根同桶、归属标志按定稿出现')
