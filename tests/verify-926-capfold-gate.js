#!/usr/bin/env node
/**
 * verify-926-capfold-gate.js — 926 胶囊折叠性能门禁（#926）
 *
 * 锁四件事（行为口径，与实现写法无关）：
 *   1. 守卫等价：同样的可用宽与同样的完整字，第二趟直接复用档位，一个字不写、一次阶梯不跑；
 *   2. 输入变化必重算：改任一段完整字的一个字、或改可用宽，第二趟必须重走测量；
 *   3. 未知不缓存：量不到可用宽的那趟不落键，宽度回来后必须重算；
 *   4. 元件换代必重算：同一个 keep 换到新元素上，即使输入相同也不许复用旧档位。
 * 外加三组结构断言：机器里有守卫与单写路径、接线走同帧合并、日志点复用已计数事件。
 *
 * 运行：node tests/verify-926-capfold-gate.js（只读源码，不开浏览器）
 */
const { readFileSync, existsSync } = require('node:fs')
const { resolve } = require('node:path')
// 按文本求值走共用入口，理由与用法见 tests/lib/eval-probe.js 文件头。
// （本文件是主干 #926 波次新合入的门禁，自带两处旧写法；#824 波次顺手按同一手法转掉，行为不变。若 #926 那边还在改这份文件，合入时以他们为准。）
const { compileFn } = require('./lib/eval-probe.js')

let passed = 0, failed = 0
const ok = (msg) => { passed++; console.log('  PASS ' + msg) }
const bad = (msg) => { failed++; console.log('  FAIL ' + msg) }
const check = (cond, msg) => { if (cond) ok(msg); else bad(msg) }

console.log('=== #926 胶囊折叠性能门禁（守卫等价 / 变化重算 / 未知不缓存 / 换代重算）===')

const read = (rel) => readFileSync(resolve(rel), 'utf8')
const CAPFOLD = 'src/client/statusbar/capFold.js'
const CAPMACHINE = 'src/client/statusbar/capFoldMachine.js'
const STATUSBAR = 'src/client/statusbar/StatusBar.js'

check(existsSync(resolve(CAPFOLD)) && existsSync(resolve(CAPMACHINE)) && existsSync(resolve(STATUSBAR)), '源码三件套可读')
// 与 scripts/build.mjs 同一套做法：剥行首 export，拼进同一作用域跑。
const mod = (function () {
  try {
    // 手法：compileFn——两段源码剥 export 后拼进同一作用域跑，原来无参造函数当场调用，共用入口同样处理。
    return compileFn([],
      read(CAPFOLD).replace(/^[ \t]*export[ \t]+/gm, '') + '\n' +
      read(CAPMACHINE).replace(/^[ \t]*export[ \t]+/gm, '') +
      '\nreturn { runCapFold: runCapFold, applyCapFoldStart: applyCapFoldStart }'
    )()
  } catch (e) { return null }
})()
check(!!mod && typeof mod.runCapFold === 'function', '机器可载入（runCapFold 就绪）')

// 假胶囊：字按 8px 一算，内容宽 = 12 + 可见字总数 * 8；布局读数只计数不重算。
const makeCap = function (words, width) {
  const stats = { textWrites: 0, flexWrites: 0, datasetWrites: 0, rectReads: 0, offsetReads: 0, scrollReads: 0, clientReads: 0 }
  const W = { v: width }
  const els = words.map(function (w, i) {
    const p = String(i + 1)
    const cls = new Set()
    let flexV = ''
    const el = {
      _text: String(w),
      getAttribute: function (n) { return n === 'data-fold-priority' ? p : null },
      get textContent() { return this._text },
      set textContent(v) { stats.textWrites++; this._text = String(v) },
      classList: {
        add: function (c) { cls.add(c) },
        remove: function (c) { cls.delete(c) },
        contains: function (c) { return cls.has(c) }
      },
      style: {}
    }
    Object.defineProperty(el.style, 'flex', {
      get: function () { return flexV },
      set: function (v) { stats.flexWrites++; flexV = String(v) },
      configurable: true
    })
    return el
  })
  const cap = { _W: W, _els: els, stats: stats }
  Object.defineProperty(cap, 'dataset', {
    value: new Proxy({}, { set: function (t, k, v) { stats.datasetWrites++; t[k] = v; return true } }),
    configurable: true
  })
  cap.querySelectorAll = function () { return els.slice() }
  Object.defineProperty(cap, 'children', { get: function () { return els.slice() }, configurable: true })
  Object.defineProperty(cap, 'clientWidth', { get: function () { stats.clientReads++; return W.v }, configurable: true })
  Object.defineProperty(cap, 'scrollWidth', {
    get: function () {
      stats.scrollReads++
      let n = 0
      for (const e of els) n += String(e._text).length
      return 12 + n * 8
    },
    configurable: true
  })
  Object.defineProperty(cap, 'offsetWidth', { get: function () { stats.offsetReads++; return W.v }, configurable: true })
  cap.getBoundingClientRect = function () { stats.rectReads++; return { width: W.v, height: 20 } }
  cap.isConnected = true
  cap.ownerDocument = {
    defaultView: {
      getComputedStyle: function () { return { paddingLeft: '6px', paddingRight: '6px', display: 'block', visibility: 'visible' } },
      requestAnimationFrame: function () { return 1 }
    }
  }
  cap.parentElement = null
  return cap
}
const resetStats = (cap) => { const s = cap.stats; Object.keys(s).forEach((k) => { s[k] = 0 }) }
const WORDS = ['MattSkills', 'update', '09-28', 'env', '3', '09:48:01', 'sed', 'handoff', 'take', 'bug', 'diag', '12']

