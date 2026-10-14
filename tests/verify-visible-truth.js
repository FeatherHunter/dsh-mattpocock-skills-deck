// verify-visible-truth.js — #715（T11 第八批）诚实显示的门禁：新鲜度 / 失败 / 降级
//
// 这一条门禁盯的是「界面说得清这份数据有多新、上次刷新成不成、现在是不是降级」这件事，
// 以及最容易做假的一条：**降级标记只能由宿主写**。
//
// 它验八件事：
//   一、新鲜度：时间戳取快照的**取数时刻**（generatedMs），阈值 5 分钟黄 / 30 分钟红（常量来自 budget.ts）；
//      2026-09-22 起这条信息显示在面板头部那个小时间标签上（panel/Dock.js），标签只画相对时间、
//      完整说法与精确时刻在悬停提示里 —— 那一节判据（truthFreshnessBox）也在这里量。
//   二、两种失败是两句不同的话（「插件自己的取数失败」与「配额已被其他使用者耗尽」），放弃等待后活还在跑时说「仍在等」不说失败（无快照也说）；
//   三、T3 那两句也要有读取点（「自动刷新已暂停」与「未在刷新（同时活跃上限 2）」）；
//   四、降档时把延迟承诺说出来（"数据可能落后 X 分钟"），绿档不说、红档说的是「已暂停」；
//   五、推迟发生时说「有更新，已推后」；
//   六、写入窗口判据（窗口内算「更新中」、窗口外不算）与那批词条中英两面都在；
//   七、降级标记（fallback: 'rest'）到得了界面：把快照回包组装函数真跑一遍，上游真降级时回包带 'rest'、没降级时是 null。
//
// 跑法：node tests/verify-visible-truth.js
// 判据不是「字符串出现过」，而是把界面那一半的**真代码**加载起来喂两组输入、看它吐出什么话
//（与 scripts/build.mjs 拼接时同一套做法：剥掉行首 export，丢进同一个作用域里跑）。
const fs = require('fs')
const path = require('path')
// 转译参数从仓库唯一那一份取（scripts/lib/transpile-unit.mjs 写明这组参数只在那处写、别处各抄一份会静默分叉）；
// 从 CJS require 一个 .mjs，与 tests/verify-file-granularity.js 里 require('../scripts/lib/effective-lines.mts') 是同一种用法。
const { TRANSPILE_OPTIONS } = require('../scripts/lib/transpile-unit.mjs')
const { compileFn } = require('./lib/eval-probe.js')

const ROOT = path.resolve(__dirname, '..')
let failed = false
const problems = []
const fail = function (msg) { problems.push(msg); failed = true }

/** 把一份「一源两物」的源文件当模块跑起来：剥行首 export，作用域里塞进它在拼接闭包里的邻居。 */
function loadModule(relPath, deps) {
  let src = fs.readFileSync(path.join(ROOT, relPath), 'utf8')
  if (relPath.endsWith('.ts')) {
    // 源码是 .ts：先按仓库自己的转译口径剥掉类型（转译参数只写在 scripts/lib/transpile-unit.mjs 那一份，
    //   这里取现成的，不另抄一套），再照下面同一套「剥行首 export、当函数体编译」的读法加载。
    //   少了这一步，`type X = …` 会在编译函数时当场 SyntaxError —— 类型标注只给编译器看，运行期行为
    //   一个字没变，剥掉之后跑的就是真正跑的那段代码。
    src = require('esbuild').transformSync(src, TRANSPILE_OPTIONS).code
  }
  const names = []
  const re = /^[ \t]*export[ \t]+(?:const|let|var|function|class)[ \t]+([A-Za-z_$][\w$]*)/gm
  let m
  while ((m = re.exec(src)) !== null) names.push(m[1])
  // esbuild 把导出收成文件末尾一条 `export { … };`（本仓 scripts/lib/transpile-unit.mjs 里同名的处理叫
  //   inlineExportDeclarations，scripts/build.mjs 只是 import 它）：这里把它翻成同一份返回对象的键，
  //   并把这行从函数体里切掉。
  const trailing = /\nexport \{([^}]*)\};?\s*$/.exec(src)
  if (trailing) {
    for (const piece of trailing[1].split(',')) {
      const entry = piece.trim()
      if (!entry) continue
      const asMatch = /^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/.exec(entry)
      names.push(asMatch ? asMatch[2] + ': ' + asMatch[1] : entry)
    }
    src = src.slice(0, trailing.index)
  }
  if (!names.length) throw new Error(relPath + ' 里没有找到 export 声明')
  const body = src.replace(/^[ \t]*export[ \t]+/gm, '')
  const deps_ = Object.keys(deps)
  // 本文件选 compileFn：原来就是把这份依赖名清单（deps_）当参数表、把剥掉 export 的源码当函数体造函数，
  //   依赖本来就全部显式传参（被造的代码读不到本文件作用域），与共用入口一一对应。
  const fn = compileFn(deps_, body + '\nreturn { ' + names.join(', ') + ' }')
  return fn.apply(null, deps_.map(function (k) { return deps[k] }))
}

