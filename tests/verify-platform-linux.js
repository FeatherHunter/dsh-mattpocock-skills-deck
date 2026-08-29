/**
 * tests/verify-platform-linux.js — linux 底座契约断言（#170 验收，容器可判真 13 项）
 *
 * 第一性原理回溯：
 *   #129 平台抽象：OS 正确性单点拥有，getHome/path/resolveExecutable/fs/env 薄外观，不裸用 Node fs/child_process，
 *         path 同步方法全委托 node:path（win32→win32, POSIX→posix），joinHome=async path.join(await getHome(),...segs)，
 *         resolveExecutable 包装 subprocess.throw→null，env 只读视图 get/has，getHome 终身缓存。
 *   #168 L1-L6 定版：L1 os.homedir()||null 不读 HOME 第二真相；L2 空串/异常→null；L3 sh 直透无别名；
 *         L4 gh 先 PATH 后 DSH_GH_PATH+lstat 兜底≠覆盖（2026-08-29 修订：兜底下沉至 composePlatform 通用层单点拥有，
 *         本适配器仅直透；G10-G12 经 createPlatform 验证的正是通用层行为）；L5 全量委托 node:path.posix sep='/'; L6 ~/$VAR 不展开属 shell 语义。
 *   #169 落地：src/host/platform/linux/index.js 按上述实现（pathImpl=nodePath.posix + getHome try/catch→null + sh直透 + gh兜底+lstat + ~不展开）
 *
 * 推导不变量（容器可判真 13 项 = 本文件断言）：
 *   G1 getHome 正常有值不返 null               L1
 *   G2 getHome 空串→null                       L2
 *   G3 getHome 抛异常→null                     L2
 *   G4 getHome 不读 HOME 第二真相（静态码查） L1
 *   G5 path.sep === '/'                        L5
 *   G6 pathImpl === node:path.posix（零自实现）L5
 *   G7 path.join/isAbsolute/normalize/relative 行为符合 posix 且无 '\\' L5
 *   G8 path.join('~','a') === '~/a' 且 isAbsolute('~/a')===false  L6
 *   G9 sh 无别名直透（成功返回 /sh 尾、失败→null） L3
 *   G10 gh PATH 优先于 DSH_GH_PATH（有 PATH 即不看兜底） L4
 *   G11 gh PATH 失败 + DSH_GH_PATH+lstat 成功→返回兜底  L4
 *   G12 gh PATH 失败 + DSH_GH_PATH 指不存在/lstat 失败→null  L4
 *   G13 env 只读视图不展开 + joinHome 语义≠字面拼接  L6
 *
 * 与 #131 共享运行器（composePlatform + 可测性注入 opts.homedir/env），单机可判三端；本文件聚焦 linux 分组，
 * win32/darwin 同模复用；全部容器内可判真（CI 主阵地 ubuntu-latest）。
 *
 * 运行：node tests/verify-platform-linux.js
 */
const assert = require('node:assert/strict')
const nodePath = require('node:path')
const nodeOs = require('node:os')
const fs = require('node:fs')
const path = require('node:path')

