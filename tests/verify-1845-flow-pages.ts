// tests/verify-1845-flow-pages.ts —— 门禁：#1845 三个流程页重做共用的小部件与段落组织。
//
// 背景：#1845 把版本管理页的「变基 / 冲突 / 任务」三个流程页按定稿原型（48/49/50 张）重做。
// 重做后三页共用的零件收在 vcFlowParts.ts 一片叶子里，段落组织收在 vcPageHead.ts 的 page-section 原语上；
// 变基页的历史改写五条动作下沉成「选动作 → 看影响 → 确认执行」三段。本门禁锁住四件事：
//   1) 三样小部件（状态芯片 / 进度条 / 贴触发点的提示）的结构与数据属性，含越界百分比与未知色调的兜底；
//   2) 五条动作面板的三段结构：三段都是 page-section、段标题与段计数用真词表、没有预检票时第三段给一句指引、
//      危险动作的第三段带危险标记、执行完成的结果只画一处（原来会在状态区与结果区各画一遍）；
//   3) 页面壳里流程页正文与五条动作面板排在能力清单之前（读者先看到这一页要做什么）；
//   4) 样式叶子覆盖新零件类名，规则一律以 [data-vc-shell] 开头、只用 --vcs-* 令牌、不写死颜色。
// 三个页面自身的渲染（段落顺序、芯片文案与色调、继续合并的禁用、取消入口）由 verify-1586-rebase /
// conflicts / task-channel 三扇门禁按各自现成的页面闭包断言；本门禁不重复搭闭包，只守共用零件与壳层顺序。
//
// 反证（本门禁自带三条，判据自己也要被证）：去掉进度条夹取、去掉结果条去重、把能力清单挪到面板之前，
// 三条都要被本门禁自己的判据当场抓住。
//
// 门禁归属: src/client/views/versionControl/vcFlowParts.ts
// 门禁归属: src/client/views/versionControl/vcUndoPage.ts
// 门禁归属: src/client/views/versionControl/vcShellPages.ts
// 门禁归属: src/client/views/versionControl/vcPageStyles.ts
//
// 用法（在插件根目录）：
//   node --import ./scripts/ts-hook.mts tests/verify-1845-flow-pages.ts
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { compileFn } from './lib/eval-probe.ts'
import { spliceableJs } from './lib/source-text.ts'
import { ensureLocaleData } from './lib/locale-data.ts'
import { printGateResult } from './lib/gate-result.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const GATE = 'verify-1845-flow-pages'

let total = 0
let failed = 0
function check(ok: any, msg: string) {
  total += 1
  if (!ok) {
    failed += 1
    console.log('  FAIL ' + msg)
  }
}

/** 假 React：与 verify-1829-page-head 同一份形状；children 里的数组递归展平，空值丢掉，够按树检查结构。 */
function makeReact() {
  return {
    createElement: function (type: any, props: any) {
      const kids: any[] = []
      const walk = function (k: any) {
        if (Array.isArray(k)) { k.forEach(walk); return }
        if (k === null || k === undefined || k === false) return
        kids.push(k)
      }
      walk(Array.prototype.slice.call(arguments, 2))
      if (typeof type === 'function') return { type: type, props: props || {}, children: [type(props || {}, kids[0])] }
      return { type: type, props: props || {}, children: kids }
    },
    useContext: function () { return null },
    useState: function (init: any) { return [typeof init === 'function' ? init() : init, function () {}] },
    useRef: function (init: any) { return { current: init === undefined ? null : init } },
    useEffect: function () { return undefined },
  }
}

function findAll(node: any, pred: (n: any) => boolean, out: any[] = []): any[] {
  if (!node || typeof node !== 'object') return out
  if (Array.isArray(node)) { node.forEach(function (n: any) { findAll(n, pred, out) }); return out }
  if (pred(node)) out.push(node)
  if (node.children !== undefined) findAll(node.children, pred, out)
  return out
}

function textOf(node: any): string {
  if (node === null || node === undefined) return ''
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (typeof node === 'object') return textOf(node.children)
  return ''
}

function clsOf(node: any): string {
  return String((node && node.props && node.props.className) || '')
}

function classHas(node: any, name: string): boolean {
  return clsOf(node).split(/\s+/).indexOf(name) >= 0
}

