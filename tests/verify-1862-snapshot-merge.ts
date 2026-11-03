/**
 * tests/verify-1862-snapshot-merge.ts —— 工作区快照库的三态合并、版本门与构建登记（#1862）
 *
 * 守什么：完整、截断、未知这三种知识状态决定「能不能覆盖旧值」，这套判断必须是纯函数、
 * 可单独验证，不能埋在 SQL 里。规格第 4 节给的口径是：
 *   - complete：整组替换；空数组 / null 表示确认没有，可以清空旧值；
 *   - truncated：只补旧组里缺的，已经有的值一个都不删；
 *   - unknown / 本批没表达的组：只盖章，不动值。
 * 版本门同理：只有「本批实际表达的组」在库里的 written_version 大于起点才整批丢弃，
 * 没表达的组不参与，否则只写标签的一批会被只写正文的另一批误伤。
 *
 * 这一扇只跑纯函数与文本登记，不碰 SQLite；真库路径由 verify-1862-snapshot-database.ts 守。
 * 为什么还要在这里断言构建登记：新树漏登记 tsconfig / build.mts 会静默不编译，
 * 这类缺口在运行时门禁里看不出来，只能从文本上锁住。
 *
 * 运行：node --import ./scripts/ts-hook.mts tests/verify-1862-snapshot-merge.ts
 */
// 门禁归属: src/workspace-snapshot

import { readFileSync } from 'node:fs'
import * as path from 'node:path'
import { printGateResult } from './lib/gate-result.ts'
import { decideCollectionMerge } from '../src/workspace-snapshot/merge/collection.ts'
import { decideRowMerge } from '../src/workspace-snapshot/merge/row.ts'
import {
  normalizeStartMergeVersion,
  shouldDiscardBatch,
} from '../src/workspace-snapshot/merge/version-gate.ts'
import { openWorkspaceSnapshot } from '../src/workspace-snapshot/contract/index.ts'
import type { IssueRowValue, SnapshotLabel } from '../src/workspace-snapshot/model/types.ts'
import type { GroupWrite } from '../src/workspace-snapshot/contract/types.ts'

const GATE = 'verify-1862-snapshot-merge'
const ROOT = process.cwd()
let total = 0
let failed = 0

function check(cond: unknown, message: string, detail?: unknown): void {
  total += 1
  if (cond) {
    console.log('PASS ' + message)
    return
  }
  failed += 1
  console.log('FAIL ' + message + (detail === undefined ? '' : '（实得 ' + JSON.stringify(detail) + '）'))
}

