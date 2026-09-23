// 探针样本（违规一）：订阅了会话事件，但处理体里根本不看这个会话属于哪个工作区。
// 期望门禁判红：B 类（消费事件数据前没有工作区门）。
export function wire(ctx, deps) {
  ctx.on('session/event', function (session, event) {
    if (event.type !== 'tool/result') return
    deps.refreshNow()
  })
}