function hasAttr(node: any, attr: string): boolean {
  return !!node && !!node.props && Object.prototype.hasOwnProperty.call(node.props, attr)
}

function byAttr(root: any, attr: string): any[] {
  return findAll(root, function (n: any) { return hasAttr(n, attr) })
}

/** 取数组里第一条 props[className] 含某一段的节点。 */
function pick(root: any, cls: string): any {
  return findAll(root, function (n: any) { return classHas(n, cls) })[0]
}

/** 载入一片叶子并拿到它的导出（按构建口径剥 export，跨叶符号由调用方补进参数表）。 */
function loadLeaf(rel: string, names: string[], params: string[], args: any[]): any {
  const src = spliceableJs(rel).replace(/^[ \t]*export[ \t]+/gm, '')
  const body = src + '\nreturn { ' + names.map(function (n) { return n + ': ' + n }).join(', ') + ' };'
  return compileFn(params, body).apply(null, args)
}

async function main() {
  console.log('#1845 三个流程页：共用小部件、五条动作三段式、页面壳里的顺序、样式作用域')

  const localeRel = ensureLocaleData(ROOT)
  const locale: any = await import(pathToFileURL(path.join(ROOT, localeRel)).href)
  const zh = locale.LOCALE_COPY && locale.LOCALE_COPY.zh
  if (!zh) throw new Error('读不到生成物 ' + localeRel + ' 的中文词表（LOCALE_COPY.zh）')
  const trZh = function (key: string, params?: any) {
    let text = zh[key] !== undefined ? String(zh[key]) : String(key)
    Object.keys(params || {}).forEach(function (name: string) {
      text = text.split('{' + name + '}').join(String((params || {})[name]))
    })
    return text
  }

  const React = makeReact()
  const h = React.createElement
  const host = { call: function () { return Promise.resolve(null) } }

  // ===== A 三样小部件 =====
  const flow = loadLeaf('src/client/views/versionControl/vcFlowParts.js', ['vcFlowChipNode', 'vcFlowMeterNode', 'vcFlowHintNode'], ['h', 't'], [h, trZh])

  const chipOk = flow.vcFlowChipNode(h, trZh, { key: 'vc.task.running', tone: 'ok' })
  check(!!chipOk && chipOk.type === 'span', 'A1 芯片是 span（实得 ' + String(chipOk && chipOk.type) + '）')
  check(classHas(chipOk, 'vcs-flow-chip') && classHas(chipOk, 'vcs-flow-chip-ok'), 'A2 芯片带 vcs-flow-chip 与色调类 vcs-flow-chip-ok（实得 "' + clsOf(chipOk) + '"）')
  check(!!chipOk && chipOk.props['data-vc-flow-chip'] === 'ok', 'A3 芯片带 data-vc-flow-chip=ok（实得 ' + String(chipOk && chipOk.props['data-vc-flow-chip']) + '）')
  check(textOf(chipOk) === trZh('vc.task.running'), 'A4 芯片文字走词表（实得「' + textOf(chipOk) + '」）')
  const chipOdd = flow.vcFlowChipNode(h, trZh, { key: 'vc.task.running', tone: 'huge' })
  check(classHas(chipOdd, 'vcs-flow-chip-muted') && chipOdd.props['data-vc-flow-chip'] === 'muted', 'A5 白名单外的色调一律落 muted，不自造没有样式的类名（实得 "' + clsOf(chipOdd) + '"）')
  const chipDanger = flow.vcFlowChipNode(h, trZh, { key: 'vc.task.running', tone: 'danger' })
  check(classHas(chipDanger, 'vcs-flow-chip-danger'), 'A6 危险色调类在（实得 "' + clsOf(chipDanger) + '"）')


  const meter = flow.vcFlowMeterNode(h, trZh, { percent: 150, labelKey: 'vc.task.percent' })
  check(!!meter && classHas(meter, 'vcs-flow-meter') && meter.props['data-vc-flow-meter'] === '100', 'B1 进度条外壳带 data-vc-flow-meter，越界 150% 被夹到 100（实得 ' + String(meter && meter.props['data-vc-flow-meter']) + '）')
  check(meter.props.role === 'progressbar' && meter.props['aria-valuenow'] === '100' && meter.props['aria-valuemin'] === '0' && meter.props['aria-valuemax'] === '100', 'B2 进度条带 progressbar 角色与 aria 三值')
  const meterBar = pick(meter, 'vcs-flow-meter-bar')
  check(!!meterBar && meterBar.props.style && meterBar.props.style.width === '100%', 'B3 填充段宽度按夹取后的百分比给（实得 ' + String(meterBar && meterBar.props.style && meterBar.props.style.width) + '）')
  const meterLabel = byAttr(meter, 'data-vc-flow-meter-label')
  check(meterLabel.length === 1 && textOf(meterLabel[0]) === trZh('vc.task.percent', { percent: 100 }), 'B4 读数由部件补 {percent}，调用方不必自己拼（实得「' + textOf(meterLabel[0]) + '」）')
  const meterLow = flow.vcFlowMeterNode(h, trZh, { percent: -7 })
  check(meterLow.props['data-vc-flow-meter'] === '0', 'B5 负数百分比夹到 0（实得 ' + String(meterLow.props['data-vc-flow-meter']) + '）')
  const meterNan = flow.vcFlowMeterNode(h, trZh, { percent: 'abc' })
  check(meterNan.props['data-vc-flow-meter'] === '0', 'B6 不是有限数时按 0 画，不编进度（实得 ' + String(meterNan.props['data-vc-flow-meter']) + '）')
  check(byAttr(meterNan, 'data-vc-flow-meter-label').length === 0, 'B7 没给读数词条时不画读数')

  const hint = flow.vcFlowHintNode(h, trZh, { key: 'vc.rebase.hint' })
  check(!!hint && classHas(hint, 'vcs-flow-hint') && hint.props['data-vc-flow-hint'] === 'vc.rebase.hint', 'C1 提示条是 div.vcs-flow-hint，带 data-vc-flow-hint=词条键')
  check(textOf(pick(hint, 'vcs-flow-hint-text')) === trZh('vc.rebase.hint'), 'C2 提示文字走词表（实得「' + textOf(pick(hint, 'vcs-flow-hint-text')) + '」）')
  check(findAll(hint, function (n: any) { return n.type === 'button' }).length === 0, 'C3 不需要跳转时整块不带按钮')
  const hintGo = flow.vcFlowHintNode(h, trZh, { key: 'vc.rebase.hint', action: { key: 'vc.retry', action: 'go', log: 'vc.test.hint' } })
  const hintBtn = pick(hintGo, 'vcs-flow-hint-go')
  check(!!hintBtn && hintBtn.props['data-vc-flow-action'] === 'go' && hintBtn.props['data-log'] === 'vc.test.hint', 'C4 需要时挂一颗 data-vc-flow-action 的跳转按钮')

  // ===== D 五条动作面板：三段结构 =====
  const undoSrc = spliceableJs('src/client/views/versionControl/vcUndoOps.js').replace(/^[ \t]*export[ \t]+/gm, '')
  const pageSrc = spliceableJs('src/client/views/versionControl/vcUndoPage.js').replace(/^[ \t]*export[ \t]+/gm, '')
  const headSrc = spliceableJs('src/client/views/versionControl/vcPageHead.js').replace(/^[ \t]*export[ \t]+/gm, '')
  const undoBody = undoSrc + '\n' + pageSrc + '\n' + headSrc + '\nreturn { vcUndoStateNew: vcUndoStateNew, vcUndoApplyCheck: vcUndoApplyCheck, vcUndoApplyWrite: vcUndoApplyWrite, vcUndoPickOpOf: vcUndoPickOpOf, vcUndoInputsOf: vcUndoInputsOf, vcUndoPageNode: vcUndoPageNode };'
  const undo = compileFn(['h', 't', 'React', 'host'], undoBody)(h, trZh, React, host)

  const idle = undo.vcUndoStateNew()
  const page = undo.vcUndoPageNode(h, trZh, { state: idle })
  check(!!page && page.type === 'section' && page.props['data-vc-undo-page'] === '1', 'D1 页面根是 section 且带 data-vc-undo-page=1')
  check(page.props['data-vc-undo-count'] === '5' && page.props['data-vc-undo-phase'] === 'idle', 'D2 根节点保留账本计数 5 与阶段标记（实得 ' + String(page.props['data-vc-undo-count']) + '/' + String(page.props['data-vc-undo-phase']) + '）')
  const sections: any[] = findAll(page, function (n: any) { return classHas(n, 'page-section') })
  check(sections.length === 3, 'D3 五条动作面板恰好三段：选动作 / 看影响 / 确认执行（实得 ' + sections.length + ' 段）')
  const titles = sections.map(function (s: any) { return textOf(pick(s, 'section-title')) })
  check(titles[0] === trZh('vc.undo.section.pick') && titles[1] === trZh('vc.undo.section.impact') && titles[2] === trZh('vc.undo.section.confirm'), 'D4 三段标题依次用 vc.undo.section.pick / impact / confirm（实得 ' + titles.join(' / ') + '）')
  check(textOf(pick(sections[0], 'section-count')) === '5', 'D5 第一段标出五条动作的条数（实得 ' + textOf(pick(sections[0], 'section-count')) + '）')
  check(byAttr(sections[0], 'data-vc-undo-op-pick').length === 5, 'D6 第一段是五条 radio 选择行（实得 ' + byAttr(sections[0], 'data-vc-undo-op-pick').length + ' 条）')
  check(byAttr(sections[1], 'data-vc-undo-check').length === 1 && byAttr(sections[0], 'data-vc-undo-check').length === 0, 'D7 预检按钮只在第二段（看影响），不在第一段')
  check(byAttr(sections[1], 'data-vc-undo-idle').length === 1, 'D8 空闲说明画在第二段（预检之前先讲清楚这一步只读）')
  check(byAttr(page, 'data-vc-undo-confirm').length === 0 && byAttr(sections[2], 'data-vc-undo-confirm-hint').length === 1, 'D9 没有预检票时第三段给一句指引，而不是一片空白（confirm-hint 恰 1 个）')
  check(textOf(byAttr(sections[2], 'data-vc-undo-confirm-hint')[0]) === trZh('vc.undo.section.confirmIdle'), 'D10 那句指引走 vc.undo.section.confirmIdle 词条')
  check(!classHas(sections[2], 'is-danger') && !hasAttr(sections[2], 'data-vc-danger-section'), 'D11 当前动作不危险时第三段不带危险标记')

  const hardInputs = undo.vcUndoPickOpOf(undo.vcUndoInputsOf(), 'reset-hard')
  const hardPage = undo.vcUndoPageNode(h, trZh, { state: Object.assign(undo.vcUndoStateNew(), { inputs: hardInputs }) })
  const hardSections: any[] = findAll(hardPage, function (n: any) { return classHas(n, 'page-section') })
  check(classHas(hardSections[2], 'is-danger') && hardSections[2].props['data-vc-danger-section'] === '1', 'D12 危险动作的第三段带危险标记（data-vc-danger-section=1）')
  check(textOf(pick(hardSections[2], 'section-danger')) === trZh('vc.shell.page.danger'), 'D13 危险标记文字走 vc.shell.page.danger 词条')

  const checkReply = { ok: true, contract: 'version-control.undo-check', version: 1, ticket: { id: 'un-abc123' }, plan: { target: 'HEAD~1', stepCount: 1 }, scene: { head: 'ffffffffffff' }, danger: false, steps: [] }
  const readyState = undo.vcUndoApplyCheck(idle, 1, checkReply)
  const readyPage = undo.vcUndoPageNode(h, trZh, { state: readyState })
  const readySections: any[] = findAll(readyPage, function (n: any) { return classHas(n, 'page-section') })
  check(byAttr(readyPage, 'data-vc-undo-confirm').length === 1 && byAttr(readySections[2], 'data-vc-undo-confirm').length === 1, 'D14 预检通过后确认卡只出现在第三段、且恰好一张')
  check(byAttr(readySections[2], 'data-vc-undo-confirm-hint').length === 0, 'D15 确认卡出现后那句「先去预检」的指引不再画')
  check(byAttr(readyPage, 'data-vc-undo-ticket')[0].props['data-vc-undo-ticket'] === 'un-abc123', 'D16 确认卡带着预检票号（凭票执行，票号来自回包）')
  check(byAttr(readySections[0], 'data-vc-undo-confirm').length === 0 && byAttr(readySections[1], 'data-vc-undo-confirm').length === 0, 'D17 确认卡不在前两段（选动作与看影响都不替读者按下确认）')

  const writeReply = { ok: true, op: 'reset-soft', before: { headOid: 'ffffffffffff' }, after: { headOid: 'dddddddddddd' }, stepsDone: 1 }
  const doneState = undo.vcUndoApplyWrite(readyState, 2, writeReply)
  const donePage = undo.vcUndoPageNode(h, trZh, { state: doneState })
  check(byAttr(donePage, 'data-vc-undo-result').length === 1, 'D18 执行完成后结果条只画一处（同一结果不许在状态区与结果区各出现一次，实得 ' + byAttr(donePage, 'data-vc-undo-result').length + ' 处）')
  check(byAttr(donePage, 'data-vc-undo-state').length === 1 && byAttr(donePage, 'data-vc-undo-state')[0].props['data-vc-undo-state'] === 'done', 'D19 完成后阶段标记是 done')
  const doneSections: any[] = findAll(donePage, function (n: any) { return classHas(n, 'page-section') })
  check(byAttr(doneSections[2], 'data-vc-undo-result').length === 1, 'D20 结果条画在第三段（跟着确认执行，而不是漂在页面末尾）')

  // ===== E 页面壳：流程页正文与五条动作面板排在能力清单之前 =====
  const shellSrc = readFileSync(path.join(ROOT, 'src/client/views/versionControl/vcShellPages.ts'), 'utf8')
  const atUndo = shellSrc.indexOf('h(VC_UNDO_PANEL')
  const atCaps = shellSrc.indexOf("children.push(Object.assign({}, vcCapabilityListOf(h, t, opts), { key: 'caps' }))")
  const atRebase = shellSrc.indexOf('vcRebasePageNode(h, t, { rebase: opts.rebase })')
  const atConflicts = shellSrc.indexOf('vcConflictsPageNode(h, t, { conflicts: opts.conflicts })')
  check(atUndo >= 0 && atCaps >= 0 && atUndo < atCaps, 'E1 五条动作面板在页面体里、排在能力清单之前（面板 @' + atUndo + '，清单 @' + atCaps + '）')
  check(atRebase >= 0 && atCaps >= 0 && atRebase < atCaps, 'E2 变基页正文排在能力清单之前（正文 @' + atRebase + '）')
  check(atConflicts >= 0 && atCaps >= 0 && atConflicts < atCaps, 'E3 冲突页正文排在能力清单之前（正文 @' + atConflicts + '）')
  check(shellSrc.split('h(VC_UNDO_PANEL').length - 1 === 1, 'E4 面板只挂一处（壳根不再重复挂一份）')

  // ===== F 样式叶子：新零件类名全覆盖、作用域与令牌纪律 =====
  const stylesSrc = readFileSync(path.join(ROOT, 'src/client/views/versionControl/vcPageStyles.ts'), 'utf8')
  const rules: string[] = []
  const ruleRe = /'\[data-vc-shell\][^']*'/g
  let m: any
  while ((m = ruleRe.exec(stylesSrc)) !== null) rules.push(m[0].slice(1, -1))
  check(rules.length > 0, 'F1 样式叶子按字符串数组写规则（读到 ' + rules.length + ' 条）')
  const flowRules = rules.filter(function (r: string) { return r.indexOf('vcs-flow-') >= 0 })
  check(flowRules.length >= 14, 'F2 流程页零件都有样式规则（实得 ' + flowRules.length + ' 条）')
  const shapes = ['vcs-flow-chip', 'vcs-flow-chip-ok', 'vcs-flow-chip-warn', 'vcs-flow-chip-danger', 'vcs-flow-btn', 'vcs-flow-btn-danger', 'vcs-flow-meter', 'vcs-flow-meter-bar', 'vcs-flow-meter-label', 'vcs-flow-hint', 'vcs-flow-hint-text', 'vcs-flow-hint-go', 'vcs-flow-cmd']
  const missing = shapes.filter(function (name: string) { return !flowRules.some(function (r: string) { return r.indexOf('.' + name) >= 0 }) })
  check(missing.length === 0, 'F3 部件用到的类名一条不缺：' + (missing.length ? missing.join('、') : '全在'))
  const scoped = flowRules.every(function (r: string) { return r.indexOf('[data-vc-shell]') === 0 })
  check(scoped, 'F4 每条流程页规则都以 [data-vc-shell] 开头（样式不外溢到别处）')
  const hardColors = flowRules.filter(function (r: string) { return /#[0-9a-fA-F]{3,8}\b|\brgba?\(/.test(r) })
  check(hardColors.length === 0, 'F5 流程页规则里没有写死颜色，只用 --vcs-* 令牌（命中 ' + hardColors.length + ' 条）')
  const colorRules = flowRules.filter(function (r: string) { return /(^|[{;])\s*(color|background|border)\s*:/.test(r) })
  const tokenRules = colorRules.filter(function (r: string) { return r.indexOf('var(--vcs-') >= 0 })
  check(colorRules.length > 0 && tokenRules.length === colorRules.length, 'F6 凡是上颜色的规则都从 --vcs-* 令牌取值（' + tokenRules.length + '/' + colorRules.length + '）')

  // ===== G 反证：判据自己也要被证 =====
  const brokenMeterSrc = spliceableJs('src/client/views/versionControl/vcFlowParts.js').replace(/^[ \t]*export[ \t]+/gm, '').replace('Math.max(0, Math.min(100, Math.round(raw)))', 'raw')
  const brokenMeter = compileFn(['h', 't'], brokenMeterSrc + '\nreturn { vcFlowMeterNode: vcFlowMeterNode };')(h, trZh)
  const brokenMeterNode = brokenMeter.vcFlowMeterNode(h, trZh, { percent: 150 })
  check(brokenMeterNode.props['data-vc-flow-meter'] === '150', 'G1 反证：把夹取去掉，这条判据当场读到 150（实得 ' + String(brokenMeterNode.props['data-vc-flow-meter']) + '，说明 B1 抓的是真东西）')

  const brokenPageSrc = pageSrc.replace('if (phase === "done" && state.result) return null;', 'if (phase === "done" && state.result) return undoResultNode(h, t, state.result);')
  check(brokenPageSrc !== pageSrc, 'G2a 反证改法真的落在了源码上（改不中就等于没证）')
  const brokenUndoSrc = undoSrc + '\n' + brokenPageSrc + '\n' + headSrc + '\nreturn { vcUndoStateNew: vcUndoStateNew, vcUndoApplyCheck: vcUndoApplyCheck, vcUndoApplyWrite: vcUndoApplyWrite, vcUndoPageNode: vcUndoPageNode };'
  const brokenUndo = compileFn(['h', 't', 'React', 'host'], brokenUndoSrc)(h, trZh, React, host)
  const brokenDonePage = brokenUndo.vcUndoPageNode(h, trZh, { state: brokenUndo.vcUndoApplyWrite(brokenUndo.vcUndoApplyCheck(brokenUndo.vcUndoStateNew(), 1, checkReply), 2, writeReply) })
  check(byAttr(brokenDonePage, 'data-vc-undo-result').length === 2, 'G2 反证：把「完成态结果不重复画」去掉，结果条当场变两处（说明 D18 抓得住）')

  const orderPredicate = function (src: string): boolean {
    const a = src.indexOf('h(VC_UNDO_PANEL')
    const c = src.indexOf("children.push(Object.assign({}, vcCapabilityListOf(h, t, opts), { key: 'caps' }))")
    return a >= 0 && c >= 0 && a < c
  }
  check(orderPredicate("children.push(Object.assign({}, vcCapabilityListOf(h, t, opts), { key: 'caps' }))" + shellSrc) === false, 'G4 反证：把能力清单挪到面板之前，同一条判据当场判否（说明 E1 抓的是位置，不是有没有）')

  console.log(failed ? '' : '\n全部通过 — 流程页共用部件与三段式面板门禁生效（' + total + ' 项断言）')
  printGateResult(GATE, total, failed ? 1 : 0)
  process.exit(failed ? 1 : 0)
}

main().catch(function (e) { console.error('门禁执行异常：' + ((e && e.stack) || e)); process.exit(1) })
