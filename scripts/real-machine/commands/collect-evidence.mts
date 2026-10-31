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
// 证据必须收进一个已经由 prepare-batch 建好的批次：命令会读 <批次>/batch.json，把候选身份写进 evidence.json。
// 缺 batch.json 或身份对不上时直接失败——没有候选身份的证据不进报告统计。
// 输出 evidence.json 的路径与清单。

import fs from 'node:fs'
import path from 'node:path'
import { judgeBatchCandidateFile, readBatch } from '../lib/batch.mts'
import { createEvidence } from '../lib/evidence.mts'
import { resolveBatchPath } from '../lib/paths.mts'
import { parseArgs, printJson, runCli } from '../lib/util.mts'

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
  const batch = resolveBatchPath(args.require('batch', '批次目录'))
  const record = readBatch(batch)
  // 从磁盘上的候选文件与候选包重新认一遍身份，再写进证据：只信 batch.json 自己的记录
  // 等于让「候选有没有被换过」这个问题没有答案。
  const candidateCheck = judgeBatchCandidateFile(record)
  if (!candidateCheck.ok) {
    throw new Error('批次记录与磁盘上的候选对不上，不能收证据：\n  ' + candidateCheck.problems.join('\n  '))
  }
  const binding = candidateCheck.binding
  if (!binding) throw new Error('候选身份没有解析出来：先跑 prepare-batch 建批次。')
  const meta: Record<string, any> = parsePairs(args.getAll('meta'))
  if ('candidate' in meta || 'batchName' in meta) {
    throw new Error('候选身份由 batch.json 决定，不要在 --meta 里手写 candidate 或 batchName：先确认批次目录没给错。')
  }
  meta.candidate = binding
  const collector = createEvidence(batch, meta, { candidate: binding })
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
  printJson({
    manifestPath: finished.manifestPath,
    batchName: record.batchName,
    candidate: binding,
    itemCount: finished.manifest.items.length,
    checkCount: finished.manifest.checks.length,
    ok: finished.manifest.checks.every((entry: any) => entry.ok),
    manifest: finished.manifest,
  })
})