// ---------- 加载真代码：新鲜度常量（budget.ts 的产物）与界面那一半的判据 ----------
const budget = loadModule('src/shared/refresh/budget.js', {})
const truth = loadModule('src/client/views/shared/truthLines.js', {
  freshnessLevel: budget.freshnessLevel,
  lagPromiseFor: budget.lagPromiseFor,
  PROBE_INTERVAL_MS: budget.PROBE_INTERVAL_MS,
  PATCH_MERGE_WINDOW_MS: budget.PATCH_MERGE_WINDOW_MS,
  idOfParts: function (effort, key) { return String(effort || '') + '\0' + String(key == null ? '' : key) },
})
const locales = loadModule('src/client/kernel/locale-pages.js', {})
const zh = locales.L_PAGES.zh
const en = locales.L_PAGES.en
const say = function (key, params) {
  let s = zh[key]
  if (s === undefined) { fail('词条缺失：' + key + '（locale-pages.js 的 zh）'); return '' }
  Object.keys(params || {}).forEach(function (k) { s = s.split('{' + k + '}').join(String(params[k])) })
  return s
}
const textOf = function (line) { return say(line.key, line.params) }

// ---------- 一、新鲜度：取数时刻 + 两个阈值 ----------
const T1204 = new Date(2026, 0, 1, 12, 4, 0).getTime()
const snapAt = function (ms, extra) { return Object.assign({ generatedMs: ms }, extra || {}) }
/** 一份「正常取回来」的会话状态：快照里可以再挂上宿主写的降级读数（refresh）。 */
const stWith = function (refresh) { return { snapshot: snapAt(T1204, refresh ? { refresh: refresh } : null), snapMode: 'real', snapError: null } }
;(function checkFreshness() {
  const fresh = truth.truthFreshnessLine(stWith(), T1204 + 4 * 60_000)
  if (!fresh || fresh.tone !== 'fresh') fail('四分钟前的数据应当是 fresh，实际：' + JSON.stringify(fresh))
  const yellow = truth.truthFreshnessLine(stWith(), T1204 + 6 * 60_000)
  if (!yellow || yellow.tone !== 'yellow') fail('六分钟前的数据应当是 yellow（超 5 分钟变黄），实际：' + JSON.stringify(yellow))
  const red = truth.truthFreshnessLine(stWith(), T1204 + 40 * 60_000)
  if (!red || red.tone !== 'red') fail('四十分钟前的数据应当是 red（超 30 分钟变红），实际：' + JSON.stringify(red))
  // 时间戳取的是「快照取数时刻」那一刻的时分，不是渲染时刻的时分：
  // 上面三组输入的「现在」各不相同，画出来的却都该是 12:04。
  ;[fresh, yellow, red].forEach(function (ln) {
    const t = ln ? textOf(ln) : ''
    if (t.indexOf('12:04') < 0) fail('那一行的时间应当是快照取数时刻 12:04（不是渲染时刻），实际：' + JSON.stringify(t))
  })
})()

