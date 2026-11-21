// verify-ts-hook-esm-require.ts —— 门禁：钩子必须拦到「Node 以 ESM 加载器装载的 .ts 里对 .js 兄弟模块的 require」。
//
// 故障（票 #6）：Node 24.15 上，入口 .ts 无论自身是 CJS 还是 ESM 写法，都先经 ESM 加载器装载；
// 其中 CJS 格式的 .ts 由加载器内的 loadCJSModule 转译执行，它内部用的那个 require 直接调
// Module._resolveFilename，不经过 registerHooks 挂的 resolve 链——所以 scripts/ts-hook.mts 只靠
// registerHooks 拦不到这一路，tests/verify-deck-tools.ts 这类「顶层 require('./lib/xxx.js')」的门禁
// 全数以 MODULE_NOT_FOUND 报红（基线上 133 扇同一症状）。修复是在钩子里补一层
// Module._resolveFilename 的改写（见 ts-hook.mts 同日注释）；本门禁在临时目录里钉住这一装载路径。
//
// 用法：node --import ./scripts/ts-hook.mts tests/verify-ts-hook-esm-require.ts（链上自动挂钩）。
const { spawnSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { pathToFileURL } = require('url')

let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

const ROOT = path.resolve(__dirname, '..')
const HOOK = path.join(ROOT, 'scripts', 'ts-hook.mts')

// 两套夹具都只给 .ts 兄弟模块或只给 .js 兄弟模块，分别钉「改写生效」与「无同名 .ts 时原样放行」。
const fixtureTsGate = [
  "const { helper } = require('./helper.js')",
  "console.log('helper=' + helper)",
  "",
].join('\n')
const fixtureHelperTs = "export const helper = 'from-helper-ts'\n"
// 这份故意只有 .js 兄弟：钩子必须不碰它，让 CJS require 照常加载 .js。
const fixtureJsOnlyGate = [
  "const { plain } = require('./plain.js')",
  "console.log('plain=' + plain)",
  "",
].join('\n')
const fixturePlainJs = "exports.plain = 'from-plain-js'\n"

function runGate(gateName, gateSource, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-hook-esm-require-'))
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content)
  fs.writeFileSync(path.join(dir, gateName), gateSource)
  const r = spawnSync(process.execPath, ['--import', pathToFileURL(HOOK).href, path.join(dir, gateName)], {
    encoding: 'utf8',
    timeout: 30000,
  })
  fs.rmSync(dir, { recursive: true, force: true })
  return r
}

// 例一：CJS 格式的 .ts 入口 require('./helper.js')，同目录只有 helper.ts —— 必须改写加载到 .ts。
{
  const r = runGate('gate.ts', fixtureTsGate, { 'helper.ts': fixtureHelperTs })
  const out = (r.stdout || '') + (r.stderr || '')
  check(r.status === 0 && out.includes('helper=from-helper-ts'),
    'ESM 加载器装载的 .ts 里 require("./x.js") 被改指同名 .ts（status=' + r.status + ' out=' + out.trim().split('\n').slice(-3).join(' | ') + ')')
}

// 例二：同目录只有 plain.js、没有 plain.ts —— 必须原样加载 .js，行为与没挂钩子一样。
{
  const r = runGate('gate.ts', fixtureJsOnlyGate, { 'plain.js': fixturePlainJs })
  const out = (r.stdout || '') + (r.stderr || '')
  check(r.status === 0 && out.includes('plain=from-plain-js'),
    '无同名 .ts 时 require("./x.js") 原样加载 .js（status=' + r.status + ' out=' + out.trim().split('\n').slice(-3).join(' | ') + ')')
}

console.log('GATE-RESULT total=' + total + ' failed=' + (failed ? 1 : 0))
if (failed) process.exit(1)
