// verify-handoff-latest-sort.js — 状态栏 handoff 文档 mtime/sort 加固（BUG4 · issue #12）
// 用法: node tests/verify-handoff-latest-sort.js [file...]（默认 host.js + package/lib/index.js 双源）
//
// 背景：DSH 沙箱里 fs.stat 返回的 info.mtime 形态不可控（Date 对象 / ISO 串 / 秒级 Unix / 本地化串 / null / undefined / NaN），
//       原实现 `typeof mt === 'number' ? mt : Date.parse(String(mt))` 在非 number 形态下任一无法 parse 的格式都得 NaN；
//       原 sort 单键 `b.mtime - a.mtime` 在两 mtime 相等/NaN 时返回 0/NaN → Array.sort 视为 equal → 原顺序保留；
//       fs.listDir 按名字典序返回 → 老文件天然排第一 → mds[0].name = 字典序最小 = 上一次写入。
//
// 修复（双重防御里的「副路径」）：
//   1) parseHandoffMtime(raw)  —— isFinite 严格校验 + Date 对象优先 → 任何无法 parse 的形态安全归 0
//   2) pickLatestHandoff(mds)  —— mtime desc 主键 + name desc 兜底（时间戳文件名 = 字典序 = 时间序）；
//      mtime 退化为 0 的退化形态（NaN/null/全 0/全等）一律走 name desc 兜底返回字典序最大
//
// 验收（按 issue #12 agent brief 验收标准节）：
//   a) 双源 host.js ↔ package/lib/index.js 都包含 parseHandoffMtime + pickLatestHandoff 定义；
//      mtime 解析用 isFinite 严格校验；sort 含 name desc 兜底（b.name < a.name）；handoffResolve 在双源注册；
//      handoffLatest / handoffResolve 均通过 helpers 实现（不再内联 sort）。
//   b) sort 加固后，pickLatestHandoff 在以下 7 case 中行为符合契约：
//      - mtime=NaN（新文件，DSH 沙箱典型失败）+ 正常（旧文件） → 旧文件（sort 加固无法修复 mtime 倒挂）
//      - mtime=null（同上形态）
//      - mtime=0（stat 全失败，等价于全部退化） → 新文件（name desc 兜底）
//      - mtime 全等（全部相同 finite） → 新文件（name desc 兜底）
//      - mtime 全 NaN（DSH 沙箱全崩） → 新文件（name desc 兜底）
//      - 混合（new=valid + old=NaN）：new 文件 mtime 1000、old 文件 NaN→0 → 新文件（NaN→0 顺带修复）
//      - 正常有先后（new>old） → 新文件（mtime desc 主键生效）
//
// 注：「1 case 旧文件」由主路径（client 端 handoffFile → host.handoffResolve(name)）独立保障，
//     本测试只覆盖 sort 加固的子路径契约。
const fs = require('fs')
const assert = require('assert')

const files = process.argv.slice(2).length ? process.argv.slice(2) : ['host.js', 'package/lib/index.js']

