// tests/verify-1152-tracker-same-layer-sample.ts —— 样本门禁：追踪器树里真冒出一条内部互引时，
// same-layer-import-tracker 当场判红并把这条边点名（#1152）
// 用法：在插件根目录执行 node --import ./scripts/ts-hook.mts tests/verify-1152-tracker-same-layer-sample.ts
//
// 守的是什么（#1152 的现象）：src/tracker 这棵树原来长在 src/host/tracker/ 下、受 same-layer-import-host 管；
// #1019 把 99 个文件搬进 src/tracker/ 之后，它们掉出了所有同层规则 —— 树里 15 条互引没有一条有人判，
// 门禁照旧判绿。这一条用真件把新规则翻过来，四个探针在同一个进程里跑一次引擎：
//   正控：src/tracker 下放一个引同层另一个干活文件的探针 → 门禁必须判红，且违规行里点名这条边的两端；
//   负控一：探针引契约层（src/tracker/contract）→ 不许被误伤（契约层是公共面，不在本规则判域里）；
//   负控二：房间里的探针引同房间模块 → 不许被误伤（房间有自己的两条纪律，同房间引用本来就允许）；
//   负控三：契约层内部两个文件互引 → 不许被误伤（契约层内部值引用只许引自己，归 tests/verify-contract-types.ts 管）。
// 跑完四个探针都删掉（finally 里删），开跑前先确认它们不在，绝不覆盖别人的文件。
// #1159 之后判域又去掉了一层：src/tracker/kernel/（房间与宿主都要用的判定件，两边都可以引），
// 所以正控改成引 registry/shape.ts，存量也从 15 条降到 10 条（涉及搬走那四份的 5 条不再是违规）。
//
// 为什么进排除表、不进链：两条独立的理由，与 tests/verify-1136-room-cross-sample.ts 同款。
// 一是它是会往工作树里写文件的门禁：进链之后，并发跑到它时，
// 同一条链上正在扫 src/tracker/** 的门禁（tests/verify-dependency-rules.ts、tests/verify-gate-map.js 等）
// 会看见多出来的四个文件，报出与改动无关的假红。
// 二是链上每一步都要出现在 tests/gate-map.json 里（那份派生表按规划名单核对步数），加一步就得
// 重新生成并提交它；而那份表今天正被别的在办工作线牵动，不该由本票顺手重写。
// 所以它按需手跑，作为「追踪器同层判据还咬不咬得到东西」的端到端抽查；常驻判据是主门禁里的结构判据
// （起点在磁盘上活着、在图上也咬得到东西、规则清单少一条就判红），以及 tests/same-layer-baseline.json 的
// 「只许减不许增」。
import { spawnSync } from 'node:child_process'
import { existsSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const GATE_REL = 'tests/verify-dependency-rules.ts'

// 正控：追踪器树内两个干活文件之间真出一条边。
// #1159 之后内核（src/tracker/kernel/）不在本规则判域里，所以正控不能再引 kernel —— 引注册表里的一份。
const CROSS_REL = 'src/tracker/zz-1152-probe-cross.ts'
const CROSS_TARGET = 'src/tracker/registry/shape.ts'
// 负控一：干活文件引契约层。
const CONTRACT_REL = 'src/tracker/zz-1152-probe-contract.ts'
// 负控二：房间文件引同房间模块。
const ROOM_REL = 'src/tracker/rooms/github/zz-1152-probe-room.ts'
// 负控三：契约层内部互引。
const INNER_REL = 'src/tracker/contract/zz-1152-probe-inner.ts'

const PROBES: Array<{ rel: string, body: string }> = [
  {
    rel: CROSS_REL,
    body:
      '// 临时探针（#1152 正控，跑完即删）：追踪器树内一个干活文件引另一个干活文件\n' +
      "import { handleKey } from './registry/shape.js'\n" +
      'export const zzProbeCross = handleKey\n',
  },
  {
    rel: CONTRACT_REL,
    body:
      '// 临时探针（#1152 负控一，跑完即删）：干活文件引契约层，契约层是公共面，不该被判红\n' +
      "import { TRACKER_CONTRACT } from './contract/index.js'\n" +
      'export const zzProbeContract = TRACKER_CONTRACT\n',
  },
  {
    rel: ROOM_REL,
    body:
      '// 临时探针（#1152 负控二，跑完即删）：房间文件引同房间模块，同房间引用本来就允许\n' +
      "import { ghPreflight } from './preflight.js'\n" +
      'export const zzProbeRoom = ghPreflight\n',
  },
  {
    rel: INNER_REL,
    body:
      '// 临时探针（#1152 负控三，跑完即删）：契约层内部互引，归 tests/verify-contract-types.ts 管\n' +
      "import { TRACKER_CONTRACT } from './index.js'\n" +
      'export const zzProbeInner = TRACKER_CONTRACT\n',
  },
]

let failed = 0
let total = 0
const check = (ok: boolean, msg: string) => {
  total += 1
  console.log((ok ? '  PASS ' : '  FAIL ') + msg)
  if (!ok) failed = true
}

// 先看现场：探针文件不该已经在。发现就先停下来 —— 覆盖别人的文件比少跑一次门禁糟得多。
const preexisting = PROBES.filter((p) => existsSync(join(ROOT, p.rel))).map((p) => p.rel)
if (preexisting.length) {
  check(false, '探针文件已经在了，先删掉再跑：' + preexisting.join('、') + '（这份门禁不覆盖已存在的文件）')
} else {
  try {
    for (const p of PROBES) writeFileSync(join(ROOT, p.rel), p.body, 'utf8')

    const run = spawnSync(process.execPath, ['--import', './scripts/ts-hook.mts', GATE_REL], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })
    const output = String(run.stdout || '') + String(run.stderr || '')
    const lines = output.split(/\r?\n/)
    const failLines = lines.filter((l) => l.trim().startsWith('FAIL'))

    check(run.status !== 0, '正控：树内真出一条互引时门禁必须判红（实际退出码 ' + String(run.status) + '）')

    const named = failLines.some(
      (l) => l.includes('same-layer-import-tracker') && l.includes('zz-1152-probe-cross.ts') && l.includes(CROSS_TARGET),
    )
    check(
      named,
      '正控：判红的那一行要点名这条边的两端（same-layer-import-tracker：' + CROSS_REL + ' -> ' + CROSS_TARGET + '）' +
        (failLines.length ? '；实际 FAIL 行：' + failLines.join(' ／ ') : '；实际没有任何 FAIL 行'),
    )

    // 负控成立的前提是「这些文件确实进了图」——正控已经证明了这一点（新文件被抓到），
    // 所以负控探针没出现在 FAIL 行里，才算真的没被误伤，而不是没被看见。
    // 再加一条计数判据把这件事钉死：探针在场时本规则的违规数必须正好是存量 11 条 + 正控这 1 条。
    // 存量从 10 涨到 11 是 #1445 的既定变化：写会话装配多了一条 open-tracker → pipeline 的同层引用，
    // 已记进 same-layer-baseline.json；除此之外的增减仍然说明判域写宽（多了）或门禁空转（少了）。
    const countLine = lines.find((l) => l.includes('图上违规合计'))
    const trackerCount = countLine ? Number((countLine.match(/same-layer-import-tracker (\d+) 条/) || [])[1] || -1) : -1
    check(
      trackerCount === 12,
      '计数判据：探针在场时 same-layer-import-tracker 必须正好报 12 条（存量 11 + 正控 1），实际 ' + trackerCount +
        (countLine ? '；实际那行：' + countLine.trim() : '；实际没有「图上违规合计」这一行'),
    )

    for (const p of PROBES.slice(1)) {
      const touched = failLines.some((l) => l.includes(p.rel))
      check(!touched, '负控：' + p.rel + ' 不许被判红（不在本规则判域里的引用不该被误伤）')
    }

    if (run.status !== 0) {
      const greenLine = lines.filter((l) => l.includes('引用方向门禁'))
      console.log('    （判红时的收尾行：' + (greenLine.join(' ／ ') || '（没有）') + '）')
    }
  } finally {
    for (const p of PROBES) {
      try {
        rmSync(join(ROOT, p.rel), { force: true })
      } catch (e) {
        check(false, '删不掉探针文件 ' + p.rel + '：' + String((e && (e as Error).message) || e))
      }
    }
  }
  const left = PROBES.filter((p) => existsSync(join(ROOT, p.rel))).map((p) => p.rel)
  check(left.length === 0, '跑完清理干净：四个探针都不在工作树里了' + (left.length ? '（还剩 ' + left.join('、') + '）' : ''))
}

console.log('追踪器同层判据样本门禁：' + (total - Number(Boolean(failed))) + '/' + total + ' 条通过')
if (failed) process.exit(1)
