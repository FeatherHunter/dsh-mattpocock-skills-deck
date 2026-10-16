// 探针样本（合规）：进门第一件事就是按会话的 cwd 判工作区，判完才碰事件数据。
// 期望门禁全绿（登记表由 compliant.registry.json 提供）。
interface Session {
  id: string
  header: { cwd: string }
}
interface DeckEvent {
  type: string
}
interface Ctx {
  on(name: string, handler: (session: Session, event: DeckEvent) => void, opts: { global: boolean }): void
}
interface Deps {
  workspaceRootHash: string
  markDirty(id: string): void
}
declare function cwdHash(cwd: string): string
export function wire(ctx: Ctx, deps: Deps): void {
  const MINE: string = deps.workspaceRootHash
  ctx.on('session/event', function (session: Session, event: DeckEvent): void {
    const cwd: string = session && session.header && session.header.cwd
    if (!cwd || cwdHash(cwd) !== MINE) return
    if (event && event.type === 'tool/call') deps.markDirty(session.id)
  }, { global: true })
}
