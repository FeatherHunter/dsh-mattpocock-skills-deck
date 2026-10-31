// tests/verify-1766-release-audit.ts —— #1766 候选审计判据的回归测试。
//
// 为什么要有这个测试：发布前检查现在要读清单票评论里的「验证身份」行、判断候选提交是不是发布提交的祖先、
// 以及候选与发布不同时票面有没有差异审计。这些都是纯文本判据，错一点就会误拦发布、或者放过没审计的版本，
// 所以把每条规则写成固定输入固定输出的用例；不需要 gh、git 或真实发布就能跑。
//
// 跑法：node --import ./scripts/ts-hook.mts tests/verify-1766-release-audit.ts
// 失败时退出码 1，逐条打印 FAIL；全部通过时打印一行总数。

import {
  IDENTITY_PREFIX,
  checkCandidateAudit,
  collectBatchIdentities,
  parseIdentityLine,
  requiresIdentity,
} from '../scripts/lib/release-candidate-audit.mts'
import type { BatchIdentityComment, CandidateAuditReport } from '../scripts/lib/release-candidate-audit.mts'

let total = 0
let failed = false

function check(ok: boolean, message: string): void {
  total += 1
  if (!ok) failed = true
  console.log((ok ? '  PASS ' : '  FAIL ') + message)
}

// 固定输入：发布提交、两个候选提交、一个候选包指纹。用重复字符凑长度，读报告时一眼能分出谁是谁。
const RELEASE = 'a'.repeat(40)
const OLD_CANDIDATE = 'b'.repeat(40)
const OTHER_CANDIDATE = 'c'.repeat(40)
const DIGEST = 'd'.repeat(64)

function identityLine(batchName: string, commit: string, sha256 = DIGEST): string {
  return IDENTITY_PREFIX + batchName + '；候选提交 ' + commit + '；候选包 sha256 ' + sha256
}

function batchStart(batchName: string, commit: string, sha256 = DIGEST): BatchIdentityComment {
  return {
    body:
      '## 批次开始：' + batchName + ' 绑定与环境\n\n' +
      '- 批次号：' + batchName + '\n' +
      identityLine(batchName, commit, sha256),
  }
}

function scenarioResult(batchName: string, commit: string, sha256 = DIGEST, scenarioId = '1766-01'): BatchIdentityComment {
  return {
    body: '场景 ' + scenarioId + '：通过。证据：evidence/' + scenarioId + '/。\n' + identityLine(batchName, commit, sha256),
  }
}

function codesOf(report: CandidateAuditReport): string[] {
  return report.findings.map((finding) => finding.code)
}

// ── 一、身份行解析与「这条评论要不要身份行」 ─────────────────────────────
console.log('[身份行解析]')
const parsed = parseIdentityLine(identityLine('B1', RELEASE) + '   ')
check(
  parsed !== null && parsed.batchName === 'B1' && parsed.commit === RELEASE && parsed.packageSha256 === DIGEST,
  '完整身份行能解析，行尾空白允许',
)
check(parseIdentityLine(identityLine('B1', RELEASE.toUpperCase())) === null, '大写提交不算身份行')
check(parseIdentityLine(identityLine('B1', RELEASE.slice(0, 39))) === null, '短一位的提交不算身份行')
check(
  parseIdentityLine(IDENTITY_PREFIX + 'B1 B2；候选提交 ' + RELEASE + '；候选包 sha256 ' + DIGEST) === null,
  '批次名带空白不算身份行',
)
check(parseIdentityLine('候选提交 ' + RELEASE) === null, '没有「验证身份」前缀的行不算身份行')

console.log('[哪些评论要身份行]')
check(requiresIdentity('## 批次开始：B1 绑定与环境'), '批次开始评论要身份行')
check(requiresIdentity('场景 1766-01：通过。'), '「场景 <编号>：」结果行要身份行')
check(requiresIdentity('| 1766-01 | #1766 | 通过 |'), 'Markdown 表格首格是场景编号的结果行要身份行')
check(requiresIdentity('- **1766-01 通过**：证据在 evidence/'), '加粗写法的结果行要身份行')
check(!requiresIdentity('收到，谢谢'), '普通评论不要求身份行')
check(!requiresIdentity('场景说明：见上文'), '「场景」后面不是编号的句子不算结果行')

