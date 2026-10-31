/**
 * tools/capture-capabilities.ts —— 从能力研究笔记生成原型的入口登记表。
 *
 * 为什么要生成而不是手抄：#1590 要求 162 条 git 能力逐条登记「入口在哪 → 打开什么 →
 * 结果落在哪」，这份登记就是原型的验收表。手抄 162 行既容易漏行，也容易在能力改名后
 * 和笔记对不上。这里直接解析 research/1588-git-full-capability-surface.md 第 2 章的
 * 十四张能力表，再按 #1590 Answer 段定的「14 个域各落在哪个页面」补上入口与落点。
 *
 * 用法（在仓库根目录执行）：
 *   node docs/prototype/vc-redesign/tools/capture-capabilities.ts
 *
 * 产物固定为 ../src/data/capabilities.generated.ts，带 AUTO-GENERATED 头，不手改。
 * 解析规则集中在这里：改笔记的表格格式要同步改本文件的解析，并在运行输出里核对
 * 「162 条、直 42 / 折 62 / 诊 34 / 外 24」这组数字仍然对得上。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..', '..', '..', '..')
const NOTE = join(REPO, 'research', '1588-git-full-capability-surface.md')
const OUT = join(HERE, '..', 'src', 'data', 'capabilities.generated.ts')

type Level = '读' | '写' | '改写' | '毁' | '非 git'
type Placement = '直' | '折' | '诊' | '外'

interface DomainSpec {
  name: string
  entry: string
  opens: string
  target: string
}

/** 14 个域的默认入口：落点照 #1590 Answer 段的「14 个域的能力各落在哪」。 */
const DOMAINS: Record<string, DomainSpec> = {
  '1': { name: '工作区与加入这次提交', entry: '改动页文件行', opens: '行内展开、行菜单或内联确认卡', target: 'changes' },
  '2': { name: '提交', entry: '改动页提交区与提交历史行菜单', opens: '提交区按钮、行菜单或内联确认卡', target: 'changes' },
  '3': { name: '历史查看', entry: '提交历史列表、提交详情与全库搜索', opens: '列表、详情、二级页或只读诊断', target: 'commits' },
  '4': { name: '引用与标签', entry: '顶部身份行分支按钮与管理页「分支与标签」', opens: '分支浮层、标签折叠区或内联确认卡', target: 'branch-tags' },
  '5': { name: '历史改写', entry: '提交行菜单与「变基待办」页', opens: '行菜单、整页待办清单或内联确认卡', target: 'rebase' },
  '6': { name: '合并、变基与冲突', entry: '分支浮层与「冲突向导」页', opens: '内联确认卡、整页向导或只读诊断', target: 'conflicts' },
  '7': { name: '收起的改动', entry: '「收起的改动」页签', opens: '行内动作或贴行确认卡', target: 'stash' },
  '8': { name: '远端与同步', entry: '顶部同步带与「远端与同步」页', opens: '同步带按钮、二级页或折叠区', target: 'remote' },
  '9': { name: '工作树与多开', entry: '工作树页签', opens: '行内展开或内联确认卡', target: 'worktrees' },
  '10': { name: '子模块', entry: '管理页「子模块」', opens: '二级页行内展开或只读诊断', target: 'submodules' },
  '11': { name: '仓库维护与迁移', entry: '管理页「维护（含危险区）」与「迁移与备份」', opens: '二级页、危险区二次确认页或只读诊断', target: 'maintenance' },
  '12': { name: '配置与钩子', entry: '管理页「配置」与「钩子」', opens: '分组折叠区或内联表单', target: 'config' },
  '13': { name: '调试与底层', entry: '管理页「诊断」与提交历史搜索', opens: '只读诊断区或二级页', target: 'diagnostics' },
  '14': { name: '托管平台与邮件边界', entry: '管理页「平台与边界」', opens: '只读说明', target: 'platform' },
}

/** 逐条覆盖域默认落点的地方：条目跨域落在别的页面，或只读诊断归到诊断页。 */
const TARGET_OVERRIDES: Record<string, string> = {
  '2.7': 'changes',
  '3.5': 'diagnostics', '3.9': 'diagnostics', '3.11': 'diagnostics', '3.13': 'commits',
  '4.12': 'branch-tags',
  '5.11': 'maintenance', '5.12': 'maintenance', '5.13': 'migrate',
  '6.10': 'diagnostics', '6.14': 'diagnostics', '6.15': 'diagnostics',
  '8.16': 'migrate',
  '11.1': 'migrate', '11.2': 'diagnostics', '11.3': 'diagnostics', '11.4': 'diagnostics',
  '11.12': 'migrate', '11.13': 'migrate',
  '12.7': 'config', '12.8': 'config', '12.5': 'hooks', '12.6': 'hooks',
  '13.3': 'search',
  '14.1': 'migrate', '14.3': 'diagnostics',
}

