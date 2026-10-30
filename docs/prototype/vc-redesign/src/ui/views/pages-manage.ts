/**
 * ui/views/pages-manage.ts —— 「管理」索引与它下面的四个日常分区：分支与标签、远端与同步、子模块。
 *
 * 四个页面共用同一套骨架（pageShell + section + 能力清单），区别只在数据从哪来：
 * 分支与标签、远端读采集到的真实引用与配置；子模块这个仓库里是空集，空态也照实画。
 * 页面里的对象级动作只有两种出口：真正属于四页签状态机的（拉取/更新/推送）直接走 session 动作，
 * 其余整理动作走能力清单里的演示流程——这样每个按钮的去向在原型里都能说清。
 */
import { capturedBranch, capturedCounts, capturedHooks, capturedLocalBranchNames, capturedLocalBranches, capturedRemotes, capturedSubmodules, capturedTags } from '../../data/repo.generated'
import { CAPABILITIES } from '../../data/capabilities.generated'
import { MANAGE_CARD_ORDER, PAGE_META } from '../../data/pages-copy'
import { h, icon } from '../dom'
import { chip, emptyState, note } from '../primitives'
import { actionButton, capabilitiesSection, coverageNote, factGrid, fold, objectRow, pageShell, section } from './page-shell'
import type { PageContext } from './page-shell'

/** 管理索引：九个分区各一张卡片，卡片本身就是入口；下面再补「命令面板」与「全库搜索」两个跨区入口。 */
export function renderManageIndex(_ctx: PageContext): HTMLElement {
  const cards = h('div', { class: 'manage-grid' })
  for (const page of MANAGE_CARD_ORDER) {
    const meta = PAGE_META[page]
    const count = manageCountOf(page)
    const caps = CAPABILITIES.filter((cap) => cap.target === page).length
    const card = h('button', {
      class: 'manage-card' + (meta.danger === true ? ' is-danger' : ''),
      attrs: { type: 'button', 'data-focus-key': 'manage-' + page, title: meta.card },
      dataset: { action: 'page-open', page },
    },
    h('span', { class: 'manage-card-head' },
      h('span', { class: 'manage-card-title', text: meta.title }),
      meta.danger === true ? chip('危险区', 'error', { small: true }) : null,
      h('span', { class: 'manage-card-count', text: count })),
    h('span', { class: 'manage-card-text', text: meta.card }),
    h('span', { class: 'manage-card-foot' },
      h('span', { class: 'manage-card-caps', text: caps + ' 条能力' }),
      h('span', { class: 'manage-card-go', text: '打开' }, icon('chevron', 11))))
    cards.append(card)
  }

  const shortcuts = h('div', { class: 'manage-shortcuts' },
    h('button', {
      class: 'manage-shortcut',
      attrs: { type: 'button', 'data-focus-key': 'manage-palette' },
      dataset: { action: 'palette-open' },
    }, icon('chevron', 12), h('span', { text: '命令面板：按能力名或位置搜索 162 条能力' })),
    h('button', {
      class: 'manage-shortcut',
      attrs: { type: 'button', 'data-focus-key': 'manage-search' },
      dataset: { action: 'page-open', page: 'search' },
    }, icon('chevron', 12), h('span', { text: '全库搜索：一次搜提交、分支与标签' })))

  const body = h('div', { class: 'page-stack' },
    h('p', { class: 'page-note' }, h('span', { text: '索引不直接写仓库；九个分区的顺序按「越往下越不常用、越不可逆」排，维护与迁移在最后。' })),
    cards, shortcuts, coverageNote())
  return pageShell('manage', PAGE_META.manage.title, PAGE_META.manage.lede, null, body)
}

/** 管理卡片上的数量：能算出真实值就用真实值，算不出的写固定范围（例如迁移页没有运行时数据）。 */
function manageCountOf(page: string): string {
  switch (page) {
    case 'branch-tags': return capturedLocalBranches + ' 条分支 · ' + capturedTags.length + ' 个标签'
    case 'remote': return capturedRemotes.length + ' 个远端'
    case 'submodules': return submoduleNames().length + ' 个子模块'
    case 'maintenance': return '松散对象 ' + capturedCounts.loose + ' · 包 ' + capturedCounts.packs
    case 'migrate': return '6 条能力 · 3 类产出'
    case 'config': return '8 条相关键 · 2 层作用域'
    case 'hooks': return hookCounts().enabled + ' 个已启用 · ' + hookCounts().samples + ' 个示例'
    case 'diagnostics': return '14 条调试能力 · 23 条只读'
    case 'platform': return '6 条能力 · 6 条无操作入口'
    default: return ''
  }
}

