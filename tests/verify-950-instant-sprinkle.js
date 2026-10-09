// tests/verify-950-instant-sprinkle.js —— #950 瞬间点缀门禁（948 图第二批）
// 用法：在插件根目录执行 node tests/verify-950-instant-sprinkle.js，可独立运行。
//
// 盯住 #950 验收 5 条：
//   1. 大按钮涟漪与小图标外扩环二选一，不在同一控件同时开
//   2. 小图标按下去不缩小不下沉，只靠描边与外扩环确认
//   3. 光泽只取现有浅色做高光，不引入新颜色
//   4. 倾斜只出现在弹窗大按钮，其他位置不用
//   5. 图标旁气泡有可读文字，减少动态下只剩图标加文字
// 外加两条本图铁律：覆盖层实现不占布局（新增规则不动宽高边距）；
// 落点扩到全部瞬间控件（过滤药丸与列表行之外：详情顶栏、版本页签、
// 悬浮行、状态栏段、设置页按钮、图标小按钮）。
const path = require('path')
const fs = require('fs')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg, detail) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg + (ok ? '' : (detail ? ' — ' + String(detail).slice(0, 400) : ''))); if (!ok) failed = true }

function main() {
  console.log('948 第二批门禁：瞬间点缀补齐并扩到全部瞬间控件（#950）')
  const styles = fs.readFileSync(path.join(ROOT, 'src/client/kernel/styles.js'), 'utf8')
  const batch = styles.split('// #948 第二批')[1]
  check(!!batch, '第二批样式有 #948 第二批 标记（可追溯、可回滚）')

  if (batch) {
    // 同一行里有多条规则时按 } 切成单条再断，避免误伤同行的无辜规则；
    // 关键帧体内（百分比段）不参与选择器断言，只看规则段。
    const ruleLines = batch.split('}').filter((frag) => {
      const t = frag.trim().replace(/^'?,?/, '')
      return t && !t.includes('@keyframes') && !/^\d+%/.test(t) && !/^(from|to)\b/.test(t)
    })

    // —— 1. 涟漪与外扩环二选一：涟漪只挂大按钮， ring 只挂小图标 ——
    check(batch.includes('@keyframes dsws-ripple') || batch.includes('dsws-ripple'), '大按钮涟漪关键帧存在')
    check(batch.includes('@keyframes dsws-ringout') || batch.includes('dsws-ringout'), '小图标外扩环关键帧存在')
    const rippleRules = ruleLines.filter((l) => l.includes('dsws-ripple') && l.includes('::after'))
    check(rippleRules.length >= 1, '涟漪经覆盖层实现（::after，不占布局）')
    check(rippleRules.every((l) => l.includes('.primary') && !l.includes('.ghost')), '涟漪只挂大按钮（.primary），不挂小图标', rippleRules[0])
    const ringRules = ruleLines.filter((l) => l.includes('dsws-ringout'))
    check(ringRules.length >= 1, '外扩环规则存在')
    check(ringRules.every((l) => l.includes('.ghost') && !l.includes('.primary')), '外扩环只挂小图标（.ghost），不挂大按钮', ringRules[0])

    // —— 2. 小图标不变形：任何挂 .ghost 的规则行都不带变形 ——
    const ghostDeform = ruleLines.filter((l) => l.includes('.ghost') && /(transform\s*:|scale\(|rotate\(|translate)/.test(l))
    check(ghostDeform.length === 0, '小图标规则里没有缩小下沉倾斜（只靠描边与外扩环）', ghostDeform[0])

    // —— 3. 光泽无新颜色：本批不出现任何十六进制色（高光只用现有的白半透明） ——
    check(!batch.includes('#f85149'), '不引入原型占位红 #f85149')
    const hexes = batch.match(/#[0-9a-fA-F]{6}\b|#fff\b|#000\b|#e6edf3\b/gi) || []
    check(hexes.length === 0, '本批零色值字面量（只用白半透明与现有蓝的透明版）', hexes.slice(0, 5).join(','))

    // —— 4. 倾斜只弹窗大按钮：每个 rotate 都带弹窗前缀 ——
    const tiltRules = ruleLines.filter((l) => l.includes('rotate('))
    check(tiltRules.length >= 1, '倾斜规则存在')
    check(tiltRules.every((l) => l.includes('modalbox') || l.includes('dialog') || l.includes('modal')), '倾斜只出现在弹窗大按钮（带弹窗前缀）', tiltRules[0])
    // 缩小下沉也只给大按钮，不给小图标
    const shrinkRules = ruleLines.filter((l) => /scale\(|translateY/.test(l))
    check(shrinkRules.length >= 1, '缩小下沉规则存在（只大按钮用）')
    check(shrinkRules.every((l) => !l.includes('.ghost')), '缩小下沉不挂小图标', shrinkRules[0])

    // —— 5. 减少动态降级：动画全关，只剩图标加文字 ——
    check(batch.includes('prefers-reduced-motion'), '减少动态兜底存在')
    const reduced = batch.split('prefers-reduced-motion')[1] || ''
    check(reduced.includes('animation:none'), '减少动态下动画全关（不闪不抖不弹）')
    check(reduced.includes('transform:none'), '减少动态下变形全关（按钮不缩不动）')

    // —— 6. 不顶布局：本批不动宽高边距 ——
    check(!/(width|height|margin|padding)\s*:/.test(batch), '新增点缀规则不动宽高边距（覆盖层实现，不顶布局）')

    // —— 7. 落点扩到全部瞬间控件 ——
    ;['.dsws-btn.primary', '.dsws-btn.ghost', '.dsws-seg', '.dsws-skillbtn', '.dsws-cfg-btn', '.dsws-skillpop-row', '.dsws-modalbox'].forEach((sel) => {
      check(batch.includes(sel), '落点覆盖 ' + sel)
    })
  }

  // —— 8. 图标旁气泡有可读文字，走已有悬浮语义（覆盖层，不占布局） ——
  const listRow = fs.readFileSync(path.join(ROOT, 'src/client/views/ListTabRow.js'), 'utf8')
  const issueDetail = fs.readFileSync(path.join(ROOT, 'src/client/views/IssueDetail.js'), 'utf8')
  const mapTop = fs.readFileSync(path.join(ROOT, 'src/client/views/MapDetailTop.js'), 'utf8')
  check(listRow.includes("h(Tip, { content: tr('tip.copyLink')"), '列表行复制图标有悬浮气泡文字')
  check(issueDetail.includes("h(Tip, { content: tr('tip.copyLink')"), '详情顶栏复制图标有悬浮气泡文字')
  check(mapTop.includes("h(Tip, { content: tr('tip.copyLink')"), '地图顶栏复制图标有悬浮气泡文字')
  const hoverTip = fs.readFileSync(path.join(ROOT, 'src/client/views/primitives/HoverTip.js'), 'utf8')
  check(hoverTip.includes("position: 'fixed'"), '气泡经顶层浮层画（position:fixed，不占布局）')
  check(hoverTip.includes("pointerEvents: 'none'"), '气泡不抢点击（pointer-events:none）')
  const tip = fs.readFileSync(path.join(ROOT, 'src/client/views/primitives/Tip.js'), 'utf8')
  check(tip.includes('aria-label'), '气泡文字可被键盘读到（aria-label）')
  const apiIo = fs.readFileSync(path.join(ROOT, 'src/client/kernel/api-io.js'), 'utf8')
  check(apiIo.includes('flash(st, okMsg'), '复制成功配底部小提示（copyText 走 flash）')

  // —— 9. 悬浮行有按下确认类 ——
  const skillFloat = fs.readFileSync(path.join(ROOT, 'src/client/floating/SkillFloatList.js'), 'utf8')
  check(skillFloat.includes('dsws-skillpop-row'), '悬浮技能行有按下确认挂钩（dsws-skillpop-row）')

  if (failed) { console.log('\n存在失败（共 ' + total + ' 项）'); process.exit(1) }
  console.log('\n全部通过 · 948 第二批门禁（#950，共 ' + total + ' 项）')
}

main()
