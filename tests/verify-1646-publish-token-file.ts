// tests/verify-1646-publish-token-file.ts —— #1646「发布 token 只走文件通道」门禁
// 用法：node --import ./scripts/ts-hook.mts tests/verify-1646-publish-token-file.ts（在插件根目录；动态部分只打 127.0.0.1 上的自建假 registry，不需要外网）
//
// 断言文字：
//   #1646 的教训是发布 token 以命令行参数的形式出现过，被原样记进了会话记录。现在发布脚本多了一条
//   优先入口 -TokenFile：命令行里只出现文件路径，token 值只从文件读。这扇门禁钉三件事，静态与动态各管一半：
//     ① 脚本还认这个入口：能解析路径、能读文件、只取第一行非空内容（BOM 与 CRLF 要吃掉）、空白文件要报错；
//     ② 值不外泄：日志只记来源（文件路径或环境变量名），任何 Log / Write-Host 行里都没有裸 token；
//        临时 npmrc 里只放环境变量占位符，不写值；
//     ③ 真能用：拿假 token 文件跑只读的 -DryRun 与 -Probe，假 registry 必须在 Authorization 里收到
//        文件里的那个值，同时 stdout、stderr、日志文件、命令行参数里都搜不到这个值。
//   静态部分查脚本与三份文档的写法；动态部分起假 registry、spawn 真的 pwsh 跑脚本。
//   pwsh 不可用时（非 Windows 的 CI 机器等）静态照跑、动态明确跳过并打 INFO 行。
//
// 门禁归属: scripts/publish-token.ps1
// 门禁归属: docs/releases/RELEASE-RUNBOOK.md
// 门禁归属: docs/agents/real-machine-verification.md
// 另外守 AGENTS.md 的发布段：根目录文件不在 gate-map 的目录前缀名单里，写归属行会被静默丢掉
//（先例是 verify-1596 的 GLOSSARY.md 那条），所以不写成归属行，改在这里说明。

const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')
const cp = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const SCRIPT = path.join(ROOT, 'scripts', 'publish-token.ps1')
const PWSH = (process.env.PWSH || '').trim() || 'pwsh'
// 故意不带 npm_ 前缀：脚本里的 Mask() 只盖 npm_ 开头的串，这样真泄露时一定抓得到。
const TOKEN = 'fake1646token-do-not-leak'
const ENV_TOKEN = 'fake1646-env-token-do-not-leak'
// 误操作形态用：长得像 token（一段 32 个字符以上的连续字母数字串），但没有路径分隔符。
const TOKEN2 = 'fake1646-token-value-do-not-leak-0123456789abcdef'
const PKG = 'verify-1646-fake-pkg'
const PKG_VERSION = '0.0.1'

let failed = false
let total = 0
const check = (ok: unknown, msg: string): void => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

console.log('发布 token 文件通道门禁（#1646）')

