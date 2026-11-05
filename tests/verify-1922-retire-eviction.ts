/**
 * tests/verify-1922-retire-eviction.ts —— 按需细节的淘汰机制退役门禁（#1922，规格 #1885）
 *
 * 守什么（票面验收逐条落在这里）：
 *   A 源码：淘汰规则模块、它在行级写回里的调用、「给行打淘汰时间戳」的键集合工具、
 *     evicted / evictedBytes 日志字段全部不存在；
 *   B 界面：只剩三态（有 / 确认没有 / 未取），「曾取过但被淘汰（曾于某时）」这一档与它的数据字段不存在，
 *     而「确认没有」与「还没取到」两句仍然分得开；
 *   C 库：快照库里没有任何容量淘汰路径（不设条数上限、不设字节上限、不按最近使用丢内容）；
 *   D 诊断：环境检查页的诊断读数能看见库文件字节数与票行数——真库上验证字节随写入变大、行数等于票数、
 *     关库重开后数据还在；读不到时如实写「—」，不编 0；
 *   E 文档：ADR、GLOSSARY、设计计划、快照库 README 与日志附录都写下了 2026-11-05 的决定——
 *     不设上限、不淘汰，库里的数据除非源头删除，否则不会消失；
 *   F 归属表：tests/gate-map.json 不再指向已删除的规则模块，本门禁在链上。
 *
 * 为什么用真 SQLite 临时库：D 段要回答「库文件字节数与票行数读得对不对」，
 * 内存替身盖住库就验不出「字节随写入变大、关库重开后行数还在」这两件事。
 * 其余各段是结构性断言：退役类工作没有运行时的调用可测，只能断言「这条路径已经不存在」。
 *
 * 判据自己能咬住吗：A/B/C 段的扫描函数都拿改坏的文本跑一遍负例（应为非空），
 * 再拿干净文本跑一遍（应为空）；D 段的读数函数也带「读不到」「字节数是负数」两条负例。
 *
 * 跑法：node --import ./scripts/ts-hook.mts tests/verify-1922-retire-eviction.ts
 */
// 门禁归属: src/workspace-snapshot/runtime/storage-stats.ts
// 门禁归属: src/refresh/rooms/host/row-patch.ts
// 门禁归属: src/client/views/shared/detailProjection.ts
// 门禁归属: src/client/views/ChecksTab.ts
// 门禁归属: src/client/views/shared/truthLines.ts
// 门禁归属: src/refresh/rooms/host/snapshot-read-channels.ts
// 门禁归属: src/refresh/rooms/host/snapshot-library-read.ts
// 门禁归属: docs/adr/20261030-panel-snapshot-single-source.md
// 门禁归属: GLOSSARY.md

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { printGateResult } from './lib/gate-result.ts'
import type { Issue, RepositoryRef } from '../src/tracker/contract/entities.ts'
import { openWorkspaceSnapshot } from '../src/workspace-snapshot/contract/index.ts'
import type { WorkspaceSnapshotHandle } from '../src/workspace-snapshot/contract/types.ts'
import { issueWritesOf } from '../src/refresh/rooms/host/snapshot-library-adapter.ts'
import {
  closeSnapshotLibraries,
  readLibraryStorageStats,
} from '../src/refresh/rooms/host/snapshot-library.ts'
import { createSnapshotReadChannels } from '../src/refresh/rooms/host/snapshot-read-channels.ts'
import { snapshotStoreStatsReadoutOf } from '../src/client/views/shared/truthLines.ts'

const GATE = 'verify-1922-retire-eviction'
const ROOT = process.cwd()
const REPO: RepositoryRef = {
  backend: 'github',
  refId: 'acme/widgets',
  name: 'acme/widgets',
  url: 'https://github.com/acme/widgets',
}
const NOW = 1762310000000

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

