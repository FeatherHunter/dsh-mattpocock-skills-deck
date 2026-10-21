// tests/verify-pagination-limits.ts —— 分页与额度常量的钉值门禁（#1343 新增）。
//
// 门禁归属: src/tracker/rooms/pagination.ts
//
// 为什么有这扇门禁：
//   三个后端房间原先各自写着同一批「一次问后端要多少条、最多问几次」的数字：同一个 50/200 在 GitHub、
//   GitLab、Markdown 三房各一份，同一个 100/1000 在 GitHub、GitLab 两房各一份。这些数字是后端接口的
//   硬事实，不是给人调的旋钮；飘了不会有人报错，只会表现为「历史少了一段」「列表少了几条」。所以把它们
//   收进 src/tracker/rooms/pagination.ts 一处，再用这扇门禁钉住：
//     · 共享表本身的值必须与下面 EXPECTED 清单逐项相等 —— 改数字必须同时改这份清单，diff 里一次就能
//       看见「哪个数从多少改成多少」，不会被悄悄改掉；
//     · 三个后端房间的源码里不许再出现这些分页额度的裸数字（唯一允许写字面量的地方是共享表本身），
//       防止有人图省事再抄一份同值拷贝，把刚收掉的重复又长回来；
//     · 凡是用了 PAGINATION 的房内文件必须从共享表导入，防止有文件自己造一份局部表来「替代」导入。
//
// 口径说明（什么算「分页额度的裸数字」）：
//   只钉「一次/一页要多少条、最多翻几页、并发几个」这类会决定「拿没拿全」的数字。GraphQL 字段级的投影
//   大小（例如 queries.ts 里 labels(first: 20)、assignees(first: 50)）不是分页额度：它们只决定一次响应里
//   带上多少个标签/指派人，要少了只是显示不全、不影响「还有没有下一页」的判断，所以本门禁有意不钉它们。
//   对应的，本门禁只钉下面这些固定形状的写法（见 RULES）；新出现一种写法时，正确做法是把它收进共享表
//   并把新形状加进 RULES，而不是绕过门禁。
//
// 这扇门禁能红也能绿（#1343 验收要求）：在某个房里临时写回 \`const MAX_PAGES = 10\` 会红，改回共享表取值
// 就绿；把共享表里任何一个数字改掉而不同步下面的 EXPECTED 清单也会红，两边一起改才绿。

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SHARED = 'src/tracker/rooms/pagination.ts'
const ROOMS_DIR = 'src/tracker/rooms'

// 期望值清单：与共享表逐项相等。改共享表的数字必须同时改这里 —— 这是本门禁「改数字的 diff 能被看见」
// 的唯一手段，所以这份清单要写全、写死，不要写成从共享表反推（反推等于没钉）。
const EXPECTED = {
  github: {
    limitDefault: 50,
    limitMax: 200,
    listPageSize: 100,
    restPageSize: 100,
    restMaxPages: 10,
    subIssuesPageSize: 100,
    subIssuesMax: 1000,
    labelListLimit: 1000,
    labelWriteConcurrencyMax: 4,
    labelWriteConcurrencyDefault: 4,
    anchorLookupBodyFetches: 40,
    anchorLookupSearchLimit: 20,
    anchorLookupListLimit: 100,
    depsMax: 50,
  },
  gitlab: {
    limitDefault: 50,
    limitMax: 200,
    maxPerPage: 100,
    subIssuesPageSize: 100,
    subIssuesMax: 1000,
    labelListPerPage: 100,
    labelListMaxPages: 100,
    labelWriteConcurrencyMax: 4,
    labelWriteConcurrencyDefault: 4,
    anchorLookupScanLimit: 100,
  },
  markdown: {
    limitDefault: 50,
    limitMax: 200,
  },
} as const

