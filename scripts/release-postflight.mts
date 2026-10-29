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
// 用法：node scripts/release-postflight.mts [--version <版本号>] [--evidence <发布证据文件>]
//   --version   刚发布的版本号，可带 v。缺省读仓根 package.json 的 version。
//   --evidence  发布脚本产出的发布证据 JSON（#1648）：每个实际发布包的逐文件清单统计（文件数、字节数、
//               清单指纹）与最终 dist-tag 指向。给了就把它们写进发布记录评论；不给时保留旧行为并打一行
//               POSTFLIGHT-INFO（五仓同步的 token 协议别处没有发布自证脚本，不能因此报错）。
//               证据文件的形状：
//                 { "version": "1.2.3", "packages": [{ "name": "...", "version": "...", "fileCount": 539,
//                   "totalBytes": 5481828, "digest": "64 位 sha256" }], "tags": { "latest": "...", "beta": "..." } }
// 退出码：0=收尾完成（或没有可补的票，只提示）；1=有一步失败（调用方记录，不改发布结论）。

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
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
  evidencePath: string
}

/** 一个实际发布包的清单统计：与 scripts/release-integrity.mts 写出的清单文件同名同义。 */
export type PublishEvidencePackage = {
  name: string
  version: string
  fileCount: number
  totalBytes: number
  digest: string
}

/** 发布脚本交给本脚本的发布证据：发出去的是什么字节、最终 tag 指向哪里。 */
export type PublishEvidence = {
  version: string
  packages: PublishEvidencePackage[]
  tags: { latest?: string; beta?: string }
}

export type PublishRecordInput = {
  version: string
  nextIssueNumber: number | null
  evidence: PublishEvidence | null
  now: Date
}

function parseArgs(argv: string[]): Options | null {
  const options: Options = { version: '', evidencePath: '' }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--version' || arg === '--evidence') {
      const value = argv[index + 1]
      if (!value) throw new Error(arg + ' 后面缺值。')
      if (arg === '--version') options.version = value
      else options.evidencePath = value
      index += 1
    } else if (arg === '--help' || arg === '-h') {
      // 用法请求不是错误，但也不能当成正常参数继续跑：用 null 把它与「参数写错」分开，
      // 免得靠一个只有本文件知道的异常字符串当控制流。
      return null
    } else {
      throw new Error('不认识的参数：' + arg)
    }
  }
  return options
}

/**
 * 拼「## 发布记录」这条评论的正文。
 *
 * 抽成纯函数是为了能被门禁直接调用验内容（tests/verify-1648-release-integrity.ts）：评论发出去之后
 * 就改不动了，格式与字段在这之前就该被断言过，而不是等发布完再靠人看。
 *
 * 证据缺省时保留旧版本那六行并写明「这次没有机器对账证据」。不假装有：没证据就写没有，
 * 比印一行看不懂的占位强。
 */
export function buildPublishRecordLines(input: PublishRecordInput): string[] {
  const version = String(input.version).trim().replace(/^[vV]/, '')
  const lines: string[] = [
    '## 发布记录',
    '',
    '- 发布版本：v' + version,
    '- 发布时间：' + localIso(input.now),
    '- 发布说明：见 CHANGELOG.md 的「v' + version + '」一节',
  ]
  const evidence = input.evidence
  if (evidence && evidence.packages.length > 0) {
    for (const pkg of evidence.packages) {
      lines.push(
        // 指纹写全：发布记录是「发出去的字节」的凭据，截断之后就没法拿它去和发布日志里那一行比对。
        '- 发布包逐文件清单：' + pkg.name + '@' + pkg.version + '，' + String(pkg.fileCount) + ' 个文件，' +
          String(pkg.totalBytes) + ' 字节，清单指纹 sha256:' + String(pkg.digest),
      )
    }
    const tags = evidence.tags || {}
    lines.push('- dist-tag 最终指向：latest → ' + (tags.latest || '（不存在）') + '，beta → ' + (tags.beta || '（不存在）'))
  } else {
    lines.push('- 发布包逐文件清单：（这次没有机器对账证据：发布脚本未产出，或没有走完「发布→拉回→比对」的包）')
  }
  lines.push('- 下一版清单票：' + (input.nextIssueNumber ? '#' + input.nextIssueNumber : '（这次没建出来，发布前检查会拦下一版）'))
  lines.push('', '本版已发布。安装由用户侧完成：市场升级、软件内升级，或自己执行安装命令。', '本票继续保持关闭；下一版的真机验证场景请登记到下一版清单票。')
  return lines
}

