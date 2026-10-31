// tests/verify-container-colors.ts —— #1296 门禁：两套容器的身份色只在中央色表一处
// https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1296
// 门禁归属: src/client/kernel/container-view.ts
// 门禁归属: src/client/views/versionControl/vcStyles.ts
// 判据（#1290 实施决策 G、#1280 第 4 节颜色四条、#1343 颜色收口）：
// 1. 探索地图的身份色与规格（实施地图）的身份色，真值只剩中央色表 src/client/kernel/container-view.ts
//    的 CONTAINER_ACCENT 一处；src 下任何其他文件再写一次这个色值就判红——写进注释也算，
//    因为注释里的色值第二天就会被复制成代码。大小写变体同样算：`#C084FC`、`#1d4ed8` 与 `#1D4ED8`
//    在渲染器眼里是同一个颜色，门禁按不区分大小写统计。
// 2. 版本控制页签那套蓝是另一回事：它单独成表（vcStyles.ts 的 --vc-info），不跟着规格卡蓝走。
//    白名单按「路径 + 段」锁死：只认 vcStyles.ts 里 --vc-info: 这一段后面的那两处，别处的蓝仍判红。
// 3. 颜色由中央色表流出去的每一处（列表行、详情页头/顶栏/动作条、内核样式、浮层、状态栏等）
//    都必须真的引用 CONTAINER_ACCENT：这条检查是「还在从中央色表取」的粗筛——只要文件里还有
//    写死的色值，字面量扫描那一节会红；粗筛只保证消费端没有整段绕开中央色表（把引用删掉）。
//    真正守住「改一处、全跟着变」的是字面量扫描加上渲染侧门禁（verify-1286-list /
//    verify-1286-detail / verify-1295-dual-panel / verify-1237-mapdetail-copy）。
// #1343 追加（颜色收口）：容器三态里的两枚固定色——空态橙、完成态绿——也只许在中央色表里写一次。
// 4. 中央色表的 CONTAINER_EMPTY_COLOR / CONTAINER_DONE_COLOR 真值各一处，运行时读出来与门禁里写死的
//    期望值一致；改色表不改这里、或改这里不改色表，都会红——两边必须一起改，diff 里看得见。
// 5. 全仓零容忍：src 下所有 .ts/.mts/.tsx 原文都在扫描范围里（含注释、不区分大小写）。
//    除中央色表外，两色每一处都必须落进 STATUS_EXCEPTIONS 的某一条「路径 + 段」里；白名单条目
//    必须被实际命中，过期条目判红。今天全仓两色（中央色表之外）共 32 个文件 79 处；中央色表里各另有一处。
//    白名单只收语义上确实不是第二份拷贝的同值点——警告橙、票/issue 状态绿、标签色数据、主题串、
//    颜色元数据、版本控制页签自带配色等，每条都写清改中央色时为什么不该顺带改它。
// 6. 动态消费端那一圈仍单独检查：引用两个状态色常量、或裸色值落在空态/完成态语境里的文件，
//    必须真的从中央色表取色；候选文件里声明的状态常量必须保留「typeof 判断 + 空串兜底」的守卫，
//    防止有人把兜底换回写死的色值。候选文件自己的裸值同样要过第 5 条的白名单。
// 7. 消费端与白名单分开检查：第八节管「谁在消费、有没有绕开中央色表」，第九节管「全仓每一处
//    同值落点是否都有白名单条目、条目是否过期」。
// 跑法：node --import ./scripts/ts-hook.mts tests/verify-container-colors.ts
// 做法：递归读 src/**/*.{ts,mts,tsx} 原文，按颜色值统计落点（不区分大小写）；中央色表与版本控制蓝
//   按白名单放行，其余一律零容忍。不跑渲染，渲染侧的取色行为由上面那几扇门禁守。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(ROOT, 'src')
const CENTER = 'src/client/kernel/container-view.ts'
const VC_STYLES = 'src/client/views/versionControl/vcStyles.ts'
// 两个字面量在这里各写一遍是必要的：门禁要拿着它们去搜源码，不能从被搜的那份色表里取，
// 否则色表被改坏时门禁会跟着一起坏（那样就变成「改什么都是绿的」）。
const EXPLORE = '#c084fc'
const SPEC = '#1D4ED8'
const VC_BLUE = '#1d4ed8'
// 版本控制蓝的白名单只锁 vcStyles.ts 里 --vc-info: 这一段（两处自定义属性的值）。
const VC_SEGMENT = '--vc-info:'
const VC_SEGMENT_OCCURRENCES = 2
// 容器三态的两枚固定色。跟上面的身份色同一个道理：门禁自己各写一遍去搜源码、去比运行时值，
// 不从被搜的那份色表里取——否则色表改坏时门禁会跟着一起坏。
const EMPTY = '#f59e0b'
const DONE = '#3fb950'
// 候选消费端的动态判据：源码里出现这两个常量名，或者出现裸色值、而那一行又带着空态/完成态的语境。
// 加语境标记是为了让「新写的裸值渲染点」也逃不掉：只看常量引用的话，直接手写色值的消费端会漏掉。
const STATUS_CONSTANTS = ['CONTAINER_EMPTY_COLOR', 'CONTAINER_DONE_COLOR']
const RAW_SEMANTIC_MARKERS = ['mapEmpty', 'mapDone', 'cState', 'containerTri', 'containerNumber', 'CONTAINER_EMPTY_COLOR', 'CONTAINER_DONE_COLOR', 'DONE_GREEN', 'inspectTitle', 'doneTitle']
// 全仓同值点的白名单：路径 + 段锁死，段是命中行里必须出现的片段，每一条还必须被实际命中。
// #1343 把范围从「容器三态消费端那一圈」扩到整个 src 之后，警告橙、票/issue 状态绿、标签色数据、
// 主题串与颜色元数据都要在这里登记；每条 reason 说明「为什么这不是第二份会跟着漂的拷贝」。
const STATUS_EXCEPTIONS = [
  // ---- 警告橙：切换、探测、迁移、快照、限流、过期等「要提醒人」的状态提示色 ----
  // 它们和容器空态橙不是同一套语义，中央色表改色时不该跟着变；今天同值只是共用同一支琥珀。
  {
    file: 'src/client/kernel/row-actions.ts',
    segment: "'needs-triage', '#f59e0b'",
    reason: 'needs-triage 动作按钮的警示橙（bc 给按钮上色）：这是 triage 标签色，用来提示需要分诊，与容器空态无关。',
  },
  {
    file: 'src/client/kernel/row-actions.ts',
    segment: "'wayfinder:prototype', '#f59e0b'",
    reason: 'wayfinder:prototype 动作按钮的警示橙（rowActionText 的按钮色）：原型标签色，与容器空态无关。',
  },
  {
    file: 'src/client/panel/Dock.ts',
    segment: 'repoUnidentifiedTitle',
    reason: '仓库未识别提示 chip 的警告色：这里要提醒人「这个仓库没认出来」，用的是 triage 警示橙。',
  },
  {
    file: 'src/client/views/shared/truthLines.ts',
    segment: "tone === 'yellow'",
    reason: '新鲜度三档的显示色（面板头部时间标签与状态栏胶囊上的时刻共用这一份映射）：数据「旧了」的提示色，不是容器空态橙；2026-10-24 从 Dock.ts 收进这里成为唯一一份。',
  },
  {
    file: 'src/client/panel/Dock.ts',
    segment: "const bg = 'rgba(245,158,11,.12)'",
    reason: '切换面板探测提示的整套琥珀底色与边框色组（rgba 配 #f59e0b）：这一块的警告配色。',
  },
  {
    file: 'src/client/panel/Dock.ts',
    segment: 'switch.goSettingsBind',
    reason: '「去设置里绑定」按钮的背景：提醒人先完成绑定才能继续，属于警告动作按钮。',
  },
  {
    file: 'src/client/panel/Dock.ts',
    segment: 'switch.probe',
    reason: '探测进行中 / 探测排队的两行提示文字（switch.probe*）：状态提示色。',
  },
  {
    file: 'src/client/panel/Dock.ts',
    segment: 'switch.retryProbe',
    reason: '探测失败后「重试」按钮的背景：警告动作按钮复用同一支琥珀。',
  },
  {
    file: 'src/client/statusbar/StatusBar.ts',
    segment: 'nav.triageTitle',
    reason: '状态栏 triage 入口的警示橙：用颜色提示「有需要分诊的票」。',
  },
  {
    file: 'src/client/statusbar/StatusBar.ts',
    segment: 'nav.envTitle',
    reason: '环境数量为负（读不到）时的黄色警示：环境状态异常提示。',
  },
  {
    file: 'src/client/statusbar/StatusBar.ts',
    segment: 'dsws-banner warn',
    reason: '接口探测中的警告横幅（dsws-banner warn）：整条 banner 的文字与边框用琥珀，同一行两处。',
  },
  {
    file: 'src/client/views/ChecksTab.ts',
    segment: "sts === 'current'",
    reason: '检查项「进行中 / 当前」的琥珀圆点与文字（同一行两处）：步骤状态色。',
  },
  {
    file: 'src/client/views/IssueDetail.ts',
    segment: 'data-detail-last-known',
    reason: '详情页「上次数据（时间）」提示的琥珀色（#1694）：提醒人当前画的是上一次取到的内容、不是最新的；与容器空态无关。',
  },
  {
    file: 'src/client/views/IssueDetail.ts',
    segment: '显示快照降级',
    reason: '「显示快照降级」提示文字的琥珀色：数据降级状态提示。',
  },
  {
    file: 'src/client/views/IssueDetailComments.ts',
    segment: 'rate-limit',
    reason: '评论提交触发限流的提示色：用琥珀和网络失败（红）区分开。',
  },
  {
    file: 'src/client/views/ListTab.ts',
    segment: 'list.partial',
    reason: '健康检查结果不完整（list.partial）的琥珀小点：结果状态提示。',
  },
  {
    file: 'src/client/views/ListTab.ts',
    segment: "t === 'yellow'",
    reason: "列表行状态 tone=yellow 的取色函数：状态提示黄。",
  },
  {
    file: 'src/client/views/ListTabClosed.ts',
    segment: 'list.page',
    reason: '已关闭列表的分页提示（list.page*）：全部在网页端 / 数据过期，用琥珀提示限制。',
  },
  {
    file: 'src/client/views/NoRepoCard.ts',
    segment: 'switch.probe',
    reason: '仓库还没就绪时的探测中 / 排队提示文字（switch.probe*）：状态提示色。',
  },
  {
    file: 'src/client/views/NoRepoCard.ts',
    segment: 'switch.retryProbe',
    reason: '探测失败后的「重试」按钮背景：警告动作按钮。',
  },
  {
    file: 'src/client/views/NoRepoCard.ts',
    segment: 'panel.labelsStepAction',
    reason: '标签补建流程里「下一步」主按钮背景：引导动作按钮复用琥珀。',
  },
  {
    file: 'src/client/views/SubworkspaceMark.ts',
    segment: 'isWarn',
    reason: '子工作区标记里被标为警告的条目：警告语义。',
  },
  {
    file: 'src/client/views/labels/LabelColorDialog.ts',
    segment: "closeXStyle.borderColor = '#f59e0b'",
    reason: '标签色对话框关闭按钮「再点一次确认」的警告边框与文字（同一行两处）：防误关。',
  },
  {
    file: 'src/client/views/labels/LabelColorDialog.ts',
    segment: 'lc.draftHint',
    reason: '有未保存标签色改动时的草稿提示：提醒人还有改动没保存。',
  },
  {
    file: 'src/client/views/labels/LabelColorDialog.ts',
    segment: 'lc.savedSome',
    reason: '部分标签色保存失败的结果提示：部分成功的警告。',
  },
  {
    file: 'src/client/views/labels/LabelColorDialog.ts',
    segment: 'lc.unsupportedTitle',
    reason: '标签色不受支持时的提示标题：警告语义。',
  },
  {
    file: 'src/client/views/labels/LabelColorDialog.ts',
    segment: "exitStyle.borderColor = '#f59e0b'",
    reason: '退出确认按钮的警告边框与文字（同一行两处）：防误退出。',
  },
  {
    file: 'src/client/views/labels/LabelColorDialog.ts',
    segment: 'lc.copyNoBackend',
    reason: '复制失败提示（没有可用后端）：警告语义。',
  },
  {
    file: 'src/client/views/labels/LabelColorDialog.ts',
    segment: 'lc.closeUnsaved',
    reason: '关闭时「还有未保存改动」的警告文字：防误关。',
  },
  {
    file: 'src/client/views/pixel/PixelDot.ts',
    segment: "p.level === 'warn'",
    reason: '像素风状态点的 warn 档取色：像素主题调色板里的警告色。',
  },
  {
    file: 'src/client/views/shared/BackendSelector.ts',
    segment: 'multiHitBadge',
    reason: '多后端同时命中的标记徽章（同一行两处）：提醒人选中的 ID 命中多个后端。',
  },
  {
    file: 'src/client/views/shared/BackendSelector.ts',
    segment: 'multiHitLine',
    reason: '多后端命中说明行：同一条提醒的正文。',
  },
  {
    file: 'src/client/views/shared/BackendSelector.ts',
    segment: 'pendingLine',
    reason: '待选择提示行：提醒人还有选择没做完。',
  },
  {
    file: 'src/client/views/shared/ChainRenderer.ts',
    segment: "k === 'warn'",
    reason: '执行链步骤的 warn 档色组（底色、边框、文字）：步骤状态色。',
  },
  {
    file: 'src/client/views/shared/ChainRenderer.ts',
    segment: "isCurrent ? '#f59e0b'",
    reason: '执行链当前步骤的琥珀底色：步骤「正在进行」的状态色。',
  },
  {
    file: 'src/client/views/shared/ChainRenderer.ts',
    segment: '2px solid #f59e0b',
    reason: '执行链当前步骤的琥珀边框。',
  },
  {
    file: 'src/client/views/shared/ChainRenderer.ts',
    segment: "isCurrent?'#f59e0b'",
    reason: '执行链当前步骤标题文字的琥珀色。',
  },
  {
    file: 'src/client/views/shared/ChainRenderer.ts',
    segment: "levelToClass(level)==='warn'",
    reason: '执行链状态点的 warn 档取色。',
  },
  {
    file: 'src/client/views/shared/SwitchConfirmModal.ts',
    segment: "id === 'migrate' ? '#f59e0b'",
    reason: '切换确认里「迁移」选项的琥珀色：keep 绿 / migrate 琥珀 / 拒绝红三档。',
  },
  {
    file: 'src/client/views/shared/SwitchConfirmModal.ts',
    segment: "migrateBlocked ? '#f87171' : '#f59e0b'",
    reason: '迁移选项标题在未阻塞时的琥珀色；阻塞时转红。',
  },
  {
    file: 'src/client/views/shared/chips.ts',
    segment: "level === 'warn'",
    reason: '通用状态点 Dot 的 warn 档取色：警告语义。',
  },
  {
    file: 'src/client/views/shared/workRouteTable.ts',
    segment: 'workRouteTable.staleSummary',
    reason: '工作路线表 stale 计数摘要的琥珀色：提醒有数据过期。',
  },
  {
    file: 'src/client/views/shared/workRouteTable.ts',
    segment: 'workRouteTable.unreadable',
    reason: '工作路线表不可读提示的琥珀色：读取失败提示。',
  },
  {
    file: 'src/client/views/skillDetail/PixelSkillRow.ts',
    segment: "level === 'warn'",
    reason: '像素技能行状态色表的 warn 档：像素主题调色板。',
  },

  // ---- 成功 / 关闭绿：票与 issue 的状态色、标签色板绿 ----
  // 容器完成态绿只在容器三态里用；这些绿各有出处，中央色表改色不该顺带改它们。
  {
    file: 'src/client/kernel/styles.ts',
    segment: '.dsws-chip-g{',
    reason: '标签「绿色」chip 的样式（.dsws-chip-g）：GitHub 标签色板里的绿，与容器完成态绿无关。',
  },
  {
    file: 'src/client/kernel/styles.ts',
    segment: '已关闭绿 #3fb950',
    reason: '注释里说明标签 chip 配色时引用的「已关闭绿」：标签色板口径的说明文字。',
  },
  {
    file: 'src/client/views/IssueDetail.ts',
    segment: "isOpen ? '#3fb950'",
    reason: 'issue 打开状态的绿：这是 issue 状态色，不是容器完成态。',
  },
  {
    file: 'src/client/views/IssueDetail.ts',
    segment: "s.state === 'CLOSED' ? '#3fb950'",
    reason: 'issue 已关闭状态的绿：票 / issue 状态色。',
  },
  {
    file: 'src/client/views/MapDetail.ts',
    segment: 'map.subClosed',
    reason: '子票已关闭的绿是票状态（CLOSED）的颜色，不是容器三态里那枚完成绿；今天同值只是历史巧合，改中央色不该顺带改子票状态色。',
  },
  {
    file: 'src/client/views/PrTab.ts',
    segment: 'list.state.open',
    reason: 'PR 打开状态的绿（list.state.open）：PR 状态色。',
  },
  {
    file: 'src/client/views/TicketRow.ts',
    segment: 'map.subClosed',
    reason: '已关闭票行内绿色勾标记：票状态（CLOSED）色，不是容器完成态。',
  },
  {
    file: 'src/client/views/shared/ticket.ts',
    segment: "t.state === 'CLOSED'",
    reason: '票状态条里的「已关闭」绿勾（done）：票状态色。',
  },
  {
    file: 'src/client/views/shared/ticket.ts',
    segment: "color: '#f59e0b', icon: 'alert' }",
    reason: '票进度到 95% 与 100% 时的琥珀警示徽章（confirm / accept 两档，同一行两处）：进度状态色，不是容器空态。',
  },
  {
    file: 'src/client/views/labels/labelColorPalette.ts',
    segment: 'light-dark(#1a7f37,#3fb950)',
    reason: 'GitHub 标签色板里的 green 条目（浅色 #1a7f37、深色 #3fb950）：标签色数据。',
  },
  {
    file: 'src/tracker/rooms/markdown/index.ts',
    segment: "darkColor: '#3fb950'",
    reason: '本地 Markdown 房的标签颜色数据（darkColor）：标签色数据，不是容器完成态。',
  },

  // ---- 主题串与版本控制页签自带配色 ----
  // 这些色值属于各自的主题 / 页签配色表，改中央色表不该顺带改它们。
  {
    file: 'src/client/views/cards/PixelCardsStyles.ts',
    segment: '--cd-warn:#f59e0b',
    reason: '像素卡片主题串里的警告色变量（--cd-warn）：主题自带调色板。',
  },
  {
    file: 'src/client/views/skillDetail/PixelStyles.ts',
    segment: '--pixel-warn:#f59e0b',
    reason: '像素主题串里的警告色变量（--pixel-warn）：主题自带调色板。',
  },
  {
    file: 'src/client/views/versionControl/VersionControlTab.ts',
    segment: '--vc-warn,#f59e0b',
    reason: '版本控制页签的警告色变量兜底（--vc-warn）：该页签自带配色表。',
  },
  {
    file: 'src/client/views/versionControl/vcStyles.ts',
    segment: '--vc-warn:#f59e0b',
    reason: '版本控制页签主题串里的警告色变量定义（中英两套主题各一处）：页签自带配色表。',
  },
  {
    file: 'src/client/views/versionControl/vcStyles.ts',
    segment: 'var(--vc-warn,#f59e0b)',
    reason: '版本控制徽章用 --vc-warn 变量、兜底里又写了一次同值（同一行两处）：页签配色表的兜底写法。',
  },

  // ---- 地图详情 V2：状态成功色变量缺省时的代换值 ----
  // 以下三处都是「主题别名变量 + 同值兜底」的写法，兜底只是变量缺失时的替身，
  // 不是容器完成态色在别处又抄了一份（与版本控制页签的 --vc-warn 兜底同一类）。
  {
    file: 'src/client/views/mapDetailV2/view/skin/MapDetailV2Styles.ts',
    segment: '.m2v2-dest',
    reason: '地图详情 V2 档案区「目的地」行的状态成功色兜底：目的地是目标语义，不是容器完成态色。',
  },
  {
    file: 'src/client/views/mapDetailV2/view/skin/MapDetailV2Styles.ts',
    segment: '.m2v2-count[data-status="ready"]',
    reason: '地图详情 V2 子票计数「已认领」档的状态成功色兜底：这是票状态色，不是容器完成态色。',
  },
  {
    file: 'src/client/views/mapDetailV2/view/skin/MapDetailV2Styles.ts',
    segment: '.m2v2-fill',
    reason: '地图详情 V2 完成度进度条的填充色兜底：进度条借用状态成功色表达完成比例，与容器三态的完成色是两套语义。',
  },

  // ---- 颜色元数据 ----
  {
    file: 'src/shared/feedback-map.ts',
    segment: '琥珀 #f59e0b',
    reason: '反馈映射表里说明「限流那一档走琥珀」的文字描述：颜色元数据，不参与渲染。',
  },
  {
    // #1448 收口补登：这一处是 #1436 加的状态栏横幅「重新检查」按钮，落在白名单之外，
    // 于是本分支的全链一直红在「登记 84 处、实得 85 处」。它不是容器空态色，是操作提示按钮的警示橙。
    file: 'src/client/statusbar/StatusBar.ts',
    segment: "alt ? h('button'",
    reason: '状态栏横幅「重新检查」按钮的警示橙：这是操作提示按钮的颜色，与容器空态无关。',
  },
]
// 今天全仓两色落点（不含中央色表）的登记数：新增或删除一处同值点都要同时改白名单与这里，
// 让「又抄了一份」或「白名单漏了一处」在 diff 里直接看得见。
// 2026-10-24：新鲜度三档的显示色从 Dock.ts 收进 views/shared/truthLines.ts（面板与状态栏共用一份），
//   同值点总数不变（85），落点文件从 32 变成 33。
// #1600：四处筹备中黄条摘掉，同值点 85→81（文件仍是 33 个，四个文件各少一处黄条）。
// #1699：列表内兜底横幅退役、换成取中央色表来画的行内小标识，横幅里两处琥珀随文件删除，
//   同值点 81→79、落点文件 33→32。
const STATUS_REPO_HITS = 79
const STATUS_REPO_FILES = 32
// 这些文件是颜色流向的消费端：必须引用中央色表，不许自己藏一份身份色值。
const CONSUMERS = [
  'src/client/floating/SkillFloatList.ts',
  'src/client/kernel/modal-fields.ts',
  'src/client/kernel/store-derived.ts',
  'src/client/kernel/styles.ts',
  'src/client/statusbar/StatusBar.ts',
  'src/client/views/shared/Tabs.ts',
  'src/client/views/DetailActionBar.ts',
  'src/client/views/IssueDetail.ts',
  'src/client/views/ListTab.ts',
  'src/client/views/ListTabRow.ts',
  'src/client/views/MapDetail.ts',
  'src/client/views/MapDetailHead.ts',
  'src/client/views/MapDetailTop.ts',
  'src/client/views/PrTab.ts',
]

