#!/usr/bin/env node
/**
 * verify-1927-tip-first-frame-browser.ts —— 悬停提示第一次出现时不许先画在估算位置再跳（#1927）
 *
 * 用户症状：右侧面板里把鼠标移到带悬停提示的按钮上，气泡先在面板中间某处出现，随后闪跳到按钮旁。
 * 根因（#1927 诊断）：提示第一次提交时还没有量到自己的真实宽高，旧实现先用 320×32 的估算尺寸
 * 算出落点并立刻画出来，挂载后的被动 effect 才量真实宽高再改位置。右侧面板里的短提示实际宽度
 * 远小于 320，贴右缘时第一笔被按 320 宽夹回屏幕内，量到真实尺寸后才回到按钮旁。
 *
 * 这一扇断的不是「最终落点对不对」（那是 tests/verify-tip-place.ts 与 tests/verify-hovertip.ts 的事），
 * 而是「第一次可见的那一笔落在哪」：把真实的 HoverTip.ts 与 tipPlace.ts 放进真 Chromium，用
 * MutationObserver 在**每个任务边界**记录提示的位置与可见性。浏览器画的一帧就是「上一个任务边界时
 * 的 DOM 状态」，所以任务边界上出现过的每一种可见位置，都是用户可能看到的一帧。
 *
 * 判据（每条用例都断）：
 *   B1 整段显示过程里只出现过一种可见位置——第一次可见时的位置就是最终位置，没有可见的跳动。
 *   B2 那一种位置与 computeTipPlace 按真实宽高独立复算的结果一致（这次修复没有碰几何）。
 *   B3 提示确实出现过（防止「什么都不显示」也能判绿）。
 *
 * 为什么必须真浏览器：jsdom 没有排版引擎，getBoundingClientRect 恒为 0，量不出「320 宽估算」与
 *   「59 宽真实尺寸」的差别；#1927 的组件级复现也证明这条路径与面板宽度无关，只与尺寸差有关。
 * 为什么按任务边界采样、而不是逐动画帧：被动 effect 与提交常常落在同一个任务里，逐动画帧会漏掉
 *   用户其实看不到的中间状态（本机实测旧代码两笔相隔约 5 毫秒，动画帧已经看不到第一笔）；
 *   按任务边界采样既能抓到「跨任务留下的错误可见帧」，又不会把同一任务里的内部重算误判成跳动。
 *
 * C 组是这把尺子的自检（反证）：把这次修复的两半都关掉——可见性不再等量到、布局 effect 退回被动
 *   effect——再量同一种场景，必须量出两种可见位置。关不干净（补丁打不上）也判红，否则这一扇是假绿。
 *
 * 跑法：node --import ./scripts/ts-hook.mts tests/verify-1927-tip-first-frame-browser.ts
 * 依赖：playwright（含 chromium），浏览器实例经 tests/lib/browser-pool.ts 取：
 *   没设 DSH_TEST_BROWSER_WS 时自己起一个，设了就共用 scripts/browser-host.mts 起的那一只。
 * 门禁归属: src/client/views/primitives/HoverTip.ts
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { build } from 'esbuild'
import { parse as parseYaml } from 'yaml'
import { getBrowser, closeBrowser } from './lib/browser-pool.js'
import { sourceText } from './lib/source-text.ts'
import { computeTipPlace } from '../src/client/views/primitives/tipPlace.ts'

// 页面求值回调里出现的 window 只是浏览器侧的全局名，门禁进程里并没有它；运行时这些回调只被
// 序列化送进页面执行，从不在门禁进程里取值。
declare const window: any

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

let passed = 0
let failed = 0
function check(ok: unknown, msg: string): void {
  if (ok) { console.log('  PASS ' + msg); passed++ }
  else { console.log('  FAIL ' + msg); failed++ }
}

// ---------- A 组：源码里有这道闸（真正的判据在 B 组，这里只是让「修哪儿」一眼可见） ----------
const hoverSrc = sourceText('src/client/views/primitives/HoverTip.ts')
// 下面这两条模式同时是 C 组反证补丁的落点：拿同一对模式把修复关掉，再让同一把尺子去量旧行为。
const VISIBILITY_GATE_RE = /visibility:\s*tipMeasured\s*\?\s*'visible'\s*:\s*'hidden'/
const BEFORE_PAINT_RE = /\?\s*React\.useLayoutEffect\s*:\s*React\.useEffect/
console.log('[A 源码：提示在量到之前不可见，且量尺寸在绘制之前生效]')
check(VISIBILITY_GATE_RE.test(hoverSrc), '提示的可见性跟着「这次量到没有」走（量到之前不可见）')
check(BEFORE_PAINT_RE.test(hoverSrc), '量尺寸与算落点走布局 effect（绘制之前生效），环境没有时退回被动 effect')

// 反证用的「旧做法」：把上面两半都关掉，等价于 #1927 修复之前的真源码。
const unfixed = (function () {
  let src = hoverSrc
  let gateHits = 0
  let hookHits = 0
  src = src.replace(VISIBILITY_GATE_RE, function () { gateHits++; return "visibility: 'visible'" })
  src = src.replace(BEFORE_PAINT_RE, function () { hookHits++; return '? React.useEffect : React.useEffect' })
  return { src: src, gateHits: gateHits, hookHits: hookHits }
})()

// ---------- 页面探针：真 React + 真 HoverTip/tipPlace 源码，浏览器里真挂载 ----------
const ENTRY = `
import React from 'react'
import { createRoot } from 'react-dom/client'
import { createPortal } from 'react-dom'
import { HoverTip } from './src/client/views/primitives/HoverTip.ts'
import { HoverTip as UnfixedHoverTip } from 'verify-1927-unfixed-tip'
import { computeTipPlace } from './src/client/views/primitives/tipPlace.ts'

// 真机里这些名字由客户端闭包提供（见 src/client/index.ts 的拼接标记）：这里按同样的形状补上。
window.React = React
window.computeTipPlace = computeTipPlace
window.DswsCtx = React.createContext(null)
window.portalTop = function (node) { return createPortal(node, document.body) }

function mount(opts) {
  const host = document.getElementById('host')
  const box = document.createElement('div')
  host.appendChild(box)
  const Comp = opts.unfixed ? UnfixedHoverTip : HoverTip
  const b = opts.button
  const trigger = React.createElement('button', {
    id: 'btn',
    type: 'button',
    style: { position: 'absolute', left: b.left + 'px', top: b.top + 'px', width: b.width + 'px', height: b.height + 'px', fontSize: '11px' },
  }, 'hover')
  const tipProps = { className: opts.className, content: opts.content }
  if (opts.maxWidth) tipProps.maxWidth = opts.maxWidth
  if (opts.delayShow) tipProps.delay = { show: opts.delayShow }
  createRoot(box).render(React.createElement(Comp, tipProps, trigger))
  return new Promise(function (done) {
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        const r = document.getElementById('btn').getBoundingClientRect()
        done({ left: r.left, top: r.top, width: r.width, height: r.height })
      })
    })
  })
}

// 每个任务边界采一次样：MutationObserver 的回调是微任务，跑在当前任务末尾、下一个任务之前，
// 所以这一刻读到的 DOM 就是「浏览器接下来画的那一帧」。
function record(selector) {
  window.__BATCHES__ = []
  window.__HOVER_AT__ = null
  const btn = document.getElementById('btn')
  const onOver = function () {
    if (window.__HOVER_AT__ === null) window.__HOVER_AT__ = performance.now()
    btn.removeEventListener('mouseover', onOver, true)
  }
  btn.addEventListener('mouseover', onOver, true)
  const snap = function () {
    const el = document.querySelector(selector)
    if (!el) return { present: false }
    const cs = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    return { present: true, left: r.left, top: r.top, width: r.width, height: r.height, visibility: cs.visibility, opacity: cs.opacity }
  }
  const mo = new MutationObserver(function (records) {
    window.__BATCHES__.push({
      t: performance.now(),
      records: records.length,
      kinds: records.map(function (r) { return r.type + (r.attributeName ? ':' + r.attributeName : '') }).join(','),
      snap: snap(),
    })
  })
  mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] })
  window.__STOP__ = function () { try { mo.disconnect() } catch (e) {} }
}

window.__probe = { mount: mount, record: record }
window.__PROBE_READY__ = true
`

const unfixedPlugin = {
  name: 'verify-1927-unfixed-tip',
  setup(esbuild: any): void {
    esbuild.onResolve({ filter: /^verify-1927-unfixed-tip$/ }, function () {
      return { path: 'unfixed-hover-tip', namespace: 'verify1927' }
    })
    esbuild.onLoad({ filter: /.*/, namespace: 'verify1927' }, function () {
      return { contents: unfixed.src, loader: 'ts' }
    })
  },
}

