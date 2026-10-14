/**
 * tests/verify-capability-register.ts —— 能力登记三处对齐门禁（#1172）
 *
 * 门禁归属: src/tracker/contract/capability-answer.ts
 * 门禁归属: src/tracker/rooms/github/capability-register.ts
 * 门禁归属: src/tracker/rooms/markdown/capability-register.ts
 * 门禁归属: src/tracker/rooms/gitlab/capability-register.ts
 * 门禁归属: docs/tracker
 *
 * 这个门禁回答的问题：「一条能力在一个后端上的归宿，三处记的是不是同一件事。」三处指：
 *   一、数据（真源）—— `src/tracker/rooms/<后端>/capability-register.ts`；
 *   二、给人读的表（视图）—— `docs/tracker/capability-<后端>.md` 里那两张表；
 *   三、实现面的成员集合 —— 各房文件里的 `XBackendMembers`，它由数据推出来（编译期管，见各房注释）。
 *
 * 为什么要它：2026-10-14 之前，同一件事在 md 表里写「当前不支持、未来会开发」，在契约注释里写
 * 「没有本地文件可放」，两句互相矛盾，改文档全靠人记得。现在分类只有数据一份真源，这个门禁逐条
 * 比对 md 表：改了一边不改另一边，它当场红，并指出是哪一行。
 *
 * 顺带守两条纪律：
 *   - `planned`（未来会开发）必须写清承接票号 —— 没有承接人的「未来会开发」就是没人管的欠账；
 *   - 登记数据不许被运行时代码 import（G5：能力只能调用即知，不许查表）。所以 src/ 下引用它的地方
 *     只许写 `import type`，扫出一句值引用就红（转译后不留引用，运行时的包里也就不会加载它）。
 *
 * 用法：node --import ./scripts/ts-hook.mjs tests/verify-capability-register.ts
 *       （挂在验证链上跑时钩子由链条自己挂，见 scripts/verify-chain.js）
 */
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'

import { OPERATIONS, LOCATORS } from '../src/tracker/contract/operations-catalog.js'
import { GITHUB_CAPABILITY_REGISTER } from '../src/tracker/rooms/github/capability-register.js'
import { MARKDOWN_CAPABILITY_REGISTER } from '../src/tracker/rooms/markdown/capability-register.js'
import { GITLAB_CAPABILITY_REGISTER } from '../src/tracker/rooms/gitlab/capability-register.js'

type Kind = 'provided' | 'partial' | 'unsupported' | 'planned'

/** 一份登记数据在门禁眼里的样子（只读，够比对用）。 */
type RegisterView = { readonly [name: string]: { readonly kind: Kind; readonly gap?: string; readonly ticket?: string } }

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..')

/** 契约名录的全部 25 个名字（22 条操作 + 3 条定位口）：登记表要有多少行，就是它说了算。 */
const CATALOG: string[] = [...OPERATIONS, ...LOCATORS]

/** md 表「登记」列里那四个词 ↔ 数据里的四类。前三个词是 2026-10-14 #1147 决策 9 定下的，
 *  第四个（`partial`）是 #1174 加的第四档：形态成立、有实现，但有某几种输入与承诺对不上。
 *  多一个没登记在这里的词就是有人新造了第五类——那要先改契约里的判据，不是在 md 表里随手写个新词。 */
const KIND_OF_LABEL: { [label: string]: Kind } = {
  明确提供功能: 'provided',
  做了但没做到位: 'partial',
  明确不支持: 'unsupported',
  '当前不支持、未来会开发': 'planned',
}

const BACKENDS: { readonly id: string; readonly register: RegisterView; readonly md: string; readonly room: string }[] = [
  { id: 'github', register: GITHUB_CAPABILITY_REGISTER, md: 'docs/tracker/capability-github.md', room: 'src/tracker/rooms/github/backend.ts' },
  { id: 'markdown', register: MARKDOWN_CAPABILITY_REGISTER, md: 'docs/tracker/capability-markdown.md', room: 'src/tracker/rooms/markdown/index.ts' },
  { id: 'gitlab', register: GITLAB_CAPABILITY_REGISTER, md: 'docs/tracker/capability-gitlab.md', room: 'src/tracker/rooms/gitlab/index.ts' },
]

let failed = false
const check = (ok: boolean, msg: string) => {
  console.log((ok ? '  PASS ' : '  FAIL ') + msg)
  if (!ok) failed = true
}
const NOTHING = '（没有）'

/** 从一份 md 里取「能力 → 『登记』列那个词」。行形如 `| 名字 | 登记 | 依据 |`；表头与分隔行按「第一格不是名录里的名字」跳过。 */
function readMdTable(text: string): { name: string; label: string }[] {
  const rows: { name: string; label: string }[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line.startsWith('|')) continue
    const cells = line.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
    if (cells.length < 2) continue
    const name = cells[0].replace(/`/g, '')
    if (!CATALOG.includes(name)) continue
    rows.push({ name, label: cells[1].replace(/`/g, '') })
  }
  return rows
}

/** 递归收 src/ 下的 .ts 文件（登记数据自己不算「引用它」）。 */
function listSrcTs(dir: string): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue
    const abs = path.join(dir, entry.name)
    if (entry.isDirectory()) { out.push(...listSrcTs(abs)); continue }
    if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) out.push(abs)
  }
  return out.sort()
}

console.log('能力登记三处对齐门禁（数据 ↔ 给人读的表 ↔ 实现面成员集合）')

