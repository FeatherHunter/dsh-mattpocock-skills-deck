/**
 * src/client/kernel/ctx.ts — Ctx 插座式接线（#95）。
 *
 * 为什么接线要收在这里：界面各层需要的东西（画界面用的 h、状态服务、语言服务、计时器、宿主桥、路由）
 * 一共有 8 样，多一样少一样都会让调用方各写一套兜底，所以建 cx 的字段清单冻结为 8 个，不增不减。
 * 契约：cx = { ctx, h, rdom, storeSvc, localeSvc, timer, api, router }，缺项兜底为 null，
 * 组件经 useContext 取到 null 时走降级渲染，不许崩。构建时剥行首 export 拼回 apply 闭包顶部。
 * 本文件由 ctx.js 转写而来，只加类型标注，运行行为一字不改。
 * 反例：不要在这里新增第 9 个字段，不要在这里调用任何服务，只做装配。
 */
declare const React: any;
export const DswsCtx: any = React.createContext(null)
/**
 * 建 cx 单例（apply 时调用一次；引用永不变化，值变会引发全树重渲染）。
 * 入参缺项兜底为 null，保证测试与异常环境下也能用。
 */
export function createCx(deps: any): any {
  const d: any = deps || {}
  return {
    ctx: d.ctx !== undefined ? d.ctx : null,
    h: d.h !== undefined ? d.h : null,
    rdom: d.rdom !== undefined ? d.rdom : null,
    storeSvc: d.storeSvc !== undefined ? d.storeSvc : null,
    localeSvc: d.localeSvc !== undefined ? d.localeSvc : null,
    timer: d.timer !== undefined ? d.timer : null,
    api: d.api !== undefined ? d.api : null,
    router: d.router !== undefined ? d.router : null,
  }
}
