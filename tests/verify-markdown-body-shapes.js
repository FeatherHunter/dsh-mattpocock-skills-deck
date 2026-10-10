// tests/verify-markdown-body-shapes.js —— 门禁：五种正文形态乘三条写路径都不写坏（#1002）
//
// 为什么要有这一条：本地 Markdown 后端上，读回给的是整份票文件文本，写路径却用启发式猜它是片段还是整份，
// 三条写路径会静默写坏票文件却回成功：建票不认整份（骨架与标题与字段翻倍）、改正文丢锚与骨架并退化标题、
// 改进度把字段行吞掉再补到文末。本文件把五种输入形态（片段 / 带一级标题 / 带锚 / 带字段行 / 整份文件）
// 乘三条写路径（建票 / 改正文 / 改进度）的不变量钉死：不重复、不丢失、不位移，做不到就如实失败。
//
// 用法：在插件根目录执行 node tests/verify-markdown-body-shapes.js，可独立运行。
import nodePath from 'node:path'
import fs from 'node:fs'
import { markdownModule } from '../src/host/tracker/backends/markdown/index.js'
import { replaceProgressSection } from '../src/host/tools/deckIssuePatch.js'
import { isWholeIssueBody } from '../src/shared/deck-tools/plan.js'

let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const h1 = (t) => (String(t).match(/^#[ \t]+\S.*/gm) || []).length
const anchors = (t) => (String(t).match(/DSH-IDEMPOTENCY-KEY/g) || []).length
const comments = (t) => (String(t).match(/^##\s*Comments\s*$/gim) || []).length
const answers = (t) => (String(t).match(/^##\s*Answer\s*$/gim) || []).length
const statusLines = (t) => (String(t).match(/^\s*Status\s*[:\uFF1A]/gim) || []).length
const progressHeaders = (t) => (String(t).match(/^##\s*(?:进度|Progress)(?:\s*[：:]\s*\d{1,3}\s*%?)?\s*$/gim) || []).length

const K = (p) => String(p).toLowerCase()
function freshWorld() {
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
  return { files, ctx }
}
const REF = { backend: 'markdown', refId: '/ws', name: 'ws', url: '' }
const tracker = markdownModule.create({})
const fileOf = (files) => String(files.get(Array.from(files.keys()).filter((k) => k.includes('/issues/')).sort()[0]))
const newestFileOf = (files) => String(files.get(Array.from(files.keys()).filter((k) => k.includes('/issues/')).sort().pop()))

// ── 判据共用：五种形态里只有纯片段不是整份 ──
{
  check(isWholeIssueBody('## Question\n\nxxx\n') === false, '判据：纯片段不是整份')
  check(isWholeIssueBody('# 自带\n\nxxx\n') === true, '判据：带一级标题是整份')
  check(isWholeIssueBody('<!-- DSH-IDEMPOTENCY-KEY: x -->\nxxx\n') === true, '判据：带锚是整份')
  check(isWholeIssueBody('## Question\n\nxxx\n\nStatus: ready-for-agent\n') === true, '判据：带字段行是整份')
  check(isWholeIssueBody('## Question\n\nxxx\n\n## Comments\n\n') === true, '判据：带骨架是整份')
}

// ── 建票：五种形态都不翻倍，标题与锚用本次的 ──
{
  const shapes = {
    fragment: '## Question\n\n建票片段\n',
    h1: '# 旧标题\n\n## Question\n\n建票带标题\n',
    anchor: '<!-- DSH-IDEMPOTENCY-KEY: old-anchor -->\n## Question\n\n建票带锚\n',
    fields: '## Question\n\n建票带字段\n\nStatus: ready-for-agent\nType: task\nBlocked by:\nLabels: bug\n',
    skeleton: '## Question\n\n建票带骨架\n\n## Comments\n\n旧评论\n\n## Answer\n\n旧回答\n',
  }
  for (const [name, body] of Object.entries(shapes)) {
    const { files, ctx } = freshWorld()
    const c = await tracker.create(REF, { title: '新票-' + name, body, labels: ['bug'], status: 'ready-for-agent', idempotencyKey: 'shape-create-' + name }, ctx)
    const f = fileOf(files)
    check(c.ok === true, '建票[' + name + ']返回成功')
    check(h1(f) === 1, '建票[' + name + ']一级标题恰好 1 个（实得 ' + h1(f) + '）')
    check(anchors(f) === 1 && f.includes('shape-create-' + name) && !f.includes('old-anchor'), '建票[' + name + ']锚恰好 1 个且是本次的')
    check(comments(f) === 1 && answers(f) === 1, '建票[' + name + ']骨架各 1 个（实得 ' + comments(f) + '/' + answers(f) + '）')
    check(statusLines(f) === 1, '建票[' + name + ']Status 行 1 个（实得 ' + statusLines(f) + '）')
    check(f.includes('# 新票-' + name), '建票[' + name + ']标题用本次的')
  }
}

// ── 建票回环：读回原样再建不翻倍 ──
{
  const { files, ctx } = freshWorld()
  const c1 = await tracker.create(REF, { title: '回环原票', body: '## Question\n\n回环\n', labels: ['bug'], status: 'ready-for-agent', idempotencyKey: 'shape-loop-1' }, ctx)
  const g = await tracker.get(REF, String(c1.data.key), {}, ctx)
  const whole = String(g.data.body)
  const c2 = await tracker.create(REF, { title: '回环新票', body: whole, labels: ['bug'], status: 'ready-for-agent', idempotencyKey: 'shape-loop-2' }, ctx)
  const f2 = newestFileOf(files)
  check(c2.ok === true, '回环建票返回成功')
  check(h1(f2) === 1 && anchors(f2) === 1 && comments(f2) === 1 && answers(f2) === 1 && statusLines(f2) === 1, '回环建票单例全是 1（实得 ' + h1(f2) + '/' + anchors(f2) + '/' + comments(f2) + '/' + answers(f2) + '/' + statusLines(f2) + '）')
  check(f2.includes('# 回环新票') && !f2.includes('# 回环原票'), '回环建票标题用本次的')
  check(f2.includes('shape-loop-2') && !f2.includes('shape-loop-1'), '回环建票锚用本次的')
}

// ── 改正文：整份无一级标题带字段行不丢锚与骨架，标题用盘上的 ──
{
  const { files, ctx } = freshWorld()
  const c1 = await tracker.create(REF, { title: '改前标题', body: '## Question\n\n改前\n', labels: ['bug'], status: 'ready-for-agent', idempotencyKey: 'shape-patch-1' }, ctx)
  const key = String(c1.data.key)
  const r = await tracker.update(REF, key, { body: '## Question\n\n换过\n\nStatus: ready-for-agent\nType: task\nBlocked by:\nLabels: bug\n' }, ctx)
  const after = fileOf(files)
  const g2 = await tracker.get(REF, key, {}, ctx)
  check(r.ok === true, '改正文返回成功')
  check(anchors(after) === 1 && after.includes('shape-patch-1'), '改正文锚保住了')
  check(comments(after) === 1 && answers(after) === 1, '改正文骨架保住了')
  check(h1(after) === 1 && g2.ok && g2.data.title === '改前标题', '改正文缺一级标题时标题用盘上的（实得 ' + (g2.ok ? g2.data.title : '?') + '）')
  // 锚保住了，同锚再建必须复用同一张
  const c2 = await tracker.create(REF, { title: '改前标题', body: 'x', labels: ['bug'], status: 'ready-for-agent', idempotencyKey: 'shape-patch-1' }, ctx)
  check(c2.ok === true && String(c2.data.key) === key, '锚保住了同锚再建复用同一张（实得 ' + (c2.ok ? String(c2.data.key) : '?') + '≠' + key + ' 时失败）')
}

// ── 改进度：有进度区时字段行不位移，无进度区时插在字段行之前 ──
{
  const { files, ctx } = freshWorld()
  const c1 = await tracker.create(REF, { title: '进度票', body: 'intro\n\n## 进度\n\nold\n', labels: ['bug'], status: 'ready-for-agent', idempotencyKey: 'shape-prog-1' }, ctx)
  const key = String(c1.data.key)
  const cur = await tracker.get(REF, key, {}, ctx)
  const patched = replaceProgressSection(String(cur.data.body), 'new')
  const r = await tracker.update(REF, key, { body: patched }, ctx)
  const after = fileOf(files)
  check(r.ok === true, '改进度返回成功')
  check(after.includes('new') && !after.includes('\nold\n'), '改进度旧内容不残留')
  check(progressHeaders(after) === 1, '改进度标题恰好 1 条')
  check(after.indexOf('Status:') < after.indexOf('## Answer'), '改进度字段行还在 Answer 之前（位移了就失败）')
}
{
  const { files, ctx } = freshWorld()
  const c1 = await tracker.create(REF, { title: '无进度票', body: 'intro\n', labels: ['bug'], status: 'ready-for-agent', idempotencyKey: 'shape-prog-2' }, ctx)
  const key = String(c1.data.key)
  const cur = await tracker.get(REF, key, {}, ctx)
  const patched = replaceProgressSection(String(cur.data.body), 'newb')
  const r = await tracker.update(REF, key, { body: patched }, ctx)
  const after = fileOf(files)
  check(r.ok === true, '无进度区改进度返回成功')
  check(after.indexOf('## 进度') < after.indexOf('Status:'), '无进度区时进度插在字段行之前（落到 Answer 之后就失败）')
  check(after.indexOf('Status:') < after.indexOf('## Answer'), '无进度区时字段行还在 Answer 之前')
}

// ── 本门禁已挂进验证链 ──
{
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
  check(((pkg.scripts && pkg.scripts.verify) || '').includes('verify-markdown-body-shapes.js'), '验证链里能找到本门禁')
}

console.log(failed ? '\n存在失败 — verify-markdown-body-shapes 未通过' : '\n全部通过 — 五种形态乘三条写路径（' + total + ' 项断言）')
process.exit(failed ? 1 : 0)
