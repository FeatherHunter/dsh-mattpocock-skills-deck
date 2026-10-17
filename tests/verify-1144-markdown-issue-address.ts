/**
 * tests/verify-1144-markdown-issue-address.ts —— Markdown 房给出的票地址，要么是空串，要么指向盘上真实存在的文件。
 *
 * 票面（#1144）：本地 Markdown 房在模块对象上声明的 `issueAddress(ref, key)` 按编号拼出一个文件名，
 * 而那个文件通常并不存在。实测（2026-10-14）：盘上真文件是 `01-hello-world.md`，它给的是 `01-untitled.md`。
 * 根因是文件名带「标题转出来的后缀」，而标题转后缀把中文等非 ASCII 字符删光、删空了回落 `untitled`
 * （`src/tracker/rooms/markdown/parse.ts` 顶上的 slugify），所以光凭编号谁也算不出真名字。
 * #1142 已把票的地址改成由真正读写文件的那一层填进票里（票的 `url` 字段），于是这条「按编号现算」的函数
 * 再没有能力给出真地址，只能猜——本票把它改成诚实回空串（票面建议方向第 2 条）。
 *
 * 本文件的判定只有一条（票面验收）：
 *   **Markdown 房给出的票地址，要么是空串，要么指向盘上真实存在的文件；不许再出现按编号猜出来的规范名。**
 * 出口有两处，本文件钉「后端自己现算地址」这一处：模块对象上的 `issueAddress`，以及注册表转发它的那一层。
 * 另一处「票自己带的 url」由 `tests/verify-markdown-backend.ts` 的第 ⑨ 节钉着（#1142），本文件不重抄一遍
 * （仓里的规矩：同一个判断不写两遍，一处改了另一处要跟着改）。
 *
 * 运行：node tests/verify-1144-markdown-issue-address.ts（挂在 verify 长串上，npm test 会跑到）
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { markdownModule, createMarkdownBackend } from '../src/tracker/rooms/markdown/index.ts'
import { issueAddress as registryIssueAddress } from '../src/tracker/registry/views.ts'

let failed = false
const check = (ok: boolean, msg: string) => {
  console.log((ok ? '  PASS ' : '  FAIL ') + msg)
  if (!ok) failed = true
}

// ── 夹具：一个真的工作区（真目录、真文件），两个 effort 各一张票 ──
// 路径按 ctx.platform.path 拼（本夹具用 posix），期望值也用同一个拼法，两边不会各说各话。
const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'md-1144-'))
const plat = {
  path: path.posix,
  fs: {
    async resolve(p: string) { return p },
    async readText(t: string) { return fs.readFileSync(t, 'utf8') },
    async writeText(t: string, c: string) { fs.mkdirSync(path.dirname(t), { recursive: true }); fs.writeFileSync(t, c, 'utf8') },
    async lstat(t: string) { try { return fs.statSync(t) } catch { return null } },
    async listDir(t: string) { try { return fs.readdirSync(t) } catch { return [] } },
    async stat(t: string) { try { return fs.statSync(t) } catch { return null } },
  },
}
const ctx = { platform: plat, fs: plat.fs, cwd: ws, get(name: string) { return name === 'fs' ? plat.fs : undefined } }
const effortDir = path.posix.join(ws, '.scratch/demo')
const issuesDir = path.posix.join(effortDir, 'issues')
const realTicket = path.posix.join(issuesDir, '01-hello-world.md')
fs.mkdirSync(issuesDir, { recursive: true })
fs.writeFileSync(path.posix.join(effortDir, 'map.md'), '# Demo Map\n\nStatus: ready-for-agent\n', 'utf8')
// 两张真票，两个不同的起名去向：英文标题留下 01-hello-world.md，中文标题落到 02-untitled.md。
// 「同一个编号可能落在这两个名字上」正是「光凭编号算不出真名字」的实物证据。
fs.writeFileSync(realTicket, '# Hello World\n\nStatus: ready-for-agent\nType: task\n', 'utf8')
fs.writeFileSync(path.posix.join(issuesDir, '02-untitled.md'), '# 中文标题的票\n\nStatus: ready-for-agent\nType: task\n', 'utf8')

/** 模块上这条定位口的调用口：本文件要钉的是「不许抛、不许猜」，所以按「什么都能传」的形状调它。 */
const callAddress = (ref: unknown, key: unknown): string =>
  (markdownModule.issueAddress as unknown as (ref: unknown, key: unknown) => string)(ref, key)

/** 按编号猜出来的规范名（旧实现的产物）：命名规则见 `src/tracker/rooms/markdown/path.ts` 的 issueFileName。 */
const guessedNames = (key: string): string[] => {
  const pad = String(key).padStart(2, '0')
  return [path.posix.join(issuesDir, pad + '-untitled.md'), path.posix.join(issuesDir, pad + '.md')]
}

/** 票面那条判据本身：空串可以，非空就必须是盘上真实存在的文件。 */
const addressInvariant = (got: unknown): string =>
  typeof got !== 'string' ? '回的不是字符串：' + JSON.stringify(got)
    : got === '' ? ''
      : fs.existsSync(got) ? '' : '给了一条不存在的路径：' + JSON.stringify(got)

