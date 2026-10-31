// scripts/release-preflight.mts —— 发布前检查：本版真机验证清单票恰好一张、已关闭，票面记录内部一致，
// 且证据能绑到具体的候选提交与候选包上。
//
// 为什么要有这一步：来源票允许在没有真机验证的情况下先关闭，验证是攒到「版本真机验证清单票」里统一做的。
// 如果等到发布之后才发现清单票没建、或者还开着一堆待验证场景，这一版就已经发出去了，验证永远补不回来。
// 规则正文见 docs/agents/real-machine-verification.md 第 4 节；本脚本做这几条机器检查：
//   一、标题「[真机验证] <本版版本号>」的票恰好一张；
//   二、那张票已经关闭；
//   三、那张票的正文与评论记录内部一致——场景编号集合、每条场景的结果、正文自称的条数与分组计数、
//       收口评论里的发布计数，互相之间要能对上。为什么要查这一条：票是人和 AI 边验边改出来的，
//       常见错误是正文删了一行、评论里还留着旧结论，或者两边的「通过 / 豁免 / 失败」数字各写各的；
//       这类错不会让票看起来没关，但会让后来的人按错误数字宣布这版验完了。
//       脚本只查「两边说的是不是同一件事」，某个豁免该不该接受仍然由人判断。
//   四、候选审计（#1766）：批次开始评论和每条场景结果评论都要写同一行「验证身份」，
//       把证据绑到候选提交与候选包指纹上；候选提交必须是发布提交的祖先；
//       候选提交与发布提交不同时，票面必须有一行差异审计说明为什么可以这么发。
//       候选清单（--candidate）还要满足：validity 是 release、sourceStable 是 true、
//       提交是 40 位小写十六进制且登记在评论里、候选包指纹与候选包 tgz 哈希都是 64 位小写十六进制，
//       并且票面身份行里的候选包 sha256 至少有一条与这份候选清单的 package.tgzSha256 相同。
//
// 两条发布路径都在真正发布之前调用本脚本：
//   - scripts/publish-token.ps1（token 无人值守路径）
//   - scripts/wizard-release.sh（只扫码向导：Stage 3 的第五步）
// DryRun / dry-run 时传 --soft，只提示不阻断——演练不该被票务状态卡住。
//
// 用法：node scripts/release-preflight.mts [--version <版本号>] [--candidate <候选清单.json>] [--soft]
//   --version    本版版本号，可带 v。缺省读仓根 package.json 的 version。
//   --candidate  候选清单 JSON（validity / sourceStable / git.commit / package.fileDigest），
//                传了才做候选清单本身的检查；不传只查评论里的身份行、祖先与差异审计。
//   --soft       只提示不阻断：结论照常逐行打印，退出码恒为 0。
// 退出码：0=通过（或 --soft 下不阻断）；1=清单票不满足发布条件；2=环境问题（gh / git 不可用、候选清单读不到等）。
//
// 输出行首标记：PREFLIGHT-OK / PREFLIGHT-FAIL / PREFLIGHT-SOFT / PREFLIGHT-INFO /
// PREFLIGHT-CANDIDATE-OK / PREFLIGHT-CANDIDATE-AUDIT，日志里按标记搜索即可。

import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

import {
  ReleaseEnvError,
  REPO_ROOT,
  isExactChecklistTitle,
  isPlaceholderTitle,
  listChecklistIssues,
  listIssueComments,
  normalizeTitle,
  readPackageVersion,
  TITLE_PREFIX,
} from './lib/release-checklist.mts'
import type { ChecklistComment, ChecklistIssue } from './lib/release-checklist.mts'
import { checkChecklistConsistency, formatConsistencyFindings } from './lib/checklist-consistency.mts'
import { COMMIT_PATTERN, checkCandidateAudit } from './lib/release-candidate-audit.mts'
import type { CandidateAuditCandidate, CandidateAuditReport } from './lib/release-candidate-audit.mts'

type Options = {
  version: string
  soft: boolean
  candidatePath: string
}

