// verify-config-store-freshness.js — 配置读写核新鲜度门禁（#1012 落地）
// 规则（照 tests/verify-label-color-freshness.js 的形态）：
//   1) src/shared/config-store/src/ 每个 TS 转译后必须与 src/shared/config-store/ 下同名 JS 逐字一致；
//      改了 TS 没重新生成产物就变红（转译口径直接复用 src/shared/config-store/build.mjs 导出的同一个
//      函数 transpileUnit，两边永远不会漂移；UNITS 清单也是同一份，不手抄；
//      四个单元是 ports 空壳 + workspace / settings / labels 三份 schema，各自独立）。
//   2) tsc --noEmit 必须通过。
// 用法：node tests/verify-config-store-freshness.js（在仓库根目录）
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
let failed = false
const check = (ok, msg) => { console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

async function main() {
  console.log('配置读写核新鲜度门禁（#1012：TS 改了产物没跟上就红）')

  // ---- 1) 新鲜度：逐字一致（UNITS 与转译口径都复用构建脚本同一份） ----
  let transpileUnit
  let UNITS
  try {
    const buildMod = await import(pathToFileURL(path.join(ROOT, 'src', 'shared', 'config-store', 'build.mjs')).href)
    transpileUnit = buildMod.transpileUnit
    UNITS = buildMod.UNITS
    check(typeof transpileUnit === 'function', '构建脚本导出同一转译口径 transpileUnit')
    check(Array.isArray(UNITS) && UNITS.length === 4, '构建脚本导出 UNITS 清单（四项：ports + 三份 schema，不手抄）')
  } catch (e) {
    check(false, '构建脚本可加载（src/shared/config-store/build.mjs）：' + (e && e.message))
    console.log('\n存在失败')
    process.exit(1)
  }
  const units = UNITS.map((u) => ({ ts: 'src/shared/config-store/src/' + u.ts, js: 'src/shared/config-store/' + u.js }))
  for (const u of units) {
    const tsName = path.basename(u.ts)
    let expected
    try {
      expected = transpileUnit(tsName)
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

  // ---- 2) 插口空壳产物还带着模块标识（读导出值，不读文本）----
  //   ports 是空壳产物：类型被擦掉之后，它只剩这一行模块标识。把模块加载起来看导出值，
  //   就知道这个标识还在不在、指的是不是那份源码。不读文本、不钉写法。
  //   2026-10-12：原先这里有一条「读产物文本、断言里面出现 PORTS_SOURCE」的检查，断言对象是文本形状，
  //   按维护者要求撤掉；改成读导出值，问的还是同一件事（产物能不能追溯回源码）。
  try {
    const portsMod = await import(pathToFileURL(path.join(ROOT, 'src/shared/config-store/ports.js')).href)
    check(portsMod.PORTS_SOURCE === 'src/shared/config-store/src/ports.ts',
      '插口产物导出模块标识 PORTS_SOURCE（实得 ' + String(portsMod.PORTS_SOURCE) + '）')
  } catch (e) {
    check(false, '插口产物可加载（src/shared/config-store/ports.js）：' + (e && e.message))
  }

  // ---- 3) 类型检查 ----
  const tscBin = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc')
  if (!fs.existsSync(tscBin)) {
    check(false, 'typescript 已安装（node_modules/typescript 缺失，请跑 pnpm install）')
  } else {
    const r = spawnSync(process.execPath, [tscBin, '-p', path.join(ROOT, 'src', 'shared', 'config-store', 'tsconfig.json')], { encoding: 'utf8' })
    check(r.status === 0, 'tsc --noEmit 通过' + (r.status === 0 ? '' : '：' + ((r.stdout || '') + (r.stderr || '')).slice(0, 500)))
  }

  console.log(failed ? '\n存在失败' : '\n全部通过 — 配置读写核新鲜度门禁生效')
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error('门禁执行异常：' + ((e && e.stack) || e))
  process.exit(1)
})
