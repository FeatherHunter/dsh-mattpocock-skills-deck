// gitlab-sandbox —— 管 GitLab 沙箱项目的生命周期：create / delete。
//
// 用法：
//   node --import ./scripts/ts-hook.mts scripts/real-machine/commands/gitlab-sandbox.mts
//         create --batch <批次目录> --path <group>/<project> [--description <说明>]
//   node --import ./scripts/ts-hook.mts scripts/real-machine/commands/gitlab-sandbox.mts
//         delete --batch <批次目录> --id <项目 id>
//
// 为什么单独一个命令、为什么不只看 glab 的退出码：
//   - 建项目时本地可能报 unexpected EOF，但服务器已经建好了；所以建完一定要按 URL 编码后的路径读回，
//     读到 id/path_with_namespace/web_url 才算成功，读到就算成功、不重复建。
//   - 删除是延迟删除：DELETE 返回 202 Accepted 之后项目还在，只是多出 marked_for_deletion_at；
//     所以要按 id 再读回这个字段才算完成，不按 404 判、不重复发 DELETE。
//   - 每次建/删的结果都写进 <批次目录>/gitlab-projects.json；删除只认批次清单里记过、且描述带本批次
//     标记「[dsh-sandbox batch=<批次名>]」的项目，避免误删别人的项目。
//
// 回执是一段 JSON（写到 stdout），成功退出码 0；拒绝删除、读回失败等以退出码 1 结束，
// 原因写 stderr，项目 id 会保留在批次清单里。本命令不直接调用网络以外的接口：glab 二进制由
// GLAB_BIN 指定（真机是 glab，门禁里是假 glab），因此可以完全离线验证。

import path from 'node:path'
import { info, parseArgs, printJson, runCli } from '../lib/util.mts'
import { createSandboxProject, deleteSandboxProject } from '../lib/gitlab-projects.mts'

const USAGE = [
  '用法：',
  '  gitlab-sandbox.mts create --batch <批次目录> --path <group>/<project> [--description <说明>]',
  '  gitlab-sandbox.mts delete --batch <批次目录> --id <项目 id>',
  '批次目录与 make-workspace 用同一个：批次清单落在 <批次目录>/gitlab-projects.json。',
].join('\n')

runCli(async () => {
  const args = parseArgs(process.argv.slice(2))
  const action = args.positional[0]
  if (!action) throw new Error('缺少动作（create 或 delete）。' + '\n' + USAGE)

  const batchText = args.get('batch')
  if (!batchText) throw new Error('缺少 --batch：请给批次目录，例如 <工作根>\batches\gitlab-smoke。' + '\n' + USAGE)
  const batchDir = path.resolve(batchText)
  const batchName = path.basename(batchDir)

  if (action === 'create') {
    const projectPath = args.get('path')
    if (!projectPath) throw new Error('gitlab-sandbox create 需要 --path <group>/<project>：例如 --path FeatherHunter/dsh-gl-20261031。')
    const result = await createSandboxProject({
      batchDir,
      batchName,
      projectPath,
      description: args.get('description'),
    })
    if (result.recoveredByReadback) {
      info('本地 repo create 报错（退出码 ' + result.createExitCode + '），但按路径读回成功：' + result.project.pathWithNamespace)
    } else if (result.reused) {
      info('批次清单里已有这个项目，按 id 读回复用：' + result.project.pathWithNamespace + '（id ' + result.project.id + '）')
    }
    printJson(Object.assign({ action: 'create' }, result))
    return
  }

  if (action === 'delete') {
    const idText = args.get('id')
    if (!idText) throw new Error('gitlab-sandbox delete 需要 --id <项目 id>：用 create 回执或批次清单里的 id。')
    const id = Number(idText)
    if (!Number.isInteger(id) || id <= 0) throw new Error('--id 必须是正整数，拿到的是「' + idText + '」。')
    const result = await deleteSandboxProject({ batchDir, batchName, id })
    if (result.alreadyDeleted) info('项目 id ' + id + ' 早已标记删除，只读回确认，没有重复 DELETE。')
    printJson(Object.assign({ action: 'delete' }, result))
    return
  }

  throw new Error('不认识的动作「' + action + '」：只能是 create 或 delete。' + '\n' + USAGE)
})
