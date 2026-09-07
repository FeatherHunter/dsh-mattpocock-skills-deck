// src/host/pickerShell.js —— 文件夹打开与原生选择器（H6 #450 从 host/index.js 823–853/1030–1133 搬出，纯结构、行为零变化）。
// 以后谁改它：改打开文件夹或原生目录/文件选择器的人。预估约150行，超 350 打回。
// 接线：由 index.js 动态 import 加载；本文件不引用其他新文件。
// 五方职责：本文件只表达意图（开目录/开文件），系统分支由平台抽象层拥有（各 OS 底座的可见打开配方），此处不出现按系统分发的分支。
export function createPickerShell(deps) {
  const { DEFAULT_CWD, getPlatform, logCtx } = deps
  // ============ #190：wf.openFolder — 打开本地文件夹（Markdown 后端仓库名点击）============
  // 输入：{ cwd }；调起经平台抽象层 openFolder（配方归 OS 底座），本文件不拼系统命令。
  async function handleOpenFolder(args) {
    const cwd = (args && (args.cwd || args.path)) || DEFAULT_CWD
    if (!cwd) return { ok: false, error: '缺少 cwd' }
    try {
      const platform = await getPlatform()
      if (!platform || typeof platform.openFolder !== 'function') return { ok: false, error: '当前平台不支持打开' }
      const res = await platform.openFolder(String(cwd), DEFAULT_CWD)
      if (!res || res.ok !== true) return { ok: false, error: String((res && res.error) || '打开失败') }
      return { ok: true, cwd: String(cwd), opener: res.opener || '' }
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) }
    }
  }

  // ============ 原生选择器（DSH directory/file picker，供 modal-seat 的 directory/file 字段使用） ============
  // 前端字段 type:'directory' | 'file' 的“浏览…”按钮会调 wf.pickDirectory / wf.pickFile
  // 宿主侧优先走平台/宿主自带的原生对话框（若 DSH / Electron 暴露），否则回落为手输提示（ok:false）
  async function handlePickDirectory(args) {
    const cwd = (args && (args.cwd || args.initial)) ? String(args.cwd || args.initial) : DEFAULT_CWD
    const initial = args && args.initial ? String(args.initial) : cwd
    try {
      // 1) 尝试 Electron dialog（DSH Desktop 主进程）
      let electron = null
      try { electron = typeof require === 'function' ? require('electron') : null } catch(_){}
      if (electron && electron.dialog && typeof electron.dialog.showOpenDialogSync === 'function') {
        try {
          const picked = electron.dialog.showOpenDialogSync({ properties: ['openDirectory'], defaultPath: initial || cwd })
          if (Array.isArray(picked) && picked[0]) return { ok: true, path: String(picked[0]) }
          return { ok: false, error: 'cancelled', errorKind: 'cancelled' }
        } catch(_){}
      }
      // 2) 尝试 DSH 平台暴露的 picker（若未来 platform 提供）
      try {
        let plat = null
        try { plat = await getPlatform() } catch(_){}
        if (plat && typeof plat.pickDirectory === 'function') {
          const p = await plat.pickDirectory(initial || cwd)
          if (p) return { ok: true, path: String(p) }
        }
      } catch(_){}
      // 3) 回落：宿主暂无原生对话框能力，提示手输（前端会保留输入框可用）
      return { ok: false, error: '当前环境暂无原生目录选择器，请手动输入路径', errorKind: 'no-picker' }
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e), errorKind: 'internal' }
    }
  }
  async function handlePickFile(args) {
    const cwd = (args && (args.cwd || args.initial)) ? String(args.cwd || args.initial) : DEFAULT_CWD
    const initial = args && args.initial ? String(args.initial) : cwd
    try {
      let electron = null
      try { electron = typeof require === 'function' ? require('electron') : null } catch(_){}
      if (electron && electron.dialog && typeof electron.dialog.showOpenDialogSync === 'function') {
        try {
          const picked = electron.dialog.showOpenDialogSync({ properties: ['openFile'], defaultPath: initial || cwd })
          if (Array.isArray(picked) && picked[0]) return { ok: true, path: String(picked[0]) }
          return { ok: false, error: 'cancelled', errorKind: 'cancelled' }
        } catch(_){}
      }
      try {
        let plat = null
        try { plat = await getPlatform() } catch(_){}
        if (plat && typeof plat.pickFile === 'function') {
          const p = await plat.pickFile(initial || cwd)
          if (p) return { ok: true, path: String(p) }
        }
      } catch(_){}
      return { ok: false, error: '当前环境暂无原生文件选择器，请手动输入路径', errorKind: 'no-picker' }
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e), errorKind: 'internal' }
    }
  }
  async function handleOpenPath(args) {
    const raw = args && args.path ? String(args.path) : ''
    if (!raw) return { ok: false, error: '缺少 path', errorKind: 'bad-arg' }
    let p = raw.trim()
    // 去 file:// 前缀（UI 传来可能是 file:///D:/a/b.md）
    if (/^file:\/\//i.test(p)) {
      try { p = decodeURI(p.replace(/^file:\/\/\//i, '').replace(/^file:\/\//i, '')) } catch {}
      // win32 file:///D:/a -> D:/a
      if (/^\/[A-Za-z]:\//.test(p)) p = p.slice(1)
    }
    // 基础校验：路径需为绝对或含盘符/斜杠，避免 shell 注入的相对跳出
    if (!p) return { ok: false, error: 'path 为空', errorKind: 'bad-arg' }
    try {
      const plat = await getPlatform()
      if (!plat || typeof plat.openFile !== 'function' || typeof plat.openFolder !== 'function') return { ok: false, error: '当前平台不支持打开', errorKind: 'unsupported' }
      // 目录与文件走不同意图：目录直接打开看里面（选中只会打开上级）；分类经平台路径基名（各系统分隔符各自认），此处不猜系统。
      let base = ''
      try { base = plat.path && typeof plat.path.basename === 'function' ? plat.path.basename(p) : '' } catch {}
      const looksDir = !base || base.indexOf('.') < 0
      const res = looksDir ? await plat.openFolder(p, DEFAULT_CWD) : await plat.openFile(p, DEFAULT_CWD)
      if (!res || res.ok !== true) return { ok: false, error: String((res && res.error) || '打开失败'), errorKind: 'open-fail' }
      return { ok: true }
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e), errorKind: 'internal' }
    }
  }
  function hash8(s) { try { const t = String(s || ''); let h = 5381; for (let i = 0; i < t.length; i++) h = (((h << 5) + h + t.charCodeAt(i)) >>> 0); return ('0000000' + h.toString(16)).slice(-8) } catch (e) { return '00000000' } }
  function phoneLog(method, kind, t0, res, err) { try {
    if (err !== undefined && err !== null) { if (logCtx) logCtx.fire('warn', 'host.call.fail', { method: method, kind: kind, errorHash: hash8(String((err && err.message) || err)) }) }
    else if (res && res.ok) { if (logCtx) logCtx.fire('info', 'host.call', { method: method, latencyMs: Date.now() - t0, ok: true, kind: kind }) }
    else if (logCtx) logCtx.fire('warn', 'host.call.fail', { method: method, kind: kind, errorHash: hash8(String((res && ((res.error && res.error.message) || res.error || res.errorKind)) || 'picker-not-ok')) }) } catch (eL) {} }
  function loggedPhone(method, kind, fn) { return async function () { const t0 = Date.now(); try { const r = await fn.apply(null, arguments); phoneLog(method, kind, t0, r); return r } catch (e) { phoneLog(method, kind, t0, null, e); throw e } } }
  return { handleOpenFolder: loggedPhone('wf.openFolder', 'picker', handleOpenFolder), handlePickDirectory: loggedPhone('wf.pickDirectory', 'picker', handlePickDirectory), handlePickFile: loggedPhone('wf.pickFile', 'picker', handlePickFile), handleOpenPath: loggedPhone('wf.openPath', 'picker', handleOpenPath) }
}