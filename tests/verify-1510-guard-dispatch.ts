// verify-1510-guard-dispatch.ts —— 远端四段判据「按票形分派」这一小段的门禁（#1510 门禁收口，父规格 #1506）。
// 门禁归属: src/tracker/rooms/markdown/template-guard.ts
// 门禁归属: src/tracker/rooms/markdown/create-render.ts
//
// 为什么要单独一扇：
//   #1507 与 #1509 的门禁都是「真建一张票 / 真改一张票」，主路径已经钉死；但它们只走了
//   普通票与地图子票，模板判据里「哪些形状受管、哪些形状豁免」的分派没有被任何门禁看着。
//   具体三处缝隙：
//     ① 实施票（spec-ticket）与缺陷票（bug）也必须被拒——有人把这两种从受管清单里删掉，
//        verify-1507 / verify-1509 都不会红；
//     ② 规格（spec）与地图（map）是容器，必须不被这条判据挡——有人把容器加进受管清单，
//        也没有门禁会红；
//     ③ 整份改写按盘上形状挑文案（容器 / 地图子票 / 其余票）与「数组形态的 Blocked by
//        带井号也去井号」这两条，也没有门禁直接钉住。
//   本文件只补这三处，直接喂纯函数，不碰磁盘、不重复建票流程；主路径的端到端证据仍在
//   verify-1507-create-strict.ts 与 verify-1509-update-strict.ts 里，不要搬过来。
//
// 规则被改回去时谁会红：
//   - 改 template-guard.ts 的受管清单或分派分支 → 本文件的 ①② 两组断言会红，信息里点名
//     是哪种形状、哪条规则；
//   - 改 create-render.ts 的 blockedKeysOf 去井号逻辑 → 本文件的 ③ 断言会红。
//
// 跑法：node --import ./scripts/ts-hook.mts tests/verify-1510-guard-dispatch.ts

import { remoteTemplateRefusalFor, remoteTemplateRefusalForLocalFile, remoteTemplateSections } from '../src/tracker/rooms/markdown/template-guard.ts'
import { blockedKeysOf } from '../src/tracker/rooms/markdown/create-render.ts'
import type { OriginalKind } from '../src/tracker/rooms/markdown/create-render.ts'

let checks = 0
const failures: string[] = []

function check(ok: boolean, message: string): void {
  checks += 1
  console.log((ok ? '  PASS ' : '  FAIL ') + message)
  if (!ok) failures.push(message)
}

/** 人从远端复制过来的整段正文：四段齐全，段名按远端原文的大小写写一次。 */
const REMOTE_FOUR = [
  '## Parent',
  '',
  '#123',
  '',
  '## What to build',
  '',
  '把这件事做出来。',
  '',
  '## Acceptance criteria',
  '',
  '- [ ] 做完了',
  '',
  '## Blocked by',
  '',
  '- #120',
  '',
].join('\n')

