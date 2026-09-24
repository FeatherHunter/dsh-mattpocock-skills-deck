/*
 * verify-rest-fallback-reason.js — 降级横幅「按原因选句」的门禁（#734）
 * 用法: node tests/verify-rest-fallback-reason.js
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
const ROOT = path.join(__dirname, '..')
let failed = false
const check = function (cond, msg) {
  if (cond) console.log('PASS ' + msg)
  else { failed = true; console.log('FAIL ' + msg) }
  return !!cond
}

// ── 一、原因分类：限流与非配额 403 分得开 ──
const reasonSrc = fs.readFileSync(path.join(ROOT, 'src/host/tracker/backends/github/fallback-reason.js'), 'utf8')
let reasonMod = null
try {
  const body = reasonSrc.replace(/^[ \t]*export[ \t]+default[^\n]*$/gm, '').replace(/^[ \t]*export[ \t]+/gm, '')
  reasonMod = new Function(body + '\n;return { pickFallbackReason: (typeof pickFallbackReason !== "undefined" ? pickFallbackReason : null) };')()
} catch (e) {
  console.log('FAIL 求值 fallback-reason.js 拿不到 pickFallbackReason：' + String(e && e.message))
}
if (!reasonMod || typeof reasonMod.pickFallbackReason !== 'function') {
  console.log('FAIL 没有 pickFallbackReason 这个分类函数')
  process.exit(1)
}
const pick = reasonMod.pickFallbackReason
check(pick({ message: 'API rate limit exceeded for user' }) === 'rate-limit', '限流文案 → rate-limit（实测 ' + pick({ message: 'API rate limit exceeded for user' }) + '）')
// 反证的核心现场：非配额的 403（权限类，不带限流文案）必须不算限流，否则界面就会误报配额耗尽。
check(pick({ message: '403 Forbidden: Resource protected by organization SAML enforcement' }) !== 'rate-limit',
  '非配额 403（权限类）不算限流（实测 ' + pick({ message: '403 Forbidden: Resource protected by organization SAML enforcement' }) + '）')
check(pick({ message: 'unexpected EOF' }) !== 'rate-limit', 'EOF 不算限流（实测 ' + pick({ message: 'unexpected EOF' }) + '）')

// ── 二、宿主透传：粗原因三档随 fallback 同生同灭 ──
const issuesSrc = fs.readFileSync(path.join(ROOT, 'src/host/tracker/backends/github/issues.js'), 'utf8')
check(/fallbackReason/.test(issuesSrc), 'issues.js 把降级原因随 fallback 交出来（fallbackReason）')
check(/pickFallbackReason\(firstRestCause/.test(issuesSrc), 'issues.js 的原因是按这次失败现场算的（firstRestCause），不是恒写一句')
check(/fbReason\s*===\s*'rate-limit'\s*\?\s*'quota'\s*:\s*'other'/.test(issuesSrc),
  'issues.js 只把真限流记成 quota，其它一律记成 other（不真耗尽不许说耗尽）')
check(/fallback:\s*'rest'[^}]*fallbackReason/.test(issuesSrc) || /fallbackReason[^}]*fallback:\s*'rest'/.test(issuesSrc),
  'issues.js 那次 REST 降级同时带 fallback 与 fallbackReason（同一处返回，不各说各的）')
// 旧判据一处不动：裸 403 照旧走老路，本票不碰它（动之前先拿证据，见 #734 补充口径第四节）。
check(/return \/rate\\s\*limit\|ratelimit\|403\//.test(fs.readFileSync(path.join(ROOT, 'src/host/index.js'), 'utf8')),
  '旧判据 isRateLimitError 原样未动（本票不碰它）')
const snapSrc = fs.readFileSync(path.join(ROOT, 'src/host/tracker/snapshot.js'), 'utf8')
check(/fallbackReason/.test(snapSrc), 'snapshot.js 快照上带着降级原因（fallbackReason）')
check(/snapshot\.fallbackReason\s*=\s*listFallback\s*===\s*'rest'\s*\?\s*\(listFallbackReason\s*\|\|\s*null\)\s*:\s*null/.test(snapSrc),
  '无降级时原因必须为空（恢复不清就红：fallback 不是 rest 时 fallbackReason 置 null）')
const envSrc = fs.readFileSync(path.join(ROOT, 'src/host/snapshotEnvelope.js'), 'utf8')
check(/fallbackReason/.test(envSrc), 'snapshotEnvelope.js 信封原样透传降级原因')
check(/o\.fallback\s*===\s*'rest'\s*\?\s*\(o\.fallbackReason\s*\|\|\s*null\)\s*:\s*null/.test(envSrc),
  '信封里无降级时原因必须为空（与快照同一条规则）')
const sessSrc = fs.readFileSync(path.join(ROOT, 'src/host/sessionSnapshot.js'), 'utf8')
check((sessSrc.match(/fallbackReason/g) || []).length >= 2, 'sessionSnapshot.js 两条快照分支都透传降级原因（实测 ' + ((sessSrc.match(/fallbackReason/g) || []).length) + ' 处）')

// ── 三、界面选句：只有 quota 才许提配额 ──
const tsrc = fs.readFileSync(path.join(ROOT, 'src/client/views/shared/truthLines.js'), 'utf8')
let mod = null
try {
  const body = tsrc.replace(/^[ \t]*export[ \t]+/gm, '')
  mod = new Function('freshnessLevel', 'PATCH_MERGE_WINDOW_MS', 'lagPromiseFor', 'PROBE_INTERVAL_MS', 'idOfParts',
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
const localeAll = ['locale-flow.js', 'locale-word.js', 'locale-pages.js', 'locale-labels.js', 'locale-panel.js']
  .map(function (f) { try { return fs.readFileSync(path.join(ROOT, 'src/client/kernel', f), 'utf8') } catch (e) { return '' } })
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
  if (!fs.existsSync(p)) { check(false, rel + ' 不存在（先跑 node scripts/build.mjs）'); return }
  const built = fs.readFileSync(p, 'utf8')
  check(built.indexOf('list.restFallbackNonQuota') >= 0, rel + ' 里带着新鲜中性句（产物按源码重建过才生效）')
  check(built.indexOf('list.restFallbackStaleNonQuota') >= 0, rel + ' 里带着上次中性句（产物按源码重建过才生效）')
  check(/fallbackReason/.test(built), rel + ' 里带着降级原因（fallbackReason）')
})

console.log(failed ? '\nFAIL — 降级按原因选句门禁未通过' : '\n全部通过 — 只有 quota 才说配额耗尽，非配额 403 不再误报（#734 门禁生效）')
process.exit(failed ? 1 : 0)
