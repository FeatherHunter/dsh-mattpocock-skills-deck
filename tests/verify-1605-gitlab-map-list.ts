/**
 * #1605 GitLab 房 listMaps（地图薄查）门禁：真实现的三条验收。
 * 做法是 TDD：本文件先行（RED），实现住 src/tracker/rooms/gitlab/maps.ts。
 * 桩把 glab api 按页喂给实现：第一页 100 行才翻页、不足 100 即停、
 * 最多翻 10 页（与 GitHub 房 PAGINATION.github.mapListMaxPages 同数，见契约注释）。
 */
import { listMaps } from '../src/tracker/rooms/gitlab/maps.ts'

let failures = 0
function check(cond: unknown, msg: string) {
  if (cond) console.log('ok: ' + msg)
  else { failures++; console.error('FAIL: ' + msg) }
}

type CannedPage = { rows?: unknown[]; code?: number; stderr?: string }

function issue(iid: number, title: string, state: string, labelNames: string[], updatedAt: string) {
  return {
    iid, id: 1000 + iid, title, state,
    labels: labelNames.map((n) => ({ name: n })),
    web_url: 'https://gitlab.example/g/p/-/issues/' + iid,
    created_at: '2026-10-01T00:00:00Z',
    updated_at: updatedAt,
  }
}

/** 最小 glab 执行桩：按 page 参数回 canned 页，记下每次命中的路径。 */
function stubExec(pages: CannedPage[], seenPaths: string[]) {
  return async (_cmd: string, args: string[], _opts: unknown) => {
    const apiPath = String(args[1] || '')
    seenPaths.push(apiPath)
    const query = apiPath.split('?')[1] || ''
    const page = Number(new URLSearchParams(query).get('page') || '1')
    const canned = pages[page - 1] || { rows: [] }
    if ((canned.code || 0) !== 0) return { stdout: '', stderr: canned.stderr || 'boom', code: canned.code || 1 }
    return { stdout: JSON.stringify(canned.rows || []), stderr: '', code: 0 }
  }
}

function makeCtx(execFn: unknown) {
  return {
    cwd: '/ws-test-1605',
    signal: undefined,
    platform: {
      resolveExecutable: async () => '/usr/bin/glab',
      path: { join: (...a: string[]) => a.join('/') },
      fs: {},
      env: {},
    },
    fs: null,
    exec: execFn,
    timers: {},
    logEvent() {},
    isEnabled() { return false },
    gate: null,
  }
}

const REPO = { refId: 'g/p', backend: 'gitlab' }

console.log('== 一、只收地图：服务端筛 + 内存复核的交集 ==')
{
  const seen: string[] = []
  const pages = [{
    rows: [
      issue(7, '地图七', 'opened', ['Wayfinder:Map'], '2026-10-20T00:00:00Z'),
      issue(3, '地图三', 'closed', ['wayfinder:map'], '2026-10-25T00:00:00Z'),
      // 诱饵：服务器万一没筛掉，内存复核必须丢掉它（它还最新，排第一就会露馅）。
      issue(9, '普通票', 'opened', ['bug'], '2026-10-27T00:00:00Z'),
    ],
  }]
  const r = await listMaps(REPO as never, makeCtx(stubExec(pages, seen)) as never) as {
    ok: boolean; data?: { rows: { key: string; title: string; state: string; url: string }[]; total: number; truncated: boolean }; error?: { kind: string; message: string }
  }
  check(r.ok === true, '薄查成功')
  const rows = (r.data && r.data.rows) || []
  check(rows.length === 2, '只回两张地图，诱饵被内存复核丢掉')
  check(rows.map((x) => x.title).join('|') === '地图三|地图七', '按更新时间倒序（新的在前）')
  check(rows.map((x) => x.key).join('|') === '3|7', 'key 取 iid')
  check(rows.map((x) => x.state).join('|') === 'closed|open', 'opened/closed 压成两态')
  check(rows.every((x) => x.url.indexOf('/issues/') >= 0), '每行都带可点的 url')
  check(((r.data && r.data.total) || -1) === 2, 'total 是服务端回来的行数')
  check((r.data && r.data.truncated) === false, '一页就够，truncated 为假')
  const q = new URLSearchParams((seen[0] || '').split('?')[1] || '')
  check(q.get('labels') === 'wayfinder:map', '服务端先筛一遍（labels=wayfinder:map）')
  check(q.get('state') === 'all', '两档状态都要（state=all，缺省只回开着的）')
  check(q.get('per_page') === '100', '一页 100 行')
}

