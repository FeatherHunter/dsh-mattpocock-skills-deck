// src/shared/session-cwd.js —— 会话对象读目录的唯一真源（#730）。
// 以后谁改它：改“从会话对象里读目录”这条取法的人。两处调用方是
//   src/host/sessionLifecycle.js 的电话体（wf.cwd）与
//   src/host/workspaceCwd.js 的按工作区找会话（沙箱政策用）。
// 为什么只有一个出口：两处各写一遍取法必然分叉（电话体认 11 个槽位、
//   沙箱只认 2 个，同一份会话两处答案不同，写操作的沙箱政策静默落错档）。
//   一只函数、一份测试、两处调用，分歧结构上不可能再出现。
// 为什么只读头的目录：写下这个目录的只有 DSH 会话层，字段就是会话头里
//   选填的目录；头的路径、worktree、projectDir、directory 与备用头、
//   自身字段在 DSH 2.0.10 的类型与全仓调用里都没有证据（第一步收敛时
//   原样保留过，第二步按“读者不许发明出处”删掉）。读不到就回空串，
//   调用方按缺席显式失败，不许拿别的字段凑，更不许按默认政策写。
// 放 shared 的理由：host 层内文件互引会被同层门禁记边，host 调 shared
//   是跨层调用（与 refresh-workspace-key.js、list-dedupe.js 同例），不记边、
//   不动基线；以后客户端收敛时也可调同一只函数。
export function resolveSessionCwd(s) {
  try {
    if (!s || typeof s !== 'object') return ''
    const header = s.header
    const cwd = header && header.cwd
    if (typeof cwd === 'string' && cwd) return cwd
  } catch (e) {}
  return ''
}
export default { resolveSessionCwd }
