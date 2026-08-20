/**
 * seam/style.js · B2 style 绑定（样式生命周期）
 *
 * R1 接口：style.insert(css): disposer
 *   dev：styles.insert(css)（动态 runner builtin，包卸载自动回收）
 *   pkg：手动 <style data-plugin> + ctx.effect 清理（静态插件没有 styles.insert builtin）
 *
 * 覆盖 D3：样式生命周期差异。
 */

/**
 * pkg 方言的 styles shim 工厂：把动态方言的 styles.insert(css) 映射到手动注入。
 * @param {() => object} getCtx 返回当前 apply 的 ctx（用于 ctx.effect 清理注册）
 */
export function createPkgStyles(getCtx) {
  return {
    insert(css) {
      const ctx = getCtx()
      const styleEl = document.createElement('style')
      styleEl.setAttribute('data-plugin', 'dsh-mattpocock-skills-deck')
      styleEl.textContent = typeof css === 'string' ? css : Array.isArray(css) ? css.join('') : String(css)
      document.head.appendChild(styleEl)
      if (ctx && typeof ctx.effect === 'function') {
        ctx.effect(() => () => {
          try { if (styleEl.parentNode) styleEl.parentNode.removeChild(styleEl) } catch (e) { /* 忽略清理期错误 */ }
        }, 'dsh-mattpocock-skills-deck: styles')
      }
      return () => {
        try { if (styleEl.parentNode) styleEl.parentNode.removeChild(styleEl) } catch (e) { /* 忽略 */ }
      }
    },
  }
}

export const describe = () => ({
  b: 'B2',
  name: 'style',
  covers: ['D3 样式生命周期：styles.insert vs <style data-plugin> + ctx.effect'],
  dev: 'styles.insert(css)（runner builtin 自动回收）',
  pkg: '手动 <style data-plugin> 注入 + ctx.effect 清理',
})
