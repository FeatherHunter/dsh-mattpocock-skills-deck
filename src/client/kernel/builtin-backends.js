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
/**
 * 内置后端名单的 UI 视图（registry 数据还没到时，界面上那一列选项取它）。
 *
 * 形状与 `wf.registry` 回包里的 modules 对齐（每项至少 id 与 label），所以调用方拿到它就能直接渲染。
 * 为什么要有它：#231 收编时把各处自己抄的「三个后端」名单删掉了，界面那几处改成「registry 数据没到就取这份兜底」；
 *   #669 的真机现场正是踩在这里 —— 状态栏那张初始化小卡在名单还没到的那一档调它，而这个函数当时没有落地，
 *   于是渲染当场抛 ReferenceError、整条状态栏从界面上消失（用户看到的就是「点了黄条，整个胶囊状态栏全没了」）。
 * 回来一份拷贝，免得调用方顺手改到这份共用名单。
 */
export function supportedBackendViews() {
  return otherFiltered(null).map(function (m) { return { id: m.id, label: m.label } })
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
