// scripts/release-preflight.mts —— 发布前检查的薄命令行入口：只解析参数、打印组合根给的结论行、返回退出码。
//
// 为什么这么薄：检查本身（清单票唯一 / 已关闭 / 正文与评论一致 / 批次身份行 / 候选祖先与差异审计 /
// 候选清单合法）已经由 base 的 runReleaseGate 实现成纯规则，本仓的接线在
// scripts/lib/release-preflight-gate.mts。两条发布路径与测试跑的是同一份代码，
// 这里只负责「命令行长什么样、退出码是什么、哪一行去哪个流」。
//
// 两条发布路径都在真正发布之前调用本脚本：
//   - scripts/publish-token.ps1（token 无人值守路径）
//   - scripts/wizard-release.sh（只扫码向导：Stage 3 的第五步）
// 演练/干跑不再传 --soft：本脚本不改变结论，只输出结论；演练模式由两个发布脚本自己按退出码
// 决定「提示还是阻断」——门禁少一个「跳过开关」，就少一条能悄悄绕过的路。
//
// 用法：node scripts/release-preflight.mts [--version <版本号>] [--candidate <候选清单.json>]
//   --version    本版版本号，可带 v。缺省读仓根 package.json 的 version。
//   --candidate  候选清单 JSON（base freeze 产出的 schemaVersion=2 候选清单）；不传只查票面身份行。
// 退出码：0=门禁通过；1=票面/候选有问题（人要去改票或改候选）；2=环境或适配器缺失，无法判定。
//
// 输出行首标记（日志里按标记搜索）：
//   PREFLIGHT-OK / PREFLIGHT-FAIL / PREFLIGHT-BLOCKED / PREFLIGHT-ENV / PREFLIGHT-INFO /
//   PREFLIGHT-CANDIDATE-OK / PREFLIGHT-CANDIDATE-AUDIT
import { runPreflightGate } from './lib/release-preflight-gate.mts'

type Options = {
  version: string
  candidatePath: string
  help: boolean
}

const USAGE = '用法：node scripts/release-preflight.mts [--version <版本号>] [--candidate <候选清单.json>]'

/** 解析参数。未知参数与缺值都按环境问题处理：发布脚本传错了，不该让人去改票。 */
function parseArgs(argv: string[]): { options: Options } | { error: string } {
  const options: Options = { version: '', candidatePath: '', help: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--version') {
      const value = argv[index + 1]
      if (value === undefined || value === '') return { error: '--version 后面缺版本号。' }
      options.version = value
      index += 1
    } else if (arg === '--candidate') {
      const value = argv[index + 1]
      if (value === undefined || value === '') return { error: '--candidate 后面缺候选清单文件路径。' }
      options.candidatePath = value
      index += 1
    } else if (arg === '--help' || arg === '-h') {
      options.help = true
    } else {
      return { error: '不认识的参数：' + arg + '。' + USAGE }
    }
  }
  return { options }
}

async function main(): Promise<number> {
  const parsed = parseArgs(process.argv.slice(2))
  if ('error' in parsed) {
    console.error('PREFLIGHT-ENV ' + parsed.error)
    return 2
  }
  if (parsed.options.help) {
    console.log(USAGE)
    return 0
  }
  const outcome = await runPreflightGate({
    version: parsed.options.version,
    candidatePath: parsed.options.candidatePath,
  })
  for (const line of outcome.lines) {
    if (line.stream === 'err') console.error(line.text)
    else console.log(line.text)
  }
  return outcome.exitCode
}

main()
  .then((code) => {
    // 用 process.exitCode 而不是 process.exit：Node 24 的 Windows 上 process.exit 可能截断未 flush 的 stdout。
    process.exitCode = code
  })
  .catch((error) => {
    console.error('PREFLIGHT-ENV 发布前检查自己出错了：' + (error instanceof Error ? error.message : String(error)))
    process.exitCode = 2
  })