// ── 二、正常通过 ────────────────────────────────────────────────────────
console.log('[正常通过]')
const passing = checkCandidateAudit({
  body: '',
  comments: [batchStart('B1', RELEASE), scenarioResult('B1', RELEASE)],
  releaseCommit: RELEASE,
  ancestorCheck: () => true,
  candidate: { commit: RELEASE, validity: 'release', sourceStable: true, fileDigest: DIGEST },
})
check(passing.ok, '批次开始与场景结果都带身份行、候选就是发布提交时通过')
check(passing.findings.length === 0, '通过时没有任何 findings')
check(passing.identities.length === 2, '两条评论各解析出一行身份')
check(passing.candidateCommit === RELEASE, '报告带回候选清单里的候选提交')
check(passing.auditCovered === false, '候选就是发布提交时不需要差异审计')

// ── 三、缺身份行 ────────────────────────────────────────────────────────
console.log('[缺身份行]')
const missing = checkCandidateAudit({
  body: '',
  comments: [
    { body: '## 批次开始：B1 绑定与环境\n- 批次号：B1' },
    { body: '场景 1766-01：通过。' },
  ],
  releaseCommit: RELEASE,
  ancestorCheck: () => true,
})
check(!missing.ok, '缺身份行时判据不通过')
check(
  codesOf(missing).filter((code) => code === 'identity-missing').length === 2,
  '批次开始与场景结果各报一次 identity-missing',
)
check(codesOf(missing).includes('batch-start-missing'), '批次开始评论没带身份行时也报 batch-start-missing')
const missingFinding = missing.findings.find((finding) => finding.code === 'identity-missing')
check(missingFinding !== undefined && missingFinding.message.includes('第 1 条评论'), 'identity-missing 的说明点名第几条评论')
check(missingFinding !== undefined && missingFinding.fix.includes(IDENTITY_PREFIX), 'identity-missing 的改法给出应补的整行示例')

// ── 四、同一批次身份冲突 ────────────────────────────────────────────────
console.log('[同批次身份冲突]')
const conflict = checkCandidateAudit({
  body: [
    '- 候选提交 ' + OLD_CANDIDATE + ' → 发布提交 ' + RELEASE + '：候选之后只改了文档',
    '- 候选提交 ' + OTHER_CANDIDATE + ' → 发布提交 ' + RELEASE + '：另一份候选，差异已审',
  ].join('\n'),
  comments: [batchStart('B1', OLD_CANDIDATE), scenarioResult('B1', OTHER_CANDIDATE)],
  releaseCommit: RELEASE,
  ancestorCheck: () => true,
})
check(codesOf(conflict).includes('identity-conflict'), '同批次名写不同候选时报 identity-conflict')
check(conflict.findings.length === 1, '同一处冲突只报一次，没有带出别的问题')
check(conflict.identities.length === 2, '冲突的两行身份都保留在报告里')
const collected = collectBatchIdentities([
  batchStart('B1', OLD_CANDIDATE),
  scenarioResult('B1', OLD_CANDIDATE),
  scenarioResult('B1', OTHER_CANDIDATE),
])
check(collected.identities.length === 3, 'collectBatchIdentities 收集全部身份行')
check(collected.errors.length === 1, '同一批次两种身份只记一条 error')
check(collected.identities[0].commentIndex === 0, '身份行带回它所在的评论下标')

// ── 五、候选提交不是发布提交的祖先 ──────────────────────────────────────
console.log('[候选提交不是祖先]')
const notAncestor = checkCandidateAudit({
  body: '- 候选提交 ' + OLD_CANDIDATE + ' → 发布提交 ' + RELEASE + '：候选之后只改了文档',
  comments: [batchStart('B1', OLD_CANDIDATE), scenarioResult('B1', OLD_CANDIDATE)],
  releaseCommit: RELEASE,
  ancestorCheck: (commit) => commit !== OLD_CANDIDATE,
})
check(!notAncestor.ok, '祖先检查不通过时整体不通过')
check(codesOf(notAncestor).includes('commit-not-ancestor'), '候选提交不是发布提交祖先时报 commit-not-ancestor')
check(notAncestor.findings.length === 1, '有差异审计时只报祖先这一处')

