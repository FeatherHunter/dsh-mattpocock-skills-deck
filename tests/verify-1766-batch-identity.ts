// tests/verify-1766-batch-identity.ts —— #1766 批次候选身份与证据绑定判据门禁。
//
// 为什么要有这一条：候选身份是「这条 PASS 在验什么」的唯一依据。判据写错一个条件，
// 旧候选、脏候选、事后改过的清单都可能被当成有效证据，而这类错误在真机上很难看出来。
// 这里用临时目录造离线候选，把五类反向场景钉成纯逻辑测试，不构建、不联网、不起实例：
//   1. 旧候选开新批（候选早于批次开始、提交不是当前 HEAD、不在本批次目录）；
//   2. 脏候选冒充发布（development 记法、sourceStable=false 被拒）；
//   3. 证据缺身份或身份与批次记录不一致；
//   4. 批次结束后 HEAD 前进（标 stale，原件不删）；
//   5. 候选文件被改过（清单重算内容指纹对不上）。
// 门禁归属: scripts/real-machine/lib/batch.mts
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { digestOfFiles } from '../scripts/release-integrity.mts'
import { printGateResult } from './lib/gate-result.ts'
import {
  assertBatchName,
  batchIdentityLine,
  candidateIdentity,
  createBatchRecord,
  evidenceCandidate,
  judgeBatchCandidateFile,
  judgeBatchFreshness,
  judgeCandidateForBatch,
  judgeEvidenceBinding,
  readBatch,
  readCandidateFile,
  writeBatch,
} from '../scripts/real-machine/lib/batch.mts'

const COMMIT_A = 'a'.repeat(40)
const COMMIT_B = 'b'.repeat(40)
const MANIFEST_DIGEST = 'd'.repeat(64)

// 批次名会被当成目录名：`.` 与 `..` 能通过字符集却会解析到 batches 目录或工作根本身，必须拒绝。
function rejectsBatchName(name: string): boolean {
  try {
    assertBatchName(name)
    return false
  } catch {
    return true
  }
}

let failed = false
let total = 0
const check = (ok: boolean, message: string): void => {
  total += 1
  if (!ok) failed = true
  console.log((ok ? '  PASS ' : '  FAIL ') + message)
}

console.log('批次名校验')
check(rejectsBatchName('.'), '批次名不能是单个点（会指到 batches 目录本身）')
check(rejectsBatchName('..'), '批次名不能是两个点（会指到工作根）')

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-1766-'))
const batchDir = path.join(base, 'batches', 'batch-a')
const candidateDir = path.join(batchDir, 'pkg')
fs.mkdirSync(candidateDir, { recursive: true })
const tgzPath = path.join(candidateDir, 'candidate.tgz')
const tgzBytes = 'fake tgz'
fs.writeFileSync(tgzPath, tgzBytes)
const TGZ_SHA = crypto.createHash('sha256').update(tgzBytes).digest('hex')
const files = [{ path: 'lib/client.js', bytes: 7, sha256: 'e'.repeat(64) }]
const fileDigest = digestOfFiles(files.map((entry) => ({ path: entry.path, size: entry.bytes, sha256: entry.sha256 })))
const startedAt = new Date().toISOString()

function makeCandidate(overrides: Record<string, any> = {}, fileName = 'candidate.json'): { path: string; manifest: any } {
  const manifest: any = {
    schemaVersion: 2,
    generatedAt: startedAt,
    version: '1.9.0-beta.33',
    validity: 'release',
    sourceStable: true,
    git: { commit: COMMIT_A, branch: 'main', clean: true, dirtyFiles: [] },
    build: { skipped: false, force: true, command: 'node scripts/build.mts --pkg-only', exitCode: 0, elapsedMs: 1 },
    package: {
      tgzPath,
      tgzBytes: 8,
      tgzSha256: TGZ_SHA,
      filename: 'candidate.tgz',
      npmShasum: 'f'.repeat(40),
      npmIntegrity: 'sha512-fake',
      npmPackSourceDir: candidateDir,
      npmPackCommand: 'npm pack --json',
      fileCount: files.length,
      files,
      manifestDigest: MANIFEST_DIGEST,
      fileDigest,
      buildCommit: COMMIT_A,
    },
    install: null,
    ui: null,
    reproducible: null,
    ...overrides,
  }
  const target = path.join(candidateDir, fileName)
  fs.writeFileSync(target, JSON.stringify(manifest, null, 2))
  return { path: target, manifest }
}

function judge(candidatePath: string, currentHead = COMMIT_A, batchStartedAt = startedAt) {
  const candidate = readCandidateFile(candidatePath)
  return judgeCandidateForBatch({ candidatePath, candidate, batchDir, batchStartedAt, currentHead })
}

console.log('批次候选身份判据门禁（#1766）')

// 1a. 正常候选：当前 HEAD 刚冻结、release、干净、指纹自洽。
const good = makeCandidate()
const goodVerdict = judge(good.path)
check(goodVerdict.ok, '当前 HEAD 的干净候选可以开批' + (goodVerdict.ok ? '' : '：' + goodVerdict.problems.join('；')))
check(goodVerdict.validity === 'release', '干净候选的 validity 是 release')

