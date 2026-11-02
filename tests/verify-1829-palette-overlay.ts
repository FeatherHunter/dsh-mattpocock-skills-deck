// tests/verify-1829-palette-overlay.ts —— 门禁：#1829 阶段 4-C 命令面板遮罩（背板 + 面板 + 底栏）。
//
// 背景：#1829 的阶段 4 要把命令面板从「搜索页里的一块普通区域」改成浮层——整块遮罩包住面板，
// 面板正文与输入/命中逻辑一个字不动，只在末尾补一条说明边界的底栏。本门禁锁住改完之后的形状与边界：
//   1) 根节点是遮罩 div.vcs-palette-backdrop（带 data-vc-palette-backdrop=1），它里面恰好一块面板；
//   2) 面板 section 保留 id、role=search、data-vc-palette 与 vcs-palette 类，并追加 vcs-pal-panel 类
//      （焦点选择器 [data-vc-palette-input] 与身份行的 aria-controls 都指着这个 id，不能挪到遮罩上）；
//   3) 标题行、输入框、命中行结构原样：仍带 data-vc-palette-input、data-vc-palette-row、data-cap-secondary；
//   4) 底栏 p.vcs-pal-foot 排在列表或空态之后，文字与真词表 vc.shell.palette.foot 一字不差；
//   5) 空查询与无命中都画空态；整棵树里没有不带 data 委托属性的假按钮。
//
// 手法：与 verify-1545 同一套——视图叶子用 spliceableJs 按构建口径剥 export，装进 compileFn 的假 h 求值；
// 词表读生成物 src/client/kernel/locale-data.ts 的真中文，不在这里抄一份文案（改词条不该改门禁）。
//
// 门禁归属: src/client/views/versionControl/vcPalette.ts
//
// 用法（在插件根目录）：
//   node --import ./scripts/ts-hook.mts tests/verify-1829-palette-overlay.ts
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { compileFn } from './lib/eval-probe.ts'
import { spliceableJs } from './lib/source-text.ts'
import { ensureLocaleData } from './lib/locale-data.ts'
import { printGateResult } from './lib/gate-result.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const GATE = 'verify-1829-palette-overlay'

let total = 0
let failed = 0
function check(ok: any, msg: string) {
  total += 1
  if (!ok) {
    failed += 1
    console.log('  FAIL ' + msg)
  }
}

/** 假 React：只造出「标签 + 属性 + 子节点」的形状，够本门禁按树检查结构。 */
function fakeH(tag: any, props: any, children: any) {
  return { tag: tag, props: props || {}, children: children }
}

