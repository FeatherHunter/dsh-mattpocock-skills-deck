// views/versionControl/vcAiHandoff.js — 「让 AI 帮我解决」：把面板解决不了的事写成 prompt 交给 AI（#854）
// 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回 src/client/index.js。
//
// 人定的三件事：①按钮放在每个「面板解决不了」的提示旁边；②点一下新开同工作区会话并预填三段式 prompt；
//   ③预填好但不自动发送，尾部留白让人补话。新开会话走既有的 openTextInNewSession（#361 那条通路，
//   同 cwd + 预填指令），这里只负责把 prompt 写对、把会话开对；开会话本身的能力与回退都是那条通路的。
// prompt 里不许出现令牌、登录态、远端地址原文 —— 输入本来就是结构化事实（种类、已翻译的句子、分支名、
//   文件名、短编号、远端名），从源头上就没这些东西；宿主原话只取前 300 字当诊断线索。
/** 读失败里哪几档值得交出去（都是「换个地方能动手」的档；配环境那几档不交）。 */
export const VC_AI_READ_FAIL_KINDS = ['exit', 'timeout', 'spawn', 'parse', 'shape']
/**
 * 把一次「面板解决不了」翻成新会话的标题与正文。
 * o: { ai, t, screen }；ai: { kind, summary, detail?, tip?, opText? }（summary/detail 已是翻好的词条句）。
 * 回 null 表示这条不用交出去（kind 空或正文空）。正文里不出现词条键。
 */
export const vcAiHandoffOf = function (o) {
  const ai = (o && o.ai) || {}
  const t = o.t
  const kind = String(ai.kind || '')
  const summary = String(ai.summary || '')
  if (!kind || !summary) return null
  const s = (o && o.screen) || {}
  const id = s.identity || {}
  const branchName = id.branch || (id.detached === true ? t('vc.detached') : '')
  const where = [String(id.worktreeDisplay || ''), branchName].filter(function (x) { return x !== '' }).join(' / ')
  const lines = [t('vc.ai.whatTitle'), summary]
  if (ai.detail) lines.push(String(ai.detail))
  if (where) lines.push(t('vc.ai.where', { where: where }))
  if (id.sync === 'tracked-known') lines.push(t('vc.sync.aheadBehind', { ahead: String(id.ahead || 0), behind: String(id.behind || 0) }))
  if (ai.opText) lines.push(String(ai.opText))
  // 冲突 kind 把卡住的文件列出来（截 10 条；AI 没有清单就只能空谈怎么解）。
  if (kind === 'conflict') {
    const stuck = []
    ;['staged', 'unstaged'].forEach(function (g) {
      (Array.isArray(s[g]) ? s[g] : []).forEach(function (r) { if (r && r.conflict === true && r.path) stuck.push(String(r.path)) })
    })
    stuck.slice(0, 10).forEach(function (p) { lines.push('- ' + p) })
    if (stuck.length > 10) lines.push('\u2026')
  }
  if (ai.tip) lines.push(String(ai.tip).slice(0, 300))
  lines.push('', t('vc.ai.triedTitle'), t('vc.ai.triedBody'), t('vc.ai.boundary'), '', t('vc.ai.tailTitle'), '')
  return { title: t('vc.ai.title'), body: lines.join('\n') }
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
