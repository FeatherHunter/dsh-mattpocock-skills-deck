// tests/verify-gate-map.js —— 给「门禁归属表」和「按改动挑门禁」这两件事把关的门禁。
//
// 为什么要有这一条：
//   scripts/gate-map.mjs 生成的 tests/gate-map.json 是一张派生表，它一旦过期，
//   scripts/lib/select-gates.mjs 挑出来的门禁就是错的——少跑了门禁，红的信号会一直到
//   合并之后才出现。所以这里做四件事：
//     1. 新鲜度：重新推导一遍归属，和 tests/gate-map.json 逐字节比；不一致就红，
//        并告诉你重跑 `node scripts/gate-map.mjs`。
//     2. 覆盖面：src/ 下每个文件，要么有门禁守着，要么在 ungated 里写清了原因；
//        既没门禁又没理由的，红。
//     3. 挑选规则的场景测试：拿真实的归属表，喂几个假想的变更清单，看挑出来的门禁对不对。
//        其中含一条反向测试，证明挑选确实在筛，不是把全链都选上。
//     4. 和链一致：归属表里的 step 集合必须等于当前 package.json 链上的 step 集合。
//
// 用法: node tests/verify-gate-map.js（在插件根目录）
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'

import { buildGateMap, normalizeForCompare, readChainSteps, ROOT, isUnder } from '../scripts/gate-map.mjs'
import { selectGates, isCrossCutting } from '../scripts/lib/select-gates.mjs'

const MAP_PATH = path.join(ROOT, 'tests', 'gate-map.json')

let failed = false
let passCount = 0
const check = (ok, msg) => {
  if (ok) passCount++
  else failed = true
  console.log((ok ? '  PASS ' : '  FAIL ') + msg)
}
const info = (msg) => console.log('  INFO ' + msg)

console.log('门禁归属表与挑选规则门禁')

// ---------------------------------------------------------------------------
// 读入被测对象
// ---------------------------------------------------------------------------
const chainSteps = readChainSteps(ROOT)
check(chainSteps.length > 0, '从 package.json 的 scripts.verify 里读到了链，共 ' + chainSteps.length + ' 步')

if (!fs.existsSync(MAP_PATH)) {
  check(false, 'tests/gate-map.json 不存在：请先跑 node scripts/gate-map.mjs')
  console.log('\n存在失败')
  process.exit(1)
}
const onDisk = JSON.parse(fs.readFileSync(MAP_PATH, 'utf8'))
const map = onDisk
const derived = buildGateMap(ROOT)

// ---------------------------------------------------------------------------
// 1) 新鲜度：重新推导一遍，和落盘的表逐字节比
// ---------------------------------------------------------------------------
{
  const a = JSON.stringify(normalizeForCompare(onDisk))
  const b = JSON.stringify(normalizeForCompare(derived))
  const same = a === b
  if (!same) {
    // 找出第一处不同，把两边的上下文打出来，方便一眼看到是哪里过期了
    let i = 0
    const n = Math.min(a.length, b.length)
    while (i < n && a[i] === b[i]) i++
    const ctx = (s) => s.slice(Math.max(0, i - 60), i + 60).replace(/\n/g, '⏎')
    info('落盘的表：链上 ' + onDisk.chainLength + ' 步，能推出归属 ' + onDisk.attributedGates + ' 步，byDir ' + Object.keys(onDisk.byDir || {}).length + ' 个目录，src 覆盖 ' + (onDisk.coverage && onDisk.coverage.coveredFileCount) + '/' + (onDisk.coverage && onDisk.coverage.fileCount))
    info('刚推导的：链上 ' + derived.chainLength + ' 步，能推出归属 ' + derived.attributedGates + ' 步，byDir ' + Object.keys(derived.byDir).length + ' 个目录，src 覆盖 ' + derived.coverage.coveredFileCount + '/' + derived.coverage.fileCount)
    info('第 ' + i + ' 个字符起就不同了（表里是「' + ctx(a) + '」，实际是「' + ctx(b) + '」）')
  }
  check(same, '归属表是最新的：重新推导的结果与 tests/gate-map.json 一致（不一致就重跑 node scripts/gate-map.mjs）')
}

