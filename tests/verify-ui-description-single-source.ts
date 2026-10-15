// tests/verify-ui-description-single-source.ts —— 门禁：发给界面的后端描述只留一条出处（#1139 立）
//
// 门禁归属: src/tracker/ui-description.ts
// 门禁归属: src/host/sessionSnapshot.ts
// 门禁归属: src/host/sessionRefresh.ts
// 门禁归属: src/host/snapshotBuild.ts
// 门禁归属: src/host/workspaceCwd.ts
// 门禁归属: src/tracker/rooms/gitlab/index.ts
//
// 为什么要有这条（#1139 交付时一起立的）：
//   界面读不到宿主的后端模块对象（上面挂着函数，过不了进程边界），所以宿主必须把每个后端「只给界面
//   看的那部分」挑出来。这段挑选原先在宿主里手抄了 11 遍，每遍把同一张六项清单重写一次，哪一遍漏
//   一项就是某条通道少一个字段——不报错、不记日志，界面只会以为「这个后端没声明」，于是走兜底。
//   GitHub 的 #620、GitLab 的 #1117 两次真事故都是这个形状。收口之后那段挑选只有一处
//   （src/tracker/ui-description.ts），这条门禁负责让「只有一处」这件事可执行：谁再抄一遍、谁再
//   在房间上开一个没人读的声明入口、谁把字段表删一项，都在这里当场红。
//
// 四段判据（每段都对着一个真会发生的退化）：
//   一、宿主四个通道文件只剩对同一处投影的调用，且整棵 src/host 里不许再出现 `openRepository` 这个
//       字段名——手抄的痕迹就是这个字段名本身（宿主没有第二处读它，见 #231 的口径：这个字段只驱动
//       界面，数据路径一个字都不读）。
//   二、GitLab 房的模块命名空间上不许再有 `openRepository`：那正是 #1117 的病根（值以文件级导出的
//       形式存在，房外零读者，谁也没发现模块对象上没有它）。GitHub 那边不在此列：它的值来自
//       repo.js，模块对象与命名空间读的是同一个绑定，没有第二份声明。
//   三、字段表与投影逐项对得上：表里每一项声明了就能出现在结果里，没声明就一个键都不多；表外的
//       字段（checks / create / matches / describe）一个都不许混进去（函数与内务字段过不了进程边界，
//       发过去就是坏数据）。
//   四、键在不在只看值有没有定义，不看值真不真：''、null、0 这些假值必须照样带键。旧写法
//       `m.openRepository ? { openRepository: m.openRepository } : {}` 会把「声明了空值」与「根本没
//       声明」压成同一件事，界面分不出来——那正是 #1139 要修的静默降级。
//
// 用法（手工跑要自己挂装载钩子；npm test / verify:parallel / verify-all 三个入口自动挂）：
//   node --import ./scripts/ts-hook.mjs tests/verify-ui-description-single-source.ts
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { UI_DESCRIPTION_FIELDS, projectUiDescription } from '../src/tracker/ui-description.js'
import type { BackendModule } from '../src/tracker/contract/backend-module.js'

/** 仓库根目录：本文件在 tests/ 下，往上一层就是根。 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

let failed = false
let assertions = 0
const messages: string[] = []
/** 一条判据：失败时把「哪个文件、期望什么、实际什么」一次说清，看的人不用回头读本文件。 */
const check = (ok: boolean, msg: string) => {
  assertions += 1
  if (!ok) {
    failed = true
    messages.push(msg)
  }
}

const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const countMatches = (text: string, re: RegExp) => (text.match(re) || []).length
const hasOwn = (obj: object, key: string) => Object.prototype.hasOwnProperty.call(obj, key)

/** 递归列出目录下的手写源码（.ts/.js），仓库相对、正斜杠。 */
function sourceFiles(dirRel: string): string[] {
  const out: string[] = []
  const walk = (rel: string) => {
    for (const entry of fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
      const child = rel + '/' + entry.name
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue
        walk(child)
      } else if (/\.(ts|js)$/.test(entry.name)) out.push(child)
    }
  }
  walk(dirRel)
  return out.sort()
}

