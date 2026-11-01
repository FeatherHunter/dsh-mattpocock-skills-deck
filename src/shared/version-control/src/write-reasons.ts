/**
 * src/shared/version-control/src/write-reasons.ts —— 写操作的失败种类与中文句子（#841，纯函数）
 *
 * 单一真源：宿主只透传 reason 与 hint，不在宿主里另造措辞（#841 硬要求）。
 * 两张表分工：
 *   · 票据类（ticket-missing / ticket-op-mismatch / ticket-expired / stale-head / stale-index /
 *     fingerprint-unavailable / target-changed）由宿主判定，**不看 git 文本**；
 *   · git 文本类由本文件的 classifyWriteFailure 按 op 归类（同一个词在不同 op 下意思不同）。
 * 传输档（need-credentials / auth-rejected / no-permission / network / stalled / timeout /
 * budget-exhausted / spawn-failed / env / args）归 #839 的 hintFor，本文件一个字不重写。
 */
import type { WriteOp } from './ports.js'

/** 写层稳定标识符 → 一句能照着做的中文话。 */
export const WRITE_REASONS: Record<string, string> = {
  'ticket-missing': '这次确认已经失效（可能已经点过、或页面重开过）。请重新看一眼再点。',
  'ticket-op-mismatch': '这次确认不是给这个动作的。请重新看一眼再点。',
  'ticket-expired': '确认超过 2 分钟没点，已经作废。请重新看一眼再点。',
  'stale-head': '仓库在你确认之后又变了（当前提交已经不是你看的那一个）。请重新看一眼再点。',
  'stale-index': '你确认之后暂存区又变了，提交进去的会和你看到的不一样。请重新看一眼再点。',
  'fingerprint-unavailable': '这次读不到暂存区的完整清单（输出太大或被截断），提交这一步做不了。请分开暂存后再试。',
  'target-changed': '这次操作的目标（远端/分支/上游）在你确认之后变了。请重新确认一次。',
  'stale-repo': '这张确认不是给这个仓库发的（换过工作区或目录）。请重新看一眼再点。',
  'head-unreadable': '这一步做完了，但读不到仓库当前状态，没法确认结果。请点一下刷新，看一眼提交历史再决定。',
  'empty-message': '提交信息不能为空。',
  'message-too-long': '提交信息太长了（标题最多 200 字、整体最多 5000 字）。',
  'bad-paths': '这次没有给出要暂存的文件，或路径形状不对。',
  'bad-target': '这次没有解析出可用的推送目标。请重新确认一次。',
  'request-reused': '这个 requestId 已经用在另一个动作上了：同一个 requestId 只能重放同一动作，换一个再发一次。',
  'need-remote-choice': '这个仓库有多个远端，面板不替你挑。请选一个远端再确认。',
  'no-remote': '这个仓库还没有配置任何远端。请先在侧栏终端里加一个远端（git remote add）再回来推送。',
  'nothing-to-stage': '没有可暂存的东西。',
  'nothing-staged': '暂存区是空的，没有可提交的内容。',
  // —— 提交页（#1743）新增的失败理由：2.4 的目标提交与 2.6 的签名 ——
  'need-commit-target': '生成 fixup / squash 提交要先选一个能被吸收的目标提交。',
  'bad-commit-target': '这个目标提交形状不对，或它在仓库里已经不在了。请重新选一个。',
  'nothing-to-amend': '这个分支还没有任何提交，没有可以修订的上一条。',
  'signing-failed': '本机的签名配置没能给这次提交签名（缺密钥、口令或 gpg 出错），提交没有发生。请到侧栏终端看一次 git commit 的签名输出。',
  'intent-to-add': '暂存区里有「只标记了要加、内容还没定」的条目（git add -N）。这种条目提交进去的会是工作区此刻的内容，面板不替你赌。请到侧栏终端处理这个文件。',
  // 拉取被拒时 fetch 那一半已经成功（远端的新提交已经取回来了）——话术要说清这一点，别让用户以为白跑一趟。
  'rejected-by-server': '远端拒绝了这次推送（服务端的钩子或保护规则拦下了）。面板改不了远端的规则；上面那行是远端原话，按它处理。',
  'auth-failed': '远端不认这台机器上的凭据（多半过期或被撤销）。请在右侧栏终端里重新登录一次再回来。',
  'non-fast-forward': '远端的新提交已经取回来了，但本地和它分开了，不能快进。面板只做快进，请到侧栏终端合并或变基。',
  'conflict': '本地和远端都有新提交，直接拉会打架。面板不替你合并——去侧栏终端跑 git pull，处理完冲突再回来。',
  'hooks-failed': '仓库的提交钩子没有通过，提交没有发生。请到侧栏终端跑一次 git commit 看钩子的输出。',
  'head-moved': '仓库的 HEAD 已经变了（可能这次提交成功了，也可能是别的程序提交的）。请看一眼提交历史再决定。',
  // —— 改动页（#1742）新增的失败理由 ——
  'bad-path': '这个路径面板不替你操作：只接受仓库里的相对路径（正斜杠），不能以短横线或冒号开头，也不能包含 ../ 反斜杠或绝对路径。',
  'hunks-unavailable': '这个文件 git 拆不开块（二进制、纯重命名或没有可拆的改动），请按整份文件暂存或丢弃。',
  'hunk-out-of-range': '你要操作的那一块已经不存在了（文件在确认之后又改过）。请重新看一眼再点。',
  'nothing-to-do': '现在没有可做的东西（可能已经做过了，或工作区已经干净）。',
  'path-exists': '目标位置已经有文件了，移动会覆盖它。请换一个名字再试。',
  'path-modified': '这个文件还有没处理完的改动，删除前请先把它们暂存或丢弃。',
  'ignore-invalid': '这一行不能写进忽略清单（空行或含控制字符）。',
  'operation-in-progress': '仓库正在合并、变基、拣选或回退中，这组动作先不接。请先处理完当前操作再回来。',
  'repo-bare': '这是一个裸仓库，没有工作区可以改。',
  // —— 配置与钩子（#1760）新增的失败理由 ——
  // 这些理由分两类：前六条是「面板自己拒」（不起进程），后三条是「git 那一步没成」。
  // 面板拒的时候要说清为什么，因为用户会觉得「改一个配置而已，凭什么不让我改」。
  'key-readonly': '配置页只改提交身份的两个键（姓名与邮箱）；其余键只读。别的键要去侧栏终端用 git config 改——面板不做通用键值编辑器，因为 core.hooksPath、alias.* 这类键能执行任意代码。',
  'scope-invalid': '作用域只能选本仓库（--local）或这台机器（--global）。系统级配置不给写。',
  'value-empty': '新值不能是空的。想删掉这个键请用「删除配置」，而不是写一个空值。',
  'value-too-long': '新值太长了（最多 200 个字符）。',
  'value-invalid': '新值里有换行或控制字符，配置值写不下这些。',
  'email-invalid': '邮箱形状不对：要有 @ 与域名点号，且不含空白。',
  'hook-name': '钩子名字只能用小写字母、数字与连字符，且不能以短横线开头。',
  'hook-not-found': '这个钩子在仓库里找不到文件（可能名字记错了，或者钩子还没装）。面板只跑已经存在的钩子文件。',
  'hook-version': '这台机器的 git 版本不支持手动跑钩子（要 2.36 以上）。请在侧栏终端直接执行钩子文件。',
  'config-missing': '这个键在所选作用域里没有值，没有可删的东西。',
  'config-failed': 'git 拒绝了这次配置写入；上面那行是它的原话。',
  'hook-failed': '钩子跑完了但退出码不是 0；上面是它的输出。钩子失败不等于这次操作失败，请按输出处理。',
  // —— 冲突向导（#1747）新增的失败理由 ——
  'conflict-markers': '这段内容里还留着冲突标记（<<<<<<<、=======、>>>>>>>），面板拦下了：先处理干净再保存或标记已解决。',
  'path-not-conflicted': '这个路径现在不是冲突文件（可能已经处理过，也可能换了仓库）。请刷新冲突清单再点。',
  'side-missing': '这个冲突文件没有你选的那一边（对方删了文件、或只有一边存在）。请选另一边，或选保留删除。',
  'binary-file': '这是二进制文件，面板不能按文本整份编辑它。请整份选一边，或标记已解决。',
  'target-missing': '找不到这个分支或提交。请刷新分支清单后重新选。',
  'version-unsupported': '这台机器的 git 版本太旧，这一步需要更新的 git（合并预演要 2.38 及以上）。请升级 git 再试。',
  'text-too-large': '这段内容太大了（超过 1 MiB），面板不能整份写回。请到侧栏终端处理这个文件。',
  'wrong-operation': '这个「跳过」不适用于当前进行中的操作（合并没有跳过这一步）。请改用继续或中止。',
  'no-operation': '现在没有正在进行的合并、变基、拣选或回退，所以没有可继续、跳过或中止的操作。',
  'unmerged-files': '还有文件没解决。请先把冲突文件逐个处理完（选边、整份编辑或标记已解决）再继续。',
  'bad-side': '这次没有给出可用的「选哪一边」，请重新选。',
  'fast-forward-impossible': '这次合并不可能快进（两边历史已经分开）。请改用普通合并，或先在终端里变基。',
  // —— 变基待办页（#1749）新增的失败理由 ——
  'update-refs-on': '这个仓库开着 rebase.updateRefs，变基时会顺带挪动其他分支的指针。面板不替你改仓库配置：请先在侧栏终端执行 git config --local rebase.updateRefs false，再回来变基。',
  'bad-todo': '这次给出的待办清单形状不对（空、有重复提交号、或某个提交不在待办窗口里）。请刷新待办窗口后重新排。',
  'todo-too-long': '待办清单最多一次排 200 行，请分批处理。',
  'todo-mismatch': '待办窗口在你排完之后又变了（基座或分支动过），这次重放会和你看的不一样。请刷新待办窗口重新排。',
  'missing-message': '有要改说明的提交没有填新说明。请逐条填好再点。',
  'bad-action': '待办里有一个面板不提供的小动作（面板只做保留、改说明、压缩、丢弃与上下移动）。请刷新待办窗口。',
  // —— 维护页整仓重写（#1750）新增的失败理由 ——
  'tool-missing': '这台机器上没有装 git-filter-repo（git 找不到这个子命令）。请先按它的官网说明安装，再回来重试；面板不会替你安装工具。',
  'shallow-repo': '这是一个浅克隆仓库（历史被截断过），整仓重写会得到不完整的重写结果。请先 git fetch --unshallow 取回完整历史，或换一个完整克隆来做。',
  'dirty-worktree': '工作区还有没提交的改动。整仓重写会重写全部提交，请先把改动提交或贮藏，再回来。',
  'bad-form': '这次没认出要用哪张重写表单（删路径、重命名路径、改写作者、删大文件、字面量替换）。请重新选一张表单。',
  'bad-rename': '重命名路径这一项形状不对：来源与目标都要写相对路径，不能是同一个路径，也不能重复。请逐条检查。',
  'bad-identity': '作者身份这一项不合形状：名字与邮箱都要给，邮箱要像 name@example.com，不能带尖括号或空白。',
  'bad-threshold': '大小阈值这一项不合形状：写成 10M、500k、1G 这样的正整数加单位（k、m、g），不写单位按字节算。',
  'bad-replacement': '字面量替换这一项不合形状：要替换的字不能为空，替换成的字可以为空，两边都不能有换行或 ==> 记号。',
  'too-many-items': '这一张表单一次最多填 50 项。请拆成几次做，每做完一次先核对结果。',
  'backup-failed': '整仓备份没有成功，所以重写没有开始。请检查磁盘剩余空间、备份目标目录权限与父目录是否存在，再看 git 原话。',
  'backup-unreadable': '备份做完了但读不出它的大小（按约定不能拿半份信息继续）。请到备份路径确认内容，必要时换一个磁盘重做。',
  'temp-unavailable': '面板写不了临时说明文件（系统临时目录不可写或已满），这一步没有开始。请清理临时目录或换一台机器再试。',
  'task-start-failed': '备份已经成功，但重写任务没有起来（长任务通道拒绝了这次请求）。备份文件还在，可以重试；重试前不需要重新备份。',
  // —— 维护页（#1758）新增的失败理由 ——
  'bad-mode': '完整性检查只有两种模式（默认与找不可达对象），这次给的模式面板认不出。请重选后再点。',
  'unknown-write-failure': 'git 报了一个我们没归类的失败；上面那行是它的原话。',
}

