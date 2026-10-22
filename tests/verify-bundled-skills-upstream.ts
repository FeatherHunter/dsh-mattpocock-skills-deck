#!/usr/bin/env node
/**
 * tests/verify-bundled-skills-upstream.ts — 捆绑技能上游原文一字一致门禁（#1366 交棒 / 用户要求）
 *
 * 职责：package/bundled-skills/<name>/ 下每个上游原有文件，都必须与上游
 * mattpocock/skills 对应 pin 的原文一字一致（含标点、空格、换行语义），
 * 只要有一个字不一样就报错，且不允许更改。
 *
 * 比对口径：把上游与本地文件都按换行归一化（CRLF→LF）后算 SHA256，
 * 再与 tests/bundled-skills-upstream-hashes.json（同步时从上游 tag 生成）比对。
 * 归一化只为抹掉 Windows 检出换行差异；语义差一个字就会判红。
 *
 * 允许的例外（不在基线里，不判红）：
 *  - 各技能目录下的 SKILL.zh.md：本地简体中文译文包，上游没有，不是原文。
 *    注意：scripts/sync-matt-skills.mts 下次同步会整目录重建，译文包会被抹掉，
 *    译文应尽快搬出 bundled-skills 或教会同步脚本保留它们。
 *
 * 用法：在插件根目录执行 node --import ./scripts/ts-hook.mts tests/verify-bundled-skills-upstream.ts
 * 退出码 0 = 通过；1 = 失败
 */
const { readFileSync, existsSync, readdirSync } = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')

const ROOT: string = path.resolve(__dirname, '..')
const BUNDLED_DIR: string = path.join(ROOT, 'package/bundled-skills')
const MANIFEST: string = path.join(ROOT, 'tests/bundled-skills-upstream-hashes.json')
const VERSION_FILE: string = path.join(BUNDLED_DIR, 'VERSION')

let failures = 0
function fail(msg: string): void { console.log('[FAIL]', msg); failures++ }
function pass(msg: string): void { console.log('[PASS]', msg) }
function note(msg: string): void { console.log('[note]', msg) }

function norm(s: string): string { return s.replace(/\r\n/g, '\n') }
function sha(s: string): string { return createHash('sha256').update(norm(s), 'utf8').digest('hex') }

if (!existsSync(BUNDLED_DIR)) {
  note('package/bundled-skills 不存在，跳过上游一致校验')
  console.log('\n=== verify-bundled-skills-upstream ===')
  console.log('SKIP (no bundled)')
  process.exit(0)
}
if (!existsSync(MANIFEST)) {
  fail('缺基线 tests/bundled-skills-upstream-hashes.json：请先跑一次上游同步生成它（见本文件头注释）')
  console.log('\n=== verify-bundled-skills-upstream ===')
  console.log('FAIL')
  process.exit(1)
}

const manifest: any = JSON.parse(readFileSync(MANIFEST, 'utf8'))
const expectedPin: string = manifest.pin
const files: Record<string, string> = manifest.files || {}
const version: string = existsSync(VERSION_FILE) ? readFileSync(VERSION_FILE, 'utf8').trim() : ''
if (version !== expectedPin) {
  fail('VERSION 与基线 pin 不一致：VERSION=' + JSON.stringify(version) + ' 基线=' + JSON.stringify(expectedPin) + '。请用同步脚本重新同步并重录基线')
} else {
  pass('VERSION==' + expectedPin + ' 与基线一致')
}

let okCount = 0
const bad: string[] = []
for (const rel of Object.keys(files).sort()) {
  const p: string = path.join(BUNDLED_DIR, rel)
  if (!existsSync(p)) {
    fail('缺文件 ' + rel + '：上游 pin ' + expectedPin + ' 里有，本地被删了。请用同步脚本恢复，原文不允许删除')
    bad.push(rel)
    continue
  }
  const actual: string = sha(readFileSync(p, 'utf8'))
  if (actual !== files[rel]) {
    fail(rel + ' 与上游原文不一致（SHA256 ' + actual.slice(0, 12) + ' ≠ 上游 ' + String(files[rel]).slice(0, 12) + '）：必须和上游完全一致且不允许更改。请用同步脚本恢复原文，本地扩展搬到 bundled-skills 之外再做')
    bad.push(rel)
  } else {
    okCount++
  }
}
if (!bad.length) pass('上游原文 ' + okCount + ' 个文件一字一致')
else note('不一致 ' + bad.length + ' 个：' + bad.join('、'))

// 本地译文包清点（允许存在，只提示风险）
let zhCount = 0
for (const d of readdirSync(BUNDLED_DIR, { withFileTypes: true })) {
  if (!d.isDirectory()) continue
  if (existsSync(path.join(BUNDLED_DIR, d.name, 'SKILL.zh.md'))) zhCount++
}
note('本地译文包 SKILL.zh.md 共 ' + zhCount + ' 个（上游没有，允许存在；但下次同步整目录重建会抹掉它们，见头注释）')

console.log('\n=== verify-bundled-skills-upstream ===')
if (failures) { console.log('FAIL ' + failures + ' 项'); process.exit(1) }
console.log('PASS（' + okCount + ' 个上游原文文件一致）')