const bundled = await build({
  stdin: { contents: ENTRY, resolveDir: ROOT, sourcefile: 'verify-1927-probe.js', loader: 'js' },
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'chrome120',
  write: false,
  logLevel: 'error',
  // 与真机产物同一档 React：生产档没有开发期的额外检查，先画后量的时序与线上一致。
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [unfixedPlugin],
})
const probeJs = bundled.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')

const pageHtml = function (): string {
  return '<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:#111;color:#eee}' +
    '#host{position:relative;width:100%;height:100%}' +
    'button{background:#333;color:#eee;border:1px solid #555;padding:0}</style></head>' +
    '<body><div id="host"></div><script>' + probeJs + '</script></body></html>'
}

// ---------- 用例：短提示贴右缘 / 长提示 / 窄视口贴右缘 / 面板那档显示延时 / 收起后再悬停 ----------
type ProbeCase = {
  id: string
  why: string
  viewport: { width: number; height: number }
  button: { left: number; top: number; width: number; height: number }
  content: string
  maxWidth?: number
  delayShow?: number
  second?: boolean
}

const LONG_TEXT = '这是一条很长的悬停提示，用来把提示本体的宽度顶到 320 的宽度上限，' +
  '再看看第一次出现时是不是也老老实实落在触发控件上方，而不是先按估算尺寸画在别处。'

