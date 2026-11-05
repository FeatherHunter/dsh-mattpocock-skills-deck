// views/versionControl/vcChangesRow.ts —— 改动页的一行：徽章、路径、暂存按钮、行菜单、贴行确认卡、改名表单与展开的逐块差异
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼回闭包，跨叶用 declare。
//
// 为什么从 vcChangesView 拆出来：一行要装的东西已经超过那个文件剩下的行数——逐块差异的块头与按钮、
// 三个行级动作（删除已跟踪 / 停止跟踪 / 重命名）的菜单与贴行确认、改名表单，再加上原来的菜单与确认卡。
// 拆成独立一叶之后，页面那一叶只负责统计卡、分组与结果条，一行里的东西只在这一处画。
//
// 就近是硬规则：菜单贴着「⋯」下方出现，确认卡与改名表单贴着触发它的那一行出现，结果不跳页尾。
// 可见文字全部走 t(词条)，这一叶不写中文字面量。

declare function vcChangesOpMetaOf(op: any): any
declare function vcChangesTargetOf(op: any, values: any, t: any): string
declare function vcChangesRowKeyOf(op: any, payload: any): string
declare function vcChangesSideKeyOf(side: any, path: any): string
declare function vcChangesSideSplitOf(lines: any, side: any): any
declare function vcChangesMergedHunksOf(stagedLines: any, unstagedLines: any): any[]
declare function vcChangesHunkProgressOf(hunks: any): any
// 差异行种类 → 原型类名：与 vcHistoryDetail 共用同一份映射（那里已经定义，闭包里不许再声明一次）。
declare const VC_DIFF_LINE_CLASS: Record<string, string>
// 贴在触发行下面的两块：确认卡与改名表单住在 vcChangesAct 一叶（本文件已经贴着 350 有效行上限）。
declare function vcChangesConfirmNodeOf(h: any, t: any, o: any): any
declare function vcChangesRenameFormOf(h: any, t: any, o: any): any

/** 六种文件变化各自的字母与色号；进程内只有这一份映射。 */
export const VC_CHANGES_FILE_LETTERS: Record<string, string> = {
  added: 'A', modified: 'M', deleted: 'D', renamed: 'R', typechange: 'T', untracked: '?',
}
const VC_CHANGES_FILE_TONES: Record<string, string> = {
  added: 'add', modified: 'mod', deleted: 'del', renamed: 'rename', typechange: 'type', untracked: 'untracked',
}
const vcChangesFileToneOf = function (change: any): string {
  return VC_CHANGES_FILE_TONES[String(change || 'modified')] || 'mod'
}
const vcChangesFileLabelKeyOf = function (change: any): string { return 'vc.changes.view.' + String(change || 'modified') }
const vcChangesRowStateKeyOf = function (row: any): string {
  if (row && row.conflict === true) return 'conflict'
  if (row && row.staged === true) return 'staged'
  return 'unstaged'
}

// 图标只这三颗：行尾箭头、禁用原因前的小感叹号、交给 AI 前的四角星（与原型 dom.ts 的路径逐字相同）。
const VC_CHANGES_ICON_PATHS: Record<string, string> = {
  chevron: 'M6 9l6 6 6-6',
  alert: 'M12 4l9 16H3zM12 10v4M12 17v.5',
  spark: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM18.5 16l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z',
}
const vcChangesIconOf = function (h: any, kind: string, size: number): any {
  return h('svg', {
    key: 'icon-' + kind, viewBox: '0 0 24 24', width: size, height: size, fill: 'none',
    stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true',
  }, h('path', { d: VC_CHANGES_ICON_PATHS[kind] || VC_CHANGES_ICON_PATHS.chevron }))
}

