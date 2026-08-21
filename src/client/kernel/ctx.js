/**
 * src/client/kernel/ctx.js — Ctx 插座式接线（阶段 2 步骤 1 · #95）
 *
 * 契约：cx = { ctx, h, rdom, storeSvc, localeSvc, timer, api, router }
 *   —— G3 冻结清单 8 字段不增不减（issue #91 拍板 · ARCHITECTURE-CTX.md §2）。
 *   - ctx        apply 的 cordis ctx
 *   - h          React.createElement
 *   - rdom       react-dom 访问器（createPortal 用；取不到为 null，portalTop 有兜底）
 *   - storeSvc   面板状态服务（shared / stores / makeStore / storeOf / emit / sub / useStore）
 *   - localeSvc  DSH locale 服务（register / bind）
 *   - timer      DSH timer 服务
 *   - api        host 桥（call(endpoint, args) → host.call，带可用性守卫）
 *   - router     面板开关 / tab 导航（open / toggle）
 *
 * 使用：组件用 React.useContext(DswsCtx) 取 cx；逻辑模块用工厂注入（makeX(cx)）。
 * Provider 缺失兜底：useContext 返回 null → 组件降级渲染不 crash（ARCHITECTURE-CTX.md §4）。
 *
 * 构建说明：本文件为模块真源（ESM 导出）；scripts/build.mjs 在构建时去掉每行行首
 * export 关键字，把声明体文本组合进 client 双产物（_dev 根 client.js / _pkg
 * package/lib/client.js）的 apply 闭包顶部 —— 与 seam shims 同模式，一源两物，src 零复制。
 */
export const DswsCtx = React.createContext(null)

/**
 * 建 cx 单例（apply 时调用一次；引用永不变化 —— Context 值变会引发全树重渲染）。
 * deps 缺项兜底为 null（防御性：测试/异常环境可用，组件经 useContext 取 null 走降级渲染）。
 */
export function createCx(deps) {
  const d = deps || {}
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