function findAll(node: any, pred: (n: any) => boolean, out: any[] = []): any[] {
  if (!node || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    node.forEach(function (n: any) { findAll(n, pred, out) })
    return out
  }
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

function classHas(node: any, name: string): boolean {
  if (!node || !node.props) return false
  return String(node.props.className || '').split(/\s+/).indexOf(name) >= 0
}

// 两条能力的账本夹具：一条从改动页跳转（写动作，需要对象上下文），一条从提交历史页跳转。
// 只喂本门禁要判的结构所需字段，不复制真能力账本（那份由 verify-818 的 Z 组逐条对账）。
const CAPS = [
  {
    id: '2.1', name: '暂存选中的改动', domainName: '改动', page: 'changes',
    command: 'git add --', level: '写', finalForm: '按钮', primaryEntry: '2.1',
  },
  {
    id: '5.4', name: '还原这次提交', domainName: '提交历史', page: 'history',
    command: 'git revert', level: '改写', finalForm: '按钮', primaryEntry: '5.4',
  },
]
const SURFACES = [
  { id: 'changes', name: '改动' },
  { id: 'history', name: '提交历史' },
]

async function main() {
  console.log('#1829 阶段 4-C 命令面板遮罩：遮罩包住面板、底栏在列表或空态之后、结构与文案原样')
  const localeRel = ensureLocaleData(ROOT)
  const locale: any = await import(pathToFileURL(path.join(ROOT, localeRel)).href)
  const zh = locale.LOCALE_COPY && locale.LOCALE_COPY.zh
  if (!zh) throw new Error('读不到生成物 ' + localeRel + ' 的中文词表（LOCALE_COPY.zh）')
  // 与运行时同一个取词口径：查不到键就回键名本身，占位符按 {name} 替换；门禁据此发现「词条没落地」。
  const trZh = function (key: string, params?: any) {
    let text = zh[key] !== undefined ? String(zh[key]) : String(key)
    Object.keys(params || {}).forEach(function (name: string) {
      text = text.split('{' + name + '}').join(String((params || {})[name]))
    })
    return text
  }

  const body = spliceableJs('src/client/views/versionControl/vcPalette.ts') +
    '\nreturn { vcPaletteNode: vcPaletteNode, vcPaletteMatchOf: vcPaletteMatchOf, vcPaletteRowsOf: vcPaletteRowsOf };'
  const factory = compileFn(
    ['h', 't', 'CAPABILITIES', 'PAGE_SURFACES', 'vcPageDepthOf', 'capabilityAvailability'],
    body,
  )
  const depthOf = function (page: any) { return page === 'changes' ? 1 : 2 }
  const availability = function () { return { state: 'full' } }
  const leaf: any = factory(fakeH, trZh, CAPS, SURFACES, depthOf, availability)

  const render = function (query: any, highlight?: any) {
    return leaf.vcPaletteNode(fakeH, trZh, {
      id: 'vc-palette-7', query: query, highlight: highlight || '', limit: 20, reads: {},
    })
  }

  // ===== A 遮罩与面板：遮罩包住唯一一块面板，面板的 id / role / 类名都不动 =====
  const root = render('', '5.4')
  check(!!root && root.tag === 'div', 'A1 根节点是遮罩 div，不再是原来的 section（实得 ' + String(root && root.tag) + '）')
  check(!!root && root.props['data-vc-palette-backdrop'] === '1', 'A2 遮罩带 data-vc-palette-backdrop=1（样式与门禁认得出它）')
  check(classHas(root, 'vcs-palette-backdrop'), 'A3 遮罩带 vcs-palette-backdrop 类')
  const wrapped = root && Array.isArray(root.children) ? root.children : [root && root.children]
  check(wrapped.length === 1 && !!wrapped[0] && wrapped[0].tag === 'section', 'A4 遮罩里恰好一块面板 section，没有多包别的兄弟节点（实得 ' + wrapped.length + ' 块）')
  const panel = wrapped[0]
  check(!!panel && panel.props.id === 'vc-palette-7', 'A5 面板保留 id（焦点选择器与 aria-controls 指着它，实得 ' + String(panel && panel.props.id) + '）')
  check(!!panel && panel.props.role === 'search', 'A6 面板保留 role=search（遮罩不许抢走这个语义，实得 ' + String(panel && panel.props.role) + '）')
  check(!!panel && panel.props['data-vc-palette'] === '1', 'A7 面板保留 data-vc-palette=1（旧门禁按它找面板）')
  check(classHas(panel, 'vcs-palette') && classHas(panel, 'vcs-pal-panel'), 'A8 面板同时带 vcs-palette 与新增的 vcs-pal-panel 两个类')
  check(findAll(root, function (n: any) { return n.props && n.props.id === 'vc-palette-7' }).length === 1, 'A9 整棵树里 id 只出现一次（唯一焦点目标，别的节点不重复占这个 id）')

  // ===== B 标题行与输入框：与原来逐字段一致 =====
  const kids: any[] = panel && Array.isArray(panel.children) ? panel.children : []
  const head = kids[0]
  check(!!head && classHas(head, 'vcs-pal-head') && Array.isArray(head.children) && head.children.length === 2, 'B1 面板第一块仍是 vcs-pal-head，里面恰好标题与提示两个子节点')
  check(!!head && classHas(head.children[0], 'vcs-pal-title') && textOf(head.children[0]) === trZh('vc.shell.palette.title'), 'B2 标题 h3.vcs-pal-title 的文字与真词表一致（实得「' + (head ? textOf(head.children[0]) : '无') + '」）')
  check(!!head && classHas(head.children[1], 'vcs-pal-hint') && textOf(head.children[1]) === trZh('vc.shell.palette.hint', { n: 2 }), 'B3 提示 span.vcs-pal-hint 写出命中 2 条且与真词表一致（实得「' + (head ? textOf(head.children[1]) : '无') + '」）')
  const input = findAll(panel, function (n: any) { return n.tag === 'input' })[0]
  check(!!input && input.props.type === 'search' && input.props['data-vc-palette-input'] === '1', 'B4 输入框仍是 type=search 且带 data-vc-palette-input=1（焦点选择器不变）')
  check(!!input && input.props['data-cap-main'] === 'palette', 'B5 输入框仍带 data-cap-main=palette（命令面板的主入口标记不变）')
  check(!!input && input.props.placeholder === trZh('vc.shell.palette.placeholder'), 'B6 输入框占位文字与真词表一致')
  check(!!input && input.props.defaultValue === '', 'B7 空查询时输入框回显空串')
  check(leaf.vcPaletteMatchOf('').length === 2 && leaf.vcPaletteRowsOf('', 20).length === 2, 'B8 命中数与行数都是 2（提示行的 2 与账本对得上）')

  // ===== C 命中行：选择器与委托属性原样，高亮仍然只落在被选中的那一行 =====
  const list = findAll(panel, function (n: any) { return n.tag === 'ul' })[0]
  check(!!list && classHas(list, 'vcs-pal-list') && list.props['data-vc-palette-list'] === '1', 'C1 结果列表仍是 ul.vcs-pal-list[data-vc-palette-list=1]')
  const rowItems = findAll(list, function (n: any) { return n.tag === 'li' })
  const rowButtons = rowItems.map(function (item: any) { return item.children && item.children[0] })
  const rowIds = rowButtons.map(function (btn: any) { return String(btn && btn.props && btn.props['data-vc-palette-row']) })
  check(rowIds.join(',') === '2.1,5.4', 'C2 两条命中的行号与顺序跟账本一致（实得 ' + rowIds.join(',') + '）')
  check(rowButtons.every(function (btn: any) { return !!btn && btn.tag === 'button' && btn.props.type === 'button' }), 'C3 每行仍是一颗 type=button 的委托按钮（不改成 div 假按钮）')
  check(rowButtons.every(function (btn: any) { return !!btn && btn.props['data-cap-secondary'] === btn.props['data-vc-palette-row'] }), 'C4 每行仍同时带 data-cap-secondary 与 data-vc-palette-row（第二入口标记不变）')
  const hitButtons = rowButtons.filter(function (btn: any) { return btn && btn.props['data-vc-palette-hit'] === '1' })
  check(hitButtons.length === 1 && String(hitButtons[0].props['data-vc-palette-row']) === '5.4', 'C5 只有被高亮的那一行带 data-vc-palette-hit=1（实得 ' + hitButtons.length + ' 行）')
  check(rowButtons.filter(function (btn: any) { return btn && btn.props['data-vc-palette-hit'] === undefined }).length === 1, 'C6 没被高亮的那一行不带命中标记')

  // ===== D 底栏：排在列表或空态之后，文字取自真词表，不是按钮 =====
  const foot = findAll(panel, function (n: any) { return classHas(n, 'vcs-pal-foot') })[0]
  const footKey = 'vc.shell.palette.foot'
  const footText = zh[footKey]
  check(typeof footText === 'string' && footText.trim().length > 0, 'D1 真词表里有 ' + footKey + '（config/copy/vcshell.yaml 落地后要重新生成 ' + localeRel + '；现在实得 ' + String(footText) + '）')
  check(!!foot && foot.tag === 'p', 'D2 底栏是一段 p 而不是按钮（面板里不新增假动作入口，实得 ' + String(foot && foot.tag) + '）')
  check(!!foot && classHas(foot, 'vcs-pal-foot'), 'D3 底栏带 vcs-pal-foot 类')
  check(!!foot && footText !== undefined && textOf(foot) === String(footText), 'D4 底栏文字与真词表译文一字不差（期望「' + String(footText) + '」，实得「' + textOf(foot) + '」）')
  check(kids.length >= 4 && kids[kids.length - 1] === foot, 'D5 底栏排在面板内容最后（列表或空态之后）')
  check(!!foot && foot.props['data-vc-palette-row'] === undefined && foot.props['data-cap-secondary'] === undefined, 'D6 底栏不冒充结果行（没有行委托属性）')

  // ===== E 空态：无命中与空查询都仍画空态，底栏照样在 =====
  const noMatch = render('这条能力不存在')
  const emptyNodes = findAll(noMatch, function (n: any) { return n.props && n.props['data-vc-palette-empty'] === '1' })
  check(emptyNodes.length === 1, 'E1 无命中时仍画空态 p[data-vc-palette-empty=1]（实得 ' + emptyNodes.length + ' 块）')
  check(findAll(noMatch, function (n: any) { return n.tag === 'ul' }).length === 0, 'E2 无命中时不画结果列表（空列表会让人以为还有内容）')
  check(!!emptyNodes[0] && classHas(emptyNodes[0], 'vcs-pal-empty') && textOf(emptyNodes[0]) === trZh('vc.shell.palette.empty'), 'E3 空态文字与真词表一致（实得「' + textOf(emptyNodes[0]) + '」）')
  const emptyHint = findAll(noMatch, function (n: any) { return classHas(n, 'vcs-pal-hint') })[0]
  check(!!emptyHint && textOf(emptyHint) === trZh('vc.shell.palette.hint', { n: 0 }), 'E4 无命中时提示行写 0 条（实得「' + textOf(emptyHint) + '」）')
  const emptyFoot = findAll(noMatch, function (n: any) { return classHas(n, 'vcs-pal-foot') })[0]
  check(!!emptyFoot && textOf(emptyFoot) === String(footText), 'E5 空态之后仍有底栏，文字不变')
  const savedCaps = CAPS.splice(0, CAPS.length)
  let coldKind = ''
  try {
    const cold = render('')
    const coldEmpty = findAll(cold, function (n: any) { return n.props && n.props['data-vc-palette-empty'] === '1' })
    coldKind = coldEmpty.length === 1 && findAll(cold, function (n: any) { return n.tag === 'ul' }).length === 0 ? 'empty' : 'other'
  } finally {
    Array.prototype.push.apply(CAPS, savedCaps)
  }
  check(coldKind === 'empty', 'E6 空查询且账本为空时也画空态（不画一只空 ul；实得 ' + coldKind + '）')

  // ===== F 假按钮：整棵树里的 button 必须都带行委托属性，底栏与空态不藏按钮 =====
  const allButtons = findAll(root, function (n: any) { return n.tag === 'button' })
  const bogus = allButtons.filter(function (btn: any) {
    return btn.props['data-cap-secondary'] === undefined && btn.props['data-vc-palette-row'] === undefined
  })
  check(allButtons.length === 2 && bogus.length === 0, 'F1 有命中时整棵树只有两颗带 data 委托属性的行按钮，没有假按钮（实得 ' + allButtons.length + ' 颗，其中无委托 ' + bogus.length + ' 颗）')
  check(findAll(noMatch, function (n: any) { return n.tag === 'button' }).length === 0, 'F2 无命中时整棵树一颗按钮都没有（空态与底栏都不是按钮）')
  const filtered = render('暂存', '2.1')
  const filteredInput = findAll(filtered, function (n: any) { return n.tag === 'input' })[0]
  const filteredHint = findAll(filtered, function (n: any) { return classHas(n, 'vcs-pal-hint') })[0]
  check(!!filteredInput && filteredInput.props.defaultValue === '暂存', 'F3 带查询词时输入框回显原词（实得「' + String(filteredInput && filteredInput.props.defaultValue) + '」）')
  check(!!filteredHint && textOf(filteredHint) === trZh('vc.shell.palette.hint', { n: 1 }), 'F4 带查询词时提示行只写 1 条命中（命中逻辑没被遮罩改动）')

  console.log('\n共 ' + total + ' 条断言，失败 ' + failed + ' 条')
  printGateResult(GATE, total, failed)
  process.exit(failed ? 1 : 0)
}

main().catch(function (e: any) {
  console.log('  FAIL 门禁自身抛错：' + String((e && e.stack) || e))
  printGateResult(GATE, total, failed)
  process.exit(1)
})
