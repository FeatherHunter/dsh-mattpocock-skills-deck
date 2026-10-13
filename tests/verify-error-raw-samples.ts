/**
 * tests/verify-error-raw-samples.js — 三条真实失败路径都要把后端原文（raw）带回来（票 #1111 第 10、11 条）。
 *
 * 判据只有一条：后端交回来的失败对象里，第三段 raw 必须真的是后端原文 —— 是字符串、有原文时非空、
 * 凭据被遮蔽。为什么这件事值得单独设一道门：判档是启发式的、可能猜错，用户与维护者最后只能靠原文
 * 自己判断；原文一旦丢掉，人拿到一句「网络错误」就只能瞎猜，这正是本票要修掉的那种失败。
 *
 * 三条后端链路各配一个本地假后端，全程走真代码（房间自己的实现，不是替身）：
 *   一、GitHub 房：本地起一个 HTTP 服务当假 GitHub；假 gh 命令行把房间发出的 `gh …` 变成一个真的
 *       HTTP 请求打到这个服务上，服务端按档位回错（403 / 404 / 429 / 500 / 一段 HTML），并把一段带
 *       令牌的原文写进响应体；命令行再把这段原文原样吐到 stderr（真 gh 就是这么干的）。房间据此必须
 *       交回带原文的失败。五个档位各跑一次，共五条。
 *   二、GitLab 房：同一个本地服务按 /gitlab/ 前缀演同样的五个档位，假 glab 命令行同样把服务端原文
 *       吐到 stderr。共五条。
 *   三、Markdown 房：本地临时工作区里有一张真能认出来的票，但读它的那一次在本机层失败了（文件系统
 *       外观当场抛一个带 EACCES 原文的错误）—— 走的是房间自己的读文件支路，原文就是那条系统错误。
 *
 * 三条路径**串行**跑（不并发，逐条打印结论，出问题时一眼看得出是哪条）。某条路径这一轮根本走不到
 * 失败（例如房间把它兜住、回了 ok:true），就打印 `SKIP <具体原因>` 并记进跳过清单 —— 不许静默略过，
 * 也不许为了让门禁变绿而放宽断言。真拿到失败却没有可用的 raw，就是 FAIL。
 */

import { createServer } from 'node:http'
import * as http from 'node:http'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { countIssues } from '../src/tracker/rooms/github/counts.ts'
import { createGitlabBackend } from '../src/tracker/rooms/gitlab/index.ts'
import { getIssue as markdownGetIssue } from '../src/tracker/rooms/markdown/issues.ts'

let failed = false
const skipped = []
const report = (ok, msg) => { console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const skip = (msg) => { console.log('  SKIP ' + msg); skipped.push(msg) }

// ── 假后端用的原文与凭据 ────────────────────────────────────────────────────────
// 原文里放一个「只在这一次响应里出现」的记号，用来证明 raw 里带的确实是这一档服务端原文
// （记号里带档位名，所以「403 那次拿回了 404 的原文」这种串档也会被逮住）；
// 令牌用真形状（GitHub 的 ghp_ 前缀、GitLab 的 glpat- 前缀），用来验证遮蔽真的生效。
const GH_MARK = (variant) => 'GITHUB-ORIGINAL-TEXT-MARKER-' + variant + '-2f9a'
const GL_MARK = (variant) => 'GITLAB-ORIGINAL-TEXT-MARKER-' + variant + '-7c31'
const GH_TOKEN = 'ghp_' + 'A'.repeat(24)
const GL_TOKEN = 'glpat-' + 'B'.repeat(24)
const MASK_MARK = '***'

// 每个房都要走的失败档位。前四档是后端自己回的错（403 没权限、404 找不到、429 被限流、
// 500 后端自己崩了），「notjson」是网关挂掉时回一段 HTML 的那种：判档只能落 parse，
// 而那段 HTML 原文必须照样带回来 —— 这正是 raw 存在的意义。
const VARIANT_ORDER = ['403', '404', '429', '500', 'notjson']
const MESSAGE_OF = {
  403: 'Resource not accessible by integration',
  404: 'Not Found',
  429: 'API rate limit exceeded for user ID 1.',
  500: 'Internal Server Error',
}

/** 假命令行发出的一次真 HTTP 请求：返回状态码与响应体原文。 */
function httpCall(url, method, token) {
  return new Promise((resolvePromise) => {
    const req = http.request(url, { method: method, headers: { authorization: 'Bearer ' + token } }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (c) => { body += c })
      res.on('end', () => resolvePromise({ status: res.statusCode || 0, body: body }))
    })
    req.on('error', (e) => resolvePromise({ status: 0, body: '', error: String((e && e.message) || e) }))
    req.end()
  })
}

