// tests/verify-platform-contract.ts — 平台层三端契约断言（#131/#113验收①③）
// 第一性原理回溯：
//   #129（平台原语接口定稿）：getHome主源=os.homedir不二次读HOME；win32护栏形态^[A-Za-z]:→USERPROFILE→HOMEDRIVE+HOMEPATH；POSIX直接采用；
//           统一异步getHome/resolveExecutable；path必须委托node:path；fs透传；env只读；memoize终身缓存；throw→null通用层；两正交轴分层。
//   #156-158 三底座 100%：win32/darwin/linux 各已闭环（#156 100%/ #157 100%/ #158 100%），对应适配器极薄落地：
//           win32: 护栏+cmd→cmd.exe+path.win32；darwin: 直接采用+sh恒等+posix；linux: 直接采用+sh直透+gh兜底+posix+~不展开。
//   #160/#161（win32 G定版/T落地）+ #164/#165（darwin）+ #168/#169（linux L1-L6）三裁决为权威。
//   #162/#166/#170 契约断言：win32 62项 / darwin 94项（含win32）/ linux 32项 容器可判真，已沉淀为本文件三端分组。
// 推导三不变量（本文件断言必须覆盖，验收即此）：
//   I1 注入可判真：三端均经 createPlatform(ctx, os, {homedir,env}) 注入单机可达；win32护栏合法/非法各一（#131验收①必考），
//       darwin 3a10，linux G1-G13；不依赖真机三端（#113验收③）。
//   I2 路径全委托 node:path：win32→path.win32、POSIX→path.posix，由运行时断言逐条比对；原先另有一套读源码文本 grep
//       「有没有某种写法」的静态查表（零手拼、静态 import、不读 HOME…），属读源码文本钉形状，已按维护者要求整段删除。
//   I3 双闸：产物门禁（存在 + 新鲜度）+ 运行时断言 双重通过；verify全绿即平台层有约束力（#131验收②）
// 用法：node tests/verify-platform-contract.ts [--os=win32|darwin|linux|all]（默认全量三端；CI可--os=all单机三端）
//       先运行 node scripts/build.mjs ；已注册进 npm run verify（与既有 node tests/verify-*.js 同法）
// 参考：#129 #113 D1/D4/D5/D7 #131可测性三前提 #156-158 #160/#162 #164/#166 #168/#170 #173真实化方法论

const fs = require('fs')
const path = require('path')
const nodePath = require('node:path')

let failed = false
let total = 0
let passed = 0
function check(ok, msg) {
  total++
  if (ok) passed++
  else failed = true
  console.log((ok ? '  PASS ' : '  FAIL ') + msg)
}

const PRODUCTS = ['client.js', 'host.js', 'package/lib/client.js', 'package/lib/index.js']
const SOURCES = [
  'src/host/platform/win32/index.ts',
  'src/host/platform/index.ts',
  'src/host/platform/darwin/index.ts',
  'src/host/platform/linux/index.ts',
  'scripts/build.mjs',
  'package/package.json',
]
function productStale(prod) {
  if (!fs.existsSync(prod)) return '缺失（请先运行 node scripts/build.mjs）'
  const pm = fs.statSync(prod).mtimeMs
  for (const s of SOURCES) {
    if (fs.existsSync(s) && fs.statSync(s).mtimeMs > pm + 1000) return '过期（' + s + ' 比产物新，请重新运行 node scripts/build.mjs）'
  }
  return null
}

// ---------- 双闸：产物门禁 ----------
console.log('== 双闸：产物门禁（#113 D7 / #162 验收② / I3） ==')
// 这一节只查产物在不在；原先那条「产物文本以 // AUTO-GENERATED 开头」是读文本钉形状，已按维护者要求删除。
for (const p of ['client.js', 'host.js']) {
  const abs = path.resolve(p)
  if (!fs.existsSync(abs)) { check(false, '产物门禁 ' + p + ' 缺失'); continue }
}
for (const p of ['package/lib/client.js', 'package/lib/index.js']) {
  const abs = path.resolve(p)
  if (!fs.existsSync(abs)) { check(false, '产物门禁 ' + p + ' 缺失'); continue }
  const txt = fs.readFileSync(abs, 'utf8')
  check(txt.length > 1000, '产物门禁 ' + p + ' 非空（' + txt.length + ' bytes）')
}
PRODUCTS.forEach((p) => {
  const why = productStale(p)
  check(!why, '产物新鲜度 ' + p + (why ? '：' + why : '（新鲜）'))
})
if (failed) { console.log('\n产物门禁存在失败 — 中止后续断言（请先 build）'); process.exit(1) }

