/**
 * views/shared/ticketBadge.ts — 票号徽标（`#目录/编号`）唯一的画法（#1564）
 *
 * 契约：模块真源（ESM 导出）；scripts/build.mts 构建时剥掉行首 export，把声明体拼进
 * src/client/index.ts 的 `// ==== leaf:ticketBadge (spliced by build) ====` 标记处（源码树里只有这一份真源）。
 * 本文件是手写的 TypeScript（不是从 .js 转写来的），所以可以直接用类型标注与导出类型。
 *
 * 为什么要有这个文件（#1564）：同一颗徽标以前在五处显示点各画一遍 —— 列表行、票详情页头、
 * 地图/规格详情页头、在办表首列、状态栏胶囊（展开单子与主行两处）。五份拷贝各自写着上限宽度、
 * 两段布局（目录段可省略、编号尾巴不缩）、悬停内容与无障碍名。后果已经发生过：#1301 那次
 * 地图详情页头画的是裸号 `#00`，跟别处对不上。从本票起，这些「怎么写」只在这里说一次；
 * 五个调用方只回答「画的是哪张票、用哪种外壳、这一处的主色是什么」。
 *
 * 四种外壳（surface）只决定「外面长什么样」，徽标里的文字规则一个字节都不重写：
 *   · badge  —— 默认外壳：列表行、票详情页头、地图/规格详情页头三处共用（CSS 类名 dsws-idnum 不变，
 *               浅色主题层与交互反馈样式都按这个类名命中）。
 *   · cell   —— 在办表首列。它不是独立控件：悬停由整行的提示负责（#1287/#1288，在 workRouteTable 里），
 *               所以这一种不套自己的 Tip；无障碍名同样由整行给出。两段布局与上限宽度仍走同一份。
 *   · pill   —— 状态栏胶囊展开单子里的那一行：圆角药丸、11px、号前面带容器身份图标。
 *   · capsule —— 状态栏主胶囊上那一颗：两段折叠结构由 kernel/ticket-label.ts 的
 *               ticketLabelCapsuleFoldOf 定（目录段挂让位号 12，编号尾巴永不让位），本组件只补悬停。
 *
 * 悬停与无障碍名（cell 以外）：整个节点包进 Tip，content 就是完整写法 ticketLabelOf(...)。
 *   Tip 对字符串内容会给子节点补 aria-label —— 所以「悬停看见的那一串」和「读屏读到的名字」
 *   天然是同一串；不要为了方便在调用方再拼一次。这也是 #1511 定下的口径。
 *
 * 上限宽度只有一处来源：kernel/ticket-label.ts 的 TICKET_LABEL_MAX_WIDTH（由 85px 那个数推出）。
 *   本文件不写字面量，调用方也传不进别的宽度 —— 要改宽窄，五处会一起变。
 *
 * 反例（不要走回去）：在调用方写 maxWidth、拼 `'#' + key`、或者再写一份悬停字符串。
 *   真要换一种外壳形态，就在这里加一种 surface 并实现，而不是只在某一处单独改。
 */

// 闭包环境声明（类型检查时才看，转译时整段删掉，真机上有值）：这些名字由构建按 scripts/build.mts
// 的次序把别的片段拼进同一个函数作用域后提供。本文件不写运行时 import —— 拼进闭包后那就是语法错。
declare function ticketLabelOf(...args: any[]): any;
declare function ticketLabelNodesOf(...args: any[]): any;
declare function ticketLabelCapsuleFoldOf(...args: any[]): any;
declare const TICKET_LABEL_MAX_WIDTH: any;
declare const Tip: any;

/** 徽标外壳：这颗号画在哪种显示点上（差别只在外部形状，见文件头）。 */
export type TicketBadgeSurface = 'badge' | 'cell' | 'pill' | 'capsule'