/** 一趟判据：跑一条真实失败路径，检查失败对象里的 raw。 */
async function checkOne(label, runner, opts) {
  let res
  try {
    res = await runner()
  } catch (e) {
    report(false, label + '：这次调用自己抛了异常，后面的 raw 就无从谈起（' + String((e && e.message) || e) + '）')
    return
  }
  if (!res || res.ok !== false) {
    skip(label + '：这一趟没有走到失败（实得 ok=' + JSON.stringify(res && res.ok) + '），没有失败原文可查 —— 房间把这次失败兜住了？请人工看一眼')
    return
  }
  const err = (res && res.error) || {}
  const raw = err.raw
  if (typeof raw !== 'string') {
    report(false, label + '：失败对象里的 raw 不是字符串（实得 ' + typeof raw + '）—— 交回来的失败形状是 '
      + JSON.stringify(res.error || res).slice(0, 300))
    return
  }
  if (raw.length === 0) {
    report(false, label + '：有失败却交回空 raw —— 人拿到失败也看不到后端原文')
    return
  }
  const missing = (opts.needles || []).filter((n) => raw.indexOf(n) < 0)
  report(missing.length === 0,
    label + '：raw 里带着后端原文（缺：' + (missing.join('、') || '无') + '；实得 ' + JSON.stringify(raw.slice(0, 160)) + '）')
  const secrets = opts.secrets || []
  const leaked = secrets.filter((s) => raw.indexOf(s) >= 0)
  report(leaked.length === 0, label + '：raw 里没有令牌明文（泄漏：' + (leaked.join('、') || '无') + '）')
  if (secrets.length) {
    report(raw.indexOf(MASK_MARK) >= 0, label + '：raw 里留下了「这里原本有凭据」的遮蔽标记')
  }
}