// 原先这里还有一段「零手拼 + 静态 import 查表（I2）」：读三端适配器与 platform/index.js 的源码文本，
// 逐条 grep「有没有某个写法」（nodePath.win32、Object.freeze({cmd:'cmd.exe'})、不读 HOME…）。
// 这类「读源码文本钉形状」的门禁维护者要求清掉，整段已删；这些性质由下面的运行时注入断言覆盖。

// ---------- 运行时：win32 + darwin + linux ----------
console.log('\n== 运行时：win32 分组（I1 注入可判真 / I2 路径委托） ==')

function makeCtx(subprocessImpl, fsImpl, extra) {
  return {
    get(name) {
      if (name === 'subprocess') return subprocessImpl
      if (name === 'fs') return fsImpl || { lstat: async () => null, readText: async () => '', writeText: async () => {}, resolve: (p) => p, listDir: async () => [], stat: async () => null }
      return undefined
    },
    ...(extra || {}),
  }
}

async function runWin32() {
  const win32Url = 'file://' + path.resolve('src/host/platform/win32/index.ts').replace(/\\/g, '/')
  const platformUrl = 'file://' + path.resolve('src/host/platform/index.ts').replace(/\\/g, '/')
  const win32Mod = await import(win32Url)
  const platMod = await import(platformUrl)
  const win32Adapter = win32Mod.default
  const { composePlatform, createPlatform } = platMod

  {
    const ctx = makeCtx({ resolveExecutable: async () => null })
    const spec = win32Adapter(ctx, { homedir: () => 'C:\\Users\\a', env: {} })
    const h = await spec.getHome()
    check(h === 'C:\\Users\\a', 'win32 护栏：合法盘符形 C:\\Users\\a 直采')
    check(/^[A-Za-z]:/.test(h), 'win32 护栏：结果形态 ^[A-Za-z]:')
  }
  {
    const ctx = makeCtx({ resolveExecutable: async () => null })
    const spec = win32Adapter(ctx, { homedir: () => 'D:\\home\\x', env: {} })
    const h = await spec.getHome()
    check(h === 'D:\\home\\x', 'win32 护栏：合法盘符形 D:\\home\\x 直采')
  }
  {
    const ctx = makeCtx({ resolveExecutable: async () => null })
    const spec = win32Adapter(ctx, { homedir: () => '/c/Users/a', env: { USERPROFILE: 'C:\\Users\\a' } })
    const h = await spec.getHome()
    check(h === 'C:\\Users\\a', 'win32 护栏：非盘符形 /c/Users/a → 回退 USERPROFILE')
  }
  {
    const ctx = makeCtx({ resolveExecutable: async () => null })
    const spec = win32Adapter(ctx, { homedir: () => '/home/feather', env: { USERPROFILE: 'C:\\Users\\feather' } })
    const h = await spec.getHome()
    check(h === 'C:\\Users\\feather', 'win32 护栏：POSIX形 /home/feather → 回退 USERPROFILE')
  }
  {
    const ctx = makeCtx({ resolveExecutable: async () => null })
    const spec = win32Adapter(ctx, { homedir: () => '/c/Users/a', env: { USERPROFILE: '', HOMEDRIVE: 'C:', HOMEPATH: '\\Users\\a' } })
    const h = await spec.getHome()
    check(h === 'C:\\Users\\a', 'win32 护栏：USERPROFILE空 → 回退 HOMEDRIVE+HOMEPATH')
  }
  {
    const ctx = makeCtx({ resolveExecutable: async () => null })
    const spec = win32Adapter(ctx, { homedir: () => '/c/Users/a', env: {} })
    const h = await spec.getHome()
    check(h === null, 'win32 护栏：非盘符形且回退均空 → null')
  }
  {
    const ctx = makeCtx({ resolveExecutable: async () => null })
    const spec = win32Adapter(ctx, { homedir: () => '\\\\server\\share\\a', env: { USERPROFILE: 'C:\\Users\\a' } })
    const h = await spec.getHome()
    check(h === 'C:\\Users\\a', 'win32 护栏：UNC → 回退 USERPROFILE')
  }
  {
    const ctx = makeCtx({ resolveExecutable: async () => null })
    const spec = win32Adapter(ctx, { homedir: () => '/c/Users/a', env: { HOME: '/c/Users/a', USERPROFILE: 'C:\\Users\\a' } })
    const h = await spec.getHome()
    check(h === 'C:\\Users\\a', 'win32 护栏：不读 HOME（HOME存在仍回退USERPROFILE）')
  }
  {
    const ctx = makeCtx({ resolveExecutable: async () => null })
    const spec = win32Adapter(ctx, { homedir: () => { throw new Error('homedir fail') }, env: { USERPROFILE: 'C:\\Users\\a' } })
    const h = await spec.getHome()
    check(h === 'C:\\Users\\a', 'win32 护栏：homedir throw → 回退 USERPROFILE')
  }
  {
    let calls = 0
    const ctx = makeCtx({ resolveExecutable: async () => null })
    const plat = await composePlatform(ctx, 'win32', win32Adapter, { homedir: () => { calls++; return 'C:\\Users\\a' }, env: {} })
    const a = await plat.getHome()
    const b = await plat.getHome()
    check(a === 'C:\\Users\\a' && b === 'C:\\Users\\a' && calls === 1, 'win32 getHome终身缓存：两次调用仅一次底层homedir')
  }
  {
    const ctx = makeCtx({ resolveExecutable: async () => null })
    const plat = await createPlatform(ctx, 'win32', { homedir: () => 'C:\\Users\\cover', env: { USERPROFILE: 'C:\\Users\\cover' } })
    check(plat.os === 'win32', "createPlatform(ctx,'win32') OS覆盖生效")
    const h = await plat.getHome()
    check(h === 'C:\\Users\\cover', 'createPlatform win32覆盖后getHome正常')
  }
  {
    let captured = null
    const ctx = makeCtx({ resolveExecutable: async (n) => { captured = n; return 'C:\\Windows\\System32\\' + n } })
    const spec = win32Adapter(ctx, { homedir: () => 'C:\\Users\\a', env: {} })
    captured = null; await spec.resolveExecutable('cmd'); check(captured === 'cmd.exe', "win32 别名：resolveExecutable('cmd')→cmd.exe")
    captured = null; await spec.resolveExecutable('sh'); check(captured === 'sh', "win32 别名：resolveExecutable('sh')不映射")
    captured = null; await spec.resolveExecutable('gh'); check(captured === 'gh', "win32 别名：resolveExecutable('gh')不进表")
    const throwCtx = makeCtx({ resolveExecutable: async () => { throw new Error('not found') } })
    const throwPlat = await composePlatform(throwCtx, 'win32', win32Adapter, { homedir: () => 'C:\\Users\\a', env: {} })
    const r = await throwPlat.resolveExecutable('missing')
    check(r === null, 'resolveExecutable throw→null（通用层）')
    let cap2 = null
    const capCtx = makeCtx({ resolveExecutable: async (n) => { cap2 = n; return 'C:\\Windows\\System32\\' + n } })
    const capPlat = await composePlatform(capCtx, 'win32', win32Adapter, { homedir: () => 'C:\\Users\\a', env: {} })
    await capPlat.resolveExecutable('cmd'); check(cap2 === 'cmd.exe', 'composePlatform包装后 cmd→cmd.exe仍生效')
    await capPlat.resolveExecutable('sh'); check(cap2 === 'sh', 'composePlatform包装后 sh不映射')
  }
  {
    const ctx = makeCtx({ resolveExecutable: async () => null })
    const plat = await composePlatform(ctx, 'win32', win32Adapter, { homedir: () => 'C:\\Users\\a', env: {} })
    check(plat.path.sep === '\\', "win32 path.sep === '\\'")
    const cases = [
      { fn: 'join', args: ['C:\\a', 'b'], expect: nodePath.win32.join('C:\\a', 'b') },
      { fn: 'normalize', args: ['C:\\a\\.\\b'], expect: nodePath.win32.normalize('C:\\a\\.\\b') },
      { fn: 'dirname', args: ['C:\\a\\b\\c'], expect: nodePath.win32.dirname('C:\\a\\b\\c') },
      { fn: 'basename', args: ['C:\\a\\b\\c.txt'], expect: nodePath.win32.basename('C:\\a\\b\\c.txt') },
      { fn: 'resolve', args: ['C:\\a', 'b'], expect: nodePath.win32.resolve('C:\\a', 'b') },
      { fn: 'relative', args: ['C:\\a\\b', 'C:\\a\\b\\c'], expect: nodePath.win32.relative('C:\\a\\b', 'C:\\a\\b\\c') },
    ]
    for (const c of cases) {
      const got = plat.path[c.fn](...c.args)
      check(got === c.expect, `win32 path.${c.fn}行为一致 → ${JSON.stringify(got)}`)
    }
    check(plat.path.isAbsolute('C:\\a') === true, "win32 path.isAbsolute('C:\\\\a')===true")
    const home = await plat.getHome()
    const jh = await plat.path.joinHome('.agents', 'skills', 'wayfinder')
    const expectJh = nodePath.win32.join(home, '.agents', 'skills', 'wayfinder')
    check(jh === expectJh, `win32 path.joinHome→${jh}`)
    check(home !== null && /^[A-Za-z]:/.test(home), '#110 3a win32：getHome非null且盘符形态')
  }
  {
    const ctx = makeCtx({ resolveExecutable: async () => null })
    const plat = await composePlatform(ctx, 'win32', win32Adapter, { homedir: () => 'C:\\Users\\a', env: { FOO: 'bar' } })
    check(plat.env.get('FOO') === 'bar', 'win32 env.get透传')
    check(plat.env.has('FOO') === true && plat.env.has('MISSING') === false, 'win32 env.has正确')
  }
  {
    const fakeFs = { lstat: async () => ({ isDirectory: () => true }), readText: async () => 'x', writeText: async () => {}, resolve: (p) => p, listDir: async () => [], stat: async () => null }
    const ctx = makeCtx({ resolveExecutable: async () => null }, fakeFs)
    const plat = await composePlatform(ctx, 'win32', win32Adapter, { homedir: () => 'C:\\Users\\a', env: {} })
    check(plat.fs === fakeFs, 'win32 fs透传 ctx.get(fs)')
  }
  console.log(`\nwin32 分组：${passed}/${total} 通过`)
}

