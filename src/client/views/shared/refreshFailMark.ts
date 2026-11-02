/**
 * views/shared/refreshFailMark.ts — 面板头部刷新按钮旁那枚「当前是不是失败」的小标识（票 #1833）
 * 契约：模块真源（ESM 导出）；scripts/build.mts 构建时剥行首 export 拼回
 * src/client/index.ts 的 leaf:refreshFailMark 标记处（源码树里只有这一份真源）。
 *
 * 为什么要有它：列表状态行里「刷新失败，正在重试」独占一行，位置又落在列表滚动区里，
 *   维护者反馈不好看、也不好找。失败这件事改由刷新按钮旁边一枚不占行的小标识表达：
 *   带可读的「失败」两个字（不点开、不悬停就能看见，守住 #715 的失败必可见），
 *   完整原因（配额耗尽 / 已暂停 / 还在重试）放在悬停提示里。
 * 三条口径不能改：
 *   ① 当前是否失败只从客户端观察到的真实结果派生（truthLines 的 truthFailureOf），
 *      不按错误文本猜，也不拿通知历史反推现在。
 *   ② 小标识只画事实，不画动作：这里不加「重试」按钮、不改刷新调度；刷新仍由旁边那颗按钮负责。
 *   ③ 健康态整枚不画（返回 null），不占位、不影响头部折叠阶梯的位置计算。
 */
declare const React: any
declare const DswsCtx: any
declare const truthFailureOf: any
declare const freshnessToneColor: any
declare const Ic: any
declare const tr: any
declare const Tip: any

export const RefreshFailMark = ({ st }: any) => {
  const cx = React.useContext(DswsCtx)
  const h = cx ? cx.h : React.createElement
  const fail = (typeof truthFailureOf === 'function') ? truthFailureOf(st) : null
  if (!fail) return null
  // 悬停里给完整原因；行上只留「失败」两个字，免得把头部那一排挤得换行。
  const full = tr(fail.tipKey)
  const label = tr('truth.failBadge')
  const tone = (typeof freshnessToneColor === 'function') ? freshnessToneColor('red') : ''
  return h(Tip, { content: full }, h('span', {
    'data-head-fail': fail.reason,
    'aria-label': label + '：' + full,
    style: { display: 'inline-flex', alignItems: 'center', gap: 3, flex: 'none', fontSize: 10, lineHeight: '14px', color: tone, whiteSpace: 'nowrap' },
  }, [
    Ic({ n: 'alert', size: 10, key: 'icon' }),
    h('span', { key: 'label' }, label),
  ]))
}
