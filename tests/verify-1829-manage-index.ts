// tests/verify-1829-manage-index.ts —— 门禁：#1829 阶段 4-B 管理索引卡片。
//
// 锁住齿轮九分区索引从「一行一个链接」换成卡片之后必须保持的形状：
//   1. 外壳：根节点是 nav，带 data-vc-gear-index / data-vc-manage-index / 调用方传进来的 id /
//      两段类名（vcs-gear-index vcs-manage-index），读屏名取真词表 vc.shell.gear.title；
//   2. 九张卡：li.vcs-gear-li 恰好九个，按钮上的 data-vc-gear-item 与 VC_MANAGE_PAGES 逐项同序
//      （verify-818 的 Z11 按这个顺序联合对；顺序一变它先红）；
//   3. 每张卡三块文字：分区名（VC_MANAGE_SECTION_KEYS 指到的那条真词表）、本分区能力条数
//      （vc.shell.page.caps，参数用账本 PAGE_COUNTS）、打开提示（vc.shell.gear.open）；
//   4. 每张卡指回自己的面板（aria-controls='vc-page-<页面>'，verify-818 的 Z8d 查它落在真实 id 上），
//      并且仍是真按钮（type=button）：点击靠 vcRealDelegate 的 data-vc-gear-item 委托，
//      这里不挂 onClick、也不写 data-action；
//   5. 当前页那张卡带 aria-current='page'，整张索引里只有它一张；没有当前页时九张卡都不带。
//
// 手法与 verify-1545 同一套：真源码按构建同一套做法（spliceableJs 剥行首 export）装进假 React 求值，
// 跨叶符号（VC_MANAGE_PAGES / VC_MANAGE_SECTION_KEYS / PAGE_COUNTS）从真源模块注入；
// 词表从 config/copy/vcshell.yaml 现读，不读可能落后的生成物 locale-data.ts。
//
// 词条依赖：#1829 阶段 4-A 负责在词表里新增 vc.shell.page.caps。本门禁按「键 + 参数」验计数接线
// （第二趟渲染用记账的 t 看它到底问了哪个键、带了什么参数），词条落盘前也能跑绿；
// 词条到位后同一条断言比的就是真话术，不需要改这里。
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
const spansOf = (button: any, cls: string): any[] => findAll(button, (n: any) => n.type === 'span' && n.props.className === cls)

/** 真词表的取词函数：键缺词条时回落键名（与运行期 tZh 同口径），占位符按参数替换。 */
function tZhOf(zh: Record<string, string>) {
  return function (k: string, p?: any): string {
    let s: string = zh[k] !== undefined ? zh[k] : k
    Object.keys(p || {}).forEach(function (key: string) { s = s.split('{' + key + '}').join(String((p || {})[key])) })
    return s
  }
}

