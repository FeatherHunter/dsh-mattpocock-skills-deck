// tests/verify-skill-detail-stack.ts —— 详情栈的门禁（2026-10-10 人拍板：详情里点开另一篇就压一层，最多三层）
// 用法：在插件根目录执行 node tests/verify-skill-detail-stack.ts，可独立运行（jsdom + 真实 React，不联网）。
//
// 守六件事：
//   1) 压栈与栈顶别名：打开一篇是一层，st.pixelDetail 恒等于栈顶（外面原来的读法不用改）。
//   2) 从详情里点开另一篇：正文里写到的、随包真有的技能名（`/grill-with-docs`、`grilling`，以及双引号写的
//      "grilling"，#1520）做成可点入口，点一下压一层；双引号只让引号里的名字可点、引号本身原样留着，
//      不是技能名的引号文字不许变成入口；当前这一篇自己的名字不做入口；
//      外层没接 onOpenSkill 时一个假入口都不做（反证）。
//   3) 三层上限：开第四层时把**最深**那层挤掉，栈深恒不超过三。
//   4) 关一层回到上一层，关完回列表；被挤掉那层迟到的读数不许再动界面。
//   5) 浅色皮肤（#1378）：像素家族的深色令牌原样住在 :root，浅色只在宿主没挂深色标记时
//      于 .pixel-tab 上换一组浅色纸面便签令牌（原型里选定的纸面底、卡片白、深色描边、深绿强调），装饰色全部走 --pixel-* 令牌；色值写错、
//      深色值被挪进浅色选择器、装饰色写回裸值都会在最后一段报红。
//   6) 真实语料盘点（#1520）：随包 27 篇正文里用双引号写出来的技能名，逐行用真渲染器画一遍，
//      每一处都必须是可点入口；同一行里不是技能名的引号文字一处入口都不许做（名单以随包目录为准，不在这里手抄）。
//
// 反证：把 onOpenSkill 摘掉，「没有可点入口」必须成立；改坏压栈或挤掉逻辑，前两段会红。
//   浅色那一段另有两组内存反例（删掉浅色覆盖 / 改错一个浅色令牌），必须同样报红。
import { JSDOM } from 'jsdom'
import React from 'react'
import * as ReactDOMClient from 'react-dom/client'
import { act } from 'react'
import vm from 'node:vm'
import fs from 'node:fs'
import path from 'node:path'
// 2026-10-19（#1301 批C）：下面这十片像素叶子以前按 .js 路径读原文、只删行首 export 就拼进 vm 求值；
//   这一类同名 .js 是构建产物，这一阶段已经删掉，按那个路径读会 ENOENT。改走共用取源入口的 spliceableJs：
//   它按构建唯一口径把 .ts 真源转成可直接拼接的 JavaScript（中央时间 import 行与行首 export 都已处理），
//   拼进 vm 的仍是同一段运行期代码，断言一条没动。
import { spliceableJs } from './lib/source-text.ts'
// 2026-10-22（#1378 浅色皮肤）：本门禁现在还兼管 skillDetail 目录下那块像素皮肤的浅色令牌，
//   判据读的就是样式真源本身（PIXEL_STYLE_TEXT），见文件末尾「浅色皮肤」那一节。
import { PIXEL_STYLE_TEXT } from '../src/client/views/skillDetail/PixelStyles.ts'

// 2026-10-17 先修：这两片像素叶子在加载时读中央时间常量 SKILL_SKELETON_DELAY_MS（#1215 引入，
//   真源 src/shared/time-config/values.js，构建时由 buildTimeConfigClientFragment() 注入闭包）。
//   门禁把叶子拼进 vm 求值时只供给上面那套 ctx，于是裸标识符未定义、0 条断言就抛出去（主链今天的红之一）。
//   这里按单源头口径把这个常量从中央真值文件里读出来再拼进被求值的文本，绝不在这里另写一个数字
//   （tests/verify-time-config.ts 盯着常量登记，硬编码会当场被判出来）。
const centralTime = await import('./../src/shared/time-config/values.js')
const SKILL_SKELETON_DELAY_MS = centralTime.SKILL_SKELETON_DELAY_MS

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
// 取源见文件头：spliceableJs 读真源、转译、并去掉行首 export，拼起来就是可直接丢进 vm 的脚本。
const splice = (f) => spliceableJs(f)
const files = [
  'src/client/views/pixel/PixelStateIcon.js', 'src/client/views/pixel/PixelBtn.js', 'src/client/views/pixel/PixelSeal.js',
  'src/client/views/pixel/PixelSkeleton.js', 'src/client/views/pixel/PixelBanner.js', 'src/client/views/pixel/PixelStatusLine.js',
  'src/client/views/skillDetail/PixelContents.js', 'src/client/views/skillDetail/PixelMarkdown.js',
  'src/client/views/skillDetail/PixelSkillOps.js', 'src/client/views/skillDetail/PixelSkillDetailModal.js',
]
let lib = 'const SKILL_SKELETON_DELAY_MS = ' + JSON.stringify(SKILL_SKELETON_DELAY_MS) + ';\n'
for (const f of files) lib += splice(f) + '\n'
lib += ';globalThis.__o = { PixelSkillDetailModal, PixelMarkdown, pixelOpenDetail, pixelCloseDetail, pixelRetryDetail };'
vm.runInContext(lib, ctx)
const Comp = ctx.__o.PixelSkillDetailModal
const { pixelOpenDetail, pixelCloseDetail } = ctx.__o


