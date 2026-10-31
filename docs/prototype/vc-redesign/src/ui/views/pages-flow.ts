/**
 * ui/views/pages-flow.ts —— 四个整页流程：变基待办、冲突处置、长任务进度、全库搜索。
 *
 * 它们不是「管理的九个分区」，而是从各个入口点进来的一次性流程：变基从历史页的提交行进来，
 * 冲突从改动页的合并状态进来，长任务从克隆/归档进来，搜索从顶部的搜索入口进来。
 * 四个页面都演示「过程可见」：走到第几步、能取消、取消后留下什么，都在界面上写清楚。
 */
import { CAPABILITIES } from '../../data/capabilities.generated'
import type { Capability } from '../../data/capabilities.generated'
import { capturedBranch, capturedCommits, capturedHead, capturedLocalBranchNames, capturedTags } from '../../data/repo.generated'
import { PAGE_META } from '../../data/pages-copy'
import { h } from '../dom'
import { chip, note } from '../primitives'
import { actionButton, capabilitiesSection, factGrid, objectRow, pageShell, section } from './page-shell'
import type { PageContext } from './page-shell'

function capOf(id: string): Capability {
  const cap = CAPABILITIES.find((item) => item.id === id)
  if (cap === undefined) throw new Error('能力编号不存在：' + id)
  return cap
}

// ---------------------------------------------------------------------------
// 变基待办
// ---------------------------------------------------------------------------

interface RebaseStage {
  title: string
  detail: string
  command: string
  tone: 'ok' | 'warn' | 'muted'
}

const REBASE_STAGES: RebaseStage[] = [
  {
    title: '冻结工作区',
    detail: '先把未提交的改动储藏起来或提示先提交。变基过程中工作区必须是干净的，否则每一步的冲突都分不清来自谁。',
    command: 'git stash push --keep-index',
    tone: 'ok',
  },
  {
    title: '选新基座',
    detail: '新基座是一条已经存在的提交。选择时显示它与当前分支的共同祖先，让人看清要搬的是哪几条提交。',
    command: 'git rebase --onto <新基座> <旧基座>',
    tone: 'ok',
  },
  {
    title: '整理待办清单',
    detail: '三条提交可以保持原样，也可以压缩、改写说明或调整顺序。清单只在本页内存里，不写仓库。',
    command: 'git rebase -i <新基座>',
    tone: 'ok',
  },
  {
    title: '逐步应用',
    detail: '每应用一条提交就停一下：成功就继续，冲突就跳到「冲突处置」页。这一步可以随时中止并回到开始前的提交。',
    command: 'git rebase --continue / --abort',
    tone: 'warn',
  },
  {
    title: '校验结果',
    detail: '重新跑一遍本地检查，确认树内容与预期一致、没有丢提交。校验通过才允许移动分支指针。',
    command: 'git range-diff <旧分支> <新分支>',
    tone: 'ok',
  },
  {
    title: '完成或回滚',
    detail: '完成时只移动当前分支指针，其他分支不动。回滚用变基开始前记下的提交号，不依赖引用日志。',
    command: 'git reset --hard <开始前提交号>',
    tone: 'ok',
  },
]

