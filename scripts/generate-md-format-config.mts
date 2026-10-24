#!/usr/bin/env node
// generate-md-format-config.mts —— Markdown 后端格式映射的生成器（#1480 T1 立）。
//
// 真源：src/tracker/rooms/markdown/format/original-skills.yaml（随包原文与本插件写法的对应关系）。
// 生成：src/tracker/rooms/markdown/format/generated.ts（构建期现场生成、不入库）。
//
// 为什么生成而不是运行时读 YAML：与 #1215 时间参数、#1292 提示词、#1294 界面词表同一条纪律——
// 宿主与客户端吃同一份构建期快照；YAML 只有一份真源，生成物不入库，改了 YAML 忘跑生成器时
// tests/verify-md-format-config.ts 与 package.json 的 typecheck 都会判红（--check）。
//
// 用法（在仓库根目录跑）：
//   node scripts/generate-md-format-config.mts            按 YAML 重写 generated.ts
//   node scripts/generate-md-format-config.mts --check    只比对，不写文件；对不上退出码 1；
//       生成物根本不在时（刚检出、还没跑过构建）现场生成一次再判过，不让人凭空先红一次。
//
// 缺键、未知键、引用不存在的原文 id 都是故障：生成器直接报错退出，不静默跳过。

import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'
import {
  MD_FORMAT_OUT_REL,
  MD_FORMAT_REL,
  readMdFormatConfig,
  readMdFormatText,
  renderMdFormatData,
} from './lib/md-format-config.mts'

const ROOT: string = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..')
const OUT_PATH: string = path.join(ROOT, MD_FORMAT_OUT_REL)

function main(): void {
  const checkOnly: boolean = process.argv.includes('--check')
  let config: Record<string, any>
  try {
    config = readMdFormatConfig(ROOT)
  } catch (err) {
    console.log('FAIL ' + (err as Error).message)
    process.exit(1)
  }
  const text: string = renderMdFormatData(config) + '\n'
  if (checkOnly) {
    let current: string | null = null
    try {
      current = fs.readFileSync(OUT_PATH, 'utf8')
    } catch {
      current = null
    }
    if (current === null) {
      // 全新检出、还没跑过构建：现场生成一次再判过，不然 typecheck 在新机器上永远先红一次。
      fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true })
      fs.writeFileSync(OUT_PATH, text)
      console.log('PASS 生成源码不在，已按 ' + MD_FORMAT_REL + ' 现场生成')
      return
    }
    if (current !== text) {
      console.log('FAIL 生成源码与 ' + MD_FORMAT_REL + ' 对不上：请跑 node scripts/generate-md-format-config.mts 重算后再提交')
      process.exit(1)
    }
    console.log('PASS 生成源码与 ' + MD_FORMAT_REL + ' 一致')
    return
  }
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true })
  fs.writeFileSync(OUT_PATH, text)
  console.log('已按 ' + MD_FORMAT_REL + ' 写出 ' + MD_FORMAT_OUT_REL)
  // 生成器读一遍原文文本只为确认它真的可读；空读会掩盖路径写错。
  void readMdFormatText(ROOT)
}

main()
