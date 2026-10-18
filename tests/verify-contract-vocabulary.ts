// verify-contract-vocabulary.ts —— 门禁：契约层里不许有「死了的常量」（#719 T15 收口 · 2026-09-24 按统筹者裁定放大到整棵 src/shared）
// 用法：在插件根目录执行 node --import ./scripts/ts-hook.mts tests/verify-contract-vocabulary.ts，可独立运行。
//
// 为什么要有这一条（票面第 3 条的原话）：契约层与共享层是「两个半场共用的词汇表」，它多一个常量，
// 后来人就会以为那条路还在。真实事故正是这样发生的：#213/#232 的四个事件源常量
//（gh-create / gh-edit / claim / index-dirty）对应的 issuePath 面包屑事件队列已随 #345 整块移除，
// 那四个值从此没有任何生产者，可它们还留在 src/shared/tracker/sync.js 里，只有那条判定函数在自读；
// 谁照着它们改代码，就会在一条早已不存在的路上花时间。
//
// 判据（两条，满足任意一条即算「活着」，两条都不满足才判红）：
//   ① **值有人产出**：这个字符串值能在**生产代码**（src/host、src/client）里找到。
//      为什么这一条只认生产代码：值的意义是「真有东西会产出这个名字」。测试里出现同一个字符串
//      往往正是一条**否证断言**（例如测试断言「源码里不该再有 'gh-create'」），把它算成产出，
//      等于让否证本身把死词汇救活。
//   ② **名字有人读**：这个常量的名字在**生产代码或测试**（src/host、src/client、tests）里被引用过。
//      为什么这一条把测试也算上：仓库既有先例就不是生产代码在读——PORTS_SOURCE 的读者是
//      tests/verify-refresh-adr.js、POLICY_SOURCE 的读者是 tests/verify-policy.js。
//      一个常量只被门禁读，和「谁都不读」是两件事，所以测试读它算活着。
//
// 为什么要两条一起看：只按①判会把一堆「共享层自己用的枚举/映射值」误判致死（举例：按①单判实测
// 会多报 90 条，例如 check-catalog-dirs.js 的 MIGRATION_MAP 里那些 'GENERIC_CATALOG[0]'）；
// 只按②判则抓不到 #719 要清的那四个事件源常量——它们**确实**被自己人读过（needProbeSource 读的），
// 读者在共享层内部，生产代码一次都没碰过。两条都不满足，才是「谁都碰不到」那种死词汇。
//
// 扫哪棵树：整棵 `src/shared`（2026-09-24 统筹者裁定；此前只扫 src/shared/tracker/）。
// 门禁自己这个文件不参与扫描：它必然要写出那些待查的名字（例如下面那条 #719 的硬断言），
// 把它算成读者就是自证。
//
// 存量清单（KNOWN_UNPRODUCED）：今天两条都不满足、按裁定「间接被读」放行的条目。
// 每条**一行**，写清三件事：名字 / 为什么留着 / 谁在读。这份清单只许减不许增——
// 新加进来的常量必须当场有值产出或有人读，否则本门禁判红；条目后来补上读者了也要当场删掉
// （下面有「过期条目」那条断言盯着）。
//
// 反证（每次运行都跑）：拿一份合成出来的常量清单喂同一个判据，两种死法各验一次，必须判红；
// 另外正向验一次「只被测试读的名字」与「值在生产代码里的名字」不许误判。
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok: unknown, msg: string): void => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

/** 值扫这三棵树里的前两棵：生产代码。 */
const VALUE_DIRS = ['src/host', 'src/client']
/** 名字扫这三棵：生产代码 + 测试与门禁。 */
const NAME_DIRS = ['src/host', 'src/client', 'tests']
/** 契约层就是整棵 src/shared（共享词汇表）。 */
const CONTRACT_DIRS = ['src/shared']
/** 本门禁自己的文件：扫描时要跳过（它必然写出待查的名字，算成读者就是自证）。 */
const SELF = path.relative(ROOT, __filename).replace(/\\/g, '/')

/**
 * 存量清单（按统筹者裁定 A：每条一行，写清 名字 / 为什么留着 / 谁在读）。
 * 只收「间接被读」那一种：值由共享层模块产出、随返回值流到调用方，因此这里的读取面**是返回信封**
 *（调用方拿到的那个 reason / items 字段），它只是不叫「变量名」，也不一定有测试断言。
 * 真没人读的一律删掉，不进这份清单（#719 删掉的六个 *_SOURCE 与 CLOSED_REASON 里那两个值就是这一类）。
 */
