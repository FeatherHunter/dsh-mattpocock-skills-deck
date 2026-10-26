#!/usr/bin/env node
// scripts/generate-prompt-config.mts —— 提示词 YAML 配置的生成器（#1292 立）。
//
// 读 config/prompts/ 下的五份模板族 YAML（三处片段按注入时机住在对应族里）、一份跨族公共小节 YAML
// （shared-sections.yaml：模板里的 {{shared:sharedTools}} 读的时候就展开成完整正文）与 config/languages.yaml，
// 由 scripts/lib/prompt-config.mts 校验、对得上 PROMPT_TEMPLATE_IDS / PROMPT_FRAGMENT_IDS / PROMPT_SHARED_SECTION_IDS 之后，
// 写成 src/client/kernel/prompt-data.ts —— 这份生成物不入库，构建时现场生成。
//
// 行为与 scripts/generate-time-config.mts 完全同款（见 docs/adr/20261016-time-config-yaml.md §2.2）。
// 区别只是这里产出的不是数字常量而是字符串文本与一份对象表 —— 但产物规则一致：
//   · 改 YAML 忘了跑生成器：typecheck 跑 --check 当场判红并提示跑一次
//   · 全新检出、还没跑过生成器：现场生成一次再判过，不让 typecheck 在新机器上永远先红一次
//
// 产物怎么进客户端闭包：这份 prompt-data.ts 由 scripts/build.mts 登记成内核模块 promptData，
//   在 src/client/index.ts 的 kernel:promptData 标记处（排在 kernel:prompts 之前）拼进去。
//   拼接机制吃的是 JavaScript 文本：构建先转译（esbuild）再剥行首 export，所以本文件里的
//   `export const` / `export type` / `export interface` 都会按各自该有的样子进闭包。
//
// 产物里为什么没有 use 字段：use 是「这条模板什么时候用」的一句人话，只给读代码的人看，
//   不是要发给用户看的文案。#1290 的验收明说「use 不出现在客户端产物」，所以 use 只留在
//   config/prompts/ 的 YAML 里，生成物不写它 —— 门禁要判 use 的文本时读 YAML 那一份。
//
// 用法（在仓库根目录）：
//   node scripts/generate-prompt-config.mts            按 YAML 重写 prompt-data.ts
//   node scripts/generate-prompt-config.mts --check   只比对，不写文件；
//       对不上时退出码 1（package.json 的 typecheck 脚本靠它看门）

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import url from 'node:url'
import {
  PROMPT_TEMPLATE_IDS,
  PROMPT_FRAGMENT_IDS,
  PROMPT_FAMILIES,
  readPromptConfig,
  validatePromptData,
  type PromptFamily,
} from './lib/prompt-config.mts'

const ROOT: string = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..')
const OUT_PATH: string = path.join(ROOT, 'src', 'client', 'kernel', 'prompt-data.ts')

/**
 * 按五族各造一份模板表，再汇总出模板表、片段表与语言清单三样。
 *
 * 产物 = 客户端内核闭包要的那一份真数据（运行时只读这份），因此生成的 TypeScript 必须满足两条：
 *   1. 生成的键联合类型 = PROMPT_TEMPLATE_IDS 的 id 联合 → 增 / 删模板遗漏时编译期就红
 *   2. 校验过（生成前再跑一遍 validatePromptData） → 缺 zh/en / 占位符声明不一致都当场红
 */
