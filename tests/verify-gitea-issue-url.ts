// verify-gitea-issue-url.ts —— Gitea 房 issue 网页地址（url）贯通门禁。
// 用法：node --import ./scripts/ts-hook.mts tests/verify-gitea-issue-url.ts（verify 链按命名约定自动发现）。
// 背景：面板上「复制 url」「打开 issue url」两个按钮对 Gitea 房一直失效，根因链是
// ① tea `issues ls` 默认字段表不含 url；② normalizeIssue 只认 GitHub 的 html_url 字段名，tea 叫 url；
// ③ gitea 房没有 links 模板兜底——三环叠加后契约 Issue.url 恒为空串。
// 断言三件事：
//   1. argsIssueListPage 显式点名了含 url 的字段表（tea 的 ls 不点名字段就只回默认七个字段）；
//   2. normalizeIssue 认得 tea 的 url 字段（html_url 优先，防未来透传原生 API 形状时拿错字段）；
//   3. 端到端：用真机回包形状（tea 0.16，自托管 gitea.vvmath.com:8443）喂 listIssues，每行 url 必须非空且指向 Gitea。
import { argsIssueListPage } from '../src/tracker/rooms/gitea/support/tea-run.js'
import { normalizeIssue } from '../src/tracker/rooms/gitea/model/normalize.js'
import { listIssues } from '../src/tracker/rooms/gitea/issues/read.js'

let failed = false
let total = 0
const check = (ok: boolean, msg: string): void => {
  total += 1
  console.log((ok ? '  PASS ' : '  FAIL ') + msg)
  if (!ok) failed = true
}

console.log('Gitea 房 issue url 贯通门禁（复制/打开按钮的地址来源）')

// 1. 列票命令要点名字段表，且含 url
const args = argsIssueListPage('zhaolj/demo', 'all', [], 100, 1)
const fieldsIdx = args.indexOf('--fields')
check(fieldsIdx >= 0, '列票命令带 --fields（tea ls 默认字段表没有 url，不点名就永远拿不到）')
check(fieldsIdx >= 0 && String(args[fieldsIdx + 1] || '').split(',').indexOf('url') >= 0, '--fields 字段表包含 url：' + (fieldsIdx >= 0 ? args[fieldsIdx + 1] : '(无)'))

// 2. normalizeIssue 认 tea 的 url 字段
const teaShape = { index: '2', title: '样票', state: 'open', url: 'https://gitea.example:8443/zhaolj/demo/issues/2' }
check(normalizeIssue(teaShape).url === 'https://gitea.example:8443/zhaolj/demo/issues/2', 'normalizeIssue 认 tea 的 url 字段（真机形状：只有 url，没有 html_url）')
const bothShape = Object.assign({}, teaShape, { html_url: 'https://gitea.example/zhaolj/demo/issues/2' })
check(normalizeIssue(bothShape).url === 'https://gitea.example/zhaolj/demo/issues/2', 'html_url 在场时优先于 url（原生 API 形状里 url 是 API 端点）')
check(normalizeIssue({ index: '3', title: '没地址' }).url === '', '两个字段都不在时 url 仍是空串（不编地址）')

// 3. 端到端：真机回包形状走完整 listIssues，行 url 必须非空
const lsOutput = JSON.stringify([
  { index: '6', title: 'C 被阻塞', state: 'open', author: 'zhaolj', milestone: '', labels: '', owner: 'zhaolj', repo: 'demo', url: 'https://gitea.vvmath.com:8443/zhaolj/demo/issues/6' },
  { index: '5', title: 'B 阻塞者', state: 'open', author: 'zhaolj', milestone: '', labels: '', owner: 'zhaolj', repo: 'demo', url: 'https://gitea.vvmath.com:8443/zhaolj/demo/issues/5' },
])
let seenArgs: string[] = []
const exec = async (_cmd: string, a: string[]) => {
  seenArgs = a
  return { code: 0, stdout: lsOutput, stderr: '' }
}
const res = await listIssues(null, { refId: 'zhaolj/demo' }, { state: 'all' }, { exec, cwd: '/ws/demo' })
check(res.ok === true, 'listIssues 用桩回话跑通')
check(seenArgs.join(' ').indexOf('--fields') >= 0 && seenArgs.join(' ').indexOf('url') >= 0, 'listIssues 实际发出的 tea 命令带了含 url 的字段表：tea ' + seenArgs.join(' '))
const rows = (res as { data?: Array<{ url?: string }> }).data || []
check(rows.length === 2 && rows.every((r) => !!r.url && r.url.indexOf('https://gitea.vvmath.com:8443/') === 0), '每一行契约 Issue 的 url 非空且指向 Gitea 实例（拿到 ' + rows.map((r) => r.url).join(' / ') + '）')

console.log((failed ? 'FAIL: ' : 'OK: ') + total + ' 判据')
process.exit(failed ? 1 : 0)
