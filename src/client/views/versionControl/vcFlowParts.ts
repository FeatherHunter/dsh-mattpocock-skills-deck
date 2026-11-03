// views/versionControl/vcFlowParts.ts —— 变基 / 冲突 / 任务三个流程页共用的小部件（#1845）
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼回同一个闭包，跨叶用 declare。
//
// 为什么单独一片叶子：这三个页面都要「状态芯片」「进度条」「贴触发点的提示」三样零件，
// 画法一样、文案来源不同。散在三个页面文件里会各写一遍，塞进 vcPageHead.ts 又会让那个文件只解释页头、
// 装不下流程页的零件。这里只画结构，不决定什么时候出现：可见性由各页自己判断。
// 文字形参一律收词条键（芯片的字、按钮的字、进度读数），叶子内部统一过 t，调用方不拼文案、不写中文。
// 按钮一律 type=button，并按全仓纪律带 data-press（按压形状）与可选 data-log（点下去能定位到是哪一颗）。
//
// 数据属性约定（门禁与容器的事件委托按这些认零件）：
//   data-vc-flow-chip=<tone>       芯片，tone 取 ok / warn / muted / danger
//   data-vc-flow-action=<action>   提示里那颗跳转按钮，action 由调用方给（例如 retry / go）
//   data-vc-flow-meter=<percent>   进度条外壳，值是取整并夹到 0–100 的百分比
//   data-vc-flow-meter-bar=1       进度条填充段，宽度由 style 给
//   data-vc-flow-meter-label=1     进度条右端的读数
//   data-vc-flow-hint=<key>        贴触发点的提示，值是这条说明的词条键

const VC_FLOW_CHIP_TONES = ['ok', 'warn', 'muted', 'danger']

/**
 * 状态芯片：一行里说明「这一步是什么状态」（已完成 / 进行中 / 待处理 / 危险）。
 * 只认四种色调，别的值一律落 muted —— 宁可画成次要，也不让调用方拼出一个没有样式的类名。
 */
export const vcFlowChipNode = function (h: any, t: any, o: any) {
  const opts = o || {}
  const wanted = String(opts.tone || '')
  const tone = VC_FLOW_CHIP_TONES.indexOf(wanted) >= 0 ? wanted : 'muted'
  return h('span', {
    className: 'vcs-flow-chip vcs-flow-chip-' + tone,
    'data-vc-flow-chip': tone,
  }, t(String(opts.key || ''), opts.params))
}

/**
 * 进度条：长任务的百分比读数。percent 不是有限数时按 0 画（真空态该由调用方先判，不要在这里编进度）；
 * 传入的百分比一律取整改夹到 0–100，避免宿主报出 120% 时把填充段撑出边框。
 * labelKey 缺省就不画读数；读数用同一条词条渲染，{percent} 由这里补上，调用方不必自己拼。
 */
export const vcFlowMeterNode = function (h: any, t: any, o: any) {
  const opts = o || {}
  const raw = Number(opts.percent)
  const pct = isFinite(raw) ? Math.max(0, Math.min(100, Math.round(raw))) : 0
  const kids: any[] = [h('div', {
    key: 'bar',
    className: 'vcs-flow-meter-bar',
    'data-vc-flow-meter-bar': '1',
    style: { width: pct + '%' },
  })]
  const labelKey = String(opts.labelKey || '')
  if (labelKey !== '') {
    kids.push(h('span', {
      key: 'label',
      className: 'vcs-flow-meter-label',
      'data-vc-flow-meter-label': '1',
    }, t(labelKey, Object.assign({ percent: pct }, opts.labelParams || {}))))
  }
  return h('div', {
    className: 'vcs-flow-meter',
    'data-vc-flow-meter': String(pct),
    role: 'progressbar',
    'aria-valuenow': String(pct),
    'aria-valuemin': '0',
    'aria-valuemax': '100',
  }, kids)
}

/**
 * 贴触发点的提示：某一步为什么现在不能做、做完这一步之后去哪儿。
 * 原型把它画成琥珀色左边线的一段话，需要时再挂一颗跳转按钮（action 形状同动作条的一项）；
 * 提示本身不是动作，所以整块不带按钮时也成立。
 */
export const vcFlowHintNode = function (h: any, t: any, o: any) {
  const opts = o || {}
  const key = String(opts.key || '')
  const kids: any[] = [h('p', { key: 'text', className: 'vcs-flow-hint-text' }, t(key, opts.params))]
  const action = opts.action
  if (action) {
    const attrs: any = {
      key: 'action',
      type: 'button',
      className: 'vcs-flow-hint-go',
      'data-press': 'button',
      'data-vc-flow-action': String(action.action || ''),
    }
    if (action.log) attrs['data-log'] = String(action.log)
    if (typeof action.onClick === 'function') attrs.onClick = action.onClick
    kids.push(h('button', attrs, t(String(action.key || ''), action.params)))
  }
  return h('div', { className: 'vcs-flow-hint', 'data-vc-flow-hint': key }, kids)
}
