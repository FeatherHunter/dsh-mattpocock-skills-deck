#!/usr/bin/env node
/**
 * scripts/seed-1460-dedup-drill.ts —— 给验收票 #1462（阶段一）造一份临时本地 Markdown 工作区（#1461 交付物）
 *
 * 为什么要有它：验收票要在真实入口里演「建 BUG 单之前的查重」，需要一个能装两张相似 BUG 单、
 * 又不会污染主仓的工作区。这个脚本只负责造种子，不跑门禁、也不代替人工判断。
 *
 * 票面与工作区文件都调插件自己的渲染器生成，脚本里不手抄任何模板：
 *   - 工作区选择文件：src/deck/shell/workspace-anchor.ts 的 stringifyWorkspaceFile；
 *   - 两张票：src/tracker/rooms/markdown/create-render.ts 的 renderTicket，走真实建票同一条渲染管线。
 * 这样票面的隐藏注释、状态行、字段行将来升级时，种子自动跟着变，不会出现「种子是旧格式、
 * 真实新建的单是新格式」这种只在演练里才暴露的偏差。
 *
 * 它会做什么：
 *   1. 在系统临时目录下新建一个本次专用的目录（os.tmpdir()，仓库之外）；
 *   2. 在里面写后端选择文件 docs/agents/workspace.yaml（backendId = markdown；
 *      source = detected，意思是这份人选由程序生成，不是人在面板上亲手点的），
 *      再写一份 docs/agents/issue-tracker.md 声明这里是本地 Markdown 跟踪器；
 *      两份都认得出时插件优先用 workspace.yaml；
 *   3. 在 .scratch/csv-export-drill/issues/ 下写两张相似 BUG 单：
 *        01 是 open（Status: needs-triage），02 是 closed（Status: resolved）；
 *   4. 把临时目录的绝对路径、两张单的路径与标题打印出来，并写明怎么把这个目录挂进真实入口。
 *
 * 重复运行安全：每次都用 fs.mkdtempSync 新建一个带随机后缀的目录，从不删、不改任何已有目录；
 * 上一轮演练留下的目录要清理由人自己决定。
 *
 * 跑法（在仓库根目录）：脚本从仓库源码取渲染器，所以要挂上 ts-hook，让它把源码里的 .js
 * 说明符改指同目录下的同名 .ts 文件：
 *   node --import ./scripts/ts-hook.mts scripts/seed-1460-dedup-drill.ts
 * 演练步骤见 acceptance/1460-dedup-drill.md。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { renderTicket } from '../src/tracker/rooms/markdown/create-render.ts'
import { stringifyWorkspaceFile, WORKSPACE_FILE_REL } from '../src/deck/shell/workspace-anchor.ts'

/** 工作区里放票的目录名（feature-slug）：两张种子单都住在这一个目录的 issues/ 下。 */
const FEATURE_DIR: string = 'csv-export-drill'

/** 一张种子单的写法：编号、落盘路径、标题、状态、标签、幂等锚与正文里「实际」那一段。 */
interface SeedTicket {
  /** 票号（文件名前缀，两位数字；插件按它寻址）。 */
  key: string
  file: string
  title: string
  status: string
  labels: string[]
  idempotencyKey: string
  whatToBuild: string
}

function writeFile(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text, 'utf8')
}

/** 用插件的建票渲染器把一张种子单渲染成票面文本（与真实入口建单同一份模板）。 */
function seedTicketText(seed: SeedTicket, createdAt: string): string {
  return renderTicket('bug', {
    title: seed.title,
    body: seed.whatToBuild,
    labels: seed.labels,
    status: seed.status,
  }, {
    number: seed.key,
    createdAt: createdAt,
    idempotencyKey: seed.idempotencyKey,
    labels: seed.labels,
    assignees: [],
    parentKey: '',
  })
}

