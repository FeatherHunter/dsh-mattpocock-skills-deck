// views/versionControl/vcRealCommitFlow.ts —— #1877 提交这一块的跨组件行为
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼回 src/client/index.ts 的 leaf 标记处。
//
// 为什么不写在容器里：容器那一叶贴着每文件 350 有效行的上限，这几条 effect 不碰 React 之外的状态、
// 也不画界面，搬出来单独放不改变任何行为。每个函数都是自定义 Hook，用法是在组件顶层无条件调用一次
// （Hooks 的规矩：每次渲染调用次序必须一样，所以函数体里只有固定的几个 Hook）。
//
// 这里装两件事：
//   1) 提交选项浮层的关闭与焦点：原型给浮层定了三条关闭路径——按 Esc、点浮层外面、换页签。
//      Esc 在委托层（vcRealShell.escape），因为它要先于「按 Esc 回来源页」裁决；这里管另外两条，
//      以及收起之后把焦点送回那枚箭头。
//   2) 提交成功之后重读提交表单：刚才那条提交就是下一次修订 / 吸收的「上一条提交」。
declare const React: any

/** 在容器里装上提交选项浮层的三条行为：换页签收起、点外面收起、收起后焦点回到箭头。
 *  o：{ rootRef, actionsRef, open, page }。open 是这次渲染时浮层开着没有；page 是当前页名。 */
export function vcRealCommitMenuEffectsOf(o: any): void {
  const opts: any = o || {}
  const rootRef: any = opts.rootRef
  const actionsRef: any = opts.actionsRef
  const open: boolean = opts.open === true
  const page: string = String(opts.page || '')
  const prevRef: any = React.useRef({ open: false })
  // 收起之后焦点回到箭头：原型定的规矩是「Esc 收起、点外面收起，焦点都回到那枚箭头」，
  //   读者收起浮层之后接着按键，键盘不该被甩回页面开头。换页签时箭头已经跟着改动页一起不在，
  //   这里找不到就不动焦点。
  React.useEffect(function () {
    const prev: any = prevRef.current
    if (prev.open === true && !open) {
      const root: any = rootRef.current
      const btn: any = root && typeof root.querySelector === 'function' ? root.querySelector('[data-vc-commit-options]') : null
      if (btn && typeof btn.focus === 'function') btn.focus({ preventScroll: true })
    }
    prev.open = open
  }, [open])
  // 点浮层外面收起：和行菜单、分支浮层同一套习惯。点在整棵面板外面（左栏、输入框等别的界面）也算外面。
  React.useEffect(function () {
    if (!open) return undefined
    const onDown = function (event: any): void {
      const target: any = event && event.target
      const root: any = rootRef.current
      if (!root || !target || typeof root.contains !== 'function') return
      const panel: any = root.querySelector('[data-vc-commit-options-panel]')
      const toggle: any = root.querySelector('[data-vc-commit-options]')
      if (panel && typeof panel.contains === 'function' && panel.contains(target)) return
      if (toggle && typeof toggle.contains === 'function' && toggle.contains(target)) return
      actionsRef.current.commitOps().closeMenu()
    }
    if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return undefined
    document.addEventListener('pointerdown', onDown, true)
    return function () { if (typeof document.removeEventListener === 'function') document.removeEventListener('pointerdown', onDown, true) }
  }, [open])
  // 换页签也收起：提交选项是「这一次提交」的临时选择，离开改动页就没有意义了。
  //   这里读 prevRef 而不是 open：本 effect 只看页名变化，浮层刚打开那一帧不该被它关掉。
  React.useEffect(function () {
    if (prevRef.current.open === true) actionsRef.current.commitOps().closeMenu()
  }, [page])
}

/** 提交成功之后重读一次提交表单：刚才那条提交就是下一次修订 / 吸收的「上一条提交」，
 *  不重读的话修订的预填与 fixup / squash 的吸收目标会一直停在上一次读到的位置。
 *  o：{ actionsRef, commit }。commit 是这次渲染时的 ui.commit；结果里的 headAfter / atMs 用来认出「新的一次成功」。
 *  为什么放 effect 不放动作层：动作层在回包那一刻立即重读会与「把这次选择重置成默认」抢同一个状态对象，
 *  那时 React 还没渲染，后一次写入会把结果条连同刚设的状态一起盖掉；effect 在渲染之后跑，读到的是新状态。 */
export function vcRealCommitFormReloadOf(o: any): void {
  const opts: any = o || {}
  const actionsRef: any = opts.actionsRef
  const commit: any = opts.commit || {}
  const result: any = commit.result || null
  const key: string = result && result.state === 'ok' ? String(result.headAfter || result.atMs || 'ok') : ''
  const seenRef: any = React.useRef('')
  React.useEffect(function () {
    if (key === '' || seenRef.current === key) return
    seenRef.current = key
    actionsRef.current.commitOps().loadForm()
  }, [key])
}

export const VC_REAL_COMMIT_FLOW_SOURCE = 'src/client/views/versionControl/vcRealCommitFlow.ts'