/** git submodule status 在空集时输出空串；一行一个子模块。 */
export function submoduleNames(): string[] {
  return capturedSubmodules.split('\n').map((line) => line.trim()).filter((line) => line !== '')
}

/** 钩子清单的两种状态，钩子页与索引卡片共用同一口径。 */
export function hookCounts(): { enabled: number; samples: number } {
  const records = hooksOf()
  return { enabled: records.filter((hook) => !hook.sample).length, samples: records.filter((hook) => hook.sample).length }
}

/** 钩子清单：由 capture-git.ts 从 hooks 目录读出的十四个文件。 */
export function hooksOf(): Array<{ name: string; sample: boolean }> {
  return capturedHooks
}

// ---------------------------------------------------------------------------
// 分支与标签
// ---------------------------------------------------------------------------

export function renderBranchTags(ctx: PageContext): HTMLElement {
  const { data, model, state } = ctx
  const rows = model.branches.rows
  const filtered = rows.filter((row) => {
    if (state.query !== '' && !row.name.toLowerCase().includes(state.query.trim().toLowerCase())) return false
    if (state.filter === 'current') return row.current
    if (state.filter === 'unmerged') return !row.merged
    return true
  })

  const filters = h('div', { class: 'page-filters' },
    filterButton('全部', 'all', state.filter), filterButton('当前分支', 'current', state.filter), filterButton('未并入当前分支', 'unmerged', state.filter))
  const search = h('label', { class: 'page-search' },
    h('span', { class: 'sr-only', text: '按分支名搜索' }),
    h('input', {
      class: 'page-search-input',
      attrs: { type: 'search', placeholder: '按分支名搜索', value: state.draft, 'data-focus-key': 'page-query' },
      dataset: { field: 'page-query' },
    }))

  const branchRows: HTMLElement[] = []
  for (const row of filtered) {
    const facts = h('span', { class: 'obj-meta' },
      h('span', { class: 'mono', text: row.upstream === null ? '没有上游' : row.upstream }),
      h('span', { text: row.ahead === 0 ? '与上游齐平' : '领先 ' + row.ahead }),
      h('span', { text: row.behind === 0 ? '' : '落后 ' + row.behind }),
      h('span', { text: row.merged ? '已并入当前分支' : '未并入当前分支' }))
    branchRows.push(objectRow([
      h('span', { class: 'obj-title' },
        h('span', { class: 'mono', text: row.name }),
        row.current ? chip('当前', 'info', { small: true }) : null,
        h('span', { class: 'obj-oid mono', text: row.oidShort })),
      facts,
      h('span', { class: 'obj-sub', text: row.when + ' · ' + row.subject }),
    ], [
      actionButton('在浮层里看', 'branch-tags-view', { focusKey: 'branch-tags-view-' + row.name, dataset: { name: row.name }, title: '打开顶部分支浮层并选中这条分支' }),
    ]))
  }
  if (filtered.length === 0) branchRows.push(emptyState('没有符合条件的分支', '清空搜索或换一个筛选再试。'))

  // 真实仓库有 62 条本地分支；这里只给与当前工作相关的六条看细节，其余收进折叠区，数量对得上。
  const shown = new Set(rows.map((row) => row.name))
  const rest = capturedLocalBranchNames.filter((name) => !shown.has(name))
  const restList: HTMLElement[] = rest.map((name) => objectRow([
    h('span', { class: 'obj-title mono', text: name }),
    h('span', { class: 'obj-sub', text: '采集到这条本地分支；原型没有为它单独造上游与领先落后样本。' }),
  ], null))

  const tagRows: HTMLElement[] = capturedTags.map((tag) => objectRow([
    h('span', { class: 'obj-title' },
      h('span', { class: 'mono', text: tag.name }),
      h('span', { class: 'obj-oid mono', text: tag.shortOid })),
    h('span', { class: 'obj-sub', text: whenText(data.nowMs, tag.createdAtMs) }),
  ], [
    actionButton('检出', 'page-demo', { focusKey: 'tag-checkout-' + tag.name, dataset: { note: '已基于标签 ' + tag.name + ' 切出新分支（原型模拟）；不会移动已有分支。' } }),
  ]))

  const tracking = factGrid([
    { key: '当前分支', value: model.rail.branch ?? capturedBranch, mono: true },
    { key: '上游', value: capturedRemotes.find((remote) => remote.name === 'origin') === undefined ? 'origin/' + capturedBranch : 'origin/' + capturedBranch, mono: true },
    { key: '领先 / 落后', value: model.rail.syncChips.map((chip) => chip.label + ' ' + chip.value).join(' · ') },
    { key: '上游依据', value: model.rail.basisText },
  ])

  const body = h('div', { class: 'page-stack' },
    section('分支', capturedLocalBranches + ' 条本地分支', '列表先给与当前工作相关的六条（含上游与领先落后）；全部 62 条在下面的折叠区里逐条列名，数量与采集一致。', [
      filters, search, h('div', { class: 'obj-list' }, ...branchRows),
      fold('branch-rest', '全部本地分支', rest.length + ' 条', state.expanded.includes('branch-rest'), restList, '这里只列名字；要看上游与领先落后，需要真实读取每条分支的跟踪配置，原型不假装有这个数据。'),
    ]),
    section('标签', capturedTags.length + ' 个标签', '标签来自本地 refs；没有远端标签与签名信息，界面不假造。', [
      h('div', { class: 'obj-list' }, ...tagRows),
    ]),
    section('上游跟踪', null, '设置上游与取消跟踪是整理动作，放在能力清单里演示；这一屏只把当前状态说清。', [tracking]),
    capabilitiesSection('branch-tags', state))
  return pageShell('branch-tags', PAGE_META['branch-tags'].title, PAGE_META['branch-tags'].lede, null, body, {
    actions: [actionButton('在分支浮层里管理', 'branch-open-from-page', { kind: 'secondary', title: '切分支、合并、变基仍走顶部分支浮层' })],
  })
}

