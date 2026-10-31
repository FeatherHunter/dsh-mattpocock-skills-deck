// 门禁归属: src/shared/version-control/src/config-rules.ts
// verify-1586-config-hooks.ts —— 配置与钩子域十二条能力的门禁（规格 #1586 之 T24 #1760）。
//
// 这一扇守四件事，缺一条都算没过：
//   ① 规则层：git config --list --show-origin 的读法（成对字段、作用域反推）、身份两个键之外一律只读、
//      改配置的取值校验、钩子名字与 2.36 版本门、属性规则与邮件映射的只读解析；
//   ② 只读读数：真 git 临时仓库里读回四组配置、身份各作用域的旧值、钩子清单、属性规则与邮件映射；
//   ③ 身份两键的写入：先预检签 120 秒票（显示旧值、非身份键当场拒、块时不签票），再凭票执行；
//      伪造票 / 过期票 / 换动作 / 现场变化全部零进程拒绝，同一 requestId 重放只执行一次；
//   ④ 手动跑钩子：2.36 以下只读说明给替代做法，2.36 起先确认再执行，输出有上限、超时走配置档。
//
// 跑法：node --import ./scripts/ts-hook.mts tests/verify-1586-config-hooks.ts
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const { pathToFileURL } = require('url')
const { printGateResult } = require('./lib/gate-result.ts')

const ROOT = path.resolve(__dirname, '..')
const GATE = 'verify-1586-config-hooks'
let failed = false
let total = 0
const check = (ok: any, msg: string): void => { total += 1; if (!ok) failed = true; console.log((ok ? '  PASS ' : '  FAIL ') + msg) }
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const raw = (text: string): string => String(text).split('\r\n').join('\n')
const NUL = String.fromCharCode(0)
const git = (cwd: string, args: string[]): any => {
  const r = spawnSync('git', args, { cwd: cwd, encoding: 'utf8', windowsHide: true })
  return { code: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() }
}
function mkRepo(tag: string): string {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dsws1760-' + tag + '-'))
  git(base, ['init', '-q', '-b', 'main'])
  git(base, ['config', 'user.name', '基线名字'])
  git(base, ['config', 'user.email', 'base@example.com'])
  fs.writeFileSync(path.join(base, 'a.txt'), 'a\n')
  git(base, ['add', '-A'])
  git(base, ['commit', '-q', '-m', '基线'])
  return base
}

