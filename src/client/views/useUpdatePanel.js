/**
 * views/useUpdatePanel.js —— 配置页右上角「检查更新」的全部状态与电话调用（#587 由 SettingsPage.js 拆出）。
 *
 * 为什么拆：SettingsPage.js 已顶到 350 行上限，这一票又要加持重启常驻提示与浮层弹窗。
 * 拆出后「怎么查、什么时候装、待重启怎么认」都收在这一个文件里，主文件只剩渲染。
 *
 * 三条判据（#587 用户拍板）：
 *   1. 待重启只认宿主当场算出的「缺一次重启」（回包原因码 pending-restart），不读会过期的任务记录。
 *   2. 无新版不弹窗（只给一行提示），且只有用户亲手点的检查才提示；自动读状态与轮询都不打扰。
 *   3. 检查中不弹窗：弹窗只在确认有新版可装、或安装失败要给原因时打开。
 *
 * 电话名与轮询间隔从更新包派生的取值来（UPD_STATUS / UPD_CHECK / UPD_INSTALL / UPD_POLL），
 * 本文件不写字面量。文案全部走词条，不写死中文。
 */

/** 装完待重启这件事，一次会话里只主动说一次；同页面不再重复提醒。 */
let updRestartToldOnce = false

/** 面板状态推进记一行（按需事件 panel.render，只在调试开关打开时落盘；与 kernel/router.js 同一形态）。 */
const updLogState = function (stage, ms) {
  try { if (isEnabled('debug')) log('debug', 'panel.render', { stage: String(stage || ''), ms: Math.round(Number(ms) || 0), mode: 'update' }) } catch (eUpdLog) {}
}


/** 把宿主回包读成面板要的几个事实（纯函数：不碰界面、不碰电话，便于离线核对）。 */
export const updReadSnapshot = (res) => {
  const snap = res && res.snapshot ? res.snapshot : null
  const job = snap && snap.job ? snap.job : null
  return {
    job: job,
    jobState: job && job.state ? String(job.state) : null,
    jobMessage: job && job.message ? String(job.message) : null,
    blocked: snap && snap.blockedReason ? String(snap.blockedReason) : null,
    // 待重启只认宿主当场算出的这条原因码（见文件头第 1 条）
    pending: !!(snap && snap.blockedReason === 'pending-restart'),
    running: snap && typeof snap.runningVersion === 'string' ? snap.runningVersion : '',
    installed: snap && typeof snap.installedVersion === 'string' ? snap.installedVersion : '',
    latest: snap && typeof snap.latestVersion === 'string' && snap.latestVersion ? snap.latestVersion : null,
    canInstall: !!(snap && snap.canInstall === true && snap.latestVersion),
    manual: res && Object.prototype.hasOwnProperty.call(res, 'manual') ? res.manual : undefined,
    checkId: res && res.receipt && res.receipt.checkId ? res.receipt.checkId : null,
    // 宿主回包原样带出的字段：手工兜底命令走 res.manual（有键才更新界面上的那份）
    hasManual: !!(res && Object.prototype.hasOwnProperty.call(res, 'manual')),
  }
}

/** 浮层弹窗该不该开：确认有新版可装，或安装失败要把原因说清楚（其余时候不打扰）。 */
export const updDialogShouldOpen = (asked, info) => {
  if (!asked || !info) return false
  return !!(info.canInstall || (info.jobState === 'failed' && !!info.jobMessage))
}

