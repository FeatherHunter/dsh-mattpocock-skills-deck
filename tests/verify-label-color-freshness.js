// verify-label-color-freshness.js — 配色核心新鲜度门禁（#629 落地）
// 规则：
//   1) label-color-core/src/ 每个 TS 转译后必须与 src/shared/label-color/ 下同名 JS 逐字一致；
//      改了 TS 没重新生成产物就变红（转译口径直接复用 label-color-core/build.mjs 导出的同一个
//      函数 transpileUnit，两边永远不会漂移）。
//   2) tsc --noEmit 必须通过（形态照 update-core：转译之外另做类型检查）。
//   3) 三个产物之间零相对引用（同层互引门禁天然能过，产物自身也真的自包含）。
//   4) 拼进客户端闭包的两个产物满足两条边界条件：要用的东西都带行首 export（构建靠去掉
//      行首那七个字符把声明体贴进闭包），并且不含 __DSW_VERSION__ 与 __DSW_REPO_URL__
//      两个占位符（拼接发生在版本注入之后，拼进来的文本不会再过一遍注入）。
//   5) 插口空壳产物里还留着模块标识 PORTS_SOURCE（类型被擦掉之后唯一能追溯来源的东西）。
// 用法：node tests/verify-label-color-freshness.js（在仓库根目录）
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
let failed = false
const check = (ok, msg) => { console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

const UNITS = [
  { ts: 'label-color-core/src/ports.ts', js: 'src/shared/label-color/ports.js' },
  { ts: 'label-color-core/src/colors.ts', js: 'src/shared/label-color/colors.js' },
  { ts: 'label-color-core/src/prompt.ts', js: 'src/shared/label-color/prompt.js' },
]

// 去掉块注释与整行注释之后再找相对 import，避免把注释里的示例当成真的引用（写法同 verify-update-freshness.js）。
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^A-Za-z0-9_$:])\/\/.*$/gm, '$1')

async function main() {
  console.log('配色核心新鲜度门禁（#629：TS 改了产物没跟上就红）')

  // ---- 1) 新鲜度：逐字一致 ----
  let transpileUnit
  try {
    const buildMod = await import(pathToFileURL(path.join(ROOT, 'label-color-core', 'build.mjs')).href)
    transpileUnit = buildMod.transpileUnit
    check(typeof transpileUnit === 'function', '构建脚本导出同一转译口径 transpileUnit')
  } catch (e) {
    check(false, '构建脚本可加载（label-color-core/build.mjs）：' + (e && e.message))
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

  // ---- 2) 产物自身的三条边界条件 ----
  const portsJs = fs.readFileSync(path.join(ROOT, 'src/shared/label-color/ports.js'), 'utf8')
  check(portsJs.includes('PORTS_SOURCE'), '插口产物带模块标识 PORTS_SOURCE（空壳可追溯）')

  // 只有这两个产物会被 scripts/build.mjs 拼进客户端闭包（SHARED_SPLICE 清单里的两条）。
  const SPLICED = ['src/shared/label-color/colors.js', 'src/shared/label-color/prompt.js']
  for (const rel of UNITS.map((u) => u.js)) {
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8')
    const code = stripComments(text)
    check(!/from\s+['"]\.\.?[^'"]*['"]/.test(code) && !/import\s+['"]\.\.?[^'"]*['"]/.test(code),
      rel + ' 零相对引用（自包含，同层互引门禁天然能过）')
  }
  for (const rel of SPLICED) {
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8')
    const declared = text.split('\n').filter((l) => /^export\s+(?:async\s+)?(?:function|const|let|var|class)\s+/.test(l)).length
    check(declared > 0, rel + ' 要用的东西都带行首 export（拼进闭包靠去掉行首那七个字符）')
    check(!text.includes('__DSW_VERSION__') && !text.includes('__DSW_REPO_URL__'),
      rel + ' 不含版本与仓库地址两个占位符（拼接不会再过一遍注入）')
  }

  // ---- 3) 类型检查 ----
  const tscBin = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc')
  if (!fs.existsSync(tscBin)) {
    check(false, 'typescript 已安装（node_modules/typescript 缺失，请跑 pnpm install）')
  } else {
    const r = spawnSync(process.execPath, [tscBin, '-p', path.join(ROOT, 'label-color-core', 'tsconfig.json')], { encoding: 'utf8' })
    check(r.status === 0, 'tsc --noEmit 通过' + (r.status === 0 ? '' : '：' + ((r.stdout || '') + (r.stderr || '')).slice(0, 500)))
  }

  console.log(failed ? '\n存在失败' : '\n全部通过 — 配色核心新鲜度门禁生效')
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error('门禁执行异常：' + ((e && e.stack) || e))
  process.exit(1)
})
