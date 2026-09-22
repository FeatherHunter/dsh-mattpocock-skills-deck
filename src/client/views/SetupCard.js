/**
 * views/SetupCard.js — 盖住整个应用的那张「域文档布局」小卡（#698 新建）。
 *
 * 它是这条链上的两张小卡之一（另一张是「该工作区尚未初始化」那条黄条本身）。这张卡问一句话：
 *   这个仓库的各部分共用一套用语，还是各有各的用语？卡上两个选项，点确认才算答完。
 *
 * 为什么要有这个文件（而不是继续写在 StatusBar.js 里）：这张卡原先只渲染在黄条**下面**，
 *   于是工作区一旦初始化过、黄条不出现，卡就没有地方可画 —— 而「切换后端时改一下布局」这条路上
 *   工作区恰恰总是初始化过的。2026-09-22 维护者真机点「确认切换」没等到这一问，查下来正是这个原因，
 *   外加「收起整个功能区」与「当前没有横幅」这两支渲染直接返回，连渲染入口都没有。
 *   搬家之后它和建仓弹窗共用同一个座位（坑位就是状态栏那一层，挂在会话输入区 dock 上，
 *   见 statusbar/StatusBar.js 的 modalSeat），与右侧面板在不在、功能区收没收起、当前有没有横幅都无关。
 *
 * 与建仓弹窗是「同一时刻只会出现一张」的两件事：卡开着时不许再开「切换后端」那张窗
 *   （挡在 kernel/store-switch.js 的 openSwitchConfirm）；反过来切换那条路永远是「先开窗、关了窗才轮到卡」。
 *   本文件不另做判断 —— 位置只有一个，两张同时置真时按建仓弹窗优先，不会叠出两层遮罩。
 *
 * 契约：叶子模块（scripts/build.mjs 的 LEAF_MODULES 登记，标记 leaf:setupCard 拼回
 *   src/client/index.js 的 apply 闭包内原位）；同闭包内直调 layoutRadios / emit / portalTop 等，不 import 任何东西。
 * 以后谁改它：改这张卡的界面形态（标题、两个选项、那两句说明、两个按钮）的人。预估约 80 行，超 350 打回。
 */

export const SetupLayoutCard = function (props) {
  const st = props && props.st ? props.st : null
  const cx = (typeof DswsCtx !== 'undefined' && DswsCtx) ? React.useContext(DswsCtx) : null
  const h = (cx && cx.h) ? cx.h : React.createElement
  if (!st || st.setupLayoutCardOpen !== true) return null
  const curId = (st.selection && st.selection.backendId) || (st.snapshot && st.snapshot.selection && st.snapshot.selection.backendId) || firstBackendIdOf(null)
  const curLabel = (typeof labelOf === 'function' ? labelOf(curId) : '') || (typeof builtinLabelOf === 'function' ? builtinLabelOf(curId) : '') || String(curId || '')
  // 关闭与取消是同一件事：卡上刚点的那一下作废，按工作区记住的那一份不动（StatusBackend.js 里的口径）。
  const closeCard = function () { try { if (typeof cancelStatusSetupPick === 'function') cancelStatusSetupPick(st) } catch (e) {} }
  const box = h('div', { className: 'dsws-modalbox', role: 'dialog', 'aria-modal': 'true', 'aria-label': tr('setup.cardTitle'), style: { width: 480, maxWidth: '94vw' }, onClick: function (e) { e.stopPropagation() } }, [
    h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 } }, [
      h('div', { style: { fontSize: 13, fontWeight: 600, color: 'var(--dsw-alias-label-primary,#e6edf3)' } }, tr('setup.cardTitle')),
      h('button', { className: 'dsws-btn ghost', 'aria-label': tr('banner.setupPickCancel'), onClick: closeCard, style: { fontSize: 12, padding: '2px 8px' } }, '✕'),
    ]),
    (typeof layoutRadios === 'function') ? layoutRadios(st, h) : null,
    h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-caption,#8b8b95)', marginTop: 8, lineHeight: 1.5 } }, tr('setup.cardBackend', { name: curLabel })),
    // 切换后端那条路上工作区已经初始化过，卡不是「初始化前最后一问」而是「顺手改一下结论」，多说这一句；
    //   黄条 / 检查页那两条路（初始化前那一问）不显示它。
    (typeof cardOwnedBySwitch === 'function' && cardOwnedBySwitch(st))
      ? h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-caption,#8b8b95)', marginTop: 6, lineHeight: 1.5 } }, tr('setup.layoutSwitchNote'))
      : null,
    h('div', { className: 'foot', style: { display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 10, alignItems: 'center' } }, [
      h('button', { className: 'dsws-btn', onClick: closeCard, style: { fontSize: 12, padding: '4px 10px' } }, tr('banner.setupPickCancel')),
      h('button', { className: 'dsws-btn primary', onClick: function () { try { confirmStatusSetupPick(st) } catch (e) {} }, style: { fontSize: 12, padding: '4px 10px', fontWeight: 600 } }, tr('banner.setupPickConfirm')),
    ]),
  ])
  // 点卡外面那一层 = 取消：与 ✕、与「取消」按钮同一个去处（三处走同一个函数，免得有一条路悄悄不同）。
  const overlay = h('div', { className: 'dsws-modal', role: 'presentation', onClick: function (e) { if (e && e.target === e.currentTarget) closeCard() }, style: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000 } }, [box])
  try { if (typeof portalTop === 'function') return portalTop(overlay) } catch (_) {}
  return overlay
}