const container = dom.window.document.createElement('div')
dom.window.document.body.appendChild(container)
const root = ReactDOMClient.createRoot(container)
const pending = {}
ctx.host = { call: function (method, args) { return new Promise(function (resolve) { pending[args.name] = resolve }) } }
const store = { pixelDetailStack: [] }
const render = async () => { await act(async () => { root.render(React.createElement(Comp, { st: store, full: true, onRetry: () => {}, onOpenSkill: (n) => pixelOpenDetail(store, n, null), skillNames: ['grill-me', 'grill-with-docs', 'tdd', 'prototype', 'grilling', 'domain-modeling', 'research', 'codebase-design'] })); await new Promise((r) => setTimeout(r, 20)) }) }
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

// #1520：双引号写出来的技能名也要能点（引号本身原样留在正文里，只让引号里的名字成入口）。
// 先把这一层（grill-with-docs）正在读的正文换成带双引号的版本，再验「能点的点开是那一篇」与「普通引号文字不许变成入口」。
const quotedMd = '# grill-with-docs\n\n先用 `/grill-with-docs` 过一遍，接着可以进 "grilling"；'
  + '要补词表就进 "domain-modeling"。\n\n'
  + '注意这两句只是普通引号文字，不许变成入口："the interface is the test surface"、'
  + '"one adapter = hypothetical seam, two = real"；长得像但不是技能名的 "grill" 也不许。'
const midResolve = pending['grill-with-docs']
delete pending['grill-with-docs']
if (midResolve) midResolve({ ok: true, md: quotedMd, path: 'C:/x/grill-with-docs/SKILL.md' })
await render()
const quotedRefs = Array.from(container.querySelectorAll('code.pixel-skillref')).map((el) => el.textContent)
check(quotedRefs.indexOf('grilling') >= 0, '双引号写的 "grilling" 做成可点入口（实得 ' + JSON.stringify(quotedRefs) + '）')
check(quotedRefs.indexOf('domain-modeling') >= 0, '双引号写的 "domain-modeling" 做成可点入口（实得 ' + JSON.stringify(quotedRefs) + '）')
check(quotedRefs.indexOf('the interface is the test surface') < 0 && quotedRefs.indexOf('grill') < 0, '不是技能名的引号文字与近形 "grill" 没做成入口（实得 ' + JSON.stringify(quotedRefs) + '）')
const grillEl = Array.from(container.querySelectorAll('code.pixel-skillref')).find((x) => x.textContent === 'grilling')
const prevText = grillEl && grillEl.previousSibling ? String(grillEl.previousSibling.textContent || '') : ''
const nextText = grillEl && grillEl.nextSibling ? String(grillEl.nextSibling.textContent || '') : ''
check(!!grillEl && prevText.slice(-1) === '"' && nextText.charAt(0) === '"', '双引号原样留在名字两侧（前 ' + JSON.stringify(prevText.slice(-3)) + ' 后 ' + JSON.stringify(nextText.slice(0, 3)) + '）')
check(!!grillEl && String(container.textContent || '').indexOf('"grilling"') >= 0, '界面上的原文仍是 "grilling"（引号没被吃掉）')
if (grillEl) await act(async () => { grillEl.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); await new Promise((r) => setTimeout(r, 20)) })
await render()
check(stack().length === 3 && top().name === 'grilling', '点双引号里的技能名：压一层到 grilling（' + names() + '）')
const grillLayer = pending['grilling']
delete pending['grilling']
if (grillLayer) grillLayer({ ok: true, md: '# grilling\n\n正文', path: 'C:/x/grilling/SKILL.md' })
await render()
pixelCloseDetail(store); await render()
check(stack().length === 2 && top().name === 'grill-with-docs', '关掉 grilling 那层：回到 grill-with-docs（' + names() + '）')

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
await act(async () => { root.render(React.createElement(Comp, { st: bare, full: true, skillNames: ['grill-with-docs', 'grilling'] })); await new Promise((r) => setTimeout(r, 20)) })
if (pending['grill-me']) { const r = pending['grill-me']; delete pending['grill-me']; r({ ok: true, md: '用 `/grill-with-docs` 与 "grilling" 打磨设计文档', path: 'C:/x/a.md' }) }
await act(async () => { root.render(React.createElement(Comp, { st: bare, full: true, skillNames: ['grill-with-docs', 'grilling'] })); await new Promise((r) => setTimeout(r, 20)) })
check(container.querySelectorAll('code.pixel-skillref').length === 0, '反证：没接 onOpenSkill 时不做假入口（反引号与双引号两种写法都不做）')

