// scripts/lib/release-preflight-gate.mts —— 发布门禁的组合根：把本仓的「环境事实」接到 base 的纯规则上。
//
// 为什么要有这一层：门禁的六条规则（清单票唯一 / 已关闭 / 正文与评论一致 / 批次身份行 /
// 候选祖先与差异审计 / 候选清单合法）是通用规则，已经由 base 的 runReleaseGate 实现；
// 本仓只负责回答规则问不出来的三件事：
//   1. 本版是哪个版本号（--version 或 package.json）；
//   2. 发布提交是哪个提交（git rev-parse HEAD）；
//   3. 票面从哪读（verify/profile.ts 的 ticketFace 声明，指向 verify/ticket-face.mts）。
// 这样两条发布路径（publish-token.ps1 与 wizard-release.sh 的第⑤步）跑的是同一份代码，
// 不存在「无人值守路径少查一条」的漏洞；agent 与人也拿到同一份报告。
//
// 本文件只返回「要以什么退出码结束、打印哪些行」，不直接 process.exit、不直接 console.log：
// 退出码与输出由 scripts/release-preflight.mts（薄 CLI）和一个测试共用，输出可断言。
import { readFileSync } from 'node:fs'
import path from 'node:path'

import {
  createNodePorts,
  loadVerificationDeclaration,
  parseCandidateManifest,
  renderReleaseGateHuman,
  runReleaseGate,
} from 'dsh-featherhunter-plugin-base/real-machine-verification'
import type {
  CandidateManifest,
  Ports,
  ReleaseGateReport,
  TicketFaceAdapter,
  TicketFaceDeclaration,
  VerificationProfile,
} from 'dsh-featherhunter-plugin-base/real-machine-verification'

import { REPO_ROOT, readPackageVersion } from './release-checklist.mts'

/** 一行输出属于哪个流；发布脚本把两条流合并后按标记行判断。 */
export interface PreflightLine {
  readonly stream: 'out' | 'err'
  readonly text: string
}

/** 一次发布前检查的完整结果：退出码、报告（环境失败时为 null）与要打印的行。 */
export interface PreflightGateOutcome {
  readonly exitCode: 0 | 1 | 2
  readonly report: ReleaseGateReport | null
  readonly lines: readonly PreflightLine[]
}

/**
 * 组合根的入参。
 *
 * 除了版本号与候选清单路径，其余都是给测试用的接缝：测试直接注入假适配器、假提交号与
 * 假候选对象，既不跑 gh 也不跑 git。生产调用只传 version 与 candidatePath。
 */
export interface PreflightGateOptions {
  /** 本版版本号；缺省读仓根 package.json。 */
  readonly version?: string
  /** 候选清单 JSON 路径（相对当前工作目录）；不给就不做候选字节检查。 */
  readonly candidatePath?: string
  /** 仓库根；缺省是本脚本所在的仓。 */
  readonly repoRoot?: string
  /** 端口集合；只用于 git 与「加载 verify/profile.ts」两件事。 */
  readonly ports?: Ports
  /** 已加载的 profile；不给时按 verify/profile.ts 现场加载。 */
  readonly profile?: VerificationProfile
  /** 直接给票面适配器（或 false 表示禁用）；给了就不加载 profile。 */
  readonly ticketFace?: TicketFaceAdapter | TicketFaceDeclaration | false
  /** 发布提交；不给时跑 git rev-parse HEAD。 */
  readonly releaseCommit?: string
  /** 已解析的候选清单；不给且给了 candidatePath 时从文件读。 */
  readonly candidate?: CandidateManifest | null
  /** 指定清单票号；缺省按「恰好一张同名票」自动选。 */
  readonly checklistTicket?: number
  /** 本版存在的原因票（只进报告注记）。 */
  readonly primaryTicket?: number
  /** 额外的差异审计行（票面正文与评论也会被扫描）。 */
  readonly auditLines?: readonly string[]
  /** true 时缺候选清单算失败；发布路径不设，表示「只查票面」。 */
  readonly requireCandidate?: boolean
  /** 动态 import 的接缝（测试用）。 */
  readonly importModule?: (specifier: string) => Promise<unknown>
  /** 读版本号的接缝（测试用）；缺省 readPackageVersion。 */
  readonly readVersion?: () => string
}

