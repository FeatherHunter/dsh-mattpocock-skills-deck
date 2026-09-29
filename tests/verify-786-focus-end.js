// verify-786-focus-end.js — 注入后光标落末尾的插件侧兜底（#786 B 方案）
// 用法: node tests/verify-786-focus-end.js
//
// 验收标准（Q1-Q2 对齐）：
//   a) 注入完成后光标落在文本末尾，可立刻打字；内容很长时输入框滚到底，不停顶部；
//   b) 现状光标在第一行第一个字符前，本改动只加兜底，不改注入主路径（setDraft 全文替换不动）；
//   c) 找不到宿主输入框就安静跳过，绝不抛错；插件自己的输入框一律不碰。
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
ok('兜底函数定义在 api-io', ioSrc.includes('export const ensureInjectFocusAtEnd = function'))
ok('主注入点调用兜底', ioSrc.includes('ensureInjectFocusAtEnd()') && ioSrc.includes('st.injector(text)'))
ok('草稿消费点调用兜底', barSrc.includes('props.inputActions.setDraft(text)') && barSrc.includes('ensureInjectFocusAtEnd()'))
ok('新会话直注点调用兜底', nsSrc.includes('ns.injector(text)') && nsSrc.includes('ensureInjectFocusAtEnd()'))
ok('无 document 时直接返回', ioSrc.includes("typeof document === 'undefined'"))
ok('全程 try/catch 不抛错', (ioSrc.match(/try \{/g) || []).length >= 8)
ok('排除插件容器', ioSrc.includes('[data-dsws-host]') && ioSrc.includes('.dsws-modal'))
ok('文本框置末', ioSrc.includes('setSelectionRange(len, len)'))
ok('文本框滚到底', ioSrc.includes('el.scrollTop = el.scrollHeight'))
ok('富文本兜底折叠到末尾', ioSrc.includes('range.collapse(false)'))
ok('下一帧调度', ioSrc.includes('requestAnimationFrame') && ioSrc.includes('setTimeout(run, 0)'))
ok('最多补一次避免抢输入', ioSrc.includes('attempts < 2') && ioSrc.includes('setTimeout(run, 120)'))
ok('不新增日志事件', !/ensureInjectFocusAtEnd[\s\S]{0,4000}?log\s*\(/.test(ioSrc.slice(ioSrc.indexOf('ensureInjectFocusAtEnd'))))
ok('不碰弹窗首控件聚焦', !read('src/client/kernel/slotRenderer-modal-view.js').includes('ensureInjectFocusAtEnd'))

// ---- Part B：行为沙箱 ----
const extractHelper = (src) => {
  const start = src.indexOf('export const ensureInjectFocusAtEnd = function')
  if (start < 0) throw new Error('helper 锚点缺失')
  const brace0 = src.indexOf('{', start)
  let depth = 0
  for (let i = brace0; i < src.length; i++) {
    if (src[i] === '{') depth += 1
    if (src[i] === '}') {
      depth -= 1
      if (depth === 0) {
        const fnSrc = src.slice(start, i + 1).replace('export const ensureInjectFocusAtEnd =', 'module.exports =')
        const mod = { exports: null }
        const factory = new Function('module', 'exports', 'document', 'window', 'requestAnimationFrame', 'setTimeout', fnSrc + '\nreturn module.exports;')
        return factory
      }
    }
  }
  throw new Error('helper 括号未闭合')
}
const factory = extractHelper(ioSrc)

const runWith = (doc, win) => {
  const raf = (cb) => { cb() }
  const timeouts = []
  const st = (fn, ms) => { timeouts.push(ms); fn(); return 0 }
  const mod = { exports: null }
  const fn = factory(mod, mod.exports, doc, win, raf, st)
  fn()
  return timeouts
}

const fakeTextarea = (over) => Object.assign({
  tagName: 'TEXTAREA', value: '第一行\n第二行', disabled: false, readOnly: false,
  offsetParent: {}, getClientRects: () => [1], closest: () => null,
  focus: function () { this._focused = true }, setSelectionRange: function (a, b) { this._sel = [a, b] },
  scrollHeight: 200, scrollTop: 0,
}, over || {})

// 场景 1：宿主输入框置末 + 聚焦 + 滚到底
const host = fakeTextarea()
runWith({ querySelectorAll: () => [host], activeElement: null }, {})
assert.deepStrictEqual(host._sel, [String(host.value).length, String(host.value).length], '光标应落在末尾')
assert.strictEqual(host._focused, true, '应聚焦')
assert.strictEqual(host.scrollTop, 200, '应滚到底')
console.log('  PASS · 宿主输入框置末聚焦滚到底')

// 场景 2：插件自己的输入框不碰
const pluginBox = fakeTextarea({ closest: (sel) => (String(sel).includes('data-dsws-host') ? {} : null) })
runWith({ querySelectorAll: () => [pluginBox], activeElement: null }, {})
assert.strictEqual(pluginBox._focused, undefined, '插件输入框不应被聚焦')
assert.strictEqual(pluginBox._sel, undefined, '插件输入框不应被置末')
console.log('  PASS · 插件输入框不受影响')

// 场景 3：只读框不碰
const ro = fakeTextarea({ readOnly: true })
runWith({ querySelectorAll: () => [ro], activeElement: null }, {})
assert.strictEqual(ro._focused, undefined, '只读框不应被聚焦')
console.log('  PASS · 只读框不受影响')

// 场景 4：无 document 不抛错
const g = { document: undefined }
try {
  const mod = { exports: null }
  const f = factory(mod, mod.exports, undefined, {}, (cb) => cb(), (fn) => fn())
  f()
  console.log('  PASS · 无 document 安静跳过')
} catch (e) { throw new Error('无 document 时不应抛错：' + e.message) }

// 场景 5：富文本折叠到末尾
const added = []
const fakeRange = { selectNodeContents: function () { this._sel = true }, collapse: function (toEnd) { this._end = toEnd } }
const ce = { tagName: 'DIV', isContentEditable: true, disabled: false, offsetParent: {}, getClientRects: () => [1], closest: () => null, focus: function () { this._focused = true }, scrollHeight: 300, scrollTop: 0 }
runWith({
  querySelectorAll: () => [ce], activeElement: null,
  getSelection: () => ({ removeAllRanges: () => {}, addRange: (r) => added.push(r) }),
  createRange: () => fakeRange,
}, { getSelection: () => ({ removeAllRanges: () => {}, addRange: (r) => added.push(r) }) })
assert.strictEqual(ce._focused, true, '富文本应聚焦')
assert.strictEqual(fakeRange._end, false, '富文本 range 应折叠到末尾')
console.log('  PASS · 富文本折叠到末尾')

console.log('\n全部通过 — #786 兜底生效（静态 13 项 + 行为 5 项）')