let failures = 0
let total = 0
const check = (ok: any, msg: string) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failures++ }

// 源码按扩展名收齐：.ts / .mts / .tsx。构建产物不在这里（src 下手写代码都是这三种后缀）。
function collectSourceFiles(dir: string): string[] {
  const out: string[] = []
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.isFile() && /\.(ts|mts|tsx)$/.test(e.name)) out.push(p)
    }
  }
  walk(dir)
  return out
}
const relOf = (abs: string) => path.relative(ROOT, abs).split(path.sep).join('/')
const textOf = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
// 一行里某个颜色值的全部落点：行号 + 所在整行，报红时能直接指到人。
// 默认不区分大小写——`#C084FC` 与 `#c084fc` 在渲染器眼里是同一个颜色，不能靠换大小写绕过去。
function occurrences(rel: string, text: string, literal: string, ignoreCase = true): Array<{ line: number; whole: string }> {
  const out: Array<{ line: number; whole: string }> = []
  const lines = text.split(/\r?\n/)
  const needle = ignoreCase ? literal.toLowerCase() : literal
  let hit = 0
  for (let i = 0; i < lines.length; i++) {
    const hay = ignoreCase ? lines[i].toLowerCase() : lines[i]
    let from = 0
    while (true) {
      const at = hay.indexOf(needle, from)
      if (at < 0) break
      // line/whole 两格都留：line 是 1 起的真实行号，whole 是那一行原文（去掉行首缩进，方便直接读）。
      out.push({ line: i + 1, whole: lines[i].trim() })
      hit += 1
      if (hit > 200) return out
      from = at + needle.length
    }
  }
  return out
}

