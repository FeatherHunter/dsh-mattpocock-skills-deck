/*
 * tests/verify-1184-body-parse-gap.ts —— #1184 正文解析三处静默丢失的门禁
 * 用法: node --import ./scripts/ts-hook.mjs tests/verify-1184-body-parse-gap.ts（在插件根目录；不联网）
 *
 * 测什么（#1184：面板把没做完的图显示成做完了，三处都在正文解析这一条链上）：
 *   A. 行中粘住的规范标题按标题切：上一行末尾粘着「## Not yet specified」时，
 *      迷雾不再是 0 条；上一行自己的前半截留在原区块，不被吞掉。
 *      `##` 后面没有空格（`text##Notes`）也一样拆；行首 `##Notes` 也认。
 *   B. `- **...**` 决策行进面板索引：带链接的提出标题与链接，
 *      不带链接的标题照收、链接记空；缩进的续行不成新决策。
 *      那句话超过 240 字时截断：不断词（退到最后一个完整词后），省略号粘在后面。
 *   C. 回归：经典 `- [标题](链接) — 一句话` 写法行为不变；
 *      围栏代码块里的「## 规范标题」不切（不误伤正文里讨论标题本身的行）。
 *   D. 守门（黑盒，不联网：守门在任何 gh 调用之前）：
 *      scripts/wire-subissues.mjs 对粘着标题的正文退出码 2，话里含文件名与该标题；
 *      标题写死在四个规范名之外（一整行 `## 别的名字`）同样退出码 2；
 *      尾部没有换行的干净正文照常放行（退出码 0）；
 *      干净正文 --dry-run 退出码 0（正向对照，同样不联网）。
 *   E. 三处标题表同源：叶子 MAP_SECTION_TITLES 的五个名，
 *      守门的三处（首行 Destination、MAP_SECTION_RE 四个、粘住检查五个）
 *      合起来正好是同一套，不多不少（防一边加名另一边漏）。
 *
 * 夹具是按 #1056 当时的真实形状仿的（「…没有动环检逻辑。## Not yet specified」粘在决策行末尾，
 * Decisions 里十几条 `- **任务票 [#NNNN](…) …**：…`），不是从线上拉的。
 */
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseMapBody } from '../src/tracker/body-parse.ts'

let failed = false
const check = (ok: boolean, msg: string): void => {
  console.log((ok ? '  PASS ' : '  FAIL ') + msg)
  if (!ok) failed = true
}

const GLUED_BODY = [
  '## Destination',
  '',
  '证明一件事。',
  '',
  '## Decisions so far',
  '',
  '- [经典写法](https://example.com/a) — 一句话结论。',
  '- **任务票 [#1057](https://example.com/1057) 已关闭**：要点一句。',
  '  - 缩进的续行，不是新决策。',
  '- **没有链接的加粗条目**：也是一条结论。',
  '- 本票只补结论线、没有动环检逻辑。## Not yet specified',
  '1. list 返回是否带完整正文与评论。',
  '2. labels 空集的语义。',
  '## Out of scope',
  '',
  '范围外。',
].join('\n')

const FENCED_BODY = [
  '## Destination',
  '',
  '证明一件事。',
  '',
  '## Notes',
  '',
  '正文里讨论标题本身时写到：行中出现 ## Not yet specified 几个字。',
  '',
  '```',
  '行中出现 ## Notes 也不该切。',
  '```',
  '',
  '## Out of scope',
  '',
  '范围外。',
].join('\n')

// ——— A. 行中粘住的规范标题按标题切 ———
const glued = parseMapBody(GLUED_BODY)
check(glued.fog.length === 2, '粘住的标题切出迷雾：fog 是 2 条（实得 ' + glued.fog.length + ' 条）')
check(glued.fog[0] !== undefined && glued.fog[0].indexOf('1. list') === 0, '迷雾第一条是未定的事（实得：' + JSON.stringify(glued.fog[0]) + '）')

// ——— B. `- **...**` 决策行进面板索引 ———
check(glued.decisions.length === 3, '决策是 3 条（经典 1 条加粗 2 条，实得 ' + glued.decisions.length + ' 条）')
const classic = glued.decisions[0]
check(classic !== undefined && classic.title === '经典写法' && classic.url === 'https://example.com/a' && classic.gist === '一句话结论。', '经典写法原样解析（实得：' + JSON.stringify(classic) + '）')
const bold = glued.decisions[1]
check(bold !== undefined && bold.title.indexOf('#1057') >= 0 && bold.url === 'https://example.com/1057' && bold.gist === '要点一句。', '加粗决策提出标题与链接（实得：' + JSON.stringify(bold) + '）')
const boldNoLink = glued.decisions[2]
check(boldNoLink !== undefined && boldNoLink.title === '没有链接的加粗条目' && boldNoLink.url === '' && boldNoLink.gist === '也是一条结论。', '无链接加粗标题照收、链接记空（实得：' + JSON.stringify(boldNoLink) + '）')
const subLeaked = glued.decisions.some((d) => d.title.indexOf('缩进的续行') >= 0 || d.gist.indexOf('缩进的续行') >= 0)
check(!subLeaked, '缩进的续行不成新决策')