// 每一种行级动作的文案：[按钮与菜单里的名字, data-log 事件名]。动作名仍是协议里的那一个，
// 界面不另造动作；菜单只决定「这一行能发哪几个」。
const VC_CHANGES_ROW_ACTS: any = {
  'stage-file': ['vc.changes.view.stage', 'vc.changes.file.stage'],
  unstage: ['vc.changes.view.unstage', 'vc.changes.file.unstage'],
  'discard-file': ['vc.changes.view.menuDiscard', 'vc.changes.file.discard'],
  mv: ['vc.changes.view.menuRename', 'vc.changes.file.rename'],
  'rm-cached': ['vc.changes.view.menuUntrack', 'vc.changes.file.untrack'],
  'rm-tracked': ['vc.changes.view.menuDeleteTracked', 'vc.changes.file.delete-tracked'],
  ignore: ['vc.changes.view.menuIgnore', 'vc.changes.file.ignore'],
  'clean-untracked': ['vc.changes.view.menuDelete', 'vc.changes.file.clean'],
}
/** 菜单里每一条的顺序与它是不是危险动作（危险动作在菜单里用危险色写）。 */
const VC_CHANGES_MENU_ORDER: string[] = ['discard-file', 'mv', 'rm-cached', 'rm-tracked', 'ignore', 'clean-untracked']
const VC_CHANGES_MENU_DANGER: any = { 'discard-file': true, 'rm-tracked': true, 'clean-untracked': true }
/** 每个界面入口对应能力账本里的哪一条：#1902 这四条（1.2 / 1.9 / 1.10 / 1.11）在真机上第一次有了可点入口，
 *  带上这一位，管理索引与命令面板仍按账本各认一个主入口，页面这一侧只标「这个控件是那条能力的入口」。 */
const VC_CHANGES_ROW_CAP: any = {
  'stage-hunks': '1.2', 'stage-file': '1.3', unstage: '1.5', 'discard-file': '1.6',
  mv: '1.11', 'rm-cached': '1.10', 'rm-tracked': '1.9', ignore: '1.12', 'clean-untracked': '1.8',
}
const vcChangesCapAttrOf = function (op: string): any {
  const cap: string = String(VC_CHANGES_ROW_CAP[op] || '')
  return cap === '' ? {} : { 'data-cap-control': cap }
}

const vcChangesRowPrimaryOpOf = function (row: any): string {
  return row && row.staged === true ? 'unstage' : 'stage-file'
}
/**
 * 这一行能发哪些行级动作。菜单只列真做得到的：
 *   已暂存的行只有「取消暂存」（整份文件）；冲突行先解决冲突；
 *   未跟踪文件是「加入 .gitignore / 删除未跟踪文件」；
 *   已跟踪的未暂存文件是「丢弃改动 / 重命名或移动 / 停止跟踪，保留文件 / 删除已跟踪的文件」。
 * 三个新动作只给已跟踪的文件：未跟踪的文件没有「停止跟踪」可言，改名也由宿主预检按索引条目判。
 */
const vcChangesRowMenuOpsOf = function (row: any): string[] {
  if (!row || row.conflict === true || row.staged === true) return []
  const untracked = row.untracked === true || String(row.change || '') === 'untracked'
  if (untracked) return ['ignore', 'clean-untracked']
  return ['discard-file', 'mv', 'rm-cached', 'rm-tracked']
}
const vcChangesRowStateOf = function (rows: any, op: string, path: string): any {
  return (rows && rows[vcChangesRowKeyOf(op, { path: path })]) || {}
}

