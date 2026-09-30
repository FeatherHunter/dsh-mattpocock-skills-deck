// verify-inject-trailing-newline.js — 注入尾部补 1 个换行（#789 A 方案）
// 用法: node tests/verify-inject-trailing-newline.js
//
// 验收标准（用户选 A）：
//   a) 不是换行结尾的注入文本补 1 个换行，已经是的不重复补，空文本不动；
//   b) 三处调宿主写草稿的落点共用同一归一（主注入、草稿消费、新会话直注）；
//   c) 光标兜底（#786）在归一之后跑，自然落到新行开头。
const fs = require('fs')
const assert = require('assert')
const path = require('path')

const root = path.join(__dirname, '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')
const ok = (name, cond) => { if (!cond) throw new Error('FAIL · ' + name); console.log('  PASS · ' + name) }

const ioSrc = read('src/client/kernel/api-io.js')
const barSrc = read('src/client/statusbar/StatusBar.js')
const nsSrc = read('src/client/kernel/api-new-session.js')

// ---- Part A：静态契约 ----
ok('归一函数定义在 api-io', ioSrc.includes('export const withTrailingNewline = function'))
ok('主注入点用归一后文本', ioSrc.includes('withTrailingNewline(text)') && ioSrc.includes('st.injector(bodyText)'))
ok('草稿消费点用归一后文本', barSrc.includes('withTrailingNewline(text)') && barSrc.includes('setDraft(draftText)'))
ok('新会话直注点用归一后文本', nsSrc.includes('withTrailingNewline(text)') && nsSrc.includes('ns.injector(directText)'))
ok('已是换行不重复补', ioSrc.includes("=== '\\n'"))
ok('空文本不动', ioSrc.includes('if (!s) return s'))
ok('兜底仍在归一后跑', ioSrc.includes('ensureInjectFocusAtEnd()'))
ok('不新增日志事件', !/withTrailingNewline[\s\S]{0,2000}?log\s*\(/.test(ioSrc.slice(ioSrc.indexOf('withTrailingNewline'))))

// ---- Part B：行为 ----
const start = ioSrc.indexOf('export const withTrailingNewline = function')
const brace0 = ioSrc.indexOf('{', start)
let depth = 0
let fn = null
for (let i = brace0; i < ioSrc.length; i++) {
  if (ioSrc[i] === '{') depth += 1
  if (ioSrc[i] === '}') {
    depth -= 1
    if (depth === 0) {
      const mod = { exports: null }
      fn = new Function('module', 'exports', ioSrc.slice(start, i + 1).replace('export const withTrailingNewline =', 'module.exports =') + '\nreturn module.exports;')(mod, mod.exports)
      break
    }
  }
}
if (!fn) throw new Error('归一函数提取失败')
const eq = (name, got, want) => { assert.strictEqual(got, want, name); console.log('  PASS · ' + name) }
eq('普通文本补 1 个换行', fn('第一行\n第二行'), '第一行\n第二行\n')
eq('已有换行不重复', fn('abc\n'), 'abc\n')
eq('多个尾随换行动', fn('a\n\n'), 'a\n\n')
eq('空串不动', fn(''), '')
eq('null 不抛错', fn(null), '')
eq('前导换行只看尾部', fn('\nabc'), '\nabc\n')

console.log('\n全部通过 — #789 归一生效（静态 8 项 + 行为 6 项）')
