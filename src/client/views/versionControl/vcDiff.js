// views/versionControl/vcDiff.js — 一处差异该怎么画（#818；#819 审查后从 vcBlocks 拆出，那个文件贴着 350 行）
// 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回 src/client/index.js
//   的 leaf 标记处（一源两物）。纯规则：喂进一份按需读数（宿主 wf.gitDiff 的回包形状）与词条函数，
//   回「这一处该画什么」。不画界面、不打电话。
//
// 三条边界都在这里落：
//   · 读不到就说读不到（loading / err 各一支，err 带重试）；
//   · 「没有内容」的六种原因各说各的实话（未跟踪 / 零提交 / 二进制 / 太大 / 空差异 / 合并提交），
//     绝不混成一句「没有改动」——合并提交那句尤其不许落到「这一处这次没读到改动内容」上；
//   · 差异太长（超过 VC_DIFF_LINES_SHOWN 行）时先说「哪几段行区间变了」，再给前 N 行，
//     并如实写「只显示了前 N 行」；正好等于阈值时不补这句（用户点开就看到全部）。
/** 差异最多就地画多少行；更多的先给行区间，再给头一段，并如实说只显示了前多少行。 */
export const VC_DIFF_LINES_SHOWN = 200
/** 差异那几种「没有内容」的原因 → 词条键（宿主 reason 字段的原样取值）。 */
export const VC_DIFF_REASON_KEY = {
  'untracked-no-diff': 'vc.diff.untracked',
  'no-commit-baseline': 'vc.diff.noBaseline',
  'no-diff': 'vc.diff.empty',
  'binary-diff': 'vc.diff.binary',
  'truncated': 'vc.diff.tooBig',
  // 合并提交：git show -p 默认不展开组合差异，所以这一处本来就没有内容 —— 这不是「读不到」，
  //   是 git 不展开合并提交（宿主用 reason:'merge-commit' 与「空提交」的 'no-diff' 分开说）。
  'merge-commit': 'vc.diff.mergeCommit',
}
/** 一处差异该画什么：行、要截断时先说「哪几段行区间变了」、以及一句「只显示了前 N 行」。 */
export const vcDiffViewOf = function (entry, t, scopeKey) {
  // scopeKey：这一处差异指的是哪一段（未提交那一层是「相对上一次提交的全部改动」，含已暂存与未暂存两部分）。
  //   不写清范围，用户会以为「已暂存」组里点开的差异就是「将要提交的那一部分」。
  const scopeText = scopeKey ? t(scopeKey) : ''
  const e = entry || { state: 'idle' }
  if (e.state === 'idle' || (e.state === 'loading' && !e.lines)) return { state: 'loading', text: t('vc.diff.loading') }
  if (e.state === 'err' && !e.lines) return { state: 'err', text: t('vc.diff.fail'), retry: t('vc.retry') }
  const raw = Array.isArray(e.lines) ? e.lines : []
  const reason = String(e.reason || 'ok')
  if (reason !== 'ok') {
    const key = VC_DIFF_REASON_KEY[reason]
    return { state: 'note', text: key ? t(key) : t('vc.diff.empty'), stale: e.state === 'err', retry: e.state === 'err' ? t('vc.retry') : '' }
  }
  const hunkLines = []
  raw.forEach(function (l) { if (l && l.kind === 'hunk') hunkLines.push(String(l.text || '')) })
  const long = raw.length > VC_DIFF_LINES_SHOWN
  return {
    state: 'ok',
    lines: raw.slice(0, VC_DIFF_LINES_SHOWN),
    total: raw.length,
    scopeText: scopeText,
    hunks: long ? hunkLines : [],
    hunksTitle: t('vc.diff.hunksTitle'),
    shownNote: long ? t('vc.diff.shownHead', { n: String(VC_DIFF_LINES_SHOWN) }) : '',
    stale: e.state === 'err',
    retry: e.state === 'err' ? t('vc.retry') : '',
  }
}
