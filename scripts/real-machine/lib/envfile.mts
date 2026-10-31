// envfile.mts —— 读「给隔离实例用的环境文件」：一行一个 KEY=VALUE，只认 GitLab 真机验证需要的那三个变量。
//
// 为什么要有这个文件而不是把值写成命令行参数：#1703 规格与 #1677 调研都要求 token 原文不进命令行、
// 不进日志、不进证据。环境文件是值的唯一入口，命令只传文件路径；计划模式（--launch-plan）只把变量名
// 打出来，绝不输出值。这里的错误信息一律只带行号与变量名，不回显任何一行原文——那行可能正好写着 token。
//
// 支持的写法（与常见 .env 一致的最小集合）：
//   - 空行、# 开头的整行注释跳过；
//   - KEY=VALUE，等号两边可以有空白；`export KEY=VALUE` 也认；
//   - 值两端成对的引号（"..." 或 '...'）会去掉；
//   - 注释只认整行，不解析值后面的 #（避免把含 # 的路径或口令截断）；
//   - 同一个变量写两次算错误，不猜以哪一次为准。
//
// 只认三个变量名：GLAB_CONFIG_DIR、PATH 必需，GITLAB_TOKEN 可选。为什么要限定：这个环境文件是
// 工具台传给隔离实例的唯一通道，放开任意变量等于绕开上面「值不进日志」的安全检查；确实需要新变量时
// 先加进这张表，并同时让它出现在计划输出与文档里。

import fs from 'node:fs'
import path from 'node:path'

/** 这个命令认识的环境变量名，按输出顺序排列。 */
export const INSTANCE_ENV_NAMES = ['GLAB_CONFIG_DIR', 'PATH', 'GITLAB_TOKEN']

/** 每次启动都必须有的变量名：实例要读本批的 glab 配置，也要按计划里的 PATH 找到（或故意找不到）glab。 */
export const REQUIRED_INSTANCE_ENV_NAMES = ['GLAB_CONFIG_DIR', 'PATH']

/** 值属于凭证、只允许进子进程环境、绝不允许进输出与日志的变量名。 */
export const SECRET_INSTANCE_ENV_NAMES = ['GITLAB_TOKEN']

/**
 * 环境文件的解析结果。values 只在内存里交给启动逻辑，调用方不许把它拼进任何给人看的输出。
 */
export interface InstanceEnvFile {
  /** 环境文件的绝对路径；计划输出与 instance.json 只记这个路径。 */
  file: string
  /** 实际写进子进程环境的变量名，按 INSTANCE_ENV_NAMES 的顺序，只含有值的。 */
  names: string[]
  /** names 里属于凭证的那几个（目前只有 GITLAB_TOKEN），计划输出要靠它标注哪几项不显示值。 */
  secretNames: string[]
  /** 变量名到值；只在启动实例时合并进子进程环境。 */
  values: Record<string, string>
}

/** 变量名是否长得像一个安全的变量名：这样的名字回显在错误信息里不会带出值。 */
function looksLikeName(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(name)
}

/** 去掉值两端成对的引号；只有成对时才去，避免把值里本来就有的单个引号吃掉。 */
function unquote(value: string): string {
  if (value.length < 2) return value
  const head = value[0]
  const tail = value[value.length - 1]
  if ((head === '"' && tail === '"') || (head === "'" && tail === "'")) return value.slice(1, -1)
  return value
}

/**
 * 读并校验环境文件，返回能直接合并进子进程环境的那几个变量。
 *
 * 任何错误都以中文抛出，消息里只有文件路径、行号、变量名与允许的名字列表，不含该行原文（行里可能是
 * token）；缺文件也在这里转成一句可照做的提示，让命令入口只负责退出码。
 *
 * 两个容易误会的约定：
 * - GITLAB_TOKEN 写成空值时按「这一次不需要访问 GitLab」处理，当它没写，不往子进程环境里塞空凭证；
 * - 其它变量写成空值直接报错，因为空的 GLAB_CONFIG_DIR / PATH 会让实例行为变得难以解释。
 */
export function loadInstanceEnvFile(file: string): InstanceEnvFile {
  const resolved = path.resolve(file)
  let text = ''
  try {
    text = fs.readFileSync(resolved, 'utf8')
  } catch {
    throw new Error('找不到环境文件「' + resolved + '」：用 --instance-env-file 指到一个写了 KEY=VALUE 的文本文件。')
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)

  const values: Record<string, string> = {}
  const firstLine: Record<string, number> = {}
  const lines = text.split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    const lineNo = index + 1
    let line = lines[index].trim()
    if (!line || line.startsWith('#')) continue
    if (line.startsWith('export ')) line = line.slice('export '.length).trim()

    const eq = line.indexOf('=')
    if (eq < 0) {
      throw new Error('环境文件「' + resolved + '」第 ' + lineNo + ' 行不是 KEY=VALUE 形式：每行写「变量名=值」，整行注释用 # 开头。')
    }
    const name = line.slice(0, eq).trim()
    if (!name) {
      throw new Error('环境文件「' + resolved + '」第 ' + lineNo + ' 行的变量名是空的：等号左边写变量名。')
    }
    if (!looksLikeName(name)) {
      throw new Error('环境文件「' + resolved + '」第 ' + lineNo + ' 行的变量名不合法：只能用字母、数字、下划线，不能以数字开头。')
    }
    if (!INSTANCE_ENV_NAMES.includes(name)) {
      throw new Error('环境文件「' + resolved + '」第 ' + lineNo + ' 行写了不支持的变量名「' + name + '」：这个命令只接受 ' + INSTANCE_ENV_NAMES.join('、') + '。')
    }
    if (firstLine[name] !== undefined) {
      throw new Error('环境文件「' + resolved + '」第 ' + lineNo + ' 行重复定义了「' + name + '」（第一次在第 ' + firstLine[name] + ' 行）。')
    }
    firstLine[name] = lineNo

    const value = unquote(line.slice(eq + 1).trim())
    if (value === '') {
      // GITLAB_TOKEN 留空表示这一次不需要访问 GitLab：当它没写，别让空凭证进环境。
      if (name === 'GITLAB_TOKEN') continue
      throw new Error('环境文件「' + resolved + '」第 ' + lineNo + ' 行的「' + name + '」值是空的：这一项必须有值，不能留空。')
    }
    values[name] = value
  }

  const missing = REQUIRED_INSTANCE_ENV_NAMES.filter((name) => values[name] === undefined)
  if (missing.length > 0) {
    throw new Error('环境文件「' + resolved + '」里缺少必需变量：' + missing.join('、') + '。至少要写 GLAB_CONFIG_DIR 与 PATH；需要访问 GitLab 时再加 GITLAB_TOKEN。')
  }
  const names = INSTANCE_ENV_NAMES.filter((name) => values[name] !== undefined)
  const secretNames = SECRET_INSTANCE_ENV_NAMES.filter((name) => values[name] !== undefined)
  return { file: resolved, names, secretNames, values }
}