/** 画一颗票号徽标要的全部输入：哪张票（key/effortId）+ 画在哪（surface）+ 该处的视觉。 */
export interface TicketBadgeOptions {
  /** 票的短编号（远端后端是数字；本地后端是文件名里的 NN 形态或带后缀的退化身份）。 */
  key?: any
  /** 票所属的工作单元（effort）；为空表示没有目录这一层，只写 #编号。 */
  effortId?: any
  /** 外壳，默认 badge。 */
  surface?: TicketBadgeSurface
  /** 这一处的主色（文字与描边）：列表用状态色、详情页用动作色、容器页头用身份色、在办表用正文色。 */
  color?: any
  /** 药丸外壳的描边色；缺省与 color 同色。 */
  borderColor?: any
  /** 药丸外壳左侧的身份图标节点（只有容器才有）；其它外壳忽略。 */
  leadingIcon?: any
  /** 在办表首列量「这一格有没有被截掉」用的引用（整行提示据此补完整票号）；其它外壳忽略。 */
  ref?: any
}

/**
 * 画一颗票号徽标。
 *
 * 三种外壳共用的外层布局（横排、垂直居中、有上限宽度、超出裁掉）在函数里现拼，不提到模块级：
 * 上限宽度来自闭包里的 TICKET_LABEL_MAX_WIDTH，模块级求值会让「谁先被导入」决定成败 ——
 * 门禁单独 import 本文件时那个名字还没注进全局，提到模块级就当场 ReferenceError。
 *
 * @param h 创建元素的函数（真机来自 DswsCtx 的 cx.h；门禁里是记录树节点的桩）
 * @param options 哪张票 + 哪种外壳 + 该处主色（见 TicketBadgeOptions）
 * @returns badge/cell/pill 是 span 节点（badge/pill 最外层还有一层 Tip）；capsule 是 Tip 包着的折叠节点
 */
export const ticketBadgeOf = function (h: any, options?: TicketBadgeOptions) {
  const o: TicketBadgeOptions = options || {}
  const key = o.key
  const effortId = o.effortId
  const surface = o.surface || 'badge'
  // 悬停与无障碍名共用这一串；cell 外壳不使用它（整行提示负责）。
  const label = ticketLabelOf(key, effortId)
  const outerStyle = { display: 'inline-flex', alignItems: 'center', maxWidth: TICKET_LABEL_MAX_WIDTH, overflow: 'hidden' }

  // 主胶囊：哪一段让位、哪一段不让位已经收在 kernel/ticket-label.ts，这里只补悬停与无障碍名。
  if (surface === 'capsule') return h(Tip, { content: label }, ticketLabelCapsuleFoldOf(h, key, effortId))

  // 在办表首列：整行的提示已经在管悬停，这里再套一层 Tip 会被外层盖住、还多一条读屏名字，所以不套。
  if (surface === 'cell') {
    // 格子窄，溢出时按格子宽度走省略号（文字实际在里层两段各自裁，这里只是兜底）。
    const cellStyle = Object.assign({ fontVariantNumeric: 'tabular-nums', color: o.color }, outerStyle, { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })
    return h('span', { ref: o.ref, style: cellStyle }, ticketLabelNodesOf(h, key, effortId))
  }

  // 胶囊展开单子里的药丸：带容器身份图标时把图标摆在号前面（图标由调用方给，它知道这是地图还是规格）。
  if (surface === 'pill') {
    const borderColor = o.borderColor != null ? o.borderColor : o.color
    const pillStyle = Object.assign({ flex: 'none' }, outerStyle, {
      fontSize: 11,
      lineHeight: '16px',
      padding: '0 6px',
      borderRadius: 99,
      border: '1px solid ' + borderColor,
      color: o.color,
    })
    const segments = ticketLabelNodesOf(h, key, effortId)
    const children = o.leadingIcon
      ? [o.leadingIcon, h('span', { style: { display: 'inline-flex', alignItems: 'center', minWidth: 0, overflow: 'hidden' } }, segments)]
      : segments
    return h(Tip, { content: label }, h('span', { style: pillStyle }, children))
  }

  // badge：列表行与两处详情页头共用的默认外壳。flex: none 让它在横排里不被压窄（宽度交给上限管）。
  const badgeStyle = Object.assign({ color: o.color, borderColor: o.color, flex: 'none' }, outerStyle)
  return h(Tip, { content: label }, h('span', { className: 'dsws-idnum', style: badgeStyle }, ticketLabelNodesOf(h, key, effortId)))
}