export function renderRebase(ctx: PageContext): HTMLElement {
  const { state } = ctx
  const todo = capturedCommits.slice(0, 3)
  const intro = objectRow([
    h('span', { class: 'obj-title', text: '把当前分支的三条提交搬到新基座上（演示）' }),
    h('span', { class: 'obj-sub', text: '变基会重写这三条提交的提交号。演示只改页面状态，不动本地仓库。开始前先记下当前提交号，中止时用它回去。' }),
    h('span', { class: 'obj-meta mono', text: capturedBranch + ' @ ' + capturedHead.slice(0, 7) }),
  ], [actionButton(state.rebaseDemo ? '演示进行中' : '开始演示', 'rebase-demo', { kind: 'primary', focusKey: 'rebase-start', disabled: state.rebaseDemo })])

  const steps: HTMLElement[] = []
  const current = Math.min(state.rebaseStep, REBASE_STAGES.length)
  REBASE_STAGES.forEach((stage, index) => {
    const status = index < current ? '已完成' : index === current ? '进行中' : '待处理'
    const tone = index < current ? 'ok' : index === current ? 'warn' : 'muted'
    const row = objectRow([
      h('span', { class: 'obj-title' }, h('span', { class: 'mono', text: String(index + 1) }), h('span', { text: ' ' + stage.title })),
      h('span', { class: 'obj-sub', text: stage.detail }),
      h('span', { class: 'obj-meta mono', text: stage.command }),
    ], [chip(status, tone as 'ok' | 'warn' | 'muted', { small: true })])
    steps.push(row)
    if (index === current && index === 3) {
      steps.push(h('div', { class: 'inline-hint' },
        note('这一步可能出现冲突：去「冲突处置」页逐文件选边、标记已解决，再回来继续。', 'warn'),
        actionButton('去冲突处置页', 'page-open', { focusKey: 'rebase-to-conflicts', dataset: { page: 'conflicts' } })))
    }
  })

  const demoBody: HTMLElement[] = []
  if (!state.rebaseDemo) {
    demoBody.push(note('演示还没开始：点上面的「开始演示」进入六步待办。每一步都可以停在这里，不会影响仓库。', 'muted'))
  } else if (state.rebaseStep >= 6) {
    demoBody.push(h('div', { class: 'flow-done' },
      chip('演示完成', 'ok'),
      h('p', { text: '六步走完：三条提交已经换到新基座上（演示数据）。真实实现里这一步之后要重新跑本地检查，再决定是否推送。' }),
      actionButton('回到管理索引', 'page-open', { focusKey: 'rebase-done', dataset: { page: 'manage' } })))
  } else {
    demoBody.push(h('div', { class: 'flow-controls' },
      actionButton('下一步', 'rebase-step', { kind: 'primary', focusKey: 'rebase-next', dataset: {} }),
      actionButton('中止并回到开始前', 'rebase-abort', { kind: 'danger', focusKey: 'rebase-abort' })))
  }

  const body = h('div', { class: 'page-stack' },
    section('本次变基', null, null, [intro, ...demoBody]),
    section('六步待办', state.rebaseDemo ? '第 ' + Math.min(state.rebaseStep + 1, 6) + ' / 6 步' : null, '顺序固定，但每一步都可以停下来看。演示不会跳过「工作区是否干净」这一关。', steps),
    section('会动与不会动', null, null, [factGrid([
      { key: '会动', value: '当前分支的提交号与这页的演示状态' },
      { key: '不会动', value: '其他分支、远端、储藏记录' },
      { key: '可按撤销', value: '中止后分支回到开始前记下的提交号' },
      { key: '不可按撤销', value: '已经推送过的重写需要强制推送，属于服务端协作问题' },
    ])]),
    capabilitiesSection('rebase', state))
  return pageShell('rebase', PAGE_META.rebase.title, PAGE_META.rebase.lede, null, body, { danger: true })
}

// ---------------------------------------------------------------------------
// 冲突处置
// ---------------------------------------------------------------------------

const CONFLICT_FILES = [
  'src/ui/views/history.ts',
  'src/ui/views/branches.ts',
  'styles/app.css',
]

