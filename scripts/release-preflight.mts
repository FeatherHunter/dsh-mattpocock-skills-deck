// scripts/release-preflight.mts —— 发布前检查：本版真机验证清单票恰好一张、且已关闭。
//
// 为什么要有这一步：来源票允许在没有真机验证的情况下先关闭，验证是攒到「版本真机验证清单票」里统一做的。
// 如果等到发布之后才发现清单票没建、或者还开着一堆待验证场景，这一版就已经发出去了，验证永远补不回来。
// 规则正文见 docs/agents/real-machine-verification.md 第 4 节；本脚本只做那两条机器检查：
//   一、标题「[真机验证] <本版版本号>」的票恰好一张；
//   二、那张票已经关闭（关闭条件由人按票面核对，脚本不看关闭评论里的计数）。
//
// 两条发布路径都在真正发布之前调用本脚本：
//   - scripts/publish-token.ps1（token 无人值守路径）
//   - scripts/wizard-release.sh（只扫码向导：Stage 3 的第五步）
// DryRun / dry-run 时传 --soft，只提示不阻断——演练不该被票务状态卡住。
//
// 用法：node scripts/release-preflight.mts [--version <版本号>] [--soft]
//   --version  本版版本号，可带 v。缺省读仓根 package.json 的 version。
//   --soft     只提示不阻断：结论照常逐行打印，退出码恒为 0。
// 退出码：0=通过（或 --soft 下不阻断）；1=清单票不满足发布条件；2=环境问题（gh 不可用等）。
//
// 输出行首标记：PREFLIGHT-OK / PREFLIGHT-FAIL / PREFLIGHT-SOFT / PREFLIGHT-INFO，日志里按标记搜索即可。

import {
  ReleaseEnvError,
  isExactChecklistTitle,
  isPlaceholderTitle,
  listChecklistIssues,
  normalizeTitle,
  readPackageVersion,
  TITLE_PREFIX,
} from './lib/release-checklist.mts'

type Issue = {
  number: number
  title: string
  state: string
  url: string
}

type Options = {
  version: string
  soft: boolean
}

function parseArgs(argv: string[]): Options {
  const options: Options = { version: '', soft: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--version') {
      const value = argv[index + 1]
      if (!value) {
        console.error('PREFLIGHT-FAIL --version 后面缺版本号')
        process.exit(2)
      }
      options.version = value
      index += 1
    } else if (arg === '--soft') {
      options.soft = true
    } else if (arg === '--help' || arg === '-h') {
      console.log('用法：node scripts/release-preflight.mts [--version <版本号>] [--soft]')
      process.exit(0)
    } else {
      console.error('PREFLIGHT-FAIL 不认识的参数：' + arg)
      process.exit(2)
    }
  }
  return options
}

const options = parseArgs(process.argv.slice(2))

/** 结论行。soft 模式下最后一句明确说「不阻断」，日志里不会把提示当成阻断。 */
function fail(message: string, exitCode: number): never {
  const line = 'PREFLIGHT-FAIL ' + message
  if (options.soft) {
    console.log('PREFLIGHT-SOFT 不阻断发布（演练模式）：' + message)
    process.exit(0)
  }
  console.error(line)
  process.exit(exitCode)
}

function ok(message: string): void {
  console.log('PREFLIGHT-OK ' + message)
}

function info(message: string): void {
  console.log('PREFLIGHT-INFO ' + message)
}

function main(): void {
  let version = ''
  try {
    version = options.version ? options.version : readPackageVersion()
  } catch (error) {
    fail(error instanceof ReleaseEnvError ? error.message : String(error), 2)
  }
  const versionNumber = String(version).trim().replace(/^[vV]/, '')
  if (!versionNumber) {
    fail('版本号为空：用 --version 指定，或确认 package.json 里有 version。', 2)
  }
  const targetTitle = TITLE_PREFIX + ' ' + versionNumber
  info('本版：' + versionNumber + '；要找的清单票标题：「' + targetTitle + '」')

  let issues: Issue[] = []
  try {
    issues = listChecklistIssues()
  } catch (error) {
    fail(error instanceof ReleaseEnvError ? error.message : String(error), 2)
  }

  const exact = issues.filter((issue) => isExactChecklistTitle(issue.title, versionNumber))
  const placeholders = issues.filter((issue) => isPlaceholderTitle(issue.title))

  if (exact.length === 0) {
    if (placeholders.length > 0) {
      const placeholder = placeholders[0]
      fail(
        '没有标题为「' + targetTitle + '」的清单票，但有一张占位票 #' + placeholder.number +
          '「' + normalizeTitle(placeholder.title) + '」。发布准备时版本号已经定了：把占位票的标题改成「' +
          targetTitle + '」，再跑本检查。',
        1,
      )
    }
    fail(
      '没有标题为「' + targetTitle + '」的清单票。发布前先按 docs/agents/checklist-issue-template.md 建一张，' +
        '把本版所有需要真机验证的场景登记进去，验完关票，再发布。',
      1,
    )
  }

  if (exact.length > 1) {
    const names = exact.map((issue) => '#' + issue.number + '「' + normalizeTitle(issue.title) + '」').join('、')
    fail('标题为「' + targetTitle + '」的清单票有 ' + exact.length + ' 张：' + names + '。合并成一张再发布。', 1)
  }

  const issue = exact[0]
  const state = String(issue.state || '').toUpperCase()
  if (state !== 'CLOSED') {
    fail(
      '清单票 #' + issue.number + '「' + normalizeTitle(issue.title) + '」还是 ' + (state || '未知状态') +
        '。等票面场景全部「通过」或「豁免被接受」后关闭它，再发布。' +
        (issue.url ? ' ' + issue.url : ''),
      1,
    )
  }

  ok('清单票 #' + issue.number + '「' + normalizeTitle(issue.title) + '」已关闭' + (issue.url ? ' ' + issue.url : ''))
  info('关闭评论里的通过/失败/豁免计数只供人读，脚本不校验计数。')
}

main()
