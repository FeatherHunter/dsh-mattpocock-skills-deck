// seed-gitlab.mts —— 命令行入口：把一批真机验证用的种子票幂等地种进一个 GitLab 沙箱项目。
//
// 用法（工作根 = DSH_VERIFY_WORK_ROOT 或仓库内 .scratch/verify-run）：
//   node --import ./scripts/ts-hook.mts scripts/real-machine/commands/seed-gitlab.mts \
//     --batch <工作根>/batches/b2 --project <群组>/<项目> \
//     [--ticket-count 101] [--closed 5] [--maps 2] [--children 5] [--blocking 8] [--unlock-readonly]
//
// 目标项目必须已经存在（用 gitlab-sandbox.mts 的 create 动作，或真机 B0 批次建好）；本命令只负责种票与关系。
// 成功时 stdout 打一份 JSON 回执（ok/mode/manifestPath/project/spec/stats/created/reused/errors），退出码 0；
// 部分失败时回执照打、退出码 1，manifest 与 errors 可读，重跑只补缺项。票池建好后 manifest.mode=read-only，
// 之后要补种（远端少了票或被改坏）必须显式加 --unlock-readonly。

import { parseArgs, printJson, runCli } from '../lib/util.mts'
import type { SeedProvidedCounts } from '../lib/seed-gitlab.mts'
import { runSeed } from '../lib/seed-gitlab.mts'

const USAGE = [
  '用法：seed-gitlab.mts --batch <批次目录> --project <群组>/<项目> [选项]',
  '',
  '  --batch <目录>       批次目录，种子清单（gitlab-seed.json）写在这里；不存在会自动建。',
  '  --project <路径>     GitLab 项目路径，例如 seed-group/seed-pool。项目必须已经存在。',
  '  --ticket-count <n>   票总数，默认 101（包含地图与子票）。同一个批次目录只按第一次的规模补种。',
  '  --closed <n>         其中已关闭的普通票数，默认 5。',
  '  --maps <n>           地图数，默认 2。',
  '  --children <n>       地图下的子票数，默认 5。',
  '  --blocking <n>       原生阻塞关系对数，默认 8（免费档通常拿不到原生边，会自动回落成正文成对两行）。',
  '  --unlock-readonly    票池已标记只读、但读回发现缺失时，显式允许补种（补完会恢复只读标记）。',
  '',
  '退出码：0=完整成功（票池已标记只读）；1=有对象没建成或只读池拒绝写入，回执与 manifest 里能看到是哪几个。',
].join('\n')

function intFlag(args: ReturnType<typeof parseArgs>, name: string, fallback: number, min: number): number {
  const raw = args.get(name)
  if (raw === undefined) return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < min) {
    throw new Error('--' + name + ' 必须是大于等于 ' + String(min) + ' 的整数，拿到的是「' + raw + '」。\n' + USAGE)
  }
  return value
}

runCli(async () => {
  const args = parseArgs(process.argv.slice(2))
  const action = args.positional[0]
  if (action !== undefined && action !== 'run') {
    throw new Error('不认识的动作「' + action + '」：本命令只有 run 动作（也可以不写动作）。\n' + USAGE)
  }
  const batchDir = args.require('batch', '批次目录，例如 <工作根>/batches/b2')
  const projectPath = args.require('project', '项目路径，例如 seed-group/seed-pool')
  if (!/^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)+$/.test(projectPath)) {
    throw new Error('--project 要写成「群组/项目」的形式（可以带多级群组），拿到的是「' + projectPath + '」。')
  }
  const ticketCount = intFlag(args, 'ticket-count', 101, 1)
  const closedCount = intFlag(args, 'closed', 5, 0)
  const mapCount = intFlag(args, 'maps', 2, 0)
  const childrenCount = intFlag(args, 'children', 5, 0)
  const blockingPairs = intFlag(args, 'blocking', 8, 0)
  const provided: SeedProvidedCounts = {}
  if (args.has('ticket-count')) provided.ticketCount = ticketCount
  if (args.has('closed')) provided.closedCount = closedCount
  if (args.has('maps')) provided.mapCount = mapCount
  if (args.has('children')) provided.childrenCount = childrenCount
  if (args.has('blocking')) provided.blockingPairs = blockingPairs

  const result = await runSeed({
    batchDir,
    projectPath,
    ticketCount,
    closedCount,
    mapCount,
    childrenCount,
    blockingPairs,
    unlockReadonly: args.has('unlock-readonly'),
    provided,
  })
  printJson(result)
  if (!result.ok) process.exitCode = 1
})
