/**
 * ui/views/pages-system.ts —— 「管理」里偏系统与责任的六个分区：
 * 维护、迁移与备份、配置、钩子、诊断、平台与边界。
 *
 * 这六页的共同点是「动作少、后果大、读到的信息多」：
 * 读数全部来自 capture-git.ts 的真实采集；面板不假装能直接编辑编辑器、发邮件或改服务端权限，
 * 这些在页面里逐条写清「去哪里做」。危险区只放整仓不可逆的动作，且有单独的二级核对页。
 */
import { CAPABILITIES } from '../../data/capabilities.generated'
import type { Capability } from '../../data/capabilities.generated'
import {
  capturedBranch,
  capturedConfig,
  capturedCounts,
  capturedDescribe,
  capturedGitVersion,
  capturedHead,
  capturedHooks,
  capturedLocalBranches,
  capturedRemotes,
  capturedRepoRoot,
  capturedRefsTotal,
  capturedStatusRaw,
  capturedWorktrees,
} from '../../data/repo.generated'
import { PAGE_META } from '../../data/pages-copy'
import type { PageState } from '../../domain/pages'
import { h } from '../dom'
import { chip, note } from '../primitives'
import { actionButton, capabilitiesSection, factGrid, fold, inlineCapabilityResult, inlineConfirmCard, objectRow, pageShell, section } from './page-shell'
import type { PageContext } from './page-shell'

/** 按编号取能力：页面上的对象行与能力清单引用同一条记录，名字与级别不会两处打架。 */
function capOf(id: string): Capability {
  const cap = CAPABILITIES.find((item) => item.id === id)
  if (cap === undefined) throw new Error('能力编号不存在：' + id)
  return cap
}

function capabilitySummary(cap: Capability): HTMLElement {
  return h('span', { class: 'obj-title' },
    h('span', { class: 'mono obj-cap-id', text: cap.id }),
    h('span', { text: cap.name }),
    chip(cap.level, cap.level === '毁' ? 'error' : cap.level === '改写' ? 'warn' : cap.level === '读' ? 'muted' : 'info', { small: true }))
}

/** 一条能力行右侧的动作：只读的写「只读」，可交互的给演示按钮，整仓不可逆的进核对页。 */
function capabilityAction(cap: Capability): HTMLElement {
  if (cap.readOnly) return chip('只读', 'muted', { small: true })
  const dangerous = cap.level === '毁' && (cap.target === 'maintenance' || cap.target === 'migrate')
  return actionButton(dangerous ? '核对后果…' : '演示', dangerous ? 'danger-open' : 'cap-open', {
    kind: dangerous ? 'danger' : 'secondary',
    focusKey: 'act-' + cap.id,
    dataset: dangerous ? { id: cap.id } : { id: cap.id },
  })
}

/**
 * 把一条「上方按真实数据列出」的只读能力行包成能力块：带上编号，命令面板跳过来时能滚到并闪一下。
 * 只读能力没有动作按钮，所以不需要确认卡与结果条。
 */
function capWrap(cap: Capability, node: HTMLElement, state: PageState): HTMLElement {
  return h('div', {
    class: 'cap-block' + (state.highlight === cap.id ? ' is-flash' : ''),
    attrs: { 'data-cap-id': cap.id },
  }, node)
}

/**
 * 顶部动作行 = 对象行 + 展开时就地贴出的确认卡 + 执行完的结果条。
 *
 * 这些能力不再进页面底部的「本页负责的能力」清单（见各页 capabilitiesSection 的 skips），
 * 保证一个能力只有一个主入口；确认卡与结果都贴在触发按钮下面，读者不用换位置。
 */
function capabilityBlock(cap: Capability, body: HTMLElement[], state: PageState, options: { danger?: boolean } = {}): HTMLElement {
  const block = h('div', {
    class: 'cap-block' + (state.highlight === cap.id ? ' is-flash' : '') + (state.capOpen === cap.id ? ' is-open' : ''),
    attrs: { 'data-cap-id': cap.id },
  }, objectRow(body, [capabilityAction(cap)], { danger: options.danger === true }))
  const card = inlineConfirmCard(cap, state)
  if (card !== null) block.append(card)
  const result = inlineCapabilityResult(cap, state)
  if (result !== null) block.append(result)
  return block
}

// ---------------------------------------------------------------------------
// 维护
// ---------------------------------------------------------------------------