// ---------------------------------------------------------------------------
// 2) 结构和自洽
// ---------------------------------------------------------------------------
{
  check(map.version === 1, '归属表的版本号是 1')
  check(typeof map.generatedAt === 'string' && !Number.isNaN(Date.parse(map.generatedAt)), '归属表里记了生成时间 generatedAt')
  check(map.chainLength === chainSteps.length, '归属表记的链长 ' + map.chainLength + ' 等于当前链的步数 ' + chainSteps.length)
  check(map.gateCount === map.gates.length, '归属表记的门禁条数 ' + map.gateCount + ' 等于 gates 数组长度 ' + map.gates.length)

  const mapSteps = map.gates.map((g) => g.step)
  const onChain = new Set(chainSteps)
  const mapStepSet = new Set(mapSteps)
  const missingOnMap = chainSteps.filter((s) => !mapStepSet.has(s))
  const extraOnMap = mapSteps.filter((s) => !onChain.has(s))
  check(
    missingOnMap.length === 0 && extraOnMap.length === 0,
    '归属表里的 step 集合与当前链上的 step 集合完全一致（只在链上不在表里 ' + missingOnMap.length + ' 条，只在表里不在链上 ' + extraOnMap.length + ' 条）',
  )
  if (missingOnMap.length) info('只在链上、表里没有的：' + missingOnMap.slice(0, 3).join(' | '))
  if (extraOnMap.length) info('只在表里、链上已经没有的：' + extraOnMap.slice(0, 3).join(' | '))
  check(mapSteps.length === new Set(mapSteps).size, '归属表里没有重复的 step')
}

{
  let shapeBad = 0
  let guardMissing = 0
  let reasonEmpty = 0
  for (const gate of map.gates) {
    if (
      typeof gate.step !== 'string' ||
      typeof gate.file !== 'string' ||
      !Array.isArray(gate.guards) ||
      !Array.isArray(gate.dirs) ||
      typeof gate.unattributed !== 'boolean'
    ) {
      shapeBad++
      continue
    }
    if (typeof gate.reason !== 'string' || !gate.reason.trim()) reasonEmpty++
    for (const g of gate.guards) {
      if (!fs.existsSync(path.join(ROOT, g))) guardMissing++
    }
  }
  check(shapeBad === 0, '每扇门禁都写齐了 step / file / guards / dirs / unattributed 五个字段（缺字段 ' + shapeBad + ' 条）')
  check(reasonEmpty === 0, '每扇门禁都写了 reason，说明它的归属是怎么来的（空 reason ' + reasonEmpty + ' 条）')
  check(guardMissing === 0, '归属表里记的每个 guards 路径都在磁盘上真实存在（不存在的 ' + guardMissing + ' 条）')

  const unattributed = map.gates.filter((g) => g.unattributed)
  check(
    map.attributedGates === map.gates.length - unattributed.length,
    '归属统计自洽：能推出归属 ' + map.attributedGates + ' 步，推不出 ' + unattributed.length + ' 步',
  )
  check(unattributed.every((g) => g.reason.trim().length > 0), '推不出归属的门禁，每一扇都写清了原因')
}

{
  // byDir 的每一层要么是空数组（这一层没有门禁，但它是某个被守着目录的祖先），
  // 要么列出的是链上真实存在的门禁；而且每个被守着目录的所有祖先都要有键，查表不会查空。
  const onChain = new Set(chainSteps)
  let badStep = 0
  let missingAncestor = 0
  for (const dir of Object.keys(map.byDir)) {
    for (const step of map.byDir[dir]) if (!onChain.has(step)) badStep++
  }
  for (const gate of map.gates) {
    for (const dir of gate.dirs) {
      let cur = dir
      while (true) {
        if (!(cur in map.byDir)) missingAncestor++
        if (cur === '.') break
        const i = cur.lastIndexOf('/')
        cur = i < 0 ? '.' : cur.slice(0, i)
      }
    }
  }
  check(badStep === 0, 'byDir 里列出的门禁都在当前链上（不在链上的 ' + badStep + ' 条）')
  check(missingAncestor === 0, 'byDir 覆盖了每个被守着目录的全部祖先层，查表不会查空（缺 ' + missingAncestor + ' 层）')
}