function parseArgs(argv: string[]): Options {
  const options: Options = { version: '', soft: false, candidatePath: '' }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--version') {
      const value = argv[index + 1]
      if (!value) {
        console.error('PREFLIGHT-FAIL --version 后面缺版本号')
        process.exit(2)
      }
      options.version = value
      index += 1
    } else if (arg === '--candidate') {
      const value = argv[index + 1]
      if (!value) {
        console.error('PREFLIGHT-FAIL --candidate 后面缺候选清单文件路径')
        process.exit(2)
      }
      options.candidatePath = value
      index += 1
    } else if (arg === '--soft') {
      options.soft = true
    } else if (arg === '--help' || arg === '-h') {
      console.log('用法：node scripts/release-preflight.mts [--version <版本号>] [--candidate <候选清单.json>] [--soft]')
      process.exit(0)
    } else {
      console.error('PREFLIGHT-FAIL 不认识的参数：' + arg)
      process.exit(2)
    }
  }
  return options
}

const options = parseArgs(process.argv.slice(2))

/** 结论行。soft 模式下最后一句明确说「不阻断」，日志里不会把提示当成阻断。 */
function fail(message: string, exitCode: number): never {
  const line = 'PREFLIGHT-FAIL ' + message
  if (options.soft) {
    console.log('PREFLIGHT-SOFT 不阻断发布（演练模式）：' + message)
    process.exit(0)
  }
  console.error(line)
  process.exit(exitCode)
}

function ok(message: string): void {
  console.log('PREFLIGHT-OK ' + message)
}

function info(message: string): void {
  console.log('PREFLIGHT-INFO ' + message)
}

/**
 * 跑一次 git 并回读 stdout；失败时抛 ReleaseEnvError，由调用方按环境问题退出 2。
 * 固定用仓根做工作目录：本脚本可能在别的目录被调起，git 判断的是这个仓库的提交关系。
 */
function gitText(args: string[]): string {
  const result = spawnSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' })
  if (result.error) {
    throw new ReleaseEnvError('调不起 git：' + result.error.message + '。发布前检查要在仓库里跑，且 git 要可用。', 2)
  }
  if (result.status !== 0) {
    const detail = String(result.stderr || '').trim()
    throw new ReleaseEnvError(
      'git ' + args.join(' ') + ' 失败（exit=' + String(result.status) + '）' + (detail ? '：' + detail : '') + '。',
      2,
    )
  }
  return String(result.stdout || '').trim()
}

/**
 * 构造「候选提交是不是发布提交的祖先」的判断回调。
 * git merge-base --is-ancestor 的退出码是这条命令的约定：0=是祖先，1=不是祖先，其余=环境问题（比如提交不在本仓库）。
 * 把 1 当正常结果返回 false，其余抛出去交给调用方按环境问题退出 2，避免把「对象不存在」误报成「不是祖先」。
 */
function makeAncestorCheck(releaseCommit: string): (commit: string) => boolean {
  return (commit: string): boolean => {
    const result = spawnSync('git', ['merge-base', '--is-ancestor', commit, releaseCommit], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    })
    if (result.error) {
      throw new ReleaseEnvError('调不起 git：' + result.error.message + '。', 2)
    }
    if (result.status === 0) return true
    if (result.status === 1) return false
    const detail = String(result.stderr || '').trim()
    throw new ReleaseEnvError(
      'git merge-base --is-ancestor ' + commit + ' ' + releaseCommit + ' 失败（exit=' + String(result.status) + '）' +
        (detail ? '：' + detail : '') + '。候选清单里的提交可能不在本仓库里。',
      2,
    )
  }
}

/**
 * 读候选清单 JSON。结构不对按环境问题退出 2：这多半是发布脚本传错文件，
 * 不是票面内容问题，不该用「改法」的形式让人去改清单票。
 */
