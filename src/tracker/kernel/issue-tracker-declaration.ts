// src/tracker/kernel/issue-tracker-declaration.ts —— 主锚 docs/agents/issue-tracker.md 的结构化解析（纯函数）。
//
// 为什么住在内核（#1555）：这份解析有两个读者 —— 判定层（explicitDetector / backendDecision）与
// 后端房间的认领（GitLab 的 matches 要判断「这份文件声明的是不是 GitLab」）。房间只许引内核与契约，
// 所以它从 detection/ 搬进 kernel/；detection/parseIssueTracker.ts 留成转出口，旧引用一条都不用改。
// 判定层与房间因此共用同一套「什么算声明」的口径，不会各写一份正则、各说一套。
//
// 第一性原理（#149 R + #150 Q1/Q6 + 契约 §2 + #113 D1/D6）：
//  - 主锚 = docs/agents/issue-tracker.md（技能集唯一后端指针；人读模板非机器配置，Q4 不回写）
//  - 本模块为纯函数（text→结构）：不读 fs、不碰 process.env / path.join、不抛；
//    I/O 由调用方经 platform.fs 完成。
//  - 契约 §2 capability-by-fill：解析只产「有/无」二分，不产能力表。
//
// #2 Gitea/Forgejo 注册（标题优先口径与上面三个词一致）：标题 gitea/forgejo 判 high，互斥顺序 gitlab > gitea > markdown > github；
// 注意：这套顺序只管「标题里同时出现多个后端名时，解析器按谁拿 high 收敛」，与 backendDecision.ts 的 MULTI_CLAIM_ORDER（多房同时认领时的裁剪顺序）是两套各管各的顺序，不要混为一谈。
// 正文关键词 gitea/forgejo/tea 走 low 兜底（explicitBackendId 交 'gitea'，与标题同一间房）。
//
// 修复 #277（标题优先 + markdown 仅看标题行）：
//  - 标题三者先互斥按 gitlab > markdown > github 收敛并以 high 返回，彻底阻断正文 markdown/.scratch 抢先
//  - 正文关键词仅 low 兜底，且 markdown 正文不参与判定（正文含 markdown/.scratch 不再误切 markdown）
//  - 旧文档无标题时仍可由 gitlab/github 正文兜底；markdown 无标题旧文档由 matches 阶段经 .scratch 目录探测（非 explicit）
//
// #1555 补一条给调用方的约定（不改本文件的解析结果）：matches 这类「身份认领」只认 high（标准标题行），
// 不拿 low 的正文兜底去参与多命中；low 兜底留给判定层用 —— 判定层本来就排在自动识别之前，
// 不需要认领再猜一遍。为什么不能让 low 参与认领：正文里只要出现一次 gitlab 字样就会被拉进多命中，
// 那正是这张票的真机现场。

/** 主锚解析结果：显式后端声明加判据说明。调用方只读 backendId 与置信度，其余供排查。 */
export interface ParsedIssueTracker {
  explicitBackendId: string | null
  rawHint: string
  confidence: 'high' | 'low' | 'none'
  reason: string
}

/**
 * 将 docs/agents/issue-tracker.md 文本结构化为显式后端声明。
 * 入参收成未知值：上游读文件可能交来空值，内部统一转成字符串再判。
 * @param raw 主锚文本（BOM/字面 \n 已由 normalizeTrackerText 处理，此处只做 Trim/BOM 清理）
 */
export function parseIssueTracker(raw: unknown): ParsedIssueTracker {
  const text = String(raw || '').replace(/^\uFEFF/, '').trim()
  if (!text) return { explicitBackendId: null, rawHint: '', confidence: 'none', reason: 'empty' }

  // 显式标题形态 `# Issue tracker: GitHub` 为 high 置信 — 仅标题行参与 high 判定
  const titleGithub = /^#\s*issue\s*tracker\s*:\s*github/im.test(text)
  const titleGitlab = /^#\s*issue\s*tracker\s*:\s*gitlab/im.test(text)
  // #2 Gitea/Forgejo：两个词指同一家软件（Forgejo 是 Gitea 的分支），标题同判 gitea 高置信；
  // 互斥顺序按既有语义排在 gitlab 之后、markdown 之前（改这行就得同时看 verify-detection-cascade 与 evidence 两扇门禁）。
  const titleGitea = /^#\s*issue\s*tracker\s*:\s*(gitea|forgejo)/im.test(text)
  const titleMarkdown = /^#\s*issue\s*tracker\s*:\s*(markdown|local)/im.test(text)

  // ── 第一阶段：标题优先（高置信），优先级 gitlab > markdown > github ──
  if (titleGitlab) {
    return { explicitBackendId: 'gitlab', rawHint: 'gitlab', confidence: 'high', reason: 'title-gitlab' }
  }
  if (titleGitea) {
    return { explicitBackendId: 'gitea', rawHint: 'gitea', confidence: 'high', reason: 'title-gitea' }
  }
  if (titleMarkdown) {
    return { explicitBackendId: 'markdown', rawHint: 'markdown', confidence: 'high', reason: 'title-markdown' }
  }
  if (titleGithub) {
    const ghHint = /gh\s+(issue|api|auth)|github\s*issues/i.test(text)
    return { explicitBackendId: 'github', rawHint: 'github', confidence: 'high', reason: ghHint ? 'github-template' : 'title-github' }
  }

  // ── 第二阶段：标题均未命中时，正文关键词 low 兜底 ──
  // markdown 正文关键词已按 #277 建议彻底忽略（仅看标题行），避免 "# Issue tracker: GitHub" + 正文 markdown/.scratch 误判；
  // markdown 旧文档无标题时由 matches 阶段经 .scratch 目录探测，无需 explicit 低兜底。
  const hasGitlab = /gitlab/i.test(text)
  if (hasGitlab) {
    return { explicitBackendId: 'gitlab', rawHint: 'gitlab', confidence: 'low', reason: 'keyword-gitlab' }
  }
  // #2 正文 low 兜底：gitea / forgejo / tea 三个词都指同一家，排在 gitlab 之后、github 之前
  //（tea 只认独立词，避免误伤正文里恰好含 tea 字样的其他内容）。
  const hasGitea = /gitea|forgejo|\btea\b/i.test(text)
  if (hasGitea) {
    return { explicitBackendId: 'gitea', rawHint: 'gitea', confidence: 'low', reason: 'keyword-gitea' }
  }
  const hasGithub = /github/i.test(text)
  if (hasGithub) {
    const ghHint = /gh\s+(issue|api|auth)|github\s*issues/i.test(text)
    return { explicitBackendId: 'github', rawHint: 'github', confidence: 'low', reason: ghHint ? 'github-template' : 'keyword-github' }
  }

  return { explicitBackendId: null, rawHint: '', confidence: 'none', reason: 'no-keyword' }
}