/** 取一句话；表里没有的按兜底那句（照 Rules 的同一风格，绝不返回空串）。 */
export function writeHintFor(reason: string): string {
  return WRITE_REASONS[String(reason || '')] || WRITE_REASONS['unknown-write-failure']
}

/** 提交信息的两条轻校验（D4）：标题 ≤200、整体 ≤5000；空一律拒绝。 */
export function messageProblem(message: string): string | null {
  const s = String(message === undefined || message === null ? '' : message)
  if (s.trim() === '') return 'empty-message'
  if (s.length > 5000) return 'message-too-long'
  const firstLine = s.split('\n')[0]
  if (firstLine.length > 200) return 'message-too-long'
  return null
}

/** 暂存路径的形状：至少一条、非空、不含 NUL。返回 null 表示没问题。 */
export function pathsProblem(paths: unknown): string | null {
  if (!Array.isArray(paths) || paths.length === 0) return 'bad-paths'
  for (const p of paths) {
    if (typeof p !== 'string' || p === '' || p.indexOf('\u0000') >= 0) return 'bad-paths'
    // 再挡两类会被 git 当别的东西解释的形状（写侧输不起）：'-x.txt' 会被当未知开关，
    // ':(exclude)*.txt' 是 pathspec 魔法（--literal-pathspecs 已关掉魔法与通配，这里补一道）。
    if (p.charAt(0) === '-' || p.charAt(0) === ':') return 'bad-paths'
  }
  return null
}

