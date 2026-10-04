// views/versionControl/vcWriteView.js —— 写操作的节点画法（#842）
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼回 src/client/index.js 的 leaf 标记处（一源两物）。
//
// 把写操作那几处 DOM 从入口组件里搬出来，好让组件那一份守住 350 行。这些函数都只接「画什么」与
//   几个帮手（h / tone / tipNode / 回调），自己不读状态、不发电话 —— 判定与执行在 vcWrite.js 与 vcWriteOps.js。
// 钩子（门禁按它们断言）：data-vc-stage / data-vc-conflict-terminal / data-vc-actions / data-vc-action /
//   data-vc-stage-all / data-vc-commit-area / data-vc-commit-msg / data-vc-commit-btn /
//   data-vc-running / data-vc-op-result / data-vc-op-text / data-vc-op-limit / data-vc-op-retry /
//   data-vc-confirm / data-vc-confirm-body / data-vc-confirm-ok / data-vc-confirm-cancel / data-vc-remote-pick
export const vcRowStageNodes = function (h, o) {
  const a = o && o.row ? o.row.stageAction : null
  if (!a) return []
  if (a.conflict) {
    return [o.tipNode(a.tip, h('span', { key: 'cterm', 'data-vc-conflict-terminal': 1, style: { flex: 'none', fontSize: 10, color: o.tone('warning'), whiteSpace: 'nowrap' } }, a.text))]
  }
  if (!a.show) return []
  return [o.tipNode(a.tip, h('button', {
    key: 'stage', className: 'dsws-btn', type: 'button', 'data-vc-stage': 1,
    onClick: function (e) { try { e.stopPropagation() } catch (err) { /* 忽略 */ } o.stagePaths([a.path]) },
    style: { flex: 'none', fontSize: 10, padding: '0 6px' },
  }, a.text))]
}

/** 身份行右侧那两颗（拉取 / 推送）：文字走折叠阶梯，完整文字在悬停里。 */
export const vcActionsNode = function (h, o) {
  const a = o && o.actions
  if (!a) return null
  const label = function (key, full) { return (o.foldActions && o.foldActions[key]) || full }
  return h('div', { key: 'actions', 'data-vc-actions': 1, style: { display: 'flex', gap: 6, alignItems: 'center', marginTop: 2 } }, [
    o.tipNode(a.pull.tip || a.pull.text, h('button', { key: 'pull', className: 'dsws-btn', type: 'button', 'data-vc-action': 'pull', disabled: a.pull.disabled === true, onClick: o.startPull, style: { fontSize: 11, padding: '1px 8px', flex: 'none' } }, label('pull', a.pull.text))),
    o.tipNode(a.push.tip || a.push.text, h('button', { key: 'push', className: 'dsws-btn', type: 'button', 'data-vc-action': 'push', disabled: a.push.disabled === true, onClick: function () { o.startPush('') }, style: { fontSize: 11, padding: '1px 8px', flex: 'none' } }, label('push', a.push.text))),
  ])
}

/** changes 标题行右侧那颗「全部暂存」（未暂存计数 > 0 才出现）。 */
export const vcStageAllNode = function (h, o) {
  const s = o && o.stageAll
  if (!s || s.show !== true) return null
  return o.tipNode(s.tip, h('button', {
    key: 'stageAll', className: 'dsws-btn', type: 'button', 'data-vc-stage-all': 1, disabled: s.disabled === true,
    onClick: function () { o.stagePaths(s.paths) }, style: { flex: 'none', fontSize: 11, padding: '1px 8px' },
  }, (o.foldActions && o.foldActions.stageAll) || s.text))
}

/** changes 块底部的提交区（输入框 + 按钮 + 一句说明）。 */
export const vcCommitAreaNode = function (h, o) {
  const c = o && o.commitArea
  if (!c) return null
  return h('div', { key: 'commitArea', 'data-vc-commit-area': 1, style: { marginTop: 8, borderTop: '1px solid var(--dsw-alias-border-l1,#2a2d35)', paddingTop: 6, display: 'flex', flexDirection: 'column', gap: 4 } }, [
    h('input', {
      type: 'text', value: c.value, placeholder: c.placeholder, 'data-vc-commit-msg': 1,
      onChange: function (e) { o.writeMessageOf(e && e.target ? e.target.value : '') },
      style: { boxSizing: 'border-box', width: '100%', fontSize: 11, padding: '3px 6px', borderRadius: 6, border: '1px solid var(--dsw-alias-border-l2,#3a3f4a)', background: 'var(--dsw-alias-bg-layer-3,#0c0e12)', color: 'var(--dsw-alias-label-primary,#e6edf3)' },
    }),
    h('div', { style: { display: 'flex', gap: 6, alignItems: 'center' } }, [
      h('span', { style: { flex: 1, minWidth: 0, fontSize: 10, color: o.tone('caption') } }, c.hint),
      o.tipNode(c.tip || c.text, h('button', {
        className: 'dsws-btn', type: 'button', 'data-vc-commit-btn': 1, disabled: c.disabled === true,
        onClick: o.submitCommit, style: { flex: 'none', fontSize: 11, padding: '1px 8px' },
      }, (o.foldActions && o.foldActions.commit) || c.text)),
    ]),
  ])
}

