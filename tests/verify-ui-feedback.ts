// tests/verify-ui-feedback.ts —— 门禁：界面反馈（液态墨块 / 悬停 / 按压 / 点击日志）不许漏、不许各写一套
// 判据（用户在界面上能直接感觉到的事）：
// 1. 面板五颗页签、列表页三组筛选药丸：选中块是一整块自己滑过去的底（.dsws-ink），
//    不是每颗按钮各换一次底色；墨块只写 transform 与 CSS 变量，对位时只读一次 offset* 尺寸
//    （docs/adr/20260911-zero-layout-jitter.md：测量相只读、变更相只写，不量改交替）。
// 2. 清单里每个可点控件都有悬停与按压反馈：悬停靠 .dsws-hov / .dsws-tab:hover / .dsws-chip:hover，
//    按压靠 data-press 属性；两套都在 feedback-styles.ts 里，且减少动态时都有降级。
// 3. 点完之后能凭一条日志唯一定位到被点的那一颗：每个可点控件带同屏唯一的 data-log，
//    统一由 kernel/ui-feedback.ts 写 debug 级 ui.action（调试开关关着时第一行早退、零开销）。
// 4. 分流/分支里重复写的同名按钮（返回列表在多个渲染分支各一份）允许字面量重复；不同控件不许共用。
// 跑法：node --import ./scripts/ts-hook.mts tests/verify-ui-feedback.ts
// 做法：读真源文本断言形状与清单，不另抄一份实现；样式判据读 feedback-styles.ts 这一份叶子。
import { sourceText } from './lib/source-text.ts'

let failures = 0
let total = 0
const check = (ok: any, msg: string) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failures++ }

const read = (p: string) => sourceText(p)
const uiFeedback = read('src/client/kernel/ui-feedback.ts')
const liquidInk = read('src/client/views/shared/liquidInk.ts')
const feedbackCss = read('src/client/views/feedback/feedback-styles.ts')
const indexSrc = read('src/client/index.ts')
const buildSrc = read('scripts/build.mts')

// ============ A 组：公共底座就这一个口 ============
check(uiFeedback.indexOf("export const UI_PRESS_CLASS = 'dsws-pressing'") >= 0, 'A1 按压态只有一个类名真源（UI_PRESS_CLASS = dsws-pressing）')
check(uiFeedback.indexOf("export const UI_PRESS_ATTR = 'data-press'") >= 0 && uiFeedback.indexOf("export const UI_LOG_ATTR = 'data-log'") >= 0, 'A2 控件只写两个属性：data-press（按压形状）与 data-log（点击定位）')
check(uiFeedback.indexOf("export function installUiFeedback") >= 0, 'A3 委托在启动段装一次（installUiFeedback）')
const dbgAt = uiFeedback.indexOf("isEnabled('debug')")
const attrAt = uiFeedback.indexOf('logTargetOf(ev)')
check(dbgAt >= 0 && attrAt > dbgAt, 'A4 调试开关关着时先早退、再读属性（不拼字段、不排队、零开销）')
check(uiFeedback.indexOf("log('debug', 'ui.action', { target: target, kind: kind })") >= 0, 'A5 点击落定后写一条 ui.action（debug 级，字段只有 target / kind）')
check(uiFeedback.indexOf('.toLowerCase()') >= 0, 'A6 定位串统一转小写（camelCase 枚举不会丢成残缺值）')
check(uiFeedback.indexOf("for (let node = t; node && node.nodeType === 1; node = node.parentNode)") >= 0, 'A7 从事件目标往上找最近的控件（外层行与内层按钮各有各的 data-log，近的优先）')
check(indexSrc.indexOf('// ==== kernel:uiFeedback (spliced by build) ====') >= 0 && indexSrc.indexOf('installUiFeedback()') >= 0, 'A8 客户端入口拼进这一片并在启动段调用一次')
check(buildSrc.indexOf("file: 'src/client/kernel/ui-feedback.ts'") >= 0 && buildSrc.indexOf("file: 'src/client/views/shared/liquidInk.ts'") >= 0 && buildSrc.indexOf("file: 'src/client/views/listFilterRow.ts'") >= 0, 'A9 三个新片都登记进构建清单（不登记会静默不编译）')
check(indexSrc.indexOf('// ==== leaf:liquidInk (spliced by build) ====') >= 0 && indexSrc.indexOf('// ==== leaf:listFilterRow (spliced by build) ====') >= 0, 'A10 两个新叶子的拼接标记都在入口里')

