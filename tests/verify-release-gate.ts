// tests/verify-release-gate.ts —— 发布门禁接线的回归门禁。
//
// 覆盖的是 t16 阶段 2 在插件仓里新接的那条线：
//   scripts/lib/release-preflight-gate.mts  组合根（唯一 import runReleaseGate 的仓内文件）
//   scripts/release-preflight.mts           薄 CLI（只认 --version / --candidate）
//   verify/ticket-face.mts                  gh 适配器（真实发布路径用）
//   scripts/publish-token.ps1 / scripts/wizard-release.sh  两条发布路径的四态接线
//
// 规则本身由 base 的 runReleaseGate 负责，六条检查的用例在 base 仓里；这里证明的是
// 「插件仓把规则接上了、且两条发布路径走的是同一份代码」。所以：
//   - 门禁判定用 base 的库 API + 假票面适配器 + 假 git 命令端口，不读网络、不碰真 gh；
//   - 接线部分读真实源码做静态断言，并把 verify/ticket-face.mts 的真导出交给 base 的
//     validateTicketFaceAdapter 过一遍（它只查形状，不发起任何 IO）；
//   - 不启动实例、不改工作树、不写 D 盘。
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import {
  createNodePorts,
  formatAuditLine,
  parseCandidateManifest,
  validateTicketFaceAdapter,
  TICKET_FACE_METHODS,
  RELEASE_GATE_CHECK_IDS,
} from 'dsh-featherhunter-plugin-base/real-machine-verification'
import { runPreflightGate } from '../scripts/lib/release-preflight-gate.mts'
import ticketFace from '../verify/ticket-face.mts'
import { printGateResult } from './lib/gate-result.ts'

const GATE = 'verify-release-gate'
const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const NEWLINE = String.fromCharCode(10)

const RELEASE_PREFLIGHT = join(ROOT, 'scripts', 'release-preflight.mts')
const RELEASE_PREFLIGHT_GATE = join(ROOT, 'scripts', 'lib', 'release-preflight-gate.mts')
const TICKET_FACE = join(ROOT, 'verify', 'ticket-face.mts')
const PROFILE = join(ROOT, 'verify', 'profile.ts')
const PUBLISH_TOKEN = join(ROOT, 'scripts', 'publish-token.ps1')
const WIZARD_RELEASE = join(ROOT, 'scripts', 'wizard-release.sh')
const SCRIPTS_TSCONFIG = join(ROOT, 'scripts', 'tsconfig.json')

const CANDIDATE = 'a'.repeat(40)
const RELEASE = 'b'.repeat(40)
const OTHER = 'c'.repeat(40)
const TGZ = 'd'.repeat(64)
const FILE_DIGEST = 'e'.repeat(64)
const MANIFEST_DIGEST = 'f'.repeat(64)
const VERSION = '1.2.3'

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

// ---- fixtures：票据记录与候选清单都按 base 的契约构造 ----

function releaseCandidate(
  overrides: { commit?: string; version?: string; validity?: 'release' | 'development' } = {},
): any {
  const parsed = parseCandidateManifest({
    schemaVersion: 2,
    generatedAt: '2026-01-02T03:04:05.000Z',
    tool: 'fake-freeze@0.1.5',
    version: overrides.version ?? VERSION,
    validity: overrides.validity ?? 'release',
    sourceStable: true,
    git: { commit: overrides.commit ?? CANDIDATE, branch: 'main', dirty: false, dirtyFiles: [] },
    package: {
      tgzPath: 'C:/repo/candidates/plugin-1.2.3.tgz',
      tgzBytes: 2048,
      tgzSha256: TGZ,
      filename: 'plugin-1.2.3.tgz',
      files: [{ path: 'package.json', bytes: 120, sha256: FILE_DIGEST }],
      fileCount: 1,
      fileDigest: FILE_DIGEST,
      manifestDigest: MANIFEST_DIGEST,
    },
  })
  if (!parsed.ok) throw new Error('candidate fixture is invalid: ' + parsed.error.message)
  return parsed.value
}