// ── 票 #5：prose 工作流的判别（未知后端声明 + 可辨识工作流结构 → prose-tracker-unsupported）──
// 这两个纯函数只负责「认得出」：标题里声明了一个插件未收录的后端名，正文里看得出一份
// prose 工作流约定。要不要判成独立状态由判定层（backendDecision）决定；这里不引用注册表，
// 所以「已收录 / 未收录」的口径只有判定层那一份。

/**
 * 从主锚文本里抽出标题声明的后端名（形如 `# Issue tracker: Jira`）。
 * 为什么单独抽：parseIssueTracker 只认识收录名单里的名字，遇到名单外的名字直接判 no-keyword；
 * 票 #5 要求把「声明了但没收录」这种情况与「什么都没声明」分开，所以先把名字原样带出来，
 * 收不收录交给判定层比名单。全角冒号兼容（人在中文环境里常写成「：」）；名字剥掉引用号、
 * 反引号、加粗星号与首尾空白后为空时按没声明处理（回 null），不产出一个空名字。
 */
export function parseDeclaredBackendTitle(raw: unknown): { name: string } | null {
  const text = String(raw || '').replace(/^﻿/, '')
  const m = /^#{1,6}\s*issue\s*tracker\s*[:：]\s*(.+)$/im.exec(text)
  if (!m) return null
  const name = m[1].replace(/[\u0060'"*\s]+/g, '').trim()
  return name ? { name } : null
}

/**
 * 判断主锚正文里能不能认出一份 prose 工作流约定。认得出时回命中的规则名，认不出回 null。
 * 三条规则的口径（票 #5 定版，正文含任一即算有效）：
 *  - blocked-by-section：有 `## Blocked by` 一类的依赖段标题 —— deck 票结构的标志性段落；
 *  - ticket-structure-section：有「目的 / 进度 / 维护者原话 / parent / 父票」开头的段标题 ——
 *    本仓库 deck 工单正文的固定骨架，散文里几乎不会平白写出这一组词；
 *  - operation-line：同一行里既提到 issue 或票、又出现创建/列出/关闭/指派这类操作动词 ——
 *    典型的「怎么操作工单」约定句。
 * 三条都只认结构性的写法，避免把一句闲聊当成工作流约定（反例由门禁钉住）。
 */
export function checkProseWorkflow(raw: unknown): string | null {
  const text = String(raw || '')
  if (/^#{1,6}\s*blocked\s*by\b/im.test(text)) return 'blocked-by-section'
  // 段标题的词尾不加 \b：中文字符不是「词字符」，\b 在中文词尾永远不成立（正例会被它吃掉）；
  // 拉丁词（parent）另用「后面不跟字母」来收尾，避免误吃 parenthesis 这类词。
  if (/^#{1,6}\s*(目的|进度|维护者原话|父票)(?![A-Za-z])|^#{1,6}\s*parent\b/im.test(text)) return 'ticket-structure-section'
  const lines = text.split(/\n/)
  for (const line of lines) {
    if (/\bissue\b|票/.test(line) && /创建|新建|列出|关闭|指派|\bcreate\b|\blist\b|\bclose\b|\bassign\b/i.test(line)) {
      return 'operation-line'
    }
  }
  return null
}

/**
 * 小工具：对已读文本判空并去 BOM（与 host normalizeBody 互补）。
 * 入参收成未知值：空值统一按空串处理，不抛异常。
 */
export function normalizeTrackerText(raw: unknown): string {
  if (raw == null) return ''
  let s = String(raw).replace(/^\uFEFF/, '')
  // 字面 \n 还原仅在大量字面换行聚类时才触发（与 host normalizeBody 同阈值）
  const realNL = (s.match(/\n/g) || []).length
  const literalNL = (s.match(/\\n/g) || []).length
  if (realNL < 2 && literalNL > 0) s = s.replace(/\\n/g, '\n')
  return s
}

export default parseIssueTracker
