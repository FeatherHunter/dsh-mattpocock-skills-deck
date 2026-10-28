// tests/verify-1411-suggest-bubble.ts —— 门禁：状态胶囊上方的下一步建议气泡（#1411）
//
// 契约（票面 #1411 验收①~⑤、⑦、⑨）：
//   - 挂页面浮层：层由 kernel:portal 的 PortalOverlay 挂到 body，position:fixed，z-index 取 SUGGEST_Z
//     （胶囊之上、仓库顶层浮层 2147483000 之下）；悬停理由用框正上方浮层，位置固定、不跟鼠标；
//   - 选项 2~4 颗，点一条走既有 inject（把文本填进输入框、不发送），点完/关闭整组消失；
//   - 第二组覆盖第一组；真按钮可聚焦，回车/空格填入，Esc 关整组；理由对读屏可读（aria-label）；
//   - 窄栏不溢出（层宽收在视口内、选项行可换行、单颗有上限）；数据不合法不崩、不渲染半成品；
//   - 源码守卫：外观旋钮集中一处（层级常量值不变、样式不写死尺寸）、界面不越权碰会话服务、
//     三片叶子在入口与构建清单里登记齐全。
//
// 跑法：node --import ./scripts/ts-hook.mts tests/verify-1411-suggest-bubble.ts
// 断言数变化时同步 scripts/gate-map.mts 里 COMPLETION_RECORDED_GATES 的 verify-1411-suggest-bubble。
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')
const { printGateResult } = require('./lib/gate-result.ts')
const { JSDOM } = require('jsdom')
const React = require('react')
const ROOT = path.resolve(__dirname, '..')
const imp = function (rel) { return import(pathToFileURL(path.join(ROOT, rel)).href) }

const failures = []
let total = 0
function check(ok, label) {
  total++
  if (!ok) failures.push(label)
}
// 源码守卫只看代码行：整行注释与块注释里的字眼不算（注释里可以提到「sessions」「2147483000」这类名字）。
function codeOnly(src) {
  return String(src)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(function (line) { return line.trim().indexOf('//') !== 0 })
    .join('\n')
}

