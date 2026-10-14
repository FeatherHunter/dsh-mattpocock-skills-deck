/**
 * tests/tracker-contract/gitlab-endpoints.ts —— GitLab 房会发出去的那些请求，逐条登记（#1179）
 *
 * 这份表是 #1179 里「端点集合」那一半的真源：它列的是 **本房源码真的会发出去的请求**（方法 + 路径形状），
 * 每条还写清「采一次真样本要发什么」。两份东西同时读它：
 *
 *   一、门禁 `tests/verify-1179-gitlab-endpoint-coverage.ts` 从 `src/tracker/rooms/gitlab/**` 的源码里
 *       把请求形状抽出来，与这份表逐条对齐 —— 源码里新发一个请求而这里没登记，门禁当场红。
 *   二、生成脚本 `scripts/generate-gitlab-fixtures.ts` 照 `request` 那一格去要真回包。
 *
 * 形状的写法：每个变量位置写成 `{}`，字面量原样保留。所以
 * `projects/FeatherHunter%2Fdemo/issues/7/links` 记成 `projects/{}/issues/{}/links`。
 * 同一个形状出现在好几个文件里只登记一次 —— 端点说的是「请求长什么样」，不是「谁发的」。
 *
 * 为什么要有这份表（#1179 的由来）：本房对远端行为的认识全部来自官方文档，一次 `glab` 都没真跑过。
 * 契约测试把 `ctx.exec` 换成脚本化桩，桩照「我以为 GitLab 会这么回」写，实现照同一个信念写 ——
 * 信念错了两边一起错，断言照样全绿。这份表加真实固件，就是为了把那个信念换成真回话。
 */

/** 登记在册的一个端点。 */
export interface GitlabEndpointSpec {
  /** 稳定的短名：给固件文件命名，也在报告里点名。 */
  readonly id: string
  /** 大写的 HTTP 方法。glab 不写 `--method` 就是 GET，这里一律写出来才看得见。 */
  readonly method: string
  /** 规范化形状，例如 `projects/{}/issues/{}?with_labels_details=true`。 */
  readonly shape: string
  /**
   * 采一次真样本时要发的那条请求，占位符由生成脚本替换：
   * `{id}` 项目路径（已做百分号编码）、`{iid}` 地图那张样本工单、`{child}` 子样本工单、
   * `{link_id}` 关系编号、`{label_id}` 标签编号、`{username}` 登录名、`{page}` 页码。
   * 这一条这次不采就写 null，并在 skipReason 里说清为什么。
   */
  readonly request: string | null
  /** 要带上去的 `-f 键=值` 参数（POST/PUT 才有）；GET 一律不写。值里也可以用上面那些占位符。 */
  readonly fields?: readonly string[]
  /** request 为 null 时必须写：为什么这一条这次不采。 */
  readonly skipReason?: string
  /** 谁在什么情况下发这一条（给人看的一句话）。 */
  readonly note: string
}

/**
 * 本房源码真的会发出去的请求。顺序按「先认仓库、再读票、再写票、最后标签与里程碑」排，
 * 与人在房间里翻代码的顺序一致。
 */
