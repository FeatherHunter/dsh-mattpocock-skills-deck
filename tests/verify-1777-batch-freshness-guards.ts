// tests/verify-1777-batch-freshness-guards.ts —— #1777 开批基线守卫与版本口径门禁。
//
// 为什么要有这一条：真机验证最贵的错误不是场景跑红，而是整批跑绿却在验旧代码或旧版本。
// #1766 能证明「这一批验的是某个确定的候选」，但证明不了「这个候选是当前最新代码、是这次要发布的版本」：
// 在集成分支上开批时，候选提交是集成分支的合并提交，它可能一直不动，而 main 已经前进了几十个提交；
// 候选版本也可能还停在上一版，而 main 的 package.json 早已前进。
//
// 这里把两条守卫钉成可离线重放的判据（门禁归属: scripts/real-machine/lib/batch.mts）：
//   1. 新鲜度：候选提交必须包含开批时本地基线（默认 main）的 tip；--allow-outdated-base 只用于开发验证；
//   2. 版本口径：候选版本必须等于基线分支 package.json 的版本（已发布 beta.32 → 验 beta.33；稳定版同理）；
//      任何放行开关都不能绕过版本核对；
//   3. 收尾：批次结束重读基线 tip，前进就标 stale；没有 base 记录的旧批次同样判 stale；
//   4. 命令层接线：check-batch 真的会读基线前进、prepare-batch 真的会在构建前拒绝落后分支与坏环境文件。
//
// 用临时 git 仓库造真实提交与真实祖先关系；不构建、不联网、不起实例。
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { digestOfFiles } from '../scripts/release-integrity.mts'
import { printGateResult } from './lib/gate-result.ts'
import {
  batchBaseLine,
  createBatchRecord,
  judgeBatchFreshness,
  judgeCandidateForBatch,
  readBatch,
  readCandidateFile,
  writeBatch,
} from '../scripts/real-machine/lib/batch.mts'
import { gitContains, gitTipAt, readLocalBaseline, readVersionAtRef } from '../scripts/real-machine/lib/candidate.mts'

const TARGET_VERSION = '1.9.0-beta.33'
const OLD_VERSION = '1.9.0-beta.32'
const MANIFEST_DIGEST = 'd'.repeat(64)

let failed = false
let total = 0
const check = (ok: boolean, message: string): void => {
  total += 1
  if (!ok) failed = true
  console.log((ok ? '  PASS ' : '  FAIL ') + message)
}

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-1777-'))
const workRoot = path.join(tmpRoot, 'work')
fs.mkdirSync(workRoot, { recursive: true })
const batchDir = path.join(workRoot, 'batches', 'batch-freshness')
const candidateDir = path.join(batchDir, 'pkg')
fs.mkdirSync(candidateDir, { recursive: true })

// 临时 git 仓库：root → main 上的两次提交；另有一条从 root 分叉的 feature 分支，用来验证「分叉」与「落后」两种情况。
const repoDir = path.join(tmpRoot, 'repo')
fs.mkdirSync(repoDir, { recursive: true })
const git = (args: string[]): string => {
  const result = spawnSync('git', args, { cwd: repoDir, encoding: 'utf8' })
  if (result.status !== 0) throw new Error('临时仓库 git ' + args.join(' ') + ' 失败：' + String(result.stderr || ''))
  return String(result.stdout || '').trim()
}
git(['init', '-q'])
git(['config', 'user.email', 'verify-1777@example.invalid'])
git(['config', 'user.name', 'verify-1777'])
// 显式建 main 分支再提交：不依赖本机 init.defaultBranch 配置，换一台机器结果一致。
git(['checkout', '-q', '-b', 'main'])
fs.writeFileSync(path.join(repoDir, 'package.json'), JSON.stringify({ name: 'fake-package', version: TARGET_VERSION }, null, 2))
fs.writeFileSync(path.join(repoDir, 'base.txt'), 'base\n')
git(['add', '-A'])
git(['commit', '-q', '-m', 'root'])
const COMMIT_ROOT = git(['rev-parse', 'HEAD'])
fs.writeFileSync(path.join(repoDir, 'main-1.txt'), 'main 1\n')
git(['add', '-A'])
git(['commit', '-q', '-m', 'main commit 1'])
const MAIN_TIP = git(['rev-parse', 'HEAD'])
git(['checkout', '-q', '-b', 'feature', COMMIT_ROOT])
fs.writeFileSync(path.join(repoDir, 'feature.txt'), 'feature\n')
git(['add', '-A'])
git(['commit', '-q', '-m', 'feature commit'])
const FORK_COMMIT = git(['rev-parse', 'HEAD'])
git(['checkout', '-q', 'main'])
fs.writeFileSync(path.join(repoDir, 'main-1.txt'), 'main 2\n')
git(['add', '-A'])
git(['commit', '-q', '-m', 'main commit 2'])
const MAIN_NEXT = git(['rev-parse', 'HEAD'])