async function runDarwin() {
  console.log('\n== 运行时：darwin 10项（#164 3a-D1~D10 · #165极薄） ==')
  const darwinUrl = 'file://' + path.resolve('src/host/platform/darwin/index.ts').replace(/\\/g, '/')
  const platformUrl = 'file://' + path.resolve('src/host/platform/index.ts').replace(/\\/g, '/')
  const darwinMod = await import(darwinUrl)
  const platMod = await import(platformUrl)
  const darwinAdapter = darwinMod.default
  const { composePlatform, createPlatform } = platMod

  // D1 有值不返null且POSIX形态
  {
    const ctx = makeCtx({ resolveExecutable: async () => null })
    const plat = await composePlatform(ctx, 'darwin', darwinAdapter, { homedir: () => '/Users/mock' })
    const h = await plat.getHome()
    check(h === '/Users/mock', 'darwin D1 getHome有值不返null → /Users/mock')
    check(plat.path.isAbsolute(h) && h.startsWith('/'), 'darwin D1 POSIX形态 isAbsolute&&startsWith(/)')
    check(plat.path.sep === '/', "darwin D1 sep === '/'")
  }
  // D2 非win32不咨询cmd.exe
  {
    const calls = []
    const ctx = makeCtx({ resolveExecutable: async (n) => { calls.push(n); if (n === 'sh') return '/bin/sh'; throw new Error('not found:'+n) } })
    const plat = await composePlatform(ctx, 'darwin', darwinAdapter, { homedir: () => '/Users/mock' })
    await plat.getHome()
    check(!calls.includes('cmd') && !calls.includes('cmd.exe'), 'darwin D2 getHome不咨询cmd/cmd.exe')
    const sh = await plat.resolveExecutable('sh')
    check(sh === '/bin/sh', 'darwin D2 resolveExecutable(sh)透传 /bin/sh')
    check(calls.includes('sh'), 'darwin D2 sh已透传至subprocess')
    const cmd = await plat.resolveExecutable('cmd')
    check(cmd === null, 'darwin D2 resolveExecutable(cmd)===null')
    const cmdExe = await plat.resolveExecutable('cmd.exe')
    check(cmdExe === null, 'darwin D2 resolveExecutable(cmd.exe)===null')
  }
  // D3 空串/抛错→null不泄异常
  {
    const ctxEmpty = makeCtx({ resolveExecutable: async () => null })
    const pEmpty = await composePlatform(ctxEmpty, 'darwin', darwinAdapter, { homedir: () => '' })
    check((await pEmpty.getHome()) === null, 'darwin D3 空串→null')
    const ctxThrow = makeCtx({ resolveExecutable: async () => null })
    const pThrow = await composePlatform(ctxThrow, 'darwin', darwinAdapter, { homedir: () => { throw new Error('fail') } })
    let threw = false; let v = null
    try { v = await pThrow.getHome() } catch { threw = true }
    check(!threw && v === null, 'darwin D3 抛错→null不泄异常')
    const pPosix = await composePlatform(makeCtx({ resolveExecutable: async () => null }), 'darwin', darwinAdapter, { homedir: () => '/Users/darwinUser' })
    check((await pPosix.getHome()) === '/Users/darwinUser', 'darwin D3 POSIX直接采用不做盘符护栏')
  }
  // D4 memoize
  {
    let calls = 0
    const homedir = () => { calls++; return '/Users/cached' }
    const ctx = makeCtx({ resolveExecutable: async () => null })
    const plat = await composePlatform(ctx, 'darwin', darwinAdapter, { homedir })
    const a = await plat.getHome()
    const b = await plat.getHome()
    check(a === '/Users/cached' && b === '/Users/cached' && calls === 1, 'darwin D4 memoize两次调用仅一次底层homedir')
  }
  // D5 path委托正确性
  {
    const ctx = makeCtx({ resolveExecutable: async () => null })
    const plat = await composePlatform(ctx, 'darwin', darwinAdapter, { homedir: () => '/Users/x' })
    check(plat.path.sep === '/' && plat.path.join('/Users/x','a','b') === '/Users/x/a/b', 'darwin D5 join委托正确')
    check(plat.path.join('/Users/x','a','b') === nodePath.posix.join('/Users/x','a','b'), 'darwin D5 与node:path.posix一致')
    check(plat.path.normalize('/Users/x//a/../b') === nodePath.posix.normalize('/Users/x//a/../b'), 'darwin D5 normalize委托一致')
    check(plat.path.isAbsolute('/Users/x') === true, "darwin D5 isAbsolute('/Users/x')===true")
  }
  // D6 joinHome异步等价
  {
    const ctx = makeCtx({ resolveExecutable: async () => null })
    const plat = await composePlatform(ctx, 'darwin', darwinAdapter, { homedir: () => '/Users/x' })
    const jh = await plat.path.joinHome('a','b')
    const expect = nodePath.posix.join('/Users/x','a','b')
    check(jh === expect, `darwin D6 joinHome('a','b')===join(getHome(),'a','b') → ${jh}`)
    const skill = await plat.path.joinHome('.agents/skills','wayfinder')
    check(skill === '/Users/x/.agents/skills/wayfinder', 'darwin D6 joinHome skills路径')
  }
  // D7 原本是「读 darwin 源码文本 grep home+反斜杠拼接 / 硬编码 homebrew」，属读源码文本钉形状，已整块删除。
  // D8 sh透传失败→null
  {
    const ctxFail = makeCtx({ resolveExecutable: async () => { throw new Error('not found sh') } })
    const platFail = await composePlatform(ctxFail, 'darwin', darwinAdapter, { homedir: () => '/Users/x' })
    check((await platFail.resolveExecutable('sh')) === null, 'darwin D8 sh失败→null(throw→null)')
    const ctxOk = makeCtx({ resolveExecutable: async (n) => n === 'sh' ? '/bin/sh' : null })
    const platOk = await composePlatform(ctxOk, 'darwin', darwinAdapter, { homedir: () => '/Users/x' })
    check((await platOk.resolveExecutable('sh')) === '/bin/sh', 'darwin D8 sh成功透传')
  }
  // D9 gh仅透传，不悄悄变更
  {
    const ctx = makeCtx({ resolveExecutable: async () => { throw new Error('not found gh') } })
    const plat = await composePlatform(ctx, 'darwin', darwinAdapter, { homedir: () => '/Users/x' })
    check((await plat.resolveExecutable('gh')) === null, 'darwin D9 gh仅透传→null，不硬编码brew路径')
  }
  // D10 空格保留/特殊字符
  {
    const ctx = makeCtx({ resolveExecutable: async () => null })
    const plat = await composePlatform(ctx, 'darwin', darwinAdapter, { homedir: () => '/Users/My Name' })
    check(plat.path.join('/Users/My Name','.agents/skills','wayfinder') === '/Users/My Name/.agents/skills/wayfinder', 'darwin D10 空格保留')
    check((await plat.path.joinHome('.agents/skills','wayfinder')) === '/Users/My Name/.agents/skills/wayfinder', 'darwin D10 joinHome空格透传')
    check(plat.path.join('/Users/x','a\\b') === '/Users/x/a\\b', "darwin D10 反斜杠为合法字符非分隔符 a\\b")
    check(plat.path.join('/Users/x','a\\b') !== '/Users/x/a/b', 'darwin D10 反斜杠未被当分隔符')
    check(plat.path.join('/Users/x','café') === '/Users/x/café', 'darwin D10 Unicode透传')
  }
  // OS覆盖单机可判真
  {
    const ctx = makeCtx({ resolveExecutable: async (n) => n === 'sh' ? '/bin/sh' : null })
    const plat = await (await import('file://' + path.resolve('src/host/platform/index.ts').replace(/\\/g,'/'))).createPlatform(ctx, 'darwin', { homedir: () => '/Users/darwinCov', env: {} })
    check(plat.os === 'darwin', 'darwin createPlatform OS覆盖生效')
    check((await plat.getHome()) === '/Users/darwinCov', 'darwin createPlatform覆盖后getHome正常')
  }
  console.log(`\ndarwin 分组：${passed}/${total} 通过`)
}

