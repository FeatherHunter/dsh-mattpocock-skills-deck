// verify-tabsfold-leaf.js — dsh-mattpocock-skills-deck 阶段 1：client 折叠机器纯函数叶子差分测试
// T1（#94）迁移：断言目标从「内联副本」改为「构建产物」——client.js / package/lib/client.js 现由
//   scripts/build.mjs 生成（一源出两物，gitignore 可变产物），本测试验证「叶子 === 构建产物」：
//   T0 接管后构建未改变叶子行为，叶子仍为唯一真源 + 测试基准。
// 用法: node tests/verify-tabsfold-leaf.js（在插件根目录；先运行 node scripts/build.mjs 生成产物）
// 验证：1) src/client/kernel/tabsfold.js 叶子可用 + 行为真值表（#15 e0f31ac 等级机器）
//       2) 产物新鲜度门禁（缺失/过期 → FAIL，提示先构建；防止陈旧产物假绿）
//       3) 叶子 === _dev 产物（根 client.js）——「构建未改变叶子行为」探测器
//       4) 叶子 === _pkg 产物（package/lib/client.js）
//       5) 文本逐字断言：产物内 tabsLevelDecide 文本 === src/client/index.js 内联
//       6) 双源镜像特征（文本镜像断言，T5 #98 统一删除）
const fs = require('fs')
const path = require('path')
let failed = false
const check = (ok, msg) => { console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

// ---- 产物清单与驱动重建的源（T1：断言目标必须是「当前构建产物」，而非磁盘任意文件）----
const PRODUCTS = ['client.js', 'package/lib/client.js']
// T2（#95）：Ctx 接线后 src/client/kernel/ctx.js 也是驱动重建的源 —— 进新鲜度门禁，防陈旧产物假绿
const SOURCES = ['src/client/index.js', 'src/client/kernel/ctx.js', 'scripts/build.mjs', 'package/package.json']

function productStale(prod) {
  if (!fs.existsSync(prod)) return '缺失（请先运行 node scripts/build.mjs）'
  const pm = fs.statSync(prod).mtimeMs
  for (const s of SOURCES) {
    if (fs.existsSync(s) && fs.statSync(s).mtimeMs > pm + 1000) {
      return '过期（' + s + ' 比产物新，请重新运行 node scripts/build.mjs）'
    }
  }
  return null
}

// 从源码抽取内联 tabsLevelDecide（去掉 const 前缀；函数体引用 TABS_FOLD_HYST，注入到求值作用域）
const grab = (src) => {
  const m = src.match(/const tabsLevelDecide\s*=\s*(function[^{]*\{[\s\S]*?\})/)
  if (!m) return null
  return eval('(function(){var TABS_FOLD_HYST=4; return (' + m[1] + ')})()')
}

// 文本原样抽取（Part E 逐字断言用，不做 eval）
const rawGrab = (src) => {
  const m = src.match(/const tabsLevelDecide\s*=\s*(function[^{]*\{[\s\S]*?\})/)
  return m ? m[0] : ''
}

async function main() {
  // ---- 产物新鲜度门禁（T1：先于一切断言，缺失/过期直接 FAIL）----
  PRODUCTS.forEach((p) => {
    const why = productStale(p)
    check(!why, '产物门禁 ' + p + (why ? '：' + why : '（存在且新鲜）'))
  })
  if (failed) { console.log('\n存在失败'); process.exit(1) }

  const cli = fs.readFileSync('client.js', 'utf8')
  const pcli = fs.readFileSync('package/lib/client.js', 'utf8')
  const srcClient = fs.readFileSync('src/client/index.js', 'utf8')

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

  // ---- 差分：叶子 === _dev 产物（根 client.js）----
  const hostD = grab(cli)
  check(!!hostD, '产物(_dev) client.js 含 tabsLevelDecide（对照基准）')
  if (hostD) {
    const cases = [[0, 500], [0, 400], [0, 350], [0, 280], [0, 80], [1, 500], [1, 430], [1, 474], [2, 350], [2, 500], [2, 280]]
    cases.forEach((c) => {
      const got = leaf.tabsLevelDecide(c[0], c[1], nats)
      const exp = hostD(c[0], c[1], nats)
      check(got === exp, 'diff tabsLevelDecide(' + c[0] + ',' + c[1] + ') 叶子(' + got + ')===产物(_dev)(' + exp + ')')
    })
  }

  // ---- 差分：叶子 === _pkg 产物（package/lib/client.js）----
  const pkgD = grab(pcli)
  check(!!pkgD, '产物(_pkg) package/lib/client.js 含 tabsLevelDecide（对照基准）')
  if (pkgD) {
    const cases = [[0, 400], [0, 280], [1, 474], [2, 500]]
    cases.forEach((c) => {
      const got = leaf.tabsLevelDecide(c[0], c[1], nats)
      const exp = pkgD(c[0], c[1], nats)
      check(got === exp, 'diff tabsLevelDecide(' + c[0] + ',' + c[1] + ') 叶子(' + got + ')===产物(_pkg)(' + exp + ')')
    })
  }

  // ---- Part E：文本逐字断言（T1 新增；构建 = 文本组合，产物内 tabsLevelDecide 必须与 src 内联逐字一致）----
  const srcT = rawGrab(srcClient)
  const devT = rawGrab(cli)
  const pkgT = rawGrab(pcli)
  check(!!srcT && !!devT && !!pkgT, '文本抽取：src/两产物均含 tabsLevelDecide 文本')
  check(srcT === devT, '文本逐字：产物(_dev) tabsLevelDecide === src/client/index.js 内联')
  check(srcT === pkgT, '文本逐字：产物(_pkg) tabsLevelDecide === src/client/index.js 内联')

  // ---- 双源镜像特征已移除（T5 #98：由 src↔产物逐字 + 冒烟取代）----

  console.log(failed ? '\n存在失败' : '\n全部通过')
  process.exit(failed ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