const tgzBytes = 'fake tgz for verify-1777'
const tgzPath = path.join(candidateDir, 'candidate.tgz')
fs.writeFileSync(tgzPath, tgzBytes)
const TGZ_SHA = crypto.createHash('sha256').update(tgzBytes).digest('hex')
const files = [{ path: 'lib/client.js', bytes: 7, sha256: 'e'.repeat(64) }]
const fileDigest = digestOfFiles(files.map((entry) => ({ path: entry.path, size: entry.bytes, sha256: entry.sha256 })))
const startedAt = new Date().toISOString()
let candidateSeq = 0

/** 造一个字段自洽的离线候选：commit 与 buildCommit 都是给定提交，其余字段与真实冻结输出同形。 */
function makeCandidate(commit: string, overrides: Record<string, any> = {}): string {
  candidateSeq += 1
  const manifest: any = {
    schemaVersion: 2,
    generatedAt: startedAt,
    version: TARGET_VERSION,
    validity: 'release',
    sourceStable: true,
    git: { commit, branch: 'main', clean: true, dirtyFiles: [] },
    build: { skipped: false, force: true },
    package: {
      tgzPath,
      tgzSha256: TGZ_SHA,
      fileCount: files.length,
      files,
      manifestDigest: MANIFEST_DIGEST,
      fileDigest,
      buildCommit: commit,
    },
    install: null,
    ui: null,
    ...overrides,
  }
  const target = path.join(candidateDir, 'candidate-' + candidateSeq + '.json')
  fs.writeFileSync(target, JSON.stringify(manifest, null, 2))
  return target
}

/** 用给定候选提交、基线与「当前 HEAD」（候选必须等于它）跑候选判据。 */
function judgeCandidate(options: {
  commit: string
  baselineTip?: string
  allowOutdated?: boolean
  expectedVersion?: string
  overrides?: Record<string, any>
}): ReturnType<typeof judgeCandidateForBatch> {
  const candidatePath = makeCandidate(options.commit, options.overrides || {})
  return judgeCandidateForBatch({
    candidatePath,
    candidate: readCandidateFile(candidatePath),
    batchDir,
    batchStartedAt: startedAt,
    currentHead: options.commit,
    repository: repoDir,
    baseline: {
      ref: 'main',
      tip: options.baselineTip === undefined ? options.commit : options.baselineTip,
      expectedVersion: options.expectedVersion === undefined ? TARGET_VERSION : options.expectedVersion,
      allowOutdated: options.allowOutdated === true,
    },
  })
}

const problemsText = (verdict: { problems: string[] }): string => verdict.problems.join('；')

console.log('[开批基线读取]')
const baseline = readLocalBaseline(repoDir, 'main')
check(baseline.ref === 'main', 'readLocalBaseline 记下基线分支名 main')
check(baseline.tip === MAIN_NEXT, 'readLocalBaseline 读到的是本地 main 的当前 tip（而不是工作树 HEAD）')
check(baseline.expectedVersion === TARGET_VERSION, 'readLocalBaseline 从 main 的 package.json 读到目标版本 ' + TARGET_VERSION)
check(readVersionAtRef(repoDir, 'main') === TARGET_VERSION, 'readVersionAtRef 单独读版本也一致')
check(gitTipAt(repoDir, 'feature') === FORK_COMMIT, 'gitTipAt 能读任意本地分支的 tip')

