/**
 * tests/fixtures/1892/regenerate.mts —— #1892 纯投影的等价性夹具生成器
 *
 * 用途：把「库列表投影里的行」按**当前实现**投影一次，落成逐字基线。
 *
 * 重要：这一份是金标准夹具的生成器，不是门禁。它的输出会被
 * tests/verify-1892-pure-projection.ts 逐字节比对。仓库里那四份基线最早是 #1892 改代码之前用当时的
 * snapshotOfProjection 跑出来的，这就是「搬前搬后一致」的证据。
 *
 * #1893（规格 #1885 I6）有意改了一次行为：未知组不再写空数组/null。按本文件自己的规矩，
 * 确认行为有意改变之后重跑了它，并把 #1893 之前的四份基线原样留在 tests/fixtures/1892/pre-1893/：
 * verify-1892 的 H 段拿新旧两份逐字段比，只允许三态字段（blockedBy / parentKey / labels /
 * assignees / mergedAt）按组状态变化。以后再重跑之前先看那条差异判据，别把真回归当预期改掉。
 *
 * 怎么重跑（在仓库根目录）：
 *   node --import ./scripts/ts-hook.mts tests/fixtures/1892/regenerate.mts
 *
 * 夹具的来历：
 *   01-real-1682.json   —— #1682 的真机夹具（脱敏后的两页 GitHub 列表行，8 张工单 + 2 个拉取请求），
 *                          用真实 GitHub 归一化（tracker/rooms/github/model/normalize）转成契约行，
 *                          再经真实 SQLite 快照库写入、readList({state:'all'}) 读回；
 *                          覆盖容器树、父子边、已关闭行、拉取请求。
 *   02-edges-and-closed.json —— 手工整理的页面样本（内容参照本仓库的规格与地图票面）：
 *                          两张地图（一张开放、一张已关闭）、一张规格、阻塞边与引用态、
 *                          已关闭子票、破链票；覆盖阻塞边、已关闭容器里的子票、瘦身行。
 *   03-multi-effort.json —— 本地 Markdown 形态的两个工作单元，编号各自从 00 起：
 *                          验证 (effortId, key) 分组与排序不靠行插入顺序。
 *   04-empty.json       —— 空库：没有任何行时的投影结果。
 *
 * 每个文件是 {note, repo, version, rows, expected}：rows 是 readList 读回来的行（原样），
 * expected 是当时 snapshotOfProjection 的输出。门禁拿 rows 再投影一次，与 expected 逐字节比。
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Issue, IssueFieldStates, RepositoryRef } from '../../../src/tracker/contract/entities.ts'
import { openWorkspaceSnapshot } from '../../../src/workspace-snapshot/contract/index.ts'
import { issueWritesOf } from '../../../src/refresh/rooms/host/snapshot-library-adapter.ts'
import { snapshotOfProjection } from '../../../src/refresh/rooms/host/snapshot-library-view.ts'
import { normalizeIssue } from '../../../src/tracker/rooms/github/model/normalize.ts'

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const OUT_DIR = path.join(ROOT, 'tests', 'fixtures', '1892')
const REPO: RepositoryRef = {
  backend: 'github',
  refId: 'acme/widgets',
  name: 'acme/widgets',
  url: 'https://github.com/acme/widgets',
}
const NOW = 1793000000000

function iso(ms: number): string {
  return new Date(ms).toISOString()
}

/** 写进真库再读回来：夹具里的行因此是「生产读路径真正会交付的那种行」。 */
function readRows(rows: Issue[], backend: 'github' | 'markdown'): { version: number, rows: any[] } {
  const root = mkdtempSync(path.join(os.tmpdir(), 'verify-1892-fixture-'))
  mkdirSync(path.join(root, 'docs', 'agents'), { recursive: true })
  writeFileSync(path.join(root, 'docs', 'agents', 'workspace.yaml'), 'name: gate-1892\n', 'utf8')
  const opened = openWorkspaceSnapshot({
    workspaceRoot: root,
    backend,
    repoIdentity: REPO.refId,
    now: () => NOW,
    leaseOwner: 'fixture-1892',
  })
  try {
    const result = opened.handle.ingest({
      startMergeVersion: opened.handle.getMergeVersion(),
      writes: issueWritesOf(rows, backend),
    })
    if (!result.committed) throw new Error('夹具写库失败：' + String(result.reason))
    const projection = opened.handle.readList({ state: 'all' })
    return { version: projection.mergeVersion, rows: projection.issues as any[] }
  } finally {
    try { opened.handle.close() } catch { /* 已关 */ }
    rmSync(root, { recursive: true, force: true })
  }
}

function fieldStates(parentKey: string | null, blockedBy: any[]): IssueFieldStates {
  return {
    parents: { known: true, value: parentKey, reason: null },
    dependencies: { known: true, value: blockedBy, reason: null },
    subIssues: { known: false, value: null, reason: 'not-expressed' },
    comments: { known: false, value: null, reason: 'not-expressed' },
    review: { known: false, value: null, reason: 'not-expressed' },
    mergeInfo: { known: false, value: null, reason: 'not-expressed' },
  }
}

