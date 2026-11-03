// tests/verify-1846-search-page.ts —— 门禁：#1846 全库搜索页独立版式（输入框在首屏、结果按页面分组）。
//
// 背景：#1846 收口搜索页、命令面板与分支浮层。改之前，全库搜索页把命令面板嵌在
// 「本页负责的能力」那张折叠清单里（手风琴默认合上，首屏看不到输入框），命令面板与能力清单缠在一起。
// 改之后，搜索页自己画首屏输入框与分组结果；命令面板只作为别的页面上的遮罩浮层出现。
// 本门禁锁住搜索页的形状与三条边界：
//   1) 一页只有一个输入框，它在页头正文的第一屏位置（说明段之后、结果之前）；
//   2) 空查询与无命中是两种状态，各自有说明文字，都不能画成「命中若干条」；
//   3) 结果按能力所属页面分组，分组顺序与命中顺序一致；行是第二入口按钮，
//      不抢能力账本的主入口标记（不画 data-cap-primary），也不冒充命令面板的行；
//   4) 数据只来自 vcPaletteMatchOf（不改搜索匹配与数据来源）：这里用账本夹具对账，
//      行号与顺序必须与 vcPaletteMatchOf 的输出一致。
//
// 手法：与 verify-1829-palette-overlay 同一套——视图叶子用 spliceableJs 按构建口径剥 export，
// 装进 compileFn 的假 h 求值；词表读生成物 src/client/kernel/locale-data.ts 的真中文，
// 不在这里抄一份文案（改词条不该改门禁）。
//
// 门禁归属: src/client/views/versionControl/vcSearchPage.ts
//
// 用法（在插件根目录）：
//   node --import ./scripts/ts-hook.mts tests/verify-1846-search-page.ts
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { compileFn } from './lib/eval-probe.ts'
import { spliceableJs } from './lib/source-text.ts'
import { ensureLocaleData } from './lib/locale-data.ts'
import { printGateResult } from './lib/gate-result.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const GATE = 'verify-1846-search-page'
const LEAF = 'src/client/views/versionControl/vcSearchPage.ts'

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

// 能力账本夹具：三条能力分布在三个页面（改动 / 提交历史 / 分支与标签），
// 其中 4.6 删除分支是写动作（需要对象上下文），后面要检查它带「只跳入口」的提示。
// 只喂本门禁要判的字段，不复制真账本（那份由 verify-818 的 Z 组逐条对账）。
const CAPS = [
  {
    id: '2.1', name: '暂存选中的改动', domainName: '改动', page: 'changes',
    command: 'git add --', level: '写', finalForm: '按钮', primaryEntry: '2.1',
  },
  {
    id: '5.4', name: '还原这次提交', domainName: '提交历史', page: 'history',
    command: 'git revert', level: '改写', finalForm: '按钮', primaryEntry: '5.4',
  },
  {
    id: '4.6', name: '删除分支', domainName: '分支与标签', page: 'branch-tags',
    command: 'git branch -d', level: '毁', finalForm: '按钮', primaryEntry: '4.6',
  },
]
const SURFACES = [
  { id: 'changes', name: '改动' },
  { id: 'history', name: '提交历史' },
  { id: 'branch-tags', name: '分支与标签' },
]

