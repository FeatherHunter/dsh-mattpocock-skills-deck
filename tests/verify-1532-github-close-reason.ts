import { createOutboundControl } from '../src/refresh/rooms/host/outbound-control.ts'
import { closeIssue } from '../src/tracker/rooms/github/issues-write.ts'

// tests/verify-1532-github-close-reason.ts —— #1532 专属门禁：GitHub 后端自由文本关闭原因不再塞进 --reason
//
// 门禁归属: src/tracker/rooms/github/issues-write.ts
//
// 用法：node --import ./scripts/ts-hook.mts tests/verify-1532-github-close-reason.ts
//
// 为什么要有这一页：gh issue close --reason 只认三个固定值（completed / not planned / duplicate），
// 自由中文长句原样塞进去必失败（invalid argument ... valid values are {completed|not planned|duplicate}），
// 票关不掉。修法是自由文本走评论留痕、固定选项只传放行值。这一页用脚本化的 gh（不打真网）钉住三件事：
//   一、自由文本不再被塞进 --reason（close 那一笔的 --reason 只能是三个固定值之一）；
//   二、自由文本原样落进评论（body 一个字不改），先评论后关票；
//   三、固定值本身直通（duplicate / not planned / not_planned 不发评论），没原因时不带 --reason。

let failures = 0
let total = 0
function check(ok: unknown, label: string, extra?: unknown): void {
  total += 1
  if (ok) { console.log('  PASS ' + label); return }
  failures += 1
  console.log('  FAIL ' + label + (extra !== undefined ? ' —— 实得 ' + JSON.stringify(extra) : ''))
}

const REPO = { backend: 'github', refId: 'acme/demo', name: 'demo', url: '' } as any
const FREE = '两处都已修复并提交 fc16fb28；tour 文档更大面积漂移转 #1531。'
const ALLOWED = ['completed', 'not planned', 'duplicate']

function mkWorld() {
  const asked: string[][] = []
  const commentBodies: string[] = []
  const closeReasons: (string | null)[] = []
  const exec = async (cmd: string, args: string[], _opts?: unknown) => {
    asked.push([cmd, ...args])
    const a = args.join('\u0001')
    // 评论 POST：api repos/.../issues/<n>/comments
    if (args[0] === 'api' && /\/comments$/.test(args[1] || '')) {
      const f = args.find((x) => x.startsWith('body=')) || 'body='
      const body = f.slice('body='.length)
      commentBodies.push(body)
      const payload = { id: 99, body: body, user: { login: 'tester' }, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }
      return { code: 0, stdout: JSON.stringify(payload), stderr: '' }
    }
    // 关票：issue close <k> --repo o/n [--reason X]
    if (args[0] === 'issue' && args[1] === 'close') {
      const at = args.indexOf('--reason')
      const v = at >= 0 ? args[at + 1] : null
      closeReasons.push(v)
      // 假 gh 按真 gh 行为回放：--reason 只认三个固定值，其余一律报错
      if (v !== null && !ALLOWED.includes(v)) {
        return { code: 1, stdout: '', stderr: 'invalid argument "' + v + '" for "-r, --reason" flag: valid values are {completed|not planned|duplicate}' }
      }
      return { code: 0, stdout: '', stderr: '' }
    }
    // 写后读回：issue view <k> --repo o/n --json ...
    if (args[0] === 'issue' && args[1] === 'view') {
      const n = Number(args[2]) || 7
      const payload = { number: n, title: 't' + n, state: 'CLOSED', body: '', url: 'u', updatedAt: '2026-01-01T00:00:00Z', createdAt: '2026-01-01T00:00:00Z', closedAt: '2026-01-01T00:00:00Z', labels: { nodes: [] }, assignees: { nodes: [] } }
      return { code: 0, stdout: JSON.stringify(payload), stderr: '' }
    }
    return { code: 1, stdout: '', stderr: 'unexpected call ' + a.slice(0, 200) }
  }
  const ctx = { cwd: '/ws/fake', outbound: createOutboundControl(), platform: { resolveExecutable: async (_n: string) => 'gh' }, exec, isEnabled: () => false, logEvent: () => {} } as any
  return { asked, commentBodies, closeReasons, ctx }
}

async function main(): Promise<void> {
  console.log('1532 github close reason with fake gh replay')

  // 一、自由文本：一次成功，原因进评论，--reason 只带放行值
  {
    const w = mkWorld()
    const r: any = await closeIssue(REPO, '7', { reason: FREE }, w.ctx)
    check(r && r.ok === true, '一.1 自由文本 + 关票一次成功', r && (r.error || r.data))
    check(w.commentBodies.length === 1 && w.commentBodies[0] === FREE, '一.2 自由文本原样进评论（一个字不改）', w.commentBodies)
    check(w.closeReasons.length === 1 && ALLOWED.includes(w.closeReasons[0] as string), '一.3 close 那一笔的 --reason 是固定值', w.closeReasons)
    check(!(w.closeReasons[0] === FREE), '一.4 自由文本没有被塞进 --reason', w.closeReasons)
    check(r && r.ok && r.data && r.data.reason === FREE, '一.5 返回票里原因仍是原话（没被固定值覆盖）', r && r.data && r.data.reason)
    check(r && r.ok && r.data && String(r.data.state).toLowerCase() === 'closed', '一.6 票是关闭状态', r && r.data && r.data.state)
  }

  // 二、固定值直通：duplicate 不发评论
  {
    const w = mkWorld()
    const r: any = await closeIssue(REPO, '7', { reason: 'duplicate' }, w.ctx)
    check(r && r.ok === true, '二.1 duplicate 直通成功', r && r.error)
    check(w.commentBodies.length === 0, '二.2 固定值不发评论', w.commentBodies)
    check(w.closeReasons.length === 1 && w.closeReasons[0] === 'duplicate', '二.3 --reason 原样透传 duplicate', w.closeReasons)
  }

  // 三、not_planned 与大小写：归一成 gh 认得的 not planned，不发评论
  {
    const w = mkWorld()
    const r: any = await closeIssue(REPO, '7', { reason: 'not_planned' }, w.ctx)
    check(r && r.ok === true, '三.1 not_planned 成功', r && r.error)
    check(w.commentBodies.length === 0, '三.2 下划线写法不发评论', w.commentBodies)
    check(w.closeReasons.length === 1 && w.closeReasons[0] === 'not planned', '三.3 归一成 not planned', w.closeReasons)
  }
  {
    const w = mkWorld()
    const r: any = await closeIssue(REPO, '7', { reason: 'Completed' }, w.ctx)
    check(r && r.ok === true, '三.4 Completed 大小写成功', r && r.error)
    check(w.commentBodies.length === 0, '三.5 大小写固定值不发评论', w.commentBodies)
  }

  // 四、没原因：不带 --reason，不发评论
  {
    const w = mkWorld()
    const r: any = await closeIssue(REPO, '7', {}, w.ctx)
    check(r && r.ok === true, '四.1 没原因也能关', r && r.error)
    check(w.commentBodies.length === 0, '四.2 没原因不发评论', w.commentBodies)
    check(w.closeReasons.length === 1 && w.closeReasons[0] === null, '四.3 没原因不带 --reason', w.closeReasons)
  }

  console.log(failures ? '存在失败 total=' + total : '全部通过 total=' + total)
  process.exit(failures ? 1 : 0)
}

main().catch((e) => { console.error(String((e && (e as any).stack) || e)); process.exit(1) })