// ---------------------------------------------------------------------------
// 3) 覆盖面：src/ 下每个文件要么有门禁守着，要么写清了原因
// ---------------------------------------------------------------------------
{
  const srcFiles = []
  // 「src/ 下的目录」把 src/ 自己也算一层：归属表 byDir 里有 src 这个键，
  // 覆盖报告里的目录数也要跟它同一个口径，不然两边永远差一个。
  const srcDirs = ['src']
  const walk = (absDir, relDir) => {
    for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
      const rel = relDir ? relDir + '/' + entry.name : entry.name
      if (entry.isDirectory()) {
        srcDirs.push(rel)
        walk(path.join(absDir, entry.name), rel)
      } else if (entry.isFile()) {
        srcFiles.push(rel)
      }
    }
  }
  walk(path.join(ROOT, 'src'), 'src')
  const allFiles = new Set(srcFiles)
  const allDirs = new Set(srcDirs)

  const guarded = new Set(map.coverage.guardedFiles)
  const ungatedPaths = new Set(map.coverage.ungated.map((u) => u.path))

  check(
    map.coverage.fileCount === srcFiles.length,
    '覆盖面记的文件数与磁盘上 src/ 的文件数一致（表里 ' + map.coverage.fileCount + '，磁盘上 ' + srcFiles.length + '）',
  )
  check(
    map.coverage.dirCount === srcDirs.length,
    '覆盖面记的目录数与磁盘上 src/ 的目录数一致（表里 ' + map.coverage.dirCount + '，磁盘上 ' + srcDirs.length + '）',
  )

  const overlap = srcFiles.filter((f) => guarded.has(f) && ungatedPaths.has(f))
  check(overlap.length === 0, '同一个文件不会既算「有门禁守着」又出现在 ungated 里（重叠 ' + overlap.length + ' 个）')

  const unknown = srcFiles.filter((f) => !guarded.has(f) && !ungatedPaths.has(f))
  check(
    unknown.length === 0,
    'src/ 下每个文件要么有门禁守着，要么在 ungated 里写清了原因，没有「既没门禁又没理由」的（' + unknown.length + ' 个）',
  )
  if (unknown.length) info('没有交代的文件（前 5 个）：' + unknown.slice(0, 5).join(' | '))

  const ghostGuarded = map.coverage.guardedFiles.filter((f) => !allFiles.has(f))
  check(ghostGuarded.length === 0, 'guardedFiles 里没有磁盘上已经不存在的文件（多出来 ' + ghostGuarded.length + ' 个）')

  const emptyReason = map.coverage.ungated.filter((u) => !u.reason || !u.reason.trim()).length
  check(emptyReason === 0, 'ungated 里每一条都写了原因（空原因 ' + emptyReason + ' 条）')

  const ungatedDirPaths = map.coverage.ungatedDirs.map((d) => d.path)
  const badDir = ungatedDirPaths.filter((d) => !allDirs.has(d)).length
  check(badDir === 0, 'ungatedDirs 里的目录都在磁盘上存在（不存在 ' + badDir + ' 个）')
  check(
    map.coverage.ungatedDirs.every((d) => d.reason && d.reason.trim()),
    '整目录没有门禁覆盖的 ' + map.coverage.ungatedDirs.length + ' 个目录都写了原因',
  )

  // 归属写成目录的门禁（`// 门禁归属: src/client/views`）必须真的把那一层以下的文件都算成已覆盖：
  // 依赖图只有文件到文件的边，目录本身没有边，这条断言守着「目录归属在覆盖面这一侧没被漏掉」。
  const guardedDirsInCoverage = new Set(map.coverage.guardedDirs)
  const dirGuards = new Set()
  for (const g of map.gates) {
    for (const guard of g.guards || []) if (allDirs.has(guard)) dirGuards.add(guard)
  }
  const dirGuardLost = Array.from(dirGuards).filter((d) => !guardedDirsInCoverage.has(d))
  check(
    dirGuardLost.length === 0,
    '归属写成目录的门禁，那些目录都在 guardedDirs 里（漏掉的 ' + dirGuardLost.length + ' 个）',
  )
  const dirGuardFilesLost = []
  for (const d of dirGuards) {
    for (const f of srcFiles.filter((f) => f === d || f.startsWith(d + '/'))) if (!guarded.has(f)) dirGuardFilesLost.push(f)
  }
  check(
    dirGuardFilesLost.length === 0,
    '归属写成目录的门禁，把那一层以下的文件都算成了已覆盖（漏掉的 ' + dirGuardFilesLost.length + ' 个）',
  )
  if (dirGuardFilesLost.length) info('没算成已覆盖的文件（前 5 个）：' + dirGuardFilesLost.slice(0, 5).join(' | '))

  // 「有门禁」与「有专属门禁」是两件事：前者靠宽口径归属也成立，后者要求这一层被点名。
  const dedicatedDirs = map.coverage.dedicatedDirs || []
  const dirsWithoutDedicated = map.coverage.dirsWithoutDedicated || []
  check(
    map.coverage.dedicatedDirCount === dedicatedDirs.length,
    '专属门禁目录数 ' + map.coverage.dedicatedDirCount + ' 等于 dedicatedDirs 的长度 ' + dedicatedDirs.length,
  )
  const dedicatedNotGuarded = dedicatedDirs.filter((d) => !allDirs.has(d) || !guardedDirsInCoverage.has(d))
  check(
    dedicatedNotGuarded.length === 0,
    '有专属门禁的目录都是 src/ 下真实存在、且算作有门禁覆盖的目录（对不上的 ' + dedicatedNotGuarded.length + ' 个）',
  )
  const badNoDedicated = dirsWithoutDedicated.filter((d) => !allDirs.has(d.path) || !(d.fileCount > 0))
  check(
    badNoDedicated.length === 0,
    '没有专属门禁的目录都在磁盘上存在、且文件数大于 0（对不上的 ' + badNoDedicated.length + ' 个）',
  )
  check(
    dedicatedDirs.length + dirsWithoutDedicated.length === map.coverage.dirCount,
    '有专属门禁的目录 ' +
      dedicatedDirs.length +
      ' 加没有的 ' +
      dirsWithoutDedicated.length +
      ' 等于 src/ 的目录数 ' +
      map.coverage.dirCount,
  )

  // 交叉核对：专属门禁目录这份名单必须能从 gates[].guards 自己算出来。
  // 只比「数量加不加得起来」是不够的——生成器要是漏记了这份名单，dedicatedDirs 会空，
  // 0 + 40 也等于 40，照样绿。这条从另一份数据（每扇门禁的 guards）重算一遍再比。
  const recomputed = new Set()
  for (const g of map.gates) {
    for (const guard of g.guards || []) {
      if (!guard.startsWith('src')) continue
      recomputed.add(allDirs.has(guard) ? guard : path.dirname(guard))
    }
  }
  const dedicatedSet = new Set(dedicatedDirs)
  const mismatch = []
  for (const d of recomputed) if (!dedicatedSet.has(d)) mismatch.push('少了 ' + d)
  for (const d of dedicatedSet) if (!recomputed.has(d)) mismatch.push('多了 ' + d)
  check(
    mismatch.length === 0,
    '专属门禁目录名单与 gates[].guards 重算的结果一致（对不上的 ' +
      mismatch.length +
      ' 个' +
      (mismatch.length ? '：' + mismatch.slice(0, 5).join(' | ') : '') +
      '）',
  )
  check(
    recomputed.size > 0,
    '归属表里确实有门禁点名了 src/ 下的目录或文件（重算得到 ' + recomputed.size + ' 个目录，为 0 说明归属解析坏了）',
  )

  info(
    'src/ 覆盖面：' +
      map.coverage.coveredFileCount +
      '/' +
      map.coverage.fileCount +
      ' 个文件有门禁，' +
      map.coverage.ungatedFileCount +
      ' 个没门禁；' +
      map.coverage.ungatedDirCount +
      ' 个目录整目录没覆盖；' +
      map.coverage.dedicatedDirCount +
      '/' +
      map.coverage.dirCount +
      ' 个目录有专属门禁（没专属门禁的 ' +
      dirsWithoutDedicated.length +
      ' 个' +
      (dirsWithoutDedicated.length
        ? '：' + dirsWithoutDedicated.map((d) => d.path + '(' + d.fileCount + ')').slice(0, 5).join(' | ')
        : '') +
      '）',
  )
}

