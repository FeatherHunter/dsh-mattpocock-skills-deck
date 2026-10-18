// tests/verify-948-feedback-map.ts —— #949 瞬间底座与组合映射门禁（948 图首批）
// 用法：在插件根目录执行 node --import ./scripts/ts-hook.mts tests/verify-948-feedback-map.ts。
// 说明符 src/shared/feedback-map.js 要保持 .js：真源已是同名 .ts，这里直读构建产物
// （普通的 file:// 导入，不走装载钩子），产物与原来行为一致，所以本文件仍不用改。
//
// 盯住 #949 验收里的组合规矩（样式类的几条随「读源码文本钉形状」门禁一起删掉了，
// 这里只留跑起来能验的部分）：
//   1. 等待加代价加形状到反馈组合的映射是全函数，31 种全部分配、无遗漏，人已否的 6 种不在内。
// 外加三条组合铁律：高危险不用弹跳扩散自动消失气泡；小图标不用缩小下沉倾斜；
// 无真实时间与真实进度不显示倒计时与百分比；同一时刻只有一个主力过程效果。
const path = require('path')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok: unknown, msg: string, detail?: unknown): void => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg + (ok ? '' : (detail ? ' — ' + String(detail).slice(0, 400) : ''))); if (!ok) failed = true }

async function main() {
  console.log('948 首批门禁：组合映射全函数 + 瞬间底座（#949）')
  const mod = await import(pathToFileURL(path.join(ROOT, 'src/shared/feedback-map.js')).href)

  // —— 1. 31 种全部分配，6 种已否不在内 ——
  const denied = ['A9', 'A10', 'B2', 'B8', 'B10', 'C13']
  const catalog = mod.FEEDBACK_31 || []
  check(Array.isArray(catalog) && catalog.length === 31, '31 种反馈全部分配（目录长 31）', '实际 ' + catalog.length)
  denied.forEach((k) => { check(!catalog.includes(k), '人已否 ' + k + ' 不在目录内') })
  const allocation = mod.ALLOCATION || {}
  const allocated = Object.values(allocation).flat()
  const missing = catalog.filter((k) => !allocated.includes(k))
  const extra = allocated.filter((k) => !catalog.includes(k))
  check(missing.length === 0, '每一种都有归宿（无遗漏）', missing.join(','))
  check(extra.length === 0, '归宿里没有目录外的东西', extra.join(','))

  // —— 2. 映射是全函数：等待 3 档 × 代价 3 档 × 形状 5 种都有唯一组合 ——
  const waits = ['instant', 'short', 'long']
  const costs = ['low', 'medium', 'high']
  const shapes = ['large-button', 'small-icon', 'pill', 'row', 'wide-button']
  let holes = []
  waits.forEach((w) => { costs.forEach((c) => { shapes.forEach((s) => {
    let r = null
    try { r = mod.feedbackComboOf({ wait: w, cost: c, shape: s }) } catch (e) { r = null }
    if (!r || typeof r.cls === 'undefined' || !r.moment || typeof r.process === 'undefined' || !r.result) holes.push(w + '+' + c + '+' + s)
  }) }) })
  check(holes.length === 0, '映射全函数（3×3×5 共 45 格格格有主）', holes.slice(0, 5).join(','))
  // 非法输入诚实失败，不猜默认值
  let threw = false
  try { mod.feedbackComboOf({ wait: 'nope', cost: 'low', shape: 'pill' }) } catch (e) { threw = true }
  check(threw, '非法等待档位诚实抛错（不猜默认值）')

  // —— 3. 高危险不用轻佻效果 ——
  const danger = mod.feedbackComboOf({ wait: 'short', cost: 'high', shape: 'large-button' })
  const dangerText = JSON.stringify(danger)
  check(danger.cls === 4, '高代价一律进第 4 类（不论等待）')
  ;['bounce', 'ring-diffuse', 'auto-bubble', 'C7', 'C12', 'C10'].forEach((k) => {
    check(!dangerText.includes(k), '高危险组合里没有 ' + k)
  })

  // —— 4. 小图标不变形 ——
  const iconCombo = mod.feedbackComboOf({ wait: 'instant', cost: 'low', shape: 'small-icon' })
  const iconText = JSON.stringify(iconCombo)
  ;['shrink', 'sink', 'tilt', 'A4', 'A5', 'A11'].forEach((k) => {
    check(!iconText.includes(k), '小图标组合里没有 ' + k)
  })
  check(iconText.includes('ring-out') || iconText.includes('A12'), '小图标靠外扩细环确认')

  // —— 5. 窄按钮不换字，结果换字只给宽按钮 ——
  const wide = mod.feedbackComboOf({ wait: 'short', cost: 'medium', shape: 'wide-button' })
  const narrow = mod.feedbackComboOf({ wait: 'short', cost: 'medium', shape: 'small-icon' })
  check(JSON.stringify(wide).includes('result-text') || JSON.stringify(wide).includes('C11'), '宽按钮允许结果换字')
  check(!JSON.stringify(narrow).includes('result-text'), '小图标不换结果文字')

  // —— 6. 无真实数不显示数字 ——
  const noNum = mod.feedbackComboOf({ wait: 'long', cost: 'medium', shape: 'wide-button', hasRealTime: false, hasRealProgress: false })
  check(!JSON.stringify(noNum).includes('countdown'), '无真实时间不显示倒计时')
  check(!JSON.stringify(noNum).includes('percent'), '无真实进度不显示百分比')
  const withReal = mod.feedbackComboOf({ wait: 'long', cost: 'medium', shape: 'wide-button', hasRealTime: true, hasRealProgress: true })
  check(JSON.stringify(withReal).includes('countdown'), '有真实时间才给倒计时')
  check(JSON.stringify(withReal).includes('percent'), '有真实进度才给百分比')

  // —— 7. 同一时刻只有一个主力过程效果 ——
  let doubles = []
  waits.forEach((w) => { costs.forEach((c) => { shapes.forEach((s) => {
    const r = mod.feedbackComboOf({ wait: w, cost: c, shape: s, hasRealTime: true, hasRealProgress: true })
    if (Array.isArray(r.process)) doubles.push(w + '+' + c + '+' + s)
  }) }) })
  check(doubles.length === 0, '过程主力唯一（process 是单值，不是数组）', doubles.slice(0, 3).join(','))

  if (failed) { console.log('\n存在失败（共 ' + total + ' 项）'); process.exit(1) }
  console.log('\n全部通过 · 948 首批门禁（#949，共 ' + total + ' 项）')
}

main().catch((e) => { console.error('门禁执行失败', e); process.exit(1) })