function filterButton(label: string, filter: string, active: string): HTMLElement {
  return h('button', {
    class: 'filter-chip' + (active === filter ? ' is-on' : ''),
    attrs: { type: 'button', 'aria-pressed': active === filter ? 'true' : 'false', 'data-focus-key': 'page-filter-' + filter },
    dataset: { action: 'page-filter', filter },
  }, label)
}

// ---------------------------------------------------------------------------
// 远端与同步
// ---------------------------------------------------------------------------

export function renderRemote(ctx: PageContext): HTMLElement {
  const { model, state } = ctx
  const remoteRows: HTMLElement[] = capturedRemotes.map((remote) => objectRow([
    h('span', { class: 'obj-title' }, h('span', { class: 'mono', text: remote.name }), remote.name === 'origin' ? chip('默认', 'info', { small: true }) : null),
    h('span', { class: 'obj-meta mono', text: remote.fetchUrl }),
    ...(remote.pushUrl !== remote.fetchUrl ? [h('span', { class: 'obj-sub mono', text: '推送地址：' + remote.pushUrl })] : []),
  ], [
    actionButton('改地址', 'page-demo', { focusKey: 'remote-edit-' + remote.name, dataset: { note: '已打开 ' + remote.name + ' 的地址编辑表单（原型模拟）；改地址不会立刻重写提交。' } }),
    actionButton('删除', 'page-demo', { kind: 'danger', focusKey: 'remote-remove-' + remote.name, dataset: { note: '删除远端只会删配置，不会删远端仓库里的任何东西（原型模拟）。' } }),
  ]))

  const syncButtons = h('div', { class: 'page-actions-row' },
    actionButton(model.rail.pull.label, 'pull', { focusKey: 'remote-pull', title: model.rail.pull.reason ?? undefined }),
    actionButton(model.rail.fetch.label, 'fetch', { focusKey: 'remote-fetch', title: model.rail.fetch.reason ?? undefined }),
    actionButton(model.rail.push.label, 'push', { focusKey: 'remote-push', title: model.rail.push.reason ?? undefined }),
    actionButton('抓取所有远端', 'page-demo', { focusKey: 'remote-fetch-all', dataset: { note: '已抓取全部远端（原型模拟）；只更新远端跟踪引用，不动工作区。' } }),
    actionButton('修剪已删除的远端分支', 'page-demo', { focusKey: 'remote-prune', dataset: { note: '已修剪远端已删除的跟踪分支（原型模拟）；本地分支不受影响。' } }))

  const syncFacts = factGrid([
    { key: '当前分支', value: model.rail.branch ?? capturedBranch, mono: true },
    { key: '同步状态', value: model.rail.sync.kind === 'text' ? model.rail.sync.text : '领先 ' + (model.rail.syncChips[0]?.value ?? 0) + ' · 落后 ' + (model.rail.syncChips[1]?.value ?? 0) },
    { key: '读取于', value: model.rail.readAtText },
    { key: '远端依据', value: model.rail.basisText },
    { key: '工作区改动', value: model.changes.stagedCount + ' 个已暂存 · ' + model.changes.unstagedCount + ' 个未暂存 · ' + model.changes.conflictCount + ' 个冲突' },
  ])

  const addForm = h('div', { class: 'inline-form' },
    h('label', { class: 'inline-field' },
      h('span', { class: 'inline-label', text: '新远端名字' }),
      h('input', { class: 'inline-input', attrs: { type: 'text', placeholder: '例如 upstream', value: state.draft }, dataset: { field: 'page-query' } })),
    actionButton('添加远端', 'page-form-submit', { kind: 'primary', focusKey: 'remote-add', dataset: { kind: 'remote-add' } }))

  const body = h('div', { class: 'page-stack' },
    section('远端清单', capturedRemotes.length + ' 个', '名字、抓取地址、推送地址分开写：三者的用途不一样，合成一句会让「推到哪里」看不出来。', [...remoteRows, addForm]),
    section('同步', null, '三颗同步按钮沿用顶部同步带的判定：禁用的原因写在按钮 title 里，拉取与推送的结果出现在顶部同步带，不会跑到页面底部。', [syncFacts, syncButtons]),
    section('远端依据', null, '「远端依据」不再是只读的时间事实，它本身是打开这一页的入口之一；这一页解释了数字来自哪一次读取。', [
      h('p', { class: 'page-note' }, h('span', { text: '顶部同步带写「远端依据 origin · 12 分钟前」，点它就是打开本页。数字与时间来自同一次读取；读取失败时写「读不到」，不写 0。' })),
    ]),
    capabilitiesSection('remote', state))
  return pageShell('remote', PAGE_META.remote.title, PAGE_META.remote.lede, null, body)
}