const KNOWN_UNPRODUCED = {
  // （#1095 删掉 FILE_NOTE / OVER_CAP / GATE_DEFER 三条：搬家后门禁按新地址复查，发现它们的值都在生产代码里
  //  （src/deck/shell/edge-landing.ts 与 call-shell.ts），按本文件「过期条目要当场删」的规矩与 #845 的先例销账。）
}

/**
 * 收集 .js 与 .ts 两种源码文件。**跳过以点开头的目录与文件**，为什么：`.git`、`.tmp`、`.scratch` 这些是仓库元数据与
 * 临时产物，不是真代码；这一条实测踩过——`tests/.tmp-repo-out/` 与 `tests/.tmp-repo-out2/` 是某次契约
 * 测试留下的临时仓库副本（里面有整份源码的拷贝），它们把 constants.js 里的死常量「救活」了
 *（副本里当然也有那份声明），于是存量清单被误判成过期。规则只有这一句，不涉及其它目录。
 *
 * 2026-10-17 补记：这里过去只收 `.js`，于是 tests 目录里那些已经改名为 `.ts` 的读者（例如
 * tests/tracker-contract/sections/idempotency.ts）就不再被算进读者那一段文本，把一个还有人读的
 * 常量误判成「死了」——主链因此红了一条假红。现在两种后缀都收；只有下面查「产物里那六行来源标注
 * 有没有被删掉」的那一次除外，那一次查的是构建产物，必须仍然只看 `.js`。
 */
function walk(dir, out) {
  if (!fs.existsSync(dir)) return out
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith('.')) continue
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) walk(p, out)
    else if (ent.isFile() && (ent.name.endsWith('.js') || ent.name.endsWith('.ts'))) out.push(p)
  }
  return out
}

/** 剥掉注释：只用来找「这个值/名字有没有出现在真代码里」，保守即多留不算漏。 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
}

/**
 * 动态读取面（#845）：`<文件名大写>_SOURCE` 这类模块标识不是被「按名字」引用的，而是被门禁**按文件名
 *   推导**出来读的 —— 门禁拿到产物文件名，把名字大写、接上 `_SOURCE` 再去问那个值。文本扫描看不见
 *   推导出来的名字，判据② 会把这一族
 *   误判成死的（实测一次报 12 条）。这里补一条窄判据：名字以 _SOURCE 结尾、值指向某个 .ts 源码、
 *   且**有门禁在做这种推导**（某道门禁的正文里同时出现 '_SOURCE' 与 toUpperCase）时，算活着。
 *   只放行这一族；别的常量想活，仍然必须有人按名字读或有人产出值。
 *
 *   2026-10-13（#1023）：原先做这推导的有四条 `<域>-freshness` 门禁，它们随四个核的旧构建脚本
 *   一起退场了；推导这件事收进 tests/verify-build-artifacts.js（覆盖面从「各域的接口空壳」扩到
 *   「每个域的每份产物」）。这份门禁只认「确实有推导在场」，推导交给谁做不在这里写死，
 *   所以换门禁、加门禁都不用回来改这一条。
 */
function dynamicSourceReaderText() {
  const parts = []
  for (const f of walk(path.join(ROOT, 'tests'), [])) {
    const rel = path.relative(ROOT, f).replace(/\\/g, '/')
    if (rel === SELF) continue
    const t = stripComments(fs.readFileSync(f, 'utf8'))
    if (t.indexOf("'_SOURCE'") >= 0 && t.indexOf('toUpperCase') >= 0) parts.push(t)
  }
  return parts.join('\n')
}

/** 把几棵树读成一段文本（剥注释、跳过本门禁自己）。 */
function textOf(dirs) {
  const parts = []
  for (const d of dirs) {
    for (const f of walk(path.join(ROOT, d), [])) {
      const rel = path.relative(ROOT, f).replace(/\\/g, '/')
      if (rel === SELF) continue
      parts.push(stripComments(fs.readFileSync(f, 'utf8')))
    }
  }
  return parts.join('\n')
}

