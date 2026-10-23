// tests/verify-ui-feedback.ts —— 门禁：界面反馈（液态墨块 / 悬停 / 按压 / 点击日志）不许漏、不许各写一套
// 判据（用户在界面上能直接感觉到的事）：
// 1. 面板五颗页签、列表页三组筛选药丸：选中块是一整块自己滑过去的底（.dsws-ink），
//    不是每颗按钮各换一次底色；墨块只写 transform 与 CSS 变量，对位时只读一次 offset* 尺寸
//    （docs/adr/20260911-zero-layout-jitter.md：测量相只读、变更相只写，不量改交替）。
// 2. 清单里每个可点控件都有悬停与按压反馈：悬停靠 [data-press] 属性（药丸与页签另有类名规则，
//    静态角标没有 data-press、所以不许有假悬停），按压靠 data-press 属性；两套都在
//    feedback-styles.ts 里，且减少动态时都有降级。键盘焦点环、悬停高亮环、按下确认圈以及悬停边框里的灰色，
//    统一取 DSH 的 --dsw-focus-ring-color（缺省回落 --dsw-alias-state-business-primary），并往控件里面画——
//    不写死颜色、不会被容器裁断（2026-10-21 用户要求：所有「获得焦点边框的灰色」都走这个 token）。
// 3. 点完之后能凭一条日志唯一定位到被点的那一颗：每个可点控件带同屏唯一的 data-log，
//    统一由 kernel/ui-feedback.ts 写 debug 级 ui.action（调试开关关着时第一行早退、零开销）。
// 4. 分流/分支里重复写的同名按钮（返回列表在多个渲染分支各一份）允许字面量重复；不同控件不许共用。
// 5. 这扇门禁自己也要能判红：A–H 八组跑真实源码必须全绿，再喂一批反例（漏接线、命名重复、
//    大写混入、另写一套样式、日志少一条、选中项重新露底色形成双底、对位改用会触发布局的尺寸接口、
//    新叶子只加源码不登记构建清单、墨块拉伸的关键帧被删、墨块宿主的早退守卫被删、墨块的尺寸监听被删、
//    悬停规则不再排除按压态、日志形状不再取最近的按压元素、静态角标又出现假悬停、焦点环又往外画、
//    焦点环颜色又写死、地图卡片悬停边框又变灰、悬停高亮环又变回白色半透明、悬停灰边框又变回灰、按下确认圈又变回白、外扩环颜色又写死、
//    胶囊里的环没淡到五成、环色绕过了可继承的那一层、交接两段又变回整块直角、整条胶囊自己的环又挂回来、
//    交接两段又没撑满整行高度、会话链胶囊的焦点圈又变回直角、列表整行的悬停环又变回 1px、入口浮层的卡又被通用悬停规则多画一圈环、入口卡又挂回 dsws-hov、入口卡自己的焦点圈被删、入口卡按下又没反馈、五处浅色个例只改样式没挂标记、只挂标记没改样式、卡片与技能两份皮肤的焦点前缀被摘、浅色层引用的宿主令牌名拼错、多行提示浮层退回按内联样式命中）各一次，每种反例至少要在预期那一组里报一条 FAIL。
//    反例只在内存里改文本、不落盘，做法同 tests/verify-1327-freshness-content.ts 的判据自证。
// 跑法：node --import ./scripts/ts-hook.mts tests/verify-ui-feedback.ts
// 做法：读真源文本断言形状与清单，不另抄一份实现；样式判据读 feedback-styles.ts 这一份叶子。
import { sourceText } from './lib/source-text.ts'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

// H 组要扫全仓客户端源文件，不能只扫清单里那几片，否则漏网的控件照样溜过去。
// 仓库根从当前目录往上找（找得到 scripts 与 src 的那一层），不依赖运行方式。
function repoRoot(): string {
  let dir = process.cwd()
  for (let i = 0; i < 6; i++) {
    try {
      const names = readdirSync(dir)
      if (names.indexOf('scripts') >= 0 && names.indexOf('src') >= 0) return dir
    } catch (e) {}
    const up = join(dir, '..')
    if (up === dir) break
    dir = up
  }
  return process.cwd()
}

/** src/client 下全部 .ts 源文件（仓库相对路径，正斜杠）。 */
const CLIENT_FILES: string[] = (() => {
  const root = repoRoot()
  const out: string[] = []
  const walk = (dir: string, prefix: string) => {
    let entries: any[] = []
    try { entries = readdirSync(dir, { withFileTypes: true }) as any[] } catch (e) { return }
    for (const e of entries) {
      const rel = prefix ? prefix + '/' + e.name : e.name
      if (e.isDirectory()) walk(join(dir, e.name), rel)
      else if (e.name.endsWith('.ts')) out.push('src/client/' + rel)
    }
  }
  walk(join(root, 'src', 'client'), '')
  return out.sort()
})()

let failures = 0
let total = 0
const check = (ok: any, msg: string) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failures++ }

// D 组逐控件清单：第一格是文件，第二格是这块界面叫什么，第三格是每颗控件该有的定位串（前缀或完整名）。
const MATRIX: [string, string, string[]][] = [
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
  // 2026-10-21 补全：清单之外的可点控件也补齐了接线（用户要求「把所有遗漏的控件都补全了」），
  // 下面这些是补全时新接上的几片界面，每片都要有自己这一组定位串。
  ['src/client/statusbar/StatusBar.ts', '状态栏胶囊、分段与横幅', ['status.capsule', 'status.seg.', 'status.banner.', 'status.menu.', 'status.handoff', 'status.refresh', 'status.gate.']],
  ['src/client/statusbar/StatusLogMenu.ts', '状态栏日志菜单', ['status.logdot', 'status.logmenu.', 'status.logconfirm.backdrop']],
  ['src/client/statusbar/LogDangerConfirm.ts', '日志危险操作确认', ['status.logconfirm.', 'status.lognotice.']],
  ['src/client/statusbar/SessionChainCapsule.ts', '会话链胶囊', ['status.chainmenu.row.', 'status.capsule.chain']],
  ['src/client/views/ListTab.ts', '列表页顶部按钮与筛选药丸', ['list.filter.remove.', 'list.filter.clear', 'list.healthcheck', 'list.effort.', 'list.fold.closed']],
  ['src/client/views/ListTabClosed.ts', '已关闭列表', ['list.closed.web']],
  ['src/client/views/IssueDetail.ts', '工单详情错误态控件', ['detail.err.']],
  ['src/client/views/IssueDetailComments.ts', '评论区的错误态链接', ['detail.cmt.']],
  ['src/client/views/MapDetail.ts', '地图详情里的决策链接', ['map.decision.link.']],
  ['src/client/views/MapDetailHead.ts', '地图详情头部', ['map.head.retry', 'map.head.open']],
  ['src/client/views/MapDetailSpecBody.ts', '规格地图页的折叠段', ['map.spec.section.']],
  ['src/client/views/ChecksTab.ts', '环境检查页', ['check.fix.', 'check.recheck', 'check.diag.']],
  ['src/client/views/PrTab.ts', '拉取请求页', ['pr.retry', 'pr.row.']],
  ['src/client/views/RunPanel.ts', '运行面板', ['run.openpanel', 'run.openconfig']],
  ['src/client/views/SkillsTab.ts', '技能页药丸', ['skill.chip.']],
  ['src/client/views/SetupCard.ts', '设置向导卡片', ['setup.close', 'setup.cancel', 'setup.confirm']],
  ['src/client/views/SubworkspaceMark.ts', '子工作区标记', ['sub.mark.open']],
  ['src/client/views/TicketRow.ts', '工单行与行内按钮', ['ticket.row.', 'ticket.newsession.', 'ticket.link.', 'ticket.view.']],
  ['src/client/views/NoRepoCard.ts', '无仓库红卡', ['norepo.pending.', 'norepo.other.', 'norepo.dismiss.', 'norepo.card.', 'norepo.err.', 'norepo.form.', 'norepo.labels.']],
  ['src/client/views/labels/LabelColorDialog.ts', '标签色弹窗', ['lc.close.x', 'lc.save', 'lc.copy', 'lc.retry']],
  ['src/client/views/labels/LabelColorRow.ts', '标签色每一行', ['lc.row.raw.toggle.', 'lc.row.swatch.']],
  ['src/client/views/cards/PixelCardBtns.ts', '像素卡里的四颗按钮', ['card.btn.']],
  ['src/client/views/cards/PixelIssueCard.ts', '像素工单卡', ['card.issue.']],
  ['src/client/views/cards/PixelIssueMapCard.ts', '像素地图工单卡', ['card.map.']],
  ['src/client/views/pixel/PixelBtn.ts', '像素按钮', ['pixel.btn.']],
  ['src/client/views/pixel/PixelBanner.ts', '像素横幅', ['banner.retry', 'banner.dismiss']],
  ['src/client/views/skillDetail/PixelContents.ts', '技能详情目录', ['sd.toc.row.']],
  ['src/client/views/skillDetail/PixelMarkdown.ts', '技能详情正文里的链接与图片', ['sd.md.']],
  ['src/client/views/skillDetail/PixelSkillDetailModal.ts', '技能详情弹窗', ['sd.detail.']],
  ['src/client/views/skillDetail/PixelSkillRow.ts', '技能列表行', ['sd.skillrow.']],
  ['src/client/views/versionControl/VersionControlTab.ts', '版本管理页', ['vc.row.open.', 'vc.reload', 'vc.commit.back', 'vc.changes.back']],
  ['src/client/views/versionControl/vcAiHandoff.ts', '版本管理的 AI 交接', ['vc.ai.']],
  ['src/client/views/versionControl/vcViews.ts', '版本管理的三个页签', ['vc.tab.']],
  ['src/client/views/versionControl/vcWriteView.ts', '版本管理的写操作', ['vc.row.stage.', 'vc.viewbar.', 'vc.action.']],
  ['src/client/views/shared/ChainRenderer.ts', '工作流步骤', ['chain.action.', 'chain.form.']],
  ['src/client/views/shared/chips.ts', '兜底药丸', ['chip.fallback.']],
  ['src/client/views/shared/md.ts', '正文里的链接与图片', ['md.link.', 'md.overlay.', 'md.img.']],
  ['src/client/views/shared/RestFallbackBanner.ts', '兜底横幅', ['banner.restfallback.dismiss']],
  ['src/client/views/shared/SwitchConfirmModal.ts', '切换后端确认框', ['switch.']],
]
// E 组要数的文件：D 组清单（这些文件里每颗控件都该写 data-log）再加上列表主文件
// （它自己不带 data-log，但它也算这块界面的一部分，留着是为了让命名纪律扫到整片列表页）。
const COUNTED_FILES: string[] = MATRIX.map(([f]) => f).concat(['src/client/views/ListTab.ts'])
// 判据要读的全部文件（去重）：G 组的反例也在这同一批文本上改。
const AUDIT_FILES: string[] = Array.from(new Set(COUNTED_FILES.concat([
  // G 组的反例要动到这几份真源：构建清单、客户端入口、两个底座片、样式真源；
  // 入口浮层的卡（F29 读它挂的类名、焦点圈与悬停提亮，G 组反例也在这份文本上改）。
  'scripts/build.mts',
  'src/client/index.ts',
  'src/client/kernel/ui-feedback.ts',
  'src/client/views/shared/liquidInk.ts',
  'src/client/views/feedback/feedback-styles.ts',
  'src/client/views/cards/PixelCardsStyles.ts',
  // F30 数的两份像素皮肤都要在 base 里：针对技能皮肤去守卫的那条反例改的就是这份文件，
  // 它不在 base 里时反例等于删掉整份文件，只能靠「条数少于 5」兜底；卡片侧深色焦点规则拆成两条后
  // 卡片一家就有 5 条，兜底失效、反例白喂。进来之后反例才是真去守卫，F30 靠裸选择器报红。
  'src/client/views/skillDetail/PixelStyles.ts',
  'src/client/kernel/entry-choice.ts',
])))