function readCandidateManifest(filePath: string): CandidateAuditCandidate {
  const resolved = path.resolve(process.cwd(), filePath)
  if (!existsSync(resolved)) {
    fail('候选清单文件不存在：' + resolved + '。检查 --candidate 的路径。', 2)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(resolved, 'utf8'))
  } catch (error) {
    fail(
      '候选清单不是合法 JSON：' + resolved + '（' + (error instanceof Error ? error.message : String(error)) + '）',
      2,
    )
  }
  const record = parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  const gitRecord =
    record !== null && record.git !== null && typeof record.git === 'object'
      ? (record.git as Record<string, unknown>)
      : null
  const packageRecord =
    record !== null && record.package !== null && typeof record.package === 'object'
      ? (record.package as Record<string, unknown>)
      : null
  const validity = record === null ? undefined : record.validity
  const sourceStable = record === null ? undefined : record.sourceStable
  const commit = gitRecord === null ? undefined : gitRecord.commit
  const fileDigest = packageRecord === null ? undefined : packageRecord.fileDigest
  const packageSha256 = packageRecord === null ? undefined : packageRecord.tgzSha256
  if (
    typeof validity !== 'string' ||
    typeof sourceStable !== 'boolean' ||
    typeof commit !== 'string' ||
    typeof fileDigest !== 'string' ||
    typeof packageSha256 !== 'string'
  ) {
    fail(
      '候选清单缺字段：要 validity（字符串）、sourceStable（布尔）、git.commit（字符串）、' +
        'package.fileDigest（字符串）、package.tgzSha256（字符串）。文件：' + resolved,
      2,
    )
  }
  return { commit, validity, sourceStable, fileDigest, packageSha256 }
}