export const useUpdatePanel = (deps) => {
  const cx = React.useContext(DswsCtx)
  const h = cx ? cx.h : React.createElement
  const st = deps && deps.st
  const sid = deps && deps.sid
  const [updChecking, setUpdChecking] = React.useState(false)
  const [updLatest, setUpdLatest] = React.useState(null)
  const [updHasNew, setUpdHasNew] = React.useState(false)
  const [updDialog, setUpdDialog] = React.useState(false)
  const [updJob, setUpdJob] = React.useState(null)
  const [updManual, setUpdManual] = React.useState(null)
  const [updCheckId, setUpdCheckId] = React.useState(null)
  const [updBlocked, setUpdBlocked] = React.useState(null)
  const [updBusy, setUpdBusy] = React.useState(false)
  const [updPending, setUpdPending] = React.useState(false)
  const [updRunning, setUpdRunning] = React.useState('')
  const [updInstalled, setUpdInstalled] = React.useState('')
  const updJobState = updJob && updJob.state ? updJob.state : null
  const updHostReady = function () { try { return !!(typeof host !== 'undefined' && host && host.call) } catch (eUpd) { return false } }

  const updApplyRes = function (res) {
    try {
      const info = updReadSnapshot(res)
      const snap = res && res.snapshot ? res.snapshot : null
      if (info.hasManual) setUpdManual(info.manual)
      if (info.checkId) setUpdCheckId(info.checkId)
      if (snap && snap.job) { setUpdJob(snap.job); if (info.jobState === 'failed' && (updJobState === 'installing' || updJobState === 'verifying')) setUpdDialog(true) }      else if (snap) setUpdJob(null)
      setUpdBlocked(info.blocked)
      if (snap) { setUpdRunning(info.running); setUpdInstalled(info.installed) }
      setUpdPending(info.pending)
      if (info.pending && !updRestartToldOnce) {
        updRestartToldOnce = true
        updLogState('update-restart', 0)
        if (typeof flash === 'function' && st) flash(st, tr('cfg.updateRestartToast', { v: info.installed }), 'warn')
      }
      if (info.canInstall && info.latest) { setUpdHasNew(true); setUpdLatest(info.latest) }
      else { setUpdHasNew(false); setUpdLatest(info.latest) }
    } catch (eUpd) {}
  }
  const updReadStatus = function () {
    if (!updHostReady()) return
    setUpdChecking(true)
    const t0 = Date.now()
    try {
      host.call(UPD_STATUS, {}).then(function (res) {
        setUpdChecking(false)
        if (res && res.ok === true && res.snapshot) {
          try { log('info', 'host.call', { method: UPD_STATUS, latencyMs: Date.now() - t0, ok: true, kind: 'update-status' }) } catch (eL) {}
          updApplyRes(res)
        } else {
          try { log('warn', 'host.call.fail', { method: UPD_STATUS, kind: 'update-status', errorHash: dswsLogHash(dswsLogTrunc(String((res && res.error) || 'not-ok'), 120, 'error')) }) } catch (eL) {}
        }
      }).catch(function (e) {
        setUpdChecking(false)
        try { log('warn', 'host.call.fail', { method: UPD_STATUS, kind: 'update-status', errorHash: dswsLogHash(dswsLogTrunc(String((e && e.message) || e), 120, 'error')) }) } catch (eL) {}
      })
    } catch (eUpd) { setUpdChecking(false) }
  }
  const updClickCheck = function () {
    if (updChecking || updBusy) return
    if (!updHostReady()) { if (st) flash(st, tr('err.hostUnavailable'), 'warn'); return }
    // 已经查到有新版（凭证仍在有效期内）：直接开弹窗，不重复联网
    if (updHasNew && updLatest && updCheckId) { setUpdDialog(true); return }
    setUpdChecking(true)
    const t0 = Date.now()
    try {
      host.call(UPD_CHECK, {}).then(function (res) {
        setUpdChecking(false)
        if (res && res.ok === true && res.snapshot) {
          try { log('info', 'host.call', { method: UPD_CHECK, latencyMs: Date.now() - t0, ok: true, kind: 'update-check' }) } catch (eL) {}
          updApplyRes(res)
          // 只有真有新版才开弹窗（#546 反例：版本号相等时不弹）
          if (updIsNewer(res.snapshot.latestVersion, res.snapshot.runningVersion)) { setUpdDialog(true); updLogState('update-dialog', Date.now() - t0) }
          else { if (st) flash(st, tr('cfg.updateLatest', { v: res.snapshot.runningVersion }), 'ok') }
        } else {
          try { log('warn', 'host.call.fail', { method: UPD_CHECK, kind: 'update-check', errorHash: dswsLogHash(dswsLogTrunc(String((res && res.error) || 'not-ok'), 120, 'error')) }) } catch (eL) {}
          if (st) flash(st, tr('cfg.updateCheckFail'), 'warn')
        }
      }).catch(function (e) {
        setUpdChecking(false)
        try { log('warn', 'host.call.fail', { method: UPD_CHECK, kind: 'update-check', errorHash: dswsLogHash(dswsLogTrunc(String((e && e.message) || e), 120, 'error')) }) } catch (eL) {}
        if (st) flash(st, tr('cfg.updateCheckFail'), 'warn')
      })
    } catch (eUpd) { setUpdChecking(false); if (st) flash(st, tr('cfg.updateCheckFail'), 'warn') }
  }
  const updStartInstall = function () {
    if (updBusy || !updCheckId) return
    if (!updHostReady()) { if (st) flash(st, tr('err.hostUnavailable'), 'warn'); return }
    setUpdBusy(true)
    const t0 = Date.now()
    const requestId = 'req-' + String(Date.now()) + '-' + String(Math.floor(Math.random() * 100000))
    try {
      host.call(UPD_INSTALL, { checkId: updCheckId, requestId: requestId }).then(function (res) {
        setUpdBusy(false)
        if (res && res.ok === true && res.snapshot) {
          try { log('info', 'host.call', { method: UPD_INSTALL, latencyMs: Date.now() - t0, ok: true, kind: 'update-install' }) } catch (eL) {}
          updApplyRes(res)
          setUpdDialog(false)
        } else {
          try { log('warn', 'host.call.fail', { method: UPD_INSTALL, kind: 'update-install', errorHash: dswsLogHash(dswsLogTrunc(String((res && res.error) || 'not-ok'), 120, 'error')) }) } catch (eL) {}
          if (res && res.error) setUpdBlocked(res.error)
          if (st) flash(st, tr('cfg.updateInstallFail'), 'warn')
          updReadStatus()
        }
      }).catch(function (e) {
        setUpdBusy(false)
        try { log('warn', 'host.call.fail', { method: UPD_INSTALL, kind: 'update-install', errorHash: dswsLogHash(dswsLogTrunc(String((e && e.message) || e), 120, 'error')) }) } catch (eL) {}
        if (st) flash(st, tr('cfg.updateInstallFail'), 'warn')
      })
    } catch (eUpd) { setUpdBusy(false); if (st) flash(st, tr('cfg.updateInstallFail'), 'warn') }
  }
  React.useEffect(function () { updReadStatus() }, [])
  React.useEffect(function () {
    if (updJobState !== 'installing' && updJobState !== 'verifying') return
    const timerId = setInterval(function () { updReadStatus() }, UPD_POLL)
    return function () { try { clearInterval(timerId) } catch (eT) {} }
  }, [updJobState])
  const updCopyManual = function () {
    if (!updManual) return
    try { copyText(st, updManual, tr('toast.copied')) } catch (eC) { if (st) flash(st, tr('toast.copyFailed'), 'warn') }
  }
  // 按钮四态：检查中 / 正在装 / 待重启 / 更新至某版 / 检查更新
  const updLabel = (updChecking || updBusy) ? tr('cfg.updateChecking') : ((updJobState === 'installing' || updJobState === 'verifying') ? tr('cfg.updateInstalling') : (updPending ? tr('cfg.updateRestart') : ((updHasNew && updLatest) ? tr('cfg.updateToVersion', { v: updLatest }) : tr('cfg.updateCheck'))))
  const updFailText = function () { const c = String((updJob && updJob.message) || ''); return tr(c === 'installation-changed' ? 'cfg.updateFailChanged' : (c === 'recovery-required' ? 'cfg.updateFailRecovery' : 'cfg.updateFailInstall')) }
  // 弹窗只在两种时候开：确认有新版可装，或安装失败要把原因说清楚
  const updShowDialog = updDialogShouldOpen(updDialog, { canInstall: !!(updHasNew && updCheckId), jobState: updJobState, jobMessage: updJob && updJob.message ? String(updJob.message) : null })
  return {
    label: updLabel,
    disabled: !!(updChecking || updBusy || updJobState === 'installing' || updJobState === 'verifying' || updPending),
    busy: !!(updChecking || updBusy),
    highlight: !!(updHasNew && updLatest && !updPending),
    onClick: updClickCheck,
    pending: updPending,
    running: updRunning,
    installed: updInstalled,
    dialog: h(UpdateDialog, {
      h: h,
      tr: tr,
      open: updShowDialog,
      latest: updLatest || '',
      running: updRunning,
      canInstall: !!(updHasNew && updCheckId),
      checkId: updCheckId,
      busy: updBusy,
      manual: updManual,
      reason: (updBlocked && !updHasNew) ? updBlocked : null,
      failText: (updJobState === 'failed' && updJob && updJob.message) ? updFailText() : null,
      onClose: function () { setUpdDialog(false) },
      onCopy: updCopyManual,
      onStart: updStartInstall,
    }),
    banner: updPending ? h(UpdateRestartBanner, { h: h, tr: tr, running: updRunning, installed: updInstalled }) : null,
  }
}