function render(): string {
  const data = readPromptConfig(ROOT)
  const errors = validatePromptData(data)
  if (errors.length) {
    throw new Error('YAML 校验失败（生成前必须修好）：\n  ' + errors.join('\n  '))
  }

  const lines: string[] = []
  lines.push('// prompt-data.ts —— 提示词配置的生成源码（#1292 立；构建时现场生成、不入库）。')
  lines.push('//')
  lines.push('// 人手不改：本文件由 scripts/generate-prompt-config.mts 按 config/languages.yaml 与 config/prompts/ 下的')
  lines.push('// 五份模板族 YAML 写出（片段与模板同住）。想改提示词文案请改 YAML 再跑生成器；漏改 YAML 直接手改这里的话，')
  lines.push('// 下一次生成会被覆盖（generate --check 也会判红），所以不要在源码里手工改这一段。')
  lines.push('')
  lines.push('/* eslint-disable */')
  lines.push('// tsc 会按本文件顶部的类型标注校验生成物 —— 类型只在文件头注释里用到，运行时只用 const 对象。')
  lines.push('/* tslint:disable */')
  lines.push('')

  // —— 共享类型（生成物顶端、消费方按这些类型去 import —— 等于把 KV 联合类型也带出来）
  // #1292：这些 `export` 在源码阶段有意义（门禁、typecheck 走源码）；构建时这一片按内核模块
  //   promptData 拼进客户端闭包，拼接机制自己剥行首 export，类型声明由转译整段去掉。
  lines.push('export interface PromptTemplateEntry {')
  lines.push('  version: number')
  lines.push('  placeholders: ReadonlyArray<string>')
  lines.push('  zh: string')
  lines.push('  en: string')
  lines.push('}')
  lines.push('')
  lines.push('export interface PromptFragmentShape {')
  lines.push('  zh?: string')
  lines.push('  en?: string')
  lines.push('  cli?: { readonly zh: string; readonly en: string }')
  lines.push('  cliBrand?: { readonly zh: string; readonly en: string }')
  lines.push('}')
  lines.push('')
  lines.push('export interface PromptLanguageEntry {')
  lines.push('  label: { readonly zh: string; readonly en: string }')
  lines.push('  fallback: ReadonlyArray<string>')
  lines.push('}')
  lines.push('')
  lines.push('export interface PromptLanguageConfig {')
  lines.push('  default: string')
  lines.push('  languages: Readonly<Record<string, PromptLanguageEntry>>')
  lines.push('}')
  lines.push('')

  // —— 模板 id 联合类型：与 PROMPT_TEMPLATE_IDS 一一对应；增 / 删模板时一并改
  lines.push('export type PromptTemplateId =')
  const sortedIds = PROMPT_TEMPLATE_IDS.map((s) => s.id).slice().sort()
  for (let i = 0; i < sortedIds.length; i++) {
    const id = sortedIds[i]
    lines.push('  | \'' + id + '\'')
  }
  lines.push('')
  // —— 模板的占位符声明映射
  lines.push('export type PromptTemplatePlaceholders = {')
  for (const spec of PROMPT_TEMPLATE_IDS) {
    lines.push('  \'' + spec.id + '\': ' + (spec.placeholders.length === 0 ? 'readonly []' : 'readonly [' + spec.placeholders.map((p) => '\'' + p + '\'').join(', ') + ']') + ',')
  }
  lines.push('}')
  lines.push('')

  // —— 模板数据：按族分表，再汇总成一份全表
  for (const fam of PROMPT_FAMILIES) {
    lines.push('// 族 ' + fam)
    lines.push('const TEMPLATES_' + fam.replace(/-/g, '_').toUpperCase() + ': Readonly<Record<string, PromptTemplateEntry>> = Object.freeze({')
    const table = data.templates[fam] || {}
    const ids = Object.keys(table).sort()
    for (const id of ids) {
      const e = table[id]
      lines.push('  ' + JSON.stringify(id) + ': Object.freeze({')
      lines.push('    version: ' + e.version + ',')
      lines.push('    placeholders: Object.freeze(' + JSON.stringify(e.placeholders) + ') as ReadonlyArray<string>,')
      lines.push('    zh: ' + JSON.stringify(e.zh) + ',')
      lines.push('    en: ' + JSON.stringify(e.en) + ',')
      lines.push('  }),')
    }
    lines.push('})')
    lines.push('')
  }
  // 五族的表合起来是一份全表。合并后的类型写成 Record<PromptTemplateId, ...>：
  //   键联合类型是生成物自己按 YAML 算出来的，所以「YAML 里少写一条 id」在这里就露出来（校验器也会当场红）。
  lines.push('export const PROMPT_TEMPLATE_DATA = Object.freeze({')
  for (const fam of PROMPT_FAMILIES) {
    lines.push('  ...TEMPLATES_' + fam.replace(/-/g, '_').toUpperCase() + ',')
  }
  lines.push('}) as Readonly<Record<PromptTemplateId, PromptTemplateEntry>>')
  lines.push('')

  // —— 片段数据
  lines.push('export const PROMPT_FRAGMENT_DATA: Readonly<Record<string, PromptFragmentShape>> = Object.freeze({')
  const fragIds = Object.keys(data.fragments || {}).sort()
  for (const id of fragIds) {
    const v = data.fragments[id]
    lines.push('  ' + JSON.stringify(id) + ': Object.freeze(' + JSON.stringify(v) + '),')
  }
  lines.push('})')
  lines.push('')

  // —— 语言清单
  lines.push('export const LANGUAGES_YAML: PromptLanguageConfig = Object.freeze({')
  lines.push('  default: ' + JSON.stringify(data.languages.default) + ',')
  lines.push('  languages: Object.freeze({')
  const langIds = Object.keys(data.languages.languages || {}).sort()
  for (const id of langIds) {
    const l = data.languages.languages[id]
    lines.push('    ' + JSON.stringify(id) + ': Object.freeze({')
    lines.push('      label: Object.freeze({ zh: ' + JSON.stringify(l.label.zh) + ', en: ' + JSON.stringify(l.label.en) + ' }),')
    lines.push('      fallback: Object.freeze(' + JSON.stringify(l.fallback) + ') as ReadonlyArray<string>,')
    lines.push('    }),')
  }
  lines.push('  }) as Readonly<Record<string, PromptLanguageEntry>>,')
  lines.push('})')
  lines.push('')
  return lines.join('\n')
}

/**
 * 主流程：--check 只比对不写文件；对不上就退出码 1（package.json 的 typecheck 脚本靠它看门）。
 *
 * 全新检出（生成物不在库里）时 --check 会先现场生成一份再判过 —— 与 generate-time-config.mts 同款，
 * 不让 typecheck 在新机器上永远先红一次。
 */
function main(): void {
  const checkOnly: boolean = process.argv.includes('--check')
  let text: string
  try {
    text = render() + '\n'
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
      // 全新检出、还没生成过：现场写一次再判过。
      mkdirSync(path.dirname(OUT_PATH), { recursive: true })
      writeFileSync(OUT_PATH, text)
      console.log('PASS 生成源码不在，已按 config/ 下的 YAML 现场生成（' + path.relative(ROOT, OUT_PATH) + '）')
      return
    }
    if (current !== text) {
      console.log('FAIL 生成源码与 config/ 下的 YAML 对不上：请先跑生成器 —— node scripts/generate-prompt-config.mts（重算后再提交）')
      process.exit(1)
    }
    console.log('PASS 生成源码与 config/ 下的 YAML 一致')
    return
  }
  mkdirSync(path.dirname(OUT_PATH), { recursive: true })
  writeFileSync(OUT_PATH, text)
  console.log('已按 config/ 下的 YAML 写出 ' + path.relative(ROOT, OUT_PATH))
}

main()
