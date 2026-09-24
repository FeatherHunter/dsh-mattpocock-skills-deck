// src/shared/session-cwd.js —— 会话对象读目录的唯一真源（#730）。
// 以后谁改它：改“从会话对象里读目录”这条取法的人。两处调用方是
//   src/host/sessionLifecycle.js 的电话体（wf.cwd）与
//   src/host/workspaceCwd.js 的按工作区找会话（沙箱政策用）。
// 为什么只有一个出口：两处各写一遍取法必然分叉（电话体认 11 个槽位、
//   沙箱只认 2 个，同一份会话两处答案不同，写操作的沙箱政策静默落错档）。
//   一只函数、一份测试、两处调用，分歧结构上不可能再出现。
// 字段清单说明：第一步收敛原样保留旧电话体的 11 个槽位（头 5、备用头 5、
//   自身 1），行为零变化；无证据槽位的删减与缺席显式失败是第二步，
//   由 tests/verify-730-cwd-consistent.js 的扩展断言锁住。
// 放 shared 的理由：host 层内文件互引会被同层门禁记边，host 调 shared
//   是跨层调用（与 refresh-workspace-key.js、list-dedupe.js 同例），不记边、
//   不动基线；以后客户端收敛时也可调同一只函数。
export function resolveSessionCwd(s) {
  try {
    if (!s || typeof s !== 'object') return ''
    const header = s.header || s.meta
    const cwd = header && (header.cwd || header.path || header.worktree || header.projectDir || header.directory)
    if (typeof cwd === 'string' && cwd) return cwd
    const meta = s.meta
    const cwd2 = meta && (meta.cwd || meta.path || meta.worktree || meta.projectDir || meta.directory)
    if (typeof cwd2 === 'string' && cwd2) return cwd2
    if (typeof s.cwd === 'string' && s.cwd) return s.cwd
  } catch (e) {}
  return ''
}
export default { resolveSessionCwd }
