#!/usr/bin/env node
/**
 * tests/lib/render-subws-mark.js —— 把面板那枚归属标志放进真浏览器环境里渲染一次的小工具
 *
 * 为什么要它：#666 的病因是「组件读了没人写的字段 → 每次都返回 null」。原来两条子目录门禁
 *   断的都是「所选目录 → 工作区根」那张表和源码里的字符串，断不到「这枚标志到底画不画得出来」，
 *   所以缺陷一路过关。这里把渲染这件事做成可复用的工具，让门禁与复现脚本都能真的画一遍。
 *
 * 真到什么程度：真的 jsdom、真的 React（两者都来自本仓 devDependencies）、组件源码从真源
 *   原样取出、浮层文案从真 locale 里取。只有两个东西是替身 —— Tip 与 host，因为本工具不测
 *   浮层的样式，也不真去开文件夹；它俩的调用记录会回给调用方自己去断言。
 *
 * 用法：
 *   const { renderMark } = require('./lib/render-subws-mark.js')
 *   const r = await renderMark(store, { lang: 'zh', src: 可选的源码文本, click: true })
 *   r.html        渲染出来的 DOM 文本
 *   r.isSub       这枚标志出现了没有（真看 DOM，不看字段）
 *   r.tipCalls    给 Tip 的调用记录（含 content 与 visible，用来断言文案与「首次自动展开」）
 *   r.hostCalls   给 host.call 的调用记录（用来断言「点一下打开工作区根」）
 *   r.hasLink     渲染结果里有没有那圈可点的链接
 */
const fs = require('fs')
const path = require('path')
const { JSDOM } = require('jsdom')

const ROOT = path.resolve(__dirname, '..', '..')
const MARK_REL = 'src/client/views/SubworkspaceMark.js'

