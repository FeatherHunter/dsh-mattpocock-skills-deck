// start-instance —— 在一个独立启动目录里起一个 DSH web 实例，把 pid、端口、访问地址、日志目录写成 instance.json。
//
// 用法：
//   node --import ./scripts/ts-hook.mts scripts/real-machine/commands/start-instance.mts
//         --home <批次home> --dir <独立启动目录> [--userprofile <目录>] [--profile web]
//         [--port 0] [--timeout 120000] [--exe <DSH程序>] [--cli <cli.js>]
//         [--instance-env-file <环境文件>] [--launch-plan]
//
// 环境文件：一行一个 KEY=VALUE，只认 GLAB_CONFIG_DIR、PATH、GITLAB_TOKEN；前两个必需，token 可选。
// 值只合并进实例进程的环境，不写命令行、不写日志、不进 instance.json；命令只传文件路径。
// 参数名是 --instance-env-file 而不是 --env-file：Node 自己有 --env-file 选项，会把后面的值当 Node
// 自己的环境文件读，命令根本收不到这个参数（实测会以「not found」退出，退出码 9）。
//
// --launch-plan：只打印这次会怎么启动（启动命令、启动目录、环境变量名），不检查程序能不能起、
// 不写目录、不起进程。计划里没有变量值，所以可以把计划贴进评论或证据。
//
// 输出：instance.json 的同一份内容（stdout 只放 JSON）。实例在后台运行，命令退出不会带走它；
// 停掉用 stop-instance。

import { parseArgs, printJson, runCli, formatMs } from '../lib/util.mts'
import { describeLaunch, startInstance, type StartOptions } from '../lib/launch.mts'

runCli(async () => {
  const args = parseArgs(process.argv.slice(2))
  const home = args.require('home', '先跑 copy-home 生成的批次 home')
  const dir = args.require('dir', '独立启动目录，例如 <工作根>\\batch-a\\run-a1')
  const portText = args.get('port')
  const envFile = args.has('instance-env-file') ? args.require('instance-env-file', '写有 KEY=VALUE 的环境文件路径') : undefined
  const options: StartOptions = {
    home,
    dir,
    userprofile: args.get('userprofile'),
    profile: args.get('profile') || 'web',
    port: portText ? Number(portText) : 0,
    timeoutMs: args.get('timeout') ? Number(args.get('timeout')) : undefined,
    exe: args.get('exe'),
    cli: args.get('cli'),
  }
  if (envFile !== undefined) options.envFile = envFile

  if (args.has('launch-plan')) {
    // 计划模式只打印、不落盘：这是规格里「起进程的命令要有不出真实副作用的计划模式」那一条。
    printJson(describeLaunch(options))
    return
  }

  const instance = await startInstance(options)
  printJson({ ...instance, readyText: formatMs(instance.readyMs) })
})
