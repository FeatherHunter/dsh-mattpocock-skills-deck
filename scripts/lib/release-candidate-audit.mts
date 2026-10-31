// scripts/lib/release-candidate-audit.mts —— 清单票评论里的「验证身份」与候选审计判据。
//
// 为什么要有这个文件：#1766 之后，真机验证证据要绑定到一个候选提交与候选包（tgz 的 sha256 与逐文件清单
// 指纹），发布前检查得能从清单票的评论里认出「这批验的是哪个候选」，并回答两个问题：
//   一、评论里写的候选提交，发布提交里包不包含——候选提交必须是发布提交的祖先，否则验过的代码没进这一版，
//       这批证据就不能给这一版背书；
//   二、候选提交与发布提交不同时，清单票正文有没有差异审计（「候选提交 X → 发布提交 Y：理由」），
//       说清这段差异为什么可以接受。没有审计的对不上必须在发布前停下。
//
// 判据的边界：本文件只做文本解析与规则判断，不调 gh、不读 git。评论从哪来、候选提交是不是祖先，
// 都由调用方传进来——发布前检查传真实的 git 祖先判断，测试传一个固定答案的函数，两边跑的是同一套规则。
// 记录里用了别的写法而没被认出来时，报告会以「缺验证身份」出现，不会静默放过。
//
// 机器可读的验证身份只有一行，精确格式见 docs/agents/real-machine-verification.md 第二节：
//   - 验证身份：批次 <批次名>；候选提交 <40 位小写提交>；候选包 sha256 <64 位小写 tgz 哈希>
// 批次名不含空白与中文分号，允许行尾空白；格式不对不算有身份行。
//
// 这里报出的每一条都带「怎么改」：发布前检查会把它原样打印给人看，人照着改票面就能继续发布。

/** 验证身份行的固定前缀。写评论的人和解析的人共用这一处，改格式先改规则文档。 */
export const IDENTITY_PREFIX = '- 验证身份：批次 '

/** 提交哈希的机器格式：只认 40 位小写十六进制。 */
const COMMIT_PATTERN = /^[0-9a-f]{40}$/
/** 候选包 tgz 哈希的机器格式：只认 64 位小写十六进制。 */
const PACKAGE_SHA256_PATTERN = /^[0-9a-f]{64}$/

/** 身份行去掉前缀之后的精确形状；行尾空白在进入正则前已经去掉。 */
const IDENTITY_TAIL_PATTERN = /^([^\s；]+)；候选提交 ([0-9a-f]{40})；候选包 sha256 ([0-9a-f]{64})$/u

/** 一条评论：正文，以及创建时间（目前只原样接收，给以后按时间顺序排批次留位置）。 */
export type BatchIdentityComment = {
  body: string
  createdAt?: string
}

/** 从一条评论里解析出来的一行验证身份。 */
export type BatchIdentity = {
  /** 批次名，例如 B1。同一批次在所有评论里必须完全一致。 */
  batchName: string
  /** 候选提交，40 位小写十六进制。 */
  commit: string
  /** 候选包 tgz 的 sha256，64 位小写十六进制。 */
  packageSha256: string
  /** 这行出现在输入评论数组里的下标（从 0 开始）；报错时换成「第几条评论」给人看。 */
  commentIndex: number
  /** 命中的那一行原文（去掉行尾空白），报错时原样引用。 */
  line: string
}

/** 候选清单（candidate.json）里本判据关心的字段；路径与其余字段不参与判断。 */
export type CandidateAuditCandidate = {
  /** 候选提交，必须是 40 位小写十六进制。 */
  commit: string
  /** release = 干净树冻结、可用于发布；development = 带未提交改动的开发验证，不能进发布。 */
  validity: string
  /** 冻结前后 HEAD 与未提交文件集合是否一致；false 说明构建期间源码被改过。 */
  sourceStable: boolean
  /** 候选包的逐文件清单指纹，64 位小写十六进制，与 release-integrity.mts 的 digest 同一算法。 */
  fileDigest: string
  /** 候选包在本机的路径，只用于报错时指路，不参与判断。 */
  packagePath?: string
}

