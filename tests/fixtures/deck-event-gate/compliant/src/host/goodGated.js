// 探针样本（合规）：进门第一件事就是按会话的 cwd 判工作区，判完才碰事件数据。
// 期望门禁全绿（登记表由 compliant.registry.json 提供）。
export function wire(ctx, deps) {
  const MINE = deps.workspaceRootHash
  ctx.on('session/event', function (session, event) {
    const cwd = session && session.header && session.header.cwd
    if (!cwd || cwdHash(cwd) !== MINE) return
    if (event && event.type === 'tool/call') deps.markDirty(session.id)
  }, { global: true })
}