// ---------------------------------------------------------------------------
// 4) 挑选规则的场景测试
// ---------------------------------------------------------------------------
const chainSet = new Set(chainSteps)
const sel = (paths) => selectGates({ changedPaths: paths, map, chainSteps })

/** 挑选结果的基本自洽：选出来的都得在链上，reasons 要覆盖每一扇选中的门禁。 */
function checkSelectionShape(out, label) {
  const bad = out.steps.filter((s) => !chainSet.has(s))
  const dup = out.steps.length !== new Set(out.steps).size
  const reasonOk =
    out.fullChain === true
      ? out.steps.every((s) => out.reasons.some((r) => r.step === s && r.reason))
      : out.steps.every((s) => out.reasons.some((r) => r.step === s && r.reason)) &&
        out.steps.length === out.reasons.length
  check(bad.length === 0 && !dup, label + '：选出来的门禁都在当前链上、没有重复（越界 ' + bad.length + ' 条）')
  check(reasonOk, label + '：每一扇选中的门禁都写了被选中的原因')
}

// 场景一：改版本管理页签的入口文件，应当带上守着它、守着它的父目录、再上一级目录的三层门禁
{
  const changed = firstJsFileIn('src/client/views/versionControl')
  check(!!changed, '找得到 src/client/views/versionControl/ 下的 .js 文件用来做场景测试（找到 ' + changed + '）')
  const out = sel([changed])
  checkSelectionShape(out, '场景一')
  check(!out.fullChain, '场景一：改 ' + changed + ' 不会退化成全链')
  const levels = ['src/client/views/versionControl', 'src/client/views', 'src/client']
  for (const dir of levels) {
    const atLevel = map.byDir[dir] || []
    check(atLevel.length > 0, '场景一：归属表里 ' + dir + ' 这一层有门禁守着（共 ' + atLevel.length + ' 扇），这条断言才有意义')
    const missed = atLevel.filter((s) => !out.steps.includes(s))
    check(missed.length === 0, '场景一：守着 ' + dir + ' 这一层的门禁全被选中（该选 ' + atLevel.length + ' 扇，漏 ' + missed.length + ' 扇）')
  }
  check(out.steps.length < chainSteps.length, '场景一：选中的 ' + out.steps.length + ' 步比全链 ' + chainSteps.length + ' 步少')
}