// ---- Part A：静态契约 ----
const statChecks = function (src, tag) {
  const ok = (name, cond) => { if (!cond) throw new Error(tag + ' · ' + name); console.log('  PASS ' + tag + ' · ' + name) }
  // 双源中至少有一个为 ESM（package/lib/index.js 有 `export const name`），不用这个区分
  const isPkg = tag === 'npm'
  const wf = isPkg ? '' : 'wf.'  // host.js 注册名带 wf. 前缀；package/lib/index.js 不带
  // 1) helpers 存在
  ok('parseHandoffMtime helper 定义', src.includes('const parseHandoffMtime'))
  ok('pickLatestHandoff helper 定义', src.includes('const pickLatestHandoff'))
  // 2) mtime 解析：isFinite 严格校验（替代脆 Date.parse 单一路径）
  ok('mtime 解析用 isFinite 校验', src.includes('isFinite'))
  ok('mtime 解析覆盖 typeof number 分支', /typeof\s+\w+\s*===\s*['"]number['"]/.test(src))
  // 3) sort：name desc 兜底（不是只看 mtime）
  ok('sort 含 name desc 兜底（b.name < a.name）', /b\.name\s*<\s*a\.name/.test(src))
  // 4) handoffLatest 仍注册
  ok("handoffLatest 仍注册（" + (wf + 'handoffLatest') + "）", src.includes(wf + 'handoffLatest') || src.includes("'handoffLatest'"))
  // 5) handoffResolve 新注册
  ok("handoffResolve 新注册（" + (wf + 'handoffResolve') + "）", src.includes(wf + 'handoffResolve') || src.includes("'handoffResolve'"))
  // 6) handoffResolve 接 args.name
  ok('handoffResolve 处理 args.name', /args(?:\s*&&\s*args)?\.name/.test(src) && /args\.name/.test(src))
  // 7) 三种路径：命中（name 在目录里）/ fallback（无 args.name，走 mtime 最新）/ strict-miss（args.name 有但文件不存在 → null，不退化）
  ok('handoffResolve 命中优先：返回 args.name', src.includes('return { ok: true, file: want }') || /file:\s*want\b/.test(src))
  ok('handoffResolve fallback（无 args.name）：走 mtime 最新', /!want/.test(src) && /pickLatestHandoff\(/.test(src))
  ok('handoffResolve strict-miss（有 args.name 但不在目录）：返回 file=null', /!want/.test(src) && /file:\s*null/.test(src))
  // 8) 旧脆路径已删（typeof number 单分支 + Date.parse 串行脆解析）
  // 旧实现特征：`typeof mt === 'number' ? mt : (mt ? Date.parse(String(mt)) : 0)` 必须已替换
  // 新实现统一走 parseHandoffMtime helper（内部 Date.parse 在 isFinite 校验后用）
  ok('旧脆单行解析已删（no `typeof ... ? ... : Date.parse(String(...))` 单行脆模式）', !/typeof\s+\w+\s*===\s*['"]number['"]\s*\?\s*\w+\s*:\s*\(\s*\w+\s*\?\s*Date\.parse/.test(src))
  ok('旧脆 sort 已删（no inline `mds.sort(function (a, b) { return b.mtime - a.mtime })`)', !/mds\.sort\(function\s*\(a,\s*b\)\s*\{\s*return\s+b\.mtime\s*-\s*a\.mtime/.test(src))
}

// ---- Part B：行为契约 —— 直接调 pickLatestHandoff 验证 7 case ----
const extractHelpers = function (src) {
  // 提取 parseHandoffMtime + pickLatestHandoff 两个函数定义（按括号深度配对定位函数结尾）
  const grab = function (name) {
    const startRe = new RegExp('const\\s+' + name + '\\s*=\\s*function', 'm')
    const m = src.match(startRe)
    if (!m) throw new Error('helper ' + name + ' 未在源中找到')
    const start = m.index
    // 从 `function` 后第一个 `{` 开始统计大括号深度，配对到深度归 0 的 `}`
    const openIdx = src.indexOf('{', start)
    if (openIdx < 0) throw new Error('helper ' + name + ' 未找到 {')
    let depth = 1
    let i = openIdx + 1
    while (i < src.length && depth > 0) {
      const c = src[i]
      if (c === '{') depth++
      else if (c === '}') depth--
      i++
    }
    if (depth !== 0) throw new Error('helper ' + name + ' 大括号不配对')
    // 截到行尾（避免包到下一行注释/代码）
    let end = i
    while (end < src.length && src[end] !== '\n') end++
    return src.slice(start, end)
  }
  return grab('parseHandoffMtime') + '\n' + grab('pickLatestHandoff')
}

const runPickLatest = function (helperSrc, mds) {
  const $ = new Function(
    'mds',
    helperSrc + '\n; return pickLatestHandoff(mds)'
  )
  return $(mds)
}

// 文件命名约定（按时间戳）：YYYYMMDD-HHMMSS.md
// 字典序小 = 时间早 = 旧文件；字典序大 = 时间晚 = 新文件
const OLD = '20260818-074046.md'
const NEW = '20260818-091652.md'

const scenarios = [
  {
    name: 'mtime=NaN（新）+ 正常（旧）→ 旧文件（sort 加固无法区分 mtime 倒挂，主路径兜底）',
    mds: [{ name: OLD, mtime: 1787010180000 }, { name: NEW, mtime: NaN }],
    expect: OLD,
    expectKind: 'sort-subpath-cannot-fix',
  },
  {
    name: 'mtime=null（新）+ 正常（旧）→ 旧文件（同上）',
    mds: [{ name: OLD, mtime: 1787010180000 }, { name: NEW, mtime: null }],
    expect: OLD,
    expectKind: 'sort-subpath-cannot-fix',
  },
  {
    name: 'mtime 全 0（stat 全失败）→ 新文件（name desc 兜底）',
    mds: [{ name: OLD, mtime: 0 }, { name: NEW, mtime: 0 }],
    expect: NEW,
    expectKind: 'sort-subpath-fix',
  },
  {
    name: 'mtime 全等（同 finite）→ 新文件（name desc 兜底）',
    mds: [{ name: OLD, mtime: 1787000000000 }, { name: NEW, mtime: 1787000000000 }],
    expect: NEW,
    expectKind: 'sort-subpath-fix',
  },
  {
    name: 'mtime 全 NaN → 新文件（NaN→0 + name desc 兜底）',
    mds: [{ name: OLD, mtime: NaN }, { name: NEW, mtime: NaN }],
    expect: NEW,
    expectKind: 'sort-subpath-fix',
  },
  {
    name: '混合（new=valid + old=NaN）→ 新文件（NaN→0 顺带修复）',
    mds: [{ name: OLD, mtime: NaN }, { name: NEW, mtime: 1787023412000 }],
    expect: NEW,
    expectKind: 'sort-subpath-fix',
  },
  {
    name: '正常有先后（new>old）→ 新文件（mtime desc 主键生效）',
    mds: [{ name: OLD, mtime: 1787010180000 }, { name: NEW, mtime: 1787023412000 }],
    expect: NEW,
    expectKind: 'sort-baseline',
  },
  {
    name: '空数组 → null（无交接文档）',
    mds: [],
    expect: null,
    expectKind: 'sort-baseline',
  },
  {
    name: '单文件 → 那个文件',
    mds: [{ name: NEW, mtime: 1787023412000 }],
    expect: NEW,
    expectKind: 'sort-baseline',
  },
  {
    name: 'parseHandoffMtime 处理 Date 对象（Date 实例 → getTime）',
    mds: [{ name: OLD, mtime: new Date(1787010180000) }, { name: NEW, mtime: new Date(1787023412000) }],
    expect: NEW,
    expectKind: 'sort-baseline',
  },
]

const main = async function () {
  let failed = false
  for (const file of files) {
    const tag = file.indexOf('package/') >= 0 ? 'npm' : 'dyn'
    console.log('=== ' + file + ' ===')
    const src = fs.readFileSync(file, 'utf8')
    console.log('-- Part A 静态契约 --')
    try { statChecks(src, tag) }
    catch (e) { failed = true; console.log('  FAIL ' + tag + ' Part A — ' + e.message); continue }
    console.log('-- Part B 行为契约（pickLatestHandoff 7+3 case） --')
    let helperSrc
    try { helperSrc = extractHelpers(src) } catch (e) { failed = true; console.log('  FAIL ' + tag + ' 提取异常 — ' + e.message); continue }
    for (const s of scenarios) {
      try {
        const got = runPickLatest(helperSrc, s.mds)
        assert.strictEqual(got, s.expect, '期望 ' + s.expect + '，实际 ' + got)
        console.log('  PASS ' + tag + ' · ' + s.name)
      } catch (e) { failed = true; console.log('  FAIL ' + tag + ' · ' + s.name + ' — ' + e.message) }
    }
  }
  if (failed) { console.log('\n存在失败'); process.exit(1) }
  console.log('\n全部通过')
}
main()