// ---------- 一之二、头部那个小时间标签要说的话（truthFreshnessBox）----------
// 2026-09-22 维护者定：「上次更新」那一条从面板正文那一行搬到面板头部第一行右侧那个小时间标签（panel/Dock.js）。
//   标签版面上只画一句相对时间（刚刚 / N 分钟前 / N 小时前 / N 天前），完整说法与精确时刻只在悬停提示里；
//   所以这一节量的是「四档相对时间各自算对了吗、精确时刻还是不是快照取数时刻、没快照时会不会凭空画一句」。
;(function checkHeadBox() {
  const tiers = [
    [20 * 1000, 'truth.updatedJustNow', 0, '刚刚'],
    [3 * 60_000, 'truth.updatedMinAgo', 3, '3 分钟前'],
    [5 * 60 * 60_000, 'truth.updatedHourAgo', 5, '5 小时前'],
    [3 * 24 * 60 * 60_000, 'truth.updatedDayAgo', 3, '3 天前'],
  ]
  for (const [ageMs, wantKey, wantN, wantText] of tiers) {
    const box = truth.truthFreshnessBox(stWith(), T1204 + ageMs)
    if (!box) { fail('头部时间标签：' + wantKey + ' 那一档没有算出话来'); continue }
    if (box.agoKey !== wantKey) fail('头部时间标签：' + wantKey + ' 那一档算成了 ' + box.agoKey + '（' + JSON.stringify(box) + '）')
    if (wantKey !== 'truth.updatedJustNow' && box.agoParams.n !== wantN) fail('头部时间标签：' + wantKey + ' 的数目应当是 ' + wantN + '，实得 ' + JSON.stringify(box.agoParams))
    if (box.time !== '12:04') fail('头部时间标签：精确时刻仍应取快照取数时刻 12:04（不是渲染时刻），实得 ' + JSON.stringify(box.time))
    const shown = say(box.agoKey, box.agoParams)
    if (shown !== wantText) fail('头部时间标签：' + wantKey + ' 画出来的话应当是「' + wantText + '」，实得 ' + JSON.stringify(shown))
    // 新鲜度那一档不许在这里另算一份：它必须就是上面那条判据给的 tone
    const line = truth.truthFreshnessLine(stWith(), T1204 + ageMs)
    if (line && box.tone !== line.tone) fail('头部时间标签的 tone 与新鲜度判据不一致（' + box.tone + ' vs ' + line.tone + '）')
    // 完整说法（悬停提示那句）里必须同时有「上次更新」、那句相对时间、以及精确时刻
    const tip = say('truth.updatedTip', { ago: shown, time: box.time })
    if (tip.indexOf('上次更新') < 0 || tip.indexOf(shown) < 0 || tip.indexOf('12:04') < 0) {
      fail('悬停提示那句没把完整说法与精确时刻都说出来：' + JSON.stringify(tip))
    }
  }
  // 还没拿到快照时一句话都不画（这条判据不许凭空造一个时刻）
  if (truth.truthFreshnessBox({ snapshot: null }, T1204) !== null) fail('还没拿到快照时头部时间标签不该算出任何一句话')
})()

// ---------- 二、两种失败是两句不同的话；第三种「已暂停」也说得出来 ----------
;(function checkTwoFailures() {
  const base = { snapshot: snapAt(T1204, { refresh: { tier: null, deferred: false, paused: false, notRefreshing: false } }), snapMode: 'err', snapError: 'boom' }
  const byOthers = truth.truthNoticeLines(Object.assign({}, base, { snapFail: { kind: 'quota-exhausted', at: T1204 } }), T1204)
  const byUs = truth.truthNoticeLines(Object.assign({}, base, { snapFail: { kind: 'fetch-failed', at: T1204 } }), T1204)
  const tOther = byOthers.filter(function (l) { return l.kind === 'fail' }).map(textOf)[0] || ''
  const tOurs = byUs.filter(function (l) { return l.kind === 'fail' }).map(textOf)[0] || ''
  if (!tOther || !tOurs) fail('两种失败各缺一句：' + JSON.stringify([tOther, tOurs]))
  if (tOther === tOurs) fail('两种失败说了同一句话（必须分开）: ' + tOurs)
  if (tOther.indexOf('其他使用者') < 0 || tOther.indexOf('整点') < 0) fail('「配额被别人耗尽」那句没说清等整点恢复：' + tOther)
  if (tOurs.indexOf('刷新失败') < 0 || tOurs.indexOf('重试') < 0) fail('「插件自己的取数失败」那句没说要重试：' + tOurs)
  // 插件自己的失败 + 已经暂停（配额紧张）时，说的是第三句
  const pausedFail = truth.truthNoticeLines(Object.assign({}, base, { snapFail: { kind: 'fetch-failed', at: T1204 }, snapshot: snapAt(T1204, { refresh: { tier: 'red', deferred: false, paused: true, notRefreshing: false } }) }), T1204)
  const tPaused = pausedFail.filter(function (l) { return l.kind === 'fail' }).map(textOf)[0] || ''
  if (tPaused.indexOf('已暂停') < 0 || tPaused.indexOf('配额紧张') < 0) fail('失败且已暂停时那句不对：' + tPaused)
})()

