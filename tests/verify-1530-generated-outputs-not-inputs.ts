// tests/verify-1530-generated-outputs-not-inputs.ts —— 生成器写出的源码必须被判成派生文件、不算构建输入（#1530）
// 门禁归属: scripts/lib/build-cache.mts
// 门禁归属: scripts/build.mts
// 门禁归属: scripts/generate-time-config.mts
// 门禁归属: scripts/generate-prompt-config.mts
// 门禁归属: scripts/generate-locale-config.mts
// 门禁归属: scripts/generate-md-format-config.mts
//
// 要守的事（票 #1530 的根因）：构建会改自己的输入。
// scripts/build.mts 先判构建缓存命中，再在构建中段依次 spawn 四个生成器（:1752 / :1758 / :1764 / :1772），
// 由它们现场写出几份「生成源码」；这些文件又躺在 scripts/lib/build-cache.mts 的输入树（src/）里。
// 其中 src/shared/time-config/values.d.ts 一直没有派生文件头，looksDerived() 认不出它，
// listInputs() 就把生成物算成了输入：生成器一改写它，输入摘要当场与开工时对不上；
// 构建最后 writeBuildCache() 用的却是被 memoInputFingerprint 记住的开工指纹（没有 reset），
// 于是缓存里记下的是「生成器改写之前」的旧指纹，下一次构建才发现对不上、再写一次（#1530 的现象）。
//
// 修法是不让构建改自己的输入（不是把算指纹的时点往后挪）：每份生成物自带派生文件头，
// looksDerived() 认得它，listInputs() 就把它排除——这也是 scripts/lib/build-cache.mts:71-79
// 早就写下的约定。本门禁用三件断言钉住这条不变量：
//   1. 下面的登记表与 scripts/build.mts 里真 spawn 的生成器一一对应：将来有人加生成器却漏登记，这里红；
//   2. 每份生成物都不在 listInputs() 的清单里：这就是「构建不能改自己的输入」的直接写法；
//   3. 每份生成物在盘上时 looksDerived() 为真：即文件头 300 字符里有 AUTO-GENERATED / 人手不改 / DO NOT EDIT。
// 另外钉一条：scripts/ 下每个 generate-*.mts 都要么登记了产物、要么登记「不写源码」，新增生成器漏登记会红。
//
// 不测「writeBuildCache 写回前要不要重算指纹」：诊断时的对抗式复核
// （research/1530-build-cache-stale-fingerprint-2026-10-26.md 第 7 节）没有采纳运行时重算——
// 写回在编译之后，重算会把编译期间别的会话写进的新输入记进指纹，把安全的「记少」翻成危险的「记多」
// （缓存声称产物是用更新的输入造的，于是该重建时跳过、留下过期产物）。只要输入在构建期间不变，
// 开工时记住的指纹就一直是对的。
//
// 生成物不在盘上时现场生成一次（链上前面有构建，通常已经就位），做法与 tests/lib/prompt-data.ts 同款，
// 这样全新检出单独跑本门禁也不是假绿。
//
// 用法: node --import ./scripts/ts-hook.mts tests/verify-1530-generated-outputs-not-inputs.ts

const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
// 判据只从构建缓存那一处取：门禁不另抄一份「什么算派生文件」。
const { listInputs, looksDerived } = require('../scripts/lib/build-cache.mts')

const ROOT = path.resolve(__dirname, '..')

let failed = false
let total = 0
const check = (ok: boolean, msg: string, detail?: string): void => {
  total += 1
  console.log((ok ? '  PASS ' : '  FAIL ') + msg + (ok || !detail ? '' : '（' + detail + '）'))
  if (!ok) failed = true
}

// ── 登记表：哪个生成器写出哪些源码。改生成器时同步这里（本文件第 1 节会拿它跟 build.mts 对） ──
interface Producer {
  script: string
  files: string[]
}
const PRODUCERS: Producer[] = [
  { script: 'scripts/generate-time-config.mts', files: ['src/shared/time-config/src/values.ts', 'src/shared/time-config/values.d.ts'] },
  { script: 'scripts/generate-prompt-config.mts', files: ['src/client/kernel/prompt-data.ts'] },
  { script: 'scripts/generate-locale-config.mts', files: ['src/client/kernel/locale-data.ts'] },
  { script: 'scripts/generate-md-format-config.mts', files: ['src/tracker/rooms/markdown/format/generated.ts'] },
]
const GENERATED_FILES: string[] = PRODUCERS.flatMap((p: Producer) => p.files)

console.log('生成器写出的源码不算构建输入（#1530）')