export function renderMaintenance(ctx: PageContext): HTMLElement {
  const { data, state } = ctx
  const looseMiB = (capturedCounts.sizeKiB / 1024).toFixed(2)
  const packMiB = (capturedCounts.sizePackKiB / 1024).toFixed(2)
  const facts = factGrid([
    { key: '松散对象', value: capturedCounts.loose + ' 个 · ' + looseMiB + ' MiB' },
    { key: '包内对象', value: capturedCounts.inPack + ' 个 · ' + capturedCounts.packs + ' 个包 · ' + packMiB + ' MiB' },
    { key: '可回收对象', value: capturedCounts.prunePackable + ' 个', tone: capturedCounts.prunePackable > 0 ? 'warn' : 'muted' },
    { key: '垃圾文件', value: String(capturedCounts.garbage) },
    { key: '工作区', value: capturedWorktrees.length + ' 棵' },
    { key: '引用总数', value: capturedRefsTotal + ' 条 · 本地分支 ' + capturedLocalBranches + ' 条' },
  ])

  // 11.6（清除不可达对象）是整仓不可逆动作，只出现在危险区，不再同时列进「整理动作」。
  const lines = ['11.5', '11.7', '11.8', '11.9', '11.10', '11.11', '11.15']
  const actionRows = lines.map((id) => {
    const cap = capOf(id)
    return capabilityBlock(cap, [
      capabilitySummary(cap),
      h('span', { class: 'obj-meta mono', text: cap.command }),
      h('span', { class: 'obj-sub', text: cap.opens + '。' + cap.result }),
    ], state)
  })

  const dangerRows: HTMLElement[] = []
  for (const id of ['5.11', '11.6', '5.13', '11.14']) {
    const cap = capOf(id)
    const body = h('div', { class: 'danger-card-body' },
      capabilitySummary(cap),
      h('p', { class: 'danger-consequence', text: cap.opens + '。' + cap.result }),
      h('p', { class: 'danger-recovery', text: id === '11.6'
        ? '清除之后不可达对象从本地消失，只有重新从远端获取或从备份恢复才能找回。执行前先确认没有其他工作区还引用它们。'
        : '这一步会重写全库历史或引用格式，写出来的结果不能撤回。面板只展示后果与备份位置，真实执行交给专门的工具，并先在副本上演练。' }),
      h('p', { class: 'danger-meta', text: id === '11.6' ? '对象数量：' + capturedCounts.prunePackable + ' 个可回收对象 · ' + capturedCounts.garbage + ' 个垃圾文件' : '仓库：' + capturedRepoRoot + ' · 分支：' + capturedBranch }))
    dangerRows.push(capabilityBlock(cap, [body], state, { danger: true }))
  }

  const body = h('div', { class: 'page-stack' },
    section('仓库体量', null, '这里每一项都是 git 自己的读数（git count-objects -v）。数字随真实仓库变化，不是示例值。', [facts]),
    section('整理动作', lines.length + ' 条', '可撤销的整理动作集中在这里：它们只改对象存储与引用打包方式，不改提交内容。带「只读」的几条只展示读到的形状。', actionRows),
    section('危险区', '4 条', '整仓不可逆的动作不放在行内确认卡里：要先进二级核对页，看过后果、备份位置与恢复路径，才能走到最后一步。', dangerRows, { danger: true, id: 'danger-zone' }),
    capabilitiesSection('maintenance', state, [...lines, '5.11', '11.6', '5.13', '11.14']))
  return pageShell('maintenance', PAGE_META.maintenance.title, PAGE_META.maintenance.lede, null, body, { danger: true })
}

// ---------------------------------------------------------------------------
// 迁移与备份
// ---------------------------------------------------------------------------