// 把样式真源（字符串数组 + 行注释）还原成纯 CSS 文本：#1379 的 F30/F31 要按「规则」切分，
// 不能只对整份源码做 includes —— 那样改坏一条规则、另一条还在，判据照样绿着。
// 先剥注释再收单引号字面量：注释里的引号、花括号不参与判据，免得被自己写的说明文字带偏。
function cssTextOfSource(src: string): string {
  const noComments = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
  const lits: string[] = []
  // 样式叶子有两种写法：cards/feedback 用单引号，skillDetail 的 PixelStyles 用双引号。
  // 两种都要收：只认一种会把整份皮肤判成「零条规则」而静默漏检（#1377 评审现场踩过：F30 只数到 2 条）。
  const re = /'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g
  let m: any
  while ((m = re.exec(noComments))) lits.push(m[1] !== undefined ? m[1] : m[2])
  return lits.join('')
}

type AuditResult = { ok: boolean; msg: string }

// 把 A–F 六组判据写成一个纯函数：给一个「按路径读源码」的函数，交回逐条结果。
// 真实源码跑一遍（下面），G 组再把五种反例喂进同一个函数跑一遍 —— 判据只有这一份，
// 反例自证验的就是它，不许另写一份「专供自证」的宽松版本。
function audit(read: (p: string) => string): AuditResult[] {
  const out: AuditResult[] = []
  const check = (ok: any, msg: string) => { out.push({ ok: !!ok, msg: msg }) }
  const uiFeedback = read('src/client/kernel/ui-feedback.ts')
  const liquidInk = read('src/client/views/shared/liquidInk.ts')
  const feedbackCss = read('src/client/views/feedback/feedback-styles.ts')
  const indexSrc = read('src/client/index.ts')
  const buildSrc = read('scripts/build.mts')

  // ============ A 组：公共底座就这一个口 ============
  check(uiFeedback.indexOf("export const UI_PRESS_CLASS = 'dsws-pressing'") >= 0, 'A1 按压态只有一个类名真源（UI_PRESS_CLASS = dsws-pressing）')
  check(uiFeedback.indexOf("export const UI_PRESS_ATTR = 'data-press'") >= 0 && uiFeedback.indexOf("export const UI_LOG_ATTR = 'data-log'") >= 0, 'A2 控件只写两个属性：data-press（按压形状）与 data-log（点击定位）')
  check(uiFeedback.indexOf('export function installUiFeedback') >= 0, 'A3 委托在启动段装一次（installUiFeedback）')
  const dbgAt = uiFeedback.indexOf("isEnabled('debug')")
  const attrAt = uiFeedback.indexOf('logTargetOf(ev)')
  check(dbgAt >= 0 && attrAt > dbgAt, 'A4 调试开关关着时先早退、再读属性（不拼字段、不排队、零开销）')
  check(uiFeedback.indexOf("log('debug', 'ui.action', { target: target, kind: kind })") >= 0, 'A5 点击落定后写一条 ui.action（debug 级，字段只有 target / kind）')
  check(uiFeedback.indexOf('.toLowerCase()') >= 0, 'A6 定位串统一转小写（camelCase 枚举不会丢成残缺值）')
  check(uiFeedback.indexOf('for (let node = t; node && node.nodeType === 1; node = node.parentNode)') >= 0, 'A7 从事件目标往上找最近的控件（外层行与内层按钮各有各的 data-log，近的优先）')
  check(indexSrc.indexOf('// ==== kernel:uiFeedback (spliced by build) ====') >= 0 && indexSrc.indexOf('installUiFeedback()') >= 0, 'A8 客户端入口拼进这一片并在启动段调用一次')
  check(buildSrc.indexOf("file: 'src/client/kernel/ui-feedback.ts'") >= 0 && buildSrc.indexOf("file: 'src/client/views/shared/liquidInk.ts'") >= 0 && buildSrc.indexOf("file: 'src/client/views/listFilterRow.ts'") >= 0, 'A9 三个新片都登记进构建清单（不登记会静默不编译）')
  check(indexSrc.indexOf('// ==== leaf:liquidInk (spliced by build) ====') >= 0 && indexSrc.indexOf('// ==== leaf:listFilterRow (spliced by build) ====') >= 0, 'A10 两个新叶子的拼接标记都在入口里')
  check(uiFeedback.indexOf('const pressed = pressTargetOf(ev)') >= 0 && uiFeedback.indexOf('pressed.getAttribute(UI_PRESS_ATTR)') >= 0, 'A11 日志的形状取离事件目标最近的那颗带 data-press 的元素（形状标在日志元素外面时也要记对，例如调试开关的开关标在外层 label 上）')

  // ============ B 组：液态墨块怎么动、不许碰布局 ============
  check(liquidInk.indexOf("export const LIQUID_INK_CLASS = 'dsws-ink'") >= 0 && liquidInk.indexOf('export function useLiquidInk') >= 0 && liquidInk.indexOf('export function liquidInkRemember') >= 0, 'B1 墨块对外只有三件：类名常量、组件入口 useLiquidInk、点击记忆 liquidInkRemember')
  check(liquidInk.indexOf('getBoundingClientRect') < 0, 'B2 不用 getBoundingClientRect（只读 offset* 四个尺寸，避免测量相里触发额外重排）')
  check(liquidInk.indexOf("readPx(target, 'offsetLeft')") >= 0 && liquidInk.indexOf("readPx(target, 'offsetWidth')") >= 0, 'B3 对位读的是目标元素的 offset 尺寸（单次读，ADR 零抖动）')
  check(liquidInk.indexOf("setProperty('--dsws-ink-x'") >= 0 && liquidInk.indexOf("setProperty('--dsws-ink-w'") >= 0, 'B4 变更相只写墨块自己的 CSS 变量（--dsws-ink-x/y/w/h）')
  check(liquidInk.indexOf("const INK_INSTANT_CLASS = 'dsws-ink-instant'") >= 0, 'B5 第一次定位先禁过渡，墨块不从左上角飞进来')
  check(liquidInk.indexOf('ink.contains && ink.contains(t)') >= 0, 'B6 观察回调忽略墨块自身的变动（否则对位改样式会自己触发自己，整窗卡死）')
  check(liquidInk.indexOf("const group = (ink.getAttribute && ink.getAttribute('data-ink-group'))") >= 0, 'B7 一块墨块只盯一组（同一容器里可并排住状态/排序/标签三块）')
  check(feedbackCss.indexOf('.dsws-ink-host{position:relative}') >= 0 && feedbackCss.indexOf('.dsws-ink{position:absolute') >= 0, 'B8 墨块是一层绝对定位的底（容器补 position:relative）')
  check(feedbackCss.indexOf('transition:transform .24s linear(0,.55 30%,1.06 62%,.99 84%,1)') >= 0, 'B9 滑动带一点过冲（linear() 逐段曲线），落定回弹不靠动画库')
  check(feedbackCss.indexOf('.dsws-ink-host .dsws-tab.on{background:transparent') >= 0 && feedbackCss.indexOf('.dsws-ink-host [data-ink-cover="1"]{background:transparent!important') >= 0 && feedbackCss.indexOf('.dsws-ink-on{background:transparent') < 0, 'B10 墨块盖住的那一颗让出底色/描边，其余选中项保留（页签用 .on，药丸靠动态 data-ink-cover；若按 .dsws-ink-on 一刀切，多选标签组会把其余选中项的描边也吃掉）')
  check(liquidInk.indexOf("export const LIQUID_INK_COVER_ATTR = 'data-ink-cover'") >= 0 && liquidInk.indexOf('function markCovered') >= 0 && liquidInk.indexOf('setAttribute(LIQUID_INK_COVER_ATTR') >= 0 && liquidInk.indexOf('removeAttribute(LIQUID_INK_COVER_ATTR)') >= 0, 'B12 盖住标记由 liquidInk 动态标/摘（不是选中态标记，多选组里只盖一颗，避免双底又给其余选中项留描边）')
  check(feedbackCss.indexOf('.dsws-ink{position:absolute') < feedbackCss.indexOf('@media (prefers-reduced-motion: reduce){.dsws-ink'), 'B11 减少动态有降级：墨块仍在，只是不滑（不是整块消失）')
  check(feedbackCss.indexOf('@keyframes dsws-ink-squash{0%{scale:') >= 0 && feedbackCss.indexOf('.dsws-ink.dsws-ink-squash{animation:dsws-ink-squash') >= 0, 'B13 墨块换项时真的有拉伸回弹：形变走独立 scale 属性与 dsws-ink-squash 关键帧（scale 与 transform 是两个属性，不会互相顶掉）')
  check(liquidInk.indexOf("const INK_SQUASH_CLASS = 'dsws-ink-squash'") >= 0 && liquidInk.indexOf('ink.classList.remove(INK_SQUASH_CLASS)') >= 0 && liquidInk.indexOf('void ink.offsetWidth') >= 0 && liquidInk.indexOf('ink.classList.add(INK_SQUASH_CLASS)') >= 0, 'B14 换项时重播拉伸回弹（先摘类、强制一次重排、再挂上，动画才会重播）')
  check(liquidInk.indexOf('ResizeObserver') >= 0 && liquidInk.indexOf('ro.observe(') >= 0, 'B15 墨块跟着选项的尺寸走（选项自身变宽——换行、字体晚到——也要重新对位）')
  check(liquidInk.indexOf('if (host.classList.contains(LIQUID_INK_HOST_CLASS)) return') >= 0, 'B16 墨块宿主已经有那个类时直接返回（#1334 整窗卡死的复发守卫：加一个已经有的类也算一次 class 变更，观察器会自己触发自己）')
  check(liquidInk.indexOf('t.classList.contains(LIQUID_INK_CLASS)') >= 0, 'B17 观察回调连兄弟墨块也跳过（一个容器里住三块墨块时——列表页三组筛选就是这个形状——A 换项重播回弹会点燃 B、C，再反点燃 A，整窗卡死；单块墨块的页面测不出来）')
  check(liquidInk.indexOf("const sig = [targetKey, x, y, w, h, bg, bd, radius].join('|')") >= 0 && liquidInk.indexOf('ink.__dswsInkSig === sig') >= 0 && liquidInk.indexOf("ink.style.opacity === '1') return true") >= 0, 'B18 墨块原地不动就不重播：落点指纹（目标标识+位置+尺寸+底色描边圆角）没变时直接返回，不摘/挂拉伸回弹——悬停按下的类变化与兄弟墨块对位都会把观察器叫醒，每叫一次就弹一下，看起来就是「液态 tab 在抖动」')

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
  for (const [file, what, names] of MATRIX) {
    const src = read(file)
    const miss = names.filter((n) => src.indexOf(n) < 0)
    check(miss.length === 0, 'D ' + what + '（' + file.split('/').pop() + '）都有 data-log' + (miss.length ? '；缺：' + miss.join(', ') : ''))
  }

  // ============ E 组：日志定位串的命名纪律 ============
  const literals: string[] = []
  // 每个定位串住在哪些文件里：同文件多个渲染分支重复不算错，跨文件重名就是两颗控件共用一个名字。
  const homes: Record<string, string[]> = {}
  for (const f of COUNTED_FILES) {
    const src = read(f)
    const re = /'data-log':\s*'([^']+)'/g
    let m: any
    while ((m = re.exec(src))) {
      literals.push(m[1])
      if (!homes[m[1]]) homes[m[1]] = []
      if (homes[m[1]].indexOf(f) < 0) homes[m[1]].push(f)
    }
  }
  check(literals.length >= 50, 'E1 清单内接线的 data-log 字面量数量够（实际 ' + literals.length + ' 处）')
  const badName = literals.filter((n) => !/^[a-z0-9._-]+$/.test(n))
  check(badName.length === 0, 'E2 每个定位串都只含小写字母、数字、点、横线、下划线（与 ui-feedback 的限字符规则一致）' + (badName.length ? '；违规：' + badName.join(', ') : ''))
  const prefixCount: Record<string, number> = {}
  for (const n of literals) { const p = n.split('.').slice(0, 2).join('.'); prefixCount[p] = (prefixCount[p] || 0) + 1 }
  check(Object.keys(prefixCount).length >= 12, 'E3 定位串按界面分区成组（面板/头部/列表/地图/工单/设置），不是一锅汤（实际 ' + Object.keys(prefixCount).sort().join('、') + '）')
  const sharedNames = Object.keys(homes).filter((n) => homes[n].length > 1)
  check(sharedNames.length === 0, 'E4 定位串同屏唯一：同一个字面量只属于一颗控件（同文件多个渲染分支可重复，跨文件重名就是两颗控件共用一个名字）' + (sharedNames.length ? '；重名：' + sharedNames.map((n) => n + '←' + homes[n].join(' / ')).join(', ') : ''))

  // ============ F 组：悬停与按压的样式只有一套 ============
  check(feedbackCss.indexOf('.dsws-pressing{filter:brightness(.85)}') >= 0, 'F1 通用按压态：按下去整颗压暗一档（全清单共用）')
  check(feedbackCss.indexOf('@media (hover:hover) and (pointer:fine){.dsws-hov:hover') >= 0, 'F2 通用悬停态只对真鼠标生效（触屏不残留悬停样式）')
  check(feedbackCss.indexOf('.dsws-tab:hover:not(.on)') >= 0 && feedbackCss.indexOf('.dsws-ink-host .dsws-tab:hover:not(.dsws-pressing){filter:brightness(1.12)}') >= 0, 'F3 页签悬停：没选中的换底、选中的再提亮一档（五颗每一颗都有反馈）；按住的时候不再提亮，否则按下去反而变亮')
  check(feedbackCss.indexOf('[data-press].dsws-chip:hover:not(.dsws-pressing){filter:brightness(1.12)') >= 0, 'F4 可点的筛选药丸悬停有提亮与描边；按住的时候不再提亮')
  // 药丸里混着静态角标（地图详情的「地图」、状态章、label 章）：没有 data-press 就不是控件，
  //   一条悬停特效都不该有。悬停规则必须只认挂了 data-press 的那一颗，否则不可点的角标也会亮一下。
  const chipHoverSegs = feedbackCss.split('}').filter((s) => s.indexOf('.dsws-chip:hover') >= 0)
  const fakeChipHover = chipHoverSegs.filter((s) => s.indexOf('[data-press].dsws-chip:hover') < 0)
  check(chipHoverSegs.length >= 1 && fakeChipHover.length === 0, 'F13 药丸悬停只给带 data-press 的可点药丸：静态角标（地图、label、状态章）不再假悬停' + (fakeChipHover.length ? '；漏网：' + fakeChipHover.map((s) => s.trim().slice(-70)).join(' | ') : ''))
  check(feedbackCss.indexOf(':active') < 0, 'F8 反馈样式真源里没有 :active（按压一律走委托挂的 .dsws-pressing：:active 按住后把指针拖走会粘住，祖先元素还会跟着一起匹配）')
  const hoverFilterSegs = feedbackCss.split('}').filter((s) => s.indexOf(':hover') >= 0 && (s.indexOf('filter:') >= 0 || s.indexOf('brightness(') >= 0))
  const hoverNotExcluded = hoverFilterSegs.filter((s) => s.indexOf('.dsws-pressing') < 0)
  check(hoverFilterSegs.length >= 3 && hoverNotExcluded.length === 0, 'F9 凡是给悬停加亮度的规则都同时排除按压态（按住时不能反而变亮）' + (hoverNotExcluded.length ? '；漏网：' + hoverNotExcluded.map((s) => s.trim().slice(-60)).join(' | ') : ''))
  check(feedbackCss.indexOf('.dsws-node:hover{border-color:var(--dsws-ring-color,var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary') >= 0 && feedbackCss.indexOf('.dsws-node.dsws-pressing') >= 0, 'F5 地图工单卡整张卡悬停与按压都有，且悬停边框取主题主色（原来变灰白，跟「获得焦点」的语义对不上）')
  check(feedbackCss.indexOf('outline:var(--dsw-focus-ring-width,2px) solid var(--dsws-ring-color,var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary') >= 0 && feedbackCss.indexOf('outline-offset:-2px') >= 0, 'F6 键盘焦点环统一取 DSH 的焦点 token（--dsw-focus-ring-color，缺省回落主题主色），并往控件里面画（负 offset；外扩的环会被 overflow:hidden 的容器裁断）')
  // 焦点环颜色不许写死：写死 #58a6ff 换主题不跟，用户实测看到的「灰色 / 旧蓝」都是这类。
  const focusSegs = feedbackCss.split('}').filter((s) => s.indexOf(':focus-visible') >= 0)
  const hardFocusColor = focusSegs.filter((s) => s.indexOf('var(--dsw-focus-ring-color') < 0)
  check(focusSegs.length >= 1 && hardFocusColor.length === 0, 'F15 焦点环颜色不写死：一律取 --dsw-focus-ring-color（换主题跟着变）' + (hardFocusColor.length ? '；漏网：' + hardFocusColor.map((s) => s.trim().slice(-70)).join(' | ') : ''))
  check(feedbackCss.indexOf('[data-dsws-host] :focus-visible') >= 0, 'F14 焦点环覆盖停靠面板里所有可聚焦控件（含设置页输入框），不只手挂类的几颗')
  // 2026-10-21 用户实测追问：「所有获得焦点边框的灰色 应该都用当前主题里最应该表示获得焦点的那个 token——为什么没这么做？」
  //   上一轮只改了键盘焦点环与地图卡片边框，悬停高亮环还是 rgba(255,255,255,.16/.2/.28) 的白半透明（深色面板上就是灰的），
  //   按下确认圈也还是白 outline，悬停边框仍是 --dsw-alias-border-line 的灰。这一组断言把这三类全部钉到焦点 token 上。
  const ringSegs = feedbackCss.split('}').filter((s) => s.indexOf(':hover') >= 0 && s.indexOf('box-shadow:inset 0 0 0 1px') >= 0)
  const ringHard = ringSegs.filter((s) => s.indexOf('var(--dsw-focus-ring-color') < 0)
  check(ringSegs.length >= 2 && ringHard.length === 0, 'F16 悬停高亮环一律取主题焦点色（--dsw-focus-ring-color），不再写死白色半透明（深色面板上就是一圈灰）' + (ringHard.length ? '；漏网：' + ringHard.map((s) => s.trim().slice(-70)).join(' | ') : ''))
  const ringWhite = feedbackCss.split('}').filter((s) => s.indexOf('box-shadow:0 0 0 1px rgba(255,255,255') >= 0)
  check(ringWhite.length === 0, 'F16b 样式真源里没有白色半透明外圈描边残留' + (ringWhite.length ? '；漏网：' + ringWhite.map((s) => s.trim().slice(-70)).join(' | ') : ''))
  check(feedbackCss.indexOf('.dsws-btn:not(.primary):hover:not(.dsws-pressing),.dsws-seg:hover:not(.dsws-pressing)') >= 0 && feedbackCss.indexOf('{border-color:var(--dsws-ring-color,var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#58a6ff)))}') >= 0, 'F17 悬停时那圈原来是灰的边框（按钮、分段、配置按钮、地图行、工单行、列表行）统一换成主题焦点色')
  // 2026-10-21 用户实测追问：ISSUE 列表每一行的焦点/悬停框看着比别处淡，问是不是宽度不够。
  //   查下来整行的悬停高亮一直只是把行自带的 1px 透明边框换成主题色：整行面积大，一道 1px 细线就显淡。
  //   这里补一圈 1px 的内画阴影，与那 1px 边框接成 2px，和键盘焦点环同宽；行不提亮也不位移。
  check(feedbackCss.indexOf('.dsws-aggrow:hover:not(.dsws-pressing),.dsws-trow:hover:not(.dsws-pressing){box-shadow:inset 0 0 0 1px var(--dsws-ring-color') >= 0, 'F28 列表整行的悬停高亮加粗到 2px（1px 主题色边框 + 1px 内画环，与键盘焦点环同宽）：原来整行只有一道 1px 细线，用户实测说看着比别处淡一半')
  check(feedbackCss.indexOf('.dsws-btn.ghost.dsws-pressing{outline:2px solid var(--dsws-ring-color,var(--dsw-focus-ring-color') >= 0 && feedbackCss.indexOf('.dsws-fb-dark.dsws-pressing,.dsws-fb-dark.fb-pressed{outline:2px solid var(--dsws-ring-color,var(--dsw-focus-ring-color') >= 0, 'F18 按下时的确认圈也走主题焦点色（原来是一圈白 outline）')
  check(feedbackCss.indexOf('@keyframes dsws-ringout{0%{box-shadow:inset 0 0 0 0 var(--dsws-ring-color,var(--dsw-focus-ring-color') >= 0, 'F19 ghost 按下的确认光环颜色也取主题焦点色，不写死旧蓝')
  // 2026-10-21 用户逐处实测报「焦点圈被截断」：页签顶部、详情页顶栏按钮上下、状态栏胶囊左右。
  //   查下来被裁的都是**往外画**的圈（box-shadow 正扩散），容器一 overflow:hidden 就切掉露在外面的那截。
  //   修法是所有高亮环一律画在控件里面（inset），跟着控件自己的圆角走——下面两条断言钉住这件事。
  const outsideRing = feedbackCss.split('}').filter((s) => s.indexOf(':hover') >= 0 && /box-shadow:0 0 0 1px/.test(s))
  check(outsideRing.length === 0, 'F20 悬停高亮环画在控件里面（inset）：外画的圈会被页签行、详情页顶栏按钮组、状态栏胶囊外层这些 overflow:hidden 的容器裁掉头尾' + (outsideRing.length ? '；漏网：' + outsideRing.map((s) => s.trim().slice(-70)).join(' | ') : ''))
  check(feedbackCss.indexOf('@keyframes dsws-ringout{0%{box-shadow:inset 0 0 0 0') >= 0 && feedbackCss.indexOf('100%{box-shadow:inset 0 0 0 2px transparent}}') >= 0, 'F21 按下确认光环也画在控件里面：原来向外扩十二像素的那圈，在没有内边距的按钮组里会被上下切掉')
  // 2026-10-21 用户要求：状态栏胶囊与整条胶囊的焦点/悬停环「轻 50%」；交接那两颗小控件的轮廓要像
  //   「胶囊被竖着切一刀」的左右两半。前者靠在胶囊作用域里覆盖可继承的环色，后者靠两段各自的圆角。
  const capsuleTint = '.dsws-capsule{--dsws-ring-color:color-mix(in srgb,var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#58a6ff)) 50%,transparent)}'
  check(feedbackCss.indexOf(capsuleTint) >= 0, 'F22 状态栏胶囊里的环统一淡到五成：胶囊作用域把可继承的 --dsws-ring-color 设成焦点色掺一半透明，环的形状、粗细、位置都不变（用户要求「胶囊与整条胶囊的焦点效果轻 50%」）')
  // 环色只有一个入口：每一处焦点/悬停/按下环都先经过 --dsws-ring-color 这一层，胶囊里才减得淡；
  //   裸写焦点 token 的只允许剩下胶囊那条作用域声明（它本身就在算减半后的颜色）。
  const wrappedRing = feedbackCss.split('var(--dsws-ring-color,var(--dsw-focus-ring-color').length - 1
  const rawRing = feedbackCss.split('var(--dsw-focus-ring-color').length - 1
  check(wrappedRing >= 8 && rawRing - wrappedRing === 1, 'F23 焦点/悬停/按下的环色一律先经过 --dsws-ring-color（实际经手 ' + wrappedRing + ' 处、裸写 ' + (rawRing - wrappedRing) + ' 处）：否则胶囊里减不淡，别处也会各写各的颜色')
  const statusBarSrc = read('src/client/statusbar/StatusBar.ts')
  const rightHalfCount = (statusBarSrc.match(/'0 99px 99px 0'/g) || []).length
  check(statusBarSrc.indexOf("borderRadius: '99px 0 0 99px'") >= 0 && rightHalfCount >= 2 && statusBarSrc.indexOf("className: 'dsws-split-part dsws-hov'") >= 0 && statusBarSrc.indexOf("className: 'dsws-split-div'") >= 0, 'F24 交接那两颗小控件的高亮/焦点轮廓是「胶囊被竖着切一刀」：左段只圆左侧两个角、右段（就绪与未就绪两个分支都算）只圆右侧两个角，切口落在中间那颗分割线上，不是各占一半宽')
  // 2026-10-21 用户第二轮实测三条（m02402）：半胶囊左右不对称、整条胶囊自己的焦点效果该去掉、
  //   会话链那颗「定位图标 + #票号」的焦点圈是直角。下面三条分别钉住这三件事。
  // 1) 整条胶囊自身不再有环：不挂复盘用的 dsws-hov，焦点选择器与通用悬停规则都不认 .dsws-capsule；
  //    里面每颗子控件（胶囊字、分段药丸、交接两段、会话链、刷新、时间）照旧保留各自的环。
  check(feedbackCss.indexOf('.dsws-capsule:focus-visible') < 0 && feedbackCss.indexOf('[data-press]:not(.dsws-aggrow):not(.dsws-trow):not(.dsws-node):not(.dsws-capsule):not(.dsws-entrycard):hover') >= 0 && statusBarSrc.indexOf("className: 'dsws-capsule'") >= 0 && statusBarSrc.indexOf("className: 'dsws-capsule dsws-hov'") < 0, 'F25 整条胶囊自己的焦点环与悬停环都摘掉了（用户要求「胶囊状态栏的焦点效果可以去掉，内部胶囊的不用去」），里面每颗子控件保留各自的环；同一条选择器现在还排除入口浮层的卡，见 F29')
  // 2) 交接左右两半要一样高：左段有图标加「交接」两个字、右段只有一颗图标，按内容高度就对不齐；
  //    两段各自 align-self:stretch 撑满整行高度（左段一处、右段就绪与未就绪两分支各一处）。
  check(statusBarSrc.indexOf("borderRadius: '99px 0 0 99px', alignSelf: 'stretch'") >= 0 && (statusBarSrc.match(/borderRadius: '0 99px 99px 0', alignSelf: 'stretch'/g) || []).length >= 2, 'F26 交接左右两半撑满同一行高（左段与右段两个分支都写 alignSelf:stretch）：不然右段只有图标、比左段矮一截，半胶囊不对称')
  // 3) 会话链那颗「定位图标 + #票号」补了轻微圆角：环跟着元素自己的边界形状走，没圆角就是直角。
  const chainSrc = read('src/client/statusbar/SessionChainCapsule.ts')
  check(chainSrc.indexOf("cursor: 'pointer', borderRadius: 4 }") >= 0, 'F27 会话链那颗「定位图标 + #票号」补了轻微圆角（4px）：环跟着元素自己的边界形状走，没有圆角就是直角')
  check((feedbackCss.match(/prefers-reduced-motion/g) || []).length >= 4, 'F7 减少动态的降级覆盖到新效果（墨块、通用悬停、按压位移都关）')
  // 通用悬停与按下只按 data-press 属性给：2026-10-21 用户实测漏掉的那批控件（列表行内四颗按钮、
  //   地图/工单详情顶栏、地图底部动作区、父链接）全都是「属性接上了、悬停类忘了挂」。按属性给之后，
  //   以后新控件只要接线就不会再漏，这条断言就是那个契约。
  check(feedbackCss.indexOf('[data-press]:not(.dsws-aggrow):not(.dsws-trow):not(.dsws-node):not(.dsws-capsule):not(.dsws-entrycard):hover:not(.dsws-pressing){filter:brightness(1.14)') >= 0, 'F10 悬停反馈按 data-press 属性统一给（不再逐颗挂 dsws-hov；真鼠标媒体查询里，触屏不残留；整条胶囊自己除外，见 F25；入口浮层的卡也除外，见 F29）')
  check(feedbackCss.indexOf('[data-press]:not(.dsws-aggrow):not(.dsws-trow):not(.dsws-node).dsws-pressing{filter:brightness(.82)}') >= 0 && feedbackCss.indexOf('[data-press="button"].dsws-pressing,[data-press="link"].dsws-pressing,[data-press="switch"].dsws-pressing{transform:translateY(1px)}') >= 0, 'F11 按下反馈也按属性统一给：按钮/链接/开关压暗并下沉一像素，整行与整卡只压暗（整块下沉会把同行元素带着错位）')
  // 2026-10-22 用户实测（#1359）：入口浮层里悬停的那张卡，焦点圈与卡框之间透出一圈橘黄细线。
  //   根因是同一张卡上叠了两套环：它自己按焦点画一圈 2px outline（内联样式），通用悬停规则又按
  //   data-press="row" 给它画一圈 1px 主题色内画阴影；卡面 SVG 的边框从半像素起画、又是半透明的，
  //   第二圈就从边框底下透出来，正好落在 outlineOffset 留出的那道暗缝里，看着像多出的一条暖色线。
  //   修法照状态栏胶囊的先例（F25）：入口卡改挂专门的类 .dsws-entrycard、不再挂 dsws-hov，通用悬停
  //   规则把它排除；卡自己的焦点圈（内联 2px outline、offset 2）与悬停提亮（内联 filter）照旧。按下压暗
  //   另有一条只在入口卡上生效的规则：卡的内联 filter 会压过 F11 那条按 data-press 给的通用按压，
  //   不单独写一条 !important 规则就看不出按下。
  //   这条断言同时钉住四件事：样式侧要排除 .dsws-entrycard、按下压暗那条要在，卡侧要恰好只挂
  //   .dsws-entrycard，焦点圈与悬停提亮不能被删。
  const entryChoiceSrc = read('src/client/kernel/entry-choice.ts')
  // 卡侧注释里写着「不挂 dsws-hov」，先剥掉行注释再找类名，免得判据被自己的说明误伤。
  const entryChoiceCode = entryChoiceSrc.replace(/\/\/[^\n]*/g, '')
  check(feedbackCss.indexOf('[data-press]:not(.dsws-aggrow):not(.dsws-trow):not(.dsws-node):not(.dsws-capsule):not(.dsws-entrycard):hover:not(.dsws-pressing){filter:brightness(1.14)') >= 0 && feedbackCss.indexOf('.dsws-entrycard.dsws-pressing{filter:brightness(.82)!important}') >= 0 && entryChoiceCode.indexOf("className: 'dsws-entrycard'") >= 0 && entryChoiceCode.indexOf('dsws-hov') < 0 && entryChoiceSrc.indexOf("'data-press': 'row'") >= 0 && entryChoiceSrc.indexOf("'data-log': 'entry.card.'") >= 0 && entryChoiceSrc.indexOf("outline: focused ? '2px solid ' + accent : 'none'") >= 0 && entryChoiceSrc.indexOf('outlineOffset: 2') >= 0 && entryChoiceSrc.indexOf("filter: focused ? 'brightness(1.14)' : 'none'") >= 0, 'F29 入口浮层的整张卡不再被通用悬停规则多画一圈环（用户实测焦点圈与卡框之间透出一条橘黄细线）：只留它自己的 2px 焦点圈与悬停提亮，悬停规则与 dsws-hov 都不再命中它；按下时另有一条只在入口卡上生效的 !important 压暗规则（内联提亮会压过通用按压，不单独写就看不出按下；对照 F25 整条胶囊的同类做法）')
  check(feedbackCss.indexOf('[data-press].dsws-pressing{transform:none!important}') >= 0, 'F12 减少动态下按下的位移关掉、压暗保留（与规格「减少动态只关位移」一致）')
  // ============ F30/F31：浅色跟随（#1379） ============
  // 背景：两份像素皮肤（卡片、技能列表与详情）都写在反馈样式之后注入，它们那几条金虚线焦点规则
  //   原本深浅两套都命中，把「浅色跟随宿主焦点环」盖掉了。F30 钉住两份皮肤里的焦点规则只在深色下存在；
  //   F31 钉住浅色个例修复层的边界：只有一段、每条选择器都只在浅色命中、不许写死色值、只许改颜色类属性、
  //   引用的宿主令牌名与清单逐字一致（拼错一个字母浏览器就静默回落，颜色当场失效）。
  // 2026-10-22 #1377 评审：原来只扫卡片皮肤一份，技能皮肤里 .pixel-btn / .pixel-skillrow / .pixel-skillref /
  //   .pixel-chipref 的焦点规则还留在源码里，换一次注入次序就会复发。现在两份一起扫，含 :focus-within 也算。
  const FOCUS_SKIN_FILES = [
    'src/client/views/cards/PixelCardsStyles.ts',
    'src/client/views/skillDetail/PixelStyles.ts',
  ]
  // 深色守卫允许两种写法，两种都只在宿主挂了深色标记时命中，浅色一个字节都碰不到：
  //   body[data-ds-dark-theme] ...     —— 卡片皮肤用的，多一份 (0,1,0) 权重，金虚线因此在深色下胜出（今天就是这样）；
  //   :where(body[data-ds-dark-theme]) —— 技能皮肤用的，:where 不参与权重计算，选择器总权重与改动前一模一样，
  //     深色下「谁盖谁」不变（若写成前缀写法，像素按钮与技能行的金圈会反过来盖住宿主蓝环，probe 实测过）。
  const isDarkGuarded = (sel: string): boolean => sel.indexOf('body[data-ds-dark-theme] ') === 0 || sel.indexOf(':where(body[data-ds-dark-theme]) ') === 0
  // #1401 追加：卡片在浅色主题下也要有自己的焦点环（被挡卡整卡可点，键盘聚焦时要看得见），
  //   所以 F30 从「只许深色规则」放宽成「只许两种守卫之一」：深色守卫（金虚线）或浅色守卫。
  //   放宽有代价，必须同时钉住浅色规则的颜色来源：它只能取宿主焦点环令牌 --dsw-focus-ring-color，
  //   不许卡片皮肤自己挑颜色——否则「浅色跟随宿主焦点环」（#1379）又会从这条新规则漏回来。
  const isLightGuarded = (sel: string): boolean => sel.indexOf('body:not([data-ds-dark-theme]) ') === 0
  const focusRules: { file: string; sel: string; body: string }[] = []
  for (const skinFile of FOCUS_SKIN_FILES) {
    const skinCss = cssTextOfSource(read(skinFile))
    for (const r of (skinCss.match(/[^{}]+\{[^{}]*\}/g) || [])) {
      const body = r.slice(r.indexOf('{') + 1, r.lastIndexOf('}'))
      for (const part of r.slice(0, r.indexOf('{')).split(',')) {
        const t = part.trim()
        if (t && (t.indexOf(':focus-visible') >= 0 || t.indexOf(':focus-within') >= 0)) focusRules.push({ file: skinFile, sel: t, body: body })
      }
    }
  }
  const focusBare = focusRules.filter((one) => !isDarkGuarded(one.sel) && !isLightGuarded(one.sel))
  const lightFocusRules = focusRules.filter((one) => isLightGuarded(one.sel))
  const lightFocusBadColor = lightFocusRules.filter((one) => one.body.indexOf('var(--dsw-focus-ring-color') < 0)
  check(focusRules.length >= 5 && focusBare.length === 0 && lightFocusRules.length >= 2 && lightFocusBadColor.length === 0,
    'F30 两份像素皮肤的焦点规则都有主题守卫（' + focusRules.length + ' 条含 :focus-visible / :focus-within 的选择器：深色的带 body[data-ds-dark-theme] 或 :where(body[data-ds-dark-theme])，' +
    '浅色的 ' + lightFocusRules.length + ' 条带 body:not([data-ds-dark-theme])，没有裸选择器；浅色那几条的颜色一律取宿主焦点令牌 --dsw-focus-ring-color，皮肤只决定环的形状）' +
    (focusBare.length ? '；未加前缀：' + focusBare.map((one) => one.file + ' 的 ' + one.sel).join(' | ') : '') +
    (lightFocusBadColor.length ? '；浅色规则没取宿主焦点令牌：' + lightFocusBadColor.map((one) => one.file + ' 的 ' + one.sel).join(' | ') : ''))

  const LIGHT_START = '// #1379 浅色个例修复层（开始）'
  const LIGHT_END = '// #1379 浅色个例修复层（结束）'
  const lsAt = feedbackCss.indexOf(LIGHT_START)
  const leAt = feedbackCss.indexOf(LIGHT_END)
  const lightSingle = lsAt >= 0 && leAt > lsAt && feedbackCss.indexOf(LIGHT_START, lsAt + 1) < 0 && feedbackCss.indexOf(LIGHT_END, leAt + 1) < 0
  check(lightSingle, 'F31 浅色个例修复层只有一段（起止标记各出现一次）：两段叠在一起就说不清哪条规则管哪个元素，也没法逐条核对')
  const lightCss = lightSingle ? cssTextOfSource(feedbackCss.slice(lsAt + LIGHT_START.length, leAt)) : ''
  const lightRules = lightCss.match(/[^{}]+\{[^{}]*\}/g) || []
  const lightSels: string[] = []
  for (const r of lightRules) {
    for (const part of r.slice(0, r.indexOf('{')).split(',')) {
      const t = part.trim()
      if (t) lightSels.push(t)
    }
  }
  // 允许多写一条裸的 body:not([data-ds-dark-theme])：浅色层开头要用它声明几个可继承的派生色，
  //   选择器本身仍然只在浅色命中（只是没有后代），不算漏了前缀。
  const lightBare = lightSels.filter((sel) => sel.indexOf('body:not([data-ds-dark-theme]) ') !== 0 && sel !== 'body:not([data-ds-dark-theme])')
  check(lightRules.length >= 20 && lightBare.length === 0,
    'F31 浅色个例修复层每条选择器都只在浅色命中（' + lightRules.length + ' 条规则，全部以 body:not([data-ds-dark-theme]) 开头），且条数不少于实际修过的个例数（20）' +
    (lightBare.length ? '；漏了前缀：' + lightBare.join(' | ') : ''))
  const lightLiterals = lightCss.match(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\b(red|blue|green|orange|yellow|purple|pink|brown|black|white|gray|grey|gold|silver|teal|navy|maroon|olive|lime|aqua|cyan|magenta|fuchsia)\b/g) || []
  check(lightLiterals.length === 0,
    'F31 浅色个例修复层不许写死色值（一律走 --dsw-* 宿主变量或 color-mix 派生），换肤时才会跟着变' +
    (lightLiterals.length ? '；写死：' + Array.from(new Set(lightLiterals)).join('、') : ''))
  // 2026-10-22 #1377 评审：F31 原来只拦「写死色值」，令牌名写错拦不住——var(--dsw-alias-label-secondry)
  //   这种拼写错误，CSS 照样合法、浏览器静默回落成空值，浅色下那几个字又看不见了。
  //   这里把浅色层用到的 --dsw-alias-* 名字全部收出来，与清单逐字比对：多一个、少一个都红。
  //   清单就是今天实际用到的宿主令牌，去重排序；新加令牌要同时改这里，等于把「引用了哪个宿主语义」写进账。
  const LIGHT_HOST_TOKENS = [
    '--dsw-alias-label-primary',
    '--dsw-alias-label-primary-foreground',
    '--dsw-alias-label-secondary',
    '--dsw-alias-link',
    '--dsw-alias-state-business-tertiary',
    '--dsw-alias-state-error-primary',
    '--dsw-alias-state-success-primary',
    '--dsw-alias-state-warn-label',
  ]
  const lightTokens = Array.from(new Set((lightCss.match(/var\((--dsw-alias-[a-z0-9-]+)/g) || []).map((one) => one.slice(4)))).sort()
  const extraTokens = lightTokens.filter((one) => LIGHT_HOST_TOKENS.indexOf(one) < 0)
  const missingTokens = LIGHT_HOST_TOKENS.filter((one) => lightTokens.indexOf(one) < 0)
  check(extraTokens.length === 0 && missingTokens.length === 0,
    'F31 浅色层引用的宿主令牌名与清单逐字一致（' + lightTokens.length + ' 个）：拼错一个字母浏览器就静默回落，颜色当场失效' +
    (extraTokens.length ? '；多出：' + extraTokens.join('、') : '') +
    (missingTokens.length ? '；少了：' + missingTokens.join('、') : ''))
  const LIGHT_PROPS = new Set(['color', 'background', 'background-color', 'border-color', 'fill', 'stroke', 'box-shadow'])
  const lightBadProps: string[] = []
  for (const r of lightRules) {
    const body = r.slice(r.indexOf('{') + 1, r.lastIndexOf('}'))
    for (const d of body.split(';')) {
      const p = d.split(':')[0].trim().toLowerCase()
      // 自定义属性（名字以 -- 开头）是浅色层内部共用的派生色，不是尺寸、间距或布局，放行。
      if (p && !LIGHT_PROPS.has(p) && p.indexOf('--') !== 0) lightBadProps.push(p)
    }
  }
  check(lightBadProps.length === 0,
    'F31 浅色个例修复层只改颜色类属性（color/background/border-color/fill/stroke/box-shadow），不改尺寸、间距、布局' +
    (lightBadProps.length ? '；越界属性：' + Array.from(new Set(lightBadProps)).join('、') : ''))

  // ============ F32：十四处浅色个例必须「组件挂标记、样式认标记」两头对齐（#1379 收口，#1388 加八处） ============
  // 为什么加这一条：浅色覆盖层全靠选择器命中组件里的类名或 data 属性。选择器写错一个字符，CSS 照样合法、
  //   整份样式也不会报错，只是浅色下那几个字又回到看不清；反过来，组件里的标记被删掉，规则还在、却再也命不中，
  //   门禁同样绿着。这种「规则在、标记没挂」或「标记在、规则漏了」的漂移，只能由一条同时读组件源码与样式层的
  //   断言钉住：每处写清三样东西 —— 组件里必须出现的标记、浅色层里必须出现的完整选择器（连前缀一起写死，
  //   前缀被摘也会红）、以及给人看的界面名（报错时能直接指到哪一处）。
  // 有的个例横跨多份组件源码（多行提示浮层的 Tip 调用点就有三个文件），所以除了主 file/marks，
  // 还可以用 moreMarks 补上别处该出现的标记（文件、标记成对写）。
  const LIGHT_CASES: { what: string; file: string; marks: string[]; moreMarks?: [string, string][]; sels: string[] }[] = [
    {
      what: '票详情顶部错误横幅正文与「显示快照降级」小字',
      file: 'src/client/views/IssueDetail.ts',
      marks: ["className: 'dsws-detail-err'", "className: 'dsws-detail-err-degraded'"],
      sels: ['body:not([data-ds-dark-theme]) .dsws-detail-err{', 'body:not([data-ds-dark-theme]) .dsws-detail-err-degraded{'],
    },
    {
      what: '已关闭列表的「未完成 / 游标失效 / 取不到」提示文字',
      file: 'src/client/views/ListTabClosed.ts',
      marks: ["className: 'dsws-closed-note'", "'data-state': 'warn'", "'data-state': 'bad'"],
      sels: ['body:not([data-ds-dark-theme]) .dsws-closed-note[data-state="warn"]{', 'body:not([data-ds-dark-theme]) .dsws-closed-note[data-state="bad"]{'],
    },
    {
      what: '拉取请求页签的三种状态字（打开 / 已关闭 / 已合并）',
      file: 'src/client/views/PrTab.ts',
      marks: ["'data-state': prStateKind(x)", "className: 'dsws-chip dsws-pr-state'"],
      sels: [
        'body:not([data-ds-dark-theme]) .dsws-aggrow[data-state="open"] .dsws-idnum,',
        'body:not([data-ds-dark-theme]) .dsws-aggrow[data-state="open"] .dsws-pr-state{',
        'body:not([data-ds-dark-theme]) .dsws-aggrow[data-state="closed"] .dsws-idnum,',
        'body:not([data-ds-dark-theme]) .dsws-aggrow[data-state="closed"] .dsws-pr-state{',
        'body:not([data-ds-dark-theme]) .dsws-aggrow[data-state="merged"] .dsws-idnum,',
        'body:not([data-ds-dark-theme]) .dsws-aggrow[data-state="merged"] .dsws-pr-state{',
      ],
    },
    {
      what: '无仓库提示卡的语义图标（罗盘 / 警告三角）',
      file: 'src/client/views/NoRepoCard.ts',
      marks: ["'data-state': 'pending'", "'data-state': 'other'", "'data-state': 'bad'"],
      sels: ['body:not([data-ds-dark-theme]) .dsws-no-repo-card[data-state="other"]>.head>svg{', 'body:not([data-ds-dark-theme]) .dsws-no-repo-card[data-state="bad"]>.head>svg{'],
    },
    {
      what: '环境检查页签每条检查项的状态字与状态圆点',
      file: 'src/client/views/ChecksTab.ts',
      marks: ["'data-state': meta.state", "className: 'dsws-ccard-dot'"],
      sels: [
        'body:not([data-ds-dark-theme]) .dsws-ccard[data-state="done"] .nm{',
        'body:not([data-ds-dark-theme]) .dsws-ccard[data-state="current"] .nm{',
        'body:not([data-ds-dark-theme]) .dsws-ccard[data-state="fail"] .nm{',
        'body:not([data-ds-dark-theme]) .dsws-ccard[data-state="pending"] .nm{',
        'body:not([data-ds-dark-theme]) .dsws-ccard[data-state="current"] .dsws-ccard-dot{',
      ],
    },
    {
      what: '多行提示浮层（地图详情头、票详情、环境检查）的第一行小标签与第二行标题',
      file: 'src/client/views/MapDetailHead.ts',
      marks: ["className: 'dsws-tip'"],
      moreMarks: [
        ['src/client/views/IssueDetail.ts', "className: 'dsws-tip'"],
        ['src/client/views/ChecksTab.ts', "className: 'dsws-tip'"],
      ],
      sels: [
        'body:not([data-ds-dark-theme]) .dsws-tip>div>div:first-child{',
        'body:not([data-ds-dark-theme]) .dsws-tip>div>div:nth-child(2){',
      ],
    },
    {
      what: '环境检查页顶的后端徽标',
      file: 'src/client/views/ChecksTab.ts',
      marks: ["className: 'dsws-env-badge'"],
      sels: ['body:not([data-ds-dark-theme]) .dsws-env-badge{'],
    },
    {
      what: '环境检查页的检测中提示',
      file: 'src/client/views/ChecksTab.ts',
      marks: ["className: 'dsws-env-detecting'"],
      sels: ['body:not([data-ds-dark-theme]) .dsws-env-detecting{'],
    },
    {
      what: '表单字段预览行',
      file: 'src/client/kernel/modal-fields.ts',
      marks: ["className: 'dsws-modal-preview'"],
      sels: ['body:not([data-ds-dark-theme]) .dsws-modal-preview{'],
    },
    {
      what: '横幅坏态的字色',
      file: 'src/client/kernel/styles.ts',
      marks: ["'.dsws-banner.bad{"],
      sels: ['body:not([data-ds-dark-theme]) .dsws-banner.bad{'],
    },
    {
      what: '版本控制页的弱说明字（令牌 --vc-faint）',
      file: 'src/client/views/versionControl/vcStyles.ts',
      marks: ['--vc-faint:'],
      sels: ['body:not([data-ds-dark-theme]) [data-vc-root]{'],
    },
    {
      what: '票卡片彩色标签的罩纱（白字深字都到不了 4.5 的底）',
      file: 'src/client/views/cards/PixelCardTags.ts',
      marks: ['data-cd-boost'],
      sels: ['body:not([data-ds-dark-theme]) .cd-chip[data-cd-boost="1"]{'],
    },
    {
      what: '票卡片彩色动作按钮的罩纱',
      file: 'src/client/views/cards/PixelCardBtns.ts',
      marks: ['data-cd-boost'],
      sels: ['body:not([data-ds-dark-theme]) .cd-abtn[data-cd-boost="1"]{'],
    },
    {
      what: '票卡片票号徽标实心款的罩纱',
      file: 'src/client/views/cards/PixelCardNo.ts',
      marks: ['data-cd-boost'],
      sels: ['body:not([data-ds-dark-theme]) .cd-nonum[data-cd-boost="1"]{'],
    },
  ]
  const lightCaseReds: string[] = []
  for (const c of LIGHT_CASES) {
    const src = read(c.file)
    if (!src) { lightCaseReds.push(c.what + '：读不到组件源码 ' + c.file); continue }
    for (const mk of c.marks) { if (src.indexOf(mk) < 0) lightCaseReds.push(c.what + '：组件里没挂标记 ' + mk) }
    for (const [moreFile, moreMark] of (c.moreMarks || [])) {
      const moreSrc = read(moreFile)
      if (!moreSrc) { lightCaseReds.push(c.what + '：读不到组件源码 ' + moreFile); continue }
      if (moreSrc.indexOf(moreMark) < 0) lightCaseReds.push(c.what + '：组件里没挂标记 ' + moreMark + '（' + moreFile + '）')
    }
    for (const sel of c.sels) { if (lightCss.indexOf(sel) < 0) lightCaseReds.push(c.what + '：浅色层里没有这条规则 ' + sel) }
  }
  check(LIGHT_CASES.length === 14 && lightCaseReds.length === 0,
    'F32 十四处浅色个例两头对齐：组件里挂着稳定标记（类名或 data-state），浅色层里有一条带 body:not([data-ds-dark-theme]) 前缀、专认这个标记的规则（' + LIGHT_CASES.length + ' 处；只改一头就红）' +
    (lightCaseReds.length ? '；对不上：' + lightCaseReds.join('；') : ''))
  for (const [file, label] of [['src/client/panel/Dock.ts', '头部 chip/切后端/刷新'], ['src/client/views/shared/Tabs.ts', '新建需求/+bug'], ['src/client/views/labels/LabelColorEntry.ts', '调色板'], ['src/client/views/shared/workRouteTable.ts', '在办表'], ['src/client/views/SettingsPage.ts', '设置页 star/issue/插件行'], ['src/client/views/SettingsWorkspaces.ts', '工作区刷新与展开'], ['src/client/views/IssueDetail.ts', '父链接与被阻塞行']] as [string, string][]) {
    check(read(file).indexOf('dsws-hov') >= 0, 'F ' + label + ' 用同一套甩停样式（dsws-hov），不各写一份')
  }

  // ============ H 组：全仓兜底 —— 有可点痕迹却没有接线的文件，一颗都不许剩 ============
  // 这一组扫的是 src/client 下全部源文件，不是清单里那十几片：清单只保证「写进去的都合格」，
  // 全仓扫描才保证「没写进去的也被揪出来」。判据只有两条：能点却没有日志接线、日志名字跨文件撞车。
  const CLICKABLE = /onClick|href:|h\('summary'|role:\s*'button'/
  const unwired: string[] = []
  const dupHomes: Record<string, string[]> = {}
  const allLogs: string[] = []
  for (const f of CLIENT_FILES) {
    // 类型声明文件只是描述控件长什么样，不是控件本身；跳过。
    if (f.endsWith('.d.ts')) continue
    const src = read(f)
    if (!src) continue
    // 注释里提到 onClick 不算这里有可点控件，先把注释去掉再判断。
    const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    const re = /'data-log':\s*'([^']+)'/g
    let m: any
    let n = 0
    while ((m = re.exec(src))) { n++; allLogs.push(m[1]); (dupHomes[m[1]] = dupHomes[m[1]] || []).push(f) }
    // 「这颗控件接了线」看的是属性在不在，而不是有没有写死成一个字符串：
    // 有些控件的名字是按参数拼出来的（例如状态栏的分段按钮 seg(...) 由调用方给标识），
    // 那种写法接了线但扫不到字面量，判据要认它接了，不该把它算成漏网。
    const hasLog = code.indexOf("'data-log'") >= 0
    const hasPress = code.indexOf("'data-press'") >= 0
    if (hasLog && !hasPress) unwired.push(f + '（有 data-log，没有 data-press）')
    if (!hasLog && CLICKABLE.test(code)) unwired.push(f)
  }
  check(unwired.length === 0, 'H1 全仓客户端没有「能点却一颗都没接线」的文件，也没有「记了日志却没有按压形状」的文件' + (unwired.length ? '；漏网：' + unwired.join('、') : ''))
  // 按压态一律走委托挂的 .dsws-pressing，不许有 CSS 的 :active 漏在别处：
  // :active 按住后把指针拖走会粘住，祖先元素还会跟着一起匹配，用户的「按下去像没按」就是这么来的。
  const activeLeaks: string[] = []
  for (const f of CLIENT_FILES) {
    if (f.endsWith('.d.ts')) continue
    const src = read(f)
    if (!src) continue
    const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    if (code.indexOf(':active') >= 0) activeLeaks.push(f)
  }
  check(activeLeaks.length === 0, 'H4 全仓客户端没有 CSS 的 :active（按压一律走委托挂的 .dsws-pressing）' + (activeLeaks.length ? '；漏网：' + activeLeaks.join('、') : ''))
  const dupAll = Object.keys(dupHomes).filter((k) => Array.from(new Set(dupHomes[k])).length > 1)
  check(dupAll.length === 0, 'H2 全仓 data-log 跨文件唯一（同一个字面量不能属于两颗控件）' + (dupAll.length ? '；重名：' + dupAll.map((k) => k + '←' + Array.from(new Set(dupHomes[k])).join('/')).join('、') : ''))
  const badShape = allLogs.filter((x) => !/^[a-z0-9._-]+$/.test(x))
  check(badShape.length === 0, 'H3 全仓 data-log 只含小写字母、数字、点、横线、下划线' + (badShape.length ? '；违规：' + badShape.join('、') : ''))
  return out
}

