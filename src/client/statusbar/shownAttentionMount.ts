// src/client/statusbar/shownAttentionMount.ts —— 状态栏「当前显示会话」的登记组件（#1220）。
//
// 这个文件只做一件事：把状态栏此刻正在显示的那个会话状态登记到视野模型里，让心跳、焦点上报、
// 探测循环与初始化链重算钩子都看这同一个会话；卸载时按同一引用清除。它不画任何东西——返回 null，
// 与 #1409 的 suggestStream.ts 同一个做法（StatusBar 贴着每文件 350 有效行的粒度红线，接线放同目录叶子）。
//
// 为什么登记引用而不是会话号：同一时刻只有当前会话的状态栏在挂载，引用本身就是「正在显示」的证据；
// 按会话号记会把「刚才看过、现在已经不显示」的会话当成当前显示（#1220 票面否决过那种近似修法）。
// 契约与其它叶子一致：运行时不许跨文件 import，跨闭包名字一律 declare；只写可剥离的 TypeScript；
// 不新增常驻定时器；不许 export default。
declare const noteShownAttentionStore: any;
declare const forgetShownAttentionStore: any;
declare const reportWorkspaceAttention: any;
declare const attentionRootOf: any;
declare const attentionKeyOf: any;
declare const _attentionPlan: any;

/**
 * 挂载点：状态栏在收起态与展开态各挂一个（挨着已有的 SuggestStreamMount）。
 * cwd 到位后再补一次会话切换上报，让宿主的探测目标立刻跟到当前工作区；工作区没换就不重复上报。
 */
export const ShownAttentionMount = function (props: any) {
  const sid = (props && props.sid) ? String(props.sid) : ''
  const cx = React.useContext(DswsCtx)
  let st: any = null
  try { st = (cx && cx.storeSvc && typeof cx.storeSvc.useStore === 'function') ? cx.storeSvc.useStore(sid) : null } catch (eStore) { st = null }
  const cwd = (st && st.cwd) ? String(st.cwd) : ''
  React.useEffect(function () {
    noteShownAttentionStore(st)
    try {
      if (st && cwd) {
        const root = attentionRootOf(st)
        const planned = String((_attentionPlan && _attentionPlan.root) || '')
        if (root && attentionKeyOf(root) !== attentionKeyOf(planned)) reportWorkspaceAttention(st, 'session-switch', null)
      }
    } catch (eRoot) {}
    return function () { forgetShownAttentionStore(st) }
  }, [st, cwd])
  return null
}
