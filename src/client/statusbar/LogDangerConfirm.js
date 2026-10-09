/**
 * statusbar/LogDangerConfirm.js — 高危险动作的就近确认框与留痕横幅（948 图 #954 落地）。
 *
 * 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回
 * src/client/index.js 的 leaf 标记处（一源两物，标记 id 与本文件同名）。
 * 为什么单开一个叶子：状态栏日志菜单那份叶子已 349/350 行（粒度红线），
 *   确认框与留痕横幅搬来这里，菜单叶子只留状态与调用（照 #851 样式叶子的做法）。
 *
 * 两件形态，都走已有的覆盖层与横幅视觉：不动位置、不动大小、不引新颜色、不新增动画关键帧。
 *   - 就近确认框：清空这类不可逆动作动手前先冒一个（用菜单里那颗危险行的锚点定位，就在按钮旁边），
 *     覆盖层画不顶开列表；一次只冒一个（状态是布尔的，不是数组）；角色是对话框、焦点先落在确认键，
 *     退出键由调用方那条已有的键盘处理接。
 *   - 留痕横幅：动手后写清做了什么，人工关掉才消失 —— 本文件不排任何自动消失的定时器；
 *     失败了横幅上带重试按钮，重试走调用方给的同一条动手路径。
 * 用起来的规矩：动手时按钮里转圈加禁用（复用短等待那套忙态覆盖层），落定后转圈退场、
 *   由横幅用对勾或叉号加闪光交代结果（结果图标与转圈不同时出现）。
 */
export const LogDangerConfirmBox = function (props) {
  const p = props || {}
  const h = p.h
  const t = p.t
  const busy = p.busy === true
  return h('div', {
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': t('logmenu.clearTitle'),
    style: {
      background: 'var(--dsw-alias-bg-layer-2,#16181d)', border: '1px solid var(--dsw-alias-border-l1,#2a2d35)', borderRadius: 12,
      padding: 16, width: '100%', maxWidth: 380, boxShadow: '0 8px 30px rgba(0,0,0,.45)',
    },
  }, [
    h('div', { key: 'ti', style: { fontSize: 14, fontWeight: 700, marginBottom: 6 } }, t('logmenu.clearTitle')),
    h('div', { key: 'de', style: { fontSize: 12, color: '#9a9aa5', marginBottom: 12, lineHeight: 1.6 } }, t('logmenu.clearDesc')),
    h('div', { key: 'ac', style: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 } }, [
      h('button', {
        key: 'cancel', className: 'dsws-btn ghost', disabled: busy,
        onClick: function () { if (!busy) p.onCancel() },
        style: { fontSize: 12 },
      }, t('logmenu.cancel')),
      h('button', {
        key: 'ok',
        className: 'dsws-btn dsws-fb-busy-fill' + (busy ? ' dsws-fb-busy' : ''),
        disabled: busy,
        autoFocus: true,
        onClick: function () { if (!busy) p.onConfirm() },
        style: { fontSize: 12, fontWeight: 700, background: '#5c2b2b', borderColor: '#5c2b2b', color: '#fca5a5', opacity: busy ? 0.55 : 1, cursor: busy ? 'default' : 'pointer' },
      }, busy
        ? [h('span', { key: 't', className: 'fb-t', 'aria-hidden': 'true' }, t('logmenu.clearing')), h('span', { key: 's', className: 'fb-spin', 'aria-hidden': 'true' }, h('span', { key: 'sp', className: 'dsws-spinner', style: { width: 11, height: 11, borderWidth: 2 } }))]
        : t('logmenu.confirmClear')),
    ]),
  ])
}

// 留痕横幅。kind 用 ok / bad 两档（跟既有横幅同款视觉）：ok 对勾加绿闪，bad 叉号加红闪并给重试。
// 关掉是人工动作（右侧那颗叉），本组件不排定时器；文字由调用方按结果拼好传进来（写清做了什么）。
export const LogDangerNotice = function (props) {
  const p = props || {}
  const h = p.h
  const t = p.t
  const bad = p.kind === 'bad'
  return h('div', {
    role: 'status',
    'aria-live': 'polite',
    className: 'dsws-banner ' + (bad ? 'bad dsws-fb-errflash' : 'ok dsws-fb-okflash'),
    style: { margin: 0, cursor: 'default', alignItems: 'center', gap: 6 },
  }, [
    (typeof Ic === 'function') ? (bad ? Ic({ n: 'x', size: 12 }) : Ic({ n: 'check', size: 12 })) : null,
    h('span', { key: 'tx', style: { flex: 1, fontSize: 12 } }, String(p.text || '')),
    bad ? h('button', {
      key: 'retry', className: 'dsws-btn', disabled: p.busy === true,
      onClick: function () { if (p.busy !== true) p.onRetry() },
      style: { borderColor: 'rgba(248,113,113,.6)', color: '#fca5a5', fontSize: 11, flex: 'none' },
    }, t('logmenu.retry')) : null,
    h('button', {
      key: 'close', className: 'dsws-btn ghost dsws-banner-fold-x', 'aria-label': t('logmenu.noticeClose'),
      onClick: function () { p.onClose() },
      style: { padding: '1px 6px', display: 'inline-flex', alignItems: 'center', flex: 'none' },
    }, (typeof Ic === 'function') ? Ic({ n: 'x', size: 11 }) : null),
  ])
}
