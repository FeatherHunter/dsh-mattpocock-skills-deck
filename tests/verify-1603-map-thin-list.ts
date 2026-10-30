/**
 * tests/verify-1603-map-thin-list.ts —— #1603（地图清单一次取全：大仓十秒回地图薄行）门禁。
 *
 * 为什么要有这一条：deck_context 今天取地图走全量 list 再内存过滤（#1598：597 票 + 193 PR，
 * 实测 163.9 秒撞预算超时）。本票新开一条只取地图的路：服务端按标签筛、内存二次校验取交集、
 * 一次翻完、按更新时间重排。本文件把这条路钉住。
 *
 * 做法：行为断言 —— 给仓库，直接调房间的新模块 listMaps，执行器换成桩（按游标发 canned
 * GraphQL 回包），不断言内部实现，只断言外部行为：行数、字段、顺序、总数口径、失败语义。
 * 设计 decisions（与票面一一对应）：
 *   一、只收仓库：状态 OPEN + CLOSED 写死、标签写死小写 wayfinder:map、时间窗口空。
 *   二、服务端筛 + 内存小写二次校验取交集（大小写标签都算地图，与 list 旧路同口径）。
 *   三、页内按创建时间倒序翻（复用 listPage 的查询），交出前按更新时间重排。
 *   四、封顶 10 页（100 行一页、上限约 1000 行，与子票 1000 行硬上限同量级）：超顶截断如实说。
 *   五、单页失败整趟失败，不交半截数据；超时与传输失败不回落（只做 unsupported 回落，不在本文件）。
 *
 * 用法：node --import ./scripts/ts-hook.mts tests/verify-1603-map-thin-list.ts（在插件根目录）
 */
import { listMaps } from '../src/tracker/rooms/github/read/maps.ts'

let failed = false
let total = 0
const check = (ok: unknown, msg: string): void => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

console.log('#1603 门禁（地图清单一次取全：行数/字段/顺序/总数口径/失败语义）')

const REPO: any = { backend: 'github', refId: 'acme/demo', name: 'demo', url: '' }

/** GraphQL 薄片段形状的节点：number/title/state/url/createdAt/updatedAt/labels。 */
function node(n: number, title: string, state: string, labels: string[], updatedAt: string, createdAt: string): any {
  return {
    number: n, title, state, url: 'https://github.com/acme/demo/issues/' + n,
    createdAt, updatedAt, author: { login: 'u' }, assignees: { nodes: [] },
    labels: { nodes: labels.map((name: string) => ({ name, color: 'ccc' })) },
  }
}

function gqlPage(nodes: any[], totalCount: number, hasNextPage: boolean, endCursor: string | null): string {
  return JSON.stringify({
    data: { repository: { issues: { totalCount, nodes, pageInfo: { hasNextPage, endCursor } } } },
  })
}

/** 按游标发回包的桩执行器：cursorToBody 把 after 游标映射到回包体；落账每次 argv。 */
function stubExec(calls: any[], cursorToBody: (after: string) => { stdout: string; stderr?: string; code?: number } | { fail: true }): any {
  return async (_cmd: string, args: string[], _opts: any): Promise<any> => {
    calls.push(args)
    let after = ''
    for (let i = 0; i + 1 < args.length; i++) {
      if (args[i] === '-F' && typeof args[i + 1] === 'string' && args[i + 1].indexOf('after=') === 0) after = args[i + 1].slice('after='.length)
    }
    const r = cursorToBody(after)
    if ((r as any).fail) return { stdout: '', stderr: 'boom', code: 1 }
    return { stdout: (r as any).stdout, stderr: (r as any).stderr || '', code: (r as any).code != null ? (r as any).code : 0 }
  }
}

function stubCtx(exec: any): any {
  return {
    cwd: '/ws',
    platform: { resolveExecutable: async (): Promise<string> => 'gh' },
    exec,
    outbound: {
      acquire: async (): Promise<() => void> => (() => {}),
      isCancelled: (): boolean => false,
      noteWrite: (): void => {},
      reportTransportFailure: (): void => {},
      reportSuccess: (): void => {},
    },
  }
}

function argvHas(args: string[], flag: string, value: string): boolean {
  for (let i = 0; i + 1 < args.length; i++) { if (args[i] === flag && args[i + 1] === value) return true }
  return false
}

const mapA = node(3, '地图 A', 'OPEN', ['wayfinder:map'], '2026-10-01T00:00:00Z', '2026-10-05T00:00:00Z')
const mapB = node(2, '地图 B', 'OPEN', ['wayfinder:map'], '2026-10-03T00:00:00Z', '2026-10-04T00:00:00Z')
const mapC = node(1, '地图 C', 'CLOSED', ['WAYFINDER:MAP'], '2026-10-02T00:00:00Z', '2026-10-03T00:00:00Z')
const notMap = node(4, '普通票', 'OPEN', ['bug'], '2026-10-06T00:00:00Z', '2026-10-06T00:00:00Z')

