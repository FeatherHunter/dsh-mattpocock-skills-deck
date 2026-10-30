/**
 * ui/views/page-host.ts —— 二级页的宿主：决定此刻该画哪一页，以及整仓不可逆动作的二级核对页。
 *
 * app.ts 只调用一个函数：没有打开页面时返回 null，照旧画四个页签；
 * 打开页面时按页面编号分发；有危险动作待核对时优先画核对页，盖住原页面。
 * 核对页不是第二个模态框：它是一整页，把后果、备份位置、恢复路径逐条摊开，
 * 要求读者照着敲确认词才允许最后一步——这一步在原型里也只写演示结果，不碰仓库。
 */
import { CAPABILITIES } from '../../data/capabilities.generated'
import type { Capability } from '../../data/capabilities.generated'
import { capturedBranch, capturedCounts, capturedHead, capturedRepoRoot } from '../../data/repo.generated'
import { h } from '../dom'
import { chip, note } from '../primitives'
import { actionButton, factGrid, objectRow, pageShell, section } from './page-shell'
import type { PageContext } from './page-shell'
import { activePage } from '../../domain/pages'
import { PAGE_META } from '../../data/pages-copy'
import { renderBranchTags, renderManageIndex, renderRemote, renderSubmodules } from './pages-manage'
import { renderConfig, renderDiagnostics, renderHooks, renderMaintenance, renderMigrate, renderPlatform } from './pages-system'
import { renderConflicts, renderRebase, renderSearch, renderTask } from './pages-flow'

/** 二级核对页要求照着敲的确认词：只在这一页里出现，不复制到别处。 */
const DANGER_WORD = '确认清理'

/** 整仓不可逆动作的后果与恢复路径：按能力编号写死，写的是这一条命令真正会发生什么。 */
interface DangerCopy {
  moves: string
  keeps: string
  recovery: string
}

function dangerCopyOf(cap: Capability, prunePackable: number): DangerCopy {
  switch (cap.id) {
    case '11.6':
      return {
        moves: '删除本地不可达的对象（当前 ' + prunePackable + ' 个可回收对象）与垃圾文件；这些对象从本地消失，引用日志里的旧记录也不再能找回它们。',
        keeps: '可达的提交、标签、远端引用与工作区文件一个都不会动；其他工作树引用的对象仍然可达，不会被删。',
        recovery: '执行前把整个仓库目录（含 .git）复制一份就是最稳的恢复路径；执行后只能从远端重新抓取，或从备份恢复。',
      }
    default:
      return {
        moves: cap.opens + '；' + cap.result,
        keeps: '面板不执行这一步，真实动作由维护者在终端完成。',
        recovery: '先在副本上演练，再对正式仓库执行。',
      }
  }
}

function findCap(id: string | null): Capability | undefined {
  if (id === null) return undefined
  return CAPABILITIES.find((cap) => cap.id === id)
}

export function renderPageHost(ctx: PageContext): HTMLElement | null {
  if (ctx.state.dangerId !== null) {
    const cap = findCap(ctx.state.dangerId)
    if (cap !== undefined) return renderDangerConfirm(ctx, cap)
  }
  const page = activePage(ctx.state)
  if (page === null) return null
  switch (page) {
    case 'manage': return renderManageIndex(ctx)
    case 'branch-tags': return renderBranchTags(ctx)
    case 'remote': return renderRemote(ctx)
    case 'submodules': return renderSubmodules(ctx)
    case 'maintenance': return renderMaintenance(ctx)
    case 'migrate': return renderMigrate(ctx)
    case 'config': return renderConfig(ctx)
    case 'hooks': return renderHooks(ctx)
    case 'diagnostics': return renderDiagnostics(ctx)
    case 'platform': return renderPlatform(ctx)
    case 'rebase': return renderRebase(ctx)
    case 'conflicts': return renderConflicts(ctx)
    case 'task': return renderTask(ctx)
    case 'search': return renderSearch(ctx)
    default: return null
  }
}

/**
 * 二级核对页：一段一段回答「会动什么、不会动什么、怎么恢复、拿什么核对」，
 * 最后要求读者把确认词照抄一遍。确认词不对，最后一步按不可用处理。
 */
function renderDangerConfirm(ctx: PageContext, cap: Capability): HTMLElement {
  const copy = dangerCopyOf(cap, capturedCounts.prunePackable)
  const meta = PAGE_META.maintenance
  const typedOk = ctx.state.confirmText.trim() === DANGER_WORD
  const todo = [
    '确认没有别的工作树还在引用这些对象：工作树清单里 ' + '每一棵都能看到自己的 HEAD 与分支。',
    '确认最近的引用日志已经不需要：清理之后旧记录指向的对象不再能找回。',
    '确认已经有一份可用的备份：整个仓库目录复制到另一块磁盘即可。',
    '确认执行窗口：执行期间不要同时跑其他会写仓库的命令（或其他会话的校验）。',
  ]
  const checklist = todo.map((item, index) => objectRow([
    h('span', { class: 'obj-title' }, h('span', { class: 'mono', text: '第 ' + (index + 1) + ' 项' })),
    h('span', { class: 'obj-sub', text: item }),
  ], [chip('已核对', 'muted', { small: true })]))

  const input = h('input', {
    class: 'confirm-input',
    attrs: { type: 'text', value: ctx.state.confirmText, placeholder: '照着敲：' + DANGER_WORD, 'data-field': 'confirm-text', 'data-focus-key': 'danger-input', autocomplete: 'off' },
  })
  const confirmBox = h('div', { class: 'danger-confirm-box' },
    h('p', { class: 'danger-confirm-q', text: '确认词：' + DANGER_WORD + '。敲对之后最后一步才可用。' }),
    input,
    h('div', { class: 'danger-confirm-actions' },
      actionButton('返回', 'danger-close', { focusKey: 'danger-cancel' }),
      actionButton('我知道后果，执行', 'danger-run', { kind: 'danger', focusKey: 'danger-run', disabled: !typedOk })))

  const facts = factGrid([
    { key: '动作', value: cap.id + ' ' + cap.name },
    { key: '命令', value: cap.command, mono: true },
    { key: '对象数量', value: capturedCounts.prunePackable + ' 个可回收 · ' + capturedCounts.garbage + ' 个垃圾文件', tone: 'warn' },
    { key: '仓库', value: capturedRepoRoot, mono: true },
    { key: '当前分支', value: capturedBranch + ' @ ' + capturedHead.slice(0, 7), mono: true },
    { key: '备份建议', value: '复制整个仓库目录（含 .git）', tone: 'warn' },
  ])

  const body = h('div', { class: 'page-stack' },
    section('会动什么', null, null, [
      h('p', { class: 'danger-consequence', text: copy.moves }),
      h('p', { class: 'danger-recovery', text: copy.keeps }),
    ]),
    section('可逆性与恢复路径', null, null, [note(copy.recovery, 'warn')]),
    section('拿什么核对', '4 项', '这四项必须逐条过一遍；核对页不替你判断，只把要看的读数摊开。', [facts, ...checklist]),
    section('最后一步', null, '这一步在原型里也只写演示结果，不会真的清理仓库。真实执行由维护者在终端完成，复核人 FeatherHunter。', [confirmBox]),
  )
  return pageShell('maintenance', meta.title + ' › 危险动作核对', '这是 ' + cap.id + ' ' + cap.name + ' 的二级核对页：先看后果，再看备份，最后照抄确认词。', null, body, { danger: true, focusKey: 'danger-top' })
}
