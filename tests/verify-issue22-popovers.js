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
  requireText(/const PortalOverlay\s*=\s*function[\s\S]{0,180}return portalTop\(h\('div'/, 'PortalOverlay 未委托给 portalTop')
  requireText(/PortalOverlay\(\{ className: 'dsws-bugmenu'/, 'BUG 菜单未通过 PortalOverlay 渲染')
  requireText(/PortalOverlay\(\{ className: 'dsws-skillpop-bridge'/, '技能列表未通过 PortalOverlay 渲染')

  // overlay 必须使用 viewport 定位和全局层级，不能继续使用 absolute + 9999。
  requireText(/dsws-bugmenu[\s\S]{0,500}position:\s*'fixed'/, 'BUG 菜单缺 position:fixed')
  requireText(/dsws-skillpop[\s\S]{0,500}position:\s*'fixed'/, '技能列表缺 position:fixed')
  requireText(/dsws-bugmenu[\s\S]{0,500}zIndex:\s*2147483000/, 'BUG 菜单缺全局 z-index')
  requireText(/dsws-skillpop[\s\S]{0,500}zIndex:\s*2147483000/, '技能列表缺全局 z-index')

  // 定位必须从锚点 rect 得出，并在滚动/缩放后更新。
  requireText(/const placeOverlay\s*=\s*function[\s\S]{0,300}getBoundingClientRect\(\)/, '缺锚点 rect 定位')
  requireText(/const placeBugMenu\s*=\s*function[\s\S]{0,450}bugMenuPos/, '缺 BUG 锚点位置状态')
  requireText(/const placeSkillPop\s*=\s*function[\s\S]{0,450}skillPopPos/, '缺技能锚点位置状态')
  requireText(/addEventListener\(['"]scroll['"][\s\S]{0,900}capture:\s*true/, '缺捕获阶段 scroll 重定位')
  requireText(/addEventListener\(['"]resize['"][\s\S]{0,900}reposition/, '缺 resize 重定位')

  // portal 后 trigger -> popup 的鼠标桥接必须有延迟关闭/取消关闭机制。
  requireText(/const scheduleClose\s*=\s*function[\s\S]{0,180}setTimeout/, '缺 portal 弹层延迟关闭')
  requireText(/clearClose\([\s\S]{0,120}bugCloseRef|clearClose\([\s\S]{0,120}skillCloseRef/, '缺 portal 弹层取消关闭')

  // 正常 portal 路径保留横向裁剪；没有 ReactDOM 时转 visible，避免 fallback 菜单被同一 wrapper 裁掉。
  requireText(/overflow:\s*RDOM\s*\?\s*'hidden'\s*:\s*'visible'/, 'wrapper 缺 RDOM 条件式裁剪/可用降级')

  if (problems.length) {
    console.log('  FAIL', file, problems.join('；'))
    failed = true
  } else {
    console.log('  PASS', file, '（body portal ✓ · fixed/global z-index ✓ · rect 重定位 ✓ · scroll/resize ✓ · hover bridge ✓ · wrapper 保护保留 ✓）')
  }
}

console.log('issue #22：BUG / 技能浮层 overlay 契约')
targets.forEach(check)

// 双源指纹一致性已移除（T5 #98：一源两物，src 为真源；由 build 保证双产物同构）

if (failed) process.exit(1)
console.log('\n全部通过')