// 1b. 旧候选：生成时间早于批次开始。
const oldFile = makeCandidate({ generatedAt: '2020-01-01T00:00:00.000Z' }, 'old.json')
const oldVerdict = judge(oldFile.path)
check(!oldVerdict.ok && oldVerdict.problems.some((item) => item.includes('早于本批开始时间')), '早于批次开始的旧候选被拒绝')

// 1c. 候选提交不是当前 HEAD。
const staleCommitFile = makeCandidate({}, 'stale-commit.json')
const staleCommitVerdict = judge(staleCommitFile.path, COMMIT_B)
check(!staleCommitVerdict.ok && staleCommitVerdict.problems.some((item) => item.includes('不是当前 HEAD')), '候选提交不等于当前 HEAD 时被拒绝')

// 1d. 候选文件不在本批次目录里（从上一批复制过来的）。
const outsideDir = path.join(base, 'other-batch')
fs.mkdirSync(outsideDir, { recursive: true })
const outsideManifest = { ...good.manifest }
const outsidePath = path.join(outsideDir, 'candidate.json')
fs.writeFileSync(outsidePath, JSON.stringify(outsideManifest, null, 2))
const outsideVerdict = judge(outsidePath)
check(!outsideVerdict.ok && outsideVerdict.problems.some((item) => item.includes('不在本批次目录里')), '不在本批次目录里的候选被拒绝')

// 2a. 脏候选：validity=development 如实记录，但仍须 sourceStable=true 才可能是有效产物。
const devFile = makeCandidate({ validity: 'development', git: { commit: COMMIT_A, branch: 'main', clean: false, dirtyFiles: ['src/client/index.ts'] } }, 'dev.json')
const devVerdict = judge(devFile.path)
check(devVerdict.ok && devVerdict.validity === 'development', '脏树候选可以开批，但记成 development（不能用于发布收口）')
check(devVerdict.identity.validity === 'development', '批次身份里保存 development，发布前检查可以据此拒绝')

// 2b. 构建期间源码变过的候选：sourceStable=false 必须拒绝。
const unstableFile = makeCandidate({ sourceStable: false }, 'unstable.json')
const unstableVerdict = judge(unstableFile.path)
check(!unstableVerdict.ok && unstableVerdict.problems.some((item) => item.includes('sourceStable')), 'sourceStable=false 的候选被拒绝')

// 2c. 产物标记的构建提交不是当前 HEAD（例如复用了缓存或 --skip-build 的旧产物）。
const wrongBuildCommitFile = makeCandidate({ package: { ...good.manifest.package, buildCommit: COMMIT_B } }, 'wrong-build.json')
const wrongBuildVerdict = judge(wrongBuildCommitFile.path)
check(!wrongBuildVerdict.ok && wrongBuildVerdict.problems.some((item) => item.includes('构建提交不是当前 HEAD') || item.includes('构建提交是')), '产物构建提交不等于当前 HEAD 时被拒绝')

// 3. 证据绑定：缺身份、批次名/提交/包哈希不一致都要拒绝。
const record = createBatchRecord({ batchName: 'batch-a', batchDir, now: startedAt, git: { commit: COMMIT_A, branch: 'main' } })
record.candidate = candidateIdentity(readCandidateFile(good.path))
const binding = evidenceCandidate(record)
check(binding !== null && binding.commit === COMMIT_A, '批次记录能给出候选身份')
const line = batchIdentityLine(binding!)
check(line === '- 验证身份：批次 batch-a；候选提交 ' + COMMIT_A + '；候选包 sha256 ' + TGZ_SHA, '身份行格式与发布前检查约定的机器格式一致')
check(judgeEvidenceBinding(record, { candidate: binding }).ok, '带正确候选身份的证据通过绑定检查')
const missing = judgeEvidenceBinding(record, {})
check(!missing.ok && missing.problems.some((item) => item.includes('没有 candidate 字段')), '缺候选身份的证据被拒绝')
const wrongCommit = judgeEvidenceBinding(record, { candidate: { ...binding!, commit: COMMIT_B } })
check(!wrongCommit.ok && wrongCommit.problems.some((item) => item.includes('候选提交')), '候选提交不一致的证据被拒绝')
const wrongSha = judgeEvidenceBinding(record, { candidate: { ...binding!, packageSha256: 'f'.repeat(64) } })
check(!wrongSha.ok && wrongSha.problems.some((item) => item.includes('候选包 sha256')), '候选包哈希不一致的证据被拒绝')

// 4. 批次收尾：HEAD 没变保持 active；HEAD 前进标 stale 并记下结束 HEAD。
const active = judgeBatchFreshness({ batch: record, currentHead: COMMIT_A, now: startedAt })
check(active.status === 'active' && active.endHead === COMMIT_A, 'HEAD 没前进时批次保持 active')
const stale = judgeBatchFreshness({ batch: record, currentHead: COMMIT_B, now: startedAt })
check(stale.status === 'stale' && stale.endHead === COMMIT_B, 'HEAD 前进后批次标 stale 并记下结束 HEAD')
check(stale.problems.some((item) => item.includes('不能用于发布收口')), 'stale 结论里写清不能用于发布收口')