export function renderConflicts(ctx: PageContext): HTMLElement {
  const { state } = ctx
  const resolved = CONFLICT_FILES.filter((path) => state.conflictResolved.includes(path))
  const intro = objectRow([
    h('span', { class: 'obj-title', text: '合并 ' + capturedBranch + ' 与 feature/version-control-redesign（演示）' }),
    h('span', { class: 'obj-sub', text: '三个文件同时被两边改过：逐文件选当前分支、对方，或打开外部编辑器手改。全部标记解决后才能继续。' }),
    h('span', { class: 'obj-meta mono', text: 'git merge --no-ff feature/version-control-redesign' }),
  ], [actionButton(state.conflictDemo ? '演示进行中' : '开始演示', 'conflict-demo', { kind: 'primary', focusKey: 'conflict-start', disabled: state.conflictDemo })])

  const rows: HTMLElement[] = []
  for (const path of CONFLICT_FILES) {
    const isResolved = state.conflictResolved.includes(path)
    const chosen = state.conflictChoice
    const side: HTMLElement[] = []
    if (isResolved) {
      side.push(chip('已解决', 'ok', { small: true }), actionButton('撤销标记', 'conflict-resolve', { focusKey: 'conflict-undo:' + path, dataset: { path } }))
    } else {
      side.push(
        actionButton('选当前分支', 'conflict-choice', { kind: chosen === 'ours' ? 'primary' : 'secondary', focusKey: 'conflict-ours:' + path, dataset: { choice: 'ours' } }),
        actionButton('选对方', 'conflict-choice', { kind: chosen === 'theirs' ? 'primary' : 'secondary', focusKey: 'conflict-theirs:' + path, dataset: { choice: 'theirs' } }),
        actionButton('打开外部编辑器', 'page-demo', { focusKey: 'conflict-edit:' + path, dataset: { note: '已把 ' + path + ' 交给外部编辑器（原型模拟）。手改之后回来点「标记已解决」。' } }),
        actionButton('标记已解决', 'conflict-resolve', { kind: 'primary', focusKey: 'conflict-resolve:' + path, dataset: { path }, disabled: chosen === null }),
      )
    }
    rows.push(objectRow([
      h('span', { class: 'obj-title' }, h('span', { class: 'mono', text: path }), chosen === null ? null : chip('已选：' + (chosen === 'ours' ? '当前分支' : '对方'), 'info', { small: true })),
      h('span', { class: 'obj-sub', text: isResolved ? '这个文件已标记解决。继续之前仍可以撤销标记再选一次。' : '两边都改过同一段。选边只影响这个文件，不影响其他冲突文件。' }),
    ], side))
  }

  const summary = objectRow([
    h('span', { class: 'obj-title', text: '已解决 ' + resolved.length + ' / ' + CONFLICT_FILES.length + ' 个文件' }),
    h('span', { class: 'obj-sub', text: '全部解决后「继续合并」才可点。继续会生成一个合并提交，中止会回到合并开始前的状态。' }),
  ], [
    actionButton('继续合并', 'page-demo', { kind: 'primary', focusKey: 'conflict-continue', dataset: { note: '合并已提交（原型模拟）：生成一个合并提交，工作区清空。' }, disabled: resolved.length !== CONFLICT_FILES.length }),
    actionButton('中止合并', 'conflict-abort', { kind: 'danger', focusKey: 'conflict-abort' }),
  ])

  const body = h('div', { class: 'page-stack' },
    section('本次合并', null, null, [intro]),
    section('冲突文件', CONFLICT_FILES.length + ' 个文件', '每一行只做三件事：选边、手改、标记已解决。选边按钮的状态跟着本页内存走，不写仓库。', [...(state.conflictDemo ? rows : [note('演示还没开始：点「开始演示」才会出现三个冲突文件。', 'muted')]), ...(state.conflictDemo ? [summary] : [])]),
    section('会动与不会动', null, null, [factGrid([
      { key: '会动', value: state.conflictDemo ? '三个冲突文件的解决标记与本页结果' : '当前什么都不会动' },
      { key: '不会动', value: '工作区文件、「已暂存」的清单、已有提交' },
      { key: '恢复路径', value: '中止合并回到开始前的提交与工作区' },
      { key: '外部编辑器', value: '面板不内嵌编辑器，只把文件交给它' },
    ])]),
    capabilitiesSection('conflicts', state))
  return pageShell('conflicts', PAGE_META.conflicts.title, PAGE_META.conflicts.lede, null, body, { danger: true })
}

// ---------------------------------------------------------------------------
// 长任务进度
// ---------------------------------------------------------------------------

interface TaskStage {
  title: string
  detail: string
  at: number
}

const TASK_STAGES: TaskStage[] = [
  { title: '准备目标目录', detail: '检查目录是否为空、磁盘空间够不够。克隆会先写一个临时目录，成功后再改名。', at: 0 },
  { title: '接收对象', detail: '按对象数量与体积显示进度。网络中断时可以从已收到的部分继续，不需要从头再来。', at: 20 },
  { title: '检出文件', detail: '把当前分支的文件写到目标目录。这一步受磁盘速度影响最大。', at: 85 },
  { title: '完成校验', detail: '核对 HEAD 与远端一致、文件数量与权限正确。校验通过才把临时目录改名为正式目录。', at: 100 },
]