function identityLine(batch = 'batch-1', commit = CANDIDATE, sha = TGZ): string {
  return '- 验证身份：批次 ' + batch + '；候选提交 ' + commit + '；候选包 sha256 ' + sha
}

function checklistBody(options: { status?: string; audit?: string } = {}): string {
  const lines = [
    '# 真机验证清单 ' + VERSION,
    '',
    '## 场景总览',
    '| 场景编号 | 来源票 | 一句话 | 状态 | 备注 |',
    '| --- | --- | --- | --- | --- |',
    '| 1600-01 | #16 | release gate | ' + (options.status ?? '通过') + ' | |',
  ]
  if (options.audit !== undefined) {
    lines.push('', '## 候选与发布差异审计', options.audit)
  }
  return lines.join(NEWLINE)
}

function checklistIssue(overrides: { number?: number; state?: 'OPEN' | 'CLOSED' | 'UNKNOWN'; body?: string } = {}): any {
  return {
    number: overrides.number ?? 12,
    title: '[真机验证] ' + VERSION,
    state: overrides.state ?? 'CLOSED',
    body: overrides.body ?? checklistBody(),
  }
}

function batchComment(
  options: { batch?: string; commit?: string; sha?: string; result?: string; identity?: boolean } = {},
): any {
  const result = options.result ?? '通过'
  const passed = result === '通过' ? 1 : 0
  const failedCount = result === '失败' ? 1 : 0
  const lines = ['批次开始']
  if (options.identity !== false) {
    lines.push(identityLine(options.batch ?? 'batch-1', options.commit ?? CANDIDATE, options.sha ?? TGZ))
  }
  lines.push('场景 1600-01：' + result)
  lines.push('[发布就绪] 通过 ' + String(passed) + ' / 失败 ' + String(failedCount) + ' / 豁免 0')
  return { body: lines.join(NEWLINE) }
}

function fakeTicketFace(
  options: { issues?: any[]; comments?: any[]; releaseCommit?: string; ancestry?: boolean | 'unknown' } = {},
): any {
  return {
    kind: 'fake',
    async listChecklistIssues() {
      return [...(options.issues ?? [])]
    },
    async listComments(_issueNumber: number) {
      return [...(options.comments ?? [])]
    },
    async resolveReleaseCommit() {
      return options.releaseCommit ?? ''
    },
    async isAncestor() {
      return options.ancestry ?? true
    },
  }
}

function happyFace(overrides: Parameters<typeof fakeTicketFace>[0] = {}): any {
  return fakeTicketFace({
    issues: [checklistIssue()],
    comments: [batchComment()],
    releaseCommit: RELEASE,
    ...overrides,
  })
}

function fakeCommand(exitCode: number, stderr = ''): any {
  return {
    requests: [],
    async run(request: any) {
      this.requests.push(request)
      return {
        ok: true,
        value: {
          argv: request.argv,
          cwd: request.cwd ?? '',
          exitCode,
          signal: null,
          stdout: '',
          stderr,
          durationMs: 1,
          timedOut: false,
        },
      }
    },
  }
}

// 门禁只用到 command 端口（git）；适配器是直接传进去的对象，所以 fs 用真的也无妨。
function portsWithCommand(command: any): any {
  return createNodePorts({ overrides: { command } })
}

interface GateRun {
  exitCode: number
  report: any
  lines: Array<{ stream: 'out' | 'err'; text: string }>
  out: string
  err: string
}

async function runGate(overrides: Record<string, unknown> = {}): Promise<GateRun> {
  const outcome = await runPreflightGate({
    version: VERSION,
    releaseCommit: RELEASE,
    candidate: releaseCandidate(),
    ports: portsWithCommand(fakeCommand(0)),
    ticketFace: happyFace(),
    ...overrides,
  })
  const lines = [...outcome.lines]
  const out = lines.filter((line) => line.stream === 'out').map((line) => line.text).join(NEWLINE)
  const err = lines.filter((line) => line.stream === 'err').map((line) => line.text).join(NEWLINE)
  return { exitCode: outcome.exitCode, report: outcome.report, lines, out, err }
}