function main(): void {
  let version = ''
  try {
    version = options.version ? options.version : readPackageVersion()
  } catch (error) {
    fail(error instanceof ReleaseEnvError ? error.message : String(error), 2)
  }
  const versionNumber = String(version).trim().replace(/^[vV]/, '')
  if (!versionNumber) {
    fail('版本号为空：用 --version 指定，或确认 package.json 里有 version。', 2)
  }
  const targetTitle = TITLE_PREFIX + ' ' + versionNumber
  info('本版：' + versionNumber + '；要找的清单票标题：「' + targetTitle + '」')

  let issues: ChecklistIssue[] = []
  try {
    issues = listChecklistIssues()
  } catch (error) {
    fail(error instanceof ReleaseEnvError ? error.message : String(error), 2)
  }

  const exact = issues.filter((issue) => isExactChecklistTitle(issue.title, versionNumber))
  const placeholders = issues.filter((issue) => isPlaceholderTitle(issue.title))

  if (exact.length === 0) {
    if (placeholders.length > 0) {
      const placeholder = placeholders[0]
      fail(
        '没有标题为「' + targetTitle + '」的清单票，但有一张占位票 #' + placeholder.number +
          '「' + normalizeTitle(placeholder.title) + '」。发布准备时版本号已经定了：把占位票的标题改成「' +
          targetTitle + '」，再跑本检查。',
        1,
      )
    }
    fail(
      '没有标题为「' + targetTitle + '」的清单票。发布前先按 docs/agents/checklist-issue-template.md 建一张，' +
        '把本版所有需要真机验证的场景登记进去，验完关票，再发布。',
      1,
    )
  }

  if (exact.length > 1) {
    const names = exact.map((issue) => '#' + issue.number + '「' + normalizeTitle(issue.title) + '」').join('、')
    fail('标题为「' + targetTitle + '」的清单票有 ' + exact.length + ' 张：' + names + '。合并成一张再发布。', 1)
  }

  const issue = exact[0]
  const state = String(issue.state || '').toUpperCase()
  if (state !== 'CLOSED') {
    fail(
      '清单票 #' + issue.number + '「' + normalizeTitle(issue.title) + '」还是 ' + (state || '未知状态') +
        '。等票面场景全部「通过」或「豁免被接受」后关闭它，再发布。' +
        (issue.url ? ' ' + issue.url : ''),
      1,
    )
  }

  ok('清单票 #' + issue.number + '「' + normalizeTitle(issue.title) + '」已关闭' + (issue.url ? ' ' + issue.url : ''))

  // 关闭只是「人宣布验完了」，还得确认这张票自己记的东西前后一致：正文的场景表、评论里的逐条结果、
  // 收口时写下的计数，任何一处和别处对不上，都说明中间改过一边忘了另一边。
  let comments: ChecklistComment[] = []
  try {
    comments = listIssueComments(issue.number)
  } catch (error) {
    fail(error instanceof ReleaseEnvError ? error.message : String(error), 2)
  }
  const report = checkChecklistConsistency({ body: issue.body, comments })
  if (!report.ok) {
    const lines = formatConsistencyFindings(report)
    for (const line of lines) {
      if (options.soft) console.log('PREFLIGHT-SOFT 不阻断发布（演练模式）：' + line)
      else console.error('PREFLIGHT-FAIL ' + line)
    }
    if (options.soft) {
      info('演练模式下只列出 ' + lines.length + ' 处对不上的地方；真实发布前要按每条的「改法」改完。')
    } else {
      console.error('PREFLIGHT-FAIL 清单票记录的正文与评论对不上，共 ' + lines.length + ' 处；按上面每条的「改法」改完再发布。')
      process.exit(1)
    }
  } else {
    const counts = report.publishCounts
    ok(
      '清单票 #' + issue.number + ' 的记录内部一致：' + report.rows.length + ' 条场景、评论登记 ' +
        report.registeredIds.length + ' 个场景编号，发布计数 通过 ' + counts.passed + ' / 豁免 ' +
        counts.exempted + ' / 失败 ' + counts.failed,
    )
  }

  // 候选审计（#1766）：放在最后做，因为要动 git 判断祖先关系；前面几条票面检查先过，才值得查提交。
  // 候选清单是可选的：不传时只查评论里的身份行、祖先与差异审计（候选提交就是身份行里写的那个）。
  let releaseCommit = ''
  try {
    releaseCommit = gitText(['rev-parse', 'HEAD'])
  } catch (error) {
    fail(error instanceof ReleaseEnvError ? error.message : String(error), 2)
  }
  if (!COMMIT_PATTERN.test(releaseCommit)) {
    fail('git rev-parse HEAD 没给出 40 位小写提交号：' + releaseCommit + '。', 2)
  }
  const candidate = options.candidatePath ? readCandidateManifest(options.candidatePath) : null
  let audit: CandidateAuditReport
  try {
    audit = checkCandidateAudit({
      body: issue.body,
      comments,
      releaseCommit,
      ancestorCheck: makeAncestorCheck(releaseCommit),
      candidate,
    })
  } catch (error) {
    fail(error instanceof ReleaseEnvError ? error.message : String(error), 2)
  }
  for (const finding of audit.findings) {
    const line = finding.message + '（改法：' + finding.fix + '）'
    if (options.soft) console.log('PREFLIGHT-SOFT 不阻断发布（演练模式）：' + line)
    else console.error('PREFLIGHT-FAIL ' + line)
  }
  if (!audit.ok) {
    if (options.soft) {
      info('演练模式下只列出 ' + audit.findings.length + ' 处候选审计问题；真实发布前要按每条的「改法」改完。')
    } else {
      console.error('PREFLIGHT-FAIL 候选审计有 ' + audit.findings.length + ' 处问题；按上面每条的「改法」改完再发布。')
      process.exit(1)
    }
  } else if (candidate) {
    // 发布脚本按这两行决定要不要做发布字节对账：同一个提交说明候选就是发布提交，
    // 不同但审计覆盖说明差异已经在清单票里说清了，两者都放行；没有这一行就说明没通过候选审计。
    if (candidate.commit === releaseCommit) {
      console.log('PREFLIGHT-CANDIDATE-OK commit=' + releaseCommit + ' fileDigest=' + candidate.fileDigest)
    } else if (audit.auditCovered) {
      console.log('PREFLIGHT-CANDIDATE-AUDIT commit=' + candidate.commit + ' fileDigest=' + candidate.fileDigest)
    }
  } else {
    info(
      '候选审计：' + audit.identities.length + ' 条验证身份行；没传 --candidate，只检查评论身份、祖先与差异审计。',
    )
  }
}

main()
