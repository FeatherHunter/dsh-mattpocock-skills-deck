// paths.mts —— DSH 程序位置、真实 home、仓库根、验证工作根与批次目录怎么找。
//
// 这台机器上的 DSH 安装位置写在默认值里；换机器时用参数或环境变量覆盖，不用改其它命令。
// 所有会写盘的路径都收在「验证工作根」之下：工作根默认是仓库内 .scratch/verify-run（已被 .gitignore 忽略），
// 也可以用环境变量 DSH_VERIFY_WORK_ROOT 指到别的盘（各命令另有 --out/--batch/--root 改单个目录）。为什么允许改工作根：
// 装依赖时 pnpm 要求目标盘与 pnpm store 同盘，而 store 在哪个盘因机器而异，所以工作根不能写死。

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { repoRoot } from './util.mts'

export interface DshPaths {
  /** DSH 桌面程序本体：可直接当 node 用（ELECTRON_RUN_AS_NODE=1）。 */
  exe: string
  /** asar 里的命令行入口：spawn 时作为第一个参数传给 exe。 */
  cli: string
}

/** 命令行覆盖优先，其次环境变量，最后是本机默认安装位置。找不到可执行文件时给出可操作的提示。 */
export function findDshPaths(overrides: { exe?: string; cli?: string } = {}): DshPaths {
  const exe = overrides.exe || process.env.DSH_EXE || 'D:/DeepseekHarness/DeepSeek Harness.exe'
  const cli =
    overrides.cli ||
    process.env.DSH_CLI_JS ||
    'D:/DeepseekHarness/resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js'
  if (!fs.existsSync(exe)) {
    throw new Error('找不到 DSH 程序「' + exe + '」：用 --exe 参数或环境变量 DSH_EXE 指到 DeepSeek Harness.exe。')
  }
  return { exe, cli }
}

/** 这台机器真实的 DSH home（里面放着 profiles 与真凭证）。默认取当前用户目录下的 .dsh。 */
export function realDshHome(override?: string): string {
  if (override) return path.resolve(override)
  if (process.env.DSH_REAL_HOME) return path.resolve(process.env.DSH_REAL_HOME)
  const userProfile = process.env.USERPROFILE || os.homedir()
  return path.join(userProfile, '.dsh')
}

export function repo(): string {
  return repoRoot()
}

/**
 * 验证工作根：批次目录、候选包、隔离 home、证据都写在这里。
 * 默认仓库内 .scratch/verify-run；环境变量 DSH_VERIFY_WORK_ROOT 优先，命令的 --out/--batch 只改单个目录。
 * 这个目录被 .gitignore 忽略，所以批次产物与候选 tgz 不会误进版本库。
 */
export function workRoot(override?: string): string {
  if (override) return path.resolve(override)
  if (process.env.DSH_VERIFY_WORK_ROOT) return path.resolve(process.env.DSH_VERIFY_WORK_ROOT)
  return path.join(repo(), '.scratch', 'verify-run')
}

/** 默认批次目录：<工作根>/batches/<名字>。 */
export function batchDir(name: string, workRootOverride?: string): string {
  return path.join(workRoot(workRootOverride), 'batches', name)
}

/**
 * 收 --batch 参数：批次名或批次目录路径都认。
 * 只写一个名字时按默认约定放到 <工作根>/batches/<名字>；带路径分隔符或盘符时按路径解析。
 * 命令层统一用它，避免同一个参数在不同命令里一个当名字、一个当路径。
 */
export function resolveBatchPath(value: string): string {
  const text = String(value || '').trim()
  if (!text) throw new Error('--batch 不能是空值：给批次名（默认在 <工作根>/batches 下）或批次目录路径。')
  if (path.isAbsolute(text) || text.includes('/') || text.includes('\\')) return path.resolve(text)
  return batchDir(text)
}

/**
 * 允许写的位置：验证工作根、系统临时目录，以及调用方显式传进来的额外目录（例如已存在的批次目录）。
 * 刻意不包含真实 DSH home：本工具只读真实 home，绝不往里面写。
 */
export function writableRoots(extra: string[] = []): string[] {
  return [workRoot(), path.resolve(os.tmpdir())].concat(extra.map((item) => path.resolve(item)))
}

/** 本工具写文件只允许落在允许位置里：防止误写真实 home、仓库源码与别的目录。 */
export function assertWritableTarget(target: string, extra: string[] = []): void {
  const resolved = path.resolve(target)
  const roots = writableRoots(extra)
  const allowed = roots.some((root) => resolved === root || resolved.startsWith(root + path.sep))
  if (!allowed) {
    throw new Error(
      '这次要写的「' + resolved + '」不在允许范围里：本工具只写 ' + roots.join('、') + ' 这些目录下的东西。' +
        '确实要换位置时用环境变量 DSH_VERIFY_WORK_ROOT 改工作根。',
    )
  }
}

/** Playwright 找不到浏览器时的提示：依赖里已经装了无头 Chromium，不需要联网重装。 */
export function playwrightBrowserHint(): string {
  return (
    'Playwright 起不来浏览器。仓库依赖里已经装了无头 Chromium，正常情况下直接可用；' +
    '如果提示浏览器缺失，先检查 PLAYWRIGHT_BROWSERS_PATH 环境变量是否被改成别处，' +
    '再确认仓库 node_modules 里的 playwright 版本。不要联网重装。'
  )
}
