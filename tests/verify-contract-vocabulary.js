// verify-contract-vocabulary.js —— 门禁：契约层里不许再有「没有生产者的常量」（#719 T15 收口）
// 用法：在插件根目录执行 node tests/verify-contract-vocabulary.js，可独立运行。
//
// 为什么要有这一条（票面第 3 条的原话）：契约层是「两个半场共用的词汇表」，它多一个常量，
// 后来人就会以为那条路还在。真实事故正是这样发生的：#213/#232 的四个事件源常量
//（gh-create / gh-edit / claim / index-dirty）对应的 issuePath 面包屑事件队列已随 #345 整块移除，
// 那四个值从此没有任何生产者，可它们还留在 src/shared/tracker/sync.js 里，只有那条判定函数在自读；
// 谁照着它们改代码，就会在一条早已不存在的路上花时间。
//
// 判据（两条，满足任意一条即算「活着」，两条都不满足才判红）：
//   ① **值有人产出**：这个字符串值能在生产代码里找到（说明真有东西会产出这个名字）；
//   ② **常量有人读**：这个常量的名字（顶层常量名，或它所在那个对象的名字）在生产代码里被引用过。
//
// 为什么要两条一起看：只按①判会把一堆「契约层自己用的内部映射值」误判致死（实测 90 条，
// 例如 check-catalog-dirs.js 的 MIGRATION_MAP 里那些 'GENERIC_CATALOG[0]'、constants.js 的
// CLOSED_REASON 里那些 'not_planned' —— 它们是喂给后端当参数的枚举值，不是谁产出的名字）；
// 只按②判则抓不到 #719 要清的那四个事件源常量——它们**确实**被自己人读过（needProbeSource 读的），
// 读者在契约层内部，生产代码一次都没碰过。两条都不满足，才是「谁都碰不到」那种死词汇。
//
// 存量清单（KNOWN_UNPRODUCED）：今天两条都不满足、但确实该留着的字符串型常量，逐个写明理由。
// 这份清单只许减不许增——新加进来的常量必须当场有值产出或有人读，否则本门禁判红。
// 反证（每次运行都跑）：拿一份合成出来的「契约层常量」喂同一个判据，两种死法各验一次，必须判红。
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

/** 生产代码那两棵树：契约层里那个常量必须在这两棵里有人读、或它的值有人产出。 */
const PRODUCER_DIRS = ['src/host', 'src/client']
/**
 * 扫哪棵树：`src/shared/tracker/` —— 仓库语境里「契约层」就是它（CONTEXT.md 后端感知架构词条：
 * 契约层 = 后端↔宿主/UI 的接口合同；三个后端房间共用它的词汇）。只扫 .js，测试文件不算契约层。
 *
 * 为什么不连 `src/shared/refresh/`（转译产物的那一层）与 `src/shared/deck-tools/` 一起扫：
 * 实测把范围放大到整棵 `src/shared`（43 个 .js、117 个字符串型常量）时，本判据会多报 14 条，
 * 它们分两类，都不是这里要清的那种死词汇：
 *   ① **来源标注**（8 条）：`refresh-core/src/*.ts` 转译时写在产物头几行的 `*_SOURCE`，值是
 *      `refresh-core/src/*.ts`，给人追溯「这份 JS 从哪来」用。今天其中只有两条被门禁读过
 *      （POLICY_SOURCE 被 tests/verify-policy.js、PORTS_SOURCE 被 tests/verify-refresh-freshness.js），
 *      其余六条（ATTENTION / BACKOFF / CHAIN / CREATE_WRITE / DELTA / WRITE_DETECT）全仓没读者。
 *   ② **模块自己产出的值**（6 条）：`IDEMPOTENCY_MARKER_PREFIX`（值是 withAnchor 写进票面正文的锚
 *      前缀）与 `deck-tools/shell.js` 的四个 `REFUSAL_REASONS.*` / `deck-tools/edges.js` 的
 *      `EDGE_LANDING.FILE_NOTE` —— 产出它们的就是这个契约层模块自己，生产代码只需调函数、不必碰字面量。
 * 这两类塞进本文件的存量清单，等于让这份清单替另外两层背书。它们该不该留、该不该各自补断言，
 * 是那两层自己的票的事；这件事记在 #719 的回报里交给统筹者，不在本门禁里假装它已经清楚。
 */
const CONTRACT_DIRS = ['src/shared/tracker']

/**
 * 存量清单：今天还没有生产者的字符串型常量。
 * 每条都必须写清「为什么先留着、等谁处理」，不许只写一个名字。
 */
const KNOWN_UNPRODUCED = {
  'src/shared/tracker/constants.js.CLOSED_REASON.NOT_PLANNED':
    '存量：GitHub 的关闭原因保留值之一（ticket 的关闭原因字段按方案是「开放 string，未知值原样展示、不分支」）。这个值今天在生产代码里既没有产出者也没有读者——它是给字段做注释用的保留值，不是被谁产出的名字。要不要删掉 CLOSED_REASON 这整张表由统筹者定（删或补上调用点都行），本票只把它如实列进这份存量清单，不代它做决定。',
  'src/shared/tracker/constants.js.CLOSED_REASON.REOPENED':
    '存量：同上（CLOSED_REASON.REOPENED）。',
}

