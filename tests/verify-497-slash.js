// tests/verify-497-slash.js —— #497 本机可见打开门禁：意图归调用方，系统分支归平台抽象层。
// 用法：node tests/verify-497-slash.js（在插件根目录）。
// 背景：宿主调起层常驻隐藏，直接拉资源管理器不可见；win32 须经 cmd start 显式可视（真机验证 /max 可见），
// darwin 沿用 open、linux 沿用 xdg-open。五方职责：pickerShell 只表达意图（开目录/开文件），
// “用哪个程序、拼什么参数”由各 OS 底座的可见打开配方拥有，通用层单点调起；调用方不出现按系统分发的分支。
// 本门禁在平台层核对三端实际参数，在调用方核对零系统分支。
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

console.log('#497 门禁：本机可见打开三端配方（调用方零系统分支）')

// 按指定系统组装平台上下文：spawn 只记录参数不真打开。
function makeCtx(captured, resolveImpl) {
  const subprocess = {
    spawn: (opts) => {
      captured.push((opts && opts.argv) ? opts.argv.slice() : [])
      return { done: Promise.resolve({ exitCode: 0 }), terminate() {} }
    },
    resolveExecutable: resolveImpl || (async (n) => 'C:\\Windows\\System32\\' + n),
  }
  return {
    get(name) {
      if (name === 'subprocess') return subprocess
      if (name === 'fs') return { lstat: async () => null, readText: async () => '', writeText: async () => {}, resolve: (p) => p, listDir: async () => [], stat: async () => null }
      return undefined
    },
  }
}

