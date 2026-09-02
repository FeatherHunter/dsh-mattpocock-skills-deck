/*
 * verify-prompt-newlines.js — 提示词模板换行契约校验（#430 根因门禁）
 * 用法: node tests/verify-prompt-newlines.js
 *
 * 契约：任何提示词模板文本（client PROMPTS 注册表 / host *_PROMPT 常量 /
 *   host 后端模块 prompts 字典的 zh/en 字面量）除「正文格式契约」刻意引用字面 \\n 的固定短语外，
 *   不得含字面 \\n 序列（两个字符：反斜杠 + n）。
 * 理由：#430 —— 模板里把换行写成双层转义（源码 \\n），运行时注入的是字面
 *   反斜杠+n，提示词没有真实换行；模板必须写单层转义 \n（源码一个反斜杠+n）。
 * 防回退：若未来模板再次出现双层转义，本文件按条目报 FAIL。
 */
const fs = require('fs')
const path = require('path')
const ROOT = path.join(__dirname, '..')
let failed = false

// 正文格式契约的刻意引用（这些短语里的字面 \\n 是「描述反斜杠+n」本身，允许）
// 变体全录：不同模板引述措辞略异（禁止字面… / 反例：… / 而不是… × zh/en 两式例证）
const ALLOWED_LITERAL_BSN = [
  '禁止字面 \\n 转义（不要把换行写成 \\n 两个字符）',
  '反例：`## 进度：90%\\n下一步：xxx`',
  '而不是 `## 进度：90%\\n下一步：xxx`',
  'No literal \\n escapes (do not write newlines as the two characters backslash-n)',
  'No literal \\n escapes, no BOM',
  '## Progress: 90%\\nNext step: ...'
]
const stripAllowed = function (s) {
  let t = String(s)
  ALLOWED_LITERAL_BSN.forEach(function (p) { t = t.split(p).join('') })
  return t
}
const countLiteral = function (s) { return (String(s).match(/\\n/g) || []).length }

// —— 忠实求值：把源码字符串字面量按 JS 语义还原为运行时文本 ——
// 注意：不能复用 verify-prompts.js 的 unescapeStr（其把源码 \\n 误还原为 \\+真实换行）
const unescapeLiteral = function (s) {
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c !== '\\') { out += c; continue }
    const n = s[i + 1]
    if (n === undefined) { out += c; continue }
    i++
    if (n === 'n') out += '\n'
    else if (n === 't') out += '\t'
    else if (n === 'r') out += '\r'
    else if (n === '\\') out += '\\'
    else if (n === "'") out += "'"
    else if (n === '"') out += '"'
    else if (n === 'u') { const hex = s.slice(i + 1, i + 5); i += 4; out += String.fromCharCode(parseInt(hex, 16)) }
    else out += n
  }
  return out
}

const checkText = function (where, name, v) {
  const n = countLiteral(stripAllowed(v))
  if (n > 0) { failed = true; console.log('FAIL ' + where + ' ' + name + ' 含字面 \\n ' + n + ' 处（剥离契约引用后应为 0）') }
  return n === 0
}

// 1) client PROMPTS 注册表（src 单源 + 双产物：改 src 必须重建，产物同步校验）
const parseEntries = function (src) {
  const out = []
  const re = /^\s*"([a-zA-Z0-9.]+)": \{ version: (\d+), placeholders: \[([^\]]*)\], use: '([^']*)', zh: '([^']*)', en: '([^']*)' \},?$/gm
  let m
  while ((m = re.exec(src)) !== null) {
    out.push({ id: m[1], version: Number(m[2]), zh: unescapeLiteral(m[5]), en: unescapeLiteral(m[6]) })
  }
  return out
}
;['src/client/kernel/prompts.js', 'client.js', 'package/lib/client.js'].forEach(function (file) {
  const p = path.join(ROOT, file)
  if (!fs.existsSync(p)) { failed = true; console.log('FAIL ' + file + ' 不存在'); return }
  const entries = parseEntries(fs.readFileSync(p, 'utf8'))
  entries.forEach(function (e) {
    ['zh', 'en'].forEach(function (lang) { checkText(file, e.id + '.' + lang, e[lang]) })
  })
  console.log('OK   ' + file + '（' + entries.length + ' 条模板 × zh/en）')
})

// 2) host 的 *_PROMPT 常量（src/host/**/*.js）
const walk = function (dir, acc) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach(function (d) {
    const p = path.join(dir, d.name)
    if (d.isDirectory()) walk(p, acc)
    else if (d.name.endsWith('.js')) acc.push(p)
  })
  return acc
}
walk(path.join(ROOT, 'src/host'), []).forEach(function (file) {
  const src = fs.readFileSync(file, 'utf8')
  const re = /const\s+([A-Za-z0-9_$]*PROMPT[A-Za-z0-9_$]*)\s*=\s*'((?:[^'\\]|\\.)*)'/g
  let m
  while ((m = re.exec(src)) !== null) {
    if (checkText(file, m[1], unescapeLiteral(m[2]))) console.log('OK   ' + file + ' ' + m[1] + '（真实换行 ' + (unescapeLiteral(m[2]).match(/\n/g) || []).length + ' 处）')
  }
})

// 3) host 后端模块 prompts 字典的 zh/en 字面量（backends/*/index.js 的 module.prompts 等）
walk(path.join(ROOT, 'src/host/tracker/backends'), []).forEach(function (file) {
  if (!file.endsWith('index.js')) return
  const src = fs.readFileSync(file, 'utf8')
  const re = /(?:zh|en): '((?:[^'\\]|\\.)*)'/g
  let m
  while ((m = re.exec(src)) !== null) {
    const v = unescapeLiteral(m[1])
    if (v.indexOf('\n') >= 0 || v.indexOf('\\n') >= 0) {
      if (checkText(file, m[1].slice(0, 24), v)) console.log('OK   ' + file + ' zh/en 字面量（含换行的 ' + m[1].slice(0, 24) + '…）')
    }
  }
})

console.log(failed ? 'FAIL' : 'PASS')
process.exit(failed ? 1 : 0)