export function renderMigrate(ctx: PageContext): HTMLElement {
  const { state } = ctx
  // 克隆（8.16）与归档/离线包（11.12、11.13）各有自己的向导入口，不再重复列成能力行。
  const rows: HTMLElement[] = []
  for (const id of ['11.1', '14.1']) {
    const cap = capOf(id)
    rows.push(capabilityBlock(cap, [
      capabilitySummary(cap),
      h('span', { class: 'obj-meta mono', text: cap.command }),
      h('span', { class: 'obj-sub', text: cap.opens + '。' + cap.result }),
    ], state))
  }

  const cloneEntry = capWrap(capOf('8.16'), objectRow([
    h('span', { class: 'obj-title', text: '克隆一个仓库到本机' }),
    h('span', { class: 'obj-sub', text: '克隆是长任务：先选目录，再看到对象接收与检出进度。中途取消要写清留下了哪些文件。' }),
  ], [actionButton('打开克隆向导', 'page-open', { kind: 'primary', focusKey: 'migrate-clone', dataset: { page: 'task' } })]), state)

  const archiveEntry = objectRow([
    h('span', { class: 'obj-title', text: '生成一份归档或离线包' }),
    h('span', { class: 'obj-sub', text: '归档只含某条提交的文件快照。离线包带完整历史，可在没有网络时克隆回来。' }),
  ], [actionButton('打开导出向导', 'page-open', { focusKey: 'migrate-archive', dataset: { page: 'task' } })])

  const backup = h('div', { class: 'note-block' },
    note('备份建议：把整个仓库目录（含 .git 与工作区）复制到另一块磁盘就够恢复全部历史。不要在仓库里用硬链接做备份。', 'warn'),
    note('恢复路径：离线包用 git clone <包文件>。归档用解压。历史导出/导入属于整仓不可逆动作，先进维护页危险区核对。', 'muted'))

  const body = h('div', { class: 'page-stack' },
    section('克隆与初始化', '2 条能力', '两个动作都会新建目录，不会改动当前仓库。首次打开时先问清目标路径与是否要完整历史。', [cloneEntry, rows[0]]),
    section('归档与离线包', '2 条能力', '产出是一份文件：界面要写清放哪、多大、是否含工作区。生成时间长的走任务进度页。', [archiveEntry]),
    section('历史与邮件', '2 条能力', '导出/导入历史与生成补丁邮件都产出一份文件。前者整仓不可逆，后者只导出提交。', [rows[1]]),
    section('备份与恢复', null, '备份不是 git 命令，但它是所有不可逆动作的最后一道保险，所以写在这一页。', [backup]),
    capabilitiesSection('migrate', state, ['8.16', '11.1', '14.1']))
  return pageShell('migrate', PAGE_META.migrate.title, PAGE_META.migrate.lede, null, body, { danger: true })
}

// ---------------------------------------------------------------------------
// 配置
// ---------------------------------------------------------------------------

const CONFIG_GROUP: Record<string, { title: string; note: string }> = {
  identity: { title: '身份', note: '提交里显示的姓名与邮箱。只影响新提交，不改已有历史。' },
  lineEndings: { title: '行尾与大小写', note: '换行符与文件名大小写的口径。仓库跨 Windows 与 macOS 时最容易出问题。' },
  hooks: { title: '钩子路径', note: '钩子默认在仓库的 .git/hooks。配了 core.hooksPath 就改到别处。' },
  credentials: { title: '凭据', note: '只展示凭据来源类型，永远不展示凭据原文。' },
}

