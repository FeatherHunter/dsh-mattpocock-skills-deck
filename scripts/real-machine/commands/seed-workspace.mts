// seed-workspace —— 往批次 home 的 storages/workspace.json 里种工作区，让实例启动后直接看到自己的批次工作区。
//
// 用法：
//   node --import ./scripts/ts-hook.mts scripts/real-machine/commands/seed-workspace.mts
//         --home <批次home> --workspace <目录> [--workspace <目录> ...] [--title <显示名> ...] [--default <目录>]
//
// --title 可以按顺序给多个；不给就用目录名。--default 不给时默认第一个工作区。

import { parseArgs, printJson, runCli } from '../lib/util.mts'
import { seedWorkspaceRegistry } from '../lib/home.mts'

runCli(async () => {
  const args = parseArgs(process.argv.slice(2))
  const home = args.require('home', '批次 home 目录')
  const paths = args.getAll('workspace')
  if (paths.length === 0) throw new Error('至少给一个 --workspace <工作区目录>。')
  const titles = args.getAll('title')
  const workspaces = paths.map((workspacePath, index) => ({ path: workspacePath, title: titles[index] }))
  const result = seedWorkspaceRegistry(home, workspaces, { defaultPath: args.get('default') })
  printJson(result)
})
