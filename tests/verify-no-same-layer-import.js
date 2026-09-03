#!/usr/bin/env node
// verify-no-same-layer-import.js —— 同层互引门禁（地图 #336 首批·墙 #439）。
//
// 规则（G1 #339 第 4 条：禁令从后端三房间扩大到 host、shared、seam、platform 全层）：
//   host、platform、shared、seam 四层各自内部，文件之间不许互相引用。
//   新增的同层引用边直接失败；存量边记进 tests/same-layer-baseline.json 豁免，只许减不许增。
//   拆分票每消掉一条边，就在同票把对应基线条目删掉，否则门禁会提示基线已可清理。
//
// 层的划分（互不重叠，避免一条边被数两次）：
//   platform ＝ src/host/platform/ 下（平台装配扇出）。
//   host     ＝ src/host/ 下，但排除 platform 与 src/host/tracker/backends/。
//            backends 三房间仍由老门禁 tests/verify-no-cross-import.js 管
//            （同房间放行、跨房间禁），新门禁不再数它们，避免和老墙打架。
//   shared   ＝ src/shared/ 下。
//   seam     ＝ src/seam/ 下。
//   client 不在范围：它的模块经 scripts/build.mjs 文本拼进闭包，源码层天然零 import 边。
//
// 只看能落到同一层的边：相对路径（./ ../）与 src/ 开头的引用才可能同层；
// 裸包名（ws、electron 等）不是同层边，本门禁忽略；node 内置模块放行。
// 非字面量 dynamic import（import(变量)）无法归因，按老门禁同等严格度记为违规。
// 注释里的引用不算（先去掉块注释与行注释，JSDoc 里的 import() 类型不算数）。
// export ... from '...' 视为一条引用边（from 正则已覆盖）。
//
// 基线匹配不看行号：同一文件内同一目标出现多次只记一条（count 记次数供人看），
// 文件内换行增减不会把基线冲掉；新增目标才算新违规。
//
// 用法：node tests/verify-no-same-layer-import.js（在插件根目录）
const fs = require('fs')
const path = require('path')
const builtinModules = require('module').builtinModules

const ROOT = path.resolve(__dirname, '..')
const BASELINE_FILE = path.join(__dirname, 'same-layer-baseline.json')
const LAYERS = ['host', 'platform', 'shared', 'seam']

let failed = false
function ok(msg) { console.log('  PASS ' + msg) }
function bad(msg) { failed = true; console.log('  FAIL ' + msg) }
function info(msg) { console.log('  INFO ' + msg) }

function layerOf(posixPath) {
  if (posixPath === 'src/host/platform' || posixPath.startsWith('src/host/platform/')) return 'platform'
  if (posixPath === 'src/host/tracker/backends' || posixPath.startsWith('src/host/tracker/backends/')) return 'backends'
  if (posixPath === 'src/host' || posixPath.startsWith('src/host/')) return 'host'
  if (posixPath === 'src/shared' || posixPath.startsWith('src/shared/')) return 'shared'
  if (posixPath === 'src/seam' || posixPath.startsWith('src/seam/')) return 'seam'
  return 'other'
}

const BUILTIN_SET = new Set(builtinModules)
function isNodeBuiltin(spec) {
  if (!spec) return false
  if (BUILTIN_SET.has(spec)) return true
  if (spec.startsWith('node:')) {
    const bare = spec.slice(5)
    return BUILTIN_SET.has(spec) || BUILTIN_SET.has(bare) || BUILTIN_SET.has('node:' + bare)
  }
  return BUILTIN_SET.has('node:' + spec)
}

function resolveSpec(spec, fromFilePosix) {
  if (spec.startsWith('src/')) return spec
  if (spec.startsWith('/')) return spec.slice(1)
  if (spec.startsWith('./') || spec.startsWith('../')) {
    return path.posix.normalize(path.posix.join(path.posix.dirname(fromFilePosix), spec))
  }
  return null
}

function stripForScan(content) {
  let out = content.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  out = out.replace(/\/\/.*$/gm, (m) => ' '.repeat(m.length))
  return out
}