/** 取真 locale 里的浮层四行文案（中英各一条，顺序与文件里两处一致）。 */
function tipsFromLocale() {
  const src = fs.readFileSync(path.join(ROOT, 'src/client/kernel/locale-panel.js'), 'utf8')
  const re = /'panel\.wsMarkTip':\s*'((?:[^'\\]|\\.)*)'/g
  const out = []
  let m
  while ((m = re.exec(src)) !== null) out.push(m[1].replace(/\\n/g, '\n').replace(/\\'/g, "'"))
  return out
}

/** 真源里的纯函数那把规整函数（大小写、分隔符都折算到同一把钥匙）。 */
function subwsCmpKey(keyOf, v) {
  try { return (typeof keyOf === 'function') ? String(keyOf(v)) : String(v == null ? '' : v) } catch (e) { return '' }
}

/** 真源里的纯函数那把规整钥匙（与门禁同一件，不另写仿制品）。 */
function keyOfFn() {
  const src = fs.readFileSync(path.join(ROOT, 'src/shared/workspaceKey.js'), 'utf8').replace(/^\s*export\s+/gm, '')
  return new Function(src + '\nreturn keyOf')()
}

/**
 * 把某一版组件源码装成一个能渲的组件。只做两件不改行为的事：剥掉行首 export，补上闭包变量。
 * @param {string} src 组件源码文本
 * @param {object} env { React, h, keyOf, tr, Tip, host, localStorage, chainStep }
 */
function makeMark(src, env) {
  const body = src.replace(/^\s*export\s+/gm, '')
  const factory = new Function(
    'keyOf', 'tr', 'Tip', 'host', 'React', 'h', 'localStorage', 'chainStep',
    body + '\nreturn SubworkspaceMark'
  )
  return factory(env.keyOf, env.tr, env.Tip, env.host, env.React, env.h, env.localStorage, env.chainStep)
}

/**
 * 把交给浮层的那些 React 元素里的文字全取出来（浮层内容是个元素，不是字符串）。
 * 门禁要断言「第四行到底画没画出来」，就得看得见元素里的文字。
 */
function textOf(node) {
  if (node == null) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  const kids = node.props && node.props.children
  return kids == null ? '' : textOf(kids)
}

/** 某一次渲染里，浮层上真正会显示的文字。 */
function tipTextOf(tipCalls) {
  return (tipCalls || []).map(function (c) { return textOf(c && c.content) }).join('\n')
}

/**
 * 渲染这枚标志一次（可选再点一下）。
 * @param {object} store 本会话的 store（要断言的是它带着 st.snapshot.workspaceRoot、cwd 是子目录）
 * @param {{lang?:string, src?:string, click?:boolean, autoShown?:boolean, chainInit?:string}} [opts]
 *   lang 取 'zh'（默认）| 'en'，决定浮层文案；src 换一版组件源码（复现脚本用它喂旧版）；
 *   click 为真时渲染完真的点一下那枚标志，把 host.call 的记录收回来；
 *   autoShown 为真时假装「这个工作区以前已经自动展开过」（记的键与组件读的键是同一条）；
 *   chainInit 给出检查链里 tracker:initialized 那一步的状态（'done' / 'current' / 不给）。
 */
async function renderMark(store, opts) {
  const o = opts || {}
  const lang = o.lang === 'en' ? 1 : 0
  const src = o.src || fs.readFileSync(path.join(ROOT, MARK_REL), 'utf8')
  const tips = tipsFromLocale()
  if (tips.length !== 2) throw new Error('真实 locale 里 panel.wsMarkTip 应有中英两条，实际 ' + tips.length + ' 条')

  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1:59519/' })
  const { window } = dom
  global.window = window
  global.document = window.document
  try { global.navigator = window.navigator } catch (e) {}
  global.Node = window.Node
  global.HTMLElement = window.HTMLElement
  if (typeof window.ResizeObserver === 'undefined') window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  global.ResizeObserver = window.ResizeObserver
  // React 19 要求显式声明「这是测试环境」，否则每次 act() 都会打一行红字警告（与结论无关的噪音）
  global.IS_REACT_ACT_ENVIRONMENT = true
  window.IS_REACT_ACT_ENVIRONMENT = true

  const React = require('react')
  const ReactDOMClient = require('react-dom/client')
  const { act } = require('react')

  const tr = function (key, params) {
    let s = (key === 'panel.wsMarkTip') ? tips[lang] : key
    if (params) s = s.replace(/\{(\w+)\}/g, function (m, name) { return (name in params) ? String(params[name]) : m })
    return s
  }
  const tipCalls = []
  // 诊断开关：把 React 的控制台抱怨连组件栈一起打出来（默认关，免得刷屏）
  if (process.env.DSW_MARK_DEBUG_WARN === '1') {
    const orig = console.error
    console.error = function () {
      const a = Array.prototype.slice.call(arguments).map(String).join(' ').slice(0, 160)
      if (a.indexOf('unique "key"') >= 0) { orig('  [warn] ' + a); orig('  [stack] ' + (new Error().stack || '').split('\n').slice(1, 6).join(' | ')) }
      else orig.apply(null, arguments)
    }
  }
  // Tip 的最小替身：真实现是浮层组件，本工具不测它的样式，只把内容与 visible 记下来。
  // 注意 children 要原样透传、不许自己包一层数组 —— 包了会让 React 报「list 缺 key」，
  // 而真 Tip 是把这一个 VNode 原样交给浮层的（那行警告只属于仿制品，不属于组件）。
  const Tip = function (props) {
    tipCalls.push(props || {})
    const p = props || {}
    return React.createElement('span', { 'data-tip': 1, 'data-tip-visible': p.visible === true ? '1' : '0' }, p.children)
  }
  const hostCalls = []
  const host = { call: function (method, args) { hostCalls.push({ method: method, args: args }); return Promise.resolve({ ok: true }) } }
  const keyOf = keyOfFn()
  // 「已经自动展开过」这份记录按**工作区根**那把键记，与组件里读它的地方同一把键
  //   （组件读的是 subwsMarkCmpKey(root)，root 取的是快照里那个 workspaceRoot）。
  if (o.autoShown && store && store.snapshot && store.snapshot.workspaceRoot) {
    const m = {}
    m[subwsCmpKey(keyOf, store.snapshot.workspaceRoot)] = 1
    window.localStorage.setItem('dsws.subwsAutoShown', JSON.stringify(m))
  }
  // 检查链那一步的替身：给什么状态就是什么状态；不给就返回 null（＝那一步还没跑，组件当作「不知道」）
  const chainStep = function (st, id) {
    if (id !== 'tracker:initialized' || !o.chainInit) return null
    return { id: id, status: o.chainInit }
  }
  const Comp = makeMark(src, { React: React, h: React.createElement, keyOf: keyOf, tr: tr, Tip: Tip, host: host, localStorage: window.localStorage, chainStep: chainStep })

  const container = window.document.createElement('div')
  window.document.body.appendChild(container)
  let root = null
  // 静默等一拍：组件挂载后那「首次自动展开」是在副作用里起的状态（#650 定的行为），
  //   等它落地再断言。这一段不属于断言对象，只是给 React 把队列跑完的时间。
  const settle = async function () {
    await act(async function () { await new Promise(function (r) { setTimeout(r, 30) }) })
  }
  try {
    await act(async function () { root = ReactDOMClient.createRoot(container) })
    await act(async function () { root.render(React.createElement(Comp, { st: store })) })
    await settle()
    let link = container.querySelector('[data-subws-mark-link]')
    if (o.click && link) {
      await act(async function () {
        link.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
      })
      await settle()
    }
    const html = container.innerHTML
    // isSub 按图标那一处本身找（[data-subws-mark]），不要拿子串搜 —— 「data-subws-mark-link」里也含这段字，
    //   只画了外层链接、没画里面图标时，子串搜会误判成「画出来了」。
    return { html: html, isSub: !!container.querySelector('[data-subws-mark]'), tipCalls: tipCalls, hostCalls: hostCalls, hasLink: !!link }
  } finally {
    try { if (root) await act(async function () { root.unmount() }) } catch (e) {}
    try { container.parentNode.removeChild(container) } catch (e) {}
  }
}

module.exports = { renderMark: renderMark, tipsFromLocale: tipsFromLocale, keyOfFn: keyOfFn, tipTextOf: tipTextOf, ROOT: ROOT }
