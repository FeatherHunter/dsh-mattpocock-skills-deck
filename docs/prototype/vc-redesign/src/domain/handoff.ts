/**
 * domain/handoff.ts —— 把面板上此刻看到的一切，拼成一段可以直接交给 AI 的说明。
 *
 * 为什么放在 domain 而不是视图里：这段文字是一份「状态快照」，不是一段界面文案。
 * 它要写到足以让一个没打开过面板的人（或模型）判断该怎么做：仓库在哪、分支与上游的关系、
 * 工作区有多少文件、这些文件都是什么、其他工作树有没有卡住、最近提交是什么样。
 * 换一套皮肤、换一个宽度、换一种「进入方式」都不该改变这段内容，所以它不依赖任何 DOM。
 *
 * 为什么分四种意图（general / changes / worktrees / branches）：同一份状态，用户从不同页面
 * 点进来时心里的问题不一样。从改动页点进来想知道「怎么拆提交」，从工作树页点进来想知道
 * 「怎么把这堆异常处理干净」。只换「想达到的结果」与「我看到的现象」两段，
 * 状态体一律相同，这样入口可以多，说明只有一份。
 */
import type { FileEntry, FirstScreen } from '../data/core'
import type { PrototypeData } from '../data/screen'
import { whenText } from '../data/format'

/** 入口的四种意图：从哪一页点进来，决定「想达到的结果」写什么。 */
export type HandoffKind = 'general' | 'changes' | 'worktrees' | 'branches'

export interface HandoffDraft {
  /** 浮层标题：一句话说清这一份说明是为什么准备的。 */
  title: string
  /** 标题下面的一句解释：说明这段文字里装了什么、点了会发生什么。 */
  lede: string
  /** 正文：可以直接粘贴进新对话的完整说明。 */
  prompt: string
  /** 正文字数，用来在复制后确认「复制到的是这一份」。 */
  charCount: number
}

/** 入口标题：四种意图各一句，动词尽量具体，不写「智能」「一键」这类空话。 */
const TITLES: Record<HandoffKind, string> = {
  general: '不想亲自处理？把当前状态交给 AI',
  changes: '改动太多？交给 AI 拆成几条提交',
  worktrees: '工作树太乱？交给 AI 收尾',
  branches: '分支关系太乱？交给 AI 理清',
}

/** 进去之后先读到的一句：写清楚这个入口会带上什么，不让人担心「只发一句话过去」。 */
const LEDES: Record<HandoffKind, string> = {
  general: '这段说明带着仓库、分支、工作区文件、其他工作树和最近提交；复制之后粘贴到新对话里，就能接着谈。',
  changes: '这段说明会列出每一个未提交的文件和增删行数，复制之后粘贴到新对话里，让 AI 直接判断该分成几条提交。',
  worktrees: '这段说明会列出每一棵其他工作树的状态与原因，复制之后让 AI 判断哪些该解锁、哪些该清理记录、哪些该移除。',
  branches: '这段说明会列出本地分支与上游的关系、领先落后与是否已合并，复制之后让 AI 给出安全的合并与删除顺序。',
}

/** 四种意图各自「我想做什么」的示例句：只当括号里的参考，不再自动替用户写成结论。 */
const GOALS: Record<HandoffKind, string> = {
  general: '先帮我把当前状态核对清楚，再告诉我下一步最值得做的一件事。',
  changes: '把这批改动整理成若干条主题清楚的提交，并逐条告诉我应该把哪些文件放进同一条提交。',
  worktrees: '把工作树清单恢复干净：能解锁的解锁，能清理记录的清理记录，能移除的移除；每一步先说清楚风险。',
  branches: '理清分支关系：该合并的合并，该删除的删除，然后告诉我以后怎么保持整洁。',
}

/** 文件行：路径是第一信息，行数是第二信息；未跟踪与冲突没有数字可报，直接写状态。 */
function fileLine(entry: FileEntry): string {
  if (entry.conflict) return `${entry.path}（冲突，尚未解决）`
  const added = entry.addedLines
  const deleted = entry.deletedLines
  if (added === null && deleted === null) return `${entry.path}（未跟踪或二进制文件，没有行数）`
  const parts: string[] = []
  if (added !== null && added > 0) parts.push(`新增 ${added} 行`)
  if (deleted !== null && deleted > 0) parts.push(`删除 ${deleted} 行`)
  return parts.length === 0 ? `${entry.path}（内容不变，只有文件状态变化）` : `${entry.path}（${parts.join('，')}）`
}

/** 未完成的 git 操作：没有就写「无」，有就把名字列全，不让读者猜。 */
function pendingOperationText(screen: FirstScreen): string {
  const names: string[] = []
  if (screen.repo.merging) names.push('合并')
  if (screen.repo.rebasing) names.push('变基')
  if (screen.repo.cherryPicking) names.push('拣选')
  if (screen.repo.reverting) names.push('回退')
  return names.length === 0 ? '无，没有正在进行的合并、变基、拣选或回退' : `正在进行：${names.join('、')}`
}

/** 工作树异常原因：一句话给结论，冒号后面给原因；正常的工作树不进这段。 */
function worktreeStateText(row: FirstScreen['otherWorktrees'][number]): string | null {
  if (row.locked) return row.lockReason === null ? '已被占用，git 记了管理员锁' : `已被占用：${row.lockReason}`
  if (row.prunable) return '目录已经不存在，只剩一条 git 记录'
  if (row.prunableUnknown) return '目录还在不在无法判断，需要人工确认'
  return null
}

function numbered(lines: string[]): string {
  return lines.map((line, index) => `  ${index + 1}. ${line}`).join('\n')
}

