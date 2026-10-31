// batch.mts —— 验证批次的身份记录与判据。
//
// 为什么要有这一层：真机验证的证据只有挂在一个确定的候选上才有意义。同一个版本号可能对应多个提交，
// 同一个提交也可能被脏工作树临时改动过；如果批次、候选、证据之间没有可以互相核对的记录，
// 事后只能靠人说「我记得当时是那个包」，发布前的检查也就无法判断一条 PASS 到底在验什么。
//
// 这里把三件事写成纯逻辑，命令层只负责读写文件与起进程：
//   1. 一个候选能不能开一个新批次（必须从当前 HEAD 重新冻结，不能复用旧候选）；
//   2. 一个批次结束时源码是否已经前进（前进就标 stale，原件不删）；
//   3. 一条证据有没有带候选身份、身份与批次记录是否一致。
// 判据写成纯函数，五类反向测试直接测这里，不需要真的构建或真机。

import path from 'node:path'
import { COMMIT_PATTERN, IDENTITY_PREFIX, PACKAGE_SHA256_PATTERN } from '../../lib/release-candidate-audit.mts'
import { digestOfFiles } from '../../release-integrity.mts'
import { exists, readJson, sha256File, writeJson } from './util.mts'

/** candidate.json 里的逐文件条目（与 freeze-candidate 的 CandidateFile 一致）。 */
export interface CandidateFileEntry {
  path: string
  bytes: number
  sha256: string
}

/**
 * 冻结候选时写下的事实。这里只声明判据要读的字段，不重复整个 FrozenManifest 类型：
 * 候选文件属于真机工具台自己的格式，读的时候逐项校验，缺失就当成不合格候选报出来。
 */
export interface FrozenCandidate {
  schemaVersion: number
  generatedAt: string
  ticket?: string | null
  candidateName?: string
  version: string
  validity?: string
  sourceStable?: boolean
  git?: { commit?: string; branch?: string; clean?: boolean; dirtyFiles?: string[] }
  build?: { skipped?: boolean; force?: boolean }
  package?: {
    tgzPath?: string
    tgzSha256?: string
    fileDigest?: string
    manifestDigest?: string
    buildCommit?: string
    fileCount?: number
    files?: CandidateFileEntry[]
  }
}

/** 读出来的候选文件：路径、文件本身的哈希，以及解析后的内容。 */
export interface CandidateFile {
  path: string
  sha256: string
  manifest: FrozenCandidate
}

/** 批次记录里保存的候选身份。字段都来自 candidate.json，另外记下候选文件自身的哈希。 */
export interface BatchCandidateIdentity {
  /** candidate.json 的绝对路径。 */
  path: string
  /** candidate.json 文件字节的 SHA256：候选文件被改过一个字，这里就对不上。 */
  sha256: string
  /** 冻结时的 git 提交。 */
  commit: string
  version: string
  /** release 才能用于发布收口；development 只能做开发验证。 */
  validity: 'release' | 'development'
  tgzPath: string
  tgzSha256: string
  /** 含版本与提交的清单摘要。 */
  manifestDigest: string
  /** 不含版本与提交的逐文件内容指纹，发布前对账用它。 */
  fileDigest: string
}

/** batch.json 的结构。status=stale 表示批次结束后源码前进了，这条批次的证据只对它自己的候选提交有效。 */
export interface BatchRecord {
  schemaVersion: 1
  batchName: string
  batchDir: string
  createdAt: string
  updatedAt: string
  status: 'active' | 'stale'
  /** 批次开始时的 HEAD。候选提交必须等于它。 */
  startHead: string
  startBranch: string
  /** 批次结束时（跑 check-batch 时）的 HEAD；还没结束是 null。 */
  endHead: string | null
  endCheckedAt: string | null
  candidate: BatchCandidateIdentity | null
  /** prepare-batch 的前置巡检结论；没跑到就是 null。 */
  preflight: Record<string, any> | null
  /** 批次实例的信息；--no-start 或启动失败时也会留下记录。 */
  instance: Record<string, any> | null
}