export function renderTask(ctx: PageContext): HTMLElement {
  const { state } = ctx
  const modes = [
    { key: 'clone', title: '克隆仓库', detail: '从一个远端地址拉一份完整历史到本机目录。', command: 'git clone <地址> <目录>' },
    { key: 'archive', title: '导出归档', detail: '只导出某条提交的文件快照，不含历史。产出是一个压缩包。', command: 'git archive -o <文件> <提交>' },
    { key: 'bundle', title: '生成离线包', detail: '把完整历史打进一个文件，没有网络时也能克隆回来。', command: 'git bundle create <文件> --all' },
  ]
  const chooser = modes.map((mode) => objectRow([
    h('span', { class: 'obj-title', text: mode.title }),
    h('span', { class: 'obj-sub', text: mode.detail }),
    h('span', { class: 'obj-meta mono', text: mode.command }),
  ], [actionButton('打开向导', 'task-demo', { kind: 'primary', focusKey: 'task-start-' + mode.key, dataset: {} })]))

  const progress = state.taskDemo ? state.taskProgress : 0
  const currentStage = TASK_STAGES.findIndex((stage) => progress < stage.at)
  const activeStage = currentStage === -1 ? TASK_STAGES.length - 1 : Math.max(0, currentStage - 1)
  const stageRows = TASK_STAGES.map((stage, index) => objectRow([
    h('span', { class: 'obj-title', text: stage.title }),
    h('span', { class: 'obj-sub', text: stage.detail }),
  ], [chip(progress >= stage.at ? '已完成' : index === activeStage ? '进行中' : '等待', progress >= stage.at ? 'ok' : index === activeStage ? 'warn' : 'muted', { small: true })]))

  const meter = h('div', { class: 'task-meter' },
    h('div', { class: 'task-meter-bar', attrs: { style: 'width: ' + progress + '%' } }),
    h('span', { class: 'task-meter-label mono', text: progress + '%' }))

  const controls = state.taskDemo
    ? h('div', { class: 'flow-controls' },
      actionButton('推进进度', 'task-tick', { kind: 'primary', focusKey: 'task-tick', dataset: {}, disabled: progress >= 100 }),
      actionButton('取消任务', 'page-demo', { kind: 'danger', focusKey: 'task-cancel', dataset: { note: '任务已取消（原型模拟）：已写入的临时文件列在结果里，可以一键清除，不会留下半个仓库。' } }))
    : note('演示还没开始：选一种任务打开向导，进度条会从 62% 继续走到 100%。', 'muted')

  const done = state.taskDemo && progress >= 100
    ? h('div', { class: 'flow-done' },
      chip('任务完成', 'ok'),
      h('p', { text: '任务走完了四步（演示数据）。真实实现里这里给出目标目录、对象数量、检出文件数与耗时。' }),
      actionButton('回到管理索引', 'page-open', { focusKey: 'task-done', dataset: { page: 'manage' } }))
    : null

  const body = h('div', { class: 'page-stack' },
    section('选一种长任务', '3 种', '三种任务共用同一个进度页：都会先把目标写清楚，再开始。取消后必须能说清留下了什么。', chooser),
    section('进度', state.taskDemo ? progress + '%' : null, '进度来自 git 的输出（真实实现里是 --progress 的读数），不是假动画。', [meter, ...stageRows, ...(state.taskDemo ? [controls] : [controls]), ...(done === null ? [] : [done])]),
    section('取消之后', null, null, [note('取消长任务不留半个仓库：写进临时目录的内容要么清除掉，要么原样列出让人自己删。目标目录里已有的文件一律不动。', 'muted')]),
    capabilitiesSection('task', state))
  return pageShell('task', PAGE_META.task.title, PAGE_META.task.lede, null, body)
}

// ---------------------------------------------------------------------------
// 全库搜索
// ---------------------------------------------------------------------------

interface SearchHit {
  kind: 'commit' | 'branch' | 'tag' | 'cap'
  title: string
  sub: string
  meta: string
  action: string
  dataset: Record<string, string>
}

