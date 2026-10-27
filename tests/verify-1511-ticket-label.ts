// tests/verify-1511-ticket-label.ts —— 门禁：面板上的编号一律写成「#目录/编号」（#1511）。
//
// 要钉住的是维护者当初定的显示规则（#1480「维护者原话」2026-10-24 23:18 第 4 条、23:38 第 3–4 条，
// 以及同票「第一性原理」第 3 条「身份由路径决定（目录名 + 文件名里的 NN）」）：
//   本地 Markdown 后端每个目录各自从 01 开始编号，所以只写 `#01` 分不清是哪一张票，必须带上目录：
//     · 正常票            → #买咖啡积分/01
//     · 同目录编号重复     → #买咖啡积分/01-文件名（目录只写一次，不重复拼）
//     · 文件名里没有编号   → #买咖啡积分/<文件名>；重名尾巴带 -1/-2
//     · 容器（地图/规格）  → #买咖啡积分/00
//     · 远端后端（GitHub） → #123（没有目录这一层，原样）
//   显示规则只有一份实现：src/client/kernel/ticket-label.ts；五处显示点都经共用徽标组件
//   （src/client/views/shared/ticketBadge.ts，#1564）调它，不各拼一遍 `'#' + key`。
//   后端寻址（ticketKey / splitTicketKey）一个字都不动 —— 这是显示层的事，不碰身份。
//
// 手法：真函数直接 import 过来跑六种形状（含退化与远端）；五处显示点与接线用源码文本核对
// （它们住在浏览器闭包里，靠 build 拼进 src/client/index.ts，在这里没法整体运行）。
//
// 门禁归属: src/client/kernel/ticket-label.ts
// 门禁归属: src/client/views/shared/ticketBadge.ts
// 门禁归属: src/client/views/ListTabRow.ts
// 门禁归属: src/client/views/shared/workRouteTable.ts
// 门禁归属: src/client/statusbar/SessionChainCapsule.ts
// 门禁归属: src/client/views/IssueDetail.ts
// 门禁归属: src/client/views/MapDetailHead.ts
// 门禁归属: src/deck/shell/work-path-readout.ts
//
// 用法（在插件根目录，先 node scripts/build.mts）：
//   node --import ./scripts/ts-hook.mts tests/verify-1511-ticket-label.ts
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { sourceText } from './lib/source-text.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const imp = (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href)
let failed = false
let total = 0
const check = (ok: any, msg: string) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

