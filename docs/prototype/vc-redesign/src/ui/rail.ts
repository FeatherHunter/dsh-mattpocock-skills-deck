/**
 * ui/rail.ts —— 面板顶部的「同步带」，界面里唯一负责「我现在在哪、和远端什么关系、能做什么」的区域。
 *
 * 重构要点（每一条都对应设计稿里的一个问题）：
 *   ① 身份一行、同步事实一行、动作一行；原因行只在有原因时出现，不再常驻路径行；
 *   ② 「超前 2」「落后 0」是两个独立计数控件，不再用一个中点把它们粘成一句话；
 *   ③ 「读取于」「远端 origin」各自带小标签，两个时钟与远端名都不用再靠猜；
 *   ④ 拉取/更新/推送就在同步事实下面：它们改的正是上面那行数字；
 *   ⑤ 按钮禁用时，原因写在按钮下方，文案同时进 title 与 aria-describedby；
 *   ⑥ 右边那组入口（复制路径、交给 AI、命令面板、管理）放在身份行末端，固定不换行——
 *      齿轮不再被挤到第二行，点开的页面也直接从身份行下方开始（见 app.ts 的 pageOpen）。
 */
import type { RailModel } from '../domain/select'
import { COPY } from '../data/copy'
import type { ResultMessage } from '../domain/session'
import { icon, h } from './dom'
import { button, chip, resultBanner } from './primitives'

export interface RailViewOptions {
  /** 打开二级页时为真：同步事实、动作与页签都让位给页面，页面紧接在身份行下方。 */
  pageOpen?: boolean
  /** 当前页是否属于「管理」这一族（用齿轮打开九个分区里的任意一个）。 */
  manageActive?: boolean
}

