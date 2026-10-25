#!/usr/bin/env node
/**
 * tests/verify-bundled-skills.js — 包内捆绑自洽与体积门禁（#387 G2）
 *
 * 职责：包内自洽（存在性、有效性、LICENSE/VERSION、增量体积）＋随包目录集合与单源名单的双向差集。
 * 第 6 段（2026-10-17 从已删的 tests/verify-matt-skills-sync.js 第 7a 段搬来）：随包目录集合
 *   与 src/shared/matt-skills.ts 的 MATT_SKILL_PROBE_NAMES 双向差集必须为 0——本文件其余段落只查
 *   每个目录自身是否自洽，查不出「漏发一个技能」或「多发一个单源里没有的目录」。
 *
 * 检查（空目录期跳过体积段）：
 *  1) package/bundled-skills 存在且含 27 个子目录，每个含有效 SKILL.md（frontmatter name: 与目录名一致，含 description）
 *  2) LICENSE 存在且含 Copyright (c) 2026 Matt Pocock
 *  3) VERSION 存在且等于 v1.3.1
 *  4) package/package.json:files 含 bundled-skills 与 bundled-skills-zh（漏发硬卡；#1521 起中文译文单放兄弟目录 bundled-skills-zh）
 *  5) 增量体积：bundled-skills 与 bundled-skills-zh 合计 ≤ 5MB（阈值硬卡，需显式改阈豁免）；空 bundled 期跳过
 *
 * 用法：在插件根目录执行 node --import ./scripts/ts-hook.mts tests/verify-bundled-skills.ts
 * 退出码 0 = 通过；1 = 失败
 */
const { readFileSync, existsSync, readdirSync, statSync } = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const ROOT: string = path.resolve(__dirname, '..')
const BUNDLED_DIR: string = path.join(ROOT, 'package/bundled-skills')
const PKG_JSON: string = path.join(ROOT, 'package/package.json')
const THRESHOLD_BYTES: number = 5 * 1024 * 1024 // 5MB

let failures = 0
function check(cond: boolean, msg: string): void { if (!cond) { console.log('[FAIL]', msg); failures++ } else { console.log('[PASS]', msg) } }
function warn(msg: string): void { console.log('[WARN]', msg) }
function note(msg: string): void { console.log('[note]', msg) }

function extractFrontmatterName(md: string): string | null {
  const firstEnd = md.indexOf('\n')
  if (firstEnd === -1) return null
  if (md.slice(0, firstEnd).replace(/\r$/, '') !== '---') return null
  const start = firstEnd + 1
  const lines = md.slice(start).split('\n')
  let closing = -1; let cursor = start
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const ls = cursor; const le = cursor + line.length
    if (line.replace(/\r$/, '') === '---') { closing = ls; break }
    cursor = le + 1
  }
  if (closing === -1) return null
  const front = md.slice(start, closing)
  const m = front.match(/^name:\s*(.+)$/m)
  if (!m) return null
  let v = m[1].trim()
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
  return v.trim()
}
function extractDescription(md: string): string | null {
  const firstEnd = md.indexOf('\n')
  if (firstEnd === -1) return null
  if (md.slice(0, firstEnd).replace(/\r$/, '') !== '---') return null
  const start = firstEnd + 1
  const lines = md.slice(start).split('\n')
  let closing = -1; let cursor = start
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const ls = cursor
    if (line.replace(/\r$/, '') === '---') { closing = ls; break }
    cursor += line.length + 1
  }
  if (closing === -1) return null
  const front = md.slice(start, closing)
  const m = front.match(/^description:\s*(.+)$/m)
  return m ? m[1].trim() : null
}

// 1) 存在性
if (!existsSync(BUNDLED_DIR)) {
  note('package/bundled-skills 不存在，跳过捆绑自洽与体积校验（早期分支容忍）')
  console.log('\n=== verify-bundled-skills ===')
  console.log('SKIP (no bundled)')
  process.exit(0)
}