let missingRefError = ''
try {
  readLocalBaseline(repoDir, 'no-such-branch')
} catch (error: any) {
  missingRefError = String(error && error.message ? error.message : error)
}
check(missingRefError.includes('读不到本地分支'), '基线分支不存在时给出能照做的错误（不回一张空基线）')

check(gitContains(repoDir, COMMIT_ROOT, MAIN_NEXT), 'gitContains：祖先提交在历史里')
check(gitContains(repoDir, MAIN_NEXT, MAIN_NEXT), 'gitContains：同一个提交算包含')
check(!gitContains(repoDir, MAIN_NEXT, COMMIT_ROOT), 'gitContains：后继提交不在祖先里')
check(!gitContains(repoDir, FORK_COMMIT, MAIN_NEXT), 'gitContains：分叉提交不互相包含')

console.log('[候选新鲜度守卫]')
const goodVerdict = judgeCandidate({ commit: MAIN_NEXT, baselineTip: MAIN_TIP })
check(goodVerdict.ok && goodVerdict.outdatedBase === false, '候选包含基线 tip 时通过新鲜度检查' + (goodVerdict.ok ? '' : '：' + problemsText(goodVerdict)))

const behindVerdict = judgeCandidate({ commit: COMMIT_ROOT, baselineTip: MAIN_TIP })
check(
  !behindVerdict.ok && behindVerdict.problems.some((item) => item.includes('不包含') && item.includes('落后于最新代码')),
  '候选提交不包含基线 tip 时被拒绝，并说清这是落后代码',
)

const forkVerdict = judgeCandidate({ commit: FORK_COMMIT, baselineTip: MAIN_TIP })
check(!forkVerdict.ok && forkVerdict.problems.some((item) => item.includes('不包含')), '候选提交与基线分叉时被拒绝')

const outdatedVerdict = judgeCandidate({ commit: COMMIT_ROOT, baselineTip: MAIN_TIP, allowOutdated: true })
check(outdatedVerdict.ok && outdatedVerdict.outdatedBase === true, '--allow-outdated-base 放行落后候选，但标记 outdatedBase=true（只能开发验证）')

console.log('[版本口径守卫]')
const wrongVersionVerdict = judgeCandidate({ commit: MAIN_NEXT, overrides: { version: OLD_VERSION } })
check(
  !wrongVersionVerdict.ok && wrongVersionVerdict.problems.some((item) => item.includes('不是这次要发布的版本') && item.includes(TARGET_VERSION)),
  '候选版本不是基线 package.json 的版本时被拒绝',
)

const wrongVersionOutdatedVerdict = judgeCandidate({
  commit: COMMIT_ROOT,
  baselineTip: MAIN_TIP,
  allowOutdated: true,
  overrides: { version: OLD_VERSION },
})
check(
  !wrongVersionOutdatedVerdict.ok && wrongVersionOutdatedVerdict.problems.some((item) => item.includes('不是这次要发布的版本')),
  '--allow-outdated-base 不能绕过版本核对',
)

const devWrongVersionVerdict = judgeCandidate({
  commit: MAIN_NEXT,
  overrides: { validity: 'development', git: { commit: MAIN_NEXT, branch: 'main', clean: false, dirtyFiles: ['src/x.ts'] }, version: OLD_VERSION },
})
check(
  !devWrongVersionVerdict.ok && devWrongVersionVerdict.problems.some((item) => item.includes('不是这次要发布的版本')),
  'development 候选（--allow-dirty）也不能绕过版本核对',
)

const noBaselineTipVerdict = judgeCandidate({ commit: MAIN_NEXT, baselineTip: '' })
check(!noBaselineTipVerdict.ok && noBaselineTipVerdict.problems.some((item) => item.includes('开批基线缺少 40 位提交')), '基线 tip 缺失时拒绝开批')