// #1520 的真实语料盘点：随包技能正文里，用直双引号写出来的技能名现在也要能点。
// 做法不靠人肉抄清单：扫 package/bundled-skills 下每篇 SKILL.md / SKILL.zh.md 的每一行，找出
// 行内所有「整个名字正好是某个随包技能名」的引号写法，逐行用真渲染器画一遍，断言每一处都成了入口；
// 再拿两句确定不是技能名的引号文字（中英文都有）画一遍，断言一处入口都不做。
let repoRoot = process.cwd()
for (let i = 0; i < 6 && !fs.existsSync(path.join(repoRoot, 'package', 'bundled-skills')); i++) repoRoot = path.dirname(repoRoot)
check(fs.existsSync(path.join(repoRoot, 'package', 'bundled-skills')), '找得到随包技能目录（' + repoRoot + '）')
const bundledRoot = path.join(repoRoot, 'package', 'bundled-skills')
const bundledNames = fs.readdirSync(bundledRoot).filter((d) => fs.existsSync(path.join(bundledRoot, d, 'SKILL.md')))
const bundledSet = {}
for (const n of bundledNames) bundledSet[n] = true
const renderLine = async function (md) {
  const box = dom.window.document.createElement('div')
  dom.window.document.body.appendChild(box)
  const r = ReactDOMClient.createRoot(box)
  await act(async () => {
    r.render(React.createElement(ctx.__o.PixelMarkdown, { md: md, lang: 'zh', st: null, onSkill: () => {}, skillNames: bundledNames }))
    await new Promise((res) => setTimeout(res, 0))
  })
  const refs = Array.from(box.querySelectorAll('code.pixel-skillref')).map((el) => el.textContent)
  const text = String(box.textContent || '')
  const alt = Array.from(box.querySelectorAll('img')).map((el) => String(el.getAttribute('alt') || ''))
  r.unmount(); box.remove()
  return { refs: refs, text: text, alt: alt }
}
// 这里按「技能名字符集」自己扫一遍正文（与渲染器里那条规则同一个字符集，故意各写一份）：
// 门禁要独立判断「原文里有几处这样的写法」和「渲染结果里有几颗入口」，两边都自己算，才不是拿实现证实现。
const QUOTED_NAME = /"([A-Za-z0-9][A-Za-z0-9_-]*)"/g
let quotedTotal = 0
const quotedBad = []
// hitSkillDirs：至少有一处双引号技能名的技能目录（SKILL.md 那一份），用来在报错信息里说清分布。
const hitSkillDirs = {}
for (const d of bundledNames) {
  for (const f of ['SKILL.md', 'SKILL.zh.md']) {
    const abs = path.join(bundledRoot, d, f)
    if (!fs.existsSync(abs)) continue
    const lines = fs.readFileSync(abs, 'utf8').split(/\r?\n/)
    for (let li = 0; li < lines.length; li++) {
      const line = lines[li]
      const wanted = []
      let m = null
      QUOTED_NAME.lastIndex = 0
      while ((m = QUOTED_NAME.exec(line)) !== null) if (bundledSet[m[1]]) wanted.push(m[1])
      if (!wanted.length) continue
      quotedTotal += wanted.length
      if (f === 'SKILL.md') hitSkillDirs[d] = true
      const got = (await renderLine(line)).refs
      for (const name of wanted) if (got.indexOf(name) < 0) quotedBad.push(d + '/' + f + ':' + (li + 1) + ' 的 ' + name)
    }
  }
}
check(quotedTotal > 0, '真实语料里确实有双引号写出来的技能名（实得 ' + quotedTotal + ' 处，分布在 ' + Object.keys(hitSkillDirs).length + ' 篇 SKILL.md：' + Object.keys(hitSkillDirs).join('、') + '；票面 2026-10-25 记的是 13 处，这里不钉死数字，随包正文升版也不该因为数量变了就红）')
check(quotedBad.length === 0, '真实语料里每一处双引号技能名都做成了入口' + (quotedBad.length ? '；没做成：' + quotedBad.slice(0, 5).join('；') : ''))
const ordinaryLines = [
  '注意这两句只是普通引号文字："the interface is the test surface" 与 "one adapter = hypothetical seam, two = real"。',
  '接口就是测试面：正文里写 "接口就是测试面" 时不该出现可点样式；"grill" 也不算技能名。',
]
let ordinaryRefs = 0
for (const one of ordinaryLines) ordinaryRefs += (await renderLine(one)).refs.length
check(ordinaryRefs === 0, '普通引号文字与近形文字一处入口都不做（实得 ' + ordinaryRefs + ' 处）')
// 图片的 alt 与 title 也可能带引号文字：双引号技能名那一遍排在图片与链接之后，
// 这时候整段图片已经被换成原子了，里面的引号文字不该再单独变成入口，也不该把原子占位符漏进界面。
const imageCases = [
  '![说明](https://example.com/a.png "grilling")',
  '!["grilling"](https://example.com/b.png)',
]
const imageProblems = []
for (const one of imageCases) {
  const out = await renderLine(one)
  if (out.refs.length !== 0) imageProblems.push(one + ' 出现了入口 ' + JSON.stringify(out.refs))
  if (out.text.indexOf('\u0002') >= 0 || out.alt.join('|').indexOf('\u0002') >= 0) imageProblems.push(one + ' 把原子占位符漏进了界面')
}
check(imageProblems.length === 0, '图片的 alt 与 title 里的引号文字不会被当成技能名' + (imageProblems.length ? '：' + imageProblems.join('；') : ''))