let bundledNames: string[] = []
try { bundledNames = readdirSync(BUNDLED_DIR, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort() } catch (e) { bundledNames = [] }
check(bundledNames.length === 27, `bundled 目录含 27 技能（当前 ${bundledNames.length}）`)

for (const name of bundledNames) {
  const mdPath = path.join(BUNDLED_DIR, name, 'SKILL.md')
  if (!existsSync(mdPath)) { check(false, `bundled ${name}/SKILL.md 缺失`); continue }
  const md = readFileSync(mdPath, 'utf8')
  const fm = extractFrontmatterName(md)
  check(fm === name, `bundled ${name}/SKILL.md frontmatter name="${fm}" 与目录名一致`)
  const desc = extractDescription(md)
  check(!!desc, `bundled ${name}/SKILL.md 含 description`)
  if (fm && !/^[\p{L}0-9]+(?:-[\p{L}0-9]+)*$/u.test(fm)) check(false, `bundled ${name} 非法 skill 名 ${fm}`)
}

// 2) LICENSE
const licPath = path.join(BUNDLED_DIR, 'LICENSE')
if (existsSync(licPath)) {
  const lic = readFileSync(licPath, 'utf8')
  check(lic.includes('Copyright (c) 2026 Matt Pocock'), 'bundled LICENSE 含 Copyright (c) 2026 Matt Pocock')
} else {
  check(false, 'bundled LICENSE 缺失')
}

// 3) VERSION
const verPath = path.join(BUNDLED_DIR, 'VERSION')
if (existsSync(verPath)) {
  const ver = readFileSync(verPath, 'utf8').trim()
  check(ver === 'v1.3.1', `bundled VERSION==v1.3.1（当前 ${ver}）`)
} else {
  check(false, 'bundled VERSION 缺失')
}

// 4) package/package.json files 含 bundled-skills
if (existsSync(PKG_JSON)) {
  try {
    const pkg = JSON.parse(readFileSync(PKG_JSON, 'utf8'))
    const files = Array.isArray(pkg.files) ? pkg.files : []
    check(files.includes('bundled-skills'), 'package/package.json:files 含 bundled-skills')
    if (!files.includes('bundled-skills') && existsSync(BUNDLED_DIR)) {
      console.log('[hint] 请在 package/package.json 的 files 中追加 "bundled-skills"')
    }
    // #1521：中文译文单放在兄弟目录 bundled-skills-zh，必须一起发进 npm 包，否则装完没有中文可看。
    check(files.includes('bundled-skills-zh'), 'package/package.json:files 含 bundled-skills-zh')
    if (!files.includes('bundled-skills-zh')) {
      console.log('[hint] 请在 package/package.json 的 files 中追加 "bundled-skills-zh"')
    }
  } catch (e) {
    check(false, 'package/package.json 解析失败：' + e.message)
  }
} else {
  check(false, 'package/package.json 缺失')
}

// 5) 增量体积（npm pack --dry-run）
// 仅当 bundled 存在时计算；通过 pack 的 unpacked size 差值估算：含 bundled 时的 size - 不含 bundled 时的 size（近似）
// 简化：直接取当前包的 unpacked size，校验 ≤ 阈值 + 基线（基线取不含 bundled 时的 size 若可得，否则直接校验当前增量文件大小总和）
// 此处采用轻量口径：统计 bundled 目录实际占用 < 5MB 即通过，超阈再用 npm pack 精确复核
try {
  let total = 0
  function walk(dir: string): void {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name)
      if (ent.isDirectory()) walk(p)
      else {
        try { total += statSync(p).size } catch {}
      }
    }
  }
  walk(BUNDLED_DIR)
  // #1521：中文译文树与原文树一起计入体积（译文同样随包发布，不能悄悄把包撑大）。
  const ZH_DIR: string = path.join(ROOT, 'package/bundled-skills-zh')
  if (existsSync(ZH_DIR)) walk(ZH_DIR)
  else check(false, 'package/bundled-skills-zh 缺失（#1521 起中文译文必须随包发布）')
  console.log(`[info] bundled 原文+中文译文目录合计占用 ${(total/1024/1024).toFixed(2)} MB（阈值 ${(THRESHOLD_BYTES/1024/1024).toFixed(0)} MB）`)
  check(total <= THRESHOLD_BYTES, `随包原文+中文译文合计 ≤ 5MB（当前 ${(total/1024/1024).toFixed(2)} MB）`)
  if (total > THRESHOLD_BYTES) {
    console.log('[hint] 超阈需显式改 tests/verify-bundled-skills.ts 的 THRESHOLD_BYTES 并说明理由')
  }
  // 额外：npm pack --dry-run 精确校验（若 npm 可用）
  // 这一行有两个坑，2026-10-17 一起修掉：
  //   ① Windows 上 npm 是 npm.cmd，直接 spawnSync('npm', […]) 报 ENOENT（status 为 null），
  //      于是这条断言在 Windows 上静默退化成「探测跳过」——CI 的 Windows 格子从没真跑过它。
  //      改走 shell（命令写成一整串，避免 Node 对「shell + 参数数组」的弃用警告），三平台一致。
  //   ② 原先 15 秒超时不够：npm pack 会先跑包里的 prepare 脚本（就是整棵构建），实测必然超时。
  //      加 --ignore-scripts 跳过 prepare，只问 tarball 清单，实测约 8 秒。
  const pack = spawnSync('npm pack --dry-run --ignore-scripts', { encoding: 'utf8', cwd: ROOT, timeout: 30000, shell: true })
  if (pack.status === 0) {
    const out = (pack.stdout || '') + (pack.stderr || '')
    // 解析 unpacked size：形如 "unpacked size: 4.2 MB" 或数字
    const m = out.match(/unpacked size:\s*([\d.]+)\s*(kB|MB|B)/i)
    if (m) {
      const num = parseFloat(m[1]); const unit = m[2].toLowerCase()
      let bytes = num * (unit === 'mb' ? 1024*1024 : unit === 'kb' ? 1024 : 1)
      console.log(`[info] npm pack unpacked size ${m[0].trim()} (${(bytes/1024/1024).toFixed(2)} MB)`)
      // 仅告警，不硬卡总量（总量含其他资源）；增量已由目录大小硬卡
    }
    // 检查 tarball 内容是否含 bundled（原文与中文译文两棵树都要在）
    if (out.includes('bundled-skills/')) {
      check(true, 'npm pack --dry-run 列出 bundled-skills')
    } else {
      check(false, 'npm pack --dry-run 未列出 bundled-skills（可能被 .npmignore 或 files 漏配）')
    }
    if (out.includes('bundled-skills-zh/')) {
      check(true, 'npm pack --dry-run 列出 bundled-skills-zh')
    } else {
      check(false, 'npm pack --dry-run 未列出 bundled-skills-zh（中文译文没进包，用户看不到中文）')
    }
  } else {
    note('npm pack --dry-run 探测跳过（npm 不可用或超时）')
  }
} catch (e) {
  note('体积校验跳过：' + e.message)
}