/** 三块尾巴：执行中那一句、上一次结果、确认框（都在块清单之外，不新增块）。 */
export const vcWriteTailNodes = function (h, o) {
  const w = (o && o.writeState) || {}
  const running = w.op ? h('div', { key: 'running', 'data-vc-running': w.op, style: { fontSize: 11, color: o.tone('accent') } }, o.tr('vc.op.running')) : null
  const result = w.result
    ? h('div', { key: 'result', 'data-vc-op-result': w.result.state, style: { display: 'flex', flexDirection: 'column', gap: 2, fontSize: 11, borderTop: '1px solid var(--dsw-alias-border-l1,#2a2d35)', paddingTop: 6 } }, [
        h('div', { style: { display: 'flex', gap: 6, alignItems: 'baseline' } }, [
          h('span', { key: 'verb', style: { flex: 'none', fontWeight: 700, color: w.result.state === 'done' ? o.tone('success') : o.tone('error') } }, o.tr(w.result.state === 'done' ? 'vc.op.done' : 'vc.op.failed')),
          o.tipNode(w.result.tip, h('span', { key: 'text', 'data-vc-op-text': 1, style: { flex: 1, minWidth: 0 } }, w.result.text)),
          w.result.retryable ? h('button', { key: 'retry', className: 'dsws-btn', type: 'button', 'data-vc-op-retry': 1, onClick: o.retryResult, style: { flex: 'none', fontSize: 10, padding: '0 6px' } }, o.tr('vc.retry')) : null,
        ]),
        w.result.limit ? h('div', { 'data-vc-op-limit': 1, style: { fontSize: 10, color: o.tone('caption'), lineHeight: 1.5 } }, w.result.limit) : null,
      ])
    : null
  const c = w.confirm
  const confirm = c
    ? h('div', { key: 'confirm', 'data-vc-confirm': c.op, style: { border: '1px solid var(--dsw-alias-border-l2,#3a3f4a)', borderRadius: 8, padding: '8px 10px', background: 'var(--dsw-alias-bg-layer-2,#16181d)', display: 'flex', flexDirection: 'column', gap: 6 } }, [
        h('div', { style: { fontSize: 12, fontWeight: 700, color: o.tone('primary') } }, c.title),
        h('div', { 'data-vc-confirm-body': 1, style: { fontSize: 11, color: o.tone('primary'), lineHeight: 1.6 } }, c.body),
        c.pickRemote && c.remotes.length
          ? h('select', { 'data-vc-remote-pick': 1, value: c.remote || 'origin', onChange: function (e) { o.pickRemote(e && e.target ? e.target.value : '') }, style: { fontSize: 11, padding: '2px 6px', borderRadius: 6, border: '1px solid var(--dsw-alias-border-l2,#3a3f4a)', background: 'var(--dsw-alias-bg-layer-3,#0c0e12)', color: 'var(--dsw-alias-label-primary,#e6edf3)' } }, c.remotes.map(function (r) { return h('option', { key: r, value: r }, r) }))
          : null,
        h('div', { style: { display: 'flex', gap: 6, justifyContent: 'flex-end' } }, [
          h('button', { key: 'cancel', className: 'dsws-btn ghost', type: 'button', 'data-vc-confirm-cancel': 1, onClick: o.cancelConfirm, style: { fontSize: 11, padding: '1px 8px' } }, o.tr('vc.confirm.cancel')),
          h('button', { key: 'ok', className: 'dsws-btn primary', type: 'button', 'data-vc-confirm-ok': 1, onClick: o.confirmNow, style: { fontSize: 11, padding: '1px 8px', fontWeight: 700 } }, c.okText),
        ]),
      ])
    : null
  return [running, result, confirm]
}
