// isolation-probe —— 实测 USERPROFILE 重定向能不能把插件设置文件隔离到临时 home，并给出结论与证据。
//
// 用法：
//   node --import ./scripts/ts-hook.mts scripts/real-machine/commands/isolation-probe.mts
//         --batch <批次目录> [--real-home <真实DSH_HOME>]
//
// 结论 ok=true：子进程 os.homedir() 跟着 USERPROFILE 走，临时 home 里能写标记，真实设置文件哈希不变。
// 结论 ok=false：额外返回 fallback 步骤（先备份、全局锁、验后按哈希恢复），每条都带可直接跑的命令。

import path from 'node:path'
import { ensureDir, parseArgs, printJson, repoRoot, runCli } from '../lib/util.mts'
import { isolationFallbackPlan, probeSettingsIsolation, realSettingsFingerprint } from '../lib/isolation.mts'

runCli(async () => {
  const args = parseArgs(process.argv.slice(2))
  const batch = path.resolve(args.require('batch', '批次目录'))
  ensureDir(batch)
  const realHome = args.get('real-home')
  const fingerprintBefore = realSettingsFingerprint(realHome)
  const result = await probeSettingsIsolation({ batchDir: batch, realHome })
  const fingerprintAfter = realSettingsFingerprint(realHome)
  const payload: Record<string, any> = {
    ...result,
    fingerprintBefore,
    fingerprintAfter,
    fingerprintUnchanged: fingerprintBefore.sha256 === fingerprintAfter.sha256 && fingerprintBefore.bytes === fingerprintAfter.bytes,
  }
  if (!result.ok) payload.fallback = isolationFallbackPlan({ batchDir: batch, realHome, repoRoot: repoRoot() })
  printJson(payload)
  if (!result.ok) process.exitCode = 1
})