const BATCH_NAME = /^(?=.*[A-Za-z0-9])[A-Za-z0-9._-]+$/

/**
 * 批次名会直接当目录名用，只允许字母数字与 . _ -，避免 ../ 之类跳出工作根。
 * 光有字母数字之外的字符还不够：`.` 与 `..` 本身能通过字符集，却会解析到 batches 目录或工作根本身，
 * 所以要求至少含一个字母或数字；`.`、`..` 与全是点的名字一律拒绝。
 */
export function assertBatchName(name: string): string {
  if (!BATCH_NAME.test(name)) {
    throw new Error('批次名「' + name + '」不合法：只能用字母、数字、点、下划线与连字符，且不能带路径分隔符。')
  }
  return name
}

/** 新建一条 batch.json 记录（还不带候选）。 */
export function createBatchRecord(options: {
  batchName: string
  batchDir: string
  now: string
  git: { commit: string; branch: string }
}): BatchRecord {
  return {
    schemaVersion: 1,
    batchName: assertBatchName(options.batchName),
    batchDir: path.resolve(options.batchDir),
    createdAt: options.now,
    updatedAt: options.now,
    status: 'active',
    startHead: options.git.commit,
    startBranch: options.git.branch,
    endHead: null,
    endCheckedAt: null,
    candidate: null,
    preflight: null,
    instance: null,
  }
}

/** 读 batch.json。不存在、JSON 坏、字段不可信都给出能直接照做的一句话。 */
export function readBatch(batchDir: string): BatchRecord {
  const dir = path.resolve(batchDir)
  const file = path.join(dir, 'batch.json')
  if (!exists(file)) {
    throw new Error(
      '批次目录「' + dir + '」里没有 batch.json：先跑 prepare-batch 建批次，不要手工拼批次目录。',
    )
  }
  let raw: any
  try {
    raw = readJson<any>(file)
  } catch (error: any) {
    throw new Error('batch.json 不是合法 JSON（' + String(error && error.message) + '）：「' + file + '」')
  }
  assertBatchRecord(raw, file)
  return raw as BatchRecord
}

/** 写 batch.json，同时刷新 updatedAt。调用方负责给出准确的 updatedAt。 */
export function writeBatch(batchDir: string, record: BatchRecord, now: string): BatchRecord {
  const updated: BatchRecord = { ...record, updatedAt: now }
  writeJson(path.join(path.resolve(batchDir), 'batch.json'), updated)
  return updated
}

function assertBatchRecord(raw: any, file: string): void {
  const bad = (message: string): never => {
    throw new Error('batch.json 记录不完整（' + message +'）：「' + file + '」')
  }
  if (!raw || typeof raw !== 'object') bad('不是一个对象')
  if (raw.schemaVersion !== 1) bad('schemaVersion 必须是 1')
  if (!BATCH_NAME.test(String(raw.batchName || ''))) bad('batchName 不合法')
  if (!COMMIT_PATTERN.test(String(raw.startHead || ''))) bad('startHead 不是 40 位提交')
  if (raw.status !== 'active' && raw.status !== 'stale') bad('status 只能是 active 或 stale')
  if (raw.candidate !== null && raw.candidate !== undefined) {
    const candidate = raw.candidate
    if (!COMMIT_PATTERN.test(String(candidate.commit || ''))) bad('candidate.commit 不是 40 位提交')
    if (!PACKAGE_SHA256_PATTERN.test(String(candidate.sha256 || ''))) bad('candidate.sha256 不是 64 位哈希')
    if (!PACKAGE_SHA256_PATTERN.test(String(candidate.tgzSha256 || ''))) bad('candidate.tgzSha256 不是 64 位哈希')
    if (!PACKAGE_SHA256_PATTERN.test(String(candidate.manifestDigest || ''))) bad('candidate.manifestDigest 不是 64 位哈希')
    if (!PACKAGE_SHA256_PATTERN.test(String(candidate.fileDigest || ''))) bad('candidate.fileDigest 不是 64 位哈希')
    if (candidate.validity !== 'release' && candidate.validity !== 'development') bad('candidate.validity 只能是 release 或 development')
  }
}