function issue(input: Partial<Issue> & { key: string, title: string }): Issue {
  const base: Issue = {
    key: input.key,
    effortId: input.effortId || '',
    type: input.type || 'issue',
    title: input.title,
    state: input.state || 'open',
    body: input.body || '',
    url: 'https://github.com/acme/widgets/issues/' + input.key,
    createdAt: input.createdAt || '2026-10-01T00:00:00.000Z',
    updatedAt: input.updatedAt || '2026-11-01T00:00:00.000Z',
    closedAt: input.closedAt === undefined ? null : input.closedAt,
    parentKey: input.parentKey === undefined ? null : input.parentKey,
  }
  return Object.assign(base, input)
}

const MAP_BODY = [
  '# 地图：快照合并服务',
  '',
  'Status: ready-for-agent',
  '',
  '## Destination',
  '',
  '把面板数据收成一条单向数据流：库是唯一真相。',
  '',
  '## Notes',
  '',
  '只读侧只做投影，不写缓存。',
  '',
  '## Decisions so far',
  '',
  '- [投影纯函数](https://github.com/acme/widgets/issues/101) — 同样输入必须逐字相同',
  '- **排序显式给定**：不依赖插入顺序',
  '',
  '## Not yet specified',
  '',
  '- 后台推送何时可用',
  '',
  '## Out of scope',
  '',
  '- 布局与通知历史',
  '',
].join('\n')

const SPEC_BODY = [
  '<!-- DSH-ISSUE-KIND: spec -->',
  '# 规格：快照库成为唯一真相',
  '',
  '## 问题陈述',
  '',
  '同一张票会说出两个值。',
  '',
  '## 解决方案',
  '',
  '库 → 投影 → 视图状态 → 界面。',
  '',
  '## 用户故事',
  '',
  '1. 关闭之后仍是关闭。',
  '',
  '## 实现决策',
  '',
  '### 1. 架构',
  '',
  '读侧是纯函数。',
  '',
  '## 测试决策',
  '',
  '真库加假后端。',
  '',
  '## 不在范围内',
  '',
  '推送。',
  '',
  '## 补充说明',
  '',
  '无。',
  '',
].join('\n')

function sampleReal1682(): Issue[] {
  const fixture = JSON.parse(readFileSync(path.join(ROOT, 'tests', 'fixtures', '1682', 'rest-list-with-fields.json'), 'utf8')) as { rows: any[] }
  return fixture.rows.map(function (raw: any) { return normalizeIssue(raw) })
}

function sampleEdgesAndClosed(): Issue[] {
  const blocker = issue({ key: '50', title: '上游迁移', state: 'closed', parentKey: '100', closedAt: '2026-10-20T00:00:00.000Z', updatedAt: '2026-10-20T00:00:00.000Z' })
  const blocked = { key: '50', title: '上游迁移', state: 'closed' as const }
  const second = { key: '101', title: '投影纯函数', state: 'open' as const }
  return [
    issue({
      key: '100', type: 'map', title: '地图：快照合并服务', body: MAP_BODY,
      updatedAt: '2026-11-02T10:00:00.000Z', labels: [{ name: 'wayfinder:map', color: '5319e7' }],
    }),
    blocker,
    issue({
      key: '101', title: '投影纯函数', parentKey: '100', updatedAt: '2026-11-03T09:00:00.000Z',
      labels: [{ name: 'ready-for-agent', color: '0e8a16' }],
      assignees: [{ login: 'alice', name: 'Alice' }],
      blockedBy: [blocked],
      fieldStates: fieldStates('100', [blocked]),
    }),
    issue({
      key: '102', title: '排序显式给定', parentKey: '100', updatedAt: '2026-11-01T08:00:00.000Z',
      blockedBy: [second],
      fieldStates: fieldStates('100', [second]),
    }),
    issue({ key: '150', type: 'map', title: '地图：收尾', state: 'closed', updatedAt: '2026-10-10T00:00:00.000Z', closedAt: '2026-10-10T00:00:00.000Z' }),
    issue({ key: '151', title: '收尾子票', parentKey: '150', state: 'closed', updatedAt: '2026-10-11T00:00:00.000Z', closedAt: '2026-10-11T00:00:00.000Z' }),
    issue({ key: '152', title: '还没做完的子票', parentKey: '150', updatedAt: '2026-10-12T00:00:00.000Z' }),
    issue({ key: '200', type: 'spec', title: '规格：快照库成为唯一真相', body: SPEC_BODY, updatedAt: '2026-11-04T00:00:00.000Z' }),
    issue({ key: '201', title: '规格里的已完成子票', parentKey: '200', state: 'closed', updatedAt: '2026-10-30T00:00:00.000Z', closedAt: '2026-10-30T00:00:00.000Z' }),
    issue({ key: '202', title: '规格里的实施票', parentKey: '200', updatedAt: '2026-11-05T00:00:00.000Z', blockedBy: [], fieldStates: fieldStates('200', []) }),
    issue({ key: '300', title: '未挂图的普通票', updatedAt: '2026-11-06T00:00:00.000Z', labels: [{ name: 'bug', color: 'd73a4a' }] }),
    issue({ key: '301', title: '拉取请求：快照唯一化', isPullRequest: true, updatedAt: '2026-11-07T00:00:00.000Z', commentCount: 5, mergedAt: null }),
    issue({ key: '302', title: '拉取请求：已合并的改动', isPullRequest: true, state: 'closed', updatedAt: '2026-10-29T00:00:00.000Z', closedAt: '2026-10-29T00:00:00.000Z', mergedAt: '2026-10-29T01:00:00.000Z' }),
    issue({ key: '400', title: '破链票：父票已经不在', parentKey: '999', updatedAt: '2026-11-08T00:00:00.000Z' }),
  ]
}

