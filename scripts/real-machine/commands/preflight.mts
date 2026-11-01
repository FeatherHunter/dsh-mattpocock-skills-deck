// scripts/real-machine/commands/preflight.mts —— 批次前置巡检：一条命令输出完整环境预检 JSON。
//
// 用法：
//   node --import ./scripts/ts-hook.mts scripts/real-machine/commands/preflight.mts --batch <批次目录>
//
// 必填 --batch；其余参数都有缺省值，正常按批次标准步骤跑的批次直接给 --batch 即可。
// 九项硬检查全部通过时退出码 0；任一硬项失败时退出码非 0，并把失败项 id 与中文名汇总到 stderr。
// stdout 只放一段 JSON（同一段也写进 --out，默认 <批次目录>/preflight.json），批次开始评论直接抄。
//
// 为什么单独做一条命令：规格 #1703 阶段 0 第 5、8 项要求每批开始前一条命令出完整预检、
// 屏幕快照并入其中；门禁与人工都只认命令行进程接口，所以参数解析、落盘、退出码都在这一层。

import fs from 'node:fs'
import path from 'node:path'
import { parseArgs, printJson, runCli } from '../lib/util.mts'
import { hardFailureLine, runPreflight, writePreflightReport } from '../lib/preflight.mts'

/** 把 --project-id 这类可选数字参数读成数字；给了但读不懂时报清楚参数名与实参。 */
function optionalInteger(args: ReturnType<typeof parseArgs>, name: string): number | undefined {
  const text = args.get(name)
  if (text === undefined) return undefined
  const value = Number(text)
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error('--' + name + ' 期望正整数，实际是「' + text + '」')
  }
  return value
}

runCli(async () => {
  const args = parseArgs(process.argv.slice(2))
  const batchText = args.require('batch', '批次目录，例如 <验证工作根>\\batches\\b2-20261031')
  const batchDir = path.resolve(batchText)
  const report = runPreflight({
    batchDir,
    candidatePath: args.get('candidate') ? path.resolve(args.get('candidate') as string) : undefined,
    home: args.get('home') ? path.resolve(args.get('home') as string) : undefined,
    profile: args.get('profile'),
    workspace: args.get('workspace') ? path.resolve(args.get('workspace') as string) : undefined,
    projectId: optionalInteger(args, 'project-id'),
    minTickets: optionalInteger(args, 'min-tickets'),
    logDir: args.get('log-dir') ? path.resolve(args.get('log-dir') as string) : undefined,
    nodeMin: args.get('node-min'),
    screenCommand: args.get('screen-cmd') || process.env.DSH_PREFLIGHT_SCREEN_CMD || 'powershell',
    outPath: args.get('out') ? path.resolve(args.get('out') as string) : undefined,
  })
  const bytes = writePreflightReport(report)
  printJson(report)
  const failureLine = hardFailureLine(report)
  if (failureLine) {
    process.stderr.write(failureLine + '\n')
    process.exitCode = 1
  } else if (process.env.HARNESS_DEBUG === '1') {
    // 预览与调试时给自己留一句落盘位置；正常跑不往 stderr 写任何东西，避免污染「stderr 只报失败」的约定。
    process.stderr.write('[preflight] 回执已写入 ' + report.outPath + '（' + String(bytes) + ' 字节）\n')
  }
})
