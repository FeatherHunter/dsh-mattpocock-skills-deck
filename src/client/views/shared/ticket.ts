/**
 * views/shared/ticket.ts — 票进度渲染（tStatus 系，v1.5 T12）
 * 契约：模块真源（ESM 导出）；scripts/build.mts 构建时剥行首 export 拼回
 * src/client/index.ts 的 `// ==== leaf:... (spliced by build) ====` 标记处（源码树里只有这一份真源）。
 *
 * 本文件由同名 .js 转成 TypeScript（#1253）：只加类型标注与下面这些说明，逻辑、字符串、
 * 数字、对象键与次序、函数名与导出名一字未动。契约照旧不能改：本文件是模块真源（ESM 导出），
 * scripts/build.mts 构建时剥掉行首 export 后把声明体拼进 src/client/index.ts 的客户端闭包
 * （源码树里只有这一份真源）；模块说明符保持 .js 后缀，由 scripts/ts-hook.mts 改指同名 .ts。
 */
/**
 * 闭包环境声明（类型检查时才看，转译时整段抹掉，真机上有值）：
 * 下面这些名字不在本文件里定义，由构建按 build.mjs 的次序把别的叶子拼进同一个函数作用域带进来
 * （tr 是词条、h 是创建元素、Ic 是图标），这里只声明形状、不参与转译。为什么不写 import：
 * 拼进闭包的片段里留着运行时 import，运行时就是语法错。声明成 (...args: any[]): any 而不是精确
 * 签名，是为了保证「只加类型、不加约束」——转译后一字不差。
 */
declare function tr(...args: any[]): any;
declare function h(...args: any[]): any;
declare function Ic(...args: any[]): any;
    // ============================================================
    // v1.5 T12：票进度渲染（状态徽章 + 进度条）—— open/close 原生 + 进度自评
export     const tStatus = function (t: any) {
      if (t.state === 'CLOSED') return { key: 'done', color: '#3fb950', icon: 'check' }
      if (t.progress === null || t.progress === undefined || t.progress <= 0) return { key: 'todo', color: '#8b8b95', icon: 'dot' } // B4：0% = 未动工（契约），不进 doing
      if (t.progress >= 100) return { key: 'accept', color: '#f59e0b', icon: 'alert' }
      if (t.progress >= 95) return { key: 'confirm', color: '#f59e0b', icon: 'alert' }
      return { key: 'doing', color: '#58a6ff', icon: 'dot' }
    }
export     const tStatusLabel = function (t: any) {
      const s = tStatus(t)
      if (s.key === 'done') return tr('progress.done')
      if (s.key === 'accept') return tr('progress.accept')
      if (s.key === 'confirm') return tr('progress.confirm')
      if (s.key === 'doing') return tr('progress.doing', { n: t.progress })
      return tr('progress.todo')
    }
export     const tProgressBar = function (t: any) {
      const p = (t.state === 'CLOSED') ? 100 : (t.progress === null || t.progress === undefined ? 0 : t.progress)
      const color = (t.state === 'CLOSED') ? '#3fb950' : (t.progress === null || t.progress === undefined ? '#52525b' : '#58a6ff')
      const label = (t.state === 'CLOSED') ? '100%' : (t.progress === null || t.progress === undefined ? '—' : t.progress + '%')
      return h('div', { style: { display: 'flex', alignItems: 'center', gap: 5, marginTop: 3 } }, [
        h('div', { style: { flex: 1, height: 4, borderRadius: 2, background: 'rgba(255,255,255,.08)', overflow: 'hidden' } }, [
          h('div', { style: { width: String(p) + '%', height: '100%', background: color, borderRadius: 2 } }),
        ]),
        h('span', { style: { fontSize: 9, color: 'var(--dsw-alias-label-caption,#8b8b95)', flex: 'none', fontVariantNumeric: 'tabular-nums', minWidth: 26, textAlign: 'right' } }, label),
      ])
    }
export     const tStatusBadge = function (t: any) {
      if (t.state === 'CLOSED') return null
      const s = tStatus(t)
      return h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 2, color: s.color, fontSize: 9, flex: 'none' } }, [
        Ic({ n: s.icon, size: 8 }),
        h('span', null, tStatusLabel(t)),
      ])
    }
