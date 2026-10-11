// tests/verify-955-alignment.js —— #955 对齐补欠账门禁（948 图第七批）
// 用法：在插件根目录执行 node tests/verify-955-alignment.js，可独立运行。
//
// 只留行为断言：把共享层 src/shared/feedback-map.js 加载起来，看它导出的三张对账表
// （FB_ICON_SIZES / FB_DURATIONS / FB_FAIL_RED_PATHS）在不在、长得对不对——条数够、
// 每条都写明文件与取舍理由、四档都有条目、没有真实数的那几条写明原因。
//
// 原来那一整批「读源码文本、断言某个字符串/色值/时长在不在、出现几次」的检查已删：
// 断言对象是手写源码文件的文本，等价重构（换写法、搬文件、改注释）就会误报。
const path = require('path')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg, detail) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg + (ok ? '' : (detail ? ' — ' + String(detail).slice(0, 300) : ''))); if (!ok) failed = true }

async function main() {
  console.log('948 第七批门禁：对齐补欠账（#955，只留行为断言）')
  const mod = await import(pathToFileURL(path.join(ROOT, 'src/shared/feedback-map.js')).href)

  // —— 1. 结果三图标尺寸表：条目在、条数够 ——
  const sizes = mod.FB_ICON_SIZES
  check(Array.isArray(sizes) && sizes.length >= 4, '结果三图标尺寸表存在（至少四处落点）', String(sizes && sizes.length))

  // —— 2. 失败红按路径逐处对齐，不设一个全局硬值 ——
  const reds = mod.FB_FAIL_RED_PATHS
  check(Array.isArray(reds) && reds.length >= 8, '失败红路径清单存在（至少八条）', String(reds && reds.length))
  check(typeof mod.FB_FAIL_RED === 'undefined' && typeof mod.FAIL_RED === 'undefined', '共享层不导出失败红全局常量（红按路径取，不设一个全局硬值）')
  const shaped = reds.filter((r) => typeof r.file === 'string' && Array.isArray(r.colors) && r.colors.length > 0 && typeof r.note === 'string' && r.note.length > 5)
  check(shaped.length === reds.length, '清单每一条都写明文件、色值与取舍理由（逐处对齐，不是一张色卡）', reds.filter((r) => shaped.indexOf(r) === -1).map((r) => r.path).join(','))

  // —— 3. 演示秒数来自真实耗时分布表：条数、分档、覆盖 ——
  const durs = mod.FB_DURATIONS
  check(Array.isArray(durs) && durs.length >= 12, '演示秒数表存在（至少十二条）', String(durs && durs.length))
  const TIERS = ['instant', 'short', 'medium', 'long']
  const badTier = durs.filter((d) => TIERS.indexOf(d.tier) === -1)
  check(badTier.length === 0, '每条都归到四档之一（瞬间/短/中长/长）', badTier.map((d) => d.fx).join(','))
  const tiersUsed = {}
  durs.forEach((d) => { tiersUsed[d.tier] = true })
  check(TIERS.every((t) => tiersUsed[t] === true), '四档都有条目（表覆盖全档，不挑着写）', TIERS.filter((t) => !tiersUsed[t]).join(','))
  // 「不编数字」：没有真实数的那几条必须显式写 null 并说明原因
  const nullRows = durs.filter((d) => d.css === undefined && d.js === null)
  check(nullRows.length >= 3 && nullRows.every((d) => typeof d.why === 'string' && d.why.length > 10), '没有写死秒数的效果都写明原因（不编数字）', nullRows.map((d) => d.fx).join(','))

  if (failed) { console.log('\n存在失败（共 ' + total + ' 项）'); process.exit(1) }
  console.log('\n全部通过 · 948 第七批门禁（#955，共 ' + total + ' 项）')
}

main().catch((e) => { console.error('门禁执行失败', e); process.exit(1) })