// ==== 浅色皮肤（#1378）：像素家族——深色原值不动，浅色换成浅色纸面便签（原型里选定的纸面底、卡片白、深色描边、深绿强调） ====
// 判据只看样式文本本身，不看渲染：色值写错、深色值被挪进浅色选择器、装饰色又写回裸值，都会报红。
// 先跑真文本（必须全过），再把同一段文本在内存里变坏两次，同一套判据必须报红——证明这扇门能红也能绿。
const PIXEL_CSS = PIXEL_STYLE_TEXT.join('')
// 深色（也就是今天的外观）逐条原值。改这里等于改了深色外观，所以逐条钉死。
const PIXEL_DARK_TOKENS = [
  ['--pixel-frame', '#3a2c14'], ['--pixel-paper', '#f2e4c0'], ['--pixel-card', '#fffdf4'],
  ['--pixel-ink', '#2b2113'], ['--pixel-acc', '#8b5cf6'], ['--pixel-stripe', '#ddcda1'],
]
// 浅色（浅色纸面便签）定版值：纸面、卡片、描边、字、强调深绿，以及浅色棋盘的两种纸色。
const PIXEL_LIGHT_TOKENS = [
  ['--pixel-frame', '#3a2c14'], ['--pixel-paper', '#f6f1e6'], ['--pixel-card', '#fffdf8'],
  ['--pixel-ink', '#221d15'], ['--pixel-ink2', '#6f6252'], ['--pixel-acc', '#15803d'],
  ['--pixel-ok', '#15803d'], ['--pixel-warn', '#b45309'], ['--pixel-bad', '#b91c1c'],
  ['--pixel-stripe', '#e7ddc8'], ['--pixel-tab1', '#efe8d9'], ['--pixel-tab2', '#e7ddc8'],
]
// 这些是深色原值里浅色绝不会用到的：出现在浅色覆盖里，就说明有人把深色令牌挪了过去。
const PIXEL_DARK_ONLY = ['#f2e4c0', '#fffdf4', '#2b2113', '#6b5b3e', '#8b5cf6', '#ddcda1', '#e3a92f', '#ffe1a1', '#5b3df0', '#e8d9ae', '#0e8a16', '#a3231a']
// 已经收进 --pixel-* 令牌的装饰色：令牌定义那几行剥掉之后，规则体里不该再有这些裸值。
const PIXEL_BARE_DECOR = ['#93764f', '#8a6f4d', '#d9f2dc', '#fbe3e1', '#fdf0d3', '#9a6a00', '#c9503f', '#9a8f78', '#efe8fb', '#e3a92f', '#241a0c', '#f2e4c0', '#0e8a16']

