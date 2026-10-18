// tests/verify-1125-gate-coverage.ts —— 看守门禁：没有哪扇门禁会被链静默漏掉（#1125）。
//
// 为什么要有它：名单改成“目录约定加显式排除表”之后，“新增门禁 = 新增文件”，
// 但反过来也要有人证明“磁盘上有、链上没跑”的情况不存在。三个执行器与这扇门禁
// 读的是同一份约定（scripts/verify-stages.json）与同一个规划函数（planGates），
// 所以这里断言的每一条，都是执行器真正会走的那条路。
//
// 约定在本文件里只出现一种形状：
//   stages  四段，顺序固定为 build → contract → behavior → freshness；
//           前两段与 freshness 按 match 前缀认领，behavior 是默认段（match 为空），
//           认领不上的就进 behavior，不许有“哪都不去”的文件；
//   exclude 显式排除表，每条必须带理由与票号，文件删了条目也要跟着删。
//
// 用法：node --import ./scripts/ts-hook.mts tests/verify-1125-gate-coverage.ts
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  discoverGateFiles,
  isGateFileName,
  loadConvention,
  nearMissGateFiles,
  planFromNames,
} from '../scripts/lib/discover-gates.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

let failed = false
let total = 0
function check(ok: boolean, msg: string, detail = ''): void {
  total++
  if (ok) console.log('  PASS ' + msg)
  else {
    failed = true
    console.log('  FAIL ' + msg + (detail ? ' — ' + detail : ''))
  }
}

// ---------------------------------------------------------------------------
// 活仓检查：对真仓库的约定与磁盘说话
// ---------------------------------------------------------------------------
console.log('活仓：约定与磁盘对得上')
const convention = loadConvention(ROOT)
check(
  convention.stages.map((s) => s.name).join(',') === 'build,contract,behavior,freshness',
  '四段顺序固定（build → contract → behavior → freshness）',
  '实得 ' + convention.stages.map((s) => s.name).join(','),
)
{
  const names = discoverGateFiles(ROOT)
  const plan = planFromNames(names, convention)
  const planned = new Set(plan.steps.map((s) => s.file))
  const excluded = new Set(plan.excluded)
  const missing = names.filter((n) => !planned.has(n) && !excluded.has(n))
  check(names.length > 0, '磁盘上扫到了门禁（' + names.length + ' 扇）')
  check(missing.length === 0, '每扇门禁要么进链、要么在排除表里（两边都不在的 ' + missing.length + ' 扇）', missing.join('、'))
  const stale = [...excluded].filter((f) => !names.includes(f))
  check(stale.length === 0, '排除表里没有“文件已删、条目还在”的烂条（' + stale.length + ' 条）', stale.join('、'))
  const bad = convention.exclude.filter((e) => !e.reason.trim() || !e.ticket.trim())
  check(bad.length === 0, '排除表每条都有理由与票号（缺的 ' + bad.length + ' 条）', bad.map((e) => e.file).join('、'))
  const stages = new Set(plan.steps.map((s) => s.stage))
  check(
    ['build', 'contract', 'behavior', 'freshness'].every((n) => stages.has(n)),
    '四段都有门禁落进去（空段说明 match 写错了）',
    '实有 ' + [...stages].join(','),
  )
  const near = nearMissGateFiles(ROOT)
  check(near.length === 0, '没有“像门禁但扫不进链”的漏网文件名（' + near.length + ' 个）', near.join('、'))
}

// ---------------------------------------------------------------------------
// 夹具检查：看守门禁的红路径是真的会红（在临时小仓里演一遍）
// ---------------------------------------------------------------------------
// 为什么用夹具：活仓今天是绿的，绿测不出“红起来是什么样子”。这里造两个小仓，
// 一个藏一扇“两边都不在”的门禁，一个藏一个“像门禁但扫不进”的文件名，
// 看判定函数是不是真的把它揪出来 —— 这正是票面第二条验收要的那句话。
console.log('夹具：红路径真的会红')
function makeFixture(files: string[], conventionText: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-1125-'))
  fs.mkdirSync(path.join(dir, 'tests'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true })
  for (const f of files) fs.writeFileSync(path.join(dir, 'tests', f), 'process.exit(0)\n')
  fs.writeFileSync(path.join(dir, 'scripts', 'verify-stages.json'), conventionText)
  return dir
}
const ConventionText = JSON.stringify({ stages: [{ name: 'behavior', match: [] as string[] }], exclude: [] })
{
  // 夹具一：规划函数漏掉一扇门禁（模拟“登记被删、文件还在”），活仓检查的第一条就该红。
  const dir = makeFixture(['verify-a.js', 'verify-b.js'], ConventionText)
  const names = discoverGateFiles(dir)
  const plan = planFromNames(names.slice(0, 1), loadConvention(dir))
  const planned = new Set(plan.steps.map((s) => s.file))
  const missing = names.filter((n) => !planned.has(n))
  check(missing.length === 1 && missing[0] === 'tests/verify-b.js', '夹具一：漏掉的那扇门禁被点名（实得 ' + missing.join('、') + '）')
  // 夹具二：文件名像门禁但扫不进链（下划线），漏网扫描把它揪出来。
  const dir2 = makeFixture(['verify_rogue.js'], ConventionText)
  check(!isGateFileName('verify_rogue.js'), '夹具二前提：verify_rogue.js 确实不是约定文件名')
  const near = nearMissGateFiles(dir2)
  check(near.length === 1 && near[0] === 'tests/verify_rogue.js', '夹具二：漏网文件名被点名（实得 ' + near.join('、') + '）')
  fs.rmSync(dir, { recursive: true, force: true })
  fs.rmSync(dir2, { recursive: true, force: true })
}

console.log('')
console.log('看守门禁：' + total + ' 条断言，' + (failed ? '有失败' : '全部通过'))
process.exit(failed ? 1 : 0)
