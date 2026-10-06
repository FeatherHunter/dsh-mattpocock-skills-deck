// verify-587-update-restart.js —— 待重启与更新弹窗委托门禁（落地票 #876 搭架、主题票 #877 切档案卷皮肤）
// 规则（与票面验收一一对应）：
//   1) 判据只看宿主当场算的那条：回包原因码 pending-restart；面板不自己比版本号、不读会过期的任务记录，
//      宿主侧一行代码不改（这条是接缝，动了就红）。判据代码活在已安装更新包里，不在本仓。
//   2) 待重启与弹窗都收在包的入口件与面板里：本仓不再自带常驻横幅组件与浮层弹窗组件，
//      配置页只挂入口件；待重启横幅与更新面板 dialog 按包的档案卷呈现（主题票 #877 已切，
//      挂载传档案卷皮肤，不自定义皮肤变量，深浅跟随系统）。
//   3) 关闭与轮询收尾按包的约定：挂载点卸载只停轮询，不自己起定时器，不加关闭与重启接线。
//   4) 文案与埋点：挂载点不写死中文，不新增事件名。
//   5) 文件粒度：相关文件都在 350 行以内。
// 用法：node tests/verify-587-update-restart.js（在仓库根目录）
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const exists = (rel) => fs.existsSync(path.join(ROOT, rel))
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^A-Za-z0-9_$:])\/\/.*$/gm, '$1')
const lines = (rel) => read(rel).split(/\r?\n/).length

const HOST = 'src/client/views/UpdateEntryHost.js'
const PAGE = 'src/client/views/SettingsPage.js'
// #801 按 #798 决策 4 改读新来源：宿主判据活在已安装更新包里，不在冻结的旧派生目录里。
const HOST_READER = 'node_modules/dsh-plugin-update/dist/reader.js'
const BUNDLE = 'scripts/generated/updateEntryPanel.bundle.js'

async function main() {
  console.log('待重启与更新弹窗委托门禁（#876 搭架 + #877 档案卷皮肤：判据在包内 + 本仓无自带横幅弹窗 + 挂载收尾按约定）')

  // ---- 1) 判据：只看宿主当场算的那条，宿主侧不动 ----
  const reader = read(HOST_READER)
  check(reader.includes('result.installedVersion !== runningVersion') && reader.includes('result.blockedReason = "pending-restart"'),
    '宿主判据不变：磁盘已装版本与运行版本不一致时报缺一次重启')
  const hookSrc = strip(read(HOST))
  check(hookSrc.includes("prefix: 'wf'") && hookSrc.includes('mountUpdateEntry'), '面板待重启只走包的入口件（前缀与宿主侧一致，不自拼判据）')
  check(hookSrc.includes("theme: 'archive'"), '待重启横幅走包的档案卷呈现（挂载传档案卷皮肤）')
  check(!hookSrc.includes('themeTokens'), '待重启横幅不自定义皮肤变量（深浅跟随系统）')
  check(!/installedVersion\s*!==\s*runningVersion|installed\s*!==\s*running|semver|localeCompare/.test(hookSrc),
    '挂载点不自己比版本号（判据单源在宿主与包内）')
  check(!hookSrc.includes('restart-required'), '挂载点不拿任务记录的状态当待重启判据')

  // ---- 2) 本仓无自带横幅与弹窗，包内覆盖 ----
  for (const rel of ['src/client/views/useUpdatePanel.js', 'src/client/views/UpdateDialog.js', 'src/client/views/UpdateRestartBanner.js']) {
    check(!exists(rel), '自有实现已删：' + rel)
  }
  const pageSrc = strip(read(PAGE))
  check(pageSrc.includes('UpdateEntryHost'), '配置页挂载入口件（标题行按钮走包的默认摆法）')
  check(!pageSrc.includes('upd.banner') && !pageSrc.includes('upd.dialog'), '配置页不再另画常驻横幅与浮层弹窗（收在入口件打开的面板里）')
  check(!pageSrc.includes('useUpdatePanel') && !pageSrc.includes('UpdateDialog') && !pageSrc.includes('UpdateRestartBanner'), '配置页不再引用旧面板三件')
  const bundle = read(BUNDLE)
  check(bundle.includes('pending-restart'), '绑定包内有待重启判据与横幅（包的面板负责说这件事）')
  check(bundle.includes('dsh-upd-overlay'), '绑定包内有 dialog 浮层形态（包的面板原样）')
  check(bundle.includes('install-failed') || bundle.includes('update-failed'), '绑定包内有安装失败的显性提示（不是点完没反应）')

  // ---- 3) 关闭与轮询收尾按包的约定 ----
  check(hookSrc.includes('.unmount()'), '卸载走包的收尾（只停轮询，安装在宿主侧继续跑）')
  check(!hookSrc.includes('setInterval') && !hookSrc.includes('UPD_POLL'), '不自己起定时器（轮询间隔走包默认）')
  check(!hookSrc.includes('onCloseRequested') && !hookSrc.includes('onRestartRequested'), '不加关闭与重启接线（走包默认）')

  // ---- 4) 文案与埋点纪律 ----
  {
    const body = strip(read(HOST)).split('\n').filter((l) => !/^\s*\*/.test(l)).join('\n')
    const cjk = (body.match(/'(?:[^'\\\n]|\\.)*'/g) || []).filter((s) => /[\u4e00-\u9fff]/.test(s))
    check(cjk.length === 0, '挂载点没有写死的中文字符串（实际 ' + cjk.length + ' 处）')
    const hookEvents = [...hookSrc.matchAll(/(?:fire|log)\s*\(\s*'(info|warn|debug|error)'\s*,\s*'([^']+)'/g)].map((m) => m[2])
    const known = new Set(['host.call', 'host.call.fail', 'panel.render'])
    const fresh = [...new Set(hookEvents)].filter((e) => !known.has(e))
    check(fresh.length === 0, '挂载点不新增事件名（实得 ' + [...new Set(hookEvents)].join('、') + '）')
  }

  // ---- 5) 文件粒度 ----
  for (const rel of [HOST, PAGE, 'src/client/kernel/styles.js']) {
    check(lines(rel) <= 350, rel + ' ' + lines(rel) + ' 行（上限 350）')
  }

  console.log(failed ? '\n存在失败' : '\n全部通过 — 待重启与更新弹窗委托门禁生效（' + total + ' 项断言）')
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error('门禁执行异常：' + ((e && e.stack) || e))
  process.exit(1)
})