/** git 文本 → 写层 reason；按 op 分（同一个词在不同 op 下意思不同），认不出回兜底。 */
export function classifyWriteFailure(op: WriteOp, exitCode: number, stderrText: string): string {
  if (exitCode === 0) return 'unknown-write-failure'
  const t = String(stderrText || '').toLowerCase()
  // 冲突向导（#1747）的几个动作不是 WriteOp 的联合成员，这里按动作名先分一支。
  // 合并类的「冲突」不是失败：执行层把它当成功结果（工作区留下冲突等用户处理），只有真正的拒绝才走到这里。
  const opName = String(op || '')
  if (opName === 'merge' || opName === 'merge-ff-only' || opName === 'merge-no-ff' || opName === 'merge-squash') {
    if (/not possible to fast-forward/.test(t)) return 'fast-forward-impossible'
    if (/not concluded your merge|you have not concluded your merge|merging is not possible/.test(t)) return 'operation-in-progress'
    return 'unknown-write-failure'
  }
  if (opName === 'take-side' || opName === 'mark-resolved' || opName === 'save-file') {
    if (/does not have (their|our) version/.test(t)) return 'side-missing'
    if (/did not match any files|pathspec .* did not match/.test(t)) return 'bad-path'
    return 'unknown-write-failure'
  }
  if (op === 'commit') {
    // 顺序有意义（#1743）：签名失败、无可修订提交、目标提交不存在各有自己的话术，
    // 都要排在「没有暂存内容」「钩子拒绝」这些通用分类之前，否则会被兜底吞成笼统的一句。
    if (/gpg failed to sign|failed to sign the data|gpg: signing failed|secret key not available|no secret key|gpg: .*failed|signing failed/.test(t)) return 'signing-failed'
    if (/nothing to amend|no commits on branch|no commit to amend/.test(t)) return 'nothing-to-amend'
    if (/could not lookup commit|unknown revision or path not in the working tree|bad revision/.test(t)) return 'bad-commit-target'
    if (/nothing to commit|no changes added to commit|nothing added to commit/.test(t)) return 'nothing-staged'
    // 词表收紧（对抗审查：原来只写 /hook/ 会把任何含 hook 字样的失败都算钩子）：必须真的是钩子拒绝。
    // exitCode === 0 已在函数开头排除，所以这里不用再判一次退出码。
    if (/pre-commit hook|commit-msg hook|prepare-commit-msg hook|hook declined|hook exited|hook failed|by a hook|husky|lint-staged/.test(t)) return 'hooks-failed'
    return 'unknown-write-failure'
  }
  if (op === 'pull') {
    if (/not possible to fast-forward|fatal: not possible to fast-forward/.test(t)) return 'non-fast-forward'
    if (/conflict|automatic merge failed|fix conflicts/.test(t)) return 'conflict'
    return 'unknown-write-failure'
  }
  if (op === 'push') {
    // 顺序有意义：先认「服务端拒绝」与「认证/权限」，再认快进，最后才回兜底。
    // 反面教材（对抗审查真样本）：`pre-receive hook declined` + `failed to push some refs` 曾经被
    // 兜底吞成 non-fast-forward，界面会说「远端有新提交，去合并/变基」——方向完全错。
    if (/remote rejected|hook declined|pre-receive|denied by|remote: error/.test(t)) return 'rejected-by-server'
    if (/authentication failed|could not read username|could not read password|permission denied|403 forbidden|terminal prompts disabled|invalid username or password/.test(t)) return 'auth-failed'
    if (/non-fast-forward|fetch first|rejected.*non-fast-forward/.test(t)) return 'non-fast-forward'
    // 兜底不再猜方向：`[rejected] / failed to push some refs` 是所有推送失败的公共横幅，
    // 单独出现时说不出是哪一种，就如实回兜底（话术带 git 原话）。
    return 'unknown-write-failure'
  }
  // 改动页（#1742）：这几条命令的失败原文很固定，能认出的就认出来，认不出如实回兜底带 git 原话。
  if (op === 'stage-hunks' || op === 'stage-file' || op === 'stage-all' || op === 'unstage') {
    if (/did not match any files|pathspec .* did not match|not under current directory/.test(t)) return 'bad-path'
    return 'unknown-write-failure'
  }
  if (op === 'discard-file' || op === 'discard-all') {
    if (/did not match any file\(s\) known to git|pathspec .* did not match/.test(t)) return 'nothing-to-do'
    return 'unknown-write-failure'
  }
  if (op === 'clean-untracked') {
    if (/no pathspec|did not match any files/.test(t)) return 'nothing-to-do'
    return 'unknown-write-failure'
  }
  if (op === 'rm-tracked' || op === 'rm-cached') {
    if (/has staged content different|has local modifications/.test(t)) return 'path-modified'
    if (/did not match any files|pathspec .* did not match/.test(t)) return 'nothing-to-do'
    return 'unknown-write-failure'
  }
  if (op === 'mv') {
    if (/destination exists|already exists/.test(t)) return 'path-exists'
    if (/bad source|not under version control|did not match any files/.test(t)) return 'bad-path'
    if (/has local modifications|staged content different/.test(t)) return 'path-modified'
    return 'unknown-write-failure'
  }
  return 'unknown-write-failure'
}

/** 票据 id 的形状：非空、≤64 字符、只允许 [A-Za-z0-9_-]。
 *  id 由宿主生成、客户端原样回传，所以它是**外部输入**：不合形状当场拒，不去查表、不起任何进程
 *  （威胁面 T13）。返回 null 表示形状没问题。 */
export function idShapeProblem(id: string): string | null {
  const s = String(id === undefined || id === null ? '' : id)
  if (s === '' || s.length > 64 || !/^[A-Za-z0-9_-]+$/.test(s)) return 'ticket-missing'
  return null
}

export const WRITE_REASONS_SOURCE = 'src/shared/version-control/src/write-reasons.ts'
