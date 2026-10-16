// 探针样本（违规一）：订阅了会话事件，但处理体里根本不看这个会话属于哪个工作区。
// 期望门禁判红：B 类（消费事件数据前没有工作区门）。
interface Session {
  id: string
}
interface DeckEvent {
  type: string
}
interface Ctx {
  on(name: string, handler: (session: Session, event: DeckEvent) => void): void
}
interface Deps {
  refreshNow(): void
}
export function wire(ctx: Ctx, deps: Deps): void {
  ctx.on('session/event', function (session: Session, event: DeckEvent): void {
    if (event.type !== 'tool/result') return
    deps.refreshNow()
  })
}
