/**
 * backends/gitlab/queries.js — GitLab REST 查询 helpers（glab api 主路径）。
 *
 * 按 #135 取数路径总表 + #144 §一：REST为主，with_labels_details + milestone展开。
 */

export function projectPath(refId) {
  return `projects/${encodeURIComponent(refId)}`
}

export function issuesPath(refId, query = '') {
  const base = `${projectPath(refId)}/issues`
  return query ? `${base}?${query}` : base
}

export function issuePath(refId, iid) {
  return `${projectPath(refId)}/issues/${encodeURIComponent(String(iid))}`
}

export function notesPath(refId, iid) {
  return `${projectPath(refId)}/issues/${encodeURIComponent(String(iid))}/notes`
}

export function linksPath(refId, iid) {
  return `${projectPath(refId)}/issues/${encodeURIComponent(String(iid))}/links`
}

export function milestonesPath(refId, query = '') {
  const base = `${projectPath(refId)}/milestones`
  return query ? `${base}?${query}` : base
}

export const ISSUE_QUERY = 'with_labels_details=true'

export default { projectPath, issuesPath, issuePath, notesPath, linksPath, milestonesPath, ISSUE_QUERY }