function extractImports(content) {
  const stripped = stripForScan(content)
  const results = []
  let m
  const reFrom = /from\s+['"]([^'"]+)['"]/g
  while ((m = reFrom.exec(stripped)) !== null) {
    const specPos = m.index + m[0].indexOf(m[1])
    results.push({ spec: m[1], line: stripped.slice(0, specPos).split('\n').length, kind: 'static-from' })
  }
  const reBare = /import\s+['"]([^'"]+)['"]/g
  while ((m = reBare.exec(stripped)) !== null) {
    const before = stripped.slice(Math.max(0, m.index - 40), m.index)
    if (/from\s*$/.test(before)) continue
    const specPos = m.index + m[0].indexOf(m[1])
    results.push({ spec: m[1], line: stripped.slice(0, specPos).split('\n').length, kind: 'static-bare' })
  }
  const reDynLit = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  while ((m = reDynLit.exec(stripped)) !== null) {
    const specPos = m.index + m[0].indexOf(m[1])
    results.push({ spec: m[1], line: stripped.slice(0, specPos).split('\n').length, kind: 'dynamic-literal' })
  }
  const reRequire = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  while ((m = reRequire.exec(stripped)) !== null) {
    const specPos = m.index + m[0].indexOf(m[1])
    results.push({ spec: m[1], line: stripped.slice(0, specPos).split('\n').length, kind: 'require' })
  }
  const reDynHead = /import\s*\(/g
  while ((m = reDynHead.exec(stripped)) !== null) {
    const tail = stripped.slice(m.index + m[0].length, m.index + m[0].length + 120).trimStart()
    if (!tail) continue
    const first = tail[0]
    if (first === String.fromCharCode(39) || first === '"' || first === ')') continue
    if (first === String.fromCharCode(96)) {
      results.push({ spec: 'template', line: stripped.slice(0, m.index).split('\n').length, kind: 'dynamic-non-literal', nonLiteral: true })
      continue
    }
    results.push({ spec: tail.slice(0, 30), line: stripped.slice(0, m.index).split('\n').length, kind: 'dynamic-non-literal', nonLiteral: true })
  }
  const seen = new Set()
  const deduped = []
  for (const r of results) {
    const key = r.line + '|' + r.spec + '|' + r.kind
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(r)
  }
  deduped.sort((a, b) => a.line - b.line)
  return deduped
}

function edgeKey(filePosix, resolvedPosix) {
  return filePosix + '|' + resolvedPosix
}

function scanForSameLayerEdges(files) {
  const edges = []
  for (const f of files) {
    const posixPath = f.filePath.replace(/\\/g, '/')
    const fromLayer = layerOf(posixPath)
    if (!LAYERS.includes(fromLayer)) continue
    const imports = extractImports(f.content)
    for (const imp of imports) {
      if (imp.nonLiteral) {
        edges.push({ file: posixPath, line: imp.line, spec: imp.spec, resolved: '(non-literal dynamic import)', layer: fromLayer, kind: imp.kind })
        continue
      }
      if (isNodeBuiltin(imp.spec)) continue
      const resolved = resolveSpec(imp.spec, posixPath)
      if (resolved === null) continue
      if (layerOf(resolved) === fromLayer) {
        edges.push({ file: posixPath, line: imp.line, spec: imp.spec, resolved, layer: fromLayer, kind: imp.kind })
      }
    }
  }
  return edges
}

console.log('== verify-no-same-layer-import：同层互引门禁（#439） ==')
let selfFailed = false
function selfCheck(cond, msg, detail) {
  if (cond) console.log('  PASS 自检：' + msg)
  else { selfFailed = true; failed = true; console.log('  FAIL 自检：' + msg + (detail ? ' —— ' + detail : '')) }
}

{
  const compliant = [
    { filePath: 'src/host/tracker/contract.js', content: "import { STATE } from '../../shared/tracker/constants.js'\nimport path from 'node:path'\n" },
    { filePath: 'src/shared/tracker/constants.js', content: "// 常量定义，无任何引用\nmodule.exports = {}\n" },
    { filePath: 'src/seam/gate.js', content: "import vm from 'node:vm'\n" },
    { filePath: 'src/host/platform/linux/index.js', content: "import nodePath from 'node:path'\n" },
    { filePath: 'src/host/index.js', content: "const m = await import('../shared/matt-skills.js')\nconst p = await import('./platform/index.js')\n" },
  ]
  const v0 = scanForSameLayerEdges(compliant)
  selfCheck(v0.length === 0, '合规夹具零同层边（跨层/内置/无引用放行）', JSON.stringify(v0.slice(0, 2)))
}

{
  const violating = [
    { filePath: 'src/host/tracker/index.js', content: "export { X } from './contract.js'\n" },
    { filePath: 'src/shared/tracker/check-catalog.js', content: "import { PRIMITIVE_KIND } from './chain.js'\n" },
    { filePath: 'src/seam/index.js', content: "export * as runtime from './runtime.js'\n" },
    { filePath: 'src/host/platform/index.js', content: "import darwin from './darwin/index.js'\n" },
    { filePath: 'src/host/index.js', content: "const m = await import('./tracker/snapshot.js')\n" },
    { filePath: 'src/host/index.js', content: "const m = await import(name)\n" },
    { filePath: 'src/shared/tracker/shape.js', content: "import { STATE } from './constants.js'\n" },
  ]
  const v1 = scanForSameLayerEdges(violating)
  selfCheck(v1.length === 7, '违规夹具应捕获 7 条同层边（含 export-from 与动态字面量与非字面量）', '实际=' + v1.length)
  selfCheck(v1.some((v) => v.layer === 'host'), '违规夹具含 host 层边')
  selfCheck(v1.some((v) => v.layer === 'shared'), '违规夹具含 shared 层边')
  selfCheck(v1.some((v) => v.layer === 'seam'), '违规夹具含 seam 层边')
  selfCheck(v1.some((v) => v.layer === 'platform'), '违规夹具含 platform 层边')
  selfCheck(v1.some((v) => v.kind === 'dynamic-non-literal'), '违规夹具含非字面量 dynamic import')
}

{
  const excluded = [
    { filePath: 'src/host/tracker/backends/github/index.js', content: "import { x } from './client.js'\n" },
    { filePath: 'src/client/kernel/store.js', content: "import { y } from './api.js'\n" },
  ]
  const v2 = scanForSameLayerEdges(excluded)
  selfCheck(v2.length === 0, '排除域不计数（backends 归老门禁、client 不在范围）', JSON.stringify(v2.slice(0, 2)))
}

{
  const jsdoc = [
    { filePath: 'src/host/tracker/registry.js', content: "/** @param {import('./contract.js').X} a */\nmodule.exports = {}\n" },
  ]
  const v3 = scanForSameLayerEdges(jsdoc)
  selfCheck(v3.length === 0, '注释里的引用不算数（JSDoc 类型放行）', JSON.stringify(v3.slice(0, 2)))
}

if (selfFailed) {
  console.log('\n自检失败 —— 门禁实现未通过内存夹具')
  process.exit(1)
}
console.log('  PASS 自检内存夹具全部通过')

function collectScopeFiles() {
  const roots = ['src/host', 'src/shared', 'src/seam'].map((d) => path.join(ROOT, d))
  const out = []
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full)
    }
  }
  for (const r of roots) walk(r)
  return out
}