// 源码里不许再出现的分页额度写法。每条都是「把数字写死在调用点」的典型形状，注释里已剥掉注释再匹配，
// 所以写注释解释这些数不算违规。
const RULES: { id: string; re: RegExp; message: string }[] = [
  {
    id: 'named-constant',
    re: /\b(DEFAULT_LIMIT|MAX_LIMIT|MAX_PER_PAGE|PAGE_SIZE|PAGE|MAX_PAGES|MAX_SUB_ISSUES|LABEL_LIST_LIMIT|LABEL_LIST_PER_PAGE|LABEL_LIST_MAX_PAGES|WRITE_CONCURRENCY_MAX|WRITE_CONCURRENCY_DEFAULT|DEPS_MAX|MAX_BODY_FETCHES|LIST_LIMIT|SCAN_LIMIT)\s*(?::[^=\n]+)?=\s*\d+/,
    message: '分页/额度常量直接写了数字，应改为从 PAGINATION 取值',
  },
  {
    id: 'named-constant-suffix',
    re: /\b[A-Z][A-Z0-9_]*(?:PAGE_SIZE|PER_PAGE|MAX_PAGES|_LIMIT|_FETCHES|CONCURRENCY(?:_MAX|_DEFAULT)?)\s*=\s*\d+/,
    message: '名字里带 PAGE_SIZE / PER_PAGE / MAX_PAGES / LIMIT 之类的常量直接写了数字，应改为从 PAGINATION 取值',
  },
  { id: 'per-page-digits', re: /per_page=\d+/, message: 'per_page 直接写了数字，应改为从 PAGINATION 取值并拼进 URL' },
  { id: 'per-page-template', re: /per_page=\$\{\d+\}/, message: 'per_page 的模板串里直接写了数字，应改为引用 PAGINATION' },
  { id: 'per-page-concat', re: /per_page='\s*\+\s*\d+/, message: 'per_page 拼接时直接写了数字，应改为引用 PAGINATION' },
  { id: 'first-arg-digits', re: /first=\d+/, message: 'first= 后直接写了数字，应改为引用 PAGINATION' },
  { id: 'first-arg-template', re: /first=\$\{\d+\}/, message: 'first 的模板串里直接写了数字，应改为引用 PAGINATION' },
  { id: 'limit-flag-digits', re: /--limit['"`]?\s*,\s*['"`]\d+['"`]/, message: '命令行 --limit 后直接写了数字，应改为引用 PAGINATION' },
  { id: 'first-graphql-template', re: /first:\$\{\d+\}/, message: 'GraphQL first: 的模板串里直接写了数字，应改为引用 PAGINATION' },
]

type Failure = { path: string; key: string; expected?: unknown; actual?: unknown; note?: string }
const failures: Failure[] = []
let checks = 0

function check(ok: boolean, okMessage: string, failure?: Failure): void {
  checks += 1
  if (ok) {
    console.log(`  ✓ ${okMessage}`)
    return
  }
  console.log(`  ✗ ${failure?.path ? failure.path + '：' : ''}${failure?.note ?? okMessage}`)
  failures.push(failure ?? { path: '', key: okMessage, note: okMessage })
}

// 逐项深比：多一个键、少一个键、值不相等都算差异，并报出能直读的差异路径（如 github.restMaxPages）。
function diffObject(prefix: string, actual: unknown, expected: unknown, out: string[]): void {
  const actualIsObject = typeof actual === 'object' && actual !== null && !Array.isArray(actual)
  const expectedIsObject = typeof expected === 'object' && expected !== null && !Array.isArray(expected)
  if (expectedIsObject) {
    if (!actualIsObject) {
      out.push(`${prefix}：共享表里这一组不存在或不是对象（实际是 ${JSON.stringify(actual)}）`)
      return
    }
    const a = actual as Record<string, unknown>
    const e = expected as Record<string, unknown>
    for (const key of Object.keys(e)) {
      if (!(key in a)) {
        out.push(`${prefix}${prefix ? '.' : ''}${key}：共享表缺少这一项（期望 ${JSON.stringify(e[key])}）`)
        continue
      }
      diffObject(`${prefix}${prefix ? '.' : ''}${key}`, a[key], e[key], out)
    }
    for (const key of Object.keys(a)) {
      if (!(key in e)) out.push(`${prefix}${prefix ? '.' : ''}${key}：共享表多出这一项（期望清单里没有）`)
    }
    return
  }
  if (actual !== expected) out.push(`${prefix}：期望 ${JSON.stringify(expected)}，共享表实际 ${JSON.stringify(actual)}`)
}

function relOf(abs: string): string {
  return path.relative(ROOT, abs).split(path.sep).join('/')
}

function collectFiles(dir: string, out: string[]): void {
  if (!fs.existsSync(dir)) return
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      collectFiles(abs, out)
      continue
    }
    if (/.(ts|mts|tsx)$/.test(entry.name) && !/\.d\.ts$/.test(entry.name)) out.push(abs)
  }
}

// 剥掉行内注释（引号里的 // 不算注释，http:// 也不算），返回可匹配的代码部分。
function stripLineComment(line: string): string {
  let quote: string | null = null
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (quote) {
      if (ch === '\\') {
        i += 1
        continue
      }
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch
      continue
    }
    if (ch === '/' && line[i + 1] === '/' && line[i - 1] !== ':') return line.slice(0, i)
  }
  return line
}

function isCommentOnly(line: string): boolean {
  const t = line.trim()
  return t === '' || t.startsWith('//') || t.startsWith('/*') || t.startsWith('*') || t.startsWith('*/')
}

console.log('分页与额度常量门禁（#1343）')

// 第一节：共享表与期望值清单逐项相等（改数字必须同时改门禁，diff 可见）。
const sharedModule = (await import('../src/tracker/rooms/pagination.js')) as { PAGINATION: unknown }
const actualTable = sharedModule.PAGINATION
const tableDiffs: string[] = []
diffObject('', actualTable, EXPECTED, tableDiffs)
check(
  tableDiffs.length === 0,
  '共享表 src/tracker/rooms/pagination.ts 与门禁期望值清单逐项相等',
  tableDiffs.length === 0
    ? undefined
    : {
        path: SHARED,
        key: 'shared-table-diff',
        note:
          '共享表与期望值清单不一致：改共享表的数字必须同时改 tests/verify-pagination-limits.ts 的 EXPECTED，让这次改动在 diff 里看得见。差异：\n    ' +
          tableDiffs.join('\n    '),
      },
)
if (tableDiffs.length > 0) for (const d of tableDiffs) console.log(`      差异：${d}`)

// 第二节：除共享表外，三个后端房间的源码里不再出现分页额度的裸数字。
const roomFiles: string[] = []
collectFiles(path.join(ROOT, ROOMS_DIR), roomFiles)
const scanned = roomFiles
  .map(relOf)
  .filter((rel) => rel !== SHARED)
  .sort()
const offenders: string[] = []
for (const rel of scanned) {
  const lines = fs.readFileSync(path.join(ROOT, rel), 'utf8').split(/\r?\n/)
  for (let i = 0; i < lines.length; i += 1) {
    if (isCommentOnly(lines[i])) continue
    const code = stripLineComment(lines[i])
    for (const rule of RULES) {
      if (!rule.re.test(code)) continue
      // 同一行只报第一条命中的规则：同一个裸数字常同时命中「具名常量」与「后缀形状」两条，报两遍只会让人多读一遍。
      offenders.push(`${rel}:${i + 1}: ${lines[i].trim()}（${rule.id}：${rule.message}）`)
      break
    }
  }
}
check(
  offenders.length === 0,
  `除共享表外没有分页额度裸数字（扫了 ${scanned.length} 个房内文件）`,
  offenders.length === 0
    ? undefined
    : { path: '', key: 'bare-numbers', note: `发现 ${offenders.length} 处分页额度裸数字，应改为从 PAGINATION 取值：\n    ` + offenders.join('\n    ') },
)
if (offenders.length > 0) for (const o of offenders) console.log(`      ${o}`)

// 第三节：用了 PAGINATION 的房内文件必须从共享表导入（防止自己造一份局部表来替代导入）。
const importHits: string[] = []
for (const rel of scanned) {
  const text = fs.readFileSync(path.join(ROOT, rel), 'utf8')
  if (!text.includes('PAGINATION')) continue
  if (!/from ['"](?:\.{1,2}\/)+pagination\.js['"]/.test(text)) importHits.push(rel)
}
check(importHits.length === 0, '用了 PAGINATION 的房内文件都从共享表导入', importHits.length === 0 ? undefined : { path: importHits.join('、'), key: 'import', note: `这些文件用了 PAGINATION 却没有从 pagination.js 导入：${importHits.join('、')}` })

// 第四节：共享表文件存在，且三个后端分组一个都不少（分组少了会让某一房静默退回「没页面大小」的默认值）。
check(fs.existsSync(path.join(ROOT, SHARED)), `共享表文件存在：${SHARED}`, { path: SHARED, key: 'exists', note: '共享表文件不存在' })
const groups = typeof actualTable === 'object' && actualTable !== null ? Object.keys(actualTable as Record<string, unknown>).sort() : []
check(
  groups.join(',') === 'github,gitlab,markdown',
  '共享表按三个后端分组：github、gitlab、markdown',
  groups.join(',') === 'github,gitlab,markdown' ? undefined : { path: SHARED, key: 'groups', note: `共享表的分组是 ${groups.join(',') || '(空)'}，期望 github,gitlab,markdown` },
)

console.log('')
if (failures.length > 0) {
  console.log(`✗ 分页与额度常量门禁失败：${failures.length} 项（共 ${checks} 项检查）`)
  process.exitCode = 1
} else {
  console.log(`✓ 分页与额度常量门禁通过：${checks} 项检查`)
}
