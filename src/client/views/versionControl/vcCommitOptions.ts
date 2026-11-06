// views/versionControl/vcCommitOptions.ts —— 提交选项展开区（#1877 按 #1876 的原型把提交域六条入口落进插件）
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼回 src/client/index.ts 的 leaf 标记处。
//
// 这一块回答一个问题：「这些入口属于提交这一件事，还是属于对某一笔提交做动作？」
// 判据不是「它动的是哪条提交」，而是「它需不需要再写点什么」。修订、fixup / squash、内容来源、钩子、签名、
// 说明模板都要用输入框里的说明与「已暂存」清单，只有提交区同时看得见这两样，所以它们和形态排在同一块；
// 还原、拣选、撤销改的是已经记下来的提交，点完就完，留在提交行菜单上（那一屏不归本票）。
//
// 四组控件按原型排：提交形态（四颗分段按钮）→ 内容来源（一起提交开关）→ 提交说明（套用模板）→
// 记录方式（跳过钩子 / 签名提交 / 追加签名行）。每组左边一行术语、右边控件与一句后果；窄到 300 档时
// 术语与控件改成上下两行（样式在 vcProtoComposer 的 [data-vc-width="300"] 一段里）。
// 收起时这一块留在 DOM 里但带 hidden：控件与 data-vc-commit-* 钩子一个不少，读屏与 Tab 不会进 hidden 子树。
declare const Tip: any

/** 提交区「储藏」拆分按钮（#1905，原型 98）：主按钮收默认那一种（只收已跟踪的改动），右侧箭头打开
 *  三行菜单，每行写清这一种收什么、对应哪条 git 命令、收完之后工作区是什么样。
 *  为什么放在这一叶：它和提交选项是同一类东西——贴在提交区上的一次展开，不是页面正文；
 *  放在提交页正文里会把那个文件顶过有效行上限，也让「提交选项」这一族多一个没有归属的渲染函数。
 *  菜单用原生 details 开合：它不落盘、不跨挂载保留，为一次展开往页面 ui 里加状态位不划算；
 *  点完一项自己收起（closeMenu），否则菜单会挡着下面的提交区。
 *  stagedGate 是 7.3 的版本门（来自共享规则）：低于 2.35 时那一行不画按钮，改画版本门说明——
 *  「藏起来不等于沉默」是既有产品规矩。 */
export const vcComposerStashSplitOf = function (h: any, t: any, o: any): any {
  const opts = o || {}
  const variants: any[] = [
    { op: 'push', nameKey: 'vc.stash.op.push', detailKey: 'vc.changes.stash.pushDetail', commandKey: 'vc.changes.stash.pushCommand' },
    { op: 'push-untracked', nameKey: 'vc.stash.op.pushUntracked', detailKey: 'vc.changes.stash.pushUntrackedDetail', commandKey: 'vc.changes.stash.pushUntrackedCommand' },
    { op: 'push-staged', nameKey: 'vc.stash.op.pushStaged', detailKey: 'vc.changes.stash.pushStagedDetail', commandKey: 'vc.changes.stash.pushStagedCommand' },
  ]
  // 菜单开合不落盘：用 hidden 属性切换（原生 details 的收起内容在量尺下仍会被算进后代边界，
  // 真浏览器门禁因此判成横向溢出；hidden 直接不参与布局）。点完一项自己收起。
  const menuOf = function (ev: any): any {
    const arrow: any = ev && ev.currentTarget ? ev.currentTarget : null
    const box: any = arrow && typeof arrow.closest === 'function' ? arrow.closest('.composer-stash-split') : null
    return box === null ? null : box.querySelector('.composer-stash-items')
  }
  const closeMenu = function (ev: any): void {
    const menu: any = menuOf(ev)
    if (menu) menu.hidden = true
  }
  const stagedGate: any = opts.stagedGate || null
  const items: any[] = variants.map(function (v: any) {
    if (v.op === 'push-staged' && stagedGate && stagedGate.state === 'hidden') {
      return h('p', { key: v.op, className: 'composer-stash-gate note note-warn', 'data-vc-stash-gate': 'hidden' }, [
        h('span', { key: 'need' }, t('vc.stash.gate.hidden', { needed: String(stagedGate.needed || '') })),
        h('span', { key: 'alt', className: 'composer-stash-gate-alt' }, t(String(stagedGate.alternativeKey || ''))),
      ])
    }
    return h('button', {
      key: v.op, type: 'button', className: 'composer-stash-item',
      'data-vc-stash-op': v.op, 'data-vc-stash-variant': v.op,
      disabled: opts.pending === true,
      'data-press': 'button', 'data-log': 'vc.changes.composer.stash-variant',
      // 提交区没有说明输入框，而宿主要求贮藏说明非空：这里带一句默认说明，否则点了只会回「这次操作没有成功」。
      onClick: function (ev: any) { closeMenu(ev); if (typeof opts.onStash === 'function') opts.onStash({ op: v.op, message: t('vc.changes.stash.defaultMessage') }) },
    }, [
      h('span', { key: 'name', className: 'composer-stash-item-name' }, t(v.nameKey)),
      h('span', { key: 'detail', className: 'composer-stash-item-detail' }, t(v.detailKey)),
      h('span', { key: 'cmd', className: 'composer-stash-item-cmd mono' }, t(v.commandKey)),
    ])
  })
  return h('span', { key: 'stash', className: 'composer-stash-split', 'data-vc-stash-split': '1' }, [
    h('button', {
      key: 'main', type: 'button', className: 'link-btn', 'data-vc-stash-op': 'push',
      title: t('vc.changes.view.composerStashHint'), 'data-press': 'button', 'data-log': 'vc.changes.composer.stash',
      onClick: function () { if (typeof opts.onStash === 'function') opts.onStash({ op: 'push', message: t('vc.changes.stash.defaultMessage') }) },
    }, t('vc.changes.view.composerStash')),
    h('button', {
      key: 'arrow', type: 'button', className: 'composer-stash-arrow',
      title: t('vc.changes.stash.menuTitle'), 'aria-label': t('vc.changes.stash.menuTitle'),
      'aria-expanded': 'false',
      'data-vc-stash-arrow': '1', 'data-press': 'button', 'data-log': 'vc.changes.composer.stash-menu',
      onClick: function (ev: any) {
        const menu: any = menuOf(ev)
        if (!menu) return
        menu.hidden = !menu.hidden
        if (ev && ev.currentTarget && ev.currentTarget.setAttribute) ev.currentTarget.setAttribute('aria-expanded', menu.hidden ? 'false' : 'true')
      },
    }, t('vc.changes.stash.arrow')),
    h('div', { key: 'items', className: 'composer-stash-items', 'data-vc-stash-menu': '1', hidden: true }, [
      h('p', { key: 'hint', className: 'composer-stash-hint' }, t('vc.changes.stash.menuHint')),
    ].concat(items)),
  ])
}