export const GITLAB_ENDPOINTS: readonly GitlabEndpointSpec[] = [
  {
    id: 'project-get',
    method: 'GET',
    shape: 'projects/{}',
    request: 'projects/{id}',
    note: '探测这个工作区指向的仓库还在不在、读不读得到（选后端时的探测与 initProject 收尾确认都用它）',
  },
  {
    id: 'project-permissions',
    method: 'GET',
    shape: 'projects/{}?simple=true',
    request: 'projects/{id}?simple=true',
    note: 'getRepoPermissions：从 permissions 里读「能不能推」与「能不能整理别人的票」',
  },
  {
    id: 'current-user',
    method: 'GET',
    shape: 'user',
    request: 'user',
    note: 'getCurrentUser 认自己是谁；initProject 认该往哪个命名空间建仓库',
  },
  {
    id: 'user-by-username',
    method: 'GET',
    shape: 'users?username={}',
    request: 'users?username={username}',
    note: '指派票时把登录名换成数字用户编号（写 assignee_ids 要的是编号，不是名字）',
  },
  {
    id: 'issue-create',
    method: 'POST',
    shape: 'projects/{}/issues',
    request: 'projects/{id}/issues',
    fields: ['title=dsh-1179-sample-created', 'description=采样时新建的一张票（#1179），可以删。'],
    note: 'createIssue 建票',
  },
  {
    id: 'issues-list',
    method: 'GET',
    shape: 'projects/{}/issues?{}',
    request: 'projects/{id}/issues?scope=all&per_page=50',
    note: 'listIssues 与 listPage 读票清单；建票前也用它回查幂等锚有没有已经落下',
  },
  {
    id: 'issues-list-capped',
    method: 'GET',
    shape: 'projects/{}/issues?per_page=100',
    request: 'projects/{id}/issues?per_page=100',
    note: '读阻塞关系时要把全仓票拉一遍，一次要 100 条',
  },
  {
    id: 'issue-patch',
    method: 'PUT',
    shape: 'projects/{}/issues/{}',
    request: 'projects/{id}/issues/{child}',
    fields: ['add_labels=dsh-1179-sample'],
    note: '改票面：标题、正文、开关状态、标签、认领人、里程碑都走它',
  },
  {
    id: 'issue-get-with-labels',
    method: 'GET',
    shape: 'projects/{}/issues/{}?with_labels_details=true',
    request: 'projects/{id}/issues/{iid}?with_labels_details=true',
    note: '读票时把标签带上颜色与描述（不带这个参数拿回来的标签只有名字）',
  },
  {
    id: 'notes-list',
    method: 'GET',
    shape: 'projects/{}/issues/{}/notes',
    request: 'projects/{id}/issues/{iid}/notes?per_page=100',
    note: '读一张票的评论',
  },
  {
    id: 'note-create',
    method: 'POST',
    shape: 'projects/{}/issues/{}/notes',
    request: 'projects/{id}/issues/{iid}/notes',
    fields: ['body=dsh-1179-sample 采样写的一条评论（#1179），可以删。'],
    note: '往一张票上写一条评论',
  },
  {
    id: 'links-list',
    method: 'GET',
    shape: 'projects/{}/issues/{}/links',
    request: 'projects/{id}/issues/{child}/links',
    note: '读关系：本房把「父子」落成平级链接 relates_to，阻塞关系也走同一张表',
  },
  {
    id: 'link-create',
    method: 'POST',
    shape: 'projects/{}/issues/{}/links',
    request: 'projects/{id}/issues/{child}/links',
    fields: ['target_project_id={id}', 'target_issue_iid={iid}', 'link_type=relates_to'],
    note: '挂关系：setParent（relates_to）与 setBlockedBy（blocks）都从子票这一头发起',
  },
  {
    id: 'link-get',
    method: 'GET',
    shape: 'projects/{}/issues/{}/links/{}',
    request: 'projects/{id}/issues/{child}/links/{link_id}',
    note: '读一条关系自己的明细：只有这里能看出哪一头是发起方（source），方向住在明细里',
  },
  {
    id: 'link-delete',
    method: 'DELETE',
    shape: 'projects/{}/issues/{}/links/{}',
    request: 'projects/{id}/issues/{child}/links/{link_id}',
    note: '取消一条关系。注意：本房今天这一支疑似拿错了编号（列表行里的 id 是对面那张票，链接自己的编号在 issue_link_id），见 #1176',
  },
  {
    id: 'issue-statistics',
    method: 'GET',
    shape: 'projects/{}/issues_statistics?{}',
    request: 'projects/{id}/issues_statistics?scope=all',
    note: 'counts：一次拿到打开、关闭、全部三个数（回包字段叫 opened/closed/all，与契约的 open/closed/total 不同名）',
  },
  {
    id: 'labels-list',
    method: 'GET',
    shape: 'projects/{}/labels',
    request: 'projects/{id}/labels?per_page=100',
    note: '读标签全集（改标签颜色前后核对现状用）',
  },
  {
    id: 'labels-list-paged',
    method: 'GET',
    shape: 'projects/{}/labels?per_page={}&page={}&include_ancestor_groups=false',
    request: 'projects/{id}/labels?per_page=100&page=1&include_ancestor_groups=false',
    note: 'listLabels 翻页拉到底；短页（不足一页）就是最后一页',
  },
  {
    id: 'label-patch',
    method: 'PUT',
    shape: 'projects/{}/labels/{}',
    request: 'projects/{id}/labels/{label_id}',
    fields: ['color=#D9534F'],
    note: 'setLabelColors 改一个标签的颜色；颜色值要带前导井号',
  },
  {
    id: 'milestones-list',
    method: 'GET',
    shape: 'projects/{}/milestones?{}',
    request: 'projects/{id}/milestones?per_page=100',
    note: '读里程碑：本房的里程碑只是一格文字，写票时要先按名字找到它',
  },
]