const CASES: ProbeCase[] = [
  {
    id: 'short-right-edge',
    why: '用户报的那一种：短提示、按钮贴着面板右缘',
    viewport: { width: 1600, height: 1000 },
    button: { left: 1500, top: 300, width: 60, height: 28 },
    content: '短提示',
  },
  {
    id: 'long-centered',
    why: '长提示：真实宽度顶到 320 上限，宽度一样但高度差得多',
    viewport: { width: 1600, height: 1000 },
    button: { left: 600, top: 500, width: 80, height: 24 },
    content: LONG_TEXT,
  },
  {
    id: 'narrow-right-edge',
    why: '窄视口 + 贴右缘：生效宽度按屏幕收窄',
    viewport: { width: 520, height: 420 },
    button: { left: 440, top: 120, width: 56, height: 28 },
    content: '短提示',
  },
  {
    id: 'panel-delay',
    why: '面板走 Tip 预设的那档显示延时：延时之后出现，出现即最终位置',
    viewport: { width: 1600, height: 1000 },
    button: { left: 1500, top: 300, width: 60, height: 28 },
    content: '短提示',
  },
  {
    id: 'second-show',
    why: '收起之后再悬停一次：每次显示都要重新量，不能拿上一次的尺寸',
    viewport: { width: 1600, height: 1000 },
    button: { left: 1500, top: 300, width: 60, height: 28 },
    content: '短提示',
    second: true,
  },
]

// 面板那档显示延时取自 config/intervals.yaml（时间参数只有这一处真源），
// 不在门禁里另写一个数字。
const timeConfig = parseYaml(readFileSync(join(ROOT, 'config', 'intervals.yaml'), 'utf8')) as any
const PANEL_SHOW_DELAY = Number(timeConfig && timeConfig.intervals && timeConfig.intervals.tipShowDelayMs)
check(Number.isFinite(PANEL_SHOW_DELAY) && PANEL_SHOW_DELAY > 0, '面板那档显示延时读自 config/intervals.yaml（读到 ' + PANEL_SHOW_DELAY + ' 毫秒）')
for (const c of CASES) if (c.id === 'panel-delay') c.delayShow = PANEL_SHOW_DELAY

type Snap = { present: boolean; left: number; top: number; width: number; height: number; visibility: string; opacity: string }
type Batch = { t: number; records: number; kinds: string; snap: Snap }
type Episode = { batches: Batch[]; hoverAt: number | null }

