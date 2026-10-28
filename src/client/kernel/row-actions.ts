/**
 * src/client/kernel/row-actions.ts — 行级动作全家（#1286 三态口径 + 八选一标签阶梯）。
 *
 * 为什么单独一片：列表整行、地图详情卡片、工单详情顶栏都要画同一颗「执行/诊断/…」按钮，
 * 文字、颜色、注入文本三样必须同源，所以只此一份实现；原先挤在 store-derived.ts 里，
 * 让那份越过每文件 350 有效行的门禁，本需求按用户授权原样抽出，行为一字不改。
 * 由构建拼进 src/client/index.ts 的同一闭包，位置紧随 store-derived.ts，所以 findMapByIdentity、
 * isLightHex、CONTAINER_ACCENT 等都在作用域内。
 * 反例：不要在这里读快照缓存，也不要在这里拼样式；按钮外观由调用处的类名决定。
 */
declare function findMapByIdentity(...args: any[]): any;
declare function effortOf(...args: any[]): any;
declare function issueUrlFor(...args: any[]): any;
declare function renderTemplate(...args: any[]): any;
declare function startText(...args: any[]): any;
declare function promptText(...args: any[]): any;
declare function tr(...args: any[]): any;
declare function h(...args: any[]): any;
declare const Tip: any;
declare function Ic(...args: any[]): any;
declare function inject(...args: any[]): any;
declare function containerKindOf(...args: any[]): any;
declare function containerStateOf(...args: any[]): any;
declare function containerTriState(...args: any[]): any;
declare function containerPromptText(...args: any[]): any;
declare function isLightHex(...args: any[]): any;
declare const CONTAINER_ACCENT: any;
/** #1286 收口：按身份认出「这一行其实是容器（探索地图 / 实施地图=规格）」，交给容器自己的三态。
  * 为什么不能只按标签判：规格带 ready-for-agent 标签，标签阶梯会把它当实施票，行级动作与
  *   「新会话」就会注入实施票的 /implement；而规格自己的按钮（拆票 / 执行→/implement-spec / 完成）
  *   由 container-view.ts 的三态决定。这里只做身份识别，文字与颜色仍取 container-view.ts 那一份，
  *   避免出现第二份判据。认不出（不是容器、快照里没有、或这些函数不在作用域）就返回空，交回标签阶梯。 */
