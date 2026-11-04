/**
 * smoke-snapshot-markdown.test.ts —— 本地 Markdown 这一端的快照库冒烟（#1869）
 *
 * 与另外两条同形，另加两格本地 Markdown 特有的：票号补零（`01` 号票）在读写两侧都对得上，
 * 以及「工作单元标识取自目录名」。要细节看 verify-1868-snapshot-markdown.ts。
 *
 * 运行：node --import ./scripts/ts-hook.mts tests/smoke-snapshot-markdown.test.ts
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { printGateResult } from './lib/gate-result.ts'
import * as library from '../src/refresh/rooms/host/snapshot-library.ts'

let failures = 0
let total = 0
const check = (ok: unknown, msg: string): void => {
  total += 1
  console.log((ok ? '  PASS ' : '  FAIL ') + msg)
  if (!ok) failures += 1
}

const EFFORT = 'alpha'

function issueOf(key: string, title: string, extra: Record<string, unknown> = {}): any {
  return Object.assign({
    key,
    effortId: EFFORT,
    type: 'issue',
    title,
    state: 'open',
    body: '',
    url: '',
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
    closedAt: null,
    parentKey: null,
    labels: [],
    assignees: [],
  }, extra)
}

const root = mkdtempSync(path.join(os.tmpdir(), 'smoke-snapshot-markdown-'))
try {
  mkdirSync(path.join(root, 'docs', 'agents'), { recursive: true })
  writeFileSync(path.join(root, 'docs', 'agents', 'workspace.yaml'), 'name: smoke-markdown\n', 'utf8')
  // 本地 Markdown 的库身份就是工作区目录本身（它没有 owner/name 可解析）。
  const key = { workspaceRoot: root, backend: 'markdown', repoIdentity: root }
  const repo = { backend: 'markdown', refId: root, name: 'ws', url: '', effortId: EFFORT } as any

  const written = await library.recordIssueRows(Object.assign({}, key, {
    rows: [
      issueOf('00', '探索地图：冒烟', { type: 'map', labels: [{ name: 'wayfinder:map', color: '5319e7' }] }),
      issueOf('01', '第一张子票', { parentKey: '00' }),
      issueOf('05', '独立票'),
    ],
  }))
  check(written.ok === true && written.rows === 3, '写进真库三张票（票号补零）')

  library.closeSnapshotLibraries()
  const replay = await library.readSnapshotReplay(Object.assign({}, key, { repo }))
  const snap: any = replay && replay.snapshot
  const maps: any[] = (snap && snap.maps) || []
  check(maps.length === 1 && String(maps[0].key) === '00', '容器树从库铺出')
  check(((maps[0] && maps[0].tickets) || []).length === 1, '子票按父子边挂在容器下')
  check(!!(snap && (snap.issues || []).some((x: any) => String(x.key) === '05')), '独立票从库铺出')

  const detail = await library.readIssueDetail(Object.assign({}, key, { key: '01', effortId: EFFORT }))
  check(!!(detail && detail.issue && (detail.issue as any).effortId === EFFORT), '工作单元标识取自目录名')
} finally {
  library.closeSnapshotLibraries()
  rmSync(root, { recursive: true, force: true })
}

if (failures) console.log('冒烟未通过')
// 完成记录：#1158 起链上执行器按这一行对数，没有它就判「跑到一半就收摊」。
printGateResult('smoke-snapshot-markdown', total, failures)
process.exit(failures ? 1 : 0)
