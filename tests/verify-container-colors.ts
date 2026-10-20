// tests/verify-container-colors.ts —— #1296 门禁：两套容器的身份色只在中央色表一处
// https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1296
// 门禁归属: src/client/kernel/container-view.ts
// 门禁归属: src/client/views/versionControl/vcStyles.ts
// 判据（#1290 实施决策 G、#1280 第 4 节颜色四条）：
// 1. 探索地图的身份色与规格（实施地图）的身份色，真值只剩中央色表 src/client/kernel/container-view.ts
//    的 CONTAINER_ACCENT 一处；src 下任何其他文件再写一次这个色值就判红——写进注释也算，
//    因为注释里的色值第二天就会被复制成代码。大小写变体同样算：`#C084FC`、`#1d4ed8` 与 `#1D4ED8`
//    在渲染器眼里是同一个颜色，门禁按不区分大小写统计。
// 2. 版本控制页签那套蓝是另一回事：它单独成表（vcStyles.ts 的 --vc-info），不跟着规格卡蓝走。
//    白名单按「路径 + 段」锁死：只认 vcStyles.ts 里 --vc-info: 这一段后面的那两处，别处的蓝仍判红。
// 3. 颜色由中央色表流出去的每一处（列表行、详情页头/顶栏/动作条、内核样式、浮层、状态栏等）
//    都必须真的引用 CONTAINER_ACCENT：这条检查是「还在从中央色表取」的粗筛——只要文件里还有
//    写死的色值，字面量扫描那一节会红；粗筛只保证消费端没有整段绕开中央色表（把引用删掉）。
//    真正守住「改一处、全跟着变」的是字面量扫描加上渲染侧门禁（verify-1286-list /
//    verify-1286-detail / verify-1295-dual-panel / verify-1237-mapdetail-copy）。
// 跑法：node --import ./scripts/ts-hook.mts tests/verify-container-colors.ts
// 做法：递归读 src/**/*.{ts,mts,tsx} 原文，按颜色值统计落点（不区分大小写）；中央色表与版本控制蓝
//   按白名单放行，其余一律零容忍。不跑渲染，渲染侧的取色行为由上面那几扇门禁守。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(ROOT, 'src')
const CENTER = 'src/client/kernel/container-view.ts'
const VC_STYLES = 'src/client/views/versionControl/vcStyles.ts'
// 两个字面量在这里各写一遍是必要的：门禁要拿着它们去搜源码，不能从被搜的那份色表里取，
// 否则色表被改坏时门禁会跟着一起坏（那样就变成「改什么都是绿的」）。
const EXPLORE = '#c084fc'
const SPEC = '#1D4ED8'
const VC_BLUE = '#1d4ed8'
// 版本控制蓝的白名单只锁 vcStyles.ts 里 --vc-info: 这一段（两处自定义属性的值）。
const VC_SEGMENT = '--vc-info:'
const VC_SEGMENT_OCCURRENCES = 2
// 这些文件是颜色流向的消费端：必须引用中央色表，不许自己藏一份色值。
const CONSUMERS = [
  'src/client/floating/SkillFloatList.ts',
  'src/client/kernel/modal-fields.ts',
  'src/client/kernel/store-derived.ts',
  'src/client/kernel/styles.ts',
  'src/client/statusbar/StatusBar.ts',
  'src/client/views/shared/Tabs.ts',
  'src/client/views/DetailActionBar.ts',
  'src/client/views/IssueDetail.ts',
  'src/client/views/ListTab.ts',
  'src/client/views/ListTabRow.ts',
  'src/client/views/MapDetail.ts',
  'src/client/views/MapDetailHead.ts',
  'src/client/views/MapDetailTop.ts',
  'src/client/views/PrTab.ts',
]

let failures = 0
let total = 0
const check = (ok: any, msg: string) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failures++ }