// ── 本地假后端：一个 HTTP 服务，按路径里的档位分别演 GitHub 与 GitLab 的失败 ──────────
// 路径长这样：`/github/<档位>/…` 与 `/gitlab/<档位>/…`，档位见 VARIANT_ORDER。
const server = createServer((req, res) => {
  const url = String(req.url || '')
  const echoed = String(req.headers.authorization || '')
  const m = /^\/(github|gitlab)\/([a-z0-9]+)\//.exec(url)
  const room = m ? m[1] : ''
  const variant = m ? m[2] : ''
  if (!m || VARIANT_ORDER.indexOf(variant) < 0) {
    res.writeHead(500, { 'Content-Type': 'text/plain' })
    res.end('假后端不认识这个请求：' + url)
    return
  }
  const mark = room === 'github' ? GH_MARK(variant) : GL_MARK(variant)
  if (variant === 'notjson') {
    res.writeHead(502, { 'Content-Type': 'text/html' })
    res.end('<html><body><h1>Bad gateway</h1><p>' + mark + '</p><p>echo_authorization: ' + echoed + '</p></body></html>')
    return
  }
  res.writeHead(Number(variant), { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ message: MESSAGE_OF[variant] + ' ' + mark, echo_authorization: echoed }))
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const origin = 'http://127.0.0.1:' + server.address().port

// ── 真实失败路径：三条后端链路，逐档串行跑 ─────────────────────────────────────
const cases = []

// 一、GitHub 房：假 gh 把 `gh api …` 变成真请求打到本地假 GitHub，五个档位各跑一次。
//    房间先探一次 `gh --version`（判断命令行装没装），这一句必须成功，否则会走「没装 gh」那条路。
for (const variant of VARIANT_ORDER) {
  cases.push({
    label: 'GitHub 房（本地假 GitHub 回 ' + variant + '）',
    needles: [GH_MARK(variant)],
    secrets: [GH_TOKEN],
    run: async () => {
      const exec = async (cmd, args) => {
        const joined = (args || []).join(' ')
        if (joined.indexOf('--version') >= 0) return { code: 0, stdout: 'gh version 2.40.0 (fake)', stderr: '' }
        const r = await httpCall(origin + '/github/' + variant + '/api', 'POST', GH_TOKEN)
        if (r.status === 200) return { code: 0, stdout: r.body, stderr: '' }
        return { code: 1, stdout: '', stderr: 'gh: ' + r.body }
      }
      const ctx = {
        cwd: 'C:/ws/fake',
        platform: { resolveExecutable: async (n) => (n === 'gh' ? 'gh' : null), env: { get: () => '' } },
        exec: exec,
        isEnabled: () => false,
        logEvent: () => {},
      }
      return await countIssues({ backend: 'github', refId: 'local/gate', name: 'local/gate', url: '' }, {}, ctx)
    },
  })
}

// 二、GitLab 房：假 glab 把房间发出的请求打到本地假 GitLab，同样五个档位各跑一次。
for (const variant of VARIANT_ORDER) {
  cases.push({
    label: 'GitLab 房（本地假 GitLab 回 ' + variant + '）',
    needles: [GL_MARK(variant)],
    secrets: [GL_TOKEN],
    run: async () => {
      const exec = async (cmd, args) => {
        const r = await httpCall(origin + '/gitlab/' + variant + '/'
          + String((args || []).join('/')).replace(/[^\w./-]/g, '_'), 'GET', GL_TOKEN)
        if (r.status === 200) return { code: 0, stdout: r.body, stderr: '' }
        return { code: 1, stdout: '', stderr: 'glab: ' + r.body }
      }
      const ctx = {
        cwd: 'C:/ws/fake',
        platform: { resolveExecutable: async (n) => (n === 'glab' ? 'glab' : null), path: { join: (...p) => p.join('/') }, env: { get: () => undefined } },
        exec: exec,
        isEnabled: () => false,
        logEvent: () => {},
      }
      const backend = createGitlabBackend(ctx)
      return await backend.list({ backend: 'gitlab', refId: 'group/project', name: 'group/project', url: '' }, {}, ctx)
    },
  })
}

// 三、Markdown 房：本地工作区里有一张真票，但读它的那一次在本机层失败（本机层报 EACCES）。
//    这一条走的是房间自己的读文件支路（src/tracker/rooms/markdown/read.ts），原文就是那条系统错误。
const MD_READ_MARK = 'MARKDOWN-READ-FAIL-MARKER-51be'
const mdTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'raw-samples-md-'))
cases.push({
  label: 'Markdown 房（读票文件时本机层报 EACCES）',
  needles: ['EACCES', MD_READ_MARK],
  secrets: [],
  run: async () => {
    // 先按房间认识的样子摆一张真票（这与 verify-multi-effort 里的固定装置同款），保证它能被找到。
    const effort = path.join(mdTmp, '.scratch', 'alpha')
    fs.mkdirSync(path.join(effort, 'issues'), { recursive: true })
    fs.writeFileSync(path.join(effort, 'map.md'),
      '# Alpha Map\n\nStatus: ready-for-agent\nLabels: wayfinder:map\n\n## Destination\n\nAlpha destination\n', 'utf8')
    fs.writeFileSync(path.join(effort, 'issues', '01-ticket.md'),
      '# Alpha First\n\nStatus: ready-for-agent\nType: task\nLabels: wayfinder:task\n\n## What to build\n\nbody\n', 'utf8')
    const platFs = {
      async resolve(p) { return p },
      async readText(t) {
        if (String(t).indexOf('01-ticket.md') >= 0) {
          const e = new Error('EACCES: permission denied, open ' + String(t) + ' ' + MD_READ_MARK)
          e.code = 'EACCES'
          throw e
        }
        return fs.readFileSync(t, 'utf8')
      },
      async writeText(t, c) { fs.mkdirSync(path.dirname(t), { recursive: true }); fs.writeFileSync(t, c, 'utf8') },
      async lstat(t) { try { return fs.statSync(t) } catch { return null } },
      async listDir(t) { try { return fs.readdirSync(t) } catch { return [] } },
      async stat(t) { try { return fs.statSync(t) } catch { return null } },
    }
    const ctx = { platform: { path: path.posix, fs: platFs }, fs: platFs, cwd: mdTmp, get(name) { if (name === 'fs') return platFs; return undefined } }
    return await markdownGetIssue(ctx, { backend: 'markdown', refId: mdTmp, name: path.basename(mdTmp), url: '', effortId: 'alpha' }, '01', {})
  },
})

console.log('── 真实失败路径的原文（串行跑，逐条看结论）')
for (const c of cases) {
  await checkOne(c.label, c.run, { needles: c.needles, secrets: c.secrets })
}

// ── 收尾：关掉假后端、删掉临时工作区 ──────────────────────────────────────────────
try { fs.rmSync(mdTmp, { recursive: true, force: true }) } catch {}
await new Promise((r) => server.close(r))

console.log(failed
  ? '\n存在失败 — verify-error-raw-samples 未通过（共 ' + cases.length + ' 条失败路径，跳过 ' + skipped.length + ' 条）'
  : '\n全部通过 — 三条后端链路的失败原文都带得回来（共 ' + cases.length + ' 条：GitHub 房 '
    + VARIANT_ORDER.length + ' 档、GitLab 房 ' + VARIANT_ORDER.length + ' 档、Markdown 房 1 条'
    + (skipped.length ? '；有 ' + skipped.length + ' 条跳过，原因见上' : '') + '）')
process.exit(failed ? 1 : 0)
