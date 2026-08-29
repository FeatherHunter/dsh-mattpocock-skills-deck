/**
 * tests/verify-dirwritable.js — dirWritable 原语契约（2026-08-29 研究实锤「md:scratchWritable 名不符实」修复验收）
 *
 * 背景：md:scratchWritable 原用 FILE_EXISTS 只判「存在」、从不测「可写」（research 笔记
 *   docs/research/environment-checks-platform-layer-20260829.md）；新增 PRIMITIVE_KIND.DIR_WRITABLE
 *   （写探测：往目标目录写 2 字节探针并尽力清理）作为跨 OS 唯一可靠的「可写」判据。
 *
 * 本文件断言：
 *   D1 目录存在且 writeText 成功 → pass（且确实尝试了写入与清理）
 *   D2 writeText 抛错 → fail（目录不可写）
 *   D3 目标不存在（fs 无该目录）→ fail
 *   D4 fs 无 writeText 能力 → 回退存在性判定，pass 时 detail 如实注明「未验证可写」
 *   D5 声明层：catalogFor('markdown').md:scratchWritable 的 check 已切换为 dirWritable
 *   D6 契约层 validateCheckItem 对 dirWritable 形状校验通过（非空 path）
 *
 * 运行：node tests/verify-dirwritable.js（已接入 npm run verify）
 */
const assert = require('node:assert/strict')