console.log('== 二、翻页：满 100 才翻，不满即停 ==')
{
  const seen: string[] = []
  const full = []
  for (let i = 1; i <= 100; i++) full.push(issue(i, '地图' + i, 'opened', ['wayfinder:map'], '2026-10-10T00:00:00Z'))
  const pages = [{ rows: full }, { rows: [issue(1001, '尾页一张', 'opened', ['wayfinder:map'], '2026-10-26T00:00:00Z')] }]
  const r = await listMaps(REPO as never, makeCtx(stubExec(pages, seen)) as never) as { ok: boolean; data?: { rows: unknown[]; total: number; truncated: boolean } }
  check(r.ok === true, '两页都成功')
  check(((r.data && r.data.rows.length) || -1) === 101, '两页拼成 101 行')
  check(seen.length === 2, '只打了两次服务端')
  check((r.data && r.data.truncated) === false, '没撞上限，truncated 为假')
}

console.log('== 三、上限：10 页封顶，多了截断不明说谎 ==')
{
  const seen: string[] = []
  const pages: CannedPage[] = []
  for (let p = 0; p < 11; p++) {
    const rows = []
    for (let i = 1; i <= 100; i++) rows.push(issue(p * 100 + i, '图' + (p * 100 + i), 'opened', ['wayfinder:map'], '2026-10-10T00:00:00Z'))
    pages.push({ rows })
  }
  const r = await listMaps(REPO as never, makeCtx(stubExec(pages, seen)) as never) as { ok: boolean; data?: { rows: unknown[]; total: number; truncated: boolean } }
  check(r.ok === true, '撞上限不断趟')
  check(seen.length === 10, '最多翻 10 页')
  check(((r.data && r.data.rows.length) || -1) === 1000, '10 页共 1000 行')
  check((r.data && r.data.truncated) === true, '撞上限必须挂 truncated=true，不装全了')
}

console.log('== 四、单页失败整趟失败：不回半份 ==')
{
  const seen: string[] = []
  const full = []
  for (let i = 1; i <= 100; i++) full.push(issue(i, '地图' + i, 'opened', ['wayfinder:map'], '2026-10-10T00:00:00Z'))
  const pages: CannedPage[] = [{ rows: full }, { code: 1, stderr: 'connection reset by peer' }]
  const r = await listMaps(REPO as never, makeCtx(stubExec(pages, seen)) as never) as { ok: boolean; error?: { kind: string; message: string } }
  check(r.ok === false, '第二页传输失败，整趟失败')
  check(!!(r.error && r.error.message), '报错说清哪一环断了')
  check(!r.error || String(r.error.kind) !== 'unsupported', '传输失败不是不支持，不许走老路回落')
}

console.log('== 五、超时与执行器抛错：老实报错，不回落 ==')
{
  const timeoutExec = async () => ({ stdout: '', stderr: 'timeout after 30000ms', code: 1 })
  const r1 = await listMaps(REPO as never, makeCtx(timeoutExec) as never) as { ok: boolean; error?: { kind: string } }
  check(r1.ok === false, '超时整趟失败')
  check(!r1.error || String(r1.error.kind) !== 'unsupported', '超时不是不支持')
  const throwingExec = async () => { throw new Error('spawn glab ENOENT') }
  const r2 = await listMaps(REPO as never, makeCtx(throwingExec) as never) as { ok: boolean; error?: { kind: string } }
  check(r2.ok === false, '执行器抛错整趟失败')
  check(!r2.error || String(r2.error.kind) !== 'unsupported', '执行器故障不是不支持')
}

if (failures > 0) { console.error('verify-1605-gitlab-map-list: ' + failures + ' 处未过'); process.exit(1) }
else console.log('verify-1605-gitlab-map-list: 全过')