/** #1590：6 条没有可操作入口（发补丁邮件加平台五条），只能在平台与边界页只读说明。 */
const BOUNDARY_ONLY = new Set(['14.2', '14.4', '14.5', '14.6', '14.7', '14.8'])

const LEVELS = new Set(['读', '写', '改写', '毁'])
const PLACEMENTS = new Set(['直', '折', '诊', '外'])

function stripLink(text: string): string {
  return text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ').trim()
}

/**
 * 界面上的叫法：git 的 stage 在界面上叫「加入这次提交」，stash 叫「收起的改动」。
 *
 * 能力表是从研究笔记抄下来的，笔记里写的是 git 自己的词（暂存、贮藏）。直接搬进界面会
 * 和页面上的按钮对不上：读者在页面上看到「加入」，登记表里却写「暂存」，会以为漏了入口。
 * 这里只改 name / entry / result 三处给人看的文字，command 列保留 git 原文——那一列是
 * 查命令用的，改成界面叫法就查不到了。数组按「先长后短」排：先换整句，再换单词，
 * 否则「暂存区」会先被「暂存」换掉半截，剩下的「区」没处安放。
 */
const UI_WORDING: Array<[string, string]> = [
  ['只允许快进', '只接受直接更新'],
  ['禁止快进', '总是生成合并提交'],
  ['判断能不能快进', '判断能不能直接更新'],
  ['撤销上一条提交、改动回暂存区', '撤销上一条提交、改动回到「已加入这次提交」'],
  ['撤销提交并取消暂存', '撤销提交并把改动移出这次提交'],
  ['提交已暂存内容', '提交已加入这次提交的内容'],
  ['丢弃单个文件的未暂存改动', '丢弃单个文件的未加入改动'],
  ['丢弃全部未暂存改动', '丢弃全部未加入改动'],
  ['应用并保留记录', '放回工作区并保留记录'],
  ['应用并删记录', '放回工作区并删掉记录'],
  ['从贮藏建分支', '从收起的改动建分支'],
  ['只贮藏暂存区', '只收起已加入这次提交的改动'],
  ['连未跟踪一起贮藏', '连未跟踪文件一起收起来'],
  ['贮藏当前改动', '把当前改动收起来'],
  ['逐块暂存', '逐块加入这次提交'],
  ['暂存单个文件', '把单个文件加入这次提交'],
  ['暂存全部', '全部加入这次提交'],
  ['撤回暂存', '把文件移出这次提交'],
  ['行改名并进暂存区', '行改名并加入这次提交'],
  ['改动页三组（已暂存 / 未暂存 / 冲突）', '改动页三组（已加入 / 未加入 / 冲突）'],
  ['文件行移进「已暂存」', '文件行移进「已加入」'],
  ['文件行回「未暂存」组', '文件行回「未加入」组'],
  ['文件行进「已暂存（删除）」', '文件行进「已加入（删除）」'],
  ['改动页出现已暂存改动', '改动页出现已加入这次提交的改动'],
  ['贮藏页签', '「收起的改动」页签'],
  ['贮藏区空', '收起清单为空'],
  ['贮藏行', '收起记录行'],
  ['贮藏页', '「收起的改动」页'],
  ['暂存区', '「已加入这次提交」的清单'],
  ['未暂存', '未加入'],
  ['已暂存', '已加入'],
  ['贮藏', '收起'],
  ['暂存', '加入这次提交'],
]

function uiWording(text: string): string {
  let out = text
  for (const [from, to] of UI_WORDING) out = out.split(from).join(to)
  // 界面上的说明句不用分号：分号要求读者自己断句，面板里改成一个句号一句话。
  // 只作用于给人看的 name / entry / result，命令列（command）保留 git 原文，不改标点。
  return out.split('；').join('。')
}

/** 面板表达里「结果落在哪」那一句：优先取「结果：」，其次「替代：」，都没有就用整句。 */
function landingOf(expression: string): string {
  const result = /结果：([^｜|]+)/.exec(expression)
  if (result !== null) return result[1].trim()
  const alt = /替代：([^｜|]+)/.exec(expression)
  if (alt !== null) return alt[1].trim()
  const first = expression.split(/[｜|]/)[0].trim()
  return first
}

function opensOf(placement: Placement, domain: DomainSpec): string {
  if (placement === '直') return domain.opens
  if (placement === '折') return '贴触发点的浮层或整页替换'
  if (placement === '诊') return '只读诊断清单'
  return '只读说明与边界'
}