function walk(dir, out) {
  if (!fs.existsSync(dir)) return out
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) walk(p, out)
    else if (ent.isFile() && ent.name.endsWith('.js')) out.push(p)
  }
  return out
}

/** 去掉注释与字符串里的干扰：这里只用来找「这个值有没有出现在生产代码里」，保守即多留不算漏。 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
}

/** 把生产代码两棵树读成一段文本（注释已经剥掉）。 */
function producerText() {
  const parts = []
  for (const d of PRODUCER_DIRS) for (const f of walk(path.join(ROOT, d), [])) parts.push(stripComments(fs.readFileSync(f, 'utf8')))
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
 * 判据本体：一份常量清单 + 一段生产代码，返回既没人产出、也没人读的那些。
 * 名字按「整词」匹配（前后不是标识符字符），免得 USER 这种短名字撞上别处的词。
 */
function unproduced(constants, text) {
  const tokenSeen = (t) => new RegExp('(^|[^A-Za-z0-9_$])' + t.replace(/[$]/g, '\\$&') + '([^A-Za-z0-9_$]|$)').test(text)
  return constants.filter((c) => {
    if (text.indexOf(c.value) >= 0) return false
    return !(c.tokens || []).some(tokenSeen)
  })
}

async function main() {
  console.log('契约层词汇门禁（#719 T15：字符串型常量必须有生产者，没有生产者的常量判红）')
  const text = producerText()
  check(text.length > 0, '生产代码扫到了内容（src/host 与 src/client 两棵树，' + text.length + ' 个字符）')

  const files = []
  for (const d of CONTRACT_DIRS) walk(path.join(ROOT, d), files)
  check(files.length > 0, '契约层扫到了 ' + files.length + ' 个 .js 文件')

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
  check(constants.length > 0, '契约层里收到 ' + constants.length + ' 个字符串型常量')

  const bad = unproduced(constants, text)
  const known = bad.filter((c) => Object.prototype.hasOwnProperty.call(KNOWN_UNPRODUCED, c.name))
  const fresh = bad.filter((c) => !Object.prototype.hasOwnProperty.call(KNOWN_UNPRODUCED, c.name))
  for (const c of bad) {
    console.log('    没有生产者：' + c.name + ' = ' + JSON.stringify(c.value) +
      (KNOWN_UNPRODUCED[c.name] ? '（存量，理由：' + KNOWN_UNPRODUCED[c.name] + '）' : ''))
  }
  check(fresh.length === 0, '契约层没有「新增的、没有生产者的字符串型常量」（存量 ' + known.length + ' 条，新增 ' + fresh.length + ' 条）')

  // 存量清单只许减不许增：清单里已经补上生产者的条目要当场删掉，否则这份清单会自己长毛。
  const stale = Object.keys(KNOWN_UNPRODUCED).filter((k) => !bad.some((c) => c.name === k))
  check(stale.length === 0, '存量清单里没有「其实已经有生产者」的过期条目（过期 ' + stale.length + ' 条）' + (stale.length ? '：' + stale.join('、') : ''))

  // #719 那两个事件的名字与判定函数不许回来（这一票就是为它们做的，单独立一条更直白）。
  const syncText = stripComments(fs.readFileSync(path.join(ROOT, 'src', 'shared', 'tracker', 'sync.js'), 'utf8'))
  check(!/SOURCE_GH_CREATE|SOURCE_GH_EDIT|SOURCE_CLAIM|SOURCE_INDEX_DIRTY|needProbeSource/.test(syncText),
    '四个事件源常量与 needProbeSource 已从 src/shared/tracker/sync.js 删掉')

  // 反证：合成一份契约层常量，两种死法各验一次，同一个判据必须判红。
  const fake = [
    { name: 'fake/example.js.SOURCE_GONE', value: 'never-produced-value-719', tokens: ['SOURCE_GONE'] },
    { name: 'fake/example.js.HAS_PRODUCER', value: 'gh', tokens: ['HAS_PRODUCER'] },
    { name: 'fake/example.js.IS_READ', value: 'never-produced-value-719-b', tokens: ['canonicalKey'] },
  ]
  const fakeBad = unproduced(fake, text)
  check(fakeBad.length === 1 && fakeBad[0].name === 'fake/example.js.SOURCE_GONE',
    '反证：既没人产出、也没人读的常量必须被判红，而有人产出的与有人读的两条都不许误判（抓到 ' + fakeBad.length + ' 条：' + fakeBad.map((c) => c.name).join('、') + '）')

  console.log(failed ? '\n存在失败 — verify-contract-vocabulary 未通过' : '\n全部通过 — 契约层词汇门禁生效（' + total + ' 项断言）')
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error('门禁执行异常：' + ((e && e.stack) || e))
  process.exit(1)
})
