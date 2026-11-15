#!/usr/bin/env node
// tests/verify-gitea-gt-prompts.ts —— 门禁：gt/tea 双套提示文案按选中执行器注入（票 #24，规格 #19 收尾）
// 用法：在插件根目录执行 node --import ./scripts/ts-hook.mts tests/verify-gitea-gt-prompts.ts
//
// 票 #24 定的口径：
//   ① 选中 gt 时，cliInstall / cliLogin / cliAuthFix / cliRepoFix / cliNetworkFix / commandMap
//      六条文案全部换 gt 套：安装指引以装 gt 为主（官方仓库 https://gitea.com/gitea/cli），
//      写明 gt 与 tea 配置互不迁移（~/.config/gitea-cli/）、切 gt 须重新 gt auth login，
//      并附一句「服务器低于 Gitea 28 才需要 tea」；
//   ② 契约键 commandVocabulary.cli 名不变，值随选中执行器注入 'gt' 或 'tea'（票 #21 已立，这里复核）；
//   ③ 选中 tea 时六条文案与基点 4847e95b 的原文逐字节一致（tea 路径零改动的行为证据）。
//      基准值直接抄自 `git show 4847e95b:src/tracker/rooms/gitea/room/prompts.ts` 的字面量，
//      作为独立真源嵌在本文件里，不依赖运行时 git。
//
// 门禁归属: src/tracker/rooms/gitea/room/prompts.ts
const nodePath = require('path')
const { pathToFileURL } = require('url')

const ROOT = nodePath.resolve(__dirname, '..')
const url = (rel) => pathToFileURL(nodePath.join(ROOT, rel)).href

let total = 0
const broken = []
function must(cond, invariant, detail) {
  total += 1
  if (cond) { console.log('  PASS ' + invariant); return }
  const line = '  FAIL 不变式破了 —— ' + invariant + (detail ? '【实测：' + detail + '】' : '')
  console.log(line)
  broken.push(line.replace(/^\s+/, ''))
}
function title(t) { console.log('\n' + t) }

// ---- 逐字一致基准：基点 4847e95b 的 tea 文案原文（独立真源，抄自该提交的 prompts.ts） ----
const BASELINE_TEA = {
  cliInstall: {
    zh: '请为 DSH 安装 Gitea CLI（tea）。官方安装说明只有一处：https://gitea.com/gitea/tea，按那一页的指引做，不要凭记忆写安装命令。\n1. 先检查：终端执行 tea --version；有版本号就直接汇报已装版本，不要重复安装；\n2. 没有 tea 时，打开上面那一页，按你的系统对应的那一节装；那一页打不开就如实说打不开，不要编命令；\n3. 装完请用户点「重查」；如果重查仍说找不到，请用户重启宿主（宿主只在启动时读 PATH）。',
    en: 'Install the Gitea CLI (tea) for DSH. The only official source is https://gitea.com/gitea/tea — follow that page, do not write install commands from memory.\n1. Check first: tea --version; if a version is reported, report it and do not reinstall;\n2. If missing, open the page above and follow the section for your OS; if the page cannot be opened, say so plainly and do not invent commands;\n3. After install, ask the user to re-check; if it still reports missing, ask the user to restart the host (the host reads PATH only at startup).',
  },
  cliLogin: {
    zh: '请完成 tea 登录：终端执行 tea login add，按向导填入 Gitea 实例地址与访问令牌；完成后用 tea login list 验证至少有一个登录项，然后请用户点「重查」。',
    en: 'Complete tea login: run tea login add and follow the wizard with your Gitea instance URL and access token; verify with tea login list that at least one login exists, then ask the user to re-check.',
  },
  cliAuthFix: {
    zh: 'tea 没有可用的登录凭据：终端执行 tea login add，按向导填入 Gitea 实例地址与访问令牌；完成后用 tea login list 确认登录项在列（自托管实例要确认地址写的是同一个实例），然后请用户点「重查」。',
    en: 'tea has no usable credentials: run tea login add and follow the wizard with your Gitea instance URL and access token; confirm with tea login list that a login exists (for a self-hosted instance, make sure the URL points at the same instance), then ask the user to re-check.',
  },
  cliRepoFix: {
    zh: 'tea 找不到这个仓库：先核对 owner/repo 的写法与实例地址是否正确（tea login list 看当前登录的是哪个实例）；用 tea issues ls 验证这个仓库确实列得出票——列不出说明仓库名写错、仓库不存在，或当前账号没有这个仓库的读权限。',
    en: 'tea cannot find this repository: verify the owner/repo spelling and the instance URL (tea login list shows which instance you are logged in to); run tea issues ls to confirm the repository actually lists issues — if it does not, the repo name is wrong, the repository does not exist, or the current account lacks read access.',
  },
  cliNetworkFix: {
    zh: '连不上 Gitea 实例：先用浏览器或 curl 确认实例地址现在可达（自托管实例常见是内网地址、VPN 没连或服务停了）；确认可达之后再重试一次，还是失败就把原始报错原文贴出来，不要凭记忆猜原因。',
    en: 'Cannot reach the Gitea instance: first confirm the instance URL is reachable right now with a browser or curl (self-hosted instances are commonly behind an intranet, a disconnected VPN, or a stopped service); retry once after confirming reachability, and if it still fails, paste the original error text instead of guessing the cause.',
  },
  commandMap: {
    zh: '本项目的票务通过 Gitea CLI（tea）操作，命令映射如下——建票：tea issues create；列票：tea issues ls（即 tea issues list）；看单张票：tea issues <编号>；看评论：tea issues <编号> comments；关票：tea issues close <编号>；给票加标签或认领：tea issues edit <编号> --add-labels/--add-assignees；标签管理：tea labels create / tea labels ls（即 tea labels list）。没有的命令（例如拆分父子、设置阻塞）tea 不提供，不要编造写法。',
    en: 'Issue tracking in this project goes through the Gitea CLI (tea); the command map: create an issue with tea issues create; list issues with tea issues ls (aka tea issues list); view one issue with tea issues <number>; view comments with tea issues <number> comments; close an issue with tea issues close <number>; add labels or assignees with tea issues edit <number> --add-labels/--add-assignees; manage labels with tea labels create / tea labels ls (aka tea labels list). tea offers no commands for parent/child splitting or blocking — do not invent syntax.',
  },
}

