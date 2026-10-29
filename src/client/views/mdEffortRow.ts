/**
 * #1639：主列表顶部那排「md目录签」的画法，连同目录名的显示上限（19 个数字的宽度 + 末尾一个省略号）。
 *
 * 为什么单独一片：ListTab 已贴着「每个文件不超过 350 行有效代码」的上限（同目录的 listFilterRow.ts
 * 就是为这个上限搬出去的先例）；更要紧的是这一排的排布规则与目录名上限要放在同一处真源，
 * 门禁才能对着同一份代码量几何。
 *
 * 排布为什么必须是普通内联流（维护者拍板：行尾放不下就必须在字与字之间切断，不许整颗挪到下一行，
 * 更不许在胶囊内部折成两行）：
 *   一粒胶囊要被行尾切成两截，它必须是内联盒（inline box），父容器必须是普通块容器。
 *   一旦父容器是 flex 或 grid，子项会被整块化（CSS Display 第 2.7 节），行尾只剩「整颗搬到下一行」
 *   这一种结果；胶囊自己也必须是 display:inline（.dsws-chip 原本是 inline-flex，在 flex 容器里
 *   看不出问题，换成内联流就永远切不开）。
 *   切口用 box-decoration-break:slice（也就是默认值，这里写出来是为了不让后来者无意改掉）：
 *   整串背景、圆角与边框只在最前和最后封口，第一行尾是平切口、第二行头文字贴边，
 *   读起来就是「同一颗胶囊被行尾切断，前一半在第一行、后一半接在第二行头」。
 *   clone 会让每一截各自封口，第二行头像一颗新胶囊的开头，不是维护者要的效果。
 *   附带两条硬事实：内联流没有 gap，胶囊之间的间距只能靠 margin（这里显式给 8 像素，
 *   因为原来的容器 gap:4 与 .dsws-chip 自带的 margin-right:4 叠起来正好是 8 像素）；
 *   内联盒上的 max-width 不生效（CSS 2.1 第 10.4 节），原来的 maxWidth:220 只能把整颗胶囊
 *   撑成一块高盒子，长名字的宽度上限必须用 JavaScript 按量出来的字宽裁。
 *
 * 文字上限（维护者新增）：每颗 md目录签显示的文字不超过 19 个数字字符的宽度，超长时末尾另加
 *   一个省略号字符；省略号是「被截过」的标记，不占那 19 个数字的宽度额度（与 #1540 的省略号口径一致）。
 *   被截掉的只是显示，名字本身不丢：悬停提示（Tip）与 aria-label 仍是全名，切成两截读回来也仍是
 *   完整的显示文字。「全部」那颗是界面上的固定选项，不是目录名，不受这条上限影响。
 */

// 下面这些名字本文件里没有 import、也不是本文件定义的：它们由构建按 scripts/build.mts 的次序，
// 把各叶子拼进同一个函数作用域后提供（真机上有值）。类型检查时本文件是独立看的，所以这里只声明形状、
// 不参与转译：declare 是纯类型语法，esbuild 转译时会整句删掉，产物里不留痕。
declare function chipProps(...args: any[]): any
declare function tr(...args: any[]): any
declare const Tip: any
declare function emit(...args: any[]): any

/** 目录名显示宽度的上限：19 个数字字符的宽度（维护者的原话是「19 个数字的宽度」）。 */
export const MD_EFFORT_LABEL_DIGIT_LIMIT: number = 19
/** 截断标记：一个省略号字符，不占上面那 19 个数字的宽度额度。 */
export const MD_EFFORT_LABEL_ELLIPSIS: string = '…'

/** 量字用的字号，与每颗胶囊的 fontSize 必须一致：量宽与排版用同一个字号，上限才对得上。 */
const MD_EFFORT_LABEL_FONT_SIZE: number = 10

/** 量「19 个数字有多宽」的样本：数字等宽，用 19 个「0」量一次就够。 */
const mdEffortDigitSample: string = '0'.repeat(MD_EFFORT_LABEL_DIGIT_LIMIT)

