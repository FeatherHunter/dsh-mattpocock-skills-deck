// verify-update-mirror-hint.js — 镜像源滞后排障口径门禁（落地票 #645）
// 规则：面板手工命令下的提示（cfg.updateManualNote）中英成对，且两边都讲清镜像源滞后时不要去掉源参数。
// 用法：node tests/verify-update-mirror-hint.js（在仓库根目录）
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
let failed = false
const check = (ok, msg) => { console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

async function main() {
  console.log('镜像源滞后排障口径门禁（#645：提示讲清镜像源滞后时不要去掉源参数）')

  // ---- 面板提示中英成对且讲清滞后 ----
  const flowSrc = read('src/client/kernel/locale-flow.js')
  const times = flowSrc.split("'cfg.updateManualNote':").length - 1
  check(times === 2, '提示文案中英成对 cfg.updateManualNote（实际 ' + times + ' 处）')
  check(flowSrc.includes('镜像源还没同步'), '中文提示讲清镜像源还没同步')
  check(flowSrc.includes('不要去掉源参数'), '中文提示讲清这时不要去掉源参数')
  check(flowSrc.includes('has not synced the new release'), '英文提示讲清镜像源还没同步')
  check(flowSrc.includes('keep the registry parameter'), '英文提示讲清这时不要去掉源参数')

  if (failed) process.exit(1)
  console.log('全部通过')
}

main().catch((e) => { console.error('FAIL ' + (e && e.message || e)); process.exit(1) })
