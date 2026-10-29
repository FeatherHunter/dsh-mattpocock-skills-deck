// backup-settings —— 把真实用户设置文件备份到指定目录，记下哈希，供事后核对没有被验证过程改动。
//
// 用法：
//   node --import ./scripts/ts-hook.mts scripts/real-machine/commands/backup-settings.mts --out <备份目录>
//         [--real-home <真实DSH_HOME>]
//
// 输出：备份文件路径、原文件 SHA256 与字节数、备份前是否存在。设置文件不存在也是正常结果（existed=false）。
// 什么时候用：需要临时改真实设置做对照、或者担心宿主机被验证过程写脏时，先备份再动手。
// 通常用不到它——isolation-probe 已经能证明隔离探针没有写真实设置；这条命令是更重的那条保险。

import { parseArgs, printJson, runCli } from '../lib/util.mts'
import { backupRealSettings } from '../lib/isolation.mts'

runCli(async () => {
  const args = parseArgs(process.argv.slice(2))
  const outDir = args.require('out', '备份目录，例如 <工作根>\\batches\\<批次>\\backup')
  const result = backupRealSettings({ outDir, realHome: args.get('real-home') })
  printJson(result)
})
