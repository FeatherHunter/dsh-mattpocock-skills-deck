/**
 * src/tracker/rooms/gitlab/room/prompts.ts —— 这一房交给契约注入、修复指引与体检的提示文案（#1907 收口）。
 *
 * 为什么独立成文件：提示文案改动频繁，入口只负责装配；改一句话不该打开入口。
 *
 * 两对历史别名共用一份文本：glabInstallFix / cliInstall 同文（#1190 的通用键与旧键），
 * glabLoginFix / cliLogin 同文。文本只在下面的 glabInstallCopy / glabLoginCopy 各写一份，
 * prompts 里的四个键用展开语法指向它；值逐字不变，运行时是四个形状相同的对象。
 *
 * healthCheck 与 subIssue 也在这里：房外门禁 tests/verify-686-accept.ts 与 tests/verify-prompts.ts
 * 已改成读本文件（而不是入口 index.ts），入口只 re-export 本文件交出的 prompts。
 *
 * 不要把这四个键的文本再抄回入口：入口不再有自己的文案，房外门禁按本文件扫描。
 */

const glabInstallCopy = {
    zh: '请为 DSH 安装 GitLab CLI（glab）。官方安装说明只有一处：https://docs.gitlab.com/cli/，按那一页的指引做，不要凭记忆写安装命令。\n1. 先检查：终端执行 glab --version；有版本号就直接汇报已装版本，不要重复安装；\n2. 没有 glab 时，打开上面那一页，按你的系统对应的那一节装；那一页打不开就如实说打不开，不要编命令；\n3. 装完请用户点「重查」；如果重查仍说找不到，先用绝对路径跑一次 glab --version 证明装好了，再请用户重启宿主（宿主只在启动时读 PATH）。',
    en: 'Install the GitLab CLI (glab) for DSH. The only official install guide is https://docs.gitlab.com/cli/ — follow that page, do not write install commands from memory.\n1. Check first: glab --version; if a version is reported, report it and do not reinstall;\n2. If missing, open the page above and follow the section for your OS; if the page cannot be opened, say so plainly and do not invent commands;\n3. After install, ask the user to re-check; if it still reports missing, prove the install with an absolute-path glab --version, then ask the user to restart the host (the host reads PATH only at startup).',
  }

const glabLoginCopy = {
    zh: '请完成 glab 登录（glab auth login）：按向导选择 GitLab.com → HTTPS → 浏览器授权（OAuth）；完成后用 glab auth status --hostname <主机名> 验证这一台主机（不带 --hostname 会把其它已配置主机一起查，别的主机坏了会误报失败）；然后请用户点「重查」。',
    en: 'Complete glab login: glab auth login → GitLab.com → HTTPS → browser OAuth; verify this host with glab auth status --hostname <hostname> (without --hostname glab checks every configured host, so a broken unrelated host reports a false failure); then ask the user to re-check.',
  }