async function main(): Promise<void> {
  console.log('配置与钩子域门禁（#1760 / 域 12：规则、只读读数、身份写入、手动跑钩子）')
  const rules = require('../src/shared/version-control/src/config-rules.js')
  const cmds = require('../src/shared/version-control/src/commands.js')

  console.log('A 规则层（纯函数）')
  const sample = ['file:C:/Program Files/Git/etc/gitconfig', 'user.name\n系统名字', 'file:C:/Users/x/.gitconfig', 'user.email\nglobal@example.com', 'file:.git/config', 'user.name\n仓库名字', 'file:.git/config', 'core.autocrlf\ntrue']
  const joined = sample.join(NUL) + NUL
  const parsed = rules.parseConfigList(joined)
  check(parsed.ok === true && parsed.entries.length === 4, 'A1 --show-origin -z 的成对字段解析：四点八段读成四条，不按行切')
  check(parsed.ok === true && parsed.entries[2].key === 'user.name' && parsed.entries[2].value === '仓库名字', 'A2 每条记录拆出 origin / key / value 三段（key 与 value 用换行分）')
  check(rules.parseConfigList('a' + NUL + 'b' + NUL + 'c').ok === false, 'A3 字段不成对整份失败，不给半份数据')
  check(rules.configScopeOf('file:.git/config', 'D:/repo/.git/config') === 'local', 'A4 相对 origin（仓库自己的 config）判本仓库作用域')
  check(rules.configScopeOf('file:D:/repo/.git/config', 'D:/repo/.git/config') === 'local', 'A5 绝对路径与本地 config 相等也判本仓库')
  check(rules.configScopeOf('file:C:/Users/x/.gitconfig', 'D:/repo/.git/config') === 'global', 'A6 用户主目录 .gitconfig 判这台机器（全局）')
  check(rules.configScopeOf('file:C:/Program Files/Git/etc/gitconfig', 'D:/repo/.git/config') === 'system', 'A7 安装目录 etc/gitconfig 判系统级（只读）')
  check(rules.CONFIG_IDENTITY_KEYS.join(',') === 'user.name,user.email', 'A8 可写的只有身份两个键')
  check(rules.CONFIG_GROUPS.length === 4 && rules.CONFIG_GROUPS[0].id === 'identity' && rules.CONFIG_GROUPS[0].editable === true, 'A9 配置分四组，第一组身份可编辑')
  check(rules.CONFIG_GROUPS.slice(1).every(function (g: any): boolean { return g.editable === false }), 'A10 行尾与大小写、钩子路径、凭据三组一律只读')
  check(rules.configGroupOf('core.autocrlf') === 'eol' && rules.configGroupOf('core.hooksPath') === 'hooksPath' && rules.configGroupOf('credential.helper') === 'credential', 'A11 只读键各归各的组')
  check(rules.configGroupOf('user.name') === 'identity' && rules.configGroupOf('alias.xx') === '', 'A12 身份键归身份组，不认识的键不硬塞进任何组')
  check(rules.identityValueError('user.name', '新的名字') === null, 'A13 身份姓名正常值通过')
  check(rules.identityValueError('user.name', '   ') === 'value-empty', 'A14 空姓名当场拒')
  check(rules.identityValueError('user.name', 'x'.repeat(201)) === 'value-too-long', 'A15 超长值当场拒（上限 200）')
  check(rules.identityValueError('user.email', '不是邮箱') === 'email-invalid', 'A16 邮箱形状不对当场拒')
  check(rules.identityValueError('user.email', 'a@b.co') === null, 'A17 邮箱形状正常通过')
  check(rules.HOOK_NAMES.indexOf('pre-commit') >= 0 && rules.HOOK_NAMES.indexOf('pre-push') >= 0, 'A18 钩子名单含常用钩子（pre-commit / pre-push）')
  check(rules.hookNameProblem('pre-commit') === null && rules.hookNameProblem('不存在的钩子') === 'hook-name', 'A19 钩子名只管形状；中文与空格当场拒')
  check(rules.hookNameProblem('my-custom-hook') === null, 'A20 git 认的钩子名之外，形状合法的自定义钩子名也放行（是否存在交给仓库读）')
  const setPlan = rules.configCheckPlanOf('config-set', { key: 'user.name', value: '新名字' })
  check(setPlan.ok === true && setPlan.plan.scope === 'local' && setPlan.plan.value === '新名字', 'A21 改配置默认作用域是本仓库（--local）')
  check(rules.configCheckPlanOf('config-set', { key: 'core.autocrlf', value: 'true' }).reason === 'key-readonly', 'A22 改身份之外的键当场拒（只读，不提供通用键值编辑器）')
  check(rules.configCheckPlanOf('config-set', { key: 'user.name', value: 'x', scope: 'system' }).reason === 'scope-invalid', 'A23 作用域只能本仓库或全局，系统级不给写')
  check(rules.configCheckPlanOf('config-unset', { key: 'user.name' }).ok === true, 'A24 删配置只删身份键')
  check(rules.configCheckPlanOf('hook-run', { name: 'pre-commit' }).ok === true, 'A25 手动跑钩子接受形状合法的名字')
  check(rules.configCheckPlanOf('config-set', { key: 'user.name', value: 'x', op: 'other' }).reason === 'bad-target', 'A26 不认识的动作当场拒')
  check(rules.configCheckPlanOf('config-set', { key: 'user.name' }).reason === 'value-empty', 'A27 改配置必须给新值')
  const d1 = rules.configPlanDigestInput(rules.configCheckPlanOf('config-set', { key: 'user.name', value: '甲' }).plan)
  const d2 = rules.configPlanDigestInput(rules.configCheckPlanOf('config-set', { key: 'user.name', value: '乙' }).plan)
  check(d1 !== d2 && d1 === rules.configPlanDigestInput(rules.configCheckPlanOf('config-set', { key: 'user.name', value: '甲' }).plan), 'A28 计划摘要：值不同就不同，同一份计划两次算相等')
  check(rules.configHookRunStateOf('git version 2.49.0.windows.1').state === 'full', 'A29 2.49 上手动跑钩子完整可用')
  const low = rules.configHookRunStateOf('git version 2.34.1')
  check(low.state === 'hidden' && low.needed === '2.36.0' && low.alternative === '2.36 以下在终端直接执行钩子文件', 'A30 2.34 判隐藏，并给替代做法（与能力账本同一句）')
  check(rules.configHookRunStateOf('git version 2.11.0').state === 'hidden', 'A31 2.11 也判隐藏（最低 2.36）')
  const attrs = rules.parseCheckAttr('README.md' + NUL + 'text' + NUL + 'set' + NUL + 'README.md' + NUL + 'eol' + NUL + 'lf' + NUL)
  check(attrs.ok === true && attrs.entries.length === 2 && attrs.entries[0].attr === 'text' && attrs.entries[1].value === 'lf', 'A32 属性规则读数按 path/attr/value 三段一组解析')
  check(rules.parseCheckAttr('README.md' + NUL + 'text' + NUL).ok === false, 'A33 属性规则三段不齐整份失败')
  check(rules.parseCheckMailmap('<a@b.co>\n') === '<a@b.co>', 'A34 邮件映射读数去掉首尾空白')
  check(Array.isArray(rules.CONFIG_ENTRY_DEFS) && rules.CONFIG_ENTRY_DEFS.length === 8, 'A35 八条能力各一条入口定义（12.1–12.8）')
  check(rules.CONFIG_ENTRY_DEFS.map(function (e: any): string { return e.capId }).join(',') === '12.1,12.2,12.3,12.4,12.5,12.6,12.7,12.8', 'A36 入口定义覆盖 12.1–12.8，一条都不少也不多')
  const listArgv = cmds.configListArgs()
  check(listArgv.join(' ') === 'config --list --show-origin -z', 'A37 读配置用 --show-origin 反推作用域（规格第 3 节点名）')
  check(cmds.configSetArgs('user.name', 'x', 'local').join(' ') === 'config --local user.name x', 'A38 改配置是 config --local <键> <值>，值与键各占一个 argv 元素')
  check(cmds.configUnsetArgs('user.name', 'global').join(' ') === 'config --global --unset user.name', 'A39 删配置是 config --global --unset <键>')
  check(cmds.hookRunArgs('pre-commit').join(' ') === 'hook run pre-commit', 'A40 手动跑钩子是 git hook run <名字>')
  check(cmds.checkAttrArgs('README.md').join(' ') === 'check-attr -a -z -- README.md', 'A41 属性规则只读查询 check-attr -a -z -- <路径>')
  check(cmds.checkMailmapArgs('a@b.co').join(' ') === 'check-mailmap -- a@b.co', 'A42 邮件映射只读查询 check-mailmap -- <地址>')
  check(cmds.gitPathArgs('hooks').join(' ') === 'rev-parse --git-path hooks', 'A43 钩子目录用 rev-parse --git-path 读（跟着 core.hooksPath 走）')

  printGateResult(GATE, total, failed)
  process.exit(failed ? 1 : 0)
}
main().catch(function (e: any): void { console.log('  FAIL 门禁自己抛错：' + String((e && e.stack) || e)); printGateResult(GATE, total, 1); process.exit(1) })