const files = collectSourceFiles(SRC)
check(files.length > 100, '源码扫描范围非空（收到 ' + files.length + ' 个 .ts/.mts/.tsx 文件）')
const fileSet = new Set(files.map(relOf))
check(fileSet.has(CENTER), '中央色表文件在扫描范围内：' + CENTER)
check(fileSet.has(VC_STYLES), '版本控制样式文件在扫描范围内：' + VC_STYLES)

// ---- 一、中央色表是唯一真源：表里只有探索紫一处、规格蓝一处（大小写不敏感） ----
{
  const text = textOf(CENTER)
  const explore = occurrences(CENTER, text, EXPLORE)
  const spec = occurrences(CENTER, text, SPEC)
  check(explore.length === 1, '中央色表里探索紫色值恰好一处（实得 ' + explore.length + ' 处' + (explore.length ? '：第 ' + explore.map((x) => x.line).join('、') + ' 行' : '') + '）')
  check(spec.length === 1, '中央色表里规格蓝色值恰好一处（实得 ' + spec.length + ' 处' + (spec.length ? '：第 ' + spec.map((x) => x.line).join('、') + ' 行' : '') + '）')
  // 表的结构也要锁住：真值必须挂在 CONTAINER_ACCENT 的 map / spec 两个键上，
  // 否则「一处真源」就只是碰巧只剩一处字面量，换个变量名照样能散开。
  check(/CONTAINER_ACCENT[\s\S]{0,200}?map:\s*'/.test(text), '探索地图身份色挂在 CONTAINER_ACCENT.map 上（中央色表结构不变）')
  check(/CONTAINER_ACCENT[\s\S]{0,200}?spec:\s*'/.test(text), '规格身份色挂在 CONTAINER_ACCENT.spec 上（中央色表结构不变）')
  check(!text.includes(VC_BLUE), '中央色表里没有版本控制那套小写蓝（两套蓝互不相干）')
}

// ---- 二、版本控制蓝：只认 vcStyles.ts 的 --vc-info 那一段（大小写不敏感） ----
{
  const text = textOf(VC_STYLES)
  const vc = occurrences(VC_STYLES, text, VC_BLUE)
  check(vc.length === VC_SEGMENT_OCCURRENCES, '版本控制蓝在 vcStyles.ts 里恰好 ' + VC_SEGMENT_OCCURRENCES + ' 处（实得 ' + vc.length + ' 处）')
  // 「路径 + 段」锁：每一处都必须落在 --vc-info: 这一段的同一行里；换个选择器或换行写法都不算白名单。
  const outside = vc.filter((x) => !x.whole.includes(VC_SEGMENT))
  check(outside.length === 0, '版本控制蓝每一处都落在 ' + VC_SEGMENT + ' 这一段里' + (outside.length ? ' —— 越界于第 ' + outside.map((x) => x.line).join('、') + ' 行' : ''))
  check(occurrences(VC_STYLES, text, EXPLORE).length === 0, '版本控制样式里没有探索紫（两套色互不干扰）')
}

// ---- 三、其他文件：出现一次就红（含注释、含大小写变体） ----
{
  const offenders: string[] = []
  for (const abs of files) {
    const rel = relOf(abs)
    if (rel === CENTER || rel === VC_STYLES) continue
    const text = fs.readFileSync(abs, 'utf8')
    const hits = occurrences(rel, text, EXPLORE).map((x) => rel + ':' + x.line + ' ' + x.whole).concat(occurrences(rel, text, SPEC).map((x) => rel + ':' + x.line + ' ' + x.whole))
    for (const h of hits) offenders.push(h)
  }
  check(offenders.length === 0, '中央色表与版本控制白名单之外没有身份色值（零容忍，不区分大小写）' + (offenders.length ? '\n      命中：\n      ' + offenders.slice(0, 20).join('\n      ') : ''))
}

// ---- 四、颜色流向的消费端必须引用中央色表 ----
{
  for (const rel of CONSUMERS) {
    check(fileSet.has(rel), '消费端文件存在：' + rel)
    if (!fileSet.has(rel)) continue
    const text = textOf(rel)
    check(text.includes('CONTAINER_ACCENT'), '消费端从中央色表取色：' + rel)
    check(occurrences(rel, text, EXPLORE).length === 0 && occurrences(rel, text, SPEC).length === 0, '消费端没有自己藏一份身份色：' + rel)
  }
}

// ---- 五、总数不变量：整个 src 里探索紫只剩一处、规格蓝与小写版本控制蓝合计三处（中央一处 + 版本控制两处） ----
{
  let explore = 0
  let specOrVc = 0
  let vc = 0
  for (const abs of files) {
    const text = fs.readFileSync(abs, 'utf8')
    explore += occurrences(relOf(abs), text, EXPLORE).length
    specOrVc += occurrences(relOf(abs), text, SPEC).length
    // 版本控制蓝按小写原样数：规格蓝是大写 `#1D4ED8`，两者大小写不同正是这一节要分开数的原因。
    vc += occurrences(relOf(abs), text, VC_BLUE, false).length
  }
  check(explore === 1, '整个 src 里探索紫只剩 1 处（实得 ' + explore + ' 处）')
  check(specOrVc === 1 + VC_SEGMENT_OCCURRENCES, '整个 src 里规格蓝与版本控制蓝合计只剩 ' + (1 + VC_SEGMENT_OCCURRENCES) + ' 处（中央色表 1 处 + 版本控制白名单 ' + VC_SEGMENT_OCCURRENCES + ' 处；实得 ' + specOrVc + ' 处）')
  check(vc === VC_SEGMENT_OCCURRENCES, '整个 src 里版本控制蓝只剩 ' + VC_SEGMENT_OCCURRENCES + ' 处（实得 ' + vc + ' 处）')
}

// ---- 六、中央色表模块的真值：运行时读出来与上面断的字面量一致 ----
{
  const mod: any = await import('../src/client/kernel/container-view.js')
  const table: any = mod.CONTAINER_ACCENT
  check(!!table && typeof table === 'object', '中央色表模块导出 CONTAINER_ACCENT 对象')
  check(!!table && table.map === EXPLORE, 'CONTAINER_ACCENT.map 就是探索紫（' + (table && table.map) + '）')
  check(!!table && table.spec === SPEC, 'CONTAINER_ACCENT.spec 就是规格蓝（' + (table && table.spec) + '）')
}

// ---- 七、中央色表里的两枚容器状态色：各恰好一处，且是用常量承载 ----
{
  const text = textOf(CENTER)
  const empty = occurrences(CENTER, text, EMPTY)
  const done = occurrences(CENTER, text, DONE)
  check(empty.length === 1, '中央色表里空态橙恰好 1 处（实得 ' + empty.length + ' 处' + (empty.length ? '：第 ' + empty.map((x: any) => x.line).join('、') + ' 行' : '') + '）')
  check(done.length === 1, '中央色表里完成态绿恰好 1 处（实得 ' + done.length + ' 处' + (done.length ? '：第 ' + done.map((x: any) => x.line).join('、') + ' 行' : '') + '）')
  check(/CONTAINER_EMPTY_COLOR\s*=\s*'/.test(text), '中央色表用 CONTAINER_EMPTY_COLOR 常量承载空态橙')
  check(/CONTAINER_DONE_COLOR\s*=\s*'/.test(text), '中央色表用 CONTAINER_DONE_COLOR 常量承载完成态绿')
}

// ---- 八、容器三态消费端：动态圈候选，候选必须从中央色表取状态色、自己不许再写一份 ----
{
  // 候选不写死文件名：源码里出现状态色常量名，或者裸色值那一行带着空态/完成态的语境标记，
  // 都算消费端。以后新增一个渲染点，只要引用常量或写了同语境的裸值，就会自动被圈进来。
  const candidates: { rel: string; text: string }[] = []
  for (const abs of files) {
    const rel = relOf(abs)
    if (rel === CENTER) continue
    const text = fs.readFileSync(abs, 'utf8')
    const saysConstant = STATUS_CONSTANTS.some((name: any) => text.includes(name))
    const rawHits = occurrences(rel, text, EMPTY).concat(occurrences(rel, text, DONE))
    const rawSemantic = rawHits.some((hit: any) => RAW_SEMANTIC_MARKERS.some((marker: any) => hit.whole.includes(marker)))
    if (saysConstant || rawSemantic) candidates.push({ rel: rel, text: text })
  }
  check(candidates.length >= 5, '容器三态消费端至少圈到 5 个（实得 ' + candidates.length + ' 个：' + candidates.map((c: any) => c.rel).join('、') + '）')

  // 「引用常量」不能只算 declare 那一行：declare 只声明全局量存在，不产生取值；真正取色的是后面的代码。
  function takesStatusConstant(text: string): boolean {
    return text.split(/\r?\n/).some((line: any) => {
      const t = line.trim()
      if (t.startsWith('declare')) return false
      return t.includes('CONTAINER_EMPTY_COLOR') || t.includes('CONTAINER_DONE_COLOR')
    })
  }

  // 候选文件里声明的状态色常量必须保留「typeof 判断 + 空串兜底」的守卫：客户端片段被单独求值时
  // 中央色表的常量可能没有被注入，这时要退回空串，而不是退回写死的色值；直接裸引用也不行。
  // 这条断言专门防有人把兜底改回 '#f59e0b' / '#3fb950'，或者把守卫整段删掉。
  function keepsStringFallbackGuard(text: string, name: string): boolean {
    return text.split(/\r?\n/).some((line: any) => {
      const t = line.trim().replace(/\s+/g, ' ')
      return t.includes("typeof " + name + " === 'string'") && t.includes('? ' + name + " : ''")
    })
  }

  const offenders: string[] = []
  for (const candidate of candidates) {
    check(takesStatusConstant(candidate.text), '容器三态消费端从中央色表取状态色：' + candidate.rel)
    for (const name of STATUS_CONSTANTS) {
      if (!new RegExp('declare\\s+const\\s+' + name + '\\b').test(candidate.text)) continue
      check(keepsStringFallbackGuard(candidate.text, name), '消费端声明的 ' + name + ' 保留 typeof 判断与空串兜底守卫：' + candidate.rel)
    }
    const hits = occurrences(candidate.rel, candidate.text, EMPTY).concat(occurrences(candidate.rel, candidate.text, DONE))
    for (const hit of hits) {
      const idx = STATUS_EXCEPTIONS.findIndex((exc: any) => exc.file === candidate.rel && hit.whole.includes(exc.segment))
      if (idx >= 0) continue
      offenders.push(candidate.rel + ':' + hit.line + ' ' + hit.whole)
    }
  }
  check(offenders.length === 0, '容器三态消费端没有自己再抄一份状态色（白名单里语义不同的同值点除外；命中 ' + offenders.length + ' 处）' + (offenders.length ? '\n  ' + offenders.join('\n  ') : ''))
}

// ---- 九、全仓扫描：除中央色表外，两色每一处都要落进白名单，白名单条目必须被命中 ----
{
  // 这一节是 #1343 扩出来的全仓零容忍：不管文件是不是容器三态消费端，只要写了这两色之一，
  // 就必须在 STATUS_EXCEPTIONS 里有一条路径 + 段对得上；同时对不上的条目判红，逼着删。
  const repoHits: Array<{ rel: string; line: number; whole: string }> = []
  for (const abs of files) {
    const rel = relOf(abs)
    if (rel === CENTER) continue
    const text = fs.readFileSync(abs, 'utf8')
    for (const hit of occurrences(rel, text, EMPTY)) repoHits.push({ rel: rel, line: hit.line, whole: hit.whole })
    for (const hit of occurrences(rel, text, DONE)) repoHits.push({ rel: rel, line: hit.line, whole: hit.whole })
  }
  const hitFiles = new Set(repoHits.map((h) => h.rel))
  check(repoHits.length === STATUS_REPO_HITS, '中央色表之外两色落点数与登记一致（登记 ' + STATUS_REPO_HITS + ' 处，实得 ' + repoHits.length + ' 处）')
  check(hitFiles.size === STATUS_REPO_FILES, '中央色表之外两色落在 ' + STATUS_REPO_FILES + ' 个文件里（实得 ' + hitFiles.size + ' 个）')

  const used = new Set<number>()
  const offenders: string[] = []
  for (const hit of repoHits) {
    const idx = STATUS_EXCEPTIONS.findIndex((exc: any) => exc.file === hit.rel && hit.whole.includes(exc.segment))
    if (idx >= 0) {
      used.add(idx)
      continue
    }
    offenders.push(hit.rel + ':' + hit.line + ' ' + hit.whole)
  }
  check(offenders.length === 0, '中央色表之外没有无归属的状态色同值点（全仓零容忍）' + (offenders.length ? '\n  命中：\n  ' + offenders.join('\n  ') : ''))
  // 白名单只放真被用到的条目：过期条目会红，逼着删，免得名单越攒越像摆设。
  STATUS_EXCEPTIONS.forEach((exc: any, idx: number) => {
    check(used.has(idx), '状态色白名单被实际命中：' + exc.file + ' 的 ' + exc.segment + '（' + exc.reason + '）')
  })
}

// ---- 十、两枚容器状态色的运行时真值：中央色表读出来与门禁写死的期望值一致 ----
{
  const mod: any = await import('../src/client/kernel/container-view.js')
  check(mod.CONTAINER_EMPTY_COLOR === EMPTY, 'CONTAINER_EMPTY_COLOR 就是空态橙（' + (mod && mod.CONTAINER_EMPTY_COLOR) + '）')
  check(mod.CONTAINER_DONE_COLOR === DONE, 'CONTAINER_DONE_COLOR 就是完成态绿（' + (mod && mod.CONTAINER_DONE_COLOR) + '）')
}

console.log(failures ? '\n存在失败 — verify-container-colors 未通过' : '\n全部通过 — 容器身份色与两枚状态色都只剩中央色表一处，全仓同值点全部有白名单归属（共 ' + total + ' 项断言）')
process.exit(failures ? 1 : 0)
