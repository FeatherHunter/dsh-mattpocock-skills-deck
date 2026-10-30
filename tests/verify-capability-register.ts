/**
 * tests/verify-capability-register.ts —— 能力登记三处对齐门禁（#1172）
 *
 * 门禁归属: src/tracker/contract/capability-answer.ts
 * 门禁归属: src/tracker/rooms/github/support/capability-register.ts
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
 * 用法：node --import ./scripts/ts-hook.mts tests/verify-capability-register.ts
 *       （挂在验证链上跑时钩子由链条自己挂，见 scripts/verify-chain.ts）
 */
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'

import { OPERATIONS, LOCATORS } from '../src/tracker/contract/operations-catalog.js'
import { GITHUB_CAPABILITY_REGISTER } from '../src/tracker/rooms/github/capability-register.js'
import { MARKDOWN_CAPABILITY_REGISTER } from '../src/tracker/rooms/markdown/capability-register.js'
import { GITLAB_CAPABILITY_REGISTER } from '../src/tracker/rooms/gitlab/capability-register.js'
import type { CapabilityTier } from '../src/tracker/contract/capability-answer.js'

/** 一份登记数据在门禁眼里的样子（只读，够比对用）。
 *  档位那一格直接用契约里的 `CapabilityTier`，本门禁不自己抄一份词——四档的词只有一个真源（#1180）。 */
type RegisterView = { readonly [name: string]: { readonly tier: CapabilityTier; readonly gap?: string; readonly ticket?: string } }

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..')

/** 契约名录的全部 27 个名字（24 条操作 + 3 条定位口）：登记表要有多少行，就是它说了算。 */
const CATALOG: string[] = [...OPERATIONS, ...LOCATORS]

/** md 表「登记」列里那四个词 ↔ 数据里的四档。前三个词是 2026-10-14 #1147 决策 9 定下的，
 *  第四个（`partial`）是 #1174 加的第四档：形态成立、有实现，但有某几种输入与承诺对不上。
 *  多一个没登记在这里的词就是有人新造了第五档——那要先改契约里的判据，不是在 md 表里随手写个新词。
 *  档位的取值照契约定（`unsupported-by-design`，不叫 `unsupported`：那个词属于错误档位那一轴，#1180）。 */
const TIER_OF_LABEL: { [label: string]: CapabilityTier } = {
  明确提供功能: 'provided',
  做了但没做到位: 'partial',
  明确不支持: 'unsupported-by-design',
  '当前不支持、未来会开发': 'planned',
}

const BACKENDS: { readonly id: string; readonly register: RegisterView; readonly md: string; readonly room: string }[] = [
  { id: 'github', register: GITHUB_CAPABILITY_REGISTER, md: 'docs/tracker/capability-github.md', room: 'src/tracker/rooms/github/room/backend.ts' },
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

/** 定位口表格头用的是缩写（「3 条全部提供」），表身那一列写的是正式档位词；这一处只做这一条映射。 */
const LOCATOR_LABELS: { [label: string]: string } = { 提供: '明确提供功能' }

/** 从一份 md 里切出一节：标题行 `## <title>（…）` 到下一个 `## ` 或文件尾。找不到返回 null。 */
function readMdSection(text: string, title: string): { heading: string; body: string } | null {
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim().startsWith('## ' + title + '（')) continue
    let end = i + 1
    while (end < lines.length && !lines[end].trim().startsWith('## ')) end++
    return { heading: lines[i].trim(), body: lines.slice(i + 1, end).join('\n') }
  }
  return null
}

/**
 * 校验一张能力表的**表头数字**与表身逐项一致：表头说 23 条、表身就得是这 23 行；表头说「22 条明确提供功能」，
 * 表身这一档就得正好 22 行。表头是给人看的总账，最容易与表身脱节（改一条能力忘了改上面那个数），
 * 所以它也要门禁，不能靠人记得。
 *
 * 标题形如：
 *   `## 操作（23 条中：22 条明确提供功能、1 条明确不支持）` —— 分档，右侧按「、」分组成「N 条<标签>」；
 *   `## 定位口（3 条全部提供）` —— 不分档，全体同一档。
 * 返回没对上的那些项（空数组 = 全对上）。`aliases` 只给「全部提供」这类缩写用。
 */
