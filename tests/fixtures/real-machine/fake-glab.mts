// tests/fixtures/real-machine/fake-glab.mts —— 假 glab：把每次调用记下来，再按计划回话。
//
// 它不是真 glab，也绝不访问网络。可以由 GLAB_BIN 直接调，也可以经 PATH 前置的 glab 启动器按名字调；
// 两种情况走的是同一个脚本，所以记录下来的调用顺序就是被测命令真实的调用顺序。
//
// 两个环境变量（由 tests/lib/real-machine-process.ts 注入，只在测试子进程里生效）：
//   GLAB_FAKE_LOG   调用记录 JSONL 的路径。每次调用追加一行：{"argv":[…],"cwd":…,"matchedRule":…,"exitCode":…}
//   GLAB_FAKE_PLAN  计划文件路径。形状见 tests/lib/real-machine-process.ts 的 GlabPlan；
//                   没有计划文件时按「退出码 0、不输出」处理。
//
// 为什么用 .mts：新夹具一律写 TypeScript；Node 24 直接跑它，不需要 ts-hook。启动器加了 --no-warnings，
// 免得类型剥离开关的实验性警告混进被测命令的 stderr。

import fs from 'node:fs'
import path from 'node:path'

interface GlabResponse {
  exitCode?: number
  stdout?: string
  stderr?: string
}

interface GlabRule extends GlabResponse {
  argvPrefix?: string[]
  argvIncludes?: string[]
}

interface GlabPlan {
  default?: GlabResponse
  rules?: GlabRule[]
}

/** 读计划文件；没有、读不懂、形状不对都按空计划处理，但读不懂时要说清是哪份文件。 */
function readPlan(file: string): GlabPlan {
  if (!file || !fs.existsSync(file)) return {}
  const text = fs.readFileSync(file, 'utf8')
  try {
    const parsed = JSON.parse(text) as GlabPlan
    if (!parsed || typeof parsed !== 'object') return {}
    return parsed
  } catch (error) {
    throw new Error('假 glab 的计划文件读不懂：' + file + '（' + (error instanceof Error ? error.message : String(error)) + '）')
  }
}

/** 一条规则是否命中：写了的匹配条件必须全部满足；什么都没写就当成「命中一切」。 */
function matchesRule(argv: string[], rule: GlabRule): boolean {
  if (Array.isArray(rule.argvPrefix)) {
    for (let index = 0; index < rule.argvPrefix.length; index += 1) {
      if (argv[index] !== rule.argvPrefix[index]) return false
    }
  }
  if (Array.isArray(rule.argvIncludes)) {
    for (const item of rule.argvIncludes) {
      if (!argv.includes(item)) return false
    }
  }
  return true
}

const argv = process.argv.slice(2)
const cwd = process.cwd()
const logPath = process.env.GLAB_FAKE_LOG || ''
const planPath = process.env.GLAB_FAKE_PLAN || ''

let response: GlabResponse = {}
let matchedRule: number | 'default' = 'default'
let planError = ''
try {
  const plan = readPlan(planPath)
  const rules = Array.isArray(plan.rules) ? plan.rules : []
  response = plan.default || {}
  for (let index = 0; index < rules.length; index += 1) {
    if (matchesRule(argv, rules[index])) {
      matchedRule = index
      response = rules[index]
      break
    }
  }
} catch (error) {
  planError = error instanceof Error ? error.message : String(error)
  response = { exitCode: 2, stderr: planError + '\n' }
}

if (logPath) {
  const record = {
    argv,
    cwd,
    matchedRule,
    exitCode: response.exitCode === undefined ? 0 : response.exitCode,
  }
  fs.mkdirSync(path.dirname(logPath), { recursive: true })
  fs.appendFileSync(logPath, JSON.stringify(record) + '\n', 'utf8')
}

process.stdout.write(response.stdout || '')
process.stderr.write(response.stderr || '')
process.exitCode = response.exitCode === undefined ? 0 : response.exitCode
