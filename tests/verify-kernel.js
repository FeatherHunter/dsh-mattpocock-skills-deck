// verify-kernel.js — dsh-mattpocock-skills-deck 阶段 2 内核迁移（#96 T3）：kernel 9 模块契约验证
// 验证：
//   1) kernel 9 模块文件存在且含预期导出（docs/architecture/kernel-contract.md · G3 冻结接口表）
//   2) 构建产物（_dev client.js / _pkg package/lib/client.js）已拼接全部模块（一源两物 · 无标记残留）
//   3) 双产物模块段关键特征一致（行为零变化证明）
//   4) 产物新鲜度门禁（缺失/过期 → FAIL，提示先构建；与 verify-ctx 同口径）
// 用法: node tests/verify-kernel.js（在插件根目录；先运行 node scripts/build.mjs 生成产物）
const fs = require('fs')
const path = require('path')
let failed = false
const check = (ok, msg) => { console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

const PRODUCTS = ['client.js', 'package/lib/client.js']
const MODULES = [
  { name: 'styles', exports: ['STYLE_TEXT'] },
  { name: 'portal', exports: ['RDOM', 'portalTop', 'PortalOverlay'] },
  { name: 'locale', exports: ['L'] },
  { name: 'icons', exports: ['ICON_SCHEMES', 'WORD_SCHEMES', 'Icon', 'Ic'] },
  { name: 'prompts', exports: ['PROMPTS', 'promptLang', 'promptText', 'BODY_FORMAT', 'completePrompt', 'FIXATE_PROMPT'] },
  { name: 'config', exports: ['CFG_KEY', 'cfg', 'templates', 'migrateStartCfg', 'TPL_DEFAULT', 'renderTemplate', 'validateTemplate'] },
  { name: 'store', exports: ['DEFAULT_PANEL_H', 'makeStore', 'shared', 'stores', 'storeOf', 'emit', 'sub', 'useStore', 'compute', 'ensureNoRepoCard', 'mkRowAction', 'timeStampStr'] },
  { name: 'probe', exports: ['loadChain', 'chainSteps', 'chainStep', 'readyCount', 'envTotal', 'envLabel', 'setupCheck', 'loadSnapshot', 'probeNow', 'startAutoProbe', 'refreshAll', 'diffSnapshots', 'snapFresh', 'broadcastCfg'] },
  { name: 'router', exports: ['openPagePanel', 'openDockPanel', 'openPanel', 'togglePanel', 'ensureSidebarTab', 'repoStr', 'startText', 'newWayfinderText', 'newBugWayfinderText'] },
  { name: 'api', exports: ['injectFixate', 'probeHandoffReady', 'doHandoff', 'doHandoffOpen', 'openTextInNewSession', 'inject', 'copyText', 'pendingDraft'] },
  { name: 'actions', exports: ['createActionDispatcher'] },
]
const SOURCES = [
  'src/client/index.js', 'scripts/build.mjs', 'package/package.json',
  ...MODULES.map((m) => 'src/client/kernel/' + m.name + '.js'),
]

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

async function main() {
  // ---- 产物新鲜度门禁 ----
  PRODUCTS.forEach((p) => {
    const why = productStale(p)
    check(!why, '产物门禁 ' + p + (why ? '：' + why : '（存在且新鲜）'))
  })
  if (failed) { console.log('\n存在失败'); process.exit(1) }

  // ---- 模块文件 + 导出齐全 ----
  for (const m of MODULES) {
    const file = 'src/client/kernel/' + m.name + '.js'
    if (!fs.existsSync(file)) { check(false, m.name + '.js 缺失'); continue }
    const src = fs.readFileSync(file, 'utf8')
    for (const ex of m.exports) {
      const ok = new RegExp('export\\s+(const|let|function|var)\\s+' + ex + '\\b').test(src)
      check(ok, m.name + '.js 导出 ' + ex)
    }
  }

  // ---- 产物已拼接（无标记残留 + 关键导出在双产物）----
  const cli = fs.readFileSync('client.js', 'utf8')
  const pcli = fs.readFileSync('package/lib/client.js', 'utf8')
  for (const m of MODULES) {
    check(!cli.includes('kernel:' + m.name + ' (spliced') && !pcli.includes('kernel:' + m.name + ' (spliced'),
      '双产物无 ' + m.name + ' 拼接标记残留')
  }
  const spot = [
    ['const STYLE_TEXT = [', 'const portalTop = function', 'const L = {', 'const Ic = ({ n', 'const PROMPTS = {', 'const cfg = (function', 'const shared = makeStore()', 'const loadSnapshot = function', 'const openPanel = function', 'const inject = (st, text)'],
  ][0]
  spot.forEach((k) => {
    check(cli.includes(k) && pcli.includes(k), '双产物含 ' + k.slice(0, 30) + '…（' + (cli.includes(k) ? '✓' : '✗') + '/' + (pcli.includes(k) ? '✓' : '✗') + '）')
  })

  // ---- index.js 无残留大块（模块代码已全部迁出，只剩组件区 + 装配）----
  const idx = fs.readFileSync('src/client/index.js', 'utf8')
  check(!idx.includes('const PROMPTS = {'), 'src/client/index.js 已不含 PROMPTS（迁出 prompts.js）')
  check(!idx.includes('const makeStore = () =>'), 'src/client/index.js 已不含 makeStore（迁出 store.js）')

  console.log(failed ? '\n存在失败' : '\n全部通过')
  process.exit(failed ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })