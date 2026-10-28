/**
 * tests/verify-1182-docs-paths.ts —— 两份接入文档里的路径与条数不许再落后于代码（#1182 第 5 件）。
 *
 * 为什么要这一条：`tests/tracker-contract/README.md` 与 `ONBOARDING.md` 是新人接一个新后端的第一份路标，
 * 但目录归位（`src/host/tracker/backends/` → `src/tracker/rooms/`）与契约扩容（13 条操作 → 22 条操作 → 规格 1439 起 23 条操作 → 规格 1602 起 24 条操作）
 * 之后，这两份文档一直写着旧路径与旧条数：#1174 的收尾评论把这两笔列为「留给下一张票」。
 * 旧路标比没有路标更贵 —— 照它去找目录，得到的是「这个目录不存在」，而不是「文档过时了」。
 *
 * 这道门禁断四件事：
 *   一、**真源**：契约名录（`src/tracker/contract/operations-catalog.ts`）今天就是 24 条操作 + 3 条定位口。
 *   二、**条数**：两份文档里凡是写「N 条操作」/「N ops」的地方，N 必须等于名录里的操作条数（今天 24）。
 *   三、**旧目录**：两份文档里不许再出现 `src/host/tracker/backends` 这个搬家前的目录字面量。
 *   四、**路径可落地**：两份文档里反引号包起来的 `src/...` 路径（带 `*` 或 `<id>` 这类占位的不算）
 *       都必须在盘上真的存在 —— 守的是「文档又被人搬家甩下」。
 *
 * 运行：node --import ./scripts/ts-hook.mts tests/verify-1182-docs-paths.ts
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { OPERATIONS, LOCATORS } from '../src/tracker/contract/operations-catalog.ts'

const ROOT = process.cwd()
const DOCS = ['tests/tracker-contract/README.md', 'tests/tracker-contract/ONBOARDING.md']

let failed = false
const check = (ok: boolean, msg: string) => {
  console.log((ok ? '  PASS ' : '  FAIL ') + msg)
  if (!ok) failed = true
}

console.log('== 一、真源：契约名录今天的条数 ==')
check(OPERATIONS.length === 24, '契约名录里操作是 24 条 → 实得 ' + OPERATIONS.length + ' 条')
check(LOCATORS.length === 3, '契约名录里定位口是 3 条 → 实得 ' + LOCATORS.length + ' 条')

console.log('== 二、两份文档里写的操作条数要跟真源一致 ==')
for (const rel of DOCS) {
  const text = fs.readFileSync(path.join(ROOT, rel), 'utf8')
  const hits: string[] = []
  // 抓「22 条操作」「22 条契约操作」「13 ops」「13 `OpName`」这类写法里的数字。
  const re = /(\d+)\s*(?:条\s*(?:契约)?操作|ops|`OpName`)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) hits.push(m[0])
  check(hits.length > 0, rel + '：文档里写到了操作条数（至少一处）→ 实得 ' + hits.length + ' 处')
  const wrong = hits.filter((h) => Number(/(\d+)/.exec(h)![1]) !== OPERATIONS.length)
  check(wrong.length === 0, rel + '：写出的条数与真源一致（都是 ' + OPERATIONS.length + ' 条）→ 对不上的写法 ' + JSON.stringify(wrong))
  check(text.indexOf('src/host/tracker/backends') < 0, rel + '：不再出现搬家前的目录字面量 src/host/tracker/backends')

  // 文档里那张逐条列名的操作清单（紧跟在「…条操作…」之后的第一段代码块）要跟名录逐条一致。
  const block = /条操作[\s\S]{0,200}?```([\s\S]*?)```/.exec(text)
  if (block) {
    const named = block[1].split(/[,\s]+/).filter(Boolean)
    const missing = OPERATIONS.filter((op) => named.indexOf(op) < 0)
    const extra = named.filter((op) => (OPERATIONS as readonly string[]).indexOf(op) < 0)
    check(missing.length === 0 && extra.length === 0 && named.length === OPERATIONS.length,
      rel + '：逐条列名的操作清单与名录一致 → 少列 ' + JSON.stringify(missing) + '、多列 ' + JSON.stringify(extra) + '、共 ' + named.length + ' 条')
  }
}

console.log('== 三、文档里反引号写出的 src 路径都要在盘上存在 ==')
for (const rel of DOCS) {
  const text = fs.readFileSync(path.join(ROOT, rel), 'utf8')
  const missing: string[] = []
  let count = 0
  const re = /`(src\/[^`]+)`/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const p = m[1]
    // 带通配符或 <id>/<backendId> 这类占位的写法不是一条具体路径，跳过。
    if (/[*<>]/.test(p)) continue
    count += 1
    if (!fs.existsSync(path.join(ROOT, p.replace(/\//g, path.sep)))) missing.push(p)
  }
  check(count > 0, rel + '：文档里点名了具体 src 路径 → 实得 ' + count + ' 条')
  check(missing.length === 0, rel + '：点名的 src 路径都在盘上 → 找不到的 ' + JSON.stringify(missing))
}

console.log(failed ? '\n存在失败 — verify-1182-docs-paths 未通过' : '\n全部通过 — 两份接入文档的路径与条数跟得上今天的代码')
process.exit(failed ? 1 : 0)
