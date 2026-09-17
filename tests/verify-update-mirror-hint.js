// verify-update-mirror-hint.js — 镜像源滞后排障口径门禁（落地票 #645）
// 规则：
//   1) 中英文说明的常见问题里都有镜像源滞后这一条：含报错关键字 No matching version、
//      镜像源名字 npmmirror、官方源地址字面量与显式走官方源的兜底命令（@latest + --registry）。
//   2) 面板手工命令下的提示（cfg.updateManualNote）中英成对且都讲清镜像源滞后时不要去掉源参数。
//   3) 插件自己拼出的安装与更新命令默认走官方源：两份派生物默认源地址为官方源，
//      命令构造路径里不出现镜像源字面量（以后谁把命令指向镜像就变红）。
//      禁止范围只收在命令构造路径，不扩到整棵源码树：以后若要在失败链路上按报错
//      地址认出镜像源错误（#645 评审结论），分类逻辑里写镜像源名字是合法的，不能被本门禁拦住。
// 用法：node tests/verify-update-mirror-hint.js（在仓库根目录）
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const OFFICIAL = 'https://registry.npmjs.org/'
let failed = false
const check = (ok, msg) => { console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

function walk(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name)
    const stat = fs.statSync(full)
    if (stat.isDirectory()) walk(full, out)
    else if (stat.isFile() && name.endsWith('.js')) out.push(full)
  }
  return out
}

async function main() {
  console.log('镜像源滞后排障口径门禁（#645：报错可查到原因、提示讲清不要去源参数、命令锁定官方源）')

  // ---- 1) 中英文说明覆盖 ----
  const zhReadme = read('README.md')
  check(zhReadme.includes('No matching version'), '中文说明含报错关键字 No matching version')
  check(zhReadme.includes('npmmirror'), '中文说明点名镜像源 npmmirror')
  check(zhReadme.includes('registry.npmjs.org'), '中文说明给出官方源地址')
  check(zhReadme.includes('dsh-mattpocock-skills-deck@latest --registry https://registry.npmjs.org'),
    '中文说明给出走官方源的兜底命令')
  const enReadme = read('docs/README.en.md')
  check(enReadme.includes('No matching version'), '英文说明含报错关键字 No matching version')
  check(enReadme.includes('npmmirror'), '英文说明点名镜像源 npmmirror')
  check(enReadme.includes('dsh-mattpocock-skills-deck@latest --registry https://registry.npmjs.org'),
    '英文说明给出走官方源的兜底命令')

  // ---- 2) 面板提示中英成对且讲清滞后 ----
  const flowSrc = read('src/client/kernel/locale-flow.js')
  const times = flowSrc.split("'cfg.updateManualNote':").length - 1
  check(times === 2, '提示文案中英成对 cfg.updateManualNote（实际 ' + times + ' 处）')
  check(flowSrc.includes('镜像源还没同步'), '中文提示讲清镜像源还没同步')
  check(flowSrc.includes('不要去掉源参数'), '中文提示讲清这时不要去掉源参数')
  check(flowSrc.includes('has not synced the new release'), '英文提示讲清镜像源还没同步')
  check(flowSrc.includes('keep the registry parameter'), '英文提示讲清这时不要去掉源参数')

  // ---- 3) 命令默认走官方源，源码树无镜像源字面量 ----
  for (const rel of ['src/shared/update/commands.js', 'src/host/updatePkg/commands.js']) {
    const src = read(rel)
    check(src.includes("NPM_REGISTRY = \"" + OFFICIAL + "\""), rel + ' 默认源地址为官方源')
  }
  const hits = []
  for (const sub of ['src/shared/update', 'src/host/updatePkg', 'packages/dsh-plugin-update/src']) {
    for (const full of walk(path.join(ROOT, sub), [])) {
      const text = fs.readFileSync(full, 'utf8')
      if (text.includes('npmmirror')) hits.push(path.relative(ROOT, full))
    }
  }
  check(hits.length === 0, '命令构造路径无镜像源字面量' + (hits.length ? '（命中 ' + hits.join('、') + '）' : ''))

  if (failed) process.exit(1)
  console.log('全部通过')
}

main().catch((e) => { console.error('FAIL ' + (e && e.message || e)); process.exit(1) })
