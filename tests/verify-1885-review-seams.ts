/**
 * tests/verify-1885-review-seams.ts —— 评审修复里那几处「只该有一份」的口子
 * （标准轴第 2 / 3 / 4 / 5 / 6 条）
 *
 * 守什么：
 *  A 切片名清单只有一份（标准轴第 3 条）：DeckViewSliceName 由 deck-view-model.ts 定义、接线层只导入；
 *    'prList' 在联合里（PrTab 正在用它），接线层不再手写第二份联合。
 *  B 行级增量那道口要求 readSnapshotReplay 齐（标准轴第 5 条）：静态清单里有它；运行时缺它时 ready() 为假，
 *    齐全时为真——否则 ready() 回真、readReplay 却拿不到基线。
 *  C 仓库身份解析只有一条链（标准轴第 2 条）：两个调用方都调 resolveRepoRefForCwd，不再自己拼 owner/name
 *    或 Markdown 分支。
 *  D 同步簿记类型只有契约一份（标准轴第 4 条）：persistence 从 contract 导，自己不再声明；
 *    结果类型统一用 SyncBookkeepingResult。
 *  E 计数清单的两个常量真的被校验代码读（标准轴第 6 条）：加数字只改清单，不在函数里手写第二遍。
 *
 * 为什么用静态判据 + 少量运行时：这五条守的是「重复定义已经不存在」和「必填口真的被要求」，
 * 重复定义在运行时看不出来；运行时只补 ready() 这一条行为断言。
 *
 * 跑法：node --import ./scripts/ts-hook.mjs tests/verify-1885-review-seams.ts
 */
// 门禁归属: src/client/kernel/deck-view-model.ts
// 门禁归属: src/client/kernel/deck-view-binding.ts
// 门禁归属: src/refresh/rooms/host/patch-library-ports.ts
// 门禁归属: src/refresh/rooms/host/snapshot-read-channels.ts
// 门禁归属: src/tracker/session/repo-ref.ts
// 门禁归属: src/workspace-snapshot/persistence/sync-bookkeeping.ts
// 门禁归属: src/tracker/deck-counts.ts

import { readFileSync, readdirSync, statSync } from 'node:fs'
import * as path from 'node:path'
import { printGateResult } from './lib/gate-result.ts'
import { createPatchLibraryPorts } from '../src/refresh/rooms/host/patch-library-ports.ts'
import { normalizeDeckCounts, DECK_COUNT_FIELDS, DECK_COUNT_COMPLETENESS } from '../src/tracker/deck-counts.ts'

const GATE = 'verify-1885-review-seams'
let total = 0
let failed = 0
function check(cond: unknown, message: string, detail?: unknown): void {
  total += 1
  if (cond) { console.log('PASS ' + message); return }
  failed += 1
  console.log('FAIL ' + message + (detail === undefined ? '' : '（实得 ' + JSON.stringify(detail) + '）'))
}

function sourceOf(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), 'utf8')
}

function codeOnly(source: string): string {
  return String(source)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
}

// ---------------------------------------------------------------------------
// A 切片名清单只有一份
// ---------------------------------------------------------------------------
{
  const model = sourceOf('src/client/kernel/deck-view-model.ts')
  const bindingRaw = sourceOf('src/client/kernel/deck-view-binding.ts')
  const binding = codeOnly(bindingRaw)
  const prTab = sourceOf('src/client/views/PrTab.ts')
  const unionLine = /export type DeckViewSliceName = ([^\n]+)/.exec(model)
  const names = unionLine ? (unionLine[1].match(/'[^']+'/g) || []).map((item: string) => item.replace(/'/g, '')) : []
  check(unionLine !== null && names.indexOf('prList') >= 0, 'A1 DeckViewSliceName 定义在 deck-view-model.ts，且包含 prList', names)
  check(bindingRaw.indexOf("import type { DeckViewSliceName } from './deck-view-model.js'") >= 0,
    'A2 接线层从 deck-view-model.ts 导入切片名（不再手写联合）')
  check(!/type\s+DeckViewSliceName\s*=/.test(binding), 'A3 接线层没有第二份 DeckViewSliceName 定义')
  check(prTab.indexOf("useDeckViewSlice(st, 'prList')") >= 0, 'A4 PrTab 仍在用 prList 切片（导入的联合必须覆盖它）')
  check(names.indexOf('issueDetail') >= 0 && names.indexOf('mapDetail') >= 0 && names.indexOf('counts') >= 0,
    'A5 联合里还带着其它在用的切片名（没有被精简掉）', names)
}

