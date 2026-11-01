// check-batch —— 批次收尾：比较当前 HEAD 与开批时的基线，判断这一批还能不能用于发布收口。
//
// 为什么要有这条命令：代码冻结是规则的一部分。批次开始后如果有人继续往主分支提交，
// 这一批验过的字节就不再代表最新代码；不标记出来，后面很容易把旧批次的 PASS 当成当前代码的 PASS。
// 两条判据都要看（#1777）：
//   1. 当前 HEAD 是否还是开批时的 HEAD；
//   2. 开批时的本地基线（默认 main）tip 是否还是同一个——在集成分支上开批时 HEAD 可能一直不动，
//      但 main 已经前进了，这一批同样不能用于发布收口。
// 这里只改 batch.json 的状态与结束时间，不删任何原件（候选、证据、实例目录都保留）。
//
// 用法：
//   node --import ./scripts/ts-hook.mts scripts/real-machine/commands/check-batch.mts --batch <批次名或批次目录>
//
// 输出：批次状态、开始/结束 HEAD、开批基线、候选提交与一句结论。
// HEAD 或基线前进时会把 status 改成 stale 并以退出码 1 结束（提醒调用方这条批次不能用于发布收口）；
// 都没前进时保持 active，退出码 0。旧批次没有 base 记录时也判 stale：无法证明它验的是最新代码。

import { batchBaseLine, judgeBatchFreshness, readBatch, writeBatch } from '../lib/batch.mts'
import { gitState, gitTipAt } from '../lib/candidate.mts'
import { repo, resolveBatchPath } from '../lib/paths.mts'
import { nowIso, parseArgs, printJson, runCli } from '../lib/util.mts'

runCli(async () => {
  const args = parseArgs(process.argv.slice(2))
  const targetDir = resolveBatchPath(args.require('batch', '批次名或批次目录'))
  const record = readBatch(targetDir)
  const git = gitState(repo())
  const now = nowIso()
  // 收尾时重读本地基线：读不到不是「没前进」，而是「无法证明没前进」，因此传 null 并带上原因，
  // 让判据把这一批标成 stale，而不是悄悄放过。
  let currentBaseTip: string | null = null
  let baseReadError = ''
  if (record.base) {
    try {
      currentBaseTip = gitTipAt(repo(), record.base.ref)
    } catch (error: any) {
      baseReadError = String(error && error.message ? error.message : error)
    }
  }
  const verdict = judgeBatchFreshness({ batch: record, currentHead: git.commit, now, currentBaseTip, baseReadError })
  const saved = writeBatch(
    targetDir,
    { ...record, status: verdict.status, endHead: verdict.endHead, endCheckedAt: verdict.endCheckedAt },
    now,
  )
  printJson({
    ok: verdict.status === 'active',
    batchName: saved.batchName,
    batchDir: saved.batchDir,
    status: saved.status,
    startHead: saved.startHead,
    endHead: saved.endHead,
    currentBranch: git.branch,
    base: saved.base,
    baseLine: batchBaseLine(saved.base),
    candidate: saved.candidate,
    message: verdict.message,
    problems: verdict.problems,
  })
  if (verdict.status === 'stale') process.exitCode = 1
})
