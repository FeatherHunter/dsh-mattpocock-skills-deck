// verify-config-store-freshness.js — 配置读写核新鲜度门禁（#1012 落地）
// 规则（照 tests/verify-label-color-freshness.js 的形态）：
//   1) config-store-core/src/ 每个 TS 转译后必须与 src/shared/config-store/ 下同名 JS 逐字一致；
//      改了 TS 没重新生成产物就变红（转译口径直接复用 config-store-core/build.mjs 导出的同一个
//      函数 transpileUnit，两边永远不会漂移；UNITS 清单也是同一份，不手抄；
//      四个单元是 ports 空壳 + workspace / settings / labels 三份 schema，各自独立）。
//   2) tsc --noEmit 必须通过。
//   3) 产物之间零相对引用（同层互引门禁天然能过；单元里连裸包引用都没有，YAML 只在宿主适配器里用）。
//   4) 要用的东西都带行首 export，并且不含 __DSW_VERSION__ 与 __DSW_REPO_URL__ 两个占位符。
//   5) 插口空壳产物里还留着模块标识 PORTS_SOURCE（类型被擦掉之后唯一能追溯来源的东西）。
//   6) 单元数钉死四个：多一个少一个都说明有人绕过清单手加文件。
// 用法：node tests/verify-config-store-freshness.js（在仓库根目录）
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
let failed = false
const check = (ok, msg) => { console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

// 去掉块注释与整行注释之后再找相对 import，避免把注释里的示例当成真的引用（写法同其它核）。
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^A-Za-z0-9_$:])\/\/.*$/gm, '$1')

async function main() {
  console.log('配置读写核新鲜度门禁（#1012：TS 改了产物没跟上就红）')

  // ---- 1) 新鲜度：逐字一致（UNITS 与转译口径都复用构建脚本同一份） ----
  let transpileUnit
  let UNITS
  try {
    const buildMod = await import(pathToFileURL(path.join(ROOT, 'config-store-core', 'build.mjs')).href)
    transpileUnit = buildMod.transpileUnit
    UNITS = buildMod.UNITS
    check(typeof transpileUnit === 'function', '构建脚本导出同一转译口径 transpileUnit')
    check(Array.isArray(UNITS) && UNITS.length === 4, '构建脚本导出 UNITS 清单（四项：ports + 三份 schema，不手抄）')
  } catch (e) {
    check(false, '构建脚本可加载（config-store-core/build.mjs）：' + (e && e.message))
    console.log('\n存在失败')
    process.exit(1)
  }
  const units = UNITS.map((u) => ({ ts: 'config-store-core/src/' + u.ts, js: 'src/shared/config-store/' + u.js }))
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

  // ---- 2) 产物自身的边界条件 ----
  const portsJs = fs.readFileSync(path.join(ROOT, 'src/shared/config-store/ports.js'), 'utf8')
  check(portsJs.includes('PORTS_SOURCE'), '插口产物带模块标识 PORTS_SOURCE（空壳可追溯）')

  for (const u of units) {
    const text = fs.readFileSync(path.join(ROOT, u.js), 'utf8')
    const code = stripComments(text)
    check(!/from\s+['"]\.\.?[^'"]*['"]/.test(code) && !/import\s+['"]\.\.?[^'"]*['"]/.test(code),
      u.js + ' 零相对引用（自包含，同层互引门禁天然能过；裸包 yaml 不算）')
    const declared = text.split('\n').filter((l) => /^export\s+(?:async\s+)?(?:function|const|let|var|class)\s+/.test(l)).length
    check(declared > 0, u.js + ' 要用的东西都带行首 export')
    check(!text.includes('__DSW_VERSION__') && !text.includes('__DSW_REPO_URL__'),
      u.js + ' 不含版本与仓库地址两个占位符')
  }

  // ---- 3) 类型检查 ----
  const tscBin = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc')
  if (!fs.existsSync(tscBin)) {
    check(false, 'typescript 已安装（node_modules/typescript 缺失，请跑 pnpm install）')
  } else {
    const r = spawnSync(process.execPath, [tscBin, '-p', path.join(ROOT, 'config-store-core', 'tsconfig.json')], { encoding: 'utf8' })
    check(r.status === 0, 'tsc --noEmit 通过' + (r.status === 0 ? '' : '：' + ((r.stdout || '') + (r.stderr || '')).slice(0, 500)))
  }

  console.log(failed ? '\n存在失败' : '\n全部通过 — 配置读写核新鲜度门禁生效')
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error('门禁执行异常：' + ((e && e.stack) || e))
  process.exit(1)
})