async function main() {
  const { createPredicateRegistry } = await import('../src/host/tracker/predicateRegistry.js')
  const { PRIMITIVE_KIND, validateCheckItem } = await import('../src/shared/tracker/chain.js')
  const { catalogFor } = await import('../src/shared/tracker/check-catalog.js')

  let failed = false
  let total = 0
  let passed = 0
  const check = (ok, msg, detail = '') => {
    total++
    if (ok) { passed++; console.log('  PASS ' + msg) }
    else { failed = true; console.log('  FAIL ' + msg + (detail ? ' — ' + String(detail).slice(0, 400) : '')) }
  }

  const runProbe = async (platform, cwd) => {
    const reg = createPredicateRegistry({ timeout: 2000 })
    const chain = [{ id: 'md:scratchWritable', check: { kind: 'primitive', primitive: 'dirWritable', path: '.scratch' } }]
    const resolved = await reg.resolveAll(chain, { platform, backendId: 'markdown', cwd: cwd || '/ws' })
    return resolved['md:scratchWritable']
  }

  console.log('== dirWritable 原语契约（可写探测修复验收） ==')

  // D1：可写 → pass；写入与清理都尝试
  {
    const written = []
    const cleaned = []
    const platform = {
      path: { join: (...a) => a.join('/') },
      env: { get: () => undefined, has: () => false },
      fs: {
        resolve: async (p, o) => (o && o.cwd ? o.cwd + '/' + p : p),
        writeText: async (p, c) => { written.push(p) },
        unlink: async (p) => { cleaned.push(p) },
      },
    }
    const r = await runProbe(platform, '/ws')
    check(r.status === 'pass', 'D1 可写目录 → pass', r.detail)
    check(written.length === 1 && written[0] === '/ws/.scratch/.dsh-write-probe', 'D1 写探针确实写入目标目录', JSON.stringify(written))
    check(cleaned.length === 1 && cleaned[0] === '/ws/.scratch/.dsh-write-probe', 'D1 探针随后被清理（unlink）', JSON.stringify(cleaned))
    check(!/writable not verified/.test(r.detail || ''), 'D1 pass 不带「未验证可写」注记')
  }

  // D2：写入抛错 → fail
  {
    const platform = {
      path: { join: (...a) => a.join('/') },
      env: { get: () => undefined, has: () => false },
      fs: {
        resolve: async (p, o) => (o && o.cwd ? o.cwd + '/' + p : p),
        writeText: async () => { throw new Error('EACCES: permission denied') },
      },
    }
    const r = await runProbe(platform, '/ws')
    check(r.status === 'fail', 'D2 写入被拒（EACCES）→ fail', r.detail)
    check(/not writable/i.test(r.detail || ''), 'D2 详情含不可写原因', r.detail)
  }

  // D3：目标不存在 → fail
  {
    const platform = {
      path: { join: (...a) => a.join('/') },
      env: { get: () => undefined, has: () => false },
      fs: {
        resolve: async () => { throw new Error('ENOENT') },
        writeText: async () => { throw new Error('should not be called') },
      },
    }
    const r = await runProbe(platform, '/ws')
    check(r.status === 'fail', 'D3 目标目录不存在 → fail', r.detail)
  }

  // D4：无 writeText 能力 → 回退存在性 + 如实注明
  {
    const platformExists = {
      path: { join: (...a) => a.join('/') },
      env: { get: () => undefined, has: () => false },
      fs: {
        resolve: async (p, o) => (o && o.cwd ? o.cwd + '/' + p : p),
        exists: async () => true,
      },
    }
    const r1 = await runProbe(platformExists, '/ws')
    check(r1.status === 'pass' && /writable not verified/.test(r1.detail || ''), 'D4 无写能力→回退存在性 pass（属实注明未验证可写）', r1.detail)
    const platformMissing = {
      path: { join: (...a) => a.join('/') },
      env: { get: () => undefined, has: () => false },
      fs: {
        resolve: async (p, o) => (o && o.cwd ? o.cwd + '/' + p : p),
        exists: async () => false,
      },
    }
    const r2 = await runProbe(platformMissing, '/ws')
    check(r2.status === 'fail', 'D4 无写能力+不存在 → fail（不误报可写）', r2.detail)
  }

  // D5：声明层切换（markdown 目录项已用 dirWritable）
  {
    const item = catalogFor('markdown').find((c) => c.id === 'md:scratchWritable')
    check(!!item, 'D5 markdown 目录含 md:scratchWritable')
    check(item && item.check && item.check.primitive === PRIMITIVE_KIND.DIR_WRITABLE, 'D5 md:scratchWritable 已切换为 dirWritable 原语', JSON.stringify(item && item.check))
    check(item && item.check && item.check.path === '.scratch', 'D5 探测目标为 .scratch')
    const gh = catalogFor('github').find((c) => c.id === 'md:scratchWritable')
    check(!gh, 'D5 github 目录不含 md:scratchWritable（后端物理隔离）')
  }

  // D6：契约形状校验通过
  {
    const okItem = { id: 'md:scratchWritable', onPass: { show: { fallback: 'ok' }, actions: [] }, onFail: { show: { fallback: 'fail' }, actions: [] }, check: { kind: 'primitive', primitive: 'dirWritable', path: '.scratch' } }
    check(validateCheckItem(okItem).length === 0, 'D6 dirWritable 合法形状（含 path）通过校验', JSON.stringify(validateCheckItem(okItem)))
    const badItem = { id: 'x', onPass: { show: { fallback: 'ok' }, actions: [] }, onFail: { show: { fallback: 'fail' }, actions: [] }, check: { kind: 'primitive', primitive: 'dirWritable' } }
    check(validateCheckItem(badItem).some((e) => /dirWritable needs path/.test(e)), 'D6 dirWritable 缺 path 被校验拦截', JSON.stringify(validateCheckItem(badItem)))
  }

  // D7：实机崩溃回归（用户反馈 "The path argument must be of type string. Received an instance of Object"）——
  //   fs.resolve 返回 target 对象（无 .path 字符串 / 形状随宿主）时，绝不因 path.join 抛 TypeError 而误判失败
  {
    const mkWritable = (shape) => ({
      path: { join: (...a) => a.join('/') },
      env: { get: () => undefined, has: () => false },
      fs: {
        resolve: async (p, o) => {
          const s = o && o.cwd ? o.cwd + '/' + p : p
          return shape === 'with-path' ? { path: s } : { kind: 'file', rel: p }
        },
        writeText: async (t, c) => { /* 收到 target 即可，不比较内容 */ },
      },
    })
    const rA = await runProbe(mkWritable('with-path'), '/ws')
    check(rA.status === 'pass', 'D7 resolve 返回 {path} 对象 → 不抛 TypeError，判定 pass', rA.detail)
    const rB = await runProbe(mkWritable('no-path'), '/ws')
    check(rB.status === 'pass', 'D7 resolve 返回无 path 键的对象（最坏形状）→ 同样 pass', rB.detail)
  }

  console.log(`\ndirWritable 契约：${passed}/${total} 通过${failed ? ' — 有失败' : ''}`)
  if (failed) process.exit(1)
  console.log('全部通过 — 可写探测原语行为成立（存在≠可写，写探测为判据）')
}

main().catch((e) => { console.error(e); process.exit(1) })
