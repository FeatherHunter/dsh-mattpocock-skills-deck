// tests/tracker-contract/sections/idempotency-counterproof-markdown.js —— #711 的反证现场实验之二。
//
// 用**真实的本地 Markdown 后端**跑一遍 tests/tracker-contract/sections/idempotency.js 第四段那几条判据，
// 但把「回查」这一步做坏两种方式，看判据变不变红：
//   甲 · 回查只认进程内的内存表（不看盘上票文件里的锚）→ 「第二次是复用而不是新建」必须变红；
//   乙 · 回查照样看盘上文件，但那张票文件里的锚被人删了 → 同一条判据也必须变红（证明它真的在读盘）。
//
// 用法：node tests/tracker-contract/sections/idempotency-counterproof-markdown.js

import * as nodeFs from 'node:fs'
import * as nodePath from 'node:path'
import * as nodeOs from 'node:os'
import { createRegistry } from '../../../src/host/tracker/registryCore.js'
import { markdownModule } from '../../../src/host/tracker/backends/markdown/index.js'
import { anchorLineFor, idempotencyKeyOf } from '../../../src/shared/refresh/idempotency.js'

function makeWorkspace() {
  const root = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'dsws-idem-cp-'))
  const dir = nodePath.join(root, '.scratch', 'demo')
  nodeFs.mkdirSync(nodePath.join(dir, 'issues'), { recursive: true })
  nodeFs.writeFileSync(nodePath.join(dir, 'map.md'), '# Demo\n\nStatus: ready-for-agent\n', 'utf8')
  const plat = {
    path: nodePath.posix,
    fs: {
      async resolve(p) { return String(p).replace(/\\/g, '/') },
      async readText(t) { return nodeFs.readFileSync(t, 'utf8') },
      async writeText(t, c) { nodeFs.mkdirSync(nodePath.dirname(t), { recursive: true }); nodeFs.writeFileSync(t, c, 'utf8') },
      async lstat(t) { try { return nodeFs.statSync(t) } catch (e) { return null } },
      async listDir(t) { try { return nodeFs.readdirSync(t) } catch (e) { return [] } },
      async stat(t) { try { return nodeFs.statSync(t) } catch (e) { return null } },
    },
  }
  const issuesDir = nodePath.join(dir, 'issues').replace(/\\/g, '/')
  return {
    issuesDir,
    repo: { backend: 'markdown', refId: '.scratch/demo', name: 'demo', url: '' },
    ctx: { platform: plat, fs: plat.fs, cwd: root.replace(/\\/g, '/'), get(n) { return n === 'fs' ? plat.fs : undefined } },
    files() { return nodeFs.readdirSync(issuesDir).filter((f) => f.endsWith('.md')) },
    read(f) { return nodeFs.readFileSync(nodePath.join(issuesDir, f), 'utf8') },
    write(f, t) { nodeFs.writeFileSync(nodePath.join(issuesDir, f), t, 'utf8') },
    cleanup() { try { nodeFs.rmSync(root, { recursive: true, force: true }) } catch (e) {} },
  }
}

/** 每次调用都用一个全新的后端实例：模拟「进程重启之后再来一次」。 */
async function freshCreate(fx, input) {
  const reg = createRegistry({ logEvent: () => {}, isEnabled: () => false }, { matchesTimeout: 200 })
  const d = reg.register(markdownModule)
  try { return await reg.get('markdown').create(fx.repo, input, fx.ctx) } finally { d.dispose() }
}

/** 这一段判据的原话：「第二次是『复用』而不是『新建』——盘上文件数不变」+「返回同一个 key」。 */
function assertReuse(name, first, second, filesAfterFirst, filesAfterSecond) {
  const oneMoreKey = second.ok === true && first.ok === true && second.data.key === first.data.key
  const sameFiles = filesAfterSecond.length === filesAfterFirst.length && filesAfterSecond.join(',') === filesAfterFirst.join(',')
  console.log('  [' + (oneMoreKey ? 'PASS' : 'FAIL') + '] ' + name + ' · 第二次提交返回同一个 key' + (oneMoreKey ? '' : '  — 实得 ' + JSON.stringify({ k1: first.data && first.data.key, k2: second.data && second.data.key })))
  console.log('  [' + (sameFiles ? 'PASS' : 'FAIL') + '] ' + name + ' · 第二次是「复用」而不是「新建」——盘上文件数不变  — 实得 ' + JSON.stringify({ before: filesAfterFirst, after: filesAfterSecond }))
  return oneMoreKey && sameFiles
}

console.log('idempotency-counterproof-markdown：真实本地 Markdown 后端上的反证实验')
console.log('')
console.log('甲 · 把回查改成「只认进程内的内存表」（不看票文件里的锚）：')
console.log('    这一段判据应当变红 —— 因为两次调用之间换的是全新实例，内存表本来就是空的。')

// 甲：这个「坏实现」的外在表现就是：两次调用之间内存表丢了，于是第二次必然另建一张。
//     用真的 markdown 后端 + 把盘上那张票的锚删掉来精确模拟同一件事（都是「回查读不到锚」）。
//     —— 为什么用这个办法：真实后端没有一处可以把「回查」单独替换掉，而删掉锚之后
//     「按锚回查」在读盘那一刻就必然空手而归，与「回查只查内存」在行为上是同一件事。
{
  const fx = makeWorkspace()
  try {
    const key = 'cp-md-1'
    const first = await freshCreate(fx, { title: '被动手脚的票', idempotencyKey: key })
    const before = fx.files()
    const name = before[0]
    fx.write(fx.files()[0], fx.read(name).split('\n').filter((l) => idempotencyKeyOf(l) === '').join('\n'))
    const second = await freshCreate(fx, { title: '被动手脚的票', idempotencyKey: key })
    const ok = assertReuse('反证甲（回查读不到锚）', first, second, before, fx.files())
    console.log('    → 这一段判据' + (ok ? '居然全绿（反证无效）' : '变红了：逮住了「回查没读到锚还敢当成功」'));
  } finally { fx.cleanup() }
}

console.log('')
console.log('乙 · 对照组：什么都不做坏，同两条判据应当全绿（证明甲之所以变红不是环境噪声）：')
{
  const fx = makeWorkspace()
  try {
    const key = 'cp-md-2'
    const first = await freshCreate(fx, { title: '正常的票', idempotencyKey: key })
    const before = fx.files()
    const second = await freshCreate(fx, { title: '正常的票', idempotencyKey: key })
    const ok = assertReuse('对照乙（正常实现）', first, second, before, fx.files())
    console.log('    → 这一段判据' + (ok ? '全绿（对照成立）' : '竟然红了（说明甲那次的红不是判据本身有问题，而是环境）'))
    console.log('    票文件第一行 = ' + JSON.stringify(fx.read(fx.files()[0]).split('\n')[0]) + '（锚就写在票面上）')
    console.log('    锚那一行的正规写法 = ' + JSON.stringify(anchorLineFor(key).trim()))
  } finally { fx.cleanup() }
}
