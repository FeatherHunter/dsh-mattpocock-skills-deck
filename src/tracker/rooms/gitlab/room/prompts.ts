/**
 * src/tracker/rooms/gitlab/room/prompts.ts —— 这一房交给契约注入与修复指引的提示文案。
 *
 * 为什么独立成文件：文案改动频繁，入口只负责装配；改一句话不该打开入口。
 * 安装与登录两条各有历史键名与通用键名（#1190）：glabInstallFix / cliInstall 是同一份文本，
 * glabLoginFix / cliLogin 是同一份文本。这里各只留一份常量，入口的 prompts 对象让四个键指向
 * 同一份值；值必须逐字不变，房外的提示词门禁会读这些文本。
 *
 * healthCheck 与 subIssue 两块**不在本文件**：它们留在入口 index.ts，因为
 * tests/verify-686-accept.ts 直接按路径读入口原文来抠这两块；要搬必须先改那道房外门禁。
 */

/** 这个后端自己的命令行名与站点名（提示词模板里的 {cli} / {cliBrand} 由这一格填）。 */
export const commandVocabulary = { cli: 'glab', cliBrand: 'GitLab' }

/**
 * 安装 glab 的指引：glabInstallFix 与 cliInstall 两个键共用这一份。
 * 文本逐字取自 #716 的原文，不润色、不改标点；官方安装说明只有那一处链接。
 */
export const glabInstallFix = {
  zh: '请为 DSH 安装 GitLab CLI（glab）。官方安装说明只有一处：https://docs.gitlab.com/cli/，按那一页的指引做，不要凭记忆写安装命令。\n1. 先检查：终端执行 glab --version；有版本号就直接汇报已装版本，不要重复安装；\n2. 没有 glab 时，打开上面那一页，按你的系统对应的那一节装；那一页打不开就如实说打不开，不要编命令；\n3. 装完请用户点「重查」；如果重查仍说找不到，先用绝对路径跑一次 glab --version 证明装好了，再请用户重启宿主（宿主只在启动时读 PATH）。',
  en: 'Install the GitLab CLI (glab) for DSH. The only official install guide is https://docs.gitlab.com/cli/ — follow that page, do not write install commands from memory.\n1. Check first: glab --version; if a version is reported, report it and do not reinstall;\n2. If missing, open the page above and follow the section for your OS; if the page cannot be opened, say so plainly and do not invent commands;\n3. After install, ask the user to re-check; if it still reports missing, prove the install with an absolute-path glab --version, then ask the user to restart the host (the host reads PATH only at startup).',
}

/**
 * 登录 glab 的指引：glabLoginFix 与 cliLogin 两个键共用这一份。
 * 文本逐字取自 #716 的原文；--hostname 那一句讲的是「只查这一台主机」，不能删。
 */
export const glabLoginFix = {
  zh: '请完成 glab 登录（glab auth login）：按向导选择 GitLab.com → HTTPS → 浏览器授权（OAuth）；完成后用 glab auth status --hostname <主机名> 验证这一台主机（不带 --hostname 会把其它已配置主机一起查，别的主机坏了会误报失败）；然后请用户点「重查」。',
  en: 'Complete glab login: glab auth login → GitLab.com → HTTPS → browser OAuth; verify this host with glab auth status --hostname <hostname> (without --hostname glab checks every configured host, so a broken unrelated host reports a false failure); then ask the user to re-check.',
}

/** 仓库没认出来时给用户的修复指引：先问意图，再走「本地 Markdown」或核对 remote 两条路。 */
export const glabRepoFix = {
  zh: '当前工作区未解析出 GitLab 仓库（glab 无法定位 owner/project）。请先向用户确认意图：\nA. 本地项目（不需要 GitLab）→ 切换到「本地 Markdown」后端；\nB. 确实要用 GitLab → 核对 remote 指向（git remote get-url origin / glab config），或 glab repo create 创建并关联；\n完成后请用户点「重查」。',
  en: 'No GitLab repository resolved for the current workspace. Confirm intent: A. local project → switch to "Local Markdown"; B. GitLab really wanted → verify the remote (git remote get-url origin / glab config), or create/associate via glab repo create; then ask the user to re-check.',
}
