// tests/verify-skill-detail-stack.js —— 详情栈的门禁（2026-10-10 人拍板：详情里点开另一篇就压一层，最多三层）
// 用法：在插件根目录执行 node tests/verify-skill-detail-stack.js，可独立运行（jsdom + 真实 React，不联网）。
//
// 守四件事：
//   1) 压栈与栈顶别名：打开一篇是一层，st.pixelDetail 恒等于栈顶（外面原来的读法不用改）。
//   2) 从详情里点开另一篇：正文里写到的、随包真有的技能名（`/grill-with-docs`）做成可点入口，点一下压一层；
//      当前这一篇自己的名字不做入口；外层没接 onOpenSkill 时一个假入口都不做（反证）。
//   3) 三层上限：开第四层时把**最深**那层挤掉，栈深恒不超过三。
//   4) 关一层回到上一层，关完回列表；被挤掉那层迟到的读数不许再动界面。
//
// 反证：最后一段把 onOpenSkill 摘掉，同一套断言必须看出「没有可点入口」；改坏压栈或挤掉逻辑，前两段会红。
import { JSDOM } from 'jsdom'
import React from 'react'
import * as ReactDOMClient from 'react-dom/client'
import { act } from 'react'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://127.0.0.1:59519/' })
global.window = dom.window; global.document = dom.window.document
try { global.navigator = dom.window.navigator } catch (e) {}
global.IS_REACT_ACT_ENVIRONMENT = true
global.ResizeObserver = dom.window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }

const ctx = {
  React, DswsCtx: React.createContext(null), console, setTimeout, clearTimeout, setInterval, clearInterval,
  emit: () => {}, tr: (k) => k, host: null, log: () => {}, dswsLogHash: (s) => 'h', dswsLogTrunc: (s) => s,
  window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
  getComputedStyle: dom.window.getComputedStyle, requestAnimationFrame: (cb) => setTimeout(cb, 0),
  ResizeObserver: global.ResizeObserver, Promise, Date, Math, JSON, Array, Object, String, Number, Boolean, RegExp, Error,
}
ctx.globalThis = ctx
vm.createContext(ctx)
const strip = (f) => readFileSync(f, 'utf8').split('\n').map((l) => l.replace(/^(\s*)export\s+/, '$1')).join('\n')
const files = [
  'src/client/views/pixel/PixelStateIcon.js', 'src/client/views/pixel/PixelBtn.js', 'src/client/views/pixel/PixelSeal.js',
  'src/client/views/pixel/PixelSkeleton.js', 'src/client/views/pixel/PixelBanner.js', 'src/client/views/pixel/PixelStatusLine.js',
  'src/client/views/skillDetail/PixelContents.js', 'src/client/views/skillDetail/PixelMarkdown.js',
  'src/client/views/skillDetail/PixelSkillOps.js', 'src/client/views/skillDetail/PixelSkillDetailModal.js',
]
let lib = ''
for (const f of files) lib += strip(f) + '\n'
lib += ';globalThis.__o = { PixelSkillDetailModal, pixelOpenDetail, pixelCloseDetail, pixelRetryDetail };'
vm.runInContext(lib, ctx)
const Comp = ctx.__o.PixelSkillDetailModal
const { pixelOpenDetail, pixelCloseDetail } = ctx.__o


const container = dom.window.document.createElement('div')
dom.window.document.body.appendChild(container)
const root = ReactDOMClient.createRoot(container)
const pending = {}
ctx.host = { call: function (method, args) { return new Promise(function (resolve) { pending[args.name] = resolve }) } }
const store = { pixelDetailStack: [] }
const render = async () => { await act(async () => { root.render(React.createElement(Comp, { st: store, full: true, onRetry: () => {}, onOpenSkill: (n) => pixelOpenDetail(store, n, null), skillNames: ['grill-me', 'grill-with-docs', 'tdd', 'prototype'] })); await new Promise((r) => setTimeout(r, 20)) }) }
const html = () => container.innerHTML
const stack = () => store.pixelDetailStack
const top = () => stack()[stack().length - 1]
const names = () => stack().map((d) => d.name).join('>')
let pass = 0, fail = 0
const check = (ok, msg) => { if (ok) { pass++; console.log('  PASS ' + msg) } else { fail++; console.log('  FAIL ' + msg) } }
const open = async (name, md) => { pixelOpenDetail(store, name, null); await render(); if (pending[name]) { const r = pending[name]; delete pending[name]; r({ ok: true, md: md || ('# ' + name + '\n\n用 `/grill-with-docs` 打磨设计文档'), path: 'C:/x/' + name + '/SKILL.md' }); await render() } }

