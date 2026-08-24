/**
 * tracker/detection/parseIssueTracker.js — 主锚结构化解析（~60 行骨架）
 *
 * 第一性原理（#149 R + #150 Q1/Q6 + 契约 §2 + #113 D1/D6）：
 *  - 主锚 = `docs/agents/issue-tracker.md`（技能集唯一后端指针；人读模板非机器配置，Q4 不回写）
 *  - 探测自身零 OS 直碰：本模块为纯函数（text→结构），不读 fs / process.env / path.join；
 *    I/O 由 explicitDetector 经 platform.fs 完成，双闸 I2 拦截直碰。
 *  - 契约 §2 capability-by-fill：解析只产「有/无」二分，不产能力表；结果作 explicit 分支输入（Q6 合并 #2&#3）
 *  - 轻量化二联骨架：本文件 + explicitDetector + detectionService = ~180 行先行（#150 Q2）
 */

 /**
  * 将 `docs/agents/issue-tracker.md` 文本结构化为显式后端声明。
  * @param {string|null|undefined} raw 主锚文本（BOM/字面 \n 已在 normalizeBody 层处理，此处只做 Trim/BOM 清理）
  * @returns {{ explicitBackendId: string|null, rawHint: string, confidence: 'high'|'low'|'none', reason: string }}
  */
export function parseIssueTracker(raw) {
  const text = String(raw || '').replace(/^\uFEFF/, '').trim()
  if (!text) return { explicitBackendId: null, rawHint: '', confidence: 'none', reason: 'empty' }
  const lower = text.toLowerCase()
  const hasGitlab = /gitlab/i.test(text)
  const hasMarkdown = /markdown|\.scratch/i.test(text)
  const hasGithub = /github/i.test(text)
  // 显式标题形态 `# Issue tracker: GitHub` 为 high 置信，其余关键词命中为 low
  const titleGithub = /^#\s*issue\s*tracker\s*:\s*github/im.test(text)
  const titleGitlab = /^#\s*issue\s*tracker\s*:\s*gitlab/im.test(text)
  const titleMarkdown = /^#\s*issue\s*tracker\s*:\s*(markdown|local)/im.test(text)

  if (titleGitlab || hasGitlab) {
    const conf = titleGitlab ? 'high' : 'low'
    return { explicitBackendId: 'gitlab', rawHint: 'gitlab', confidence: conf, reason: hasGitlab ? 'keyword-gitlab' : 'title-gitlab' }
  }
  if (titleMarkdown || hasMarkdown) {
    // markdown 可能与 github 关键词并存（如 docs 提及迁移），优先 markdown
    if (hasMarkdown) {
      const conf = titleMarkdown ? 'high' : 'low'
      return { explicitBackendId: 'markdown', rawHint: 'markdown', confidence: conf, reason: 'keyword-markdown' }
    }
  }
  if (titleGithub || hasGithub) {
    // `checkTracker` 双 regex 的等价强化：同时含 `github` 与 `gh (issue|api|auth)` 为 github 模板
    const ghHint = /gh\s+(issue|api|auth)|github\s*issues/i.test(text)
    const conf = (titleGithub && ghHint) ? 'high' : (titleGithub ? 'high' : (ghHint ? 'low' : 'low'))
    return { explicitBackendId: 'github', rawHint: 'github', confidence: conf, reason: ghHint ? 'github-template' : 'keyword-github' }
  }
  return { explicitBackendId: null, rawHint: '', confidence: 'none', reason: 'no-keyword' }
}

/**
 * 小工具：对已读文本判空并去 BOM（与 host normalizeBody 互补）
 */
export function normalizeTrackerText(raw) {
  if (raw == null) return ''
  let s = String(raw).replace(/^\uFEFF/, '')
  // 字面 \n 还原仅在大量字面换行聚类时才触发（与 host normalizeBody 同阈值）
  const realNL = (s.match(/\n/g) || []).length
  const literalNL = (s.match(/\\n/g) || []).length
  if (realNL < 2 && literalNL > 0) s = s.replace(/\\n/g, '\n')
  return s
}

export default parseIssueTracker
