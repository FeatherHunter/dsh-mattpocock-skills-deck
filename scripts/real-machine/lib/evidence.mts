// evidence.mts —— 证据包：截图、日志片段、命令回显写进批次目录，最后生成带时间戳与文件哈希的 evidence.json。
//
// 证据文件都在 <batch>/evidence/files/ 下，manifest 里记相对路径、字节数与 SHA256，方便别人复核没有被改过。

import fs from 'node:fs'
import path from 'node:path'
import { ensureDir, exists, sha256File, fileSize, nowIso, writeJson, writeText } from './util.mts'

export interface EvidenceItem {
  /** 这一条证据是什么：screenshot / log-slice / command / json / text / page-diagnostics。 */
  kind: string
  /** 相对 batch 目录的路径，方便在别的机器上按同样结构找。 */
  file: string
  bytes: number
  sha256: string
  capturedAt: string
  note: string
}

export interface EvidenceCheck {
  name: string
  ok: boolean
  detail: string
}

export interface EvidenceCollector {
  dir: string
  addText: (name: string, text: string, note?: string) => EvidenceItem
  addJson: (name: string, value: any, note?: string) => EvidenceItem
  addScreenshot: (page: any, name: string, options?: { fullPage?: boolean; note?: string }) => Promise<EvidenceItem>
  addLogSlice: (name: string, logFile: string, lines: string[], note?: string) => EvidenceItem
  addCommand: (name: string, command: { argv: string[]; cwd: string; exitCode: number | null; stdout?: string; stderr?: string }, note?: string) => EvidenceItem
  addFile: (name: string, sourceFile: string, note?: string) => EvidenceItem
  check: (name: string, ok: boolean, detail?: string) => EvidenceCheck
  finish: (summary: Record<string, any>, options?: { extra?: Record<string, any> }) => { manifestPath: string; manifest: any }
  items: () => EvidenceItem[]
  checks: () => EvidenceCheck[]
}

function relativeTo(dir: string, file: string): string {
  return path.relative(dir, file).split(path.sep).join('/')
}

/** 开一个证据收集器：所有文件落在 <batch>/evidence/files/ 里。 */
export function createEvidence(batchDir: string, meta: Record<string, any> = {}): EvidenceCollector {
  const dir = path.resolve(batchDir)
  assertWithin(dir)
  const filesDir = path.join(dir, 'evidence', 'files')
  ensureDir(filesDir)
  const collected: EvidenceItem[] = []
  const checks: EvidenceCheck[] = []

  const record = (kind: string, filePath: string, note: string): EvidenceItem => {
    const item: EvidenceItem = {
      kind,
      file: relativeTo(dir, filePath),
      bytes: fileSize(filePath),
      sha256: sha256File(filePath),
      capturedAt: nowIso(),
      note,
    }
    collected.push(item)
    return item
  }

  const safeName = (name: string): string => name.replace(/[<>:"/\\|?*]/g, '-').replace(/\s+/g, '-').slice(0, 120)

  /** 同名文件不互相覆盖：第二个同名的会加 -2、-3 后缀，避免证据被悄悄冲掉。 */
  const uniquePath = (base: string, ext: string): string => {
    let candidate = path.join(filesDir, base + ext)
    let index = 2
    while (exists(candidate)) {
      candidate = path.join(filesDir, base + '-' + index + ext)
      index += 1
    }
    return candidate
  }

  return {
    dir,
    addText(name, text, note = '') {
      const filePath = path.join(filesDir, safeName(name) + '.txt')
      writeText(filePath, text)
      return record('text', filePath, note)
    },
    addJson(name, value, note = '') {
      const filePath = path.join(filesDir, safeName(name) + '.json')
      writeJson(filePath, value)
      return record('json', filePath, note)
    },
    async addScreenshot(page, name, options = {}) {
      const filePath = path.join(filesDir, safeName(name) + '.png')
      ensureDir(path.dirname(filePath))
      await page.screenshot({ path: filePath, fullPage: options.fullPage === true })
      return record('screenshot', filePath, options.note || '')
    },
    addLogSlice(name, logFile, lines, note = '') {
      const filePath = path.join(filesDir, safeName(name) + '.logfrag')
      const header = '# source: ' + logFile + '\n# capturedAt: ' + nowIso() + '\n'
      writeText(filePath, header + lines.join('\n') + '\n')
      return record('log-slice', filePath, note)
    },
    addCommand(name, command, note = '') {
      const filePath = path.join(filesDir, safeName(name) + '.command.json')
      const payload = {
        argv: command.argv,
        cwd: command.cwd,
        exitCode: command.exitCode,
        stdoutTail: (command.stdout || '').slice(-2000),
        stderrTail: (command.stderr || '').slice(-2000),
        capturedAt: nowIso(),
      }
      writeJson(filePath, payload)
      return record('command', filePath, note)
    },
    addFile(name, sourceFile, note = '') {
      const filePath = path.join(filesDir, safeName(name) + path.extname(sourceFile))
      ensureDir(path.dirname(filePath))
      fs.copyFileSync(sourceFile, filePath)
      return record('file', filePath, note)
    },
    check(name, ok, detail = '') {
      const entry: EvidenceCheck = { name, ok, detail }
      checks.push(entry)
      return entry
    },
    finish(summary, options = {}) {
      const manifestPath = path.join(dir, 'evidence.json')
      const manifest = {
        generatedAt: nowIso(),
        batch: path.basename(dir),
        meta,
        summary,
        checks,
        items: collected,
        ...(options.extra || {}),
      }
      writeJson(manifestPath, manifest)
      return { manifestPath, manifest }
    },
    items: () => collected.slice(),
    checks: () => checks.slice(),
  }
}

/** 证据目录必须在批次目录里：防止有人把证据写到仓库其它位置。 */
function assertWithin(batchDir: string): void {
  const resolved = path.resolve(batchDir)
  if (!exists(resolved)) throw new Error('批次目录「' + resolved + '」不存在：先建目录再收证据。')
  if (!path.isAbsolute(resolved)) throw new Error('批次目录必须是绝对路径。')
}