// ---------------------------------------------------------------------------
// 子模块
// ---------------------------------------------------------------------------

export function renderSubmodules(ctx: PageContext): HTMLElement {
  const { state } = ctx
  const names = submoduleNames()
  const rows: HTMLElement[] = names.map((name) => objectRow([
    h('span', { class: 'obj-title mono', text: name }),
    h('span', { class: 'obj-sub', text: '子模块路径与当前指向的提交需要真实读取 .gitmodules 与索引；原型没有造。' }),
  ], [actionButton('更新', 'page-demo', { focusKey: 'sub-update-' + name, dataset: { note: '已更新子模块 ' + name + ' 到登记提交（原型模拟）。' } })]))

  const installForm = h('div', { class: 'inline-form' },
    h('label', { class: 'inline-field' },
      h('span', { class: 'inline-label', text: '子模块地址' }),
      h('input', { class: 'inline-input', attrs: { type: 'text', placeholder: 'https://… 或 ../仓库路径', value: state.draft }, dataset: { field: 'page-query' } })),
    actionButton('添加子模块', 'page-form-submit', { kind: 'primary', focusKey: 'sub-add', dataset: { kind: 'sub-add' } }))

  const empty = h('div', { class: 'empty-block' },
    emptyState('这个仓库没有子模块', '.gitmodules 不存在；空态也要能评审，所以这里照实画，不拿演示行填满。'),
    installForm)

  const body = h('div', { class: 'page-stack' },
    section('子模块清单', names.length + ' 个', '每一行只回答三件事：路径、指向哪条提交、现在是不是登记的样子；批量动作收在能力清单里。', names.length === 0 ? [empty] : [...rows, installForm]),
    section('批量动作', null, '批量更新与批量执行会一次改动多个仓库；超过三个对象时用二级确认页逐条核对，不在行内弹确认卡。', [
      h('p', { class: 'page-note' }, h('span', { text: '真实实现里每个子模块是独立仓库：面板能发起批量命令并展示逐个子模块的结果，但不会替你解决子模块内部的分支冲突。' })),
    ]),
    capabilitiesSection('submodules', state))
  return pageShell('submodules', PAGE_META.submodules.title, PAGE_META.submodules.lede, null, body)
}

/** 标签的创建时间用与提交相同的时间说法：评审读起来不需要换算。 */
function whenText(nowMs: number, ms: number): string {
  const minutes = Math.max(0, Math.floor((nowMs - ms) / 60000))
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return minutes + ' 分钟前'
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return hours + ' 小时前'
  return Math.floor(hours / 24) + ' 天前'
}
