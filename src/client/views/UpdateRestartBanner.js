/**
 * views/UpdateRestartBanner.js —— 装完还没重启的常驻提示（#587 新增）。
 *
 * 为什么有它：装上更新后，磁盘上已经是新版，但进程还跑着旧版，要等一次重启才真的生效。
 * 在那之前界面上什么提示都没有，用户看不出「还差一步」。这一行就是补那句话：一直在，直到重启。
 *
 * 判据只有一条（#587 用户拍板 C 案）：宿主当场算出的「缺一次重启」（回包里的原生原因码
 * pending-restart，也就是磁盘已装版本与进程运行版本不是同一个）。不读那条会过期的任务记录，
 * 所以装上就出现、重启就消失，不需要人去关。
 *
 * 文案全部走词条（cfg.restart*），本文件不写死任何中文。
 */
export const UpdateRestartBanner = (props) => {
  const h = props && props.h ? props.h : React.createElement
  const tr = props.tr
  const cat = function (a, b) { return String(a) + ' → ' + String(b) }
  const line = (props.installed && props.running)
    ? tr('cfg.restartDoneWith', { from: props.running, to: props.installed })
    : tr('cfg.restartDone')
  return h('div', { className: 'dsws-restart-row', 'data-role': 'update-restart-banner' }, [
    typeof Ic === 'function' ? Ic({ n: 'refresh', size: 12, color: '#f59e0b' }) : null,
    h('span', { className: 'ttl' }, tr('cfg.updateRestart')),
    h('span', { className: 'note' }, line),
  ])
}
