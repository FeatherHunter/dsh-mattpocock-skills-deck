// scripts/release-candidate-check.mts —— 候选清单校验与发布字节对账的唯一命令入口。
//
// 为什么要有这一步：#1766 要求发布前证明「这次要发的字节就是候选包」。候选清单的字段规则、
// 候选包指纹与发布前逐文件清单指纹的比较，原来分散在 publish-token.ps1 与 release-preflight.mts
// 里，PowerShell 里那段比较没法被门禁直接测到，CANDIDATE-DIFF 分支也就没有反向测试。
// 现在把规则收进 lib/release-candidate-audit.mts，这个脚本只做参数解析、读文件与打印结论；
// 发布脚本调它，测试也调它，两边跑的是同一套判据。
//
// 用法：
//   node --import ./scripts/ts-hook.mts scripts/release-candidate-check.mts validate --candidate <candidate.json>
//     校验候选清单能不能进入发布：validity 必须是 release、sourceStable 必须是 true、
//     git.commit / package.fileDigest / package.tgzSha256 必须是 40/64 位小写十六进制。
//     通过打印 CANDIDATE-VALID，退出码 0；候选不合格打印 CANDIDATE-FAIL，退出码 1；
//     文件读不到或结构不对打印 CANDIDATE-ENV，退出码 2。
//   node --import ./scripts/ts-hook.mts scripts/release-candidate-check.mts match --candidate <candidate.json> --manifest <发布前清单.json> [--audit-covered]
//     把候选包的逐文件清单指纹与发布前清单的 digest 对账：一致 CANDIDATE-SAME；不一致但有
//     差异审计（--audit-covered，来自 preflight 的 PREFLIGHT-CANDIDATE-AUDIT）CANDIDATE-DIFF-AUDITED；
//     不一致又没有审计 CANDIDATE-DIFF，退出码 1（发布脚本必须在此停下）。
//
// 输出行首标记稳定，日志里按标记搜索即可；本脚本不调 npm、不读 git、不打印 token。

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import {
  CANDIDATE_MANIFEST_FIELDS_HINT,
  PACKAGE_SHA256_PATTERN,
  candidateFromRecord,
  checkCandidateManifest,
  judgeReleaseBytes,
} from './lib/release-candidate-audit.mts'
import type { CandidateAuditCandidate } from './lib/release-candidate-audit.mts'

/** 环境/结构问题的退出码：与 release-preflight 的约定一致，表示「先查参数或文件」，不是票面问题。 */
const ENV_EXIT_CODE = 2

/**
 * 命令自己决定退出码时用异常往上抛，最后统一设 process.exitCode。
 * 不在打印后直接 process.exit：Node 24 在 Windows 上偶发在 stdout 还没写完时退出，
 * 会留下 libuv 断言（退出码变成 3221226505），把本来清楚的 CANDIDATE-ENV 变成环境崩溃。
 */
class CliExit extends Error {
  code: number
  constructor(code: number, message: string) {
    super(message)
    this.code = code
  }
}

function envFail(message: string): never {
  console.log('CANDIDATE-ENV ' + message)
  throw new CliExit(ENV_EXIT_CODE, message)
}

function readJsonFile(filePath: string, label: string): Record<string, unknown> {
  const resolved = path.resolve(process.cwd(), filePath)
  if (!existsSync(resolved)) {
    envFail(label + '文件不存在：' + resolved)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(resolved, 'utf8'))
  } catch (error) {
    envFail(label + '不是合法 JSON：' + resolved + '（' + (error instanceof Error ? error.message : String(error)) + '）')
  }
  if (parsed === null || typeof parsed !== 'object') {
    envFail(label + '不是对象：' + resolved)
  }
  return parsed as Record<string, unknown>
}