function headingProblems(
  text: string,
  catalog: string[],
  title: string,
  aliases: { [label: string]: string } = {},
): string[] {
  const section = readMdSection(text, title)
  if (!section) return ['找不到「## ' + title + '（…）」这一节']
  const open = section.heading.indexOf('（')
  const close = section.heading.lastIndexOf('）')
  if (open < 0 || close < open) return ['表头没有括注总数：' + section.heading]
  const inner = section.heading.slice(open + 1, close)
  const problems: string[] = []
  let declaredTotal = -1
  let groups: { label: string; count: number }[] = []
  const split = /^(\d+) 条中[：:](.+)$/.exec(inner)
  const all = /^(\d+) 条全部(.+)$/.exec(inner)
  if (split) {
    declaredTotal = Number(split[1])
    // 分档按顿号切，但档位词本身可能带顿号（「当前不支持、未来会开发」）：只在顿号后面跟着「数字 + 条」时才切。
    groups = split[2].split(/、(?=\d+ 条)/).map((part) => {
      const m = /^(\d+) 条(.+)$/.exec(part.trim())
      if (!m) problems.push('表头分档「' + part.trim() + '」读不出条数与标签')
      return m ? { label: m[2].trim(), count: Number(m[1]) } : { label: part.trim(), count: -1 }
    })
  } else if (all) {
    declaredTotal = Number(all[1])
    groups = [{ label: all[2].trim(), count: Number(all[1]) }]
  } else {
    return ['表头读不懂（既不是「N 条中：…」也不是「N 条全部…」）：' + inner]
  }
  const rows = readMdTable(section.body)
  if (declaredTotal !== catalog.length) {
    problems.push('表头总数写 ' + declaredTotal + '，名录里是 ' + catalog.length + ' 条')
  }
  if (rows.length !== catalog.length) {
    problems.push('表里实际 ' + rows.length + ' 行，名录里是 ' + catalog.length + ' 条')
  }
  const actual: { [label: string]: number } = {}
  for (const row of rows) actual[row.label] = (actual[row.label] || 0) + 1
  for (const group of groups) {
    const label = aliases[group.label] || group.label
    const got = actual[label] || 0
    if (group.count !== got) problems.push('表头写「' + group.count + ' 条' + group.label + '」，表身是 ' + got + ' 行')
  }
  const declaredLabels = groups.map((g) => aliases[g.label] || g.label)
  for (const label of Object.keys(actual)) {
    if (!declaredLabels.includes(label)) problems.push('表身有「' + label + '」这一档，表头没列它的条数')
  }
  return problems
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
  const mdText = fs.readFileSync(path.join(ROOT, backend.md), 'utf8')
  const mdRows = readMdTable(mdText)
  const mdNames = mdRows.map((r) => r.name)

  // —— 一、登记数据本身：27 条齐全、与名录同集（类型层已经管住，这里是运行时的第二道）——
  const dataMissing = CATALOG.filter((n) => !dataNames.includes(n))
  const dataExtra = dataNames.filter((n) => !CATALOG.includes(n))
  check(
    dataMissing.length === 0 && dataExtra.length === 0 && dataNames.length === CATALOG.length,
    backend.id + ' 的登记数据 27 条齐全、与名录同集（共 ' + dataNames.length + ' 条；缺 ' +
      (dataMissing.length ? dataMissing.join('、') : NOTHING) + '；多 ' + (dataExtra.length ? dataExtra.join('、') : NOTHING) + '）',
  )

  // —— 二、md 表与数据逐条一致：名字两个方向 + 档位逐行 ——
  const mdMissing = CATALOG.filter((n) => !mdNames.includes(n))
  const mdDuplicate = mdNames.filter((n, i) => mdNames.indexOf(n) !== i)
  const tierMismatch: string[] = []
  const unknownLabel: string[] = []
  for (const row of mdRows) {
    const tier = TIER_OF_LABEL[row.label]
    if (!tier) { unknownLabel.push(row.name + ' → 「' + row.label + '」'); continue }
    if (tier !== backend.register[row.name].tier) {
      tierMismatch.push(row.name + '：表里写「' + row.label + '」，数据里是 ' + backend.register[row.name].tier)
    }
  }
  const mdOk = mdMissing.length === 0 && mdDuplicate.length === 0 && tierMismatch.length === 0 && unknownLabel.length === 0
  check(
    mdOk,
    backend.md + ' 与登记数据逐条一致（' + mdRows.length + ' 行；' +
      (mdMissing.length ? '表里缺：' + mdMissing.join('、') + '；' : '') +
      (mdDuplicate.length ? '表里重复：' + mdDuplicate.join('、') + '；' : '') +
      (tierMismatch.length ? '档位不符：' + tierMismatch.join('；') + '；' : '') +
      (unknownLabel.length ? '不认识的说法：' + unknownLabel.join('；') + '；' : '') +
      (mdOk ? '两处同集、逐行同档位' : '把两边改成同一件事再提交') + '）',
  )

  // —— 三、两张表的表头数字与表身一致（#1456：表头是总账，最容易与表身脱节）——
  const opHeadingProblems = headingProblems(mdText, OPERATIONS, '操作')
  const locHeadingProblems = headingProblems(mdText, LOCATORS, '定位口', LOCATOR_LABELS)
  check(
    opHeadingProblems.length === 0 && locHeadingProblems.length === 0,
    backend.md + ' 两张表的表头数字与表身一致（操作 ' + OPERATIONS.length + ' 条、定位口 ' + LOCATORS.length + ' 条）' +
      (opHeadingProblems.length ? '（操作表头：' + opHeadingProblems.join('；') + '）' : '') +
      (locHeadingProblems.length ? '（定位口表头：' + locHeadingProblems.join('；') + '）' : ''),
  )

  // —— 四、`planned` 必须写清承接票号 ——
  const plannedNoTicket = dataNames.filter((n) => backend.register[n].tier === 'planned' && !String(backend.register[n].ticket || '').trim())
  const planned = dataNames.filter((n) => backend.register[n].tier === 'planned').length
  check(
    plannedNoTicket.length === 0,
    backend.id + ' 的 ' + planned + ' 条「未来会开发」都写了承接票号' +
      (plannedNoTicket.length ? '（没写：' + plannedNoTicket.join('、') + '）' : ''),
  )

  // —— 五、`partial` 必须写清差在哪（`gap`），并且说明这处缺口由谁承接 ——
  // 为什么单独立一条：这一档的全部价值就是「把差在哪写下来」。写不出差在哪，说明这条压根还没审过，
  // 那它就该老老实实是 `provided` 或者 `unsupported-by-design`，不该占着这一档当挡箭牌。
  const partialNoGap = dataNames.filter((n) => backend.register[n].tier === 'partial' && !String(backend.register[n].gap || '').trim())
  const partialNoTicket = dataNames.filter((n) => backend.register[n].tier === 'partial' && !String(backend.register[n].ticket || '').trim())
  const partial = dataNames.filter((n) => backend.register[n].tier === 'partial').length
  check(
    partialNoGap.length === 0 && partialNoTicket.length === 0,
    backend.id + ' 的 ' + partial + ' 条「做了但没做到位」都写清了差在哪、由谁承接' +
      (partialNoGap.length ? '（没写差在哪：' + partialNoGap.join('、') + '）' : '') +
      (partialNoTicket.length ? '（没写承接票：' + partialNoTicket.join('、') + '）' : ''),
  )

  // —— 六、实现面：成员集合由登记推出来，不再手写一份 ——
  const roomText = fs.readFileSync(path.join(ROOT, backend.room), 'utf8')
  check(
    /ProvidedCapability<typeof\s+\w+_CAPABILITY_REGISTER>/.test(roomText),
    backend.room + ' 的成员集合由登记数据推出来（`ProvidedCapability<typeof …>`），没有手写的第二份名单',
  )

  // 概览（不是判定，是给人看的一行账）
  const count = (tier: CapabilityTier) => dataNames.filter((n) => backend.register[n].tier === tier).length
  console.log('  ---- ' + backend.id + '：' + count('provided') + ' 提供 / ' + count('partial') + ' 做了但没做到位 / ' + count('unsupported-by-design') + ' 明确不支持 / ' + count('planned') + ' 未来会开发')
}