// ---------------------------------------------------------------------------
// 一、静态：脚本与文档的写法
// ---------------------------------------------------------------------------
function staticChecks(): void {
  const scriptText = fs.readFileSync(SCRIPT, 'utf8')
  const has = (needle: string): boolean => scriptText.indexOf(needle) >= 0

  check(has('[string]$TokenFile'), '发布脚本提供 -TokenFile 参数，命令行里只传文件路径')
  check(has('Resolve-Path -LiteralPath $TokenFile'), '脚本先解析 token 文件路径，路径不对时报错而不是继续跑')
  check(has('ReadAllText($tokenFilePath)'), '脚本从文件读 token（不是从命令行读）')
  check(has('TOKEN source=file path='), '日志只记来源与路径：TOKEN source=file path=')

  check(has('FAIL 读不到 token 文件') && has('FAIL token 文件里没有内容'), '读不到文件、文件里没内容都当用法错误（exit 2）')
  check(has('FAIL 缺 token：给 -TokenFile <路径>'), '缺 token 的报错提示 -TokenFile 通道')
  check(has('本脚本不会打印 token 的任何片段'), '缺 token 的报错明确承诺不打印任何片段')
  check(has('2=用法错误（缺 token/读不到 token 文件/无探针靶）'), '退出码说明里写清 2 的用途')

  // 打印与落盘语句的实参里只能出现来源，不能出现值：Log / Write-Host / Add-Content / Set-Content /
  // Out-File 出现位置之后的那段文本不许有裸 $token。不扫整行，是因为条件判断行也会出现 $token
  // （例如 if (... $token)) { Log ... }），那不是打印值。
  const bareToken = /\$token(?![A-Za-z0-9_])/
  const scriptLines = scriptText.split(/\r?\n/)
  const printMarks = ['Log (', 'Log(', 'Write-Host', 'Add-Content', 'Set-Content', 'Out-File']
  const printTails: string[] = []
  for (const line of scriptLines) {
    let at = -1
    for (const mark of printMarks) {
      const m = line.indexOf(mark)
      if (m >= 0 && (at < 0 || m < at)) at = m
    }
    if (at >= 0) printTails.push(line.slice(at))
  }
  check(printTails.length > 0, '脚本里能找到打印与落盘语句（本判据确实扫到了）')
  const leakLines: string[] = []
  for (const tail of printTails) if (bareToken.test(tail)) leakLines.push(tail.trim())
  check(leakLines.length === 0, '所有打印与落盘语句的实参都没有裸 $token（发现 ' + leakLines.length + ' 处' + (leakLines.length ? '：' + leakLines.join(' | ') : '') + '）')

  // 值也不能拼进外部命令的参数：命令行同样会被会话记录与进程参数完整留下（#1646 泄露的就是这条路径）。
  const runsExternal = /(^|[\s;|(])(npm|node|cmd|pwsh|Start-Process)([\s;|)]|$)/
  const argLeakLines = scriptLines.filter((line) => runsExternal.test(line) && bareToken.test(line))
  check(argLeakLines.length === 0, '脚本没有把裸 $token 拼进外部命令的参数（发现 ' + argLeakLines.length + ' 处）')

  // 临时 npmrc 里只放占位符：真正提交时由 npm 从环境变量代入，文件里没有值。
  const npmrcLine = scriptLines.find((l) => l.indexOf('Set-Content -Path $tempNpmrc') >= 0)
  check(typeof npmrcLine === 'string', '脚本会写临时 npmrc 给 npm 用')
  if (typeof npmrcLine === 'string') {
    check(npmrcLine.indexOf('${NODE_AUTH_TOKEN}') >= 0, '临时 npmrc 里放的是环境变量占位符，不是 token 值')
    check(!bareToken.test(npmrcLine), '临时 npmrc 那一行没有裸 $token')
  }

  // 旧写法会诱导人把值写进命令行：脚本头注释里不许再出现「内联赋一个 npm_ 值」的示例。
  check(!has("NODE_AUTH_TOKEN='npm_") && !has('NODE_AUTH_TOKEN = ' + String.fromCharCode(39) + 'npm_'), '脚本里没有内联写 token 值的旧示例')

  const agents = fs.readFileSync(path.join(ROOT, 'AGENTS.md'), 'utf8')
  check(agents.indexOf('-TokenFile') >= 0, 'AGENTS.md 的发布说明写了 -TokenFile 文件通道')
  check(agents.indexOf('立刻删掉') >= 0, 'AGENTS.md 要求跑完立刻删掉临时 token 文件')
  check(agents.indexOf('按季度轮换') >= 0 && agents.indexOf('撤销') >= 0, 'AGENTS.md 写明轮换与泄露后撤销的处置')

  const runbook = fs.readFileSync(path.join(ROOT, 'docs', 'releases', 'RELEASE-RUNBOOK.md'), 'utf8')
  check(runbook.indexOf('## 12. 发布 token 的文件通道与轮换') >= 0, 'RELEASE-RUNBOOK.md 有第 12 节讲 token 文件通道与轮换')
  check(runbook.indexOf('-TokenFile') >= 0 && runbook.indexOf('撤销') >= 0, 'RELEASE-RUNBOOK.md 第 12 节写清传法与撤销')

  const realMachine = fs.readFileSync(path.join(ROOT, 'docs', 'agents', 'real-machine-verification.md'), 'utf8')
  check(realMachine.indexOf('-TokenFile') >= 0, 'real-machine-verification.md 的发布路径说明跟着改成文件通道')

  // 权限与删除要有可执行命令，不能只写「只给本人可读」这类形容词。
  check(runbook.indexOf('icacls') >= 0, 'RELEASE-RUNBOOK.md 给出收紧 token 文件权限的可执行命令')
  check(runbook.indexOf('Remove-Item -LiteralPath') >= 0, 'RELEASE-RUNBOOK.md 给出用完即删的可执行命令')
  check(runbook.indexOf('只打一行 WARN 提醒') >= 0, 'RELEASE-RUNBOOK.md 写明仓库目录里的 WARN 只提醒不阻断')

  // 本 issue 的误操作形态是把 token 值当成 -TokenFile 的值传进来：回显路径前必须先打码。
  check(has('function ShowPath'), '脚本有 ShowPath：回显路径前先隐去长令牌串')
  check(has('(ShowPath $TokenFile)') && has('(ShowPath $tokenFilePath)'), '报错与 WARN 回显路径时都经过 ShowPath')
}

