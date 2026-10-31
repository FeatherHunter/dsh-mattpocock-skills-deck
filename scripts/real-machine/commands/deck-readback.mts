// scripts/real-machine/commands/deck-readback.mts —— 用 glab 独立读回一张 GitLab 票（#1709）。
//
// 为什么单独一条命令：规格要求「用 glab API 独立读回」来核对 deck 工具写进去的东西。
// 独立的意思是这一条不经过 src/deck 的装配、不 import deck 工具，只起 glab 子进程读一次
// projects/<enc>/issues/<iid>，把结果整理成人能直接比对的字段。它读到的就是 GitLab 那边的原始回包。
//
// 用法：
//   GLAB_BIN=<glab 可执行文件> node --import ./scripts/ts-hook.mts scripts/real-machine/commands/deck-readback.mts \
//     --ref FixtureGroup/dsh-deck-demo --key 7 [--out readback.json]
//
// 退出码：0 读回并解析成功；1 glab 非 0 或回包不可解析；2 参数不对；3 环境缺失（GLAB_BIN）。

import fs from 'node:fs'
import path from 'node:path'
import { info, parseArgs, printJson, writeJson } from '../lib/util.mts'
import { isRecord, runGlabProcess } from '../lib/deck-write.mts'

const EXIT_OK = 0
const EXIT_READBACK_FAILED = 1
const EXIT_BAD_INPUT = 2
const EXIT_ENV_MISSING = 3

function fail(code: number, lines: string[]): void {
  for (const line of lines) info(line)
  info('命令退出码 ' + code + '，这次没拿到独立读回的结果。')
  process.exitCode = code
}

/** 从正文文件头里认隐藏归属标记：只认前 10 行里单独一行的 <!-- DSH-PARENT: N -->。 */
function parentKeyOf(description: string): string {
  const head = String(description || '').split(/\r?\n/).slice(0, 10)
  for (const line of head) {
    const matched = /^<!--\s*DSH-PARENT\s*:\s*(\d+)\s*-->$/.exec(line.trim())
    if (matched) return matched[1]
  }
  return ''
}

function labelsOf(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const item of raw) {
    if (typeof item === 'string') out.push(item)
    else if (isRecord(item) && typeof item.name === 'string') out.push(item.name)
  }
  return out
}

function main(): void {
  const parsed = parseArgs(process.argv.slice(2))
  const glabBin = String(process.env.GLAB_BIN || '')
  if (glabBin.trim() === '') {
    fail(EXIT_ENV_MISSING, ['没有收到 glab 可执行文件路径（环境变量 GLAB_BIN）：独立读回也要经它调 glab，不会去 PATH 上找。'])
    return
  }
  if (!fs.existsSync(glabBin)) {
    fail(EXIT_ENV_MISSING, ['GLAB_BIN 指向的文件不存在：' + glabBin])
    return
  }
  const refId = parsed.get('ref') || ''
  if (!/^[^/\s]+\/[^/\s]+$/.test(refId)) {
    fail(EXIT_BAD_INPUT, ['缺少或认不出参数 --ref：要写成 <group>/<project> 两段（收到「' + refId + '」）。'])
    return
  }
  const key = String(parsed.get('key') || '').trim()
  if (key === '') {
    fail(EXIT_BAD_INPUT, ['缺少参数 --key：要读回哪一张票的票号（例如 7）。'])
    return
  }
  const apiPath = 'projects/' + encodeURIComponent(refId) + '/issues/' + encodeURIComponent(key) + '?with_labels_details=true'
  const run = runGlabProcess(glabBin, ['api', apiPath])
  if (run.code !== 0) {
    const firstLine = String(run.stderr || '').split(/\r?\n/)[0]
    fail(EXIT_READBACK_FAILED, ['独立读回失败：glab 退出码 ' + run.code + '，接口 ' + apiPath + (firstLine ? '，stderr 第一行：' + firstLine : '。')])
    return
  }
  let raw: unknown
  try {
    raw = JSON.parse(run.stdout)
  } catch (error) {
    fail(EXIT_READBACK_FAILED, ['独立读回失败：glab 的输出不是合法 JSON（接口 ' + apiPath + '）。'])
    return
  }
  if (!isRecord(raw)) {
    fail(EXIT_READBACK_FAILED, ['独立读回失败：glab 的输出不是一张票的对象（接口 ' + apiPath + '）。'])
    return
  }
  const description = typeof raw.description === 'string' ? raw.description : ''
  const result: Record<string, unknown> = {
    ref: refId,
    key: raw.iid === undefined ? key : String(raw.iid),
    title: typeof raw.title === 'string' ? raw.title : '',
    body: description,
    state: typeof raw.state === 'string' ? raw.state : '',
    labels: labelsOf(raw.labels),
    parentKey: parentKeyOf(description),
    url: typeof raw.web_url === 'string' ? raw.web_url : (typeof raw.url === 'string' ? raw.url : ''),
    raw: raw,
  }
  const out = parsed.get('out')
  if (out) {
    const written = path.resolve(out)
    writeJson(written, result)
    info('读回结果写到 ' + written)
  }
  printJson(result)
  process.exitCode = EXIT_OK
}

try {
  main()
} catch (error) {
  fail(EXIT_BAD_INPUT, ['deck-readback 命令自己出错：' + (error && typeof error === 'object' && 'message' in error ? String((error as { message: unknown }).message) : String(error))])
}
