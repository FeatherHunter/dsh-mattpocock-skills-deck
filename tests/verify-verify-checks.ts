// tests/verify-verify-checks.ts —— 插件自带五项自检、实例环境白名单、身份行跨仓解析的回归门禁。
//
// 覆盖来源（阶段 B2 会删除的旧文件）：
//   tests/verify-1710-preflight.ts      → 五项检查的 id/title/hard/run 与各自的数据缺失语义
//   tests/verify-1707-env-injection.ts  → instanceEnvAllowlist 只放行 GLAB_CONFIG_DIR / GITLAB_TOKEN / GLAB_BIN
//   tests/verify-1766-batch-identity.ts → base 的 formatIdentityLine 生成的行能被发布审计解析回来
//
// 这扇门禁不启动实例、不跑真 glab：命令端口与文件端口都由测试自己拼，读源码时直接读仓库里的真实文件。
// 构造不出输入的那一项会写成静态断言并说明，不做 silent skip。
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import {
  formatIdentityLine,
  parseBatchName,
  parseCommitSha,
  parseSha256Hex,
  parseIdentityLine as parseBaseIdentityLine,
} from 'dsh-featherhunter-plugin-base/real-machine-verification'
import profile from '../verify/profile.ts'
import { pluginChecks } from '../verify/checks/index.ts'
import {
  parseIdentityLine as parseAuditIdentityLine,
  IDENTITY_PREFIX,
  collectBatchIdentities,
} from '../scripts/lib/release-candidate-audit.mts'
import { printGateResult } from './lib/gate-result.ts'

const GATE = 'verify-verify-checks'
const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const TEMP_ROOT = 'D:/Temp'
const NEWLINE = String.fromCharCode(10)
const PROFILE_SOURCE = join(ROOT, 'verify', 'profile.ts')
const CHECKS_SOURCE = join(ROOT, 'verify', 'checks', 'index.ts')

let assertions = 0
let failed = 0

function check(ok: boolean, message: string, detail = ''): void {
  assertions++
  if (ok) {
    console.log('PASS ' + message)
    return
  }
  failed++
  console.log('FAIL ' + message + (detail === '' ? '' : '：' + detail))
}

function show(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

type PortResult = { ok: true; value: any } | { ok: false; error: { message: string } }

function okResult(value: any): PortResult {
  return { ok: true, value }
}

function errResult(message: string): PortResult {
  return { ok: false, error: { message } }
}

// 真实的 fs 端口：workspace-fixture / ticket-pool / log-dir 都只用到其中一小撮方法，
// 这里按 base 的 FsPort 契约把用到的那些包成 Result 信封，读的是仓库与 D:/Temp 下的真文件。
function realFsPort(): any {
  return {
    exists: async (path: string) => fs.existsSync(path),
    stat: async (path: string) => {
      try {
        const stat = fs.statSync(path)
        const kind = stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'other'
        return okResult({ kind, size: stat.size, mtimeMs: stat.mtimeMs })
      } catch (error: any) {
        return errResult(error.message)
      }
    },
    readText: async (path: string) => {
      try {
        return okResult(fs.readFileSync(path, 'utf8'))
      } catch (error: any) {
        return errResult(error.message)
      }
    },
    makeDir: async (path: string) => {
      try {
        fs.mkdirSync(path, { recursive: true })
        return okResult(undefined)
      } catch (error: any) {
        return errResult(error.message)
      }
    },
    writeText: async (path: string, text: string) => {
      try {
        fs.writeFileSync(path, text, 'utf8')
        return okResult(undefined)
      } catch (error: any) {
        return errResult(error.message)
      }
    },
    remove: async (path: string) => {
      try {
        fs.rmSync(path, { recursive: true, force: true })
        return okResult(undefined)
      } catch (error: any) {
        return errResult(error.message)
      }
    },
  }
}

// 只给检查真正会读的端口。profile 用真实 profile，这样 workspace-fixture 的 backend 白名单
// 与身份行测试读的是插件实际声明的值，不是测试另抄一份。
function makeContext(options: any = {}): any {
  const env: Record<string, string> = options.env ?? {}
  return {
    profile,
    profileName: 'web',
    ports: {
      fs: options.fs ?? realFsPort(),
      command: options.command ?? { run: async () => errResult('the test did not provide a command port') },
      env: {
        get: (name: string) => (Object.prototype.hasOwnProperty.call(env, name) ? env[name] : undefined),
        snapshot: () => ({ ...env }),
        homeDir: () => options.homeDir ?? 'C:/Users/tester',
      },
      clock: options.clock ?? {
        iso: () => '2026-11-02T12:00:00.000Z',
        nowMs: () => Date.parse('2026-11-02T12:00:00.000Z'),
        sleep: async () => undefined,
      },
    },
    cwd: options.cwd ?? ROOT,
    dshHome: options.dshHome ?? join(TEMP_ROOT, 'matt-b1b-home'),
    profileDir: options.profileDir ?? join(TEMP_ROOT, 'matt-b1b-profile'),
  }
}

const tempDirs: string[] = []

function makeTempDir(label: string): string {
  fs.mkdirSync(TEMP_ROOT, { recursive: true })
  const dir = fs.mkdtempSync(join(TEMP_ROOT, 'matt-b1b-' + label + '-'))
  tempDirs.push(dir)
  return dir
}

function cleanupTempDirs(): void {
  for (const dir of tempDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      // 清理失败不影响结论；下一次跑会另建目录。
    }
  }
}

