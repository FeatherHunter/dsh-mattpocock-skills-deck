/*
 * verify-rest-fallback-banner.js — 降级横幅「该不该画、画哪一句」的门禁（2026-09-24）
 * 用法: node tests/verify-rest-fallback-banner.js
 *
 * 这一条盯的是一件具体的事：那条「GraphQL 配额已耗尽，已切换 REST 通道」的横幅，此前只要快照里
 * 带着 `fallback:'rest'` 就画，而那个标记是**那一次构建**留下的历史事实，会随快照被缓存、被反复取用
 * —— 于是横幅在某些工作区出现过就常驻（维护者 2026-09-24 反馈）。
 *
 * 判据只有一份，在 src/client/views/shared/truthLines.js 的 restFallbackView（纯函数）。
 * 本门禁分三段：
 *   一、纯函数行为：不画 / 照旧说「已切换」/ 超过一小时改口成「上次取数走的」/ 时刻缺失也不冒充现在 /
 *       本次会话关掉就不画、但**新的一次降级要能重新出现**；
 *   二、界面接线：ListTab 用的是这个纯函数，并且**不给宿主的标记赋值**（那条静态规矩在 verify-visible-truth 里，这里再钉一遍）；
 *   三、词条与产物：两个语言都有那句新话，且构建产物里带着它（产物不重建就是没生效）。
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

// ── 一、纯函数行为 ──
const tsrc = fs.readFileSync(path.join(ROOT, 'src/client/views/shared/truthLines.js'), 'utf8')
let mod = null
try {
  const body = tsrc.replace(/^[ \t]*export[ \t]+/gm, '')
  mod = new Function('freshnessLevel', 'PATCH_MERGE_WINDOW_MS', 'lagPromiseFor', 'PROBE_INTERVAL_MS', 'idOfParts',
    body + '\n;return { restFallbackView: restFallbackView, REST_FALLBACK_STALE_MS: REST_FALLBACK_STALE_MS };')(
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
const st = function (fallback, fallbackAt) { return { snapshot: { fallback: fallback, fallbackAt: fallbackAt } } }

check(view({ snapshot: null }, NOW, 0) === null, '没有快照 → 一个字都不画')
check(view(st(null, null), NOW, 0) === null, '快照里没有降级标记 → 不画')
check(view(st('graphql', NOW), NOW, 0) === null, '标记不是 rest → 不画')

const fresh = view(st('rest', NOW - 5 * MIN), NOW, 0)
check(!!fresh && fresh.key === 'list.restFallback' && fresh.stale === false, '五分钟前的降级 → 照旧说「已切换 REST 通道」（实测 ' + JSON.stringify(fresh) + '）')
check(!!fresh && fresh.minutes === 5, '带着分钟数 5（界面要能说「N 分钟前」）')

const stale = view(st('rest', NOW - 2 * 60 * MIN), NOW, 0)
check(!!stale && stale.key === 'list.restFallbackStale' && stale.stale === true, '两小时前的降级 → 改口成「上次取数走的 REST 通道（N 分钟前）」（实测 ' + JSON.stringify(stale) + '）')
check(!!stale && stale.minutes === 120, '两小时 → 120 分钟（实测 ' + (stale && stale.minutes) + '）')

const noAt = view(st('rest', null), NOW, 0)
check(!!noAt && noAt.stale === true && noAt.key === 'list.restFallbackStale', '宿主没给时刻 → 不冒充现在，按「上次」那一句说（实测 ' + JSON.stringify(noAt) + '）')

check(view(st('rest', NOW - 5 * MIN), NOW, NOW - 5 * MIN) === null, '本次会话关掉这一档 → 不画')
const again = view(st('rest', NOW - 1 * MIN), NOW, NOW - 5 * MIN)
check(!!again && again.key === 'list.restFallback', '新的一次降级（时刻更晚）→ 横幅重新出现（关掉的记的是「哪一次」）')

// ── 二、界面接线 ──
// 2026-09-24：横幅本体从 ListTab.js 搬进 views/shared/RestFallbackBanner.js（ListTab 贴着 350 行上限）。
//   判据跟着**真实落点**走：判据仍要在界面代码里被调用、词条仍要被画出来，另加一条「ListTab 真的把它挂上去」
//   —— 只查组件本身会因为「组件写了没人用」而变成假绿。
const bannerSrc = fs.readFileSync(path.join(ROOT, 'src/client/views/shared/RestFallbackBanner.js'), 'utf8')
const listSrc = fs.readFileSync(path.join(ROOT, 'src/client/views/ListTab.js'), 'utf8')
check(bannerSrc.indexOf('restFallbackView(') >= 0, '降级横幅走的是那个纯函数判据（RestFallbackBanner.js 里调它）')
check(bannerSrc.indexOf('data-rest-fallback-dismiss') >= 0, '横幅上有一颗「本次会话不再提示」的关闭钮')
check(bannerSrc.indexOf('data-rest-fallback') >= 0, '横幅带着它与哪一档对应（now / stale）的标记，可被真机量到')
check(/h\(RestFallbackBanner,\s*\{[^}]*st:\s*st/.test(listSrc), 'ListTab 把这条横幅挂上去了（组件写了没人用同样是假绿）')
const assign = /(snapshot|snap)\s*\.\s*fallback\s*=/.test(bannerSrc + listSrc)
check(!assign, '界面不给宿主的降级标记赋值（承认事实、不制造事实）')

// ── 三、词条与产物 ──
// 2026-09-24：这两条词条随横幅本体一起从 locale-flow.js 搬进 locale-word.js（键名与文案一字未改），
//   所以这里按**两个文件的合体**数「中英各一条」——数法没变，只是不再假定它们住在哪个片段里。
const locale = fs.readFileSync(path.join(ROOT, 'src/client/kernel/locale-flow.js'), 'utf8') +
  fs.readFileSync(path.join(ROOT, 'src/client/kernel/locale-word.js'), 'utf8')
const nKey = (locale.match(/'list\.restFallbackStale'/g) || []).length
const nDis = (locale.match(/'list\.restFallbackDismiss'/g) || []).length
check(nKey === 2, '「上次取数走的 REST…」两种语言各一条（实测 ' + nKey + '）')
check(nDis === 2, '关闭钮的无障碍名两种语言各一条（实测 ' + nDis + '）')
;['client.js', 'package/lib/client.js'].forEach(function (rel) {
  const p = path.join(ROOT, rel)
  if (!fs.existsSync(p)) { check(false, rel + ' 不存在（先跑 node scripts/build.mjs）'); return }
  const built = fs.readFileSync(p, 'utf8')
  check(built.indexOf('list.restFallbackStale') >= 0, rel + ' 里带着新那句（产物按源码重建过才生效）')
  check(built.indexOf('data-rest-fallback-dismiss') >= 0, rel + ' 里带着关闭钮')
  check(/fallbackAt/.test(built), rel + ' 里带着宿主给的降级时刻（fallbackAt）')
})

console.log(failed ? '\nFAIL — 降级横幅门禁未通过' : '\n全部通过 — 降级横幅「画不画、说哪句」的判据唯一且可测（降级横幅门禁生效）')
process.exit(failed ? 1 : 0)