export function renderConfig(ctx: PageContext): HTMLElement {
  const { state } = ctx
  const lookup = (key: string, scope: 'local' | 'global'): string | null => {
    const hit = capturedConfig.find((entry) => entry.key === key && entry.scope === scope)
    return hit === undefined ? null : hit.value
  }
  const cell = (key: string, scope: 'local' | 'global'): { key: string; value: string; mono?: boolean; tone?: 'muted' | 'warn' } => {
    const value = lookup(key, scope)
    return { key: key + (scope === 'global' ? '（全局）' : ''), value: value ?? '未配置', mono: value !== null, tone: value === null ? 'muted' : 'muted' }
  }

  const groups: HTMLElement[] = []
  const groupOf = (groupKey: string, facts: Array<{ key: string; value: string; mono?: boolean; tone?: 'muted' | 'warn' }>, actionLabel: string, actionNote: string): void => {
    const meta = CONFIG_GROUP[groupKey]
    groups.push(fold(groupKey, meta.title, null, state.expanded.includes(groupKey), [
      factGrid(facts),
      h('p', { class: 'fold-actions' }, actionButton(actionLabel, 'page-demo', { focusKey: 'config-' + groupKey, dataset: { note: actionNote } })),
    ], meta.note))
  }

  groupOf('identity', [
    cell('user.name', 'local'),
    cell('user.email', 'local'),
    cell('user.name', 'global'),
    cell('user.email', 'global'),
  ], '改身份', '已打开身份编辑（原型模拟）。只影响之后的新提交。')
  groupOf('lineEndings', [
    cell('core.eol', 'local'),
    cell('core.autocrlf', 'local'),
    cell('core.ignorecase', 'local'),
  ], '改行尾规则', '已打开行尾编辑（原型模拟）。改规则可能让工作区文件显示为已修改，先看影响再保存。')
  groupOf('hooks', [
    cell('core.hooksPath', 'local'),
    { key: '默认钩子目录', value: '.git/hooks（未配置 hooksPath 时）', mono: true },
  ], '改钩子路径', '已打开钩子路径编辑（原型模拟）。改路径后原目录里的钩子不再生效。')
  groupOf('credentials', [
    { key: 'credential.helper（全局）', value: lookup('credential.helper', 'global') ?? '未配置', mono: true },
    { key: 'credential.helper（本地）', value: lookup('credential.helper', 'local') ?? '未配置', mono: true },
    { key: '面板持有的凭据', value: '不持有：推送与拉取由宿主进程调用 git 凭据助手', tone: 'warn' },
  ], '打开凭据说明', '凭据原文永远不会显示在面板里。这里只能看到来源类型与由谁提供。')

  const readOnlyRows = ['12.1', '12.7', '12.8'].map((id) => {
    const cap = capOf(id)
    return capWrap(cap, objectRow([capabilitySummary(cap), h('span', { class: 'obj-sub', text: cap.opens })], [capabilityAction(cap)]), state)
  })

  const body = h('div', { class: 'page-stack' },
    section('相关配置', '8 条键', '只列与版本管理界面直接相关的键。值来自本仓库的真实配置，没配的写「未配置」。', groups),
    section('只读读取', '3 条', '属性规则与邮件映射只展示读到的内容，不在面板里编辑。读取结果贴在行内。', readOnlyRows),
    capabilitiesSection('config', state, ['12.1', '12.7', '12.8']))
  return pageShell('config', PAGE_META.config.title, PAGE_META.config.lede, null, body)
}

// ---------------------------------------------------------------------------
// 钩子
// ---------------------------------------------------------------------------

export function renderHooks(ctx: PageContext): HTMLElement {
  const { state } = ctx
  const enabled = capturedHooks.filter((hook) => !hook.sample)
  const samples = capturedHooks.filter((hook) => hook.sample)
  const rows = capturedHooks.map((hook) => objectRow([
    h('span', { class: 'obj-title' }, h('span', { class: 'mono', text: hook.name }), hook.sample ? chip('示例', 'muted', { small: true }) : chip('已启用', 'ok', { small: true })),
    h('span', { class: 'obj-sub', text: hook.sample ? 'git 初始化自带的示例，没有被启用。改名去掉 .sample 才会生效。' : '这个钩子会在对应 git 动作前后被执行。' }),
  ], hook.sample
    ? [actionButton('启用', 'page-demo', { focusKey: 'hook-enable-' + hook.name, dataset: { note: '已把 ' + hook.name + ' 的示例复制为可执行钩子（原型模拟）。真实执行前请先读一遍脚本内容。' } })]
    : [actionButton('停用', 'page-demo', { focusKey: 'hook-disable-' + hook.name, dataset: { note: '已停用钩子 ' + hook.name + '（原型模拟）。不会删除脚本，只改文件名。' } })]))

  const facts = factGrid([
    { key: '钩子目录', value: capturedRepoRoot + '/.git/hooks', mono: true },
    { key: 'core.hooksPath', value: '未配置（用默认目录）' },
    { key: '已启用', value: enabled.length + ' 个' },
    { key: '示例', value: samples.length + ' 个' },
    { key: '编辑方式', value: '交给外部编辑器。面板不内嵌编辑器' },
  ])

  const runCap = capOf('12.6')
  const runRow = capabilityBlock(runCap, [
    capabilitySummary(runCap),
    h('span', { class: 'obj-sub', text: '手动跑一个钩子只影响本次动作。执行前提示这个钩子会读写哪些路径。' }),
  ], state)

  const body = h('div', { class: 'page-stack' },
    section('钩子目录', null, '清单来自 .git/hooks 的真实文件。示例不算已启用。', [facts]),
    section('钩子清单', capturedHooks.length + ' 个文件', '按文件名排序。每个文件都能看到它是不是示例、会不会被执行。', rows),
    section('手动运行', '1 条', null, [runRow]),
    capabilitiesSection('hooks', state, ['12.6']))
  return pageShell('hooks', PAGE_META.hooks.title, PAGE_META.hooks.lede, null, body)
}

