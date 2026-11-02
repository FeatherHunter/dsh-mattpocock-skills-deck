// verify-visible-truth.ts — #715（T11 第八批）诚实显示的门禁：新鲜度 / 失败 / 降级
//
// 这一条门禁盯的是「界面说得清这份数据有多新、上次刷新成不成、现在是不是降级」这件事，
// 以及最容易做假的一条：**降级标记只能由宿主写**。
//
// 它验八件事：
//   一、新鲜度：时间戳取快照的**取数时刻**（generatedMs），阈值 5 分钟黄 / 30 分钟红（常量来自 budget.ts）；
//      2026-09-22 起这条信息显示在面板头部那个小时间标签上（panel/Dock.js），标签只画相对时间、
//      完整说法与精确时刻在悬停提示里 —— 那一节判据（truthFreshnessBox）也在这里量。
//   二、当前是否失败改由面板头部刷新按钮旁一枚带文字的小标识表达（#1833，三种原因各有一句完整说明），
//      列表状态行不再出现失败句；放弃等待后活还在跑时说「仍在等」不说失败（无快照也说）；
//   三、T3 那两句也要有读取点（「自动刷新已暂停」与「未在刷新（同时活跃上限 2）」）；
//   四、降档时把延迟承诺说出来（"数据可能落后 X 分钟"），绿档不说、红档说的是「已暂停」；
//   五、推迟发生时说「有更新，已推后」；
//   六、写入窗口判据（窗口内算「更新中」、窗口外不算）与那批词条中英两面都在；
//   七、降级标记（fallback: 'rest'）到得了界面：把快照回包组装函数真跑一遍，上游真降级时回包带 'rest'、没降级时是 null。
//   八、面板的额度读数（#1446）：只读宿主写下的 refresh.backend.budgetKind，两桶 / 只计请求 / 离网 / 未知四种后端各说各的话；
//      读数未知时只许说「还没同步上来」，不许出现数字 0，也不许上红档（不知道不等于紧张）。
//      #1833：额度不再并进列表状态行，改为按「充足 / 紧张 / 未知 / 离网 / 没有额度」给通知中心那一行
//      （budgetTierViewOf），列表行一个字都不再说额度。
//
// 跑法：node tests/verify-visible-truth.ts
// 判据不是「字符串出现过」，而是把界面那一半的**真代码**加载起来喂两组输入、看它吐出什么话
//（与 scripts/build.mts 拼接时同一套做法：剥掉行首 export，丢进同一个作用域里跑）。
const fs = require('fs')
const path = require('path')
// 转译参数从仓库唯一那一份取（scripts/lib/transpile-unit.mts 写明这组参数只在那处写、别处各抄一份会静默分叉）；
// 从 CJS require 一个 .mjs，与 tests/verify-file-granularity.ts 里 require('../scripts/lib/effective-lines.mts') 是同一种用法。
const { TRANSPILE_OPTIONS } = require('../scripts/lib/transpile-unit.mts')
// #1833：头部失败小标识要真渲染一次，确认「健康态不画、失败态带文字且原因进悬停」。
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const { compileFn } = require('./lib/eval-probe.js')
// 取源走共用入口（tests/lib/source-text.ts）：这一阶段 src/client 下的同名 .js 构建产物已经删掉，
//   下面 loadModule 按 .js 路径直接读会 ENOENT。sourcePath 问 .js 时同名 .ts 优先，问到的是手写真源；
//   问到的仍是 .js（例如 shared 域的产物 budget.js，它的源码在域目录的 src/ 子目录里、不同名目录）
//   就照旧读那个文件，不硬把产物改读成别的东西。
const { sourcePath } = require('./lib/source-text.ts')
// 中央时间真值：拼进闭包的几片（budget.js 的 freshnessLevel/lagPromiseFor、truthLines 那片）在门禁里
// 是“剥掉中央 import 行、当函数体编译”跑起来的（见下面的 loadModule），裸用的中央名字在求值时走全局预埋——
// 值就是中央导出的同一份，不经过第二份拷贝。单源头改造前这些名字是各文件的字面量，预埋无从谈起。
const centralTime = require('../src/shared/time-config/values.js')
Object.assign(globalThis, centralTime)
const { PROBE_INTERVAL_MS, PATCH_MERGE_WINDOW_MS, PROBE_INTERVAL_YELLOW_MS } = centralTime

const ROOT = path.resolve(__dirname, '..')
let failed = false
const problems = []
const fail = function (msg) { problems.push(msg); failed = true }

