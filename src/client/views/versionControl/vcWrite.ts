// views/versionControl/vcWrite.ts —— 写操作的纯规则层（#842）
// 契约：模块真源（ESM 导出）；scripts/build.mts 构建时剥行首 export 拼回 src/client/index.ts 的 leaf 标记处（源码树里只有这一份真源）。
//
// 本文件由同名 .js 转来：只加类型标注（对象表按「变量键取值」标成 Record<string, string>，参数标 any），
// 逻辑、分支条件、字符串、数字、对象键与顺序、函数名与导出名一个字没动。
// 本文件不裸引用闭包里别的叶子（判定用的核心 judge 只被注释提到，真正调用它的是 vcWriteRun），
// 所以这里一条 declare 都不需要。
//
// 这一层只回答四件事，一个中文字面量都没有（可见文字全走词条，键在 kernel/locale-vcwrite.ts）：
//   ① 核心判定（rules.judge 的 verdict / reasons）→ 按钮状态与理由词条键；
//   ② 宿主写失败（WRITE_REASONS 的 25 个稳定标识符 + 传输档 kind）→ 话术族；
//   ③ 三个确认框该写什么（目标只认预检回包里的 plan，绝不自己拆 remote/branch —— 远端名可以含斜杠）；
//   ④ 结果一句话取哪条词条。
// 判定只有一个来源：闭包里拼进来的核心 judge（src/shared/version-control/rules.js）。界面不自己算。

export const VC_WRITE_OPS: string[] = ['stage', 'commit', 'pull', 'push', 'fetch']

/** 判定理由（核心 rules.REASONS 的取值）→ 词条键。是 block 还是 warn 由核心的 verdict 说，界面不自己判。 */
export const VC_BLOCK_KEY: Record<string, string> = {
  'nothing-to-stage': 'vc.block.nothingToStage',
  'nothing-staged': 'vc.block.nothingStaged',
  'conflicts-unresolved': 'vc.block.conflicts',
  'dirty-tree': 'vc.block.dirtyTree',
  'no-upstream': 'vc.block.noUpstream',
  'upstream-gone': 'vc.block.upstreamGone',
  'detached-head': 'vc.block.detachedHead',
  'mid-merge': 'vc.block.midOperation',
  'mid-rebase': 'vc.block.midOperation',
  'mid-cherry-revert': 'vc.block.midOperation',
  'behind-remote': 'vc.block.behindRemote',
  'basis-unknown': 'vc.warn.basisUnknown',
  'bare-repo': 'vc.block.bareRepo',
  'unknown-operation': 'vc.block.unknown',
  'ok': '',
}

/** 一个理由 → 词条键；表里没有的（宿主加过新理由）落到兜底，绝不落到空串。 */
export const vcBlockKeyOf = function (reason: any) {
  const k = VC_BLOCK_KEY[String(reason === undefined || reason === null ? '' : reason)]
  return typeof k === 'string' && k ? k : 'vc.block.unknown'
}

/** 一批理由 → 一串词条键（去重、保序）；'ok' 不进结果。 */
export const vcReasonKeysOf = function (reasons: any) {
  const out: string[] = []
  const list = Array.isArray(reasons) ? reasons : []
  list.forEach(function (r: any) {
    const k = vcBlockKeyOf(r)
    if (k && out.indexOf(k) < 0) out.push(k)
  })
  return out
}

/** 判定 → 按钮状态：只有 block 禁用；warn 可点（理由在确认框里列出来）；allow 可点。 */
export const vcOpStateOf = function (decision: any) {
  const v = decision && decision.verdict ? String(decision.verdict) : 'block'
  return v === 'allow' || v === 'warn' ? 'idle' : 'blocked'
}

/**
 * 推送专用的判定修正：核心的 judge 把「没有上游 / 上游被删」判成 block，但那两条不是「不能推」，
 * 而是「走建上游 / 重建上游那一档、显式带 -u」。宿主预检里也是这么摘的（versionControlCheck.js 那一段），
 * 界面这一侧必须用同一条口径，否则按钮会灰着、而宿主其实允许推。摘完还有别的理由才真挡。
 */
