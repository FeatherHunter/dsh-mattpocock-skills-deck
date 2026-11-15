/**
 * src/tracker/rooms/gitea/room/prompts.ts — 这一房交给契约注入与修复指引的提示文案。
 *
 * 为什么独立成文件：与 GitLab 房同一理由 —— 提示文案改动频繁，入口只负责装配；
 * 改一句话不该打开入口。
 *
 * 两类文案：
 *   · 命令词汇表与安装/登录指引（commandVocabulary / cliInstall / cliLogin）；
 *   · 错误三档的修复指引（cliAuthFix / cliRepoFix / cliNetworkFix）与命令映射（commandMap）：
 *     错误判档给出「这一档该怎么走」之后，把可操作的命令原样交给人——
 *     只写对应执行器实测有的命令面，不编不存在的命令。
 *
 * 票 #24（规格 #19 收尾）：上面六条文案各有 gt / tea 两套，按 preflight 选中的执行器注入
 * （规格决策 Q4 / 实现决策 4/5）。两套的分工：
 *   · tea 套是基点 4847e95b 的原文，一个字不动（用户故事 12：tea 路径零影响；
 *     逐字一致的基准钉在 tests/verify-gitea-gt-prompts.ts 里）；
 *   · gt 套按票 #20 真机核对与 gt 1.2.0 实测的命令面写。安装指引以装 gt 为主，
 *     写明 gt 与 tea 配置互不迁移（gt 用自己的 ~/.config/gitea-cli/，不读 tea 的配置，
 *     切 gt 必须重新 gt auth login），并附一句「服务器低于 Gitea 28 才需要 tea」。
 */

const teaInstallCopy = {
  zh: '请为 DSH 安装 Gitea CLI（tea）。官方安装说明只有一处：https://gitea.com/gitea/tea，按那一页的指引做，不要凭记忆写安装命令。\n1. 先检查：终端执行 tea --version；有版本号就直接汇报已装版本，不要重复安装；\n2. 没有 tea 时，打开上面那一页，按你的系统对应的那一节装；那一页打不开就如实说打不开，不要编命令；\n3. 装完请用户点「重查」；如果重查仍说找不到，请用户重启宿主（宿主只在启动时读 PATH）。',
  en: 'Install the Gitea CLI (tea) for DSH. The only official source is https://gitea.com/gitea/tea — follow that page, do not write install commands from memory.\n1. Check first: tea --version; if a version is reported, report it and do not reinstall;\n2. If missing, open the page above and follow the section for your OS; if the page cannot be opened, say so plainly and do not invent commands;\n3. After install, ask the user to re-check; if it still reports missing, ask the user to restart the host (the host reads PATH only at startup).',
}

const teaLoginCopy = {
  zh: '请完成 tea 登录：终端执行 tea login add，按向导填入 Gitea 实例地址与访问令牌；完成后用 tea login list 验证至少有一个登录项，然后请用户点「重查」。',
  en: 'Complete tea login: run tea login add and follow the wizard with your Gitea instance URL and access token; verify with tea login list that at least one login exists, then ask the user to re-check.',
}

// 错误三档的修复指引：文案与 errors.ts 的判档一一对应（AUTH 两句原话 → cliAuthFix，
// NOT-FOUND 的「仓库不存在」→ cliRepoFix，NETWORK 兜底 → cliNetworkFix）。
const teaAuthFixCopy = {
  zh: 'tea 没有可用的登录凭据：终端执行 tea login add，按向导填入 Gitea 实例地址与访问令牌；完成后用 tea login list 确认登录项在列（自托管实例要确认地址写的是同一个实例），然后请用户点「重查」。',
  en: 'tea has no usable credentials: run tea login add and follow the wizard with your Gitea instance URL and access token; confirm with tea login list that a login exists (for a self-hosted instance, make sure the URL points at the same instance), then ask the user to re-check.',
}

