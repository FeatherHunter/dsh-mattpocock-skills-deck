/**
 * tests/verify-1827-double-anchor.ts —— 正文自带幂等锚时，建票不许写成两行（#1827）。
 *
 * 病：建票时 withAnchor() 无条件把锚行拼在正文最前；调用方在正文里手写过同一行锚时，
 * 票面上就落成两行相同的注释（#1801、#1802 就是这么来的）。本文件在单元层钉住修法，
 * 纯函数、不联网、不调 gh / glab：
 *   ① 正文没有锚：带键时只多出工具那一行，正文一个字节不动；
 *   ② 正文自带同键锚：落成一行，不重复；
 *   ③ 正文自带多行锚 / 异键锚：全部剥掉，只留工具这把键的一行；
 *   ④ 只剥整行锚：正文中间的引用、行内提及、其它隐藏注释都不动；
 *   ⑤ CRLF、空正文：不把别处的换行符改掉；
 *   ⑥ 不带键：原样返回，一个字节都不改（沿用旧行为）；
 *   ⑦ 本门禁挂在 verify 链里（不挂进链就等于没跑）。
 *
 * 真机上「建一张正文自带锚的票、读回来只有一行」这一步要 gh / glab 登录与可写仓库，
 * 门禁里做不了；单元层把两间房写正文那一处（withAnchor）钉死即可。
 *
 * 运行：node --import ./scripts/ts-hook.mts tests/verify-1827-double-anchor.ts
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { anchorLineFor, idempotencyKeyOf, stripAnchorLines } from '../src/refresh/contract/idempotency-keys.ts'
import { withAnchor as withAnchorGithub } from '../src/tracker/rooms/github/routing/idempotency.ts'
import { withAnchor as withAnchorGitlab } from '../src/tracker/rooms/gitlab/idempotency.ts'
import { planGates } from '../scripts/lib/discover-gates.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

let failed = false
const check = (ok: boolean, msg: string) => {
  console.log((ok ? '  PASS ' : '  FAIL ') + msg)
  if (!ok) failed = true
}

/** 拼一行锚（与 anchorLineFor 同形，用来当“正文里手写的那一行”）。 */
const anchorText = (key: string): string => '<!-- DSH-IDEMPOTENCY-KEY: ' + key + ' -->'
/** 一段正文里出现了几次锚标记（判「几行」只数标记串，不必再按行切）。 */
const anchorCount = (text: string): number => text.split('DSH-IDEMPOTENCY-KEY').length - 1

type WithAnchor = (body: string, key: string | null | undefined) => string

/** 两间远端房各一份 withAnchor：修法要两处同时成立，缺一间就是漏网。 */
const rooms: Array<[string, WithAnchor]> = [
  ['GitHub', withAnchorGithub],
  ['GitLab', withAnchorGitlab],
]

// ── ① 正文没有锚：只多出工具那一行，正文原样 ──
{
  const plain = '## 目的\n\n正文一段，行尾有空格 　\n'
  for (const [name, withAnchor] of rooms) {
    const out = withAnchor(plain, 'k1')
    check(out === anchorLineFor('k1') + plain, name + '：正文没有锚时只多出工具那一行，正文一字不动')
    check(anchorCount(out) === 1, name + '：拼完只有一行锚（实得 ' + anchorCount(out) + ' 处标记）')
  }
}

// ── ② 正文自带同键锚：落成一行 ──
{
  const body = anchorText('k1') + '\n## 目的\n'
  for (const [name, withAnchor] of rooms) {
    const out = withAnchor(body, 'k1')
    check(out === anchorLineFor('k1') + '## 目的\n', name + '：正文自带同键锚时不再拼第二行')
    check(anchorCount(out) === 1, name + '：同键锚落盘后只有一行（实得 ' + anchorCount(out) + ' 处标记）')
  }
}

// ── ③ 正文自带多行锚 / 异键锚：全剥掉，只留工具这把键 ──
{
  const dirty = anchorText('k1') + '\n' + anchorText('k1') + '\n' + anchorText('old-key') + '\n## 目的\n'
  for (const [name, withAnchor] of rooms) {
    const out = withAnchor(dirty, 'k1')
    check(out === anchorLineFor('k1') + '## 目的\n', name + '：多行锚与异键锚都剥掉，只留工具这把键的一行')
    check(anchorCount(out) === 1, name + '：脏正文落盘后只有一行（实得 ' + anchorCount(out) + ' 处标记）')
    check(out.indexOf('old-key') < 0, name + '：旧的另一把键不留在票面上')
    check(idempotencyKeyOf(out) === 'k1', name + '：回查按票面第一行读到的仍是工具这把键')
  }
}