function sampleMultiEffort(): Issue[] {
  return [
    issue({ key: '00', effortId: 'alpha', type: 'map', title: '地图：工作单元 alpha', updatedAt: '2026-11-02T00:00:00.000Z' }),
    issue({ key: '01', effortId: 'alpha', title: 'alpha 的开放子票', parentKey: '00', updatedAt: '2026-11-03T00:00:00.000Z' }),
    issue({ key: '02', effortId: 'alpha', title: 'alpha 的已关闭子票', parentKey: '00', state: 'closed', updatedAt: '2026-10-20T00:00:00.000Z', closedAt: '2026-10-20T00:00:00.000Z' }),
    issue({ key: '00', effortId: 'beta', type: 'map', title: '地图：工作单元 beta', updatedAt: '2026-11-04T00:00:00.000Z' }),
    issue({ key: '01', effortId: 'beta', title: 'beta 的开放子票', parentKey: '00', updatedAt: '2026-11-05T00:00:00.000Z' }),
    issue({ key: '03', effortId: 'beta', title: 'beta 的孤立票', updatedAt: '2026-11-06T00:00:00.000Z' }),
  ]
}

function writeFixture(file: string, note: string, backend: 'github' | 'markdown', rows: Issue[]): void {
  const read = readRows(rows, backend)
  const projection = { mergeVersion: read.version, generatedAtMs: NOW, issues: read.rows }
  const expected = snapshotOfProjection(REPO, projection as any)
  const data = { note, repo: REPO, version: read.version, rows: read.rows, expected }
  writeFileSync(path.join(OUT_DIR, file), JSON.stringify(data, null, 2) + '\n', 'utf8')
  console.log(file + '：' + read.rows.length + ' 行，' + JSON.stringify(expected).length + ' 字节输出')
}

function main(): void {
  mkdirSync(OUT_DIR, { recursive: true })
  writeFixture(
    '01-real-1682.json',
    '#1682 真机夹具（两页 200 行里挑出的 10 行，8 张工单 + 2 个拉取请求，字段形状原样保留）；' +
    '经 GitHub 归一化写进真 SQLite 快照库、readList({state:"all"}) 读回；期望值在 #1892 搬前冻结，' +
    '#1893 按规格 I6（unknown 不写字段）重新冻结，旧基线见 pre-1893/。覆盖容器树、父子边、已关闭行与拉取请求。',
    'github',
    sampleReal1682(),
  )
  writeFixture(
    '02-edges-and-closed.json',
    '手工整理的页面样本（内容参照本仓库的规格与地图票面）：两张地图（一开一关）、一张规格、' +
    '阻塞边与引用态、已关闭子票、破链票与两个拉取请求；经真 SQLite 快照库写入再读回。' +
    '#1893 按规格 I6 重新冻结（mergeInfo complete + null 现在写 mergedAt:null），旧基线见 pre-1893/。' +
    '覆盖阻塞边、已关闭容器里的子票与瘦身行。',
    'github',
    sampleEdgesAndClosed(),
  )
  writeFixture(
    '03-multi-effort.json',
    '本地 Markdown 形态的两个工作单元（编号各自从 00 起）；经真 SQLite 快照库写入再读回，' +
    '验证按 (effortId, key) 的分组与显式排序。',
    'markdown',
    sampleMultiEffort(),
  )
  // 空库：没有任何行。旧实现读库为空时回 null，但投影本来就应该给出一份空形状，
  // 所以这一份直接调投影（与 snapshotOfProjection 对空 projection 的调用同形）。
  const emptyProjection = { mergeVersion: 0, generatedAtMs: NOW, issues: [] }
  const emptyExpected = snapshotOfProjection(REPO, emptyProjection as any)
  writeFileSync(path.join(OUT_DIR, '04-empty.json'), JSON.stringify({
    note: '空库：没有任何行。快照库读口回 null，但投影对空输入要给出确定的空形状。',
    repo: REPO,
    version: 0,
    rows: [],
    expected: emptyExpected,
  }, null, 2) + '\n', 'utf8')
  console.log('04-empty.json：0 行')
}

main()
