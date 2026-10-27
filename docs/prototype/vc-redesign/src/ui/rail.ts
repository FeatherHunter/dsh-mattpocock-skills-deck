/**
 * ui/rail.ts —— 面板顶部的「同步带」，界面里唯一负责「我现在在哪、和远端什么关系、能做什么」的区域。
 *
 * 重构要点（每一条都对应设计稿里的一个问题）：
 *   ① 一行只放一件事：身份一行、同步事实一行、动作一行、路径与下一步一行；
 *   ② 「超前 2」「落后 0」是两个独立计数控件，不再用一个中点把它们粘成一句话；
 *   ③ 「读取于」「远端依据」各自带小标签，两个时钟的差别不用再靠猜；
 *   ④ 拉取/更新/推送就在同步事实下面：它们改的正是上面那行数字；
 *   ⑤ 按钮禁用时，原因写在按钮下方，文案同时进 title 与 aria-describedby。
 */
import type { RailModel } from '../domain/select'
import { COPY } from '../data/copy'
import type { ResultMessage } from '../domain/session'
import { icon, h } from './dom'
import { button, chip, resultBanner } from './primitives'

export function renderRail(model: RailModel, result: ResultMessage | null): HTMLElement {
  const rail = h('header', { class: 'rail', attrs: { 'aria-label': '仓库状态' } })

  // ① 身份行：仓库名、分支、短提交号、复制路径各占一个控件。
  const idRow = h('div', { class: 'rail-row rail-id' })
  idRow.append(h('span', { class: 'rail-repo mono', text: model.worktreeDisplay, title: model.worktreePath }))
  if (model.branch === null) {
    idRow.append(chip(COPY.rail.detached, 'warn', { small: true }))
  } else {
    idRow.append(
      h('span', { class: 'rail-slash', text: '/', attrs: { 'aria-hidden': 'true' } }),
      h('span', { class: 'rail-branch', attrs: { title: `分支 ${model.branch}` } }, h('span', { class: 'mono', text: model.branch })),
    )
  }
  if (model.oidShort !== null) {
    idRow.append(h('span', { class: 'rail-oid mono', text: model.oidShort, title: '当前提交的短号' }))
  }
  idRow.append(
    h('button', {
      class: 'icon-btn',
      attrs: { type: 'button', 'aria-label': COPY.rail.copyRepoPath, title: COPY.rail.copyRepoPath, 'data-focus-key': 'copy-repo' },
      dataset: { action: 'copy-repo' },
    }, icon('copy', 14)),
  )

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
    h('span', { class: 'fact' },
      h('span', { class: 'fact-k', text: '远端依据' }),
      h('span', { class: 'fact-v', text: model.basisText, attrs: { title: COPY.rail.basisHint } })),
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

  // ④ 底部信息行：完整工作树路径。窄宽度下允许换行，不截断末段目录名。
  const pathRow = h('div', { class: 'rail-row rail-path' },
    h('span', { class: 'rail-path-label', text: '工作树路径' }),
    h('span', { class: 'rail-path-value mono', text: model.worktreePath }))

  // 禁用/警告原因：只列有原因的动作，每行一个「动作：原因」。
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

  rail.append(idRow, syncRow, actRow, reasons, pathRow)
  if (result !== null) rail.append(resultBanner(result))
  return rail
}

// 占位导出：让 TypeScript 允许本文件被单独引用时仍然有内容。
export const RAIL_SOURCE = 'docs/prototype/vc-redesign/src/ui/rail.ts'