// 把一段像素样式文本按浅深两套的判据过一遍，返回不通过的原因（空数组＝全过）。
// 抽成函数只为一件事：下面的反例要在内存里把同一段文本变坏，再用同一套判据跑一遍。
function pixelLightProblems(css: string): string[] {
  const out: string[] = []
  // 1) 基础 :root 令牌仍是今天的深色原值（深色零变化的底线）。
  const rootBlocks = (css.match(/:root\{[^}]*\}/g) || []).join('')
  if (!rootBlocks) out.push('找不到基础 :root 令牌')
  for (const pair of PIXEL_DARK_TOKENS) {
    if (rootBlocks.indexOf(pair[0] + ':' + pair[1]) < 0) out.push('深色令牌 ' + pair[0] + ' 不再是 ' + pair[1])
  }
  // 2) 浅色覆盖有且只有一组，且只挂在宿主的深色标记上（面板里不许自造开关）。
  const marks = css.match(/body:not\(\[data-ds-dark-theme\]\)/g) || []
  if (marks.length !== 1) out.push('浅色覆盖只该有一组（实得 ' + marks.length + ' 组）')
  const light = css.match(/body:not\(\[data-ds-dark-theme\]\) \.pixel-tab\s*\{([^}]*)\}/)
  if (!light) {
    out.push('缺少 body:not([data-ds-dark-theme]) .pixel-tab 这一组浅色覆盖')
  } else {
    const decl = light[1]
    for (const pair of PIXEL_LIGHT_TOKENS) {
      if (decl.indexOf(pair[0] + ':' + pair[1]) < 0) out.push('浅色令牌 ' + pair[0] + ' 该是定版值 ' + pair[1])
    }
    // 浅色那一组只许写 --pixel-* 令牌：多写一条普通属性，就是在浅色下另起一套结构。
    for (const one of decl.split(';')) {
      const chip = one.trim()
      if (chip !== '' && !/^--pixel-[a-z0-9-]+:[^;]+$/.test(chip)) out.push('浅色覆盖里混进了不是令牌的写法：' + chip)
    }
    for (const val of PIXEL_DARK_ONLY) {
      if (decl.toLowerCase().indexOf(val) >= 0) out.push('深色原值 ' + val + ' 被挪进了浅色覆盖（浅色该是一套新值）')
    }
  }
  if (/data-(?!ds-dark-theme)[a-z-]*theme/.test(css)) out.push('出现了宿主深色标记以外的主题标记（面板不许自造开关）')
  if (css.indexOf('prefers-color-scheme') >= 0) out.push('出现 prefers-color-scheme：深浅只认宿主标记，不猜系统主题')
  // 3) 裸色检查：装饰色收进令牌后，规则体里不该再有直接写死的色值。令牌定义那几行先剥掉再扫。
  const rulesOnly = css.replace(/:root\{[^}]*\}/g, '').replace(/body:not\(\[data-ds-dark-theme\]\) \.pixel-tab\s*\{[^}]*\}/g, '')
  for (const raw of PIXEL_BARE_DECOR) {
    if (rulesOnly.toLowerCase().indexOf(raw) >= 0) out.push('规则体里还有裸装饰色 ' + raw + '（该走 --pixel-* 令牌）')
  }
  if (/#fff(?![0-9a-f])/i.test(rulesOnly)) out.push('规则体里还有裸的白色字（该走 --pixel-acc-ink）')
  // 4) 浅色下必须真的看得到：棋盘与棋盘上的分组标题都得走令牌，不能再写死纸色。
  if (!/\.pixel-tab\{[^}]*var\(--pixel-tab1\)/.test(css)) out.push('.pixel-tab 的棋盘没用 --pixel-tab1')
  if (!/\.pixel-tab\{[^}]*var\(--pixel-tab2\)/.test(css)) out.push('.pixel-tab 的棋盘没用 --pixel-tab2')
  if (!/\.pixel-tab \.dsws-grp\{[^}]*color:var\(--pixel-tab-ink\)/.test(css)) out.push('.pixel-tab .dsws-grp 的字色没用 --pixel-tab-ink（浅色棋盘上会看不见）')
  // 5) 两条硬线：全仓同值点白名单锁着的那一处警告色只能有一份；容器身份色一处都不许碰。
  if (css.split('--pixel-warn:#f59e0b').length - 1 !== 1) out.push('--pixel-warn:#f59e0b 该有且只有一处（verify-container-colors 的白名单锁着它）')
  if (/#1d4ed8/i.test(css)) out.push('出现了容器身份蓝 #1d4ed8（全仓零容忍，链接请用 #2563eb）')
  if (/#c084fc/i.test(css)) out.push('出现了探索地图身份紫 #c084fc（全仓零容忍）')
  return out
}

// 纸面上的字要看得清：把浅色令牌里的几对前景/背景真算一遍对比度（WCAG 的算法，正文线 4.5:1）。
// 算法本身放在 tests/lib/contrast.ts，与卡片门禁共用一份；这里只留原来的两个名字，调用点不用改。
import { relativeLuminance as pixelLum, contrastRatio as pixelContrast } from './lib/contrast.ts'

const pixelProblems = pixelLightProblems(PIXEL_CSS)
check(pixelProblems.length === 0, '浅色皮肤：深色令牌原样、浅色是定版纸面、装饰色全走令牌' + (pixelProblems.length ? '\n    不过 ' + pixelProblems.length + ' 条：\n      ' + pixelProblems.join('\n      ') : ''))

// 反例 a：把浅色覆盖整段删掉 —— 同一套判据必须报红（只在内存里改文本，不落盘）
const noLightCss = PIXEL_CSS.replace(/body:not\(\[data-ds-dark-theme\]\) \.pixel-tab\s*\{[^}]*\}/, '')
const noLightProblems = pixelLightProblems(noLightCss)
check(noLightCss !== PIXEL_CSS && noLightProblems.length > 0, '反例 a：删掉浅色覆盖 → 判据报红（' + noLightProblems.length + ' 条：' + noLightProblems.slice(0, 2).join('；') + '）')

// 反例 b：把一个浅色令牌值改成深色原值 —— 同一套判据必须报红
const wrongToneCss = PIXEL_CSS.replace('--pixel-paper:#f6f1e6', '--pixel-paper:#f2e4c0')
const wrongToneProblems = pixelLightProblems(wrongToneCss)
check(wrongToneCss !== PIXEL_CSS && wrongToneProblems.length > 0, '反例 b：把一个浅色令牌值改错 → 判据报红（' + wrongToneProblems.length + ' 条：' + wrongToneProblems.slice(0, 2).join('；') + '）')

// 浅色纸面上的对比度：真算一遍，不凭眼睛。正文与次要字走 4.5:1 那条线；
// 强调绿在浅色里只当图形元素用（列表圆点、星号、块引用左边框、悬停描边），按 WCAG 1.4.11 的 3:1 判。
{
  const lightDecl = (PIXEL_CSS.match(/body:not\(\[data-ds-dark-theme\]\) \.pixel-tab\s*\{([^}]*)\}/) || ['', ''])[1]
  const valOf = function (name: string): string {
    const m = lightDecl.match(new RegExp(name + ':(#[0-9a-fA-F]{6})'))
    return m ? m[1].toLowerCase() : ''
  }
  const groups = [
    { line: 4.5, pairs: [['ink/paper', '--pixel-ink', '--pixel-paper'], ['ink2/card', '--pixel-ink2', '--pixel-card'], ['link/paper', '--pixel-link', '--pixel-paper']] },
    { line: 3, pairs: [['acc/paper', '--pixel-acc', '--pixel-paper']] },
  ]
  const shown: string[] = []
  const low: string[] = []
  for (const group of groups) {
    for (const p of group.pairs) {
      const ratio = pixelContrast(valOf(p[1]), valOf(p[2]))
      shown.push(p[0] + ' ' + ratio.toFixed(2))
      if (!(ratio >= group.line)) low.push(p[0] + ' ' + valOf(p[1]) + ' on ' + valOf(p[2]) + ' = ' + ratio.toFixed(2) + '（该 ≥ ' + group.line + '）')
    }
  }
  check(low.length === 0, '浅色纸面上的字与图形都过线：字 4.5:1、强调色 3:1（' + shown.join('、') + '）' + (low.length ? ' —— 不达标：' + low.join('；') : ''))
}

console.log('合计 ' + pass + ' 通过 / ' + fail + ' 失败')
if (fail) console.log('存在失败')
process.exit(fail ? 1 : 0)