// ── 六、候选与发布不同且没有差异审计 ────────────────────────────────────
console.log('[候选与发布不同且无审计]')
const noAudit = checkCandidateAudit({
  body: '',
  comments: [batchStart('B1', OLD_CANDIDATE), scenarioResult('B1', OLD_CANDIDATE)],
  releaseCommit: RELEASE,
  ancestorCheck: () => true,
})
check(!noAudit.ok, '没有差异审计时判据不通过')
check(codesOf(noAudit).includes('audit-missing'), '候选与发布不同且没有差异审计时报 audit-missing')
check(noAudit.findings.length === 1, '同一次候选只报一次 audit-missing')
check(noAudit.auditCovered === false, '没有审计时 auditCovered 为 false')
const auditFinding = noAudit.findings.find((finding) => finding.code === 'audit-missing')
check(
  auditFinding !== undefined && auditFinding.fix.includes('- 候选提交 ' + OLD_CANDIDATE + ' → 发布提交 ' + RELEASE),
  'audit-missing 的改法给出应补的整行',
)

// ── 七、有差异审计时通过（箭头两种写法都认） ────────────────────────────
console.log('[有差异审计]')
const audited = checkCandidateAudit({
  body: '- 候选提交 ' + OLD_CANDIDATE + ' -> 发布提交 ' + RELEASE + '：候选之后只改了文档，发布字节与候选包一致',
  comments: [batchStart('B1', OLD_CANDIDATE), scenarioResult('B1', OLD_CANDIDATE)],
  releaseCommit: RELEASE,
  ancestorCheck: () => true,
})
check(audited.ok, '有差异审计时判据通过，箭头写成 -> 也认')
check(audited.auditCovered === true, '差异审计覆盖了候选提交')

// ── 八、候选清单本身的问题 ──────────────────────────────────────────────
console.log('[候选清单]')
const development = checkCandidateAudit({
  body: '',
  comments: [batchStart('B1', RELEASE), scenarioResult('B1', RELEASE)],
  releaseCommit: RELEASE,
  ancestorCheck: () => true,
  candidate: { commit: RELEASE, validity: 'development', sourceStable: true, fileDigest: DIGEST },
})
check(!development.ok, 'validity 是 development 的候选被拒')
check(codesOf(development).includes('candidate-not-release'), 'development 候选报 candidate-not-release')

const unregistered = checkCandidateAudit({
  body: '- 候选提交 ' + OLD_CANDIDATE + ' → 发布提交 ' + RELEASE + '：候选之后只改了文档',
  comments: [batchStart('B1', RELEASE), scenarioResult('B1', RELEASE)],
  releaseCommit: RELEASE,
  ancestorCheck: () => true,
  candidate: { commit: OLD_CANDIDATE, validity: 'release', sourceStable: true, fileDigest: DIGEST },
})
check(codesOf(unregistered).includes('candidate-not-registered'), '候选提交没出现在任何身份行里时报 candidate-not-registered')
check(unregistered.findings.length === 1, '有差异审计时只报未登记这一处')

const candidateNoAudit = checkCandidateAudit({
  body: '',
  comments: [batchStart('B1', RELEASE), scenarioResult('B1', RELEASE)],
  releaseCommit: RELEASE,
  ancestorCheck: () => true,
  candidate: { commit: OLD_CANDIDATE, validity: 'release', sourceStable: true, fileDigest: DIGEST },
})
check(codesOf(candidateNoAudit).includes('candidate-audit-missing'), '候选与发布不同且无审计时报 candidate-audit-missing')
check(codesOf(candidateNoAudit).includes('candidate-not-registered'), '未登记时同时也会报 candidate-not-registered')

const unstable = checkCandidateAudit({
  body: '',
  comments: [batchStart('B1', RELEASE), scenarioResult('B1', RELEASE)],
  releaseCommit: RELEASE,
  ancestorCheck: () => true,
  candidate: { commit: RELEASE, validity: 'release', sourceStable: false, fileDigest: DIGEST },
})
check(codesOf(unstable).includes('candidate-source-unstable'), 'sourceStable 不是 true 时报 candidate-source-unstable')

const badDigest = checkCandidateAudit({
  body: '',
  comments: [batchStart('B1', RELEASE), scenarioResult('B1', RELEASE)],
  releaseCommit: RELEASE,
  ancestorCheck: () => true,
  candidate: { commit: RELEASE, validity: 'release', sourceStable: true, fileDigest: 'd'.repeat(63) },
})
check(codesOf(badDigest).includes('candidate-digest-invalid'), 'fileDigest 不是 64 位时报 candidate-digest-invalid')

// ── 收尾 ────────────────────────────────────────────────────────────────
if (failed) {
  console.log('\n存在失败（共 ' + total + ' 项）')
  process.exit(1)
}
console.log('\n全部通过（共 ' + total + ' 项）')
