/**
 * seam/style.ts · B2 style 绑定（样式生命周期）
 *
 * R1 接口：style.insert(css): disposer
 *   dev：styles.insert(css)（动态 runner builtin，包卸载自动回收）
 *   pkg：手动 <style data-plugin> + ctx.effect 清理（静态插件没有 styles.insert builtin）
 *
 * 覆盖 D3：样式生命周期差异。
 */

// 本域 tsconfig 有意不加载任何类型包（types 为空），DOM 类型不在 lib 里；
// 原文直接读全局 document，没有守卫 —— 只能在浏览器里被调用，Node 里调同样会抛。
// 这里照搬原文的假定（调用方保证浏览器环境），只声明用到的那一面。
declare const document: {
  createElement(tag: 'style'): {
    setAttribute(name: string, value: string): void
    textContent: string | null
    parentNode: { removeChild(child: unknown): void } | null
  }
  head: {
    appendChild(node: unknown): void
  }
}

interface PkgCtx {
  get?(name: string): unknown
  effect?(fn: () => () => void, label: string): void
}

/**
 * pkg 方言的 styles shim 工厂：把动态方言的 styles.insert(css) 映射到手动注入。
 * @param getCtx 返回当前 apply 的 ctx（用于 ctx.effect 清理注册）
 */
export function createPkgStyles(getCtx: () => PkgCtx): {
  insert(css: string | string[] | unknown): () => void
} {
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

/** 本绑定说明的形状：只在本文件内用，不导出 —— 跨文件引用会多出层内边（同层禁引），6 份各自写一份。 */
interface SeamDescribe {
  b: string
  name: string
  covers: string[]
  dev: string
  pkg: string
}

export const describe = (): SeamDescribe => ({
  b: 'B2',
  name: 'style',
  covers: ['D3 样式生命周期：styles.insert vs <style data-plugin> + ctx.effect'],
  dev: 'styles.insert(css)（runner builtin 自动回收）',
  pkg: '手动 <style data-plugin> 注入 + ctx.effect 清理',
})