// 场景二：改 src/client/views/ 直接下面的文件，应当带上守着 views 这一层和 client 这一层的门禁
{
  const changed = firstJsFileIn('src/client/views')
  check(!!changed, '找得到 src/client/views/ 直接下面的 .js 文件（找到 ' + changed + '）')
  const out = sel([changed])
  checkSelectionShape(out, '场景二')
  check(!out.fullChain, '场景二：改 ' + changed + ' 不会退化成全链')
  for (const dir of ['src/client/views', 'src/client']) {
    const atLevel = map.byDir[dir] || []
    check(atLevel.length > 0, '场景二：归属表里 ' + dir + ' 这一层有门禁守着（共 ' + atLevel.length + ' 扇）')
    const missed = atLevel.filter((s) => !out.steps.includes(s))
    check(missed.length === 0, '场景二：守着 ' + dir + ' 这一层的门禁全被选中（漏 ' + missed.length + ' 扇）')
  }
}

// 场景三：改被很多人 import 的底层模块，必须带上反向依赖它的那些门禁
{
  const target = 'src/shared/refresh/budget.js'
  check(fs.existsSync(path.join(ROOT, target)), '底层共享模块 ' + target + ' 还在（场景三要用它）')
  // 这里自己扫一遍 src/，算出谁 import 了这个文件——不调被测的建图代码，免得自证自话。
  const importers = whoImports(target)
  check(importers.length >= 5, '场景三：自己扫出来的直接 import ' + target + ' 的文件有 ' + importers.length + ' 个，足够支撑这条测试')
  const expectGates = map.gates
    .filter((g) => g.guards.some((x) => importers.includes(x)))
    .filter((g) => !g.guards.includes(target))
  check(expectGates.length > 0, '场景三：有不直接守 ' + target + '、但守着「import 了它的文件」的门禁，共 ' + expectGates.length + ' 扇')
  const out = sel([target])
  checkSelectionShape(out, '场景三')
  check(!out.fullChain, '场景三：改 ' + target + ' 不会退化成全链')
  const missed = expectGates.filter((g) => !out.steps.includes(g.step))
  check(
    missed.length === 0,
    '场景三：反向依赖 ' + target + ' 的那些门禁全被选中（该选 ' + expectGates.length + ' 扇，漏 ' + missed.length + ' 扇：' + missed.slice(0, 3).map((g) => g.file).join('、') + '）',
  )
  check(out.steps.length < chainSteps.length, '场景三：选中的 ' + out.steps.length + ' 步比全链 ' + chainSteps.length + ' 步少')
}