/**
 * 读并校验发布脚本交来的证据文件。
 *
 * 校验得松一点没有好处：证据文件坏掉时最坏的结果是发布记录里少一行关键信息，而那一行正是
 * #1648 要让发布记录「自己说得清」的东西。字段不全就直接失败，让人看到 POSTFLIGHT-FAIL。
 */
function readEvidenceFile(filePath: string): PublishEvidence {
  let text = ''
  try {
    text = readFileSync(filePath, 'utf8')
  } catch (error) {
    throw new Error('读不到 --evidence 指向的文件「' + filePath + '」：' + String(error))
  }
  let parsed: any
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new Error('--evidence 文件「' + filePath + '」不是合法 JSON：' + String(error))
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('--evidence 文件「' + filePath + '」不是对象。')
  if (typeof parsed.version !== 'string' || parsed.version === '') throw new Error('--evidence 文件缺 version 字段。')
  if (!Array.isArray(parsed.packages)) throw new Error('--evidence 文件缺 packages 数组。')
  const packages: PublishEvidencePackage[] = []
  for (const raw of parsed.packages) {
    if (!raw || typeof raw.name !== 'string' || typeof raw.version !== 'string') {
      throw new Error('--evidence 文件里有一个包缺 name/version。')
    }
    packages.push({
      name: raw.name,
      version: raw.version,
      fileCount: Number(raw.fileCount) || 0,
      totalBytes: Number(raw.totalBytes) || 0,
      digest: typeof raw.digest === 'string' ? raw.digest : '',
    })
  }
  const tagsRaw = parsed.tags && typeof parsed.tags === 'object' ? parsed.tags : {}
  return {
    version: parsed.version,
    packages,
    tags: {
      latest: typeof tagsRaw.latest === 'string' && tagsRaw.latest !== '' ? tagsRaw.latest : undefined,
      beta: typeof tagsRaw.beta === 'string' && tagsRaw.beta !== '' ? tagsRaw.beta : undefined,
    },
  }
}

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
  let options: Options
  try {
    const parsed = parseArgs(process.argv.slice(2))
    if (parsed === null) {
      console.log('用法：node scripts/release-postflight.mts [--version <版本号>] [--evidence <发布证据文件>]')
      process.exit(0)
    }
    options = parsed
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }

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

  let evidence: PublishEvidence | null = null
  if (options.evidencePath) {
    try {
      evidence = readEvidenceFile(options.evidencePath)
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error))
      process.exit(1)
    }
    if (evidence.version.trim().replace(/^[vV]/, '') !== versionNumber) {
      fail('--evidence 里的版本是 ' + evidence.version + '，与这次发布的 ' + versionNumber + ' 不一致。')
      process.exit(1)
    }
    info(
      '发布证据：' + evidence.packages.length + ' 个包，dist-tag latest=' + (evidence.tags.latest || '（缺）') +
        '，beta=' + (evidence.tags.beta || '（缺）'),
    )
  } else {
    info('没有给 --evidence：发布记录里不写逐文件清单与 dist-tag 指向（五仓同步的旧协议行为）。')
  }

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
  const lines = buildPublishRecordLines({
    version: versionNumber,
    nextIssueNumber: nextIssue ? nextIssue.number : null,
    evidence,
    now: new Date(),
  })
  try {
    ghText(['issue', 'comment', String(issue.number), '--body', lines.join('\n')])
  } catch (error) {
    fail('给清单票 #' + issue.number + ' 补发布记录失败：' + (error instanceof ReleaseEnvError ? error.message : String(error)))
    process.exit(1)
  }
  ok('已给清单票 #' + issue.number + '「' + normalizeTitle(issue.title) + '」补发布记录')
  process.exit(failed ? 1 : 0)
}

// 只有被直接执行时才跑 main()：tests/verify-1648-release-integrity.ts 会 import 这个文件里的
// buildPublishRecordLines() 验发布记录正文，import 不能顺手去调 gh。
const invokedDirectly = process.argv[1] ? resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url)) : false
if (invokedDirectly) main()