export const vcPushDecisionOf = function (decision: any) {
  const d = decision || {}
  const reasons = (Array.isArray(d.reasons) ? d.reasons : []).filter(function (r: any) { return r !== 'no-upstream' && r !== 'upstream-gone' })
  if (d.verdict === 'block' && reasons.length === 0) return { verdict: 'allow', reasons: [] }
  return { verdict: d.verdict || 'block', reasons: reasons }
}

/** 禁用时悬停里那句话：把理由逐条翻成词条，用「；」连起来（一条都没有时不编话）。 */
export const vcBlockedTipOf = function (decision: any, t: any) {
  const keys = vcReasonKeysOf(decision && decision.reasons)
  return keys.map(function (k: any) { return t(k) }).join('；')
}

/** 宿主写失败：reason（WRITE_REASONS 的 25 个）→ 话术族。 */
export const VC_WRITE_ERR_FAMILY: Record<string, string> = {
  'auth-failed': 'noCredential',
  'rejected-by-server': 'remoteRule',
  'conflict': 'conflict',
  'non-fast-forward': 'notFastForward',
  'ticket-missing': 'stale',
  'ticket-op-mismatch': 'stale',
  'ticket-expired': 'stale',
  'stale-head': 'stale',
  'stale-index': 'stale',
  'stale-repo': 'stale',
  'target-changed': 'stale',
  'bad-paths': 'notReady',
  // #1742 改动页新增的九种理由（共享真源 write-reasons.ts 已登记话术）：形状不对与状态不满足都属 notReady，
  // 只有「确认之后那一块又变了」按 stale 处理——那一条要人重新看一眼，不是重试同一请求。
  'bad-path': 'notReady',
  'hunks-unavailable': 'notReady',
  'hunk-out-of-range': 'stale',
  'nothing-to-do': 'notReady',
  'path-exists': 'notReady',
  'path-modified': 'notReady',
  'ignore-invalid': 'notReady',
  'operation-in-progress': 'notReady',
  'repo-bare': 'notReady',
  'bad-target': 'notReady',
  'need-remote-choice': 'notReady',
  'no-remote': 'notReady',
  'nothing-to-stage': 'notReady',
  'nothing-staged': 'notReady',
  'intent-to-add': 'notReady',
  'fingerprint-unavailable': 'notReady',
  'empty-message': 'notReady',
  'message-too-long': 'notReady',
  'hooks-failed': 'notReady',
  'head-unreadable': 'moved',
  'head-moved': 'moved',
  'unknown-write-failure': 'unknown',
}

/**
 * 传输档（#839 的信封 kind）：reason 落到兜底时按它判族。
 * 词表按宿主真源对齐（gitCredentialExec.js 的 classifyGitFailure 与写电话回包）：args / budget-exhausted /
 *   env / timeout / stalled / spawn-failed / need-credentials / auth-rejected / no-permission / network / other。
 * 「网络」只留真网络的三种；env 与预算/起进程失败是环境问题，别让人去查网络（对抗式审查 6.1）。
 */
export const VC_WRITE_ERR_NETWORK_KINDS: string[] = ['timeout', 'stalled', 'network']
export const VC_WRITE_ERR_KIND_FAMILY: Record<string, string> = {
  'env': 'notReady',
  'spawn-failed': 'notReady',
  'budget-exhausted': 'notReady',
  'need-credentials': 'noCredential',
  'auth-rejected': 'noCredential',
  'no-permission': 'noPermission',
}

export const vcWriteErrFamilyOf = function (reason: any, kind: any) {
  const r = String(reason === undefined || reason === null ? '' : reason)
  if (VC_WRITE_ERR_FAMILY[r]) return VC_WRITE_ERR_FAMILY[r]
  const k = String(kind === undefined || kind === null ? '' : kind)
  if (VC_WRITE_ERR_KIND_FAMILY[k]) return VC_WRITE_ERR_KIND_FAMILY[k]
  if (VC_WRITE_ERR_NETWORK_KINDS.indexOf(k) >= 0) return 'network'
  return 'unknown'
}

/**
 * 预检回包是不是「这个仓库有多个远端，请先选一个」那一档。
 * 形状（总工裁决）：失败信封的顶层 remotes 是候选清单（不是 error.remotes）。
 * 界面据此画一排可点的远端入口；选中之后带 remote 重跑预检。
 */
