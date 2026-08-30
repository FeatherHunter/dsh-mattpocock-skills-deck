#!/usr/bin/env node
/**
 * verify-no-cross-import.js — 跨房引用门禁（#326 承接 #313 D1-D3）
 *
 * 扫描域：三座内置后端目录（src/host/tracker/backends/github、gitlab、markdown），
 * 第三方扩展（examples/demo-mini 等）不在域内。
 *
 * 检查对象：静态 import / export-from 的字面量说明符 与 动态 import('...') 的字面量说明符；
 * 每条违规输出文件、行号、目标房间。非字面量的动态 import 也视为违规（纪律要求后端文件的
 * 引用说明符必须是字面量字符串）。
 *
 * 白名单（允许引用，其余一律禁止）：
 *   - node 内置模块（含 node: 前缀与裸名）
 *   - 同房间内相对路径（解析后仍在 src/host/tracker/backends/<self>/ 内）
 *   - src/shared/tracker/**
 *   - src/shared/labels.js
 *   - src/host/tracker/preflight.js
 *   - src/host/platform/**
 *
 * host 主程序 -> 后端的引用不在检查范围（本脚本只扫三座后端目录）。
 *
 * 用法：node tests/verify-no-cross-import.js
 */
const fs = require('fs')
const path = require('path')
const builtinModules = require('module').builtinModules

const root = path.resolve(__dirname, '..')
const BACKENDS = ['github', 'gitlab', 'markdown']
const BACKEND_ROOT_POSIX = 'src/host/tracker/backends'

let failed = false
let passedChecks = 0
function ok(msg) { passedChecks++; console.log('  PASS ' + msg) }
function bad(msg) { failed = true; console.log('  FAIL ' + msg) }

const WHITELIST_RE = [
  /^src\/shared\/tracker\//,
  /^src\/shared\/labels\.js$/,
  /^src\/host\/tracker\/preflight\.js$/,
  /^src\/host\/platform\//,
]

const BUILTIN_SET = new Set(builtinModules)
function isNodeBuiltin(spec) {
  if (!spec) return false
  if (BUILTIN_SET.has(spec)) return true
  if (spec.startsWith('node:')) {
    const bare = spec.slice(5)
    if (BUILTIN_SET.has(spec) || BUILTIN_SET.has(bare) || BUILTIN_SET.has('node:' + bare)) return true
  } else {
    if (BUILTIN_SET.has('node:' + spec)) return true
  }
  return false
}

function getBackendOfFile(posixPath) {
  const prefix = BACKEND_ROOT_POSIX + '/'
  if (!posixPath.startsWith(prefix)) return null
  const rest = posixPath.slice(prefix.length)
  const slash = rest.indexOf('/')
  if (slash === -1) return null
  return rest.slice(0, slash)
}

function isSameRoom(filePosix, resolvedPosix) {
  const backend = getBackendOfFile(filePosix)
  if (!backend) return false
  const expected = BACKEND_ROOT_POSIX + '/' + backend + '/'
  return resolvedPosix === BACKEND_ROOT_POSIX + '/' + backend || resolvedPosix.startsWith(expected)
}

function isWhitelisted(resolvedPosix) {
  return WHITELIST_RE.some(re => re.test(resolvedPosix))
}

function resolveRelative(spec, fromFilePosix) {
  const dir = path.posix.dirname(fromFilePosix)
  const joined = path.posix.join(dir, spec)
  const normalized = path.posix.normalize(joined)
  return normalized
}

function stripForScan(content) {
  let out = content
  out = out.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
  out = out.replace(/\/\/.*$/gm, m => ' '.repeat(m.length))
  return out
}

