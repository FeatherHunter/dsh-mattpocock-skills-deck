// make-workspace —— 生成验证用的工作区：github / cold / markdown / gitlab / ab 五种形状。
//
// 用法：
//   node --import ./scripts/ts-hook.mts scripts/real-machine/commands/make-workspace.mts
//         --batch <批次目录> --kind <github|cold|markdown|gitlab|ab> [--name <目录名>]
//         [--source-repo <仓库>] [--commit <提交>] [--layout single|multi] [--force] [--git]
//         [--project <group>/<project>]（kind=gitlab 时必填）
//
// 生成结果打印成 JSON，同时写进 <批次目录>/workspaces.json。
//   github   ：源仓库冻结提交的 git worktree，加 docs/agents/workspace.yaml（backendId=github）
//   cold     ：空目录（加 --git 时是一个只有初始提交的本地仓库），没有任何绑定，验证离线冷启动
//   markdown ：.scratch/<长名字>/map.md 加 issues/ 子票，绑定 backendId=markdown（默认生成两套 effort）
//   gitlab   ：本地空仓库 + origin 指向沙箱项目 + 绑定 backendId=gitlab（不 clone、不联网，项目用 gitlab-sandbox create 建）
//   ab       ：1612 用的工作区 A 与 B，形状相同、内容不同，各自绑定 markdown

import path from 'node:path'
import { ensureDir, parseArgs, printJson, runCli } from '../lib/util.mts'
import {
  createAbWorkspaces,
  createColdWorkspace,
  createGithubWorkspace,
  createGitlabWorkspace,
  createMarkdownWorkspace,
  writeWorkspaceManifest,
} from '../lib/workspaces.mts'

runCli(async () => {
  const args = parseArgs(process.argv.slice(2))
  const batch = path.resolve(args.require('batch', '批次目录，例如 <工作根>\\batches\\smoke'))
  const kind = args.require('kind', 'github / cold / markdown / gitlab / ab 之一')
  ensureDir(batch)
  const layoutText = args.get('layout')
  if (layoutText && layoutText !== 'single' && layoutText !== 'multi') throw new Error('--layout 只能是 single 或 multi。')
  const layout = layoutText as 'single' | 'multi' | undefined
  const force = args.has('force')
  const name = args.get('name')

  if (kind === 'ab') {
    const [a, b] = await createAbWorkspaces({ baseDir: path.join(batch, 'workspaces'), force })
    const manifestPath = writeWorkspaceManifest(batch, [a, b])
    printJson({ kind, workspaces: [a, b], manifestPath })
    return
  }

  const dir = path.join(batch, 'workspaces', name || kind + '-' + Date.now())
  let workspace
  if (kind === 'github') {
    workspace = await createGithubWorkspace({
      dir,
      sourceRepo: args.get('source-repo'),
      commit: args.get('commit'),
      layout: layout || 'multi',
      force,
    })
  } else if (kind === 'cold') {
    workspace = createColdWorkspace({ dir, git: args.has('git'), force })
  } else if (kind === 'markdown') {
    workspace = await createMarkdownWorkspace({ dir, layout: layout || 'multi', force })
  } else if (kind === 'gitlab') {
    const project = args.get('project')
    if (!project) {
      throw new Error(
        '--kind gitlab 需要 --project <group>/<project>：例如 --project FeatherHunter/dsh-gl-20261031，' +
          '指向 gitlab-sandbox create 建出来的沙箱项目。',
      )
    }
    workspace = await createGitlabWorkspace({ dir, project, force })
  } else {
    throw new Error('不认识的 --kind「' + kind + '」：只能是 github、cold、markdown、gitlab、ab。')
  }
  const manifestPath = writeWorkspaceManifest(batch, [workspace])
  printJson({ kind, workspaces: [workspace], manifestPath })
})