export const vcRemoteChoiceOf = function (reply: any) {
  const r = reply || {}
  const err = r.error || {}
  const remotes = Array.isArray(r.remotes) ? r.remotes.map(function (x: any) { return String(x) }).filter(function (x: any) { return x !== '' }) : []
  return {
    show: r.ok === false && String(err.reason || '') === 'need-remote-choice' && remotes.length > 0,
    remotes: remotes,
    hint: String(err.hint || err.message || ''),
  }
}

/** 失败信封 → 主句词条键（limit 句 = 这个键 + '.limit'）。 */
export const vcWriteErrKeyOf = function (error: any) {
  return 'vc.writeErr.' + vcWriteErrFamilyOf(error && error.reason, error && error.kind)
}

/**
 * 预检回包的 plan 与界面这一侧的读数对不上时，返回一句诊断（对得上返回空串）。
 * 为什么要有它：确认框里的目标一律以回包为准（远端名可以含斜杠，客户端不许自己拆），
 *   但「回包说的」与「界面上原本显示的」不一致这件事本身要留一条日志（设计 §4：kind=shape）。
 * 只用来记日志，不用来改显示 —— 显示永远跟回包。
 */
export const vcPlanMismatchOf = function (op: any, screen: any, plan: any) {
  const p = plan || {}
  const s = screen || {}
  const identity = s.identity || {}
  const branch = String(identity.branch || '')
  const cur = (Array.isArray(s.branches) ? s.branches : []).filter(function (b: any) { return String(b && b.short) === branch })[0] || null
  const upstream = cur && cur.upstream ? String(cur.upstream) : ''
  if (op === 'pull') {
    if (p.localBranch && branch && String(p.localBranch) !== branch) return 'plan-branch-mismatch'
    if (p.upstream && upstream && String(p.upstream) !== upstream) return 'plan-upstream-mismatch'
    return ''
  }
  if (op === 'push') {
    if (p.localBranch && branch && String(p.localBranch) !== branch) return 'plan-branch-mismatch'
    if (String(p.mode) === 'existing' && upstream && (String(p.remote || '') + '/' + String(p.branch || '')) !== upstream) return 'plan-target-mismatch'
    return ''
  }
  return ''
}

/**
 * 确认框内容模型。目标只认预检回包的 plan；多远端时把候选远端原样带出来（顶层 remotes），
 * 默认 origin 但绝不替用户挑（挑由用户在框里选，选中后重新预检）。
 */
export const vcConfirmOf = function (op: any, plan: any, t: any, remotes: any) {
  const p = plan || {}
  const remote = String(p.remote || '')
  const target = String(p.branch || '')
  const list = Array.isArray(remotes) ? remotes.map(function (x: any) { return String(x) }) : []
  // 上游被删：宿主可能回 mode='recreate'，也可能只给 upstreamGone 布尔（那一档由宿主票补）；两种都按重建上游画。
  const mode = (String(p.mode || '') === 'recreate' || p.upstreamGone === true) ? 'recreate' : String(p.mode || 'existing')
  const base = { op: String(op || ''), mode: mode, remote: remote, target: target, localBranch: String(p.localBranch || ''), remotes: list, pickRemote: false, okText: '' }
  if (op === 'pull') {
    return Object.assign(base, { title: t('vc.confirm.pullTitle'), body: t('vc.confirm.pullBody'), okText: t('vc.action.pull') })
  }
  if (base.mode === 'set-upstream') {
    return Object.assign(base, {
      pickRemote: list.length > 1,
      title: t('vc.confirm.pushSetUpstreamTitle'),
      body: t('vc.confirm.pushSetUpstreamBody', { local: base.localBranch, remote: remote, target: target }),
      okText: t('vc.action.pushSetUpstream'),
    })
  }
  if (base.mode === 'recreate') {
    return Object.assign(base, {
      title: t('vc.confirm.pushRecreateTitle'),
      body: t('vc.confirm.pushRecreateBody', { remote: remote, target: target }),
      okText: t('vc.action.pushRecreate'),
    })
  }
  return Object.assign(base, {
    title: t('vc.confirm.pushTitle'),
    body: t('vc.confirm.pushBody', { remote: remote, target: target }),
    okText: t('vc.action.push'),
  })
}
