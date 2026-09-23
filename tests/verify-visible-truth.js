// verify-visible-truth.js — #715（T11 第八批）诚实显示的门禁：新鲜度 / 失败 / 降级
//
// 这一条门禁盯的是「界面说得清这份数据有多新、上次刷新成不成、现在是不是降级」这件事，
// 以及最容易做假的一条：**降级标记只能由宿主写**。
//
// 它验七件事：
//   一、新鲜度：时间戳取快照的**取数时刻**（generatedMs），阈值 5 分钟黄 / 30 分钟红（常量来自 budget.ts）；
//   二、两种失败是两句不同的话（「插件自己的取数失败」与「配额已被其他使用者耗尽」）；
//   三、T3 那两句也要有读取点（「自动刷新已暂停」与「未在刷新（同时活跃上限 2）」）；
//   四、降档时把延迟承诺说出来（"数据可能落后 X 分钟"），绿档不说、红档说的是「已暂停」；
//   五、推迟发生时说「有更新，已推后」；
//   六、三处文案在界面代码里都有真实读取点（不是写了没人读）；
//   七、降级标记（fallback: 'rest'）只由宿主快照组装处写，界面层一处赋值都不许有（静态断言）。
//
// 跑法：node tests/verify-visible-truth.js
// 判据不是「字符串出现过」，而是把界面那一半的**真代码**加载起来喂两组输入、看它吐出什么话
//（与 scripts/build.mjs 拼接时同一套做法：剥掉行首 export，丢进同一个作用域里跑）。
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
let failed = false
const problems = []
const fail = function (msg) { problems.push(msg); failed = true }

/** 把一份「一源两物」的源文件当模块跑起来：剥行首 export，作用域里塞进它在拼接闭包里的邻居。 */
function loadModule(relPath, deps) {
  const src = fs.readFileSync(path.join(ROOT, relPath), 'utf8')
  const names = []
  const re = /^[ \t]*export[ \t]+(?:const|let|var|function|class)[ \t]+([A-Za-z_$][\w$]*)/gm
  let m
  while ((m = re.exec(src)) !== null) names.push(m[1])
  if (!names.length) throw new Error(relPath + ' 里没有找到 export 声明')
  const body = src.replace(/^[ \t]*export[ \t]+/gm, '')
  const deps_ = Object.keys(deps)
  const fn = new Function(deps_.join(', '), body + '\nreturn { ' + names.join(', ') + ' }')
  return fn.apply(null, deps_.map(function (k) { return deps[k] }))
}

function countLinesHits(relPath, regex) {
  const src = fs.readFileSync(path.join(ROOT, relPath), 'utf8')
  const hits = []
  src.split(/\r?\n/).forEach(function (line, i) {
    // 只看代码那一截：注释里为了解释而提到某个数字或某个字段名，不算「代码里写了这个数字/这一处赋值」。
    const code = line.replace(/\/\/.*$/, '')
    if (regex.test(code)) hits.push((i + 1) + ': ' + line.trim())
  })
  return hits
}

function walk(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    const st = fs.statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (name.endsWith('.js')) out.push(path.relative(ROOT, p).replace(/\\/g, '/'))
  }
  return out
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
  // 阈值不许在界面里另写一份：界面文件里不许出现这些毫秒字面量
  const banned = /(\b300000\b|\b1800000\b|\b120000\b|\b10000\b|5\s*\*\s*60\s*\*\s*1000|30\s*\*\s*60\s*\*\s*1000)/
  ;['src/client/views/shared/truthLines.js', 'src/client/views/ListTab.js', 'src/client/views/ListTabRow.js'].forEach(function (f) {
    const hits = countLinesHits(f, banned)
    if (hits.length) fail(f + ' 里出现了阈值/窗口的毫秒字面量（应当只用 budget.ts 的常量）：' + hits.join(' | '))
  })
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