// ── 一、两页收齐：行数/字段/顺序/总数口径/发包口径 ──
{
  const calls: any[] = []
  const exec = stubExec(calls, (after: string) => {
    if (!after) return { stdout: gqlPage([mapA, notMap], 3, true, 'C1') }
    return { stdout: gqlPage([mapB, mapC], 3, false, null) }
  })
  const r = await listMaps(REPO, stubCtx(exec))
  check(r && r.ok === true, '两页都拿到时回成功')
  const rows = (r && (r as any).data && (r as any).data.rows) || []
  check(rows.length === 3, '两页的地图都收齐了（普通票被筛掉，3 行）')
  check(rows.map((x: any) => x.key).join(',') === '2,1,3', '交出前按更新时间倒序重排（更新序 B,C,A，不是创建序 A,B,C）')
  const keysOk = rows.every((x: any) => JSON.stringify(Object.keys(x).sort()) === '["key","state","title","url"]')
  check(keysOk, '薄行只有 key/title/state/url 四格（不带正文评论，不问 PR）')
  check(rows.some((x: any) => x.key === '1' && x.state === 'closed'), '已关闭地图不缺席（CLOSED 在内）')
  check(rows.some((x: any) => x.key === '1' && x.title === '地图 C'), '大写标签的地图也在内（内存二次校验不区分大小写）')
  check((r as any).data.total === 3, '总数口径 = 地图总数（3），不是页数也不是全仓票数')
  check((r as any).data.truncated === false, '没超顶时 truncated 为假')
  const first = calls[0] || []
  check(argvHas(first, '-F', 'states[]=OPEN') && argvHas(first, '-F', 'states[]=CLOSED'), '发包写死两种状态（OPEN + CLOSED）')
  check(argvHas(first, '-F', 'labels[]=wayfinder:map'), '发包带小写地图标签做服务端筛')
  check(first.every((a: string) => a.indexOf('since=') !== 0), '时间窗口是空的（不带 since）')
  check(first.some((a: string) => a.indexOf('CREATED_AT') >= 0), '翻页按创建时间倒序走（复用 listPage 查询口径）')
}

// ── 二、封顶截断：永远有下一页时停得下来、如实说 ──
{
  const calls: any[] = []
  let n = 0
  const exec = stubExec(calls, (after: string) => {
    n += 1
    return { stdout: gqlPage([node(1000 + n, 'm' + n, 'OPEN', ['wayfinder:map'], '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z')], 2500, true, 'C' + n) }
  })
  const r = await listMaps(REPO, stubCtx(exec))
  check(r && r.ok === true, '超顶时仍然回成功（不是失败）')
  check((r as any).data.truncated === true, '超顶时 truncated 为真（如实说没拿全）')
  check(calls.length === 10, '最多翻 10 页就停（' + calls.length + ' 次服务端往返）')
  check((r as any).data.total === 2500, '总数口径仍是服务端报的地图总数（2500），不是已拿回的行数')
}

// ── 三、单页失败整趟失败：不交半截数据，不回落 ──
{
  const calls: any[] = []
  const exec = stubExec(calls, (after: string) => {
    if (!after) return { stdout: gqlPage([mapA], 2, true, 'C1') }
    return { fail: true }
  })
  const r = await listMaps(REPO, stubCtx(exec))
  check(r && r.ok === false, '第二页传输失败时整趟失败')
  check(!(r && (r as any).data && (r as any).data.rows), '失败时不交半截数据（第一页拿到的也不交）')
  const allGraphql = calls.every((a: string[]) => a[0] === 'api' && a[1] === 'graphql')
  check(allGraphql, '传输失败不走 REST 回落（每次往返都是 GraphQL）')
}

// ── 四、仓库坐标形坏：直接失败，不发包 ──
{
  const calls: any[] = []
  const exec = stubExec(calls, () => ({ stdout: gqlPage([], 0, false, null) }))
  const r = await listMaps({ backend: 'github', refId: '', name: '', url: '' }, stubCtx(exec))
  check(r && r.ok === false, '仓库坐标形坏时回失败')
  check(calls.length === 0, '坐标形坏时一次服务端往返都不做')
}

// ── 五、空仓：一页零节点，成功空行 ──
{
  const calls: any[] = []
  const exec = stubExec(calls, () => ({ stdout: gqlPage([], 0, false, null) }))
  const r = await listMaps(REPO, stubCtx(exec))
  check(r && r.ok === true, '空仓回成功')
  check(((r && (r as any).data && (r as any).data.rows) || []).length === 0, '空仓行数是 0')
  check((r as any).data.total === 0 && (r as any).data.truncated === false, '空仓总数 0、不截断')
}

console.log('共 ' + total + ' 条，' + (failed ? '有失败' : '全过'))
if (failed) process.exit(1)
