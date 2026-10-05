// views/versionControl/vcAiHandoff.js — 「让 AI 帮我解决」：把面板解决不了的事写成 prompt 交给 AI（#854）
// 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回 src/client/index.js。
//
// 人定的三件事：①按钮放在每个「面板解决不了」的提示旁边；②点一下新开同工作区会话并预填 prompt；
//   ③预填好但不自动发送，尾部留目标与补充两行空着让人补话。新开会话走既有的 openTextInNewSession（#361 那条通路，
//   同 cwd + 预填指令），这里只负责把 prompt 写对、把会话开对；开会话本身的能力与回退都是那条通路的。
// 能填的都由面板填（仓库、分支、同步数、改动计数、进行中操作、卡住的文件、想做的操作、看到的话）；
// 只留目标与补充两行给人。prompt 里不写解释，不出现令牌、登录态、远端地址原文 —— 输入本来就是结构化事实（种类、
//   已翻译的句子、分支名、文件名、短编号），从源头上就没这些东西；宿主原话只取前 300 字当诊断线索。
/** 读失败里哪几档值得交出去（都是「换个地方能动手」的档；配环境那几档不交）。 */
export const VC_AI_READ_FAIL_KINDS = ['exit', 'timeout', 'spawn', 'parse', 'shape']
/**
 * 把一次「面板解决不了」翻成新会话的标题与正文。
 * o: { ai, t, screen }；ai: { kind, summary, detail?, tip?, opText? }（summary/detail 已是翻好的词条句）。
 * 回 null 表示这条不用交出去（kind 空或正文空）。正文里不出现词条键，不出现章节符号。
 * 版式：仓库、改动、想做、看到由面板填，目标、补充留白给人；上游名模型里没有就不编。
 */
export const vcAiHandoffOf = function (o) {
  const ai = (o && o.ai) || {}
  const t = o.t
  const kind = String(ai.kind || '')
  const summary = String(ai.summary || '')
  if (!kind || !summary) return null
  const s = (o && o.screen) || {}
  const hasScreen = !!(o && o.screen)
  const id = s.identity || {}
  const repo = s.repo || {}
  const repoName = String(id.worktreeDisplay || '') || (repo.bare === true ? t('vc.other.bare') : '')
  const branchName = id.detached === true ? t('vc.detached') : (String(id.branch || '') || t('vc.other.noBranch'))
  const title = t('vc.ai.title', { branch: branchName })
  const lines = []
  if (repoName || (hasScreen && branchName)) {
    if (id.detached === true) lines.push(t('vc.ai.repoDetached', { repo: repoName, oid: String(id.oid || '').slice(0, 7) }))
    else if (String(id.sync || '') === 'no-upstream') lines.push(t('vc.ai.repoNoUpstream', { repo: repoName, branch: branchName }))
    else if (String(id.sync || '') === 'upstream-gone') lines.push(t('vc.ai.repoUpstreamGone', { repo: repoName, branch: branchName }))
    else if (String(id.sync || '') === 'tracked-known') lines.push(t('vc.ai.repoKnown', { repo: repoName, branch: branchName, ahead: String(id.ahead || 0), behind: String(id.behind || 0) }))
    else if (repoName && branchName) lines.push(t('vc.ai.repoUnknown', { repo: repoName, branch: branchName }))
  }
  if (hasScreen) {
    const midos = []
    if (repo.merging === true) midos.push(t('vc.ai.midopMerge'))
    if (repo.rebasing === true) midos.push(t('vc.ai.midopRebase'))
    if (repo.cherryPicking === true) midos.push(t('vc.ai.midopCherry'))
    if (repo.reverting === true) midos.push(t('vc.ai.midopRevert'))
    const sep = t('vc.ai.midopNone') === 'none' ? ', ' : '、'
    lines.push(t('vc.ai.changes', { staged: String(s.stagedCount || 0), unstaged: String(s.unstagedCount || 0), conflicts: String(s.conflictCount || 0), midop: midos.length ? midos.join(sep) : t('vc.ai.midopNone') }))
  }
  lines.push(t('vc.ai.intent', { op: ai.opText ? String(ai.opText) : t('vc.ai.intentDefault') }))
  let seen = summary
  const detail = ai.detail ? String(ai.detail) : ''
  if (detail && detail !== summary) seen += ' ' + detail
  const tip = ai.tip ? String(ai.tip).slice(0, 300) : ''
  if (tip && seen.indexOf(tip) < 0) seen += (seen ? ' ' : '') + tip
  lines.push(t('vc.ai.seen', { text: seen }))
  // 冲突 kind 把卡住的文件列出来（截 10 条；AI 没有清单就只能空谈怎么解）。
  if (kind === 'conflict') {
    const stuck = []
    ;['staged', 'unstaged'].forEach(function (g) {
      (Array.isArray(s[g]) ? s[g] : []).forEach(function (r) { if (r && r.conflict === true && r.path) stuck.push(String(r.path)) })
    })
    stuck.slice(0, 10).forEach(function (p) { lines.push('- ' + p) })
    if (stuck.length > 10) lines.push('\u2026')
  }
  lines.push(t('vc.ai.goal'), t('vc.ai.extra'))
  return { title: title, body: lines.join('\n') }
}
/** 交出去的那个按钮（o: { ai, tr, onOpen }；没有 ai 描述就不画）。 */
export const vcAiButtonNode = function (h, o) {
  const ai = (o && o.ai) || null
  if (!ai || !ai.kind) return null
  return h('button', { key: 'ai', className: 'dsws-btn', type: 'button', 'data-vc-ai': String(ai.kind), onClick: function () { o.onOpen(ai) }, style: { fontSize: 10, padding: '0 6px', flex: 'none' } }, o.tr('vc.action.aiHandoff'))
}
/** 按约定的形状开新会话（o: { opener, st, handoff }）；opener 缺席或抛错都回 false，不崩。 */
export const vcOpenAiHandoff = function (o) {
  const opener = o && o.opener
  const handoff = o && o.handoff
  if (typeof opener !== 'function' || !handoff || !handoff.body) return false
  try { opener(o.st, handoff.body, handoff.title, { kind: 'fix' }) } catch (e) { return false }
  return true
}