export function renderSearch(ctx: PageContext): HTMLElement {
  const { state } = ctx
  const query = state.query.trim()
  const lower = query.toLocaleLowerCase()
  const filters = [
    { key: 'all', label: '全部' },
    { key: 'commit', label: '提交' },
    { key: 'branch', label: '分支' },
    { key: 'tag', label: '标签' },
    { key: 'cap', label: '能力' },
  ]
  const filterRow = h('div', { class: 'filter-row' }, ...filters.map((item) => actionButton(item.label, 'page-filter', { kind: state.filter === item.key ? 'primary' : 'ghost', focusKey: 'search-filter-' + item.key, dataset: { filter: item.key } })))

  const input = h('input', {
    class: 'search-input',
    attrs: { type: 'text', value: state.query, placeholder: '搜提交主题、分支名、标签名或能力名', 'data-field': 'page-query', 'data-focus-key': 'search-input', autocomplete: 'off' },
  })

  const hits: SearchHit[] = []
  if (lower !== '') {
    for (const commit of capturedCommits) {
      if (commit.subject.toLocaleLowerCase().includes(lower) || commit.short.includes(lower) || commit.author.toLocaleLowerCase().includes(lower)) {
        hits.push({ kind: 'commit', title: commit.subject, sub: commit.author + ' · ' + new Date(commit.authorDateMs).toLocaleString('zh-CN'), meta: commit.short, action: 'search-jump', dataset: { kind: 'commit', oid: commit.oid } })
      }
    }
    for (const name of capturedLocalBranchNames) {
      if (name.toLocaleLowerCase().includes(lower)) hits.push({ kind: 'branch', title: name, sub: '本地分支', meta: '分支', action: 'search-jump', dataset: { kind: 'branch', name } })
    }
    for (const tag of capturedTags) {
      if (tag.name.toLocaleLowerCase().includes(lower)) hits.push({ kind: 'tag', title: tag.name, sub: '标签 · 指向 ' + tag.shortOid, meta: tag.shortOid, action: 'search-jump', dataset: { kind: 'tag', name: tag.name } })
    }
    for (const cap of CAPABILITIES) {
      if (cap.name.toLocaleLowerCase().includes(lower) || cap.command.toLocaleLowerCase().includes(lower) || cap.entry.toLocaleLowerCase().includes(lower)) {
        hits.push({ kind: 'cap', title: cap.id + ' ' + cap.name, sub: cap.entry, meta: cap.level + ' · ' + cap.placement, action: 'search-jump', dataset: { kind: 'cap', id: cap.id } })
      }
    }
  }
  const visible = hits.filter((hit) => state.filter === 'all' || hit.kind === state.filter)
  const hitRows = visible.slice(0, 40).map((hit) => objectRow([
    h('span', { class: 'obj-title' }, chip(hit.kind === 'commit' ? '提交' : hit.kind === 'branch' ? '分支' : hit.kind === 'tag' ? '标签' : '能力', 'info', { small: true }), h('span', { text: hit.title })),
    h('span', { class: 'obj-sub', text: hit.sub }),
    h('span', { class: 'obj-meta mono', text: hit.meta }),
  ], [actionButton('打开', hit.action, { focusKey: 'search-hit:' + hit.meta + ':' + hit.title.slice(0, 12), dataset: hit.dataset })]))

  const counts = h('p', { class: 'search-counts' },
    chip('提交 ' + hits.filter((hit) => hit.kind === 'commit').length, 'muted', { small: true }),
    chip('分支 ' + hits.filter((hit) => hit.kind === 'branch').length, 'muted', { small: true }),
    chip('标签 ' + hits.filter((hit) => hit.kind === 'tag').length, 'muted', { small: true }),
    chip('能力 ' + hits.filter((hit) => hit.kind === 'cap').length, 'muted', { small: true }))

  const body = h('div', { class: 'page-stack' },
    section('搜索', null, '搜索范围是本页顶部的采集数据：50 条提交、' + capturedLocalBranchNames.length + ' 条本地分支、' + capturedTags.length + ' 个标签，加上 162 条能力的名称、命令与入口。文件内容搜索是一条只读能力（13.3），这里只展示它读到的形状。', [input, filterRow, counts, ...(lower === '' ? [note('输入关键字开始搜索。例如输入 CSS 会命中样式相关提交，输入 remote 会命中远端能力。', 'muted')] : visible.length === 0 ? [note('没有命中：换一个更短的关键字，或切换上面的类别。', 'muted')] : hitRows)]),
    capabilitiesSection('search', state))
  return pageShell('search', PAGE_META.search.title, PAGE_META.search.lede, null, body)
}