async function main() {
  const platUrl = pathToFileURL(path.join(ROOT, 'src', 'host', 'platform', 'index.js')).href
  const win32Url = pathToFileURL(path.join(ROOT, 'src', 'host', 'platform', 'win32', 'index.js')).href
  const darwinUrl = pathToFileURL(path.join(ROOT, 'src', 'host', 'platform', 'darwin', 'index.js')).href
  const linuxUrl = pathToFileURL(path.join(ROOT, 'src', 'host', 'platform', 'linux', 'index.js')).href
  let platMod, win32Adapter, darwinAdapter, linuxAdapter
  try {
    platMod = await import(platUrl)
    win32Adapter = (await import(win32Url)).default
    darwinAdapter = (await import(darwinUrl)).default
    linuxAdapter = (await import(linuxUrl)).default
  } catch (e) {
    check(false, '平台层可被动态加载：' + e.message)
    console.log('\n存在失败')
    process.exit(1)
  }
  check(typeof platMod.composePlatform === 'function', '平台层导出组装函数 composePlatform')

  // win32 开目录：经 cmd start 显式可视，正斜杠已归一，不手写引号。
  {
    const captured = []
    const plat = await platMod.composePlatform(makeCtx(captured), 'win32', win32Adapter, {})
    const res = await plat.openFolder('D:/0Tools/DSH Desktop/.dsh-mattskillsdeck-cache/logs', 'D:/base')
    check(res && res.ok === true, 'win32 开目录成功（含空格真机路径）')
    check(JSON.stringify(captured[0]) === JSON.stringify(['C:\\Windows\\System32\\cmd.exe', '/c', 'start', '', '/max', 'D:\\0Tools\\DSH Desktop\\.dsh-mattskillsdeck-cache\\logs']), 'win32 开目录走 cmd start 显式可视且斜杠已归一（实得 ' + JSON.stringify(captured[0]) + '）')
  }

  // win32 开文件（名内无空格）：先切目录再按名选中。
  {
    const captured = []
    const plat = await platMod.composePlatform(makeCtx(captured), 'win32', win32Adapter, {})
    const res = await plat.openFile('D:/cache/logs/2026-09-06.log', 'D:/base')
    check(res && res.ok === true, 'win32 开文件成功（无空格名）')
    check(JSON.stringify(captured[0]) === JSON.stringify(['C:\\Windows\\System32\\cmd.exe', '/c', 'start', '', '/max', '/d', 'D:\\cache\\logs', 'explorer', '/select,2026-09-06.log']), 'win32 开文件先切目录再选中（实得 ' + JSON.stringify(captured[0]) + '）')
  }

  // win32 开文件（名内有空格）：拼不出选中串，改开上级目录（看得见位置，不选中）。
  {
    const captured = []
    const plat = await platMod.composePlatform(makeCtx(captured), 'win32', win32Adapter, {})
    const res = await plat.openFile('D:/cache/my notes.md', 'D:/base')
    check(res && res.ok === true, 'win32 空格文件名仍成功（改开上级）')
    check(JSON.stringify(captured[0]) === JSON.stringify(['C:\\Windows\\System32\\cmd.exe', '/c', 'start', '', '/max', 'D:\\cache']), 'win32 空格文件名改开上级目录（实得 ' + JSON.stringify(captured[0]) + '）')
  }

  // win32 含壳元字符：诚实失败，不让 cmd 多执行半句。
  {
    const captured = []
    const plat = await platMod.composePlatform(makeCtx(captured), 'win32', win32Adapter, {})
    const res = await plat.openFolder('D:/cache/a&b', 'D:/base')
    check(res && res.ok !== true, 'win32 壳元字符诚实失败（实得 ' + JSON.stringify(res) + '）')
    check(captured.length === 0, 'win32 壳元字符未调起（零调起）')
  }

  // win32 找不到打开器：诚实失败。
  {
    const captured = []
    const plat = await platMod.composePlatform(makeCtx(captured, async () => { throw new Error('not found') }), 'win32', win32Adapter, {})
    const res = await plat.openFolder('D:/cache/logs', 'D:/base')
    check(res && res.ok !== true, 'win32 无打开器诚实失败')
  }

  // darwin：open 直调，空格与斜杠原样。
  {
    const captured = []
    const ctx = { get: (n) => (n === 'subprocess' ? { spawn: (o) => { captured.push(o.argv.slice()); return { done: Promise.resolve({}), terminate() {} } }, resolveExecutable: async (x) => '/usr/bin/' + x } : { lstat: async () => null }) }
    const plat = await platMod.composePlatform(ctx, 'darwin', darwinAdapter, {})
    await plat.openFolder('/Users/a/My Logs', '/tmp')
    check(JSON.stringify(captured[0]) === JSON.stringify(['/usr/bin/open', '/Users/a/My Logs']), 'darwin 开目录直调 open（实得 ' + JSON.stringify(captured[0]) + '）')
    await plat.openFile('/tmp/a/b.log', '/tmp')
    check(JSON.stringify(captured[1]) === JSON.stringify(['/usr/bin/open', '/tmp/a/b.log']), 'darwin 开文件直调 open（实得 ' + JSON.stringify(captured[1]) + '）')
  }

  // linux：xdg-open 直调。
  {
    const captured = []
    const ctx = { get: (n) => (n === 'subprocess' ? { spawn: (o) => { captured.push(o.argv.slice()); return { done: Promise.resolve({}), terminate() {} } }, resolveExecutable: async (x) => '/usr/bin/' + x } : { lstat: async () => null }) }
    const plat = await platMod.composePlatform(ctx, 'linux', linuxAdapter, {})
    await plat.openFolder('/home/u/logs', '/tmp')
    check(JSON.stringify(captured[0]) === JSON.stringify(['/usr/bin/xdg-open', '/home/u/logs']), 'linux 开目录直调 xdg-open（实得 ' + JSON.stringify(captured[0]) + '）')
  }

  // 调用方零系统分支：pickerShell 不出现按系统分发的字面。
  {
    const src = fs.readFileSync(path.join(ROOT, 'src', 'host', 'pickerShell.js'), 'utf8')
    const strip = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    check(!/===\s*['"]win32['"]/.test(strip) && !/===\s*['"]darwin['"]/.test(strip), 'pickerShell 无按系统分发的分支')
    check(!strip.includes('explorer') && !strip.includes('xdg-open'), 'pickerShell 不拼系统命令（配方归底座）')
    check(src.includes('openFolder') && src.includes('openFile'), 'pickerShell 只表达意图（开目录/开文件）')
  }

  console.log(failed ? '\n存在失败 ' + total + ' 项' : '\n全部通过 ' + total + ' 项')
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error('门禁异常：' + ((e && e.message) || e)); process.exit(1) })
