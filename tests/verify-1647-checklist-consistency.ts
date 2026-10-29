// tests/verify-1647-checklist-consistency.ts —— #1647 清单票预检一致性判据门禁。
//
// 为什么要有这一条：预检脚本从「恰好一张且已关闭」扩到「记录内部一致」以后，判据本身
// 也是代码，也会看错行、数错数。这里用离线夹具把两条红线钉住：自洽的记录必须判绿
// （含「收口评论只写模板要求的一行计数」这种最简写法）；正文缺行、正文计数不一致、
// 编号集合不同、正文有行但评论里没有场景块这几种真出现过的问题必须逐条判红，
// 并说清是哪一处、两边分别是什么。
//
// 夹具是 JSON：{ name, body, comments: [{ body, createdAt }], expect }。不读网络、不跑 gh。
// 夹具按目录里实际存在的 *.json 跑；下面 REQUIRED_FIXTURES 只钉住「至少要有哪几份」，
// 以后新增夹具不用改名单，删掉必备夹具会在这里红。
// 门禁归属: scripts/lib/checklist-consistency.mts
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  checkChecklistConsistency,
  formatConsistencyFindings,
} from '../scripts/lib/checklist-consistency.mts'

const FIXTURE_DIR = fileURLToPath(new URL('./fixtures/1647/', import.meta.url))
// 夹具按目录里实际存在的 *.json 跑：以后多放一份夹具不用再改这份名单，避免「加了夹具却没被跑」。
const FIXTURE_NAMES = fs
  .readdirSync(FIXTURE_DIR)
  .filter((name) => name.endsWith('.json'))
  .map((name) => name.slice(0, -'.json'.length))
  .sort()
// 必备夹具：票面要求的三条红路径、全绿路径，以及 #1647 实现里补的三份（模板收口写法、缺场景块、作废行）。
const REQUIRED_FIXTURES = [
  'green',
  'green-template-closing',
  'green-with-void',
  'red-body-missing-row',
  'red-count-mismatch',
  'red-id-set-diff',
  'red-missing-block',
]
for (const required of REQUIRED_FIXTURES) {
  if (!FIXTURE_NAMES.includes(required)) throw new Error('缺少必备夹具：' + required + '.json（目录：' + FIXTURE_DIR + '）')
}

type FixtureExpect = {
  ok: boolean
  codes?: string[]
  messageIncludes?: string[]
}
type Fixture = {
  name: string
  body: string
  comments: { body: string; createdAt: string }[]
  expect: FixtureExpect
}

let failed = false
let total = 0
const check = (ok: boolean, msg: string): void => {
  total += 1
  if (!ok) failed = true
  console.log((ok ? '  PASS ' : '  FAIL ') + msg)
}

console.log('清单票预检一致性判据门禁（#1647）')

for (const fixtureName of FIXTURE_NAMES) {
  const filePath = path.join(FIXTURE_DIR, fixtureName + '.json')
  const fixture = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Fixture
  const report = checkChecklistConsistency({ body: fixture.body, comments: fixture.comments })
  const where = fixture.name || fixtureName

  check(report.ok === fixture.expect.ok, where + '：整体判据结果与夹具期望一致（期望 ' + (fixture.expect.ok ? '绿' : '红') + '，实际 ' + (report.ok ? '绿' : '红') + '）')

  const actualCodes = report.findings.map((finding) => finding.code)
  for (const code of fixture.expect.codes || []) {
    check(actualCodes.includes(code), where + '：报出了「' + code + '」（实际：' + (actualCodes.join('、') || '无') + '）')
  }

  if (fixture.expect.messageIncludes) {
    const hit = (fixture.expect.messageIncludes || []).every((piece) =>
      report.findings.some((finding) => finding.message.includes(piece)),
    )
    check(hit, where + '：说明里写出了两边的事实（' + fixture.expect.messageIncludes.join(' 与 ') + '）')
  }

  const lines = formatConsistencyFindings(report)
  check(lines.length === report.findings.length, where + '：每条判据都有一行给人读的说明（' + lines.length + ' 行 / ' + report.findings.length + ' 条）')
  check(
    lines.every((line) => line.includes('改法：')),
    where + '：每条说明都带「改法：」，读票的人知道下一步改哪里',
  )
}

// 票的「做完」还要求：正文缺总览表、评论缺场景块时给出明确修复指引，而不是泛泛报错。
// 这两种情况没有单独的夹具文件（就是一份空记录），在门禁里直接构造最小输入。
const noOverview = checkChecklistConsistency({ body: '## 规则', comments: [] })
check(
  noOverview.findings.some((finding) => finding.code === 'missing-overview' && finding.fix.includes('场景总览')),
  '正文缺「## 场景总览」时，说明里指出按模板补回哪一节（missing-overview）',
)
const miniBody = [
  '## 场景总览',
  '',
  '| 场景编号 | 来源票 | 一句话 | 状态 | 备注 |',
  '| --- | --- | --- | --- | --- |',
  '| 2101-01 | #2101 | 打开面板 | 通过 |  |',
].join('\n')
const noBlock = checkChecklistConsistency({ body: miniBody, comments: [] })
check(
  noBlock.findings.some((finding) => finding.code === 'missing-scenario-block' && finding.fix.includes('场景块')),
  '评论里没有场景块时，说明里指出要按「## 场景块」写（missing-scenario-block）',
)

if (failed) {
  console.log('\n存在失败（共 ' + total + ' 项）')
  process.exit(1)
}
console.log('\n全部通过 · 清单票预检一致性判据门禁（#1647，共 ' + total + ' 项）')
