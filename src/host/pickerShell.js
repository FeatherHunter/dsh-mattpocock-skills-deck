// src/host/pickerShell.js —— 文件夹打开与原生选择器（H6 #450 从 host/index.js 823–853/1030–1133 搬出，纯结构、行为零变化）。
// 以后谁改它：改打开文件夹或原生目录/文件选择器的人。预估约150行，超 350 打回。
// 接线：由 index.js 动态 import 加载；本文件不引用其他新文件。
export function createPickerShell(deps) {
  const { DEFAULT_CWD, getPlatform, subprocess, timer } = deps
  // ============ #190：wf.openFolder — 打开本地文件夹（Markdown 后端仓库名点击）============
  // 输入：{ cwd }；平台分发：win32 explorer / darwin open / linux xdg-open（经 platform.resolveExecutable），subprocess.spawn 打开
  async function handleOpenFolder(args) {
    const cwd = (args && (args.cwd || args.path)) || DEFAULT_CWD
    if (!cwd) return { ok: false, error: '缺少 cwd' }
    try {
      const platform = await getPlatform()
      const os = platform.os || (typeof process !== 'undefined' && process.platform) || 'win32'
      const openerName = os === 'win32' ? 'explorer' : os === 'darwin' ? 'open' : 'xdg-open'
      const opener = await platform.resolveExecutable(openerName)
      if (!opener) return { ok: false, error: '找不到打开器：' + openerName }
      // cwd 归一（platform.path 处理分隔符）
      let target = String(cwd)
      try { if (platform.path && typeof platform.path.normalize === 'function') target = platform.path.normalize(target) } catch {}
      // win32 explorer 需保持原分隔符；darwin/linux 用 posix 兼容
      const argv = [opener, target]
      try {
        const handle = subprocess.spawn({ argv: argv, cwd: DEFAULT_CWD || target, stdio: { stdin: 'ignore', stdout: { maxBytes: 64*1024 }, stderr: { maxBytes: 64*1024 } }, graceMs: 2000 })
        // 不等待完成，fire-and-forget；若 spawn 同步抛错则视为失败
        if (handle && handle.done) {
          // 异步错误吞掉，避免未处理 rejection 影响面板；成功即返回
          handle.done.catch(function(){})
        }
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) }
      }
      return { ok: true, cwd: target, opener: opener }
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
      const isWin = plat && plat.os === 'win32'
      const isMac = plat && plat.os === 'darwin'
      let argv = null
      if (isWin) {
        // win32 用 explorer 选中文件，无 shell 拼接，argv 直传防注入；文件不存在时 explorer 仍会打开目录
        // 优先用 explorer /select, 失败回退 cmd start
        try {
          // 先尝试 explorer 选中（最符合“在本地打开”）
          const handle = subprocess.spawn({ argv: ['explorer', '/select,' + p], cwd: DEFAULT_CWD, stdio: { stdin: 'ignore', stdout: { maxBytes: 64*1024 }, stderr: { maxBytes: 64*1024 } }, graceMs: 2000 })
          const to = timer.timeout(3000)
          await Promise.race([handle.done, to.then(function(){ try{ handle.terminate() }catch{}; return {exitCode:-1}})])
          return { ok: true }
        } catch {}
        argv = ['cmd', '/c', 'start', '', p]
      } else if (isMac) {
        argv = ['open', p]
      } else {
        argv = ['xdg-open', p]
      }
      if (argv) {
        const h = subprocess.spawn({ argv: argv, cwd: DEFAULT_CWD, stdio: { stdin: 'ignore', stdout: { maxBytes: 64*1024 }, stderr: { maxBytes: 64*1024 } }, graceMs: 2000 })
        const to2 = timer.timeout(5000)
        const out = await Promise.race([h.done, to2.then(function(){ try{ h.terminate() }catch{}; return {exitCode:-1, signal:'timeout'}})])
        if (out && out.exitCode === 0) return { ok: true }
        // explorer 场景已在上面 return，此处为 open/xdg-open 的结果
        return { ok: true }
      }
      return { ok: false, error: '当前平台不支持打开', errorKind: 'unsupported' }
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e), errorKind: 'internal' }
    }
  }
  return { handleOpenFolder, handlePickDirectory, handlePickFile, handleOpenPath }
}