function checkById(id: string): any {
  const found = pluginChecks.find((entry: any) => entry.id === id)
  if (found === undefined) throw new Error('pluginChecks 里没有 ' + id)
  return found
}

async function main(): Promise<void> {
  try {
    // ---- A. 登记：profile.checks 就是 checks/index.ts 导出的五项 ----
    const registered = (profile as any).checks as any[]
    const profileSource = fs.readFileSync(PROFILE_SOURCE, 'utf8')
    const indexSource = fs.readFileSync(CHECKS_SOURCE, 'utf8')
    const expectedIds = ['glab-available', 'sandbox-project', 'ticket-pool', 'workspace-fixture', 'log-dir']

    check(Array.isArray(registered) && registered.length === 5, 'A1 profile.checks 恰有五项', show(registered?.length))
    check(pluginChecks.length === 5, 'A2 pluginChecks 恰有五项', show(pluginChecks.length))
    check(
      registered.length === pluginChecks.length && registered.every((entry, index) => entry === pluginChecks[index]),
      'A3 profile.checks 的每一项就是 pluginChecks 的同一对象（不是另抄一份）',
      show(registered.map((entry) => entry.id)),
    )
    check(
      JSON.stringify(registered.map((entry: any) => entry.id)) === JSON.stringify(expectedIds),
      'A4 五项检查的 id 与顺序是 glab-available / sandbox-project / ticket-pool / workspace-fixture / log-dir',
      show(registered.map((entry: any) => entry.id)),
    )
    for (const [index, expectedId] of expectedIds.entries()) {
      const entry = registered[index]
      check(
        entry !== undefined &&
          entry.id === expectedId &&
          typeof entry.title === 'string' &&
          entry.title.trim() !== '' &&
          typeof entry.run === 'function' &&
          typeof entry.hard === 'boolean',
        'A5.' + String(index + 1) + ' ' + expectedId + ' 有 id/title/run/hard',
        show(entry),
      )
    }
    const hardFlags: Record<string, boolean> = {}
    for (const entry of registered) hardFlags[entry.id] = entry.hard
    check(
      JSON.stringify(hardFlags) ===
        JSON.stringify({
          'glab-available': true,
          'sandbox-project': false,
          'ticket-pool': true,
          'workspace-fixture': false,
          'log-dir': true,
        }),
      'A6 hard 标记没有静默变软：glab/ticket-pool/log-dir 硬，sandbox-project/workspace-fixture 软',
      show(hardFlags),
    )
    check(
      profileSource.includes('checks: pluginChecks') && profileSource.includes('pluginChecks'),
      'A7 profile.ts 直接把 pluginChecks 接进 checks，而不是在 profile 里重列',
      '',
    )
    check(
      indexSource.includes('glab-available.ts') &&
        indexSource.includes('sandbox-project.ts') &&
        indexSource.includes('ticket-pool.ts') &&
        indexSource.includes('workspace-fixture.ts') &&
        indexSource.includes('log-dir.ts'),
      'A8 checks/index.ts 从五份实现导入，不是内联桩',
      '',
    )
    check(
      Array.isArray((profile as any).workspaceBackends) && (profile as any).workspaceBackends.includes('markdown'),
      'A9 profile 的 backend 白名单里有 markdown（下面 fixture 用它做已知后端）',
      show((profile as any).workspaceBackends),
    )

    // ---- B. glab-available：命令成功 / 非零退出 / 起不来 ----
    const glab = checkById('glab-available')
    const glabCalls: any[] = []
    const successContext = makeContext({
      cwd: ROOT,
      env: {},
      command: {
        run: async (request: any) => {
          glabCalls.push(request)
          return okResult({
            argv: request.argv,
            cwd: request.cwd,
            exitCode: 0,
            signal: null,
            stdout: 'glab version 1.50.0 (2026-01-01)' + NEWLINE + 'second line',
            stderr: '',
            durationMs: 12,
            timedOut: false,
          })
        },
      },
    })
    const glabOk = await glab.run(successContext)
    check(glabOk.ok === true, 'B1 glab 命令输出版本时检查通过', show(glabOk))
    check(
      typeof glabOk.detail === 'string' && glabOk.detail.includes('glab --version -> glab version 1.50.0'),
      'B2 通过的说明带上版本首行',
      glabOk.detail,
    )
    check(
      glabCalls.length === 1 &&
        glabCalls[0].argv[0] === 'glab' &&
        glabCalls[0].argv[1] === '--version' &&
        glabCalls[0].cwd === ROOT &&
        glabCalls[0].timeoutMs === 10000,
      'B3 默认调用 glab --version，cwd 是检查上下文，超时 10 秒',
      show(glabCalls[0]),
    )

    const overrideCalls: any[] = []
    const overrideContext = makeContext({
      env: { GLAB_BIN: 'C:/tools/glab.exe' },
      command: {
        run: async (request: any) => {
          overrideCalls.push(request)
          return okResult({ argv: request.argv, cwd: request.cwd, exitCode: 0, signal: null, stdout: 'glab version 9.9.9', stderr: '', durationMs: 1, timedOut: false })
        },
      },
    })
    const overrideObs = await glab.run(overrideContext)
    check(
      overrideObs.ok === true && overrideCalls.length === 1 && overrideCalls[0].argv[0] === 'C:/tools/glab.exe',
      'B4 GLAB_BIN 覆盖默认的 glab 可执行文件',
      show(overrideCalls[0]),
    )
    check(
      typeof overrideObs.detail === 'string' && overrideObs.detail.startsWith('C:/tools/glab.exe --version -> '),
      'B5 覆盖后说明里写的是真实可执行文件路径',
      overrideObs.detail,
    )

    const nonzeroContext = makeContext({
      env: {},
      command: {
        run: async (request: any) =>
          okResult({
            argv: request.argv,
            cwd: request.cwd,
            exitCode: 1,
            signal: null,
            stdout: '',
            stderr: 'glab: unknown command "--version"',
            durationMs: 3,
            timedOut: false,
          }),
      },
    })
    const nonzero = await glab.run(nonzeroContext)
    check(nonzero.ok === false, 'B6 glab 非零退出时检查失败', show(nonzero))
    check(
      typeof nonzero.detail === 'string' && nonzero.detail.includes('exited 1'),
      'B7 失败说明写清退出码',
      nonzero.detail,
    )
    check(
      nonzero.expected === 'glab --version exits 0' &&
        typeof nonzero.actual === 'string' &&
        nonzero.actual.includes('unknown command'),
      'B8 失败带上期望与 stderr 摘要',
      show(nonzero),
    )
    check(
      typeof nonzero.hint === 'string' && nonzero.hint.includes('gitlab.com/gitlab-org/cli#installation'),
      'B9 失败提示包含安装 glab 的指引',
      nonzero.hint,
    )

    const cannotStartContext = makeContext({
      env: {},
      command: { run: async () => errResult('spawn glab ENOENT') },
    })
    const cannotStart = await glab.run(cannotStartContext)
    check(
      cannotStart.ok === false &&
        typeof cannotStart.detail === 'string' &&
        cannotStart.detail.startsWith('could not start glab') &&
        cannotStart.actual === 'spawn glab ENOENT' &&
        typeof cannotStart.hint === 'string' &&
        cannotStart.hint.includes('GLAB_BIN'),
      'B10 glab 起不来时失败，并提示装 glab 或设 GLAB_BIN',
      show(cannotStart),
    )

    // ---- C. workspace-fixture：真实临时工作区 ----
    const fixture = checkById('workspace-fixture')

    const validWorkspace = makeTempDir('ws-valid')
    fs.mkdirSync(join(validWorkspace, '.git'), { recursive: true })
    fs.mkdirSync(join(validWorkspace, 'docs', 'agents'), { recursive: true })
    fs.writeFileSync(join(validWorkspace, 'docs', 'agents', 'workspace.yaml'), 'backendId: markdown' + NEWLINE + 'schema: 2' + NEWLINE, 'utf8')
    const emptyCwd = makeTempDir('ws-cwd')
    const validObs = await fixture.run(makeContext({ cwd: emptyCwd, env: { DSH_VERIFY_WORKSPACE_DIR: validWorkspace } }))
    check(validObs.ok === true, 'C1 合法工作区（.git + backendId=markdown）通过', show(validObs))
    check(
      typeof validObs.detail === 'string' &&
        validObs.detail.includes(validWorkspace) &&
        validObs.detail.includes('backendId markdown'),
      'C2 通过的说明写出工作区路径与 backendId',
      validObs.detail,
    )

    const unknownWorkspace = makeTempDir('ws-unknown')
    fs.mkdirSync(join(unknownWorkspace, '.git'), { recursive: true })
    fs.mkdirSync(join(unknownWorkspace, 'docs', 'agents'), { recursive: true })
    fs.writeFileSync(join(unknownWorkspace, 'docs', 'agents', 'workspace.yaml'), 'backendId: svn' + NEWLINE, 'utf8')
    const unknownObs = await fixture.run(makeContext({ cwd: emptyCwd, env: { DSH_VERIFY_WORKSPACE_DIR: unknownWorkspace } }))
    check(unknownObs.ok === false, 'C3 backendId 不在 workspaceBackends 里时失败', show(unknownObs))
    check(
      typeof unknownObs.detail === 'string' &&
        unknownObs.detail.includes('not one of') &&
        typeof unknownObs.actual === 'string' &&
        unknownObs.actual.includes('backendId svn'),
      'C4 失败说明点明未知 backendId 与可选值',
      show(unknownObs),
    )
    check(
      typeof unknownObs.hint === 'string' && unknownObs.hint.includes('workspace command'),
      'C5 失败提示指向重建 fixture 的旧命令或 DSH_VERIFY_WORKSPACE_DIR',
      unknownObs.hint,
    )

    const noGitWorkspace = makeTempDir('ws-nogit')
    fs.mkdirSync(join(noGitWorkspace, 'docs', 'agents'), { recursive: true })
    fs.writeFileSync(join(noGitWorkspace, 'docs', 'agents', 'workspace.yaml'), 'backendId: markdown' + NEWLINE, 'utf8')
    const noGitObs = await fixture.run(makeContext({ cwd: emptyCwd, env: { DSH_VERIFY_WORKSPACE_DIR: noGitWorkspace } }))
    check(
      noGitObs.ok === false && typeof noGitObs.detail === 'string' && noGitObs.detail.includes('no .git entry'),
      'C6 有绑定文件但不是 git 仓库时失败',
      show(noGitObs),
    )

    const noFixtureCwd = makeTempDir('ws-none')
    const noFixtureObs = await fixture.run(makeContext({ cwd: noFixtureCwd, env: {} }))
    check(
      noFixtureObs.ok === true &&
        typeof noFixtureObs.detail === 'string' &&
        noFixtureObs.detail.includes('soft check skipped'),
      'C7 没有工作区时不静默跳过，而是明确报告 soft check skipped',
      show(noFixtureObs),
    )

    // ---- D. ticket-pool：真实规划器源码 / 源码缺失 / 默认值漂移 ----
    const pool = checkById('ticket-pool')
    const seedPath = join(ROOT, 'scripts', 'real-machine', 'commands', 'seed-gitlab.mts')
    check(fs.existsSync(seedPath), 'D0 真实的 seed 规划器源码存在', seedPath)
    const poolObs = await pool.run(makeContext({ cwd: ROOT }))
    check(poolObs.ok === true, 'D1 在仓库根上五组默认值都符合文档', show(poolObs))
    check(
      typeof poolObs.detail === 'string' && poolObs.detail.includes('101 tickets / 5 closed / 2 maps / 5 children / 8 blocking pairs'),
      'D2 通过的说明列出全部五组数字',
      poolObs.detail,
    )
    check(typeof poolObs.detail === 'string' && poolObs.detail.includes(seedPath), 'D3 通过的说明带源码路径', poolObs.detail)

    const missingPoolDir = makeTempDir('pool-missing')
    const missingPool = await pool.run(makeContext({ cwd: missingPoolDir, env: {} }))
    check(
      missingPool.ok === false &&
        typeof missingPool.detail === 'string' &&
        missingPool.detail.includes('seed planner source was not found'),
      'D4 找不到规划器源码时硬检查失败，不静默通过',
      show(missingPool),
    )
    check(
      typeof missingPool.hint === 'string' && missingPool.hint.includes('plugin repository root'),
      'D5 找不到源码的提示指向从仓库根跑自检',
      missingPool.hint,
    )

    const driftDir = makeTempDir('pool-drift')
    fs.mkdirSync(join(driftDir, 'scripts', 'real-machine', 'commands'), { recursive: true })
    const driftLines = [
      'const ticketCount = intFlag(args, "ticket-count", 99, 1)',
      'const closed = intFlag(args, "closed", 5, 0)',
      'const maps = intFlag(args, "maps", 2, 0)',
      'const children = intFlag(args, "children", 5, 0)',
      'const blocking = intFlag(args, "blocking", 8, 0)',
    ]
    fs.writeFileSync(join(driftDir, 'scripts', 'real-machine', 'commands', 'seed-gitlab.mts'), driftLines.join(NEWLINE) + NEWLINE, 'utf8')
    const driftObs = await pool.run(makeContext({ cwd: driftDir, env: {} }))
    check(
      driftObs.ok === false && typeof driftObs.detail === 'string' && driftObs.detail.includes('--ticket-count is 99'),
      'D6 规划器默认值漂移时失败并指出具体是哪一项',
      show(driftObs),
    )
    check(
      typeof driftObs.actual === 'string' && driftObs.actual.includes('"ticket-count":99') && driftObs.actual.includes('"maps":2'),
      'D7 漂移失败带上全部实测数字，不只报第一处',
      driftObs.actual,
    )

    // ---- E. sandbox-project：没点名时跳过，点名时必须带批次标记 ----
    const sandbox = checkById('sandbox-project')
    const sandboxSkip = await sandbox.run(makeContext({ env: {} }))
    check(
      sandboxSkip.ok === true &&
        typeof sandboxSkip.detail === 'string' &&
        sandboxSkip.detail.includes('soft check skipped'),
      'E1 没有点名 sandbox 项目时明确跳过',
      show(sandboxSkip),
    )

    const sandboxCalls: any[] = []
    const sandboxContext = makeContext({
      env: { DSH_VERIFY_SANDBOX_PROJECT: 'group/project' },
      command: {
        run: async (request: any) => {
          sandboxCalls.push(request)
          return okResult({
            argv: request.argv,
            cwd: request.cwd,
            exitCode: 0,
            signal: null,
            stdout: JSON.stringify({ description: 'batch [dsh-sandbox batch=B1b]' }),
            stderr: '',
            durationMs: 4,
            timedOut: false,
          })
        },
      },
    })
    const sandboxOk = await sandbox.run(sandboxContext)
    check(sandboxOk.ok === true, 'E2 项目描述带 [dsh-sandbox 标记时通过', show(sandboxOk))
    check(
      sandboxCalls.length === 1 &&
        sandboxCalls[0].argv[0] === 'glab' &&
        sandboxCalls[0].argv[1] === 'api' &&
        sandboxCalls[0].argv[2] === 'projects/group%2Fproject' &&
        sandboxCalls[0].timeoutMs === 20000,
      'E3 用 glab api projects/<URL 编码后的项目路径> 读取，超时 20 秒',
      show(sandboxCalls[0]),
    )
    check(
      typeof sandboxOk.detail === 'string' && sandboxOk.detail === 'project group/project carries a [dsh-sandbox marker',
      'E4 通过的说明写出项目名与标记',
      sandboxOk.detail,
    )

    const noMarkerContext = makeContext({
      env: { GITLAB_SANDBOX_PROJECT: 'group/bare' },
      command: {
        run: async (request: any) =>
          okResult({ argv: request.argv, cwd: request.cwd, exitCode: 0, signal: null, stdout: JSON.stringify({ description: 'ordinary project' }), stderr: '', durationMs: 1, timedOut: false }),
      },
    })
    const noMarker = await sandbox.run(noMarkerContext)
    check(
      noMarker.ok === false &&
        typeof noMarker.detail === 'string' &&
        noMarker.detail.includes('no [dsh-sandbox marker'),
      'E5 描述里没有批次标记时失败',
      show(noMarker),
    )

    const nonJsonContext = makeContext({
      env: { DSH_SANDBOX_PROJECT: 'group/broken' },
      command: {
        run: async (request: any) =>
          okResult({ argv: request.argv, cwd: request.cwd, exitCode: 0, signal: null, stdout: 'not json at all', stderr: '', durationMs: 1, timedOut: false }),
      },
    })
    const nonJson = await sandbox.run(nonJsonContext)
    check(
      nonJson.ok === false && typeof nonJson.detail === 'string' && nonJson.detail.includes('non-JSON project payload'),
      'E6 glab api 返回非 JSON 时失败，不把坏数据当没有标记',
      show(nonJson),
    )

    const sandboxNonzeroContext = makeContext({
      env: { DSH_VERIFY_SANDBOX_PROJECT: 'group/forbidden' },
      command: {
        run: async (request: any) =>
          okResult({ argv: request.argv, cwd: request.cwd, exitCode: 7, signal: null, stdout: '', stderr: '403 Forbidden', durationMs: 1, timedOut: false }),
      },
    })
    const sandboxNonzero = await sandbox.run(sandboxNonzeroContext)
    check(
      sandboxNonzero.ok === false &&
        typeof sandboxNonzero.detail === 'string' &&
        sandboxNonzero.detail.includes('exited 7') &&
        typeof sandboxNonzero.actual === 'string' &&
        sandboxNonzero.actual.includes('403 Forbidden'),
      'E7 glab api 非零退出时失败并带上错误输出',
      show(sandboxNonzero),
    )

    // ---- F. log-dir：真家目录跳过 / 可写 / 建目录失败 / 写探针失败 ----
    const logDir = checkById('log-dir')
    const realHomeSkip = await logDir.run(
      makeContext({ dshHome: join('C:/Users/tester', '.dsh'), profileDir: join(TEMP_ROOT, 'matt-b1b-profile-skip') }),
    )
    check(
      realHomeSkip.ok === true &&
        typeof realHomeSkip.detail === 'string' &&
        realHomeSkip.detail.includes('skipped by policy'),
      'F1 DSH_HOME 指向真家目录时按策略跳过写探针，并说明日志目录应在哪',
      show(realHomeSkip),
    )

    const writableHome = makeTempDir('home')
    const writableProfile = makeTempDir('profile')
    const writable = await logDir.run(makeContext({ dshHome: writableHome, profileDir: writableProfile }))
    const logsDir = join(writableProfile, '.dsh-mattskillsdeck-cache', 'logs')
    check(
      writable.ok === true && typeof writable.detail === 'string' && writable.detail.includes('log directory is writable'),
      'F2 批次 home 下可以建日志目录并写探针',
      show(writable),
    )
    check(
      fs.existsSync(logsDir) && fs.readdirSync(logsDir).every((name) => !name.startsWith('.verify-write-probe')),
      'F3 探针写完会自己删掉，不在日志目录留垃圾',
      show(fs.existsSync(logsDir) ? fs.readdirSync(logsDir) : []),
    )
    check(
      typeof writable.detail === 'string' && writable.detail.includes('has not been created yet'),
      'F4 还没有实例跑过时，说明今天的日志文件尚未出现',
      writable.detail,
    )

    fs.writeFileSync(join(logsDir, '2026-11-02.log'), 'already here' + NEWLINE, 'utf8')
    const withToday = await logDir.run(makeContext({ dshHome: writableHome, profileDir: writableProfile }))
    check(
      withToday.ok === true && typeof withToday.detail === 'string' && withToday.detail.includes('today file 2026-11-02.log exists'),
      'F5 今天的日志文件已存在时能定位到它',
      withToday.detail,
    )

    const failingMakeDirFs = { ...realFsPort(), makeDir: async () => errResult('EACCES: permission denied') }
    const makeDirFailed = await logDir.run(makeContext({ dshHome: writableHome, profileDir: writableProfile, fs: failingMakeDirFs }))
    check(
      makeDirFailed.ok === false &&
        typeof makeDirFailed.detail === 'string' &&
        makeDirFailed.detail.includes('could not create the log directory') &&
        makeDirFailed.actual === join(writableProfile, '.dsh-mattskillsdeck-cache', 'logs'),
      'F6 建不出日志目录时硬检查失败并写出目标路径',
      show(makeDirFailed),
    )

    const failingWriteFs = {
      ...realFsPort(),
      writeText: async () => errResult('EACCES: permission denied'),
    }
    const writeFailed = await logDir.run(makeContext({ dshHome: makeTempDir('home-ro'), profileDir: makeTempDir('profile-ro'), fs: failingWriteFs }))
    check(
      writeFailed.ok === false &&
        typeof writeFailed.detail === 'string' &&
        writeFailed.detail.includes('the log directory is not writable'),
      'F7 目录能建但探针写不进去时失败',
      show(writeFailed),
    )

    // ---- G. instanceEnvAllowlist：只有三个变量 ----
    function parseAllowlist(source: string): string[] {
      const marker = 'instanceEnvAllowlist:'
      const start = source.indexOf(marker)
      if (start < 0) return []
      const end = source.indexOf(']', start)
      if (end < 0) return []
      return source
        .slice(start + marker.length, end)
        .split(',')
        .map((part) => {
          let text = part.trim()
          while (text.startsWith('[') || text.startsWith('"') || text.startsWith("'")) text = text.slice(1)
          while (text.endsWith('"') || text.endsWith("'")) text = text.slice(0, -1)
          return text
        })
        .filter((part) => part !== '')
    }

    const staticAllowlist = parseAllowlist(profileSource)
    const expectedAllowlist = ['GLAB_CONFIG_DIR', 'GITLAB_TOKEN', 'GLAB_BIN']
    check(
      JSON.stringify(staticAllowlist) === JSON.stringify(expectedAllowlist),
      'G1 源码里的 instanceEnvAllowlist 恰为 GLAB_CONFIG_DIR / GITLAB_TOKEN / GLAB_BIN（顺序与数量都对）',
      show(staticAllowlist),
    )
    check(
      JSON.stringify((profile as any).instanceEnvAllowlist) === JSON.stringify(expectedAllowlist),
      'G2 运行时的 profile 实例环境名单与源码一致',
      show((profile as any).instanceEnvAllowlist),
    )
    check((profile as any).instanceEnvAllowlist.length === 3, 'G3 实例环境只有三个变量，没有多放一个', String((profile as any).instanceEnvAllowlist.length))
    const forbidden = ['PATH', 'HOME', 'NODE_OPTIONS', 'DSH_HOME', 'DSH_PROFILE', 'GITLAB_HOST', 'GLAB_TOKEN']
    const present = forbidden.filter((name) => (profile as any).instanceEnvAllowlist.includes(name))
    check(present.length === 0, 'G4 名单里没有 PATH/HOME/NODE_OPTIONS 等通用变量', show(present))
    const counted = expectedAllowlist.map((name) => ({ name, occurrences: profileSource.split(name).length - 1 }))
    check(
      counted.every((entry) => entry.occurrences === 1),
      'G5 三个变量名在 profile.ts 里各只出现一次（没有在别处再抄一份名单）',
      show(counted),
    )
    check(
      !profileSource.includes('GITLAB_TOKEN=') && !profileSource.includes('GITLAB_TOKEN ='),
      'G6 profile.ts 里只有变量名，没有把 token 值写进源码',
      '',
    )

    // ---- H. 身份行跨仓解析：base 生成，发布审计解析 ----
    const batch = parseBatchName('B1b-2026-11-02')
    const commit = parseCommitSha('a'.repeat(40))
    const sha = parseSha256Hex('b'.repeat(64))
    check(batch.ok && commit.ok && sha.ok, 'H1 用 base 的 parser 构造合法的批次名、提交与包哈希', show({ batch, commit, sha }))
    if (batch.ok && commit.ok && sha.ok) {
      const formatted = formatIdentityLine({ batchName: batch.value, commit: commit.value, packageSha256: sha.value })
      check(formatted.ok === true, 'H2 base 的 formatIdentityLine 生成身份行', show(formatted))
      if (formatted.ok) {
        const line = formatted.value
        check(line.startsWith(IDENTITY_PREFIX), 'H3 生成的行以发布审计的固定前缀开头', line)
        const auditParsed = parseAuditIdentityLine(line)
        check(
          auditParsed !== null &&
            auditParsed.batchName === 'B1b-2026-11-02' &&
            auditParsed.commit === 'a'.repeat(40) &&
            auditParsed.packageSha256 === 'b'.repeat(64),
          'H4 发布审计解析回来的批次名、候选提交、包哈希与输入完全一致',
          show(auditParsed),
        )
        const collected = collectBatchIdentities([{ body: line }])
        check(
          collected.identities.length === 1 && collected.errors.length === 0 && collected.identities[0].batchName === 'B1b-2026-11-02',
          'H5 collectBatchIdentities 认这行，且同批次不报不一致',
          show(collected),
        )
        check(parseBaseIdentityLine(line).ok === true, 'H6 base 自己的 parseIdentityLine 也能把这行解析回来', show(parseBaseIdentityLine(line)))
        check(parseAuditIdentityLine(line + '   ') !== null, 'H7 行尾空白不影响识别（评论里常见的尾随空格）', '')
        check(parseAuditIdentityLine(line.replace(commit.value, commit.value.toUpperCase())) === null, 'H8 大写哈希被拒绝，不会把近似值当身份', '')
        check(parseAuditIdentityLine('- 验证身份：批次 only-a-batch') === null, 'H9 缺候选提交与包哈希的行不被认作身份行', '')
      }
    }
  } finally {
    cleanupTempDirs()
  }

  const record = printGateResult(GATE, assertions, failed)
  console.log('GATE-SUMMARY ' + JSON.stringify(record))
  process.exitCode = failed > 0 ? 1 : 0
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error))
  printGateResult(GATE, assertions, failed + 1)
  process.exitCode = 1
})