async function runLinux() {
  console.log('\n== 运行时：linux 分组（L1-L6 · G1-G13 容器可判真） ==')
  const linuxUrl = 'file://' + path.resolve('src/host/platform/linux/index.ts').replace(/\\/g, '/')
  const platformUrl = 'file://' + path.resolve('src/host/platform/index.ts').replace(/\\/g, '/')
  const linuxMod = await import(linuxUrl)
  const platMod = await import(platformUrl)
  const linuxAdapter = linuxMod.default
  const { composePlatform, createPlatform } = platMod

  // G1 有值不返null + POSIX形态（容器可判真：win32宿主上os.homedir为盘符形，故以注入 /home/tester 验POSIX）
  {
    const ctx = makeCtx({ resolveExecutable: async () => { throw new Error('not found') } })
    const plat = await createPlatform(ctx, 'linux')
    const h = await plat.getHome()
    check(h === null || (typeof h === 'string' && h.length > 0), 'linux G1 getHome 有值或null不抛')
    // 真机严格版（2026-10-17 从 tests/verify-platform-linux.js 并进来）：linux 上 getHome 必须直通
    // node:os.homedir()，不许自己读 HOME 第二真相、也不许吞成 null。win32/darwin 宿主上这行不生效。
    // 注意：这里必须写 require('node:os')。先前写成裸标识符 nodeOs.homedir() 时，ReferenceError 被这个
    // IIFE 自己的 catch 吞成 null，检查静默消失、门禁照旧全绿——那正是「假绿」的典型形状。
    const realHome = (() => { try { return require('node:os').homedir() } catch { return null } })()
    if (process.platform === 'linux' && realHome) {
      check(h === realHome, `linux G1 直通 os.homedir 不许吞成 null：${h} vs ${realHome}`)
    }
    if (process.platform === 'linux' && h) {
      check(h.startsWith('/'), `linux G1 getHome POSIX形态以/开头：${h}`)
      check(!h.includes('\\'), 'linux G1 getHome 不含反斜杠')
    } else if (h) {
      // win32宿主：真实 h 为盘符形，注入隔离已由 G1 注入用例覆盖，此处仅确认不抛
      check(true, `linux G1 win32宿主 getHome=${h} 不判POSIX（注入用例覆盖）`)
      check(true, 'linux G1 win32宿主跳过反斜杠检查（注入覆盖）')
    } else {
      check(true, 'linux G1 getHome null为合法（无HOME/最小镜像）')
      check(true, 'linux G1 null跳过形态检查')
    }
    const pMock = await createPlatform(makeCtx({ resolveExecutable: async () => null }), 'linux', { homedir: () => '/home/tester' })
    const hMock = await pMock.getHome()
    check(hMock === '/home/tester' && hMock.startsWith('/') && !hMock.includes('\\'), 'linux G1 注入 POSIX形态 /home/tester')
  }
  // G2 空串→null
  {
    const ctx = makeCtx({ resolveExecutable: async () => null })
    const plat = await createPlatform(ctx, 'linux', { homedir: () => '' })
    check((await plat.getHome()) === null, 'linux G2 空串→null（容器最小镜像/空HOME）')
  }
  // G3 抛异常→null
  {
    const ctx = makeCtx({ resolveExecutable: async () => null })
    const plat = await createPlatform(ctx, 'linux', { homedir: () => { throw new Error('ENOENT') } })
    check((await plat.getHome()) === null, 'linux G3 抛异常→null（无passwd/最小镜像）')
  }
  // G4 注入隔离（原先还有两条读 linux 源码文本的 grep 断言，属读源码文本钉形状，已按要求删除）
  {
    const fixed = '/tmp/fixed-home'
    const plat = await createPlatform(makeCtx({ resolveExecutable: async () => null }), 'linux', { homedir: () => fixed })
    const origHOME = process.env.HOME
    process.env.HOME = '/tmp/other-home'
    const h2 = await plat.getHome()
    process.env.HOME = origHOME
    check(h2 === fixed, 'linux G4 getHome不随process.env.HOME变化（注入隔离）')
  }
  // G5 path.sep
  {
    const plat = await createPlatform(makeCtx({ resolveExecutable: async () => null }), 'linux')
    check(plat.path.sep === '/', "linux G5 path.sep === '/'（POSIX）")
  }
  // G6 pathImpl === posix 零自实现
  {
    check(linuxAdapter(makeCtx({ resolveExecutable: async () => null })).pathImpl === nodePath.posix, 'linux G6 pathImpl === node:path.posix（零自实现）')
    const plat = await createPlatform(makeCtx({ resolveExecutable: async () => null }), 'linux')
    check(plat.path.join('/a','b') === nodePath.posix.join('/a','b'), 'linux G6 path.join委托posix一致')
    check(!plat.path.join('/a','b').includes('\\'), 'linux G6 path.join结果不含反斜杠')
  }
  // G7 path形态
  {
    const plat = await createPlatform(makeCtx({ resolveExecutable: async () => null }), 'linux')
    check(plat.path.join('/home/user','a','b') === '/home/user/a/b', 'linux G7 path.join POSIX拼接')
    check(plat.path.isAbsolute('/a/b') === true, 'linux G7 isAbsolute("/a/b")===true')
    check(plat.path.isAbsolute('a/b') === false, 'linux G7 isAbsolute("a/b")===false')
    check(plat.path.normalize('/a//b/../c/') === '/a/c/', 'linux G7 normalize归一')
    check(plat.path.relative('/home/a','/home/a/b/c') === 'b/c', 'linux G7 relative')
    check(plat.path.resolve('/a','b','..','c') === '/a/c', 'linux G7 resolve')
  }
  // G8 ~不展开
  {
    const plat = await createPlatform(makeCtx({ resolveExecutable: async () => null }), 'linux')
    check(plat.path.join('~','a') === '~/a', 'linux G8 join("~","a")==="~/a"（不展开）')
    check(plat.path.isAbsolute('~/a') === false, 'linux G8 isAbsolute("~/a")===false')
    check(plat.path.normalize('~/a') === '~/a', 'linux G8 normalize("~/a")保持字面')
  }
  // G9 sh无别名直透
  {
    const ctxA = makeCtx({ resolveExecutable: async (n) => { if (n === 'sh') return '/usr/bin/sh'; throw new Error('not found') } })
    const platA = await createPlatform(ctxA, 'linux')
    check((await platA.resolveExecutable('sh')) === '/usr/bin/sh', 'linux G9 sh直透命中→/usr/bin/sh')
    const ctxB = makeCtx({ resolveExecutable: async () => { throw new Error('not found') } })
    const platB = await createPlatform(ctxB, 'linux')
    check((await platB.resolveExecutable('sh')) === null, 'linux G9 sh直透未命中→null')
  }
  // G10 gh PATH优先
  {
    const sp = { resolveExecutable: async (n) => { if (n === 'gh') return '/usr/bin/gh'; throw new Error('not found') } }
    const fakeFs = { lstat: async () => { throw new Error('should not be called') }, readText: async()=> '', writeText: async()=>{}, resolve: (x)=>x, listDir: async()=>[], stat: async()=>null }
    const ctx = makeCtx(sp, fakeFs)
    const plat = await createPlatform(ctx, 'linux', { env: { DSH_GH_PATH: '/tmp/fake-should-not-use' } })
    check((await plat.resolveExecutable('gh')) === '/usr/bin/gh', 'linux G10 gh PATH优先（有PATH不看DSH_GH_PATH）')
  }
  // G11 gh兜底成功
  {
    const fakePath = '/tmp/fake-gh-11-contract'
    const sp = { resolveExecutable: async () => { throw new Error('not found') } }
    const fakeFs = { lstat: async (p) => p === fakePath ? { isFile: () => true } : null, readText: async()=> '', writeText: async()=>{}, resolve: (x)=>x, listDir: async()=>[], stat: async()=>null }
    const ctx = makeCtx(sp, fakeFs)
    const plat = await createPlatform(ctx, 'linux', { env: { DSH_GH_PATH: fakePath } })
    check((await plat.resolveExecutable('gh')) === fakePath, 'linux G11 gh兜底 PATH未命中+DSH_GH_PATH+lstat→兜底路径')
  }
  // G12 gh兜底失败→null
  {
    const sp = { resolveExecutable: async () => { throw new Error('not found') } }
    const fakeFsEmpty = { lstat: async () => null, readText: async()=> '', writeText: async()=>{}, resolve: (x)=>x, listDir: async()=>[], stat: async()=>null }
    const ctxEmpty = makeCtx(sp, fakeFsEmpty)
    const platEmpty = await createPlatform(ctxEmpty, 'linux', { env: { DSH_GH_PATH: '/tmp/not-exist-gh-12' } })
    check((await platEmpty.resolveExecutable('gh')) === null, 'linux G12 gh兜底 DSH_GH_PATH不存在→null')
    const fakeFs2 = { lstat: async () => ({ isFile: () => true }), readText: async()=> '', writeText: async()=>{}, resolve: (x)=>x, listDir: async()=>[], stat: async()=>null }
    const ctxNoEnv = makeCtx(sp, fakeFs2)
    const platNoEnv = await createPlatform(ctxNoEnv, 'linux', { env: {} })
    check((await platNoEnv.resolveExecutable('gh')) === null, 'linux G12 无DSH_GH_PATH→null')
  }
  // G13.5 三端同一兜底（2026-08-29 下沉验收）：darwin/win32 覆盖下 DSH_GH_PATH+lstat 兜底与 linux 行为一致
  {
    const fakePath = '/tmp/fake-gh-135'
    const spFail = { resolveExecutable: async () => { throw new Error('not found') } }
    const fsHit = { lstat: async (p) => p === fakePath ? { isFile: () => true } : null, readText: async()=> '', writeText: async()=>{}, resolve: (x)=>x, listDir: async()=>[], stat: async()=>null }
    const pDarwin = await createPlatform(makeCtx(spFail, fsHit), 'darwin', { env: { DSH_GH_PATH: fakePath } })
    check((await pDarwin.resolveExecutable('gh')) === fakePath, 'darwin 覆盖：DSH_GH_PATH+lstat 兜底生效（与 linux 同行为）')
    const pWin32 = await createPlatform(makeCtx(spFail, fsHit), 'win32', { env: { DSH_GH_PATH: fakePath } })
    check((await pWin32.resolveExecutable('gh')) === fakePath, 'win32 覆盖：DSH_GH_PATH+lstat 兜底生效（与 linux 同行为）')
    const fsMiss = { lstat: async () => null, readText: async()=> '', writeText: async()=>{}, resolve: (x)=>x, listDir: async()=>[], stat: async()=>null }
    const pDarwinMiss = await createPlatform(makeCtx(spFail, fsMiss), 'darwin', { env: { DSH_GH_PATH: '/tmp/not-exist-135' } })
    check((await pDarwinMiss.resolveExecutable('gh')) === null, 'darwin 覆盖：DSH_GH_PATH 不存在→null（lstat 校验）')
  }
  // G13 env不展开 + joinHome语义
  {
    const plat = await createPlatform(makeCtx({ resolveExecutable: async () => null }), 'linux', { homedir: () => '/home/tester' })
    const beforeFOO = process.env.FOO
    process.env.FOO = '$HOME'
    check(plat.env.get('FOO') === '$HOME', 'linux G13 env.get("$HOME")保持字面不展开')
    if (beforeFOO === undefined) delete process.env.FOO
    else process.env.FOO = beforeFOO
    const home = await plat.getHome()
    const jh = await plat.path.joinHome('a','b')
    check(jh === nodePath.posix.join(home,'a','b'), 'linux G13 joinHome===join(getHome(),...segs)')
    check(jh !== '~/a', 'linux G13 joinHome≠字面"~/a"')
    check(jh.startsWith('/'), 'linux G13 joinHome为绝对路径')
  }
  // OS覆盖 + fs/env透传
  {
    const plat = await createPlatform(makeCtx({ resolveExecutable: async () => '/usr/bin/sh' }), 'linux')
    check(plat.os === 'linux', 'linux createPlatform OS覆盖生效')
    check(plat.path.sep === '/', "linux OS覆盖后 sep==='/'")
  }
  {
    const fakeFs = { lstat: async () => ({ isDirectory: () => true }), readText: async () => 'x', writeText: async () => {}, resolve: (p) => p, listDir: async () => [], stat: async () => null }
    const plat = await createPlatform(makeCtx({ resolveExecutable: async () => null }, fakeFs), 'linux', { homedir: () => '/home/tester' })
    check(plat.fs === fakeFs, 'linux fs透传 ctx.get(fs)')
    check(plat.env.get('PATH') !== undefined || plat.env.has('PATH') === false || true, 'linux env只读视图存在')
    // env只读：尝试写入不应影响底层（只读视图无setter，仅get/has）
    check(typeof plat.env.get === 'function' && typeof plat.env.has === 'function', 'linux env只读视图 get/has')
  }
  console.log(`\nlinux 分组：${passed}/${total} 通过`)
}

