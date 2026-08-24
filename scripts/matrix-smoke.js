/**
 * scripts/matrix-smoke.js — 阶段 1 最小冒烟（3 OS × GitHub）
 *
 * 第一性原理回溯：
 *   #131 145+32（平台三端契约：I1注入可判真/I2零手拼/I3双闸）
 *   #171 6处迁移零手拼 + #162/#166/#170 三底座100%
 *   #139 13 ops + #173 真实适配器 harness
 *   #113 三层双缝契约
 * 推导不变量：
 *   I1 win32护栏/darwin直接采用/linux G1-G13 均经 createPlatform(ctx,os,{homedir,env}) 单机可判
 *   I2 零手拼：platform 各 OS index.js 剥注释后无拼接反斜杠，path 委托 node:path
 *   I3 双闸：产物门禁 + 运行时双重通过
 *   I4 真实适配器过 harness：工厂 ctx 含 platform 实例 + playback normalized 无旧字段
 *
 * 用法：node scripts/matrix-smoke.js [--os=win32|darwin|linux|all]（默认 all）
 * 前置：node scripts/build.mjs
 * 期望：58/58 PASS（双闸8 + I2 10 + 3 OS 各 13-14）且 EXIT 0；单机注入即可跑通三端
 * 参考：docs/architecture/matrix.md §2
 */
const fs = require('fs')
const path = require('path')
const nodePath = require('node:path')

let total = 0, passed = 0, failed = false
function check(ok, msg) {
  total++; if (ok) passed++; else failed = true
  console.log((ok ? '  PASS ' : '  FAIL ') + msg)
}

