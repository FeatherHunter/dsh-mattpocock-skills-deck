// tests/verify-497-slash.js —— #497 win32 打开路径门禁：斜杠统一为反斜杠、不手写引号、目录直接打开。
// 用法：node tests/verify-497-slash.js（在插件根目录）。
// 背景：宿主打开文件夹与打开文件在 win32 下把含正斜杠的路径原样交给 explorer，
// 资源管理器认不出，回落到默认位置，用户看到“点了没反应”（电话仍回 ok:true）。
// 纠偏：数组透传由调起层按需自动加引号，手写双引号会变成文件名的一部分，含空格路径反而打不开，
// 因此只做斜杠统一，不手写引号；目录走直接打开（选中只会打开上级），文件才走选中。
// 本门禁逐平台核对传给 spawn 的实际参数。
const path = require('path')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

console.log('#497 门禁：win32 打开路径无正斜杠不手写引号，目录直接打开（darwin/linux 保持正斜杠）')

// 按指定系统组装宿主依赖：spawn 只记录参数不真打开，计时器立即超时不等待。
function makeDeps(os, captured) {
  return {
    DEFAULT_CWD: 'D:/base',
    getPlatform: async () => ({
      os,
      path: { normalize: (s) => String(s) },
      resolveExecutable: async (name) => String(name)
    }),
    subprocess: {
      spawn: (opts) => {
        captured.push((opts && opts.argv) ? opts.argv.slice() : [])
        return { done: Promise.resolve({ exitCode: 0 }), terminate() {} }
      }
    },
    timer: {
      timeout: (a) => {
        if (typeof a === 'number') return Promise.resolve({ exitCode: -1, signal: 'timeout' })
        return { then(resolve) { resolve({ exitCode: -1 }) } }
      }
    },
    logCtx: null
  }
}

async function main() {
  const modUrl = pathToFileURL(path.join(ROOT, 'src', 'host', 'pickerShell.js')).href
  let mod
  try {
    mod = await import(modUrl)
  } catch (e) {
    check(false, '打开器可被动态加载（src/host/pickerShell.js）：' + e.message)
    console.log(failed ? '\n存在失败' : '\n全部通过')
    process.exit(1)
  }
  check(typeof mod.createPickerShell === 'function', '打开器导出工厂函数 createPickerShell')

  // win32 打开文件夹：传给 explorer 的目标路径无正斜杠、不手写引号。
  {
    const captured = []
    const shell = mod.createPickerShell(makeDeps('win32', captured))
    const res = await shell.handleOpenFolder({ cwd: 'D:/cache/logs' })
    const target = (captured[0] && captured[0][1]) || ''
    check(res && res.ok === true, 'win32 打开文件夹仍成功（斜杠转换不翻失败）')
    check(!String(target).includes('/'), 'win32 打开文件夹的目标路径无正斜杠（实得 ' + target + '）')
    check(target === 'D:\\cache\\logs', 'win32 正斜杠统一为反斜杠且不手写引号（实得 ' + target + '）')
    check(!(String(target).startsWith('"') && String(target).endsWith('"')), 'win32 数组直传不手写双引号（含空格路径由宿主调起层自动加引号，实得 ' + target + '）')
  }

  // win32 含空格文件夹：同样不手写引号（用户真机路径 D:/0Tools/DSH Desktop/...）。
  {
    const captured = []
    const shell = mod.createPickerShell(makeDeps('win32', captured))
    await shell.handleOpenFolder({ cwd: 'D:/0Tools/DSH Desktop/.dsh-mattskillsdeck-cache/logs' })
    const target = (captured[0] && captured[0][1]) || ''
    check(target === 'D:\\0Tools\\DSH Desktop\\.dsh-mattskillsdeck-cache\\logs', 'win32 含空格目录同样只转斜杠不包引号（实得 ' + target + '）')
  }

  // win32 打开文件：explorer 选中参数里的文件路径无正斜杠、不手写引号（/select, 开关头不算）。
  {
    const captured = []
    const shell = mod.createPickerShell(makeDeps('win32', captured))
    const res = await shell.handleOpenPath({ path: 'D:/cache/logs/2026-09-06.log' })
    const arg = (captured[0] && captured[0][1]) || ''
    const filePart = String(arg).replace(/^\/select,/, '')
    check(res && res.ok === true, 'win32 打开文件仍成功（斜杠转换不翻失败）')
    check(!filePart.includes('/'), 'win32 打开文件的目标路径无正斜杠（实得 ' + filePart + '）')
    check(!(filePart.startsWith('"') && filePart.endsWith('"')), 'win32 打开文件的选中路径不手写引号（实得 ' + filePart + '）')
    check(String(arg) === '/select,D:\\cache\\logs\\2026-09-06.log', 'win32 打开文件的选中参数形如 /select,盘符:\\...（实得 ' + arg + '）')
  }

  // win32 打开目录走打开文件电话：按目录直接打开，不走选中（选中只会打开上级）。
  {
    const captured = []
    const shell = mod.createPickerShell(makeDeps('win32', captured))
    const res = await shell.handleOpenPath({ path: 'D:/0Tools/DSH Desktop/.dsh-mattskillsdeck-cache/logs' })
    const arg = (captured[0] && captured[0][1]) || ''
    check(res && res.ok === true, 'win32 目录走打开文件电话仍成功（按目录直接打开）')
    check(String(arg) === 'D:\\0Tools\\DSH Desktop\\.dsh-mattskillsdeck-cache\\logs', 'win32 目录直接打开不带选中头（实得 ' + arg + '）')
  }

  // darwin 与 linux：正斜杠保持不动（修法只动 win32）。
  {
    const capturedMac = []
    const mac = mod.createPickerShell(makeDeps('darwin', capturedMac))
    await mac.handleOpenPath({ path: '/tmp/a/b.log' })
    const macArg = (capturedMac[0] && capturedMac[0][1]) || ''
    check(macArg === '/tmp/a/b.log', 'darwin 打开路径保持正斜杠不动（实得 ' + macArg + '）')
    const capturedLinux = []
    const linux = mod.createPickerShell(makeDeps('linux', capturedLinux))
    await linux.handleOpenFolder({ cwd: 'D:/cache/logs' })
    const linuxTarget = (capturedLinux[0] && capturedLinux[0][1]) || ''
    check(linuxTarget === 'D:/cache/logs', 'linux 打开路径保持正斜杠不动（实得 ' + linuxTarget + '）')
  }

  console.log(failed ? '\n存在失败 ' + total + ' 项' : '\n全部通过 ' + total + ' 项')
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error('门禁异常：' + ((e && e.message) || e)); process.exit(1) })
