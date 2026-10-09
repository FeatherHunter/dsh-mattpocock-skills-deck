// tests/verify-952-short-text.js —— #952 短等待文字与轻效果门禁（948 图第三批）
// 用法：在插件根目录执行 node tests/verify-952-short-text.js，可独立运行。
//
// 盯住 #952 验收 5 条（原文见票正文，大白话复述）：
//   1. 结果换字只出现在宽按钮，换字时按钮宽度不动（最长一句提前留死）。
//   2. 成功圈与弹跳只给低代价复制类，其他短等待不用。
//   3. 省略号圆点与呼吸是备用，同一时刻不和转圈同开。
//   4. 窄按钮与状态栏小段不换结果文字，不留死宽度。
//   5. 减少动态下换字与图标保留，闪跳弹一律降级。
// 外加本图铁律：覆盖层实现不占布局（留死宽度只许出现在换字类与圆点区两个固定位）；
// 不引入新颜色与原型占位红；映射判断口的备用词（dots/breath）有归宿。
const path = require('path')
const fs = require('fs')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg, detail) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg + (ok ? '' : (detail ? ' — ' + String(detail).slice(0, 300) : ''))); if (!ok) failed = true }
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

async function main() {
  console.log('948 第三批门禁：短等待文字与轻效果（#952）')
  const fbStyles = read('src/client/views/feedback/feedback-styles.js')
  const modalView = read('src/client/kernel/slotRenderer-modal-view.js')
  const listRow = read('src/client/views/ListTabRow.js')
  const comments = read('src/client/views/IssueDetailComments.js')
  const statusbar = read('src/client/statusbar/StatusBar.js')
  const mod = await import(pathToFileURL(path.join(ROOT, 'src/shared/feedback-map.js')).href)

  // —— 1. 结果换字只宽按钮：全仓只有弹窗提交按钮写「已提交」，且宽度留死 ——
  const swapSites = ['src/client/kernel/slotRenderer-modal-view.js', 'src/client/views/ListTab.js', 'src/client/views/ListTabRow.js', 'src/client/views/IssueDetail.js', 'src/client/views/IssueDetailComments.js', 'src/client/views/SettingsPage.js', 'src/client/statusbar/StatusBar.js', 'src/client/views/labels/LabelColorDialog.js', 'src/client/views/ChecksTab.js', 'src/client/panel/Dock.js']
    .filter(function (rel) { try { return read(rel).indexOf('已提交') !== -1 } catch (e) { return false } })
  check(swapSites.length === 1 && swapSites[0] === 'src/client/kernel/slotRenderer-modal-view.js', '「已提交」换字只出现在弹窗提交按钮', swapSites.join(','))
  check(fbStyles.includes('.dsws-fb-result') && fbStyles.includes('min-width'), '换字按钮有留死宽度的类（最长一句为准）')
  check(modalView.includes('dsws-fb-result'), '弹窗提交成功态挂留死宽度类')

  // —— 2. 成功圈与弹跳只复制类：样式有，落点只在行内复制按钮 ——
  check(fbStyles.includes('dsws-fb-success-ring') && fbStyles.includes('dsws-fb-pop'), '成功圈与弹跳的类存在')
  check(listRow.includes('dsws-fb-success-ring') && listRow.includes('dsws-fb-pop'), '行内复制成功挂成功圈与弹跳')
  const nonCopyViews = [modalView, comments, statusbar, read('src/client/views/SettingsPage.js'), read('src/client/views/labels/LabelColorDialog.js')]
  check(nonCopyViews.every(function (s) { return s.indexOf('dsws-fb-success-ring') === -1 && s.indexOf('dsws-fb-pop') === -1 }), '成功圈与弹跳不在非复制落点出现')

  // —— 3. 圆点与呼吸是备用：类与映射出口都在；弹窗提交等待中用转圈（953 窄按钮规则，同一按钮只开一个主力），圆点退回备用，永不与转圈同开 ——
  check(fbStyles.includes('dsws-fb-dots') && fbStyles.includes('dsws-fb-breath'), '圆点与呼吸的类存在')
  check(modalView.includes('dsws-fb-busy') && modalView.indexOf('dsws-fb-dots') === -1, '弹窗提交等待中只开转圈（圆点退回备用，不双开）')
  check(comments.includes('dsws-fb-breath'), '呼吸落在评论分页加载中（无转圈的文字按钮）')
  const dualViews = [modalView, comments, listRow, read('src/client/views/ListTab.js'), read('src/client/views/labels/LabelColorDialog.js'), read('src/client/views/SettingsPage.js')]
  const dual = dualViews.some(function (src) {
    return String(src).split('\n').some(function (ln) {
      const hasBusy = ln.indexOf('dsws-fb-busy') !== -1 || ln.indexOf('dsws-spinner') !== -1
      const hasAlt = ln.indexOf('dsws-fb-dots') !== -1 || ln.indexOf('dsws-fb-breath') !== -1
      return hasBusy && hasAlt
    })
  })
  check(!dual, '备用过程永不与转圈同处一行（同一按钮只开一个主力）')
  const altOf = mod.feedbackComboOf({ wait: 'short', cost: 'medium', shape: 'wide-button' })
  check(Array.isArray(altOf.alt) && altOf.alt.indexOf('dots') !== -1 && altOf.alt.indexOf('breath') !== -1, '映射给出短等待的备用过程（dots/breath）')

  // —— 4. 窄按钮与状态栏小段不换字 ——
  check(statusbar.indexOf('已提交') === -1 && statusbar.indexOf('dsws-fb-result') === -1, '状态栏小段不换结果文字')
  check(listRow.indexOf('已提交') === -1, '行内窄按钮不换结果文字')

  // —— 5. 减少动态下降级：动效全关，换字图标保留 ——
  const reduced = fbStyles.split('prefers-reduced-motion').slice(1).join('\n')
  check(reduced.includes('dsws-fb-pop') && reduced.includes('dsws-fb-success-ring') && reduced.includes('dsws-fb-dots') && reduced.includes('dsws-fb-breath'), '减少动态下弹跳成功圈圆点呼吸全关')

  // —— 本图铁律：无新颜色、无占位红；留死宽度只许两个固定位 ——
  const touchedSrc = [fbStyles, modalView, listRow, comments].join('\n')
  check(!touchedSrc.includes('#f85149'), '本批不引入原型占位红 #f85149')
  check(!/#[0-9a-fA-F]{6}/.test(fbStyles.split('#948 第三批')[1] || ''), '本批样式零色值字面量（只复用既有色与 currentColor）')
  const widthRules = (fbStyles.split('#948 第三批')[1] || '').split('\n').filter(function (ln) { return ln.indexOf('min-width') !== -1 || ln.indexOf('minWidth') !== -1 })
  check(widthRules.length > 0 && widthRules.every(function (ln) { return ln.indexOf('dsws-fb-result') !== -1 || ln.indexOf('dsws-fb-dots') !== -1 }), '留死宽度只出现在换字类与圆点区', widthRules.join('|').slice(0, 200))

  if (failed) { console.log('\n存在失败（共 ' + total + ' 项）'); process.exit(1) }
  console.log('\n全部通过 · 948 第三批门禁（#952，共 ' + total + ' 项）')
}

main().catch((e) => { console.error('门禁执行失败', e); process.exit(1) })
