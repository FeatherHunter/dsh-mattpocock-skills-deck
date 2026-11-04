/**
 * smoke-snapshot-gitlab.test.ts —— GitLab 这一端的快照库冒烟（#1869）
 *
 * 与 GitHub 那条同形：一小批票写进真 SQLite 库 → 关句柄 → 重开 → 从库回放容器树与子票。
 * GitLab 特有的那一格在这里也顺手证一下：它原生没有的三组写成「不适用」，不是「确认没有」。
 * 要细节看 verify-1867-snapshot-gitlab.ts。
 *
 * 运行：node --import ./scripts/ts-hook.mts tests/smoke-snapshot-gitlab.test.ts
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
    url: 'https://gitlab.com/acme/project/-/issues/' + key,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
    closedAt: null,
    parentKey: null,
    labels: [],
    assignees: [],
  }, extra)
}

const root = mkdtempSync(path.join(os.tmpdir(), 'smoke-snapshot-gitlab-'))
try {
  mkdirSync(path.join(root, 'docs', 'agents'), { recursive: true })
  writeFileSync(path.join(root, 'docs', 'agents', 'workspace.yaml'), 'name: smoke-gitlab\n', 'utf8')
  const key = { workspaceRoot: root, backend: 'gitlab', repoIdentity: 'acme/project' }
  const repo = { backend: 'gitlab', refId: 'acme/project', name: 'project', url: 'https://gitlab.com/acme/project' } as any

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
  const snap: any = replay && replay.snapshot
  const maps: any[] = (snap && snap.maps) || []
  check(maps.length === 1 && String(maps[0].key) === '100', '容器树从库铺出')
  check(((maps[0] && maps[0].tickets) || []).length === 1, '子票按父子边挂在容器下')
  check(!!(snap && (snap.issues || []).some((x: any) => String(x.key) === '7')), '独立票从库铺出')

  const detail = await library.readIssueDetail(Object.assign({}, key, { key: '5' }))
  const groups: any = (detail && detail.issue && (detail.issue as any).groups) || {}
  check(!!groups.subIssues && groups.subIssues.reason === 'not-applicable', 'GitLab 没有的能力写成「不适用」，不冒充「确认没有」')
} finally {
  library.closeSnapshotLibraries()
  rmSync(root, { recursive: true, force: true })
}

if (failures) console.log('冒烟未通过')
// 完成记录：#1158 起链上执行器按这一行对数，没有它就判「跑到一半就收摊」。
printGateResult('smoke-snapshot-gitlab', total, failures)
process.exit(failures ? 1 : 0)