/** checkCandidateAudit 的输入。 */
export type CandidateAuditOptions = {
  /** 清单票正文（差异审计行写在这里）。 */
  body: string
  /** 清单票的全部评论，按 gh 返回的顺序。 */
  comments: BatchIdentityComment[]
  /** 本次要发布的提交（git rev-parse HEAD 的结果）。 */
  releaseCommit: string
  /** 判断某个提交是不是 releaseCommit 的祖先；不传时跳过祖先检查（纯文本判据）。 */
  ancestorCheck?: (commit: string) => boolean
  /** 本次发布要用的候选清单；不传时只查评论里的身份与差异审计。 */
  candidate?: CandidateAuditCandidate | null
}

/** 判据能报出的问题种类；每种在 checkCandidateAudit 里对应一处 push，code 稳定，改含义时换新值。 */
export type CandidateAuditFindingCode =
  | 'identity-missing'
  | 'identity-conflict'
  | 'batch-start-missing'
  | 'commit-not-ancestor'
  | 'audit-missing'
  | 'candidate-not-release'
  | 'candidate-source-unstable'
  | 'candidate-commit-invalid'
  | 'candidate-commit-not-ancestor'
  | 'candidate-digest-invalid'
  | 'candidate-not-registered'
  | 'candidate-audit-missing'

/** 一处对不上：说清是哪一处、为什么不对、具体怎么改。 */
export type CandidateAuditFinding = {
  code: CandidateAuditFindingCode
  /** 一句话说清哪一处不对。 */
  message: string
  /** 具体怎么改，读票的人照着做就能改对。 */
  fix: string
}

/** 判据的结论。 */
export type CandidateAuditReport = {
  ok: boolean
  findings: CandidateAuditFinding[]
  /** 评论里解析出来的全部身份行（含互相冲突的），调用方可以打摘要。 */
  identities: BatchIdentity[]
  /** 候选清单里的候选提交；没传候选清单时为 null。 */
  candidateCommit: string | null
  /** 候选提交（以及评论里的候选提交）与发布提交不同时，是否每一条都有差异审计覆盖。 */
  auditCovered: boolean
}

/** 把评论正文切成行；CRLF 与 LF 都认。 */
function splitLines(text: string): string[] {
  return String(text || '').split(/\r?\n/u)
}

/** 去掉行尾空白（含 CRLF 留下的 \r）：身份行允许行尾空白，解析前先归一。 */
function stripTrailingSpace(line: string): string {
  return String(line || '').replace(/\s+$/u, '')
}

/**
 * 解析一行验证身份。不是身份行（前缀不对、批次名带空白、哈希长度或大小写不对、行尾还有别的字）
 * 都返回 null——发布前检查按「没有身份行」处理，宁可让人补一行，也不猜一个可能错的候选提交。
 */
export function parseIdentityLine(line: string): { batchName: string; commit: string; packageSha256: string } | null {
  const text = stripTrailingSpace(line)
  if (!text.startsWith(IDENTITY_PREFIX)) return null
  const matched = IDENTITY_TAIL_PATTERN.exec(text.slice(IDENTITY_PREFIX.length))
  if (!matched) return null
  return { batchName: matched[1], commit: matched[2], packageSha256: matched[3] }
}

/** 一条评论里有没有格式正确的身份行。 */
function hasIdentityLine(body: string): boolean {
  return splitLines(body).some((line) => parseIdentityLine(line) !== null)
}

/**
 * 从全部评论里收集身份行，并检查同一批次的身份是否前后一致。
 *
 * 为什么同一批次要一致：一个批次就是一次集中验证，批次开始评论登记了候选提交与候选包，
 * 后面每条场景结果评论都该是同一个候选上验出来的。同批次名却写了不同候选，说明中间换过包
 * 或者评论复制粘贴没改干净，这些结果不能混在一起算。
 */
export function collectBatchIdentities(comments: BatchIdentityComment[]): { identities: BatchIdentity[]; errors: string[] } {
  const identities: BatchIdentity[] = []
  const errors: string[] = []
  const firstByBatch = new Map<string, BatchIdentity>()
  comments.forEach((comment, commentIndex) => {
    for (const line of splitLines(comment.body)) {
      const parsed = parseIdentityLine(line)
      if (!parsed) continue
      const identity: BatchIdentity = {
        batchName: parsed.batchName,
        commit: parsed.commit,
        packageSha256: parsed.packageSha256,
        commentIndex,
        line: stripTrailingSpace(line),
      }
      identities.push(identity)
      const first = firstByBatch.get(parsed.batchName)
      if (!first) {
        firstByBatch.set(parsed.batchName, identity)
        continue
      }
      if (first.commit === identity.commit && first.packageSha256 === identity.packageSha256) continue
      errors.push(
        '第 ' + (commentIndex + 1) + ' 条评论里批次「' + parsed.batchName + '」的验证身份与第 ' +
          (first.commentIndex + 1) + ' 条评论不一致：候选提交 ' + first.commit + ' / ' + identity.commit +
          '；候选包 sha256 ' + first.packageSha256 + ' / ' + identity.packageSha256 + '。同一批次的身份必须完全相同。',
      )
    }
  })
  return { identities, errors }
}

