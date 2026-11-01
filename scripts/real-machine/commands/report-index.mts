// #1711 report-index：读全局 index.jsonl 与 conditions.jsonl，输出一段 JSON 摘要（可选同时写 Markdown）。
//
// 口径与数据形状见 README 与 research/1677-execution-orchestration.md 第 9.4 节：
// 成功时 stdout 只有一段 JSON，失败时退出码非 0、stderr 一句中文原因（由 runCli 统一兜底）。
// 所有写入都限制在工作根内（assertWritableTarget），产物默认放 .scratch/verify-run/ 下。
import * as path from 'node:path'
import { ensureDir, exists, parseArgs, printJson, runCli, writeText } from '../lib/util.mts'
import { assertWritableTarget, workRoot } from '../lib/paths.mts'
import { aggregateReport, readConditionRows, readDefectOverrides, readIndexRows, renderMarkdown } from '../lib/report-index.mts'

runCli(async () => {
  const args = parseArgs(process.argv.slice(2))
  const indexRaw = args.get('index')
  const indexPath = path.resolve(process.cwd(), indexRaw || path.join(workRoot(), 'evidence-archive', 'index.jsonl'))
  if (!exists(indexPath)) {
    throw new Error('找不到全局索引「' + indexPath + '」：先用批次归档命令生成 evidence-archive/index.jsonl，或显式传 --index。')
  }

  let conditionsPath: string | null = null
  let conditionRows: ReturnType<typeof readConditionRows> = []
  const conditionsRaw = args.get('conditions')
  if (conditionsRaw) {
    conditionsPath = path.resolve(process.cwd(), conditionsRaw)
    if (!exists(conditionsPath)) {
      throw new Error('找不到条件账本「' + conditionsPath + '」：--conditions 指定的文件不存在，请检查路径。')
    }
    conditionRows = readConditionRows(conditionsPath)
  } else {
    const defaultConditions = path.join(path.dirname(indexPath), 'conditions.jsonl')
    if (exists(defaultConditions)) {
      conditionsPath = defaultConditions
      conditionRows = readConditionRows(defaultConditions)
    }
  }

  let defectOverrides: ReturnType<typeof readDefectOverrides> = []
  const defectsRaw = args.get('defects')
  if (defectsRaw) {
    const defectsPath = path.resolve(process.cwd(), defectsRaw)
    if (!exists(defectsPath)) {
      throw new Error('找不到缺陷等级清单「' + defectsPath + '」：--defects 指定的文件不存在，请检查路径。')
    }
    defectOverrides = readDefectOverrides(defectsPath)
  }

  const indexRows = readIndexRows(indexPath)
  const summary = aggregateReport({ indexRows: indexRows, conditionRows: conditionRows, defectOverrides: defectOverrides })
  const markdown = renderMarkdown(summary)

  let markdownPath: string | null = null
  const markdownRaw = args.get('markdown-out')
  if (markdownRaw) {
    markdownPath = path.resolve(process.cwd(), markdownRaw)
    assertWritableTarget(markdownPath)
    ensureDir(path.dirname(markdownPath))
    writeText(markdownPath, markdown)
  }

  printJson({
    ok: true,
    indexPath: indexPath,
    conditionsPath: conditionsPath,
    markdownPath: markdownPath,
    totals: summary.totals,
    assertions: summary.assertions,
    unmappedScenarios: summary.unmappedScenarios,
    candidates: summary.candidates,
    defects: summary.defects,
    unticketedProductDefects: summary.unticketedProductDefects,
    conditions: summary.conditions,
    markdown: markdown,
  })
})