const teaRepoFixCopy = {
  zh: 'tea 找不到这个仓库：先核对 owner/repo 的写法与实例地址是否正确（tea login list 看当前登录的是哪个实例）；用 tea issues ls 验证这个仓库确实列得出票——列不出说明仓库名写错、仓库不存在，或当前账号没有这个仓库的读权限。',
  en: 'tea cannot find this repository: verify the owner/repo spelling and the instance URL (tea login list shows which instance you are logged in to); run tea issues ls to confirm the repository actually lists issues — if it does not, the repo name is wrong, the repository does not exist, or the current account lacks read access.',
}

const teaNetworkFixCopy = {
  zh: '连不上 Gitea 实例：先用浏览器或 curl 确认实例地址现在可达（自托管实例常见是内网地址、VPN 没连或服务停了）；确认可达之后再重试一次，还是失败就把原始报错原文贴出来，不要凭记忆猜原因。',
  en: 'Cannot reach the Gitea instance: first confirm the instance URL is reachable right now with a browser or curl (self-hosted instances are commonly behind an intranet, a disconnected VPN, or a stopped service); retry once after confirming reachability, and if it still fails, paste the original error text instead of guessing the cause.',
}

// tea 命令映射：把契约操作名对到 tea 实测存在的命令面上，注入提示词用它，出错指引也引用同一批命令。
const teaCommandMapCopy = {
  zh: '本项目的票务通过 Gitea CLI（tea）操作，命令映射如下——建票：tea issues create；列票：tea issues ls（即 tea issues list）；看单张票：tea issues <编号>；看评论：tea issues <编号> comments；关票：tea issues close <编号>；给票加标签或认领：tea issues edit <编号> --add-labels/--add-assignees；标签管理：tea labels create / tea labels ls（即 tea labels list）。没有的命令（例如拆分父子、设置阻塞）tea 不提供，不要编造写法。',
  en: 'Issue tracking in this project goes through the Gitea CLI (tea); the command map: create an issue with tea issues create; list issues with tea issues ls (aka tea issues list); view one issue with tea issues <number>; view comments with tea issues <number> comments; close an issue with tea issues close <number>; add labels or assignees with tea issues edit <number> --add-labels/--add-assignees; manage labels with tea labels create / tea labels ls (aka tea labels list). tea offers no commands for parent/child splitting or blocking — do not invent syntax.',
}

// ---- gt 套（票 #24）。命令写法只收票 #20 真机核对 + 2026-11-15 本机 gt 1.2.0 实测有的命令面：
// gt issue create/list/view/comment/close/reopen/edit、gt label list/create/edit、gt auth login/status。
// gt 只支持 Gitea 28 及以上实例，且配置与 tea 互不迁移（~/.config/gitea-cli/）——这两点写进文案。

const gtInstallCopy = {
  zh: '请为 DSH 安装 Gitea CLI（gt）。官方安装说明只有一处：https://gitea.com/gitea/cli，按那一页的指引做，不要凭记忆写安装命令。\n1. 先检查：终端执行 gt --version；有版本号就直接汇报已装版本，不要重复安装；\n2. 没有 gt 时，打开上面那一页，按你的系统对应的那一节装；那一页打不开就如实说打不开，不要编命令；\n3. 注意：gt 与 tea 配置互不迁移（gt 用自己的 ~/.config/gitea-cli/，不读 tea 的配置），之前登录过 tea 不算数，装完要重新执行 gt auth login；\n4. gt 只支持 Gitea 28 及以上的实例——仅当你的 Gitea 服务器版本低于 28 时才需要改用 tea（https://gitea.com/gitea/tea）；\n5. 装完请用户点「重查」；如果重查仍说找不到，请用户重启宿主（宿主只在启动时读 PATH）。',
  en: 'Install the Gitea CLI (gt) for DSH. The only official source is https://gitea.com/gitea/cli — follow that page, do not write install commands from memory.\n1. Check first: gt --version; if a version is reported, report it and do not reinstall;\n2. If missing, open the page above and follow the section for your OS; if the page cannot be opened, say so plainly and do not invent commands;\n3. Note: gt and tea configurations are not migrated between each other (gt uses its own ~/.config/gitea-cli/ and does not read tea\u2019s configuration); a previous tea login does not count — run gt auth login again after installing;\n4. gt only supports Gitea 28 and newer instances — only if your Gitea server version is below 28 do you need tea instead (https://gitea.com/gitea/tea);\n5. After install, ask the user to re-check; if it still reports missing, ask the user to restart the host (the host reads PATH only at startup).',
}

