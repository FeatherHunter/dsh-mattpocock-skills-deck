// tests/verify-1159-deck-kernel-sample.ts —— 样本门禁：deck 直连共享内核时，
// deck-deep-import 当场判红并把这条边点名（#1159）
// 用法：在插件根目录执行 node --import ./scripts/ts-hook.mjs tests/verify-1159-deck-kernel-sample.ts
//
// 守的是什么：`src/tracker/kernel/` 是房间与宿主都要用的判定件（#1159 建的归口）。deck 层只许连
// 契约层的公开入口，不许直接连内核 —— 否则这份新目录会变成绕开「只许连契约」的后门。
// 规则是 `.dependency-cruiser.cjs` 的 deck-deep-import，它的 `to` 已含 `^src/tracker/kernel/`；
// 这一条用真件把那半句翻过来，两个探针在同一个进程里跑一次引擎：
//   正控：src/deck 下放一个引内核的探针 → 门禁必须判红，且违规行里点名这条边的两端；
//   负控：同一个位置引契约层（src/tracker/contract）→ 不许被误伤（契约层本来就是 deck 唯一可以深引的公共面）。
// 跑完两个探针都删掉（finally 里删），开跑前先确认它们不在，绝不覆盖别人的文件。
//
// 为什么进排除表、不进链：两条独立的理由，与 tests/verify-1136-room-cross-sample.ts 同款。
// 一是它是会往工作树里写文件的门禁：进链之后，并发跑到它时，
// 同一条链上正在扫 src/deck/** 与 src/tracker/** 的门禁（tests/verify-dependency-rules.ts、
// tests/verify-gate-map.js 等）会看见多出来的两个文件，报出与改动无关的假红。
// 二是链上每一步都要出现在 tests/gate-map.json 里（那份派生表按规划名单核对步数），加一步就得
// 重新生成并提交它。所以它按需手跑，作为「deck 不许直连内核」这条判据还咬不咬得到东西的端到端抽查；
// 常驻判据是主门禁里的规则清单核对（少一条、改名、降级就判红）与起点活着判据。
import { spawnSync } from 'node:child_process'
import { existsSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const GATE_REL = 'tests/verify-dependency-rules.ts'

// 正控：deck 层直连共享内核（规则要判红的那一类）。
const DECK_KERNEL_REL = 'src/deck/zz-1159-probe-kernel.ts'
const DECK_KERNEL_TARGET = 'src/tracker/kernel/error-rules.ts'
// 负控：deck 层引契约层（规则允许的那一类）。
const DECK_CONTRACT_REL = 'src/deck/zz-1159-probe-contract.ts'

const PROBES: Array<{ rel: string, body: string }> = [
  {
    rel: DECK_KERNEL_REL,
    body:
      '// 临时探针（#1159 正控，跑完即删）：deck 直连共享内核，规则必须判红\n' +
      "import { RULE_LAYERS } from '../tracker/kernel/error-rules.js'\n" +
      'export const zzProbeDeckKernel = RULE_LAYERS\n',
  },
  {
    rel: DECK_CONTRACT_REL,
    body:
      '// 临时探针（#1159 负控，跑完即删）：deck 引契约层，这是允许的方向，不该被判红\n' +
      "import { BACKEND_KIND } from '../tracker/contract/vocabulary.js'\n" +
      'export const zzProbeDeckContract = BACKEND_KIND\n',
  },
]

let failed = 0
let total = 0
const check = (ok: boolean, msg: string) => {
  total += 1
  console.log((ok ? '  PASS ' : '  FAIL ') + msg)
  if (!ok) failed = true
}

const preexisting = PROBES.filter((p) => existsSync(join(ROOT, p.rel))).map((p) => p.rel)
if (preexisting.length) {
  check(false, '探针文件已经在了，先删掉再跑：' + preexisting.join('、') + '（这份门禁不覆盖已存在的文件）')
} else {
  try {
    for (const p of PROBES) writeFileSync(join(ROOT, p.rel), p.body, 'utf8')

    const run = spawnSync(process.execPath, ['--import', './scripts/ts-hook.mjs', GATE_REL], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })
    const output = String(run.stdout || '') + String(run.stderr || '')
    const lines = output.split(/\r?\n/)
    const failLines = lines.filter((l) => l.trim().startsWith('FAIL'))

    check(run.status !== 0, '正控：deck 直连内核时门禁必须判红（实际退出码 ' + String(run.status) + '）')

    const named = failLines.some(
      (l) => l.includes('deck-deep-import') && l.includes('zz-1159-probe-kernel.ts') && l.includes(DECK_KERNEL_TARGET),
    )
    check(
      named,
      '正控：判红的那一行要点名这条边的两端（deck-deep-import：' + DECK_KERNEL_REL + ' -> ' + DECK_KERNEL_TARGET + '）' +
        (failLines.length ? '；实际 FAIL 行：' + failLines.join(' ／ ') : '；实际没有任何 FAIL 行'),
    )

    // 计数判据：探针在场时 deck-deep-import 必须正好 1 条（今天这条规则零违规，多一条就是探针这一条）。
    // 少了说明探针没进图（这条门禁在空转）；多了说明判域写宽了、把别的方向也算进来了。
    const countLine = lines.find((l) => l.includes('图上违规合计'))
    const deckCount = countLine ? Number((countLine.match(/deck-deep-import (\d+) 条/) || [])[1] || -1) : -1
    check(
      deckCount === 1,
      '计数判据：探针在场时 deck-deep-import 必须正好报 1 条（今天这条规则零违规），实际 ' + deckCount +
        (countLine ? '；实际那行：' + countLine.trim() : '；实际没有「图上违规合计」这一行（零违规时那行只列非零的规则）'),
    )

    const touched = failLines.some((l) => l.includes(DECK_CONTRACT_REL))
    check(!touched, '负控：' + DECK_CONTRACT_REL + ' 不许被判红（deck 引契约层是允许的方向）')

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
  check(left.length === 0, '跑完清理干净：两个探针都不在工作树里了' + (left.length ? '（还剩 ' + left.join('、') + '）' : ''))
}

console.log('deck 直连内核样本门禁：' + (total - Number(Boolean(failed))) + '/' + total + ' 条通过')
if (failed) process.exit(1)