/** 从一份「模块导出对象」里收出字符串型常量：顶层字符串 + 冻结对象里一层字符串。 */
function stringConstantsOf(modExport, modName) {
  const found = []
  const push = (name, value, tokens) => {
    if (typeof value !== 'string' || value === '') return
    found.push({ name: modName + '.' + name, value: value, tokens: tokens })
  }
  for (const key of Object.keys(modExport || {})) {
    const v = modExport[key]
    if (typeof v === 'string') push(key, v, [key])
    else if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const k2 of Object.keys(v)) {
        // 这一项是不是「常量」：键必须是标识符，且值必须是字符串（排除那些键名本身就是数据的映射表）。
        if (!/^[A-Za-z_$][\w$]*$/.test(k2)) continue
        // 「有人读」的证据只认**这个键自己的名字**，不认它所在那个对象的名字。
        // 这里踩过一次坑：一开始把 `OBJ` 也算成证据，结果「SYNC 在生产代码里被引用过」就把 SYNC 里
        // 任何一个键都判成活的——反证时把 SOURCE_GH_CREATE 加回去，门禁照样判绿，等于白写。
        push(key + '.' + k2, v[k2], [k2])
      }
    }
  }
  return found
}

/**
 * 判据本体：一份常量清单 + 两段文本（值那一份只看生产代码，名字那一份含测试），
 * 返回既没人产出、也没人读的那些。名字按「整词」匹配（前后不是标识符字符），
 * 免得 USER 这种短名字撞上别处的词。
 *
 * `dynamicText` 是「按文件名推导读模块标识」那族门禁的正文（见上面 dynamicSourceReaderText）。
 * 这一族要看两件事：
 *   - 有推导在场（dynamicText 非空，见 main 里那条断言）；
 *   - 这个常量属于被推导的那一族：名字是 `<文件名大写>_SOURCE`，值是 `src/shared/<域>/src/x.ts`
 *     这样的仓库相对源码路径。两条一起才是「产物里的模块标识」这件事本身。
 * 推导出来的**成品名字**（PORTS_SOURCE 这类）是跑的时候拼出来的，静态文本里没有，所以这里没法
 * 按名字对；至于推导出来的每个名字是不是真有对应产物、值是不是指向真源码，由做推导的那道门禁
 * 自己逐份断言（tests/verify-build-artifacts.js 的模块标识出处判据）。这里只负责不当死词汇判红。
 */
function dead(constants, valueText, nameText, dynamicText = '') {
  const tokenSeen = (t) => new RegExp('(^|[^A-Za-z0-9_$])' + t.replace(/[$]/g, '\\$&') + '([^A-Za-z0-9_$]|$)').test(nameText)
  return constants.filter((c) => {
    if (valueText.indexOf(c.value) >= 0) return false
    if ((c.tokens || []).some(tokenSeen)) return false
    // 动态读取面（#845）：模块标识那一族被门禁按文件名推导读，见上面那段说明。
    const key = String(c.name).split('.').pop()
    if (dynamicText !== '' && /^[A-Z0-9_]+_SOURCE$/.test(key) && /^src\/shared\/[^/]+\/src\/[^/]+\.ts$/.test(c.value)) return false
    return true
  })
}

