/**
 * client/kernel/builtin-backends.ts — 内置后端显示名单单源（#231 类别 5 收编）。
 *
 * 契约边界：
 * - 本名单仅作 UI 兜底展示（registry 数据未达时的标签兜底）与「首项 = 默认后端」语义单源；
 * - 后端能力/链接/动作的真源在 host 各后端模块声明（links / capabilities / openRepository /
 *   prompts / linkPatternSource），经 wf.registry 与快照 backendModules 双通道透传；
 * - 本文件是 backendId 字面量的唯一 sanctioned 客户端落点（tests/verify-client-hardcode-gate.js allowlist）。
 */
/*
 * 转写注记：本文件原来是手写 JavaScript，按动到哪里转到哪里转成 TypeScript，
 * 真源是这份，同名 JavaScript 是构建产物。转写只加这一处注记与参数的类型标注，
 * 名单内容、函数行为、导出名一字未动。
 */
export const BUILTIN_BACKENDS = [{ id: 'github', label: 'GitHub' }, { id: 'markdown', label: 'Markdown' }, { id: 'gitlab', label: 'GitLab' }]
// #1600（#1188 跟进）：GitLab 能力已补齐，三处窗都不再置灰 —— 名单清空，界面可选性恢复三后端全可选。
//   名单本身保留为空数组：切换弹窗、面板门控窗、状态栏门控窗三处仍问同一份答案，只是今天答案是「都不锁」。
//   名单只管界面可选性，不参与判定链；以后若再有后端能力不全，把它的标识加回这份名单即可。
export const SWITCH_UNAVAILABLE_BACKENDS: string[] = []
// 「这个后端今天能不能选」这个问题的唯一一份答案：切换弹窗、面板门控窗、状态栏门控窗三处都问它。
export function isBackendUnavailable(id: any) {
  const k = String(id == null ? '' : id).toLowerCase()
  return SWITCH_UNAVAILABLE_BACKENDS.some(function (x) { return String(x).toLowerCase() === k })
}
export function builtinLabelOf(id: any) {
  const k = String(id == null ? '' : id)
  for (let i = 0; i < BUILTIN_BACKENDS.length; i++) if (BUILTIN_BACKENDS[i].id === k) return BUILTIN_BACKENDS[i].label
  return ''
}
export function otherFiltered(list: any) {
  const src = (Array.isArray(list) && list.length) ? list : BUILTIN_BACKENDS
  return src.filter(function (m) { return m && m.id && String(m.id).toLowerCase() !== 'other' })
}
export function firstBackendIdOf(list: any) {
  const f = otherFiltered(list)
  return (f[0] && f[0].id) || ''
}
/** 开仓契约动作解析（#231）：'folder' | 'url' | ''（未声明且无 url 即诚实无动作）。 */
export function repositoryActionOf(st: any, bid: any) {
  const mm = moduleMetaOf(st, bid)
  if (mm && mm.openRepository === 'folder') return 'folder'
  return ''
}
/** 当前会话某后端的 UI-lane 描述数据（links/capabilities/openRepository/prompts）；无数据返回 null。 */
export function moduleMetaOf(st: any, bid: any) {
  const ms = st && st.backendModules
  if (!Array.isArray(ms) || bid == null) return null
  for (let i = 0; i < ms.length; i++) if (ms[i] && ms[i].id === bid) return ms[i]
  return null
}
