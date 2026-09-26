// verify-deck-tools-row-zero-dep.js —— 门禁：行模块零框架引用（#741 根因）
// 用法：在插件根目录执行 node tests/verify-deck-tools-row-zero-dep.js，可独立运行。
//
// 为什么要这一段：2026-09-26 真机上全部工具调用一起失败
// （Cannot read properties of undefined (reading 'prepare')，摘掉工具行即恢复）。
// 排查结论是插件自带的那份工具包与宿主手里的不是同一份，
// 行模块再从自带那份创建工具，注册时就对不上宿主的调度器。
// 所以行模块只许交纯数据对象，不许引用框架包；
// 发布清单里也不许再带工具包依赖，工具行挂载必须在。
// 本文件不联网、不读 DSH 安装目录：只看仓库里的文本与形状。
const path = require('path')
const fs = require('fs')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const readText = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href)

const SEVEN_NAMES = [
  'deck_context',
  'deck_issue_get',
  'deck_map_snapshot',
  'deck_issue_create',
  'deck_map_plan_create',
  'deck_map_link',
  'deck_issue_patch',
]

async function main() {
  console.log('行模块零框架引用门禁（#741：无自带工具包、工具行在、形状原生合法）')

  // 1. 行模块不引用框架包
  const rowSrc = readText('src/host/platform/deckToolsRow.js')
  check(rowSrc.indexOf('@deepseek-ai/dsh-tools') < 0, '行模块不引用工具包（无自带副本可对不上）')
  check(!/require\(\s*['"]@deepseek-ai\/dsh-tools['"]\s*\)/.test(rowSrc), '行模块无 require 工具包')
  check(!/from\s+['"]@deepseek-ai\/(dsh-brand|dsh-storage-domain|dsh-agent)['"]/.test(rowSrc), '行模块无其他框架引用')

  // 2. 发布清单：有工具行导出、无运行时工具包依赖
  const pkg = JSON.parse(readText('package/package.json'))
  const exports = (pkg && pkg.exports) || {}
  check(exports['./tools'] === './lib/platform/deckToolsRow.js', '发布清单导出工具行（./tools 指向行模块）')
  const deps = (pkg && pkg.dependencies) || {}
  check(!Object.hasOwn(deps, '@deepseek-ai/dsh-tools'), '发布清单运行时依赖无工具包（不再多装一份）')
  const patch = readText('package/cordis.patch.yml')
  check(patch.indexOf('dsh-mattpocock-skills-deck/tools') >= 0, '装配补丁含工具行（agent 层能装上）')

  // 3. 行模块交出七个加探针，且形状过真原生判定
  let row = null
  try { row = await imp('src/host/platform/deckToolsRow.js') } catch (e) {
    check(false, '行模块可加载（' + String((e && e.message) || e).slice(0, 120) + '）')
    console.log('\n' + total + ' 条断言，失败')
    process.exit(1)
  }
  check(row && typeof row.apply === 'function', '行模块交出 apply')
  check(row && Array.isArray(row.inject) && row.inject.indexOf('tools') >= 0, '行模块注入工具服务')
  const registered = []
  const svc = { register: function (tool) { registered.push(tool); return function () {} } }
  let crashed = null
  try { row.apply({ tools: svc }) } catch (e) { crashed = e }
  check(!crashed, '行模块应用不抛')
  const names = registered.map((t) => t.name)
  check(SEVEN_NAMES.every((n) => names.indexOf(n) >= 0), '行模块交出七个 deck 工具')
  check(names.indexOf('deck_probe') >= 0, '行模块交出探针')

  // 形状：参数与输出都过仓库开发依赖里的真原生判定（与线上同版本）。
  let realAssert = null
  try {
    const realTools = await imp('node_modules/@deepseek-ai/dsh-tools/lib/index.js')
    realAssert = realTools.assertSupportedJsonSchema
  } catch (e) { realAssert = null }
  check(typeof realAssert === 'function', '真原生判定可加载（开发依赖与线上同版本）')
  if (typeof realAssert === 'function') {
    for (const t of registered) {
      if (SEVEN_NAMES.indexOf(t.name) < 0) continue
      try { realAssert(t.parameters); realAssert(t.output.schema) } catch (e) {
        check(false, t.name + ' 形状过真原生判定（' + String((e && e.message) || e).split(';')[0].slice(0, 120) + '）')
        continue
      }
      check(true, t.name + ' 形状过真原生判定')
    }
  }

  // 4. 发包镜像与源一致（构建会整树复制，手改发包即红）
  try {
    const crypto = require('crypto')
    const sha = (rel) => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, rel))).digest('hex')
    check(sha('src/host/platform/deckToolsRow.js') === sha('package/lib/platform/deckToolsRow.js'), '发包行模块与源同字节（构建已同步）')
  } catch (e) {
    check(false, '发包镜像比对失败（' + String((e && e.message) || e).slice(0, 100) + '）')
  }

  console.log('\n' + total + ' 条断言，' + (failed ? '失败' : '通过'))
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error('门禁抛错：' + ((e && e.stack) || e)); process.exit(1) })
