// verify-ctx.js — dsh-mattpocock-skills-deck 阶段 2 步骤 1（#95）：Ctx 接线模块验证
// 验证：
//   1) src/client/kernel/ctx.js 模块可用：DswsCtx = React.createContext(null)（缺省值 null → Provider 缺失兜底）
//   2) createCx 产出 G3 冻结 8 字段（ctx/h/rdom/storeSvc/localeSvc/timer/api/router），值原样保留
//   3) createCx 缺项兜底为 null（防御性），字段数仍恒为 8
//   4) 构建产物（_dev client.js / _pkg package/lib/client.js）已注入 ctx 模块声明（一源两物）
//   5) 产物新鲜度门禁（缺失/过期 → FAIL，提示先构建；与 verify-tabsfold-leaf 同口径）
// 用法: node tests/verify-ctx.js（在插件根目录；先运行 node scripts/build.mjs 生成产物）
const fs = require('fs')
const path = require('path')
let failed = false
const check = (ok, msg) => { console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

const PRODUCTS = ['client.js', 'package/lib/client.js']
const SOURCES = ['src/client/kernel/ctx.js', 'src/client/index.js', 'scripts/build.mjs', 'package/package.json']

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

  // ---- 模块级：DswsCtx 缺省 null + createCx 8 字段 ----
  globalThis.React = { createContext: (v) => ({ _defaultValue: v, Provider: 'Provider' }) }
  const mod = await import('file://' + path.resolve('src/client/kernel/ctx.js').replace(/\\/g, '/'))
  check(typeof mod.DswsCtx === 'object' && mod.DswsCtx !== null, 'ctx.js 导出 DswsCtx')
  check(mod.DswsCtx && mod.DswsCtx._defaultValue === null, 'DswsCtx 缺省值 = null（Provider 缺失兜底）')
  check(typeof mod.createCx === 'function', 'ctx.js 导出 createCx')

  const FIELDS = ['ctx', 'h', 'rdom', 'storeSvc', 'localeSvc', 'timer', 'api', 'router']
  const sentinel = { tag: 'v' }
  const full = mod.createCx({
    ctx: sentinel, h: sentinel, rdom: sentinel, storeSvc: sentinel, localeSvc: sentinel,
    timer: sentinel, api: sentinel, router: sentinel,
  })
  const keys = Object.keys(full).sort()
  check(keys.join(',') === FIELDS.slice().sort().join(','), 'createCx 产出 8 字段冻结清单（G3 · #91）')
  check(FIELDS.every((k) => full[k] === sentinel), 'createCx 全量入参原样保留')
  const empty = mod.createCx({})
  check(Object.keys(empty).length === 8, 'createCx 缺项仍恒 8 字段')
  check(FIELDS.every((k) => empty[k] === null), 'createCx 缺项兜底为 null')
  check(Object.keys(mod.createCx(undefined)).length === 8, 'createCx(undefined) 不抛错且恒 8 字段')

  // ---- 产物已注入（双产物同构 · 一源两物）----
  const cli = fs.readFileSync('client.js', 'utf8')
  const pcli = fs.readFileSync('package/lib/client.js', 'utf8')
  const need = ['const DswsCtx = React.createContext(null)', 'function createCx(deps)', 'const cx = createCx(', 'withCx(OverlayPanel)', 'withCx(StatusBar)', 'withCx(RunPanel)', 'withCx(SettingsPage)', 'withCx(DetailsDock)']
  need.forEach((k) => {
    check(cli.includes(k) && pcli.includes(k), '产物(_dev)+(_pkg) 含 ' + k + '（' + (cli.includes(k) ? '✓' : '✗') + '/' + (pcli.includes(k) ? '✓' : '✗') + '）')
  })

  console.log(failed ? '\n存在失败' : '\n全部通过')
  process.exit(failed ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
