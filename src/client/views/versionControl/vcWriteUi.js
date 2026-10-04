// views/versionControl/vcWriteUi.js —— 写操作的画法层（#842）
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼回 src/client/index.js 的 leaf 标记处（一源两物）。
//
// 这一层把「规则 + 判定 + 界面状态」收成组件要画的那几个模型（一个中文字面量都没有，全走词条）：
//   ops        四个动作各自的可点/禁用与悬停理由（判定来自核心 judge，界面不自己算）
//   actions    身份行右侧那两颗（拉取 / 推送）
//   stageAll   changes 标题行右侧那颗（未暂存计数 > 0 才出现）
//   commitArea changes 块底部的提交区（输入框 + 按钮；无暂存时禁用）
//   confirm    确认框模型（三档推送 + 拉取；目标只认预检回包）
//   result     上一次执行的结果一句话（done / failed）
export const vcRowStageOf = function (row, t) {
  const conflict = !!(row && row.conflict === true)
  const unstaged = !!(row && row.group === 'unstaged')
  return {
    show: !conflict && unstaged,
    conflict: conflict,
    text: conflict ? t('vc.row.conflictTerminal') : (unstaged ? t('vc.action.stage') : ''),
    tip: conflict ? t('vc.band.terminalTip') : (unstaged ? t('vc.action.stage') : ''),
    path: String((row && row.path) || ''),
  }
}

export const vcWriteUiOf = function (screen, ui, env) {
  const t = env.t
  const w = (ui && ui.write) || {}
  const decisions = (env && env.decisions) || {}
  const ops = {}
  VC_WRITE_OPS.forEach(function (op) {
    // 推送那一条要先摘掉「没有上游 / 上游被删」：它们不是不能推，而是走建/重建上游那一档。
    const d = op === 'push' ? vcPushDecisionOf(decisions[op]) : decisions[op]
    const state = vcOpStateOf(d)
    ops[op] = {
      state: state,
      disabled: state === 'blocked',
      tip: state === 'blocked' ? vcBlockedTipOf(d, t) : '',
      reasons: vcReasonKeysOf(d && d.reasons).map(function (k) { return t(k) }),
    }
  })
  const running = String(w.op || '')
  const result = w.result || null
  const s = screen || {}
  const staged = Math.max(0, Number(s.stagedCount) || 0)
  const unstaged = Math.max(0, Number(s.unstagedCount) || 0)
  const rows = vcFileRowsOf(s)
  const stagePaths = rows.filter(function (r) { return r.group === 'unstaged' && r.conflict !== true }).map(function (r) { return r.path })
  const busy = running !== ''
  return {
    ops: ops,
    running: running,
    runningText: busy ? t('vc.op.running') : '',
    result: result
      ? {
          text: t(result.key, result.params),
          limit: result.limitKey ? t(result.limitKey) : '',
          tip: String(result.tip || ''),
          retryable: result.retryable === true,
          failed: String(result.state) === 'failed',
          moved: result.moved === true,
        }
      : null,
    actions: {
      pull: { op: 'pull', text: t('vc.action.pull'), disabled: busy || ops.pull.disabled, tip: ops.pull.tip },
      push: { op: 'push', text: t('vc.action.push'), disabled: busy || ops.push.disabled, tip: ops.push.tip },
    },
    stageAll: {
      show: unstaged > 0,
      text: t('vc.action.stageAll'),
      paths: stagePaths,
      disabled: busy,
      tip: t('vc.action.stageAll'),
    },
    commitArea: {
      value: String(w.message || ''),
      placeholder: t('vc.commitArea.placeholder'),
      hint: t('vc.commitArea.hint'),
      text: t('vc.action.commit', { n: String(staged) }),
      // 无暂存内容、或判定说这一步做不了、或正在执行：按钮禁用。
      disabled: busy || staged === 0 || ops.commit.disabled,
      tip: ops.commit.tip,
    },
    confirm: w.confirm ? vcConfirmOf(w.confirm.op, w.confirm.plan, t, w.confirm.remotes) : null,
  }
}