// ---------- 三、T3 那两句（自动刷新已暂停 / 未在刷新（同时活跃上限 2））----------
;(function checkT3Lines() {
  const paused = truth.truthNoticeLines(stWith({ tier: null, deferred: false, paused: true, notRefreshing: false }), T1204)
  const t1 = paused.filter(function (l) { return l.key === 'truth.paused' }).map(textOf)[0] || ''
  if (t1.indexOf('自动刷新已暂停') < 0) fail('T3 的「自动刷新已暂停」没有真实读取点或文案不对，实际：' + JSON.stringify(t1))
  const third = truth.truthNoticeLines(stWith({ tier: null, deferred: false, paused: false, notRefreshing: true }), T1204)
  const t2 = third.filter(function (l) { return l.key === 'truth.notRefreshing' }).map(textOf)[0] || ''
  if (t2.indexOf('未在刷新') < 0 || t2.indexOf('活跃上限 2') < 0) fail('T3 的「未在刷新（同时活跃上限 2）」没有真实读取点或文案不对，实际：' + JSON.stringify(t2))
})()

// ---------- 四、降档时把延迟承诺说出来（不许 5 秒静默变长）----------
;(function checkLag() {
  const at = function (tier) { return truth.truthNoticeLines(stWith({ tier: tier, deferred: false, paused: false, notRefreshing: false }), T1204) }
  const green = at('green').filter(function (l) { return l.kind === 'lag' }).map(textOf)[0]
  if (green) fail('绿档不该说「数据可能落后」：承诺没有变长，说了反而像出事，实际：' + green)
  const yellow = at('yellow').filter(function (l) { return l.kind === 'lag' }).map(textOf)[0] || ''
  const wantMin = Math.round(budget.PROBE_INTERVAL_YELLOW_MS / 60000)
  if (yellow.indexOf('数据可能落后') < 0 || yellow.indexOf(wantMin + ' 分钟') < 0) fail('黄档应当说「数据可能落后 ' + wantMin + ' 分钟」（数从 budget.ts 的探测间隔来），实际：' + JSON.stringify(yellow))
  const red = at('red')
  const redLag = red.filter(function (l) { return l.kind === 'lag' }).map(textOf)[0]
  if (redLag) fail('红档自动刷新全停，不该说「落后 X 分钟」（那是给了个不存在的上界）：' + redLag)
  if (!red.filter(function (l) { return l.key === 'truth.paused' }).length) fail('红档应当明说「自动刷新已暂停」')
})()

// ---------- 五、推迟：有更新，已推后 ----------
;(function checkDeferred() {
  const ls = truth.truthNoticeLines(stWith({ tier: null, deferred: true, paused: false, notRefreshing: false }), T1204)
  const t = ls.filter(function (l) { return l.key === 'truth.deferred' }).map(textOf)[0] || ''
  if (t.indexOf('有更新') < 0 || t.indexOf('推后') < 0) fail('推迟发生时应当显示「有更新，已推后」，实际：' + JSON.stringify(t))
})()

;(function checkPendingLate() {
  if (!zh['truth.pendingLate']) fail('zh 缺词条 truth.pendingLate')
  if (!en['truth.pendingLate']) fail('en 缺词条 truth.pendingLate')
  const pend = truth.truthNoticeLines({ snapshot: snapAt(T1204), snapMode: 'err', snapError: 'client loadSnapshot timeout 30s', snapPending: true }, T1204)
  if (!pend.some(function (l) { return l.key === 'truth.pendingLate' })) fail('放弃等待后应说仍在等（truth.pendingLate），实际：' + JSON.stringify(pend))
  if (pend.some(function (l) { return l.kind === 'fail' })) fail('仍在等时不该再说失败，实际：' + JSON.stringify(pend))
  const pendNoSnap = truth.truthNoticeLines({ snapshot: null, snapMode: 'err', snapError: 'client loadSnapshot timeout 30s', snapPending: true }, T1204)
  if (!pendNoSnap.some(function (l) { return l.key === 'truth.pendingLate' })) fail('无快照时仍在等也该说出来，实际：' + JSON.stringify(pendNoSnap))
})()

