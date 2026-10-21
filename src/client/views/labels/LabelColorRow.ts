/**
 * views/labels/LabelColorRow.ts — 标签配色弹窗里的一行（#621 新增）
 *
 * 一行 = 色块 + 标签名 + 颜色值输入框；没配色的标签，色块是灰的、输入框空着，
 * 空着的输入框用「未配色」当占位提示。
 *
 * 保存成功后那颗绿勾（#630 改法）：它是**输入框内侧右端的尾巴**——勾和输入框包在同一个定位框里，
 * 勾绝对定位贴在输入框右边内侧、上下用弹性盒居中。这样勾既不会甩到这一行的最右边（原来它是行尾的
 * 一个独立元素，把输入框也一起挤左、还压在右侧滚动条那一带），也不会比输入框低半截；所有行的输入框
 * 左右边界因此完全对齐。有勾的那一行，输入框的内容宽减 15 像素、右内边距加 15 像素，外框宽度不变。
 *
 * 两个取色控件并存，各管一段：
 *   - 色块本身就是浏览器原生的 <input type="color">，点它弹出系统取色盘（已实测可用）。
 *     它给出来的是**带井号的小写六位**（例如 #8b5cf6），存进草稿前由 lcToDisplay 收口。
 *     没配色的行原生控件不接受空值，色块拿一个中性灰当占位色，点开取色盘时从灰开始。
 *   - 输入框接受带井号或不带井号的写法（大小写随意），要是不合六位十六进制的规矩，
 *     当场在这行下面出一句提示，不静默改成黑色、也不替用户改值；到底收不收由后端裁决。
 *     （#617 交接要求：原生取色盘之外补一个十六进制输入框；「一排预置色块」本图不做。）
 *
 * 失败的行在这行下面逐条说清楚：先是「这一条没保存成功」，再一句按错误档位写的人话，
 * 最后把后端返回的说明原样接上——用户要能分辨是自己填错了、账号没权限、还是插件这边的限制。
 *
 * 本文件由同名 .js 转成 TypeScript（#1253）：只加类型标注与下面这些说明，逻辑、分支条件、
 * 字符串、数字、对象键与次序、函数名与导出名一字未动。契约照旧不能改：本文件是模块真源
 * （ESM 导出），scripts/build.mts 构建时剥掉行首 export 后拼进 src/client/index.ts 的客户端闭包
 * （源码树里只有这一份真源）；模块说明符保持 .js 后缀，由 scripts/ts-hook.mts 改指同名 .ts。
 * 另有一条不能破的约定：本组件会被 tests/verify-label-color-core.ts 单独摘出来编译、只注入固定
 *   几个依赖（compileFn），多一个运行时自由变量就会在渲染这一行时炸——所以下面的 declare 一律是
 *   **只给类型检查看的形状声明**，转译时整段抹掉，不会变成运行时要去找的自由变量。
 */
/**
 * 闭包环境声明（类型检查时才看，转译时整段抹掉，真机上有值）：
 * 下面这些名字不在本文件里定义，是构建按 build.mjs 的次序把别的叶子拼进同一个函数作用域
 * 带进来的，这里只声明形状、不参与转译。React / DswsCtx / tr 由 src/client/ts-pixel-ambient.d.ts
 * 统一声明，这里不重复声明。
 */
/** 悬停提示组件（别的叶子拼进同一闭包，真机上有值）。 */
declare const Tip: any;
/** 六位十六进制色值的判据（labelColorErrors.ts 导出）。 */
declare function isColor(...args: any[]): any;
/** 把色值收成界面统一写法「带井号的小写六位」（labelColorErrors.ts 导出）。 */
declare function lcToDisplay(...args: any[]): any;
/** 这一行填得完不完整的判据（labelColorErrors.ts 导出）。 */
declare function lcRowIncomplete(...args: any[]): any;
/** 错误档位对应的词条键（labelColorErrors.ts 导出）。 */
declare function lcKindKey(...args: any[]): any;
/** 没配色时色块用的中性灰占位色（labelColorErrors.ts 导出）。 */
declare const LC_PLACEHOLDER_COLOR: any;