// 「能被看到」的一笔：在文档里、不是 visibility:hidden、不透明、有实际大小。
function visibleBatches(ep: Episode): Batch[] {
  return ep.batches.filter(function (b) {
    const s = b.snap
    return !!s && s.present === true && s.visibility !== 'hidden' && Number(s.opacity) > 0 && s.width > 0 && s.height > 0
  })
}
function positionKey(b: Batch): string {
  return Math.round(b.snap.left) + ',' + Math.round(b.snap.top)
}
function describeShape(b: Batch): string {
  return Math.round(b.snap.left) + 'x' + Math.round(b.snap.top) + '（' + b.snap.width.toFixed(1) + '×' + b.snap.height.toFixed(1) + '）'
}

async function runEpisode(page: any, rect: any, selector: string, waitMs: number): Promise<Episode> {
  await page.evaluate(function (s: string) { window.__probe.record(s) }, selector)
  await page.mouse.move(rect.left + rect.width / 2, rect.top + rect.height / 2, { steps: 3 })
  await page.waitForTimeout(waitMs)
  return await page.evaluate(function () {
    window.__STOP__()
    return { batches: window.__BATCHES__, hoverAt: window.__HOVER_AT__ }
  })
}

/**
 * 一次显示过程：悬停 → 记录任务边界 → 断言「只出现过一种可见位置」并且它就是几何解。
 * 用例带了 delayShow 时，另外断「出现时刻不早于配置的显示延时」（延时没有被绕过）。
 */
async function judgeEpisode(c: ProbeCase, ep: Episode, rect: any): Promise<void> {
  const tag = c.id + ' '
  const seen = visibleBatches(ep)
  check(seen.length > 0, tag + '提示确实出现过（' + seen.length + ' 个可见的任务边界，共 ' + ep.batches.length + ' 个边界）')
  if (!seen.length) return
  const keys = seen.map(positionKey).filter(function (k, i, all) { return all.indexOf(k) === i })
  const first = seen[0]
  const last = seen[seen.length - 1]
  check(keys.length === 1, tag + '整段显示里只出现过一种可见位置（出现了 ' + keys.length + ' 种：' + keys.join(' / ') + '，用例：' + c.why + '）')
  check(positionKey(first) === positionKey(last), tag + '第一次可见的位置就是最终位置（第一次 ' + describeShape(first) + ' / 最终 ' + describeShape(last) + '）')

  // 落点必须与方位纯函数按真实宽高复算的结果一致：这次修复不碰几何。
  const maxWidth = typeof c.maxWidth === 'number' ? c.maxWidth : 320
  const want: any = computeTipPlace(rect, { width: last.snap.width, height: last.snap.height }, c.viewport, maxWidth)
  check(Math.abs(want.x - last.snap.left) <= 0.5 && Math.abs(want.y - last.snap.top) <= 0.5,
    tag + '最终落点与 computeTipPlace 复算一致（画面 ' + describeShape(last) + ' / 复算 ' + want.placement + ' ' + want.x + ',' + want.y + '）')
  check(want.placement === 'above', tag + '仍然锚定在触发控件上方（复算方位 ' + want.placement + '）')

  if (typeof c.delayShow === 'number' && typeof ep.hoverAt === 'number') {
    const waited = Math.round(first.t - ep.hoverAt)
    check(waited >= c.delayShow - 25, tag + '显示延时没有被绕过：悬停后 ' + waited + ' 毫秒才出现，配置是 ' + c.delayShow + ' 毫秒')
  }
}