const noExpectedVersionVerdict = judgeCandidate({ commit: MAIN_NEXT, expectedVersion: '' })
check(!noExpectedVersionVerdict.ok && noExpectedVersionVerdict.problems.some((item) => item.includes('没有记录目标版本')), '基线没有目标版本时拒绝开批')

console.log('[批次收尾守卫]')
const record = createBatchRecord({
  batchName: 'batch-freshness',
  batchDir,
  now: startedAt,
  git: { commit: MAIN_NEXT, branch: 'main' },
  base: { ref: 'main', tip: MAIN_TIP, expectedVersion: TARGET_VERSION, allowOutdated: false },
})
const active = judgeBatchFreshness({ batch: record, currentHead: MAIN_NEXT, now: startedAt, currentBaseTip: MAIN_TIP })
check(active.status === 'active' && active.problems.length === 0, 'HEAD 与基线都没前进时批次保持 active' + (active.problems.length ? '：' + active.problems.join('；') : ''))

const baseAdvanced = judgeBatchFreshness({ batch: record, currentHead: MAIN_NEXT, now: startedAt, currentBaseTip: MAIN_NEXT })
check(
  baseAdvanced.status === 'stale' && baseAdvanced.problems.some((item) => item.includes('本地基线') && item.includes('前进')),
  'HEAD 没动但本地基线前进时批次标 stale',
)

const baseUnreadable = judgeBatchFreshness({ batch: record, currentHead: MAIN_NEXT, now: startedAt, currentBaseTip: null, baseReadError: '模拟读不到分支' })
check(
  baseUnreadable.status === 'stale' && baseUnreadable.problems.some((item) => item.includes('读不到本地基线')),
  '收尾时读不到基线也判 stale（不能把「读不到」当成「没前进」）',
)

const noBaseRecord = { ...record, base: null } as typeof record
const noBaseVerdict = judgeBatchFreshness({ batch: noBaseRecord, currentHead: MAIN_NEXT, now: startedAt, currentBaseTip: MAIN_TIP })
check(
  noBaseVerdict.status === 'stale' && noBaseVerdict.problems.some((item) => item.includes('没有记录开批基线')),
  '没有 base 记录的旧批次判 stale，不能用于发布收口',
)

const outdatedRecord = { ...record, base: { ...record.base!, allowOutdated: true } } as typeof record
const outdatedFreshness = judgeBatchFreshness({ batch: outdatedRecord, currentHead: MAIN_NEXT, now: startedAt, currentBaseTip: MAIN_TIP })
check(
  outdatedFreshness.status === 'stale' && outdatedFreshness.problems.some((item) => item.includes('--allow-outdated-base')),
  'allowOutdated 的批次收尾时判 stale',
)

console.log('[batch.json 往返与坏记录]')
const saved = writeBatch(batchDir, record, startedAt)
const reloaded = readBatch(batchDir)
check(
  reloaded.base?.ref === 'main' && reloaded.base?.tip === MAIN_TIP && reloaded.base?.expectedVersion === TARGET_VERSION && reloaded.base?.allowOutdated === false,
  'batch.json 写盘再读回后 base 三个事实都还在',
)
check(batchBaseLine(saved.base) === '- 验证基线：本地 main ' + MAIN_TIP + '；目标版本 ' + TARGET_VERSION, '验证基线行格式稳定（批次开始评论按它写）')
check(batchBaseLine(null) === null, '没有 base 时不编造基线行')

const badDir = path.join(tmpRoot, 'bad-batch')
fs.mkdirSync(badDir, { recursive: true })
const badRecord = { ...record, base: { ref: 'main', tip: 'abc', expectedVersion: TARGET_VERSION, allowOutdated: false } }
fs.writeFileSync(path.join(badDir, 'batch.json'), JSON.stringify(badRecord, null, 2))
let badBaseError = ''
try {
  readBatch(badDir)
} catch (error: any) {
  badBaseError = String(error && error.message ? error.message : error)
}
check(badBaseError.includes('base.tip 不是 40 位提交'), 'base.tip 不是 40 位提交时 readBatch 拒绝整条记录')