// ---------------------------------------------------------------------------
// 二、动态：起假 registry，真跑发布脚本
// ---------------------------------------------------------------------------
type StubRequest = { method: string; url: string; auth: string }
type Stub = { url: string; requests: StubRequest[]; close: () => Promise<void> }

// mode 决定假 registry 对「这个版本在不在云端」的回答：
//   missing → GET /<包名> 404（走 -DryRun 的 TODO 分支）；visible → 返回 packument（-Probe 要重发已有版本）。
// 两个模式下 GET /-/whoami 都回 200，PUT 都回 409：这正是真 registry 对「重发已存在版本」的答复，
// 脚本据此判 PROBE-OK（写链路通）。所有请求都记下来，用来断言 Authorization 里带的是文件里的 token。
function startStub(mode: 'missing' | 'visible'): Promise<Stub> {
  const requests: StubRequest[] = []
  const sockets = new Set()
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const url = String(req.url || '').split('?')[0]
      requests.push({ method: String(req.method || ''), url: url, auth: String(req.headers.authorization || '') })
      const send = (code: number, body: unknown): void => {
        const text = JSON.stringify(body)
        res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text) })
        res.end(text)
      }
      if (req.method === 'GET' && url === '/-/whoami') return send(200, { username: 'fake-user' })
      if (mode === 'visible' && req.method === 'GET' && url === '/' + PKG) {
        const versions: Record<string, unknown> = {}
        versions[PKG_VERSION] = { name: PKG, version: PKG_VERSION, dist: { tarball: 'http://127.0.0.1:1/fake.tgz' } }
        return send(200, { name: PKG, 'dist-tags': { latest: PKG_VERSION }, versions: versions })
      }
      if (req.method === 'PUT') return send(409, { error: 'previously staged version', reason: 'previously staged version' })
      send(404, { error: 'not found' })
    })
  })
  server.on('connection', (socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)) })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      const port = addr && typeof addr === 'object' ? addr.port : 0
      resolve({
        url: 'http://127.0.0.1:' + port + '/',
        requests: requests,
        close: () => new Promise((done) => {
          for (const socket of sockets) { try { socket.destroy() } catch (e) {} }
          server.close(() => done())
        }),
      })
    })
  })
}

// 子进程环境要干净：别人的 token、npm 配置、代理都可能把请求带出 127.0.0.1 或污染结论。
function childEnv(extra: Record<string, string>): Record<string, string> {
  const drop = new Set(['NODE_AUTH_TOKEN', 'NPM_TOKEN', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY'])
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue
    const upper = key.toUpperCase()
    if (drop.has(upper) || upper.indexOf('npm_config_') === 0) continue
    env[key] = value
  }
  for (const [key, value] of Object.entries(extra)) env[key] = value
  return env
}

type RunResult = { code: number; out: string; err: string }

// PowerShell 把中文写进被重定向的 stdout 时用哪种编码，取决于本机控制台代码页（简体中文 Windows 上是 GBK），
// 所以不能直接按 UTF-8 解。先按 UTF-8 严格解，解不动再按 GBK 解；都对不上最后退回宽松 UTF-8。
function decodeOutput(buf: Buffer): string {
  if (buf.length === 0) return ''
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf) } catch (e) {}
  try { return new TextDecoder('gbk').decode(buf) } catch (e) {}
  return buf.toString('utf8')
}

