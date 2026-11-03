/**
 * tests/verify-1863-snapshot-library-replay.ts —— 首屏容器树与状态胶囊从快照库出（#1863）
 *
 * 守什么：GitHub 列表取数的结果要按组写进本地快照库，界面首屏读回来的地图/规格容器树、
 * 子票与阻塞胶囊与在线列表一致；断网冷启动时零网络请求也能铺出这一屏。
 *
 * 为什么用真库与真临时工作区：写入的三态、父子边、整池重建后已关闭票仍在，都发生在
 * SQLite 里，替身盖不住这些行为；临时目录用 os.tmpdir()，跑完删干净。
 *
 * 运行：node --import ./scripts/ts-hook.mts tests/verify-1863-snapshot-library-replay.ts
 */
// 门禁归属: src/refresh/rooms/host/snapshot-library.ts

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { printGateResult } from './lib/gate-result.ts'
import type { Issue, IssueFieldStates, RepositoryRef } from '../src/tracker/contract/entities.ts'
import { recordIssueRows, readSnapshotReplay, closeSnapshotLibraries } from '../src/refresh/rooms/host/snapshot-library.ts'

const GATE = 'verify-1863-snapshot-library-replay'
const CLOCK = 1762310000000
const REPO: RepositoryRef = {
  backend: 'github',
  refId: 'acme/repo-a',
  name: 'repo-a',
  url: 'https://github.com/acme/repo-a',
}
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

function fieldStates(parentKey: string | null, blockedBy: Array<{ key: string; title: string; state?: 'open' | 'closed' }>): IssueFieldStates {
  return {
    parents: { known: true, value: parentKey, reason: null },
    dependencies: { known: true, value: blockedBy, reason: null },
    subIssues: { known: false, value: null, reason: 'not-expressed' },
    comments: { known: false, value: null, reason: 'not-expressed' },
    review: { known: false, value: null, reason: 'not-expressed' },
    mergeInfo: { known: false, value: null, reason: 'not-expressed' },
  }
}

function issue(input: Partial<Issue> & { key: string; title: string }): Issue {
  const base: Issue = {
    key: input.key,
    effortId: input.effortId || '',
    type: input.type || 'issue',
    title: input.title,
    state: input.state || 'open',
    body: input.body || '',
    url: 'https://github.com/acme/repo-a/issues/' + input.key,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: input.updatedAt || '2026-11-01T00:00:00Z',
    closedAt: input.closedAt || null,
    parentKey: input.parentKey === undefined ? null : input.parentKey,
  }
  return Object.assign(base, input)
}

function findContainer(replay: any, key: string): any {
  return replay.snapshot.maps.filter((m: any) => m.key === key)[0]
}

function findTicket(container: any, key: string): any {
  return (container && container.tickets || []).filter((t: any) => String(t.key) === key)[0]
}

