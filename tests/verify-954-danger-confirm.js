// tests/verify-954-danger-confirm.js —— #954 高危险确认与留痕门禁（948 图第五批）
// 用法：在插件根目录执行 node tests/verify-954-danger-confirm.js，可独立运行。
//
// 盯住 #954 验收 5 条（落点：状态栏日志菜单的“清空今日日志”，全仓唯一的高危险不可逆动作）：
//   1. 确认框用覆盖层实现，不顶开布局，一次只冒一个。
//   2. 确认框键盘可达，退出键可关，有可读文字。
//   3. 动手后转圈加禁用，结果对勾叉号加闪光。
//   4. 顶部横幅人工关闭才消失，失败带重试。
//   5. 弹跳扩散会自动消失的气泡在高危险里一个不用。
//
// 落子结论（读透已有叶子后定的，不另起重型弹窗）：
//   - SwitchConfirmModal 是切换后端的居中三选一重弹窗（选项加链检查），与“按钮旁边小确认框”不是同一种东西，
//     复用它等于把小确认做成大弹窗，不复用，就近确认直接画在日志菜单浮层里（按钮旁边，覆盖层，一次一个）。
//   - 留痕横幅就近留在状态栏（dsws-banner ok/bad 视觉、人工关闭、失败重试三条语义与顶部横幅一致），
//     不为一次危险动作新建跨组件通道；座位语义见 D:\dsh-plugin\dsh-948-notes\exploration.md。
//   - 主理人接盘时确认框与留痕横幅搬进了新叶子 statusbar/LogDangerConfirm.js（菜单叶子贴 350 行粒度红线，
//     照 #851 样式叶子的做法另起），所以第 2/3/4 组断言读「菜单叶子 + 新叶子」两份合起来的内容；
//     第 1 组与日志那条仍只盯菜单叶子（状态与调用留在那儿）。
const path = require('path')
const fs = require('fs')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg, detail) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg + (ok ? '' : (detail ? ' — ' + String(detail).slice(0, 300) : ''))); if (!ok) failed = true }
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

function main() {
  console.log('948 第五批门禁：高危险确认与留痕（#954）')
  const menu = read('src/client/statusbar/StatusLogMenu.js')
  const danger = read('src/client/statusbar/LogDangerConfirm.js')
  const ui = menu + '\n' + danger
  const leaf = read('src/client/views/feedback/feedback-styles.js')

  // —— 0. 新叶子真被拼进产物（登记与标记都在，否则界面是空的） ——
  check(read('scripts/build.mjs').includes("'src/client/statusbar/LogDangerConfirm.js'"), '新叶子在构建清单里登记')
  check(read('src/client/index.js').includes('leaf:logDangerConfirm'), 'index.js 有 leaf:logDangerConfirm 标记（拼接位）')

  // —— 1. 确认框是覆盖层、一次一个、不顶布局 ——
  check(menu.includes('clearConfirm'), '清空确认状态存在（一次只冒一个）')
  check(/position:\s*'fixed'/.test(menu) || menu.includes("position: 'fixed'"), '确认框经 fixed 覆盖层画（不占布局）')
  check(!/clearConfirm\[[^\]]*\]\s*=\s*\[|clearConfirms/.test(menu), '确认框无多实例（单状态，无队列无数组）')

  // —— 2. 键盘可达、退出键可关、有可读文字 ——
  check(menu.includes('Escape') || menu.includes("'Esc'"), '退出键可关确认框')
  check(ui.includes('logmenu.clearTitle') && ui.includes('logmenu.clearDesc'), '确认框有可读文字（标题加说明，不是光秃按钮）')
  check(ui.includes('autoFocus') || (ui.includes("role: 'dialog'") || ui.includes('role:"dialog"')), '确认框键盘可达（焦点进框或语义 dialog）')

  // —— 3. 动手后转圈加禁用，结果对勾叉号加闪光 ——
  check(ui.includes('dsws-spinner'), '动手后按钮内有转圈')
  check(ui.includes('disabled'), '动手后按钮禁用（连点无事）')
  check(ui.includes("Ic({ n: 'check'") && ui.includes("Ic({ n: 'x'"), '结果对勾叉号同尺寸图标替换')
  check(ui.includes('dsws-fb-okflash') && ui.includes('dsws-fb-errflash'), '结果加成功绿闪失败红闪')

  // —— 4. 留痕横幅人工关闭才消失，失败带重试 ——
  check(menu.includes('clearNotice'), '留痕通知状态存在（在菜单叶子里）')
  check(ui.includes('dsws-banner'), '留痕走横幅视觉（dsws-banner ok/bad）')
  const noticeAuto = /clearNotice[^;]*setTimeout|setTimeout[^;]*clearNotice\s*=\s*null/.test(menu)
  check(!noticeAuto, '留痕不自动消失（无定时清理，人工关闭才消失）')
  check(danger.includes('logmenu.retry') || menu.includes('logmenu.retry'), '失败留痕带可操作按钮（重试）')
  check(danger.includes('onClose') && menu.includes('setClearNotice(null)'), '留痕有人工关闭（关掉才消失）')

  // —— 5. 高危险不用轻佻效果 ——
  ;['dsws-fb-pop', 'dsws-fb-success-ring', 'dsws-fb-breath', 'bounce', 'ring-diffuse', 'auto-bubble'].forEach((k) => {
    check(!ui.includes(k), '清空路径不用 ' + k)
  })

  // —— 本批卫生：无新颜色、无占位红、无新动画（复用叶子已降级的类） ——
  check(!ui.includes('#f85149'), '不引入原型占位红')
  check(!danger.includes('@keyframes'), '不新增动画关键帧（复用叶子已做减少动态降级的类）')

  // —— 日志：危险结果记一条常驻（只记动作类别与成败，不记标题路径令牌） ——
  check(menu.includes("method: 'wf.logClear'") || menu.includes('method:"wf.logClear"'), '清空落定记一条调用日志（复用 host.call 事件与白名单字段）')

  if (failed) { console.log('\n存在失败（共 ' + total + ' 项）'); process.exit(1) }
  console.log('\n全部通过 · 948 第五批门禁（#954，共 ' + total + ' 项）')
}

main()