// ── 第 1 节：登记表与 build.mts 里真 spawn 的生成器一一对应 ──
// 扫描写法钉的是构建里那条真实调用（resolve(ROOT, 'scripts', 'generate-xxx.mts')）。
// 将来构建改了调用形态，这里会先报「认不出生成器调用」而不是静默变绿。
const spawned = new Set<string>()
{
  const buildText = fs.readFileSync(path.join(ROOT, 'scripts', 'build.mts'), 'utf8')
  const re = /resolve\(ROOT,\s*'scripts',\s*'(generate-[a-z0-9-]+\.mts)'\)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(buildText)) !== null) spawned.add('scripts/' + m[1])
}
check(spawned.size > 0, '在 scripts/build.mts 里认得出生成器调用（防止扫描规则失效后本门禁假绿）', '一条都没认到')
const registeredScripts = new Set<string>(PRODUCERS.map((p: Producer) => p.script))
for (const p of PRODUCERS) {
  check(spawned.has(p.script), p.script + ' 确实由 scripts/build.mts 在构建中段调用', 'build.mts 的调用清单里没有它')
}
for (const script of Array.from(spawned)) {
  check(registeredScripts.has(script), script + ' 写出的源码已登记在本门禁的清单里（新增生成器时要补登记）', '登记表里没有这个生成器')
}

// ── 第 2 节：生成物都在盘上；不在盘上时现场生成一次 ──
// 不写源码的生成器登记在这里并写明原因：scripts/ 下新加一个 generate-*.mts 却忘了登记时，
// 下面这段会红——否则将来冒出的第 6 份「没人管的产物」可能又落回构建输入（正是 #1530 的形状）。
const NOT_SOURCE_GENERATORS: Record<string, string> = {
  'scripts/generate-star-history-svg.mts': '写 docs/ 里的星标历史图，不进构建输入、也不是源码生成器',
}
{
  const onDisk: string[] = fs.readdirSync(path.join(ROOT, 'scripts'))
    .filter((name: string) => /^generate-.*\.mts$/.test(name))
    .map((name: string) => 'scripts/' + name)
  for (const script of onDisk) {
    check(
      registeredScripts.has(script) || script in NOT_SOURCE_GENERATORS,
      script + ' 已登记（要么在 PRODUCERS 里写明产物，要么在 NOT_SOURCE_GENERATORS 里写明不写源码）',
      '新增生成器没登记：写源码就补进 PRODUCERS，不写源码就登记到 NOT_SOURCE_GENERATORS 并写原因',
    )
  }
}
// 每份登记产物固定一条断言，暖盘与全新检出的断言数一样（将来开闸写死条数时不会因盘态来回判红）。
for (const p of PRODUCERS) {
  const missing = p.files.filter((rel: string) => !fs.existsSync(path.join(ROOT, rel)))
  let ok = missing.length === 0
  let detail = ''
  if (!ok) {
    const r: any = spawnSync(process.execPath, [path.join(ROOT, p.script)], { cwd: ROOT, encoding: 'utf8' })
    ok = r.status === 0
    if (!ok) detail = String(r.stdout || '').trim().split('\n').slice(0, 3).join(' / ') || String(r.stderr || '').trim().split('\n').slice(0, 3).join(' / ')
  }
  check(ok, p.files.join('、') + ' 在盘上（缺了就现场跑 ' + p.script + '）', detail)
}
const missingNow = GENERATED_FILES.filter((rel: string) => !fs.existsSync(path.join(ROOT, rel)))
check(missingNow.length === 0, '全部 ' + GENERATED_FILES.length + ' 份生成物都在盘上', '缺：' + missingNow.join('、'))
if (missingNow.length !== 0) {
  console.log('')
  console.log('生成物缺着，后面的断言判不可信，先看上面生成器为什么失败。')
  process.exit(1)
}

// ── 第 3 节：每份生成物都不在构建输入清单里 ──
const inputs: string[] = listInputs(ROOT)
check(inputs.length > 100, 'listInputs() 扫到了输入文件（清单不是空的）', '只扫到 ' + inputs.length + ' 份')
const inputSet = new Set<string>(inputs)
for (const rel of GENERATED_FILES) {
  check(
    !inputSet.has(rel),
    rel + ' 不在构建输入清单里（生成物不算输入）',
    '生成器会改写它；构建若把它当输入，输入摘要就会在构建中段变化，缓存写回的指纹跟着变旧',
  )
}

// ── 第 4 节：判据认得出这些生成物（派生文件头在文件最前面） ──
for (const rel of GENERATED_FILES) {
  check(
    looksDerived(path.join(ROOT, rel)),
    rel + ' 带派生文件头（looksDerived() 认得）',
    '文件头 300 字符里没有 AUTO-GENERATED / 人手不改 / DO NOT EDIT；缺标记就会被当成输入',
  )
}

console.log('')
console.log(failed ? '失败 ' + total + ' 条断言' : '全部通过：' + total + ' 条断言')
process.exit(failed ? 1 : 0)