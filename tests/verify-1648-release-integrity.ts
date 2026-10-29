// tests/verify-1648-release-integrity.ts —— #1648「发布脚本自己证明发出去的字节与 dist-tag 指向」门禁
// 用法：node --import ./scripts/ts-hook.mts tests/verify-1648-release-integrity.ts（在插件根目录；
//       动态部分只打 127.0.0.1 上的自建假 registry，不需要外网，也不动真 registry）
//
// #1648 要解决的是两次「靠人发现」的事故：发布包与候选包差 102 字节、latest 与 beta 指向不一致。
// 这扇门禁从三个层面钉住现在的机器判据：
//   一、静态：发布脚本里确实只有一次构建 + 唯一裁决入口；对账/核对/证据三类标记与命令都在；
//       发布记录评论的正文由可单独调用的纯函数拼出来，并带逐文件清单与 tag 指向。
//   二、单测：release-integrity.mts 的 tar 逐文件清单（含 pax 长路径）、清单指纹、逐文件差异定位、
//       tag 策略（预发布/稳定/倒退/beta 指向正式号）各自按纯函数验一遍。
//   三、动态：在临时目录搭一个假仓库 + 假 registry，真跑 pwsh 发布脚本，验四条关键路径——策略不允许时
//       不进发布；发布前补跑 prepublishOnly 后字节变了就停、且没向 registry 发 PUT；预发布版本发布后
//       latest 与 beta 都指到新版本、证据交给收尾脚本；稳定版本只动 latest、beta 保持原样。
//       pwsh 不可用时（非 Windows 的机器等）静态与单测照跑、动态明确跳过并打 INFO。
//
// 门禁归属: scripts/publish-token.ps1
// 门禁归属: scripts/release-integrity.mts
// 门禁归属: scripts/release-postflight.mts
// 门禁归属: docs/releases/RELEASE-RUNBOOK.md
// 另外守 docs/agents/real-machine-verification.md：该文件不在 gate-map 的目录前缀名单里会写丢归属行，
// 与 verify-1646 同样只在静态断言里查它。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import cp from 'node:child_process'
import zlib from 'node:zlib'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

import {
  buildManifest,
  compareManifests,
  compareVersions,
  digestOfFiles,
  parseSemver,
  planTags,
  readTarEntries,
  verifyTags,
} from '../scripts/release-integrity.mts'
import { buildPublishRecordLines } from '../scripts/release-postflight.mts'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SCRIPT = path.join(ROOT, 'scripts', 'publish-token.ps1')
const INTEGRITY = path.join(ROOT, 'scripts', 'release-integrity.mts')
const PWSH = (process.env.PWSH || '').trim() || 'pwsh'
const PKG = 'verify-1648-fake-pkg'
const TOKEN = 'fake1648token-not-a-real-secret'

let failed = false
let total = 0
function check(ok: unknown, msg: string): void {
  total += 1
  if (!ok) failed = true
  console.log((ok ? '  PASS ' : '  FAIL ') + msg)
}

console.log('发布自证门禁（#1648）')

// ---------------------------------------------------------------------------
// 一、静态：发布脚本、收尾脚本与两份文档的写法
// ---------------------------------------------------------------------------
function staticChecks(): void {
  const scriptText = fs.readFileSync(SCRIPT, 'utf8')
  const has = (needle: string): boolean => scriptText.indexOf(needle) >= 0

  // 门禁段：只构建一次，然后跑唯一裁决入口；不能再跑会重复构建的整条 npm test。
  const gateLines = scriptText.split(/\r?\n/).filter((line) => line.indexOf('GATE ') >= 0 || line.indexOf('npm run ') >= 0)
  check(gateLines.some((line) => line.indexOf('npm run build 2>&1') >= 0), '门禁段先构建一次：npm run build')
  check(gateLines.some((line) => line.indexOf('npm run verify:parallel 2>&1') >= 0), '门禁段用唯一裁决入口：npm run verify:parallel')
  check(!gateLines.some((line) => line.indexOf('npm test 2>&1') >= 0), '门禁段不再跑整条 npm test（不会第二次构建）')
  check(has("GATE-FAIL 构建红") && has('GATE-FAIL 裁决红'), '构建红与裁决红都立即非零退出（GATE-FAIL）')

  // dist-tag 策略：发布前算、发布后核，预发布版本自己补 latest。
  check(has("'tags-plan'") && has("'tags-verify'"), '调用 release-integrity.mts 的 tags-plan 与 tags-verify')
  check(has('TAG-PLAN-FAIL') && has('TAG-VERIFY-FAIL'), '策略不允许时 TAG-PLAN-FAIL、指向不符时 TAG-VERIFY-FAIL，都非零退出')
  check(has('dist-tag add') && has(' latest '), '预发布版本发布后把 latest 指到新版本（npm dist-tag add … latest）')
  check(has('[string]$Tag = ' + String.fromCharCode(39, 39)), '-Tag 缺省留空：按版本形态自动推导发布通道')

  // 字节对账：门禁快照 → 发布前补跑 prepublishOnly 再拍 → 发布后从 registry 拉回再拍。
  check(has('GATE-SNAPSHOT') && has('GATE 构建'), '门禁后给待发包拍一次逐文件清单（GATE-SNAPSHOT）')
  check(has("npm run prepublishOnly") && has('PRE-PACK-SAME') && has('PRE-PACK-DIFF'), '发布前补跑包内 prepublishOnly 并比对（PRE-PACK-SAME / PRE-PACK-DIFF）')
  check(has('PRE-PACK-DIFF') && has('发布前停下'), '发布前字节不一致就停，不进发布')
  check(has('FETCH-FAIL') && has('BYTES-SAME') && has('BYTES-DIFF'), '发布后从 registry 拉回 tarball 再比对（BYTES-SAME / BYTES-DIFF）')
  check(has('BYTES-DIFF') && has('无法撤回'), '发布后不一致按失败算并说明无法撤回、必须人工核对')
  check(has('BYTES-SKIP 本仓没有 scripts/release-integrity.mts'), '本仓没有自证脚本时退回旧口径并记 BYTES-SKIP（五仓同步协议靠这个字面量抓日志）')

  // 证据：清单统计与最终 tag 指向交给收尾脚本写进发布记录评论。
  check(has('BYTES-EVIDENCE') && has("'evidence.json'"), '把清单统计与 tag 指向整理成证据文件（evidence.json）')
  check(has("'--evidence'") && has('releaseVersion'), '调用 release-postflight.mts 时带上 --version 与 --evidence')

  // 收尾脚本：发布记录正文可单独调用、带逐文件清单与 dist-tag 行，import 时不会顺手去调 gh。
  const postflightText = fs.readFileSync(path.join(ROOT, 'scripts', 'release-postflight.mts'), 'utf8')
  check(postflightText.indexOf('export function buildPublishRecordLines') >= 0, '收尾脚本把发布记录正文抽成可导出的纯函数')
  check(postflightText.indexOf('发布包逐文件清单') >= 0 && postflightText.indexOf('dist-tag 最终指向') >= 0, '发布记录里写逐文件清单摘要与各 dist-tag 最终指向')
  check(postflightText.indexOf('invokedDirectly') >= 0, '收尾脚本只有被直接执行时才跑 main()（import 不触发 gh）')
  check(postflightText.indexOf('__HELP__') < 0, '收尾脚本不拿异常字符串当 --help 的控制流')

  // 文档：规则写进 runbook，真机验证规则里补一句「发布脚本自证」。
  const runbook = fs.readFileSync(path.join(ROOT, 'docs', 'releases', 'RELEASE-RUNBOOK.md'), 'utf8')
  check(runbook.indexOf('release-integrity.mts') >= 0, 'RELEASE-RUNBOOK.md 写明发布自证用的 release-integrity.mts')
  check(runbook.indexOf('BYTES-SAME') >= 0 && runbook.indexOf('BYTES-DIFF') >= 0, 'RELEASE-RUNBOOK.md 写明发布后拉回对账的两个结论标记')
  check(runbook.indexOf('dist-tag') >= 0 && runbook.indexOf('TAG-VERIFY-OK') >= 0, 'RELEASE-RUNBOOK.md 写明 dist-tag 策略与核对标记')
  check(runbook.indexOf('npm run verify:parallel') >= 0, 'RELEASE-RUNBOOK.md 写明门禁只跑唯一裁决入口')
  const realMachine = fs.readFileSync(path.join(ROOT, 'docs', 'agents', 'real-machine-verification.md'), 'utf8')
  check(realMachine.indexOf('release-integrity.mts') >= 0 || realMachine.indexOf('逐文件清单') >= 0, 'real-machine-verification.md 提到发布脚本自证（逐文件清单 / dist-tag）')

  check(fs.existsSync(INTEGRITY), 'release-integrity.mts 在仓里（发布脚本据此判断走新口径还是退回旧口径）')
}