/** 一个开关：方框 + 名字，整行是一颗按钮，键盘只停一次；后果写在悬停提示里，不占面板高度。
 *  item.optAttr / optValue 决定它带哪个 data-vc-commit-* 钩子：「一起提交」与三个记录方式都有各自的钩子。
 *  aria-label 一定显式写：悬停提示走 Tip，而 Tip 在缺 aria-label 时会把提示原文塞进去，读屏念的就不是名字了。 */
function vcCommitOptionSwitch(h: any, item: any, onToggle: any): any {
  const attrs: any = {
    key: item.key, type: 'button', className: 'opt-check' + (item.checked ? ' is-on' : ''),
    role: 'switch', 'aria-checked': item.checked ? 'true' : 'false', 'aria-label': item.label,
    'data-vc-commit-opt-hint': item.hint, disabled: item.disabled === true,
    'data-press': 'button', 'data-log': item.log, onClick: function () { onToggle(item.key) },
  }
  if (item.cap) attrs['data-cap-control'] = item.cap
  if (item.optAttr) attrs[item.optAttr] = item.optValue === undefined ? 1 : item.optValue
  const node = h('button', attrs, [
    h('span', { key: 'box', className: 'opt-box', 'aria-hidden': 'true' }),
    h('span', { key: 'label', className: 'opt-check-label' }, item.label),
  ])
  // 每个开关自己的提示包一层 Tip；key 必须带开关名，三颗开关是兄弟节点，同叫 'tip' 会被 React 警告并丢节点。
  return h(Tip, { key: 'tip-' + item.key, content: item.hint }, node)
}

