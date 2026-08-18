// verify-tabsfold-leaf.js — dsh-mattpocock-skills-deck 阶段 1：client 折叠机器纯函数叶子差分测试
// 用法: node tests/verify-tabsfold-leaf.js（在插件根目录）
// 验证：1) src/client/kernel/tabsfold.js 叶子可用 + 行为真值表（#15 e0f31ac 等级机器）
//       2) 叶子版 === client.js 内联版（同一批输入逐字节一致）——「搬坏」探测器
//       3) 叶子版 === package/lib/client.js 内联版 同逻辑
//       4) 双源镜像特征 + 常量（TABS_FOLD_HYST / TABS_LEVELS）
const fs = require('fs')
const path = require('path')
let failed = false
const check = (ok, msg) => { console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

const cli = fs.readFileSync('client.js', 'utf8')
const pcli = fs.readFileSync('package/lib/client.js', 'utf8')

// 从源码抽取内联 tabsLevelDecide（去掉 const 前缀；函数体引用 TABS_FOLD_HYST，注入到求值作用域）
const grab = (src) => {
  const m = src.match(/const tabsLevelDecide\s*=\s*(function[^{]*\{[\s\S]*?\})/)
  if (!m) return null
  return eval('(function(){var TABS_FOLD_HYST=4; return (' + m[1] + ')})()')
}

async function main() {
  const leaf = await import('file://' + path.resolve('src/client/kernel/tabsfold.js').replace(/\\/g, '/'))
  check(typeof leaf.tabsLevelDecide === 'function', '叶子导出 tabsLevelDecide')
  check(leaf.TABS_FOLD_HYST === 4, '叶子 TABS_FOLD_HYST = 4')
  check(leaf.TABS_LEVELS === 3, '叶子 TABS_LEVELS = 3')

  // ---- 行为真值表（与 verify-tabs-narrow 的 11 项一致，防「两边一起错」）----
  const nats = [470, 380, 200] // L0 自然宽 470 · L1 380 · L2 200
  const d = leaf.tabsLevelDecide
  check(d(0, 500, nats) === 0, '真值 (0,500)=0 宽裕保持 L0')
  check(d(0, 400, nats) === 1, '真值 (0,400)=1 L0 放不下→L1')
  check(d(0, 350, nats) === 2, '真值 (0,350)=2 L0/L1 均放不下→L2（nats=[470,380,200]，350<380）')
  check(d(0, 280, nats) === 2, '真值 (0,280)=2 L1 也不够→L2')
  check(d(0, 80, nats) === 2, '真值 (0,80)=2 极窄顶格 L2')
  check(d(1, 500, nats) === 0, '真值 (1,500)=0 L1 空间回够→降回 L0')
  check(d(1, 430, nats) === 1, '真值 (1,430)=1 滞回带内保持 L1 防抖')
  check(d(1, 474, nats) === 0, '真值 (1,474)=0 恰好 L0+4→降回 L0')
  check(d(2, 350, nats) === 2, '真值 (2,350)=2 L2 起且空间不足 L1+4→保持 L2')
  check(d(2, 500, nats) === 0, '真值 (2,500)=0 L2 空间够 L0→回 L0')
  check(d(2, 280, nats) === 2, '真值 (2,280)=2 仍放不下保持 L2')
  check(d(0, 400, []) === 0, '真值 nats 空保护→0')
  check(d(0, 400, null) === 0, '真值 nats null 保护→0')

  // ---- 差分：叶子 === client.js（动态版）----
  const hostD = grab(cli)
  check(!!hostD, 'client.js 含内联 tabsLevelDecide（对照基准）')
  if (hostD) {
    const cases = [[0, 500], [0, 400], [0, 350], [0, 280], [0, 80], [1, 500], [1, 430], [1, 474], [2, 350], [2, 500], [2, 280]]
    cases.forEach((c) => {
      const got = leaf.tabsLevelDecide(c[0], c[1], nats)
      const exp = hostD(c[0], c[1], nats)
      check(got === exp, 'diff tabsLevelDecide(' + c[0] + ',' + c[1] + ') 叶子(' + got + ')===client(' + exp + ')')
    })
  }

  // ---- 差分：叶子 === package/lib/client.js（npm 版）----
  const pkgD = grab(pcli)
  check(!!pkgD, 'package/lib/client.js 含内联 tabsLevelDecide（对照基准）')
  if (pkgD) {
    const cases = [[0, 400], [0, 280], [1, 474], [2, 500]]
    cases.forEach((c) => {
      const got = leaf.tabsLevelDecide(c[0], c[1], nats)
      const exp = pkgD(c[0], c[1], nats)
      check(got === exp, 'diff tabsLevelDecide(' + c[0] + ',' + c[1] + ') 叶子(' + got + ')===package(' + exp + ')')
    })
  }

  // ---- 双源镜像特征 ----
  const HYST_OK = cli.includes('TABS_FOLD_HYST = 4') && pcli.includes('TABS_FOLD_HYST = 4')
  const LV_OK = cli.includes('TABS_LEVELS = 3') && pcli.includes('TABS_LEVELS = 3')
  check(HYST_OK, '双源含 TABS_FOLD_HYST = 4')
  check(LV_OK, '双源含 TABS_LEVELS = 3')
  check(cli.includes('tabsLevelDecide'), 'client.js 含 tabsLevelDecide')
  check(pcli.includes('tabsLevelDecide'), 'package/lib/client.js 含 tabsLevelDecide')

  console.log(failed ? '\n存在失败' : '\n全部通过')
  process.exit(failed ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