const raw = readFileSync(NOTE, 'utf8')
const lines = raw.split(/\r?\n/)

let domainNo = '0'
const rows: Array<{
  id: string
  domain: string
  name: string
  command: string
  level: Level
  placement: Placement
  entry: string
  opens: string
  result: string
  target: string
  readOnly: boolean
}> = []

for (const line of lines) {
  const domainMatch = /^### 2\.(\d+) 域[^：]+：(.+)$/.exec(line)
  if (domainMatch !== null) {
    domainNo = domainMatch[1]
    continue
  }
  if (!line.startsWith('| ')) continue
  const cells = line.split('|').map((cell) => cell.trim())
  // 单元格：['', id, 能力, 级别, 前置, 表达, 归属, '']
  if (cells.length < 8) continue
  const id = cells[1]
  if (!/^\d+\.\d+$/.test(id)) continue
  const domain = DOMAINS[domainNo]
  if (domain === undefined) throw new Error('能力表出现未知域：' + domainNo)
  const nameCell = cells[2]
  const levelRaw = cells[3]
  const level: Level = LEVELS.has(levelRaw) ? (levelRaw as Level) : '非 git'
  const placementRaw = cells[6]
  if (!PLACEMENTS.has(placementRaw)) throw new Error('未知归属：' + placementRaw)
  const placement = placementRaw as Placement
  const domainId = id.split('.')[0]
  const [namePart, ...commandParts] = nameCell.split(' · ')
  rows.push({
    id,
    domain: domainId,
    name: uiWording(stripLink(namePart)),
    command: stripLink(commandParts.join(' · ')),
    level,
    placement,
    entry: uiWording(domain.entry),
    opens: opensOf(placement, domain),
    result: uiWording(landingOf(cells[5])),
    target: TARGET_OVERRIDES[id] ?? domain.target,
    readOnly: placement === '诊' || placement === '外',
  })
}

if (rows.length !== 162) throw new Error('能力条数不是 162：' + rows.length)
const count = (placement: Placement): number => rows.filter((row) => row.placement === placement).length
const expected = { 直: 42, 折: 62, 诊: 34, 外: 24 }
for (const placement of ['直', '折', '诊', '外'] as Placement[]) {
  const actual = count(placement)
  if (actual !== expected[placement]) throw new Error(placement + ' 归属条数不是 ' + expected[placement] + '：' + actual)
}

const header = `// AUTO-GENERATED。来源脚本：docs/prototype/vc-redesign/tools/capture-capabilities.ts。
// 数据来源：research/1588-git-full-capability-surface.md 第 2 章的十四张能力表；
// 入口与落点来源：#1590 Answer 段的「14 个域的能力各落在哪」与「覆盖口径」。
// 共 ${rows.length} 条：直 ${count('直')}、折 ${count('折')}、诊 ${count('诊')}、外 ${count('外')}。
// 界面叫法已换成图上的说法（stage 叫「加入这次提交」、stash 叫「收起的改动」），command 列保留 git 原文。
// 不要手改；要刷新就在仓库根目录重新跑一次生成脚本。
`

const body = `export type CapabilityLevel = '读' | '写' | '改写' | '毁' | '非 git'
export type CapabilityPlacement = '直' | '折' | '诊' | '外'

export interface Capability {
  /** 能力编号，与 research/1588-git-full-capability-surface.md 第 2 章一致。 */
  id: string
  /** 所属域编号 1–14。 */
  domain: string
  /** 能力名，取自笔记表格第一列「能力 · 命令」的能力部分。 */
  name: string
  /** 对应的 git 命令与选项，取自笔记表格第一列。 */
  command: string
  level: CapabilityLevel
  placement: CapabilityPlacement
  /** 入口在哪：这一条能力的主入口。 */
  entry: string
  /** 打开什么：点开之后出现的是行内、浮层、二级页还是只读诊断。 */
  opens: string
  /** 结果落在哪：动作执行完之后结果出现的位置。 */
  result: string
  /** 原型里的落点：页签名或页面 id。 */
  target: string
  /** 只读：这类能力在原型里只展示信息，不给可操作按钮。 */
  readOnly: boolean
}

export const CAPABILITY_TOTAL = ${rows.length}

export const CAPABILITIES: Capability[] = ${JSON.stringify(rows, null, 2)}
`

writeFileSync(OUT, header + body, 'utf8')
console.log(`captured ${rows.length} capabilities (直 ${count('直')} / 折 ${count('折')} / 诊 ${count('诊')} / 外 ${count('外')}) -> ${OUT}`)