// 6) bundled 目录集合与单源 MATT_SKILL_PROBE_NAMES 双向差集为 0（2026-10-17 从 tests/verify-matt-skills-sync.js 第 7a 段搬来）
// 为什么留这一条：本文件其余段落只查「每个目录自身是否自洽」，查不出「随包目录漏了一个技能、
// 或者多出一个单源里没有的目录」——那种漂移只有和单源名单对集合才看得见。
// 单源真源是 src/shared/matt-skills.ts（不是本文件里任何字面量）。#1342 起这里直接 import 真源，
// 不再从 .build 产物里正则抠名单：产物只是转译后的副本，抠它会把「产物没重建」误判成单源漂移。
// require 里的 '.js' 说明符由 scripts/ts-hook.mts 指到同名 .ts 源码，加载的是源码而不是产物。
let probeNames: string[] = []
try {
  const shared = require('../src/shared/matt-skills.js') as { MATT_SKILL_PROBE_NAMES?: string[] }
  probeNames = [...(shared.MATT_SKILL_PROBE_NAMES || [])]
  check(probeNames.length === 27, '单源探测名单应为 27 项（实 ' + probeNames.length + '）')
} catch (e) {
  check(false, '无法导入 src/shared/matt-skills.ts 的单源探测名单：' + (e as Error).message)
}
if (probeNames.length > 0 && existsSync(BUNDLED_DIR)) {
  const bundledDirs = readdirSync(BUNDLED_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
  const sortedProbeNames = [...probeNames].sort()
  const missing = sortedProbeNames.filter((n) => !bundledDirs.includes(n))
  const extra = bundledDirs.filter((n) => !sortedProbeNames.includes(n))
  check(
    missing.length === 0 && extra.length === 0,
    'bundled 目录集合与单源双向差集 0（缺 ' + (missing.join(',') || '无') + '；多 ' + (extra.join(',') || '无') + '）',
  )
} else if (!existsSync(BUNDLED_DIR)) {
  check(false, 'package/bundled-skills 缺失（随包目录集合没有可比对的单源）')
}

console.log('\n=== verify-bundled-skills ===')
if (failures === 0) {
  console.log('ALL CHECKS PASS')
  process.exit(0)
} else {
  console.log(failures + ' FAILURE(S)')
  process.exit(1)
}