// ---------------------------------------------------------------------------
// 二、单测：tar 逐文件清单、清单指纹、差异定位、tag 策略
// ---------------------------------------------------------------------------
// 手写最小 ustar 头：只填本门的读取器需要的字段（name/size/typeflag/checksum）。
function tarHeader(name: string, size: number, typeflag: string): Buffer {
  const header = Buffer.alloc(512, 0)
  header.write(name, 0, 100, 'utf8')
  header.write('0000644\0', 100, 8, 'utf8')
  header.write('0000000\0', 108, 8, 'utf8')
  header.write('0000000\0', 116, 8, 'utf8')
  header.write(size.toString(8).padStart(11, '0') + '\0', 124, 12, 'utf8')
  header.write('00000000000\0', 136, 12, 'utf8')
  header.write('        ', 148, 8, 'utf8')
  header.write(typeflag, 156, 1, 'utf8')
  header.write('ustar\0', 257, 6, 'utf8')
  header.write('00', 263, 2, 'utf8')
  let sum = 0
  for (let index = 0; index < 512; index += 1) sum += header[index]
  header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'utf8')
  return header
}

function tarEntry(name: string, content: Buffer, typeflag = '0'): Buffer {
  const padded = Buffer.alloc(Math.ceil(content.length / 512) * 512, 0)
  content.copy(padded)
  return Buffer.concat([tarHeader(name, content.length, typeflag), padded])
}

function makeTar(entries: Array<{ name: string; content: Buffer; typeflag?: string }>): Buffer {
  return Buffer.concat([...entries.map((entry) => tarEntry(entry.name, entry.content, entry.typeflag || '0')), Buffer.alloc(1024, 0)])
}

/** 拼一条 pax 扩展头记录：格式是「十进制总长度 + 空格 + 键=值 + 换行」，长度包含它自己这几个数字。 */
function paxRecord(key: string, value: string): Buffer {
  const body = key + '=' + value + '\n'
  let total = Buffer.byteLength(body) + 2
  while (String(total).length + 1 + Buffer.byteLength(body) !== total) {
    total = String(total).length + 1 + Buffer.byteLength(body)
  }
  return Buffer.from(String(total) + ' ' + body, 'utf8')
}

function sha256Of(content: Buffer): string {
  return crypto.createHash('sha256').update(content).digest('hex')
}

