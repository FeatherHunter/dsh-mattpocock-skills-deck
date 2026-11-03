// tests/verify-1829-manage-index.ts —— 门禁：#1829 阶段 4-B / #1840 管理索引卡片与索引屏。
//
// 锁住「管理索引」这一屏在重做之后必须保持的形状。它有两种摆法共用一份卡片结构：
//   受控渲染（open.gear）把它挂在身份行下面；真实运行时它是独立的一屏（#1840，页面 id manage）。
// 这扇门禁只按结构验叶子，不启动外壳，所以两种摆法验的是同一份卡片。
//
// 一、外壳与九张卡（受控摆法）：
//   1. 根节点是 nav，带 data-vc-gear-index / data-vc-manage-index / 调用方传进来的 id /
//      两段类名（vcs-gear-index vcs-manage-index），读屏名取真词表 vc.shell.gear.title；
//      索引屏的页头已经写了标题，卡片列表里不再重复一块标题；
//   2. li.vcs-gear-li 恰好九个，按钮上的 data-vc-gear-item 与 VC_MANAGE_PAGES 逐项同序
//      （verify-818 的 Z11 按这个顺序联合对；顺序一变它先红）；
//   3. 每张卡三段：头部（分区名；维护分区再跟一枚「危险区」）、覆盖口径一句话、脚部（条数与打开提示）；
//      分区名、条数、覆盖口径、打开提示全部走真词表，条数参数取账本 PAGE_COUNTS；
//   4. 每张卡指回自己的面板（aria-controls='vc-page-<页面>'，verify-818 的 Z8d 查它落在真实 id 上），
//      并且仍是真按钮（type=button）：点击靠 vcRealDelegate 的 data-vc-gear-item 委托，
//      这里不挂 onClick、也不写 data-action；
//   5. 当前页那张卡带 aria-current='page'，整张索引里只有它一张；没有当前页时九张卡都不带。
//   6. 「危险区」只在 VC_MANAGE_DANGER_PAGES 点名的分区上出现，不按文案猜。
//
// 二、独立索引屏（#1840，vcManageIndexPageNode）：
//   说明句 → 九张卡 → 两条跨区入口（命令面板、全库搜索）→ 覆盖口径。
//   两条入口复用既有事件属性（data-vc-search-entry / data-vc-extra-link='search'），委托层不新增意图；
//   覆盖口径的四个计数从能力账本现算（直/折/诊/外），不在界面上抄死数字。
//
// 手法与 verify-1545 同一套：真源码按构建同一套做法（spliceableJs 剥行首 export）装进假 React 求值，
// 跨叶符号从真源模块注入；词表从 config/copy/vcshell.yaml 现读，不读可能落后的生成物 locale-data.ts。
//
// 门禁归属: src/client/views/versionControl/vcManageIndex.ts
//
// 用法（在插件根目录）：
//   node --import ./scripts/ts-hook.mts tests/verify-1829-manage-index.ts
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parse as parseYaml } from 'yaml'
import { compileFn } from './lib/eval-probe.js'
import { spliceableJs } from './lib/source-text.ts'
import { printGateResult } from './lib/gate-result.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const GATE = 'verify-1829-manage-index'
const imp = (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href)
let failed = false
let total = 0
const check = (ok: any, msg: string) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

/** 假 React 的 createElement：只留类型、属性与子节点，够按结构查形状。 */
function makeH() {
  return function (type: any, props: any) {
    const kids: any[] = []
    const walk = function (k: any) {
      if (Array.isArray(k)) { k.forEach(walk); return }
      if (k === null || k === undefined || k === false || k === true) return
      kids.push(k)
    }
    walk(Array.prototype.slice.call(arguments, 2))
    return { type: type, props: props || {}, children: kids }
  }
}

function findAll(node: any, pred: (n: any) => boolean, out: any[] = []): any[] {
  if (!node || typeof node !== 'object') return out
  if (Array.isArray(node)) { node.forEach((n) => findAll(n, pred, out)); return out }
  if (node.type && pred(node)) out.push(node)
  if (node.children) findAll(node.children, pred, out)
  return out
}

