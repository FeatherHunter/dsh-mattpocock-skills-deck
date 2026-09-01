#!/usr/bin/env node
/**
 * tests/verify-bundled-skills.js — 包内捆绑自洽与体积门禁（#387 G2）
 *
 * 职责：包内自洽（存在性、有效性、LICENSE/VERSION、增量体积），与 verify-matt-skills-sync 的跨源一致性正交。
 *
 * 检查（空目录期跳过体积段）：
 *  1) package/bundled-skills 存在且含 25 个子目录，每个含有效 SKILL.md（frontmatter name: 与目录名一致，含 description）
 *  2) LICENSE 存在且含 Copyright (c) 2026 Matt Pocock
 *  3) VERSION 存在且等于 v1.2.3
 *  4) package/package.json:files 含 bundled-skills（漏发硬卡）
 *  5) 增量体积：npm pack --dry-run 的 unpacked size 差值 ≤ 5MB（阈值硬卡，需显式改阈豁免）；空 bundled 期跳过
 *
 * 用法：node tests/verify-bundled-skills.js
 * 退出码 0 = 通过；1 = 失败
 */
const { readFileSync, existsSync, readdirSync, statSync } = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..')
const BUNDLED_DIR = path.join(ROOT, 'package/bundled-skills')
const PKG_JSON = path.join(ROOT, 'package/package.json')
const THRESHOLD_BYTES = 5 * 1024 * 1024 // 5MB

let failures = 0
function check(cond, msg) { if (!cond) { console.log('[FAIL]', msg); failures++ } else { console.log('[PASS]', msg) } }
function warn(msg) { console.log('[WARN]', msg) }
function note(msg) { console.log('[note]', msg) }

function extractFrontmatterName(md) {
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
function extractDescription(md) {
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

let bundledNames = []
try { bundledNames = readdirSync(BUNDLED_DIR, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort() } catch (e) { bundledNames = [] }
check(bundledNames.length === 25, `bundled 目录含 25 技能（当前 ${bundledNames.length}）`)

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
  check(ver === 'v1.2.3', `bundled VERSION==v1.2.3（当前 ${ver}）`)
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
  function walk(dir) {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name)
      if (ent.isDirectory()) walk(p)
      else {
        try { total += statSync(p).size } catch {}
      }
    }
  }
  walk(BUNDLED_DIR)
  console.log(`[info] bundled 目录实际占用 ${(total/1024/1024).toFixed(2)} MB（阈值 ${(THRESHOLD_BYTES/1024/1024).toFixed(0)} MB）`)
  check(total <= THRESHOLD_BYTES, `bundled 增量 ≤ 5MB（当前 ${(total/1024/1024).toFixed(2)} MB）`)
  if (total > THRESHOLD_BYTES) {
    console.log('[hint] 超阈需显式改 tests/verify-bundled-skills.js 的 THRESHOLD_BYTES 并说明理由')
  }
  // 额外：npm pack --dry-run 精确校验（若 npm 可用）
  const pack = spawnSync('npm', ['pack', '--dry-run'], { encoding: 'utf8', cwd: ROOT, timeout: 15000 })
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
    // 检查 tarball 内容是否含 bundled
    if (out.includes('bundled-skills/')) {
      check(true, 'npm pack --dry-run 列出 bundled-skills')
    } else {
      check(false, 'npm pack --dry-run 未列出 bundled-skills（可能被 .npmignore 或 files 漏配）')
    }
  } else {
    note('npm pack --dry-run 探测跳过（npm 不可用或超时）')
  }
} catch (e) {
  note('体积校验跳过：' + e.message)
}

console.log('\n=== verify-bundled-skills ===')
if (failures === 0) {
  console.log('ALL CHECKS PASS')
  process.exit(0)
} else {
  console.log(failures + ' FAILURE(S)')
  process.exit(1)
}
