// src/shared/deck-tools/session-resolve.js —— 会话目录异步归一（934：工作区钥匙单源）
// 住共享层，供九个工具（宿主层）直接引用；宿主→共享允许，不新增宿主层内部边。
// 本文件零导入（共享层互引门禁），自带最小字符串与散列工具，与 shell.js 同款一行实现。
// 归一出口 canonicalKey 由宿主注入（归一加锚根唯一实现）；缺席时沿用原始目录（旧门禁兼容）。
// 归一在场却算不出规范根时如实失败，不凑钥匙。
function str(v) { return (typeof v === 'string') ? v : '' }
function hash8(t) { let h = 5381; const s = String(t || ''); for (let i = 0; i < s.length; i++) h = (((h << 5) + h + s.charCodeAt(i)) >>> 0); return ('0000000' + h.toString(16)).slice(-8) }
const NO_SESSION = 'no-session-context'
export function sessionContextOf(exec, deps) {
  const e = exec || {}; const d = deps || {}; const agent = e.agent || {}; const session = agent.session || e.session || null
  const cands = [{ where: 'exec.agent.session.cwd', value: session && session.cwd }, { where: 'exec.agent.session.workspaceRoot', value: session && session.workspaceRoot }, { where: 'exec.agent.session.workspace.cwd', value: session && session.workspace && session.workspace.cwd }, { where: 'exec.agent.cwd', value: agent.cwd }, { where: 'exec.session.cwd', value: e.session && e.session.cwd }, { where: 'exec.cwd', value: e.cwd }]
  let cwd = ''; let source = ''
  for (const c of cands) { if (typeof c.value === 'string' && c.value.trim()) { cwd = c.value.trim(); source = c.where; break } }
  const sessionId = str(session && (session.id || session.sessionId)) || str(agent.sessionId)
  if (!cwd) return { ok: false, reason: NO_SESSION, sessionId, text: '这次没拿到当前会话的工作区目录，所以我不动任何票。' }
  const key = typeof d.workspaceKeyOf === 'function' ? String(d.workspaceKeyOf(cwd)) : ('ws-' + hash8(cwd))
  return { ok: true, cwd, workspaceKey: key, sessionId, source, text: '' }
}
export async function sessionContextOfAsync(exec, deps) {
  const base = sessionContextOf(exec, deps || {})
  if (!base.ok) return base
  const d = deps || {}; const raw = base.cwd
  if (typeof d.canonicalKey !== 'function') return base
  let canon = ''
  try { canon = await d.canonicalKey(raw) } catch (e) { canon = '' }
  if (typeof canon !== 'string' || !canon.trim()) return { ok: false, reason: NO_SESSION, sessionId: base.sessionId, text: '这次没能把工作区目录归一到工作区根，所以我不动任何票。' }
  const root = canon.trim()
  if (root === raw) return base
  const key = typeof d.workspaceKeyOf === 'function' ? String(d.workspaceKeyOf(root)) : ('ws-' + hash8(root))
  return { ok: true, cwd: root, rawCwd: raw, workspaceKey: key, sessionId: base.sessionId, source: base.source, text: '' }
}