function unitChecks(): void {
  // 1. 普通 ustar：两个文件，按 path 排序，大小与 sha256 对得上。
  {
    const tar = makeTar([
      { name: 'package/lib/payload.txt', content: Buffer.from('payload\n') },
      { name: 'package/package.json', content: Buffer.from('{"name":"x","version":"1.0.0"}\n') },
    ])
    const entries = readTarEntries(tar)
    // readTarEntries 去掉 npm tarball 的 package/ 前缀，按 tar 里的顺序返回；排序与汇总在 buildManifest 里做。
    const expected = [
      { path: 'lib/payload.txt', size: 8, sha256: sha256Of(Buffer.from('payload\n')) },
      { path: 'package.json', size: 31, sha256: sha256Of(Buffer.from('{"name":"x","version":"1.0.0"}\n')) },
    ]
    check(entries.length === 2, '单测：普通 tar 读出 2 个文件（实际 ' + entries.length + '）')
    check(JSON.stringify(entries) === JSON.stringify(expected), '单测：读出 path/size/sha256，路径去掉 package/ 前缀')
  }

  // 2. 目录条目要跳过；前缀 package/ 要去掉（npm tarball 的固定形状）。
  {
    const tar = makeTar([
      { name: 'package/', content: Buffer.alloc(0), typeflag: '5' },
      { name: 'package/a.txt', content: Buffer.from('a') },
    ])
    const entries = readTarEntries(tar)
    check(entries.length === 1 && entries[0].path === 'a.txt', '单测：目录条目跳过、路径前缀 package/ 去掉')
  }

  // 3. pax 长路径：pax 头里的 path 覆盖下一个文件头里的截断名。
  {
    const longName = 'package/bundled-skills/very-long-directory-name/' + 'x'.repeat(60) + '.md'
    // pax 记录格式是「十进制总长度 + 空格 + 键=值 + 换行」，长度含自身这几位数字、空格与换行。
    const paxPayload = paxRecord('path', longName)
    const tar = Buffer.concat([
      tarEntry('PaxHeader/xxx', paxPayload, 'x'),
      tarEntry('package/truncated-name', Buffer.from('hello')),
      Buffer.alloc(1024, 0),
    ])
    const entries = readTarEntries(tar)
    check(entries.length === 1 && entries[0].path === longName.replace(/^package\//, ''), '单测：pax 长路径覆盖被截断的文件名（实际 ' + (entries[0] && entries[0].path) + '）')
  }

  // 3b. GNU 长路径（typeflag 'L'）：长名头的内容是下一个文件的完整路径，下一个文件头里的名字被截断。
  {
    const longName = 'package/' + 'deep/'.repeat(30) + 'gnu-long-name.md'
    const tar = Buffer.concat([
      tarEntry('././@LongLink', Buffer.from(longName + '\0', 'utf8'), 'L'),
      tarEntry('package/truncated-name', Buffer.from('long')),
      Buffer.alloc(1024, 0),
    ])
    const entries = readTarEntries(tar)
    check(
      entries.length === 1 && entries[0].path === longName.replace(/^package\//, ''),
      '单测：GNU 长路径（typeflag L）读出完整路径、不被截断（实际 ' + (entries[0] && entries[0].path) + '）',
    )
  }

  // 4. 清单指纹：确定性、与文件内容相关。
  {
    const files = [
      { path: 'b.txt', size: 1, sha256: sha256Of(Buffer.from('b')) },
      { path: 'a.txt', size: 1, sha256: sha256Of(Buffer.from('a')) },
    ]
    const digest1 = digestOfFiles(files)
    const digest2 = digestOfFiles([files[1], files[0]])
    check(digest1 === digest2 && /^[0-9a-f]{64}$/.test(digest1), '单测：清单指纹与文件顺序无关，是 64 位 sha256')
    const changed = [{ path: 'a.txt', size: 1, sha256: sha256Of(Buffer.from('x')) }, files[0]]
    check(digestOfFiles(changed) !== digest1, '单测：文件内容变了，清单指纹跟着变')
    const manifest = buildManifest(files, { name: 'p', version: '1.0.0' })
    check(manifest.fileCount === 2 && manifest.totalBytes === 2 && manifest.digest === digest1, '单测：buildManifest 汇总文件数/字节数/指纹')
  }

  // 5. 差异定位：第一处变化要指出 path 与两边 sha；缺文件、多文件分开数。
  {
    const expected = buildManifest([
      { path: 'a.txt', size: 1, sha256: sha256Of(Buffer.from('a')) },
      { path: 'b.txt', size: 1, sha256: sha256Of(Buffer.from('b')) },
    ], {})
    const actual = buildManifest([
      { path: 'a.txt', size: 1, sha256: sha256Of(Buffer.from('changed')) },
      { path: 'c.txt', size: 1, sha256: sha256Of(Buffer.from('c')) },
    ], {})
    const comparison = compareManifests(expected, actual)
    const diffs = [...comparison.changed, ...comparison.missing, ...comparison.extra]
    check(comparison.same === false, '单测：清单不一致时判为不同')
    check(comparison.changed.length === 1 && comparison.missing.length === 1 && comparison.extra.length === 1, '单测：变化/缺失/多出各计 1（实际 ' + comparison.changed.length + '/' + comparison.missing.length + '/' + comparison.extra.length + '）')
    check(diffs.length >= 3 && diffs[0].path === 'a.txt' && diffs[0].kind === 'changed', '单测：第一处差异指向 a.txt（内容变化，changed 组排在 missing/extra 前面）')
    check(diffs.every((diff) => diff.path !== '' && typeof diff.kind === 'string'), '单测：每条差异都带 path 与类型')
    check(compareManifests(expected, expected).same === true, '单测：同一份清单判为相同')
  }

  // 6. semver 比较：预发布号按数值比较，正式号大于同版本预发布号。
  {
    const parsed = parseSemver('v1.2.3-beta.10')
    check(parsed !== null && parsed.major === 1 && parsed.prerelease.join('.') === 'beta.10', '单测：parseSemver 解析带 v 前缀的预发布版本')
    check(parseSemver('not-a-version') === null, '单测：parseSemver 对不合法版本返回 null')
    check(compareVersions('1.2.3-beta.10', '1.2.3-beta.2') > 0, '单测：beta.10 大于 beta.2（按数值比较，不是字典序）')
    check(compareVersions('1.2.3', '1.2.3-beta.9') > 0, '单测：正式号大于同版本预发布号')
    check(compareVersions('1.2.3-beta.1', '1.2.3-beta.1') === 0, '单测：同版本比较相等')
  }

  // 7. tag 策略：预发布发 beta 并把 latest 指过去；稳定发 latest、beta 不动；倒退与「beta 指向正式号」拒绝。
  {
    const prerelease = planTags({ version: '1.9.0-beta.32', before: { latest: '1.8.0', beta: '1.9.0-beta.31' } })
    check(prerelease.ok === true, '单测：预发布版本的 tag 计划通过')
    if (prerelease.ok) {
      check(prerelease.plan.publishTag === 'beta' && prerelease.plan.addLatest === true, '单测：预发布版本发到 beta，并补 latest')
      check(prerelease.plan.expectedLatest === '1.9.0-beta.32' && prerelease.plan.expectedBeta === '1.9.0-beta.32', '单测：预发布版本的期望是 latest 与 beta 都指到新版本')
    }
    const stable = planTags({ version: '2.0.0', before: { latest: '1.8.0', beta: '1.9.0-beta.31' } })
    check(stable.ok === true, '单测：稳定版本的 tag 计划通过')
    if (stable.ok) {
      check(stable.plan.publishTag === 'latest' && stable.plan.addLatest === false, '单测：稳定版本发到 latest，不动 beta')
      check(stable.plan.expectedLatest === '2.0.0' && stable.plan.expectedBeta === '1.9.0-beta.31', '单测：稳定版本的期望是 latest 指新版、beta 保持原样')
    }
    const downgrade = planTags({ version: '1.7.0', before: { latest: '1.8.0' } })
    check(downgrade.ok === false && downgrade.problems.join('、').indexOf('更新') >= 0, '单测：版本比 latest 旧时拒绝（TAG-PLAN-FAIL 说明新版本必须比 latest 新）')
    const betaOnStable = planTags({ version: '1.9.0-beta.32', before: { latest: '1.8.0', beta: '1.8.1' } })
    check(betaOnStable.ok === false && betaOnStable.problems.join('、').indexOf('beta') >= 0, '单测：beta 指向正式号时拒绝（beta 只放预发布版本）')
    const noPrerelease = planTags({ version: '1.9.0-beta.31', before: { latest: '1.8.0', beta: '1.9.0-beta.31' } })
    check(noPrerelease.ok === false, '单测：同版本重复发布被拒绝')
  }

  // 8. tag 核对：发布后 latest/beta 各按计划对；稳定版本 beta 变了也算错。
  {
    const prerelease = planTags({ version: '1.9.0-beta.32', before: { latest: '1.8.0' } })
    if (prerelease.ok) {
      const good = verifyTags({ version: '1.9.0-beta.32', plan: prerelease.plan, after: { latest: '1.9.0-beta.32', beta: '1.9.0-beta.32' } })
      check(good.ok === true, '单测：预发布版本发布后 latest 与 beta 都对时通过')
      const bad = verifyTags({ version: '1.9.0-beta.32', plan: prerelease.plan, after: { latest: '1.8.0', beta: '1.9.0-beta.32' } })
      check(bad.ok === false && bad.problems.some((line) => line.indexOf('latest') >= 0), '单测：预发布版本发布后 latest 没跟上时报错')
    }
    const stable = planTags({ version: '2.0.0', before: { latest: '1.8.0', beta: '1.9.0-beta.31' } })
    if (stable.ok) {
      check(verifyTags({ version: '2.0.0', plan: stable.plan, after: { latest: '2.0.0', beta: '1.9.0-beta.31' } }).ok === true, '单测：稳定版本发布后 latest 动了、beta 没动时通过')
      check(verifyTags({ version: '2.0.0', plan: stable.plan, after: { latest: '2.0.0', beta: '2.0.0' } }).ok === false, '单测：稳定版本发布后 beta 被动了也算错')
      check(verifyTags({ version: '2.0.0', plan: stable.plan, after: { latest: '2.0.0', beta: '1.9.0-beta.31' } }).ok === true, '单测：稳定版本发布后 beta 缺失而计划里也没有时不误判（计划记录的是「原来没有」）')
    }
  }

  // 9. 发布记录评论正文：逐文件清单摘要与 dist-tag 指向都写进去；没有证据时明确写「没有」。
  {
    const withEvidence = buildPublishRecordLines({
      version: '1.9.0-beta.32',
      nextIssueNumber: 88,
      evidence: {
        version: '1.9.0-beta.32',
        packages: [{ name: PKG, version: '1.9.0-beta.32', fileCount: 539, totalBytes: 5481828, digest: 'f09103d1709b08839db95d6d8a10a11a75d056afb0677b97622dc8283b922ba6' }],
        tags: { latest: '1.9.0-beta.32', beta: '1.9.0-beta.32' },
      },
      now: new Date('2026-10-29T06:40:00Z'),
    })
    const text = withEvidence.join('\n')
    check(text.indexOf('## 发布记录') === 0, '单测：发布记录以「## 发布记录」开头')
    check(text.indexOf('539 个文件') >= 0 && text.indexOf('5481828 字节') >= 0, '单测：发布记录写实际发布包的文件数与字节数')
    check(text.indexOf('清单指纹 sha256:f09103d1709b08839db95d6d8a10a11a75d056afb0677b97622dc8283b922ba6') >= 0, '单测：发布记录写完整清单指纹（64 位 sha256，可拿去与发布日志的 BYTES-SAME 行比对）')
    check(text.indexOf('dist-tag 最终指向：latest → 1.9.0-beta.32，beta → 1.9.0-beta.32') >= 0, '单测：发布记录写各 dist-tag 最终指向')
    check(text.indexOf('下一版清单票：#88') >= 0, '单测：发布记录带下一版清单票号')
    const withoutEvidence = buildPublishRecordLines({ version: '1.9.0', nextIssueNumber: null, evidence: null, now: new Date('2026-10-29T06:40:00Z') }).join('\n')
    check(withoutEvidence.indexOf('没有机器对账证据') >= 0, '单测：没有证据时写明没有，不印占位数字')
  }
}

// ---------------------------------------------------------------------------
// 三、动态：临时假仓库 + 假 registry，真跑发布脚本
// ---------------------------------------------------------------------------
type RegistryRequest = { method: string; url: string; auth: string }
type DocState = {
  name: string
  tags: Record<string, string>
  versions: Map<string, { name: string; version: string }>
  tarballs: Map<string, Buffer>
}
type RegistryOptions = {
  seed?: { name: string; versions?: string[]; tags?: Record<string, string> }
  tamperTarball?: boolean
  ignoreDistTagAdd?: boolean
}
type Stub = {
  url: string
  state: Map<string, DocState>
  requests: RegistryRequest[]
  unknown: string[]
  close: () => Promise<void>
}

function startRegistry(options: RegistryOptions): Promise<Stub> {
  const state = new Map<string, DocState>()
  const requests: RegistryRequest[] = []
  const unknown: string[] = []
  const sockets = new Set<any>()
  const seed = options.seed
  if (seed) {
    const doc: DocState = { name: seed.name, tags: Object.assign({}, seed.tags || {}), versions: new Map(), tarballs: new Map() }
    for (const version of seed.versions || Object.values(doc.tags)) doc.versions.set(version, { name: seed.name, version })
    state.set(seed.name, doc)
  }
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const rawUrl = String(req.url || '')
      const urlPath = rawUrl.split('?')[0]
      const method = String(req.method || '')
      requests.push({ method, url: urlPath, auth: String(req.headers.authorization || '') })
      const host = String(req.headers.host || '127.0.0.1')
      const baseUrl = 'http://' + host
      const send = (code: number, body: unknown): void => {
        const text = JSON.stringify(body)
        res.writeHead(code, {
          'content-type': 'application/json; charset=utf-8',
          'content-length': Buffer.byteLength(text),
          'cache-control': 'no-store',
        })
        res.end(text)
      }
      const sendBytes = (bytes: Buffer): void => {
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': bytes.length, 'cache-control': 'no-store' })
        res.end(bytes)
      }
      const packumentOf = (doc: DocState): unknown => {
        const versions: Record<string, unknown> = {}
        for (const version of doc.versions.keys()) {
          versions[version] = {
            name: doc.name,
            version,
            dist: { tarball: baseUrl + '/' + encodeURIComponent(doc.name) + '/-/' + doc.name + '-' + version + '.tgz' },
          }
        }
        return { _id: doc.name, name: doc.name, 'dist-tags': doc.tags, versions }
      }

      if (method === 'GET' && urlPath === '/-/whoami') return send(200, { username: 'verify-1648-fake-user' })

      const tarballMatch = /^\/([^/]+)\/-\/(.+\.tgz)$/.exec(urlPath)
      if (method === 'GET' && tarballMatch) {
        const name = decodeURIComponent(tarballMatch[1])
        const filename = tarballMatch[2]
        const doc = state.get(name)
        const stored = doc ? doc.tarballs.get(filename) : undefined
        if (!stored) { unknown.push('GET tarball 404 ' + urlPath); return send(404, { error: 'not found' }) }
        if (!options.tamperTarball) return sendBytes(stored)
        // 篡改测试：解压后改一个字节再压回去（仍然是一个合法 tarball，只是文件内容变了）。
        let bytes = stored
        try {
          const raw = zlib.gunzipSync(stored)
          const at = raw.indexOf(Buffer.from('v1\n'))
          if (at >= 0) {
            raw[at] = 'v'.charCodeAt(0)
            raw[at + 1] = '2'.charCodeAt(0)
          }
          bytes = zlib.gzipSync(raw)
        } catch (error) {
          unknown.push('tamper 失败：' + String(error))
        }
        return sendBytes(bytes)
      }

      // npm 的 dist-tag add 先 GET 整个 dist-tags 表（拿当前指向），再 PUT 单个 tag。
      const distTagsListMatch = /^\/-\/package\/([^/]+)\/dist-tags$/.exec(urlPath)
      if (method === 'GET' && distTagsListMatch) {
        const name = decodeURIComponent(distTagsListMatch[1])
        const doc = state.get(name)
        if (!doc) return send(404, { error: 'not found' })
        return send(200, doc.tags)
      }

      const distTagMatch = /^\/-\/package\/([^/]+)\/dist-tags\/(.+)$/.exec(urlPath)
      if (method === 'PUT' && distTagMatch) {
        const name = decodeURIComponent(distTagMatch[1])
        const tag = decodeURIComponent(distTagMatch[2])
        let version = ''
        try { version = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch (error) { version = '' }
        if (!version) { unknown.push('dist-tag add 没有版本：' + urlPath); return send(400, { error: 'bad version' }) }
        if (!options.ignoreDistTagAdd) {
          const doc = state.get(name)
          if (doc) doc.tags[tag] = version
        }
        return send(201, { ok: true })
      }

      if (method === 'GET' && urlPath.indexOf('/-/') !== 0) {
        const name = decodeURIComponent(urlPath.replace(/^\//, ''))
        const doc = state.get(name)
        if (!doc) return send(404, { error: 'not found' })
        return send(200, packumentOf(doc))
      }

      if (method === 'PUT' && urlPath.indexOf('/-/') !== 0) {
        const name = decodeURIComponent(urlPath.replace(/^\//, ''))
        let body: any = {}
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch (error) { unknown.push('publish body 不是 JSON：' + urlPath); return send(400, { error: 'bad body' }) }
        let doc = state.get(name)
        if (!doc) {
          doc = { name, tags: {}, versions: new Map(), tarballs: new Map() }
          state.set(name, doc)
        }
        const versionsInBody = body.versions && typeof body.versions === 'object' ? Object.keys(body.versions) : []
        let version = ''
        for (const candidate of versionsInBody) if (!doc.versions.has(candidate)) { version = candidate; break }
        if (!version && body['dist-tags'] && typeof body['dist-tags'] === 'object') {
          version = String(body['dist-tags'].latest || body['dist-tags'].beta || '')
        }
        const attachments = body._attachments && typeof body._attachments === 'object' ? body._attachments : {}
        for (const filename of Object.keys(attachments)) {
          const attachment = attachments[filename]
          if (attachment && typeof attachment.data === 'string') doc.tarballs.set(filename, Buffer.from(attachment.data, 'base64'))
        }
        if (version) doc.versions.set(version, { name, version })
        if (body['dist-tags'] && typeof body['dist-tags'] === 'object') {
          for (const tag of Object.keys(body['dist-tags'])) doc.tags[tag] = String(body['dist-tags'][tag])
        }
        return send(201, { ok: true, id: name, rev: '1-verify' })
      }

      unknown.push(method + ' ' + urlPath)
      send(404, { error: 'not found' })
    })
  })
  server.on('connection', (socket: any) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = address && typeof address === 'object' ? address.port : 0
      resolve({
        url: 'http://127.0.0.1:' + port + '/',
        state,
        requests,
        unknown,
        close: () => new Promise<void>((done) => {
          for (const socket of sockets) { try { socket.destroy() } catch (error) {} }
          server.close(() => done())
        }),
      })
    })
  })
}

// 子进程环境要干净：别人的 token、npm 配置、代理都可能把请求带出 127.0.0.1 或污染结论。
function childEnv(extra: Record<string, string>): Record<string, string> {
  const drop = new Set(['NODE_AUTH_TOKEN', 'NPM_TOKEN', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY'])
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue
    const upper = key.toUpperCase()
    if (drop.has(upper) || upper.indexOf('NPM_CONFIG_') === 0) continue
    env[key] = value
  }
  for (const [key, value] of Object.entries(extra)) env[key] = value
  return env
}

// PowerShell 把中文写进被重定向的 stdout 时用哪种编码取决于控制台代码页（简体中文 Windows 上是 GBK），
// 所以先按 UTF-8 严格解，解不动再按 GBK 解。
function decodeOutput(buf: Buffer): string {
  if (buf.length === 0) return ''
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf) } catch (error) {}
  try { return new TextDecoder('gbk').decode(buf) } catch (error) {}
  return buf.toString('utf8')
}