// 场景四：改 package.json 这类横切文件，必须跑全链
{
  const out = sel(['package.json'])
  check(out.fullChain === true, '场景四：改 package.json 会跑全链')
  check(out.steps.length === chainSteps.length, '场景四：全链就是链上的 ' + chainSteps.length + ' 步')
  check(!!out.fullChainReason && out.fullChainReason.includes('package.json'), '场景四：写明是 package.json 触发的全链：「' + out.fullChainReason + '」')
}

// 场景五：改一个谁也没管的路径，必须跑全链
{
  const ghost = 'src/__no_such_gate_dir__/ghost.js'
  check(!fs.existsSync(path.join(ROOT, ghost)), '场景五：' + ghost + ' 确实不存在')
  const out = sel([ghost])
  check(out.fullChain === true, '场景五：改一个没有任何门禁守着的路径会跑全链')
  check(!!out.fullChainReason && out.fullChainReason.includes(ghost), '场景五：写明是哪个文件触发的全链')
}

// 场景六（反向测试）：从变更清单里拿掉某扇门禁守着的文件，它就不该再被选中
{
  // 挑一扇门禁和一扇跟它不在同一棵子树里的文件：先两个一起改（那扇门禁应当被选中），
  // 再把门禁守的文件删掉（那扇门禁就不该再出现）。
  // 挑法：找一扇守的全是 src/host/ 下具体文件的门禁，这样它注册的层级都在 src/host 里，
  // 跟 src/client/views 那一棵子树没有交集，反向测试才干净。
  const targetGate = map.gates.find(
    (g) =>
      g.guards.length > 0 &&
      g.guards.every((x) => isUnder(x, 'src/host') && !isDirectory(x)),
  )
  const itsFile = targetGate && targetGate.guards[0]
  const other = firstJsFileIn('src/client/views')
  check(
    !!targetGate && !!itsFile,
    '场景六：找到一扇守着 src/host/ 下具体文件的门禁用来做反向测试（' +
      (targetGate && targetGate.file) +
      ' 守着 ' +
      itsFile +
      '）',
  )
  if (targetGate && itsFile && other) {
    const both = sel([itsFile, other])
    const onlyOther = sel([other])
    check(both.steps.includes(targetGate.step), '场景六：' + itsFile + ' 在变更清单里时，' + targetGate.file + ' 被选中')
    check(
      !onlyOther.steps.includes(targetGate.step),
      '场景六：把 ' + itsFile + ' 从变更清单里拿掉后，' + targetGate.file + ' 不再被选中（证明挑选确实在筛，不是全选）',
    )
    check(onlyOther.steps.length < chainSteps.length, '场景六：只改 ' + other + ' 时选中的 ' + onlyOther.steps.length + ' 步少于全链 ' + chainSteps.length + ' 步')
  }
}

