/**
 * backends/gitlab/queries.ts — GitLab REST 查询 helpers（glab api 主路径）。
 *
 * 按 #135 取数路径总表 + #144 §一：REST为主，with_labels_details + milestone展开。
 */

// 项目路径要做一次编码，是因为 refId 里那道斜杠是仓库名的一部分，不是路径分隔符，不编码远端会认错仓库。
export function projectPath(refId: string): string {
  return `projects/${encodeURIComponent(refId)}`
}

// 列表路径带查询串时才拼问号，是为了不带条件时不给远端一个空问号，保持与原来一致的可缓存形状。
export function issuesPath(refId: string, query = ''): string {
  const base = `${projectPath(refId)}/issues`
  return query ? `${base}?${query}` : base
}

// 单票路径把编号先转成字符串再编码，是因为调用方可能传数字编号，直接编码数字会丢前导零以外的东西不如先统一成串。
export function issuePath(refId: string, iid: string | number): string {
  return `${projectPath(refId)}/issues/${encodeURIComponent(String(iid))}`
}

// 评论与关联路径都挂在单票下面，是因为 GitLab 的 notes 与 links 都是票的子资源，换地方远端就不认了。
export function notesPath(refId: string, iid: string | number): string {
  return `${projectPath(refId)}/issues/${encodeURIComponent(String(iid))}/notes`
}

export function linksPath(refId: string, iid: string | number): string {
  return `${projectPath(refId)}/issues/${encodeURIComponent(String(iid))}/links`
}

export function milestonesPath(refId: string, query = ''): string {
  const base = `${projectPath(refId)}/milestones`
  return query ? `${base}?${query}` : base
}

export const ISSUE_QUERY: string = 'with_labels_details=true'

export default { projectPath, issuesPath, issuePath, notesPath, linksPath, milestonesPath, ISSUE_QUERY }