// ---------------------------------------------------------------------------
// B 行级增量必填口含 readSnapshotReplay
// ---------------------------------------------------------------------------
{
  const ports = codeOnly(sourceOf('src/refresh/rooms/host/patch-library-ports.ts'))
  const portsRaw = sourceOf('src/refresh/rooms/host/patch-library-ports.ts')
  check(/REQUIRED_METHODS\s*=\s*\[[^\]]*'readSnapshotReplay'/.test(portsRaw),
    'B1 REQUIRED_METHODS 里有 readSnapshotReplay')
  const complete = {
    readSyncState: async () => null,
    writeSyncState: async () => null,
    readIssueIndex: async () => ({}),
    commitChangeRows: async () => ({ ok: true }),
    readSnapshotReplay: async () => null,
  }
  const make = function (lib: any): any {
    return createPatchLibraryPorts({
      getSnapshotLibrary: async () => lib,
      getRepoKey: async () => ({ owner: 'acme', name: 'widgets' }),
      backendIdOf: () => 'github',
    })
  }
  const full = make(complete)
  check(await full.ready('D:/ws-1885-seams') === true, 'B2 五个口齐全时 ready() 为真')
  const missingReplay: any = Object.assign({}, complete)
  delete missingReplay.readSnapshotReplay
  const partial = make(missingReplay)
  check(await partial.ready('D:/ws-1885-seams') === false,
    'B3 缺 readSnapshotReplay 时 ready() 为假（不再出现「ready 为真、基线拿不到」）')
  check(await partial.readReplay('D:/ws-1885-seams') === null, 'B4 缺这一口时 readReplay 也如实回 null')
}