/** 一块的按钮与它自己的状态：已进索引的块压暗、按钮换成「取消暂存这一块」；其余是「暂存这一块」。 */
const vcChangesHunkNodeOf = function (h: any, t: any, o: any): any {
  const hunk: any = o.hunk || {}
  const staged: boolean = hunk.side === 'staged'
  const label: string = t(staged ? 'vc.changes.view.hunkUnstage' : 'vc.changes.view.hunkStage')
  const act: string = staged ? 'unstage' : 'stage'
  return h('div', {
    key: 'hunk-' + String(hunk.order), className: 'hunk' + (staged ? ' is-staged' : ''),
    'data-vc-hunk': String(hunk.order), 'data-vc-hunk-side': String(hunk.side), 'data-vc-hunk-index': String(hunk.hunkIndex),
  }, [
    h('div', { key: 'bar', className: 'hunk-bar' }, [
      h('span', { key: 'name', className: 'hunk-name', 'data-vc-hunk-name': String(hunk.order) }, t('vc.changes.view.hunkTitle', { n: String(hunk.order) })),
      staged ? h('span', { key: 'chip', className: 'chip chip-sm chip-ok', 'data-vc-hunk-staged': '1' }, t('vc.changes.view.hunkStaged')) : null,
      h('span', { key: 'gap', className: 'hunk-gap' }),
      h('button', {
        key: 'act', type: 'button', className: 'row-act hunk-act', 'data-vc-hunk-act': act,
        'data-cap-control': '1.2',
        'data-vc-hunk-path': String(o.path || ''), disabled: o.busy === true,
        title: t('vc.changes.view.hunkActionTitle', { act: label, total: String(o.total === undefined ? '' : o.total) }),
        'data-press': 'button', 'data-log': 'vc.changes.hunk.' + act,
        onClick: function () { if (typeof o.onHunk === 'function') o.onHunk(String(o.path || ''), Number(hunk.hunkIndex) || 0, staged, Number(hunk.order) || 0) },
      }, label),
    ]),
    h('pre', { key: 'lines', className: 'patch', 'data-vc-hunk-lines': String(hunk.order) }, hunk.lines.map(function (line: any, i: number) {
      const kind: string = String(line.kind || 'context')
      return h('span', {
        key: 'l' + i, className: 'diff-line ' + (VC_DIFF_LINE_CLASS[kind] || 'diff-ctx'), 'data-vc-diff-line': kind,
      }, String(line.text === undefined || line.text === null ? '' : line.text) + '\n')
    })),
  ])
}
/**
 * 展开的差异块。五种「没有补丁」的情形各说各的（正在读 / 读失败带重试 / 二进制 / 未跟踪 / 没有基线），
 * 读到之后按「文件头 + 逐块」画：每一块的块头单独一行，左边第几块、右边这一块自己的按钮。
 */
const vcChangesHunksNodeOf = function (h: any, t: any, o: any): any {
  const path: string = String(o.path || '')
  const row: any = o.row || {}
  const diffs: any = o.diffs || {}
  const primary: any = row.staged === true ? diffs[vcChangesSideKeyOf('staged', path)] : diffs[vcChangesSideKeyOf('unstaged', path)]
  const stagedRead: any = diffs[vcChangesSideKeyOf('staged', path)]
  const kids: any[] = []
  const note = function (key: string, attr: string, text: string): void {
    const attrs: any = { key: key, className: 'note file-detail-note' }
    if (attr !== '') attrs[attr] = '1'
    kids.push(h('p', attrs, text))
  }
  const state: string = primary ? String(primary.state || 'idle') : 'idle'
  const reason: string = primary ? String(primary.reason || '') : ''
  // 部分暂存的行要两侧都读到才画得全：另一侧还在读时先说一句「正在读」，免得先把半份补丁画出来。
  const waitingOther: boolean = row.partial === true && !!stagedRead && String(stagedRead.state || '') === 'loading'
  if (!primary || state === 'idle' || state === 'loading' || waitingOther) {
    note('loading', 'data-vc-changes-diff-state', t('vc.shell.history.diffLoading'))
  } else if (state === 'err') {
    note('err', 'data-vc-changes-diff-error', t('vc.shell.history.diffError'))
    kids.push(h('button', {
      key: 'retry', type: 'button', className: 'vcs-hist-diff-retry', 'data-vc-changes-diff-retry': path,
      'data-press': 'button', 'data-log': 'vc.changes.diff-retry',
      onClick: function () { if (typeof o.onRetry === 'function') o.onRetry() },
    }, t('vc.shell.history.diffRetry')))
  } else if (reason === 'binary-diff') {
    note('binary', 'data-vc-changes-diff-binary', t('vc.shell.history.diffBinary'))
  } else if (reason === 'untracked-no-diff') {
    note('untracked', 'data-vc-changes-diff-untracked', t('vc.changes.view.diffUntracked'))
  } else if (reason === 'no-commit-baseline') {
    note('baseline', 'data-vc-changes-diff-baseline', t('vc.changes.view.diffNoBaseline'))
  } else {
    if (primary.truncated === true) note('trunc', 'data-vc-changes-diff-truncated', t('vc.shell.history.diffTruncated'))
    const stagedLines: any = stagedRead && String(stagedRead.state || '') === 'ok' ? stagedRead.lines : []
    const unstagedLines: any = row.staged === true ? [] : (primary.lines || [])
    const merged: any[] = vcChangesMergedHunksOf(stagedLines, unstagedLines)
    const head: any[] = vcChangesSideSplitOf(stagedLines, 'staged').head.length > 0
      ? vcChangesSideSplitOf(stagedLines, 'staged').head
      : vcChangesSideSplitOf(unstagedLines, 'unstaged').head
    const primaryLines: any[] = Array.isArray(primary.lines) ? primary.lines : []
    if (merged.length === 0 && primaryLines.length > 0) {
      // 差异里没有 @@ 头（宿主只回了逐行内容，或者这份补丁本来就不成块）：照原样画出来。
      //   把已经读到的内容说成「没有差异」是这几种里最糟的一种，宁可画一段没有块头的差异。
      kids.push(h('pre', { key: 'raw', className: 'patch', 'data-vc-changes-diff-raw': '1' }, primaryLines.map(function (line: any, i: number) {
        const kind: string = String(line.kind || 'context')
        return h('span', { key: 'l' + i, className: 'diff-line ' + (VC_DIFF_LINE_CLASS[kind] || 'diff-ctx'), 'data-vc-diff-line': kind }, String(line.text === undefined || line.text === null ? '' : line.text) + '\n')
      })))
    } else if (merged.length === 0) {
      note('none', 'data-vc-changes-diff-none', t('vc.shell.history.diffNoDiff'))
    } else {
      const blocks: any[] = []
      if (head.length > 0) {
        blocks.push(h('pre', { key: 'head', className: 'patch', 'data-vc-hunk-head': '1' }, head.map(function (line: any, i: number) {
          const kind: string = String(line.kind || 'filehead')
          return h('span', { key: 'l' + i, className: 'diff-line ' + (VC_DIFF_LINE_CLASS[kind] || 'diff-head'), 'data-vc-diff-line': kind }, String(line.text || '') + '\n')
        })))
      }
      const busy: boolean = o.busy === true
      merged.forEach(function (hunk: any) {
        blocks.push(vcChangesHunkNodeOf(h, t, { hunk: hunk, path: path, busy: busy, total: merged.length, onHunk: o.onHunk }))
      })
      kids.push(h('div', { key: 'hunks', className: 'hunked', 'data-vc-hunks': String(merged.length) }, blocks))
      kids.push(h('div', { key: 'note', className: 'file-detail-note', 'data-vc-hunk-note': '1' }, t('vc.changes.view.hunkNote')))
    }
  }
  return h('div', { key: 'diff', className: 'file-detail', 'data-vc-file-diff': path, 'data-vc-changes-diff': path }, kids)
}