async function main() {
  const { createPlatform } = await import('../src/host/platform/index.js')
  const { default: linuxAdapter } = await import('../src/host/platform/linux/index.js')

  let failed = false
  let total = 0
  let passed = 0
  const check = (ok, msg) => {
    total++
    if (ok) { passed++; console.log('  PASS ' + msg) } else { failed = true; console.log('  FAIL ' + msg) }
  }
  const checkEq = (a, b, msg) => {
    total++
    try { assert.strictEqual(a, b); passed++; console.log('  PASS ' + msg) }
    catch (e) { failed = true; console.log('  FAIL ' + msg + ` — expect ${JSON.stringify(b)} got ${JSON.stringify(a)} :: ${e.message}`) }
  }

  console.log('linux 底座契约断言（G1-G13，容器可判真）')
  console.log('  platform: linux, node=' + process.version + ' os.homedir=' + (()=>{try{return nodeOs.homedir()}catch{return 'THROW'}})())

  function mockCtx({ subprocessImpl, fsImpl } = {}) {
    const sp = subprocessImpl || { resolveExecutable: async (n) => { throw Object.assign(new Error('not found: '+n), { code: 'ENOENT' }) } }
    const f = fsImpl || { lstat: async (p) => null, readText: async()=> '', writeText: async()=>{}, resolve: (x)=>x, listDir: async()=>[], stat: async()=>null }
    return {
      get(name) {
        if (name === 'subprocess') return sp
        if (name === 'fs') return f
        return undefined
      }
    }
  }

  // G1: 正常 getHome 有值不返 null（容器内 HOME 已设时 homedir 非空）
  {
    const ctx = mockCtx()
    const p = await createPlatform(ctx, 'linux')
    const h = await p.getHome()
    check(h !== null && typeof h === 'string' && h.length > 0, 'G1 getHome 有值不返 null（容器正常）')
    if (process.platform === 'linux' && h) {
      check(h.startsWith('/'), `G1 getHome 形态为 POSIX 绝对路径（以 / 开头）：${h}`)
      check(!h.includes('\\'), 'G1 getHome 不含反斜杠（POSIX）')
    } else if (h) {
      const pMock = await createPlatform(mockCtx(), 'linux', { homedir: () => '/home/tester' })
      const hMock = await pMock.getHome()
      check(hMock.startsWith('/'), `G1 getHome 注入 POSIX 形态：${hMock}`)
      check(!hMock.includes('\\'), 'G1 getHome 注入值不含反斜杠')
    }
  }

  // G2: 空串→null（注入 homedir 返回 ''）
  {
    const ctx = mockCtx()
    const p = await createPlatform(ctx, 'linux', { homedir: () => '' })
    const h = await p.getHome()
    checkEq(h, null, 'G2 getHome 空串→null（容器最小镜像/空 HOME 场景）')
  }

  // G3: 抛异常→null（注入 homedir throw）
  {
    const ctx = mockCtx()
    const p = await createPlatform(ctx, 'linux', { homedir: () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }) } })
    const h = await p.getHome()
    checkEq(h, null, 'G3 getHome 抛异常→null（无 passwd/最小镜像场景）')
  }

  // G4: 不读 HOME 第二真相
  {
    const srcRaw = fs.readFileSync(path.resolve(__dirname, '../src/host/platform/linux/index.js'), 'utf8')
    const src = srcRaw.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
    const readsHomeDirectly = /process\.env\.HOME/.test(src) || /\benv\.HOME\b/.test(src)
    const readsWinProfile = /USERPROFILE|HOMEDRIVE|HOMEPATH/.test(src)
    check(!readsHomeDirectly, 'G4 linux 适配器不直读 process.env.HOME（无第二真相）')
    check(!readsWinProfile, 'G4 linux 适配器不读 USERPROFILE/HOMEDRIVE（win32 护栏不适用）')
    const ctx = mockCtx()
    const fixed = '/tmp/fixed-home'
    const p = await createPlatform(ctx, 'linux', { homedir: () => fixed })
    const origHOME = process.env.HOME
    process.env.HOME = '/tmp/other-home'
    const h2 = await p.getHome()
    process.env.HOME = origHOME
    checkEq(h2, fixed, 'G4 getHome 不随 process.env.HOME 变化（注入隔离）')
  }

  // G5: path.sep === '/'
  {
    const ctx = mockCtx()
    const p = await createPlatform(ctx, 'linux')
    checkEq(p.path.sep, '/', "G5 path.sep === '/'（POSIX）")
  }

  // G6: pathImpl === node:path.posix（零自实现）
  {
    check(linuxAdapter(mockCtx()).pathImpl === nodePath.posix, 'G6 linux pathImpl === node:path.posix（零自实现）')
    const ctx = mockCtx()
    const p = await createPlatform(ctx, 'linux')
    checkEq(p.path.join('/a', 'b'), nodePath.posix.join('/a', 'b'), 'G6 path.join 委托 posix 一致')
    check(!p.path.join('/a', 'b').includes('\\'), 'G6 path.join 结果不含反斜杠')
  }

  // G7: path 形态细节
  {
    const ctx = mockCtx()
    const p = await createPlatform(ctx, 'linux')
    checkEq(p.path.join('/home/user', 'a', 'b'), '/home/user/a/b', 'G7 path.join POSIX 拼接')
    checkEq(p.path.isAbsolute('/a/b'), true, 'G7 path.isAbsolute("/a/b")===true')
    checkEq(p.path.isAbsolute('a/b'), false, 'G7 path.isAbsolute("a/b")===false')
    checkEq(p.path.normalize('/a//b/../c/'), '/a/c/', 'G7 path.normalize 归一')
    checkEq(p.path.relative('/home/a', '/home/a/b/c'), 'b/c', 'G7 path.relative')
    checkEq(p.path.resolve('/a', 'b', '..', 'c'), '/a/c', 'G7 path.resolve')
  }

  // G8: ~ 不展开
  {
    const ctx = mockCtx()
    const p = await createPlatform(ctx, 'linux')
    checkEq(p.path.join('~', 'a'), '~/a', 'G8 path.join("~","a") === "~/a"（不展开）')
    checkEq(p.path.isAbsolute('~/a'), false, 'G8 path.isAbsolute("~/a")===false（~ 非绝对）')
    checkEq(p.path.normalize('~/a'), '~/a', 'G8 path.normalize("~/a") 保持字面')
  }

  // G9: sh 无别名直透
  {
    const ctxA = mockCtx({ subprocessImpl: { resolveExecutable: async (n) => { if (n === 'sh') return '/usr/bin/sh'; throw new Error('not found') } } })
    const pA = await createPlatform(ctxA, 'linux')
    const rA = await pA.resolveExecutable('sh')
    checkEq(rA, '/usr/bin/sh', 'G9 sh 直透：PATH 命中时返回原路径 /usr/bin/sh')
    const ctxB = mockCtx({ subprocessImpl: { resolveExecutable: async () => { throw new Error('not found') } } })
    const pB = await createPlatform(ctxB, 'linux')
    const rB = await pB.resolveExecutable('sh')
    checkEq(rB, null, 'G9 sh 直透：PATH 未命中时→null（无别名映射）')
    const srcRaw9 = fs.readFileSync(path.resolve(__dirname, '../src/host/platform/linux/index.js'), 'utf8')
    const src9 = srcRaw9.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
    check(!src9.includes('sh.exe'), 'G9 linux 适配器无 sh→sh.exe 别名（仅 win32 有）')
  }

  // G10: gh PATH 优先于 DSH_GH_PATH
  {
    const ctx = mockCtx({
      subprocessImpl: { resolveExecutable: async (n) => { if (n === 'gh') return '/usr/bin/gh'; throw new Error('not found') } },
      fsImpl: { lstat: async (p) => { throw new Error('should not be called') } }
    })
    const p = await createPlatform(ctx, 'linux', { env: { DSH_GH_PATH: '/tmp/fake-gh-should-not-use' } })
    const r = await p.resolveExecutable('gh')
    checkEq(r, '/usr/bin/gh', 'G10 gh PATH 优先：有 PATH 时不看 DSH_GH_PATH（兜底≠覆盖）')
  }

  // G11: gh 兜底：PATH 失败 + DSH_GH_PATH+lstat 成功→返回兜底
  {
    const fakePath = '/tmp/fake-gh-11'
    const ctx = mockCtx({
      subprocessImpl: { resolveExecutable: async () => { throw new Error('not found') } },
      fsImpl: { lstat: async (p) => p === fakePath ? { isFile: () => true } : null }
    })
    const p = await createPlatform(ctx, 'linux', { env: { DSH_GH_PATH: fakePath } })
    const r = await p.resolveExecutable('gh')
    checkEq(r, fakePath, 'G11 gh 兜底：PATH 未命中 + DSH_GH_PATH+lstat 成功→返回兜底')
  }

  // G12: gh 兜底失败→null
  {
    const ctxEmpty = mockCtx({
      subprocessImpl: { resolveExecutable: async () => { throw new Error('not found') } },
      fsImpl: { lstat: async () => null }
    })
    const pEmpty = await createPlatform(ctxEmpty, 'linux', { env: { DSH_GH_PATH: '/tmp/not-exist-gh-12' } })
    const rEmpty = await pEmpty.resolveExecutable('gh')
    checkEq(rEmpty, null, 'G12 gh 兜底：DSH_GH_PATH 指不存在→null（lstat 校验）')

    const ctxNoEnv = mockCtx({
      subprocessImpl: { resolveExecutable: async () => { throw new Error('not found') } },
      fsImpl: { lstat: async () => ({ isFile: () => true }) }
    })
    const pNoEnv = await createPlatform(ctxNoEnv, 'linux', { env: {} })
    const rNoEnv = await pNoEnv.resolveExecutable('gh')
    checkEq(rNoEnv, null, 'G12 gh 兜底：无 DSH_GH_PATH 时→null（不凭空造路径）')
  }

  // G13: env 只读视图不展开 + joinHome 语义
  {
    const ctx = mockCtx()
    const p = await createPlatform(ctx, 'linux', { homedir: () => '/home/tester' })
    const beforeFOO = process.env.FOO
    process.env.FOO = '$HOME'
    checkEq(p.env.get('FOO'), '$HOME', 'G13 env.get("FOO") 保持 "$HOME" 字面（不展开）')
    if (beforeFOO === undefined) delete process.env.FOO
    else process.env.FOO = beforeFOO

    const home = await p.getHome()
    const jh = await p.path.joinHome('a', 'b')
    checkEq(jh, nodePath.posix.join(home, 'a', 'b'), 'G13 path.joinHome === path.join(getHome(),...segs)')
    check(jh !== '~/a', 'G13 joinHome 结果≠字面 "~/a"（显式 HOME 展开口）')
    check(jh.startsWith('/'), 'G13 joinHome 结果为绝对路径')
  }

  console.log(`\nlinux 契约：${passed}/${total} passed${failed ? ' — 有失败' : ''}`)
  if (failed) process.exit(1)
  console.log('全部通过 — linux 底座契约成立（容器可判真 13 项）')
}

main().catch(e => { console.error(e); process.exit(1) })
