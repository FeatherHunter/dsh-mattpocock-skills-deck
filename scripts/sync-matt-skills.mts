#!/usr/bin/env node
// 迁移说明（#1252）：本文件由 scripts/sync-matt-skills.mjs 转写而来，只加类型注解，行为零变化。
/**
 * scripts/sync-matt-skills.mts — 捆绑技能同步脚本（#386 G1 / #387 G2 / #388 T1）
 *
 * 作用：把上游 mattpocock/skills 的 27 个技能（engineering 20 + productivity 7）以 pin 指向的 tag 同步到 package/bundled-skills/
 *  - git clone --depth 1 --branch <pin> https://github.com/mattpocock/skills → 临时目录
 *  - 拷 skills/engineering + skills/productivity 的 27 个目录到 package/bundled-skills/<name>/（整目录复制，保留 SKILL.md）
 *  - 校验每技能 SKILL.md frontmatter 的 name: 与目录名一致（isSkillCardValid 同口径）
 *  - 拷 LICENSE 到 package/bundled-skills/LICENSE，并写入 package/bundled-skills/VERSION 为 pin 值
 *
 * 用法：
 *   node scripts/sync-matt-skills.mts --pin v1.3.2 --verify
 *   node scripts/sync-matt-skills.mts --pin v1.3.2          # 仅同步，不校验
 *   node scripts/sync-matt-skills.mts --help
 *
 * 设计要点（对齐 G2 定版）：
 *  - 纯手动：不挂 prepare/prebuild，构建不自动联网；幂等（同 pin 重跑零 diff）
 *  - 单源：src/shared/matt-skills.ts 的 MATT_SKILL_PROBE_NAMES 为 27 项真源，同步后与之双向差集为 0
 *  - 校验：--verify 时在同步后自检（27 数、集合一致、frontmatter、LICENSE、VERSION）
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, rmSync, cpSync } from 'node:fs'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
// #1342：名单直接从真源模块导入，不再用正则从源码文本里抠名字——后者改一处缩进就可能抠空。
import { MATT_SKILL_PROBE_NAMES } from '../src/shared/matt-skills.ts'

const ROOT: string = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PIN_DEFAULT: string = 'v1.3.2'
const REPO_URL: string = 'https://github.com/mattpocock/skills'
const DEST_DIR: string = join(ROOT, 'package', 'bundled-skills')

type SyncArgs = { pin: string; verify: boolean; help: boolean }

function parseArgs(argv: string[]): SyncArgs {
  const out: SyncArgs = { pin: PIN_DEFAULT, verify: false, help: false }
  for (let i: number = 0; i < argv.length; i++) {
    const a: string = argv[i]
    if (a === '--pin' && argv[i + 1]) { out.pin = argv[++i].startsWith('v') ? argv[i] : 'v' + argv[i]; }
    else if (a.startsWith('--pin=')) { const v: string = a.slice('--pin='.length); out.pin = v.startsWith('v') ? v : 'v' + v }
    else if (a === '--verify') out.verify = true
    else if (a === '--help' || a === '-h') out.help = true
  }
  return out
}

function helpText(): string {
  return `sync-matt-skills.mts — 同步 mattpocock/skills 到 package/bundled-skills/

用法：
  node scripts/sync-matt-skills.mts [--pin v1.3.2] [--verify]

选项：
  --pin <tag>   上游 tag，默认 v1.3.2（带或不带 v 前缀均可）
  --verify      同步后自校验（27 项一致、frontmatter、LICENSE、VERSION）
  --help        显示此帮助
`
}

function readSharedNames(): string[] {
  return [...MATT_SKILL_PROBE_NAMES]
}

function extractFrontmatterName(skillMd: string): string | undefined {
  // 复刻 dsh-skill-filesystem 的 parseFrontmatter 判据：首行 --- 到下一个独立行 --- 内的 YAML name:
  const firstEnd: number = skillMd.indexOf('\n')
  if (firstEnd < 0) return undefined
  if (skillMd.slice(0, firstEnd).replace(/\r$/, '') !== '---') return undefined
  const start: number = firstEnd + 1
  // 找下一个独立行的 ---
  const lines: string[] = skillMd.slice(start).split('\n')
  let closingIdx: number = -1
  let cursor: number = start
  for (let i: number = 0; i < lines.length; i++) {
    const line: string = lines[i]
    const lineStart: number = cursor
    const lineEnd: number = cursor + line.length
    if (line.replace(/\r$/, '') === '---') { closingIdx = lineStart; break }
    cursor = lineEnd + 1 // + \n
  }
  if (closingIdx === -1) return undefined
  const front: string = skillMd.slice(start, closingIdx)
  const mm: RegExpMatchArray | null = front.match(/^name:\s*(.+)$/m)
  if (!mm) return undefined
  let v: string = mm[1].trim()
  // 去引号
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
  return v.trim()
}

function isValidSkillName(name: string): boolean {
  return /^[\p{L}0-9]+(?:-[\p{L}0-9]+)*$/u.test(name)
}

function run(cmd: string, args: string[], opts: any = {}): any {
  const r: any = spawnSync(cmd, args, { encoding: 'utf8', ...opts })
  return r
}

async function main(): Promise<void> {
  const args: SyncArgs = parseArgs(process.argv.slice(2))
  if (args.help) { console.log(helpText()); process.exit(0) }
  const pin: string = args.pin
  console.log(`[sync:matt] pin=${pin} repo=${REPO_URL} dest=${DEST_DIR}`)

  const expected: string[] = readSharedNames()
  console.log(`[sync:matt] shared 单源 27 项已加载：${expected.length} 项`)
  if (expected.length !== 27) {
    console.error(`[sync:matt] 错误：shared 单源应为 27 项，当前 ${expected.length}`)
    process.exit(1)
  }

  // 1. 准备临时克隆目录
  const tmpBase: string = join(tmpdir(), `matt-skills-sync-${Date.now()}`)
  mkdirSync(tmpBase, { recursive: true })
  const cloneDir: string = join(tmpBase, 'skills')
  console.log(`[sync:matt] 克隆 ${REPO_URL} --branch ${pin} --depth 1 → ${cloneDir}`)
  let cloneOk: boolean = false
  // 若已存在旧的 /tmp/matt-skills-test 可复用（本地已克隆过），先尝试复用以省时
  const reuseCandidate: string = join('/tmp', 'matt-skills-test')
  let sourceRoot: string | null = null
  if (existsSync(join(reuseCandidate, 'skills', 'engineering', 'ask-matt', 'SKILL.md'))) {
    // 检查复用候选的版本是否匹配 pin（读 package.json version）
    try {
      const pkgRaw: string = readFileSync(join(reuseCandidate, 'package.json'), 'utf8')
      const ver: any = JSON.parse(pkgRaw).version
      const tagVer: string = pin.startsWith('v') ? pin.slice(1) : pin
      if (ver === tagVer) {
        console.log(`[sync:matt] 复用本地已有克隆 ${reuseCandidate} (v${ver})`)
        sourceRoot = reuseCandidate
        cloneOk = true
      } else {
        console.log(`[sync:matt] 本地复用候选版本 v${ver} ≠ ${pin}，重新克隆`)
      }
    } catch {}
  }
  if (!cloneOk) {
    const r: any = run('git', ['clone', '--depth', '1', '--branch', pin, REPO_URL, cloneDir])
    if (r.status !== 0) {
      console.error(`[sync:matt] git clone 失败：${r.stderr || r.stdout}`)
      console.error('[sync:matt] 若离线或网络不可用，请手动把上游 skills 目录拷到临时位置后重跑，或检查 pin 是否存在')
      // 尝试列出远程 tag 以提示
      const ls: any = run('git', ['ls-remote', '--tags', REPO_URL])
      if (ls.status === 0) {
        const tags: string[] = ls.stdout.split('\n').map((l: string) => l.split('/').pop()).filter(Boolean).slice(-10)
        console.error(`[sync:matt] 远程最近 tags: ${tags.join(', ')}`)
      }
      process.exit(1)
    }
    sourceRoot = cloneDir
  }

  const engDir: string = join(sourceRoot, 'skills', 'engineering')
  const prodDir: string = join(sourceRoot, 'skills', 'productivity')
  if (!existsSync(engDir) || !existsSync(prodDir)) {
    console.error(`[sync:matt] 克隆后未找到 skills/engineering 或 skills/productivity：${sourceRoot}`)
    process.exit(1)
  }

  const engNames: string[] = readdirSync(engDir, { withFileTypes: true }).filter((d: any) => d.isDirectory()).map((d: any) => d.name).sort()
  const prodNames: string[] = readdirSync(prodDir, { withFileTypes: true }).filter((d: any) => d.isDirectory()).map((d: any) => d.name).sort()
  const upstreamNames: string[] = [...engNames, ...prodNames].sort()
  console.log(`[sync:matt] 上游 engineering=${engNames.length} productivity=${prodNames.length} 合计=${upstreamNames.length}`)

  // 校验上游集合与 shared 单源一致（双向差集）
  const missing: string[] = expected.filter((n: string) => !upstreamNames.includes(n))
  const extra: string[] = upstreamNames.filter((n: string) => !expected.includes(n))
  if (missing.length || extra.length) {
    console.error(`[sync:matt] 上游集合与单源不一致：缺 ${missing.join(', ') || '无'}；多 ${extra.join(', ') || '无'}`)
    console.error('[sync:matt] 请检查 pin 是否为 v1.3.2，或 shared 单源是否已漂移')
    process.exit(1)
  }

  // 2. 清理并重建目标目录
  if (existsSync(DEST_DIR)) {
    console.log(`[sync:matt] 清理旧 ${DEST_DIR}`)
    rmSync(DEST_DIR, { recursive: true, force: true })
  }
  mkdirSync(DEST_DIR, { recursive: true })

  // 3. 逐技能复制
  let copied: number = 0
  for (const name of expected) {
    const srcDir: string = existsSync(join(engDir, name)) ? join(engDir, name) : join(prodDir, name)
    const dstDir: string = join(DEST_DIR, name)
    if (!existsSync(join(srcDir, 'SKILL.md'))) {
      console.error(`[sync:matt] 缺 SKILL.md：${srcDir}`)
      process.exit(1)
    }
    // 整目录复制（保留 SKILL.md 及可能的附属文件）
    cpSync(srcDir, dstDir, { recursive: true, force: true })
    // 校验 frontmatter name
    const md: string = readFileSync(join(dstDir, 'SKILL.md'), 'utf8')
    const fmName: string | undefined = extractFrontmatterName(md)
    if (!fmName) {
      console.error(`[sync:matt] ${name}/SKILL.md frontmatter 缺 name:`)
      process.exit(1)
    }
    if (fmName !== name) {
      console.error(`[sync:matt] ${name}/SKILL.md frontmatter name=${fmName} ≠ 目录名 ${name}`)
      process.exit(1)
    }
    if (!isValidSkillName(fmName)) {
      console.error(`[sync:matt] ${name} 非法 skill 名：${fmName}`)
      process.exit(1)
    }
    copied++
  }
  console.log(`[sync:matt] 已复制 ${copied}/27 技能到 ${DEST_DIR}`)

  // 4. 拷 LICENSE
  const srcLicense: string = join(sourceRoot, 'LICENSE')
  const dstLicense: string = join(DEST_DIR, 'LICENSE')
  if (!existsSync(srcLicense)) {
    console.error('[sync:matt] 上游缺 LICENSE')
    process.exit(1)
  }
  const licText: string = readFileSync(srcLicense, 'utf8')
  if (!licText.includes('Copyright (c) 2026 Matt Pocock')) {
    console.warn('[sync:matt] 警告：LICENSE 未含 Copyright (c) 2026 Matt Pocock，仍写入')
  }
  writeFileSync(dstLicense, licText, 'utf8')
  console.log('[sync:matt] 已写入 LICENSE')

  // 5. 写 VERSION
  const dstVersion: string = join(DEST_DIR, 'VERSION')
  writeFileSync(dstVersion, pin + '\n', 'utf8')
  console.log(`[sync:matt] 已写入 VERSION=${pin}`)

  // 6. 写 README.md（可选，说明来源）
  const dstReadme: string = join(DEST_DIR, 'README.md')
  const readme: string = '# Bundled Skills (mattpocock/skills ' + pin + ')\n\n本目录由 `scripts/sync-matt-skills.mts --pin ' + pin + '` 从 https://github.com/mattpocock/skills 同步而来，含 27 个技能（engineering 20 + productivity 7）。\n\n- 单源：`src/shared/matt-skills.js` 的 27 项（MATT_SKILL_PROBE_NAMES）为真源，与本目录双向差集为 0。\n- 产物：`package/bundled-skills/<name>/SKILL.md`（frontmatter name: 与目录名一致，符合 dsh-skill-filesystem 的 discoverRoot 校验）。\n- 版本：`VERSION` 溯源 pin，`LICENSE` 保留上游 MIT 声明（Copyright (c) 2026 Matt Pocock）。\n- 同步：纯手动 `pnpm run sync:matt`（`node scripts/sync-matt-skills.mts --pin ' + pin + ' --verify`），不挂 prepare/prebuild。\n';
  writeFileSync(dstReadme, readme, 'utf8')
  console.log('[sync:matt] 已写入 README.md')

  // 7. 清理临时克隆（若是新克隆的 tmpBase）
  if (sourceRoot === cloneDir) {
    try { rmSync(tmpBase, { recursive: true, force: true }) } catch {}
  }

  // 8. 自校验（--verify）
  if (args.verify) {
    console.log('[sync:matt] --verify 自校验开始')
    let failures: number = 0
    const check = (cond: any, msg: any): void => {
      if (!cond) { console.error('[FAIL]', msg); failures++ } else { console.log('[PASS]', msg) }
    }
    // a) 25 目录数与集合
    const got: string[] = readdirSync(DEST_DIR, { withFileTypes: true }).filter((d: any) => d.isDirectory()).map((d: any) => d.name).sort()
    check(got.length === 27, `bundled 目录数 27（当前 ${got.length}）`)
    const miss2: string[] = expected.filter((n: string) => !got.includes(n))
    const extra2: string[] = got.filter((n: string) => !expected.includes(n))
    check(miss2.length === 0 && extra2.length === 0, `集合与单源双向差集 0（缺 ${miss2.join(',')||'无'}；多 ${extra2.join(',')||'无'}）`)
    // b) 逐目录 name:
    for (const name of expected) {
      const md: string = readFileSync(join(DEST_DIR, name, 'SKILL.md'), 'utf8')
      const fm: string | undefined = extractFrontmatterName(md)
      check(fm === name, `${name}/SKILL.md name:=${fm} 与目录名一致`)
    }
    // c) LICENSE 与 VERSION
    const lic2: string = readFileSync(dstLicense, 'utf8')
    check(lic2.includes('Copyright (c) 2026 Matt Pocock'), 'LICENSE 含 Copyright (c) 2026 Matt Pocock')
    const ver2: string = readFileSync(dstVersion, 'utf8').trim()
    check(ver2 === pin, `VERSION==${pin}（当前 ${ver2}）`)
    if (failures) {
      console.error(`[sync:matt] 自校验失败 ${failures} 项`)
      process.exit(1)
    }
    console.log('[sync:matt] 自校验全部通过')
  }

  console.log(`[sync:matt] 完成：${copied} 技能已同步到 ${DEST_DIR}（pin ${pin}）`)
}

main().catch((e) => { console.error('[sync:matt] 异常', e); process.exit(1) })