function main(): void {
  // ── 判据自证：先确认这四段真的能被认出来，后面「被拒」才不是空转 ──
  const sections = remoteTemplateSections(REMOTE_FOUR)
  check(
    sections.length === 4 && sections[0] === 'Parent' && sections[3] === 'Blocked by',
    '判据自证：remoteTemplateSections 认出全部四段（按出现顺序）——判据失效时后面每条都会跟着红',
  )

  // ── ① 新建时，四种票形的受管清单 ──
  // 每条信息都点名票形与「改回去会怎样」，门禁红时不用再翻实现猜是哪条规则。
  const guarded: ReadonlyArray<[OriginalKind, string]> = [
    ['spec-ticket', '① 实施票（spec-ticket）带远端四段必须被拒'],
    ['issue', '① 普通票（issue）带远端四段必须被拒'],
    ['bug', '① 缺陷票（bug）带远端四段必须被拒'],
    ['map-ticket', '① 地图子票（map-ticket）带远端四段必须被拒'],
  ]
  for (const [kind, rule] of guarded) {
    const message = remoteTemplateRefusalFor(kind, sections)
    check(message !== '', rule + '——把 ' + kind + ' 从 template-guard 的受管清单里删掉，这条会红')
    check(
      message.indexOf('## Parent') >= 0 && message.indexOf('## Blocked by') >= 0,
      rule + '：拒绝语点名正文里的远端段落（人拿报错能直接对照自己的正文）',
    )
  }

  // ── ① 容器的豁免（负控）：规格与地图不走这条判据 ──
  const containers: readonly OriginalKind[] = ['spec', 'map']
  for (const kind of containers) {
    check(
      remoteTemplateRefusalFor(kind, sections) === '',
      '① 容器（' + kind + '）不受这条判据管——把 ' + kind + ' 加进受管清单，这条会红',
    )
  }

  // ── ① 拒绝语给的本地模板要对得上票形 ──
  const ticketText = remoteTemplateRefusalFor('spec-ticket', sections)
  check(
    ticketText.indexOf('**What to build:**') >= 0 && ticketText.indexOf('**Status:**') >= 0,
    '① 实施票的拒绝语给的是本地票模板（**What to build:** / **Status:**）',
  )
  const childText = remoteTemplateRefusalFor('map-ticket', sections)
  check(
    childText.indexOf('## Question') >= 0 && childText.indexOf('Type:') >= 0,
    '① 地图子票的拒绝语给的是本地问句模板（## Question 与 Type: 行）',
  )
  check(
    childText.indexOf('**What to build:**') < 0,
    '① 地图子票不照搬实施票的字段模板——给错模板会把人引到另一种落盘形状',
  )

  // ── ② 整份改写按盘上形状分派 ──
  check(
    remoteTemplateRefusalForLocalFile('spec', 'impl-ticket', sections) === '',
    '② 改写：盘上是规格容器（spec）时豁免——把容器分支改成受管，这条会红',
  )
  check(
    remoteTemplateRefusalForLocalFile('map', 'map-ticket', sections) === '',
    '② 改写：盘上是地图容器（map）时豁免——把容器分支改成受管，这条会红',
  )
  check(
    remoteTemplateRefusalForLocalFile(null, 'map-ticket', sections).indexOf('## Question') >= 0,
    '② 改写：地图子票用问句模板——分派写错成普通票模板，这条会红',
  )
  check(
    remoteTemplateRefusalForLocalFile(null, 'impl-ticket', sections).indexOf('**What to build:**') >= 0,
    '② 改写：实施票用本地票模板',
  )
  check(
    remoteTemplateRefusalForLocalFile(null, 'legacy', sections).indexOf('**What to build:**') >= 0,
    '② 改写：旧布局票也引到同一套本地模板（这里不猜兼容，重写正好引到现在这一套）',
  )
  check(
    remoteTemplateRefusalForLocalFile(null, 'impl-ticket', []) === '',
    '② 没有违规段落时不拒绝——判据不能把正常改写也挡掉',
  )

  // ── ③ 新建时 Blocked by 写了井号：数组形态与正文行同一口径 ──
  // verify-1507 只喂过不带井号的数组与带井号的正文行；带井号的数组是另一条入口。
  const fromArray = blockedKeysOf({ title: '示例票', blockedBy: ['#5', '#10'] })
  check(
    fromArray.length === 2 && fromArray[0] === '05' && fromArray[1] === '10',
    '③ 数组形态的 Blocked by 带井号也去井号、纯数字补足两位——删掉 replace(/^#/, \'\') 或补号，这条会红（实际 ' + JSON.stringify(fromArray) + '）',
  )

  // ── 汇总 ──
  console.log('')
  if (failures.length) {
    console.log('verify-1510-guard-dispatch: ' + failures.length + ' 条没过（共 ' + checks + ' 条）')
    for (const line of failures) console.log('  - ' + line)
    process.exitCode = 1
    return
  }
  console.log('verify-1510-guard-dispatch: 全过（共 ' + checks + ' 条）')
}

main()