await open('grill-me')
check(stack().length === 1 && top().name === 'grill-me', '打开第一篇：栈里一层')
check(store.pixelDetail === top(), 'st.pixelDetail 恒等于栈顶')
check(!html().includes('pixel-stack'), '只有一层：不显示层号')

const ref = Array.from(container.querySelectorAll('code.pixel-skillref')).map((el) => el.textContent)
check(ref.indexOf('/grill-with-docs') >= 0, '正文里的 /grill-with-docs 做成可点入口（实得 ' + JSON.stringify(ref) + '）')
check(!html().includes('code class="pixel-skillref">/grill-me<'), '当前这一篇自己的名字没做成入口')

const el = Array.from(container.querySelectorAll('code.pixel-skillref')).find((x) => x.textContent === '/grill-with-docs')
await act(async () => { el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); await new Promise((r) => setTimeout(r, 20)) })
await render()
check(stack().length === 2 && top().name === 'grill-with-docs', '点正文里的技能名：又压一层（' + names() + '）')
check(html().includes('sd.stack'), '两层起显示层号（第 {n} 层 / 共 {m} 层）')

await open('tdd')
check(stack().length === 3 && names() === 'grill-me>grill-with-docs>tdd', '第三层：' + names())
await open('prototype')
check(stack().length === 3 && names() === 'grill-with-docs>tdd>prototype', '第四层：最深那层被挤掉，仍是三层（' + names() + '）')

// 被挤掉那层的读数回来，不许动界面
// 被挤掉那一层的读数迟到回来：不许动界面（栈不变、也没有别人拿到它那份正文）
pixelOpenDetail(store, 'late-a', null)
await render()
const lateResolve = pending['late-a']
for (const n of ['late-b', 'late-c', 'late-d']) { pixelOpenDetail(store, n, null); await render() }
check(names() === 'late-b>late-c>late-d', '连开四层后只剩最近三层，最早那层被挤掉（' + names() + '）')
const beforeNames = names()
const beforeMd = stack().map((d) => String(d.mdEn || '')).join('|')
if (lateResolve) { lateResolve({ ok: true, md: '# 迟到的读数', path: 'C:/x/late.md' }); await render() }
check(names() === beforeNames, '被挤掉那层的读数迟到回来：栈不变（' + names() + '）')
check(stack().map((d) => String(d.mdEn || '')).join('|') === beforeMd, '被挤掉那层没有把正文塞给别人')

pixelCloseDetail(store); await render()
check(names() === 'late-b>late-c', '关一层：回到上一层（' + names() + '）')
pixelCloseDetail(store); await render()
pixelCloseDetail(store); await render()
check(stack().length === 0 && html() === '', '一路关完：回到列表（页面画 null）')
check(store.pixelDetail === null, '栈空了：pixelDetail 也是 null')

// 反证：外层没接 onOpenSkill 时，正文里的技能名不该做成入口（否则点了没反应，等于假入口）
const bare = { pixelDetailStack: [] }
pixelOpenDetail(bare, 'grill-me', null)
await act(async () => { root.render(React.createElement(Comp, { st: bare, full: true, skillNames: ['grill-with-docs'] })); await new Promise((r) => setTimeout(r, 20)) })
if (pending['grill-me']) { const r = pending['grill-me']; delete pending['grill-me']; r({ ok: true, md: '用 `/grill-with-docs` 打磨设计文档', path: 'C:/x/a.md' }) }
await act(async () => { root.render(React.createElement(Comp, { st: bare, full: true, skillNames: ['grill-with-docs'] })); await new Promise((r) => setTimeout(r, 20)) })
check(container.querySelectorAll('code.pixel-skillref').length === 0, '反证：没接 onOpenSkill 时不做假入口')

console.log('合计 ' + pass + ' 通过 / ' + fail + ' 失败')
if (fail) console.log('存在失败')
process.exit(fail ? 1 : 0)