// 票 #24 六条契约键（键名是对外契约，不能改名）。
const KEYS = ['cliInstall', 'cliLogin', 'cliAuthFix', 'cliRepoFix', 'cliNetworkFix', 'commandMap']

async function main() {
const promptMod = await import(url('src/tracker/rooms/gitea/room/prompts.ts'))
const { setSelectedExecutor } = promptMod

title('一、选中 gt：六条文案全部换成 gt 套（规格决策 Q4/实现决策 4/5）')
setSelectedExecutor('gt')
for (const key of KEYS) {
  const block = promptMod.prompts[key]
  must(typeof block.zh === 'string' && block.zh.includes('gt'), key + '.zh 是 gt 套文案（含 gt 命令）', String(block.zh).slice(0, 80))
  must(typeof block.en === 'string' && block.en.includes('gt'), key + '.en 是 gt 套文案（含 gt 命令）', String(block.en).slice(0, 80))
  must(!block.zh.includes('tea issues') && !block.zh.includes('tea login add') && !block.zh.includes('tea labels'), key + '.zh 不再出现 tea 命令写法', block.zh.slice(0, 80))
  must(!block.en.includes('tea issues') && !block.en.includes('tea login add') && !block.en.includes('tea labels'), key + '.en 不再出现 tea 命令写法', block.en.slice(0, 80))
}

title('二、gt 安装指引：以装 gt 为主，写明配置不迁移与重新登录，附 tea 适用边界（实现决策 5）')
const inst = promptMod.prompts.cliInstall
must(inst.zh.includes('https://gitea.com/gitea/cli'), 'zh 安装指引指向 gt 官方仓库 https://gitea.com/gitea/cli', inst.zh.slice(0, 100))
must(inst.en.includes('https://gitea.com/gitea/cli'), 'en 安装指引指向 gt 官方仓库 https://gitea.com/gitea/cli', inst.en.slice(0, 100))
must(inst.zh.includes('~/.config/gitea-cli/'), 'zh 写明 gt 配置目录 ~/.config/gitea-cli/', '')
must(inst.zh.includes('gt auth login'), 'zh 写明切 gt 须重新 gt auth login', '')
must(inst.zh.includes('不迁移') || inst.zh.includes('互不迁移'), 'zh 写明 gt 与 tea 配置互不迁移', '')
must(inst.en.includes('gt auth login'), 'en 写明切 gt 须重新 gt auth login', '')
must(inst.en.includes('not migrated') || inst.en.includes('not shared'), 'en 写明配置不迁移', '')
must(inst.zh.includes('低于 28') || inst.zh.includes('低于 Gitea 28'), 'zh 附「服务器低于 Gitea 28 才需要 tea」', '')
must(inst.zh.includes('tea'), 'zh 的 tea 适用边界一句里点到了 tea', '')

title('三、gt 登录与认证修复指引：给的是 gt auth login（用户故事 5）')
const login = promptMod.prompts.cliLogin
must(login.zh.includes('gt auth login') && login.zh.includes('gt auth status'), 'zh 登录指引给 gt auth login 与 gt auth status', login.zh.slice(0, 80))
must(login.en.includes('gt auth login') && login.en.includes('gt auth status'), 'en 登录指引给 gt auth login 与 gt auth status', '')
const authFix = promptMod.prompts.cliAuthFix
must(authFix.zh.includes('gt auth login') && authFix.zh.includes('gt auth status'), 'zh 认证修复给 gt auth login 与 gt auth status', '')
must(authFix.en.includes('gt auth login') && authFix.en.includes('gt auth status'), 'en 认证修复给 gt auth login 与 gt auth status', '')
must(authFix.zh.includes('不迁移') || authFix.zh.includes('互不迁移'), 'zh 认证修复写明 gt 与 tea 凭据互不迁移', '')

title('四、gt 仓库修复与命令映射：命令写法与 gt 实测命令面一致（票 #20/#22/#23 核对过的拼法）')
const repoFix = promptMod.prompts.cliRepoFix
must(repoFix.zh.includes('gt issue list'), 'zh 仓库修复验证命令是 gt issue list', repoFix.zh.slice(0, 80))
must(repoFix.en.includes('gt issue list'), 'en 仓库修复验证命令是 gt issue list', '')
const cmdMap = promptMod.prompts.commandMap
must(cmdMap.zh.includes('gt issue create'), 'zh 命令映射含 gt issue create', '')
must(cmdMap.zh.includes('gt issue list'), 'zh 命令映射含 gt issue list', '')
must(cmdMap.zh.includes('gt issue view'), 'zh 命令映射含 gt issue view', '')
must(cmdMap.zh.includes('gt issue comment'), 'zh 命令映射含 gt issue comment', '')
must(cmdMap.zh.includes('gt issue close') && cmdMap.zh.includes('gt issue reopen'), 'zh 命令映射含 gt issue close / reopen', '')
must(cmdMap.zh.includes('--json'), 'zh 命令映射说明脚本输出走 --json', '')
must(cmdMap.zh.includes('gt label create') && cmdMap.zh.includes('gt label edit'), 'zh 命令映射含 gt label create / edit', '')
must(cmdMap.zh.includes('不') && cmdMap.zh.includes('编造') || cmdMap.zh.includes('do not invent'), 'zh 命令映射保留「不要编造写法」的告诫', cmdMap.zh.slice(-60))

title('五、契约键与值：commandVocabulary.cli 名不变，值随选中注入（验收项 2）')
must(promptMod.prompts.commandVocabulary.cli === 'gt', '选中 gt 时 commandVocabulary.cli === \'gt\'', String(promptMod.prompts.commandVocabulary.cli))
must(Object.prototype.hasOwnProperty.call(promptMod.prompts, 'cliInstall'), 'cliInstall 键仍在 prompts 块上（键名是对外契约）', '')
must(Object.prototype.hasOwnProperty.call(promptMod.prompts, 'commandMap'), 'commandMap 键仍在 prompts 块上', '')

title('六、选中 tea：六条文案与基点 4847e95b 逐字节一致（用户故事 12，验收项「tea 文案零变化」）')
setSelectedExecutor('tea')
must(promptMod.prompts.commandVocabulary.cli === 'tea', '选中 tea 时 commandVocabulary.cli === \'tea\'', String(promptMod.prompts.commandVocabulary.cli))
for (const key of KEYS) {
  for (const lang of ['zh', 'en']) {
    const got = promptMod.prompts[key][lang]
    const want = BASELINE_TEA[key][lang]
    must(got === want, 'tea 选中时 ' + key + '.' + lang + ' 与基点逐字一致',
      got === want ? '' : '长度 ' + String(got).length + ' vs 基准 ' + String(want).length)
  }
}

title('七、getter 语义：改选中立即生效（注入时求值，不是模块加载时定格）')
setSelectedExecutor('gt')
must(promptMod.prompts.cliLogin.zh === promptMod.prompts.cliLogin.zh && promptMod.prompts.cliLogin.zh.includes('gt auth login'), '置 gt 后读 cliLogin.zh 已是 gt 套', '')
setSelectedExecutor('tea')
must(promptMod.prompts.cliLogin.zh.includes('tea login add'), '再置 tea 后读 cliLogin.zh 回到 tea 套', '')

console.log('\n共 ' + total + ' 条不变式，红了 ' + broken.length + ' 条。')
if (broken.length) {
  console.log('\n失败清单：')
  broken.forEach(function (line) { console.log('  ' + line) })
  process.exit(1)
}
}

main().catch(function (e) { console.error(e); process.exit(1) })