const textOf = (node: any): string => ((node && node.children) || []).filter((c: any) => typeof c === 'string').join('')
const spansOf = (node: any, cls: string): any[] => findAll(node, (n: any) => n.type === 'span' && n.props.className === cls)
const elsOf = (node: any, type: string, cls: string): any[] => (node.children || []).filter((c: any) => !!c && c.type === type && c.props.className === cls)

/** 真词表的取词函数：键缺词条时回落键名（与运行期 tZh 同口径），占位符按参数替换。 */
function tZhOf(zh: Record<string, string>) {
  return function (k: string, p?: any): string {
    let s: string = zh[k] !== undefined ? zh[k] : k
    Object.keys(p || {}).forEach(function (key: string) { s = s.split('{' + key + '}').join(String((p || {})[key])) })
    return s
  }
}

/** 覆盖口径四个计数：期望值取自账本构建期算好的 PLACEMENT_COUNTS（真源），只把中文桶名映成词表占位符名。
 *  不在测试里再数一遍 162 条 placement——那等于把叶子里的重算抄成第二份账本，门禁就成了自证。 */
function countsOf(placement: Record<string, number>) {
  return {
    direct: Number(placement['直'] || 0),
    fold: Number(placement['折'] || 0),
    diag: Number(placement['诊'] || 0),
    out: Number(placement['外'] || 0),
  }
}

