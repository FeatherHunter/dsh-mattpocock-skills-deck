// src/client/statusbar/suggestGate.ts —— 「下一步建议」气泡什么时候该显示、关掉 deck 时它怎么收尾（#1879）
//
// 这张票要三件事：
//   一、气泡该不该显示只有一个判据：deck 没有收起（#1612 的 isDeckCapsuleFolded 为假），并且这个工作区的
//      建议开关是开。状态栏收起态与展开态各挂一次取数组件，两处都问这一个函数，不许各判各的。
//   二、关掉整个 deck 的那一刻，屏幕上那组建议按「已跳过」处理：忘掉按会话的缓存，并写一份跨刷新的关闭标记，
//      重新打开 deck、刷新页面都不再补出来（两个写口见 suggestStream.ts 的 suggestGroupForget 与
//      suggestClosedRemember）。
//      为什么不能只把挂载从收起分支拿掉：收起态与展开态是两棵不同的树，组件会卸载再挂载，而建议组按会话
//      缓存在模块级 Map 里，重新挂载时又会把它放回来。
//   三、只收起胶囊（deck 工具箱仍开着）不算跳过：收起期间模型新给的建议照常缓存，展开后显示最新一组。
//      关掉建议开关同理：只隐藏、不作废（#1879 维护者拍板 Q2）。
//
// 为什么单独一片：StatusBar.ts、suggestStream.ts、suggestBubble.ts 三个自然落点都贴着 350 有效行的红线，
// 判据与收尾逻辑放不进那几份文件。
//
// 契约（与仓库其它叶子文件同一套，见 scripts/build.mts 里的叶子清单）：
//   模块真源是 ESM 导出，构建时剥掉行首 export 拼进 apply 闭包；运行时不许跨文件 import
//   （跨文件名字一律用下面的 declare 声明）；不许 export default；只写可剥离的 TypeScript。
declare function isDeckCapsuleFolded(...args: any[]): any;
declare function deckSuggestOf(...args: any[]): any;
declare function isDeckClosed(...args: any[]): any;
declare function suggestGroupRecall(...args: any[]): any;
declare function suggestGroupForget(...args: any[]): any;
declare function suggestClosedRemember(...args: any[]): any;
declare const React: any;

/**
 * 气泡该不该显示：唯一判据 =「deck 没有收起」并且「这个工作区的建议开关是开」。
 * 「收起」由 isDeckCapsuleFolded 一处判：deck 工具箱关掉、或者胶囊状态栏被收起，两种都算。
 * 判据函数缺席（老产物、门禁里的渲染替身）时按显示处理，与改动前一样；判据自己抛错时也按显示处理 ——
 * 宁可多显示一次，也不要让一次读设置失败把气泡永久藏掉。
 */
export const suggestBubbleVisibleOf = function (cwd: any): boolean {
  try {
    if (typeof isDeckCapsuleFolded !== 'function' || typeof deckSuggestOf !== 'function') return true
    if (isDeckCapsuleFolded(cwd) === true) return false
    return deckSuggestOf(cwd) !== 'off'
  } catch (e) { return true }
}

/**
 * 关掉整个 deck 时把屏上那组建议记为已跳过；返回这次有没有真的处理掉一组。
 * 只认「deck 工具箱关掉」这一种（isDeckClosed）；只收起胶囊那一档只是隐藏，不记跳过。
 * 没有缓存组时什么也不做：关 deck 之前本来就没有建议可跳过。
 *
 * 两件必须一起做，缺一件都会被另一条路补回来：
 *   · suggestGroupForget 清掉按会话的缓存，并记下内存关闭标记（挡住刷新前的历史重放补出）；
 *   · suggestClosedRemember 按这一组的调用编号写一份跨刷新的关闭标记（刷新之后只剩它能挡住重放）。
 */
export const suggestSkipOnDeckClosed = function (cwd: any, sid: any): boolean {
  try {
    if (!sid) return false
    if (typeof isDeckClosed !== 'function' || isDeckClosed(cwd) !== true) return false
    if (typeof suggestGroupRecall !== 'function') return false
    const group = suggestGroupRecall(sid)
    if (!group) return false
    if (group.callId && typeof suggestClosedRemember === 'function') suggestClosedRemember(sid, String(group.callId))
    if (typeof suggestGroupForget === 'function') suggestGroupForget(sid)
    return true
  } catch (e) { return false }
}

/**
 * 挂载组件用的那个钩子：算出这一帧该不该显示气泡，并在 deck 整个关掉时把那组建议记为已跳过。
 * 入参就是取数组件的 props（sid、cwd）、当前显示的那一组和它的 setter；返回该不该显示。
 * 依赖里带着 group：关闭期间如果还有一组在宿主闸门生效前已经发出、关掉之后才到，
 * 那一趟也要按已跳过处理（#1879 实施说明里的窄边界）。
 */
export const useSuggestBubbleGate = function (props: any, group: any, setGroup: any): boolean {
  const cwd = (props && props.cwd) ? String(props.cwd) : ''
  const sid = (props && props.sid) ? String(props.sid) : ''
  const visible = suggestBubbleVisibleOf(cwd)
  React.useEffect(function () {
    if (!suggestSkipOnDeckClosed(cwd, sid)) return
    try { setGroup(null) } catch (e) {}
  }, [sid, cwd, group])
  return visible
}
