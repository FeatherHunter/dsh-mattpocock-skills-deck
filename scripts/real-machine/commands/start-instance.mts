// start-instance —— 在一个独立启动目录里起一个 DSH web 实例，把 pid、端口、访问地址、日志目录写成 instance.json。
//
// 用法：
//   node --import ./scripts/ts-hook.mts scripts/real-machine/commands/start-instance.mts
//         --home <批次home> --dir <独立启动目录> [--userprofile <目录>] [--profile web]
//         [--port 0] [--timeout 120000] [--exe <DSH程序>] [--cli <cli.js>]
//
// 输出：instance.json 的同一份内容（stdout 只放 JSON）。实例在后台运行，命令退出不会带走它；
// 停掉用 stop-instance。

import { parseArgs, printJson, runCli, formatMs } from '../lib/util.mts'
import { startInstance } from '../lib/launch.mts'

runCli(async () => {
  const args = parseArgs(process.argv.slice(2))
  const home = args.require('home', '先跑 copy-home 生成的批次 home')
  const dir = args.require('dir', '独立启动目录，例如 <工作根>\\batch-a\\run-a1')
  const portText = args.get('port')
  const instance = await startInstance({
    home,
    dir,
    userprofile: args.get('userprofile'),
    profile: args.get('profile') || 'web',
    port: portText ? Number(portText) : 0,
    timeoutMs: args.get('timeout') ? Number(args.get('timeout')) : undefined,
    exe: args.get('exe'),
    cli: args.get('cli'),
  })
  printJson({ ...instance, readyText: formatMs(instance.readyMs) })
})