// 还原 batch.json：后面的命令层接线要读一份干净记录。
writeBatch(batchDir, record, startedAt)

console.log('[命令层接线：check-batch]')
const runScript = (script: string, args: string[], extraEnv: Record<string, string>): { code: number | null; output: string } => {
  const result = spawnSync(process.execPath, ['--import', './scripts/ts-hook.mts', script, ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, ...extraEnv },
  })
  return { code: result.status, output: String(result.stdout || '') + String(result.stderr || '') }
}
const commandEnv = { DECK_REPO_ROOT: repoDir, DSH_VERIFY_WORK_ROOT: workRoot }

// 让批次记录与当前 main tip 一致：base tip 用 MAIN_NEXT、startHead 也用 MAIN_NEXT。
const wiringRecord = createBatchRecord({
  batchName: 'batch-freshness',
  batchDir,
  now: startedAt,
  git: { commit: MAIN_NEXT, branch: 'main' },
  base: { ref: 'main', tip: MAIN_NEXT, expectedVersion: TARGET_VERSION, allowOutdated: false },
})
writeBatch(batchDir, wiringRecord, startedAt)
const checkActive = runScript('scripts/real-machine/commands/check-batch.mts', ['--batch', batchDir], commandEnv)
check(checkActive.code === 0 && checkActive.output.includes('"status": "active"'), 'check-batch 在 HEAD 与基线都没前进时退出 0（实际 code=' + String(checkActive.code) + '）')

// 基线前进：临时仓库再提交一次，main tip 变了，但批次记录里的 startHead 没变。
fs.writeFileSync(path.join(repoDir, 'main-3.txt'), 'main 3\n')
git(['add', '-A'])
git(['commit', '-q', '-m', 'main commit 3'])
const checkStale = runScript('scripts/real-machine/commands/check-batch.mts', ['--batch', batchDir], commandEnv)
check(checkStale.code === 1 && checkStale.output.includes('"status": "stale"'), 'check-batch 在本地基线前进后退出 1 并标 stale（实际 code=' + String(checkStale.code) + '）')
check(checkStale.output.includes('本地基线') && checkStale.output.includes('前进'), 'check-batch 的 stale 原因写清「本地基线前进」')

console.log('[命令层接线：prepare-batch 构建前拒绝]')
const batchNameEarly = 'batch-early-' + Date.now()
const missingEnv = path.join(tmpRoot, 'no-such-env-file.txt')
const missingEnvRun = runScript(
  'scripts/real-machine/commands/prepare-batch.mts',
  ['--batch', batchNameEarly + '-env', '--instance-env-file', missingEnv],
  commandEnv,
)
check(missingEnvRun.code !== 0 && missingEnvRun.output.includes('找不到环境文件'), '坏环境文件在构建前就被拒绝（实际 code=' + String(missingEnvRun.code) + '）')

// HEAD 落后于 main：先让工作树停在 root 提交上，prepare-batch 的基线守卫应在构建前拒绝。
git(['checkout', '-q', '--detach', COMMIT_ROOT])
const behindRun = runScript('scripts/real-machine/commands/prepare-batch.mts', ['--batch', batchNameEarly + '-behind'], commandEnv)
check(behindRun.code !== 0 && behindRun.output.includes('不包含本地'), '工作树 HEAD 落后于 main 时 prepare-batch 在构建前拒绝（实际 code=' + String(behindRun.code) + '）')
check(!fs.existsSync(path.join(workRoot, 'batches', batchNameEarly + '-behind')), '被拒绝的批次不留下空批次目录')
git(['checkout', '-q', 'main'])

if (process.argv.includes('--negative')) {
  // 负例自证：--negative 时故意让一条本应成立的断言不成立，证明这扇门禁真的会红。
  total += 1
  failed = true
  console.log('  FAIL 负例：--negative 故意注入一条失败断言，证明这扇门禁会红')
}

printGateResult('verify-1777-batch-freshness-guards', total, failed ? total : 0)
if (failed) process.exitCode = 1
