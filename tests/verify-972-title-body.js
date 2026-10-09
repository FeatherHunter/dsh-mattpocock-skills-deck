// tests/verify-972-title-body.js —— 门禁：同时传标题与正文时标题不丢（#972）
// 用法：在插件根目录执行 node tests/verify-972-title-body.js，可独立运行。
//
// 守的是什么：票更新操作原来先换标题、再按正文整份覆盖。一次同时传新标题与含旧标题
// 的整份正文时，刚换好的新标题会被整份盖回去，调用还返回成功。现在标题分支挪到正文
// 分支之后：同传时以后一步的标题参数为准；只传一边时行为不变。
//
// 五组断言：① 同传标题加含旧标题的状态正文（本缺陷：新标题落盘）；② 只传标题（行为不变）；
// ③ 只传正文（行为不变：标题跟正文走）；④ 同传标题加片段（两边都生效）；⑤ 本门禁已挂进验证链。
import nodePath from 'node:path'
import fs from 'node:fs'
import { markdownModule } from '../src/host/tracker/backends/markdown/index.js'

let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const h1 = (t) => (String(t).match(/^#\s+/gm) || []).length
const firstH1 = (t) => String(t).split('\n').find((l) => /^#\s+/.test(l)) || ''

const K = (p) => String(p).toLowerCase()
function freshWorld() {
  const files = new Map()
  const dirs = new Set(['/ws', '/ws/.scratch', '/ws/.scratch/demo', '/ws/.scratch/demo/issues'])
  files.set(K('/ws/.scratch/demo/map.md'), '# \u6f14\u793a\u5730\u56fe\n\nStatus: ready-for-agent\n')
  const mem = {
    async resolve(p) { return String(p) },
    async readText(t) { const p = String(t); if (!files.has(K(p))) throw Object.assign(new Error('ENOENT: ' + p), { code: 'ENOENT' }); return files.get(K(p)) },
    async writeText(t, c) { files.set(K(String(t)), String(c)) },
    async rename(a, b) { files.set(K(String(b)), files.get(K(String(a)))); files.delete(K(String(a))) },
    async rm(p) { files.delete(K(String(p))) },
    async mkdir(p) { dirs.add(K(String(p))) },
    async lstat(p) { return files.has(K(String(p))) ? { mtime: 0 } : null },
    async stat(p) { return files.has(K(String(p))) ? { mtime: 0 } : null },
    async listDir(p) {
      const p2 = K(String(p)).replace(/[/]+$/, '')
      if (!dirs.has(p2)) throw Object.assign(new Error('ENOENT: ' + p2), { code: 'ENOENT' })
      const out = new Set()
      for (const k of files.keys()) { if (!k.startsWith(p2 + '/')) continue; const rest = k.slice(p2.length + 1); const seg = rest.includes('/') ? rest.slice(0, rest.indexOf('/')) : rest; if (seg) out.add(seg) }
      for (const d of dirs.keys()) { if (!d.startsWith(p2 + '/')) continue; const rest = d.slice(p2.length + 1); const seg = rest.includes('/') ? rest.slice(0, rest.indexOf('/')) : rest; if (seg) out.add(seg) }
      return Array.from(out)
    },
  }
  const ctx = { cwd: '/ws', platform: { path: nodePath.posix, fs: mem }, fs: mem, logEvent: () => {}, isEnabled: () => false }
  return { files, ctx }
}
const REF = { backend: 'markdown', refId: '/ws', name: 'ws', url: '' }
const tracker = markdownModule.create({})
const fileOf = (files) => String(files.get(Array.from(files.keys()).filter((k) => k.includes('/issues/'))[0]))

// —— ① 本缺陷：同传新标题加含旧标题的状态正文，新标题必须落盘 ——
{
  const { files, ctx } = freshWorld()
  const created = await tracker.create(REF, { title: '\u65e7\u6807\u9898', labels: ['bug'], status: 'ready-for-agent', idempotencyKey: 'verify-972-1' }, ctx)
  check(created.ok === true, '\u2460 \u5efa\u7968\u6210\u529f')
  const key = String(created.data.key)
  const cur = await tracker.get(REF, key, {}, ctx)
  const wholeWithOldTitle = String(cur.data.body)
  check(wholeWithOldTitle.includes('# \u65e7\u6807\u9898'), '\u2460 \u6574\u4efd\u6b63\u6587\u91cc\u4fdd\u7559\u65e7\u6807\u9898\uff08\u524d\u63d0\u6210\u7acb\uff09')
  const r = await tracker.update(REF, key, { title: '\u65b0\u6807\u9898', body: wholeWithOldTitle }, ctx)
  const after = fileOf(files)
  check(r.ok === true, '\u2460 \u8fd4\u56de\u6210\u529f')
  check(firstH1(after) === '# \u65b0\u6807\u9898', '\u2460 \u843d\u76d8\u6807\u9898\u662f\u65b0\u6807\u9898\uff08\u5b9e\u5f97 ' + firstH1(after) + '\uff09')
  check(h1(after) === 1, '\u2460 \u76d8\u4e0a\u53ea\u6709\u4e00\u4e2a\u4e00\u7ea7\u6807\u9898')
}

// —— ② 只传标题：只换标题行，其余不动 ——
{
  const { files, ctx } = freshWorld()
  const created = await tracker.create(REF, { title: '\u65e7\u6807\u9898', labels: ['bug'], status: 'ready-for-agent', idempotencyKey: 'verify-972-2' }, ctx)
  const key = String(created.data.key)
  const r = await tracker.update(REF, key, { title: '\u53ea\u6539\u6807\u9898' }, ctx)
  const after = fileOf(files)
  check(r.ok === true && firstH1(after) === '# \u53ea\u6539\u6807\u9898', '\u2461 \u53ea\u4f20\u6807\u9898\u65f6\u65b0\u6807\u9898\u843d\u76d8')
  check(after.includes('Labels: bug'), '\u2461 \u6807\u7b7e\u884c\u4fdd\u7559')
}

// —— ③ 只传正文：标题跟正文走（行为不变） ——
{
  const { files, ctx } = freshWorld()
  const created = await tracker.create(REF, { title: '\u65e7\u6807\u9898', labels: ['bug'], status: 'ready-for-agent', idempotencyKey: 'verify-972-3' }, ctx)
  const key = String(created.data.key)
  const cur = await tracker.get(REF, key, {}, ctx)
  const next = String(cur.data.body).replace('# \u65e7\u6807\u9898', '# \u6b63\u6587\u91cc\u7684\u6807\u9898')
  const r = await tracker.update(REF, key, { body: next }, ctx)
  const after = fileOf(files)
  check(r.ok === true && firstH1(after) === '# \u6b63\u6587\u91cc\u7684\u6807\u9898', '\u2462 \u53ea\u4f20\u6b63\u6587\u65f6\u6807\u9898\u8ddf\u6b63\u6587\u8d70')
}

// —— ④ 同传标题加片段：两边都生效 ——
{
  const { files, ctx } = freshWorld()
  const created = await tracker.create(REF, { title: '\u65e7\u6807\u9898', labels: ['bug'], status: 'ready-for-agent', idempotencyKey: 'verify-972-4' }, ctx)
  const key = String(created.data.key)
  const r = await tracker.update(REF, key, { title: '\u7247\u6bb5\u540c\u4f20\u6807\u9898', body: '## \u8fdb\u5ea6\n\n\u505a\u4e86\u4e00\u4e9b\u4e8b\n' }, ctx)
  const after = fileOf(files)
  check(r.ok === true && firstH1(after) === '# \u7247\u6bb5\u540c\u4f20\u6807\u9898', '\u2463 \u7247\u6bb5\u540c\u4f20\u65f6\u6807\u9898\u751f\u6548')
  check(after.includes('\u505a\u4e86\u4e00\u4e9b\u4e8b') && after.includes('Labels: bug'), '\u2463 \u7247\u6bb5\u5185\u5bb9\u843d\u76d8\u3001\u539f\u6807\u7b7e\u884c\u8fd8\u5728')
}

// —— ⑤ 本门禁已挂进验证链 ——
{
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
  check(((pkg.scripts && pkg.scripts.verify) || '').includes('verify-972-title-body.js'), '\u2464 \u9a8c\u8bc1\u94fe\u91cc\u80fd\u627e\u5230\u672c\u95e8\u7981')
}

console.log(failed ? '\n\u5b58\u5728\u5931\u8d25 — verify-972-title-body \u672a\u901a\u8fc7' : '\n\u5168\u90e8\u901a\u8fc7 — \u540c\u4f20\u6807\u9898\u4e0e\u6b63\u6587\u65f6\u6807\u9898\u4e0d\u4e22\uff08' + total + ' \u9879\u65ad\u8a00\uff09')
process.exit(failed ? 1 : 0)
