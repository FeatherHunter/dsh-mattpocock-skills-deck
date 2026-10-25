#!/usr/bin/env node
/**
 * scripts/seed-1460-dedup-drill.ts —— 给验收票 #1462（阶段一）造一份临时本地 Markdown 工作区（#1461 交付物）
 *
 * 为什么要有它：验收票要在真实入口里演「建 BUG 单之前的查重」，需要一个能装两张相似 BUG 单、
 * 又不会污染主仓的工作区。这个脚本只负责造种子，不跑任何门禁、也不代替人工判断。
 *
 * 它会做什么：
 *   1. 在系统临时目录下新建一个本次专用的目录（os.tmpdir()，仓库之外）；
 *   2. 在目录里写后端选择文件 docs/agents/workspace.yaml（backendId = markdown），
 *      再写一份 docs/agents/issue-tracker.md 声明这里是本地 Markdown 跟踪器，
 *      两份都认得出时插件优先用 workspace.yaml；
 *   3. 在 .scratch/csv-export-drill/issues/ 下写两张相似 BUG 单：
 *        01 是 open（Status: needs-triage），02 是 closed（Status: resolved）；
 *   4. 把临时目录的绝对路径、两张单的路径与标题打印出来，并写明怎么把这个目录挂进真实入口。
 *
 * 重复运行安全：每次都用 fs.mkdtempSync 新建一个带随机后缀的目录，从不删、不改任何已有目录；
 * 上一轮演练留下的目录要清理由人自己决定。
 *
 * 跑法（在仓库根目录）：
 *   node scripts/seed-1460-dedup-drill.ts
 * 演练步骤见 acceptance/1460-dedup-drill.md。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** 工作区里放票的目录名（feature-slug）：两张种子单都住在这一个目录的 issues/ 下。 */
const FEATURE_DIR: string = 'csv-export-drill'

/** 一张种子单的写法：路径、标题、状态、隐藏标签、正文里「实际」那一段。 */
interface SeedTicket {
  file: string
  title: string
  status: string
  labels: string[]
  idempotencyKey: string
  whatToBuild: string
}

/** 一张种子单的完整写法：文件路径、编号、标题、状态、隐藏标签、正文里「实际」那一段。 */
interface TicketSeed extends SeedTicket {
  /** 票号（文件名前缀，两位数字；插件按它寻址）。 */
  key: string
}

function ticket(text: TicketSeed, createdAt: string): string {
  return [
    '<!-- DSH-FORMAT: md-v1 -->',
    '<!-- DSH-LABELS: ' + text.labels.join(', ') + ' -->',
    '<!-- DSH-IDEMPOTENCY-KEY: ' + text.idempotencyKey + ' -->',
    '<!-- DSH-CREATED: ' + createdAt + ' -->',
    '# ' + text.key + ': ' + text.title,
    '',
    '**What to build:** ' + text.whatToBuild,
    '',
    '**Blocked by:** None (can start immediately)',
    '',
    '**Status:** ' + text.status,
    '',
    '- [ ] 导出的 CSV 列顺序与页面显示一致',
    '',
  ].join('\n')
}

function writeFile(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text, 'utf8')
}

function main(): void {
  const stamp: string = new Date().toISOString().replace(/[:.]/g, '-')
  const root: string = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-1460-dedup-drill-' + stamp + '-'))
  const createdAt: string = new Date().toISOString()
  const issuesDir: string = path.join(root, '.scratch', FEATURE_DIR, 'issues')

  // 后端选择文件：插件读到它就把这个工作区绑到本地 Markdown 后端，不会去猜 GitHub / GitLab。
  writeFile(
    path.join(root, 'docs', 'agents', 'workspace.yaml'),
    [
      '# 这个临时工作区用本地 Markdown 后端（Markdown 票就是仓库里的 .md 文件）。',
      '# 文件格式由插件维护，字段含义见 docs/agents/workspace.yaml 的注释。',
      'version: 2',
      'backendId: markdown',
      'pickedAt: ' + String(Date.now()),
      'source: user',
      '',
    ].join('\n'),
  )

  // 声明文件：workspace.yaml 万一读不到时，插件还能凭这个标题认出本地 Markdown 后端。
  writeFile(
    path.join(root, 'docs', 'agents', 'issue-tracker.md'),
    [
      '# Issue tracker: Markdown',
      '',
      '这个工作区里的票都是本地 Markdown 文件，放在 .scratch/<目录>/issues/ 下。',
      '',
    ].join('\n'),
  )

  const openTicket: TicketSeed = {
    key: '01',
    file: path.join(issuesDir, '01-csv-export-column-order.md'),
    title: '导出 CSV 时列顺序错乱',
    status: 'needs-triage',
    labels: ['bug', 'needs-triage'],
    idempotencyKey: 'drill-1460-open',
    whatToBuild: '从列表页导出 CSV 时，导出的列顺序应当和页面显示一致。',
  }
  const closedTicket: TicketSeed = {
    key: '02',
    file: path.join(issuesDir, '02-csv-export-column-order-fixed.md'),
    title: '导出 CSV 时列顺序错乱（同一问题的更早一张单，已修）',
    status: 'resolved',
    labels: ['bug', 'ready-for-agent'],
    idempotencyKey: 'drill-1460-closed',
    whatToBuild: '同一问题的早期记录：导出 CSV 的列顺序与页面显示不一致。这张单已经修好并关闭。',
  }

  writeFile(openTicket.file, ticket(openTicket, createdAt))
  writeFile(closedTicket.file, ticket(closedTicket, createdAt))

  // 打印给人看的部分：路径、标题、状态，以及怎么挂进真实入口。
  console.log('')
  console.log('===== 演练种子已生成（仓库外的临时目录，不改主仓任何文件） =====')
  console.log('临时工作区：' + root)
  console.log('')
  console.log('种子 1（open，相似单）：' + openTicket.file)
  console.log('  标题：' + openTicket.title + '（Status: ' + openTicket.status + '，标签：' + openTicket.labels.join(' / ') + '）')
  console.log('种子 2（closed，相似单）：' + closedTicket.file)
  console.log('  标题：' + closedTicket.title + '（Status: ' + closedTicket.status + '，标签：' + closedTicket.labels.join(' / ') + '）')
  console.log('')
  console.log('----- 怎么把它挂进真实入口 -----')
  console.log('1. 在 DSH 里新建会话，工作区选上面这个临时目录（初始化流程第 1 步「选择工作区并新建会话」）。')
  console.log('2. 插件读到 ' + path.join(root, 'docs', 'agents', 'workspace.yaml') + ' 后，')
  console.log('   这个工作区会用本地 Markdown 后端；若右侧面板还显示未绑定后端，手动选「本地 Markdown」，')
  console.log('   它会把这行写回同一份 workspace.yaml。')
  console.log('3. 打开右侧问题面板，确认能看到上面两张单；然后用「+ 新增BUG单」按钮（或状态栏 BUG 胶囊菜单里的「新增」）开始演练。')
  console.log('4. 演练步骤与每个场景的通过标准见 acceptance/1460-dedup-drill.md。')
  console.log('5. 演练结束可以整个删掉这个临时目录（' + root + '）；脚本每跑一次都会新建一个目录，不会动你已有的目录。')
  console.log('')
}

main()
