// collect-evidence —— 把截图、日志片段、命令回显等文件收进批次证据包，生成带时间戳与哈希的 evidence.json。
//
// 用法：
//   node --import ./scripts/ts-hook.mts scripts/real-machine/commands/collect-evidence.mts
//         --batch <批次目录>
//         --file <要收的文件> [--file ...] [--note <说明> ...] [--kind <类别> ...]
//         [--check <名字=true|false[:说明]> ...]
//         [--summary <JSON 文本或 @JSON文件>]
//         [--meta 键=值 ...] [--extra 键=值 ...]
//
// --note / --kind 按顺序对应 --file；不给时用文件名与 file。
// 输出 evidence.json 的路径与清单。

import fs from 'node:fs'
import path from 'node:path'
import { ensureDir, parseArgs, printJson, runCli } from '../lib/util.mts'
import { createEvidence } from '../lib/evidence.mts'

function parsePairs(values: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const pair of values) {
    const eq = pair.indexOf('=')
    if (eq < 0) throw new Error('要写成 键=值，收到「' + pair + '」。')
    out[pair.slice(0, eq)] = pair.slice(eq + 1)
  }
  return out
}

runCli(async () => {
  const args = parseArgs(process.argv.slice(2))
  const batch = args.require('batch', '批次目录')
  ensureDir(batch)
  const collector = createEvidence(batch, parsePairs(args.getAll('meta')))
  const files = args.getAll('file')
  const notes = args.getAll('note')
  const kinds = args.getAll('kind')
  files.forEach((file, index) => {
    const target = path.resolve(file)
    if (!fs.existsSync(target)) throw new Error('要收进证据的文件不存在：「' + target + '」')
    const stem = path.basename(target, path.extname(target))
    collector.addFile(stem, target, notes[index] || path.basename(target))
  })
  for (const spec of args.getAll('check')) {
    const eq = spec.indexOf('=')
    if (eq < 0) throw new Error('--check 要写成 名字=true[:说明]，收到「' + spec + '」。')
    const name = spec.slice(0, eq)
    const rest = spec.slice(eq + 1)
    const colon = rest.indexOf(':')
    const valueText = colon < 0 ? rest : rest.slice(0, colon)
    const detail = colon < 0 ? '' : rest.slice(colon + 1)
    collector.check(name, valueText.toLowerCase() === 'true', detail)
  }
  const summaryText = args.get('summary')
  let summary: any = {}
  if (summaryText) {
    if (summaryText.startsWith('@')) {
      summary = JSON.parse(fs.readFileSync(path.resolve(summaryText.slice(1)), 'utf8'))
    } else {
      summary = JSON.parse(summaryText)
    }
  }
  const finished = collector.finish(summary, { extra: parsePairs(args.getAll('extra')) })
  printJson({ manifestPath: finished.manifestPath, itemCount: finished.manifest.items.length, checkCount: finished.manifest.checks.length, ok: finished.manifest.checks.every((entry: any) => entry.ok), manifest: finished.manifest })
})