/**
 * 读 candidate.json 并做最小自检。这里不判断它能不能开批（那是 judgeCandidateForBatch 的事），
 * 只保证字段齐全、类型正确，免得后面拿半个对象做判断。
 */
export function readCandidateFile(candidatePath: string): CandidateFile {
  const file = path.resolve(candidatePath)
  if (!exists(file)) throw new Error('候选文件不存在：「' + file + '」')
  let manifest: FrozenCandidate
  try {
    manifest = readJson<FrozenCandidate>(file)
  } catch (error: any) {
    throw new Error('候选文件不是合法 JSON（' + String(error && error.message) + '）：「' + file + '」')
  }
  if (!manifest || typeof manifest !== 'object') throw new Error('候选文件不是对象：「' + file + '」')
  if (!COMMIT_PATTERN.test(String(manifest.git?.commit || ''))) throw new Error('候选文件缺少合法的 git.commit：「' + file + '」')
  if (!manifest.version) throw new Error('候选文件缺少 version：「' + file + '」')
  if (!manifest.package || typeof manifest.package !== 'object') throw new Error('候选文件缺少 package：「' + file + '」')
  return { path: file, sha256: sha256File(file), manifest }
}

/** 把候选文件转成 batch.json 里保存的身份。调用前应已通过 judgeCandidateForBatch。 */
export function candidateIdentity(file: CandidateFile): BatchCandidateIdentity {
  const manifest = file.manifest
  const id: BatchCandidateIdentity = {
    path: file.path,
    sha256: file.sha256,
    commit: String(manifest.git?.commit || ''),
    version: String(manifest.version || ''),
    validity: manifest.validity === 'release' ? 'release' : 'development',
    tgzPath: String(manifest.package?.tgzPath || ''),
    tgzSha256: String(manifest.package?.tgzSha256 || ''),
    manifestDigest: String(manifest.package?.manifestDigest || ''),
    fileDigest: String(manifest.package?.fileDigest || ''),
  }
  return id
}

export interface CandidateVerdict {
  ok: boolean
  problems: string[]
  /** 供调用方直接写进 batch.json 的候选身份；不合格时也会填，方便把不合格原因落盘。 */
  identity: BatchCandidateIdentity
  validity: 'release' | 'development'
}

/**
 * 判断一份候选能不能开一个新批次。宁可多拒绝，也不要把「看起来差不多」的候选放进来：
 * 每一批的证据都绑定候选提交，候选错了整批证据就都失去意义。
 *
 * 拒绝的五类情况（对应票面的验收）：
 *   1. 候选不在本批次目录里：可能是从上一批直接复制过来的；
 *   2. 候选早于批次开始：说明它是批次开始之前就冻结好的旧候选；
 *   3. 候选提交不是当前 HEAD：批次必须从当前 HEAD 重新冻结；
 *   4. 候选产物标记的构建提交不是当前 HEAD：产物不是从这份源码构建的（常见于缓存或 --skip-build）；
 *   5. 候选文件本身缺字段、validity 不是合法值、或标记自己构建期间源码变过。
 * development 候选允许开批（脏树上的开发验证），但发布前检查会拒绝它；这里不替发布环节做决定。
 */