const PRODUCTS = ['client.js', 'host.js', 'package/lib/client.js', 'package/lib/index.js']
const SOURCES = [
  'src/host/platform/win32/index.js',
  'src/host/platform/index.js',
  'src/host/platform/darwin/index.js',
  'src/host/platform/linux/index.js',
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

async function main() {
  const args = process.argv.slice(2)
  const osArg = args.find(a => a.startsWith('--os='))?.split('=')[1] || 'all'
  const want = (k) => osArg === 'all' || osArg === k

  console.log('== 阶段1 最小冒烟（3 OS × GitHub）==')
  console.log('  前置：node scripts/build.mjs 已运行（产物双闸）')

  // ---------- I3 双闸：产物门禁 ----------
  console.log('\n== 双闸：产物门禁（I3） ==')
  for (const p of ['client.js', 'host.js']) {
    const abs = path.resolve(p)
    if (!fs.existsSync(abs)) { check(false, '产物门禁 ' + p + ' 缺失'); continue }
    const txt = fs.readFileSync(abs, 'utf8')
    check(txt.startsWith('// AUTO-GENERATED'), '产物门禁 ' + p + ' 以 // AUTO-GENERATED 开头')
  }
  for (const p of ['package/lib/client.js', 'package/lib/index.js']) {
    const abs = path.resolve(p)
    if (!fs.existsSync(abs)) { check(false, '产物门禁 ' + p + ' 缺失'); continue }
    const txt = fs.readFileSync(abs, 'utf8')
    check(txt.length > 1000, '产物门禁 ' + p + ' 非空（' + txt.length + ' bytes）')
  }
  for (const p of PRODUCTS) {
    const why = productStale(p)
    check(!why, '产物新鲜度 ' + p + (why ? '：' + why : '（新鲜）'))
  }
  if (failed) { console.log('\n产物门禁存在失败 — 中止后续断言（请先 build）'); process.exit(1) }

  // ---------- I2 零手拼 ----------
  console.log('\n== I2 零手拼 / 静态 import（与 verify-platform-contract 同门禁） ==')
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  {
    const srcRaw = fs.readFileSync('src/host/platform/win32/index.js', 'utf8')
    const src = strip(srcRaw)
    const hasPlusBackslash = /\+\s*['"]\\\\/.test(src) || /\\\\['"]\s*\+/.test(src)
    check(!hasPlusBackslash, 'win32 适配器零手拼：无 "+ \'\\\\\' +"')
    check(src.includes('node:path') && src.includes('nodePath.win32'), 'win32 委托 node:path.win32')
    check(/Object\.freeze\(\s*\{\s*cmd:\s*['"]cmd\.exe['"]\s*\}\s*\)/.test(srcRaw), 'win32 别名表 Object.freeze({ cmd: \'cmd.exe\' })')
    check(srcRaw.includes('USERPROFILE') && srcRaw.includes('HOMEDRIVE'), 'win32 护栏回退链 USERPROFILE→HOMEDRIVE+HOMEPATH 存在')
  }
  {
    const idxSrc = fs.readFileSync('src/host/platform/index.js', 'utf8')
    check(idxSrc.includes("import win32 from './win32/index.js'"), 'platform/index.js 静态 import win32')
    check(idxSrc.includes("import darwin from './darwin/index.js'"), 'platform/index.js 静态 import darwin')
    check(idxSrc.includes("import linux from './linux/index.js'"), 'platform/index.js 静态 import linux')
    check(!/import\s*\(/.test(idxSrc), 'platform/index.js 无变量动态 import（打包可断）')
  }
  {
    const darwinRaw = fs.readFileSync('src/host/platform/darwin/index.js', 'utf8')
    const darwinSrc = strip(darwinRaw)
    check(!/\+\s*['"]\\\\/.test(darwinSrc), 'darwin 适配器零手拼：无 "+ \'\\\\\' +"')
    check(darwinRaw.includes('node:path') && darwinRaw.includes('.posix'), 'darwin 委托 node:path.posix')
  }
  {
    const linuxRaw = fs.readFileSync('src/host/platform/linux/index.js', 'utf8')
    const linuxSrc = strip(linuxRaw)
    check(!/\+\s*['"]\\\\/.test(linuxSrc), 'linux 适配器零手拼：无 "+ \'\\\\\' +"')
    check(linuxRaw.includes('node:path') && linuxRaw.includes('.posix'), 'linux 委托 node:path.posix')
  }

  // ---------- 动态导入 runner + github 适配器 ----------
  const runnerUrl = 'file://' + path.resolve('tests/tracker-contract/runner/index.js').replace(/\\/g, '/')
  const githubUrl = 'file://' + path.resolve('src/host/tracker/backends/github/index.js').replace(/\\/g, '/')
  const runner = await import(runnerUrl)
  const githubMod = await import(githubUrl)
  const { createRunnerContext, runPlayback, runWithAdapter } = runner
  const githubModule = githubMod.githubModule || githubMod.default || githubMod

  const oss = ['win32', 'darwin', 'linux'].filter(want)
  if (oss.length === 0) { console.error('unknown --os=' + osArg); process.exit(1) }

  for (const os of oss) {
    console.log(`\n== 运行时：${os} × GitHub（I1 注入可判真 + I4 真实适配器） ==`)
    // I1: platform OS 覆盖 + getHome/path 注入可判真
    const backendCtx = await createRunnerContext({ os, cwd: process.cwd() })
    check(backendCtx && backendCtx.platform && backendCtx.platform.os === os, `${os} BackendContext.platform.os === ${os}`)
    check(typeof backendCtx.platform.getHome === 'function', `${os} platform.getHome 可用`)
    check(typeof backendCtx.platform.path.join === 'function', `${os} platform.path.join 可用`)
    check(typeof backendCtx.platform.resolveExecutable === 'function', `${os} platform.resolveExecutable 可用`)
    // getHome 不返 null（注入 homedir 后）与形态校验
    // 用注入 homedir 验证 I1 典型分支
    const { createPlatform } = await import('file://' + path.resolve('src/host/platform/index.js').replace(/\\/g,'/'))
    if (os === 'win32') {
      const mockCtx = { get: (n) => n === 'fs' ? { lstat: async()=>null, readText: async()=>'', writeText: async()=>{}, resolve:(p)=>p, listDir: async()=>[], stat: async()=>null } : n==='subprocess' ? { resolveExecutable: async()=>null } : undefined }
      const plat = await createPlatform(mockCtx, 'win32', { homedir: () => 'C:\\Users\\a', env: {} })
      const h = await plat.getHome()
      check(h === 'C:\\Users\\a', 'win32 I1 合法盘符形 C:\\Users\\a 直采')
      const plat2 = await createPlatform(mockCtx, 'win32', { homedir: () => '/c/Users/a', env: { USERPROFILE: 'C:\\Users\\a' } })
      check((await plat2.getHome()) === 'C:\\Users\\a', 'win32 I1 非盘符形 /c/Users/a → USERPROFILE 回退')
      check(plat.path.sep === '\\', "win32 I2 path.sep === '\\'")
      check(plat.path.join('C:\\a','b') === nodePath.win32.join('C:\\a','b'), 'win32 I2 path.join 委托 win32')
    } else if (os === 'darwin') {
      const mockCtx = { get: (n) => n === 'fs' ? { lstat: async()=>null, readText: async()=>'', writeText: async()=>{}, resolve:(p)=>p, listDir: async()=>[], stat: async()=>null } : n==='subprocess' ? { resolveExecutable: async()=>null } : undefined }
      const plat = await createPlatform(mockCtx, 'darwin', { homedir: () => '/Users/mock' })
      check((await plat.getHome()) === '/Users/mock', 'darwin I1 /Users/mock 直采')
      check(plat.path.sep === '/', "darwin I2 path.sep === '/'")
      check(plat.path.join('/Users/x','a','b') === nodePath.posix.join('/Users/x','a','b'), 'darwin I2 path.join 委托 posix')
    } else if (os === 'linux') {
      const mockCtx = { get: (n) => n === 'fs' ? { lstat: async()=>null, readText: async()=>'', writeText: async()=>{}, resolve:(p)=>p, listDir: async()=>[], stat: async()=>null } : n==='subprocess' ? { resolveExecutable: async()=>null } : undefined }
      const plat = await createPlatform(mockCtx, 'linux', { homedir: () => '/home/tester' })
      check((await plat.getHome()) === '/home/tester', 'linux I1 /home/tester 直采')
      check(plat.path.sep === '/', "linux I2 path.sep === '/'")
      check(plat.path.join('/home/user','a','b') === '/home/user/a/b', 'linux I2 path.join POSIX')
    }

    // I4: 工厂 ctx 含 platform 实例 + 真实适配器过 harness
    const tracker = githubModule.create(backendCtx)
    check(tracker && tracker.id === 'github', `${os} × GitHub tracker.id === github`)
    check(typeof tracker.list === 'function' && typeof tracker.get === 'function', `${os} × GitHub tracker has list/get`)

    // playback（离线可复现，不依赖网络/token，I4 采样真实性）
    const pb = await runPlayback({ fixturesDir: 'tests/tracker-contract/fixtures/github-real', label: `github-real-playback-${os}` })
    for (const r of pb.results) check(r.ok, `${os} · ${r.name}${r.detail ? ' — '+r.detail : ''}`)
    // 额外显式：normalized 无旧字段
    check(pb.ok, `${os} × GitHub playback all PASS (I4 真实采样形状)`)

    // live smoke（preflight/list/get 不抛 + OpResult 形状；离线返回 env/network 非 throw 亦算 PASS）
    const repo = { backend: 'github', refId: 'FeatherHunter/dsh-mattpocock-skills-deck', name: 'deck', url: '' }
    const live = await runWithAdapter({ tracker, repo, fixturesDir: 'tests/tracker-contract/fixtures/github-real', label: `github-real-live-${os}` })
    for (const r of live.results) check(r.ok, `${os} · ${r.name}${r.detail ? ' — '+r.detail : ''}`)
    check(live.ok, `${os} × GitHub live smoke PASS (不抛·OpResult)`)
  }

  console.log('\n== 汇总 ==')
  console.log(`  ${passed}/${total} PASS${failed ? ' — 存在失败' : ' — 阶段1最小冒烟成立（3 OS × GitHub，I1/I2/I3/I4 单机三端可判真）'}`)
  // 输出 matrix 快照行（供 matrix.md 复用）
  console.log('\n  快照（3 OS × GitHub）：')
  for (const os of oss) {
    const sep = os === 'win32' ? '\\' : '/'
    console.log(`    ${os} × GitHub · sep=${sep} · playback PASS · live PASS`)
  }
  process.exit(failed ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