/** 把一份「一源两物」的源文件当模块跑起来：剥行首 export，作用域里塞进它在拼接闭包里的邻居。 */
function loadModule(relPath, deps) {
  // 取源见文件头：先问真源在哪（.js 说明符 → 同名 .ts 优先），再读那个路径的原文。
  const resolved = sourcePath(relPath)
  let src = fs.readFileSync(path.join(ROOT, resolved), 'utf8')
  // 中央 import 在 compileFn 函数体里非法，求值前整行剥掉（闭包里它由时间片段提供，门禁里走上面的全局预埋）。
  src = src.split('\n').filter((l) => !/^\s*import\s.*time-config\/values\.js/.test(l)).join('\n')
  if (resolved.endsWith('.ts')) {
    // 源码是 .ts：先按仓库自己的转译口径剥掉类型（转译参数只写在 scripts/lib/transpile-unit.mts 那一份，
    //   这里取现成的，不另抄一套），再照下面同一套「剥行首 export、当函数体编译」的读法加载。
    //   少了这一步，`type X = …` 会在编译函数时当场 SyntaxError —— 类型标注只给编译器看，运行期行为
    //   一个字没变，剥掉之后跑的就是真正跑的那段代码。
    src = require('esbuild').transformSync(src, TRANSPILE_OPTIONS).code
  }
  const names = []
  const re = /^[ \t]*export[ \t]+(?:const|let|var|function|class)[ \t]+([A-Za-z_$][\w$]*)/gm
  let m
  while ((m = re.exec(src)) !== null) names.push(m[1])
  // esbuild 把导出收成文件末尾一条 `export { … };`（本仓 scripts/lib/transpile-unit.mts 里同名的处理叫
  //   inlineExportDeclarations，scripts/build.mts 只是 import 它）：这里把它翻成同一份返回对象的键，
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
const budget = loadModule('src/refresh/kernel/host-budget.js', {})
const truth = loadModule('src/client/views/shared/truthLines.js', {
  freshnessLevel: budget.freshnessLevel,
  lagPromiseFor: budget.lagPromiseFor,
  // 额度读数的黄/红档位沿用宿主那一份 tierFor，门禁里把它当邻居传进去（与拼接闭包里的处境一致）。
  tierFor: budget.tierFor,
  PROBE_INTERVAL_MS: PROBE_INTERVAL_MS,
  PATCH_MERGE_WINDOW_MS: PATCH_MERGE_WINDOW_MS,
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
// #1833：面板头部「失败」小标识的叶子。依赖照拼接闭包里的邻居显式传进来，不读本文件作用域。
const failMark = loadModule('src/client/views/shared/refreshFailMark.js', {
  React: React,
  DswsCtx: React.createContext({ h: React.createElement }),
  truthFailureOf: truth.truthFailureOf,
  freshnessToneColor: truth.freshnessToneColor,
  Ic: function (props) { return '[icon:' + String(props && props.n) + ']' },
  tr: function (key, params) { return say(key, params) },
  Tip: function (props) { return React.createElement('span', { 'data-tip': String(props && props.content) }, props && props.children) },
})

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

// ---------- 二、当前是否失败改由头部小标识表达；列表状态行不再出现失败句 ----------
;(function checkFailureMarkFacts() {
  const base = { snapshot: snapAt(T1204, { refresh: { tier: null, deferred: false, paused: false, notRefreshing: false } }), snapMode: 'err', snapError: 'boom' }
  // 失败这一事实仍分三种原因，只是承载它的地方从列表行换到了面板头部；tipKey 是悬停里那句完整说明的词条。
  const quota = truth.truthFailureOf(Object.assign({}, base, { snapFail: { kind: 'quota-exhausted', at: T1204 } }))
  const retry = truth.truthFailureOf(Object.assign({}, base, { snapFail: { kind: 'fetch-failed', at: T1204 } }))
  const pausedFail = truth.truthFailureOf(Object.assign({}, base, { snapFail: { kind: 'fetch-failed', at: T1204 }, snapshot: snapAt(T1204, { refresh: { tier: 'red', deferred: false, paused: true, notRefreshing: false } }) }))
  // 健康态没有失败事实：小标识不画，列表状态行也不该凭空多一句话。
  if (truth.truthFailureOf(stWith()) !== null) fail('健康态不该算出「失败」这件事')
  if (truth.truthNoticeLines(stWith(), T1204).length !== 0) fail('健康态的列表状态行该是空的（失败与额度都不再占列表这一行）')
  if (!quota || quota.reason !== 'quota' || quota.tipKey !== 'truth.failQuota') fail('配额被别人耗尽时该算出 reason=quota / tipKey=truth.failQuota，实得：' + JSON.stringify(quota))
  if (!retry || retry.reason !== 'retry' || retry.tipKey !== 'truth.failRetry') fail('插件自己的取数失败还在重试时该算出 reason=retry / tipKey=truth.failRetry，实得：' + JSON.stringify(retry))
  if (!pausedFail || pausedFail.reason !== 'paused' || pausedFail.tipKey !== 'truth.failPaused' || pausedFail.paused !== true) fail('失败且已暂停时该算出 reason=paused / tipKey=truth.failPaused，实得：' + JSON.stringify(pausedFail))
  const tOther = quota ? say(quota.tipKey) : ''
  const tOurs = retry ? say(retry.tipKey) : ''
  if (!tOther || !tOurs) fail('两种失败各缺一句悬停说明：' + JSON.stringify([tOther, tOurs]))
  if (tOther === tOurs) fail('两种失败说了同一句话（必须分开）: ' + tOurs)
  if (tOther.indexOf('其他使用者') < 0 || tOther.indexOf('整点') < 0) fail('「配额被别人耗尽」那句没说清等整点恢复：' + tOther)
  if (tOurs.indexOf('刷新失败') < 0 || tOurs.indexOf('重试') < 0) fail('「插件自己的取数失败」那句没说要重试：' + tOurs)
  if (say(pausedFail.tipKey).indexOf('已暂停') < 0 || say(pausedFail.tipKey).indexOf('配额紧张') < 0) fail('失败且已暂停时那句不对：' + say(pausedFail.tipKey))
  // 放弃等待后活还在跑：说「仍在等」，既不画失败标识，列表行也不说失败。
  const late = { snapshot: snapAt(T1204), snapMode: 'err', snapError: 'timeout', snapPending: true }
  if (truth.truthFailureOf(late) !== null) fail('还在等的时候（snapPending）不该画失败标识')
  if (truth.truthNoticeLines(late, T1204).some(function (l) { return l.kind === 'fail' })) fail('还在等的时候列表行不该说失败')
  // #1833 的落点：失败这一行从列表状态行退役后，列表行里再也不出现 kind=fail 的句子（有快照、无快照都一样）。
  if (truth.truthNoticeLines(base, T1204).some(function (l) { return l.kind === 'fail' })) fail('列表状态行不该再说失败（失败改由头部小标识表达）')
  if (truth.truthNoticeLines(Object.assign({}, base, { snapshot: null }), T1204).some(function (l) { return l.kind === 'fail' })) fail('无快照时列表状态行也不该说失败')
})()

// ---------- 二之二、头部小标识真渲染：健康态不画、失败态带「失败」两个字的可见文字、原因进悬停 ----------
;(function checkFailureMarkRender() {
  const render = function (st) { return renderToStaticMarkup(React.createElement(failMark.RefreshFailMark, { st: st })) }
  const htmlOf = function (kind, extra) {
    return render(Object.assign({ snapshot: snapAt(T1204), snapMode: 'err', snapError: 'boom' }, kind ? { snapFail: { kind: kind, at: T1204 } } : {}, extra || {}))
  }
  if (render(stWith()) !== '') fail('健康态头部不该画失败标识，实得：' + JSON.stringify(render(stWith())))
  const quotaHtml = htmlOf('quota-exhausted')
  if (quotaHtml.indexOf('data-head-fail="quota"') < 0) fail('配额耗尽时头部小标识没带 data-head-fail="quota"：' + JSON.stringify(quotaHtml))
  if (quotaHtml.indexOf('失败') < 0) fail('失败小标识必须带可读的「失败」文字（不靠悬停才看得见）：' + JSON.stringify(quotaHtml))
  if (quotaHtml.indexOf(say('truth.failQuota')) < 0) fail('配额耗尽那次的完整原因没进悬停提示：' + JSON.stringify(quotaHtml))
  const retryHtml = htmlOf('fetch-failed')
  if (retryHtml.indexOf('data-head-fail="retry"') < 0) fail('取数失败时头部小标识没带 data-head-fail="retry"：' + JSON.stringify(retryHtml))
  if (retryHtml.indexOf(say('truth.failRetry')) < 0) fail('取数失败的完整原因没进悬停提示：' + JSON.stringify(retryHtml))
  const pausedHtml = htmlOf('fetch-failed', { snapshot: snapAt(T1204, { refresh: { tier: 'red', deferred: false, paused: true, notRefreshing: false } }) })
  if (pausedHtml.indexOf('data-head-fail="paused"') < 0) fail('失败且已暂停时头部小标识没带 data-head-fail="paused"：' + JSON.stringify(pausedHtml))
  const nullSnapHtml = render({ snapshot: null, snapMode: 'err', snapError: 'boom', snapFail: { kind: 'fetch-failed', at: T1204 } })
  if (nullSnapHtml.indexOf('data-head-fail="retry"') < 0) fail('无快照时失败也要在头部看得见（不能只靠列表里那行全屏错误）：' + JSON.stringify(nullSnapHtml))
  if (render({ snapshot: null, snapMode: 'err', snapError: 'timeout', snapPending: true }) !== '') fail('还在等的时候头部不该画失败标识')
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
  const wantMin = Math.round(PROBE_INTERVAL_YELLOW_MS / 60000)
  if (yellow.indexOf('数据可能落后') < 0 || yellow.indexOf(wantMin + ' 分钟') < 0) fail('黄档应当说「数据可能落后 ' + wantMin + ' 分钟」（数从中央时间参数的黄档探测间隔来），实际：' + JSON.stringify(yellow))
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
  if (truth.truthWriteWindowOpen(t0, t0 + PATCH_MERGE_WINDOW_MS + 1)) fail('窗口一过就不该再算「更新中」')
  // 词条两面都在（中英双语，走现有红线检查的那一套）
  ;['truth.updatedAt', 'truth.failBadge', 'truth.failRetry', 'truth.failPaused', 'truth.failQuota', 'truth.pendingLate', 'truth.deferred', 'truth.paused', 'truth.notRefreshing', 'truth.lag', 'truth.writing'].forEach(function (k) {
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

// ---------- 八、面板的额度读数（#1446）----------
// 面板不推算后端类型，只读宿主写下的 refresh.backend；这一节量的是「四种后端各说各的话、未知时不吓人」。
;(function checkBudgetNotices() {
  ;['truth.budgetGraphql', 'truth.budgetRest', 'truth.budgetRequests', 'truth.budgetOffNetwork', 'truth.budgetUnknown', 'truth.budgetUnknownModel', 'truth.budgetSyncFailedHard', 'truth.budgetSyncFailedSoft', 'truth.budgetStaleSyncFailedHard', 'truth.budgetStaleSyncFailedSoft'].forEach(function (k) {
    if (!zh[k]) fail('zh 缺词条 ' + k)
    if (!en[k]) fail('en 缺词条 ' + k)
  })
  // 两套入口分开：budgetNoticeLines 收的是 refresh 那一格本身，truthNoticeLines 收的是整个界面状态（snapshot.refresh 在里面）。
  const refreshWith = function (backend) {
    return { tier: null, deferred: false, paused: false, notRefreshing: false, backend: backend }
  }
  const withBackend = function (backend) { return stWith(refreshWith(backend)) }
  const keysOf = function (lines) { return lines.map(function (l) { return l.key }) }
  // 两桶后端：GraphQL 剩 4200/5000，REST 剩 60/60，两句都要带上真读数
  const twoBuckets = truth.budgetNoticeLines(refreshWith({
    id: 'gh-graphql', budgetKind: 'two-buckets', readKnown: true, offNetwork: false,
    buckets: { graphql: { remaining: 4200, limit: 5000 }, rest: { remaining: 60, limit: 60 } },
  }))
  if (keysOf(twoBuckets).join(',') !== 'truth.budgetGraphql,truth.budgetRest') fail('两桶后端应当先念 GraphQL 再念 REST，实得：' + JSON.stringify(keysOf(twoBuckets)))
  const gqlText = twoBuckets[0] ? textOf(twoBuckets[0]) : ''
  if (gqlText.indexOf('4200') < 0 || gqlText.indexOf('5000') < 0) fail('GraphQL 那一行没带上剩余量与总额：' + JSON.stringify(gqlText))
  if (twoBuckets[0] && twoBuckets[0].tone !== 'fresh') fail('额度还宽裕时不该是黄/红档：' + JSON.stringify(twoBuckets[0]))
  // 只计请求的后端：一句「请求额度剩 N/M」
  const requests = truth.budgetNoticeLines(refreshWith({
    id: 'gh-rest', budgetKind: 'requests', readKnown: true, offNetwork: false,
    requests: { remaining: 3000, limit: 5000 },
  }))
  if (keysOf(requests).join(',') !== 'truth.budgetRequests') fail('只计请求的后端应当只说请求额度，实得：' + JSON.stringify(keysOf(requests)))
  // 离网后端：一句「本后端不出站，不需要额度」，不说「还没同步」
  const offNetwork = truth.budgetNoticeLines(refreshWith({ id: 'local', budgetKind: 'none', readKnown: false, offNetwork: true }))
  if (keysOf(offNetwork).join(',') !== 'truth.budgetOffNetwork') fail('离网后端应当说「不需要额度」，实得：' + JSON.stringify(keysOf(offNetwork)))
  if (textOf(offNetwork[0] || {}).indexOf('不需要额度') < 0) fail('离网那句文案应当是「不需要额度」：' + JSON.stringify(textOf(offNetwork[0] || {})))
  // 读数未知：只许说「还没同步上来」，整行不许出现数字，也不许上红/黄档
  const unknown = truth.budgetNoticeLines(refreshWith({
    id: 'gh-graphql', budgetKind: 'two-buckets', readKnown: false, offNetwork: false,
    buckets: { graphql: { remaining: 0, limit: 5000 }, rest: { remaining: 0, limit: 60 } },
  }))
  if (keysOf(unknown).join(',') !== 'truth.budgetUnknown') fail('读数未知时应当只说「还没同步上来」，实得：' + JSON.stringify(keysOf(unknown)))
  const unknownText = textOf(unknown[0] || {})
  if (/\d/.test(unknownText)) fail('读数未知时整行不许出现数字（尤其不许把 0 念出来）：' + JSON.stringify(unknownText))
  if (unknown[0] && (unknown[0].tone === 'red' || unknown[0].tone === 'yellow')) fail('读数未知时不许上红/黄档：' + JSON.stringify(unknown[0]))
  // 预算模型未知（#1455）：后端声明 unknown 时也要说「未知」，不静默、不念数字、不上红/黄档。
  // 它与上面「读数未知」是两句不同的话：这里是「这个后端的额度怎么算说不清」，那里是「这次还没读到」。
  const unknownModel = truth.budgetNoticeLines(refreshWith({ id: 'gh-graphql', budgetKind: 'unknown', readKnown: false, offNetwork: false, reason: 'unsupported' }))
  if (keysOf(unknownModel).join(',') !== 'truth.budgetUnknownModel') fail('预算模型未知时应当说「未知」，实得：' + JSON.stringify(keysOf(unknownModel)))
  const unknownModelText = textOf(unknownModel[0] || {})
  if (unknownModelText.indexOf('未知') < 0) fail('预算模型未知那句要自己说出「未知」：' + JSON.stringify(unknownModelText))
  if (/\d/.test(unknownModelText)) fail('预算模型未知时整行不许出现数字（尤其不许把 0 念出来）：' + JSON.stringify(unknownModelText))
  if (unknownModel[0] && (unknownModel[0].tone === 'red' || unknownModel[0].tone === 'yellow')) fail('预算模型未知时不许上红/黄档：' + JSON.stringify(unknownModel[0]))
  // 后台同步失败（#1006）：读数未知时要把「为什么还没同步」说出来，不能永远只有一句「还没同步上来」。
  // hard = 这台机器上的命令行工具没准备好（要人处理，黄档）；soft = 刚才没连上服务（等它自己重试，绿档）。
  const hardSync = truth.budgetNoticeLines(refreshWith({
    id: 'gh-graphql', budgetKind: 'two-buckets', readKnown: false, offNetwork: false, reason: 'not-measured',
    sync: { lastFailAt: 1767221040000, lastFailKind: 'hard' },
  }))
  if (keysOf(hardSync).join(',') !== 'truth.budgetSyncFailedHard') fail('环境没准备好时应当说 truth.budgetSyncFailedHard，实得：' + JSON.stringify(keysOf(hardSync)))
  const hardSyncText = textOf(hardSync[0] || {})
  if (hardSyncText.indexOf('还没同步上来') < 0 || hardSyncText.indexOf('没准备好') < 0) fail('hard 那句要同时说出「还没同步上来」与「命令行工具没准备好」：' + JSON.stringify(hardSyncText))
  if (hardSyncText.indexOf('重试') < 0) fail('hard 那句要说清后台会继续重试：' + JSON.stringify(hardSyncText))
  if (hardSyncText.indexOf('要人检查') < 0) fail('hard 那句要说清「等人去处理」（不是只要重试就好）：' + JSON.stringify(hardSyncText))
  if (/\d/.test(hardSyncText)) fail('hard 那句不许出现数字（尤其不许把 0 念出来）：' + JSON.stringify(hardSyncText))
  if (hardSyncText.indexOf('用完') >= 0 || hardSyncText.indexOf('耗尽') >= 0) fail('hard 那句不许把「不知道」说成「用完了 / 耗尽」：' + JSON.stringify(hardSyncText))
  if (hardSync[0] && hardSync[0].tone !== 'yellow') fail('环境没准备好要人处理，应是黄档：' + JSON.stringify(hardSync[0]))
  const softSync = truth.budgetNoticeLines(refreshWith({
    id: 'gh-graphql', budgetKind: 'two-buckets', readKnown: false, offNetwork: false, reason: 'not-measured',
    sync: { lastFailAt: 1767221040000, lastFailKind: 'soft' },
  }))
  if (keysOf(softSync).join(',') !== 'truth.budgetSyncFailedSoft') fail('刚才没连上时应当说 truth.budgetSyncFailedSoft，实得：' + JSON.stringify(keysOf(softSync)))
  const softSyncText = textOf(softSync[0] || {})
  if (softSyncText.indexOf('还没同步上来') < 0 || softSyncText.indexOf('没连上') < 0) fail('soft 那句要同时说出「还没同步上来」与「刚才没连上」：' + JSON.stringify(softSyncText))
  if (softSyncText.indexOf('重试') < 0) fail('soft 那句要说清后台会继续重试：' + JSON.stringify(softSyncText))
  if (/\d/.test(softSyncText)) fail('soft 那句不许出现数字：' + JSON.stringify(softSyncText))
  if (softSync[0] && softSync[0].tone !== 'fresh') fail('刚才没连上是等它自己重试，应是绿档：' + JSON.stringify(softSync[0]))
  if (softSyncText === hardSyncText) fail('两种失败不能是同一句话（环境没准备好 ≠ 刚才没连上）')
  // 有旧读数时失败也要说得出来（#1006 复核）：数字照念，后面补一句它可能不是最新的 + 原因。
  //   只加在这个分支、且只认两种已知类别；没有 sync 或形状不对时不许凭空补一句。
  const staleHard = truth.budgetNoticeLines(refreshWith({
    id: 'gh-graphql', budgetKind: 'two-buckets', readKnown: true, offNetwork: false,
    buckets: { graphql: { remaining: 4200, limit: 5000 }, rest: { remaining: 60, limit: 60 } },
    sync: { lastFailAt: 1767221040000, lastFailKind: 'hard' },
  }))
  if (keysOf(staleHard).join(',') !== 'truth.budgetGraphql,truth.budgetRest,truth.budgetStaleSyncFailedHard') fail('有旧读数且后台同步硬失败时，应念数字再补 truth.budgetStaleSyncFailedHard，实得：' + JSON.stringify(keysOf(staleHard)))
  const staleHardText = textOf(staleHard[2] || {})
  if (staleHardText.indexOf('不是最新') < 0 || staleHardText.indexOf('没准备好') < 0 || staleHardText.indexOf('再试') < 0) fail('有旧读数的 hard 失败句要说清「数字可能不是最新」「工具没准备好」「之后会再试」：' + JSON.stringify(staleHardText))
  if (/\d/.test(staleHardText)) fail('有旧读数的 hard 失败句不许出现数字（数字只在读数那一行）：' + JSON.stringify(staleHardText))
  if (staleHard[0] && textOf(staleHard[0]).indexOf('4200') < 0) fail('补了失败句之后旧数字仍要照念：' + JSON.stringify(staleHard[0]))
  if (staleHard[2] && staleHard[2].tone !== 'yellow') fail('有旧读数的 hard 失败要人处理，应是黄档：' + JSON.stringify(staleHard[2]))
  const staleSoft = truth.budgetNoticeLines(refreshWith({
    id: 'gh-rest', budgetKind: 'requests', readKnown: true, offNetwork: false,
    requests: { remaining: 3000, limit: 5000 },
    sync: { lastFailAt: 1767221040000, lastFailKind: 'soft' },
  }))
  if (keysOf(staleSoft).join(',') !== 'truth.budgetRequests,truth.budgetStaleSyncFailedSoft') fail('有旧读数且后台同步软失败时，应念数字再补 truth.budgetStaleSyncFailedSoft，实得：' + JSON.stringify(keysOf(staleSoft)))
  const staleSoftText = textOf(staleSoft[1] || {})
  if (staleSoftText.indexOf('不是最新') < 0 || staleSoftText.indexOf('没连上') < 0 || staleSoftText.indexOf('重试') < 0) fail('有旧读数的 soft 失败句要说清「数字可能不是最新」「刚才没连上」「会继续重试」：' + JSON.stringify(staleSoftText))
  if (staleSoft[1] && staleSoft[1].tone !== 'fresh') fail('有旧读数的 soft 失败是等它自己好，应是绿档：' + JSON.stringify(staleSoft[1]))
  // 真耗尽时数字就是此刻事实：只说 failQuota，不再补「可能不是最新」。
  const staleExhausted = truth.budgetNoticeLines(refreshWith({
    id: 'gh-graphql', budgetKind: 'two-buckets', readKnown: true, offNetwork: false,
    buckets: { graphql: { remaining: 0, limit: 5000 }, rest: { remaining: 0, limit: 60 } },
    sync: { lastFailAt: 1767221040000, lastFailKind: 'hard' },
  }))
  if (keysOf(staleExhausted).join(',') !== 'truth.failQuota') fail('真耗尽时只说 failQuota，不再补「数字可能不是最新」，实得：' + JSON.stringify(keysOf(staleExhausted)))
  // 模型未知仍第一优先：记事本里有失败也不能把「模型不知道」改口成「同步失败」。
  const modelWithSync = truth.budgetNoticeLines(refreshWith({
    id: 'gh-graphql', budgetKind: 'unknown', readKnown: false, offNetwork: false, reason: 'unsupported',
    sync: { lastFailAt: 1767221040000, lastFailKind: 'hard' },
  }))
  if (keysOf(modelWithSync).join(',') !== 'truth.budgetUnknownModel') fail('模型未知要压过后台同步失败（仍说 truth.budgetUnknownModel），实得：' + JSON.stringify(keysOf(modelWithSync)))
  // 形状不对的 sync（绕过宿主校验直接喂）不许猜类别：仍说中性的「还没同步上来」。
  const bogusSync = truth.budgetNoticeLines(refreshWith({
    id: 'gh-graphql', budgetKind: 'two-buckets', readKnown: false, offNetwork: false,
    sync: { lastFailAt: 0, lastFailKind: 'fatal' },
  }))
  if (keysOf(bogusSync).join(',') !== 'truth.budgetUnknown') fail('形状不对的 sync 不猜类别，应说 truth.budgetUnknown，实得：' + JSON.stringify(keysOf(bogusSync)))
  // #1833：列表状态行不再并入额度句；额度改由通知中心那一行按档位说，档位判据在这里量。
  const panel = truth.truthNoticeLines(withBackend({
    id: 'gh-graphql', budgetKind: 'two-buckets', readKnown: true, offNetwork: false,
    buckets: { graphql: { remaining: 4200, limit: 5000 }, rest: { remaining: 60, limit: 60 } },
  }), T1204)
  if (panel.length !== 0) fail('列表状态行不该再并入额度句（额度改由通知中心那一行说），实得：' + JSON.stringify(keysOf(panel)))
  const plentyView = truth.budgetTierViewOf(refreshWith({
    id: 'gh-graphql', budgetKind: 'two-buckets', readKnown: true, offNetwork: false,
    buckets: { graphql: { remaining: 4200, limit: 5000 }, rest: { remaining: 4500, limit: 5000 } },
  }))
  if (!plentyView || plentyView.tier !== 'plenty' || keysOf(plentyView.lines).join(',') !== 'truth.budgetGraphql,truth.budgetRest') fail('两桶都宽裕时额度档位该是 plenty 且带 GraphQL / REST 两个读数，实得：' + JSON.stringify(plentyView))
  const tightView = truth.budgetTierViewOf(refreshWith({
    id: 'gh-graphql', budgetKind: 'two-buckets', readKnown: true, offNetwork: false,
    buckets: { graphql: { remaining: 500, limit: 5000 }, rest: { remaining: 4500, limit: 5000 } },
  }))
  if (!tightView || tightView.tier !== 'tight') fail('读数进黄档时额度档位该是 tight，实得：' + JSON.stringify(tightView))
  const unknownView = truth.budgetTierViewOf(refreshWith({ id: 'gh-graphql', budgetKind: 'two-buckets', readKnown: false, offNetwork: false }))
  if (!unknownView || unknownView.tier !== 'unknown') fail('读数未知时额度档位该是 unknown（写「还没同步」，不编 0），实得：' + JSON.stringify(unknownView))
  const offView = truth.budgetTierViewOf(refreshWith({ id: 'backend-off', budgetKind: 'none', readKnown: true, offNetwork: true }))
  if (!offView || offView.tier !== 'off') fail('离网后端额度档位该是 off（不需要额度），实得：' + JSON.stringify(offView))
  const noneView = truth.budgetTierViewOf(refreshWith({ id: 'local', budgetKind: 'none', readKnown: true, offNetwork: false }))
  if (!noneView || noneView.tier !== 'none') fail('没有额度模型的后端档位该是 none，实得：' + JSON.stringify(noneView))
  if (truth.budgetTierViewOf(refreshWith(undefined)) !== null) fail('后端没声明额度时不该凭空给出一个档位')
  // #1833 复审修复：未知按行上的显式标记认（不按词条键猜），黄档「数字可能不是最新的」提醒句不算紧张。
  if (!unknownView || !unknownView.lines[0] || unknownView.lines[0].unknown !== true) fail('读数未知的行要带 unknown 机器标记（档位按标记认，新加一种未知原因不会漏判成充足）：' + JSON.stringify(unknownView))
  if (modelWithSync[0] && modelWithSync[0].unknown !== true) fail('模型未知的行也要带 unknown 标记：' + JSON.stringify(modelWithSync[0]))
  if (bogusSync[0] && bogusSync[0].unknown !== true) fail('形状不对的 sync 说「还没同步」时也要带 unknown 标记：' + JSON.stringify(bogusSync[0]))
  if (staleHard[2] && staleHard[2].unknown === true) fail('有旧读数时那句「数字可能不是最新」说的是读数过期、不是未知，不该带 unknown 标记（否则档位被算成未知）：' + JSON.stringify(staleHard[2]))
  const staleWarnView = truth.budgetTierViewOf(refreshWith({
    id: 'gh-graphql', budgetKind: 'two-buckets', readKnown: true, offNetwork: false,
    buckets: { graphql: { remaining: 4200, limit: 5000 }, rest: { remaining: 4500, limit: 5000 } },
    sync: { lastFailAt: 1767221040000, lastFailKind: 'hard' },
  }))
  if (!staleWarnView || staleWarnView.tier !== 'plenty') fail('黄档提醒句「数字可能不是最新的」不算紧张（读数本身是充足的，判成紧张会与展开后读数自相矛盾），档位该是 plenty，实得：' + JSON.stringify(staleWarnView))
  const staleWarnLine = (staleWarnView && staleWarnView.lines[2]) || {}
  if (staleWarnLine.key !== 'truth.budgetStaleSyncFailedHard' || staleWarnLine.tone !== 'yellow' || staleWarnLine.unknown === true) fail('紧邻读数的黄档提醒句仍是黄档提醒、不带 unknown 标记，实得：' + JSON.stringify(staleWarnLine))
  const hardUnknownView = truth.budgetTierViewOf(refreshWith({
    id: 'gh-graphql', budgetKind: 'two-buckets', readKnown: false, offNetwork: false,
    sync: { lastFailAt: 1767221040000, lastFailKind: 'hard' },
  }))
  if (!hardUnknownView || hardUnknownView.tier !== 'unknown') fail('读数未知且同步硬失败：档位该是 unknown（按标记认），不能被黄档提醒句算成紧张，实得：' + JSON.stringify(hardUnknownView))
  const nearYellowView = truth.budgetTierViewOf(refreshWith({
    id: 'gh-graphql', budgetKind: 'two-buckets', readKnown: true, offNetwork: false,
    buckets: { graphql: { remaining: 1000, limit: 5000 }, rest: { remaining: 4200, limit: 5000 } },
  }))
  if (!nearYellowView || nearYellowView.tier !== 'tight') fail('黄档读数本身仍算紧张（带剩余量的读数是「快用完了」的真读数，不能因为只是黄档就放过），实得：' + JSON.stringify(nearYellowView))
})()
console.log('#715 诚实显示门禁（新鲜度 / 失败 / 降级）')
if (failed) {
  problems.forEach(function (p) { console.log('  FAIL ' + p) })
  console.log('\n存在失败')
  process.exit(1)
}
console.log('  PASS 新鲜度取快照取数时刻，5 分钟黄 / 30 分钟红（阈值来自 budget.ts）')
console.log('  PASS 头部那个小时间标签：四档相对时间（刚刚 / N 分钟前 / N 小时前 / N 天前）都算对，精确时刻只在悬停提示里，没快照时一句话都不画')
console.log('  PASS 当前失败由面板头部小标识表达（三种原因各一句悬停说明，健康态不画），列表状态行不再出现失败句')
console.log('  PASS T3 两句有读取点（自动刷新已暂停 / 未在刷新（同时活跃上限 2））')
console.log('  PASS 降档说出延迟承诺（数据可能落后 ' + Math.round(PROBE_INTERVAL_YELLOW_MS / 60000) + ' 分钟）')
console.log('  PASS 推迟说「有更新，已推后」；写入窗口内/外判得对，那批词条中英两面都在')
console.log('  PASS 降级标记到得了界面：上游真降级时回包带 \'rest\'、没降级时是 null')
console.log('  PASS 面板额度读数按后端声明说话（两桶 / 仅请求 / 离网 / 未知），未知时不出现 0 与红档；后台同步失败按 hard / soft 说清原因（读数未知说有旧读数都说得出来），模型未知仍优先')
console.log('  PASS 额度档位视图（充足 / 紧张 / 未知 / 离网 / 没有额度）与列表行分离：列表行不再并入额度句；紧张只看读数本身（黄档提醒句不算），未知按行上标记认')
console.log('\n全部通过')