// ——— B 补：那句话太长时截断（不断词，省略号粘在最后一个完整词后） ———
const longSpaced = '- **长话**：' + 'ab '.repeat(100)
const longSpacedDec = parseMapBody('## Destination\n\nX\n\n## Decisions so far\n\n' + longSpaced).decisions[0]
check(longSpacedDec !== undefined && longSpacedDec.gist.length === 240 && longSpacedDec.gist.slice(-1) === '…' && longSpacedDec.gist.indexOf('a…') < 0, '加粗长话截到 240 字、不断词（实得 ' + (longSpacedDec === undefined ? '无决策' : longSpacedDec.gist.length + ' 字，尾=' + JSON.stringify(longSpacedDec.gist.slice(-4))) + '）')
const longClassic = '- [长话](https://example.com/l) — ' + 'ab '.repeat(100)
const longClassicDec = parseMapBody('## Destination\n\nX\n\n## Decisions so far\n\n' + longClassic).decisions[0]
check(longClassicDec !== undefined && longClassicDec.gist.length === 240 && longClassicDec.gist.slice(-1) === '…', '经典长话同样截到 240 字（实得 ' + (longClassicDec === undefined ? '无决策' : longClassicDec.gist.length + ' 字') + '）')
const longToken = '- **整词**：' + 'x'.repeat(300)
const longTokenDec = parseMapBody('## Destination\n\nX\n\n## Decisions so far\n\n' + longToken).decisions[0]
check(longTokenDec !== undefined && longTokenDec.gist.length === 241 && longTokenDec.gist.slice(-1) === '…', '单个超长词硬切在 240 字处（实得 ' + (longTokenDec === undefined ? '无决策' : longTokenDec.gist.length + ' 字') + '）')

// ——— A 补：`##` 后面没有空格也认 ———
const noSpace = parseMapBody('## Destination\n\nX\n\n##Notes\n\n记了。\n\n正文尾巴##Out of scope\n\n范围外。')
check(noSpace.notes === '记了。 正文尾巴', '行首 `##Notes`（无空格）照样切出区块，前半截留在原区块（实得：' + JSON.stringify(noSpace.notes) + '）')
check(noSpace.outOfScope.length === 1 && noSpace.outOfScope[0] === '范围外。', '行中 `##Out of scope`（无空格）照样拆出新区块（实得 outOfScope=' + JSON.stringify(noSpace.outOfScope) + '）')

// ——— C. 围栏内不切 ———
const fenced = parseMapBody(FENCED_BODY)
check(fenced.fog.length === 0, '行中提到标题名但不是标题时不切（fog 实得 ' + fenced.fog.length + ' 条）')
check(fenced.outOfScope.length === 1 && fenced.outOfScope[0] === '范围外。', '行首标题照常切（实得：' + JSON.stringify(fenced.outOfScope) + '）')