const containerActionOf = function (st: any, x: any): any {
  try {
    const num: any = (x && (x.number != null ? x.number : x.key))
    const maps: any = (st && st.snapshot && st.snapshot.maps)
    if (num == null || !Array.isArray(maps)) return null
    if (typeof findMapByIdentity !== 'function' || typeof containerKindOf !== 'function' || typeof containerStateOf !== 'function') return null
    const c: any = findMapByIdentity(maps, num, effortOf(x))
    if (!c) return null
    const kind: any = containerKindOf(c)
    if (!kind) return null
    return { c: c, kind: kind, state: containerStateOf(c) }
  } catch (e) { return null }
}
// #771 一处分类（状态优先于类型）：未分流 → 接手 → 补充 → 修复 → 讨论 → 研究 → 原型 → 执行。
//   两枚同时出现取接手；needs-triage 与 needs-info 同时出现仍先诊断（按定义不该同时出现）。
//   四处展示（注入文本 / 行按钮 / 新会话与详情顶栏取色 / 详情顶栏字与悬停）一律调它，不各写一份阶梯。
export const rowActionKind = function (x: any): any {
  const has = function (nm: any): any { return ((x && x.labels) || []).some(function (l: any): any { return (typeof l === 'string') ? l === nm : l.name === nm }) }
  const _isTriageLike: boolean = !(x && x.labels && x.labels.length) || has('needs-triage')
  if (_isTriageLike) return 'diagnose'
  if (has('ready-for-human')) return 'takeover'
  if (has('needs-info')) return 'supplement'
  if (has('bug')) return 'fix'
  if (has('wayfinder:grilling')) return 'discuss'
  if (has('wayfinder:research')) return 'research'
  if (has('wayfinder:prototype')) return 'prototype'
  // #1281：map 里的 task 票和普通兜底票仍走 wayfinder 推进；带 ready-for-agent 的实施票
  //   （to-tickets 拆出来的票）改成「实施」，注入的提示词首行是 /implement。
  //   判断只看标签、不看父子边：to-tickets 的产物按约定就是 ready-for-agent 且不带 wayfinder 标签。
  if (has('wayfinder:task')) return 'execute'
  if (has('ready-for-agent')) return 'implement'
  return 'execute'
}
export const actionColorOf = function (x: any, colorOf: any): any {
  const has = function (nm: any): any { return (x.labels || []).some(function (l: any): any { return (typeof l === 'string') ? l === nm : l.name === nm }) }
  const bc = function (nm: any, fb: any): any { const cc: any = colorOf[nm]; return cc ? '#' + cc : fb }
  const kind: any = rowActionKind(x)
  if (kind === 'diagnose') return bc('needs-triage', '#f59e0b')
  // #785：接手跟 ready-for-human 标签色、补充跟 needs-info 标签色，取不到时兜底探索紫（与 10 个核心标签色均不同）
  if (kind === 'takeover') return bc('ready-for-human', CONTAINER_ACCENT.map)
  if (kind === 'supplement') return bc('needs-info', CONTAINER_ACCENT.map)
  if (kind === 'fix') return bc('bug', '#f87171')
  if (kind === 'discuss') return bc('wayfinder:grilling', '#d93f0b')
  if (kind === 'research') return bc('wayfinder:research', '#0ea5e9')
  if (kind === 'prototype') return bc('wayfinder:prototype', '#f59e0b')
  // #1281：实施票与「规格」同色（贵族蓝），一眼能认出它属于实施地图那一支。
  if (kind === 'implement') return CONTAINER_ACCENT.spec
  return CONTAINER_ACCENT.map
}
// #361：行级动作注入文本的单一真源（诊断/接手/补充/修复/讨论/研究/原型/执行）—— 新会话打开与行内动作共用
export const rowActionText = function (st: any, x: any): any {
  let url: string = ''
  try { url = issueUrlFor(st, x.number, effortOf(x)) } catch(e) { url = '' }
  if (!url) {
    const fallbackKey: any = (x && (x.number != null ? x.number : x.key != null ? x.key : ''))
    if (fallbackKey !== '') url = '#' + String(fallbackKey)
  }
  // #1286 收口：规格与地图自己不是实施票。行级动作（列表行按钮、新会话、票详情顶栏）先认出容器，
  //   取容器三态那一份提示词；认不出才落到下面的标签阶梯（实施票的 /implement 仍然只给实施票）。
  const cont: any = containerActionOf(st, x)
  if (cont) {
    if (typeof containerPromptText === 'function') {
      try { const ct: any = containerPromptText(st, cont.c, cont.kind, cont.state, url); if (ct) return ct } catch (eC) {}
    }
    // 兜底：容器函数不在作用域时（单文件求值）也要给出同一路提示词，不能再落回 /implement。
    if (typeof promptText === 'function') {
      try {
        if (cont.kind === 'spec') {
          if (cont.state === 'empty') return promptText('specSplit', { url: url })
          if (cont.state === 'open') return promptText('specExecute', { url: url })
          const stt: any = (cont.c && cont.c.stats) || {}
          return promptText('specComplete', { url: url, total: String(stt.total || 0), closed: String(stt.closed || 0) })
        }
        return startText(st, cont.c)
      } catch (eP) {}
    }
  }
  const kind: any = rowActionKind(x)
  if (kind === 'diagnose') return renderTemplate('diagnose', { url: url }, st)
  if (kind === 'takeover') return renderTemplate('takeover', { url: url }, st)
  if (kind === 'supplement') return renderTemplate('supplement', { url: url }, st)
  if (kind === 'fix') return renderTemplate('fix', { url: url }, st)
  if (kind === 'discuss') return renderTemplate('discuss', { url: url }, st)
  if (kind === 'research') return renderTemplate('research', { url: url }, st)
  if (kind === 'prototype') return renderTemplate('prototype', { url: url }, st)
  if (kind === 'implement') return promptText('tpl.implement', { url: url })
  try { return startText(st, x) } catch(e) { return renderTemplate('diagnose', { url: url }, st) }
}
// v19：共享 —— 行级动作（列表与 map 详情共用）：按一处分类八选一（诊断/接手/补充/修复/讨论/研究/原型/执行），预填输入框；
// 按钮主体色 = 对应 label 的 GitHub 配置色（字色按对比度在深白两色里择优，见 isLightHex）；接手跟 ready-for-human、补充跟 needs-info（#785），取不到时兜底探索紫
export const mkRowAction = function (st: any, x: any, narrow: any, colorOf: any): any {
  const url: any = issueUrlFor(st, x.number, effortOf(x))
  const kind: any = rowActionKind(x)
  const isLight: any = isLightHex
  const btnColor = function (nm: any, fb: any): any { const c: any = colorOf[nm]; return c ? '#' + c : fb }
  const mk = (icon: any, label: any, text: any, colorHex: any, tipText?: any): any => {
    const light: any = isLight(colorHex)
    const tipByLabel = tipText || (function(): any{
      try {
        if (label === tr('act.diagnose')) return tr('tip.diagnose')
        if (label === tr('act.takeover')) return tr('tip.takeover')
        if (label === tr('act.supplement')) return tr('tip.supplement')
        if (label === tr('act.fix')) return tr('tip.fix')
        if (label === tr('act.discuss')) return tr('tip.discuss')
        if (label === tr('act.research')) return tr('tip.research')
        if (label === tr('act.prototype')) return tr('tip.prototype')
        if (label === tr('act.implement')) return tr('tip.implement')
        if (label === tr('act.execute')) return tr('tip.execute')
      } catch(e){}
      return label
    })()
    return h(Tip, { content: tipByLabel }, h('button', {
      className: 'dsws-btn primary' + (narrow ? ' narrow-icon' : ''),
      // 本次界面反馈需求：这一族「行级主动作」在列表与详情卡里共用，按下反馈沿按钮自身，
      //   点击日志只带票号（视图由日志前后文区分），不把列表/详情两套名字塞进这个共享函数。
      'data-press': 'button',
      'data-log': 'issue.action.' + x.number,
      onClick: function (e: any): void { e.stopPropagation(); inject(st, text) },
      style: { display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 6px', fontSize: 11, flex: 'none', background: colorHex, borderColor: 'transparent', color: light ? '#140a1e' : '#ffffff' },
    }, [Ic({ n: icon, size: icon === 'prototype' ? 12 : 10 }), narrow ? null : h('span', null, label)]))
  }
  // #1286 收口：容器（规格 / 探索地图）自己的按钮文字、颜色与注入文本都按三态取；
  //   规格带 ready-for-agent 标签，按标签阶梯会画成「实施」并注入 /implement，与规格容器口径相反。
  const cont: any = containerActionOf(st, x)
  if (cont) {
    let tri: any = null
    try { tri = (typeof containerTriState === 'function') ? containerTriState(cont.kind, cont.state) : null } catch (eT) {}
    if (tri && tri.labelKey) {
      let tip: any = ''
      try { tip = tr(tri.titleKey) } catch (eTi) { tip = '' }
      const colorHex: any = tri.color || (cont.kind === 'spec' ? CONTAINER_ACCENT.spec : CONTAINER_ACCENT.map)
      return mk(tri.icon, tr(tri.labelKey), rowActionText(st, x), colorHex, tip)
    }
  }
  // v21：技能命令 + URL + 统一引导句（不再重复灌输技能内部流程）
  // v25 · T2b：诊断/修复/讨论走模板渲染（用户可自定义静态文本，{url} 注入）
  if (kind === 'diagnose') return mk('chat', tr('act.diagnose'), rowActionText(st, x), btnColor('needs-triage', '#f59e0b'))
  if (kind === 'takeover') return mk('play', tr('act.takeover'), rowActionText(st, x), btnColor('ready-for-human', CONTAINER_ACCENT.map))
  if (kind === 'supplement') return mk('play', tr('act.supplement'), rowActionText(st, x), btnColor('needs-info', CONTAINER_ACCENT.map))
  if (kind === 'fix') return mk('hammer', tr('act.fix'), rowActionText(st, x), btnColor('bug', '#f87171'))
  if (kind === 'discuss') return mk('chat', tr('act.discuss'), rowActionText(st, x), btnColor('wayfinder:grilling', '#d93f0b'))
  if (kind === 'research') return mk('search', tr('act.research'), rowActionText(st, x), btnColor('wayfinder:research', '#0ea5e9'))
  if (kind === 'prototype') return mk('prototype', tr('act.prototype'), rowActionText(st, x), btnColor('wayfinder:prototype', '#f59e0b'))
  if (kind === 'implement') return mk('hammer', tr('act.implement'), rowActionText(st, x), CONTAINER_ACCENT.spec)
  return mk('play', tr('act.execute'), rowActionText(st, x), CONTAINER_ACCENT.map)
}