// ---- 一、宿主四个通道文件只剩同一处投影调用，整棵 src/host 里没有第二个字段名 ----
/**
 * 四个通道：会话快照、会话刷新、快照构建、工作区登记回包。calls 是这一处应当有的调用次数——
 * 逐处钉死而不是「至少一处」：某个通道被改回手抄、或整个调用被删掉，两者的差别正在次数上。
 */
const CHANNELS = [
  { file: 'src/host/sessionSnapshot.ts', calls: 5 },
  { file: 'src/host/sessionRefresh.ts', calls: 4 },
  { file: 'src/host/snapshotBuild.ts', calls: 1 },
  { file: 'src/host/workspaceCwd.ts', calls: 1 },
]

const hostFiles = sourceFiles('src/host')
check(hostFiles.length >= CHANNELS.length, `扫描 src/host 只找到 ${hostFiles.length} 个源码文件（少于四个通道文件），判据跑漏了`)
for (const ch of CHANNELS) check(hostFiles.includes(ch.file), `${ch.file} 不在 src/host 的扫描结果里，这条判据没跑到它`)

for (const ch of CHANNELS) {
  const text = read(ch.file)
  const calls = countMatches(text, /\.map\(projectUiDescription\)/g)
  check(
    calls === ch.calls,
    `${ch.file}：应当有 ${ch.calls} 处 .map(projectUiDescription)，实际 ${calls} 处。少了就是某条通道被删或改回手抄，多了就是新开了一条通道——两种都要先回答「这条通道发给界面的字段从哪来」`,
  )
  const copied = countMatches(text, /Object\.assign\(\s*\{\s*id\s*:/g)
  check(copied === 0, `${ch.file}：又出现手抄的投影拼装（Object.assign({ id: … })）${copied} 处，请改回 .map(projectUiDescription)`)
}

let hostRepoHits = 0
for (const rel of hostFiles) {
  const hits = countMatches(read(rel), /openRepository/g)
  hostRepoHits += hits
  check(
    hits === 0,
    rel +
      '：出现 openRepository ' +
      hits +
      ' 处。host 里没有第二处读它的地方（这个字段只驱动界面，数据路径一个字都不读，见 #231）：要么这里又手抄了一份投影（改调 projectUiDescription），要么宿主真要读它——那种情形请先回答数据路径能不能读，再给这条判据开豁免并写清理由',
  )
}

// ---- 二、GitLab 房的命名空间上不许再有那个没人读的文件级导出 ----
// 读模块命名空间而不是扫源码文本：注释里提一句 `export const openRepository` 是说明，不是声明，
// 扫文本会把说明也判红；命名空间上有没有，才是「房外能不能看见」这件事本身。
const gitlabNs = (await import('../src/tracker/rooms/gitlab/index.js')) as Record<string, unknown>
check(
  !hasOwn(gitlabNs, 'openRepository'),
  'src/tracker/rooms/gitlab/index.ts：命名空间上又出现 openRepository。房外零读者的文件级导出正是 #1117 的病根（值在那儿、界面却读不到），要加声明就往模块对象 gitlabBackend 上加',
)

// ---- 三、字段表与投影逐项对得上 ----
const fields = [...UI_DESCRIPTION_FIELDS]
check(fields.length === new Set(fields).size, '界面描述字段表里有重复项：' + JSON.stringify(fields))
check(
  fields.every((f) => typeof f === 'string' && f.length > 0),
  '界面描述字段表里有空项或非字符串项：' + JSON.stringify(fields),
)
check(
  fields.includes('openRepository'),
  '界面描述字段表里没有 openRepository：界面按「后端自己声明的开仓动作」分套那一处就永远读到「没声明」，#620 与 #1117 会以同一种形状复发',
)

/** 造一个最小的假模块对象：只带身份三件套，其余按需补。断言只看「键在不在、值等不等」。 */
const fake = (extra: Record<string, unknown>): BackendModule => ({ id: 'fake-backend', label: '假后端', ...extra }) as unknown as BackendModule
const asRecord = (v: unknown) => v as unknown as Record<string, unknown>

for (const field of fields) {
  const sentinel = '哨兵值:' + field
  const declared = asRecord(projectUiDescription(fake({ [field]: sentinel })))
  check(declared[field] === sentinel, `字段表里的 ${field} 声明了却没进投影（拿到 ${JSON.stringify(declared[field])}）：表与投影已经分叉`)
  const missing = asRecord(projectUiDescription(fake({})))
  check(!hasOwn(missing, field), `模块对象上没声明 ${field}，投影里却有这个键：界面会把「没声明」读成「声明了 undefined」`)
}

const allDeclared = fake(Object.fromEntries(fields.map((f) => [f, '哨兵值:' + f])))
const full = asRecord(projectUiDescription(allDeclared))
check(full.id === 'fake-backend' && full.label === '假后端', '身份三件套（id/label）没有原样带过去：界面画后端列表就靠它们')
check(hasOwn(full, 'presentation'), '投影里没有 presentation 键：它按惯例永远在（没声明时值为 undefined），界面据此取品牌色')
const extraKeys = Object.keys(full).filter((k) => k !== 'id' && k !== 'label' && k !== 'presentation' && !fields.includes(k))
check(
  extraKeys.length === 0,
  '投影里多出字段表之外的键：' + JSON.stringify(extraKeys) + '。字段表是唯一真源，多出来的键要回答「谁把它加进去的」',
)
check(
  Object.keys(full).length === 3 + fields.length,
  `投影的键数应当是 3 + ${fields.length} = ${3 + fields.length}，实际 ${Object.keys(full).length}`,
)

const withBehavior = asRecord(projectUiDescription(fake({ checks: ['x'], create: () => ({}), matches: () => true, describe: () => ({}) })))
const leaked = ['checks', 'create', 'matches', 'describe'].filter((k) => hasOwn(withBehavior, k))
check(leaked.length === 0, '投影里混进了表外的行为与内务字段：' + JSON.stringify(leaked) + '（函数过不了进程边界，发过去就是坏数据）')

// ---- 四、键在不在只看值有没有定义，不看值真不真 ----
for (const falsy of ['', null, 0, false]) {
  const projected = asRecord(projectUiDescription(fake({ openRepository: falsy })))
  check(
    hasOwn(projected, 'openRepository'),
    'openRepository = ' +
      JSON.stringify(falsy) +
      ' 时投影把这个键丢了：旧写法 m.openRepository ? { openRepository: m.openRepository } : {} 就是这样，把「声明了空值」与「根本没声明」压成同一件事（#1139 改掉了它，这里守着别再改回去）',
  )
}

// 判据跑漏的兜底：上面每段都必须真的跑过，否则一个空循环就能让整条门禁在零断言下变绿。
const NEEDED = 40
check(assertions >= NEEDED, `判据跑漏了：只跑了 ${assertions} 条，至少要 ${NEEDED} 条`)

console.log('界面描述单源门禁（#1139 起：宿主投影一处、房间无第二个声明入口）')
if (failed) {
  for (const m of messages) console.log('  FAIL ' + m)
  console.log(`\n有 ${messages.length} 条不成立（共 ${assertions} 条判据）`)
  process.exit(1)
}
console.log(
  `  全部通过 — ${assertions} 条判据：宿主四个通道都走同一处投影、src/host 里 ${hostFiles.length} 个源码文件里没有第二个 openRepository 字段名（实测 ${hostRepoHits} 处）、GitLab 房命名空间上没有那个没人读的文件级导出、字段表与投影逐项对得上、声明了假值也不丢键`,
)