if (mod) {
  // 1. 守卫等价：同输入第二趟零写复用
  const cap1 = makeCap(WORDS, 900)
  const keep1 = { full: {}, written: {} }
  const t1a = mod.runCapFold(cap1, keep1)
  check(typeof t1a === 'number' && t1a >= 0, '首趟定档（宽 900，档号 ' + t1a + '）')
  resetStats(cap1)
  const t1b = mod.runCapFold(cap1, keep1)
  check(t1b === t1a, '同输入第二趟档位一致（' + t1b + '）')
  check(cap1.stats.textWrites === 0, '同输入第二趟零写字（实得 ' + cap1.stats.textWrites + ' 次）')
  check(cap1.stats.flexWrites === 0, '同输入第二趟零碰 flex（放下判断一次没跑，实得 ' + cap1.stats.flexWrites + ' 次）')
  check(cap1.stats.datasetWrites === 0, '同输入第二趟零写档号（实得 ' + cap1.stats.datasetWrites + ' 次）')
  // 2. 改字必重算：模拟界面把某段换成新完整字（外来写入），同元素同 keep 必须重测
  resetStats(cap1)
  cap1._els[5]._text = '09:48:02 多一个字X'
  const t2 = mod.runCapFold(cap1, keep1)
  check(cap1.stats.textWrites > 0, '改一段完整字后重走测量（写字 ' + cap1.stats.textWrites + ' 次，档号 ' + t2 + '）')
  // 2b. 改宽必重算
  const cap2b = makeCap(WORDS, 900)
  const keep2b = { full: {}, written: {} }
  mod.runCapFold(cap2b, keep2b)
  cap2b._W.v = 300
  resetStats(cap2b)
  const t2b = mod.runCapFold(cap2b, keep2b)
  check(cap2b.stats.textWrites > 0, '改可用宽后重走测量（写字 ' + cap2b.stats.textWrites + ' 次，档号 ' + t2b + '）')
  cap2b._W.v = 900
  resetStats(cap2b)
  const t2c = mod.runCapFold(cap2b, keep2b)
  check(t2c === 0, '拉宽后回弹到完整档（档号 ' + t2c + '，写字 ' + cap2b.stats.textWrites + ' 次）')
  // 3. 未知不缓存
  const cap3 = makeCap(WORDS, 12)
  const keep3 = { full: {}, written: {} }
  const t3a = mod.runCapFold(cap3, keep3)
  check(t3a === null, '量不到宽时返回未知（null）')
  check(keep3.foldGuardKey === '', '未知那趟不落键（实得 ' + JSON.stringify(keep3.foldGuardKey) + '）')
  cap3._W.v = 900
  resetStats(cap3)
  const t3b = mod.runCapFold(cap3, keep3)
  check(typeof t3b === 'number' && cap3.stats.textWrites > 0, '宽度回来后重算不定旧结论（档号 ' + t3b + '）')
  // 4. 元件换代必重算（同 keep、同输入、新元素必须重写）
  const cap4a = makeCap(WORDS, 900)
  const keep4 = { full: {}, written: {} }
  mod.runCapFold(cap4a, keep4)
  const cap4b = makeCap(WORDS, 900)
  resetStats(cap4b)
  mod.runCapFold(cap4b, keep4)
  check(cap4b.stats.textWrites > 0, '换到新元素上不复用旧档位（新元素写字 ' + cap4b.stats.textWrites + ' 次）')
  // 5. 首帧语义保持：未知时品牌段收起
  const cap5 = makeCap(WORDS, 12)
  mod.runCapFold(cap5, { full: {}, written: {} })
  check(cap5._els[0]._text === '' && cap5._els[0].classList.contains('dsws-folded'), '首帧未知时品牌段收起（起始态保持）')
}