type GitTextResult = { readonly ok: true; readonly value: string } | { readonly ok: false; readonly message: string }

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/** 跑一次 git 并回读 stdout。失败时返回一句话，由调用方按环境问题退出 2。 */
async function gitText(ports: Ports, args: readonly string[], cwd: string): Promise<GitTextResult> {
  const outcome = await ports.command.run({ argv: ['git', ...args], cwd, timeoutMs: 60_000 })
  if (!outcome.ok) {
    return { ok: false, message: '调不起 git：' + outcome.error.message + '。发布前检查要在仓库里跑，且 git 要可用。' }
  }
  const result = outcome.value
  if (result.exitCode !== 0) {
    const detail = String(result.stderr || '').trim()
    return {
      ok: false,
      message:
        'git ' + args.join(' ') + ' 失败（exit=' + String(result.exitCode) + '）' +
        (detail ? '：' + detail : '') + '。',
    }
  }
  return { ok: true, value: String(result.stdout || '').trim() }
}

/** 把一行失败标成环境问题：退出码 2，前缀 PREFLIGHT-ENV（发布脚本按它区分 1 与 2）。 */
function envFail(lines: PreflightLine[], message: string, hint?: string): PreflightGateOutcome {
  lines.push({ stream: 'err', text: 'PREFLIGHT-ENV ' + message + (hint ? '（改法：' + hint + '）' : '') })
  return { exitCode: 2, report: null, lines }
}

/**
 * 跑一次发布前检查。
 *
 * 顺序是有讲究的：先确认「这次发布是什么」（版本、提交、候选包），再确认「谁来说票面」（适配器），
 * 最后才跑门禁。前三步任一失败都是环境问题（exit 2）——发布脚本不该把「gh 没登录」误报成
 * 「清单票没关闭」让作者去改票。只有门禁自己产出报告后，才按 0/1/2 三态给结论。
 */
