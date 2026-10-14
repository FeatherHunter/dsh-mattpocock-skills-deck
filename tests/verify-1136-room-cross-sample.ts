// tests/verify-1136-room-cross-sample.ts —— 样本门禁：房间之间真出一条边时，门禁当场判红并把这条边点名（#1136）
// 用法：在插件根目录执行 node --import ./scripts/ts-hook.mjs tests/verify-1136-room-cross-sample.ts
//
// 守的是什么（#1136 的现象）：两条房间纪律规则的起点曾经指着搬家前的 src/host/tracker/backends/，
// 磁盘上那个目录早没了 —— 起点命中 0 个模块，于是往 github 房里写一句 import '../gitlab/index.js'
// （真跨房引用）门禁照样退出 0，末行照样打印「房间纪律与禁循环零违规」。这就是假绿：绿灯的样子没变，
// 守的东西没了。这一条用真件把它翻过来，两个探针在同一个进程里跑一次引擎：
//   正控：github 房放一个引别房源码模块的探针文件 → 门禁必须判红，且违规行里点名这条边的两端；
//   负控：同房间引用（./repo.js）不许被误伤 —— 同房放行靠规则里的 $1，抄宽或抄错都会在这里露出来。
// 跑完两个探针都删掉（finally 里删），开跑前先确认它们不在，绝不覆盖别人的文件。
//
// 为什么不挂进 package.json 的 scripts.verify：它是全仓唯一会往工作树里写文件的门禁。
// 挂进链里之后，npm run verify:parallel 并发跑到它时，同一条链上正在扫 src/tracker/** 的门禁
// （tests/verify-dependency-rules.ts、verify-no-mixed-session.js、tests/verify-gate-map.js 等）
// 会看见多出来的两个文件，从而报出与改动无关的假红。所以它按需手跑，作为「房间纪律还咬不咬得到
// 东西」的抽查手段；常驻判据是主门禁里的五条结构判据（改口径、抄宽白名单、起点变死都在那里判红）。
import { spawnSync } from 'node:child_process'
import { existsSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const CROSS_REL = 'src/tracker/rooms/github/zz-1136-probe-cross.ts'
const SAME_REL = 'src/tracker/rooms/github/zz-1136-probe-same.ts'
const GATE_REL = 'tests/verify-dependency-rules.ts'

let failed = 0
let total = 0
const check = (ok: boolean, msg: string) => {
  total += 1
  console.log((ok ? '  PASS ' : '  FAIL ') + msg)
  if (!ok) failed = true
}

const crossAbs = join(ROOT, CROSS_REL)
const sameAbs = join(ROOT, SAME_REL)

// 先看现场：探针文件不该已经在。发现就先停下来 —— 覆盖别人的文件比少跑一次门禁糟得多。
const preexisting = [CROSS_REL, SAME_REL].filter((rel) => existsSync(join(ROOT, rel)))
if (preexisting.length) {
  check(false, '探针文件已经在了，先删掉再跑：' + preexisting.join('、') + '（这份门禁不覆盖已存在的文件）')
} else {
  try {
    writeFileSync(
      crossAbs,
      '// 临时探针（#1136 正控，跑完即删）：github 房的房间文件引别房的源码模块\n' +
        "import '../gitlab/index.js'\n" +
        'export const zzProbeCross = 1\n',
      'utf8'
    )
    writeFileSync(
      sameAbs,
      '// 临时探针（#1136 负控，跑完即删）：同房间引用，不该被判红\n' +
        "import { describe } from './repo.js'\n" +
        'export const zzProbeSame = describe\n',
      'utf8'
    )

    const run = spawnSync(process.execPath, ['--import', './scripts/ts-hook.mjs', GATE_REL], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })
    const output = String(run.stdout || '') + String(run.stderr || '')
    const lines = output.split(/\r?\n/)

    check(run.status !== 0, '正控：真跨房边在场时门禁必须判红（实际退出码 ' + String(run.status) + '）')

    const crossLines = lines.filter((l) => l.includes('zz-1136-probe-cross.ts'))
    const named = crossLines.some((l) => l.includes('cross-room-import') && l.includes('gitlab/index.ts'))
    check(
      named,
      '正控：判红的那一行要点名这条边的两端（cross-room-import：' + CROSS_REL + ' -> ../gitlab/index.js）' +
        (crossLines.length ? '；实际：' + crossLines.join(' ／ ') : '；实际没有任何一行提到探针文件')
    )

    // 负控成立的前提是「同一个目录里的新文件确实进了图」——正控已经证明了这一点（探针被抓到），
    // 所以同房探针没出现在 FAIL 行里，才算真的没被误伤，而不是没被看见。
    const sameFailed = lines.some((l) => l.trim().startsWith('FAIL') && l.includes('zz-1136-probe-same.ts'))
    check(!sameFailed, '负控：同房间引用（' + SAME_REL + ' 引 ./repo.js）不许被判红')

    const greenLine = lines.filter((l) => l.includes('引用方向门禁') || l.includes('新增方向违规'))
    if (run.status !== 0) {
      console.log('    （判红时的收尾行：' + (greenLine.join(' ／ ') || '（没有）') + '）')
    }
  } finally {
    for (const abs of [crossAbs, sameAbs]) {
      try {
        rmSync(abs, { force: true })
      } catch (e) {
        check(false, '删不掉探针文件 ' + abs + '：' + String((e && (e as Error).message) || e))
      }
    }
  }
  const left = [CROSS_REL, SAME_REL].filter((rel) => existsSync(join(ROOT, rel)))
  check(left.length === 0, '跑完清理干净：两个探针都不在工作树里了' + (left.length ? '（还剩 ' + left.join('、') + '）' : ''))
}

console.log('房间纪律样本门禁：' + (total - Number(Boolean(failed))) + '/' + total + ' 条通过')
if (failed) process.exit(1)