// 源码按扩展名收齐：.ts / .mts / .tsx。构建产物不在这里（src 下手写代码都是这三种后缀）。
function collectSourceFiles(dir: string): string[] {
  const out: string[] = []
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.isFile() && /\.(ts|mts|tsx)$/.test(e.name)) out.push(p)
    }
  }
  walk(dir)
  return out
}
const relOf = (abs: string) => path.relative(ROOT, abs).split(path.sep).join('/')
const textOf = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
// 一行里某个颜色值的全部落点：行号 + 所在整行，报红时能直接指到人。
// 默认不区分大小写——`#C084FC` 与 `#c084fc` 在渲染器眼里是同一个颜色，不能靠换大小写绕过去。
function occurrences(rel: string, text: string, literal: string, ignoreCase = true): Array<{ line: number; whole: string }> {
  const out: Array<{ line: number; whole: string }> = []
  const lines = text.split(/\r?\n/)
  const needle = ignoreCase ? literal.toLowerCase() : literal
  let hit = 0
  for (let i = 0; i < lines.length; i++) {
    const hay = ignoreCase ? lines[i].toLowerCase() : lines[i]
    let from = 0
    while (true) {
      const at = hay.indexOf(needle, from)
      if (at < 0) break
      // line/whole 两格都留：line 是 1 起的真实行号，whole 是那一行原文（去掉行首缩进，方便直接读）。
      out.push({ line: i + 1, whole: lines[i].trim() })
      hit += 1
      if (hit > 200) return out
      from = at + needle.length
    }
  }
  return out
}

const files = collectSourceFiles(SRC)
check(files.length > 100, '源码扫描范围非空（收到 ' + files.length + ' 个 .ts/.mts/.tsx 文件）')
const fileSet = new Set(files.map(relOf))
check(fileSet.has(CENTER), '中央色表文件在扫描范围内：' + CENTER)
check(fileSet.has(VC_STYLES), '版本控制样式文件在扫描范围内：' + VC_STYLES)