function extractImports(content) {
  const stripped = stripForScan(content)
  const results = []
  const reFrom = /from\s+['\"]([^'\"]+)['\"]/g
  let m
  while ((m = reFrom.exec(stripped)) !== null) {
    const spec = m[1]
    const fullMatch = m[0]
    const specIndex = m.index + fullMatch.indexOf(spec)
    const line = stripped.slice(0, specIndex).split('\n').length
    results.push({ spec, line, kind: 'static-from' })
  }
  const reImportBare = /import\s+['\"]([^'\"]+)['\"]/g
  while ((m = reImportBare.exec(stripped)) !== null) {
    const spec = m[1]
    const idx = m.index
    const before = stripped.slice(Math.max(0, idx - 40), idx)
    if (/from\s*$/.test(before)) continue
    const specPos = m[0].indexOf(spec)
    const line = stripped.slice(0, m.index + specPos).split('\n').length
    results.push({ spec, line, kind: 'static-bare' })
  }
  const reDynLit = /import\s*\(\s*['\"]([^'\"]+)['\"]\s*\)/g
  while ((m = reDynLit.exec(stripped)) !== null) {
    const spec = m[1]
    const pos = m.index + m[0].indexOf(spec)
    const line = stripped.slice(0, pos).split('\n').length
    results.push({ spec, line, kind: 'dynamic-literal' })
  }
  const reRequire = /require\s*\(\s*['\"]([^'\"]+)['\"]\s*\)/g
  while ((m = reRequire.exec(stripped)) !== null) {
    const spec = m[1]
    const pos = m.index + m[0].indexOf(spec)
    const line = stripped.slice(0, pos).split('\n').length
    results.push({ spec, line, kind: 'require' })
  }
  const reDynHead = /import\s*\(/g
  while ((m = reDynHead.exec(stripped)) !== null) {
    const start = m.index + m[0].length
    const tail = stripped.slice(start, start + 200)
    const trimmed = tail.trimStart()
    if (!trimmed) continue
    const first = trimmed[0]
    if (first === "'" || first === '"') continue
    if (first === String.fromCharCode(96)) {
      const line = stripped.slice(0, m.index).split('\n').length
      results.push({ spec: String.fromCharCode(96) + 'template' + String.fromCharCode(96), line, kind: 'dynamic-non-literal', nonLiteral: true, raw: trimmed.slice(0, 30) })
      continue
    }
    if (first === ')') continue
    const line = stripped.slice(0, m.index).split('\n').length
    results.push({ spec: trimmed.slice(0, 30), line, kind: 'dynamic-non-literal', nonLiteral: true })
  }
  const seen = new Set()
  const deduped = []
  for (const r of results) {
    const key = r.line + '|' + r.spec + '|' + r.kind
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(r)
  }
  deduped.sort((a,b)=> a.line - b.line)
  return deduped
}

function scanForCrossImport(files) {
  const violations = []
  for (const f of files) {
    const posixPath = f.filePath.replace(/\\/g, '/')
    const backend = getBackendOfFile(posixPath)
    if (!backend) continue
    const imports = extractImports(f.content)
    for (const imp of imports) {
      if (imp.nonLiteral) {
        violations.push({
          file: posixPath,
          line: imp.line,
          spec: imp.spec,
          resolved: '',
          target: 'non-literal',
          reason: '后端文件的引用说明符必须是字面量字符串（发现非字面量 dynamic import）',
        })
        continue
      }
      const spec = imp.spec
      if (isNodeBuiltin(spec)) continue
      let isRelative = spec.startsWith('.') || spec.startsWith('/')
      if (isRelative) {
        let s = spec
        if (s.startsWith('/')) s = s.slice(1)
        let resolved = resolveRelative(s, posixPath)
        if (spec.startsWith('/')) resolved = s
        if (isSameRoom(posixPath, resolved)) continue
        if (isWhitelisted(resolved)) continue
        let target = '非白名单'
        for (const other of BACKENDS) {
          if (other === backend) continue
          const otherPrefix = BACKEND_ROOT_POSIX + '/' + other + '/'
          const otherExact = BACKEND_ROOT_POSIX + '/' + other
          if (resolved === otherExact || resolved.startsWith(otherPrefix)) {
            target = other
            break
          }
        }
        if (target === '非白名单' && /backends\/(github|gitlab|markdown)\//.test(spec)) {
          const m2 = /backends\/(github|gitlab|markdown)\//.exec(spec)
          if (m2) target = m2[1]
        }
        violations.push({
          file: posixPath,
          line: imp.line,
          spec,
          resolved,
          target,
          reason: '跨房或非白名单引用',
        })
      } else {
        if (spec.startsWith('src/')) {
          const resolved = spec
          if (isSameRoom(posixPath, resolved)) continue
          if (isWhitelisted(resolved)) continue
          let target = '非白名单'
          for (const other of BACKENDS) {
            const otherPrefix = BACKEND_ROOT_POSIX + '/' + other + '/'
            if (resolved.startsWith(otherPrefix)) { target = other; break }
          }
          violations.push({ file: posixPath, line: imp.line, spec, resolved, target, reason: '跨房或非白名单引用（裸仓库路径）' })
        } else {
          violations.push({ file: posixPath, line: imp.line, spec, resolved: spec, target: 'bare-spec', reason: '裸说明符非 node 内置且不在白名单' })
        }
      }
    }
  }
  return violations
}

console.log('== verify-no-cross-import：跨房引用门禁（#326） ==')
let selfFailed = false
function selfCheck(ok, msg, detail) {
  if (ok) console.log('  PASS ' + msg)
  else { selfFailed = true; failed = true; console.log('  FAIL ' + msg + (detail ? ' - ' + detail : '')) }
}

{
  const compliant = [
    { filePath: 'src/host/tracker/backends/github/a.js', content: "import x from './b.js'\nimport { y } from './sub/c.js'\nimport { ERROR_KIND } from '../../../../shared/tracker/constants.js'\nimport { CANONICAL_LABELS } from '../../../../shared/labels.js'\nimport { fail } from '../../preflight.js'\nimport plat from '../../../platform/index.js'\nimport hostPlat from '../../../platform/index.js'\nimport path from 'node:path'\nimport fs from 'node:fs'\nimport os from 'os'\nimport p from 'path'\n" },
    { filePath: 'src/host/tracker/backends/gitlab/b.js', content: "import { glabClient } from './client.js'\nimport { normalizeIssue } from './normalize.js'\nimport { ERROR_KIND } from '../../../../shared/tracker/constants.js'\n" },
    { filePath: 'src/host/tracker/backends/markdown/c.js', content: "import { parseMd } from './parse.js'\nimport { readTextFile } from './read.js'\nimport { ERROR_KIND } from '../../../../shared/tracker/constants.js'\nimport nodePath from 'node:path'\n" },
    { filePath: 'src/host/tracker/backends/github/d.js', content: "const m = await import('./client.js')\nawait import('../../../../shared/tracker/constants.js')\n" },
  ]
  const v1 = scanForCrossImport(compliant)
  selfCheck(v1.length === 0, '自检合规夹具零违规', v1.length ? JSON.stringify(v1.slice(0,2)) : '')
}

{
  const violating = [
    { filePath: 'src/host/tracker/backends/github/bad1.js', content: "import { x } from '../gitlab/client.js'\n" },
    { filePath: 'src/host/tracker/backends/gitlab/bad2.js', content: "import y from '../markdown/parse.js'\n" },
    { filePath: 'src/host/tracker/backends/markdown/bad3.js', content: "import z from '../../../../shared/other.js'\n" },
    { filePath: 'src/host/tracker/backends/github/bad4.js', content: "import ws from 'ws'\n" },
    { filePath: 'src/host/tracker/backends/github/bad5.js', content: "await import('../gitlab/index.js')\n" },
    { filePath: 'src/host/tracker/backends/github/bad6.js', content: "import(someVar)\n" },
    { filePath: 'src/host/tracker/backends/github/bad7.js', content: "import('./a/' + name + '.js')\n" },
  ]
  const v2 = scanForCrossImport(violating)
  selfCheck(v2.length >= 6, '自检违规夹具应捕获 >=6 条违规', 'got=' + v2.length)
  const hasGitlab = v2.some(v => v.target === 'gitlab' || v.resolved.includes('gitlab'))
  selfCheck(hasGitlab, '违规夹具含 gitlab 跨房')
  const hasBare = v2.some(v => v.target === 'bare-spec' || v.spec === 'ws')
  selfCheck(hasBare, '违规夹具含裸包 ws')
  const hasNonLiteral = v2.some(v => v.target === 'non-literal')
  selfCheck(hasNonLiteral, '违规夹具含非字面量 dynamic import')
  const hasWhitelistFail = v2.some(v => v.resolved === 'src/shared/other.js')
  selfCheck(hasWhitelistFail, '违规夹具含非白名单 src/shared/other.js')
}

{
  const edge = [
    { filePath: 'src/host/tracker/backends/github/a.js', content: "import x from '../github/client.js'\n" },
    { filePath: 'src/host/tracker/backends/github/b.js', content: "import y from './other.js'\n" },
  ]
  const ve = scanForCrossImport(edge)
  selfCheck(ve.length === 0, '边界：绕路径同房放行', JSON.stringify(ve))
}

{
  const dynWhite = [
    { filePath: 'src/host/tracker/backends/github/a.js', content: "await import('node:path')\nawait import('../../../../shared/tracker/constants.js')\n" },
  ]
  const vd = scanForCrossImport(dynWhite)
  selfCheck(vd.length === 0, '动态字面量白名单放行')
}

if (selfFailed) {
  console.log('\n自检失败 - 门禁实现未通过内存夹具')
  process.exit(1)
}
console.log('  PASS 自检内存夹具全部通过')

function collectBackendFiles() {
  const out = []
  for (const backend of BACKENDS) {
    const dir = path.join(root, BACKEND_ROOT_POSIX, backend)
    ;(function walk(d) {
      if (!fs.existsSync(d)) return
      for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, ent.name)
        if (ent.isDirectory()) walk(p)
        else if (ent.isFile() && ent.name.endsWith('.js')) out.push(p)
      }
    })(dir)
  }
  return out
}

const realFiles = collectBackendFiles().map(abs => {
  const rel = path.relative(root, abs).replace(/\\/g, '/')
  const content = fs.readFileSync(abs, 'utf8')
  return { filePath: rel, content }
})

const realViolations = scanForCrossImport(realFiles)

if (realViolations.length) {
  console.log('\n-- 真实仓库扫描发现违规 --')
  for (const v of realViolations) {
    bad(v.file + ':' + v.line + " -> '" + v.spec + "' 解析为 '" + v.resolved + "' 目标=" + v.target + ' (' + v.reason + ')')
  }
} else {
  ok('真实仓库零跨房引用（' + realFiles.length + ' 文件扫描）')
}

if (realViolations.length) {
  console.log('\n提示：白名单与现状不符或存在跨房引用；请按纪律拆票或更新白名单并在票据留痕（#313 D2）')
}

console.log(failed ? '\n[verify-no-cross-import] FAIL' : '\n[verify-no-cross-import] PASS')
process.exit(failed ? 1 : 0)