function statusOf(report: any, id: string): string {
  const found = (report?.checks ?? []).find((item: any) => String(item.id) === id)
  return found === undefined ? 'missing' : String(found.status)
}

function hasFinding(report: any, code: string): boolean {
  return (report?.findings ?? []).some((finding: any) => finding.code === code)
}

function readSource(path: string): string {
  return fs.readFileSync(path, 'utf8')
}

// 扫源码树找「谁 import 了某个符号」：只看代码扩展名，跳过 node_modules 与构建产物。
// 只认 import 语句（含多行 import { ... }），注释里提到符号不算接线。
function importsSymbol(text: string, symbol: string): boolean {
  return new RegExp('import\\s*\\{[^}]*\\b' + symbol + '\\b', 's').test(text)
}

function scanImportsOf(needle: string): string[] {
  const extensions = new Set(['.ts', '.mts', '.cts', '.tsx', '.js', '.mjs', '.cjs'])
  const skipDirs = new Set(['node_modules', 'dist', 'coverage', '.git'])
  const hits: string[] = []
  const walk = (dir: string): void => {
    let entries: fs.Dirent[] = []
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (skipDirs.has(entry.name)) continue
        if (entry.name.startsWith('.scratch')) continue
        walk(join(dir, entry.name))
        continue
      }
      if (!extensions.has(entry.name.slice(entry.name.lastIndexOf('.')))) continue
      const path = join(dir, entry.name)
      let text = ''
      try {
        text = fs.readFileSync(path, 'utf8')
      } catch {
        continue
      }
      if (importsSymbol(text, needle)) hits.push(path)
    }
  }
  for (const root of ['scripts', 'verify', 'tests', 'src']) walk(join(ROOT, root))
  return hits.sort()
}

function countOccurrences(text: string, needle: string): number {
  let count = 0
  let index = text.indexOf(needle)
  while (index >= 0) {
    count++
    index = text.indexOf(needle, index + needle.length)
  }
  return count
}