function main(): void {
  const stamp: string = new Date().toISOString().replace(/[:.]/g, '-')
  const root: string = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-1460-dedup-drill-' + stamp + '-'))
  const createdAt: string = new Date().toISOString()
  const issuesDir: string = path.join(root, '.scratch', FEATURE_DIR, 'issues')

  // 后端选择文件：插件读到它就把这个工作区绑到本地 Markdown 后端，不会去猜 GitHub / GitLab。
  // 内容交给插件的序列化器生成，字段含义与注释格式都跟真实流程一致。
  const workspaceFile: string = path.join(root, ...WORKSPACE_FILE_REL.split('/'))
  writeFile(
    workspaceFile,
    stringifyWorkspaceFile({ backendId: 'markdown', pickedAt: Date.now(), source: 'detected' }),
  )

  // 声明文件：workspace.yaml 万一读不到时，插件还能凭这行标题认出本地 Markdown 后端。
  writeFile(
    path.join(root, 'docs', 'agents', 'issue-tracker.md'),
    [
      '# Issue tracker: Markdown',
      '',
      '这个工作区里的票都是本地 Markdown 文件，放在 .scratch/<目录>/issues/ 下。',
      '',
    ].join('\n'),
  )

  const openTicket: SeedTicket = {
    key: '01',
    file: path.join(issuesDir, '01-csv-export-column-order.md'),
    title: '导出 CSV 时列顺序错乱',
    status: 'needs-triage',
    labels: ['bug', 'needs-triage'],
    idempotencyKey: 'drill-1460-open',
    whatToBuild: '从列表页导出 CSV 时，导出的列顺序应当和页面显示一致。',
  }
  const closedTicket: SeedTicket = {
    key: '02',
    file: path.join(issuesDir, '02-csv-export-column-order-fixed.md'),
    title: '导出 CSV 时列顺序错乱（同一问题的更早一张单，已修）',
    status: 'resolved',
    labels: ['bug'],
    idempotencyKey: 'drill-1460-closed',
    whatToBuild: '同一问题的早期记录：导出 CSV 的列顺序与页面显示不一致。这张单已经修好并关闭。',
  }

  writeFile(openTicket.file, seedTicketText(openTicket, createdAt))
  writeFile(closedTicket.file, seedTicketText(closedTicket, createdAt))

  // 打印给人看的部分：路径、标题、状态，以及怎么挂进真实入口。
  console.log('')
  console.log('===== 演练种子已生成（仓库外的临时目录，不改主仓任何文件） =====')
  console.log('临时工作区：' + root)
  console.log('工作区选择文件：' + workspaceFile + '（backendId: markdown，source: detected）')
  console.log('')
  console.log('种子 1（open，相似单）：' + openTicket.file)
  console.log('  标题：' + openTicket.title + '（Status: ' + openTicket.status + '，标签：' + openTicket.labels.join(' / ') + '）')
  console.log('种子 2（closed，相似单）：' + closedTicket.file)
  console.log('  标题：' + closedTicket.title + '（Status: ' + closedTicket.status + '，标签：' + closedTicket.labels.join(' / ') + '）')
  console.log('')
  console.log('----- 怎么把它挂进真实入口 -----')
  console.log('1. 在 DSH 里新建会话时，把工作区选成上面这个临时目录：' + root)
  console.log('2. 插件读到 workspace.yaml 后，这个工作区会用本地 Markdown 后端。')
  console.log('   那份文件里写的 source 是 detected（程序生成的人选，不是人亲手点的）；')
  console.log('   若右侧面板要求你确认一次工作区，确认即可。')
  console.log('   若面板仍要求先选后端，就在切换器里选名称带 Markdown 的那一项（英文界面写 Local markdown）。')
  console.log('3. 打开右侧问题面板，确认能看到上面两张单；然后用「+ 新增BUG单」按钮（或状态栏 BUG 胶囊菜单里的「新增」）开始演练。')
  console.log('4. 演练步骤与每个场景的通过标准见 acceptance/1460-dedup-drill.md。')
  console.log('5. 演练结束可以整个删掉这个临时目录（' + root + '）；脚本每跑一次都会新建一个目录，不会动你已有的目录。')
  console.log('')
}

main()