/** 浏览器里量字用的画布上下文：第一次用到时建一次，之后复用；建不出来就一直是 null（退回估宽）。 */
let mdEffortCanvasCtx: any = null
let mdEffortCanvasTried: boolean = false

/**
 * 一个字（码点）的估计宽度：真机上永远走浏览器真字体，估宽只在拿不到画布时兜底
 * （在 Node 里跑源码，或者门禁忘了注入量字函数）。汉字、全角标点、省略号按一个字号宽，
 * 其余按六成字号宽，这就是这类界面字体里半角字符与全角字符的常见比例。
 */
const mdEffortEstimateCharWidth = function (ch: string): number {
  const code: number = ch.codePointAt(0) || 0
  const wide: boolean = (code >= 0x2e80 && code <= 0x9fff) || (code >= 0xf900 && code <= 0xfaff)
    || (code >= 0xff01 && code <= 0xff60) || code === 0x2026
  return (wide ? 1 : 0.6) * MD_EFFORT_LABEL_FONT_SIZE
}

/** 拿不到浏览器字体时按字符估一段文字的宽度。 */
const mdEffortEstimateTextWidth = function (text: string): number {
  let width: number = 0
  const chars: string[] = Array.from(text)
  for (let i = 0; i < chars.length; i += 1) width += mdEffortEstimateCharWidth(chars[i])
  return width
}

/**
 * 真机上的量字：用浏览器画布按面板继承下来的字体族量（--dsw-font-family 由 body 往下传）。
 * 拿不到 document 或画布时返回 null，由调用方退回估宽。字体族只取一次：换皮肤要重开界面，不会中途变。
 */
const mdEffortMeasureWithCanvas = function (): any {
  if (mdEffortCanvasTried) return mdEffortCanvasCtx
  mdEffortCanvasTried = true
  try {
    const doc: any = (typeof document === 'undefined') ? null : document
    if (!doc || !doc.createElement) return null
    const ctx: any = doc.createElement('canvas').getContext('2d')
    if (!ctx) return null
    let family: string = ''
    try { family = (typeof getComputedStyle === 'function' && doc.body) ? String(getComputedStyle(doc.body).fontFamily || '') : '' } catch (e) { family = '' }
    ctx.font = MD_EFFORT_LABEL_FONT_SIZE + 'px ' + (family || 'system-ui, sans-serif')
    mdEffortCanvasCtx = ctx
  } catch (e) {
    mdEffortCanvasCtx = null
  }
  return mdEffortCanvasCtx
}

/**
 * 量一段文字的宽度。优先用真字体（浏览器画布），量不到就按字符估。
 * measureTextWidth 只给门禁与静态渲染注入：Node 里没有排版引擎，门禁把浏览器量到的字宽按函数传进来，
 * 这样门禁算出的截断结果与真机一致。
 */
const mdEffortMeasureText = function (text: string, measureTextWidth?: any): number {
  if (typeof measureTextWidth === 'function') return Number(measureTextWidth(String(text)))
  const ctx: any = mdEffortMeasureWithCanvas()
  if (ctx) {
    try { return Number(ctx.measureText(String(text)).width) } catch (e) { /* 落到估宽 */ }
  }
  return mdEffortEstimateTextWidth(String(text))
}

/**
 * 目录名的显示文字：不超过 19 个数字的宽度就原样返回，超了就从尾巴截掉，末尾换成省略号。
 * 取舍口时按「回退到最后一个放得下的字」，所以显示文字的实际宽度永远不会超过上限，
 * 而省略号提供的「被截过」的提示不占上限额度。
 */
export const mdEffortLabelOf = function (nm: any, measureTextWidth?: any): string {
  const full: string = String(nm === undefined || nm === null ? '' : nm)
  const measure = function (text: string): number { return mdEffortMeasureText(text, measureTextWidth) }
  const budget: number = measure(mdEffortDigitSample)
  if (!(budget > 0)) return full
  if (!(measure(full) > budget)) return full
  const chars: string[] = Array.from(full)
  let keep: number = 0
  for (let i = 1; i <= chars.length; i += 1) {
    if (!(measure(chars.slice(0, i).join('')) <= budget)) break
    keep = i
  }
  if (keep <= 0) return MD_EFFORT_LABEL_ELLIPSIS
  return chars.slice(0, keep).join('') + MD_EFFORT_LABEL_ELLIPSIS
}