export function renderRail(model: RailModel, result: ResultMessage | null, options: RailViewOptions = {}): HTMLElement {
  const pageOpen = options.pageOpen === true
  const rail = h('header', { class: 'rail' + (pageOpen ? ' is-page' : ''), attrs: { 'aria-label': '仓库状态' } })

  // ① 身份行：左边是「仓库 / 分支 / 短号」，右边是四个全局入口。
  // 两边各占一块、都不换行：分支名太长时由左边截断，入口不会被挤到下一行。
  const idRow = h('div', { class: 'rail-row rail-id' })
  const idMain = h('div', { class: 'rail-id-main' })
  idMain.append(h('span', { class: 'rail-repo mono', text: model.worktreeDisplay, title: model.worktreePath }))
  if (model.branch === null) {
    idMain.append(chip(COPY.rail.detached, 'warn', { small: true }))
  } else {
    // 分支名本身是入口：点开是分支列表，切换与合并都在那里，不再只是给眼睛看的文字。
    idMain.append(
      h('span', { class: 'rail-slash', text: '/', attrs: { 'aria-hidden': 'true' } }),
      h('button', {
        class: 'rail-branch-btn',
        attrs: {
          type: 'button',
          title: COPY.rail.branchHint,
          'aria-label': `当前分支 ${model.branch}。${COPY.rail.branchHint}`,
          'data-focus-key': 'branch-open',
        },
        dataset: { action: 'branch-open' },
      },
      h('span', { class: 'rail-branch mono', text: model.branch }),
      h('span', { class: 'rail-branch-chevron', attrs: { 'aria-hidden': 'true' } }, icon('chevron', 11))),
    )
  }
  if (model.oidShort !== null) {
    idMain.append(h('span', { class: 'rail-oid mono', text: model.oidShort, title: '当前提交的短号' }))
  }

  // 全局入口按「离开当前页面的程度」从左到右排：复制留在原地，交给 AI 打开浮层，
  // 放大镜打开命令面板，齿轮进入管理页。四颗都不随页面滚动，任何宽度都不隐藏。
  const tools = h('div', { class: 'rail-tools', attrs: { role: 'group', 'aria-label': '全局入口' } })
  tools.append(
    h('button', {
      class: 'icon-btn',
      attrs: { type: 'button', 'aria-label': COPY.rail.copyRepoPath, title: COPY.rail.copyRepoPath, 'data-focus-key': 'copy-repo' },
      dataset: { action: 'copy-repo' },
    }, icon('copy', 14)),
    h('button', {
      class: 'icon-btn',
      attrs: { type: 'button', 'aria-label': '把当前状态交给 AI', title: '交给 AI：把仓库状态、当前这一页和难处整理成一段可复制的交接说明', 'data-focus-key': 'handoff-general' },
      dataset: { action: 'handoff-open', kind: 'general' },
    }, icon('spark', 14)),
    h('button', {
      class: 'icon-btn',
      attrs: { type: 'button', 'aria-label': '命令面板：搜索全部 162 条能力', title: '命令面板（Ctrl/⌘+K）：按名称、编号或命令搜能力', 'data-focus-key': 'palette-open' },
      dataset: { action: 'palette-open' },
    }, icon('search', 14)),
    h('button', {
      class: 'icon-btn' + (options.manageActive === true ? ' is-on' : ''),
      attrs: {
        type: 'button',
        'aria-label': '打开管理：分支与远端、维护、诊断等九个分区',
        title: '管理（分支与远端、子模块、维护、迁移、配置、钩子、诊断、平台）',
        'data-focus-key': 'manage-open',
        'aria-current': options.manageActive === true ? 'page' : null,
      },
      dataset: { action: 'page-open', page: 'manage' },
    }, icon('settings', 14)),
  )
  idRow.append(idMain, tools)
  rail.append(idRow)

  // 打开二级页时同步带只留身份行：页面在它下面整块铺开，齿轮与页面之间不再隔着页签和路径。
  if (pageOpen) {
    if (result !== null) rail.append(resultBanner(result))
    return rail
  }

  // ② 同步事实行：计数控件 + 两个时间事实 + 重新读取。
  const syncRow = h('div', { class: 'rail-row rail-sync' })
  if (model.sync.kind === 'counts') {
    for (const item of model.syncChips) {
      const tone = item.value === 0 ? ' is-zero' : item.kind === 'ahead' ? ' is-ahead' : ' is-behind'
      syncRow.append(
        h(
          'span',
          {
            class: `sync-count${tone}`,
            attrs: { title: COPY.rail.syncHint(item.label, item.value), 'aria-label': COPY.rail.syncHint(item.label, item.value) },
          },
          h('span', { class: 'sync-label', text: item.label }),
          h('span', { class: 'sync-value', text: String(item.value) }),
        ),
      )
    }
  } else {
    syncRow.append(chip(model.sync.text, model.sync.tone === 'warn' ? 'warn' : 'muted', { small: true }))
  }
  syncRow.append(
    h('span', { class: 'fact' },
      h('span', { class: 'fact-k', text: '读取于' }),
      h('span', { class: 'fact-v', text: model.readAtText, attrs: { title: COPY.rail.readHint } })),
    // 「远端依据」改成入口，标签带上远端名：读者一眼能看出这个时间是跟哪个远端比的。
    h('button', {
      class: 'fact fact-btn',
      attrs: { type: 'button', 'data-focus-key': 'basis-open', title: COPY.rail.basisHint + '；点开查看远端清单与同步读数' },
      dataset: { action: 'page-open', page: 'remote' },
    },
    h('span', { class: 'fact-k', text: model.remoteName === null ? '远端依据' : `远端 ${model.remoteName}` }),
    h('span', { class: 'fact-v', text: model.basisText })),
  )
  syncRow.append(
    h('button', {
      class: `icon-text-btn${model.reloading ? ' is-busy' : ''}`,
      attrs: {
        type: 'button',
        'data-focus-key': 'reload',
        disabled: model.reloading || model.busy !== null,
        'aria-busy': model.reloading ? 'true' : null,
        title: `${COPY.rail.reload}（${COPY.rail.readAt(model.readAtText)}）`,
      },
      dataset: { action: 'reload' },
    }, icon('refresh', 13), h('span', { text: model.reloading ? COPY.rail.reloadBusy : COPY.rail.reload })),
  )

  // ③ 动作行：三颗按钮各绑自己的判定结果；禁用原因单独一行。
  const actRow = h('div', { class: 'rail-row rail-acts' })
  actRow.append(
    button({ label: model.pull.label, kind: 'secondary', size: 'sm', disabled: model.pull.disabled, busy: model.busy === 'pull', busyLabel: COPY.busy.pull, title: model.pull.reason, action: 'pull', focusKey: 'pull' }),
  )
  actRow.append(
    button({ label: model.fetch.label, kind: 'ghost', size: 'sm', disabled: model.fetch.disabled, busy: model.busy === 'fetch' || model.reloading, busyLabel: COPY.busy.fetch, title: model.fetch.reason, action: 'fetch', focusKey: 'fetch' }),
  )
  const pushButton = button({ label: model.push.label, kind: 'secondary', size: 'sm', disabled: model.push.disabled, busy: model.busy === 'push', busyLabel: COPY.busy.push, title: model.push.reason, action: 'push', focusKey: 'push' })
  // 推送是同步动作里当前最值得点的一颗，但实心主按钮只留给提交：
  // 用描边高亮标出建议项，避免同一屏出现两颗实心主按钮（旧页面被批过的点）。
  if (model.push.primary) pushButton.classList.add('is-suggested')
  actRow.append(pushButton)
  const nextChip = h('span', { class: `next-step next-${model.nextTone}`, attrs: { title: COPY.rail.nextHint } },
    h('span', { class: 'next-k', text: COPY.rail.next }),
    h('span', { class: 'next-v', text: model.next }))
  // 下一步贴着动作行右端：它说的是「这组动作应该先点哪个」，不是路径的附注。
  actRow.append(nextChip)

  // ④ 禁用/警告原因：只列有原因的动作，每行一个「动作：原因」。没有原因时这一块整行不出现。
  const reasons = h('div', { class: 'rail-reasons' })
  const rows: Array<[string, typeof model.pull]> = [
    [COPY.actions.pull, model.pull],
    [COPY.actions.push, model.push],
  ]
  for (const [label, action] of rows) {
    if (action.reason === null) continue
    reasons.append(h('div', { class: `reason${action.disabled ? ' is-block' : ' is-warn'}` },
      h('span', { class: 'reason-k', text: label }),
      h('span', { class: 'reason-v', text: action.reason })))
  }

  rail.append(syncRow, actRow)
  if (reasons.childElementCount > 0) rail.append(reasons)
  if (result !== null) rail.append(resultBanner(result))
  return rail
}

// 占位导出：让 TypeScript 允许本文件被单独引用时仍然有内容。
export const RAIL_SOURCE = 'docs/prototype/vc-redesign/src/ui/rail.ts'