/** 读候选清单并只做结构检查；字段怎么取与语义规则都和发布前检查共用同一处实现。 */
function readCandidate(candidatePath: string): CandidateAuditCandidate {
  const record = readJsonFile(candidatePath, '候选清单')
  const candidate = candidateFromRecord(record)
  if (!candidate) {
    envFail(CANDIDATE_MANIFEST_FIELDS_HINT + '文件：' + path.resolve(process.cwd(), candidatePath))
  }
  return candidate
}

function failCandidate(candidate: CandidateAuditCandidate): void {
  const findings = checkCandidateManifest(candidate)
  if (findings.length === 0) return
  for (const finding of findings) {
    console.log('CANDIDATE-FAIL ' + finding.message + '（改法：' + finding.fix + '）')
  }
  throw new CliExit(1, '候选清单不合格')
}

function commandValidate(options: { candidate: string }): void {
  const candidate = readCandidate(options.candidate)
  failCandidate(candidate)
  console.log(
    'CANDIDATE-VALID commit=' + candidate.commit + ' fileDigest=' + candidate.fileDigest +
      ' tgzSha256=' + candidate.packageSha256,
  )
}

function commandMatch(options: { candidate: string; manifest: string; auditCovered: boolean }): void {
  const candidate = readCandidate(options.candidate)
  failCandidate(candidate)
  const manifest = readJsonFile(options.manifest, '发布前清单')
  const publishedFileDigest = manifest.digest
  if (typeof publishedFileDigest !== 'string' || !PACKAGE_SHA256_PATTERN.test(publishedFileDigest)) {
    envFail('发布前清单的 digest 不是 64 位小写十六进制：' + path.resolve(process.cwd(), options.manifest))
  }
  const report = judgeReleaseBytes({
    candidateFileDigest: candidate.fileDigest,
    publishedFileDigest,
    auditCovered: options.auditCovered,
  })
  const prefix =
    report.verdict === 'same'
      ? 'CANDIDATE-SAME '
      : report.verdict === 'diff-audited'
        ? 'CANDIDATE-DIFF-AUDITED '
        : 'CANDIDATE-DIFF '
  console.log(prefix + report.message)
  if (report.verdict === 'diff') throw new CliExit(1, '发布字节与候选包不一致且没有差异审计')
}

function usage(): never {
  console.log(
    '用法：\n' +
      '  node --import ./scripts/ts-hook.mts scripts/release-candidate-check.mts validate --candidate <candidate.json>\n' +
      '  node --import ./scripts/ts-hook.mts scripts/release-candidate-check.mts match --candidate <candidate.json> --manifest <发布前清单.json> [--audit-covered]',
  )
  throw new CliExit(ENV_EXIT_CODE, '参数用法不正确')
}

function main(argv: string[]): void {
  const command = argv[0]
  const options: { candidate: string; manifest: string; auditCovered: boolean } = {
    candidate: '',
    manifest: '',
    auditCovered: false,
  }
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--candidate') {
      options.candidate = argv[index + 1] || ''
      if (!options.candidate) envFail('--candidate 后面缺候选清单路径')
      index += 1
    } else if (arg === '--manifest') {
      options.manifest = argv[index + 1] || ''
      if (!options.manifest) envFail('--manifest 后面缺发布前清单路径')
      index += 1
    } else if (arg === '--audit-covered') {
      options.auditCovered = true
    } else if (arg === '--help' || arg === '-h') {
      usage()
    } else {
      envFail('不认识的参数：' + arg)
    }
  }
  if (command === 'validate') {
    if (!options.candidate) envFail('validate 需要 --candidate <candidate.json>')
    if (options.manifest) envFail('validate 不接受 --manifest')
    commandValidate(options)
    return
  }
  if (command === 'match') {
    if (!options.candidate) envFail('match 需要 --candidate <candidate.json>')
    if (!options.manifest) envFail('match 需要 --manifest <发布前清单.json>')
    commandMatch(options)
    return
  }
  usage()
}

try {
  main(process.argv.slice(2))
} catch (error) {
  if (error instanceof CliExit) {
    process.exitCode = error.code
  } else {
    throw error
  }
}
