// verify-version-control-freshness.js — 版本控制核心新鲜度门禁（#816 落地）
// 规则：
//   1) version-control-core/src/ 每个 TS 转译后必须与 src/shared/version-control/ 下同名 JS
//      逐字一致；改了 TS 没重新生成产物就变红。转译口径直接复用 version-control-core/build.mjs
//      导出的同一个函数 transpileUnit；清单直接从同一脚本导出的 UNITS 读，不许手抄
//      （#822 要求：刷新核心的手抄清单漏过两个文件，教训在此）。
//   2) tsc --noEmit 必须通过。
//   3) 全部产物之间零相对引用（import type 转译后不留痕迹，同层互引门禁天然能过）。
//   4) 插口产物带模块标识 PORTS_SOURCE（类型擦掉后唯一可追溯来源的东西）。
// 本票没有把任何产物拼进客户端闭包，所以这里不查行首 export 与版本占位符；
// 将来哪一票真要拼，那一票把这两条检查加进来。
// 用法：node tests/verify-version-control-freshness.js（在仓库根目录）
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
let failed = false
const check = (ok, msg) => { console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^A-Za-z0-9_$:])\/\/.*$/gm, '$1')

async function main() {
  console.log('版本控制核心新鲜度门禁（#816：TS 改了产物没跟上就红）')

  let buildMod
  try {
    buildMod = await import(pathToFileURL(path.join(ROOT, 'version-control-core', 'build.mjs')).href)
    check(typeof buildMod.transpileUnit === 'function', '构建脚本导出同一转译口径 transpileUnit')
    check(Array.isArray(buildMod.UNITS) && buildMod.UNITS.length === 14, '构建脚本导出 UNITS 清单（14 项＝#816 的 11 项 + #841 的三项写路径纯函数，不手抄）')
  } catch (e) {
    check(false, '构建脚本可加载（version-control-core/build.mjs）：' + (e && e.message))
    console.log('\n存在失败')
    process.exit(1)
  }
  const UNITS = buildMod.UNITS.map((u) => ({ ts: 'version-control-core/src/' + u.ts, js: 'src/shared/version-control/' + u.js }))

  for (const u of UNITS) {
    const tsName = path.basename(u.ts)
    let expected
    try {
      expected = buildMod.transpileUnit(tsName)
    } catch (e) {
      check(false, u.ts + ' 转译成功：' + (e && e.message))
      continue
    }
    const jsAbs = path.join(ROOT, u.js)
    if (!fs.existsSync(jsAbs)) {
      check(false, u.js + ' 存在（请运行 node scripts/build.mjs 后提交）')
      continue
    }
    const actual = fs.readFileSync(jsAbs, 'utf8').replace(/\r\n/g, '\n')
    check(actual === expected, u.js + ' 与 ' + u.ts + ' 转译一致（不一致请跑 node scripts/build.mjs）')
  }

  let portsJs = ''
  try {
    portsJs = fs.readFileSync(path.join(ROOT, 'src/shared/version-control/ports.js'), 'utf8')
  } catch (e) {
    check(false, 'src/shared/version-control/ports.js 可读：' + (e && e.message))
  }
  if (portsJs) check(portsJs.includes('PORTS_SOURCE'), '插口产物带模块标识 PORTS_SOURCE（空壳可追溯）')

  // #845：每个产物都要带自己的模块标识（<文件名大写>_SOURCE，值指向它来自哪个 TS）。
  //   这条判据本来就该有：仓库里同类的三份门禁都在读各自的模块标识（label-color 的 PORTS_SOURCE、
  //   refresh 的 POLICY_SOURCE 与 WRITE_DETECT_SOURCE、版本控制自己的 RULES_SOURCE），只有这份新鲜度门禁
  //   只查了 ports.js 一处，剩下 12 个产物的标识谁都没读 → 被 verify-contract-vocabulary 判成
  //   「死了的常量」。读它一次，既把词汇救活，也把「产物能追溯回源码」这条钉住。
  for (const u of UNITS) {
    const jsAbs = path.join(ROOT, u.js)
    if (!fs.existsSync(jsAbs)) continue
    const base = path.basename(u.js, '.js')
    const constName = base.toUpperCase().replace(/[^A-Z0-9]+/g, '_') + '_SOURCE'
    let mod = null
    try { mod = await import(pathToFileURL(jsAbs).href) } catch (e) { check(false, u.js + ' 可导入（读模块标识用）：' + (e && e.message)); continue }
    check(mod[constName] === u.ts, u.js + ' 带模块标识 ' + constName + ' 且指向 ' + u.ts + '（实得 ' + String(mod[constName]) + '）')
  }

  for (const u of UNITS) {
    const abs = path.join(ROOT, u.js)
    if (!fs.existsSync(abs)) continue
    const code = stripComments(fs.readFileSync(abs, 'utf8'))
    check(!/from\s+['"]\.\.?[^'"]*['"]/.test(code) && !/import\s+['"]\.\.?[^'"]*['"]/.test(code),
      u.js + ' 零相对引用（自包含，同层互引门禁天然能过）')
  }

  const tscBin = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc')
  if (!fs.existsSync(tscBin)) {
    check(false, 'typescript 已安装（node_modules/typescript 缺失，请跑 pnpm install）')
  } else {
    const r = spawnSync(process.execPath, [tscBin, '-p', path.join(ROOT, 'version-control-core', 'tsconfig.json')], { encoding: 'utf8' })
    check(r.status === 0, 'tsc --noEmit 通过' + (r.status === 0 ? '' : '：' + ((r.stdout || '') + (r.stderr || '')).slice(0, 500)))
  }

  console.log(failed ? '\n存在失败' : '\n全部通过 — 版本控制核心新鲜度门禁生效')
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error('门禁执行异常：' + ((e && e.stack) || e))
  process.exit(1)
})
