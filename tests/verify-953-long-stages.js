// tests/verify-953-long-stages.js —— #953 中长等待多阶段门禁（948 图第四批）
// 用法：在插件根目录执行 node tests/verify-953-long-stages.js，可独立运行。
//
// 盯住 #953 验收 5 条（只断看得见的行为与源码字面量，不跑浏览器）：
//   1. 阶段文字轮换只出现在宽按钮多阶段任务，窄按钮不轮
//   2. 倒计时与百分比只在有真实时间与真实进度时出现，不编数
//   3. 骨架占位只用于面板列表，其他位置不用
//   4. 进度环只包有正方形加空隙的图标
//   5. 失败横幅带重试，成功用轻提示，横幅走已有横幅座位语义
//
// 诚实边界（实现时逐个核对过代码，不是猜的）：
//   - 五个落点里没有宽按钮多阶段任务（版本页按钮、弹窗提交都是窄按钮；检查更新
//     的按钮与弹窗归更新包所有，本仓只有挂载点 UpdateEntryHost.js，动不了），
//     所以阶段轮换只留映射里的 spinner-stage 机制，生产里窄按钮一律不轮。
//   - 五个落点里没有真实时间与真实进度数据（版本操作只回 done/failed），
//     所以倒计时与百分比不画，映射里的 detail 标志原样保留。
//   - 版本页的骨架（dsws-vc-skel）与像素风占位（PxSkel）早于本图已存在，不动；
//     本批新增的骨架类只许出现在叶子与面板列表。
//   - 五个落点里没有正方形加空隙的图标（状态栏刷新是时间药丸里的 11 像素图标，
//     不是方图标按钮），所以进度环只留映射规则，生产里不给任何图标套环。
//   - 版本页失败就地结果加重试（#842 契约）与弹窗失败内联条（#420/#426 契约）
//     都保留，不搬去横幅座位；本批不新增横幅调用。
const path = require('path')
const fs = require('fs')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg, detail) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg + (ok ? '' : (detail ? ' — ' + String(detail).slice(0, 400) : ''))); if (!ok) failed = true }
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

function main() {
  console.log('948 第四批门禁：中长等待多阶段（#953）')
  const leaf = read('src/client/views/feedback/feedback-styles.js')
  const listTab = read('src/client/views/ListTab.js')
  const vcView = read('src/client/views/versionControl/vcWriteView.js')
  const vcTab = read('src/client/views/versionControl/VersionControlTab.js')
  const modal = read('src/client/kernel/slotRenderer-modal-view.js')
  const mapping = read('src/shared/feedback-map.js')
  const updateHost = read('src/client/views/UpdateEntryHost.js')

  // —— 1. 长任务按钮内转圈加禁用：版本五个动作与弹窗提交，跑起来的那一颗盖转圈 ——
  check(vcTab.includes('runningOp'), '版本页把在跑的操作名传给画法层（runningOp）')
  check(vcView.includes('dsws-fb-busy') && vcView.includes('runningOp'), '版本动作按钮跑起来盖转圈（复用 951 忙态覆盖层）')
  check(modal.includes('dsws-fb-busy'), '弹窗提交等候时盖转圈（窄按钮只转圈加禁用，不轮阶段文字）')
  check(vcTab.includes('data-vc-reload') && vcTab.includes('dsws-fb-busy'), '版本重新读取时盖转圈加禁用')

  // —— 2. 窄按钮不轮阶段文字：五个落点都没有轮换钩子 ——
  ;[vcView, vcTab, modal, listTab, updateHost].forEach(function (src, i) {
    check(!src.includes('fb-stage') && !src.includes('stageText'), '落点' + (i + 1) + '无阶段轮换钩子（窄按钮不轮）')
  })
  check(mapping.includes('spinner-stage'), '映射里中长等待过程词还在（机制位没动）')

  // —— 3. 无真实数不显示数字：五个落点都不画倒计时与百分比 ——
  ;[vcView, vcTab, modal, listTab].forEach(function (src, i) {
    check(!src.includes('countdown') && !src.includes('percent'), '落点' + (i + 1) + '不画倒计时与百分比（没有真实数）')
  })

  // —— 4. 骨架只面板列表：遮罩里是行形占位，不再是转圈 ——
  check(listTab.includes('dsws-loading-shade'), '列表加载遮罩还在（只换里面，不动出现规则）')
  check(listTab.includes('dsws-fb-skel'), '列表遮罩里画行形骨架占位')
  const skelFiles = ['src/client/views/feedback/feedback-styles.js', 'src/client/views/ListTab.js', 'tests/verify-953-long-stages.js']
  const outside = []
  ;[vcView, vcTab, modal, updateHost].forEach(function (src, i) {
    if (src.includes('dsws-fb-skel')) outside.push('落点' + (i + 1))
  })
  check(outside.length === 0, '新增骨架类只在叶子与列表（版本弹窗更新四处不用）', outside.join(','))
  check(vcTab.includes('dsws-vc-skel'), '版本页原有骨架还在（早于本图，不动）')
  check(!read('src/client/views/primitives/PxSkel.js').includes('dsws-fb-skel'), '像素风占位块不动（那是详情的，不是列表的）')

  // —— 5. 进度环只包方空隙图标：五个落点里没有，生产里不给任何图标套环 ——
  check(!listTab.includes('fb-ring') && !vcView.includes('fb-ring') && !modal.includes('fb-ring'), '五个落点无进度环（没有方空隙图标就不套）')

  // —— 6. 失败留痕与重试都在：版本就地结果加重试、弹窗内联条都在 ——
  check(vcView.includes('data-vc-op-retry'), '版本失败结果带重试（就地保留）')
  check(modal.includes('alert'), '弹窗失败内联提醒还在（契约不动）')

  // —— 7. 本批铁律：无新颜色、减少动态兜底、不顶布局 ——
  check(!leaf.includes('#f85149'), '叶子不引入原型占位红 #f85149')
  const added = leaf.split('#953').slice(1).join('\n')
  if (added) {
    check(!/#[0-9a-fA-F]{3,8}/.test(added.replace(/rgba?\([^)]*\)/g, '')), '本批新增规则零十六进制色（只用现成的白半透明）')
    check(!/\.dsws-fb[^{]*\{[^}]*\b(width|height|margin|padding):/.test(added), '本批新增规则不动宽高边距（不顶布局）')
    check(added.includes('prefers-reduced-motion'), '本批新增动画有减少动态兜底')
  } else {
    check(false, '本批新增规则有 #953 标记（可追溯）')
  }

  if (failed) { console.log('\n存在失败（共 ' + total + ' 项）'); process.exit(1) }
  console.log('\n全部通过 · 948 第四批门禁（#953，共 ' + total + ' 项）')
}

main()