// ---------- 六、写入窗口判据与词条两面 ----------
;(function checkWriteWindowAndLocales() {
  // 窗口判据本身：窗口内 true，窗口外 false
  const t0 = 1_700_000_000_000
  if (!truth.truthWriteWindowOpen(t0, t0 + 1000)) fail('写入窗口内应当算「更新中」')
  if (truth.truthWriteWindowOpen(t0, t0 + budget.PATCH_MERGE_WINDOW_MS + 1)) fail('窗口一过就不该再算「更新中」')
  // 词条两面都在（中英双语，走现有红线检查的那一套）
  ;['truth.updatedAt', 'truth.failRetry', 'truth.failPaused', 'truth.failQuota', 'truth.pendingLate', 'truth.deferred', 'truth.paused', 'truth.notRefreshing', 'truth.lag', 'truth.writing'].forEach(function (k) {
    if (!zh[k]) fail('zh 缺词条 ' + k)
    if (!en[k]) fail('en 缺词条 ' + k)
  })
})()

// ---------- 七、降级标记到得了界面：把回包组装函数真跑一遍 ----------
;(function checkSnapshotEnvelope() {
  // 快照回包要把降级事实带上（否则宿主写了、界面读不到）：把组装函数真加载起来、喂两组输入，看回包上带没带。
  //   上游真降级 → 回包上必须是 'rest'；上游没降级 → 必须是 null（不许把没降级的也写成降级）。
  const envRel = 'src/host/snapshotEnvelope.ts'
  let snapFromRest = null
  let snapFromNone = null
  try {
    const envMod = loadModule(envRel, {})
    const env = envMod.createSnapshotEnvelope({ getGhPath: function () { return null }, getGhLastError: function () { return null }, adoptSnapshot: function (s) { return s } })
    snapFromRest = env.buildSnap({ fallback: 'rest', deck: null })
    snapFromNone = env.buildSnap({ fallback: null, deck: null })
  } catch (eEnv) {
    fail('快照回包组装（' + envRel + '）加载不起来，降级标记到不到界面无从判定：' + eEnv.message)
  }
  if (!snapFromRest || snapFromRest.fallback !== 'rest') fail('wf.snapshot 的回包没有把降级标记带出去（宿主写了却到不了界面）：上游真的降级时，回包上的 fallback 实得 ' + JSON.stringify(snapFromRest && snapFromRest.fallback))
  if (!snapFromNone || snapFromNone.fallback !== null) fail('wf.snapshot 的回包把没降级的也写成了降级（这条上界要如实）：上游没带降级事实时，回包上的 fallback 实得 ' + JSON.stringify(snapFromNone && snapFromNone.fallback))
})()

// ---------- 输出 ----------
console.log('#715 诚实显示门禁（新鲜度 / 失败 / 降级）')
if (failed) {
  problems.forEach(function (p) { console.log('  FAIL ' + p) })
  console.log('\n存在失败')
  process.exit(1)
}
console.log('  PASS 新鲜度取快照取数时刻，5 分钟黄 / 30 分钟红（阈值来自 budget.ts）')
console.log('  PASS 头部那个小时间标签：四档相对时间（刚刚 / N 分钟前 / N 小时前 / N 天前）都算对，精确时刻只在悬停提示里，没快照时一句话都不画')
console.log('  PASS 两种失败两句不同的话（插件自己的取数失败 / 配额已被其他使用者耗尽）')
console.log('  PASS T3 两句有读取点（自动刷新已暂停 / 未在刷新（同时活跃上限 2））')
console.log('  PASS 降档说出延迟承诺（数据可能落后 ' + Math.round(budget.PROBE_INTERVAL_YELLOW_MS / 60000) + ' 分钟）')
console.log('  PASS 推迟说「有更新，已推后」；写入窗口内/外判得对，那批词条中英两面都在')
console.log('  PASS 降级标记到得了界面：上游真降级时回包带 \'rest\'、没降级时是 null')
console.log('\n全部通过')