/**
 * 一行文件：徽章 + 路径 + 变化词条 + 增删行数 + 主按钮 + 「⋯」；菜单、确认卡、改名表单、展开块都挂在 wrap 里。
 * 行主体就是「展开 / 收起」：点整行，或用键盘回车 / 空格；读差异由容器那一层发（界面不自己拼电话）。
 */
export const vcChangesFileRowNode = function (h: any, t: any, row: any, ctx: any): any {
  const path = String(row.path || '')
  const change = String(row.change || 'modified')
  const rows: any = ctx.rows || {}
  const diffs: any = ctx.diffs || {}
  const handlers: any = ctx.handlers || {}
  const values: any = ctx.values || {}
  const onValue = function (field: string, value: any) { if (typeof handlers.onValue === 'function') handlers.onValue(field, value) }
  // 展开状态按「分组 + 路径」记：同一个文件被暂存之后换了一组、补丁也换了一份，仍按裸路径记会继续显示上一组读到的补丁。
  const openKey = vcChangesSideKeyOf(row.staged === true ? 'staged' : 'unstaged', path)
  const open = String(values.openPath || '') === openKey
  const menuOpen = String(values.menuPath || '') === path
  const renameOpen = String(values.renamePath || '') === path
  const primaryOp = vcChangesRowPrimaryOpOf(row)
  const menuOps: string[] = vcChangesRowMenuOpsOf(row)
  const primaryState: any = vcChangesRowStateOf(rows, primaryOp, path)
  const hunkState: any = vcChangesRowStateOf(rows, 'stage-hunks', path)
  const primaryPair: any = VC_CHANGES_ROW_ACTS[primaryOp] || [primaryOp, 'vc.changes.run']
  const slash = path.lastIndexOf('/')
  const dir = slash >= 0 ? path.slice(0, slash + 1) : ''
  const name = slash >= 0 ? path.slice(slash + 1) : path
  const tone = vcChangesFileToneOf(change)
  const statusText = t('vc.changes.view.stat.' + vcChangesRowStateKeyOf(row))
  const deltaKnown = row.addedLines !== null && row.addedLines !== undefined
  const extras: any[] = []
  if (change === 'untracked') extras.push(h('span', { key: 'untracked', className: 'chip chip-sm chip-untracked' }, t('vc.changes.view.untracked')))
  // 部分暂存：行上标出「已暂存几块」。读数没到（没展开过）时只能说「已暂存一部分」，不编一个数字。
  if (row.partial === true) {
    const stagedLines: any = (diffs[vcChangesSideKeyOf('staged', path)] || {}).lines || []
    const unstagedLines: any = (diffs[vcChangesSideKeyOf('unstaged', path)] || {}).lines || []
    const merged: any[] = vcChangesMergedHunksOf(stagedLines, unstagedLines)
    const progress: any = vcChangesHunkProgressOf(merged)
    const known: boolean = merged.length > 0
    extras.push(h('span', {
      key: 'hunk-progress', className: 'chip chip-sm chip-ok', 'data-vc-file-hunk-progress': known ? String(progress.staged) + '/' + String(progress.total) : 'partial',
      title: known ? t('vc.changes.view.hunkProgressTitle', { staged: String(progress.staged), total: String(progress.total) }) : t('vc.changes.view.hunkProgressTitlePartial'),
    }, known ? t('vc.changes.view.hunkProgress', { staged: String(progress.staged), total: String(progress.total) }) : t('vc.changes.view.hunkProgressPartial')))
  }
  const kinds: any[] = [
    h('span', { key: 'badge', className: 'badge badge-' + tone, 'data-vc-file-change': change, 'aria-label': t(vcChangesFileLabelKeyOf(change)), title: t(vcChangesFileLabelKeyOf(change)) }, VC_CHANGES_FILE_LETTERS[change] || 'M'),
    h('span', { key: 'path', className: 'file-path' }, [
      h('span', { key: 'dir', className: 'file-dir' }, dir),
      h('span', { key: 'name', className: 'file-name' }, name),
    ]),
  ]
  if (extras.length > 0) kinds.push(h('span', { key: 'extras', className: 'file-extras' }, extras))
  if (deltaKnown) kinds.push(h('span', { key: 'delta', className: 'file-delta', 'data-vc-file-delta': '1' }, [
    h('span', { key: 'add', className: 'dl-add' }, '+' + String(row.addedLines)),
    h('span', { key: 'del', className: 'dl-del' }, '−' + String(row.deletedLines === null || row.deletedLines === undefined ? 0 : row.deletedLines)),
  ]))
  kinds.push(h('span', { key: 'chevron', className: 'row-chevron' + (open ? ' is-open' : '') }, vcChangesIconOf(h, 'chevron', 12)))
  const acts: any[] = [
    h('button', Object.assign({
      key: 'primary', type: 'button', className: 'row-act', 'data-vc-file-op': primaryOp, 'data-vc-file-path': path,
      disabled: primaryState.busy === true || !!primaryState.confirm, 'data-press': 'button', 'data-log': primaryPair[1],
      onClick: function () { if (typeof handlers.begin === 'function') handlers.begin(primaryOp, { path: path }) },
    }, vcChangesCapAttrOf(primaryOp)), t(primaryPair[0])),
  ]
  if (menuOps.length > 0) {
    acts.push(h('button', {
      key: 'more', type: 'button', className: 'row-act row-more' + (menuOpen ? ' is-open' : ''), 'data-vc-file-menu': path,
      'aria-haspopup': 'menu', 'aria-expanded': menuOpen ? 'true' : 'false', 'aria-label': t('vc.changes.view.menuOpen'),
      title: t('vc.changes.view.menuOpen'), 'data-press': 'button', 'data-log': 'vc.changes.file.menu',
      onClick: function () { onValue('menuPath', menuOpen ? '' : path) },
    }, h('span', { key: 'dots', className: 'row-more-dots' }, '⋯')))
  }
  const toggle = function () { if (typeof handlers.onOpen === 'function') handlers.onOpen(path, row) }
  const rowKids: any[] = [
    h('div', {
      key: 'main', className: 'file-main', role: 'button', tabIndex: 0,
      'aria-expanded': open ? 'true' : 'false', 'aria-label': path + '：' + statusText,
      'data-vc-file-open': path, 'data-press': 'button', 'data-log': 'vc.changes.file.open', title: path,
      onClick: toggle,
      onKeyDown: function (ev: any) {
        const key: string = String((ev && ev.key) || '')
        if (key !== 'Enter' && key !== ' ') return
        if (ev && typeof ev.preventDefault === 'function') ev.preventDefault()
        toggle()
      },
    }, kinds),
    h('span', { key: 'acts', className: 'file-actions' }, acts),
  ]
  const wrapKids: any[] = [h('div', {
    key: 'row', className: 'file-row' + (row.conflict === true ? ' is-conflict' : '') + (open ? ' is-open' : '') + (renameOpen ? ' is-pending' : ''),
    'data-vc-file-row': path, 'data-vc-file-change': change, 'data-vc-file-conflict': row.conflict === true ? '1' : '0',
    'data-vc-file-partial': row.partial === true ? '1' : '0',
  }, rowKids)]
  // 菜单：贴着「⋯」下方展开，条目带后果说明；点条目先收起菜单再发动作，避免菜单盖住确认卡。
  if (menuOpen) {
    const items: any[] = []
    VC_CHANGES_MENU_ORDER.forEach(function (op: string) {
      if (menuOps.indexOf(op) < 0) return
      const pair: any = VC_CHANGES_ROW_ACTS[op] || [op, 'vc.changes.run']
      const state: any = vcChangesRowStateOf(rows, op, path)
      const danger: boolean = VC_CHANGES_MENU_DANGER[op] === true
      items.push(h('button', Object.assign({
        key: op, type: 'button', role: 'menuitem', className: 'row-menu-item' + (danger ? ' is-danger' : ''),
        disabled: state.busy === true, 'data-vc-file-op': op, 'data-vc-file-path': path, 'data-press': 'button', 'data-log': pair[1],
        onClick: function () {
          onValue('menuPath', '')
          if (op === 'mv') { if (typeof handlers.renameOpen === 'function') handlers.renameOpen(path); return }
          if (typeof handlers.begin === 'function') handlers.begin(op, { path: path })
        },
      }, vcChangesCapAttrOf(op)), t(pair[0])))
    })
    items.push(h('button', {
      key: 'close', type: 'button', role: 'menuitem', className: 'row-menu-item is-close', 'data-vc-file-menu-close': path,
      'data-press': 'button', 'data-log': 'vc.changes.file.menu.close',
      onClick: function () { onValue('menuPath', '') },
    }, t('vc.changes.view.menuClose')))
    wrapKids.push(h('div', { key: 'menu', className: 'row-menu', role: 'menu', 'aria-label': t('vc.changes.view.menuMore') }, items))
  }
  if (renameOpen) wrapKids.push(vcChangesRenameFormOf(h, t, { path: path, values: values, handlers: handlers }))
  // 确认卡按「哪颗按钮触发的」逐个画：同一行里两个动作可以各有一张卡，键带动作名以免撞 key。
  const allOps: string[] = [primaryOp].concat(menuOps)
  allOps.forEach(function (op: string) {
    const state: any = vcChangesRowStateOf(rows, op, path)
    if (!state.confirm) return
    const meta: any = vcChangesOpMetaOf(op) || { op: op, dangerous: true, reversible: false }
    wrapKids.push(vcChangesConfirmNodeOf(h, t, { meta: meta, confirm: state.confirm, row: row, handlers: handlers }))
  })
  if (open) {
    wrapKids.push(vcChangesHunksNodeOf(h, t, {
      path: path, row: row, diffs: diffs, busy: hunkState.busy === true,
      onHunk: function (p: string, index: number, reverse: boolean, order: number) { if (typeof handlers.onHunk === 'function') handlers.onHunk(p, index, reverse, order) },
      onRetry: function () { if (typeof handlers.onDiffRetry === 'function') handlers.onDiffRetry(path, row) },
    }))
  }
  return h('div', { key: path, className: 'file-row-wrap' }, wrapKids)
}