async function main(): Promise<void> {
  // ── 一、显示规则的唯一实现：六种形状逐条钉住 ─────────────────────────────────────
  const mod: any = await imp('src/client/kernel/ticket-label.ts')
  const label = mod.ticketLabelOf
  check(typeof label === 'function', 'kernel/ticket-label.ts 导出 ticketLabelOf')

  const DIR = '买咖啡积分'
  check(label('01', DIR) === '#' + DIR + '/01', '正常票带目录：#买咖啡积分/01')
  check(label(1, DIR) === '#' + DIR + '/1', '数字形态的编号按原样写（不补零）：#买咖啡积分/1')
  check(label('01', '') === '#01', '没有目录（单工作单元后端）就只写 #01')
  check(label('01', null) === '#01', '目录为 null 按没有目录处理')
  check(label('01-买咖啡', DIR) === '#' + DIR + '/01-买咖啡', '同目录编号重复时编号已带后缀：#买咖啡积分/01-买咖啡')
  check(label(DIR + '/01-买咖啡', DIR) === '#' + DIR + '/01-买咖啡', '编号里已经含目录时不再重复拼一次目录（退化身份）')
  check(label('00', DIR) === '#' + DIR + '/00', '容器（地图/规格）同样是 #买咖啡积分/00')
  check(label(123, '') === '#123', '远端后端（GitHub/GitLab）仍写 #123')
  check(label(123, '   ') === '#123', '空白目录不算目录')
  check(label('', DIR) === '', '编号为空就不画（不画一个只有 # 和目录的空徽标）')
  check(label(null, DIR) === '', '编号为 null 也不画')
  check(label(undefined, undefined) === '', '两个参数都缺席时返回空串')

  // ── 一点五、B 方案的分段写法：目录前缀可省略、`/编号` 尾巴绝不缩小 ──────────────────
  // 同一串编号只在这里拆一次：前缀（含 `#`，不含 `/`）走省略号那一段，`/编号` 尾巴（`flex: none`）
  // 永远完整显示；上限宽度同样只在这里定一个值（`TICKET_LABEL_MAX_WIDTH_PX = 85`），五处显示点都读它，
  // 在办表首列分档的封顶也由它推出（#1565：格子与徽标不再一宽一窄）。
  // 取 85px 的原因：11px 字下 `#wayfin…/05` 外宽约 84px，按这串规则宽度定上限；放不下时目录段走省略号，
  // `/` 与编号尾巴始终完整（#1579：`/` 留在尾巴里，不再被目录段的末尾省略吃掉）。
  check(typeof mod.ticketLabelPartsOf === 'function', 'kernel/ticket-label.ts 导出 ticketLabelPartsOf')
  check(typeof mod.ticketLabelNodesOf === 'function', 'kernel/ticket-label.ts 导出 ticketLabelNodesOf')
  check(mod.TICKET_LABEL_MAX_WIDTH === '85px', '上限宽度是 85px（规则宽度：`#wayfin…/05` 外宽约 84px，放不下走目录省略）')
  // #1565：上限先写成像素数，CSS 写法与在办表首列分档的封顶都由它推出来 —— 改宽度只改这一个数。
  check(mod.TICKET_LABEL_MAX_WIDTH_PX === 85 && mod.TICKET_LABEL_MAX_WIDTH === mod.TICKET_LABEL_MAX_WIDTH_PX + 'px', '上限有两个形态（85 与 85px）且同源：分档封顶不会另写一个数')
  const parts = mod.ticketLabelPartsOf
  const p1 = parts('01', DIR)
  check(p1.full === '#' + DIR + '/01' && p1.prefix === '#' + DIR && p1.number === '/01', '正常票拆成 #目录 + /01（`/` 跟编号走，不被目录省略吃掉）')
  const p2 = parts('01', '')
  check(p2.full === '#01' && p2.prefix === '#' && p2.number === '01', '没有目录时拆成 # + 01')
  const p3 = parts(DIR + '/01-买咖啡', DIR)
  check(p3.full === '#' + DIR + '/01-买咖啡' && p3.prefix === '#' + DIR && p3.number === '/01-买咖啡', '退化身份同样按第一个 / 切（目录可压、`/编号` 保住）')
  const p4 = parts('', DIR)
  check(p4.full === '' && p4.prefix === '' && p4.number === '', '空编号返回空三件（不画空徽标）')
  const fakeH = function (tag: any, props: any) { return { tag: tag, props: props } }
  const nodes = mod.ticketLabelNodesOf(fakeH, '01', DIR)
  check(Array.isArray(nodes) && nodes.length === 2, '两段子节点：目录一段 + 编号一段')
  check(nodes[0] && nodes[0].props && nodes[0].props.style && nodes[0].props.style.textOverflow === 'ellipsis' && nodes[0].props.style.whiteSpace === 'nowrap', '目录那段走省略号（末尾变…）')
  check(nodes[1] && nodes[1].props && nodes[1].props.style && nodes[1].props.style.flex === 'none', '`/编号` 那段绝不缩小（flex: none）')
  check(mod.ticketLabelNodesOf(fakeH, '', DIR).length === 0, '空编号不画子节点')

  // ── 二、五处显示点都走共用徽标组件（#1564），组件内部仍调这份显示规则 ────────────────
  const sites: Array<{ file: string; why: string }> = [
    { file: 'src/client/views/ListTabRow.ts', why: '列表行的编号徽标' },
    { file: 'src/client/views/shared/workRouteTable.ts', why: '在办表首列票号' },
    { file: 'src/client/statusbar/SessionChainCapsule.ts', why: '状态栏链徽标的文字通道与朗读' },
    { file: 'src/client/views/IssueDetail.ts', why: '详情页头部的编号徽标' },
    { file: 'src/client/views/MapDetailHead.ts', why: '地图详情头部的编号徽标' },
  ]
  for (const s of sites) {
    const src = sourceText(s.file)
    check(src.indexOf('declare function ticketBadgeOf(') >= 0, s.file + ' 声明了共用徽标组件（' + s.why + '）')
    check(src.indexOf('ticketBadgeOf(h, {') >= 0, s.file + ' 真的调用共用徽标组件（' + s.why + '）')
  }
  // 显示规则（#目录/编号怎么写）仍然只在 kernel 一处：组件替五处调用它。
  const badgeSrc = sourceText('src/client/views/shared/ticketBadge.ts')
  check(badgeSrc.indexOf('ticketLabelOf(') >= 0, '共用徽标组件调 ticketLabelOf 拿完整写法（悬停与无障碍名同串）')
  check(badgeSrc.indexOf('ticketLabelNodesOf(') >= 0, '共用徽标组件调 ticketLabelNodesOf 画两段（目录可省略、编号绝不缩小）')
  // 票号徽标这一格最要紧：三处 dsws-idnum 徽标都由组件画，不许再写回 `'#' + 票号`。
  for (const file of ['src/client/views/ListTabRow.ts', 'src/client/views/IssueDetail.ts', 'src/client/views/MapDetailHead.ts']) {
    const badgeLine = sourceText(file).split('\n').filter((l) => l.indexOf('ticketBadgeOf(h, {') >= 0)[0] || ''
    check(badgeLine.indexOf("surface: 'badge'") >= 0, file + ' 的票号徽标用 badge 外壳：' + badgeLine.trim().slice(0, 70))
    check(!/'#'\s*\+/.test(badgeLine), file + ' 的票号徽标里没有自己拼的 #')
  }
  // ── 二点五、四种外壳只决定外面长什么样；上限宽度、两段与悬停只剩组件一处 ───────────
  for (const file of ['src/client/views/ListTabRow.ts', 'src/client/views/IssueDetail.ts', 'src/client/views/MapDetailHead.ts', 'src/client/views/shared/workRouteTable.ts', 'src/client/statusbar/SessionChainCapsule.ts']) {
    const src = sourceText(file)
    check(src.indexOf('ticketLabelNodesOf(') < 0 && src.indexOf('TICKET_LABEL_MAX_WIDTH') < 0, file + ' 不再自带两段/上限宽度（#1564 起整颗徽标走组件）')
  }
  const capsuleSrc = sourceText('src/client/statusbar/SessionChainCapsule.ts')
  check(/ticketBadgeOf\(h, \{ key: e\.ticketKey[\s\S]*?surface: 'capsule'/.test(capsuleSrc), '主胶囊走 capsule 外壳（折叠让位仍由 kernel 那份函数定）')
  check(/chainKeyTextOf/.test(capsuleSrc) && /ticketLabelOf\(/.test(capsuleSrc), '胶囊文字通道仍直接读完整写法（无障碍名与悬停同串）')

  // ── 三、接线：内核片段登记进构建、并写进 index 的拼接标记 ─────────────────────────────
  const buildSrc = sourceText('scripts/build.mts')
  check(buildSrc.indexOf("src/client/kernel/ticket-label.ts") >= 0, 'scripts/build.mts 的 KERNEL_MODULES 登记了 ticket-label')
  const idxSrc = sourceText('src/client/index.ts')
  check(/kernel:ticketLabel \(spliced by build\)/.test(idxSrc), 'src/client/index.ts 有 kernel:ticketLabel 的拼接标记')

  // ── 四、目录要从账本一路带到面板（不然上面那份实现拿不到目录，只能写 #01） ─────────────────
  const readoutSrc = sourceText('src/deck/shell/work-path-readout.ts')
  check(/export interface WorkPathReadoutEntry \{[\s\S]*?effortId\?: string/.test(readoutSrc), '读出口条目带 effortId')
  const effortWrites = (readoutSrc.match(/entry\.effortId = r\.effortId|entry\.effortId = e\.effortId/g) || []).length
  check(effortWrites >= 2, '原始读数与投影（core/standard）都把 effortId 带出去（实际 ' + effortWrites + ' 处）')
  const recordSrc = sourceText('src/deck/shell/work-path-record.ts')
  check(/input\.effortId = facts\.effortId/.test(recordSrc), '写账本时 effortId 已经记进去了（前置条件）')

  // 面板那一侧只认白名单字段：解析时要把它收进来，否则读出口带了也白带。
  const tableSrc = sourceText('src/client/views/shared/workRouteTable.ts')
  check(/effortId\?: string/.test(tableSrc), '在办表的行类型带 effortId')
  check(/row\.effortId = e\.effortId/.test(tableSrc), '在办表解析时收下 effortId')

  // ── 五、身份与寻址没被顺手改掉 ──────────────────────────────────────────────────
  const locateSrc = sourceText('src/tracker/rooms/markdown/issues-locate.ts')
  check(/return tf\.inner/.test(locateSrc), 'ticketKey() 仍然只返回短编号或退化身份（寻址口径未动）')

  if (total === 0) check(false, '一条断言都没跑')
}

main().then(function () {
  console.log('\n共 ' + total + ' 条断言')
  if (failed) { console.log('存在失败'); process.exit(1) }
  console.log('全部通过')
}).catch(function (e: any) {
  console.log('  FAIL 门禁自身抛错：' + String((e && e.stack) || e))
  process.exit(1)
})