// ============ B 组：液态墨块怎么动、不许碰布局 ============
check(liquidInk.indexOf("export const LIQUID_INK_CLASS = 'dsws-ink'") >= 0 && liquidInk.indexOf('export function useLiquidInk') >= 0 && liquidInk.indexOf('export function liquidInkRemember') >= 0, 'B1 墨块对外只有三件：类名常量、组件入口 useLiquidInk、点击记忆 liquidInkRemember')
check(liquidInk.indexOf('getBoundingClientRect') < 0, 'B2 不用 getBoundingClientRect（只读 offset* 四个尺寸，避免测量相里触发额外重排）')
check(liquidInk.indexOf("readPx(target, 'offsetLeft')") >= 0 && liquidInk.indexOf("readPx(target, 'offsetWidth')") >= 0, 'B3 对位读的是目标元素的 offset 尺寸（单次读，ADR 零抖动）')
check(liquidInk.indexOf("setProperty('--dsws-ink-x'") >= 0 && liquidInk.indexOf("setProperty('--dsws-ink-w'") >= 0, 'B4 变更相只写墨块自己的 CSS 变量（--dsws-ink-x/y/w/h）')
check(liquidInk.indexOf("const INK_INSTANT_CLASS = 'dsws-ink-instant'") >= 0, 'B5 第一次定位先禁过渡，墨块不从左上角飞进来')
check(liquidInk.indexOf('ink.contains && ink.contains(t)') >= 0, 'B6 观察回调忽略墨块自身的变动（否则对位改样式会自己触发自己，整窗卡死）')
check(liquidInk.indexOf("const group = (ink.getAttribute && ink.getAttribute('data-ink-group'))") >= 0, 'B7 一块墨块只盯一组（同一容器里可并排住状态/排序/标签三块）')
check(feedbackCss.indexOf('.dsws-ink-host{position:relative}') >= 0 && feedbackCss.indexOf(".dsws-ink{position:absolute") >= 0, 'B8 墨块是一层绝对定位的底（容器补 position:relative）')
check(feedbackCss.indexOf('transition:transform .24s linear(0,.55 30%,1.06 62%,.99 84%,1)') >= 0, 'B9 滑动带一点过冲（linear() 逐段曲线），落定回弹不靠动画库')
check(feedbackCss.indexOf('.dsws-ink-host .dsws-tab.on{background:transparent') >= 0 && feedbackCss.indexOf('.dsws-ink-host .dsws-ink-on{background:transparent!important') >= 0, 'B10 选中项原来的底色/描边让位给墨块（页签用 .on，药丸用 .dsws-ink-on）')
check(feedbackCss.indexOf('.dsws-ink{position:absolute') < feedbackCss.indexOf('@media (prefers-reduced-motion: reduce){.dsws-ink'), 'B11 减少动态有降级：墨块仍在，只是不滑（不是整块消失）')