async function main(): Promise<void> {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'verify-1863-replay-'))
  try {
    mkdirSync(path.join(tempRoot, 'docs', 'agents'), { recursive: true })
    writeFileSync(path.join(tempRoot, 'docs', 'agents', 'workspace.yaml'), 'name: gate-1863\n', 'utf8')

    const blocked = { key: '50', title: '已关闭的子票', state: 'closed' as const }
    const rows: Issue[] = [
      issue({ key: '100', type: 'map', title: '地图 100' }),
      issue({
        key: '5',
        title: '子票 5',
        parentKey: '100',
        updatedAt: '2026-11-02T00:00:00Z',
        labels: [{ name: 'ready-for-agent', color: '00ff00' }],
        assignees: [{ login: 'alice' }],
        blockedBy: [blocked],
        fieldStates: fieldStates('100', [blocked]),
      }),
      issue({ key: '50', title: '已关闭的子票', state: 'closed', parentKey: '100', closedAt: '2026-10-20T00:00:00Z' }),
      issue({ key: '200', type: 'spec', title: '规格 200' }),
    ]

    // A. 第一批列表写入：五组都进库，回放出的容器树与在线组装同形
    const first = await recordIssueRows({
      workspaceRoot: tempRoot,
      backend: 'github',
      repoIdentity: REPO.refId,
      rows,
    })
    check(first.ok === true && first.rows === 4, 'A1 第一批四条票按组写入库', first)

    const replay1 = await readSnapshotReplay({
      workspaceRoot: tempRoot,
      backend: 'github',
      repoIdentity: REPO.refId,
      repo: REPO,
    })
    check(replay1 !== null, 'A2 库读得回首屏回放', replay1)
    const map100 = findContainer(replay1, '100')
    check(map100 && map100.type === 'map', 'A3 地图容器从库回放出来', map100 && map100.type)
    const ticket5 = findTicket(map100, '5')
    check(ticket5 !== undefined, 'A4 子票挂在父容器下面（父子关系来自库里的边）', map100 && map100.tickets.map((t: any) => t.key))
    check(ticket5 && ticket5.labels?.[0]?.name === 'ready-for-agent', 'A5 标签组回放', ticket5 && ticket5.labels)
    check(ticket5 && ticket5.assignees?.[0]?.login === 'alice', 'A6 指派组回放', ticket5 && ticket5.assignees)
    const cap = ticket5 && ticket5.blockedBy && ticket5.blockedBy[0]
    check(
      !!cap && cap.key === blocked.key && cap.title === blocked.title && cap.state === blocked.state,
      'A7 状态胶囊（阻塞关系）带目标标题与状态回放',
      ticket5 && ticket5.blockedBy,
    )
    check(findTicket(map100, '50') !== undefined, 'A8 已关闭子票也在容器树里', map100 && map100.tickets.map((t: any) => t.key))
    check(findContainer(replay1, '200') !== undefined, 'A9 规格容器从库回放出来')
    check(replay1.snapshot.repository && replay1.snapshot.repository.refId === REPO.refId, 'A10 回放信封带仓库身份')

    // B. 第二批只写变化的两条：旧行不被整份重写，版本号前进
    const second = await recordIssueRows({
      workspaceRoot: tempRoot,
      backend: 'github',
      repoIdentity: REPO.refId,
      rows: [
        issue({ key: '5', title: '子票 5（改名）', parentKey: '100', updatedAt: '2026-11-03T00:00:00Z' }),
        issue({ key: '6', title: '新子票 6', parentKey: '200' }),
      ],
    })
    check(second.ok === true && second.rows === 2, 'B1 第二批只写两条', second)
    check(typeof second.mergeVersion === 'number' && second.mergeVersion > first.mergeVersion!, 'B2 增量写入推进合并版本号', {
      first: first.mergeVersion,
      second: second.mergeVersion,
    })
    const replay2 = await readSnapshotReplay({
      workspaceRoot: tempRoot,
      backend: 'github',
      repoIdentity: REPO.refId,
      repo: REPO,
    })
    const map100v2 = findContainer(replay2, '100')
    check(findTicket(map100v2, '5').title === '子票 5（改名）', 'B3 后写的标题覆盖前值', findTicket(map100v2, '5').title)
    check(findTicket(map100v2, '50') !== undefined, 'B4 第二批没提到的旧行仍在库里', map100v2.tickets.map((t: any) => t.key))
    check(findTicket(findContainer(replay2, '200'), '6') !== undefined, 'B5 新子票挂到规格容器下')

    // C. 整池重建（只表达开放票）：已关闭票不被删
    const rebuild = await recordIssueRows({
      workspaceRoot: tempRoot,
      backend: 'github',
      repoIdentity: REPO.refId,
      rows: [
        issue({ key: '100', type: 'map', title: '地图 100' }),
        issue({ key: '5', title: '子票 5（改名）', parentKey: '100', updatedAt: '2026-11-03T00:00:00Z' }),
        issue({ key: '200', type: 'spec', title: '规格 200' }),
      ],
    })
    check(rebuild.ok === true, 'C1 整池重建批次写入成功', rebuild)
    const replay3 = await readSnapshotReplay({
      workspaceRoot: tempRoot,
      backend: 'github',
      repoIdentity: REPO.refId,
      repo: REPO,
    })
    check(findTicket(findContainer(replay3, '100'), '50') !== undefined, 'C2 整池重建后已关闭票仍在库里')

    // D. 关掉句柄重开：数据在真文件里，不靠进程内状态
    closeSnapshotLibraries()
    const replay4 = await readSnapshotReplay({
      workspaceRoot: tempRoot,
      backend: 'github',
      repoIdentity: REPO.refId,
      repo: REPO,
    })
    check(replay4 !== null && findTicket(findContainer(replay4, '100'), '50') !== undefined, 'D1 重开库后容器树与已关闭票仍可回放')
  } finally {
    closeSnapshotLibraries()
    rmSync(tempRoot, { recursive: true, force: true })
  }
  printGateResult(GATE, total, failed)
}

main().catch((e) => {
  console.log('FAIL 门禁异常退出：' + ((e && e.stack) || e))
  printGateResult(GATE, total, failed + 1)
  process.exitCode = 1
})