// ——— D. 守门（黑盒） ———
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-1184-'))
const gluedFile = path.join(TMP, 'glued.md')
fs.writeFileSync(gluedFile, GLUED_BODY, 'utf8')
const cleanBody = GLUED_BODY.replace('逻辑。## Not yet specified', '逻辑。\n\n## Not yet specified')
const cleanFile = path.join(TMP, 'clean.md')
fs.writeFileSync(cleanFile, cleanBody, 'utf8')
function runGuard(bodyFile: string, extra: string[]): { code: number, out: string } {
  try {
    const out = execFileSync(process.execPath, ['scripts/wire-subissues.mjs', '--map', '1056', '--children', '1057', '--body-file', bodyFile].concat(extra), { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return { code: 0, out: String(out) }
  } catch (e: any) {
    const stdout = String((e && e.stdout) || '')
    const stderr = String((e && e.stderr) || '')
    const code = typeof (e && e.status) === 'number' ? (e.status as number) : 1
    return { code: code, out: stdout + stderr }
  }
}
// 注意：两处都带 --dry-run（守门在任何 gh 调用之前，退出码 2 照样能测到；
// 不带会真跑写回——血的教训：本门禁第一版没带，把 #1056 的正文写成了夹具，
// 当场用 gh issue edit --body-file 按事前存盘恢复（7702 字，去尾空白后逐字节一致）。
const gluedRun = runGuard(gluedFile, ['--dry-run'])
check(gluedRun.code === 2, '粘着标题的正文被守门拒绝（退出码 2，实得 ' + gluedRun.code + '）')
check(gluedRun.out.indexOf('粘在') >= 0 && gluedRun.out.indexOf('## Not yet specified') >= 0, '拒绝理由指明哪一处粘住、怎么改（实得：' + JSON.stringify(gluedRun.out.slice(0, 160)) + '）')
const cleanRun = runGuard(cleanFile, ['--dry-run'])
check(cleanRun.code === 0, '干净正文演练通过（退出码 0，实得 ' + cleanRun.code + '）')
check(gluedRun.out.indexOf('.md') >= 0, '拒绝理由里点名是哪个正文文件（实得：' + JSON.stringify(gluedRun.out.slice(0, 160)) + '）')

// ——— D 补：三种构造各走各的门 ———
const outsideFile = path.join(TMP, 'outside.md')
fs.writeFileSync(outsideFile, '## Destination\n\n目标。\n\n## 别的名字\n\n正文。', 'utf8')
const outsideRun = runGuard(outsideFile, ['--dry-run'])
check(outsideRun.code === 2, '标题写死在四个规范名之外（一整行 `## 别的名字`）被拒绝（退出码 2，实得 ' + outsideRun.code + '）')
const noTrailingFile = path.join(TMP, 'notrail.md')
fs.writeFileSync(noTrailingFile, '## Destination\n\n目标。\n\n## Notes\n\n备注。', 'utf8')
const noTrailingRun = runGuard(noTrailingFile, ['--dry-run'])
check(noTrailingRun.code === 0, '尾部没有换行的干净正文照常放行（退出码 0，实得 ' + noTrailingRun.code + '）')
const gluedEofFile = path.join(TMP, 'gluedeof.md')
fs.writeFileSync(gluedEofFile, '## Destination\n\n目标。\n\n## Notes\n\n备注。\n\n尾巴。## Out of scope', 'utf8')
const gluedEofRun = runGuard(gluedEofFile, ['--dry-run'])
check(gluedEofRun.code === 2 && gluedEofRun.out.indexOf('## Out of scope') >= 0 && gluedEofRun.out.indexOf('.md') >= 0, '文件尾粘住的标题（无尾换行）也被拒绝且点名文件与标题（退出码 ' + gluedEofRun.code + '）')

// ——— E. 三处标题表同源（叶子五个名 == 守门三处合起来） ———
const leafSrc = fs.readFileSync(path.join(ROOT, 'src/tracker/body-parse.ts'), 'utf8')
const guardSrc = fs.readFileSync(path.join(ROOT, 'scripts/wire-subissues.mjs'), 'utf8')
function quotedList(src: string, anchor: RegExp): string[] {
  const m = src.match(anchor)
  if (!m) return []
  return (m[1].match(/'([^']+)'/g) || []).map((q) => q.slice(1, -1))
}
function groupList(src: string, anchor: RegExp): string[] {
  const m = src.match(anchor)
  if (!m) return []
  return m[1].split('|').map((s) => s.trim()).filter(Boolean)
}
const leafTitles = quotedList(leafSrc, /MAP_SECTION_TITLES\s*=\s*\[([^\]]+)\]/)
const guardFour = groupList(guardSrc, /MAP_SECTION_RE\s*=\s*\/\^##\\s*\(([^)]+)\)/)
const guardGlued = groupList(guardSrc, /function findGluedHeading[\s\S]*?const titles = "\(([^)]+)\)"/)
const guardFirst = /\/\^##\\s\*Destination\\s\*\$\//.test(guardSrc) ? ['Destination'] : []
const guardAll = Array.from(new Set(guardFirst.concat(guardFour, guardGlued))).sort()
check(JSON.stringify(leafTitles.slice().sort()) === JSON.stringify(guardAll), '标题表同源：叶子五个名 == 守门（首行 Destination + 四名 + 粘住检查）合集（叶子=' + JSON.stringify(leafTitles) + ' 守门=' + JSON.stringify(guardAll) + '）')

if (failed) {
  console.log('存在失败 — verify-1184-body-parse-gap 未通过')
  process.exitCode = 1
} else {
  console.log('全部通过 — 正文解析不再静默丢掉行中标题与加粗决策行，守门拦得住粘住的写法')
}
