// scripts/real-machine/commands/deck-write.mts —— 在隔离环境里直调一次 deck 写工具（#1709）。
//
// 用法（真机与门禁同一套接口）：
//   GLAB_BIN=<glab 可执行文件> node --import ./scripts/ts-hook.mts scripts/real-machine/commands/deck-write.mts \
//     --tool deck_issue_create --args tests/fixtures/real-machine/deck/create.json \
//     --ref FixtureGroup/dsh-deck-demo --workspace <本地工作区> --out <回执文件>
//
// 外部世界只从进程边界进来：glab 走 GLAB_BIN（缺了不回退 PATH 上的 glab），工作区与仓库标识走参数。
// 不读真实 DSH 配置、不碰真实凭据、不访问真实 gitlab.com；后端装配与回执无损检查在
// scripts/real-machine/lib/deck-write.mts 里，本文件只做参数收口、打印与退出码。
//
// 退出码：0 工具回 ok；1 工具回了失败；2 参数或入口不对；3 环境缺失（GLAB_BIN/工作区/仓库标识）；
// 4 装配或执行这条入口时自己出错。stdout 只放回执 JSON，人看的说明一律走 stderr 的 [harness] 行。

import path from 'node:path'
import { info, parseArgs, printJson } from '../lib/util.mts'
import {
  DECK_WRITE_TOOLS,
  EXIT_BAD_INPUT,
  EXIT_ENV_MISSING,
  EXIT_INTERNAL,
  callDeckWriteTool,
  checkWriteEnvironment,
  exitCodeForReceipt,
  exitCodeText,
  readToolArgsFile,
  writeReceiptFile,
} from '../lib/deck-write.mts'

function messageOf(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) return String((error as { message: unknown }).message)
  return String(error)
}

/** 拒绝并退出：把每条原因原样写 stderr，再补一行「退出码几」，stdout 留空（下游据此判断没有回执）。 */
function fail(code: number, lines: string[]): void {
  for (const line of lines) info(line)
  info('命令退出码 ' + code + '（' + exitCodeText(code) + '），这次没有写回执文件。')
  process.exitCode = code
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2))
  const tool = parsed.get('tool') || ''
  if (DECK_WRITE_TOOLS.indexOf(tool) < 0) {
    fail(EXIT_BAD_INPUT, [
      '缺少或认不出参数 --tool：要调哪个 deck 写工具。可直调清单：' + DECK_WRITE_TOOLS.join('、') + '（收到「' + tool + '」）。',
    ])
    return
  }
  const argsFile = parsed.get('args') || ''
  const read = readToolArgsFile(argsFile)
  if (!read.ok) {
    fail(EXIT_BAD_INPUT, [read.problem])
    return
  }
  const refId = parsed.get('ref') || ''
  const workspace = parsed.get('workspace') || ''
  const glabBin = process.env.GLAB_BIN || ''
  const environment = checkWriteEnvironment({ glabBin: glabBin, workspace: workspace, refId: refId })
  if (!environment.ok) {
    fail(EXIT_ENV_MISSING, environment.problems)
    return
  }
  const outFile = path.resolve(parsed.get('out') || 'tool-response.json')
  info('调用 ' + tool + '：工作区 ' + path.resolve(workspace) + '，仓库 ' + refId + '，glab ' + glabBin)
  let receipt: Record<string, unknown>
  try {
    receipt = await callDeckWriteTool({ tool: tool, args: read.args, refId: refId, workspace: workspace, glabBin: glabBin })
  } catch (error) {
    fail(EXIT_INTERNAL, ['装配或执行这条直调入口时出错：' + messageOf(error)])
    return
  }
  try {
    const written = writeReceiptFile(outFile, receipt)
    info('回执写到 ' + written)
  } catch (error) {
    fail(EXIT_INTERNAL, ['回执文件写不进去：' + messageOf(error)])
    return
  }
  printJson(receipt)
  const code = exitCodeForReceipt(receipt)
  if (code !== 0) {
    info('工具回了失败：status=' + String(receipt.status) + '，reason=' + String(receipt.reason) + '，text=' + String(receipt.text))
    process.exitCode = code
    return
  }
  process.exitCode = code
}

main().catch(function (error: unknown): void {
  fail(EXIT_INTERNAL, ['deck-write 命令自己崩了：' + messageOf(error)])
})