type RunResult = { code: number; out: string; err: string }

function runScript(args: string[], extraEnv: Record<string, string>): Promise<RunResult> {
  const fullArgs = ['-NoProfile', '-NonInteractive', '-File', SCRIPT].concat(args)
  return new Promise((resolve, reject) => {
    const child = cp.spawn(PWSH, fullArgs, { cwd: ROOT, env: childEnv(extraEnv), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const outChunks: Buffer[] = []
    const errChunks: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => outChunks.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => errChunks.push(chunk))
    const timer = setTimeout(() => { try { child.kill('SIGKILL') } catch (error) {} }, 240000)
    child.on('error', (error: Error) => { clearTimeout(timer); reject(new Error('起 pwsh 跑发布脚本失败：' + error.message)) })
    child.on('close', (code: number | null) => {
      clearTimeout(timer)
      resolve({ code: code === null ? -1 : code, out: decodeOutput(Buffer.concat(outChunks)), err: decodeOutput(Buffer.concat(errChunks)) })
    })
  })
}

function hasPwsh(): boolean {
  const result = cp.spawnSync(PWSH, ['-NoProfile', '-NonInteractive', '-Command', 'exit 0'], { encoding: 'utf8', timeout: 30000, windowsHide: true })
  return !result.error && result.status === 0
}

const NOOP_SCRIPT = 'process.exit(0)\n'
const REBUILD_STUB_SCRIPT = [
  "import fs from 'node:fs'",
  "if (process.env.PREPACK_CHANGE === '1') fs.writeFileSync('lib/payload.txt', 'package-payload-v2\\n')",
  'process.exit(0)',
  '',
].join('\n')
const POSTFLIGHT_STUB_SCRIPT = [
  "import fs from 'node:fs'",
  'const argv = process.argv.slice(2)',
  "const at = argv.indexOf('--evidence')",
  'let evidence = null',
  'if (at >= 0 && argv[at + 1]) {',
  '  try { evidence = JSON.parse(fs.readFileSync(argv[at + 1], "utf8")) } catch (error) { evidence = null }',
  '}',
  'const output = process.env.POSTFLIGHT_CAPTURE',
  "if (output) fs.writeFileSync(output, JSON.stringify({ argv, evidence }), 'utf8')",
  'process.exit(0)',
  '',
].join('\n')

type ScenarioResult = {
  code: number
  out: string
  err: string
  log: string
  requests: RegistryRequest[]
  unknown: string[]
  postflight: { argv: string[]; evidence: any } | null
  registry: Stub
}

type ScenarioOptions = {
  version: string
  registry: RegistryOptions
  prepackChange?: boolean
  extraArgs?: string[]
  // true = 这个假仓库里不放 scripts/release-integrity.mts，模拟五仓同步里还没升级的老仓库。
  omitIntegrity?: boolean
}

async function runScenario(options: ScenarioOptions): Promise<ScenarioResult> {
  const lab = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-1648-'))
  const repo = path.join(lab, 'repo')
  const registry = await startRegistry(options.registry)
  let postflight: ScenarioResult['postflight'] = null
  try {
    fs.mkdirSync(path.join(repo, 'scripts'), { recursive: true })
    fs.mkdirSync(path.join(repo, 'package', 'lib'), { recursive: true })
    fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({
      name: 'verify-1648-fake-root',
      version: '0.0.0',
      private: true,
      scripts: { build: 'node scripts/noop.mjs', 'verify:parallel': 'node scripts/noop.mjs' },
    }, null, 2), 'utf8')
    fs.writeFileSync(path.join(repo, 'scripts', 'noop.mjs'), NOOP_SCRIPT, 'utf8')
    fs.writeFileSync(path.join(repo, 'scripts', 'rebuild-stub.mjs'), REBUILD_STUB_SCRIPT, 'utf8')
    if (!options.omitIntegrity) {
      fs.writeFileSync(path.join(repo, 'scripts', 'release-integrity.mts'), fs.readFileSync(INTEGRITY, 'utf8'), 'utf8')
    }
    fs.writeFileSync(path.join(repo, 'scripts', 'release-postflight.mts'), POSTFLIGHT_STUB_SCRIPT, 'utf8')
    fs.writeFileSync(path.join(repo, 'package', 'package.json'), JSON.stringify({
      name: PKG,
      version: options.version,
      private: false,
      files: ['lib'],
      scripts: { prepublishOnly: 'node ../scripts/rebuild-stub.mjs' },
    }, null, 2), 'utf8')
    fs.writeFileSync(path.join(repo, 'package', 'lib', 'payload.txt'), 'package-payload-v1\n', 'utf8')
    const tokenPath = path.join(repo, 'publish-token.txt')
    fs.writeFileSync(tokenPath, TOKEN + '\n', 'utf8')
    const logPath = path.join(lab, 'publish.log')
    const capturePath = path.join(lab, 'postflight.json')
    const extraEnv: Record<string, string> = {
      npm_config_cache: path.join(lab, 'npm-cache'),
      npm_config_audit: 'false',
      npm_config_fund: 'false',
      npm_config_progress: 'false',
      POSTFLIGHT_CAPTURE: capturePath,
    }
    if (options.prepackChange) extraEnv.PREPACK_CHANGE = '1'
    const args = [
      '-TokenFile', tokenPath,
      '-RepoRoot', repo,
      '-LogPath', logPath,
      '-Registry', registry.url,
    ].concat(options.extraArgs || [])
    const run = await runScript(args, extraEnv)
    let log = ''
    try { log = fs.readFileSync(logPath, 'utf8') } catch (error) { log = '' }
    try { postflight = JSON.parse(fs.readFileSync(capturePath, 'utf8')) } catch (error) { postflight = null }
    return { code: run.code, out: run.out, err: run.err, log, requests: registry.requests, unknown: registry.unknown, postflight, registry }
  } finally {
    await registry.close()
    try { fs.rmSync(lab, { recursive: true, force: true }) } catch (error) {}
  }
}

