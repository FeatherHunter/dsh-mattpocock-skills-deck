// tests/verify-970-whole-document.js —— 门禁：整份正文缺状态行时按整份替换，不写成两份（#970）
// 用法：在插件根目录执行 node tests/verify-970-whole-document.js，可独立运行。
//
// 守的是什么：更新票时正文分派原来只看有没有行首状态行。递进来的是自带一级标题
// 或锚标记的整份文档、但不带状态行时，会被误判为片段、整份粘到旧标题后面，盘上
// 变成两个标题、两个锚、两份正文，而调用返回成功。现在加了一条中间支：长得像整份
// 就按整份替换，并把盘上原有而新文缺的字段行补回文末。
//
// 四组断言：① 缺状态整份（本缺陷：单标题单锚、新内容、字段补回）；② 带状态整份
// （行为不变）；③ 普通片段（仍走插入）；④ 本门禁已挂进验证链。
import nodePath from 'node:path'
import fs from 'node:fs'
import { markdownModule } from '../src/host/tracker/backends/markdown/index.js'
import { anchorLineFor } from '../src/shared/refresh/idempotency.js'

let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const h1 = (t) => (String(t).match(/^#\s+/gm) || []).length
const anchors = (t) => (String(t).match(/DSH-IDEMPOTENCY-KEY/g) || []).length

const K = (p) => String(p).toLowerCase()
const files = new Map()
const dirs = new Set(['/ws', '/ws/.scratch', '/ws/.scratch/demo', '/ws/.scratch/demo/issues'])
files.set(K('/ws/.scratch/demo/map.md'), '# 演示地图\n\nStatus: ready-for-agent\n')
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
const REF = { backend: 'markdown', refId: '/ws', name: 'ws', url: '' }
const tracker = markdownModule.create({})
const fileOf = () => String(files.get(Array.from(files.keys()).filter((k) => k.includes('/issues/'))[0]))

// ── 建一张带锚的正常票 ──
const created = await tracker.create(REF, { title: '原标题', labels: ['bug'], status: 'ready-for-agent', idempotencyKey: 'verify-970-seed' }, ctx)
check(created.ok === true, '建票成功（实得 ' + JSON.stringify((created && created.error) || 'ok') + '）')
const key = created.ok ? String(created.data.key) : '01'
const anchor = anchorLineFor('verify-970-seed').trim()

// ── ① 本缺陷：整份无状态行 → 单份＋字段补回 ──
{
  const incoming = anchor + '\n# 新标题\n\n## 正文\n\n新正文\n'
  const r = await tracker.update(REF, key, { body: incoming }, ctx)
  const after = fileOf()
  check(r.ok === true, '① 返回成功')
  check(h1(after) === 1, '① 盘上只有一个一级标题（原来是两个，实得 ' + h1(after) + '）')
  check(anchors(after) === 1, '① 盘上只有一个锚标记（原来是两个，实得 ' + anchors(after) + '）')
  check(after.includes('新正文'), '① 新内容保留')
  check(/^\s*Status\s*:/im.test(after) && after.includes('Labels: bug'), '① 盘上原有的状态与标签行补回来了')
}

// ── ② 带状态整份：仍整份替换，行为不变 ──
{
  const incoming = anchor + '\n# 又一标题\n\nStatus: ready-for-agent\nType: task\nBlocked by:\nLabels: bug\n\n## 正文\n\n第二版正文\n'
  const r = await tracker.update(REF, key, { body: incoming }, ctx)
  const after = fileOf()
  check(r.ok === true && h1(after) === 1 && after.includes('第二版正文'), '② 带状态整份仍整份替换（单标题、新内容）')
}

// ── ③ 普通片段：仍走插入，标题数不变、原字段还在 ──
{
  const r = await tracker.update(REF, key, { body: '## 进度\n\n做了一些事\n' }, ctx)
  const after = fileOf()
  check(r.ok === true && h1(after) === 1, '③ 片段插入后仍单标题')
  check(after.includes('做了一些事') && after.includes('Labels: bug'), '③ 片段内容落盘、原标签行还在')
}

// ── ④ 本门禁已挂进验证链 ──
{
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
  check(((pkg.scripts && pkg.scripts.verify) || '').includes('verify-970-whole-document.js'), '④ 验证链里能找到本门禁')
}

console.log(failed ? '\n存在失败 — verify-970-whole-document 未通过' : '\n全部通过 — 整份缺状态行按整份替换（' + total + ' 项断言）')
process.exit(failed ? 1 : 0)
