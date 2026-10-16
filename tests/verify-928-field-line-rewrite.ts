// tests/verify-928-field-line-rewrite.ts —— 门禁：本地票文件改写字段行时只动同一行，绝不吃掉下一行（#928）
// 用法：在插件根目录执行 node --import ./scripts/ts-hook.mjs tests/verify-928-field-line-rewrite.ts。
// 它不能裸跑：本文件用的是 .ts 说明符，而 markdown 房的 index.ts 里还留着 .js 说明符，
// 那些 .js 要靠装载钩子改指同名的 .ts 源文件（旧说法「可独立运行」是错的）。
//
// 守的是什么：票文件里的字段行（Status / Type / Blocked by / Labels）是这样改的 —— 先按行找到字段行，
// 再把这一行换成新的一行。旧写法用的正则是 `^\s*字段\s*[:：]\s*.*$`：字段值为空时（文件里写成
// 「Blocked by:」后面直接跟下一行），冒号后面的 \s* 会跨过换行、.*$ 再吃掉下一行，于是补一条阻塞边
// 就把紧跟其后的 Labels 行整行删掉，给票打标签就把 ## Comments 标题整行删掉。
// 这与并发无关：单写者、单次调用就会发生。
//
// 五个场景、共 19 条断言：①②③ 直接调那个函数（三个输入输出钉死），④ 端到端走真后端（建票 → 补阻塞边 → 标签行还在），
// ⑤ 端到端走真后端（带原因关票 → 改一次正文 → 原因那一行还在）。
//
// 第 ③ 条为什么在 #1174 改过判据：补一行时**不能紧贴标题**。本房的票文件布局是「标题 → 正文 → 字段行 → 骨架区」，
// 紧贴标题插进去的那一行落在正文区里，而整份正文改写是按「标题到第一个字段行之间都算正文」重建的 ——
// 于是下一次改正文会把它整行吃掉。这不是理论推演：关票原因就是这么丢的（关完票再改一次正文，读回退成默认的
// completed）。所以现在补行一律接在**最后一条字段行**后面，第 ③ 条按这个钉，第 ⑤ 条把丢行的场景整个走一遍。
// 一句分寸话：那次修复同时上了两道防线（补行不再插进正文区 + 改写正文时按字段白名单把这几行搬回来），
// 所以第 ⑤ 条单独退回旧插法仍然是绿的；只钉补行位置的是第 ③ 条。
import nodePath from 'node:path'
import { markdownModule } from '../src/tracker/rooms/markdown/index.ts'
import { replaceOrInsertField } from '../src/tracker/rooms/markdown/issues-status.ts'

let failed = 0
let total = 0
const check = (ok: unknown, msg: string): void => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

// ── ① 字段值为空、下一行有内容：下一行必须原样留着 ──
{
  const input = '# 一张票\n\nStatus: ready-for-agent\nBlocked by:\nLabels: bug\n'
  const out = replaceOrInsertField(input, 'Blocked\\s+by', 'Blocked by: #02')
  check(out.includes('Labels: bug'), '① 补阻塞边：紧跟其后的 Labels 行还在（实得 ' + JSON.stringify(out) + '）')
  check(out.includes('Blocked by: #02'), '① 补阻塞边：新的一行写进去了')
}
{
  const input = '# 一张票\n\nStatus: ready-for-agent\nLabels:\n\n## Comments\n'
  const out = replaceOrInsertField(input, 'Labels', 'Labels: bug')
  check(out.includes('## Comments'), '① 打标签：紧跟其后的 ## Comments 标题还在（实得 ' + JSON.stringify(out) + '）')
  check(out.includes('Labels: bug'), '① 打标签：新的一行写进去了')
}

// ── ② 字段行本来就有值：正常整行替换（不许多吃一行、也不许留下旧值） ──
{
  const input = '# 一张票\n\nStatus: ready-for-agent\nBlocked by: #01\nLabels: bug\n'
  const out = replaceOrInsertField(input, 'Blocked\\s+by', 'Blocked by: #02')
  check(out.includes('Blocked by: #02') && !out.includes('#01'), '② 有值时整行换成新的（旧值不残留）')
  check(out.includes('Labels: bug') && out.split('\n').length === input.split('\n').length, '② 行数没变：只换了那一行，没有多吃也没有多插')
}