/** 提交选项展开区本体。所有判定与文案都来自 vcCommitPanelOf 算好的模型，这里只负责画。 */
export function vcCommitOptionsNode(h: any, t: any, o: any): any {
  const opts = o || {}
  const panel = opts.panel || {}
  const ops = opts.ops || null
  const handler = function (name: any) {
    const fn = ops && typeof ops[name] === 'function' ? ops[name] : null
    return fn
  }
  const click = function (name: any, arg?: any) {
    return function () { const fn = handler(name); if (fn) fn(arg) }
  }
  const open = panel.optionsOpen === true
  const kids: any[] = []
  kids.push(h('div', { key: 'head', className: 'opt-head' }, [
    h('span', { key: 'title', className: 'opt-title' }, t('vc.commit.options')),
    h('button', {
      key: 'close', type: 'button', className: 'opt-close', 'aria-label': t('vc.commit.optionsClose'),
      'data-vc-commit-options-close': 1, 'data-press': 'button', 'data-log': 'vc.commit.options.close',
      onClick: click('closeMenu'),
    }, '×'),
  ]))
  // 四组都按「左边一行术语、右边控件与一句后果」排。后果句必须跟在控件下面（原型把 note 放进 opt-body），
  // 不能和 body 平级：.opt-line 是两列网格，平级的 note 会掉进 52 像素宽的术语列里被挤成三行，
  // 整块浮层因此变高、在多档宽下多出滚动条（#1877 真机并排比对时抓到的）。
  const group = function (id: any, key: any, body: any[], note: any): any {
    const bodyKids: any[] = body.slice()
    if (note !== '') bodyKids.push(h('p', { key: 'note', className: 'opt-note', 'data-vc-commit-note': id }, note))
    return h('div', { key: id, className: 'opt-line', 'data-vc-commit-group': id }, [
      h('span', { key: 'key', className: 'opt-key' }, key),
      h('div', { key: 'body', className: 'opt-body' }, bodyKids),
    ])
  }
  // 1) 提交形态：四颗分段按钮。修订与吸收提交要有上一条提交可改，没有时禁用并把理由挂在按钮上。
  const seg: any[] = (panel.forms || []).map(function (m: any) {
    const node = h('button', {
      key: m.form, type: 'button', className: 'opt-seg-btn' + (m.selected ? ' is-on' : ''),
      'aria-pressed': m.selected ? 'true' : 'false', 'aria-label': m.label,
      'data-vc-commit-mode': m.form, 'data-cap-control': m.cap, disabled: m.disabled === true,
      'data-cap-why': m.reasonKey || undefined, 'data-press': 'button', 'data-log': 'vc.commit.form.' + m.form,
      onClick: click('selectForm', m.form),
    }, m.label)
    return h(Tip, { key: 'tip-' + m.form, content: m.tip }, node)
  })
  kids.push(group('form', t('vc.commit.group.form'), [h('div', { key: 'seg', className: 'opt-seg', role: 'group', 'aria-label': t('vc.commit.group.form') }, seg)], String(panel.formNote || '')))
  // 2) 内容来源：一起提交开关（2.2）。工作区没有未暂存改动时禁用，并说明为什么加不进来。
  const allItem = {
    key: 'all', label: t('vc.commit.content.allTracked'), cap: '2.2',
    hint: panel.allTrackedCount === 0 ? t('vc.commit.content.allTrackedEmpty') : t('vc.commit.content.allTrackedNote', { n: String(panel.allTrackedCount) }),
    checked: panel.allTracked === true,
    disabled: panel.allTrackedCount === 0 && panel.allTracked !== true,
    optAttr: 'data-vc-commit-all', log: 'vc.commit.all',
  }
  kids.push(group('content', t('vc.commit.group.content'), [
    vcCommitOptionSwitch(h, allItem, function () { click('toggleAll')() }),
  ], String(panel.contentNote || '')))
  // 3) 提交说明：套用仓库配置的模板；已套用时同一个位置改成「已套用 · 撤销套用」。
  const templateNode = h('button', {
    key: 'template', type: 'button', className: 'opt-link',
    'data-vc-commit-template': 1, 'data-cap-control': '2.8', disabled: panel.templateDisabled === true,
    'aria-label': String(panel.templateLabel || ''), 'data-press': 'button', 'data-log': 'vc.commit.template',
    onClick: click(panel.templateApplied ? 'undoTemplate' : 'applyTemplate'),
  }, String(panel.templateLabel || ''))
  kids.push(group('message', t('vc.commit.group.message'), [
    h(Tip, { key: 'tip-template', content: String(panel.templateNote || '') }, templateNode),
  ], String(panel.templateNote || '')))
  // 4) 记录方式：三颗开关互不影响，各带一句后果（悬停可见）；组尾一句说明它们只影响这一次提交。
  const onToggle = function (key: any) { const fn = handler('toggleOption'); if (fn) fn(key) }
  const records: any[] = (panel.options || []).map(function (item: any) {
    return vcCommitOptionSwitch(h, Object.assign({ optAttr: 'data-vc-commit-opt', optValue: item.key, log: 'vc.commit.opt.' + item.key }, item), onToggle)
  })
  kids.push(group('record', t('vc.commit.group.record'), [h('div', { key: 'records', className: 'opt-records' }, records)], String(panel.optionsNote || '')))
  return h('div', {
    className: 'commit-options', role: 'dialog', 'aria-label': t('vc.commit.options'),
    'data-vc-commit-menu': open ? 'open' : 'closed', 'data-vc-commit-options-panel': 1, hidden: open !== true,
  }, kids)
}

export const VC_COMMIT_OPTIONS_SOURCE = 'src/client/views/versionControl/vcCommitOptions.ts'