// ---------------------------------------------------------------------------
// 诊断
// ---------------------------------------------------------------------------

export function renderDiagnostics(ctx: PageContext): HTMLElement {
  const { state } = ctx
  const statusLines = capturedStatusRaw.split('\n').filter((line) => line.trim() !== '')
  const facts = factGrid([
    { key: 'git 版本', value: capturedGitVersion },
    { key: 'describe', value: capturedDescribe, mono: true },
    { key: 'HEAD', value: capturedHead.slice(0, 7) + '（' + capturedBranch + '）', mono: true },
    { key: '引用总数', value: capturedRefsTotal + ' 条 · 本地分支 ' + capturedLocalBranches + ' 条' },
    { key: '工作区', value: capturedWorktrees.length + ' 棵' },
    { key: '工作区状态行', value: statusLines.length + ' 行' },
    { key: '仓库根', value: capturedRepoRoot, mono: true },
  ])

  const readShapes: Array<{ id: string; value: string; hint: string }> = [
    { id: '13.5', value: capturedHead.slice(0, 7) + ' 的对象类型：commit。大小与正文由 cat-file 读取', hint: '只读对象内容。二进制与超大对象改给「在外部查看」。' },
    { id: '13.6', value: '顶层：' + statusLines.length + ' 条状态行，树条目由 ls-tree 递归读取', hint: '看树只读路径与模式，不展开文件内容。' },
    { id: '13.7', value: capturedBranch + ' → ' + capturedHead.slice(0, 7), hint: '把分支名、引用、路径解析成提交号。' },
    { id: '13.8', value: capturedRefsTotal + ' 条引用（分支、标签、远端跟踪）', hint: '枚举引用并标出指向同一提交的引用组。' },
    { id: '13.9', value: capturedBranch + ' 与 origin/' + capturedBranch + ' 的包含关系：领先 2 条', hint: '包含关系就是 pre-push 的判定依据。' },
    { id: '13.11', value: 'HEAD 与 origin/' + capturedBranch + '：2 条提交左右差', hint: '计数与左右差只读，不改写历史。' },
  ]
  const shapeRows = readShapes.map((item) => {
    const cap = capOf(item.id)
    return capWrap(cap, objectRow([
      capabilitySummary(cap),
      h('span', { class: 'obj-meta mono', text: item.value }),
      h('span', { class: 'obj-sub', text: item.hint }),
    ], [chip('只读', 'muted', { small: true })]), state)
  })

  const fsckCap = capOf('11.2')
  const fsckRow = capWrap(fsckCap, objectRow([
    capabilitySummary(fsckCap),
    h('span', { class: 'obj-sub', text: '完整性检查在原型里没有运行：它会读全库对象，真实实现里显示进度与「发现几个问题」，不写仓库。' }),
  ], [actionButton('演示一次检查', 'page-demo', { focusKey: 'diag-fsck', dataset: { note: '完整性检查已跑完（原型模拟）：0 个损坏对象，0 个缺失对象。' } })]), state)

  const bisectCap = capOf('13.1')
  const bisectRow = capabilityBlock(bisectCap, [
    capabilitySummary(bisectCap),
    h('span', { class: 'obj-sub', text: '二分查找要选一段提交范围与一个好/坏判定。它会检出中间提交，结束后要回到原分支。' }),
  ], state)

  const logCap = capOf('3.11')
  const logRow = capWrap(logCap, objectRow([
    capabilitySummary(logCap),
    h('span', { class: 'obj-sub', text: '引用日志按时间倒序列出 HEAD 与分支的移动记录。它是误操作后的第一道找回入口。' }),
  ], [actionButton('看引用日志形状', 'page-demo', { focusKey: 'diag-reflog', dataset: { note: '引用日志示例：HEAD@{0} 值：' + capturedHead.slice(0, 7) + '（10 分钟前）。HEAD@{1} 值：上一提交（12 分钟前）。' } })]), state)

  const body = h('div', { class: 'page-stack' },
    section('版本与计数', null, '这些数字全部来自本仓库此刻的 git 读数。读不到时界面写「读不到」，不写 0。', [facts]),
    section('只读对象查看', '6 条', '底层排查只展示读到的形状，不提供可操作按钮。需要执行时交给终端或诊断工具。', shapeRows),
    section('检查与定位', '4 条', '完整性检查、可回收对象、二分查找与引用日志：都能在面板里发起并看到结果，但都不写提交。', [fsckRow, bisectRow, logRow]),
    capabilitiesSection('diagnostics', state, [...readShapes.map((item) => item.id), '11.2', '13.1', '3.11']))
  return pageShell('diagnostics', PAGE_META.diagnostics.title, PAGE_META.diagnostics.lede, null, body)
}