const gtLoginCopy = {
  zh: '请完成 gt 登录：终端执行 gt auth login，按向导填入 Gitea 实例地址与访问令牌（或走 OAuth 浏览器授权）；完成后用 gt auth status 验证至少有一个登录项，然后请用户点「重查」。gt 与 tea 配置互不迁移，之前 tea 登录过不算数。',
  en: 'Complete gt login: run gt auth login and follow the wizard with your Gitea instance URL and access token (or OAuth browser authorization); verify with gt auth status that at least one login exists, then ask the user to re-check. gt and tea configurations are not migrated between each other — a previous tea login does not count.',
}

const gtAuthFixCopy = {
  zh: 'gt 没有可用的登录凭据：终端执行 gt auth login，按向导填入 Gitea 实例地址与访问令牌；完成后用 gt auth status 确认登录项在列（自托管实例要确认地址写的是同一个实例），然后请用户点「重查」。gt 与 tea 配置互不迁移（gt 用自己的 ~/.config/gitea-cli/），之前用 tea 登录过不能顶替，必须重新 gt auth login。',
  en: 'gt has no usable credentials: run gt auth login and follow the wizard with your Gitea instance URL and access token; confirm with gt auth status that a login exists (for a self-hosted instance, make sure the URL points at the same instance), then ask the user to re-check. gt and tea configurations are not migrated between each other (gt uses its own ~/.config/gitea-cli/) — a previous tea login does not count; run gt auth login again.',
}

const gtRepoFixCopy = {
  zh: 'gt 找不到这个仓库：先核对 owner/repo 的写法与实例地址是否正确（gt auth status 看当前登录的是哪个实例）；用 gt issue list 验证这个仓库确实列得出票——列不出说明仓库名写错、仓库不存在，或当前账号没有这个仓库的读权限。',
  en: 'gt cannot find this repository: verify the owner/repo spelling and the instance URL (gt auth status shows which instance you are logged in to); run gt issue list to confirm the repository actually lists issues — if it does not, the repo name is wrong, the repository does not exist, or the current account lacks read access.',
}

const gtNetworkFixCopy = {
  zh: '连不上 Gitea 实例：先用浏览器或 curl 确认实例地址现在可达（自托管实例常见是内网地址、VPN 没连或服务停了）；gt 只支持 Gitea 28 及以上实例，实例版本过低也会探不上；确认可达之后再重试一次，还是失败就把原始报错原文贴出来，不要凭记忆猜原因。',
  en: 'Cannot reach the Gitea instance: first confirm the instance URL is reachable right now with a browser or curl (self-hosted instances are commonly behind an intranet, a disconnected VPN, or a stopped service); gt only supports Gitea 28 and newer instances — an older server also fails the probe; retry once after confirming reachability, and if it still fails, paste the original error text instead of guessing the cause.',
}