// ── ③b 用 #1802 票面原文的开头当样本：两行同锚 + 「## 目的」 ──
{
  const ticketHead = anchorText('defect-settings-cross-window-writeback-20261101') + '\n' + anchorText('defect-settings-cross-window-writeback-20261101') + '\n## 目的\n'
  for (const [name, withAnchor] of rooms) {
    const out = withAnchor(ticketHead, 'defect-settings-cross-window-writeback-20261101')
    check(out === anchorLineFor('defect-settings-cross-window-writeback-20261101') + '## 目的\n', name + '：真实双锚票面修后只留一行')
  }
}

// ── ④ 只剥整行锚：行内提及与其它隐藏注释不动 ──
{
  const body = '举例：<!-- DSH-IDEMPOTENCY-KEY: k1 --> 这一行只是引用写法\n<!-- DSH-PARENT: 5 -->\n正文\n'
  check(stripAnchorLines(body) === body, '只剥整行：行内提及锚的正文不动，其它隐藏注释也不动')
  const mid = '## 目的\n\n' + anchorText('x') + '\n正文\n'
  check(stripAnchorLines(mid) === '## 目的\n\n正文\n', '正文中间单独成行的锚也剥掉（锚行是保留行，不算正文）')
  const indented = '  ' + anchorText('x') + '  \n正文'
  check(stripAnchorLines(indented) === '正文', '整行锚带行首缩进与行尾空格也认得出、剥得掉')
  const spaced = '<!--   DSH-IDEMPOTENCY-KEY: x -->\n正文'
  check(stripAnchorLines(spaced) === '正文', '注释开头多几个空格也认（判法与工具拼出来的形状对齐）')
  const notClosed = '<!-- DSH-IDEMPOTENCY-KEY: x\n正文'
  check(stripAnchorLines(notClosed) === notClosed, '没收尾成注释的行不算锚，原样保留')
}

// ── ⑤ CRLF 与空正文：别处的换行符不改 ──
{
  check(stripAnchorLines(anchorText('k1') + '\r\n正文\r\n') === '正文\r\n', 'CRLF 正文锚行剥掉后其余行原样（实得 ' + JSON.stringify(stripAnchorLines(anchorText('k1') + '\r\n正文\r\n')) + '）')
  for (const [name, withAnchor] of rooms) {
    const out = withAnchor(anchorText('k1') + '\r\n正文\r\n', 'k1')
    check(out === anchorLineFor('k1') + '正文\r\n', name + '：CRLF 正文拼完只剩一行锚，正文的换行符没被改写')
    check(withAnchor('', 'k1') === anchorLineFor('k1'), name + '：空正文只落一行锚（不多出空行）')
  }
  check(stripAnchorLines(undefined) === '', 'undefined 当空正文（不抛错、不拼出字面量）')
}

// ── ⑥ 不带键：原样返回，一个字节都不改 ──
{
  const body = anchorText('k1') + '\n正文\n'
  for (const [name, withAnchor] of rooms) {
    check(withAnchor(body, '') === body, name + '：没有键时原样返回（空串）')
    check(withAnchor(body, null) === body, name + '：没有键时原样返回（null）')
    check(withAnchor('', null) === '', name + '：空正文、没有键时仍是空串')
  }
}

// ── ⑦ 本文件必须在 verify 链里（不挂进链就等于没跑；#1125 起问规划函数）──
{
  const mine = planGates(ROOT).filter((s) => s.file.indexOf('verify-1827-double-anchor') >= 0)
  check(mine.length === 1, '本门禁挂在 verify 链里且只挂一次（实得 ' + mine.length + ' 次）')
}

console.log('\nverify-1827-double-anchor: ' + (failed ? '有失败项' : '全部通过'))
if (failed) process.exit(1)
console.log('IDEMPOTENCY ANCHOR DEDUPE OK')