// ============ 真实源码：A–F 六组逐条验 ============
for (const r of audit(sourceText)) check(r.ok, r.msg)

// ============ G 组：判据自证（八种反例各喂一次，预期那一组必须报红） ============
// 反例只在内存里改文本：真实文件一个字都不动，门禁跑完源码与跑之前一样。
const base: Record<string, string> = {}
for (const f of AUDIT_FILES) base[f] = sourceText(f)
type Variant = { label: string; file: string; group: string; change: (s: string) => string }
// 反例要改的文本常常出现不止一处（同一份规则写了两遍），所以替换要全部换掉，
// 否则第一处换掉了、第二处还在，判据照样绿着，反例就白喂了。
const replaceAll = (s: string, from: string, to: string): string => s.split(from).join(to)
const variants: Variant[] = [
  {
    label: '漏接线：页签少了 +bug 的点击日志',
    file: 'src/client/views/shared/Tabs.ts',
    group: 'D ',
    change: (s) => s.replace("'data-log': 'panel.newbug'", ''),
  },
  {
    label: '命名重复：同一个定位串被抄进第二个文件',
    file: 'src/client/panel/Dock.ts',
    group: 'E4',
    // 把工单详情顶栏「返回列表」的定位串再抄一份到头部 —— 两颗控件共用一个名字。
    change: (s) => s + "\n// 反例：同一个定位串被抄到第二处\nconst fakeDup = { 'data-log': 'issue.top.back' }\n",
  },
  {
    label: '大写混入：新加的定位串带了大小写',
    file: 'src/client/views/shared/Tabs.ts',
    group: 'E2',
    change: (s) => s + "\n// 反例：定位串里混了大写\nconst fakeUpper = { 'data-log': 'panel.BadBug' }\n",
  },
  {
    label: '另写一套样式：通用按压态被换成了自己的一档',
    file: 'src/client/views/feedback/feedback-styles.ts',
    group: 'F1',
    change: (s) => replaceAll(s, '.dsws-pressing{filter:brightness(.85)}', '.dsws-pressing{opacity:.7}'),
  },
  {
    label: '日志少一条：点击落定那一行被删掉了',
    file: 'src/client/kernel/ui-feedback.ts',
    group: 'A5',
    change: (s) => s.replace("log('debug', 'ui.action', { target: target, kind: kind })", ''),
  },
  {
    label: '选中项重新露出底色形成双底：盖住的让位规则被删掉',
    file: 'src/client/views/feedback/feedback-styles.ts',
    group: 'B10',
    change: (s) => s.replace('.dsws-ink-host [data-ink-cover="1"]{background:transparent!important;border-color:transparent!important}', ''),
  },
  {
    label: '墨块对位改成读会触发布局的尺寸接口',
    file: 'src/client/views/shared/liquidInk.ts',
    group: 'B2',
    change: (s) => s + "\n// 反例：对位改用会触发额外重排的尺寸接口\nconst fakeRect = function (el: any) { return el.getBoundingClientRect() }\n",
  },
  {
    label: '新叶子只加源码不登记构建清单',
    file: 'scripts/build.mts',
    group: 'A9',
    change: (s) => s.replace("file: 'src/client/views/shared/liquidInk.ts'", ''),
  },
  {
    label: '墨块的拉伸回弹被删了：只剩位移，没有形变',
    file: 'src/client/views/feedback/feedback-styles.ts',
    group: 'B13',
    change: (s) => replaceAll(s, '@keyframes dsws-ink-squash{0%{scale:1.05 .94}55%{scale:1.015 .985}100%{scale:1 1}}', ''),
  },
  {
    label: '墨块宿主的早退守卫被删了：#1334 那条环路会复发',
    file: 'src/client/views/shared/liquidInk.ts',
    group: 'B16',
    change: (s) => s.replace('if (host.classList.contains(LIQUID_INK_HOST_CLASS)) return', ''),
  },
  {
    label: '兄弟墨块的跳过守卫被删了：一个容器里三块墨块会互相点燃，整窗卡死',
    file: 'src/client/views/shared/liquidInk.ts',
    group: 'B17',
    change: (s) => s.replace('if (t && t.nodeType === 1 && t.classList && t.classList.contains(LIQUID_INK_CLASS)) continue', ''),
  },
  {
    label: '墨块的尺寸监听被删了：选项变宽时墨块停在旧位置',
    file: 'src/client/views/shared/liquidInk.ts',
    group: 'B15',
    change: (s) => replaceAll(s, 'ResizeObserver', 'ResizeWatcher'),
  },
  {
    label: '悬停规则不再排除按压态：按住的时候反而变亮',
    file: 'src/client/views/feedback/feedback-styles.ts',
    group: 'F9',
    change: (s) => replaceAll(s, ':hover:not(.dsws-pressing)', ':hover'),
  },
  {
    label: '日志形状不再取最近的按压元素：调试开关那类会记成 other',
    file: 'src/client/kernel/ui-feedback.ts',
    group: 'A11',
    change: (s) => s.replace('const pressed = pressTargetOf(ev)', 'const pressed = null'),
  },
  {
    label: '整片界面的接线被抹掉：能点却一颗日志都不记',
    file: 'src/client/views/IssueDetail.ts',
    group: 'H1',
    // 把这一片里所有 data-log 属性都改名，文件照样能点，却再也认不出点了哪一颗。
    change: (s) => replaceAll(s, "'data-log': ", "'data-log-off': "),
  },
  {
    label: '别处又写了一份 CSS 的 :active：按住后拖走指针会粘住',
    file: 'src/client/views/shared/Tabs.ts',
    group: 'H4',
    change: (s) => s + "\n// 反例：又用上了 CSS 的 :active\nconst fakeActive = '.dsws-tab:active{filter:brightness(.9)}'\n",
  },
  {
    label: '墨块的同位置守卫被删了：静止的墨块每按一下都弹一次（液态 tab 抖动）',
    file: 'src/client/views/shared/liquidInk.ts',
    group: 'B18',
    change: (s) => s.replace("if (ink.__dswsInkPlaced && ink.__dswsInkSig === sig && ink.style.opacity === '1') return true", ''),
  },
  {
    label: '通用悬停不再按 data-press 属性给：新控件又得逐颗挂类，漏一颗就没反馈',
    file: 'src/client/views/feedback/feedback-styles.ts',
    group: 'F10',
    change: (s) => s.replace("@media (hover:hover) and (pointer:fine){[data-press]:not(.dsws-aggrow):not(.dsws-trow):not(.dsws-node):not(.dsws-capsule):not(.dsws-entrycard):hover:not(.dsws-pressing){filter:brightness(1.14);box-shadow:inset 0 0 0 1px var(--dsws-ring-color,var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#58a6ff))),0 2px 10px rgba(0,0,0,.3)}}", ''),
  },
  {
    label: '静态角标又有假悬停：药丸悬停规则不再只认 data-press',
    file: 'src/client/views/feedback/feedback-styles.ts',
    group: 'F13',
    change: (s) => replaceAll(s, '[data-press].dsws-chip:hover:not(.dsws-pressing)', '.dsws-chip:hover:not(.dsws-pressing)'),
  },
  {
    label: '焦点环又往外画：页签与按钮组的上下圈被 overflow:hidden 的容器裁断',
    file: 'src/client/views/feedback/feedback-styles.ts',
    group: 'F6',
    change: (s) => replaceAll(s, 'outline-offset:-2px', 'outline-offset:2px'),
  },
  {
    label: '焦点环颜色写死成旧蓝：换主题不跟',
    file: 'src/client/views/feedback/feedback-styles.ts',
    group: 'F15',
    change: (s) => replaceAll(s, 'outline:var(--dsw-focus-ring-width,2px) solid var(--dsws-ring-color,var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#58a6ff)));outline-offset:-2px', 'outline:2px solid #58a6ff;outline-offset:-2px'),
  },
  {
    label: '地图卡片悬停边框又变回灰白：跟主题主色对不上',
    file: 'src/client/views/feedback/feedback-styles.ts',
    group: 'F5',
    change: (s) => replaceAll(s, 'border-color:var(--dsws-ring-color,var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#58a6ff)))!important', 'border-color:rgba(255,255,255,.28)!important'),
  },
  {
    label: '悬停高亮环又变回白色半透明：深色面板上就是一圈灰，换主题也不跟',
    file: 'src/client/views/feedback/feedback-styles.ts',
    group: 'F16',
    change: (s) => replaceAll(s, 'box-shadow:inset 0 0 0 1px var(--dsws-ring-color,var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#58a6ff)))}}', 'box-shadow:0 0 0 1px rgba(255,255,255,.16)}}'),
  },
  {
    label: '悬停灰边框没换成焦点色：按钮、分段、配置按钮、地图行、工单行、列表行的悬停边框又变回灰色',
    file: 'src/client/views/feedback/feedback-styles.ts',
    group: 'F17',
    change: (s) => s.replace('.dsws-btn:not(.primary):hover:not(.dsws-pressing),', ''),
  },
  {
    label: '按下确认圈又变回一圈白：不跟主题焦点色',
    file: 'src/client/views/feedback/feedback-styles.ts',
    group: 'F18',
    change: (s) => replaceAll(s, 'outline:2px solid var(--dsws-ring-color,var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#58a6ff)));outline-offset:-2px', 'outline:2px solid rgba(255,255,255,.55);outline-offset:1px'),
  },
  {
    label: 'ghost 按下的外扩环颜色又写死成旧蓝：换主题不跟',
    file: 'src/client/views/feedback/feedback-styles.ts',
    group: 'F19',
    change: (s) => replaceAll(s, '0%{box-shadow:inset 0 0 0 0 var(--dsws-ring-color,var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#58a6ff)))}', '0%{box-shadow:0 0 0 0 rgba(88,166,255,.7)}'),
  },
  {
    label: '悬停高亮环又往外画：页签顶部、详情页顶栏按钮的上下圈又被 overflow:hidden 的容器裁断',
    file: 'src/client/views/feedback/feedback-styles.ts',
    group: 'F20',
    change: (s) => replaceAll(s, 'box-shadow:inset 0 0 0 1px var(--dsws-ring-color,var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#58a6ff))),0 2px 10px rgba(0,0,0,.25)', 'box-shadow:0 0 0 1px var(--dsws-ring-color,var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#58a6ff))),0 2px 10px rgba(0,0,0,.25)'),
  },
  {
    label: '胶囊里的环没有淡到五成：胶囊作用域不再覆盖可继承的环色',
    file: 'src/client/views/feedback/feedback-styles.ts',
    group: 'F22',
    change: (s) => s.replace('.dsws-capsule{--dsws-ring-color:color-mix(in srgb,var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#58a6ff)) 50%,transparent)}', ''),
  },
  {
    label: '环色绕过了可继承的那一层：胶囊里减不淡',
    file: 'src/client/views/feedback/feedback-styles.ts',
    group: 'F23',
    change: (s) => s + "\n// 反例：环色直接写焦点 token，不经过 --dsws-ring-color\nconst fakeRing = '.dsws-fake:hover{box-shadow:inset 0 0 0 1px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#58a6ff))}'\n",
  },
  {
    label: '交接两段又变回整块直角：半胶囊轮廓没了',
    file: 'src/client/statusbar/StatusBar.ts',
    group: 'F24',
    change: (s) => replaceAll(replaceAll(s, "borderRadius: '99px 0 0 99px'", ''), "borderRadius: '0 99px 99px 0'", ''),
  },
  {
    label: '整条胶囊的假悬停又回来了：通用悬停规则不再排除 .dsws-capsule',
    file: 'src/client/views/feedback/feedback-styles.ts',
    group: 'F25',
    change: (s) => replaceAll(s, ':not(.dsws-capsule):not(.dsws-entrycard):hover', ':not(.dsws-entrycard):hover'),
  },
  {
    label: '整条胶囊又挂回 dsws-hov：鼠标扫过整条外框都亮一圈',
    file: 'src/client/statusbar/StatusBar.ts',
    group: 'F25',
    change: (s) => replaceAll(s, "className: 'dsws-capsule'", "className: 'dsws-capsule dsws-hov'"),
  },
  {
    label: '入口卡又被通用悬停规则多画一圈环：焦点圈与卡框之间那圈橘黄细线回来了',
    file: 'src/client/views/feedback/feedback-styles.ts',
    group: 'F29',
    change: (s) => replaceAll(s, ':not(.dsws-capsule):not(.dsws-entrycard):hover', ':not(.dsws-capsule):hover'),
  },
  {
    label: '入口卡又挂回 dsws-hov：悬停时整张卡又被多画一圈环',
    file: 'src/client/kernel/entry-choice.ts',
    group: 'F29',
    change: (s) => replaceAll(s, "className: 'dsws-entrycard'", "className: 'dsws-entrycard dsws-hov'"),
  },
  {
    label: '入口卡自己的焦点圈被删了：悬停时连它自己那一圈环都没有',
    file: 'src/client/kernel/entry-choice.ts',
    group: 'F29',
    change: (s) => replaceAll(s, "outline: focused ? '2px solid ' + accent : 'none',", ''),
  },
  {
    label: '入口卡按下又没反馈了：内联提亮压过通用按压规则，按下时卡面纹丝不动',
    file: 'src/client/views/feedback/feedback-styles.ts',
    group: 'F29',
    change: (s) => replaceAll(s, '.dsws-entrycard.dsws-pressing{filter:brightness(.82)!important}', ''),
  },
  {
    label: '交接两段又没撑满整行高度：右段比左段矮，半胶囊不对称',
    file: 'src/client/statusbar/StatusBar.ts',
    group: 'F26',
    change: (s) => replaceAll(s, ", alignSelf: 'stretch'", ''),
  },
  {
    label: '会话链胶囊的圆角被删了：焦点圈又变回直角',
    file: 'src/client/statusbar/SessionChainCapsule.ts',
    group: 'F27',
    change: (s) => replaceAll(s, "cursor: 'pointer', borderRadius: 4 }", "cursor: 'pointer' }"),
  },
  {
    label: '列表整行的悬停环又变回 1px：整行一大片面积上只剩一道细线，看着比别处淡',
    file: 'src/client/views/feedback/feedback-styles.ts',
    group: 'F28',
    change: (s) => replaceAll(s, '.dsws-aggrow:hover:not(.dsws-pressing),.dsws-trow:hover:not(.dsws-pressing){box-shadow:inset 0 0 0 1px var(--dsws-ring-color,var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#58a6ff)))}', ''),
  },
  {
    label: '卡片皮肤那两条焦点规则的深色前缀被摘掉：浅色下卡片焦点环又变回金虚线，不再跟随宿主蓝',
    file: 'src/client/views/cards/PixelCardsStyles.ts',
    group: 'F30',
    change: (s) => replaceAll(s, 'body[data-ds-dark-theme] ', ''),
  },
  {
    label: '技能皮肤的焦点选择器也把深色守卫摘掉了：浅色下按钮、技能行、正文技能名的焦点环又变回皮肤里的金圈',
    file: 'src/client/views/skillDetail/PixelStyles.ts',
    group: 'F30',
    change: (s) => replaceAll(replaceAll(s, ':where(body[data-ds-dark-theme]) ', ''), 'body[data-ds-dark-theme] ', ''),
  },
  {
    label: '浅色修复层里有一条选择器漏了 body:not([data-ds-dark-theme]) 前缀：深色也被改到',
    file: 'src/client/views/feedback/feedback-styles.ts',
    group: 'F31',
    change: (s) => replaceAll(s, 'body:not([data-ds-dark-theme]) .dsws-chain-form label', '.dsws-chain-form label'),
  },
  {
    label: '浅色修复层里把宿主变量换成了写死的 #61666b：换肤时不会跟着宿主走',
    file: 'src/client/views/feedback/feedback-styles.ts',
    group: 'F31',
    change: (s) => replaceAll(s, 'color:var(--dsw-alias-label-secondary)!important}', 'color:#61666b!important}'),
  },
  {
    label: '浅色层引用的宿主令牌名拼错了：浏览器静默回落，那几个字又回到看不清（CSS 与旧判据都不会报错）',
    file: 'src/client/views/feedback/feedback-styles.ts',
    group: 'F31',
    change: (s) => replaceAll(s, 'var(--dsw-alias-label-secondary)', 'var(--dsw-alias-label-secondry)'),
  },
  {
    label: '票详情的错误横幅又退回无名内联 div：浅色规则再也命不中，正文回到 2.56:1',
    file: 'src/client/views/IssueDetail.ts',
    group: 'F32',
    change: (s) => replaceAll(s, "className: 'dsws-detail-err', ", ''),
  },
  {
    label: '拉取请求「已合并」那一条浅色规则被删了：状态字又回到 2.54:1',
    file: 'src/client/views/feedback/feedback-styles.ts',
    group: 'F32',
    change: (s) => replaceAll(s, '[data-state="merged"]', ''),
  },
  {
    label: '环境检查的状态圆点少了类名：浅色规则命不中圆点，警告橙圆点又回到 2.15:1',
    file: 'src/client/views/ChecksTab.ts',
    group: 'F32',
    change: (s) => replaceAll(s, "className: 'dsws-ccard-dot'", ''),
  },
  {
    label: '多行提示浮层的类名标记被删掉：浅色规则再也命不中，第一行小标签又回到 3.38:1',
    file: 'src/client/views/IssueDetail.ts',
    group: 'F32',
    change: (s) => replaceAll(s, "className: 'dsws-tip', ", ''),
  },
]
for (const v of variants) {
  const read = (p: string) => (p === v.file ? v.change(String(base[p] || '')) : String(base[p] || ''))
  const reds = audit(read).filter((r) => !r.ok)
  const hit = reds.some((r) => r.msg.indexOf(v.group) === 0)
  check(hit, 'G 判据能判红：' + v.label + '（' + v.group.trim() + ' 组报一条 FAIL）' + (hit ? '' : '；实际报错：' + (reds.map((r) => r.msg).join(' | ').slice(0, 300) || '一条都没有')))
}

console.log('')
console.log(failures === 0 ? ('全部通过：' + total + ' 条断言') : ('失败 ' + failures + ' / 共 ' + total + ' 条断言'))
if (failures > 0) process.exit(1)
