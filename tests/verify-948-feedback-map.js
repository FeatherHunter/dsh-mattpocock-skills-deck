// tests/verify-948-feedback-map.js —— #949 瞬间底座与组合映射门禁（948 图首批）
// 用法：在插件根目录执行 node tests/verify-948-feedback-map.js，可独立运行。
//
// 盯住 #949 验收 5 条与 #946 规格的组合规矩：
//   1. 等待加代价加形状到反馈组合的映射是全函数，31 种全部分配、无遗漏，人已否的 6 种不在内。
//   2. 过滤小药丸与列表行按下加深、松手恢复，不顶开布局（样式文本断言）。
//   3. 键盘焦点环全量覆盖（:focus-visible 外圈，不占布局）。
//   4. 悬停浮起只加阴影，深底用外圈描边代替加深（不引入新颜色）。
//   5. 减少动态下底座仍可见，不闪不抖（媒体查询兜底存在）。
// 外加三条组合铁律：高危险不用弹跳扩散自动消失气泡；小图标不用缩小下沉倾斜；
// 无真实时间与真实进度不显示倒计时与百分比；同一时刻只有一个主力过程效果。
const path = require('path')
const fs = require('fs')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg, detail) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg + (ok ? '' : (detail ? ' — ' + String(detail).slice(0, 400) : ''))); if (!ok) failed = true }

async function main() {
  console.log('948 首批门禁：组合映射全函数 + 瞬间底座（#949）')
  const mod = await import(pathToFileURL(path.join(ROOT, 'src/shared/feedback-map.js')).href)
  const styles = fs.readFileSync(path.join(ROOT, 'src/client/views/feedback/feedback-styles.js'), 'utf8') + '\n' + fs.readFileSync(path.join(ROOT, 'src/client/kernel/styles.js'), 'utf8')

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

  // —— 9. 可点控件键盘可达：小药丸与整行 Tab 能停留，回车空格沿用鼠标同一条路 ——
  //   （收敛：三件套住共享 chips.js 的 chipProps，列表页调用点只包一层；断言跟实现同形）
  const listTab = fs.readFileSync(path.join(ROOT, 'src/client/views/ListTab.js'), 'utf8')
  const listRow = fs.readFileSync(path.join(ROOT, 'src/client/views/ListTabRow.js'), 'utf8')
  const prTab = fs.readFileSync(path.join(ROOT, 'src/client/views/PrTab.js'), 'utf8')
  const issueDetail = fs.readFileSync(path.join(ROOT, 'src/client/views/IssueDetail.js'), 'utf8')
  const chips = fs.readFileSync(path.join(ROOT, 'src/client/views/shared/chips.js'), 'utf8')
  check(chips.includes('chipKeyDown') && chips.includes('chipProps'), '过滤小药丸有统一键盘处理（共享 chips.js 的 chipKeyDown 与 chipProps）')
  check(chips.includes('tabIndex') && chips.includes("role: 'button'") && chips.includes('onKeyDown'), '三件套住共享层（Tab 停留 + role=button + 键盘处理）')
  const chipUses = (listTab.match(/chipProps\(\{/g) || []).length
  check(chipUses >= 8, '列表页可点小药丸基本都包了三件套（chipProps ≥ 8）', '实际 ' + chipUses)
  check(!listTab.includes('chipKeyDown'), '列表页不再自带键盘处理（单源在共享层，不各写一份）')
  check(listRow.includes("tabIndex: 0") && listRow.includes("role: 'button'"), '列表整行键盘可达（tabIndex + role=button）')
  check(prTab.includes('tabIndex: 0'), 'PR 行键盘可达（tabIndex）')
  check(issueDetail.includes('tabIndex: 0'), '详情子票与阻塞行键盘可达（tabIndex）')
  // #956 评审后收敛：行内小药丸与整行都改调共享层（chipProps / chipKeyDown），
  //   所以「回车空格调起 click」只在 chips.js 一处有源码，两边的使用点改判为「确实引用了共享层」。
  check(chips.includes('e.currentTarget.click()') && listRow.includes('chipProps(') && listRow.includes('chipKeyDown(e)'), '键盘沿用鼠标同一条路（共享层一处实现，调用点只引用不重写）')
  // #956 评审修正：子孙元素的事件不许冒上来重复触发整行（会话上按回车会既复制又开票）。
  check(listRow.includes('e.target !== e.currentTarget'), '整行键盘处理忽略来自子孙的事件（不双触发）')
  check(prTab.includes('e.target !== e.currentTarget') && issueDetail.includes('e.target !== e.currentTarget'), 'PR 行与详情行同样有子孙护栏')

  // —— 8. 底座样式落进 styles.js，且只叠加不顶布局 ——
  check(styles.includes('.dsws-chip:active') || styles.includes('.dsws-chip-fb:active'), '过滤小药丸按下加深存在')
  check(styles.includes(':focus-visible'), '键盘焦点环存在（:focus-visible）')
  check(styles.includes('.dsws-btn:hover'), '悬停浮起挂在既有按钮上（.dsws-btn:hover 只加阴影）')
  check(styles.includes('.dsws-btn.ghost:active'), '透明底 ghost 按钮按下走外圈描边（深底代替加深）')
  check(styles.includes('prefers-reduced-motion'), '减少动态兜底存在')
  check(styles.includes('fb-dark') || styles.includes('is-dark'), '深底描边代替加深存在')
  check(!styles.includes('#f85149'), '不引入原型占位红 #f85149')
  // 新规则里不许出现顶开布局的写法（宽高边距内边距位移布局）。
  // #952 起例外：票面点名“宽度提前按最长一句留死”，留死只许换字类与圆点区两个固定位，其余一律不许。
  const fbRules = styles.split('// #948').slice(1).join('\n')
  const fbNoReserve = fbRules.replace(/\.dsws-fb-result\{[^}]*\}/g, '').replace(/\.dsws-fb-dots\{[^}]*\}/g, '').replace(/\.dsws-fb-dots i\{[^}]*\}/g, '')
  if (fbRules) {
    check(!/\.dsws-fb[^{]*\{[^}]*\b(width|height|margin|padding):/.test(fbNoReserve), '新增反馈规则不动宽高边距（不顶布局，留死宽度只许两个固定位）')
  } else {
    check(false, '新增反馈规则有 #948 标记（可追溯）')
  }

  if (failed) { console.log('\n存在失败（共 ' + total + ' 项）'); process.exit(1) }
  console.log('\n全部通过 · 948 首批门禁（#949，共 ' + total + ' 项）')
}

main().catch((e) => { console.error('门禁执行失败', e); process.exit(1) })
