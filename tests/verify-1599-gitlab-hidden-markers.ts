/**
 * tests/verify-1599-gitlab-hidden-markers.ts —— GitLab 房文件头隐藏标记（#1599）。
 *
 * 票面给的验收，本文件在单元层一条一条钉住（纯函数，不联网、不调 glab）：
 *   ① 归属读：隐藏标记优先，没有才回退认旧 Part of 行；
 *   ② 正文中间手写的 Part of #99 不影响归属（文件头口径）；
 *   ③ 写一次：重复行清干净、旧 Part of 行置换成隐藏行、不新增可见行；
 *   ④ 挂/拆位置：幂等锚之后、其余正文之前；
 *   ⑤ 阻塞成对写：可见行与机器表一次写齐，读侧隐藏优先，空集拆干净。
 *
 * 真机三步（挂、改挂、取消各一次）要 glab 登录与可写的远端仓，门禁里做不了，
 * 步骤写在 #1599 票面“真机沙箱”一节，由人或有凭证的会话按票面执行。
 *
 * 运行：node --import ./scripts/ts-hook.mts tests/verify-1599-gitlab-hidden-markers.ts
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  normalizeIssue,
  parseHiddenParent,
  parseLegacyPartOf,
  parseHiddenBlockedBy,
  parseBlockedByFallback,
  rewriteDescriptionWithHiddenParent,
  rewriteDescriptionWithBlockedPair,
} from '../src/tracker/rooms/gitlab/normalize.ts'
import { planGates } from '../scripts/lib/discover-gates.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

let failed = false
const check = (ok: boolean, msg: string) => {
  console.log((ok ? '  PASS ' : '  FAIL ') + msg)
  if (!ok) failed = true
}

const parentOf = (description: string): string | null =>
  normalizeIssue({ iid: 1, description }).parentKey
const blockedKeysOf = (description: string): string[] =>
  normalizeIssue({ iid: 1, description }).blockedBy.map((b) => b.key)

// ── ① 隐藏优先，旧行回退 ──
check(parseHiddenParent('<!-- DSH-PARENT: 7 -->\n\n正文') === '7', '隐藏标记读得出地图号')
check(
  parentOf('<!-- DSH-PARENT: 7 -->\nPart of #5\n\n正文') === '7',
  '隐藏与旧行并存时隐藏赢',
)
check(parentOf('Part of #5\n\n正文') === '5', '只有旧行时回退认（存量票双读可用）')

// ── ② 正文中间的不算 ──
check(
  parentOf('# 标题\n\n举例：\nPart of #99\n\n正文') === null,
  '正文中间手写的 Part of #99 不影响归属',
)
check(
  parseHiddenParent('# 标题\n\n<!-- DSH-PARENT: 99 -->\n') === null,
  '正文中间的隐藏标记不算归属',
)
check(
  parseLegacyPartOf('# 标题\n\nPart of #99\n') === null,
  '旧行回退认同样只认文件头',
)

// ── ③ 写一次清干净并迁移 ──
{
  const dirty = '<!-- DSH-PARENT: 3 -->\nPart of #5\n<!-- DSH-PARENT: 3 -->\n\n正文还在'
  const out = rewriteDescriptionWithHiddenParent(dirty, '7')
  const hiddenCount = out.split('\n').filter((l) => l.trim() === '<!-- DSH-PARENT: 7 -->').length
  check(hiddenCount === 1, '重复行一次清干净（实得 ' + hiddenCount + ' 行）')
  check(out.indexOf('Part of') < 0, '旧 Part of 行写时置换掉')
  check(out.indexOf('正文还在') >= 0, '其余正文一个字不动')
}
check(
  rewriteDescriptionWithHiddenParent('Part of #5\n\n正文', '5') === '<!-- DSH-PARENT: 5 -->\n正文',
  '存量旧行写一次后只剩隐藏行',
)
{
  const out = rewriteDescriptionWithHiddenParent('<!-- DSH-PARENT: 5 -->\n\n正文', null)
  check(out === '正文', '拆归属时只删行（实得 ' + JSON.stringify(out) + '）')
}

// ── ④ 锚之后、正文之前 ──
check(
  rewriteDescriptionWithHiddenParent('<!-- DSH-IDEMPOTENCY-KEY: k1 -->\n\n正文', '5') ===
    '<!-- DSH-IDEMPOTENCY-KEY: k1 -->\n<!-- DSH-PARENT: 5 -->\n\n正文',
  '归属行插在幂等锚之后',
)

// ── ⑤ 阻塞成对 ──
check(
  rewriteDescriptionWithBlockedPair('', ['12', '13']) ===
    'Blocked by: #12, #13\n<!-- DSH-BLOCKED-BY: 12, 13 -->',
  '空正文写阻塞一次写齐两行',
)
{
  const body = rewriteDescriptionWithBlockedPair('# 标题\n\n正文', ['12'])
  check(
    body === '# 标题\n\n正文' || body.indexOf('Blocked by: #12') >= 0,
    '标题后写阻塞不破坏正文',
  )
  check(
    parseBlockedByFallback(body) !== null && parseBlockedByFallback(body)!.join(',') === '12',
    '写下的阻塞读得回来',
  )
  check(
    blockedKeysOf(body).join(',') === '12',
    '归一读阻塞走机器表（实得 ' + blockedKeysOf(body).join(',') + '）',
  )
}
check(
  parseBlockedByFallback('Blocked by: #99\n<!-- DSH-BLOCKED-BY: 12 -->')!.join(',') === '12',
  '两行不一致时机器表赢',
)
check(
  JSON.stringify(parseHiddenBlockedBy('<!-- DSH-BLOCKED-BY: -->\n正文')) === '[]',
  '空机器表读成空集（不是缺失）',
)
check(
  parseBlockedByFallback('<!-- DSH-BLOCKED-BY: abc, 12 -->')!.join(',') === '12',
  '机器表里非数字忽略',
)
{
  const body = 'Blocked by: #12\n<!-- DSH-BLOCKED-BY: 12 -->\n\n正文'
  const out = rewriteDescriptionWithBlockedPair(body, [])
  check(out === '正文', '空集拆掉两处（实得 ' + JSON.stringify(out) + '）')
}

// ── 本文件必须在 verify 链里（不挂进链就等于没跑；#1125 起问规划函数）──
{
  const mine = planGates(ROOT).filter((s) => s.file.indexOf('verify-1599-gitlab-hidden-markers') >= 0)
  check(mine.length === 1, '本门禁挂在 verify 链里且只挂一次（实得 ' + mine.length + ' 次）')
}

console.log('\nverify-1599-gitlab-hidden-markers: ' + (failed ? '有失败项' : '全部通过'))
if (failed) process.exit(1)
console.log('GITLAB HIDDEN MARKERS OK')