// 必须用异步 spawn：假 registry 跑在本进程里，spawnSync 会阻塞事件循环，registry 回不了话就死等到超时。
function runScript(args: string[], extraEnv: Record<string, string>): Promise<RunResult> {
  const fullArgs = ['-NoProfile', '-NonInteractive', '-File', SCRIPT].concat(args)
  return new Promise((resolve, reject) => {
    const child = cp.spawn(PWSH, fullArgs, { cwd: ROOT, env: childEnv(extraEnv), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const outChunks: Buffer[] = []
    const errChunks: Buffer[] = []
    child.stdout.on('data', (c: Buffer) => outChunks.push(c))
    child.stderr.on('data', (c: Buffer) => errChunks.push(c))
    const timer = setTimeout(() => { try { child.kill('SIGKILL') } catch (e) {} }, 60000)
    child.on('error', (err: Error) => { clearTimeout(timer); reject(new Error('起 pwsh 跑发布脚本失败：' + err.message)) })
    child.on('close', (code: number | null) => {
      clearTimeout(timer)
      resolve({ code: code === null ? -1 : code, out: decodeOutput(Buffer.concat(outChunks)), err: decodeOutput(Buffer.concat(errChunks)) })
    })
  })
}

function hasPwsh(): boolean {
  const res = cp.spawnSync(PWSH, ['-NoProfile', '-NonInteractive', '-Command', 'exit 0'], { encoding: 'utf8', timeout: 30000, windowsHide: true })
  return !res.error && res.status === 0
}

function readIfExists(file: string): string {
  try { return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '' } catch (e) { return '' }
}

function noLeak(label: string, text: string, hidden: string): void {
  check(text.indexOf(hidden) < 0, label + '里搜不到 token 值')
}

async function dynamicChecks(): Promise<void> {
  if (!hasPwsh()) {
    console.log('  INFO ' + PWSH + ' 不可用，动态部分跳过：静态判据已跑，发布脚本本身要求 pwsh 7，请在有 pwsh 的机器上补跑完整版。')
    return
  }

  const lab = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-1646-'))
  const repo = path.join(lab, 'repo')
  const logA = path.join(lab, 'a.log')
  const logD = path.join(lab, 'd.log')
  const logE = path.join(lab, 'e.log')
  const logF = path.join(lab, 'f.log')
  const logG = path.join(lab, 'g.log')
  const packumentPath = path.join(repo, 'package', 'package.json')
  // token 文件故意放在假仓库目录里：顺带验证「文件在仓库目录里」的 WARN。
  const tokenPath = path.join(repo, 'publish-token.txt')
  const missingPath = path.join(lab, 'no-such-token.txt')
  const emptyPath = path.join(lab, 'empty-token.txt')

  try {
    fs.mkdirSync(path.join(repo, 'package'), { recursive: true })
    fs.writeFileSync(packumentPath, JSON.stringify({ name: PKG, version: PKG_VERSION, description: 'fake package for verify-1646 gate' }, null, 2), 'utf8')
    // BOM + 空行 + 值两侧空白 + CRLF + 多余的一行：脚本只取第一行非空内容并去空白，后面那行必须被忽略。
    fs.writeFileSync(tokenPath, '\uFEFF\r\n   ' + TOKEN + '  \r\nsecond-line-should-be-ignored\r\n', 'utf8')
    fs.writeFileSync(emptyPath, '\uFEFF  \r\n\r\n', 'utf8')

    // A. 既没有 -TokenFile 也没有环境变量：用法错误，且报错指路到文件通道。
    {
      const run = await runScript(['-RepoRoot', repo, '-LogPath', logA, '-DryRun'], {})
      check(run.code === 2, 'A 缺 token 时退出码是 2（实测 ' + run.code + '）')
      check(run.out.indexOf('-TokenFile') >= 0, 'A 缺 token 的报错提到 -TokenFile 文件通道')
      check(run.out.indexOf('NODE_AUTH_TOKEN') >= 0, 'A 缺 token 的报错提到兼容的环境变量名')
      check(run.out.indexOf('不会打印 token') >= 0, 'A 缺 token 的报错承诺不打印任何片段')
      noLeak('A 的 stdout', run.out, TOKEN)
      noLeak('A 的 stderr', run.err, TOKEN)
    }

    // B. -TokenFile 指向不存在的文件：用法错误，报错里给路径。
    {
      const run = await runScript(['-TokenFile', missingPath, '-RepoRoot', repo, '-LogPath', logA, '-DryRun'], {})
      check(run.code === 2, 'B token 文件不存在时退出码是 2（实测 ' + run.code + '）')
      check(run.out.indexOf(missingPath) >= 0, 'B 报错里给出所给的文件路径')
      noLeak('B 的 stdout', run.out, TOKEN)
      noLeak('B 的 stderr', run.err, TOKEN)
    }

    // C. 文件里没有内容：用法错误，报错点明文件里没有内容。
    {
      const run = await runScript(['-TokenFile', emptyPath, '-RepoRoot', repo, '-LogPath', logA, '-DryRun'], {})
      check(run.code === 2, 'C 空白 token 文件时退出码是 2（实测 ' + run.code + '）')
      check(run.out.indexOf(emptyPath) >= 0 && run.out.indexOf('没有内容') >= 0, 'C 报错里给出路径并说明文件里没有内容')
      noLeak('C 的 stdout', run.out, TOKEN)
      noLeak('C 的 stderr', run.err, TOKEN)
    }

    // D. 主路径：文件里的假 token 跑 -DryRun（假 registry 说这个版本还没发过）。
    let stubMissing: Stub | null = null
    try {
      stubMissing = await startStub('missing')
      const args = ['-TokenFile', tokenPath, '-RepoRoot', repo, '-LogPath', logD, '-DryRun', '-Registry', stubMissing.url]
      const run = await runScript(args, {})
      check(run.code === 0, 'D -DryRun 以假 token 文件跑通，退出码 0（实测 ' + run.code + '）')
      check(run.out.indexOf('TOKEN source=file path=') >= 0, 'D 日志记明来源是文件并给出路径')
      check(run.out.indexOf(tokenPath) >= 0, 'D 输出的来源路径就是所给的 token 文件')
      check(run.out.indexOf('DRYRUN 只验到这里') >= 0, 'D -DryRun 只验到只读阶段，不跑门禁不发布')
      check(run.out.indexOf('WARN token 文件在仓库目录里') >= 0, 'D token 文件在仓库目录里时给出 WARN，提醒删掉别提交')
      noLeak('D 的 stdout', run.out, TOKEN)
      noLeak('D 的 stderr', run.err, TOKEN)
      const logText = readIfExists(logD)
      check(logText.length > 0, 'D 写了日志文件')
      noLeak('D 的日志文件', logText, TOKEN)
      const seen = stubMissing.requests.filter((r) => r.url === '/' + PKG || r.url === '/-/whoami')
      check(seen.length >= 2, 'D 假 registry 收到了读表与 whoami 两类请求（实测 ' + stubMissing.requests.length + ' 个请求）')
      check(stubMissing.requests.some((r) => r.method === 'PUT') === false, 'D -DryRun 不向 registry 发 PUT（没有真发布）')
      check(stubMissing.requests.some((r) => r.auth === 'Bearer ' + TOKEN), 'D 假 registry 的 Authorization 里带的是文件里的 token')
      check(args.join(' ').indexOf(TOKEN) < 0, 'D 命令行参数里只有 token 文件路径，没有 token 值')
    } finally {
      if (stubMissing) await stubMissing.close()
    }

    // E. 探针：假 registry 说这个版本已经存在，重发会被 409 拒收 —— 这正是写权限成立的证据。
    let stubVisible: Stub | null = null
    try {
      stubVisible = await startStub('visible')
      const args = ['-TokenFile', tokenPath, '-RepoRoot', repo, '-LogPath', logE, '-Probe', '-Registry', stubVisible.url]
      const run = await runScript(args, {})
      check(run.code === 0, 'E -Probe 以假 token 文件跑通，退出码 0（实测 ' + run.code + '）')
      check(run.out.indexOf('PROBE-OK') >= 0, 'E 探针判 PROBE-OK（registry 拒收已存在版本＝写链路通）')
      noLeak('E 的 stdout', run.out, TOKEN)
      noLeak('E 的 stderr', run.err, TOKEN)
      noLeak('E 的日志文件', readIfExists(logE), TOKEN)
      const put = stubVisible.requests.find((r) => r.method === 'PUT')
      check(put !== undefined, 'E 探针确实向 registry 发了 PUT（真写权限探针，不是只看读）')
      check(put !== undefined && put.auth === 'Bearer ' + TOKEN, 'E 探针 PUT 的 Authorization 里带的是文件里的 token')
      check(args.join(' ').indexOf(TOKEN) < 0, 'E 命令行参数里只有 token 文件路径，没有 token 值')
    } finally {
      if (stubVisible) await stubVisible.close()
    }

    // F. 兼容：不给 -TokenFile 时，环境变量入口照旧可用，日志只记变量名。
    let stubEnv: Stub | null = null
    try {
      stubEnv = await startStub('missing')
      const args = ['-RepoRoot', repo, '-LogPath', logF, '-DryRun', '-Registry', stubEnv.url]
      const run = await runScript(args, { NODE_AUTH_TOKEN: ENV_TOKEN })
      check(run.code === 0, 'F 环境变量入口照旧可用，退出码 0（实测 ' + run.code + '）')
      check(run.out.indexOf('TOKEN source=env name=NODE_AUTH_TOKEN') >= 0, 'F 日志记明来源是环境变量名')
      noLeak('F 的 stdout', run.out, ENV_TOKEN)
      noLeak('F 的 stderr', run.err, ENV_TOKEN)
      noLeak('F 的日志文件', readIfExists(logF), ENV_TOKEN)
      check(stubEnv.requests.some((r) => r.auth === 'Bearer ' + ENV_TOKEN), 'F 假 registry 的 Authorization 里带的是环境变量里的 token')
      check(args.join(' ').indexOf(ENV_TOKEN) < 0, 'F 命令行参数里没有 token 值（值只走环境变量）')
    } finally {
      if (stubEnv) await stubEnv.close()
    }

    // G. 误操作形态：把 token 值当成 -TokenFile 的路径传进来。报错可以指路，但值绝不能原样出现。
    {
      const args = ['-TokenFile', TOKEN2, '-RepoRoot', repo, '-LogPath', logG, '-DryRun']
      const run = await runScript(args, {})
      check(run.code === 2, 'G 把 token 值当路径传时按用法错误退出 2（实测 ' + run.code + '）')
      check(run.out.indexOf('读不到 token 文件') >= 0, 'G 报错点明读不到 token 文件')
      check(run.out.indexOf('***') >= 0, 'G 回显前把长令牌串打了码')
      noLeak('G 的 stdout', run.out, TOKEN2)
      noLeak('G 的 stderr', run.err, TOKEN2)
      noLeak('G 的日志文件', readIfExists(logG), TOKEN2)
      check(args.join(' ').indexOf(TOKEN2) >= 0, 'G 对照：这个值确实在命令行里传进去了（所以上面“搜不到”不是空转）')
    }
  } finally {
    try { fs.rmSync(lab, { recursive: true, force: true }) } catch (e) {}
  }
}

async function main(): Promise<void> {
  staticChecks()
  await dynamicChecks()
  console.log('共有 ' + total + ' 条断言，' + (failed ? '存在失败' : '全部通过'))
  process.exit(failed ? 1 : 0)
}

main().catch(function (err: unknown) {
  console.error('门禁运行出错：' + ((err as { stack?: string }).stack || String(err)))
  process.exit(1)
})
