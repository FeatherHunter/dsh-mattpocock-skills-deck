#!/usr/bin/env node
// scripts/generate-locale-config.mts —— 界面词表配置的生成器（#1294 立）。
//
// 读 config/copy/ 下的每族词表 YAML 与 config/languages.yaml，由 scripts/lib/copy-config.mts 校验之后，
// 写成 src/client/kernel/locale-data.ts —— 这份生成物不入库，构建时现场生成。
//
// 为什么界面文案要离开源码（docs/adr/20261020-ui-copy-data-driven.md）：
//   · 改一句话不用碰 TypeScript，也不用担心改坏组件逻辑；
//   · 语言清单 config/languages.yaml 是提示词与界面共用的一份，加一门语言只改 YAML；
//   · 生成物把「每门语言都有一份」写成编译期约束，漏译在 typecheck 当场红，而不是运行时界面显示键名。
//
// 行为与 scripts/generate-prompt-config.mts / generate-time-config.mts 同款：
//   · 改 YAML 忘了跑生成器：typecheck 跑 --check 当场判红并提示跑一次；
//   · 全新检出、还没跑过生成器：现场生成一次再判过，不让新机器上第一次 typecheck 永远先红。
//   · 生成物里的 {{时间参数}} 会按 src/shared/time-config/src/values.ts 烘成字面量。那个文件是另一份
//     生成物（config/ 下的三份时间参数 YAML → 时间参数域），本生成器不自己读 YAML，每次都先跑一次
//     时间参数生成器再读值：--check 模式下用它的 --check（只比不写，过期会当场说清是哪一份过期），
//     写盘模式下直接重算它就是「先刷新再烘」。这样不管两个生成器谁先跑，烘进词表里的数字都是当前
//     YAML 的值，不会出现「改了时间参数、重新生成词表却把旧数字烘进去」这种静默漂移。
//
// 产物怎么进客户端闭包：locale-data.ts 由 scripts/build.mts 登记成内核模块 localeData，
//   在 src/client/index.ts 的 kernel:localeData 标记处（排在 kernel:locale 之前）拼进去。
//   拼接机制吃的是 JavaScript 文本：构建先转译（esbuild）再剥行首 export，所以本文件里的
//   `export const` / `export type` / `export interface` 都会按各自该有的样子进闭包。
//
// 用法（在仓库根目录）：
//   node scripts/generate-locale-config.mts            按 YAML 重写 locale-data.ts
//   node scripts/generate-locale-config.mts --check   只比对，不写文件；
//       对不上时退出码 1（package.json 的 typecheck 脚本靠它看门）

import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import url from 'node:url'
import {
  readCopyConfig,
  validateCopyConfig,
  readTimeValues,
  renderLocaleData,
  LOCALE_DATA_REL,
} from './lib/copy-config.mts'

const ROOT: string = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..')
const OUT_PATH: string = path.join(ROOT, LOCALE_DATA_REL)

/**
 * 词表里的 {{时间参数}} 引用要先有一份时间参数生成物，且必须是当前 YAML 算出来的那一份。
 * 这里每次都调用时间参数生成器，不另写一遍读 YAML 的逻辑：
 *   · 写盘模式（build 里跑）：跑一次生成器把时间参数刷成最新，再把值烘进词表；
 *   · --check 模式：跑时间参数的 --check（只比对不写），它过期就当场报「时间参数生成物过期」，
 *     免得用户看到的是「界面词表对不上」而实际要修的是另一份生成物。
 * 全新检出时时间参数生成物不在盘上，它的 --check 会现场生成一份再判过（与另外两个生成器同款）。
 */
function loadTimeValues(checkOnly: boolean): Record<string, number> {
  const gen: string = path.join(ROOT, 'scripts', 'generate-time-config.mts')
  const args: string[] = checkOnly ? [gen, '--check'] : [gen]
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', cwd: ROOT })
  if (r.status !== 0) {
    throw new Error('中央时间参数生成物与 config/ 下的三份时间参数文件对不上（词表里的 {{时间参数}} 要用它烘成数字）：'
      + '先跑 node scripts/generate-time-config.mts 重算，再跑本生成器。\n'
      + String(r.stdout || '') + String(r.stderr || ''))
  }
  return readTimeValues(ROOT)
}

/**
 * 读 YAML → 校验 → 渲染成生成物文本。校验不过就抛（生成前必须修好 YAML，而不是写出一份坏数据）。
 */
function render(checkOnly: boolean): string {
  const config = readCopyConfig(ROOT)
  const timeValues = loadTimeValues(checkOnly)
  const errors: string[] = validateCopyConfig(config, timeValues)
  if (errors.length) {
    throw new Error('YAML 校验失败（生成前必须修好）：\n  ' + errors.join('\n  '))
  }
  return renderLocaleData(config, timeValues)
}

/**
 * 主流程：--check 只比对不写文件；对不上就退出码 1（package.json 的 typecheck 脚本靠它看门）。
 *
 * 全新检出（生成物不在库里）时 --check 会先现场生成一份再判过 —— 与另外两个生成器同款，
 * 不让 typecheck 在新机器上永远先红一次。
 */
function main(): void {
  const checkOnly: boolean = process.argv.includes('--check')
  let text: string
  try {
    text = render(checkOnly) + '\n'
  } catch (err) {
    console.log('FAIL ' + (err instanceof Error ? err.message : String(err)))
    process.exit(1)
  }
  if (checkOnly) {
    let current: string | null = null
    try {
      current = readFileSync(OUT_PATH, 'utf8')
    } catch {
      current = null
    }
    if (current === null) {
      mkdirSync(path.dirname(OUT_PATH), { recursive: true })
      writeFileSync(OUT_PATH, text)
      console.log('PASS 生成源码不在，已按 config/ 下的 YAML 现场生成（' + LOCALE_DATA_REL + '）')
      return
    }
    if (current !== text) {
      console.log('FAIL 生成源码与 config/ 下的 YAML 对不上：请先跑生成器 —— node scripts/generate-locale-config.mts（重算后再提交）')
      process.exit(1)
    }
    console.log('PASS 生成源码与 config/ 下的 YAML 一致')
    return
  }
  mkdirSync(path.dirname(OUT_PATH), { recursive: true })
  writeFileSync(OUT_PATH, text)
  console.log('已按 config/ 下的 YAML 写出 ' + LOCALE_DATA_REL)
}

main()