/** 递归列出目录下所有 .ts / .mts 源文件（仓库相对路径，斜杠统一）。 */
function sourceFiles(relDir: string): string[] {
  const out: string[] = []
  const stack: string[] = [path.join(ROOT, relDir)]
  while (stack.length) {
    const dir = stack.pop() as string
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name)
      if (statSync(full).isDirectory()) { stack.push(full); continue }
      if (!/\.(ts|mts)$/.test(name)) continue
      out.push(path.relative(ROOT, full).replace(/\\/g, '/'))
    }
  }
  return out.sort()
}

/**
 * 淘汰规则在源码里留下的名字：出现一个就是还没退役干净。
 * 只认这几个精确记号，不把「淘汰」当关键词全局扫——别的机制（视野模型、选择记忆、
 * 版本管理缓存）各有自己的容量上限，那些不在本票范围里。
 */
const RETIRED_SYMBOLS: RegExp = /detail-eviction|detailEvicted|detailTouchedAt|evictDetailsInSnapshot|DETAIL_EVICTION|EVICTABLE_CONTENT_FIELDS|evictForWrite|freshKeysOf/

/**
 * 扫一批「文件名 → 文本」里还带着某个模式的部分；返回 { 文件: [命中] } 便于失败时指到文件。
 * 把读文件这件事留给调用方传进来，负例就能直接喂一段改坏的假文本，不必在盘上造假文件。
 */
function scanHits(texts: Record<string, string>, pattern: RegExp): Record<string, string[]> {
  const hits: Record<string, string[]> = {}
  for (const file of Object.keys(texts)) {
    const found = texts[file].match(pattern)
    if (found) hits[file] = Array.from(new Set(found.map((f) => String(f))))
  }
  return hits
}

/** 读一组源文件的文本，交给 scanHits。 */
function scanFiles(files: string[], pattern: RegExp): Record<string, string[]> {
  const texts: Record<string, string> = {}
  for (const file of files) texts[file] = readFileSync(path.join(ROOT, file), 'utf8')
  return scanHits(texts, pattern)
}

function issueOf(key: string, title: string, extra?: Partial<Issue>): Issue {
  return Object.assign({
    key,
    effortId: '',
    type: 'issue',
    title,
    state: 'open',
    body: '',
    url: 'https://github.com/acme/widgets/issues/' + key,
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
    closedAt: null,
    parentKey: null,
    labels: [],
    assignees: [{ login: 'alice' }],
    blockedBy: [],
    isPullRequest: false,
  } as Issue, extra || {})
}

function makePhone(lib: any): any {
  return createSnapshotReadChannels({
    canonicalKey: async (c: unknown) => String(c),
    selectEarly: async () => ({ backendId: 'github', rev: 1 }),
    getTrackerRegistry: async () => ({ describe: () => REPO, modules: () => [], get: () => ({}) }),
    getSnapshotLibrary: async () => lib,
    getRepoKey: async () => ({ owner: 'acme', name: 'widgets' }),
    openSession: async () => null,
  } as any)
}

function writeRows(handle: WorkspaceSnapshotHandle, rows: Issue[]): number {
  const result = handle.ingest({ startMergeVersion: handle.getMergeVersion(), writes: issueWritesOf(rows, 'github') })
  if (!result.committed) throw new Error('写库失败：' + String(result.reason))
  return result.mergeVersion
}