export const LabelColorRow = (props: any) => {
  const cx = React.useContext(DswsCtx)
  const h = cx ? cx.h : React.createElement
  const row = props.row || { name: '', color: '' }
  const text = props.text === null || props.text === undefined ? '' : String(props.text)
  const narrow = !!props.narrow
  const result = props.result || null
  // 行序号由父组件按渲染次序传进来：行名是用户自己的标签名、不能进 data-log，序号才是同屏可区分的稳定标识。
  const rowIndex = typeof props.rowIndex === 'number' ? props.rowIndex : 0
  // 没填完的两种情形（写错了字、或把原本有颜色的格子清空了）由纯函数一处判定，弹窗那边用同一个函数决定保存按钮亮不亮。
  const incomplete = lcRowIncomplete(row, text)
  // 色块显示哪一个值：用户填的能用就用用户填的，其次用这一行现在的颜色，都没有就是中性灰占位。
  const shown = isColor(text) ? lcToDisplay(text) : (isColor(row.color) ? lcToDisplay(row.color) : LC_PLACEHOLDER_COLOR)
  const onText = function (e: any) { if (typeof props.onChangeText === 'function') props.onChangeText(row.name, e && e.target ? e.target.value : '') }
  const onPick = function (e: any) { if (typeof props.onChangeText === 'function') props.onChangeText(row.name, e && e.target ? e.target.value : '') }
  // 离开输入框时收成界面的统一写法（带井号的小写六位）：用户写 8B5CF6、#8B5CF6 都收成 #8b5cf6。
  // 只在值确实合法时才收（isColor 为真），不合法就原样留着让用户自己改——静默改写会把用户填错的东西藏起来。
  const onBlur = function () { if (isColor(text) && typeof props.onChangeText === 'function') props.onChangeText(row.name, lcToDisplay(text)) }
  // 这一行要不要挂那颗绿勾（后端刚返回结果里这一行成功了）
  const okMark = !!(result && result.ok)
  // 输入框外框宽度 = 内容宽 + 左右内边距 12 + 左右描边 2（默认 content-box 算法）。
  // 有勾的那一行把内容宽减 15、右内边距加 15（3px 21px 3px 6px）——外框宽度与没勾的行一模一样，
  // 勾不占行的宽度，各行输入框右缘因此始终对齐。
  const boxW = narrow ? 92 : 108
  const inputStyle: Record<string, any> = { width: okMark ? boxW - 15 : boxW, flex: 'none', padding: okMark ? '3px 21px 3px 6px' : '3px 6px', borderRadius: 6, border: '1px solid ' + (incomplete ? 'rgba(248,113,113,.6)' : 'var(--dsw-alias-border-l1,#2a2d35)'), background: 'var(--dsw-alias-bg-layer-1,#10131a)', color: 'var(--dsw-alias-label-primary,#e6edf3)', fontSize: 11.5, fontFamily: 'Consolas,Menlo,monospace', colorScheme: 'light dark' }
  // #1111：这一行的失败说明分三块——给人看的一句话（后端写的 message）、可选档位小标签、可逐字核对的后端原文。
  // 原文默认收起（可能很长），点开才看；没有原文就不渲染这一块，不摆空框。原文由 lcSaveOutcome 一路带进行对象，
  // 旧形状把原文放在 error 里（只认字符串）。就地取、不调跨文件的 lcRawOf：本组件会被测试单独摘出来编译、
  // 只注入固定几个依赖（见 tests/verify-label-color-core.ts 的 compileFn），多一个自由变量就会在渲染这一行时炸。
  const rawText = String((result && result.raw) || (result && typeof result.error === 'string' ? result.error : '') || '').trim()
  const failText = result && !result.ok ? [
    h('div', { key: 'lead', style: { fontWeight: 600 } }, tr('lc.rowFailed')),
    h('div', { key: 'kind' }, tr(lcKindKey(result.kind))),
    result.message ? h('div', { key: 'said', style: { opacity: 0.85, wordBreak: 'break-word' } }, tr('lc.backendSaid', { msg: result.message })) : null,
    rawText ? h('details', { key: 'raw', style: { marginTop: 2 } }, [
      // 折叠条是「点一下就展开」的整条控件：接 row 与带行序号的唯一日志，另加 dsws-hov 拿悬停提亮。
      h('summary', { className: 'dsws-hov', 'data-press': 'row', 'data-log': 'lc.row.raw.toggle.' + rowIndex, style: { opacity: 0.85, cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, tr('vc.fail.raw', { msg: rawText })),
      h('div', { style: { marginTop: 3, padding: '4px 6px', border: '1px solid var(--dsw-alias-border-l1,#2a2d35)', borderRadius: 4, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 160, overflow: 'auto' } }, rawText),
    ]) : null,
  ] : null
  return h('div', { 'data-lc-row': row.name, style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '5px 0', borderTop: '1px solid var(--dsw-alias-border-l1,#2a2d35)' } }, [
    // 色块是原生取色控件，点它弹出系统取色盘：它只有色块那么大，是纯图标尺寸的控件，只接 data-press（按下压暗），
    // 不接 dsws-hov——按下时整颗色块下沉一格会跟旁边的输入框错开，看着像布局歪了。
    h(Tip, { key: 'sw', content: tr('lc.swatchTip') }, h('input', {
      type: 'color',
      value: shown,
      onChange: onPick,
      'data-press': 'icon',
      'data-log': 'lc.row.swatch.' + rowIndex,
      'aria-label': tr('lc.colorValue') + ': ' + row.name,
      style: { width: 22, height: 22, flex: 'none', padding: 0, border: '1px solid var(--dsw-alias-border-l1,#2a2d35)', borderRadius: 4, background: 'transparent', cursor: 'pointer', colorScheme: 'light dark' },
    })),
    h('span', { key: 'name', style: { flex: '1 1 120px', minWidth: 0, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, row.name),
    // 输入框与勾包在同一个定位框里：勾贴在输入框右内侧（right:6），上下各顶到框边、由弹性盒居中，
    // 所以它的垂直中心永远等于输入框的垂直中心。pointerEvents none：勾不吃点击，点它等于点输入框。
    h('span', { key: 'hexwrap', 'data-lc-hexwrap': 1, style: { position: 'relative', display: 'inline-flex', flex: 'none' } }, [
      h('input', {
        key: 'hex',
        type: 'text',
        value: text,
        placeholder: tr('lc.uncolored'),
        spellCheck: false,
        onChange: onText,
        onBlur: onBlur,
        'aria-label': tr('lc.colorValue') + ': ' + row.name,
        style: inputStyle,
      }),
      okMark ? h('span', { key: 'ok', 'data-lc-ok': 1, style: { position: 'absolute', right: 6, top: 0, bottom: 0, display: 'flex', alignItems: 'center', pointerEvents: 'none', fontSize: 11, lineHeight: 1, color: '#4ade80' } }, '✓') : null,
    ]),
    incomplete ? h('span', { key: 'bad', style: { flex: '1 1 100%', fontSize: 10.5, color: '#f87171' } }, tr('lc.hexFormat')) : null,
    failText ? h('div', { key: 'fail', style: { flex: '1 1 100%', fontSize: 11, lineHeight: 1.6, color: '#f87171', background: 'rgba(248,113,113,.08)', border: '1px solid rgba(248,113,113,.3)', borderRadius: 6, padding: '5px 8px' } }, failText) : null,
  ])
}