async function main() {
  console.log('#1829 阶段 4-B：齿轮九分区索引换成管理卡片（九张卡、三块文字、真按钮）')
  const registry: any = await imp('src/client/views/versionControl/vcCapabilityPages.ts')
  const ledger: any = await imp('src/shared/version-control/src/capability-ledger.ts')
  const VC_MANAGE_PAGES: string[] = registry.VC_MANAGE_PAGES
  const VC_MANAGE_SECTION_KEYS: Record<string, string> = registry.VC_MANAGE_SECTION_KEYS
  const PAGE_COUNTS: Record<string, number> = ledger.PAGE_COUNTS
  const doc: any = parseYaml(fs.readFileSync(path.join(ROOT, 'config/copy/vcshell.yaml'), 'utf8'))
  const zh: Record<string, string> = doc.zh
  const tZh = tZhOf(zh)
  const h = makeH()

  // 一、按构建同一套做法把叶子求值成真函数：跨叶符号当形参注入，等价于闭包里它们先有值。
  const leafSrc = spliceableJs('src/client/views/versionControl/vcManageIndex.js').replace(/^[ \t]*export[ \t]+/gm, '')
  const leaf: any = compileFn(['VC_MANAGE_PAGES', 'VC_MANAGE_SECTION_KEYS', 'PAGE_COUNTS'],
    leafSrc + '\nreturn { vcManageIndexNode }')(VC_MANAGE_PAGES, VC_MANAGE_SECTION_KEYS, PAGE_COUNTS)
  check(typeof leaf.vcManageIndexNode === 'function', '叶子导出 vcManageIndexNode(h, t, o)')

  const opts: any = { id: 'vc-maintenance-gear-index', active: 'maintenance' }
  const nav: any = leaf.vcManageIndexNode(h, tZh, opts)

  // 二、外壳：一个导航地标，两个标记属性与两段类名，读屏名走真词表。
  check(!!nav && nav.type === 'nav', '根节点是 nav（整块索引是一个导航地标）')
  check(!!nav && nav.props['data-vc-gear-index'] === '1', 'nav 带 data-vc-gear-index="1"（事件委托与门禁的钥匙）')
  check(!!nav && nav.props['data-vc-manage-index'] === '1', 'nav 带 data-vc-manage-index="1"（管理索引卡片这一层的标记）')
  check(!!nav && nav.props.id === opts.id, 'nav 用调用方传进来的 id（实得 ' + String(nav && nav.props.id) + '）')
  check(!!nav && nav.props.className === 'vcs-gear-index vcs-manage-index', 'nav 两段类名都在：索引外壳 + 管理卡片')
  check(!!nav && nav.props['aria-label'] === zh['vc.shell.gear.title'], '读屏名取真词表 vc.shell.gear.title（' + zh['vc.shell.gear.title'] + '）')
  const head: any = (nav.children || [])[0] || null
  const list: any = (nav.children || [])[1] || null
  check(!!head && head.type === 'p' && head.props.className === 'vcs-gear-title' && textOf(head) === zh['vc.shell.gear.title'], '第一块是标题 p.vcs-gear-title，文字取真词表')
  check(!!list && list.type === 'ul' && list.props.className === 'vcs-gear-list', '第二块是 ul.vcs-gear-list（九张卡按顺序装在里面）')

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

  // 四、每张卡三块文字：分区名与打开提示是词表真话术，计数按 vc.shell.page.caps + 账本条数取。
  const sectionKeys: string[] = VC_MANAGE_PAGES.map((id: string) => VC_MANAGE_SECTION_KEYS[id])
  check(sectionKeys.every((k: string) => typeof zh[k] === 'string' && zh[k].length > 0), '九个分区名在词表里都有真词条')
  check(VC_MANAGE_PAGES.every((id: string) => typeof PAGE_COUNTS[id] === 'number' && PAGE_COUNTS[id] > 0), '账本里九个分区都有正数能力条数')
  const titleSpans: any[] = buttons.map((b: any) => spansOf(b, 'vcs-manage-card-title'))
  const countSpans: any[] = buttons.map((b: any) => spansOf(b, 'vcs-manage-card-count'))
  const goSpans: any[] = buttons.map((b: any) => spansOf(b, 'vcs-manage-card-go'))
  check(titleSpans.every((s: any[]) => s.length === 1) && countSpans.every((s: any[]) => s.length === 1) && goSpans.every((s: any[]) => s.length === 1), '每张卡三块文字各恰好一块（名称 / 计数 / 打开提示）')
  check(JSON.stringify(titleSpans.map((s: any[]) => textOf(s[0]))) === JSON.stringify(sectionKeys.map((k: string) => zh[k])), '九张卡的分区名逐项等于真词表（' + sectionKeys.map((k: string) => zh[k]).join('、') + '）')
  check(JSON.stringify(countSpans.map((s: any[]) => textOf(s[0]))) === JSON.stringify(VC_MANAGE_PAGES.map((id: string) => tZh('vc.shell.page.caps', { n: PAGE_COUNTS[id] }))), '九张卡的计数文案按 vc.shell.page.caps + PAGE_COUNTS 取')
  check(JSON.stringify(goSpans.map((s: any[]) => textOf(s[0]))) === JSON.stringify(VC_MANAGE_PAGES.map(() => zh['vc.shell.gear.open'])), '九张卡的打开提示都取真词表 vc.shell.gear.open')
  if (zh['vc.shell.page.caps'] === undefined) {
    console.log('  NOTE 词表里还没有 vc.shell.page.caps（#1829 阶段 4-A 负责新增）：计数这一格按「键 + 参数」验接线，词条落盘后同一条断言比的就是真话术')
  }

  // 五、当前页只有一张卡带 aria-current='page'，换一页跟着换，没有当前页时一张都不带。
  const current: any[] = buttons.filter((b: any) => b.props['aria-current'] === 'page')
  check(current.length === 1 && current[0].props['data-vc-gear-item'] === 'maintenance', '当前页（maintenance）那张卡带 aria-current="page"，且整张索引只有这一张')
  check(buttons.every((b: any) => b.props['aria-current'] === undefined || b.props['aria-current'] === 'page'), 'aria-current 只有两种状态：当前页是 page，其余是 undefined（渲染时不出现）')
  check(buttons.filter((b: any) => b.props['aria-current'] !== 'page').every((b: any) => b.props['aria-current'] === undefined), '非当前页的卡一律不带 aria-current')
  const navEmpty: any = leaf.vcManageIndexNode(h, tZh, { id: 'vc-x-gear-index', active: '' })
  check(findAll(navEmpty, (n: any) => n.type === 'button').every((b: any) => b.props['aria-current'] === undefined), '没有当前页时：九张卡都不带 aria-current')
  const navRemote: any = leaf.vcManageIndexNode(h, tZh, { id: 'vc-x-gear-index', active: 'remote' })
  check(findAll(navRemote, (n: any) => n.type === 'button').filter((b: any) => b.props['aria-current'] === 'page').map((b: any) => b.props['data-vc-gear-item']).join(',') === 'remote', '换一页（remote）时 aria-current 跟着换，不是写死在维护页上')

  // 六、第二趟渲染用记账的 t：不看词表也能确认它问的是哪条键、带了什么参数（词条并行落盘时不误判）。
  const asked: any[] = []
  const tRec = function (k: string, p?: any): string {
    asked.push({ key: k, params: p || {} })
    return p === undefined ? 't:' + k : 't:' + k + ':' + JSON.stringify(p)
  }
  const navRec: any = leaf.vcManageIndexNode(h, tRec, { id: 'vc-x-gear-index', active: '' })
  const btnRec: any[] = findAll(navRec, (n: any) => n.type === 'button')
  check(navRec.props['aria-label'] === 't:vc.shell.gear.title', '读屏名问的是词表键 vc.shell.gear.title')
  check(JSON.stringify(btnRec.map((b: any) => textOf(spansOf(b, 'vcs-manage-card-title')[0]))) === JSON.stringify(sectionKeys.map((k: string) => 't:' + k)), '分区名逐项问 VC_MANAGE_SECTION_KEYS 指到的那条键')
  check(JSON.stringify(btnRec.map((b: any) => textOf(spansOf(b, 'vcs-manage-card-count')[0]))) === JSON.stringify(VC_MANAGE_PAGES.map((id: string) => 't:vc.shell.page.caps:{"n":' + PAGE_COUNTS[id] + '}')), '计数问的是 vc.shell.page.caps，参数是账本 PAGE_COUNTS[页面]')
  check(JSON.stringify(btnRec.map((b: any) => textOf(spansOf(b, 'vcs-manage-card-go')[0]))) === JSON.stringify(VC_MANAGE_PAGES.map(() => 't:vc.shell.gear.open')), '打开提示问的是词表键 vc.shell.gear.open')
  check(asked.length > 0 && asked.every((a: any) => typeof a.key === 'string' && a.key.indexOf('vc.shell.') === 0), '这一趟渲染取词全部走 vc.shell.* 词表键，没有写死的中文')

  if (total === 0) check(false, '一条断言都没跑')
  console.log('\n共 ' + total + ' 条断言，' + (failed ? '存在失败' : '全部通过'))
  printGateResult(GATE, total, failed ? 1 : 0)
  if (failed) process.exit(1)
}

main().catch(function (e: any) {
  console.log('  FAIL 门禁自身抛错：' + String((e && e.stack) || e))
  process.exit(1)
})
