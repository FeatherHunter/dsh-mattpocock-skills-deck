/** 目录可写检查：不存在路径 fail，其余不可安全验证时 pending，绝不写入或删除。
 * 运行：node --import ./scripts/ts-hook.mts tests/verify-dirwritable.ts
 */
const assert = require('node:assert/strict')

async function main() {
  const { createPredicateRegistry } = await import('../src/host/tracker/predicateCore.js')
  const { PRIMITIVE_KIND } = await import('../src/shared/tracker/chain-types.js')
  const { validateCheckItem } = await import('../src/shared/tracker/chain-validate.js')
  const { catalogFor } = await import('../src/shared/tracker/check-catalog-dirs.js')
  const { checkScratchWritable } = await import('../src/tracker/rooms/markdown/workspace-checks.js')
  const chain = [{ id: 'md:scratchWritable', check: { kind: 'primitive', primitive: PRIMITIVE_KIND.DIR_WRITABLE, path: '.scratch' } }]
  const run = async (platform, lang = 'en') => (await createPredicateRegistry({ timeout: 2000 }).resolveAll(chain, { platform, backendId: 'markdown', cwd: '/ws', lang }))['md:scratchWritable']
  let writes = 0
  let deletes = 0
  const fsFor = (extra = {}) => ({
    resolve: async (p, o) => o && o.cwd ? o.cwd + '/' + p : p,
    writeText: async () => { writes++; throw new Error('write must not be called') },
    unlink: async () => { deletes++; throw new Error('unlink must not be called') },
    ...extra,
  })
  const platformFor = (fs) => ({ path: { join: (...a) => a.join('/') }, env: { get: () => undefined, has: () => false }, fs })

  // 权限异常不是不存在的证据。
  const denied = await run(platformFor(fsFor({ exists: async () => { throw Object.assign(new Error('permission denied'), { code: 'EACCES' }) } })))
  assert.equal(denied.status, 'pending')

  // 确认真实存在与缺失分别被识别；不得仅以 resolve 成功假装路径存在。
  const exists = await run(platformFor(fsFor({ exists: async () => true })))
  assert.equal(exists.status, 'pending')
  assert.match(exists.detail, /unverified/i)
  const missing = await run(platformFor(fsFor({ exists: async () => false })))
  assert.equal(missing.status, 'pending')
  const unknown = await run(platformFor(fsFor()))
  assert.equal(unknown.status, 'pending')
  const dirFallback = await run(platformFor(fsFor({ exists: async () => false, listDir: async () => [] })))
  assert.equal(dirFallback.status, 'pending')
  const missingFallback = await run(platformFor(fsFor({ exists: async () => false, listDir: async () => { throw new Error('ENOENT') }, stat: async () => null })))
  assert.equal(missingFallback.status, 'fail')
  const badResolve = await run(platformFor(fsFor({ resolve: async () => { throw new Error('ENOENT') } })))
  assert.equal(badResolve.status, 'fail')
  for (const method of ['resolve', 'exists', 'listDir', 'stat', 'lstat']) {
    for (const code of ['EACCES', 'EPERM', 'EIO']) {
      const result = await run(platformFor(fsFor({ [method]: async () => { throw Object.assign(new Error(code), { code }) } })))
      assert.equal(result.status, 'pending', method + ' ' + code)
    }
    const result = await run(platformFor(fsFor({ [method]: async () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }) } })))
    assert.equal(result.status, 'fail', method + ' ENOENT')
  }
  const nullStat = await run(platformFor(fsFor({ stat: async () => null })))
  assert.equal(nullStat.status, 'pending')
  const conflicting = await run(platformFor(fsFor({ exists: async () => { throw new Error('ENOENT') }, listDir: async () => [] })))
  assert.equal(conflicting.status, 'pending')
  const resolveUnknown = await run(platformFor(fsFor({ resolve: async () => { throw new Error('resolver unavailable') } })))
  assert.equal(resolveUnknown.status, 'pending')
  for (const target of [{ path: '/ws/.scratch' }, { kind: 'file', rel: '.scratch' }]) {
    const result = await run(platformFor(fsFor({ resolve: async () => target, exists: async (p) => { assert.equal(p, target); return true } })))
    assert.equal(result.status, 'pending')
  }
  for (const lang of ['zh', 'en']) {
    const result = await run(platformFor(fsFor({ exists: async () => true })), lang)
    assert.equal(result.status, 'pending')
    assert.match(result.detail, lang === 'zh' ? /未验证/ : /unverified/i)
  }

  // backend 判据不读写磁盘，无论 .scratch 是否存在或是否传许可。
  for (const scratchExists of [true, false]) {
    const platform = platformFor(fsFor({ lstat: async () => scratchExists ? { isDirectory: () => true } : null }))
    for (const lang of ['zh', 'en']) {
      const result = await checkScratchWritable({ platform, cwd: '/ws', lang, sandboxPolicy: { p: 1 } })
      assert.equal(result.status, 'pending')
      assert.equal(result.evidence, 'writability-unverified')
      assert.match(result.detail, lang === 'zh' ? /无法验证/ : /unverified/i)
    }
  }
  assert.equal(writes, 0, '不可写入探针')
  assert.equal(deletes, 0, '不可删除探针')

  const item = catalogFor('markdown').find((c) => c.id === 'md:scratchWritable')
  assert.ok(item)
  assert.deepEqual(item.check, { kind: 'backend', id: 'scratchWritable', backendId: 'markdown' })
  assert.equal(item.sessionScoped, true)
  assert.equal(catalogFor('github').find((c) => c.id === 'md:scratchWritable'), undefined)
  const okItem = { id: 'md:scratchWritable', onPass: { show: { fallback: 'ok' }, actions: [] }, onFail: { show: { fallback: 'fail' }, actions: [] }, check: { kind: 'primitive', primitive: 'dirWritable', path: '.scratch' } }
  assert.equal(validateCheckItem(okItem).length, 0)
  assert.ok(validateCheckItem({ ...okItem, check: { kind: 'primitive', primitive: 'dirWritable' } }).some((e) => /dirWritable needs path/.test(e)))
  console.log('全部通过 — 不存在路径 fail；可写性未验证 pending，零写入零删除')
}
main().catch((e) => { console.error(e); process.exitCode = 1 })
