/**
 * smoke-snapshot-github.test.ts —— GitHub 这一端的快照库冒烟（#1869）
 *
 * 只做一件事，但要穿过真实文件：把一小批票写进真 SQLite 库 → 关掉所有句柄 → 重开 → 从库回放出
 * 容器树与子票。两秒内跑完，进冒烟链；要细节与三态断言看 verify-1863-snapshot-cold-start.ts。
 *
 * 运行：node --import ./scripts/ts-hook.mts tests/smoke-snapshot-github.test.ts
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

function issueOf(key: string, title: string, extra: Record<string, unknown> = {}): any {
  return Object.assign({
    key,
    effortId: '',
    type: 'issue',
    title,
    state: 'open',
    body: '',
    url: 'https://github.com/acme/widgets/issues/' + key,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
    closedAt: null,
    parentKey: null,
    labels: [],
    assignees: [],
  }, extra)
}

const root = mkdtempSync(path.join(os.tmpdir(), 'smoke-snapshot-github-'))
try {
  mkdirSync(path.join(root, 'docs', 'agents'), { recursive: true })
  writeFileSync(path.join(root, 'docs', 'agents', 'workspace.yaml'), 'name: smoke-github\n', 'utf8')
  const key = { workspaceRoot: root, backend: 'github', repoIdentity: 'acme/widgets' }
  const repo = { backend: 'github', refId: 'acme/widgets', name: 'widgets', url: 'https://github.com/acme/widgets' } as any

  const written = await library.recordIssueRows(Object.assign({}, key, {
    rows: [
      issueOf('100', '探索地图：冒烟', { type: 'map', labels: [{ name: 'wayfinder:map', color: '5319e7' }] }),
      issueOf('5', '子票五', { parentKey: '100' }),
      issueOf('7', '独立票'),
    ],
  }))
  check(written.ok === true && written.rows === 3, '写进真库三张票')

  library.closeSnapshotLibraries()
  const replay = await library.readSnapshotReplay(Object.assign({}, key, { repo }))
  check(replay !== null, '关库重开后能回放')
  const snap: any = replay && replay.snapshot
  const maps: any[] = (snap && snap.maps) || []
  check(maps.length === 1 && String(maps[0].key) === '100', '容器树从库铺出')
  const tickets: any[] = (maps[0] && maps[0].tickets) || []
  check(tickets.length === 1 && String(tickets[0].key) === '5', '子票按父子边挂在容器下')
  check(!!(snap && (snap.issues || []).some((x: any) => String(x.key) === '7')), '独立票从库铺出')
} finally {
  library.closeSnapshotLibraries()
  rmSync(root, { recursive: true, force: true })
}

if (failures) console.log('冒烟未通过')
// 完成记录：#1158 起链上执行器按这一行对数，没有它就判「跑到一半就收摊」。
printGateResult('smoke-snapshot-github', total, failures)
process.exit(failures ? 1 : 0)
