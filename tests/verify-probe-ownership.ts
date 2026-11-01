// Probe safety: the file service has no atomic ownership-checked delete.
const assert = require('node:assert/strict')
async function main() {
  const { probeDirWritable } = await import('../src/host/tracker/predicateFileProbes.js')
  const { checkScratchWritable } = await import('../src/tracker/rooms/markdown/workspace-checks.js')
  for (const run of [
    (platform) => probeDirWritable({ path: '.scratch' }, { platform, cwd: '/ws', lang: 'en' }),
    (platform) => checkScratchWritable({ platform, cwd: '/ws', lang: 'en' }),
  ]) {
    const files = new Map([['/ws/.scratch/.dsh-write-probe', 'someone else']])
    let writes = 0, deletes = 0
    const platform = { path: { join: (...parts) => parts.join('/') }, fs: {
      resolve: async (path, options) => options?.cwd ? options.cwd + '/' + path : path,
      lstat: async () => ({ isDirectory: () => true }),
      exists: async () => true,
      writeText: async (target, content) => { writes++; files.set(target, content) },
      unlink: async (target) => { deletes++; files.delete(target) },
    } }
    const result = await run(platform)
    assert.equal(result.status, 'pending')
    assert.equal(writes, 0, 'without conditional cleanup the probe must not write')
    assert.equal(deletes, 0, 'must not delete a file whose ownership is unproven')
    assert.equal(files.get('/ws/.scratch/.dsh-write-probe'), 'someone else')
  }
  console.log('probe ownership fail-closed: PASS')
}
main().catch(e => { console.error(e); process.exitCode = 1 })