// —— 反证：表头数字不是抄的。把真文档里的一处总数改错一位，同一个判据必须抓到（#1456）——
const ghText = fs.readFileSync(path.join(ROOT, 'docs/tracker/capability-github.md'), 'utf8')
const badOpText = ghText.split('23 条明确提供功能').join('22 条明确提供功能')
const badOpHeading = headingProblems(badOpText, OPERATIONS, '操作')
check(
  ghText.indexOf('23 条明确提供功能') >= 0 && badOpHeading.length > 0,
  '反证：把「23 条明确提供功能」改成 22 条之后，表头判据必须抓到它' +
    (badOpHeading.length ? '（抓到：' + badOpHeading.join('；') + '）' : '（没抓到，判据失效）'),
)
const badLocText = ghText.split('3 条全部提供').join('4 条全部提供')
const badLocHeading = headingProblems(badLocText, LOCATORS, '定位口', LOCATOR_LABELS)
check(
  ghText.indexOf('3 条全部提供') >= 0 && badLocHeading.length > 0,
  '反证：把「3 条全部提供」改成 4 条之后，表头判据必须抓到它' +
    (badLocHeading.length ? '（抓到：' + badLocHeading.join('；') + '）' : '（没抓到，判据失效）'),
)

// —— 七、G5：登记数据只许被 `import type` 引用（运行时不读它）——
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