export function judgeCandidateForBatch(options: {
  candidatePath: string
  candidate: CandidateFile
  batchDir: string
  /** 批次开始时间（ISO 文本）。候选的 generatedAt 不能早于它。 */
  batchStartedAt: string
  /** 批次开始时的 HEAD。 */
  currentHead: string
}): CandidateVerdict {
  const problems: string[] = []
  const manifest = options.candidate.manifest
  const identity = candidateIdentity(options.candidate)
  const validity = identity.validity

  const rel = path.relative(path.resolve(options.batchDir), path.resolve(options.candidatePath))
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    problems.push('候选文件不在本批次目录里（' + options.candidatePath + '）：每一批都要重新冻结到自己的目录，不能复用别的批次的候选。')
  }
  const generated = Date.parse(String(manifest.generatedAt || ''))
  const started = Date.parse(options.batchStartedAt)
  if (!Number.isFinite(generated) || !Number.isFinite(started)) {
    problems.push('候选或批次的生成时间读不出来：候选时间「' + String(manifest.generatedAt) + '」，批次开始时间「' + options.batchStartedAt + '」。')
  } else if (generated < started) {
    problems.push('候选生成于 ' + manifest.generatedAt + '，早于本批开始时间 ' + options.batchStartedAt + '：这是旧候选，不能用它开新批次。')
  }
  if (manifest.schemaVersion !== 2) {
    problems.push('候选文件 schemaVersion 是 ' + String(manifest.schemaVersion) + '，当前要求 2：旧格式候选没有 validity 与 buildCommit，重新跑 prepare-batch 冻结。')
  }
  if (!COMMIT_PATTERN.test(identity.commit)) {
    problems.push('候选的 git.commit 不是 40 位提交：「' + identity.commit + '」。')
  } else if (identity.commit !== options.currentHead) {
    problems.push('候选提交 ' + identity.commit + ' 不是当前 HEAD ' + options.currentHead + '：批次必须从当前 HEAD 重新冻结。')
  }
  if (!COMMIT_PATTERN.test(String(manifest.package?.buildCommit || ''))) {
    problems.push('候选缺少 40 位的 package.buildCommit：产物没有自证构建提交，无法确认它来自哪份源码。')
  } else if (String(manifest.package?.buildCommit) !== options.currentHead) {
    problems.push('候选产物的构建提交是 ' + String(manifest.package?.buildCommit) + '，不是当前 HEAD ' + options.currentHead + '：产物不是从当前源码构建的，去掉 --skip-build 重来。')
  }
  if (manifest.sourceStable !== true) {
    problems.push('候选没有记录 sourceStable=true：冻结前后源码状态不一致，产物不能代表一个确定的源码状态。')
  }
  if (manifest.validity !== 'release' && manifest.validity !== 'development') {
    problems.push('候选缺少合法的 validity（release 或 development）。')
  }
  if (!PACKAGE_SHA256_PATTERN.test(identity.fileDigest)) {
    problems.push('候选缺少逐文件内容指纹 package.fileDigest：无法在发布前对账。')
  }
  if (!PACKAGE_SHA256_PATTERN.test(identity.manifestDigest)) {
    problems.push('候选缺少清单摘要 package.manifestDigest。')
  }
  if (!PACKAGE_SHA256_PATTERN.test(identity.tgzSha256)) {
    problems.push('候选缺少候选包哈希 package.tgzSha256。')
  }
  if (!identity.tgzPath || !exists(identity.tgzPath)) {
    problems.push('候选包文件不存在：「' + identity.tgzPath + '」。')
  } else if (PACKAGE_SHA256_PATTERN.test(identity.tgzSha256) && sha256File(identity.tgzPath) !== identity.tgzSha256) {
    problems.push('候选包文件的 sha256 与候选记录里的不一致：' + identity.tgzPath + ' 在冻结之后被换过或改过，这一份不能代表候选。')
  }
  // 用候选自己记录的文件清单再算一次内容指纹，防止有人在冻结之后改了文件清单或换掉 tgz。
  if (Array.isArray(manifest.package?.files) && manifest.package.files.length > 0) {
    const files = manifest.package.files.filter((entry) => entry && typeof entry.path === 'string' && typeof entry.sha256 === 'string' && typeof entry.bytes === 'number')
    if (files.length !== manifest.package.files.length) {
      problems.push('候选文件清单里有条目缺 path/bytes/sha256。')
    } else if (PACKAGE_SHA256_PATTERN.test(identity.fileDigest)) {
      const recomputed = digestOfFiles(files.map((entry) => ({ path: entry.path, size: entry.bytes, sha256: entry.sha256 })))
      if (recomputed !== identity.fileDigest) {
        problems.push('候选文件清单算出来的内容指纹 ' + recomputed.slice(0, 12) + ' 与记录里的 ' + identity.fileDigest.slice(0, 12) + ' 不一致：候选文件被改过。')
      }
    }
  } else {
    problems.push('候选缺少逐文件清单 package.files：无法复核内容指纹。')
  }

  return { ok: problems.length === 0, problems, identity, validity }
}