// 结构断言：机器与接线的新形状
const machineSrc = existsSync(resolve(CAPMACHINE)) ? read(CAPMACHINE) : ''
check(/foldGuardKey/.test(machineSrc), '机器含输入指纹守卫（foldGuardKey）')
check(/foldGuardEl/.test(machineSrc), '机器认得出元素换代（foldGuardEl）')
check(/capfold-guard/.test(machineSrc), '机器记下守卫复用情况（capfold-guard 日志点）')
const barSrc = existsSync(resolve(STATUSBAR)) ? read(STATUSBAR) : ''

// 调度器运行时行为：单飞丢弃、回调清位、异常兜底（正则只能证明存在，行为要跑出来）
// 手法：compileFn——机器源码单独求值，window 显式当参数名传进去，下面调用时仍传替身窗口。
const schedMod = compileFn(['window'], read(CAPMACHINE).replace(/^[ \t]*export[ \t]+/gm, '') + '\nreturn { capFoldScheduleFold: capFoldScheduleFold }')
const schedWin = { cbs: [], requestAnimationFrame: function (cb) { this.cbs.push(cb); return 1 } }
const schedRun = schedMod(schedWin)
let schedRan = 0
const schedFn = function () { schedRan++ }
const schedKeep = {}
schedRun.capFoldScheduleFold(schedKeep, schedFn)
schedRun.capFoldScheduleFold(schedKeep, schedFn)
check(schedRan === 0 && schedWin.cbs.length === 1, '占位期第二次触发被丢弃（同帧只排一次）')
schedWin.cbs[0]()
check(schedRan === 1 && schedKeep.foldRaf === 0, '帧回调跑一次并清占位')
schedRun.capFoldScheduleFold(schedKeep, schedFn)
schedWin.cbs[1]()
check(schedRan === 2, '清位后可再排（占位不卡死）')
let syncRan = 0
schedMod({ requestAnimationFrame: function () { throw 0 } }).capFoldScheduleFold({}, function () { syncRan++ })
check(syncRan === 1, '帧回调抛错走同步兜底')
// 换代起步优化：同输入新元素从旧档起步，不从头走完整条阶梯
const capNa = makeCap(WORDS, 300)
const keepN = { full: {}, written: {} }
const tNa = mod.runCapFold(capNa, keepN)
const capNb = makeCap(WORDS, 300)
resetStats(capNb)
const tNb = mod.runCapFold(capNb, keepN)
check(tNb === tNa, '换代后档位一致（档号 ' + tNb + '）')
check(capNb.stats.flexWrites <= 48, '换代从旧档起步（flex 写 ' + capNb.stats.flexWrites + ' 次，至多两次放下判断）')
// 阶梯变短：深档下把字大幅改短，旧档超界走夹紧且结论正确
capNa._els[0]._text = 'M'
capNa._els[5]._text = 'x'
resetStats(capNa)
const tS1 = mod.runCapFold(capNa, keepN)
const shortWords = WORDS.slice(); shortWords[0] = 'M'; shortWords[5] = 'x'
const capS2 = makeCap(shortWords, 300)
const tS2 = mod.runCapFold(capS2, { full: {}, written: {} })
check(capNa.stats.textWrites > 0 && tS1 === tS2, '阶梯变短后重算且与全新起步一致（档号 ' + tS1 + '）')
check(/const scheduleFold = function/.test(barSrc), '接线含同帧合并（scheduleFold）')
check(/const scheduleFold = function \(\) \{ capFoldScheduleFold\(foldKeep\.current, applyFold\)/.test(barSrc), '接线只留一行转调（实现住机器，StatusBar.js 行数不变）')
check(/window\.requestAnimationFrame\(function \(\) \{ keep\.foldRaf = 0; applyFold\(\) \}\)/.test(machineSrc) && /catch \(eRaf\) \{ keep\.foldRaf = 0; applyFold\(\) \}/.test(machineSrc), '合并走帧回调、异常回同步（实现在机器）')
check(/React\.useEffect\(function \(\) \{ scheduleFold\(\) \}\)/.test(barSrc), '每次提交后进合并队列（语义接管旧直接调用）')
check(/new ResizeObserver\(function \(\) \{ scheduleFold\(\) \}\)/.test(barSrc), '两条尺寸观察走合并队列')
check(/document\.fonts\.ready\.then\(scheduleFold\)/.test(barSrc), '字体就绪走合并队列')
// 日志点：复用已计数事件 input.observe，白名单字段，是否开启判断同行
const logLine = machineSrc.split('\n').filter((l) => l.indexOf('capfold-guard') >= 0 && l.indexOf('input.observe') >= 0)
check(logLine.length >= 1 && /isEnabled\(/.test(logLine[0]) && /log\(/.test(logLine[0]), '日志点与是否开启判断同行（关着不组装字段）')

console.log(failed ? '\n存在失败 — verify-926-capfold-gate 未通过' : '\n全部通过 — 926 门禁生效（' + passed + ' 项断言）')
process.exit(failed ? 1 : 0)
