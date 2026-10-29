// stop-instance —— 按 instance.json 里的 pid 结束整个实例进程树。
//
// 用法：
//   node --import ./scripts/ts-hook.mts scripts/real-machine/commands/stop-instance.mts --instance <启动目录或instance.json> [--timeout 15000]

import { parseArgs, printJson, runCli } from '../lib/util.mts'
import { stopInstance } from '../lib/launch.mts'

runCli(async () => {
  const args = parseArgs(process.argv.slice(2))
  const target = args.require('instance', '启动目录，或该目录下的 instance.json')
  const result = await stopInstance(target, { timeoutMs: args.get('timeout') ? Number(args.get('timeout')) : undefined })
  printJson(result)
})