async function main(): Promise<void> {
  // ---- A. 主路径：一张完整清单票 + 冻结候选，门禁通过，CLI 标记齐全 ----
  {
    const run = await runGate()
    check(run.exitCode === 0, 'A1 完整清单票 + 合法候选 → 退出码 0', show(run.exitCode))
    check(run.report?.decision === 'pass', 'A2 报告 decision=pass', show(run.report?.decision))
    check(run.lines.every((line) => line.stream === 'out'), 'A3 通过时所有行都走 stdout（stderr 留给失败与阻塞）', show(run.lines.map((line) => line.stream)))
    check(run.out.includes('PREFLIGHT-OK'), 'A4 stdout 有 PREFLIGHT-OK 标记', run.out.split(NEWLINE).slice(-6).join(' / '))
    check(run.out.includes('v' + VERSION + ' at ' + RELEASE), 'A5 PREFLIGHT-OK 带版本与发布提交', '')
    check(run.out.includes('decision: pass (exit 0)'), 'A6 人类可读报告末尾有 decision 行', '')
    check(
      JSON.stringify((run.report?.checks ?? []).map((item: any) => String(item.id))) === JSON.stringify([...RELEASE_GATE_CHECK_IDS]),
      'A7 六项检查按契约顺序出现，一项不少',
      show((run.report?.checks ?? []).map((item: any) => String(item.id))),
    )
    check(statusOf(run.report, 'release-candidate-valid') === 'pass', 'A8 合法候选候选检查 pass', statusOf(run.report, 'release-candidate-valid'))
    check(statusOf(run.report, 'release-batch-identity') === 'pass', 'A9 身份行与候选一致', statusOf(run.report, 'release-batch-identity'))
    check(run.report?.ticket?.number === 12 && run.report?.ticket?.exactCount === 1, 'A10 报告记下唯一清单票 #12', show(run.report?.ticket))
    check(run.err === '', 'A11 通过时 stderr 为空', run.err)
  }

  // ---- B. 批次评论缺身份行 → fail / identity-missing，走 CHECK-FAIL 一路 ----
  {
    const run = await runGate({ ticketFace: happyFace({ comments: [batchComment({ identity: false })] }) })
    check(run.exitCode === 1, 'B1 缺身份行 → 退出码 1', show(run.exitCode))
    check(hasFinding(run.report, 'identity-missing'), 'B2 报告带 identity-missing finding', show(run.report?.findings?.map((f: any) => f.code)))
    check(run.err.includes('PREFLIGHT-FAIL 发布门禁拒绝 v' + VERSION), 'B3 stderr 有拒绝汇总行', run.err.split(NEWLINE)[0] ?? '')
    check(run.err.includes('PREFLIGHT-FAIL identity-missing：'), 'B4 每条 finding 都带「改法」行', '')
    check(!run.out.includes('PREFLIGHT-OK'), 'B5 失败时绝不出现 PREFLIGHT-OK', '')
    check(run.out.includes('decision: fail (exit 1)'), 'B6 人类可读报告仍完整打印', '')
  }

  // ---- C. 身份行指向别的提交 → identity-not-in-candidate ----
  {
    const run = await runGate({ ticketFace: happyFace({ comments: [batchComment({ commit: OTHER })] }) })
    check(run.exitCode === 1, 'C1 身份行候选提交与候选包不符 → 退出码 1', show(run.exitCode))
    check(hasFinding(run.report, 'identity-not-in-candidate'), 'C2 报告带 identity-not-in-candidate', show(run.report?.findings?.map((f: any) => f.code)))
    check(run.err.includes('PREFLIGHT-FAIL identity-not-in-candidate：'), 'C3 CLI 点名该 finding code', '')
  }

  // ---- D. 清单票还没关闭 → checklist-not-closed ----
  {
    const run = await runGate({ ticketFace: happyFace({ issues: [checklistIssue({ state: 'OPEN' })] }) })
    check(run.exitCode === 1, 'D1 清单票 OPEN → 退出码 1', show(run.exitCode))
    check(hasFinding(run.report, 'checklist-not-closed'), 'D2 报告带 checklist-not-closed', show(run.report?.findings?.map((f: any) => f.code)))
    check(run.err.includes('PREFLIGHT-FAIL checklist-not-closed：'), 'D3 CLI 点名该 finding code', '')
  }

  // ---- E. 候选不是发布提交的祖先、票面又没有差异审计 → 两条 finding 一起红 ----
  {
    const run = await runGate({ ticketFace: happyFace({ ancestry: false }) })
    check(run.exitCode === 1, 'E1 候选非祖先且无审计 → 退出码 1', show(run.exitCode))
    check(hasFinding(run.report, 'commit-not-ancestor'), 'E2 报告带 commit-not-ancestor', show(run.report?.findings?.map((f: any) => f.code)))
    check(hasFinding(run.report, 'audit-missing'), 'E3 报告带 audit-missing', '')
    check(run.report?.audit?.required === true && run.report?.audit?.covered === false, 'E4 报告记下「需要审计、未覆盖」', show(run.report?.audit))
    check(run.err.includes('PREFLIGHT-FAIL commit-not-ancestor：'), 'E5 CLI 把两条 finding 都打出来', '')
  }

  // ---- F. 票面写了差异审计 → 候选非祖先也能过，并打 PREFLIGHT-CANDIDATE-AUDIT ----
  {
    const audit = formatAuditLine({
      candidateCommit: CANDIDATE,
      releaseCommit: RELEASE,
      reason: 'release branch merged the candidate after the freeze',
    })
    const run = await runGate({
      ticketFace: happyFace({ ancestry: false, issues: [checklistIssue({ body: checklistBody({ audit }) })] }),
    })
    check(run.exitCode === 0, 'F1 票面覆盖差异审计 → 退出码 0', show(run.exitCode) + ' / ' + run.err.split(NEWLINE)[0])
    check(run.report?.audit?.covered === true, 'F2 报告记下审计已覆盖', show(run.report?.audit))
    check(
      run.out.includes('PREFLIGHT-CANDIDATE-AUDIT commit=' + CANDIDATE),
      'F3 stdout 有候选差异审计标记（发布脚本据此对账字节）',
      run.out.split(NEWLINE).filter((line) => line.startsWith('PREFLIGHT-CANDIDATE')).join(' / '),
    )
    check(run.out.includes('fileDigest=' + FILE_DIGEST), 'F4 审计标记带候选包 sha256', '')
  }

  // ---- G. 没配票面适配器 → blocked（exit 2），给三步注入方法，绝不绿 ----
  {
    const run = await runGate({ ticketFace: false })
    check(run.exitCode === 2, 'G1 无适配器 → 退出码 2（blocked 不是 fail）', show(run.exitCode))
    check(run.report?.decision === 'blocked', 'G2 报告 decision=blocked', show(run.report?.decision))
    check(run.report?.blocked?.[0]?.code === 'adapter-missing', 'G3 阻塞原因 adapter-missing', show(run.report?.blocked?.[0]?.code))
    check(run.err.includes('PREFLIGHT-BLOCKED'), 'G4 stderr 有 PREFLIGHT-BLOCKED 标记', '')
    check(run.err.includes('add to verify/profile.ts'), 'G5 阻塞行带三步注入方法', '')
    check(run.err.includes('改法：'), 'G6 阻塞行带可执行的「改法」', '')
    check(!run.out.includes('PREFLIGHT-OK') && !run.err.includes('PREFLIGHT-FAIL'), 'G7 阻塞既不算通过也不算失败', '')
  }

  // ---- H. development 候选拒发 → candidate-not-release ----
  {
    const run = await runGate({ candidate: releaseCandidate({ validity: 'development' }) })
    check(run.exitCode === 1, 'H1 development 候选 → 退出码 1', show(run.exitCode))
    check(hasFinding(run.report, 'candidate-not-release'), 'H2 报告带 candidate-not-release', show(run.report?.findings?.map((f: any) => f.code)))
    check(run.err.includes('PREFLIGHT-FAIL candidate-not-release：'), 'H3 CLI 点名该 finding code', '')
  }

  // ---- I. 候选就是发布提交 → PREFLIGHT-CANDIDATE-OK ----
  {
    const run = await runGate({
      candidate: releaseCandidate({ commit: RELEASE }),
      ticketFace: happyFace({ comments: [batchComment({ commit: RELEASE })] }),
    })
    check(run.exitCode === 0, 'I1 候选提交等于发布提交 → 退出码 0', show(run.exitCode))
    check(run.out.includes('PREFLIGHT-CANDIDATE-OK commit=' + RELEASE), 'I2 stdout 有 PREFLIGHT-CANDIDATE-OK', '')
    check(run.out.includes('fileDigest=' + FILE_DIGEST), 'I3 标记带候选包 sha256', '')
    check(run.report?.audit?.required === false, 'I4 无需差异审计（要求是空的，不是没证）', show(run.report?.audit))
  }

  // ---- J. 环境类输入错误：都归 exit 2，不冒充票面失败 ----
  {
    const gitRun = await runGate({ releaseCommit: undefined, ports: portsWithCommand(fakeCommand(128, 'fatal: not a git repository')) })
    check(gitRun.exitCode === 2, 'J1 git 取不到 HEAD → 退出码 2', show(gitRun.exitCode))
    check(gitRun.err.includes('PREFLIGHT-ENV') && gitRun.err.includes('git rev-parse HEAD 失败'), 'J2 stderr 说清是 git 环境问题', gitRun.err.split(NEWLINE)[0] ?? '')

    const versionRun = await runGate({ version: undefined, readVersion: () => '   ' })
    check(versionRun.exitCode === 2, 'J3 版本号为空 → 退出码 2', show(versionRun.exitCode))
    check(versionRun.err.includes('PREFLIGHT-ENV') && versionRun.err.includes('版本号'), 'J4 stderr 说清缺版本号', versionRun.err.split(NEWLINE)[0] ?? '')

    const missingCandidate = await runGate({ candidate: undefined, candidatePath: 'D:/Temp/__no_such_candidate__.json' })
    check(missingCandidate.exitCode === 2, 'J5 候选清单文件不存在 → 退出码 2', show(missingCandidate.exitCode))
    check(missingCandidate.err.includes('PREFLIGHT-ENV') && missingCandidate.err.includes('候选清单文件不存在'), 'J6 stderr 点名缺失的候选清单', missingCandidate.err.split(NEWLINE)[0] ?? '')

    const noDeclaration = await runGate({
      ticketFace: undefined,
      profile: undefined,
      repoRoot: 'D:/Temp/__no_such_release_repo__',
    })
    check(noDeclaration.exitCode === 2, 'J7 找不到 verify/profile.ts 声明 → 退出码 2', show(noDeclaration.exitCode))
    check(noDeclaration.err.includes('PREFLIGHT-BLOCKED'), 'J8 声明缺失归 blocked 且给改法', noDeclaration.err.split(NEWLINE)[0] ?? '')
  }

  // ---- K. 接线静态断言：两条发布路径同一份代码、没留跳过开关 ----
  {
    const cliSource = readSource(RELEASE_PREFLIGHT)
    check(cliSource.includes("from './lib/release-preflight-gate.mts'"), 'K1 薄 CLI 从组合根 import runPreflightGate', '')
    check(countOccurrences(cliSource, 'runPreflightGate(') === 1, 'K2 薄 CLI 只调一次组合根，没有第二条判定路径', show(countOccurrences(cliSource, 'runPreflightGate(')))
    check(!importsSymbol(cliSource, 'runReleaseGate'), 'K3 薄 CLI 不直接 import 门禁，规则只在组合根里接', '')
    check(!cliSource.includes("'--soft'") && !cliSource.includes('"--soft"'), 'K4 薄 CLI 不接 --soft（注释里说明为什么不传不算开关）', '')
    check(
      !cliSource.includes('--force') && !cliSource.includes('--no-verify') && !cliSource.includes('skip'),
      'K5 薄 CLI 没有 force / no-verify / skip 开关',
      '',
    )
    check(cliSource.includes('process.exitCode'), 'K6 用 process.exitCode 收尾（Node 24 Windows 上不截断 stdout）', '')
    check(!cliSource.includes('process.exit('), 'K7 不直接调 process.exit(', '')

    const gateSource = readSource(RELEASE_PREFLIGHT_GATE)
    check(countOccurrences(gateSource, 'runReleaseGate(') === 1, 'K8 组合根里 runReleaseGate 只调用一次', show(countOccurrences(gateSource, 'runReleaseGate(')))
    check(gateSource.includes('renderReleaseGateHuman'), 'K9 组合根用 base 的人类可读报告渲染', '')
    check(gateSource.includes('PREFLIGHT-CANDIDATE-AUDIT') && gateSource.includes('PREFLIGHT-CANDIDATE-OK'), 'K10 候选标记在组合根里生成', '')
    check(gateSource.includes('PREFLIGHT-BLOCKED') && gateSource.includes('PREFLIGHT-FAIL') && gateSource.includes('PREFLIGHT-OK') && gateSource.includes('PREFLIGHT-ENV'), 'K11 四类标记齐全', '')

    const importers = scanImportsOf('runReleaseGate')
    check(
      JSON.stringify(importers) === JSON.stringify([RELEASE_PREFLIGHT_GATE]),
      'K12 全仓只有组合根 import runReleaseGate（没有第二处接线，也没有第二份规则）',
      show(importers.map((path) => path.slice(ROOT.length + 1))),
    )

    const publishSource = readSource(PUBLISH_TOKEN)
    check(publishSource.includes('scripts/release-preflight.mts'), 'K13 publish-token.ps1 调发布前检查', '')
    check(!publishSource.includes('--soft'), 'K14 publish-token.ps1 不再传跳过开关', '')
    check(publishSource.includes('CHECK-BLOCKED') && publishSource.includes('CHECK-ENV'), 'K15 publish-token.ps1 接了四态（含 blocked / env）', '')

    const wizardSource = readSource(WIZARD_RELEASE)
    check(wizardSource.includes('scripts/release-preflight.mts'), 'K16 wizard-release.sh 调发布前检查', '')
    check(!wizardSource.includes('--soft'), 'K17 wizard-release.sh 不再传跳过开关', '')
    check(wizardSource.includes('PREFLIGHT_CODE') && wizardSource.includes('exit 2'), 'K18 wizard-release.sh 区分 blocked（exit 2）', '')

    const profileSource = readSource(PROFILE)
    check(profileSource.includes('ticketFace') && profileSource.includes('verify/ticket-face.mts'), 'K19 verify/profile.ts 声明票面适配器', '')

    const ticketFaceSource = readSource(TICKET_FACE)
    check(ticketFaceSource.includes('merge-base') && ticketFaceSource.includes('"unknown"'), 'K20 gh 适配器的 isAncestor 三态，不拿 false 冒充 unknown', '')
    check(ticketFaceSource.includes('ReleaseEnvError'), 'K21 环境问题抛 ReleaseEnvError（门禁归 blocked，不冒充票面失败）', '')

    const validated = validateTicketFaceAdapter(ticketFace)
    check(validated.ok === true, 'K22 verify/ticket-face.mts 的默认导出通过 base 的适配器形状校验', validated.ok ? '' : show(validated))
    check(ticketFace?.kind === 'github-gh-cli', 'K23 适配器 kind 说明协议来源', show(ticketFace?.kind))
    check(
      TICKET_FACE_METHODS.every((method: string) => typeof (ticketFace as any)[method] === 'function'),
      'K24 四个必需方法都在',
      show(TICKET_FACE_METHODS.map((method: string) => typeof (ticketFace as any)[method])),
    )

    const tsconfigSource = readSource(SCRIPTS_TSCONFIG)
    check(tsconfigSource.includes('lib/release-preflight-gate.mts'), 'K25 组合根登记进 scripts/tsconfig.json', '')
    check(tsconfigSource.includes('../verify/ticket-face.mts'), 'K26 票面适配器登记进 scripts/tsconfig.json', '')
  }

  // ---- L. 薄 CLI 的子进程行为（--help 与参数错误，不触发网络） ----
  {
    const help = spawnSync(process.execPath, [RELEASE_PREFLIGHT, '--help'], { cwd: ROOT, encoding: 'utf8' })
    check(help.status === 0, 'L1 --help 退出码 0', String(help.status))
    check((help.stdout ?? '').includes('用法'), 'L2 --help 打印用法', (help.stdout ?? '').trim().slice(0, 80))
    check(!(help.stdout ?? '').includes('PREFLIGHT-ENV'), 'L3 --help 不冒充参数错误', '')

    const bogus = spawnSync(process.execPath, [RELEASE_PREFLIGHT, '--bogus'], { cwd: ROOT, encoding: 'utf8' })
    check(bogus.status === 2, 'L4 不认识的参数 → 退出码 2', String(bogus.status))
    check((bogus.stderr ?? '').includes('PREFLIGHT-ENV') && (bogus.stderr ?? '').includes('不认识的参数'), 'L5 参数错误走 PREFLIGHT-ENV 并点名参数', (bogus.stderr ?? '').trim().slice(0, 120))

    const soft = spawnSync(process.execPath, [RELEASE_PREFLIGHT, '--version', '1.2.3', '--soft'], { cwd: ROOT, encoding: 'utf8' })
    check(soft.status === 2 && (soft.stderr ?? '').includes('不认识的参数：--soft'), 'L8 传 --soft 直接被拒（没有跳过开关）', String(soft.status) + ' / ' + (soft.stderr ?? '').trim().slice(0, 80))

    const missingValue = spawnSync(process.execPath, [RELEASE_PREFLIGHT, '--version'], { cwd: ROOT, encoding: 'utf8' })
    check(missingValue.status === 2, 'L6 --version 缺值 → 退出码 2', String(missingValue.status))
    check((missingValue.stderr ?? '').includes('PREFLIGHT-ENV'), 'L7 缺值也是环境类错误', (missingValue.stderr ?? '').trim().slice(0, 120))
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