// ---------------------------------------------------------------------------
// C 仓库身份解析只有一条链
// ---------------------------------------------------------------------------
{
  const readChannels = codeOnly(sourceOf('src/refresh/rooms/host/snapshot-read-channels.ts'))
  const patchPorts = codeOnly(sourceOf('src/refresh/rooms/host/patch-library-ports.ts'))
  const repoRef = sourceOf('src/tracker/session/repo-ref.ts')
  check(readChannels.indexOf('resolveRepoRefForCwd(') >= 0, 'C1 两条读口用共享的 resolveRepoRefForCwd')
  check(patchPorts.indexOf('resolveRepoRefForCwd(') >= 0, 'C2 行级增量口用共享的 resolveRepoRefForCwd')
  check(!/backend\s*===\s*['"]markdown['"]/.test(readChannels) && !/backend\s*===\s*['"]markdown['"]/.test(patchPorts),
    'C3 两个调用方都不再自己写 Markdown 的 cwd 兜底（搬进解析器一处）')
  check(!/reg\.describe\s*\(\s*\{\s*cwd\s*\}/.test(readChannels) && !/reg\.describe\s*\(\s*\{\s*cwd\s*\}/.test(patchPorts),
    'C4 两个调用方都不再自己调 describe 拼第一段（解析器内部做）')
  check(repoRef.indexOf('export async function resolveRepoRefForCwd') >= 0 && repoRef.indexOf('getRepoKey') >= 0,
    'C5 解析器接纳本地 git 远程这一格（三个调用方的顺序在同一处）')
}

// ---------------------------------------------------------------------------
// D 同步簿记类型只有契约一份
// ---------------------------------------------------------------------------
{
  const persistenceRaw = sourceOf('src/workspace-snapshot/persistence/sync-bookkeeping.ts')
  const persistence = codeOnly(persistenceRaw)
  const contract = sourceOf('src/workspace-snapshot/contract/types.ts')
  check(!/interface\s+SyncBookkeeping\b/.test(persistence) && !/interface\s+SyncBookkeepingWrite\b/.test(persistence),
    'D1 persistence 不再声明 SyncBookkeeping / SyncBookkeepingWrite')
  check(persistenceRaw.indexOf("from '../contract/types.js'") >= 0 && persistence.indexOf('SyncBookkeepingResult') >= 0,
    'D2 persistence 从契约导入类型，结果类型用 SyncBookkeepingResult')
  check(/interface\s+SyncBookkeeping\b/.test(contract) && /interface\s+SyncBookkeepingResult\b/.test(contract),
    'D3 契约仍是簿记类型的唯一入口')
  const applyResult = /reason\?:\s*'stale'\s*\|\s*'readonly'\s*\|\s*'write-failed'/.test(contract)
  check(applyResult, 'D4 契约的结果类型保留 stale / readonly / write-failed 三档（不再漂成只剩 stale）')
  const allSources: string[] = []
  const walk = function (dir: string): void {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name)
      const stat = statSync(full)
      if (stat.isDirectory()) { walk(full); continue }
      if (/\.(ts|mts)$/.test(name)) allSources.push(readFileSync(full, 'utf8'))
    }
  }
  walk(path.join(process.cwd(), 'src'))
  check(allSources.every((text: string) => text.indexOf('SyncBookkeepingApplyResult') < 0),
    'D5 全仓已经没有 SyncBookkeepingApplyResult 这个第二份名字')
}

// ---------------------------------------------------------------------------
// E 计数清单常量真的被校验代码读
// ---------------------------------------------------------------------------
{
  const source = codeOnly(sourceOf('src/tracker/deck-counts.ts'))
  const normalizeStart = source.indexOf('export function normalizeDeckCounts')
  const normalizeBody = normalizeStart >= 0 ? source.slice(normalizeStart, source.indexOf('export function applyDeckCounts', normalizeStart)) : ''
  check(normalizeBody.indexOf('DECK_COUNT_FIELDS') >= 0, 'E1 normalizeDeckCounts 按 DECK_COUNT_FIELDS 逐项收数（常量有真读者）')
  check(normalizeBody.indexOf('DECK_COUNT_COMPLETENESS') >= 0, 'E2 完整度按 DECK_COUNT_COMPLETENESS 认值')
  check(DECK_COUNT_FIELDS.length === 6 && DECK_COUNT_COMPLETENESS.length === 2, 'E3 两份清单的长度与契约一致', { fields: DECK_COUNT_FIELDS.length, completeness: DECK_COUNT_COMPLETENESS.length })
  const good = { total: 7, open: 4, closed: 3, takeable: 2, blocked: 1, claimed: 1, completeness: 'complete' }
  check(normalizeDeckCounts(good) !== null && normalizeDeckCounts(good).total === 7, 'E4 六格齐全的读数收得下')
  check(normalizeDeckCounts({ total: 7, open: 4, closed: 3, takeable: 2, blocked: 1, completeness: 'complete' }) === null,
    'E5 缺一格整份拒绝（不挑几个数先用）')
  check(normalizeDeckCounts(Object.assign({}, good, { completeness: 'pending' })) === null,
    'E6 认不出的完整度整份拒绝（不编一个 known）')
}

console.log('')
if (failed) console.log('FAIL：' + total + ' 条断言里有失败')
else console.log('OK：' + total + ' 条断言全部通过')
printGateResult(GATE, total, failed)
process.exit(failed ? 1 : 0)
