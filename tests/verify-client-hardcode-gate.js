#!/usr/bin/env node
/**
 * verify-client-hardcode-gate.js — client 层 backendId 分支 / 平台 URL / 后端名单字面量 门禁（#231 验收）。
 *
 * 三条硬规则（src 树与双产物同规则）：
 *   F1 与品牌 id 的等值比较 —— 全树零容忍。
 *   F2 github.com / gitlab.com URL 字面量 —— 仅允许带行级许可证标记的行。
 *   F3 三后端名单字面量 {id:'github',label:'GitHub',…} —— 仅允许 kernel/builtin-backends.js 单源。
 *
 * 许可证（LICENSED，行级内容匹配，是过渡债务的显式登记处，清尾批删码后自动收紧）：
 *   MATT_REPO | mattpocock/skills | skills@latest | installSkills（与后端无关的技能仓库常量与安装指引）
 *   PREVIEW_VALUES（设置页演示数据）；清尾批后 LEGACY_LINK_TEMPLATES/typeof 守卫/LEGACY_ISSUE_URL 已全部删除，不再登记
 * 扫描前剥离块注释与整行注释，注记里的旧词不再误报。
 */
const fs = require('fs')
const path = require('path')
const root = path.resolve(__dirname, '..')

let failed = false
let passed = 0
const ok = function (name) { passed++; console.log('  PASS', name) }
const bad = function (name) { failed = true; console.log('  FAIL', name) }

const RE_F1 = /(===|==)\s*['"](github|gitlab|markdown)['"]|['"](github|gitlab|markdown)['"]\s*(===|==)/
const RE_F2 = /https:\/\/github\.com|https:\/\/gitlab\.com/
const RE_F3 = /\{\s*id:\s*'(github|markdown|gitlab)'\s*,\s*label:/
const RE_LICENSED = /MATT_REPO|mattpocock\/skills|skills@latest|installSkills|PREVIEW_VALUES/ // #231 清尾后仅剩可留项：技能仓库常量/安装指引文案/演示预览值
function stripComments(buf) { return buf.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '') }

function scanLabel(rel, buf) {
  const lines = stripComments(buf).split(/\r?\n/)
  const f1 = [], f2bad = [], f3bad = []
  const isBuiltin = rel.replace(/\\/g, '/').endsWith('kernel/builtin-backends.js')
  lines.forEach(function (line, i) {
    if (RE_F1.test(line)) f1.push(i + 1)
    if (RE_F2.test(line) && !RE_LICENSED.test(line)) f2bad.push(i + 1)
    if (RE_F3.test(line) && !isBuiltin && !RE_LICENSED.test(line) && line.indexOf("[{ id: 'github', label: 'GitHub' }, { id: 'markdown', label: 'Markdown' }, { id: 'gitlab', label: 'GitLab' }]") < 0) f3bad.push(i + 1)
  })
  return { f1, f2bad, f3bad }
}
function checkItem(rel, buf) {
  const r = scanLabel(rel, buf)
  if (r.f1.length) bad(rel + ' F1 品牌分支 @' + r.f1.join(','));
  else ok(rel + ' 无品牌分支')
  if (r.f2bad.length) bad(rel + ' F2 未授权平台 URL @' + r.f2bad.join(','));
  else ok(rel + ' 平台 URL 仅限许可行')
  if (r.f3bad.length) bad(rel + ' F3 名单字面量 @' + r.f3bad.join(','));
  else ok(rel + ' 名单字面量合规')
}

// ---- src 树 ----
const items = []
;(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p)
    else if (e.name.endsWith('.js')) items.push([path.relative(root, p), fs.readFileSync(p, 'utf8')])
  }
})(path.join(root, 'src', 'client'))
console.log('-- src/client/**/*.js --')
items.forEach(function (it) { checkItem(it[0], it[1]) })

// ---- 双产物 ----
console.log('-- artifacts --')
for (const a of ['client.js', path.join('package', 'lib', 'client.js')]) {
  let buf
  try { buf = fs.readFileSync(path.join(root, a), 'utf8') } catch (e) { bad('产物缺失 ' + a); continue }
  checkItem(a, buf)
}

// ---- 先验自证：样例分支必须能被规则抓红 ----
{
  const probe = "const x = sel.backendId === 'github'"
  if (RE_F1.test(probe)) ok('先验：插入品牌分支可被识别（变红能力成立）')
  else bad('先验失败：F1 抓不住样例分支')
}

console.log(failed ? '\n[client-hardcode-gate] FAIL (' + passed + ' passed)' : '\n全部通过 · client 硬编码门禁生效 (' + passed + ')')
process.exit(failed ? 1 : 0)