const gtCommandMapCopy = {
  zh: '本项目的票务通过 Gitea CLI（gt）操作，命令映射如下——建票：gt issue create（带 --json 回读编号）；列票：gt issue list；看单张票：gt issue view <编号>；看评论：gt issue comment list <编号>；写评论：gt issue comment <编号> --body 正文 --json；关票/重开：gt issue close <编号> / gt issue reopen <编号>；改票（加标签/认领等）：gt issue edit <编号> --add-label/--set-labels/--set-assignees；标签管理：gt label list / gt label create <名> --color 色 / gt label edit <数字id> --color 色（认 id 不认名字）。脚本化调用一律带 --json；没有的命令（例如拆分父子、设置阻塞的独立命令）gt 不提供，不要编造写法。',
  en: 'Issue tracking in this project goes through the Gitea CLI (gt); the command map: create an issue with gt issue create (with --json to read back the number); list issues with gt issue list; view one issue with gt issue view <number>; view comments with gt issue comment list <number>; post a comment with gt issue comment <number> --body <text> --json; close/reopen with gt issue close <number> / gt issue reopen <number>; edit an issue (labels/assignees) with gt issue edit <number> --add-label/--set-labels/--set-assignees; manage labels with gt label list / gt label create <name> --color <color> / gt label edit <numeric-id> --color <color> (by id, not by name). Always pass --json for scripted calls; gt offers no standalone commands for parent/child splitting or blocking — do not invent syntax.',
}

/**
 * preflight 选中的执行器（票 #21）：'gt' 或 'tea'，缺省 'tea'。
 * 为什么放模块级变量而不是构造期传参：prompts 是静态导出的常量对象，
 * 客户端投影（ui-description）在读属性时才求值，getter 注入是唯一的活口——
 * preflight 探测完写进来，注入提示词时读出去，键名与取值类型不变。
 * 这里只存「选了谁」；gt/tea 两套完整文案（#24）各自成表，注入时按它选一套。
 */
export type GiteaExecutorCli = 'gt' | 'tea'
let selectedExecutorCli: GiteaExecutorCli = 'tea'

/** preflight 探测结束后写入选中结果；只收 'gt' | 'tea'，写别的值编译不过。 */
export function setSelectedExecutor(cli: GiteaExecutorCli): void {
  selectedExecutorCli = cli
}

/** 读当前选中的执行器（测试与诊断用；提示词注入经 commandVocabulary.cli 的 getter 走这里）。 */
export function selectedExecutor(): GiteaExecutorCli {
  return selectedExecutorCli
}

// 票 #24：按选中执行器取一套文案。写成 getter 是因为 prompts 是静态导出的常量对象，
// 客户端投影（ui-description）在读属性时才求值，与 commandVocabulary.cli 同一活口——
// preflight 探测完写进来，注入时读出去。tea 套的字面量一个字没动（基点 4847e95b 原文），
// 逐字一致由 tests/verify-gitea-gt-prompts.ts 钉住。
function copyFor(gt: { zh: string; en: string }, tea: { zh: string; en: string }): { zh: string; en: string } {
  return selectedExecutorCli === 'gt' ? { ...gt } : { ...tea }
}

/** 这一房交给契约注入与修复指引的全部提示文案；commandVocabulary 的键名是对外契约，不能改名。 */
export const prompts = {
  // cli 是 getter：每次投影/注入时读 preflight 刚写进来的选中值（#21）。
  // 什么都没探测过时维持 'tea'，与旧行为一致（老会话没跑过新 preflight 也不变味）。
  commandVocabulary: {
    get cli(): GiteaExecutorCli { return selectedExecutorCli },
    cliBrand: 'Gitea',
  },
  get cliInstall(): { zh: string; en: string } { return copyFor(gtInstallCopy, teaInstallCopy) },
  get cliLogin(): { zh: string; en: string } { return copyFor(gtLoginCopy, teaLoginCopy) },
  get cliAuthFix(): { zh: string; en: string } { return copyFor(gtAuthFixCopy, teaAuthFixCopy) },
  get cliRepoFix(): { zh: string; en: string } { return copyFor(gtRepoFixCopy, teaRepoFixCopy) },
  get cliNetworkFix(): { zh: string; en: string } { return copyFor(gtNetworkFixCopy, teaNetworkFixCopy) },
  get commandMap(): { zh: string; en: string } { return copyFor(gtCommandMapCopy, teaCommandMapCopy) },
}
