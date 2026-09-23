// verify-refresh-freshness.js — 刷新核心新鲜度门禁（#720 落地）
// 规则：
//   1) refresh-core/src/ 每个 TS 转译后必须与 src/shared/refresh/ 下同名 JS 逐字一致；
//      改了 TS 没重新生成产物就变红（转译口径直接复用 refresh-core/build.mjs 导出的同一个
//      函数 transpileUnit，两边永远不会漂移）。
//   2) tsc --noEmit 必须通过（形态照 update-core 与 label-color-core：转译之外另做类型检查）。
//   3) 两个产物之间零相对引用（同层互引门禁天然能过，产物自身也真的自包含）。
//   4) 插口空壳产物里还留着模块标识 PORTS_SOURCE（类型被擦掉之后唯一能追溯来源的东西）。
// 本票没有把任何产物拼进客户端闭包，所以这里不查「行首 export」与「不含版本占位符」两条边界条件；
// 将来哪一票真要拼，那一票把这两条检查加进来（做法见 label-color-core 的同名门禁）。
// 用法：node tests/verify-refresh-freshness.js（在仓库根目录）
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
let failed = false
const check = (ok, msg) => { console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

const UNITS = [
  { ts: 'refresh-core/src/ports.ts', js: 'src/shared/refresh/ports.js' },
  { ts: 'refresh-core/src/budget.ts', js: 'src/shared/refresh/budget.js' },
  // #711 加的第三份：创建幂等锚。与上面两份同一口径 —— 改了 TS 没重新生成产物就红。
  { ts: 'refresh-core/src/idempotency.ts', js: 'src/shared/refresh/idempotency.js' },
  // #706（T2）加的第四份：闸的裁决纯函数。同一口径。
  { ts: 'refresh-core/src/policy.ts', js: 'src/shared/refresh/policy.js' },
]

// 去掉块注释与整行注释之后再找相对 import，避免把注释里的示例当成真的引用（写法同 verify-update-freshness.js）。
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^A-Za-z0-9_$:])\/\/.*$/gm, '$1')

async function main() {
  console.log('刷新核心新鲜度门禁（#720：TS 改了产物没跟上就红）')

  // ---- 1) 新鲜度：逐字一致 ----
  let transpileUnit
  try {
    const buildMod = await import(pathToFileURL(path.join(ROOT, 'refresh-core', 'build.mjs')).href)
    transpileUnit = buildMod.transpileUnit
    check(typeof transpileUnit === 'function', '构建脚本导出同一转译口径 transpileUnit')
  } catch (e) {
    check(false, '构建脚本可加载（refresh-core/build.mjs）：' + (e && e.message))
    console.log('\n存在失败')
    process.exit(1)
  }
  for (const u of UNITS) {
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

  // ---- 2) 产物自身的两条硬条件 ----
  let portsJs = ''
  try {
    portsJs = fs.readFileSync(path.join(ROOT, 'src/shared/refresh/ports.js'), 'utf8')
  } catch (e) {
    check(false, 'src/shared/refresh/ports.js 可读：' + (e && e.message))
  }
  if (portsJs) check(portsJs.includes('PORTS_SOURCE'), '插口产物带模块标识 PORTS_SOURCE（空壳可追溯）')

  for (const rel of UNITS.map((u) => u.js)) {
    const abs = path.join(ROOT, rel)
    if (!fs.existsSync(abs)) continue
    const code = stripComments(fs.readFileSync(abs, 'utf8'))
    check(!/from\s+['"]\.\.?[^'"]*['"]/.test(code) && !/import\s+['"]\.\.?[^'"]*['"]/.test(code),
      rel + ' 零相对引用（自包含，同层互引门禁天然能过）')
  }

  // ---- 3) 类型检查 ----
  const tscBin = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc')
  if (!fs.existsSync(tscBin)) {
    check(false, 'typescript 已安装（node_modules/typescript 缺失，请跑 pnpm install）')
  } else {
    const r = spawnSync(process.execPath, [tscBin, '-p', path.join(ROOT, 'refresh-core', 'tsconfig.json')], { encoding: 'utf8' })
    check(r.status === 0, 'tsc --noEmit 通过' + (r.status === 0 ? '' : '：' + ((r.stdout || '') + (r.stderr || '')).slice(0, 500)))
  }

  console.log(failed ? '\n存在失败' : '\n全部通过 — 刷新核心新鲜度门禁生效')
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error('门禁执行异常：' + ((e && e.stack) || e))
  process.exit(1)
})
