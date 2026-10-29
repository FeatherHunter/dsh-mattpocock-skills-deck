// restore-settings —— 用备份文件恢复真实用户设置，并核对恢复后的哈希确实等于备份时的哈希。
//
// 用法：
//   node --import ./scripts/ts-hook.mts scripts/real-machine/commands/restore-settings.mts --backup <备份目录>
//         [--real-home <真实DSH_HOME>] [--force]
//
// 输出：是否恢复、恢复前后的哈希、是否与备份一致。哈希对不上时命令以非 0 退出，不静默放过。
// 注意：真实设置文件可能被用户同时使用 DSH 改写；不确认现状时先用 backup-settings 再比对，
// 不要无条件覆盖（--force 只跳过「备份文件不存在」的保护，不跳过哈希核对）。

import { parseArgs, printJson, runCli } from '../lib/util.mts'
import { restoreRealSettings } from '../lib/isolation.mts'

runCli(async () => {
  const args = parseArgs(process.argv.slice(2))
  const backupDir = args.require('backup', 'backup-settings 生成的备份目录')
  const result = restoreRealSettings({ backupDir, realHome: args.get('real-home'), force: args.has('force') })
  printJson(result)
})