/** 这一房交给契约注入与修复指引的全部提示文案；键名是对外契约，不能改名。 */
export const prompts = {
  commandVocabulary: { cli: 'glab', cliBrand: 'GitLab' },
  glabInstallFix: { ...glabInstallCopy },
  glabLoginFix: { ...glabLoginCopy },
  cliInstall: { ...glabInstallCopy },
  cliLogin: { ...glabLoginCopy },
  glabRepoFix: {
    zh: '当前工作区未解析出 GitLab 仓库（glab 无法定位 owner/project）。请先向用户确认意图：\nA. 本地项目（不需要 GitLab）→ 切换到「本地 Markdown」后端；\nB. 确实要用 GitLab → 核对 remote 指向（git remote get-url origin / glab config），或 glab repo create 创建并关联；\n完成后请用户点「重查」。',
    en: 'No GitLab repository resolved for the current workspace. Confirm intent: A. local project → switch to "Local Markdown"; B. GitLab really wanted → verify the remote (git remote get-url origin / glab config), or create/associate via glab repo create; then ask the user to re-check.',
  },
  subIssue: {
    // 2026-09 修正：旧文案让 agent 执行 setParent(map.key) / list({parentKey})，但宿主侧没有这些 agent tool —— 照做不到。
    //   改成这个后端真的能做的动作：在 map 文件的任务清单里引用子票。
    // #716 两处改正：
    //   ① 建边与校验已经搬进契约层的 deck_map_link / deck_map_snapshot，所以这里只讲用哪个工具，不留裸命令；
    //   ② 原先这段写「建原生父子边」，与本后端的实现不符 —— setParent 落下去的是票文件头的
    //      隐藏标记 `<!-- DSH-PARENT: <地图> -->`（见 graph/membership.ts），不是原生父子边。以契约为准，文案同步改正。
    // #1176 之后补正（2026-10-15，来自对抗式审查）：原先这里写「GitLab 上没有原生父子关系」，这句是错的
    //   —— 平台有原生的父子层级（官方有整页在讲「Child items」，免费档就有），只是它在 work items 那条路上，
    //   入口是界面与 GraphQL；本房取数一律走 glab api 的 REST issue links，而那个接口的 link_type 只有
    //   relates_to / blocks / is_blocked_by 三种，没有表示层级的那一种。所以准确的说法是「本房这条 REST 路
    //   拿不到层级边」，不是「GitLab 做不到」。差别要留住：读的人据此才能判断要不要另开一票走 GraphQL。
    zh: '建边用 deck_map_link：父子边传 parentKey、阻塞边传 blockedBy。要注意本后端的能力边界 —— 父子边不走接口，落在票文件头的隐藏标记 <!-- DSH-PARENT: <地图> -->（读回走契约的父子列）。GitLab 平台本身有原生父子层级，但它在 work items 那条路上（入口是界面与 GraphQL），本房不走那条；要远端认的层级得另开一票换成 GraphQL。阻塞边走原生 is_blocked_by：有能力就真写、写后读回核对；免费档拿不到原生能力时，工具回落到正文的成对降级写法（可见行 + 隐藏机器表）。建完用 deck_map_snapshot 读回地图，核对子票张数与预期一致。',
    en: 'Wire edges with deck_map_link: parentKey for the parent-child edge, blockedBy for blocking edges. Mind this backend\'s limit — the parent-child edge does not go through the API; it lands as a hidden <!-- DSH-PARENT: <map> --> marker in the ticket header (read back through the contract parent column). GitLab itself does have a native parent-child hierarchy, but it lives on the work-items path (reached through the UI and GraphQL), which this backend does not use; a remotely-recognised hierarchy would be a new capability on GraphQL. Blocking edges use native is_blocked_by: written for real with read-back verification when capable; on the free tier without native capability the tool falls back to the paired body fallback (a visible line plus a hidden machine table). Then read the map back with deck_map_snapshot and confirm the child count matches the plan.',
  },
  healthCheck: {
    zh: '**游离的开放票**在这条后端上的落地口径：这张票**没有关闭**、**自己不是地图**、**不在任何地图的子票里** —— 与另一条远端后端同一套（两个后端的票仓结构本来就是同一套：地图 + 子议题 + 阻塞边）。\n\n**动手时只做两件结构动作**，都走工具：\n1. 建边，把票挂到合适的地图下：deck_map_link 的 parentKey；\n2. 为人点过头的票开一张新地图：deck_map_plan_create 先写最小的 Destination 草稿。\n\n**本后端做不到的地方，如实写出来**：父子边落在票正文顶部的 Part of #<地图> 声明行（原生层级在 work items 那条路上，本房不走），解析率也还没用真仓库量过 —— 动手之前先量一次，量与不出来的原因都写进报告，**不要硬来**。\n\n**不碰**：已关闭的票、任何票的标题与正文、标签与认领状态、别的仓库；不关票、不删评论、不改源码、不发版、不提交。\n\n报告按标签与建议类型分区，但体检的范围是全部开放票、不跟随面板当前的筛选。',
    en: '**How "orphaned open ticket" lands on this backend**: the ticket is **not closed**, it is **not itself a map**, and it is **not inside any map as a sub-ticket** — the same rules as the other remote backend (both backends share one ticket-store shape: maps + sub-tickets + blocking edges).\n\n**When acting, only two structural actions**, both through the tools:\n1. Wire the edge that attaches the ticket under a suitable map: deck_map_link with parentKey;\n2. Open a new map for a ticket the human has nodded on: deck_map_plan_create, writing only the minimal Destination draft.\n\n**State plainly what this backend cannot do**: the parent-child edge lands as a Part of #<map> declaration line at the top of the ticket body (the native hierarchy lives on the work-items path, which this backend does not use); its resolution rate has not been measured against a real repository yet — measure once before acting, write both the measurement and any reason it fails into the report, and **do not force it**.\n\n**Never touch**: closed tickets, any ticket title or body, labels and claim state, other repositories; do not close tickets, delete comments, change source code, publish a release, or commit.',
  },
}
