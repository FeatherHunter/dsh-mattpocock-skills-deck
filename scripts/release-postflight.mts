// scripts/release-postflight.mts —— 发布之后的收尾：给本版真机验证清单票补一条发布记录，并建下一版的占位清单票。
//
// 为什么要在发布之后自动做：清单票的下一版不能凭空冒出来。发布成功就是「这一版结束了、下一版开始了」这个
// 必然事件；在这里建占位票，下一版的场景从第一天就有地方登记，不会等到快发布时才发现没建票。
// 规则正文见 docs/agents/real-machine-verification.md 第 5 节。
//
// 本脚本由 scripts/publish-token.ps1 在发布成功之后调用（wizard-release.sh 的发布路径在 Stage 4 之后由人
// 按 Runbook 走，本脚本也可以在发布后手动补跑一次）。它失败不影响发布结果：调用方只记录一行 POST-FAIL，
// 下一次发布前检查发现缺票照样会拦住。
//
// 用法：node scripts/release-postflight.mts [--version <版本号>]
//   --version  刚发布的版本号，可带 v。缺省读仓根 package.json 的 version。
// 退出码：0=收尾完成（或没有可补的票，只提示）；1=有一步失败（调用方记录，不改发布结论）。

import {
  ReleaseEnvError,
  extractChecklistTemplateBody,
  fillChecklistTemplate,
  ghText,
  isExactChecklistTitle,
  isPlaceholderTitle,
  listChecklistIssues,
  localIso,
  normalizeTitle,
  PLACEHOLDER_WORD,
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
}

function parseArgs(argv: string[]): Options {
  const options: Options = { version: '' }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--version') {
      const value = argv[index + 1]
      if (!value) {
        console.error('POSTFLIGHT-FAIL --version 后面缺版本号')
        process.exit(1)
      }
      options.version = value
      index += 1
    } else if (arg === '--help' || arg === '-h') {
      console.log('用法：node scripts/release-postflight.mts [--version <版本号>]')
      process.exit(0)
    } else {
      console.error('POSTFLIGHT-FAIL 不认识的参数：' + arg)
      process.exit(1)
    }
  }
  return options
}

const options = parseArgs(process.argv.slice(2))
let failed = false

function fail(message: string): void {
  failed = true
  console.error('POSTFLIGHT-FAIL ' + message)
}

function ok(message: string): void {
  console.log('POSTFLIGHT-OK ' + message)
}

function info(message: string): void {
  console.log('POSTFLIGHT-INFO ' + message)
}

/** 从 gh issue create 的输出里取票号：成功时它只打印一行票面网址。 */
function issueNumberFromUrl(text: string): number {
  const matched = /\/issues\/(\d+)/.exec(String(text || ''))
  return matched ? Number(matched[1]) : 0
}

function createIssue(title: string, body: string): Issue | null {
  let output = ''
  try {
    output = ghText(['issue', 'create', '--title', title, '--body', body])
  } catch (error) {
    fail('建下一版占位清单票失败：' + (error instanceof ReleaseEnvError ? error.message : String(error)))
    return null
  }
  const number = issueNumberFromUrl(output)
  const url = String(output || '').trim().split(/\s+/).pop() || ''
  if (!number) {
    fail('建票命令返回了看不懂的输出，票可能已经建出来，请人工确认：' + String(output || '').trim())
    return null
  }
  ok('建好下一版占位清单票 #' + number + '「' + title + '」' + (url ? ' ' + url : ''))
  return { number, title, state: 'OPEN', url }
}

function main(): void {
  let version = ''
  try {
    version = options.version ? options.version : readPackageVersion()
  } catch (error) {
    fail(error instanceof ReleaseEnvError ? error.message : String(error))
    process.exit(1)
  }
  const versionNumber = String(version).trim().replace(/^[vV]/, '')
  if (!versionNumber) {
    fail('版本号为空：用 --version 指定，或确认 package.json 里有 version。')
    process.exit(1)
  }
  info('刚发布的版本：' + versionNumber)

  let issues: Issue[] = []
  try {
    issues = listChecklistIssues()
  } catch (error) {
    fail(error instanceof ReleaseEnvError ? error.message : String(error))
    process.exit(1)
  }

  const exact = issues.filter((issue) => isExactChecklistTitle(issue.title, versionNumber))
  const placeholders = issues.filter((issue) => isPlaceholderTitle(issue.title))

  let nextIssue: Issue | null = placeholders.length > 0 ? placeholders[0] : null
  if (nextIssue) {
    info('下一版占位清单票已经存在：#' + nextIssue.number + '「' + normalizeTitle(nextIssue.title) + '」')
  } else {
    const placeholderTitle = TITLE_PREFIX + ' ' + PLACEHOLDER_WORD + '（自 v' + versionNumber + ' 之后）'
    let body = ''
    try {
      body = fillChecklistTemplate(extractChecklistTemplateBody(), '待定（发布准备时确定并改标题）', versionNumber)
    } catch (error) {
      fail('读清单票正文模板失败：' + (error instanceof ReleaseEnvError ? error.message : String(error)))
    }
    if (body) {
      nextIssue = createIssue(placeholderTitle, body)
    }
  }

  if (exact.length === 0) {
    fail('没找到标题为「' + TITLE_PREFIX + ' ' + versionNumber + '」的清单票，这次发布没有清单票可补记录。下一版占位票已经处理完。')
    process.exit(failed ? 1 : 0)
  }
  if (exact.length > 1) {
    fail(
      '标题为「' + TITLE_PREFIX + ' ' + versionNumber + '」的清单票有 ' + exact.length + ' 张，无法确定补哪一张：' +
        exact.map((issue) => '#' + issue.number).join('、') + '。',
    )
    process.exit(1)
  }

  const issue = exact[0]
  const lines = [
    '## 发布记录',
    '',
    '- 发布版本：v' + versionNumber,
    '- 发布时间：' + localIso(new Date()),
    '- 发布说明：见 CHANGELOG.md 的「v' + versionNumber + '」一节',
    '- 下一版清单票：' + (nextIssue ? '#' + nextIssue.number : '（这次没建出来，发布前检查会拦下一版）'),
    '',
    '本版已发布。安装由用户侧完成：市场升级、软件内升级，或自己执行安装命令。',
    '本票继续保持关闭；下一版的真机验证场景请登记到下一版清单票。',
  ]
  try {
    ghText(['issue', 'comment', String(issue.number), '--body', lines.join('\n')])
  } catch (error) {
    fail('给清单票 #' + issue.number + ' 补发布记录失败：' + (error instanceof ReleaseEnvError ? error.message : String(error)))
    process.exit(1)
  }
  ok('已给清单票 #' + issue.number + '「' + normalizeTitle(issue.title) + '」补发布记录')
  process.exit(failed ? 1 : 0)
}

main()