// 5. 候选文件被改过：清单重算出来的内容指纹对不上，必须拒绝。
const tamperedFiles = [{ path: 'lib/client.js', bytes: 7, sha256: '9'.repeat(64) }]
const tamperedFile = makeCandidate({ package: { ...good.manifest.package, files: tamperedFiles } }, 'tampered.json')
const tamperedVerdict = judge(tamperedFile.path)
check(!tamperedVerdict.ok && tamperedVerdict.problems.some((item) => item.includes('内容指纹')), '文件清单与记录的内容指纹不一致时被拒绝')

// 6. 候选包哈希必须对着真实文件核一遍：记录里写一个漂亮的 64 位假哈希不算数。
const badTgzFile = makeCandidate({ package: { ...good.manifest.package, tgzSha256: '0'.repeat(64) } }, 'bad-tgz.json')
const badTgzVerdict = judge(badTgzFile.path)
check(!badTgzVerdict.ok && badTgzVerdict.problems.some((item) => item.includes('候选包文件的 sha256')), '候选记录里的包哈希与真实 tgz 对不上时被拒绝')

// 7. 收证据前从磁盘重新认身份：候选文件与候选包都要还是原来那一份。
const diskVerdict = judgeBatchCandidateFile(record)
check(diskVerdict.ok && diskVerdict.binding?.commit === COMMIT_A, '磁盘上的候选文件与包和批次记录一致时通过复核')
const changedManifest = JSON.parse(fs.readFileSync(good.path, 'utf8'))
changedManifest.version = '9.9.9'
fs.writeFileSync(good.path, JSON.stringify(changedManifest, null, 2))
const changedFileVerdict = judgeBatchCandidateFile(record)
check(!changedFileVerdict.ok && changedFileVerdict.problems.some((item) => item.includes('sha256 与批次记录不一致')), '候选文件在批次开始后被改过时被拒绝')
fs.writeFileSync(good.path, JSON.stringify(good.manifest, null, 2))
fs.writeFileSync(tgzPath, 'replaced tgz')
const changedTgzVerdict = judgeBatchCandidateFile(record)
check(!changedTgzVerdict.ok && changedTgzVerdict.problems.some((item) => item.includes('候选包文件') && item.includes('不一致')), '候选包在批次开始后被换过时被拒绝')

// 补一条：batch.json 能原样读回，避免判据用到的字段在写盘时丢掉。
const saved = writeBatch(batchDir, record, startedAt)
const reloaded = readBatch(batchDir)
check(reloaded.candidate?.fileDigest === saved.candidate?.fileDigest, 'batch.json 写盘再读回后候选指纹仍然在')

// 8. 命令层接线也真跑一遍：纯函数绿不代表 collect-evidence 真的把候选身份写进了证据。
// 这里造一个通过前置巡检的批次，起子进程收一条证据，再改坏候选文件看它会不会拒。
console.log('[collect-evidence 接线]')
record.preflight = { ok: true }
writeBatch(batchDir, record, startedAt)
fs.writeFileSync(tgzPath, tgzBytes)
const evidenceInput = path.join(base, 'note.txt')
fs.writeFileSync(evidenceInput, 'evidence for collect-evidence smoke')
const collectArgs = [
  '--import',
  './scripts/ts-hook.mts',
  'scripts/real-machine/commands/collect-evidence.mts',
  '--batch',
  batchDir,
  '--file',
  evidenceInput,
  '--check',
  'ok=true',
]
const runCollect = (): { code: number | null; output: string } => {
  const result = spawnSync(process.execPath, collectArgs, { cwd: process.cwd(), encoding: 'utf8' })
  return { code: result.status, output: String(result.stdout || '') + String(result.stderr || '') }
}
const collectRun = runCollect()
check(collectRun.code === 0, 'collect-evidence 对通过巡检的批次收证据时退出 0（实际 code=' + String(collectRun.code) + '，输出=' + JSON.stringify(collectRun.output.slice(0, 200)) + '）')
const evidenceManifest = JSON.parse(fs.readFileSync(path.join(batchDir, 'evidence.json'), 'utf8'))
const expectedBinding = evidenceCandidate(record)
check(
  evidenceManifest.candidate?.batchName === expectedBinding?.batchName &&
    evidenceManifest.candidate?.commit === expectedBinding?.commit &&
    evidenceManifest.candidate?.packageSha256 === expectedBinding?.packageSha256,
  'evidence.json 顶层的候选身份与批次记录一致',
)
fs.appendFileSync(good.path, ' ')
const tamperedRun = runCollect()
check(tamperedRun.code !== 0 && tamperedRun.output.includes('候选文件'), '候选文件在批次开始后被改过时 collect-evidence 拒收')
fs.writeFileSync(good.path, JSON.stringify(good.manifest, null, 2))

printGateResult('verify-1766-batch-identity', total, failed ? total : 0)
if (failed) process.exitCode = 1
