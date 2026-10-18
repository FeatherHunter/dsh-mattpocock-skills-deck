// tests/verify-1161-rooms-assembly-samples.ts —— 样本门禁：宿主文件直接引房间实现时，门禁当场判红并点名（#1161）
// 用法：在插件根目录执行 node --import ./scripts/ts-hook.mts tests/verify-1161-rooms-assembly-samples.ts
//
// 守的是什么：反方向规则 `rooms-imported-only-by-assembly` 说的是「房间实现只许被装配点引用」。
// 一条规则立起来最容易出的两种假绿，这一条都用真件翻一遍（同一个进程里跑两次引擎）：
//   正控：src/host 下放一个直接引房间源码模块的探针文件 → 门禁必须判红，且判红行点名这条边的两端；
//   负控：探针删掉之后门禁必须回绿 —— 装配点自己（src/tracker/registry/builtins.ts）本来就引房间，
//         它不许被判红（它是唯一出口）；「删了探针就回绿」同时也证明正控那次的红确实来自探针，
//         不是环境里本来就有的别的红。
// 跑完探针删掉（finally 里删），开跑前先确认它不在，绝不覆盖别人的文件。
//
// 为什么进排除表、不进链：两条独立的理由。
// 一是它会往工作树里写文件：进链之后，并发跑到它时，同一条链上正在扫
//   src/** 的门禁（tests/verify-dependency-rules.ts、verify-no-mixed-session.js、verify-gate-map.js 等）
//   会看见多出来的文件，报出与改动无关的假红。
// 二是链上每一步都要出现在 tests/gate-map.json 里（那份派生表按规划名单核对步数），加一步就得
//   重新生成并提交它；而那份表今天正被别的在办工作线牵动，它的存废归 #1124，不该由本票顺手重写。
// 所以它按需手跑，作为「这条反方向规则还咬不咬得到东西」的端到端抽查；常驻判据是主门禁的规则清单那条
// （配置里少了这条规则、名字被改、severity 不是 error，tests/verify-dependency-rules.ts 当场判红）。
import { spawnSync } from 'node:child_process'
import { existsSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const PROBE_REL = 'src/host/zz-1161-probe-room-import.ts'
const GATE_REL = 'tests/verify-dependency-rules.ts'

let failed = 0
let total = 0
const check = (ok: boolean, msg: string) => {
  total += 1
  console.log((ok ? '  PASS ' : '  FAIL ') + msg)
  if (!ok) failed = true
}

const probeAbs = join(ROOT, PROBE_REL)

/** 跑一次真门禁，返回退出码与全部输出（stdout + stderr）。 */
function runGate() {
  const run = spawnSync(process.execPath, ['--import', './scripts/ts-hook.mts', GATE_REL], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  return { status: run.status, output: String(run.stdout || '') + String(run.stderr || '') }
}

// 先看现场：探针文件不该已经在。发现就先停下来 —— 覆盖别人的文件比少跑一次门禁糟得多。
if (existsSync(probeAbs)) {
  check(false, '探针文件已经在了，先删掉再跑：' + PROBE_REL + '（这份门禁不覆盖已存在的文件）')
} else {
  try {
    writeFileSync(
      probeAbs,
      '// 临时探针（#1161 正控，跑完即删）：宿主文件直接引房间实现，按规则 rooms-imported-only-by-assembly 必须判红\n' +
        "import { parseMd } from '../tracker/rooms/markdown/parse.js'\n" +
        'export const zzProbeRoomImport = parseMd\n',
      'utf8'
    )

    const red = runGate()
    const lines = red.output.split(/\r?\n/)

    check(red.status !== 0, '正控：宿主深引房间实现时门禁必须判红（实际退出码 ' + String(red.status) + '）')

    const probeLines = lines.filter((l) => l.includes('zz-1161-probe-room-import.ts'))
    const named = probeLines.some(
      (l) => l.includes('rooms-imported-only-by-assembly') && l.includes('rooms/markdown/parse.ts')
    )
    check(
      named,
      '正控：判红的那一行要点名规则与这条边的两端（rooms-imported-only-by-assembly：' + PROBE_REL +
        " -> '../tracker/rooms/markdown/parse.js'）" +
        (probeLines.length ? '；实际：' + probeLines.join(' ／ ') : '；实际没有任何一行提到探针文件')
    )
  } finally {
    try {
      rmSync(probeAbs, { force: true })
    } catch (e) {
      check(false, '删不掉探针文件 ' + probeAbs + '：' + String((e && (e as Error).message) || e))
    }
  }

  const left = existsSync(probeAbs)
  check(!left, '跑完清理干净：探针不在工作树里了' + (left ? '（还在：' + PROBE_REL + '）' : ''))

  // 负控：探针不在时门禁回绿 —— 装配点自己引房间不算违规，且正控那次的红确实来自探针。
  const green = runGate()
  const greenLines = green.output.split(/\r?\n/).filter((l) => l.includes('引用方向门禁') || l.includes('新增方向违规'))
  check(
    green.status === 0,
    '负控：探针删掉后门禁回绿（装配点引房间不算违规；实际退出码 ' + String(green.status) + '）' +
      (green.status === 0 ? '' : '；收尾行：' + (greenLines.join(' ／ ') || '（没有）'))
  )
}

console.log('房间装配点样本门禁：' + (total - Number(Boolean(failed))) + '/' + total + ' 条通过')
if (failed) process.exit(1)