async function runCase(browser: any, c: ProbeCase, waitMs: number): Promise<void> {
  console.log('')
  console.log('[B ' + c.id + '] ' + c.why)
  const page = await browser.newPage({ viewport: c.viewport })
  const pageErrors: string[] = []
  page.on('pageerror', function (e: any) { pageErrors.push('pageerror: ' + String((e && e.message) || e)) })
  page.on('console', function (m: any) { if (m.type() === 'error') pageErrors.push('console: ' + m.text()) })
  try {
    await page.setContent(pageHtml(), { waitUntil: 'load' })
    await page.waitForFunction(function () { return window.__PROBE_READY__ === true }, null, { timeout: 20000 })
    await page.mouse.move(2, 2)
    const rect = await page.evaluate(function (o: any) { return window.__probe.mount(o) }, {
      content: c.content, className: 'tip-probe', maxWidth: c.maxWidth, delayShow: c.delayShow, button: c.button,
    })
    const ep = await runEpisode(page, rect, '.tip-probe', waitMs)
    check(pageErrors.length === 0, c.id + ' 页面没有报错' + (pageErrors.length ? '：' + pageErrors.slice(0, 3).join(' | ') : ''))
    await judgeEpisode(c, ep, rect)

    if (c.second) {
      // 收起（隐藏延时 160 毫秒由组件自己管）→ 第二次悬停：这次同样不许先画在别处。
      console.log('[B ' + c.id + '] 收起后再悬停一次')
      await page.mouse.move(2, 2)
      await page.waitForTimeout(500)
      const stillVisible = await page.evaluate(function () {
        const el = document.querySelector('.tip-probe')
        if (!el) return false
        const cs = getComputedStyle(el)
        return cs.visibility !== 'hidden' && Number(cs.opacity) > 0
      })
      check(stillVisible === false, c.id + ' 鼠标移开后提示已经收起（第二次显示才是干净的一次）')
      const ep2 = await runEpisode(page, rect, '.tip-probe', waitMs)
      await judgeEpisode(c, ep2, rect)
    }
  } finally {
    try { await page.close() } catch (e) { /* 页面可能已经自己关了 */ }
  }
}

// ---------- C 组：反证。把修复关掉之后，同一把尺子必须量出两种可见位置 ----------
async function runCounterProof(browser: any, c: ProbeCase, waitMs: number): Promise<void> {
  console.log('')
  console.log('[C 反证] 把可见闸与绘制前测量都关掉，同一场景必须量出两种可见位置（否则 B 组是假绿）')
  check(unfixed.gateHits === 1 && unfixed.hookHits === 1,
    '反证补丁打上了：可见闸 ' + unfixed.gateHits + ' 处、布局 effect ' + unfixed.hookHits + ' 处（旧行为就是这两半都关掉的样子）')
  if (unfixed.gateHits !== 1 || unfixed.hookHits !== 1) return
  const page = await browser.newPage({ viewport: c.viewport })
  try {
    await page.setContent(pageHtml(), { waitUntil: 'load' })
    await page.waitForFunction(function () { return window.__PROBE_READY__ === true }, null, { timeout: 20000 })
    await page.mouse.move(2, 2)
    const rect = await page.evaluate(function (o: any) { return window.__probe.mount(o) }, {
      content: c.content, className: 'tip-probe', button: c.button, unfixed: true,
    })
    const ep = await runEpisode(page, rect, '.tip-probe', waitMs)
    const seen = visibleBatches(ep)
    const keys = seen.map(positionKey).filter(function (k, i, all) { return all.indexOf(k) === i })
    check(seen.length > 0, '反证组件确实出现过（' + seen.length + ' 个可见的任务边界）')
    check(keys.length > 1, '反证：关掉修复后量出 ' + keys.length + ' 种可见位置（' + keys.join(' / ') + '）——旧行为必红，这把尺子测得出来')
    if (keys.length > 1) {
      console.log('  说明：第一笔落在估算位置 ' + describeShape(seen[0]) + '，随后才回到 ' + describeShape(seen[seen.length - 1]))
    }
  } finally {
    try { await page.close() } catch (e) { /* 页面可能已经自己关了 */ }
  }
}

async function main(): Promise<void> {
  const browser = await getBrowser({ headless: true })
  try {
    for (const c of CASES) {
      const waitMs = (typeof c.delayShow === 'number' ? c.delayShow : 0) + 420
      await runCase(browser, c, waitMs)
    }
    // 反证只用「用户报的那一种」：短提示贴右缘，差异最大、最好读。
    await runCounterProof(browser, CASES[0], 420)
  } finally {
    await closeBrowser()
  }
}

main().then(function (): void {
  console.log('')
  if (failed) {
    console.log('存在失败 — 悬停提示第一次出现时仍然先画在估算位置（' + passed + ' 条通过，' + failed + ' 条失败）')
  } else {
    console.log('全部通过 — 悬停提示第一次可见就是最终位置：' + passed + ' 条断言（短提示/长提示/窄视口/显示延时/二次显示 + 反证）')
  }
  process.exit(failed ? 1 : 0)
}).catch(function (err: any): void {
  console.log('  FAIL 门禁自己抛错：' + String((err && err.stack) || err))
  closeBrowser().then(function () { process.exit(1) })
})