/** 一颗胶囊的选中/未选中配色。切成两截只影响背景与圆角的连续性，文字与边框颜色不因此变化。 */
const mdEffortChipColors = function (on: boolean): any {
  return {
    background: on ? 'rgba(88,166,255,.18)' : 'rgba(255,255,255,.06)',
    color: on ? '#58a6ff' : 'var(--dsw-alias-label-secondary,#a1a1aa)',
    border: '1px solid ' + (on ? 'rgba(88,166,255,.6)' : 'rgba(255,255,255,.15)'),
  }
}

/**
 * 画这一排。参数说明：
 *   h 是 React 的 createElement；st 是列表页状态（这里读 effFilters 判断选中，点击后整份交回 emit）；
 *   effortNames 是 effortNamesOf 给出的目录名（已排序，多于一个时界面上才画这一排）；
 *   measureTextWidth 只给门禁用（见 mdEffortMeasureText 上的说明），真机不传。
 */
export const mdEffortRowNode = function (h: any, st: any, effortNames: any, measureTextWidth?: any): any {
  const names: any[] = Array.isArray(effortNames) ? effortNames : []
  // 单选：effFilters 里只放一个目录名；空数组表示「全部」。
  const selected: any[] = (st && st.effFilters) || []
  // 容器用普通块，不用 flex：flex 子项会被整块化，行尾切不开（见文件头）。
  // 行高 20 像素，给胶囊上下留出余量：胶囊自己 18 像素高（14 行高 + 上下各 2 像素内边距与边框），
  // 两行之间不会叠在一起。
  const rowStyle: any = { display: 'block', lineHeight: '20px', marginBottom: 6 }
  // 每颗胶囊的公共排布：display:inline 覆盖 .dsws-chip 的 inline-flex，这是能被行尾切开的前提。
  const chipLayout: any = {
    display: 'inline',
    cursor: 'pointer',
    fontSize: MD_EFFORT_LABEL_FONT_SIZE,
    lineHeight: '14px',
    // 名字可以在任意字之间断开：中文逐字可断，英文长词也要能断（不然会把面板撑宽）。
    whiteSpace: 'normal',
    wordBreak: 'break-all',
    // 内联流没有 gap，间距只能靠 margin-right；8 像素 = 原来的容器 gap:4 + .dsws-chip 的 margin-right:4。
    marginRight: 8,
    // 整串只在最前与最后封口：第一行尾平切口、第二行头文字贴边（维护者拍板 slice，别改成 clone）。
    boxDecorationBreak: 'slice',
    WebkitBoxDecorationBreak: 'slice',
  }
  return h('div', { 'data-dsh-md-effort-row': '1', style: rowStyle }, [
    h('span', chipProps({
      key: 'eff-all',
      className: 'dsws-chip dsws-hov',
      'data-press': 'chip',
      'data-log': 'list.effort.all',
      onClick: function (e: any) { e.stopPropagation(); st.effFilters = []; emit(st) },
      style: Object.assign({}, chipLayout, mdEffortChipColors(!selected.length)),
    }), tr('list.all')),
    names.map(function (nm: any, i: number) {
      const on: boolean = (selected[0] === nm)
      // md目录签能点（一次只看一个工作单元），给它自己的按压态与点击日志；
      //   定位串用序号（目录名可能是任意字符，进不了定位串）。
      // 悬停与 aria-label 仍给全名：文字被截断或切成两截时，悬停与读屏都能看到完整目录名。
      return h(Tip, { content: nm }, h('span', chipProps({
        key: 'eff-' + nm,
        className: 'dsws-chip dsws-hov',
        'aria-label': nm,
        'data-press': 'chip',
        'data-log': 'list.effort.' + i,
        onClick: function (e: any) {
          e.stopPropagation()
          st.effFilters = on ? [] : [nm]
          emit(st)
        },
        style: Object.assign({}, chipLayout, mdEffortChipColors(on)),
      }), mdEffortLabelOf(nm, measureTextWidth)))
    }),
  ])
}