function loadBaseline() {
  if (!fs.existsSync(BASELINE_FILE)) return null
  return JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'))
}

const realFiles = collectScopeFiles().map((abs) => ({
  filePath: path.relative(ROOT, abs).split(path.sep).join('/'),
  content: fs.readFileSync(abs, 'utf8'),
}))
const realEdges = scanForSameLayerEdges(realFiles)

const baseline = loadBaseline()
if (!baseline || !Array.isArray(baseline.entries)) {
  bad('存量基线缺失或格式不对：' + BASELINE_FILE + '（须为含 entries 数组的 JSON）')
} else {
  const allowed = new Set(baseline.entries.map((e) => edgeKey(e.file, e.resolved)))
  const fresh = realEdges.filter((e) => !allowed.has(edgeKey(e.file, e.resolved)))
  if (fresh.length) {
    console.log('\n-- 真实仓库发现新增同层引用（不在基线内） --')
    for (const v of fresh) {
      bad(v.layer + '层 ' + v.file + ':' + v.line + " -> '" + v.spec + "' 解析为 '" + v.resolved + "'")
    }
  } else {
    ok('真实仓库零新增同层引用（' + realEdges.length + ' 条边全在基线内，' + realFiles.length + ' 文件已扫）')
  }
  const liveKeys = new Set(realEdges.map((e) => edgeKey(e.file, e.resolved)))
  const gone = baseline.entries.filter((e) => !liveKeys.has(edgeKey(e.file, e.resolved)))
  if (gone.length) {
    for (const g of gone) info('基线条目已消除可清理：' + g.file + " -> '" + g.resolved + "'（拆分票记得同票删基线条目）")
  } else {
    info('基线无可清理条目（存量 ' + baseline.entries.length + ' 条全在）')
  }
}

if (failed) {
  console.log('\n门禁未通过：新增同层引用须先拆分消边，或确认后记进基线（只许减不许增，新增须写理由与归属拆分票）')
  process.exit(1)
}
console.log('\n同层互引门禁通过')
