/**
 * tracker/detection/parseIssueTracker.js — 主锚结构化解析（~60 行骨架）
 *
 * 第一性原理（#149 R + #150 Q1/Q6 + 契约 §2 + #113 D1/D6）：
 *  - 主锚 = `docs/agents/issue-tracker.md`（技能集唯一后端指针；人读模板非机器配置，Q4 不回写）
 *  - 探测自身零 OS 直碰：本模块为纯函数（text→结构），不读 fs / process.env / path.join；
 *    I/O 由 explicitDetector 经 platform.fs 完成，双闸 I2 拦截直碰。
 *  - 契约 §2 capability-by-fill：解析只产「有/无」二分，不产能力表；结果作 explicit 分支输入（Q6 合并 #2&#3）
 *  - 轻量化二联骨架：本文件 + explicitDetector + detectionService = ~180 行先行（#150 Q2）
 *
 * 修复 #277（标题优先 + markdown 仅看标题行）：
 *  - 标题三者先互斥按 gitlab > markdown > github 收敛并以 high 返回，彻底阻断正文 markdown/.scratch 抢先
 *  - 正文关键词仅 low 兜底，且 markdown 正文不参与判定（正文含 markdown/.scratch 不再误切 markdown）
 *  - 旧文档无标题时仍可由 gitlab/github 正文兜底；markdown 无标题旧文档由 matches 阶段经 .scratch 目录探测（非 explicit）
 */

/**
 * 将 `docs/agents/issue-tracker.md` 文本结构化为显式后端声明。
 * @param {string|null|undefined} raw 主锚文本（BOM/字面 \\n 已在 normalizeBody 层处理，此处只做 Trim/BOM 清理）
 * @returns {{ explicitBackendId: string|null, rawHint: string, confidence: 'high'|'low'|'none', reason: string }}
 */
export function parseIssueTracker(raw) {
  const text = String(raw || '').replace(/^\uFEFF/, '').trim()
  if (!text) return { explicitBackendId: null, rawHint: '', confidence: 'none', reason: 'empty' }

  // 显式标题形态 `# Issue tracker: GitHub` 为 high 置信 — 仅标题行参与 high 判定
  const titleGithub = /^#\s*issue\s*tracker\s*:\s*github/im.test(text)
  const titleGitlab = /^#\s*issue\s*tracker\s*:\s*gitlab/im.test(text)
  const titleMarkdown = /^#\s*issue\s*tracker\s*:\s*(markdown|local)/im.test(text)

  // ── 第一阶段：标题优先（高置信），优先级 gitlab > markdown > github ──
  if (titleGitlab) {
    return { explicitBackendId: 'gitlab', rawHint: 'gitlab', confidence: 'high', reason: 'title-gitlab' }
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
  const hasGithub = /github/i.test(text)
  if (hasGithub) {
    const ghHint = /gh\s+(issue|api|auth)|github\s*issues/i.test(text)
    return { explicitBackendId: 'github', rawHint: 'github', confidence: 'low', reason: ghHint ? 'github-template' : 'keyword-github' }
  }

  return { explicitBackendId: null, rawHint: '', confidence: 'none', reason: 'no-keyword' }
}

/**
 * 小工具：对已读文本判空并去 BOM（与 host normalizeBody 互补）
 */
export function normalizeTrackerText(raw) {
  if (raw == null) return ''
  let s = String(raw).replace(/^\uFEFF/, '')
  // 字面 \\n 还原仅在大量字面换行聚类时才触发（与 host normalizeBody 同阈值）
  const realNL = (s.match(/\n/g) || []).length
  const literalNL = (s.match(/\\n/g) || []).length
  if (realNL < 2 && literalNL > 0) s = s.replace(/\\n/g, '\n')
  return s
}

export default parseIssueTracker