// ── ③ 文件里没有这一行：接在已有字段行的后面（不紧贴标题，理由见文件头） ──
{
  const input = '# 一张票\n\nStatus: ready-for-agent\nLabels: bug\n'
  const out = replaceOrInsertField(input, 'Type', 'Type: task')
  const lines = out.split('\n')
  check(out.includes('Type: task'), '③ 新字段写进去了（实得 ' + JSON.stringify(lines) + '）')
  check(lines[0] === '# 一张票' && out.includes('Status: ready-for-agent') && out.includes('Labels: bug'), '③ 原有的标题与两行字段一行不少')
  check(lines.indexOf('Type: task') === lines.indexOf('Labels: bug') + 1, '③ 新字段接在最后一条字段行后面，不插进正文区（实得 ' + JSON.stringify(lines) + '）')
}

// ── ④ 端到端：走真后端建一张本地票（票面上「Blocked by:」是空行、下面是 Labels 行），再补一条阻塞边 ──
{
  const K = (p) => String(p).toLowerCase()
  const files = new Map()
  const dirs = new Set(['/ws', '/ws/.scratch', '/ws/.scratch/demo', '/ws/.scratch/demo/issues'])
  files.set(K('/ws/.scratch/demo/map.md'), '# 演示地图\n\nStatus: ready-for-agent\n')
  const fs = {
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
  const ctx = { cwd: '/ws', platform: { path: nodePath.posix, fs: fs }, fs: fs, logEvent: () => {}, isEnabled: () => false }
  const REF = { backend: 'markdown', refId: '/ws', name: 'ws', url: '' }
  const tracker = markdownModule.create({})
  const created = await tracker.create(REF, { title: '端到端那张票', labels: ['needs-triage'], status: 'ready-for-agent' }, ctx)
  check(created.ok === true, '④ 建票成功（实得 ' + JSON.stringify(created && created.error || 'ok') + '）')
  const path = created.ok ? created.data.path || (created.data && created.data.finalPath) : ''
  const file = Array.from(files.keys()).filter((k) => k.includes('/issues/'))[0]
  const before = String(files.get(file))
  check(before.includes('Labels: needs-triage'), '④ 建出来的票面上有 Labels 行（实得 ' + JSON.stringify(before.split('\n').slice(0, 8)) + '）')
  const blocked = await tracker.setBlockedBy(REF, created.data.key || '01', ['02'], {}, ctx)
  check(blocked.ok === true, '④ 补阻塞边成功（实得 ' + JSON.stringify(blocked && blocked.error || 'ok') + '）')
  const after = String(files.get(file))
  check(after.includes('Blocked by: #02'), '④ 阻塞边写进去了')
  check(after.includes('Labels: needs-triage'), '④ 补阻塞边之后，票面上的 Labels 行还在（#928 的数据丢失面，实得 ' + JSON.stringify(after.split('\n').slice(0, 8)) + '）')

  // ── ⑤ 同一张票上再走一遍「事后补的行会不会被下一次改正文吃掉」：带原因关票 → 改一次正文 → 原因那一行还在 ──
  // 这是 #1174 复核 P1-1 实测出来的场景，也是第 ③ 条改判据的由来。
  // 这道防线今天有两道：改写正文时按字段白名单把盘上那几行搬回来（issues-patch.ts 的 fieldLinesOf），
  // 以及补行不再插进正文区（第 ③ 条钉的就是这一道）。所以把补行退回旧写法，本条仍然是绿的 —— 它守的是整条路，
  // 只钉补行位置的是第 ③ 条，别把两件事当成一件事。
  const key = created.data.key || '01'
  const closed = await tracker.close(REF, key, { reason: 'duplicate' }, ctx)
  check(closed.ok === true, '⑤ 带原因关票成功（实得 ' + JSON.stringify(closed && closed.error || 'ok') + '）')
  check(String(files.get(file)).includes('Close reason: duplicate'), '⑤ 票面上写下了 Close reason 那一行（实得 ' + JSON.stringify(String(files.get(file)).split('\n').slice(0, 9)) + '）')
  const updated = await tracker.update(REF, key, { body: '换一段正文。' }, ctx)
  check(updated.ok === true, '⑤ 改正文成功（实得 ' + JSON.stringify(updated && updated.error || 'ok') + '）')
  const finalText = String(files.get(file))
  check(finalText.includes('Close reason: duplicate'), '⑤ 改过正文之后，Close reason 那一行还在（#1174 复核 P1-1，实得 ' + JSON.stringify(finalText.split('\n').slice(0, 9)) + '）')
  check(finalText.includes('Labels: needs-triage') && finalText.includes('Blocked by: #02'), '⑤ 认领人与阻塞边两行也没被这次改正文弄丢')
}

console.log(failed ? '\n存在失败 — verify-928-field-line-rewrite 未通过' : '\n全部通过 — 字段行改写只动同一行（' + total + ' 项断言）')
process.exit(failed ? 1 : 0)