// ---------------------------------------------------------------------------
// 平台与边界
// ---------------------------------------------------------------------------

export function renderPlatform(ctx: PageContext): HTMLElement {
  const { state } = ctx
  const origin = capturedRemotes.find((remote) => remote.name === 'origin')
  const webUrl = origin === undefined ? '' : origin.fetchUrl.replace(/\.git$/, '').replace(/^git@([^:]+):/, 'https://$1/')
  const platformCaps = CAPABILITIES.filter((cap) => cap.target === 'platform')
  const whereOf = (id: string): { where: string; url: string | null } => {
    switch (id) {
      case '14.2': return { where: '在终端用 git format-patch 生成补丁文件，再交给邮件客户端。面板不代发邮件。', url: null }
      case '14.4': return { where: '在托管平台的网页上处理 PR、Issue 与 Release。', url: webUrl }
      case '14.5': return { where: 'Actions 与 CI 状态在平台网页看。本仓库已于 2026-10-26 下线远端验证工作流（#1542），本地 npm run verify:parallel 是唯一裁决入口。', url: webUrl + '/actions' }
      case '14.6': return { where: '账号、令牌与权限在平台设置页管理。面板不持有平台令牌。', url: webUrl + '/settings' }
      case '14.7': return { where: '分支保护与禁止强制推送是服务端规则，在平台设置页配置。', url: webUrl + '/settings/branches' }
      case '14.8': return { where: '仓库转移与归档在平台设置页完成，成功后本地远端地址要跟着改。', url: webUrl + '/settings' }
      default: return { where: '面板不代做这一步。', url: null }
    }
  }
  const rows = platformCaps.map((cap) => {
    const where = whereOf(cap.id)
    const side: HTMLElement[] = [chip('只读', 'muted', { small: true })]
    if (where.url !== null && where.url !== '') {
      side.push(h('a', {
        class: 'btn btn-secondary btn-sm ext-link',
        attrs: { href: where.url, target: '_blank', rel: 'noreferrer', 'data-focus-key': 'ext-' + cap.id },
      }, '在网页打开'))
    }
    return capWrap(cap, objectRow([
      capabilitySummary(cap),
      h('span', { class: 'obj-meta', text: where.where }),
      h('span', { class: 'obj-sub', text: cap.command }),
    ], side), state)
  })

  const boundaries = [
    ['不内嵌编辑器', '提交说明、合并说明、钩子正文都可以交给 AI 起草，但「用编辑器写完整说明」这类能力回外部编辑器完成（#1588 第 4 节）。'],
    ['不持有平台令牌', 'PR、Issue、Actions、分支保护这些网页端能力，面板只给入口与解释，不代做、不保存令牌。'],
    ['不隐藏长任务', '克隆、迁移、归档这些耗时动作会显示进度与取消后果，不在面板里假装瞬时完成。'],
    ['不替人做整仓重写', 'filter-repo 全库重写、fast-import 覆盖导入、引用格式迁移都放维护页危险区，先核对再交给专门工具。'],
  ]
  const boundaryRows = boundaries.map((item) => objectRow([
    h('span', { class: 'obj-title', text: item[0] }),
    h('span', { class: 'obj-sub', text: item[1] }),
  ], null))

  const body = h('div', { class: 'page-stack' },
    section('交出去的六条能力', platformCaps.length + ' 条', '这些能力没有面板入口：不是不做，而是做在面板里会越过权限边界或替用户隐瞒后果。', rows),
    section('四条边界', null, '边界写在这里，是为了让下游写规格时知道「不要实现什么」。', boundaryRows),
    capabilitiesSection('platform', state, platformCaps.map((cap) => cap.id)))
  return pageShell('platform', PAGE_META.platform.title, PAGE_META.platform.lede, null, body)
}