// 场景七：横切文件的判定本身，逐条钉住规则里写明的那些类
{
  const cases = [
    ['package.json', true],
    ['tsconfig.client.json', true],
    ['scripts/build.mjs', true],
    ['tests/verify-progress.js', true],
    ['docs/agents/verification.md', true],
    ['research/489-appendix.md', true],
    ['README.md', true],
    ['host.js', true],
    ['package/lib/client.js', true],
    ['src/client/views/versionControl/VersionControlTab.js', false],
    ['src/host/mapBody.js', false],
  ]
  for (const [p, want] of cases) {
    const got = isCrossCutting(p).crossCutting
    check(got === want, '场景七：' + p + ' 判定为横切文件 = ' + want + '（实际 ' + got + '）')
  }
  // 契约层：src 下任何一层目录里的 contract/ 都算横切
  const contractSample = findFirstUnder('src', (rel) => /(^|\/)contract\//.test(rel))
  check(!!contractSample, '场景七：src/ 下找得到一个契约层文件用来验证（' + contractSample + '）')
  if (contractSample) {
    check(isCrossCutting(contractSample).crossCutting, '场景七：契约层文件 ' + contractSample + ' 判定为横切文件')
    check(sel([contractSample]).fullChain === true, '场景七：改契约层文件 ' + contractSample + ' 会跑全链')
  }
}

// ---------------------------------------------------------------------------
// 收尾
// ---------------------------------------------------------------------------
if (failed) {
  console.log('\n存在失败')
  process.exit(1)
}
console.log('\n全部通过（' + passCount + ' 条断言）')

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

/** 仓库里的某个相对路径是不是目录（不存在就返回 false）。 */
function isDirectory(rel) {
  try {
    return fs.statSync(path.join(ROOT, rel)).isDirectory()
  } catch {
    return false
  }
}

/** 列一个目录下直接放着的 .js 文件（不递归），按名字排序，返回仓库相对路径。 */
function firstJsFileIn(relDir) {
  const abs = path.join(ROOT, relDir)
  if (!fs.existsSync(abs)) return ''
  const found = fs
    .readdirSync(abs, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.js'))
    .map((e) => relDir + '/' + e.name)
    .sort()
  return found[0] || ''
}

/** 在 relDir 下找一个满足条件的东西（文件或目录），返回仓库相对路径；找不到返回空串。 */
function findFirstUnder(relDir, pred) {
  const abs = path.join(ROOT, relDir)
  if (!fs.existsSync(abs)) return ''
  const stack = [relDir]
  while (stack.length) {
    const dir = stack.shift()
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = dir + '/' + entry.name
      if (entry.isDirectory()) stack.push(rel)
      else if (pred(rel)) return rel
    }
  }
  return ''
}

/**
 * 自己扫一遍 src/，找出哪些文件里写了 import 目标文件的语句。
 * 只认静态 import / export ... from、require(...)、动态 import(...) 三种写法里的字符串字面量；
 * 拼出来的路径认不出来，那正是这套规则已知的漏洞之一。
 * 这里故意不复用 scripts/gate-map.mjs 的建图代码：拿一份独立实现去对，才能验出「建图坏了」。
 */
function whoImports(targetRel) {
  const targetNoExt = targetRel.replace(/\.(js|ts|mjs|cjs)$/, '')
  const out = []
  const stack = ['src']
  while (stack.length) {
    const dir = stack.shift()
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = dir + '/' + entry.name
      if (entry.isDirectory()) {
        stack.push(rel)
        continue
      }
      if (!/\.(js|ts|mjs|cjs)$/.test(entry.name)) continue
      const code = fs.readFileSync(path.join(ROOT, rel), 'utf8')
      const re = /(?:from\s*|require\s*\(\s*|import\s*\(\s*)['"]([^'"]+)['"]/g
      let m
      while ((m = re.exec(code))) {
        const spec = m[1]
        if (!spec.startsWith('.')) continue
        const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(rel), spec))
        if (resolved === targetRel || resolved.replace(/\.(js|ts|mjs|cjs)$/, '') === targetNoExt) {
          out.push(rel)
          break
        }
      }
    }
  }
  return out
}
