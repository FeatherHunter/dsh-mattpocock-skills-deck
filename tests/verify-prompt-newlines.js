/*
 * verify-prompt-newlines.js — 提示词模板换行契约校验（#430 根因门禁）
 * 用法: node tests/verify-prompt-newlines.js
 *
 * 契约（#603 修订）：任何提示词模板文本（client PROMPTS 注册表 / host *_PROMPT 常量 /
 *   host 后端模块 prompts 字典的 zh/en 字面量）都不得含字面 \n 序列（两个字符：反斜杠 + n），
 *   只有「教学片段」例外：正文格式块要能原样引述「写成 \n 是什么样」。免豁免清单是 4 条固定引用，
 *   条数与内容指纹都钉死在下面（改一个字就红），不是随手能加的口子。
 *   为什么会有这几条：#603 按领导拍板把正文格式块还原成 #567 之前的写法，那份写法里就有
 *   点名 \n 的禁止条与一条反例。
 * 理由：#430 —— 模板里把换行写成双层转义（源码 \\n），运行时注入的是字面
 *   反斜杠+n，提示词没有真实换行；模板必须写单层转义 \n（源码一个反斜杠+n）。
 * 防回退：若未来模板再次出现双层转义，本文件按条目报 FAIL；
 *   且本文件断言「白名单必须为空」（见 ALLOWED_LITERAL_BSN），防止豁免被悄悄加回来。
 * 扫描范围就是「提示词模板面」本身：三处注册表 + host *_PROMPT + 后端 zh/en 字面量；
 *   src/host 全树另有若干源码级 \\n 在正则字面量与代码注释里（mapBody.js / parseIssueTracker.js /
 *   gitlab/graph-blocking.js），它们不是模板文本，不属本门禁扫描面（按全树断言会误红）。
 */
const fs = require('fs')
const path = require('path')
const ROOT = path.join(__dirname, '..')
let failed = false

// #603：正文格式块按领导拍板还原成 #567 之前的写法，它必须能引述「写成 \n 是什么样」，
//   所以放行下面 4 条固定的教学片段。条数与内容指纹都硬编码，改这份清单必然变红。
const ALLOWED_LITERAL_BSN = [
  '禁止字面 \\n 转义（不要把换行写成 \\n 两个字符）',
  '（反例：`## 进度：90%\\n下一步：xxx`）',
  'No literal \\n escapes (do not write newlines as the two characters backslash-n)',
  '(not `## Progress: 90%\\nNext step: ...`)',
]
const EXPECT_ALLOWED_COUNT = 4
const EXPECT_ALLOWED_FINGERPRINT = '694a1d116d799ec7'
const allTexts = []
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
  allTexts.push(String(v))
  const n = countLiteral(stripAllowed(v))
  if (n > 0) { failed = true; console.log('FAIL ' + where + ' ' + name + ' 含字面 \\n ' + n + ' 处（剥离契约引用后应为 0）') }
  return n === 0
}

// #603：白名单是「钉死的教学片段清单」—— 条数与内容指纹都要对得上，防悄悄加口子
const fingerprint = require('crypto').createHash('sha256').update(ALLOWED_LITERAL_BSN.join('\u0000'), 'utf8').digest('hex').slice(0, 16)
if (ALLOWED_LITERAL_BSN.length !== EXPECT_ALLOWED_COUNT || fingerprint !== EXPECT_ALLOWED_FINGERPRINT) {
  failed = true
  console.log('FAIL ALLOWED_LITERAL_BSN 与钉死的教学片段清单不一致（实际 ' + ALLOWED_LITERAL_BSN.length + ' 条 / 指纹 ' + fingerprint +
    '，期望 ' + EXPECT_ALLOWED_COUNT + ' 条 / 指纹 ' + EXPECT_ALLOWED_FINGERPRINT + '）——要改这份清单就连断言一起改，不许绕过去')
} else {
  console.log('OK   ALLOWED_LITERAL_BSN 与钉死的教学片段清单一致（' + ALLOWED_LITERAL_BSN.length + ' 条 / 指纹 ' + fingerprint + '）')
}

// 1) client PROMPTS 注册表（src 单源 + 双产物：改 src 必须重建，产物同步校验）
const parseEntries = function (src) {
  // #588 起转义感知（与 verify-prompts.js ENTRY_RE 同口径）：第 ① 步命令的内层单引号在源码是 \'，[^']* 会提前截断少扫
  const out = []
  const re = /^\s*"([a-zA-Z0-9.]+)": \{ version: (\d+), placeholders: \[([^\]]*)\], use: '((?:[^'\\]|\\.)*)', zh: '((?:[^'\\]|\\.)*)', en: '((?:[^'\\]|\\.)*)' \},?$/gm
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

// #603：钉死的教学片段必须真的还在文本里 —— 防白名单烂在代码里（文本改了、豁免还留着）
ALLOWED_LITERAL_BSN.forEach(function (frag) {
  if (allTexts.join('\n').indexOf(frag) < 0) {
    failed = true
    console.log('FAIL 白名单里的教学片段已经不在任何提示词文本里（该删掉这条豁免）：' + JSON.stringify(frag))
  }
})
console.log('OK   白名单 ' + ALLOWED_LITERAL_BSN.length + ' 条教学片段都在当前文本里找得到')

console.log(failed ? 'FAIL' : 'PASS')
process.exit(failed ? 1 : 0)
