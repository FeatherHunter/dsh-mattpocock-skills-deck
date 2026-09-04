#!/usr/bin/env node
// verify-strict-module-syntax.js —— src 全员严格模块解析门禁（#471）。
//
// 背景：2026-09-04 执行 #448 期间，新文件 sessionSnapshot.js 缺了一个 try 开头，
//   src 侧 node --check 全程放行（退出码 0），同一字节在 package/package.json（含 type module）
//   语境下被判为非法（catch 无匹配 try），构建门禁才拦下。同一字节在两种语境下判定结果相反，
//   本地快速检查全绿这个信号被高估了。
// 规则：对 src/ 下每一个 .js 文件，用仓库已有 esbuild 依赖做严格模块解析
//   （transformSync，loader js，format esm；比 scripts/build.mjs 的 gateSyntax 更严：
//   gateSyntax 对不含 export 的文件走 vm.Script 脚本语境，本门禁按票面要求对全员走 ESM），
//   失败即红。根 package.json 不加 type module（ tests 下几十个 require 脚本会连锁炸掉，否决）。
// 用法：node tests/verify-strict-module-syntax.js（在插件根目录）
const fs = require('fs')
const path = require('path')
const esbuild = require('esbuild')

const ROOT = path.resolve(__dirname, '..')
const SRC = path.join(ROOT, 'src')

let failed = false
function ok(msg) { console.log('  PASS ' + msg) }
function bad(msg) { failed = true; console.log('  FAIL ' + msg) }
function info(msg) { console.log('  INFO ' + msg) }

console.log('严格模块解析门禁：src/ 全员 esbuild ESM 解析（#471）')

// ---- 自检内存夹具：证明门禁本身能分辨合法与非法 ----
function selfCheck(cond, msg, detail) {
  if (cond) console.log('  PASS 自检：' + msg)
  else { failed = true; console.log('  FAIL 自检：' + msg + (detail ? '（' + detail + '）' : '')) }
}
{
  const valid = "export function foo() {\n  try { console.log(1) } catch {} \n}\n"
  let validOk = true
  try {
    esbuild.transformSync(valid, { loader: 'js', format: 'esm' })
  } catch (e) { validOk = false }
  selfCheck(validOk, '合法模块能过（try 配 catch 的导出函数）')

  // #448 实证形态：缺 try 开头，多一个 } catch（与 src/ 同字节在宽松侧放行，在严格侧必挂）
  const invalid = "export function foo(deps) {\n  async function bar() {\n    const x = 1\n      console.log(x)\n    } catch (e) {\n      console.log(e)\n    }\n  }\n}\n"
  let invalidCaught = false
  try {
    esbuild.transformSync(invalid, { loader: 'js', format: 'esm' })
  } catch (e) { invalidCaught = true }
  selfCheck(invalidCaught, '非法模块能红（缺 try 开头的 catch 块）')
}
if (failed) {
  console.log('\n自检失败 —— 门禁实现未通过内存夹具')
  process.exit(1)
}
console.log('  PASS 自检内存夹具全部通过')

// ---- 真实仓库扫描 ----
function listJsFiles() {
  const out = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.js')) out.push(full)
    }
  }
  walk(SRC)
  return out.sort()
}

const files = listJsFiles()
if (files.length === 0) {
  bad('src/ 下一个 .js 文件都没扫到（目录缺失或口径漂移），请检查扫描范围')
  console.log('\n存在失败')
  process.exit(1)
}
let passCount = 0
for (const abs of files) {
  const rel = path.relative(ROOT, abs).split(path.sep).join('/')
  let code
  try {
    code = fs.readFileSync(abs, 'utf8')
  } catch (e) {
    bad(rel + ' 读取失败：' + e.message)
    continue
  }
  try {
    esbuild.transformSync(code, { loader: 'js', format: 'esm' })
    passCount++
  } catch (e) {
    const first = String((e && e.message) || e).split('\n')[0]
    bad(rel + ' 严格解析失败：' + first)
  }
}

if (!failed) {
  ok('真实仓库全绿：' + passCount + ' 个 src/ 文件严格解析零失败（共扫 ' + files.length + ' 个）')
} else {
  info('已扫 ' + files.length + ' 个，通过 ' + passCount + ' 个')
}

if (failed) console.log('\n存在失败')
else console.log('\n全部通过')
process.exit(failed ? 1 : 0)