console.log('== ① 模块对象上的 issueAddress：三条旧 ref 形状都不许再猜文件名 ==')
{
  const shapes: Array<[string, unknown]> = [
    // 三条都是旧实现真会拼出文件的形状；今天它们一律回空串，重点是「不许出现不存在的路径」。
    ['refId 指到 effort 目录（金标准回执那种）', { backend: 'markdown', refId: effortDir, name: 'demo', url: '' }],
    ['refId 指到工作区根 + effortId（effort 范围那种）', { backend: 'markdown', refId: ws, name: 'demo', url: '', effortId: 'demo' }],
    ['path 直接指到 effort 目录（夹具形态）', { backend: 'markdown', path: effortDir, name: 'demo', url: '' }],
  ]
  // '00' 是地图、'01'／'02' 是两张真票、'999' 与空串是「这个编号没有对应文件」的两端。
  const keys = ['00', '01', '02', '999', '']
  for (const [label, ref] of shapes) {
    for (const key of keys) {
      let got = ''
      let threw = ''
      try { got = callAddress(ref, key) } catch (e) { threw = String((e as Error) && (e as Error).message) }
      const bad = threw ? '调用抛错：' + threw : addressInvariant(got)
      check(bad === '', '① ' + label + '，编号 ' + JSON.stringify(key) + ' → 空串或真实存在的文件（' + (bad || '实得 ' + JSON.stringify(got)) + '）')
    }
  }
}

console.log('\n== ② 按编号猜出来的规范名一个都不许出现（本票的现象就是这两个） ==')
{
  const ref = { backend: 'markdown', refId: effortDir, name: 'demo', url: '' }
  for (const key of ['01', '02']) {
    const got = callAddress(ref, key)
    const guesses = guessedNames(key)
    check(guesses.indexOf(got) < 0,
      '② 编号 ' + key + ' 的答案不许是按编号拼出来的那个名字（实得 ' + JSON.stringify(got) + '，猜测候选 ' + JSON.stringify(guesses) + '）')
  }
  // 01 这一条是本票实测的现象本身：真文件是 01-hello-world.md，旧实现给的是 01-untitled.md。
  const got01 = callAddress(ref, '01')
  check(got01 !== path.posix.join(issuesDir, '01-untitled.md') && (got01 === '' || fs.existsSync(got01)),
    '② 编号 01 的地址不是 01-untitled.md（真文件 ' + realTicket + ' 存在=' + fs.existsSync(realTicket) + '；实得 ' + JSON.stringify(got01) + '）')
}

console.log('\n== ③ 边界：不给引用、给空引用、给空编号，也不许抛 ==')
{
  const edges: Array<[string, unknown, unknown]> = [
    ['引用与编号都不给（undefined）', undefined, undefined],
    ['引用与编号都是 null', null, null],
    ['空对象引用', {}, '01'],
    ['引用只有空 refId', { backend: 'markdown', refId: '' }, '01'],
    ['编号是空格', { backend: 'markdown', refId: effortDir }, '   '],
  ]
  for (const [label, ref, key] of edges) {
    let got = ''
    let threw = ''
    try { got = callAddress(ref, key) } catch (e) { threw = String((e as Error) && (e as Error).message) }
    const bad = threw ? '调用抛错：' + threw : addressInvariant(got)
    check(bad === '', '③ ' + label + ' → 不抛、且答案要么空要么真实（' + (bad || '实得 ' + JSON.stringify(got)) + '）')
  }
}

console.log('\n== ④ 注册表转发那一层：任何人经它拿到的地址同样不许指向不存在的文件 ==')
{
  // 注册表按「模块对象优先、实例其次」转发（src/tracker/registry/views.ts 的 issueAddress），
  // 票面点的就是这条路：「任何人一调就拿到一条指向不存在文件的路径」。这里按注册表登记的真实形状传。
  const byId = new Map<string, unknown>([['markdown', { mod: markdownModule, tracker: createMarkdownBackend(ctx) }]])
  const ref = { backend: 'markdown', refId: effortDir, name: 'demo', url: '' }
  for (const key of ['00', '01', '02']) {
    let got = ''
    let threw = ''
    try { got = registryIssueAddress(byId as never, 'markdown' as never, ref as never, key) } catch (e) { threw = String((e as Error) && (e as Error).message) }
    const bad = threw ? '调用抛错：' + threw : addressInvariant(got)
    check(bad === '' && guessedNames(key).indexOf(got) < 0,
      '④ 经注册表取编号 ' + key + ' 的地址 → 空串或真实存在的文件，且不是猜的名字（' + (bad || '实得 ' + JSON.stringify(got)) + '）')
  }
}

fs.rmSync(ws, { recursive: true, force: true })

if (failed) {
  console.log('\n存在失败 — verify-1144-markdown-issue-address 未通过')
  process.exit(1)
}
console.log('\n全部通过 — Markdown 房给出的票地址：要么空，要么真实存在，不再按编号猜（#1144）')
