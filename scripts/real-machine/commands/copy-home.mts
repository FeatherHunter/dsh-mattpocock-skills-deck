// copy-home —— 把真实 web profile（或 #1631 的 home-template）安静复制成批次专属 DSH_HOME。
//
// 用法：
//   node --import ./scripts/ts-hook.mts scripts/real-machine/commands/copy-home.mts --home <批次home>
//         [--template <home-template目录>] [--source <真实DSH_HOME>] [--profile web] [--force]
//
// 输出：一段 JSON，字段见 CopyHomeResult（home、profileDir、文件数与字节数、耗时）。
// 不打印文件名、不读文件内容，因而不会把任何凭证带出来。

import { parseArgs, printJson, runCli } from '../lib/util.mts'
import { copyWebProfile } from '../lib/home.mts'
import { realDshHome } from '../lib/paths.mts'

runCli(async () => {
  const args = parseArgs(process.argv.slice(2))
  const home = args.require('home', '批次专属 home 目录，例如 <工作根>\\batch-a\\home')
  const template = args.get('template')
  const source = template ? undefined : args.get('source') || realDshHome()
  const result = copyWebProfile({
    home,
    template,
    sourceHome: source,
    profile: args.get('profile') || 'web',
    force: args.has('force'),
  })
  printJson({ ...result, sourceHome: source || null, template: template || null })
})
