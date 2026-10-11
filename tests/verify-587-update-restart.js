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
//
// 【2026-10-12 清理】上面 1)～4) 原先是一条条读文件文本去断的：面板挂载点与配置页的源码里必须出现哪些
//   字面量、两份构建产物里必须出现哪个标识符、源码里不许出现哪个词、挂载点里有没有写死的中文与事件名……
//   断言的对象都是文件文本，改个写法、搬一次文件、把文件转成 TypeScript、构建换个输出，都会让它变红。
//   按维护者「清掉读源码文本钉形状的门禁」的要求，这些断言连同只服务它们的读取与文本处理（read / strip
//   两个辅助、外部包与产物的路径常量）一并撤掉；上面那几条约定的实质结论现在由人工评审与包里自带面板的
//   行为守着。留下的是两类完全不看文本的：文件存在性（旧面板三件确实不在了）与文件行数上限。
// 用法：node tests/verify-587-update-restart.js（在仓库根目录）
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const exists = (rel) => fs.existsSync(path.join(ROOT, rel))
const lines = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').split(/\r?\n/).length

const HOST = 'src/client/views/UpdateEntryHost.js'
const PAGE = 'src/client/views/SettingsPage.js'

async function main() {
  console.log('待重启与更新弹窗委托门禁（#876 搭架 + #877 档案卷皮肤：本仓无自带横幅弹窗 + 文件粒度）')

  // ---- 1) 本仓无自带横幅与弹窗，包内覆盖 ----
  for (const rel of ['src/client/views/useUpdatePanel.js', 'src/client/views/UpdateDialog.js', 'src/client/views/UpdateRestartBanner.js']) {
    check(!exists(rel), '自有实现已删：' + rel)
  }

  // ---- 2) 文件粒度 ----
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
