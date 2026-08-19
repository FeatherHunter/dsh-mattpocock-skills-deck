// verify-issue22-popovers.js — issue #22 浮层脱离状态栏裁剪契约
// 用法: node tests/verify-issue22-popovers.js [file...]
//
// 行为 seam：BUG 新增菜单与技能列表必须是 body-level overlay；
// 布局 wrapper 继续保留横向裁剪职责，但不得再承载向上展开的弹层。
const fs = require('fs')
const files = process.argv.slice(2)
const targets = files.length ? files : ['client.js', 'package/lib/client.js']
let failed = false

const check = function (file) {
  const src = fs.readFileSync(file, 'utf8')
  const problems = []
  const requireText = (re, message) => { if (!re.test(src)) problems.push(message) }

  // 两个交互浮层都必须走既有的 body portal seam。
  requireText(/portalTop\(h\('div',[\s\S]{0,500}dsws-bugmenu/, 'BUG 菜单未通过 portalTop 渲染')
  requireText(/portalTop\(h\('div',[\s\S]{0,500}dsws-skillpop/, '技能列表未通过 portalTop 渲染')

  // overlay 必须使用 viewport 定位和全局层级，不能继续使用 absolute + 9999。
  requireText(/dsws-bugmenu[\s\S]{0,500}position:\s*'fixed'/, 'BUG 菜单缺 position:fixed')
  requireText(/dsws-skillpop[\s\S]{0,500}position:\s*'fixed'/, '技能列表缺 position:fixed')
  requireText(/dsws-bugmenu[\s\S]{0,500}zIndex:\s*2147483000/, 'BUG 菜单缺全局 z-index')
  requireText(/dsws-skillpop[\s\S]{0,500}zIndex:\s*2147483000/, '技能列表缺全局 z-index')

  // 定位必须从锚点 rect 得出，并在滚动/缩放后更新。
  requireText(/getBoundingClientRect\(\)[\s\S]{0,300}(bugMenuPos|bugMenuAnchor|placeBug)/, '缺 BUG 锚点 rect 定位')
  requireText(/getBoundingClientRect\(\)[\s\S]{0,300}(skillPopPos|skillPopAnchor|placeSkill)/, '缺技能列表锚点 rect 定位')
  requireText(/addEventListener\(['"]scroll['"][\s\S]{0,1200}capture:\s*true/, '缺捕获阶段 scroll 重定位')
  requireText(/addEventListener\(['"]resize['"][\s\S]{0,1200}(bugMenuPos|skillPopPos|placeBug|placeSkill)/, '缺 resize 重定位')

  // portal 后 trigger -> popup 的鼠标桥接必须有延迟关闭/取消关闭机制。
  requireText(/setTimeout\([\s\S]{0,220}(bugMenuOpen|skillsOpen)[\s\S]{0,220}clearTimeout/, '缺 portal 弹层悬停桥接（延迟关闭 + 取消）')

  // wrapper 的原始布局保护仍保留；修复不能靠删除它掩盖回归。
  requireText(/overflow:\s*'hidden'/, 'wrapper 横向裁剪保护被完全移除')

  if (problems.length) {
    console.log('  FAIL', file, problems.join('；'))
    failed = true
  } else {
    console.log('  PASS', file, '（body portal ✓ · fixed/global z-index ✓ · rect 重定位 ✓ · scroll/resize ✓ · hover bridge ✓ · wrapper 保护保留 ✓）')
  }
}

console.log('issue #22：BUG / 技能浮层 overlay 契约')
targets.forEach(check)

if (targets.length >= 2) {
  const a = fs.readFileSync(targets[0], 'utf8')
  const b = fs.readFileSync(targets[1], 'utf8')
  const fingerprints = [
    'portalTop(h(',
    'dsws-bugmenu',
    'dsws-skillpop',
    '2147483000',
    "capture: true",
  ]
  const mismatch = fingerprints.filter((x) => a.includes(x) !== b.includes(x))
  if (mismatch.length) { console.log('  FAIL 双源指纹不一致:', mismatch.join(', ')); failed = true }
  else console.log('  PASS 双源指纹一致')
}

if (failed) process.exit(1)
console.log('\n全部通过')