/** 场景编号的形状：字母数字票号 + 连字符 + 两位序号（1600-01、J1-01 都认）；前后不能再紧挨数字或连字符。 */
const SCENARIO_ID_TOKEN_PATTERN = /[A-Za-z0-9]{1,10}-\d{2}(?![\d-])/u
/** 场景结果词：加粗写法要同时有编号与结果词才算结果行，免得把普通加粗要点当成场景结果。 */
const RESULT_WORD_PATTERN = /通过|失败|豁免|未测|阻塞|作废|已验证|待验证/u

/** 从「## 批次开始：B1 绑定与环境」这类标题里取批次名；没有批次开始标记时返回空串。 */
function batchStartName(body: string): string {
  const matched = /批次开始[:：]\s*([^\s，。；:：]+)/u.exec(String(body || ''))
  return matched ? matched[1] : ''
}

/**
 * 这条评论是不是「必须带验证身份」的记录：批次开始评论，或者给了场景结果的评论。
 *
 * 只认模板里约定的三种结果写法（规则文档第二节）：
 *   「场景 <编号>：<结果>」、Markdown 表格首格是场景编号、「- **<编号> <结果>**：…」。
 * 散文里顺口提一句「场景」不算——判据不猜自然语言，认不出就说明写法不在模板里，由人改写法或补身份行。
 */