async function main() {
  console.log('共享层词汇门禁（#719 T15：整棵 src/shared 的字符串型常量都要有出处，死了的判红）')
  const valueText = textOf(VALUE_DIRS)
  const nameText = textOf(NAME_DIRS)
  check(valueText.length > 0, '生产代码扫到了内容（src/host 与 src/client 两棵树，' + valueText.length + ' 个字符）')
  check(nameText.length > valueText.length, '名字那一份比值那一份大（多扫了 tests 那棵树，' + nameText.length + ' 个字符）')
  // 自证防护：本门禁自己的文件必须真的没被扫进去（它里面写着待查的名字，算成读者就是自证）。
  check(nameText.indexOf('死了的字符串型常量') < 0, '本门禁自己的文件没有被算进读者那一段文本（排除生效）')

  const files = []
  for (const d of CONTRACT_DIRS) walk(path.join(ROOT, d), files)
  check(files.length > 0, '共享层扫到了 ' + files.length + ' 个 .js/.ts 文件')

  const constants = []
  for (const f of files) {
    const rel = path.relative(ROOT, f).replace(/\\/g, '/')
    let mod
    try {
      mod = await import(pathToFileURL(f).href)
    } catch (e) {
      check(false, rel + ' 导入失败：' + String((e && e.message) || e))
      continue
    }
    for (const c of stringConstantsOf(mod, rel)) constants.push(c)
  }
  check(constants.length > 0, '共享层里收到 ' + constants.length + ' 个字符串型常量')

  const dynamicText = dynamicSourceReaderText()
  check(dynamicText.length > 0, '找到做「按文件名推导读模块标识」的门禁（动态读取面生效，' + dynamicText.length + ' 个字符）')
  const bad = dead(constants, valueText, nameText, dynamicText)
  const known = bad.filter((c) => Object.prototype.hasOwnProperty.call(KNOWN_UNPRODUCED, c.name))
  const fresh = bad.filter((c) => !Object.prototype.hasOwnProperty.call(KNOWN_UNPRODUCED, c.name))
  for (const c of bad) {
    console.log('    死了：' + c.name + ' = ' + JSON.stringify(c.value) +
      (KNOWN_UNPRODUCED[c.name] ? '（存量：' + KNOWN_UNPRODUCED[c.name] + '）' : ''))
  }
  check(fresh.length === 0, '共享层没有「新增的、死了的字符串型常量」（存量 ' + known.length + ' 条，新增 ' + fresh.length + ' 条）')

  // 存量清单只许减不许增：清单里已经补上读者的条目要当场删掉，否则这份清单会自己长毛。
  const stale = Object.keys(KNOWN_UNPRODUCED).filter((k) => !bad.some((c) => c.name === k))
  check(stale.length === 0, '存量清单里没有「其实已经活过来」的过期条目（过期 ' + stale.length + ' 条）' + (stale.length ? '：' + stale.join('、') : ''))

  // #719 那两个事件的名字与判定函数不许回来（这一票就是为它们做的，单独立一条更直白）。
  const syncText = stripComments(fs.readFileSync(path.join(ROOT, 'src', 'shared', 'tracker', 'sync.js'), 'utf8'))
  check(!/SOURCE_GH_CREATE|SOURCE_GH_EDIT|SOURCE_CLAIM|SOURCE_INDEX_DIRTY|needProbeSource/.test(syncText),
    '四个事件源常量与 needProbeSource 已从 src/shared/tracker/sync.js 删掉')

  // #719 删掉的六个来源标注不许回来（它们的产物第一行已经有机器生成的 AUTO-GENERATED 包头）。
  // 这一次查的是构建产物，所以仍然只看 .js：源码 .ts 里那六行以注释形式留着（「这里原来有一行
  // export const …」），把 .ts 也算进来会拿注释去判「标注回来了」，当场假红。
  const goneSources = ['ATTENTION_SOURCE', 'BACKOFF_SOURCE', 'CHAIN_SOURCE', 'CREATE_WRITE_SOURCE', 'DELTA_SOURCE', 'IDEMPOTENCY_SOURCE']
  const refreshJs = walk(path.join(ROOT, 'src', 'shared', 'refresh'), []).filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(f, 'utf8')).join('\n')
  const back = goneSources.filter((n) => new RegExp('export const ' + n + '\\b').test(refreshJs))
  check(back.length === 0, '六个没有读者的来源标注已从产物里删掉（' + goneSources.length + ' 个里找回了 ' + back.length + ' 个' + (back.length ? '：' + back.join('、') : '') + '）')

  // 反证：合成一份常量清单，两种死法各验一次，同一个判据必须判红；两种活法不许误判。
  const fake = [
    { name: 'fake/a.js.NOBODY', value: 'never-produced-value-719', tokens: ['NOBODY'] },
    { name: 'fake/b.js.HAS_PRODUCER', value: 'gh', tokens: ['HAS_PRODUCER'] },
    { name: 'fake/c.js.READ_BY_TEST', value: 'never-produced-value-719-b', tokens: ['VIOLATING_EXPECTED_FAILURES'] },
  ]
  const fakeBad = dead(fake, valueText, nameText)
  check(fakeBad.length === 1 && fakeBad[0].name === 'fake/a.js.NOBODY',
    '反证：既没人产出、也没人读的常量必须被判红，而「值在生产代码里」（gh）与「名字只被测试读」两条都不许误判（抓到 ' + fakeBad.length + ' 条：' + fakeBad.map((c) => c.name).join('、') + '）')

  console.log(failed ? '\n存在失败 — verify-contract-vocabulary 未通过' : '\n全部通过 — 共享层词汇门禁生效（' + total + ' 项断言）')
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error('门禁执行异常：' + ((e && e.stack) || e))
  process.exit(1)
})
