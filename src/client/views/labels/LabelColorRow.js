/**
 * views/labels/LabelColorRow.js — 标签配色弹窗里的一行（#621 新增）
 *
 * 一行 = 色块 + 标签名 + 颜色值输入框；没配色的标签，色块是灰的、输入框空着，
 * 空着的输入框用「未配色」当占位提示。
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
 * 最后把后端原话原样接上——用户要能分辨是自己填错了、账号没权限、还是插件这边的限制。
 */
export const LabelColorRow = (props) => {
  const cx = React.useContext(DswsCtx)
  const h = cx ? cx.h : React.createElement
  const row = props.row || { name: '', color: '' }
  const text = props.text === null || props.text === undefined ? '' : String(props.text)
  const narrow = !!props.narrow
  const result = props.result || null
  // 没填完的两种情形（写错了字、或把原本有颜色的格子清空了）由纯函数一处判定，弹窗那边用同一个函数决定保存按钮亮不亮。
  const incomplete = lcRowIncomplete(row, text)
  // 色块显示哪一个值：用户填的能用就用用户填的，其次用这一行现在的颜色，都没有就是中性灰占位。
  const shown = isColor(text) ? lcToDisplay(text) : (isColor(row.color) ? lcToDisplay(row.color) : LC_PLACEHOLDER_COLOR)
  const onText = function (e) { if (typeof props.onChangeText === 'function') props.onChangeText(row.name, e && e.target ? e.target.value : '') }
  const onPick = function (e) { if (typeof props.onChangeText === 'function') props.onChangeText(row.name, e && e.target ? e.target.value : '') }
  // 离开输入框时收成界面的统一写法（带井号的小写六位）：用户写 8B5CF6、#8B5CF6 都收成 #8b5cf6。
  // 只在值确实合法时才收（isColor 为真），不合法就原样留着让用户自己改——静默改写会把用户填错的东西藏起来。
  const onBlur = function () { if (isColor(text) && typeof props.onChangeText === 'function') props.onChangeText(row.name, lcToDisplay(text)) }
  const inputStyle = { width: narrow ? 92 : 108, flex: 'none', padding: '3px 6px', borderRadius: 6, border: '1px solid ' + (incomplete ? 'rgba(248,113,113,.6)' : 'var(--dsw-alias-border-l1,#2a2d35)'), background: 'var(--dsw-alias-bg-layer-1,#10131a)', color: 'var(--dsw-alias-label-primary,#e6edf3)', fontSize: 11.5, fontFamily: 'Consolas,Menlo,monospace', colorScheme: 'light dark' }
  const failText = result && !result.ok ? [
    h('div', { key: 'lead', style: { fontWeight: 600 } }, tr('lc.rowFailed')),
    h('div', { key: 'kind' }, tr(lcKindKey(result.kind))),
    result.message ? h('div', { key: 'raw', style: { opacity: 0.85, wordBreak: 'break-word' } }, tr('lc.backendSaid', { msg: result.message })) : null,
  ] : null
  return h('div', { 'data-lc-row': row.name, style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '5px 0', borderTop: '1px solid var(--dsw-alias-border-l1,#2a2d35)' } }, [
    h(Tip, { key: 'sw', content: tr('lc.swatchTip') }, h('input', {
      type: 'color',
      value: shown,
      onChange: onPick,
      'aria-label': tr('lc.colorValue') + ': ' + row.name,
      style: { width: 22, height: 22, flex: 'none', padding: 0, border: '1px solid var(--dsw-alias-border-l1,#2a2d35)', borderRadius: 4, background: 'transparent', cursor: 'pointer', colorScheme: 'light dark' },
    })),
    h('span', { key: 'name', style: { flex: '1 1 120px', minWidth: 0, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, row.name),
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
    result && result.ok ? h('span', { key: 'ok', style: { flex: 'none', fontSize: 11, color: '#4ade80' } }, '✓') : null,
    incomplete ? h('span', { key: 'bad', style: { flex: '1 1 100%', fontSize: 10.5, color: '#f87171' } }, tr('lc.hexFormat')) : null,
    failText ? h('div', { key: 'fail', style: { flex: '1 1 100%', fontSize: 11, lineHeight: 1.6, color: '#f87171', background: 'rgba(248,113,113,.08)', border: '1px solid rgba(248,113,113,.3)', borderRadius: 6, padding: '5px 8px' } }, failText) : null,
  ])
}