async function main() {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    url: 'http://127.0.0.1:59519/',
    runScripts: 'dangerously',
  })
  const win = dom.window
  global.window = win
  global.document = win.document
  try { global.navigator = win.navigator } catch (eNav) {}
  global.Node = win.Node
  global.HTMLElement = win.HTMLElement
  global.getComputedStyle = win.getComputedStyle.bind(win)
  global.requestAnimationFrame = win.requestAnimationFrame ? win.requestAnimationFrame.bind(win) : function (cb) { return setTimeout(cb, 0) }
  global.cancelAnimationFrame = win.cancelAnimationFrame ? win.cancelAnimationFrame.bind(win) : function (id) { clearTimeout(id) }
  win.React = React
  global.React = React
  const ReactDOMClient = require('react-dom/client')
  win.ReactDOM = ReactDOMClient
  global.ReactDOM = ReactDOMClient
  global.IS_REACT_ACT_ENVIRONMENT = true
  const act = React.act

  // 词表：与 config/copy/panel.yaml 的 suggest.* 同形；键缺了按键名回退（和真 tr 一致）。
  const dict = {
    'suggest.group': '下一步建议',
    'suggest.close': '关闭（等于一条都不选）',
    'suggest.ariaPill': '{prompt}；推荐理由：{reason}',
    'suggest.live': '有 {n} 条下一步建议',
  }
  function trFn(key, params) {
    let text = (dict[key] !== undefined) ? dict[key] : key
    if (params) {
      text = text.replace(/\{(\w+)\}/g, function (m, name) {
        return (params[name] !== undefined) ? String(params[name]) : m
      })
    }
    return text
  }
  global.tr = trFn

  // 跨叶子自由变量：外观常量、三片叶子对内核/相邻叶子的调用，都在这里打桩（真机由构建闭包提供）。
  const appearanceMod = await imp('src/client/statusbar/suggestAppearance.ts')
  global.SUGGEST_Z = appearanceMod.SUGGEST_Z
  global.SUGGEST_APPEARANCE = appearanceMod.SUGGEST_APPEARANCE
  // #1236：动画时长住在 kernel/motion.ts 的 MOTION 里，样式叶子求值前必须先接上。
  const motionMod = await imp('src/client/kernel/motion.ts')
  global.MOTION = motionMod.MOTION
  const injectCalls = []
  const portalCalls = []
  global.inject = function (st, text) { injectCalls.push({ st: st, text: text }) }
  global.PortalOverlay = function (props, children) {
    portalCalls.push(props)
    return React.createElement('div', props || {}, children)
  }
  portalCalls.length = 0

  const stylesMod = await imp('src/client/statusbar/suggestStyles.ts')
  const bubbleMod = await imp('src/client/statusbar/suggestBubble.ts')

  // ---------- 渲染夹具：真 jsdom + 真 React，只有跨叶子调用是桩 ----------
  const extraInputs = []
  async function mount(options) {
    const opts = options || {}
    const host = document.createElement('div')
    document.body.appendChild(host)
    // 输入框锚点用：真的往文档里塞 textarea（宿主输入框的最小仿形），量不到时自然退回胶囊。
    if (opts.inputRect) {
      const input = document.createElement('textarea')
      input.getBoundingClientRect = function () { return opts.inputRect }
      document.body.appendChild(input)
      extraInputs.push(input)
    }
    const capsule = document.createElement('div')
    capsule.className = 'dsws-capsule'
    if (opts.capsuleRect) {
      capsule.getBoundingClientRect = function () { return opts.capsuleRect }
    }
    host.appendChild(capsule)
    const holder = document.createElement('div')
    capsule.appendChild(holder)
    const st = { injector: function () {} }
    let setGroup = null
    function Host() {
      const state = React.useState(opts.initial ? { id: 1, items: opts.initial } : null)
      setGroup = state[1]
      const group = state[0]
      if (!group) return null
      return React.createElement(bubbleMod.SuggestBubble, {
        st: st,
        sid: 'sid-1',
        group: group,
        onDismiss: function () { setGroup(null) },
      })
    }
    const root = ReactDOMClient.createRoot(holder)
    await act(async function () {
      root.render(React.createElement(Host))
      await new Promise(function (resolve) { setTimeout(resolve, 0) })
    })
    return {
      host: host,
      capsule: capsule,
      holder: holder,
      st: st,
      async setItems(items, id) {
        await act(async function () {
          setGroup({ id: id || 2, items: items })
          await new Promise(function (resolve) { setTimeout(resolve, 0) })
        })
      },
      pills: function () { return Array.prototype.slice.call(holder.querySelectorAll('.dsws-sugg-pill')) },
      layer: function () { return holder.querySelector('.dsws-sugg-layer') },
      closeBtn: function () { return holder.querySelector('.dsws-sugg-close') },
      sr: function () { return holder.querySelector('.dsws-sugg-sr') },
      async fire(node, type, event) {
        await act(async function () {
          node.dispatchEvent(event)
          await new Promise(function (resolve) { setTimeout(resolve, 0) })
        })
      },
      async click(node) {
        await act(async function () {
          node.click()
          await new Promise(function (resolve) { setTimeout(resolve, 0) })
        })
      },
      async unmount() {
        await act(async function () { root.unmount() })
        if (host.parentNode) host.parentNode.removeChild(host)
        while (extraInputs.length) {
          const input = extraInputs.pop()
          if (input && input.parentNode) input.parentNode.removeChild(input)
        }
      },
    }
  }
  function keyEvent(key) {
    return new win.KeyboardEvent('keydown', { key: key, bubbles: true, cancelable: true })
  }

  // ---------- 1. 基本形状：两颗选项、层属性、层级、锚点、读屏 ----------
  {
    injectCalls.length = 0
    const m = await mount({
      initial: [
        { intro: '接着做', prompt: '/next', reason: '因为还有一张票没关' },
        { intro: '收尾', prompt: '继续收尾', reason: '' },
      ],
      capsuleRect: { left: 100, top: 700, width: 400, height: 36 },
    })
    check(m.pills().length === 2, '基本：显示 2 颗选项')
    // #1451 后续：选项框上只印简介，提示词不进按钮（点选时才填进输入框）；两颗时每颗最大宽度均分整组（(720-6)/2=357）。
    check(m.pills()[0].textContent === '接着做', '基本：选项框上只显示简介')
    check(m.pills()[0].querySelector('.dsws-sugg-cmd') === null && m.pills()[0].textContent.indexOf('/next') < 0, '基本：提示词不进按钮（点选时才填）')
    check(m.pills()[0].style.maxWidth === '357px' && m.pills()[1].style.maxWidth === '357px', '基本：两颗时每颗最大宽度均分整组（(720-6)/2=357）')
    check(m.pills()[0].parentNode !== null && m.pills()[0].parentNode.className.indexOf('dsws-sugg-pill-wrap') >= 0, '基本：有理由的选项包在定位壳里（浮层按框顶边摆）')
    const layer = m.layer()
    check(layer !== null, '基本：气泡层已渲染')
    check(layer.getAttribute('role') === 'group', '基本：层 role=group')
    check(layer.getAttribute('aria-label') === '下一步建议', '基本：层 aria-label 走词表')
    check(layer.getAttribute('data-log') === 'suggest.group', '基本：层挂 data-log 便于查日志')
    check(layer.style.position === 'fixed', '基本：层 position:fixed（页面浮层）')
    check(layer.style.zIndex === String(appearanceMod.SUGGEST_Z), '基本：层 z-index 取具名常量 SUGGEST_Z')
    check(layer.style.pointerEvents === 'none', '基本：层本身不吃鼠标事件（只有子控件可点）')
    check(layer.style.maxWidth.indexOf('100vw') >= 0 && layer.style.maxWidth.indexOf('720') >= 0, '基本：层最大宽度受视口与旋钮共同约束')
    check(layer.style.left === '300px', '基本：锚点横向 = 胶囊中心（100+400/2）')
    check(layer.style.bottom === '77px', '基本：锚点纵向 = 视口高 - 胶囊顶 + 9（768-700+9）')
    check(m.pills()[0].getAttribute('aria-label') === '接着做 /next；推荐理由：因为还有一张票没关', '基本：选项 aria-label 念「简介 提示词」并含推荐理由（读屏可读）')
    check(m.pills()[0].parentNode.querySelector('.dsws-sugg-pop') !== null && m.pills()[0].parentNode.querySelector('.dsws-sugg-pop').textContent === '因为还有一张票没关', '基本：理由收进框正上方的浮层，内容就是理由')
    check(m.pills()[0].getAttribute('aria-describedby') === m.pills()[0].parentNode.querySelector('.dsws-sugg-pop').getAttribute('id'), '基本：按钮用 aria-describedby 指到自己的浮层')
    check(m.pills()[1].getAttribute('aria-label') === '收尾 继续收尾', '基本：没理由的选项 aria-label 念「简介 提示词」，不念理由')
    check(m.pills()[1].parentNode.querySelector('.dsws-sugg-pop') === null, '基本：没理由的选项不挂浮层')
    check(m.sr() !== null && m.sr().getAttribute('role') === 'status' && m.sr().getAttribute('aria-live') === 'polite', '基本：读屏播报节点 role=status aria-live=polite')
    check(m.sr().textContent === '有 2 条下一步建议', '基本：读屏播报条数')
    check(m.closeBtn() !== null && m.closeBtn().getAttribute('type') === 'button', '基本：关闭是真按钮')
    check(m.closeBtn().getAttribute('aria-label') === '关闭（等于一条都不选）', '基本：关闭按钮 aria-label 说明含义')
    check(portalCalls.length >= 1, '基本：层经 PortalOverlay 挂载（与胶囊菜单同招）')
    await m.fire(m.pills()[0], 'mouseover', new win.MouseEvent('mouseover', { bubbles: true, cancelable: true }))
    check(m.pills()[0].parentNode.className.indexOf('dsws-sugg-show-pop') >= 0, '基本：鼠标进入选项框浮层显现（固定在框上方，不跟鼠标）')
    await m.fire(m.pills()[0], 'mouseout', new win.MouseEvent('mouseout', { bubbles: true, cancelable: true }))
    check(m.pills()[0].parentNode.className.indexOf('dsws-sugg-show-pop') < 0, '基本：鼠标离开选项框浮层收起')
    await m.unmount()

    // 三条、四条时也要排得进一行：宽度按条数均分，条数越多每颗越窄（#1451）。
    const m3 = await mount({
      initial: [
        { intro: '一', prompt: '/one', reason: '' },
        { intro: '二', prompt: '/two', reason: '' },
        { intro: '三', prompt: '/three', reason: '' },
      ],
    })
    check(m3.pills().length === 3 && m3.pills().every(function (p) { return p.style.maxWidth === '236px' }),
      '基本：三条时每颗最大宽度均分整组（(720-12)/3=236，三条排得进一行）')
    await m3.unmount()
    const m4 = await mount({
      initial: [
        { intro: '一', prompt: '/one', reason: '' },
        { intro: '二', prompt: '/two', reason: '' },
        { intro: '三', prompt: '/three', reason: '' },
        { intro: '四', prompt: '/four', reason: '' },
      ],
    })
    check(m4.pills().length === 4 && m4.pills().every(function (p) { return p.style.maxWidth === '175px' }),
      '基本：四条时每颗最大宽度均分整组（(720-18)/4=175）')
    await m4.unmount()
  }

  // ---------- 1.5 输入框锚点：用户拍板把锚点改到输入框（折叠不折叠它都在，不再偏左） ----------
  {
    // 有输入框时按输入框定：横向对准输入框中心（200+800/2=600），纵向顶边 600 → 768-600+9=177。
    const mIn = await mount({
      initial: [{ intro: '一条', prompt: '/a', reason: 'r' }, { intro: '两条', prompt: '/b', reason: 'r' }],
      inputRect: { left: 200, top: 600, width: 800, height: 44 },
      capsuleRect: { left: 100, top: 700, width: 400, height: 36 },
    })
    check(mIn.layer() !== null && mIn.layer().style.left === '600px', '输入框锚点：横向对准输入框中心，而不是状态胶囊中心')
    check(mIn.layer().style.bottom === '177px', '输入框锚点：纵向贴在输入框顶边上方（768-600+9）')
    await mIn.unmount()
    // 一个输入框都找不到时仍退回状态胶囊（老宿主、没有 textarea 的界面）。
    const mNoIn = await mount({
      initial: [{ intro: '一条', prompt: '/a', reason: 'r' }, { intro: '两条', prompt: '/b', reason: 'r' }],
      capsuleRect: { left: 100, top: 700, width: 400, height: 36 },
    })
    check(mNoIn.layer().style.left === '300px', '输入框锚点：找不到输入框时退回胶囊中心（100+400/2）')
    await mNoIn.unmount()
    // 页面上有好几个输入域时挑最宽的那个（小的搜索框不该抢锚点）。
    const narrow = document.createElement('textarea')
    narrow.getBoundingClientRect = function () { return { left: 0, top: 500, width: 120, height: 30 } }
    document.body.appendChild(narrow)
    const mWidest = await mount({
      initial: [{ intro: '一条', prompt: '/a', reason: 'r' }, { intro: '两条', prompt: '/b', reason: 'r' }],
      inputRect: { left: 300, top: 620, width: 640, height: 44 },
    })
    check(mWidest.layer().style.left === '620px', '输入框锚点：多个输入域时挑最宽的那个当锚点（300+640/2）')
    await mWidest.unmount()
    if (narrow.parentNode) narrow.parentNode.removeChild(narrow)
  }

  // ---------- 1.6 浮层里的分数泡：模型打了分就印出来，没打分就不印 ----------
  {
    const mScore = await mount({
      initial: [
        { intro: '先做', prompt: '/a', reason: '卡在后面', priority: 9.5 },
        { intro: '后做', prompt: '/b', reason: '顺手做', priority: 3 },
        { intro: '不打分', prompt: '/c', reason: '看情况' },
      ],
    })
    const pops = function () { return Array.prototype.slice.call(mScore.holder.querySelectorAll('.dsws-sugg-pop')) }
    check(pops().length === 3, '分数泡：三颗选项各有自己的浮层')
    const scoreSpans = function () { return Array.prototype.slice.call(mScore.holder.querySelectorAll('.dsws-sugg-score')) }
    check(scoreSpans().length === 2, '分数泡：只有打了分的两条印分数泡（没打分的那条不印）')
    check(scoreSpans()[0].textContent === '9.5' && scoreSpans()[1].textContent === '3', '分数泡：印出模型给的原始分数（9.5 与 3）')
    check(pops()[0].querySelector('.dsws-sugg-reason') !== null && pops()[0].querySelector('.dsws-sugg-reason').textContent === '卡在后面', '分数泡：理由仍在同一浮层里，评分排在理由前面（贴在第一行开头）')
    const firstPopKids = Array.prototype.slice.call(pops()[0].children)
    check(firstPopKids.length === 2 && String(firstPopKids[0].className).indexOf('dsws-sugg-score') >= 0 && String(firstPopKids[1].className).indexOf('dsws-sugg-reason') >= 0, '分数泡：浮层里先分数泡、后理由正文（这个顺序让评分贴在第一行开头）')
    check(pops()[2].querySelector('.dsws-sugg-score') === null && pops()[2].textContent === '看情况', '分数泡：没打分的浮层只有理由')
    const mZero = await mount({
      initial: [
        { intro: '最后', prompt: '/a', reason: 'r', priority: 0 },
        { intro: '其次', prompt: '/b', reason: 'r', priority: 6 },
      ],
    })
    const zeroScore = mZero.holder.querySelector('.dsws-sugg-score')
    check(zeroScore !== null && zeroScore.textContent === '0', '分数泡：0 分也印出来（0 是「最后再做」，不是没打分）')
    await mZero.unmount()
    await mScore.unmount()
  }

  // ---------- 2. 点一条：走既有 inject、不发送、整组消失 ----------
  {
    injectCalls.length = 0
    const m = await mount({ initial: [{ prompt: '再跑一遍验证', reason: '上次没跑完' }] })
    await m.click(m.pills()[0])
    check(injectCalls.length === 1, '点选：调用既有 inject 恰好一次')
    check(injectCalls.length === 1 && injectCalls[0].text === '再跑一遍验证', '点选：把提示词原样交给 inject（补尾换行由 inject 负责）')
    check(injectCalls.length === 1 && injectCalls[0].st === m.st, '点选：交给同一份会话 store（不另造注入通路）')
    check(m.layer() === null && m.pills().length === 0, '点选：随后整组消失，不留半成品')
    await m.unmount()
  }

  // ---------- 3. 关闭按钮：一条不选，不注入 ----------
  {
    injectCalls.length = 0
    const m = await mount({ initial: [{ prompt: '随便一条', reason: '' }] })
    await m.click(m.closeBtn())
    check(injectCalls.length === 0, '关闭：不调用 inject（等于一条都不选）')
    check(m.layer() === null && m.pills().length === 0, '关闭：整组消失')
    await m.unmount()
  }

  // ---------- 4. 键盘：回车与空格填入；都不触发浏览器默认激活 ----------
  {
    injectCalls.length = 0
    const m = await mount({ initial: [{ prompt: '回车填入', reason: '' }] })
    const enterEvent = keyEvent('Enter')
    await m.fire(m.pills()[0], 'keydown', enterEvent)
    check(injectCalls.length === 1 && injectCalls[0].text === '回车填入', '键盘：回车把提示词填入')
    check(enterEvent.defaultPrevented === true, '键盘：回车 preventDefault，避免同一次按键触发两次')
    check(m.pills().length === 0, '键盘：回车填入后整组消失')
    await m.unmount()

    injectCalls.length = 0
    const m2 = await mount({ initial: [{ prompt: '空格填入', reason: '' }] })
    const spaceEvent = keyEvent(' ')
    await m2.fire(m2.pills()[0], 'keydown', spaceEvent)
    check(injectCalls.length === 1 && injectCalls[0].text === '空格填入', '键盘：空格把提示词填入')
    check(m2.pills().length === 0, '键盘：空格填入后整组消失')
    await m2.unmount()
  }

  // ---------- 5. Esc 关整组（焦点在哪都能关） ----------
  {
    injectCalls.length = 0
    const m = await mount({ initial: [{ prompt: '不该被填进去', reason: '' }] })
    await m.fire(document, 'keydown', keyEvent('Escape'))
    check(injectCalls.length === 0, 'Esc：关组不等于选一条，不注入')
    check(m.layer() === null, 'Esc：整组消失')
    await m.unmount()
    // 卸载后监听要摘掉：再按 Esc 不该有任何异常或副作用。
    let threw = false
    try { document.dispatchEvent(keyEvent('Escape')) } catch (eEsc) { threw = true }
    check(threw === false, 'Esc：组件卸载后监听已摘，再按不抛')
  }

  // ---------- 6. 第二组覆盖第一组 ----------
  {
    const m = await mount({ initial: [{ prompt: '旧的一组', reason: '' }] })
    await m.setItems([{ prompt: '新的第一条', reason: '' }, { prompt: '新的第二条', reason: '' }], 7)
    check(m.holder.querySelectorAll('.dsws-sugg-layer').length === 1, '覆盖：任何时刻只有一组气泡层')
    check(m.holder.textContent.indexOf('旧的一组') < 0, '覆盖：旧一组不再显示')
    check(m.pills().length === 2 && m.pills()[0].textContent === '新的第一条', '覆盖：显示的是新一组')
    await m.unmount()
  }

  // ---------- 7. 防御性渲染：条数越界、空数组、坏形状都不崩 ----------
  {
    const m6 = await mount({ initial: [
      { prompt: '一', reason: '' }, { prompt: '二', reason: '' }, { prompt: '三', reason: '' },
      { prompt: '四', reason: '' }, { prompt: '五', reason: '' }, { prompt: '六', reason: '' },
    ] })
    check(m6.pills().length === 4, '防御：超过上限截到 4 颗')
    await m6.unmount()

    const mEmpty = await mount({ initial: [] })
    check(mEmpty.layer() === null && mEmpty.pills().length === 0, '防御：空数组不渲染任何东西')
    await mEmpty.unmount()

    const mBad = await mount({ initial: 'not-an-array' })
    check(mBad.layer() === null && mBad.pills().length === 0, '防御：items 不是数组时安静不渲染')
    await mBad.unmount()

    const mMix = await mount({ initial: [null, {}, { prompt: '' }, { prompt: '好的', reason: 123 }, { prompt: '第二条', reason: '有理由' }] })
    check(mMix.pills().length === 2, '防御：坏条目被过滤，只留 prompt 非空的')
    check(mMix.pills()[0].getAttribute('aria-label') === '好的', '防御：reason 不是字符串就不当理由')
    check(mMix.pills()[0].parentNode.querySelector('.dsws-sugg-pop') === null, '防御：reason 不是字符串就不挂浮层')
    check(mMix.pills()[1].textContent === '第二条' && mMix.pills()[1].parentNode.querySelector('.dsws-sugg-pop').textContent === '有理由', '防御：只有字符串理由才挂浮层，框里仍只显示简介')
    await mMix.unmount()
  }

  // ---------- 8. 拿不到胶囊 / 窄栏：退回视口中央，不横向溢出 ----------
  {
    const mFallback = await mount({ initial: [{ prompt: '没有胶囊祖先', reason: '' }] })
    const lyr = mFallback.layer()
    check(lyr.style.left === '512px', '降级：量不到胶囊时横向落在视口中央（1024/2）')
    check(lyr.style.bottom === '120px', '降级：量不到胶囊时纵向用固定兜底')
    await mFallback.unmount()

    const widthProp = Object.getOwnPropertyDescriptor(win, 'innerWidth')
    Object.defineProperty(win, 'innerWidth', { value: 320, configurable: true, writable: true })
    const mNarrow = await mount({ initial: [{ prompt: '窄栏里也要收住', reason: '' }] })
    const lyrNarrow = mNarrow.layer()
    check(lyrNarrow.style.left === '160px', '窄栏：横向锚点仍按视口宽计算')
    check(lyrNarrow.style.maxWidth.indexOf('100vw') >= 0, '窄栏：层宽随视口收（100vw 兜底）')
    await mNarrow.unmount()
    if (widthProp) Object.defineProperty(win, 'innerWidth', widthProp)
    else Object.defineProperty(win, 'innerWidth', { value: 1024, configurable: true, writable: true })
  }

  // ---------- 9. 样式文本：结构齐、关键尺寸来自外观常量、窄栏 wrap ----------
  {
    const css = stylesMod.SUGGEST_STYLE_TEXT
    check(typeof css === 'string' && css.indexOf('.dsws-sugg-pill') >= 0, '样式：选项样式存在')
    check(css.indexOf('flex-wrap:wrap') >= 0, '样式：选项行可换行（窄栏不溢出）')
    check(css.indexOf('max-width:100%') >= 0, '样式：选项行宽度不超过层')
    check(css.indexOf('max-width:' + appearanceMod.SUGGEST_APPEARANCE.pillMaxWidthPx + 'px') >= 0, '样式：单颗最大宽度来自外观旋钮')
    check(css.indexOf('font-size:' + appearanceMod.SUGGEST_APPEARANCE.pillFontPx + 'px') >= 0, '样式：药丸字号来自外观旋钮')
    check(css.indexOf('border-radius:' + appearanceMod.SUGGEST_APPEARANCE.pillRadiusPx + 'px') >= 0, '样式：圆角来自外观旋钮')
    check(css.indexOf('.dsws-sugg-close') >= 0, '样式：关闭按钮样式存在')
    check(css.indexOf('opacity:' + appearanceMod.SUGGEST_APPEARANCE.closeIdleOpacity) >= 0, '样式：关闭按钮空闲透明度来自外观旋钮')
    check(css.indexOf(':focus-visible') >= 0, '样式：键盘焦点可见')
    check(css.indexOf('.dsws-sugg-sr') >= 0, '样式：读屏节点视觉隐藏')
    check(css.indexOf('--dsw-alias-') >= 0, '样式：颜色走宿主主题 token（亮暗主题都不用另写）')
    check(css.indexOf('.dsws-sugg-intro') >= 0 && css.indexOf('.dsws-sugg-pill-wrap') >= 0 && css.indexOf('.dsws-sugg-pop') >= 0, '样式：简介、浮层定位壳、浮层的样式都在')
    check(css.indexOf('.dsws-sugg-cmd') < 0, '样式：提示词不再进按钮，旧的两段样式已删')
    check(css.indexOf('bottom:calc(100% + ' + appearanceMod.SUGGEST_APPEARANCE.popGapPx + 'px)') >= 0, '样式：浮层固定在框顶边正上方（间距来自外观旋钮，不跟鼠标）')
    check(css.indexOf('max-width:' + appearanceMod.SUGGEST_APPEARANCE.popMaxWidthPx + 'px') >= 0, '样式：浮层最大宽度来自外观旋钮')
    const popRule = (css.match(/\.dsws-sugg-pop\{[^}]*\}/) || [''])[0]
    check(popRule.indexOf('display:block') >= 0 && popRule.indexOf('display:flex') < 0, '样式：浮层按普通文字流排版（不用竖排 flex），评分才能和理由排在同一行')
    check(css.indexOf('margin-right:' + appearanceMod.SUGGEST_APPEARANCE.scoreGapPx + 'px') >= 0, '样式：分数泡与理由之间留空，间距来自外观旋钮')
    check(css.indexOf('.dsws-sugg-reason{display:inline}') >= 0, '样式：理由正文跟分数泡排同一行，不再独占一段')
    check(popRule.indexOf('background:' + appearanceMod.SUGGEST_APPEARANCE.popBg) >= 0, '样式：浮层底色取自浮层专用旋钮（比选项框淡一档）')
    check(css.indexOf('body:not([data-ds-dark-theme]) .dsws-sugg-pop{background:' + appearanceMod.SUGGEST_APPEARANCE.lightPopBg) >= 0, '样式：浅色主题下浮层也另给一档更淡的底色')
    check(css.indexOf('prefers-reduced-motion') >= 0, '样式：尊重系统减少动效偏好')
  }

  // ---------- 10. 源码守卫：外观旋钮集中、层级常量值不变、界面不越权碰会话 ----------
  {
    const appearanceSrc = fs.readFileSync(path.join(ROOT, 'src/client/statusbar/suggestAppearance.ts'), 'utf8')
    const stylesSrc = fs.readFileSync(path.join(ROOT, 'src/client/statusbar/suggestStyles.ts'), 'utf8')
    const bubbleSrc = fs.readFileSync(path.join(ROOT, 'src/client/statusbar/suggestBubble.ts'), 'utf8')
    const streamSrc = fs.readFileSync(path.join(ROOT, 'src/client/statusbar/suggestStream.ts'), 'utf8')
    const indexSrc = fs.readFileSync(path.join(ROOT, 'src/client/index.ts'), 'utf8')
    const buildSrc = fs.readFileSync(path.join(ROOT, 'scripts/build.mts'), 'utf8')
    const leavesSrc = fs.readFileSync(path.join(ROOT, 'tests/verify-leaves.ts'), 'utf8')

    check(appearanceMod.SUGGEST_Z === 2147482000, '守卫：SUGGEST_Z 的具体值不变（2147482000）')
    check(appearanceMod.SUGGEST_Z < 2147483000, '守卫：SUGGEST_Z 低于仓库顶层浮层（2147483000）')
    check(/export const SUGGEST_Z = 2147482000/.test(appearanceSrc), '守卫：层级常量在 appearance 叶子且只有一个定义')
    const bubbleCode = codeOnly(bubbleSrc)
    check(bubbleCode.indexOf('SUGGEST_Z') >= 0 && !/zIndex:\s*\d/.test(bubbleCode), '守卫：气泡层取具名常量，不写字面量层级')
    check(stylesSrc.indexOf('SUGGEST_APPEARANCE.pillFontPx') >= 0 && stylesSrc.indexOf('12.5') < 0, '守卫：样式尺寸来自外观旋钮，不写死数字')
    check(stylesSrc.indexOf('--dsw-alias-') >= 0, '守卫：样式颜色只用主题 token')
    check(bubbleSrc.indexOf('setInterval') < 0 && bubbleSrc.indexOf('setTimeout') < 0, '守卫：气泡薄壳不新增定时器')
    check(bubbleSrc.indexOf('dsws-sugg-intro') >= 0 && bubbleSrc.indexOf('dsws-sugg-pop') >= 0 && bubbleSrc.indexOf('dsws-sugg-pill-wrap') >= 0, '守卫：气泡薄壳只印简介，理由进正上方浮层')
    check(bubbleSrc.indexOf('dsws-sugg-cmd') < 0 && bubbleSrc.indexOf('Tip') < 0, '守卫：按钮里不再有提示词那段，也不再用跟鼠标走的悬停提示')
    check(bubbleCode.indexOf('sessions') < 0 && bubbleCode.indexOf('retain') < 0 && bubbleCode.indexOf('.binding') < 0, '守卫：气泡薄壳不碰会话服务（只读订阅在取数层）')
    check(streamSrc.indexOf('SuggestBubble') >= 0, '接线：取数层的挂载组件把建议交给气泡')
    check(indexSrc.indexOf('leaf:suggestAppearance') >= 0 && indexSrc.indexOf('leaf:suggestStyles') >= 0 && indexSrc.indexOf('leaf:suggestBubble') >= 0, '接线：三片叶子在入口登记了拼接标记')
    check(indexSrc.indexOf('styles.insert(SUGGEST_STYLE_TEXT)') >= 0, '接线：气泡样式走同一个 styles.insert 接缝')
    check(buildSrc.indexOf("id: 'suggestAppearance'") >= 0 && buildSrc.indexOf("id: 'suggestStyles'") >= 0 && buildSrc.indexOf("id: 'suggestBubble'") >= 0, '接线：三片叶子在构建清单登记')
    check(leavesSrc.indexOf('suggestAppearance.ts') >= 0 && leavesSrc.indexOf('suggestStyles.ts') >= 0 && leavesSrc.indexOf('suggestBubble.ts') >= 0, '接线：三片叶子在叶子清单登记（单文件行数上限检查）')
  }

  if (failures.length) {
    console.log('verify-1411-suggest-bubble 失败项：')
    for (const item of failures) console.log('  - ' + item)
  }
  console.log('verify-1411-suggest-bubble：' + total + ' 条断言，' + failures.length + ' 条失败')
  printGateResult('verify-1411-suggest-bubble', total, failures.length ? 1 : 0)
  process.exit(failures.length ? 1 : 0)
}

main().catch(function (err) {
  console.log('verify-1411-suggest-bubble 异常：' + ((err && err.stack) || err))
  printGateResult('verify-1411-suggest-bubble', total, 1)
  process.exit(1)
})