async function main() {
  console.log('#1846 全库搜索页：独立版式（输入框在首屏、空查询与无命中分开、结果按页面分组）')
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

  const depthOf = function (page: any) { return page === 'changes' ? 1 : 2 }
  const availability = function () { return { state: 'full' } }
  // 数据来源仍是 vcPalette.ts 的 vcPaletteMatchOf（#1846 的边界：不改搜索匹配），
  // 所以先按账本夹具把那一份求值出来，再把它当参数喂给搜索页，两边用的是同一套匹配函数。
  const paletteBody = spliceableJs('src/client/views/versionControl/vcPalette.ts') +
    '\nreturn { vcPaletteMatchOf: vcPaletteMatchOf, vcPaletteRowsOf: vcPaletteRowsOf };'
  const palette: any = compileFn(
    ['h', 't', 'CAPABILITIES', 'PAGE_SURFACES', 'vcPageDepthOf', 'capabilityAvailability'],
    paletteBody,
  )(fakeH, trZh, CAPS, SURFACES, depthOf, availability)
  const body = spliceableJs(LEAF) +
    '\nreturn { vcSearchPageNode: vcSearchPageNode, vcSearchGroupsOf: vcSearchGroupsOf, vcSearchRowNode: vcSearchRowNode, VC_SEARCH_RENDER_MAX: VC_SEARCH_RENDER_MAX };'
  const factory = compileFn(['h', 't', 'vcPaletteMatchOf'], body)
  const leaf: any = factory(fakeH, trZh, palette.vcPaletteMatchOf)

  const render = function (query: any, highlight?: any, limit?: any) {
    return leaf.vcSearchPageNode(fakeH, trZh, {
      id: 'vc-search-7', query: query, highlight: highlight || '', limit: limit,
    })
  }

  // ===== A 版式骨架：页面区块、说明段、唯一输入框 =====
  const root = render('', '')
  check(!!root && root.tag === 'section', 'A1 根节点是页面区块 section（实得 ' + String(root && root.tag) + '）')
  check(!!root && root.props['data-vc-search-page'] === '1', 'A2 根带 data-vc-search-page=1（门禁与样式认得出这一页）')
  check(classHas(root, 'vcs-search'), 'A3 根带 vcs-search 类')
  check(!!root && root.props.id === 'vc-search-7', 'A4 根保留传入的 id（身份行放大镜的 aria-controls 指着它，实得 ' + String(root && root.props.id) + '）')
  const rootKids: any[] = root && Array.isArray(root.children) ? root.children : []
  const note = findAll(root, function (n: any) { return n.props && n.props['data-vc-search-note'] === '1' })[0]
  check(!!note && note.tag === 'p' && textOf(note) === trZh('vc.shell.search.note'), 'A5 说明段 p[data-vc-search-note=1] 的文字与真词表一致（实得「' + textOf(note) + '」）')
  const inputs = findAll(root, function (n: any) { return n.tag === 'input' })
  check(inputs.length === 1, 'A6 整页只有一个输入框（实得 ' + inputs.length + ' 个）')
  const input = inputs[0]
  check(!!input && input.props.type === 'search' && input.props['data-vc-search-input'] === '1', 'A7 输入框是 type=search 且带 data-vc-search-input=1（输入意图与焦点选择器靠它）')
  check(!!input && input.props.placeholder === trZh('vc.shell.search.placeholder'), 'A8 输入框占位文字与真词表一致（实得「' + String(input && input.props.placeholder) + '」）')
  check(!!input && input.props['aria-label'] === trZh('vc.shell.search.placeholder'), 'A9 输入框的无障碍名与占位文字同一句')
  check(!!input && input.props.defaultValue === '', 'A10 空查询时输入框回显空串')
  check(!!root && rootKids.length >= 2 && rootKids[0] === note, 'A11 说明段排在第一个（读者先看到这一页在搜什么）')
  const box = findAll(root, function (n: any) { return classHas(n, 'vcs-search-box') })[0]
  check(!!box && rootKids[1] === box && findAll(box, function (n: any) { return n.tag === 'input' }).length === 1, 'A12 输入框包在 vcs-search-box 里，紧随说明段（首屏可见）')

  // ===== B 空查询：画「先输入关键词」提示，不画结果 =====
  const emptyQuery = findAll(root, function (n: any) { return n.props && n.props['data-vc-search-empty'] === 'query' })
  check(emptyQuery.length === 1, 'B1 空查询时画一条 data-vc-search-empty=query 的提示（实得 ' + emptyQuery.length + ' 条）')
  check(!!emptyQuery[0] && textOf(emptyQuery[0]) === trZh('vc.shell.search.emptyQuery'), 'B2 空查询提示文字与真词表一致（实得「' + textOf(emptyQuery[0]) + '」）')
  check(findAll(root, function (n: any) { return n.props && n.props['data-vc-search-group'] !== undefined }).length === 0, 'B3 空查询时不画分组（空查询的命中是全部 162 条，画出来会像已搜过）')
  check(findAll(root, function (n: any) { return n.props && n.props['data-vc-search-count'] !== undefined }).length === 0, 'B4 空查询时不画命中计数行')
  check(findAll(root, function (n: any) { return n.tag === 'button' }).length === 0, 'B5 空查询时一颗按钮都不画（没有结果就没有可点的行）')
  const savedCaps = CAPS.splice(0, CAPS.length)
  let coldState = ''
  let coldHasInput = false
  try {
    const cold = render('')
    coldState = findAll(cold, function (n: any) { return n.props && n.props['data-vc-search-empty'] === 'query' }).length === 1 ? 'query' : 'other'
    coldHasInput = findAll(cold, function (n: any) { return n.props && n.props['data-vc-search-input'] === '1' }).length === 1
  } finally {
    Array.prototype.push.apply(CAPS, savedCaps)
  }
  check(coldState === 'query' && coldHasInput, 'B6 账本为空且查询为空时仍画输入框与「先输入关键词」提示（不画空列表，实得 ' + coldState + '）')

  // ===== C 无命中：另一条提示文字，与空查询分开 =====
  const noHit = render('这条能力不存在')
  const hitEmpty = findAll(noHit, function (n: any) { return n.props && n.props['data-vc-search-empty'] === 'hit' })
  check(hitEmpty.length === 1, 'C1 无命中时画一条 data-vc-search-empty=hit 的提示（实得 ' + hitEmpty.length + ' 条）')
  check(!!hitEmpty[0] && textOf(hitEmpty[0]) === trZh('vc.shell.search.emptyHit'), 'C2 无命中提示文字与真词表一致（实得「' + textOf(hitEmpty[0]) + '」）')
  check(findAll(noHit, function (n: any) { return n.props && n.props['data-vc-search-empty'] === 'query' }).length === 0, 'C3 无命中时不画「先输入关键词」那条（两种状态不能混）')
  check(findAll(noHit, function (n: any) { return n.props && n.props['data-vc-search-group'] !== undefined }).length === 0, 'C4 无命中时没有分组')
  check(findAll(noHit, function (n: any) { return n.tag === 'button' }).length === 0, 'C5 无命中时一颗按钮都没有')

  // ===== D 有命中：计数行 + 按页面分组，组序与命中顺序一致 =====
  const hits = render('git')
  const countNode = findAll(hits, function (n: any) { return n.props && n.props['data-vc-search-count'] !== undefined })[0]
  const expectRows = palette.vcPaletteMatchOf('git')
  check(!!countNode && countNode.props['data-vc-search-count'] === String(expectRows.length), 'D1 计数行写出命中总数（实得 ' + String(countNode && countNode.props['data-vc-search-count']) + '，期望 ' + expectRows.length + '）')
  check(!!countNode && textOf(countNode) === trZh('vc.shell.search.count', { n: expectRows.length }), 'D2 计数行文字与真词表一致（实得「' + textOf(countNode) + '」）')
  const groups = findAll(hits, function (n: any) { return n.props && n.props['data-vc-search-group'] !== undefined })
  const groupPages = groups.map(function (g: any) { return String(g.props['data-vc-search-group']) })
  const expectGroups: string[] = []
  expectRows.forEach(function (row: any) { if (expectGroups.indexOf(row.page) < 0) expectGroups.push(row.page) })
  check(groupPages.join(',') === expectGroups.join(','), 'D3 分组按命中顺序首次出现的页面排序（实得 ' + groupPages.join(',') + '，期望 ' + expectGroups.join(',') + '）')
  const groupTitles = groups.map(function (g: any) {
    const title = findAll(g, function (n: any) { return classHas(n, 'vcs-search-group-title') })[0]
    return textOf(title)
  })
  check(groupTitles.every(function (name: string) { return name.trim().length > 0 }), 'D4 每组都有页面标题（实得 ' + groupTitles.join(' / ') + '）')
  const groupRowIds = groups.map(function (g: any) {
    return findAll(g, function (n: any) { return n.props && n.props['data-vc-search-row'] !== undefined })
      .map(function (btn: any) { return String(btn.props['data-vc-search-row']) })
  })
  const expectIds = expectRows.map(function (row: any) { return String(row.id) })
  check(groupRowIds.length === expectGroups.length && expectGroups.every(function (page: string, i: number) {
    const pageIds = expectRows.filter(function (row: any) { return row.page === page }).map(function (row: any) { return String(row.id) })
    return groupRowIds[i].join(',') === pageIds.join(',')
  }), 'D5 每组行号与 vcPaletteMatchOf 的输出逐条一致（实得 ' + groupRowIds.map(function (ids: string[]) { return ids.join('|') }).join(' / ') + '）')
  const groupCounts = groups.map(function (g: any) { return textOf(findAll(g, function (n: any) { return classHas(n, 'vcs-search-group-count') })[0]) })
  check(groupCounts.every(function (text: string) { return /\d/.test(text) }), 'D6 每组写着本组条数（实得 ' + groupCounts.join(' / ') + '）')
  const allRows = findAll(hits, function (n: any) { return n.props && n.props['data-vc-search-row'] !== undefined })
  check(allRows.length === expectIds.length, 'D7 行数等于命中数（实得 ' + allRows.length + ' 行，期望 ' + expectIds.length + ' 行）')
  check(allRows.every(function (btn: any) { return btn.tag === 'button' && btn.props.type === 'button' }), 'D8 每行都是 type=button 的委托按钮（不是 div 假按钮）')
  const needRow = expectRows.filter(function (row: any) { return row.needsObject === true })[0]
  if (needRow) {
    const needBtn = allRows.filter(function (btn: any) { return String(btn.props['data-vc-search-row']) === String(needRow.id) })[0]
    const needText = findAll(needBtn, function (n: any) { return classHas(n, 'vcs-search-need') })[0]
    check(!!needText && textOf(needText) === trZh('vc.shell.search.needsObject'), 'D9 需要对象上下文的那一行写着「只跳入口」（实得「' + textOf(needText) + '」）')
  }

  // ===== E 渲染上限：超上限只画前 N 行并提示缩小范围（计数行仍写命中总数）=====
  const capped = render('git', '', 1)
  const cappedRows = findAll(capped, function (n: any) { return n.props && n.props['data-vc-search-row'] !== undefined })
  check(cappedRows.length === 1, 'E1 渲染上限 1 时只画 1 行（实得 ' + cappedRows.length + ' 行）')
  const moreNode = findAll(capped, function (n: any) { return n.props && n.props['data-vc-search-more'] === '1' })[0]
  check(!!moreNode && textOf(moreNode) === trZh('vc.shell.search.more', { n: 1 }), 'E2 超上限时末尾提示只画了前 1 条（实得「' + textOf(moreNode) + '」）')
  const cappedCount = findAll(capped, function (n: any) { return n.props && n.props['data-vc-search-count'] !== undefined })[0]
  check(!!cappedCount && cappedCount.props['data-vc-search-count'] === String(expectRows.length), 'E3 计数行仍写命中总数，不写被截断后的行数（实得 ' + String(cappedCount && cappedCount.props['data-vc-search-count']) + '）')
  check(leaf.VC_SEARCH_RENDER_MAX === 40, 'E4 默认渲染上限是 40 行（与原型搜索结果一致，实得 ' + String(leaf.VC_SEARCH_RENDER_MAX) + '）')

  // ===== F 高亮：只有被选中的那一行带命中标记 =====
  const target = expectRows[0]
  const highlighted = render('git', target.id)
  const hitRows = findAll(highlighted, function (n: any) { return n.props && n.props['data-vc-search-hit'] === '1' })
  check(hitRows.length === 1 && String(hitRows[0].props['data-vc-search-row']) === String(target.id), 'F1 只有选中的那一行带 data-vc-search-hit=1（实得 ' + hitRows.length + ' 行）')
  check(findAll(render('git', ''), function (n: any) { return n.props && n.props['data-vc-search-hit'] === '1' }).length === 0, 'F2 没有选中时整页不带命中标记')

  // ===== G 边界：搜索页不画命令面板、不抢能力账本主入口 =====
  const all = function (node: any, attr: string) {
    return findAll(node, function (n: any) { return n.props && n.props[attr] !== undefined })
  }
  check(all(hits, 'data-vc-palette-input').length === 0, 'G1 搜索页不画命令面板输入框（#1846：面板只作别的页面上的遮罩浮层）')
  check(all(hits, 'data-vc-palette-row').length === 0, 'G2 搜索页不画命令面板的结果行（两套行不能混）')
  check(all(hits, 'data-vc-palette-backdrop').length === 0, 'G3 搜索页不挂命令面板的遮罩（否则会把这一页自己盖住）')
  check(all(hits, 'data-cap-primary').length === 0, 'G4 搜索页的结果行不抢能力账本的主入口标记（data-cap-primary 只属于能力行）')
  check(all(hits, 'data-cap-row').length === 0, 'G5 搜索页的行不带能力行标记（它是搜索页自己的第二入口）')
  check(all(hits, 'data-vc-search-row').length === all(hits, 'data-vc-search-row').length && leaf.vcSearchGroupsOf([]).length === 0, 'G6 空行分组返回空数组（分工函数不凭空造组）')
  const fixtureGroups = leaf.vcSearchGroupsOf([
    { id: 'a', page: 'history', pageName: '提交历史' },
    { id: 'b', page: 'changes', pageName: '改动' },
    { id: 'c', page: 'history', pageName: '提交历史' },
  ])
  check(fixtureGroups.length === 2 && fixtureGroups[0].page === 'history' && fixtureGroups[0].rows.length === 2 && fixtureGroups[1].page === 'changes', 'G7 分组函数保持命中顺序、把同一页的行收进同一组（实得 ' + fixtureGroups.map(function (g: any) { return g.page + ':' + g.rows.length }).join(',') + '）')

  console.log('\n共 ' + total + ' 条断言，失败 ' + failed + ' 条')
  printGateResult(GATE, total, failed)
  process.exit(failed ? 1 : 0)
}

main().catch(function (e: any) {
  console.log('  FAIL 门禁自身抛错：' + String((e && e.stack) || e))
  printGateResult(GATE, total, failed)
  process.exit(1)
})
