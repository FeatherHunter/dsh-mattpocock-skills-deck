/*
 * verify-rest-fallback-reason.ts — 降级横幅「按原因选句」的门禁（#734）
 * 用法: 在插件根目录执行 node tests/verify-rest-fallback-reason.ts
 *
 * 写法说明：本文件是 CommonJS 写法的 TypeScript（用 require 与 __dirname，不写 import 语句），
 * Node 自己剥离类型就能执行，不需要装载钩子。这正是全仓最终只留 TypeScript 的路径：
 * 测试按单元改名成 .ts，行为一行不变，旧语言棘轮跟着缩一条（见 AGENTS.md「TypeScript 优先」）。
 *
 * 这一条盯的是 #734 的硬规矩：不真耗尽，不许说「耗尽」。
 * 面板新链路里任何 GraphQL 失败都会掉到 REST 并回 `fallback:'rest'`，而横幅的判据
 * （snapshot.js 的 `fallback === 'rest'`）根本不是配额检查 —— 所以它会在账号还剩
 * 4983 点时照样说「配额已耗尽」。旧判据 isRateLimitError 更是裸 403 也算限流。
 *
 * 修法（判据 → 原因 → 文案 → 门禁）：
 *   原因住在宿主侧：快照除 fallback / fallbackAt 之外再带 fallbackReason，
 *   取值 quota（真配额耗尽）/ other（其它原因走了 REST）/ 未知=null（判不出来）；
 *   界面只读：只有 quota 才说「配额已耗尽」，other 与未知一律说中性那句，
 *   中性句里一个字不许提配额。旧判据与额度常量一处不动。
 *
 * 反证：造一个非配额的 403（权限类，不带限流文案）→ 那句话里不许出现「配额」二字；
 *   把选句改坏（例如所有原因都说配额句）→ 本门禁当场变红。
 */
const fs = require('fs')
const path = require('path')
// 引真源的规矩：能直接引模块就别把文件文本当函数体求值 —— 整份文本里只要出现 import、interface
// 或类型标注，vm.compileFunction 就当场抛错（#1167 从 #1147 起一直红着，就是这个原因）。
// 文本求值只留给「必须注入替身」的那种文件：下面 truthLines.js 那一段靠参数名拿五个替身，继续走 compileFn。
// 后半段（truthLines）仍然走共用求值入口；说明符写成显式 .ts，所以这份门禁挂着钩子跑、裸着跑都行
// （共用入口只引 node:vm，没有仓库内的依赖；写 .js 的调用方则必须挂 scripts/ts-hook.mts）。
const { compileFn } = require('./lib/eval-probe.ts')
// 中央时间真值：过期阈值只住 config/*.yaml，这里读同一份导出来预埋，不在测试里写第二份数字。
const centralTime = require('../src/shared/time-config/values.js')
globalThis.REST_FALLBACK_STALE_MS = centralTime.REST_FALLBACK_STALE_MS
// 取源走共用入口（#1207 立）：按 .js 路径直接读，读到的会是真源旁边那份构建产物。
const { sourceText } = require('./lib/source-text.ts')
const ROOT = path.join(__dirname, '..')
let failed = false
const check = function (cond, msg) {
  if (cond) console.log('PASS ' + msg)
  else { failed = true; console.log('FAIL ' + msg) }
  return !!cond
}

