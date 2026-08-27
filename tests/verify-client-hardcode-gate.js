#!/usr/bin/env node
/**
 * verify-client-hardcode-gate.js — client 层 backendId 分支 / 平台 URL / 后端名单字面量 门禁（#231 验收）。
 *
 * 三条硬规则：
 *   F1 backendId 与品牌 id 的等值分支 —— 全树零容忍（检查项契约落地后的回归即红）。
 *   F2 github.com / gitlab.com URL 字面量 —— 仅允许「持许可证标记」的行（见 LICENSED）。
 *   F3 三后端名单字面量 —— 仅允许 kernel/builtin-backends.js（名单单源）。
 *
 * 许可证为行级内容标记（src 与双产物同规则扫描）：
 *   LEGACY_LINK_TEMPLATES / MATT_REPO|mattpocock\/skills|skills@latest|installSkills /
 *   PREVIEW_VALUES / typeof issueUrlFor === 'function'|typeof repoUrlFor === 'function' / LEGACY_ISSUE_URL
 * 许可证是过渡债务的显式登记处：清尾批删除对应代码后规则自动收紧。
 */
const fs = require('fs')
const path = require('path')
const root = path.resolve(__dirname, '..')

let failed = false
let passed = 0
const ok = function (name) { passed++; console.log('  PASS', name) }
const bad = function (name) { failed = true; console.log('  FAIL', name) }

const RE_F1 = /(backendId|[\s(!&]bid[Norm]*|bidNorm)\s*={2,3}\s*['"](github|gitlab|markdown)['"]|(===|==)\s*['"](github|gitlab|markdown)['"]/
const RE_F2 = /https:\/\/github\.com|https:\/\/gitlab\.com/
const RE_F3 = /\{\s*id:\s*'(github|markdown|gitlab)'\s*,\s*label:/
const RE_LICENSED = /LEGACY_LINK_TEMPLATES|MATT_REPO|mattpocock\/skills|skills@latest|installSkills|PREVIEW_VALUES|typeof issueUrlFor === 'function'|typeof repoUrlFor === 'function'|LEGACY_ISSUE_URL/

function scanLabel(fileLabel, buf) {
  const lines = buf.split(/\r?\n/)
  let f1 = [], f2bad = [], f3bad = []
  lines.forEach(function (line, i) {
    const licensed = RE_LICENSED.test(line)
    if (RE_F1.test(line)) f1.push(i + 1)
    if (RE_F2.test(line) && !licensed) f2bad.push(i + 1)
    if (RE_F3.test(line) && !licensed) {
      // 名单单源例外文件自身豁免由调用方决定；默认按违规计
      f3bad.push(i + 1)
    }
  })
  return { f1, f2bad, f3bad }
}

function checkTree(label, items, opts) {
  console.log('-- ' + label + ' --')
  for (const it of items) {
    const rel = it.rel
    const r = scanLabel(rel, it.buf)
    const builtinFile = rel.replace(/\\/g, '/').endsWith('kernel/builtin-backends.js')
    if (!builtinFile && !(opts && opts.f3allow)) {
      // F3 在非单源文件出现 → 违规
    }
    if (r.f1.length) bad(rel + ' F1 品牌分支 @' + r.f1.join(','))
    else ok(rel + ' 无 backendId 品牌分支')
    if (r.f2bad.length) bad(rel + ' F2 未授权平台 URL @' + r.f2bad.join(','))
    else ok(rel + ' 平台 URL 仅限许可行')
    if (!builtinFile && r.f3bad.length) bad(rel + ' F3 名单字面量 @' + r.f3bad.join(','))
    else ok(rel + ' 名单字面量合规')
  }
}

// ---- src 树 ----
const SRC_ROOT = path.join(root, 'src', 'client')
const srcFiles = []
;(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p)
    else if (e.name.endsWith('.js')) srcFiles.push(path.relative(root, p))
  }
})(SRC_ROOT)
const srcItems = srcFiles.map(function (rel) { return { rel, buf: fs.readFileSync(path.join(root, rel), 'utf8') } })
checkTree('src/client/**/*.js', srcItems)

// ---- 双产物 ----
const artifacts = ['client.js', path.join('package', 'lib', 'client.js')]
const artItems = []
for (const a of artifacts) {
  const p = path.join(root, a)
  if (!fs.existsSync(p)) { bad('产物缺失 ' + a); continue }
  artItems.push({ rel: a, buf: fs.readFileSync(p, 'utf8') })
}
checkTree('artifacts', artItems)

// ---- 先验自证：故意注入一个品牌分支必须能被本门禁抓红（先验要求）----
{
  const probe = "const x = sel.backendId === 'github'"
  if (RE_F1.test(probe)) ok('先验：插入品牌分支可被规则识别（变红能力成立）')
  else bad('先验失败：F1 规则抓不住样例分支')
}

console.log(failed ? '\n[client-hardcode-gate] FAIL' : '\n全部通过 · client 硬编码门禁生效')
process.exit(failed ? 1 : 0)