function srcText(rel: string): string {
  return readFileSync(path.join(ROOT, rel), 'utf8')
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function main(): void {
  // ---- 一、row 组：三态各走一条完全不同的写动作 ----
  const existingRow: IssueRowValue = { title: '旧标题', state: 'open', url: null }

  const replaced = decideRowMerge(existingRow, {
    completeness: 'complete',
    value: { title: '新标题', state: 'closed' },
  })
  check(
    replaced.kind === 'replace'
      && same(replaced.value, { title: '新标题', state: 'closed' }),
    'A1 complete 有值：整组替换，只保留本批给出的字段（SQL 侧其余列写 NULL）',
    replaced,
  )

  const removed = decideRowMerge(existingRow, { completeness: 'complete', value: null })
  check(removed.kind === 'remove', 'A2 complete + null：确认这张票不存在，整行删除', removed)

  const filled = decideRowMerge(existingRow, {
    completeness: 'truncated',
    value: { title: '不该覆盖', url: 'https://example.test/1', commentCount: 0 },
  })
  check(
    filled.kind === 'fill'
      && same(filled.value, { title: '不该覆盖', url: 'https://example.test/1', commentCount: 0 }),
    'A3 truncated 有值：只挑非空字段去补缺，0 也算有值（SQL 侧 COALESCE 不覆盖已有值）',
    filled,
  )

  const keptUnknown = decideRowMerge(existingRow, {
    completeness: 'unknown',
    reason: 'not-expressed',
    value: { title: '不该看' },
  })
  check(keptUnknown.kind === 'keep', 'A4 unknown：即使带了值也只盖章、不动旧行', keptUnknown)

  const truncatedEmpty = decideRowMerge(existingRow, { completeness: 'truncated', value: null })
  check(truncatedEmpty.kind === 'keep', 'A5 truncated + null：什么都没拿到，保留旧行', truncatedEmpty)

  // ---- 二、条目组：标签与指派共用同一套规则 ----
  const oldLabels: SnapshotLabel[] = [
    { name: 'bug', color: '#d73a4a' },
    { name: 'docs', color: null },
  ]
  const keyOfLabel = (item: SnapshotLabel): string => item.name

  const cleared = decideCollectionMerge(oldLabels, { completeness: 'complete', value: [] }, keyOfLabel)
  check(
    cleared.kind === 'replace' && cleared.items.length === 0,
    'B1 complete + 空数组：确认没有，整组清空',
    cleared,
  )

  const nullCleared = decideCollectionMerge(
    oldLabels,
    { completeness: 'complete', value: null },
    keyOfLabel,
  )
  check(
    nullCleared.kind === 'replace' && nullCleared.items.length === 0,
    'B2 complete + null：与空数组同义，整组清空',
    nullCleared,
  )

  const appended = decideCollectionMerge(
    oldLabels,
    { completeness: 'truncated', value: [{ name: 'bug', color: '#000000' }, { name: 'triage' }] },
    keyOfLabel,
  )
  check(
    appended.kind === 'append'
      && same(appended.items, [{ name: 'triage' }]),
    'B3 truncated：只补旧组没有的条目，已有条目的颜色不被覆盖，旧顺序不动',
    appended,
  )

  const appendNothing = decideCollectionMerge(
    oldLabels,
    { completeness: 'truncated', value: [] },
    keyOfLabel,
  )
  check(appendNothing.kind === 'keep', 'B4 truncated + 空数组：零动作，旧组原样保留', appendNothing)

  const unknownLabels = decideCollectionMerge(
    oldLabels,
    { completeness: 'unknown', value: [{ name: 'zzz' }] },
    keyOfLabel,
  )
  check(unknownLabels.kind === 'keep', 'B5 unknown：不删也不补，只由调用方盖章', unknownLabels)

  const deduped = decideCollectionMerge(
    [],
    { completeness: 'complete', value: [{ name: 'bug' }, { name: 'bug', color: '#fff' }] },
    keyOfLabel,
  )
  check(
    deduped.kind === 'replace'
      && deduped.items.length === 1
      && (deduped.items[0] as SnapshotLabel).name === 'bug'
      && same(deduped.items[0], { name: 'bug' }),
    'B6 同一批里的重复条目按第一次出现算，后面的整条丢掉（不是合并字段）',
    deduped,
  )

  // ---- 三、版本门：只看本批表达的组 ----
  check(
    shouldDiscardBatch(3, [4]) && shouldDiscardBatch(3, [3, 99]) && !shouldDiscardBatch(3, [3, 2]),
    'C1 任一表达组的 written_version 大于起点就整批丢弃；等于或小于不丢',
  )
  check(
    !shouldDiscardBatch(3, []) && !shouldDiscardBatch(3, [0]),
    'C2 本批没表达任何组时不丢；库里没有行按 0 传也不会误伤',
  )
  check(
    normalizeStartMergeVersion(Number.NaN) === 0
      && normalizeStartMergeVersion(-5) === 0
      && normalizeStartMergeVersion(7.9) === 7
      && shouldDiscardBatch(Number.NaN, [1]) === true,
    'C3 起点非法（NaN / 负数 / 小数）归一成 0 或整数，绝不把 NaN 带进比较绕过版本门',
  )

  // ---- 四、构建与类型检查登记：新树漏登记会静默不编译 ----
  const buildSrc = srcText('scripts/build.mts')
  check(
    buildSrc.indexOf("'[workspace-snapshot-ts]'") >= 0
      && buildSrc.indexOf('function buildWorkspaceSnapshotTree') >= 0
      && buildSrc.indexOf('function checkWorkspaceSnapshotTree') >= 0,
    'D1 scripts/build.mts 里有 workspace-snapshot 的转译段与类型检查段',
  )
  check(
    /buildWorkspaceSnapshotTree\(\)\s*\ncheckWorkspaceSnapshotTree\(\)/.test(buildSrc),
    'D2 build.mts 主流程真的调用了这两段（只定义不调用等于没登记）',
  )
  const tsconfigSrc = srcText('src/workspace-snapshot/tsconfig.json')
  check(
    tsconfigSrc.indexOf('"include"') >= 0 && tsconfigSrc.indexOf('**/*.ts') >= 0,
    'D3 src/workspace-snapshot/tsconfig.json 的 include 覆盖整棵树（contract/ 子目录也归它）',
  )
  check(
    typeof openWorkspaceSnapshot === 'function',
    'D4 门面只从 contract/index.ts 导出 openWorkspaceSnapshot，上层不用认识内部路径',
  )

  console.log('')
  console.log(failed ? '存在失败 — ' + GATE + ' 未通过' : '全部通过 — 快照库合并规则与登记门禁生效（' + total + ' 项断言）')
  printGateResult(GATE, total, failed)
  process.exit(failed ? 1 : 0)
}

main()