// ---- 一、中央色表是唯一真源：表里只有探索紫一处、规格蓝一处（大小写不敏感） ----
{
  const text = textOf(CENTER)
  const explore = occurrences(CENTER, text, EXPLORE)
  const spec = occurrences(CENTER, text, SPEC)
  check(explore.length === 1, '中央色表里探索紫色值恰好一处（实得 ' + explore.length + ' 处' + (explore.length ? '：第 ' + explore.map((x) => x.line).join('、') + ' 行' : '') + '）')
  check(spec.length === 1, '中央色表里规格蓝色值恰好一处（实得 ' + spec.length + ' 处' + (spec.length ? '：第 ' + spec.map((x) => x.line).join('、') + ' 行' : '') + '）')
  // 表的结构也要锁住：真值必须挂在 CONTAINER_ACCENT 的 map / spec 两个键上，
  // 否则「一处真源」就只是碰巧只剩一处字面量，换个变量名照样能散开。
  check(/CONTAINER_ACCENT[\s\S]{0,200}?map:\s*'/.test(text), '探索地图身份色挂在 CONTAINER_ACCENT.map 上（中央色表结构不变）')
  check(/CONTAINER_ACCENT[\s\S]{0,200}?spec:\s*'/.test(text), '规格身份色挂在 CONTAINER_ACCENT.spec 上（中央色表结构不变）')
  check(!text.includes(VC_BLUE), '中央色表里没有版本控制那套小写蓝（两套蓝互不相干）')
}

// ---- 二、版本控制蓝：只认 vcStyles.ts 的 --vc-info 那一段（大小写不敏感） ----
{
  const text = textOf(VC_STYLES)
  const vc = occurrences(VC_STYLES, text, VC_BLUE)
  check(vc.length === VC_SEGMENT_OCCURRENCES, '版本控制蓝在 vcStyles.ts 里恰好 ' + VC_SEGMENT_OCCURRENCES + ' 处（实得 ' + vc.length + ' 处）')
  // 「路径 + 段」锁：每一处都必须落在 --vc-info: 这一段的同一行里；换个选择器或换行写法都不算白名单。
  const outside = vc.filter((x) => !x.whole.includes(VC_SEGMENT))
  check(outside.length === 0, '版本控制蓝每一处都落在 ' + VC_SEGMENT + ' 这一段里' + (outside.length ? ' —— 越界于第 ' + outside.map((x) => x.line).join('、') + ' 行' : ''))
  check(occurrences(VC_STYLES, text, EXPLORE).length === 0, '版本控制样式里没有探索紫（两套色互不干扰）')
}

// ---- 三、其他文件：出现一次就红（含注释、含大小写变体） ----
{
  const offenders: string[] = []
  for (const abs of files) {
    const rel = relOf(abs)
    if (rel === CENTER || rel === VC_STYLES) continue
    const text = fs.readFileSync(abs, 'utf8')
    const hits = occurrences(rel, text, EXPLORE).map((x) => rel + ':' + x.line + ' ' + x.whole).concat(occurrences(rel, text, SPEC).map((x) => rel + ':' + x.line + ' ' + x.whole))
    for (const h of hits) offenders.push(h)
  }
  check(offenders.length === 0, '中央色表与版本控制白名单之外没有身份色值（零容忍，不区分大小写）' + (offenders.length ? '\n      命中：\n      ' + offenders.slice(0, 20).join('\n      ') : ''))
}

// ---- 四、颜色流向的消费端必须引用中央色表 ----
{
  for (const rel of CONSUMERS) {
    check(fileSet.has(rel), '消费端文件存在：' + rel)
    if (!fileSet.has(rel)) continue
    const text = textOf(rel)
    check(text.includes('CONTAINER_ACCENT'), '消费端从中央色表取色：' + rel)
    check(occurrences(rel, text, EXPLORE).length === 0 && occurrences(rel, text, SPEC).length === 0, '消费端没有自己藏一份身份色：' + rel)
  }
}

// ---- 五、总数不变量：整个 src 里探索紫只剩一处、规格蓝与小写版本控制蓝合计三处（中央一处 + 版本控制两处） ----
{
  let explore = 0
  let specOrVc = 0
  let vc = 0
  for (const abs of files) {
    const text = fs.readFileSync(abs, 'utf8')
    explore += occurrences(relOf(abs), text, EXPLORE).length
    specOrVc += occurrences(relOf(abs), text, SPEC).length
    // 版本控制蓝按小写原样数：规格蓝是大写 `#1D4ED8`，两者大小写不同正是这一节要分开数的原因。
    vc += occurrences(relOf(abs), text, VC_BLUE, false).length
  }
  check(explore === 1, '整个 src 里探索紫只剩 1 处（实得 ' + explore + ' 处）')
  check(specOrVc === 1 + VC_SEGMENT_OCCURRENCES, '整个 src 里规格蓝与版本控制蓝合计只剩 ' + (1 + VC_SEGMENT_OCCURRENCES) + ' 处（中央色表 1 处 + 版本控制白名单 ' + VC_SEGMENT_OCCURRENCES + ' 处；实得 ' + specOrVc + ' 处）')
  check(vc === VC_SEGMENT_OCCURRENCES, '整个 src 里版本控制蓝只剩 ' + VC_SEGMENT_OCCURRENCES + ' 处（实得 ' + vc + ' 处）')
}

// ---- 六、中央色表模块的真值：运行时读出来与上面断的字面量一致 ----
{
  const mod: any = await import('../src/client/kernel/container-view.js')
  const table: any = mod.CONTAINER_ACCENT
  check(!!table && typeof table === 'object', '中央色表模块导出 CONTAINER_ACCENT 对象')
  check(!!table && table.map === EXPLORE, 'CONTAINER_ACCENT.map 就是探索紫（' + (table && table.map) + '）')
  check(!!table && table.spec === SPEC, 'CONTAINER_ACCENT.spec 就是规格蓝（' + (table && table.spec) + '）')
}

console.log(failures ? '\n存在失败 — verify-container-colors 未通过' : '\n全部通过 — 容器身份色只剩中央色表一处（共 ' + total + ' 项断言）')
process.exit(failures ? 1 : 0)