export async function runPreflightGate(options: PreflightGateOptions = {}): Promise<PreflightGateOutcome> {
  const lines: PreflightLine[] = []
  const repoRoot = path.resolve(options.repoRoot ?? REPO_ROOT)
  const ports = options.ports ?? createNodePorts()

  let version = ''
  try {
    const raw =
      options.version !== undefined && options.version.trim() !== ''
        ? options.version
        : (options.readVersion ?? readPackageVersion)()
    version = String(raw || '').trim().replace(/^[vV]/, '')
  } catch (error) {
    return envFail(
      lines,
      '读不到本版版本号：' + describeError(error) + '。',
      '用 --version 指定版本号，或确认 package.json 里有 version。',
    )
  }
  if (version === '') {
    return envFail(lines, '版本号为空：用 --version 指定，或确认 package.json 里有 version。')
  }

  let releaseCommit = options.releaseCommit ?? ''
  if (releaseCommit === '') {
    const head = await gitText(ports, ['rev-parse', 'HEAD'], repoRoot)
    if (!head.ok) return envFail(lines, head.message)
    releaseCommit = head.value
  }
  if (!/^[0-9a-f]{40}$/.test(releaseCommit)) {
    return envFail(lines, 'git rev-parse HEAD 没给出 40 位小写提交号：' + (releaseCommit || '<空>') + '。')
  }

  let candidate: CandidateManifest | null = null
  if (options.candidate !== undefined) {
    candidate = options.candidate
  } else if (options.candidatePath !== undefined && options.candidatePath !== '') {
    const resolved = path.resolve(process.cwd(), options.candidatePath)
    let raw: unknown
    try {
      raw = JSON.parse(readFileSync(resolved, 'utf8'))
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code
      if (code === 'ENOENT') {
        return envFail(lines, '候选清单文件不存在：' + resolved + '。', '检查 --candidate 的路径。')
      }
      return envFail(
        lines,
        '候选清单读不出来或不是合法 JSON：' + resolved + '（' + describeError(error) + '）。',
        '检查 --candidate 指向的文件。',
      )
    }
    const parsed = parseCandidateManifest(raw)
    if (!parsed.ok) {
      return envFail(lines, '候选清单不符合候选清单契约：' + parsed.error.message, parsed.error.hint)
    }
    candidate = parsed.value
  }

  // 票面从哪来：要么调用方直接给了适配器，要么按 verify/profile.ts 的声明现场加载。
  // 声明缺失是「无法观察」而不是「验证失败」：给 blocked（exit 2）与三段式修法，不给人改票的压力。
  let profile = options.profile
  if (profile === undefined && options.ticketFace === undefined) {
    const declaration = await loadVerificationDeclaration({
      fs: ports.fs,
      cwd: repoRoot,
      nodeVersion: process.version,
      declarationPath: path.join(repoRoot, 'verify', 'profile.ts'),
    })
    if (!declaration.ok) {
      if (declaration.error.kind === 'blocked') {
        lines.push({
          stream: 'err',
          text:
            'PREFLIGHT-BLOCKED ' +
            declaration.error.message +
            (declaration.error.hint ? '（改法：' + declaration.error.hint + '）' : ''),
        })
        return { exitCode: 2, report: null, lines }
      }
      return envFail(lines, 'verify/profile.ts 读不通：' + declaration.error.message, declaration.error.hint)
    }
    profile = declaration.value.profile
  }

  const gate = await runReleaseGate({
    ports,
    candidate,
    releaseCommit,
    releaseVersion: version,
    workRoot: repoRoot,
    ...(options.checklistTicket === undefined ? {} : { checklistTicket: options.checklistTicket }),
    ...(options.primaryTicket === undefined ? {} : { primaryTicket: options.primaryTicket }),
    ...(options.auditLines === undefined ? {} : { auditLines: options.auditLines }),
    ...(profile === undefined ? {} : { profile }),
    ...(options.ticketFace === undefined ? {} : { ticketFace: options.ticketFace }),
    ...(options.requireCandidate === undefined ? {} : { requireCandidate: options.requireCandidate }),
    ...(options.importModule === undefined ? {} : { importModule: options.importModule }),
  })
  if (!gate.ok) {
    return envFail(
      lines,
      '发布门禁无法用这组输入判定（' + gate.error.code + '）：' + gate.error.message,
      gate.error.hint,
    )
  }

  const report = gate.value
  for (const text of renderReleaseGateHuman(report).split(/\r?\n/)) {
    if (text.trim() !== '') lines.push({ stream: 'out', text })
  }

  // 候选标记：发布脚本按这两行决定「要不要做发布字节对账、差异是否有审计覆盖」。
  // 只有候选提交就是发布提交（同一份字节）时才是 CANDIDATE-OK；不同提交时，
  // 只有当差异审计真的覆盖了这对提交（audit.required && audit.covered）才给 CANDIDATE-AUDIT。
  if (report.candidate !== null) {
    if (report.candidate.commit === releaseCommit) {
      lines.push({
        stream: 'out',
        text: 'PREFLIGHT-CANDIDATE-OK commit=' + releaseCommit + ' fileDigest=' + report.candidate.fileDigest,
      })
    } else if (report.audit.required && report.audit.covered) {
      lines.push({
        stream: 'out',
        text: 'PREFLIGHT-CANDIDATE-AUDIT commit=' + report.candidate.commit + ' fileDigest=' + report.candidate.fileDigest,
      })
    } else if (report.audit.required) {
      lines.push({
        stream: 'out',
        text: 'PREFLIGHT-INFO 候选提交与发布提交不同，且票面没有覆盖这对提交的差异审计：发布脚本会按候选包对账字节。',
      })
    }
  } else {
    lines.push({
      stream: 'out',
      text: 'PREFLIGHT-INFO 没传 --candidate：只核对清单票与票面身份行，不证明要发的字节。',
    })
  }

  if (report.decision === 'pass') {
    const ticket = report.ticket.number === null ? '没有清单票' : '清单票 #' + String(report.ticket.number)
    lines.push({
      stream: 'out',
      text:
        'PREFLIGHT-OK 发布门禁通过：v' + version + ' at ' + releaseCommit + '；' + ticket +
        '；' + String(report.tally.passed) + '/' + String(report.tally.total) + ' 项检查通过。',
    })
    return { exitCode: 0, report, lines }
  }

  if (report.decision === 'blocked') {
    lines.push({
      stream: 'err',
      text:
        'PREFLIGHT-BLOCKED 发布门禁无法判定 v' + version + '：' +
        String(report.blocked.length) + ' 个前置条件缺失（exit 2）。',
    })
    for (const reason of report.blocked) {
      lines.push({
        stream: 'err',
        text: 'PREFLIGHT-BLOCKED ' + reason.message + '（改法：' + reason.hint + '）',
      })
    }
    return { exitCode: 2, report, lines }
  }

  lines.push({
    stream: 'err',
    text:
      'PREFLIGHT-FAIL 发布门禁拒绝 v' + version + '：' + String(report.tally.failed) +
      ' 项硬检查没通过（共 ' + String(report.tally.total) + ' 项）。',
  })
  for (const finding of report.findings) {
    lines.push({
      stream: 'err',
      text: 'PREFLIGHT-FAIL ' + finding.code + '：' + finding.message + '（改法：' + finding.hint + '）',
    })
  }
  return { exitCode: 1, report, lines }
}