/**
 * 从磁盘上的文件重新确认批次记录里的候选身份，而不是拿 batch.json 自己跟自己比。
 * prepare-batch 只记录事实，这里负责复核：候选文件是否还是原来那份、候选包是否还是原来那个包。
 * 换掉候选文件或换掉 tgz 都会被抓到，证据才能真的绑定到一个确定的候选上。
 */
export function judgeBatchCandidateFile(batch: BatchRecord): { ok: boolean; problems: string[]; binding: EvidenceCandidateBinding | null } {
  const problems: string[] = []
  const recorded = batch.candidate
  // 身份从磁盘上的候选文件与候选包重新算，不直接拿 batch.json 的字段回填；
  // 这样 collect-evidence 再拿它和 batch.json 比一次，才有「两边独立算过」的意义。
  let actualCommit = ''
  let actualTgzSha256 = ''
  if (!recorded) {
    return { ok: false, problems: ['batch.json 里没有候选身份：先跑 prepare-batch 建批次，再收证据。'], binding: null }
  }
  if (!recorded.path || !exists(recorded.path)) {
    problems.push('批次记录里的候选文件不存在：「' + recorded.path + '」。')
  } else {
    const actualFileHash = sha256File(recorded.path)
    if (actualFileHash !== recorded.sha256) {
      problems.push('候选文件 ' + path.basename(recorded.path) + ' 的 sha256 与批次记录不一致：文件在批次开始后被改过。')
    }
    let manifest: any = null
    try {
      manifest = readJson(recorded.path)
    } catch (error) {
      problems.push('候选文件读不出来或不是合法 JSON：' + (error as Error).message)
    }
    if (manifest) {
      const git = manifest.git && typeof manifest.git === 'object' ? manifest.git : {}
      const pkg = manifest.package && typeof manifest.package === 'object' ? manifest.package : {}
      actualCommit = String(git.commit || '')
      if (actualCommit !== recorded.commit) {
        problems.push('候选文件里的 git.commit「' + String(git.commit) + '」与批次记录的「' + recorded.commit + '」不一致。')
      }
      if (String(manifest.version || '') !== recorded.version) {
        problems.push('候选文件里的 version「' + String(manifest.version) + '」与批次记录的「' + recorded.version + '」不一致。')
      }
      if (String(pkg.tgzSha256 || '') !== recorded.tgzSha256) {
        problems.push('候选文件里的候选包 sha256「' + String(pkg.tgzSha256) + '」与批次记录的「' + recorded.tgzSha256 + '」不一致。')
      }
      if (String(pkg.fileDigest || '') !== recorded.fileDigest) {
        problems.push('候选文件里的内容指纹「' + String(pkg.fileDigest) + '」与批次记录的「' + recorded.fileDigest + '」不一致。')
      }
      if (String(pkg.manifestDigest || '') !== recorded.manifestDigest) {
        problems.push('候选文件里的清单摘要「' + String(pkg.manifestDigest) + '」与批次记录的「' + recorded.manifestDigest + '」不一致。')
      }
      if (manifest.validity !== recorded.validity) {
        problems.push('候选文件里的 validity「' + String(manifest.validity) + '」与批次记录的「' + recorded.validity + '」不一致。')
      }
    }
  }
  if (!recorded.tgzPath || !exists(recorded.tgzPath)) {
    problems.push('批次记录里的候选包文件不存在：「' + recorded.tgzPath + '」。')
  } else {
    actualTgzSha256 = sha256File(recorded.tgzPath)
    if (actualTgzSha256 !== recorded.tgzSha256) {
      problems.push('候选包文件 ' + recorded.tgzPath + ' 的 sha256 与批次记录不一致：包在批次开始后被换过或改过。')
    }
  }
  const ok = problems.length === 0
  return {
    ok,
    problems,
    binding: ok
      ? {
          batchName: batch.batchName,
          commit: actualCommit || recorded.commit,
          packageSha256: actualTgzSha256 || recorded.tgzSha256,
        }
      : null,
  }
}