for (const backend of BACKENDS) {
  const dataNames = Object.keys(backend.register)
  const mdRows = readMdTable(fs.readFileSync(path.join(ROOT, backend.md), 'utf8'))
  const mdNames = mdRows.map((r) => r.name)

  // —— 一、登记数据本身：25 条齐全、与名录同集（类型层已经管住，这里是运行时的第二道）——
  const dataMissing = CATALOG.filter((n) => !dataNames.includes(n))
  const dataExtra = dataNames.filter((n) => !CATALOG.includes(n))
  check(
    dataMissing.length === 0 && dataExtra.length === 0 && dataNames.length === CATALOG.length,
    backend.id + ' 的登记数据 25 条齐全、与名录同集（共 ' + dataNames.length + ' 条；缺 ' +
      (dataMissing.length ? dataMissing.join('、') : NOTHING) + '；多 ' + (dataExtra.length ? dataExtra.join('、') : NOTHING) + '）',
  )

  // —— 二、md 表与数据逐条一致：名字两个方向 + 分类逐行 ——
  const mdMissing = CATALOG.filter((n) => !mdNames.includes(n))
  const mdDuplicate = mdNames.filter((n, i) => mdNames.indexOf(n) !== i)
  const kindMismatch: string[] = []
  const unknownLabel: string[] = []
  for (const row of mdRows) {
    const kind = KIND_OF_LABEL[row.label]
    if (!kind) { unknownLabel.push(row.name + ' → 「' + row.label + '」'); continue }
    if (kind !== backend.register[row.name].kind) {
      kindMismatch.push(row.name + '：表里写「' + row.label + '」，数据里是 ' + backend.register[row.name].kind)
    }
  }
  const mdOk = mdMissing.length === 0 && mdDuplicate.length === 0 && kindMismatch.length === 0 && unknownLabel.length === 0
  check(
    mdOk,
    backend.md + ' 与登记数据逐条一致（' + mdRows.length + ' 行；' +
      (mdMissing.length ? '表里缺：' + mdMissing.join('、') + '；' : '') +
      (mdDuplicate.length ? '表里重复：' + mdDuplicate.join('、') + '；' : '') +
      (kindMismatch.length ? '分类不符：' + kindMismatch.join('；') + '；' : '') +
      (unknownLabel.length ? '不认识的说法：' + unknownLabel.join('；') + '；' : '') +
      (mdOk ? '两处同集、逐行同分类' : '把两边改成同一件事再提交') + '）',
  )

  // —— 三、`planned` 必须写清承接票号 ——
  const plannedNoTicket = dataNames.filter((n) => backend.register[n].kind === 'planned' && !String(backend.register[n].ticket || '').trim())
  const planned = dataNames.filter((n) => backend.register[n].kind === 'planned').length
  check(
    plannedNoTicket.length === 0,
    backend.id + ' 的 ' + planned + ' 条「未来会开发」都写了承接票号' +
      (plannedNoTicket.length ? '（没写：' + plannedNoTicket.join('、') + '）' : ''),
  )

  // —— 四、`partial` 必须写清差在哪（`gap`），并且说明这处缺口由谁承接 ——
  // 为什么单独立一条：这一档的全部价值就是「把差在哪写下来」。写不出差在哪，说明这条压根还没审过，
  // 那它就该老老实实是 `provided` 或者 `unsupported`，不该占着这一档当挡箭牌。
  const partialNoGap = dataNames.filter((n) => backend.register[n].kind === 'partial' && !String(backend.register[n].gap || '').trim())
  const partialNoTicket = dataNames.filter((n) => backend.register[n].kind === 'partial' && !String(backend.register[n].ticket || '').trim())
  const partial = dataNames.filter((n) => backend.register[n].kind === 'partial').length
  check(
    partialNoGap.length === 0 && partialNoTicket.length === 0,
    backend.id + ' 的 ' + partial + ' 条「做了但没做到位」都写清了差在哪、由谁承接' +
      (partialNoGap.length ? '（没写差在哪：' + partialNoGap.join('、') + '）' : '') +
      (partialNoTicket.length ? '（没写承接票：' + partialNoTicket.join('、') + '）' : ''),
  )

  // —— 五、实现面：成员集合由登记推出来，不再手写一份 ——
  const roomText = fs.readFileSync(path.join(ROOT, backend.room), 'utf8')
  check(
    /ProvidedCapability<typeof\s+\w+_CAPABILITY_REGISTER>/.test(roomText),
    backend.room + ' 的成员集合由登记数据推出来（`ProvidedCapability<typeof …>`），没有手写的第二份名单',
  )

  // 概览（不是判定，是给人看的一行账）
  const count = (kind: Kind) => dataNames.filter((n) => backend.register[n].kind === kind).length
  console.log('  ---- ' + backend.id + '：' + count('provided') + ' 提供 / ' + count('partial') + ' 做了但没做到位 / ' + count('unsupported') + ' 明确不支持 / ' + count('planned') + ' 未来会开发')
}

// —— 五、G5：登记数据只许被 `import type` 引用（运行时不读它）——
const valueImports: string[] = []
for (const abs of listSrcTs(path.join(ROOT, 'src'))) {
  if (path.basename(abs) === 'capability-register.ts') continue
  const lines = fs.readFileSync(abs, 'utf8').split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    if (!/capability-register\.js['"]/.test(lines[i])) continue
    if (/^\s*import\s+type\b/.test(lines[i])) continue
    valueImports.push(path.relative(ROOT, abs).replace(/\\/g, '/') + ':' + (i + 1) + ' ' + lines[i].trim())
  }
}
check(
  valueImports.length === 0,
  '全仓 src/ 只有 `import type` 引用登记数据（运行时不读它；G5 红线：能力只能调用即知）' +
    (valueImports.length ? '：' + valueImports.join('；') : ''),
)

console.log(failed ? '\n存在失败 — 能力登记三处没对齐' : '\n全部通过 — 能力登记三处对齐（数据是唯一真源，表是它的视图）')
process.exit(failed ? 1 : 0)