// ── 一、原因分类：限流与非配额 403 分得开 ──
// 直接引真源模块，不再读文本求值。说明符写显式 .ts：这份真源今天只有 import type（加载时会被剥掉），
// 所以人手裸跑、链上挂钩子跑，两种跑法都能跑。哪天它长出运行时 import 或值导出以外的语法，
// 就把说明符改回 .js —— 本门禁已在 package.json 的 verify 链上，链会自动挂 scripts/ts-hook.mts
// （docs/agents/verification.md 第三节）；那时人手裸跑要自己加 --import ./scripts/ts-hook.mts。
let pick = null
try {
  pick = require('../src/tracker/rooms/github/fallback-reason.ts').pickFallbackReason
} catch (e) {
  console.log('FAIL 引真源 fallback-reason.ts 拿不到 pickFallbackReason：' + String(e && e.message))
}
if (typeof pick !== 'function') {
  console.log('FAIL 没有 pickFallbackReason 这个分类函数')
  process.exit(1)
}
check(pick({ message: 'API rate limit exceeded for user' }) === 'rate-limit', '限流文案 → rate-limit（实测 ' + pick({ message: 'API rate limit exceeded for user' }) + '）')
// 反证的核心现场：非配额的 403（权限类，不带限流文案）必须不算限流，否则界面就会误报配额耗尽。
check(pick({ message: '403 Forbidden: Resource protected by organization SAML enforcement' }) !== 'rate-limit',
  '非配额 403（权限类）不算限流（实测 ' + pick({ message: '403 Forbidden: Resource protected by organization SAML enforcement' }) + '）')
check(pick({ message: 'unexpected EOF' }) !== 'rate-limit', 'EOF 不算限流（实测 ' + pick({ message: 'unexpected EOF' }) + '）')


// ── 三、界面选句：只有 quota 才许提配额 ──
const tsrc = fs.readFileSync(path.join(ROOT, 'src/client/views/shared/truthLines.js'), 'utf8')
let mod = null
try {
  const body = tsrc.replace(/^[ \t]*export[ \t]+/gm, '').split('\n').filter((l) => !/^\s*import\s.*time-config\/values\.js/.test(l)).join('\n')
  // 中央 import 在 compileFn 函数体里非法，求值前整行剥掉（闭包里它由时间片段提供，门禁里走上面的全局预埋）。
  // 本处走 compileFn：五个依赖本来就在参数表里，照旧按参数名传进去。
  mod = compileFn(['freshnessLevel', 'PATCH_MERGE_WINDOW_MS', 'lagPromiseFor', 'PROBE_INTERVAL_MS', 'idOfParts'],
    body + '\n;return { restFallbackView: restFallbackView };')(
    function () { return 'fresh' }, 10000, function () { return { maxLagMs: 0 } }, 90000, function () { return 'k' })
} catch (e) {
  console.log('FAIL 求值 truthLines.js 拿不到 restFallbackView：' + String(e && e.message))
}
if (!mod || typeof mod.restFallbackView !== 'function') {
  console.log('FAIL 没有 restFallbackView 这个判据函数')
  process.exit(1)
}
const view = mod.restFallbackView
const MIN = 60 * 1000
const NOW = 1760000000000
const stReason = function (at, reason) {
  const snap = { fallback: 'rest', fallbackAt: at }
  if (reason !== undefined) snap.fallbackReason = reason
  return { snapshot: snap }
}
const freshQuota = view(stReason(NOW - 5 * MIN, 'quota'), NOW, 0)
check(!!freshQuota && freshQuota.key === 'list.restFallback', '新鲜的 quota 降级 → 说「配额已耗尽」（实测 ' + JSON.stringify(freshQuota) + '）')
// 反证：非配额 403 落到快照里是 other，新鲜时必须说中性那句。
const freshOther = view(stReason(NOW - 5 * MIN, 'other'), NOW, 0)
check(!!freshOther && freshOther.key === 'list.restFallbackNonQuota', '新鲜的 other 降级（含非配额 403）→ 说中性那句，不许说配额耗尽（实测 ' + JSON.stringify(freshOther) + '）')
const freshMissing = view(stReason(NOW - 5 * MIN, undefined), NOW, 0)
check(!!freshMissing && freshMissing.key === 'list.restFallbackNonQuota', '老快照缺原因 → 按未知说中性那句，绝不冒充配额耗尽（实测 ' + JSON.stringify(freshMissing) + '）')
const freshNull = view(stReason(NOW - 5 * MIN, null), NOW, 0)
check(!!freshNull && freshNull.key === 'list.restFallbackNonQuota', '原因显式为空 → 同样说中性那句（实测 ' + JSON.stringify(freshNull) + '）')
const staleQuota = view(stReason(NOW - 2 * 60 * MIN, 'quota'), NOW, 0)
check(!!staleQuota && staleQuota.key === 'list.restFallbackStale', '超一小时的 quota 降级 → 改口「上次」（实测 ' + JSON.stringify(staleQuota) + '）')
const staleOther = view(stReason(NOW - 2 * 60 * MIN, 'other'), NOW, 0)
check(!!staleOther && staleOther.key === 'list.restFallbackStaleNonQuota', '超一小时的 other 降级 → 同样改口「上次」的中性句（实测 ' + JSON.stringify(staleOther) + '）')
const staleMissing = view(stReason(null, undefined), NOW, 0)
check(!!staleMissing && staleMissing.key === 'list.restFallbackStaleNonQuota', '宿主没给时刻 → 按未知说中性那句，不冒充现在也不提配额（实测 ' + JSON.stringify(staleMissing) + '）')
check(view({ snapshot: { fallback: null, fallbackAt: null, fallbackReason: null } }, NOW, 0) === null, '恢复后的干净快照 → 一个字都不画（回切不清就红）')

