/**
 * tools/check-capability-entries.ts —— 核对 162 条能力的入口台账，并把它写成一份 Markdown。
 *
 * 为什么要有这道核对：入口台账是手写决定的，最容易出的错不是写错一句理由，
 * 而是「某条能力悄悄没有条目」——四页签改了版式、能力账本加了一条，台账却没人补。
 * 这道检查把三件事一次查明：条数与账本一致、编号一一对应、每条换过落点或新增入口的都写了理由。
 *
 * 运行方式（仓库根目录，Node 24 起直接跑）：
 *   node docs/prototype/vc-redesign/tools/check-capability-entries.ts
 *   node docs/prototype/vc-redesign/tools/check-capability-entries.ts --write
 *
 * 加 --write 会把同一份台账写成同目录的 capability-entries.md，供评审逐条读；
 * 不加只核对，检查不过时以非零退出码结束。
 */
import { writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CAPABILITIES } from '../src/data/capabilities.generated.ts'
import { allCapabilityEntries, handwrittenEntries, tabCapabilityIds } from '../src/data/capability-entries.ts'
import type { CapabilityEntry } from '../src/data/capability-entries.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')

const problems: string[] = []
const entries = allCapabilityEntries()
const ledgerIds = CAPABILITIES.map((cap) => cap.id)
const entryIds = entries.map((entry) => entry.id)

// ① 条数：台账必须与能力账本一一对应，多一条少一条都说明有人改了账本没改台账。
if (entries.length !== CAPABILITIES.length) {
  problems.push(`台账有 ${entries.length} 条，能力账本是 ${CAPABILITIES.length} 条`)
}
const duplicates = entryIds.filter((id, index) => entryIds.indexOf(id) !== index)
if (duplicates.length > 0) problems.push('台账里有重复编号：' + duplicates.join('、'))
const missing = ledgerIds.filter((id) => entryIds.includes(id) === false)
if (missing.length > 0) problems.push('能力账本里有、台账里没有：' + missing.join('、'))
const extra = entryIds.filter((id) => ledgerIds.includes(id) === false)
if (extra.length > 0) problems.push('台账里有、能力账本里没有：' + extra.join('、'))

// ② 四页签：每条都要有人手写的落点决定，不能退回派生条目。
const tabIds = tabCapabilityIds()
const handwrittenIds = handwrittenEntries().map((entry) => entry.id)
const tabMissing = tabIds.filter((id) => handwrittenIds.includes(id) === false)
if (tabMissing.length > 0) problems.push('四页签上这几条没有手写落点决定：' + tabMissing.join('、'))
const tabExtra = handwrittenIds.filter((id) => tabIds.includes(id) === false)
if (tabExtra.length > 0) problems.push('这几条不在四页签上，却写了手写落点：' + tabExtra.join('、'))

// ③ 理由：换过落点或新增入口的条目必须写一句为什么。
const reasonMissing = entries.filter((entry) => (entry.status === '待画' || entry.status === '本票已画') && (entry.reason ?? '') === '')
if (reasonMissing.length > 0) problems.push('这几条换了落点却没写理由：' + reasonMissing.map((entry) => entry.id).join('、'))

// ④ 只读条目不该声称画了可改控件。
const readonlyWrong = CAPABILITIES.filter((cap) => cap.readOnly).filter((cap) => {
  const entry = entries.find((item) => item.id === cap.id)
  return entry !== undefined && (entry.form === '行内控件' || entry.form === '行尾菜单' || entry.form === '提交选项')
})
if (readonlyWrong.length > 0) problems.push('只读能力却记成了可改控件：' + readonlyWrong.map((cap) => cap.id).join('、'))

if (problems.length > 0) {
  console.error('入口台账核对不通过：')
  for (const problem of problems) console.error(' - ' + problem)
  process.exitCode = 1
} else {
  const count = (status: string): number => entries.filter((entry) => entry.status === status).length
  console.log('入口台账核对通过：共 ' + entries.length + ' 条')
  console.log('  已画 ' + count('已画') + ' · 本票已画 ' + count('本票已画') + ' · 待画 ' + count('待画') + ' · 只读 ' + count('只读'))
}

if (process.argv.includes('--write')) {
  writeFileSync(resolve(ROOT, 'capability-entries.md'), renderMarkdown(entries), 'utf8')
  console.log('已写出 docs/prototype/vc-redesign/capability-entries.md')
}

/** 把台账写成一张能逐条读的表：编号、能力、形态、落点、状态、理由。 */
function renderMarkdown(rows: CapabilityEntry[]): string {
  const nameOf = new Map(CAPABILITIES.map((cap) => [cap.id, cap.name]))
  const lines: string[] = [
    '# 162 条能力的入口台账',
    '',
    '这张表由 `node docs/prototype/vc-redesign/tools/check-capability-entries.ts --write` 从',
    '`src/data/capability-entries.ts` 生成，不要手改。数据来源是 `src/data/capabilities.generated.ts`',
    '的 162 条能力；四页签上的条目是手写的落点决定，二级页上的条目由页面底部的能力行派生。',
    '',
    '状态说明：',
    '',
    '- **已画**：这张票之前原型里就有可点入口；',
    '- **本票已画**：#1876 补的入口：提交区那六条（提交形态、内容来源、说明模板、钩子与签名），以及改动页行菜单里的删除已跟踪文件、停止跟踪、重命名或移动；',
    '- **待画**：决定已经给出，由后续切片按这张表落进原型；',
    '- **只读**：这类能力不该有可改控件，页面只展示它读到的形状或边界。',
    '',
    '| 编号 | 能力 | 形态 | 落点 | 状态 | 理由 |',
    '| --- | --- | --- | --- | --- | --- |',
  ]
  for (const entry of rows) {
    const reason = (entry.reason ?? '').replace(/\|/g, '\\|')
    lines.push('| ' + [entry.id, nameOf.get(entry.id) ?? '', entry.form, entry.at, entry.status, reason].join(' | ') + ' |')
  }
  lines.push('')
  return lines.join('\n')
}