/**
 * 组装交接说明。输入只有两类：真实数据（data）与「用户此刻停在哪儿」（focus）。
 * 输出是纯文本，不含任何界面标记；复制到聊天框后仍然按段落可读。
 */
export function buildHandoff(data: PrototypeData, kind: HandoffKind, nowMs: number, focus: string): HandoffDraft {
  const screen = data.screen
  const identity = screen.identity
  const upstream = screen.branches.find((row) => row.short === data.branch)?.upstream ?? null
  const otherWorktrees = screen.otherWorktrees
  const abnormal = otherWorktrees.filter((row) => worktreeStateText(row) !== null)
  const branches = data.branches
  const mergedBranches = branches.filter((row) => row.mergedIntoCurrent && row.name !== data.branch)
  const looseBranches = branches.filter((row) => row.upstream === null && row.name !== data.branch)
  const stagedLines = screen.staged.map(fileLine)
  const unstagedLines = screen.unstaged.map(fileLine)
  const conflictLines = screen.unstaged.filter((row) => row.conflict).map(fileLine)
  const recentCommits = data.commits.slice(0, 5).map((commit) => `${commit.short} ${commit.subject}（${commit.author}，${whenText(nowMs, commit.authorDateMs)}）`)

  // 路径统一成斜杠：同一段说明里既有仓库根又有工作树路径，一个用反斜杠一个用正斜杠，
  // 贴进对话后读者会以为是两个不同的目录。Windows 的正斜杠 git 也认。
  const repoPath = data.repoRoot.replace(/\\/g, '/')
  const identityLines = [
    `路径：${repoPath}`,
    `当前工作树：${identity.worktreePath.replace(/\\/g, '/')}`,
    `分支：${identity.branch ?? '游离 HEAD，不在任何分支上'}`,
    `上游：${upstream ?? '这条分支没有设置上游'}`,
    `同步：超前 ${identity.ahead} 笔提交，落后 ${identity.behind} 笔提交`,
  ]

  const changesLines = [
    `已暂存：${screen.stagedCount} 个文件`,
    ...(stagedLines.length === 0 ? [] : [numbered(stagedLines)]),
    `未暂存：${screen.unstagedCount} 个文件`,
    ...(unstagedLines.length === 0 ? [] : [numbered(unstagedLines)]),
    `冲突：${screen.conflictCount} 个文件`,
    ...(conflictLines.length === 0 ? [] : [numbered(conflictLines)]),
    `未完成的操作：${pendingOperationText(screen)}`,
  ]

  const worktreeLines = otherWorktrees.length === 0
    ? ['没有其他工作树。']
    : [
      `共 ${otherWorktrees.length} 棵，其中 ${abnormal.length} 棵需要处理。`,
      ...(abnormal.length === 0 ? [] : [numbered(abnormal.map((row) => {
        const reason = worktreeStateText(row)
        return `${row.display}：${row.path}（${reason ?? ''}）`
      }))]),
    ]

  const branchLines = branches.length === 0
    ? ['没有读到的本地分支。']
    : [
      `本地 ${branches.length} 条，当前是 ${data.branch}。`,
      numbered(branches.map((row) => {
        const parts: string[] = []
        if (row.name === data.branch) parts.push('当前分支')
        parts.push(row.upstream === null ? '没有上游' : `上游 ${row.upstream}`)
        if (row.ahead > 0) parts.push(`超前 ${row.ahead}`)
        if (row.behind > 0) parts.push(`落后 ${row.behind}`)
        if (row.name !== data.branch) parts.push(row.mergedIntoCurrent ? '已合并进当前分支' : '尚未合并进当前分支')
        return `${row.name}（${parts.join('，')}）：${row.subject}`
      })),
      `其中已合并 ${mergedBranches.length} 条，没有上游 ${looseBranches.length} 条。`,
    ]

  // 主观三段留空：面板能确定的是仓库与界面位置，不能替用户说他想要什么。
  // 这里只放「界面停在」这一条已知事实，其余用括号提示写法，等用户自己补。
  const prompt = [
    '我在本地仓库的版本管理页上遇到了下面的情况，请你帮我判断并给出下一步做法。',
    '',
    '【仓库与分支】',
    ...identityLines,
    '',
    '【工作区现状】',
    ...changesLines,
    '',
    '【其他工作树】',
    ...worktreeLines,
    '',
    '【本地分支】',
    ...branchLines,
    '',
    '【最近提交】',
    recentCommits.length === 0 ? '  没有读到提交。' : numbered(recentCommits),
    '',
    '【我看到的现象】',
    `  界面停在：${focus}`,
    '  （在这里补一句：你打开面板时想做什么，或者看到哪里不对劲。这一句不写，模型只能从上面的状态里猜。）',
    '',
    '【我想做什么】',
    `  （用一两句话说清你想得到的结果。可以照这个方向写：${GOALS[kind]}）`,
    '',
    '【请你】',
    '  1. 先用三五句话复述你理解的状态，并指出我可能误解的地方。',
    '  2. 再按步骤给出做法，每一步写清楚会改动什么、不会改动什么、怎么验证成功。',
    '  3. 碰到丢弃改动、覆盖已推送的历史、强制推送之前，先停下来问我确认。',
    '',
    '【补充】',
    '  （如果还有别的背景或限制，写在这里。）',
  ].join('\n')

  return { title: TITLES[kind], lede: LEDES[kind], prompt, charCount: prompt.length }
}

/** 视图层要的入口文案：一处定义，改动页、工作树页、分支页与同步带共用。 */
export const HANDOFF_ENTRY = {
  general: '不想亲自处理？交给 AI',
  changes: '拿不准怎么拆提交？交给 AI',
  worktrees: '不想自己排查？交给 AI',
  branches: '分支关系太乱？交给 AI 理清',
} satisfies Record<HandoffKind, string>