// ---------- 六、三处文案的真实读取点（静态：界面代码真的把它们画出来）----------
;(function checkReadPoints() {
  const listTab = fs.readFileSync(path.join(ROOT, 'src/client/views/ListTab.js'), 'utf8')
  const row = fs.readFileSync(path.join(ROOT, 'src/client/views/ListTabRow.js'), 'utf8')
  if (!/truthNoticeLines\(st/.test(listTab) || !/truthFreshnessLine\(st/.test(listTab)) fail('ListTab.js 没有读新鲜度/通知那两路判据（写了没人读）')
  if (!/tr\(ln\.key/.test(listTab)) fail('ListTab.js 没有把判据吐出来的词条画出来（读了没画）')
  if (!/snapshot\.fallback === 'rest'/.test(listTab) || !/tr\('list\.restFallback'\)/.test(listTab)) fail('ListTab.js 没有读降级标记并画出「已切 REST 通道」横幅')
  if (!/truthWriteWindowOpen\(st\.writeAt/.test(row) || !/tr\('truth\.writing'\)/.test(row)) fail('ListTabRow.js 没有在写入窗口期画出那一行「更新中」标记')
  const apiIo = fs.readFileSync(path.join(ROOT, 'src/client/kernel/api-io.js'), 'utf8')
  if (!/markRowWrite\(st, num, ciEffort\)/.test(apiIo)) fail('api-io.js 写入成功那一处没有记下时刻（「更新中」就没有事实来源）')
  // 窗口判据本身：窗口内 true，窗口外 false
  const t0 = 1_700_000_000_000
  if (!truth.truthWriteWindowOpen(t0, t0 + 1000)) fail('写入窗口内应当算「更新中」')
  if (truth.truthWriteWindowOpen(t0, t0 + budget.PATCH_MERGE_WINDOW_MS + 1)) fail('窗口一过就不该再算「更新中」')
  // 词条两面都在（中英双语，走现有红线检查的那一套）
  ;['truth.updatedAt', 'truth.failRetry', 'truth.failPaused', 'truth.failQuota', 'truth.deferred', 'truth.paused', 'truth.notRefreshing', 'truth.lag', 'truth.writing'].forEach(function (k) {
    if (!zh[k]) fail('zh 缺词条 ' + k)
    if (!en[k]) fail('en 缺词条 ' + k)
  })
  // 拼接登记：界面读的那些常量来自 budget.ts 的产物，缺登记就会在运行时变成 undefined
  const build = fs.readFileSync(path.join(ROOT, 'scripts/build.mjs'), 'utf8')
  const index = fs.readFileSync(path.join(ROOT, 'src/client/index.js'), 'utf8')
  const marker = '// ==== shared:refreshBudget (spliced by build) ===='
  if (build.indexOf(marker) < 0) fail('scripts/build.mjs 没有登记 ' + marker)
  if (index.indexOf(marker) < 0) fail('src/client/index.js 没有放 ' + marker)
  if (build.indexOf("id: 'truthLines'") < 0) fail('scripts/build.mjs 的叶子清单没有登记 truthLines')
  if (index.indexOf('// ==== leaf:truthLines (spliced by build) ====') < 0) fail('src/client/index.js 没有放 leaf:truthLines 标记')
})()

// ---------- 七、降级标记只由宿主写：界面层一处赋值都不许有（静态断言）----------
;(function checkDegradeMarkerOwnership() {
  const clientFiles = walk(path.join(ROOT, 'src/client'), [])
  // 界面层：不许给降级标记赋值（属性赋值、对象字面量里给 snapshot 补一个 fallback、把 'rest' 塞给降级字段）
  const assignRe = /\.(fallback|degraded|degradeReason)\s*=(?!=)/
  const litRe = /(fallback|degraded)\s*[:=]\s*['"]rest['"]/
  clientFiles.forEach(function (f) {
    const hits = countLinesHits(f, assignRe).concat(countLinesHits(f, litRe))
    if (hits.length) fail('界面层不许给降级标记赋值（只能由宿主快照组装处写）：' + f + ' → ' + hits.join(' | '))
  })
  // 宿主快照组装处：必须有这一处写入，而且写的是真实降级事实（不是写死的 'rest'）
  const asm = fs.readFileSync(path.join(ROOT, 'src/host/tracker/snapshot.js'), 'utf8')
  if (!/snapshot\.fallback\s*=\s*listFallback === 'rest' \? 'rest' : null/.test(asm)) fail('宿主快照组装处没有按真实降级事实写 snapshot.fallback')
  if (!/res\.fallback === 'rest'|fast\.fallback === 'rest'/.test(asm)) fail('宿主快照组装处没有读上游带回来的真实降级事实（listFallback）')
  // 上游那一处降级事实：github 后端的 REST 通道真的降级时才带 fallback: 'rest'
  const gh = fs.readFileSync(path.join(ROOT, 'src/host/tracker/backends/github/issues.js'), 'utf8')
  if (!/return \{ ok: true, data: applyIssueFilter\(restNorm, filter\), fallback: 'rest' \}/.test(gh)) fail('github 后端的 REST 降级通道没有把 fallback: \'rest\' 这个事实带回来')
  // 快照回包要把这两个字段带上（否则宿主写了、界面读不到）
  const snapReply = fs.readFileSync(path.join(ROOT, 'src/host/sessionSnapshot.js'), 'utf8')
  if (!/fallback: \(o\.fallback === 'rest' \? 'rest' : null\)/.test(snapReply)) fail('wf.snapshot 的回包没有把降级标记带出去（宿主写了却到不了界面）')
})()

// ---------- 输出 ----------
console.log('#715 诚实显示门禁（新鲜度 / 失败 / 降级）')
if (failed) {
  problems.forEach(function (p) { console.log('  FAIL ' + p) })
  console.log('\n存在失败')
  process.exit(1)
}
console.log('  PASS 新鲜度取快照取数时刻，5 分钟黄 / 30 分钟红（阈值来自 budget.ts）')
console.log('  PASS 两种失败两句不同的话（插件自己的取数失败 / 配额已被其他使用者耗尽）')
console.log('  PASS T3 两句有读取点（自动刷新已暂停 / 未在刷新（同时活跃上限 2））')
console.log('  PASS 降档说出延迟承诺（数据可能落后 ' + Math.round(budget.PROBE_INTERVAL_YELLOW_MS / 60000) + ' 分钟）')
console.log('  PASS 推迟说「有更新，已推后」；降级横幅与写入中的「更新中」都有读取点')
console.log('  PASS 降级标记只由宿主快照组装处写，界面层一处赋值都没有')
console.log('\n全部通过')