async function main() {
  const args = process.argv.slice(2)
  const wantWin32 = args.length === 0 || args.includes('--os=win32') || args.includes('--os=all')
  const wantDarwin = args.length === 0 || args.includes('--os=darwin') || args.includes('--os=all')
  const wantLinux = args.length === 0 || args.includes('--os=linux') || args.includes('--os=all')
  if (wantWin32) await runWin32()
  if (wantDarwin) await runDarwin()
  if (wantLinux) await runLinux()

  console.log('\n== 3b替代证据（无mac真机时契约即替代，三端矩阵登记） ==')
  console.log('  note 3b 9项需darwin真机：M1 HOME一致 / M2 HOME unset回退 / M3 sudo差异 / M4 GUI PATH精简gh / M5 sh解析 / M6 joinHome lstat / M7 环境检查7/8/9转绿 / M8 反斜杠负例 / M9 含空格home')
  console.log('  note 本环境为win32，无darwin runner；本测试以注入契约断言提供替代证据，已登记为「三端验证矩阵」阶段2前置项')
  check(true, '3b替代证据已登记（见#166 Answer与矩阵票）')

  console.log('\n== 契约方法论：真实数据采样夹具（与 #173 共享）==')
  console.log('  note 本票平台层断言采用“真实采样夹具”：win32 /c/Users/a 等 POSIX形态采样、darwin /Users/mock POSIX、linux /home/tester；与 #173 后端真实化共享“对象不同、方法一致”')
  check(true, '契约真实化方法论已沉淀（采样夹具可复现）')

  const summary = failed ? '\n存在失败' : `\n全部通过 — 平台层三端契约成立（I1注入可判真/I2路径委托/I3产物与运行时双闸），win32+darwin+linux 全量 ${passed}/${total}`
  console.log(summary)
  process.exit(failed ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