function hasLogLine(log: string, needle: string): boolean {
  return log.split(/\r?\n/).some((line) => line.indexOf(needle) >= 0)
}

function publishPuts(requests: RegistryRequest[]): RegistryRequest[] {
  return requests.filter((request) => request.method === 'PUT' && request.url === '/' + PKG)
}

function tagsOf(result: ScenarioResult): Record<string, string> {
  const doc = result.registry.state.get(PKG)
  return doc ? Object.assign({}, doc.tags) : {}
}

function digestOfPublishedTarball(result: ScenarioResult, version: string): string {
  const doc = result.registry.state.get(PKG)
  if (!doc) return ''
  const stored = doc.tarballs.get(PKG + '-' + version + '.tgz')
  if (!stored) return ''
  const entries = readTarEntries(zlib.gunzipSync(stored))
  return digestOfFiles(entries)
}

async function dynamicChecks(): Promise<void> {
  if (!hasPwsh()) {
    console.log('  INFO ' + PWSH + ' 不可用，动态部分跳过：静态与单测已跑，发布脚本本身要求 pwsh 7，请在有 pwsh 的机器上补跑完整版。')
    return
  }

  // A. 策略不允许：云端 latest 已经 2.0.0，这次要发 1.0.0-beta.1 —— 发布前就该停，不进门禁、不发 PUT。
  {
    const result = await runScenario({
      version: '1.0.0-beta.1',
      registry: { seed: { name: PKG, versions: ['2.0.0'], tags: { latest: '2.0.0' } } },
    })
    check(result.code === 1, 'A 版本比 latest 旧时退出码非零（实测 ' + result.code + '）')
    check(hasLogLine(result.log, 'TAG-PLAN-FAIL'), 'A 日志里给出 TAG-PLAN-FAIL（策略不允许这次发布）')
    check(!hasLogLine(result.log, 'GATE 构建'), 'A 在门禁之前就停下（没有白跑一遍构建）')
    check(publishPuts(result.requests).length === 0, 'A 没有向 registry 发任何发布 PUT')
  }

  // B. 发布前字节对不上：prepublishOnly 改了要发的内容 —— 发布前停下，registry 收不到 PUT。
  {
    const result = await runScenario({
      version: '1.0.0-beta.1',
      registry: {},
      prepackChange: true,
    })
    check(result.code === 1, 'B 发布前字节不一致时退出码非零（实测 ' + result.code + '）')
    check(hasLogLine(result.log, 'GATE-SNAPSHOT') && hasLogLine(result.log, 'PRE-PACK-SAME') === false, 'B 门禁快照拍了，但发布前比对没通过（没有 PRE-PACK-SAME）')
    check(hasLogLine(result.log, 'PRE-PACK-DIFF') && hasLogLine(result.log, 'COMPARE-DIFF'), 'B 日志指出 PRE-PACK-DIFF 与第一处 COMPARE-DIFF')
    check(publishPuts(result.requests).length === 0, 'B 在发布前停下，registry 收不到发布 PUT（没有发出无法撤回的包）')
  }

  // C. 预发布主路径：发 beta 后 latest 也指过去；证据交给收尾脚本，且证据里的指纹就是发出去的字节。
  {
    const version = '1.0.0-beta.1'
    const result = await runScenario({
      version,
      registry: { seed: { name: PKG, versions: [], tags: {} } },
    })
    if (result.code !== 0) {
      const tail = result.log.split(/\r?\n/).slice(-60).join('\n')
      console.log('  INFO C 日志尾部：\n' + tail)
      console.log('  INFO C 未识别请求：' + JSON.stringify(result.unknown))
      console.log('  INFO C 全部请求：' + JSON.stringify(result.requests.map((r) => r.method + ' ' + r.url)))
    }
    check(result.code === 0, 'C 预发布版本完整跑通，退出码 0（实测 ' + result.code + '）')
    check(hasLogLine(result.log, 'TAG-PLAN kind=prerelease publish-tag=beta'), 'C 发布前算出预发布计划：发 beta、补 latest')
    check(hasLogLine(result.log, 'GATE-SNAPSHOT') && hasLogLine(result.log, 'PRE-PACK-SAME'), 'C 门禁快照与发布前清单一致（GATE-SNAPSHOT + PRE-PACK-SAME）')
    check(publishPuts(result.requests).length >= 1, 'C 向 registry 发了发布 PUT')
    check(hasLogLine(result.log, 'PKG-OK'), 'C 发布成功（PKG-OK）')
    check(hasLogLine(result.log, 'BYTES-SAME'), 'C 从 registry 拉回的包与发布前清单逐文件一致（BYTES-SAME）')
    check(hasLogLine(result.log, 'TAG-VERIFY-OK latest=' + version + ' beta=' + version), 'C 发布后核对 latest 与 beta 都指到新版本（TAG-VERIFY-OK）')
    const tags = tagsOf(result)
    check(tags.latest === version && tags.beta === version, 'C registry 上 latest 与 beta 都指到新版本（实际 latest=' + (tags.latest || '缺') + ' beta=' + (tags.beta || '缺') + '）')
    check(hasLogLine(result.log, 'BYTES-EVIDENCE'), 'C 生成了发布证据文件（BYTES-EVIDENCE）')
    check(result.postflight !== null && result.postflight.argv.indexOf('--evidence') >= 0, 'C 收尾脚本收到了 --evidence')
    if (result.postflight && result.postflight.evidence) {
      const evidence = result.postflight.evidence
      const publishedDigest = digestOfPublishedTarball(result, version)
      check(evidence.version === version, 'C 证据里的版本就是这次发布的版本')
      check(evidence.packages.length === 1 && evidence.packages[0].fileCount > 0, 'C 证据里记了每个发布包的文件数与字节数')
      check(evidence.packages[0].digest === publishedDigest, 'C 证据里的清单指纹就是 registry 上实际发布包的指纹')
      check(evidence.tags.latest === version && evidence.tags.beta === version, 'C 证据里的 dist-tag 指向就是 registry 最终指向')
    } else {
      check(false, 'C 收尾脚本没有留下可读的发布证据')
    }
  }

  // D. 稳定版本：只动 latest，beta 保持不动。
  {
    const version = '1.2.0'
    const result = await runScenario({
      version,
      registry: { seed: { name: PKG, versions: ['1.0.0', '1.1.0-beta.1'], tags: { latest: '1.0.0', beta: '1.1.0-beta.1' } } },
    })
    check(result.code === 0, 'D 稳定版本完整跑通，退出码 0（实测 ' + result.code + '）')
    check(hasLogLine(result.log, 'TAG-PLAN kind=stable publish-tag=latest'), 'D 发布前算出稳定计划：发 latest、不动 beta')
    const tags = tagsOf(result)
    check(tags.latest === version, 'D registry 上 latest 指到新版本（实际 ' + (tags.latest || '缺') + '）')
    check(tags.beta === '1.1.0-beta.1', 'D registry 上 beta 保持原样（实际 ' + (tags.beta || '缺') + '）')
    check(hasLogLine(result.log, 'TAG-VERIFY-OK'), 'D 发布后 tag 核对通过（TAG-VERIFY-OK）')
    check(hasLogLine(result.log, 'dist-tag add') === false, 'D 稳定版本不补 latest（没有多余的 dist-tag add 步骤）')
  }

  // E. 发布后被改动：registry 回一个内容被改过的 tarball —— 拉回对账必须报 BYTES-DIFF、非零退出。
  {
    const version = '1.0.0-beta.1'
    const result = await runScenario({
      version,
      registry: { tamperTarball: true },
    })
    check(result.code === 1, 'E 拉回的包与发布前不一致时退出码非零（实测 ' + result.code + '）')
    check(hasLogLine(result.log, 'BYTES-DIFF'), 'E 日志里给出 BYTES-DIFF（已发布，无法撤回，必须人工核对）')
    check(hasLogLine(result.log, 'COMPARE-DIFF'), 'E 日志里指出第一处差异（COMPARE-DIFF）')
    check(publishPuts(result.requests).length >= 1, 'E 对照：此时确实已经发布过（registry 已收下，无法撤回）')
  }

  // F. registry 收下发布但不执行 dist-tag 补 latest —— 发布后核对必须报 TAG-VERIFY-FAIL、非零退出。
  {
    const version = '1.0.0-beta.1'
    const result = await runScenario({
      version,
      registry: { ignoreDistTagAdd: true },
    })
    check(result.code === 1, 'F dist-tag 指向不符时退出码非零（实测 ' + result.code + '）')
    check(hasLogLine(result.log, 'TAG-VERIFY-FAIL'), 'F 日志里给出 TAG-VERIFY-FAIL（latest 没有跟上预发布版本）')
  }

  // G. 五仓同步的老仓库没有 release-integrity.mts：必须退回旧口径照常发布，日志里明写 BYTES-SKIP，
  // 且收尾脚本不收到 --evidence（没有机器对账证据就不该假装有）。
  {
    const version = '1.0.0'
    const result = await runScenario({
      version,
      registry: {},
      omitIntegrity: true,
    })
    check(result.code === 0, 'G 没有自证脚本时仍按旧口径发布成功，退出码 0（实测 ' + result.code + '）')
    check(hasLogLine(result.log, 'BYTES-SKIP 本仓没有 scripts/release-integrity.mts'), 'G 日志里明写 BYTES-SKIP 与原因（不是悄悄降级）')
    check(hasLogLine(result.log, 'GATE-SNAPSHOT') === false && hasLogLine(result.log, 'PRE-PACK-SAME') === false, 'G 没有门禁快照与发布前对账（本来就没有可比的东西）')
    check(hasLogLine(result.log, 'PKG-OK'), 'G 包照常发布成功（PKG-OK）')
    const tags = tagsOf(result)
    check(tags.latest === version, 'G registry 上 latest 指向新版本（实际 ' + (tags.latest || '缺') + '）')
    check((hasLogLine(result.log, 'TAG-VERIFY-OK') || hasLogLine(result.log, 'TAG-VERIFY-FAIL')) === false, 'G 不做 tag 核对（旧口径没有策略）')
    check(result.postflight !== null && result.postflight.argv.indexOf('--evidence') < 0, 'G 收尾脚本不带 --evidence')
  }
}

async function main(): Promise<void> {
  staticChecks()
  unitChecks()
  await dynamicChecks()
  console.log('共有 ' + total + ' 条断言，' + (failed ? '存在失败' : '全部通过'))
  process.exit(failed ? 1 : 0)
}

main().catch((error: unknown) => {
  console.error('门禁运行出错：' + ((error as { stack?: string }).stack || String(error)))
  process.exit(1)
})
