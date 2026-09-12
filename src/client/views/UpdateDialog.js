/**
 * views/UpdateDialog.js —— 检查更新的浮层弹窗（#587 由 SettingsPage.js 拆出，改为居中浮层）。
 *
 * 为什么拆：SettingsPage.js 已顶到 350 行上限，而这一票要给弹窗补内容（当前版本、装完要重启的说明）。
 * 拆出后弹窗自己能长，主文件只留一行渲染调用。
 *
 * 形态（#587 用户拍板 A 案）：走仓库现成的 dsws-modal 浮层（全屏遮罩加居中卡片），不再是页面里的内联分组。
 * 点遮罩空白处可关，行为与切换后端的确认框一致。
 *
 * 文案全部走词条（cfg.update*），本文件不写死任何中文。
 */
export const UpdateDialog = (props) => {
  const h = props && props.h ? props.h : React.createElement
  const tr = props.tr
  const onClose = props.onClose
  const onCopy = props.onCopy
  const onStart = props.onStart
  const open = !!(props && props.open)
  if (!open) return null
  const closeOnBackdrop = function (e) { if (e && e.target === e.currentTarget && typeof onClose === 'function') onClose() }
  const headIcon = typeof Ic === 'function' ? Ic({ n: 'refresh', size: 14 }) : null
  const actions = [
    (props.canInstall && props.checkId) ? h('button', { key: 'go', className: 'dsws-btn primary', disabled: !!props.busy, onClick: onStart, style: { fontSize: 12, padding: '5px 14px' } }, tr('cfg.updateStart')) : null,
    h('button', { key: 'later', className: 'dsws-btn ghost', onClick: onClose, style: { fontSize: 12, padding: '5px 14px' } }, tr('cfg.updateLater')),
  ].filter(Boolean)
  // 安装失败要看得见（#541 那次实测：失败后对话框已关、按钮弹回「更新至」，用户以为点了没反应）
  const updFailText = function () { return String(props.failText || '') }
  const failLine = props.failText ? h('div', { key: 'fail', className: 'dsws-upd-dlg-fail' }, tr('cfg.updateFailed', { reason: updFailText() })) : null
  return h('div', { className: 'dsws-modal', 'data-role': 'update-dialog', onClick: closeOnBackdrop }, [
    h('div', { className: 'dsws-modalbox', 'data-role': 'update-dialog-box' }, [
      h('div', { className: 'dsws-upd-dlg-head' }, [
        headIcon,
        h('span', { className: 'ttl' }, tr('cfg.updateDialogTitle', { v: props.latest || '' })),
      ]),
      h('div', { className: 'dsws-upd-dlg-note' }, tr('cfg.updateDialogBody')),
      // 版本对照：让人一眼看清「现在跑的是哪版、要装的是哪版」
      h('div', { className: 'dsws-upd-dlg-note' }, tr('cfg.updateVersions', { running: props.running || '', latest: props.latest || '' })),
      // 装完必须重启才生效：写在装的这一步之前，别让人装完以为没成功
      h('div', { className: 'dsws-upd-dlg-note' }, tr('cfg.updateRestartNote')),
      failLine,
      props.reason ? h('div', { className: 'dsws-upd-dlg-note' }, tr('cfg.updateBlocked', { reason: props.reason })) : null,
      props.manual ? h('div', { className: 'dsws-upd-dlg-cmd' }, [
        h('div', { className: 'dsws-upd-dlg-cmd-head' }, [
          h('span', null, tr('cfg.updateManualTitle')),
          h('button', { key: 'copy', className: 'dsws-cfg-btn', onClick: onCopy }, tr('cfg.updateCopy')),
        ]),
        h('pre', null, props.manual),
        h('div', { className: 'dsws-upd-dlg-note' }, tr('cfg.updateManualNote')),
      ]) : null,
      h('div', { className: 'dsws-upd-dlg-acts' }, actions),
    ]),
  ])
}
