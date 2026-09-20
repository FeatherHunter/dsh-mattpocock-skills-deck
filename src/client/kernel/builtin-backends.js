/**
 * client/kernel/builtin-backends.js — 内置后端显示名单单源（#231 类别 5 收编）。
 *
 * 契约边界：
 * - 本名单仅作 UI 兜底展示（registry 数据未达时的标签兜底）与「首项 = 默认后端」语义单源；
 * - 后端能力/链接/动作的真源在 host 各后端模块声明（links / capabilities / openRepository /
 *   prompts / linkPatternSource），经 wf.registry 与快照 backendModules 双通道透传；
 * - 本文件是 backendId 字面量的唯一 sanctioned 客户端落点（tests/verify-client-hardcode-gate.js allowlist）。
 */
export const BUILTIN_BACKENDS = [{ id: 'github', label: 'GitHub' }, { id: 'markdown', label: 'Markdown' }, { id: 'gitlab', label: 'GitLab' }]
// #669 第 6 件（ADR 20260921）：今天真正可用的后端只有 GitHub 与本地 Markdown —— GitLab 能力不全
//   （后端模块在，但一批操作返回 unsupported，链上会出现一串红牌，界面上一直标着「筹备中」）。
//   所以它在「切换后端」那张卡上置灰不可选（维护者 2026-09-21 拍板：不让人按到没实现的按钮）。
//   以后 GitLab 补齐了，把它从这个名单里拿掉即可（这份名单只管界面可选性，不参与判定链）。
export const SWITCH_UNAVAILABLE_BACKENDS = ['gitlab']
// 「这个后端今天能不能选」这个问题的唯一一份答案：切换弹窗、面板门控窗、状态栏门控窗三处都问它，
//   #669 第 6 件对抗式审查补（原先只有切换弹窗那处置灰，门控窗照样能选到 GitLab —— 最可能出现的那一屏反而没堵上）。
export function isBackendUnavailable(id) {
  const k = String(id == null ? '' : id).toLowerCase()
  return SWITCH_UNAVAILABLE_BACKENDS.some(function (x) { return String(x).toLowerCase() === k })
}
export function builtinLabelOf(id) {
  const k = String(id == null ? '' : id)
  for (let i = 0; i < BUILTIN_BACKENDS.length; i++) if (BUILTIN_BACKENDS[i].id === k) return BUILTIN_BACKENDS[i].label
  return ''
}
export function otherFiltered(list) {
  const src = (Array.isArray(list) && list.length) ? list : BUILTIN_BACKENDS
  return src.filter(function (m) { return m && m.id && String(m.id).toLowerCase() !== 'other' })
}
export function firstBackendIdOf(list) {
  const f = otherFiltered(list)
  return (f[0] && f[0].id) || ''
}
/** 开仓契约动作解析（#231）：'folder' | 'url' | ''（未声明且无 url 即诚实无动作）。 */
export function repositoryActionOf(st, bid) {
  const mm = moduleMetaOf(st, bid)
  if (mm && mm.openRepository === 'folder') return 'folder'
  return ''
}
/** 当前会话某后端的 UI-lane 描述数据（links/capabilities/openRepository/prompts）；无数据返回 null。 */
export function moduleMetaOf(st, bid) {
  const ms = st && st.backendModules
  if (!Array.isArray(ms) || bid == null) return null
  for (let i = 0; i < ms.length; i++) if (ms[i] && ms[i].id === bid) return ms[i]
  return null
}
