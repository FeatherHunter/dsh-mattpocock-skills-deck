/**
 * tests/verify-1621-gh-missing-copy.ts —— #1621：缺 gh 的提示必须说清「可能装了，只是不在启动时继承的 PATH 里」
 *
 * 病根：gh 已经装在默认目录（Windows 上是 C:\\Program Files\\GitHub CLI\\gh.exe）、也已经登录，
 *   但它的目录既不在用户 PATH、也不在 DSH 进程启动时继承的 PATH 里。旧文案把这件事一律说成
 *   「gh 还没安装，安装后即可继续」，界面于是要求重装一个已经装着的命令；重启 DSH 能恢复
 *   （进程环境重新快照），但没有任何一处提示告诉人这一点。
 *
 * 修法范围（维护者 2026-10-29 决定：只改文案，不动解析逻辑）：用户能看到的缺 gh 提示分成
 *   状态栏与检查页的 hint 和按钮标签、点按钮注入的安装指引、errorKinds 里的短句、宿主建仓失败时
 *   的那段长文、预检与客户端解析失败的标准错误消息、宿主 gh 执行器记下的最近一次失败原因、
 *   以及 issue-tracker 文档里「工具故障」一节的处理步骤。这些文案说同一个事实：
 *   DSH 只从「进程启动时继承的 PATH」里解析 gh；已安装但不在该 PATH 时，改 PATH 或设 DSH_GH_PATH
 *   之后要**重启 DSH**，不要重装。
 *
 * 本门禁钉住：
 *   ① 用户可见文案都换成新说法，旧说法（「还没安装」「请先安装」、/wizard 原话）不再出现；
 *   ② 宿主建仓失败长文与 init-project 回包里的 prompt 是同一段话（两处各存一份，必须逐字一致）；
 *   ③ 分类 token 保留：预检与客户端的新消息仍含 gh not found 与 platform.resolveExecutable，
 *      判档仍归环境档，chain-env-map 仍把它们认成「缺 gh 可执行」；
 *   ④ 宿主 gh 执行器的失败原因、issue-tracker 文档的排查步骤都带上新说法与 DSH_GH_PATH；
 *   ⑤ 行为没被顺手改：gh:installed 的按钮仍是注入 cliInstall，仍带「重新检查」那条 refresh 动作。
 *
 * 运行：node --import ./scripts/ts-hook.mts tests/verify-1621-gh-missing-copy.ts
 *
 * 门禁归属: src/tracker/rooms/github
 * 门禁归属: src/host/publishFlow.ts
 * 门禁归属: src/refresh/rooms/host/gh-execution.ts
 * 门禁归属: docs/agents/issue-tracker.md
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { fixes, prompts } from '../src/tracker/rooms/github/index.ts'
import { classifyGhError } from '../src/tracker/rooms/github/errors.ts'
import { ghAuthVerdict } from '../src/refresh/rooms/host/chain-env-map.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8')

let failed = false
let total = 0
const check = (ok: boolean, msg: string) => {
  total++
  console.log((ok ? '  PASS ' : '  FAIL ') + msg)
  if (!ok) failed = true
}

/** 源码里的单引号字符串字面量还原成运行时文本：只认本文件用到的转义（\\ \' \n \r \t）。 */
const unescapeJs = (raw: string): string =>
  raw.replace(/\\(n|r|t|'|"|\\)/g, (_m: string, c: string) =>
    c === 'n' ? '\n' : c === 'r' ? '\r' : c === 't' ? '\t' : c)

/** 取源码里第一处单引号字面量的运行时文本；取不到返回 null（由断言按「缺了」判，不抛）。 */
const literalAfter = (src: string, re: RegExp): string | null => {
  const m = re.exec(src)
  return m ? unescapeJs(m[1]) : null
}

/** 一串关键片段是否都在文本里：缺哪一段都算没说到。 */
const hasAll = (text: string, parts: string[]): boolean => parts.every((p) => text.indexOf(p) >= 0)
/** 一串旧说法是否都不在文本里。 */
const hasNone = (text: string, parts: string[]): boolean => parts.every((p) => text.indexOf(p) < 0)

/** 宿主建仓失败时给的那段长文里的关键步骤（两处各存一份，内容一致是硬要求）。 */
const NO_GH_PROMPT_MARKERS = [
  '该结果不等同于 gh 未安装',
  '用户级或系统级 PATH',
  'DSH_GH_PATH',
  '从开始菜单、桌面或资源管理器启动',
  '不重新读取进程环境变量',
  '不能替代重启 DSH',
]

function main(): void {
  console.log('== 1. 状态栏与检查页：hint 与按钮标签先让人排查路径，再谈安装 ==')
  const ghInstalled: any = (fixes as any)['gh:installed']
  check(!!ghInstalled, '后端声明里还有 gh:installed 这一行')
  const hintZh = String((ghInstalled.hint || {}).zh || '')
  const hintEn = String((ghInstalled.hint || {}).en || '')
  check(hasAll(hintZh, ['DSH 进程启动时继承的 PATH 中未解析到 gh 可执行文件', '可能未安装', '也可能已安装', 'DSH_GH_PATH']),
    '中文 hint 说清「只从启动时继承的 PATH 里解析」，并区分「未安装」与「已安装但不在该 PATH」（实得「' + hintZh + '」）')
  check(hintZh.indexOf('还没安装，安装后即可继续') < 0, '中文 hint 不再把结果直接说成「还没安装」（旧说法会把已安装的人引去重装）')
  check(hasAll(hintEn, ['PATH inherited at DSH process startup', 'may be not installed', 'installed in a directory absent from that PATH', 'DSH_GH_PATH']),
    '英文 hint 同样说清启动时继承的 PATH 与两种可能（实得「' + hintEn + '」）')
  const actions: any[] = Array.isArray(ghInstalled.actions) ? ghInstalled.actions : []
  const installAction: any = actions.find((a: any) => a && a.type === 'inject-prompt')
  const refreshAction: any = actions.find((a: any) => a && a.type === 'refresh')
  check(!!installAction && installAction.prompt === 'cliInstall', 'gh:installed 的按钮仍是「注入 cliInstall 那条提示词」（行为不变）')
  check(!!refreshAction && refreshAction.target === 'chain', '「重新检查」仍是 refresh chain（文案要说清它不刷新进程环境）')
  const labelZh = String(((installAction || {}).label || {}).zh || '')
  const labelEn = String(((installAction || {}).label || {}).en || '')
  check(labelZh === '排查与安装', '中文按钮标签改成「排查与安装」（先排查是不是路径问题，再谈安装；实得「' + labelZh + '」）')
  check(labelEn === 'Troubleshoot / install', '英文按钮标签同步（实得「' + labelEn + '」）')

  console.log('== 2. 点按钮注入的安装指引：先确认装没装，再按结果分两条路走 ==')
  const install: any = (prompts as any).cliInstall || {}
  const installZh = String(install.zh || '')
  const installEn = String(install.en || '')
  check(hasAll(installZh, [
    '确认 gh 安装状态',
    '在 DSH 之外的终端执行',
    'gh --version',
    '有版本号输出：gh 已安装',
    '无需重复安装',
    'DSH_GH_PATH',
    '重启 DSH Desktop',
    'C:\\Program Files\\GitHub CLI\\gh.exe',
    '/wizard 安装 gh CLI',
  ]), '中文指引先验证安装状态，有输出时只让人改 PATH 或设 DSH_GH_PATH 再重启（实得「' + installZh + '」）')
  check(installZh.indexOf('/wizard 帮用户安装gh cli') < 0, '中文指引不再逐字沿用旧的 /wizard 原话（那句默认 gh 没装）')
  check(hasNone(installZh, ['winget', 'brew', 'sudo apt']), '中文指引不再列按系统分平台的安装命令（本票只谈路径与重启）')
  check(hasAll(installEn, [
    'Confirm gh installation status',
    'terminal outside DSH',
    'Version printed: gh is installed',
    'Do not reinstall',
    'DSH_GH_PATH',
    'restart DSH Desktop',
    'C:\\Program Files\\GitHub CLI\\gh.exe',
    '/wizard install the gh CLI',
  ]), '英文指引与中文信息量一致（实得「' + installEn + '」）')
  check(installEn.indexOf('/wizard help the user install the gh CLI') < 0, '英文指引不再逐字沿用旧的 /wizard 原话')

  console.log('== 3. errorKinds 的 no-gh 短句：先说不确定，再给下一步 ==')
  const errNoGh: any = ((prompts as any).errorKinds || {})['no-gh'] || {}
  const errZh = String(errNoGh.zh || '')
  const errEn = String(errNoGh.en || '')
  check(hasAll(errZh, ['DSH 进程的 PATH 中未解析到 gh', '可能未安装', '也可能已安装']),
    '中文短句说清「解析不到」不等同于「没装」（实得「' + errZh + '」）')
  check(errZh.indexOf('请先安装') < 0, '中文短句不再直接要求安装（旧说法正是让人重装一个装着的命令）')
  check(hasAll(errEn, ['DSH process PATH', 'not installed', 'absent from the DSH process PATH']),
    '英文短句同步（实得「' + errEn + '」）')

  console.log('== 4. 宿主建仓失败的长文与 init-project 回包：同一段话，逐字一致 ==')
  const publishSrc = read('src/host/publishFlow.ts')
  const initSrc = read('src/tracker/rooms/github/init-project.ts')
  const noGhPrompt = literalAfter(publishSrc, /const NO_GH_PROMPT = '((?:[^'\\]|\\.)*)'/)
  const initMatch = /kind: 'no-gh', message: '((?:[^'\\]|\\.)*)', raw: '', prompt: '((?:[^'\\]|\\.)*)'/.exec(initSrc)
  const initMessage = initMatch ? unescapeJs(initMatch[1]) : null
  const initPrompt = initMatch ? unescapeJs(initMatch[2]) : null
  check(!!noGhPrompt, '宿主 publishFlow 里还找得到 NO_GH_PROMPT（这段长文的来源之一）')
  check(!!initPrompt, 'init-project 的 no-gh 回包仍带着 prompt 长文')
  check(!!noGhPrompt && noGhPrompt === initPrompt, '宿主长文与 init-project 回包里的 prompt 逐字一致（两处各存一份，必须一起改）')
  check(initMessage === '未在 DSH 启动时继承的 PATH 中解析到 gh 可执行文件（可能未安装，也可能安装后未重启 DSH）',
    'init-project 的短句如实说「可能安装后未重启」（实得「' + String(initMessage) + '」）')
  const promptText = noGhPrompt || ''
  check(hasAll(promptText, NO_GH_PROMPT_MARKERS), '宿主长文写清「不等同于未安装」、PATH 的两级、DSH_GH_PATH、重启入口与「重新检查」的边界')
  check(hasNone(promptText, ['winget', 'brew', 'sudo apt', '请为 DSH 安装']), '宿主长文不再是「请为 DSH 安装」那套安装说明（会让人重装）')

  console.log('== 5. 分类 token 保留：新消息仍被认成「缺 gh 可执行」 ==')
  // #1686 阶段 1：preflight 随 read 层搬进 read/，文案看真身而不是旧路径的转发壳。
  const preflightSrc = read('src/tracker/rooms/github/read/preflight.ts')
  // #1684 阶段 1：gh 客户端真身搬进 transport/，旧路径只留转发；文案看真身。
  const clientSrc = read('src/tracker/rooms/github/transport/client.ts')
  const preflightMsg = literalAfter(preflightSrc, /message: '(gh not found: platform\.resolveExecutable returned null[^']*)'/)
  const clientMsg = literalAfter(clientSrc, /return fail\(ERROR_KIND\.ENV, '(gh not found: platform\.resolveExecutable returned null and gh --version probe failed[^']*)'/)
  check(!!preflightMsg && hasAll(preflightMsg, ['gh not found', 'platform.resolveExecutable', 'PATH inherited at process startup', 'DSH_GH_PATH']),
    '预检新消息保留 classify token，并说清只认启动时继承的 PATH')
  check(!!clientMsg && hasAll(clientMsg, ['gh not found', 'platform.resolveExecutable', 'PATH inherited at process startup', 'DSH_GH_PATH']),
    '客户端新消息保留同样的 token 与说明')
  check(!!preflightMsg && classifyGhError(preflightMsg) === 'env', '预检新消息仍判环境档（不是资源不存在，更不是没装）')
  check(!!clientMsg && classifyGhError(clientMsg) === 'env', '客户端新消息仍判环境档')
  const missingZh = String(ghAuthVerdict({ stage: 'gh', kind: 'env', message: preflightMsg } as never, true).detail || '')
  const missingEn = String(ghAuthVerdict({ stage: 'gh', kind: 'env', message: preflightMsg } as never, false).detail || '')
  check(missingZh.indexOf('没找到 gh 可执行') >= 0, '登录态文案仍把预检新消息认成「没找到 gh 可执行」（实得「' + missingZh + '」）')
  check(missingEn.indexOf('gh executable not found') >= 0, '英文界面同样认得出（token 没被改坏）')

  console.log('== 6. 宿主 gh 执行器与 issue-tracker 文档：排查步骤也换新说法 ==')
  const ghExecSrc = read('src/refresh/rooms/host/gh-execution.ts')
  const lastErr = literalAfter(ghExecSrc, /setGhLastError\('((?:[^'\\]|\\.)*)'\)/)
  check(!!lastErr && hasAll(lastErr, ['DSH 启动时继承的 PATH 中未解析到 gh 可执行文件', '不代表未安装', 'DSH_GH_PATH']),
    '宿主 gh 执行器的失败原因说清「不代表未安装」并给出 PATH 与 DSH_GH_PATH（实得「' + String(lastErr) + '」）')
  check(!!lastErr && lastErr.indexOf('PATH 无 gh') < 0, '不再只说「PATH 无 gh」（那听起来就是没装）')
  const docs = read('docs/agents/issue-tracker.md')
  check(docs.indexOf('报 `gh not found` 但 `gh --version` 有输出') >= 0,
    'issue-tracker 的「工具故障」一节写了「报 gh not found 但 gh --version 有输出」怎么处理')
  check(hasAll(docs, ['从开始菜单、桌面或资源管理器启动', 'DSH_GH_PATH', '不要直接建议重装']),
    '文档给的是「重启 DSH / 改 PATH / 设 DSH_GH_PATH」，不是重装')

  console.log(failed ? 'FAIL ' + total + ' 项检查里有未过的' : 'PASS 全部 ' + total + ' 项检查通过')
  process.exit(failed ? 1 : 0)
}

main()