async function main() {
  console.log('#1829 阶段 4-B / #1840：管理索引——九张分区卡与独立索引屏')
  const registry: any = await imp('src/client/views/versionControl/vcCapabilityPages.ts')
  const ledger: any = await imp('src/shared/version-control/src/capability-ledger.ts')
  const VC_MANAGE_PAGES: string[] = registry.VC_MANAGE_PAGES
  const VC_MANAGE_SECTION_KEYS: Record<string, string> = registry.VC_MANAGE_SECTION_KEYS
  const VC_MANAGE_DANGER_PAGES: string[] = registry.VC_MANAGE_DANGER_PAGES
  const PAGE_COUNTS: Record<string, number> = ledger.PAGE_COUNTS
  const PLACEMENT_COUNTS: Record<string, number> = ledger.PLACEMENT_COUNTS
  const CAPABILITIES: any[] = ledger.CAPABILITIES
  const doc: any = parseYaml(fs.readFileSync(path.join(ROOT, 'config/copy/vcshell.yaml'), 'utf8'))
  const zh: Record<string, string> = doc.zh
  const en: Record<string, string> = doc.en
  const tZh = tZhOf(zh)
  const h = makeH()
  const counts = countsOf(PLACEMENT_COUNTS)

  // 一、按构建同一套做法把叶子求值成真函数：跨叶符号当形参注入，等价于闭包里它们先有值。
  const leafSrc = spliceableJs('src/client/views/versionControl/vcManageIndex.js').replace(/^[ \t]*export[ \t]+/gm, '')
  const leaf: any = compileFn(['VC_MANAGE_PAGES', 'VC_MANAGE_SECTION_KEYS', 'PAGE_COUNTS', 'PLACEMENT_COUNTS', 'CAPABILITIES', 'VC_MANAGE_DANGER_PAGES'],
    leafSrc + '\nreturn { vcManageIndexNode, vcManageIndexPageNode, vcManageCardKeyOf }')(VC_MANAGE_PAGES, VC_MANAGE_SECTION_KEYS, PAGE_COUNTS, PLACEMENT_COUNTS, CAPABILITIES, VC_MANAGE_DANGER_PAGES)
  check(typeof leaf.vcManageIndexNode === 'function', '叶子导出 vcManageIndexNode(h, t, o)')
  check(typeof leaf.vcManageIndexPageNode === 'function', '叶子导出 vcManageIndexPageNode(h, t, o)（#1840 独立索引屏）')

  const opts: any = { id: 'vc-maintenance-gear-index', active: 'maintenance' }
  const nav: any = leaf.vcManageIndexNode(h, tZh, opts)

  // 二、外壳：一个导航地标，两个标记属性与两段类名，读屏名走真词表。
  check(!!nav && nav.type === 'nav', '根节点是 nav（整块索引是一个导航地标）')
  check(!!nav && nav.props['data-vc-gear-index'] === '1', 'nav 带 data-vc-gear-index="1"（事件委托与门禁的钥匙）')
  check(!!nav && nav.props['data-vc-manage-index'] === '1', 'nav 带 data-vc-manage-index="1"（管理索引卡片这一层的标记）')
  check(!!nav && nav.props.id === opts.id, 'nav 用调用方传进来的 id（实得 ' + String(nav && nav.props.id) + '）')
  check(!!nav && nav.props.className === 'vcs-gear-index vcs-manage-index', 'nav 两段类名都在：索引外壳 + 管理卡片')
  check(!!nav && nav.props['aria-label'] === zh['vc.shell.gear.title'], '读屏名取真词表 vc.shell.gear.title（' + zh['vc.shell.gear.title'] + '）')
  const list: any = (nav.children || [])[0] || null
  check(!!list && list.type === 'ul' && list.props.className === 'vcs-gear-list', '索引里第一块就是 ul.vcs-gear-list（标题交给页头，列表不重复一块标题）')
  check((nav.children || []).length === 1, '索引只有列表这一块，不再画 p.vcs-gear-title（实得 ' + (nav.children || []).length + ' 块）')

  // 三、九张卡与真页面表逐项同序：id 顺序就是 VC_MANAGE_PAGES 的顺序。
  const lis: any[] = list ? findAll(list, (n: any) => n.type === 'li' && n.props.className === 'vcs-gear-li') : []
  check(lis.length === 9, '恰好九个 li.vcs-gear-li（实得 ' + lis.length + ' 个）')
  const buttons: any[] = lis.map((li: any) => (li.children || [])[0])
  check(buttons.length === 9 && buttons.every((b: any) => !!b && b.type === 'button'), '每个 li 里恰好一张卡，卡是 button')
  check(buttons.length === 9 && buttons.every((b: any) => b.props.className === 'vcs-gear-item vcs-manage-card'), '每张卡两个类名都在：齿轮项 + 管理卡片')
  check(buttons.length === 9 && buttons.every((b: any) => b.props.type === 'button'), '每张卡 type="button"（真按钮，不是可点的 div）')
  const ids: string[] = buttons.map((b: any) => String(b.props['data-vc-gear-item']))
  check(JSON.stringify(ids) === JSON.stringify(VC_MANAGE_PAGES), '九张卡的 data-vc-gear-item 顺序 = VC_MANAGE_PAGES（' + ids.join(',') + '）')
  check(buttons.length === 9 && buttons.every((b: any, i: number) => b.props['aria-controls'] === 'vc-page-' + VC_MANAGE_PAGES[i]), '每张卡 aria-controls 指回自己的面板 vc-page-<页面>')
  check(buttons.length === 9 && buttons.every((b: any) => b.props['data-action'] === undefined && b.props.onClick === undefined), '卡上没有 data-action、也没有 onClick：点击走 data-vc-gear-item 委托，不假接')
  check(!/"style"/.test(JSON.stringify(nav)), '这片叶子不写内联样式（颜色与间距在 vcPageStyles 那一片）')

  // 四、每张卡三段：头部（名称 + 可选危险区）、覆盖口径、脚部（条数 + 打开提示）。
  const sectionKeys: string[] = VC_MANAGE_PAGES.map((id: string) => VC_MANAGE_SECTION_KEYS[id])
  // 键的派生规则由叶子导出的同一个函数算，测试不再手抄一遍 replace（两处各写一份迟早会漂）。
  const cardKeys: string[] = VC_MANAGE_PAGES.map((id: string) => leaf.vcManageCardKeyOf(id))
  check(sectionKeys.every((k: string) => typeof zh[k] === 'string' && zh[k].length > 0), '九个分区名在词表里都有真词条')
  check(cardKeys.every((k: string) => typeof zh[k] === 'string' && zh[k].length > 0), '九条覆盖口径说明在词表里都有真词条')
  check(VC_MANAGE_PAGES.every((id: string) => typeof PAGE_COUNTS[id] === 'number' && PAGE_COUNTS[id] > 0), '账本里九个分区都有正数能力条数')
  const partsOk: boolean[] = buttons.map(function (b: any) {
    const kids: any[] = b.children || []
    return kids.length === 3 &&
      kids[0].type === 'span' && kids[0].props.className === 'vcs-manage-card-head' &&
      kids[1].type === 'span' && kids[1].props.className === 'vcs-manage-card-text' &&
      kids[2].type === 'span' && kids[2].props.className === 'vcs-manage-card-foot'
  })
  check(partsOk.every(Boolean), '每张卡三段：头部 span / 覆盖口径 span / 脚部 span')
  const titleSpans: any[] = buttons.map((b: any) => spansOf(b, 'vcs-manage-card-title'))
  const textSpans: any[] = buttons.map((b: any) => spansOf(b, 'vcs-manage-card-text'))
  const countSpans: any[] = buttons.map((b: any) => spansOf(b, 'vcs-manage-card-count'))
  const goSpans: any[] = buttons.map((b: any) => spansOf(b, 'vcs-manage-card-go'))
  check(titleSpans.every((s: any[]) => s.length === 1) && textSpans.every((s: any[]) => s.length === 1) && countSpans.every((s: any[]) => s.length === 1) && goSpans.every((s: any[]) => s.length === 1), '每张卡四块文字各恰好一块（名称 / 说明 / 条数 / 打开提示）')
  check(JSON.stringify(titleSpans.map((s: any[]) => textOf(s[0]))) === JSON.stringify(sectionKeys.map((k: string) => zh[k])), '九张卡的分区名逐项等于真词表（' + sectionKeys.map((k: string) => zh[k]).join('、') + '）')
  check(JSON.stringify(textSpans.map((s: any[]) => textOf(s[0]))) === JSON.stringify(cardKeys.map((k: string) => zh[k])), '九条覆盖口径说明逐项取 card.<分区> 词条，说的是这一区管什么')
  check(JSON.stringify(countSpans.map((s: any[]) => textOf(s[0]))) === JSON.stringify(VC_MANAGE_PAGES.map((id: string) => tZh('vc.shell.page.caps', { n: PAGE_COUNTS[id] }))), '九张卡的条数文案按 vc.shell.page.caps + PAGE_COUNTS 取')
  check(JSON.stringify(goSpans.map((s: any[]) => textOf(s[0]))) === JSON.stringify(VC_MANAGE_PAGES.map(() => zh['vc.shell.gear.cardOpen'])), '九张卡的打开提示都取真词表 vc.shell.gear.cardOpen')

  // 五、危险区只在 VC_MANAGE_DANGER_PAGES 点名的分区上出现。
  const dangerSpans: any[] = findAll(nav, (n: any) => n.type === 'span' && n.props.className === 'vcs-manage-card-danger')
  check(JSON.stringify(VC_MANAGE_DANGER_PAGES) === JSON.stringify(['maintenance']), '危险分区清单点名的就是维护（当前为 ' + JSON.stringify(VC_MANAGE_DANGER_PAGES) + '）')
  check(dangerSpans.length === VC_MANAGE_DANGER_PAGES.length, '整张索引里「危险区」标记的个数等于危险分区数（实得 ' + dangerSpans.length + ' 枚）')
  const dangerCard: any = buttons.filter((b: any) => b.props['data-vc-gear-item'] === 'maintenance')[0]
  const dangerHead: any = dangerCard ? spansOf(dangerCard, 'vcs-manage-card-danger') : []
  check(dangerHead.length === 1 && textOf(dangerHead[0]) === zh['vc.shell.gear.danger'], '维护卡头部带一枚「危险区」标记，文字取真词表（' + zh['vc.shell.gear.danger'] + '）')
  check(buttons.filter((b: any) => b.props['data-vc-gear-item'] !== 'maintenance').every((b: any) => spansOf(b, 'vcs-manage-card-danger').length === 0), '其余八张卡不带危险区标记')

  // 六、当前页只有一张卡带 aria-current='page'，换一页跟着换，没有当前页时一张都不带。
  const current: any[] = buttons.filter((b: any) => b.props['aria-current'] === 'page')
  check(current.length === 1 && current[0].props['data-vc-gear-item'] === 'maintenance', '当前页（maintenance）那张卡带 aria-current="page"，且整张索引只有这一张')
  check(buttons.filter((b: any) => b.props['aria-current'] !== 'page').every((b: any) => b.props['aria-current'] === undefined), '非当前页的卡一律不带 aria-current')
  const navEmpty: any = leaf.vcManageIndexNode(h, tZh, { id: 'vc-x-gear-index', active: '' })
  check(findAll(navEmpty, (n: any) => n.type === 'button').every((b: any) => b.props['aria-current'] === undefined), '没有当前页时：九张卡都不带 aria-current')
  const navRemote: any = leaf.vcManageIndexNode(h, tZh, { id: 'vc-x-gear-index', active: 'remote' })
  check(findAll(navRemote, (n: any) => n.type === 'button').filter((b: any) => b.props['aria-current'] === 'page').map((b: any) => b.props['data-vc-gear-item']).join(',') === 'remote', '换一页（remote）时 aria-current 跟着换，不是写死在维护页上')

  // 七、独立索引屏：说明句 → 九张卡 → 两条跨区入口 → 覆盖口径，四块按这个顺序。
  const page: any = leaf.vcManageIndexPageNode(h, tZh, { id: 'vc-manage-gear-index' })
  check(!!page && page.type === 'div' && page.props.className === 'vcs-manage-page' && page.props['data-vc-manage-page'] === '1', '索引屏根节点是 div.vcs-manage-page（data-vc-manage-page="1"）')
  check((page.children || []).length === 4, '索引屏恰好四块（说明句 / 卡片列表 / 两条入口 / 覆盖口径），实得 ' + (page.children || []).length + ' 块')
  const note: any = (page.children || [])[0] || null
  check(!!note && note.type === 'p' && note.props.className === 'vcs-manage-note' && note.props['data-vc-note'] === 'manage-index' && textOf(note) === zh['vc.shell.gear.indexNote'], '第一块是 p.vcs-manage-note：说明句取真词表 vc.shell.gear.indexNote')
  const pageNav: any = (page.children || [])[1] || null
  check(!!pageNav && pageNav.type === 'nav' && pageNav.props['data-vc-gear-index'] === '1' && pageNav.props.id === 'vc-manage-gear-index', '第二块是同一份九卡导航（id 用调用方传进来的）')
  check(findAll(pageNav, (n: any) => n.type === 'button').length === 9 && findAll(pageNav, (n: any) => n.props['aria-current'] === 'page').length === 0, '索引屏的九张卡都在，且没有一张标 aria-current（索引屏自己没有「当前分区」）')
  const shortcuts: any = (page.children || [])[2] || null
  const scBtns: any[] = shortcuts ? (shortcuts.children || []) : []
  check(!!shortcuts && shortcuts.type === 'div' && shortcuts.props.className === 'vcs-manage-shortcuts' && scBtns.length === 2, '第三块是 div.vcs-manage-shortcuts，恰两条跨区入口')
  check(scBtns.length === 2 && scBtns.every((b: any) => b.type === 'button' && b.props.className === 'vcs-manage-shortcut' && b.props.type === 'button'), '两条入口都是真按钮 button.vcs-manage-shortcut（type="button"）')
  check(!!scBtns[0] && scBtns[0].props['data-vc-search-entry'] === '1' && scBtns[0].props['data-vc-extra-link'] === undefined, '第一条入口走既有命令面板属性 data-vc-search-entry（委托层不新增意图）')
  check(!!scBtns[1] && scBtns[1].props['data-vc-extra-link'] === 'search' && scBtns[1].props['data-vc-search-entry'] === undefined, '第二条入口走既有页面跳转属性 data-vc-extra-link="search"（落点是全库搜索页）')
  check(textOf(scBtns[0]) === tZh('vc.shell.gear.shortcutPalette', { n: CAPABILITIES.length }) && textOf(scBtns[1]) === zh['vc.shell.gear.shortcutSearch'], '两条入口的话术取真词表，条数参数用账本总数 ' + CAPABILITIES.length)
  check(scBtns.every((b: any) => b.props.onClick === undefined && b.props['data-action'] === undefined), '两条入口不挂 onClick、不写 data-action：点击仍走根节点的委托')
  const coverage: any = (page.children || [])[3] || null
  check(!!coverage && coverage.type === 'p' && coverage.props.className === 'vcs-coverage-note' && coverage.props['data-vc-note'] === 'coverage', '第四块是 p.vcs-coverage-note（覆盖口径）')
  const chip: any = spansOf(coverage, 'vcs-coverage-chip')
  const coverText: any = spansOf(coverage, 'vcs-coverage-text')
  const coverCount: any = spansOf(coverage, 'vcs-coverage-count')
  check(chip.length === 1 && textOf(chip[0]) === zh['vc.shell.gear.coverageChip'], '覆盖口径带一枚 chip，文字取真词表（' + zh['vc.shell.gear.coverageChip'] + '）')
  check(coverText.length === 1 && textOf(coverText[0]) === tZh('vc.shell.gear.coverageText', { n: CAPABILITIES.length }), '覆盖口径说明取真词表，能力总数用账本 ' + CAPABILITIES.length + ' 条现算')
  check(coverCount.length === 1 && textOf(coverCount[0]) === tZh('vc.shell.gear.coverageCount', counts), '覆盖口径四类计数按账本 placement 现算（直 ' + counts.direct + ' · 折 ' + counts.fold + ' · 诊 ' + counts.diag + ' · 外 ' + counts.out + '）')
  check(counts.direct + counts.fold + counts.diag + counts.out === CAPABILITIES.length, '四类计数加起来等于账本总条数（' + CAPABILITIES.length + ' 条，不重不漏）')
  check(!/"style"/.test(JSON.stringify(page)), '索引屏也不写内联样式（颜色与间距在 vcPageStyles 那一片）')

  // 八、词表：新增键中英文都有真话术，占位符两边一致（少一份，切语言就露键名）。
  const newKeys: string[] = ['vc.shell.page.manage', 'vc.shell.page.note.manage', 'vc.shell.gear.indexNote', 'vc.shell.gear.danger', 'vc.shell.gear.cardOpen',
    'vc.shell.gear.shortcutPalette', 'vc.shell.gear.shortcutSearch', 'vc.shell.gear.coverageChip', 'vc.shell.gear.coverageText', 'vc.shell.gear.coverageCount']
      .concat(cardKeys)
  check(newKeys.every((k: string) => typeof zh[k] === 'string' && zh[k].length > 0 && typeof en[k] === 'string' && en[k].length > 0), '索引屏新增的 ' + newKeys.length + ' 条词条在 zh 与 en 两边都有真话术')
  check(newKeys.filter((k: string) => zh[k].indexOf('{') >= 0).every((k: string) => { const zs = zh[k].match(/\{\w+\}/g) || []; const es = en[k].match(/\{\w+\}/g) || []; return JSON.stringify(zs.sort()) === JSON.stringify(es.sort()) }), '带占位符的词条两边占位符集合一致')

  // 九、第二趟渲染用记账的 t：不看词表也能确认它问的是哪条键、带了什么参数（词条并行落盘时不误判）。
  const asked: any[] = []
  const tRec = function (k: string, p?: any): string {
    asked.push({ key: k, params: p || {} })
    return p === undefined ? 't:' + k : 't:' + k + ':' + JSON.stringify(p)
  }
  const pageRec: any = leaf.vcManageIndexPageNode(h, tRec, { id: 'vc-x-gear-index' })
  const btnRec: any[] = findAll(pageRec, (n: any) => n.type === 'button' && n.props['data-vc-gear-item'] !== undefined)
  const keysAsked: string[] = asked.map((a: any) => a.key)
  check(asked.length > 0 && asked.every((a: any) => typeof a.key === 'string' && a.key.indexOf('vc.shell.') === 0), '索引屏取词全部走 vc.shell.* 词表键，没有写死的中文')
  check(keysAsked.indexOf('vc.shell.gear.indexNote') >= 0 && keysAsked.indexOf('vc.shell.gear.shortcutSearch') >= 0 && keysAsked.indexOf('vc.shell.gear.coverageChip') >= 0, '说明句、全库搜索入口、覆盖口径 chip 都问的是各自的词表键')
  check(JSON.stringify(asked.filter((a: any) => a.key === 'vc.shell.gear.shortcutPalette').map((a: any) => a.params)) === JSON.stringify([{ n: CAPABILITIES.length }]), '命令面板入口的话术问的是 vc.shell.gear.shortcutPalette，参数是账本总数')
  check(JSON.stringify(asked.filter((a: any) => a.key === 'vc.shell.gear.coverageText').map((a: any) => a.params)) === JSON.stringify([{ n: CAPABILITIES.length }]), '覆盖口径说明问的是 vc.shell.gear.coverageText，参数是账本总数')
  check(JSON.stringify(asked.filter((a: any) => a.key === 'vc.shell.gear.coverageCount').map((a: any) => a.params)) === JSON.stringify([counts]), '覆盖口径计数问的是 vc.shell.gear.coverageCount，参数是直折诊外四个数')
  check(JSON.stringify(btnRec.map((b: any) => textOf(spansOf(b, 'vcs-manage-card-title')[0]))) === JSON.stringify(sectionKeys.map((k: string) => 't:' + k)), '分区名逐项问 VC_MANAGE_SECTION_KEYS 指到的那条键')
  check(JSON.stringify(btnRec.map((b: any) => textOf(spansOf(b, 'vcs-manage-card-text')[0]))) === JSON.stringify(cardKeys.map((k: string) => 't:' + k)), '覆盖口径说明逐项由分区名键派生出 card.<分区> 键去问')
  check(JSON.stringify(btnRec.map((b: any) => textOf(spansOf(b, 'vcs-manage-card-count')[0]))) === JSON.stringify(VC_MANAGE_PAGES.map((id: string) => 't:vc.shell.page.caps:{"n":' + PAGE_COUNTS[id] + '}')), '条数问的是 vc.shell.page.caps，参数是账本 PAGE_COUNTS[页面]')
  check(JSON.stringify(btnRec.map((b: any) => textOf(spansOf(b, 'vcs-manage-card-go')[0]))) === JSON.stringify(VC_MANAGE_PAGES.map(() => 't:vc.shell.gear.cardOpen')), '打开提示问的是词表键 vc.shell.gear.cardOpen')
  check(asked.filter((a: any) => a.key === 'vc.shell.gear.danger').length === VC_MANAGE_DANGER_PAGES.length, '「危险区」只问了危险分区数那么多次（' + VC_MANAGE_DANGER_PAGES.length + ' 次，只有维护分区那一张卡要它）')

  if (total === 0) check(false, '一条断言都没跑')
  console.log('\n共 ' + total + ' 条断言，' + (failed ? '存在失败' : '全部通过'))
  printGateResult(GATE, total, failed ? 1 : 0)
  if (failed) process.exit(1)
}

main().catch(function (e: any) {
  console.log('  FAIL 门禁自身抛错：' + String((e && e.stack) || e))
  process.exit(1)
})
