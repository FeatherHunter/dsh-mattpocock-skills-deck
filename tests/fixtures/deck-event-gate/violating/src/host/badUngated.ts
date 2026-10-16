// 探针样本（违规二）：两个毛病写在一起——先消费事件数据、后判工作区门；而且把整个事件对象
// 交给了日志出口。期望门禁判红：B 类（门排在消费之后）与 C 类（事件对象整份进日志）。
interface Session {
  id: string
  header: { cwd: string }
}
interface DeckEvent {
  type: string
  data?: { command?: string }
}
interface Ctx {
  on(name: string, handler: (session: Session, event: DeckEvent) => void, opts: { global: boolean }): void
}
interface Deps {
  workspaceRootHash: string
  logCtx: { fire(...args: unknown[]): void }
  markDirty(id: string): void
}
declare function cwdHash(cwd: string): string
export function wire(ctx: Ctx, deps: Deps): void {
  const MINE: string = deps.workspaceRootHash
  ctx.on('session/event', function (session: Session, event: DeckEvent): void {
    const cmd: string | undefined = event.data && event.data.command
    deps.logCtx.fire('debug', 'deck.event.seen', event)
    if (cwdHash(session.header.cwd) !== MINE) return
    deps.markDirty(session.id)
  }, { global: true })
}
