/**
 * seam/sidebar.js · B6 sidebar 绑定（better-sidebar 单例化）
 *
 * R1 接口：sidebar.ensure(): boolean + sidebar.open(sid) 单例化
 *   dev：动态版无声明 inject 依赖，运行时探测 + 幂等注册（sidebarTabRetry 重试）
 *   pkg：D7 双注册死代码 → 单例化，只允许 1 次声明
 *
 * 覆盖 D7：better-sidebar 重试/双注册死代码。G 构建门禁（单组件只允许 1 次声明）在
 * seam/gate.js 拦截手写破损；本绑定提供方言无关的幂等注册工具。
 */

/** 幂等注册：同一 sideTabKey 只注册一次（双方言一致）。 */
export function ensureOnce(registry, key, registerFn) {
  if (registry.has(key)) return false
  registry.set(key, true)
  try { registerFn() } catch (e) { registry.delete(key); throw e }
  return true
}

export const describe = () => ({
  b: 'B6',
  name: 'sidebar',
  covers: ['D7 better-sidebar 双注册死代码 → 单例化'],
  dev: '运行时探测 + sidebarTabRetry 幂等',
  pkg: '单例化 ensure/open',
})