// ============ C 组：五颗页签 + 三组药丸都接上了 ============
const tabs = read('src/client/views/shared/Tabs.ts')
const dock = read('src/client/panel/Dock.ts')
const filterRow = read('src/client/views/listFilterRow.ts')
check(tabs.indexOf('useLiquidInk(inkHostRef)') >= 0 && tabs.indexOf("'data-ink-key': id") >= 0, 'C1 五颗页签共用一块墨块，点哪颗记哪颗（data-ink-key）')
check(tabs.indexOf('panel.tab.') >= 0 && ['list', 'skills', 'versionControl', 'pr', 'checks'].every((id) => tabs.indexOf("tabBtn('" + id + "'") >= 0), 'C2 五个页签 id 都在 items 里，日志名由 id 派生（panel.tab.*）')
check(dock.indexOf("'dsws-tabs dsws-ink-host'") >= 0 || dock.indexOf('dsws-tabs dsws-ink-host') >= 0, 'C3 页签那一行就是墨块容器（dsws-ink-host）')
check(dock.indexOf('tabsRef.current = el') >= 0 && dock.indexOf('tabs.inkHostRef.current = el') >= 0, 'C4 同一个节点挂两个 ref：折叠机读 tabsRef，墨块读 inkHostRef，谁也不拆谁')
check(dock.indexOf('[tabs.inkEl].concat(tabs.items') >= 0, 'C5 墨块作为第一个子节点放进页签行（绝对定位，不占位）')
check(["'state'", "'sort'", "'label'"].every((g) => filterRow.indexOf('useLiquidInk(hostRef, ' + g + ')') >= 0), 'C6 三组药丸各有一块墨块：状态 / 排序 / 标签')
check(filterRow.indexOf("const INK_RADIUS: string = '99px'") >= 0 && filterRow.indexOf("'data-ink-radius': INK_RADIUS") >= 0, 'C7 药丸墨块是胶囊圆角（99px），与页签的 6px 分开')
check(filterRow.indexOf("liquidInkRemember(e.currentTarget, nm, 'label')") >= 0, 'C8 多选标签组记住「最近点中的那颗」，取消选中时墨块退回同组第一个选中项')
check((filterRow.match(/data-ink-group/g) || []).length >= 3 && (filterRow.match(/data-press': 'chip'/g) || []).length >= 3, 'C9 三组药丸都带分组键、底色/描边来源与按压态')

// ============ D 组：清单里每个控件都有点击日志（一个不能漏） ============
const matrix: [string, string, string[]][] = [
  ['src/client/views/shared/Tabs.ts', '面板页签与两个新建入口', ['panel.newwayfinder', 'panel.newbug']],
  ['src/client/panel/Dock.ts', '仓库名/切后端/刷新', ['head.repochip', 'head.switchbackend', 'head.refresh']],
  ['src/client/views/labels/LabelColorEntry.ts', '调色板入口', ['head.palette']],
  ['src/client/views/shared/workRouteTable.ts', '在办表入口', ['head.workroute']],
  ['src/client/views/listFilterRow.ts', '列表三组筛选药丸', ['list.filter.state.', 'list.filter.sort.', 'list.filter.label.']],
  ['src/client/views/ListTabRow.ts', '列表行与行内四颗按钮', ['list.row.', 'list.row.newsession.', 'list.row.copy.', 'list.row.link.']],
  ['src/client/kernel/row-actions.ts', '行级主动作（执行/原型）', ['issue.action.']],
  ['src/client/views/MapDetail.ts', '地图卡片与折叠条', ['map.card.', 'map.card.newsession.', 'map.card.copy.', 'map.card.link.', 'map.notes.toggle', 'map.decisions.toggle', 'map.fog.toggle', 'map.outofscope.toggle']],
  ['src/client/views/MapDetailTop.ts', '地图详情顶栏', ['map.top.back', 'map.top.exec', 'map.top.newsession', 'map.top.copy', 'map.top.link']],
  ['src/client/views/DetailActionBar.ts', '地图底部执行/档案', ['map.dest.exec', 'map.dest.archive']],
  ['src/client/views/IssueDetail.ts', '工单详情顶栏、父链接、子票与被阻塞行', ['issue.top.back', 'issue.top.exec', 'issue.top.newsession', 'issue.top.copy', 'issue.top.link', 'issue.parent.', 'issue.sub.', 'issue.blocked.']],
  ['src/client/views/IssueDetailComments.ts', '评论发送', ['issue.comment.send']],
  ['src/client/views/SettingsPage.ts', '设置页 star/issue/版本号/插件行', ['settings.version', 'settings.star', 'settings.issue', 'settings.plugin.']],
  ['src/client/views/SettingsWorkspaces.ts', '工作区总览刷新与展开收起', ['settings.workspaces.toggle', 'settings.workspaces.refresh']],
  ['src/client/views/diagnosticLog/DiagnosticLogSection.ts', '调试开关与四颗日志按钮', ['settings.debug.toggle', 'settings.log.export', 'settings.log.open', 'settings.log.copy', 'settings.log.clear']],
]
for (const [file, what, names] of matrix) {
  const src = read(file)
  const miss = names.filter((n) => src.indexOf(n) < 0)
  check(miss.length === 0, 'D ' + what + '（' + file.split('/').pop() + '）都有 data-log' + (miss.length ? '；缺：' + miss.join(', ') : ''))
}

// ============ E 组：日志定位串的命名纪律 ============
const wiredFiles = matrix.map(([f]) => f).concat(['src/client/views/ListTab.ts'])
const literals: string[] = []
for (const f of wiredFiles) {
  const src = read(f)
  const re = /'data-log':\s*'([^']+)'/g
  let m: any
  while ((m = re.exec(src))) literals.push(m[1])
}
check(literals.length >= 50, 'E1 清单内接线的 data-log 字面量数量够（实际 ' + literals.length + ' 处）')
const badName = literals.filter((n) => !/^[a-z0-9._-]+$/.test(n))
check(badName.length === 0, 'E2 每个定位串都只含小写字母、数字、点、横线、下划线（与 ui-feedback 的限字符规则一致）' + (badName.length ? '；违规：' + badName.join(', ') : ''))
const prefixCount: Record<string, number> = {}
for (const n of literals) { const p = n.split('.').slice(0, 2).join('.'); prefixCount[p] = (prefixCount[p] || 0) + 1 }
check(Object.keys(prefixCount).length >= 12, 'E3 定位串按界面分区成组（面板/头部/列表/地图/工单/设置），不是一锅汤（实际 ' + Object.keys(prefixCount).sort().join('、') + '）')

// ============ F 组：悬停与按压的样式只有一套 ============
check(feedbackCss.indexOf('.dsws-pressing{filter:brightness(.85)}') >= 0, 'F1 通用按压态：按下去整颗压暗一档（全清单共用）')
check(feedbackCss.indexOf('@media (hover:hover) and (pointer:fine){.dsws-hov:hover') >= 0, 'F2 通用悬停态只对真鼠标生效（触屏不残留悬停样式）')
check(feedbackCss.indexOf('.dsws-tab:hover:not(.on)') >= 0 && feedbackCss.indexOf('.dsws-ink-host .dsws-tab:hover{filter:brightness(1.12)}') >= 0, 'F3 页签悬停：没选中的换底、选中的再提亮一档（五颗每一颗都有反馈）')
check(feedbackCss.indexOf('.dsws-chip:hover{filter:brightness(1.12)') >= 0, 'F4 筛选药丸悬停有提亮与描边')
check(feedbackCss.indexOf('.dsws-node:hover{border-color') >= 0 && feedbackCss.indexOf('.dsws-node.dsws-pressing') >= 0, 'F5 地图工单卡整张卡悬停与按压都有（卡内按钮各自还有自己的）')
check(feedbackCss.indexOf('.dsws-tab:focus-visible,.dsws-chip:focus-visible,.dsws-hov:focus-visible') >= 0, 'F6 键盘焦点环补到页签、药丸与小按钮（不删焦点可见性）')
check((feedbackCss.match(/prefers-reduced-motion/g) || []).length >= 4, 'F7 减少动态的降级覆盖到新效果（墨块、通用悬停、按压位移都关）')
for (const [file, label] of [['src/client/panel/Dock.ts', '头部 chip/切后端/刷新'], ['src/client/views/shared/Tabs.ts', '新建需求/+bug'], ['src/client/views/labels/LabelColorEntry.ts', '调色板'], ['src/client/views/shared/workRouteTable.ts', '在办表'], ['src/client/views/SettingsPage.ts', '设置页 star/issue/插件行'], ['src/client/views/SettingsWorkspaces.ts', '工作区刷新与展开'], ['src/client/views/IssueDetail.ts', '父链接与被阻塞行']] as [string, string][]) {
  check(read(file).indexOf('dsws-hov') >= 0, 'F ' + label + ' 用同一套甩停样式（dsws-hov），不各写一份')
}

console.log('')
console.log(failures === 0 ? ('全部通过：' + total + ' 条断言') : ('失败 ' + failures + ' / 共 ' + total + ' 条断言'))
if (failures > 0) process.exit(1)