/** 批次收尾判断：当前 HEAD 与批次开始时不同，就说明这一批之后代码又前进了。 */
export function judgeBatchFreshness(options: {
  batch: BatchRecord
  currentHead: string
  now: string
}): { status: 'active' | 'stale'; endHead: string; endCheckedAt: string; problems: string[]; message: string } {
  const problems: string[] = []
  if (!COMMIT_PATTERN.test(options.currentHead)) problems.push('当前 HEAD 不是 40 位提交：「' + options.currentHead + '」。')
  const stale = options.currentHead !== options.batch.startHead
  if (stale) {
    problems.push(
      '批次开始时的 HEAD 是 ' + options.batch.startHead + '，现在是 ' + options.currentHead +
        '：这一批之后代码前进了，它的证据只对候选提交 ' + options.batch.startHead + ' 有效，不能用于发布收口。',
    )
  }
  const message = stale
    ? '批次已标为 stale：原件保留，重新开一批从当前 HEAD 冻结候选再来。'
    : '批次保持 active：HEAD 没有前进，可以继续往这一批里收证据。'
  return {
    status: stale ? 'stale' : 'active',
    endHead: options.currentHead,
    endCheckedAt: options.now,
    problems,
    message,
  }
}

/** 证据包里应该带的候选身份。字段名与 release-preflight 读评论身份行时用的名字保持一致。 */
export interface EvidenceCandidateBinding {
  batchName: string
  commit: string
  packageSha256: string
}

export function evidenceCandidate(batch: BatchRecord): EvidenceCandidateBinding | null {
  if (!batch.candidate) return null
  return { batchName: batch.batchName, commit: batch.candidate.commit, packageSha256: batch.candidate.tgzSha256 }
}

/**
 * 判断一条证据有没有绑定到批次记录里的候选。
 * 缺身份或身份不一致的证据不能进入报告统计：它说不清自己在验哪个候选，混进去会让统计看起来比实际更有依据。
 */
export function judgeEvidenceBinding(batch: BatchRecord, meta: Record<string, any>): { ok: boolean; problems: string[]; binding: EvidenceCandidateBinding | null } {
  const problems: string[] = []
  const expected = evidenceCandidate(batch)
  const actual = meta && typeof meta === 'object' ? meta.candidate : null
  if (!expected) {
    problems.push('batch.json 里没有候选身份：先跑 prepare-batch 建批次，再收证据。')
  }
  if (!actual || typeof actual !== 'object') {
    problems.push('证据的 meta 里没有 candidate 字段：这条证据缺候选身份，不能计入报告统计。')
  } else {
    if (String(actual.batchName || '') !== String(expected?.batchName || '')) {
      problems.push('证据里的批次名「' + String(actual.batchName) + '」与 batch.json 的「' + String(expected?.batchName) + '」不一致。')
    }
    if (String(actual.commit || '') !== String(expected?.commit || '')) {
      problems.push('证据里的候选提交「' + String(actual.commit) + '」与 batch.json 的「' + String(expected?.commit) + '」不一致。')
    }
    if (String(actual.packageSha256 || '') !== String(expected?.packageSha256 || '')) {
      problems.push('证据里的候选包 sha256「' + String(actual.packageSha256) + '」与 batch.json 的「' + String(expected?.packageSha256) + '」不一致。')
    }
  }
  return { ok: problems.length === 0, problems, binding: expected }
}

/** 批次身份行：批次开始评论与每条场景结果评论都要带这一行，发布前检查靠它把评论和 batch.json 对上。 */
export function batchIdentityLine(binding: EvidenceCandidateBinding): string {
  return IDENTITY_PREFIX + binding.batchName + '；候选提交 ' + binding.commit + '；候选包 sha256 ' + binding.packageSha256
}