export function requiresIdentity(commentBody: string): boolean {
  const text = String(commentBody || '')
  if (/批次开始[:：]/u.test(text)) return true
  for (const line of splitLines(text)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    // 第一类：批次结果段落「场景 1600-02（仓库 #1600 评论 5）：通过。」
    const named = /^(?:[-*]\s*)?场景\s+(.+?)\s*[:：]/u.exec(trimmed)
    if (named && SCENARIO_ID_TOKEN_PATTERN.test(named[1])) return true
    // 第二类：Markdown 表行，首格以场景编号开头（第二格是结果，这里不判结果，只认首格）。
    if (trimmed.startsWith('|')) {
      const firstCell = (trimmed.slice(1).split('|')[0] || '').replace(/[*`]/gu, '').trim()
      if (/^[A-Za-z0-9]{1,10}-\d{2}(?![\d-])/u.test(firstCell)) return true
    }
    // 第三类：加粗要点「- **1630-01 通过**：…」。
    const bold = /^(?:[-*]\s*)?\*\*([^*]+)\*\*/u.exec(trimmed)
    if (bold && SCENARIO_ID_TOKEN_PATTERN.test(bold[1]) && RESULT_WORD_PATTERN.test(bold[1])) return true
  }
  return false
}

/** 差异审计行：「- 候选提交 <40hex> → 发布提交 <40hex>：<一句话理由>」，箭头写 → 或 -> 都认。 */
const AUDIT_LINE_PATTERN = /^\s*-\s*候选提交\s+([0-9a-f]{40})\s*(?:→|->)\s*发布提交\s+([0-9a-f]{40})\s*[:：]\s*(\S[^\r\n]*)$/u

type AuditLine = {
  candidateCommit: string
  releaseCommit: string
  reason: string
}

/** 从清单票正文里收集差异审计行。 */
function collectAuditLines(body: string): AuditLine[] {
  const audits: AuditLine[] = []
  for (const line of splitLines(body)) {
    const matched = AUDIT_LINE_PATTERN.exec(line)
    if (!matched) continue
    audits.push({ candidateCommit: matched[1], releaseCommit: matched[2], reason: matched[3].trim() })
  }
  return audits
}

/** 某个候选提交有没有被「候选 → 发布」的差异审计覆盖。 */
function isAudited(audits: AuditLine[], candidateCommit: string, releaseCommit: string): boolean {
  return audits.some((audit) => audit.candidateCommit === candidateCommit && audit.releaseCommit === releaseCommit)
}

/**
 * 发布前的候选审计：评论里的身份行、候选提交与发布提交的关系、候选清单本身是否可用于发布。
 *
 * 返回全部问题而不是遇到第一条就停：发布前检查一次列全，人改一轮就能改完，不用来回跑。
 * 不传 candidate 时只查评论（身份行、祖先、差异审计），用于「这次发布还没定候选清单」的场合。
 */
export function checkCandidateAudit(options: CandidateAuditOptions): CandidateAuditReport {
  const comments = Array.isArray(options.comments) ? options.comments : []
  const body = String(options.body || '')
  const releaseCommit = String(options.releaseCommit || '')
  const candidate = options.candidate ?? null
  const ancestorCheck = options.ancestorCheck
  const findings: CandidateAuditFinding[] = []

  const collected = collectBatchIdentities(comments)
  const identities = collected.identities
  for (const error of collected.errors) {
    findings.push({
      code: 'identity-conflict',
      message: error,
      fix: '同一批次的批次开始评论与每条场景结果评论要写同一行「验证身份」：批次名、候选提交、候选包 sha256 完全一致；以批次开始评论为准，把对不上的那条改过来。',
    })
  }

  // 一、每条批次开始 / 场景结果评论都要有身份行：没有它，这条记录不知道是在哪个候选上验出来的。
  comments.forEach((comment, commentIndex) => {
    const text = String(comment.body || '')
    if (!requiresIdentity(text)) return
    if (hasIdentityLine(text)) return
    const exampleBatch = batchStartName(text) || '<批次名>'
    findings.push({
      code: 'identity-missing',
      message:
        '第 ' + (commentIndex + 1) + ' 条评论是批次开始或场景结果评论，但没有格式正确的「验证身份」行：' +
        '发布前检查靠这一行把评论和 batch.json 对上，缺了它这条记录不算进通过项。',
      fix:
        '在这条评论里补一行：' + IDENTITY_PREFIX + exampleBatch +
        '；候选提交 <40 位小写候选提交>；候选包 sha256 <64 位小写候选包 tgz 哈希>（批次名、候选提交与候选包 sha256 要和 batch.json 的记录一致）。',
    })
  })

  // 二、至少要有一条带身份行的批次开始评论：没有它，这批证据没有起点，也不知道属于哪个候选。
  const startComments = comments
    .map((comment, commentIndex) => ({ body: String(comment.body || ''), commentIndex }))
    .filter((item) => batchStartName(item.body) !== '')
  if (startComments.length === 0) {
    findings.push({
      code: 'batch-start-missing',
      message: '清单票评论里没有「批次开始：<批次名>」评论：发布前检查找不到这批真机验证的起点。',
      fix:
        '按 docs/agents/real-machine-verification.md 第二节的模板发一条批次开始评论：写清批次号、候选提交、候选包 sha256、' +
        '验证环境与本批场景，并带一行「验证身份」。',
    })
  } else if (!startComments.some((item) => hasIdentityLine(item.body))) {
    findings.push({
      code: 'batch-start-missing',
      message: '有批次开始评论，但没有一条带格式正确的「验证身份」行：发布前检查不知道这批验的是哪个候选。',
      fix:
        '在批次开始评论里补一行：' + IDENTITY_PREFIX + (batchStartName(startComments[0].body) || '<批次名>') +
        '；候选提交 <40 位小写候选提交>；候选包 sha256 <64 位小写候选包 tgz 哈希>（与 batch.json 的记录一致）。',
    })
  }

  // 三、评论里的候选提交必须是发布提交的祖先，并且与发布提交不同时要有差异审计。
  const audits = collectAuditLines(body)
  const differingCommits = new Set<string>()
  const identityCommits: string[] = []
  const batchNameOfCommit = new Map<string, string>()
  for (const identity of identities) {
    if (!batchNameOfCommit.has(identity.commit)) batchNameOfCommit.set(identity.commit, identity.batchName)
    if (identity.commit === releaseCommit) continue
    if (!identityCommits.includes(identity.commit)) identityCommits.push(identity.commit)
  }
  for (const commit of identityCommits) {
    differingCommits.add(commit)
    const batchName = batchNameOfCommit.get(commit) || '<批次名>'
    if (ancestorCheck && !ancestorCheck(commit)) {
      findings.push({
        code: 'commit-not-ancestor',
        message:
          '批次「' + batchName + '」的候选提交 ' + commit + ' 不是发布提交 ' + releaseCommit +
          ' 的祖先：这批验的代码没有进这次要发的版本。',
        fix: '用发布提交（或它的祖先）重新冻结候选、重跑这一批真机验证，再关闭清单票；或者把发布提交换成包含这个候选提交的版本。',
      })
    }
    if (!isAudited(audits, commit, releaseCommit)) {
      findings.push({
        code: 'audit-missing',
        message:
          '批次「' + batchName + '」的候选提交 ' + commit + ' 与发布提交 ' + releaseCommit +
          ' 不同，但清单票正文没有对应的差异审计行。',
        fix: '在清单票正文补一行：- 候选提交 ' + commit + ' → 发布提交 ' + releaseCommit + '：<一句话说明这段差异为什么可以接受>。',
      })
    }
  }

  // 四、候选清单本身：只有 release 候选（干净树冻结、构建期间源码没变）能进发布，并且要在这批记录里登记过。
  if (candidate) {
    const candidateCommit = String(candidate.commit || '')
    const candidateCommitValid = COMMIT_PATTERN.test(candidateCommit)
    if (String(candidate.validity || '') !== 'release') {
      findings.push({
        code: 'candidate-not-release',
        message:
          '候选清单的 validity 是「' + String(candidate.validity || '（空）') + '」：development 候选只用于开发验证，不能作为发布证据。',
        fix: '用不带 --allow-dirty 的方式重新冻结候选（validity 写成 release），再用这个候选重跑真机验证。',
      })
    }
    if (candidate.sourceStable !== true) {
      findings.push({
        code: 'candidate-source-unstable',
        message: '候选清单的 sourceStable 不是 true：冻结前后 HEAD 或未提交文件集合变过，构建出来的包不能当作该提交的候选包。',
        fix: '确认冻结期间源码没有被改动，重新冻结一次候选，并把 sourceStable 写成 true。',
      })
    }
    if (!candidateCommitValid) {
      findings.push({
        code: 'candidate-commit-invalid',
        message: '候选清单的 git.commit 不是 40 位小写十六进制：「' + candidateCommit + '」。',
        fix: '把 candidate.json 的 git.commit 写成完整的 40 位小写提交哈希。',
      })
    } else {
      if (candidateCommit !== releaseCommit) {
        differingCommits.add(candidateCommit)
        if (ancestorCheck && !ancestorCheck(candidateCommit)) {
          findings.push({
            code: 'candidate-commit-not-ancestor',
            message: '候选清单的候选提交 ' + candidateCommit + ' 不是发布提交 ' + releaseCommit + ' 的祖先：这次要发的版本不包含候选代码。',
            fix: '换一个发布提交，或者从发布提交（或它的祖先）重新冻结候选、重跑真机验证。',
          })
        }
        if (!isAudited(audits, candidateCommit, releaseCommit)) {
          findings.push({
            code: 'candidate-audit-missing',
            message:
              '候选清单的候选提交 ' + candidateCommit + ' 与发布提交 ' + releaseCommit +
              ' 不同，但清单票正文没有对应的差异审计行。',
            fix: '在清单票正文补一行：- 候选提交 ' + candidateCommit + ' → 发布提交 ' + releaseCommit + '：<一句话说明这段差异为什么可以接受>。',
          })
        }
      }
      if (!identities.some((identity) => identity.commit === candidateCommit)) {
        findings.push({
          code: 'candidate-not-registered',
          message: '候选清单的候选提交 ' + candidateCommit + ' 没有出现在任何一条「验证身份」行里：这批证据不是对这个候选做的。',
          fix: '用这个候选提交重新冻结、重跑批次，并在批次开始与每条场景结果评论里写同一行「验证身份」；或者换一个已在票面登记过的候选。',
        })
      }
    }
    if (!PACKAGE_SHA256_PATTERN.test(String(candidate.fileDigest || ''))) {
      findings.push({
        code: 'candidate-digest-invalid',
        message: '候选清单的 package.fileDigest 不是 64 位小写十六进制：「' + String(candidate.fileDigest || '（空）') + '」。',
        fix: '重新冻结候选，让 package.fileDigest 写成 64 位小写十六进制的逐文件清单指纹（与 release-integrity.mts 的 digest 同一算法）。',
      })
    }
  }

  const auditCovered =
    differingCommits.size > 0 &&
    [...differingCommits].every((commit) => isAudited(audits, commit, releaseCommit))

  return {
    ok: findings.length === 0,
    findings,
    identities,
    candidateCommit: candidate ? String(candidate.commit || '') : null,
    auditCovered,
  }
}