// ── 四、词条与产物：中性句里一个字不许提配额，配额句一字不动 ──
// #1209：locale-pages 的真源从手写 .js 转成了 .ts，按 .js 路径直接读会读到构建产物
//   （pixel-ts 写在真源旁边那份，字符串引号统一变双引号），下面那条只认单引号的正则会一条都取不到。
//   所以取源走共用入口拿真源文本；正则仍只认单引号 —— 真源今天就是单引号写的，判据本身不放松。
const localeAll = ['locale-flow.js', 'locale-word.js', 'locale-pages.js', 'locale-labels.js', 'locale-panel.js']
  .map(function (f) { try { return sourceText('src/client/kernel/' + f) } catch (e) { return '' } })
  .join('\n')
const textsOf = function (k) {
  return Array.from(localeAll.matchAll(new RegExp("'" + k.replace(/\./g, '\\.') + "':\\s*'([^']*)'", 'g')))
    .map(function (m) { return m[1] })
}
;['list.restFallbackNonQuota', 'list.restFallbackStaleNonQuota'].forEach(function (k) {
  const texts = textsOf(k)
  check(texts.length === 2, '词条 ' + k + ' 中英各一条（实测 ' + texts.length + ' 条）')
  const withQuota = texts.filter(function (s) { return /配额|quota/i.test(s) })
  check(texts.length === 2 && withQuota.length === 0, '词条 ' + k + ' 一个字不许提配额（实测 ' + JSON.stringify(texts) + '）')
  const badTri = texts.filter(function (s) { return /[⚠️]/.test(s) })
  check(texts.length === 2 && badTri.length === 0, '词条 ' + k + ' 没有字符版警告三角（三角由画面画一次）')
})
// 配额句是上一批的既有文案，本票一字不动（只查存在，不查内容）。
check(textsOf('list.restFallback').length === 2, '配额句 list.restFallback 中英仍在（本票不动它）')
check(textsOf('list.restFallbackStale').length === 2, '配额句 list.restFallbackStale 中英仍在（本票不动它）')
;['client.js', 'package/lib/client.js'].forEach(function (rel) {
  const p = path.join(ROOT, rel)
  if (!fs.existsSync(p)) { check(false, rel + ' 不存在（先跑 node scripts/build.mts）'); return }
  const built = fs.readFileSync(p, 'utf8')
  check(built.indexOf('list.restFallbackNonQuota') >= 0, rel + ' 里带着新鲜中性句（产物按源码重建过才生效）')
  check(built.indexOf('list.restFallbackStaleNonQuota') >= 0, rel + ' 里带着上次中性句（产物按源码重建过才生效）')
  check(/fallbackReason/.test(built), rel + ' 里带着降级原因（fallbackReason）')
})

console.log(failed ? '\nFAIL — 降级按原因选句门禁未通过' : '\n全部通过 — 只有 quota 才说配额耗尽，非配额 403 不再误报（#734 门禁生效）')
process.exit(failed ? 1 : 0)