async function run(): Promise<void> {
  console.log('按需细节淘汰机制退役门禁（#1922）')

  // ── A 源码：规则模块、调用、时间戳工具、日志字段都不在了 ──────────────────────
  {
    check(!existsSync(path.join(ROOT, 'src/refresh/kernel/detail-eviction.ts')),
      'A1 淘汰规则模块 src/refresh/kernel/detail-eviction.ts 已删除')

    const stale = scanFiles(sourceFiles('src'), RETIRED_SYMBOLS)
    check(Object.keys(stale).length === 0,
      'A2 全仓 src 里不再有淘汰规则的名字（模块名、调用、记号字段、时间戳工具）', stale)
    const dirty = scanHits({ 'fake/row-patch.ts': "import { evictDetailsInSnapshot } from '../../kernel/detail-eviction.js'\nconst x = evictForWrite(snap)\n" }, RETIRED_SYMBOLS)
    const clean = scanHits({ 'fake/row-patch.ts': 'const snap = merged.snapshot\n' }, RETIRED_SYMBOLS)
    check(Object.keys(dirty).length === 1 && Object.keys(clean).length === 0,
      'A3 负例自测：扫描判据认得出旧写法，干净文本不误报', { dirty, clean })

    const rowPatch = srcText('src/refresh/rooms/host/row-patch.ts')
    check(!/evicted|evictedBytes/.test(rowPatch),
      'A4 行级写回的日志里不再有 evicted / evictedBytes 两格')
    check(rowPatch.indexOf('detail-eviction') < 0 && rowPatch.indexOf('evictForWrite') < 0,
      'A5 行级写回不再 import 淘汰规则、也没有写回前淘汰的调用')

    const logFields = srcText('tests/verify-log-fields.ts')
    const patchLine = logFields.split(/\r?\n/).find((l) => l.indexOf("'refresh.patch':") >= 0) || ''
    check(patchLine.length > 0 && patchLine.indexOf("'evicted'") < 0 && patchLine.indexOf("'evictedBytes'") < 0,
      'A6 日志字段白名单的 refresh.patch 里没有淘汰两格（字段与实现同一步退役）', patchLine.slice(0, 240))
  }

  // ── B 界面：只剩三态，淘汰那一档与「曾取过」措辞都不在了 ──────────────────────
  {
    const proj = srcText('src/client/views/shared/detailProjection.ts')
    check(proj.indexOf('detailEvicted') < 0 && proj.indexOf("'evicted'") < 0 && proj.indexOf('detail.evictedAt') < 0,
      'B1 详情投影不再有「曾取过但被淘汰」这一档（记号字段、档位与文案键都不在）')
    const dirtyProj = scanHits({ proj: "if (snapIssue.detailEvicted) return { kind: 'evicted' }" }, /detailEvicted|'evicted'/)
    const cleanProj = scanHits({ proj: "return { kind: 'unknown', atMs: at }" }, /detailEvicted|'evicted'/)
    check(Object.keys(dirtyProj).length === 1 && Object.keys(cleanProj).length === 0,
      'B2 负例自测：界面里再出现淘汰档位会判红，正常三态不误报', { dirtyProj, cleanProj })
    check(proj.indexOf("kind: 'text'") >= 0 && proj.indexOf("kind: 'none'") >= 0
      && proj.indexOf("kind: 'unknown'") >= 0 && proj.indexOf("kind: 'loading'") >= 0,
      'B3 正文格仍是四档：有正文 / 确认没有 / 还没拿到 / 加载中')
    check(proj.indexOf('detail.bodyNotYet') >= 0 && proj.indexOf('detail.noBody') >= 0,
      'B4「还没拿到」与「确认没有」仍是两句话，必须分开画')

    const flow = srcText('config/copy/flow.yaml')
    check(flow.indexOf('detail.evictedAt') < 0, 'B5 词表两种语言都不再有「未取（曾在 {time}）」这一条')
    check(flow.indexOf('detail.noBody') >= 0 && flow.indexOf('detail.bodyNotYet') >= 0 && flow.indexOf('detail.lastKnownData') >= 0,
      'B6 三态与「上次数据」几句照旧留在词表里')

    const detail = srcText('src/client/views/IssueDetail.ts')
    check(detail.indexOf('proj.bodySlot') >= 0 && !/被淘汰/.test(detail),
      'B7 详情页只按投影的正文格画，注释里也不再提「被淘汰」')
  }

  // ── C 库：没有任何容量淘汰路径 ────────────────────────────────────────────────
  {
    const libFiles = sourceFiles('src/workspace-snapshot')
    const evictHits = scanFiles(libFiles, /evict|淘汰|maxEntries|maxBytes/i)
    check(Object.keys(evictHits).length === 0,
      'C1 快照库里没有容量淘汰路径（不设条数上限、不设字节上限、不按最近使用丢内容）', evictHits)
    const dirtyLib = scanHits({ lib: 'function evictDetails() { maxEntries = 200 }' }, /evict|淘汰|maxEntries|maxBytes/i)
    check(Object.keys(dirtyLib).length === 1, 'C2 负例自测：库里再长出容量淘汰路径会判红', dirtyLib)
    check(libFiles.length > 0 && libFiles.some((f) => f.indexOf('projection/list.ts') >= 0),
      'C3 扫描覆盖到了库的读写层（不是空目录上假绿）')
    const readme = srcText('src/workspace-snapshot/README.md')
    check(readme.indexOf('2026-11-05') >= 0 && readme.indexOf('不设上限') >= 0 && readme.indexOf('不淘汰') >= 0,
      'C4 快照库 README 写明 2026-11-05 起不设上限、不淘汰')
  }

  // ── D 诊断：真库上的库文件字节数与票行数 ──────────────────────────────────────
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'verify-1922-'))
  try {
    mkdirSync(path.join(tempRoot, 'docs', 'agents'), { recursive: true })
    writeFileSync(path.join(tempRoot, 'docs', 'agents', 'workspace.yaml'), 'name: verify-1922' + String.fromCharCode(10), 'utf8')
    const dbPath = path.join(tempRoot, '.dsh-mattskillsdeck-cache', 'snapshot', 'github.sqlite')

    closeSnapshotLibraries()
    let empty: any = null
    let three: any = null
    let seven: any = null
    {
      const opened = openWorkspaceSnapshot({ workspaceRoot: tempRoot, backend: 'github', repoIdentity: REPO.refId, now: () => NOW })
      const handle = opened.handle
      try {
        empty = handle.readStorageStats()
        writeRows(handle, [issueOf('1', '票 1'), issueOf('2', '票 2'), issueOf('3', '票 3')])
        three = handle.readStorageStats()
        writeRows(handle, [
          issueOf('4', '票 4', { body: '正文'.repeat(200) }),
          issueOf('5', '票 5', { body: '正文'.repeat(200) }),
          issueOf('6', '票 6', { body: '正文'.repeat(200) }),
          issueOf('7', '票 7', { body: '正文'.repeat(200) }),
        ])
        seven = handle.readStorageStats()
      } finally {
        try { handle.close() } catch { /* 已关 */ }
      }
    }
    check(empty && empty.rows === 0 && empty.bytes > 0, 'D1 空库也有字节数（主文件已在盘上），票行数为 0', empty)
    check(three && three.rows === 3 && three.bytes > empty.bytes,
      'D2 写三张票之后票行数是 3，字节数跟着变大（看得见增长）', three)
    check(seven && seven.rows === 7 && seven.bytes > three.bytes,
      'D3 再写四张带正文的票：行数 7、字节继续变大——库不会因为变大而丢内容', seven)
    check(existsSync(dbPath), 'D4 读数对着的就是工作区里那个 .sqlite 库文件')

    const reopened = openWorkspaceSnapshot({ workspaceRoot: tempRoot, backend: 'github', repoIdentity: REPO.refId, now: () => NOW })
    let afterReopen: any = null
    try { afterReopen = reopened.handle.readStorageStats() } finally { try { reopened.handle.close() } catch { /* 已关 */ } }
    // 字节总数在关库时会因 WAL 落回主文件而略有变化，所以这里只判「读数照常、票一行没少」；
    // 主文件本身必须真的在盘上（否则读数就是编出来的）。
    check(afterReopen && afterReopen.rows === 7 && afterReopen.bytes > 0 && statSync(dbPath).size > 0,
      'D5 关库重开之后票行数仍是 7，库文件与字节数照常读得到（数据不因容量自行消失）', afterReopen)

    const at0 = snapshotStoreStatsReadoutOf({ bytes: 0, rows: 0 })
    const at15 = snapshotStoreStatsReadoutOf({ bytes: 1536, rows: 7 })
    const atOne = snapshotStoreStatsReadoutOf({ bytes: 1048576, rows: 0 })
    check(at0.ok === true && at0.bytesText === '0 B' && at0.rowsText === '0',
      'D6 读数为 0 时如实写 0（0 是合法的字节数与行数）', { bytes: at0.bytesText, rows: at0.rowsText })
    check(at15.bytesText === '1.5 KB' && at15.rowsText === '7', 'D7 字节数折算成人读单位，行数原样显示', at15.bytesText)
    check(atOne.bytesText === '1 MB', 'D8 整兆不带多余的小数位', atOne.bytesText)
    const missing = snapshotStoreStatsReadoutOf({ ok: false, error: '库打不开' })
    const brokenBytes = snapshotStoreStatsReadoutOf({ bytes: -1, rows: 3 })
    check(missing.ok === false && missing.bytesText === '—' && missing.rowsText === '—',
      'D9 读不到库占用时诊断读数如实写「—」，不编一个 0', missing)
    check(brokenBytes.ok === false && brokenBytes.bytesText === '—',
      'D10 负例：字节数不是非负整数时同样写「—」', brokenBytes)

    // 宿主电话：与库里的读数逐项相等
    const lib = {
      readLibraryVersion: async () => {
        const stats: any = await readLibraryStorageStats({ workspaceRoot: tempRoot, backend: 'github', repoIdentity: REPO.refId })
        return stats && stats.version
      },
      readLibraryChangeSet: async () => null,
      readLibraryStorageStats,
    }
    const phone = makePhone(lib)
    const reply: any = await phone.handleSnapshotStoreStats({ cwd: tempRoot })
    const direct: any = await readLibraryStorageStats({ workspaceRoot: tempRoot, backend: 'github', repoIdentity: REPO.refId })
    const replyKeys = Object.keys(reply || {}).sort().join(',')
    check(reply && replyKeys === 'backend,bytes,rows,version,workspaceKey',
      'D11 诊断电话回包带版本、字节数、票行数、工作区键与后端五格', replyKeys)
    check(reply && direct && reply.bytes === direct.bytes && reply.rows === direct.rows && reply.version === direct.version,
      'D12 电话回的字节数、票行数与版本就是库里的读数', { reply, direct })
    check(reply && reply.rows === 7 && reply.bytes > 0, 'D13 电话读数与真库对得上（7 张票）', reply)
    const failedReply: any = await phone.handleSnapshotStoreStats({})
    check(failedReply && failedReply.ok === false && snapshotStoreStatsReadoutOf(failedReply).bytesText === '—',
      'D14 没有工作区时电话如实失败，读数写「—」，不冒充 0', failedReply)

    const checks = srcText('src/client/views/ChecksTab.ts')
    check(checks.indexOf('wf.snapshotStoreStats') >= 0 && checks.indexOf('snapshotStoreStatsReadoutOf') >= 0,
      'D15 环境检查页的诊断读数调这条电话，并用同一个读数函数')
    check(checks.indexOf('env.diagLibraryBytes') >= 0 && checks.indexOf('env.diagLibraryRows') >= 0,
      'D16 诊断读数把库文件字节数与票行数两行都画出来')
    const panelCopy = srcText('config/copy/panel.yaml')
    const countOf = (needle: string): number => panelCopy.split(needle).length - 1
    check(countOf('env.diagLibraryBytes') === 2 && countOf('env.diagLibraryRows') === 2,
      'D17 两个文案键在中英词表里各有且只有一份')
    const hostSrc = srcText('src/host/index.ts')
    check(hostSrc.indexOf("'wf.snapshotStoreStats'") >= 0 && hostSrc.indexOf('snapshot-read-channels.js') >= 0,
      'D18 宿主入口注册了这条诊断电话，并接进同一个读口模块')

    // ── E 文档：写下 2026-11-05 的决定 ──────────────────────────────────────────
    const adr = srcText('docs/adr/20261030-panel-snapshot-single-source.md')
    // §2.5 是这条决定的正文；变更记录里会引用旧规则说明它被废止，所以「旧口径不成立」只对正文判。
    const adrSection = (adr.split('### 2.5')[1] || '').split('### 2.6')[0]
    check(adr.indexOf('2026-11-05') >= 0 && adrSection.indexOf('不设上限') >= 0 && adrSection.indexOf('不淘汰') >= 0,
      'E1 ADR 记下 2026-11-05 起按需细节不设上限、不淘汰')
    check(adrSection.indexOf('除非源头被删除') >= 0 && adrSection.indexOf('超出按最近使用淘汰') < 0 && adrSection.indexOf('要有上限') < 0,
      'E2 ADR 正文写明数据只在源头删除时消失，旧的「超出按最近使用淘汰」已不成立', adrSection.length)

    const glossary = srcText('GLOSSARY.md')
    const detailLine = glossary.split(/\r?\n/).find((l) => l.indexOf('- **按需细节（') >= 0) || ''
    check(detailLine.length > 0 && detailLine.indexOf('2026-11-05') >= 0 && detailLine.indexOf('不设上限') >= 0,
      'E3 术语表「按需细节」词条写明 2026-11-05 起不设上限、不淘汰')
    check(detailLine.indexOf('源头') >= 0 && detailLine.indexOf('字节数') >= 0 && detailLine.indexOf('按最近使用淘汰') < 0 && detailLine.indexOf('曾取过') < 0,
      'E4 术语表写明数据只在源头删除时消失，并指向诊断读数里的字节数', detailLine.slice(0, 160))

    const plan = srcText('docs/design/20261030-panel-snapshot-and-room-layering-plan.md')
    check(plan.indexOf('2026-11-05') >= 0 && plan.indexOf('废止') >= 0,
      'E5 设计计划里「按需细节要有上限、超出按最近使用淘汰」已标注废止（带日期与理由）')

    const appendix = srcText('research/489-appendix.md')
    const patchRow = appendix.split(/\r?\n/).find((l) => l.indexOf('| 82 | refresh.patch |') >= 0) || ''
    check(patchRow.length > 0 && patchRow.indexOf('evicted') < 0,
      'E6 日志附录的 refresh.patch 字段表不再列淘汰两格（附录与实现同步）')
    check(appendix.indexOf('#1922') >= 0 && appendix.indexOf('2026-11-05') >= 0,
      'E7 日志附录留了一条 2026-11-05（#1922）的修订记录')

    // ── F 归属表 ────────────────────────────────────────────────────────────────
    const gateMap: any = JSON.parse(srcText('tests/gate-map.json'))
    const gates: any[] = Array.isArray(gateMap.gates) ? gateMap.gates : []
    const staleGuards = gates.filter((g: any) => Array.isArray(g.guards) && g.guards.indexOf('src/refresh/kernel/detail-eviction.ts') >= 0)
    check(staleGuards.length === 0, 'F1 门禁归属表不再指向已删除的淘汰规则模块', staleGuards.map((g: any) => g.file))
    const self = gates.find((g: any) => g && g.file === 'tests/verify-1922-retire-eviction.ts')
    check(!!self && self.completionRecord === true && self.expectedAssertions > 0,
      'F2 本门禁在链上且已登记完成记录与断言条数', self && { completionRecord: self.completionRecord, expectedAssertions: self.expectedAssertions })
    check(gates.some((g: any) => g && g.file === 'tests/verify-1692-disk-replay-eviction.ts'),
      'F3 磁盘快照退役那扇门禁还在链上（只把淘汰段退役，别的判据不跟着丢）')
  } finally {
    closeSnapshotLibraries()
    try { rmSync(tempRoot, { recursive: true, force: true }) } catch { /* 临时目录清不掉不影响结论 */ }
  }
}

run().then(() => {
  console.log('')
  console.log(failed ? '存在失败 — ' + GATE + ' 未通过' : '全部通过 — 按需细节淘汰机制退役门禁生效（' + total + ' 项断言）')
  printGateResult(GATE, total, failed)
  process.exit(failed ? 1 : 0)
}).catch((e) => {
  console.log('门禁执行异常：' + (e && e.stack ? e.stack : String(e)))
  printGateResult(GATE, total, 1)
  process.exit(1)
})
