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

  // ---- B 组：只读读数（真 git 临时仓库） ----
  const vcMod = require('../src/host/versionControl.js')
  let clockNow = 5000
  const spawnLog: string[] = []
  function makeVc(versionText?: any): any {
    const deps: any = {
      subprocess: {
        spawn(req: any): any {
          spawnLog.push(req.argv.join(' '))
          if (versionText && req.argv.indexOf('--version') >= 0) {
            const mk0 = (b: any): any => ({ finalize: (): any => ({ text: (b || Buffer.alloc(0)).toString('utf8'), truncated: false }) })
            return { done: Promise.resolve({ exitCode: 0 }), collected: { stdout: mk0(Buffer.from(versionText + '\n')), stderr: mk0(Buffer.alloc(0)) }, terminate(): void {} }
          }
          const r = spawnSync(req.argv[0], req.argv.slice(1), { cwd: req.cwd, encoding: 'buffer', windowsHide: true, maxBuffer: 1 << 26 })
          const mk = (b: any): any => ({ finalize: (): any => ({ text: (b || Buffer.alloc(0)).toString('utf8'), truncated: false }) })
          return { done: Promise.resolve({ exitCode: r.status }), collected: { stdout: mk(r.stdout), stderr: mk(r.stderr) }, terminate(): void {} }
        },
      },
      timer: { timeout: (ms: any): any => new Promise((res: any): any => setTimeout(res, ms)) },
      fs: {
        stat: async (p: any): Promise<any> => await fs.promises.stat(p),
        lstat: async (p: any): Promise<any> => await fs.promises.lstat(p),
        exists: async (p: any): Promise<boolean> => { try { await fs.promises.access(p); return true } catch (e) { return false } },
      },
      getPlatform: async (): Promise<any> => ({ resolveExecutable: async (n: any): Promise<any> => (n === 'git' ? 'git' : null) }),
      DEFAULT_CWD: ROOT,
      TIMEOUT_MS: 30000,
      gate: { noteOutbound(): void {} },
      logCtx: { fire(): void {} },
      now: (): number => clockNow,
    }
    return vcMod.createVersionControl(deps)
  }
  const countWrites = (): number => spawnLog.filter(function (s: string): boolean { return s.indexOf(' config --') >= 0 || s.indexOf(' hook run ') >= 0 }).length
  const countHookRuns = (): number => spawnLog.filter(function (s: string): boolean { return s.indexOf(' hook run ') >= 0 }).length
  const repoA = mkRepo('b')
  fs.writeFileSync(path.join(repoA, '.gitattributes'), 'a.txt text\n')
  git(repoA, ['add', '-A'])
  git(repoA, ['commit', '-q', '-m', '属性规则'])
  fs.writeFileSync(path.join(repoA, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\necho hook-ran\nexit 0\n')
  fs.writeFileSync(path.join(repoA, '.git', 'hooks', 'pre-commit.sample'), '#!/bin/sh\nexit 0\n')
  const vcA = makeVc()
  const rd = await vcA.handleGitConfigRead({ cwd: repoA, path: 'a.txt', address: 'base@example.com' })
  check(rd.ok === true && rd.contract === 'version-control.config-read', 'B1 读配置电话在真仓库里成功，并回自己的契约名')
  check(Array.isArray(rd.groups) && rd.groups.length >= 2 && rd.groups.some(function (g: any): boolean { return g.key === 'user.name' && g.value === '基线名字' && g.scope === 'local' }), 'B2 配置行按 show-origin 反推的作用域逐条回来（含本仓库 user.name 与它的来源作用域）')
  check(rd.identity && rd.identity.name && rd.identity.name.local === '基线名字', 'B3 身份两条带本仓库作用域的旧值（user.name = 基线名字）')
  check(typeof rd.configPath === 'string' && /[.]git[\\/]config$/.test(rd.configPath), 'B4 用 rev-parse --git-path 读本仓库配置文件的绝对路径')
  check(rd.hooks && rd.hooks.readable === true && String(rd.hooks.dir).indexOf('hooks') >= 0, 'B5 钩子目录可读，路径跟着 core.hooksPath 走')
  check(Array.isArray(rd.hooks.entries) && rd.hooks.entries.some(function (e: any): boolean { return e.name === 'pre-commit' && e.sample === false }) && rd.hooks.entries.some(function (e: any): boolean { return e.sample === true }), 'B6 钩子清单认得出真钩子与 .sample 示例')
  check(rd.hookRunVersion && rd.hookRunVersion.state === 'full', 'B7 2.49 上手势跑钩子这一档回 full')
  check(rd.attr && rd.attr.state === 'ok' && rd.attr.entries.some(function (e: any): boolean { return e.attr === 'text' }), 'B8 属性规则按路径读出 .gitattributes 命中的规则（只读）')
  check(rd.mailmap && rd.mailmap.state === 'ok' && String(rd.mailmap.mapped).indexOf('base@example.com') >= 0, 'B9 邮件映射按地址查出映射结果（只读）')
  check(Array.isArray(rd.entries) && rd.entries.length === 8 && rd.entries[0].capId === '12.1' && rd.entries[7].capId === '12.8', 'B10 八条能力各一条入口定义随读数一起回（12.1–12.8）')
  const notRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'dsws1760-nr-'))
  const rdBad = await vcA.handleGitConfigRead({ cwd: notRepo })
  check(rdBad.ok === false && rdBad.error && rdBad.error.kind === 'not-repo', 'B11 不是 git 仓库时当场拒（not-repo），不假装读到空配置')

  // ---- C 组：身份两键的写入（真 git，先签票再凭票执行） ----
  const beforeC = countWrites()
  const ck1 = await vcA.handleGitConfigCheck({ cwd: repoA, op: 'config-set', key: 'user.name', value: '新名字' })
  check(ck1.ok === true && ck1.ticket && ck1.ticket.op === 'config-set' && ck1.confirmRequired === false, 'C1 改身份姓名的预检签票，不需要确认卡')
  check(ck1.ticket.expiresAtMs - ck1.ticket.checkedAtMs === 120000, 'C2 票的有效期是 120 秒（与写动作三段式同一口径）')
  check(ck1.scene && ck1.scene.nameLocal === '基线名字', 'C3 预检照回现场：改之前本仓库的姓名旧值')
  const wr1 = await vcA.handleGitConfigWrite({ cwd: repoA, op: 'config-set', ticketId: ck1.ticket.id, requestId: 'c1' })
  check(wr1.ok === true && wr1.oldValue === '基线名字' && wr1.newValue === '新名字', 'C4 凭票改配置成功，并回旧值与新值（界面据此显示旧值）')
  check(git(repoA, ['config', '--local', 'user.name']).out === '新名字', 'C5 真仓库里的 user.name 真的变成了新名字')
  const beforeRO = countWrites()
  const ckRO = await vcA.handleGitConfigCheck({ cwd: repoA, op: 'config-set', key: 'core.autocrlf', value: 'true' })
  check(ckRO.ok === false && ckRO.error.kind === 'args' && ckRO.reason === 'key-readonly', 'C6 身份之外的键当场拒（只读，不做通用键值编辑器）')
  check(countWrites() === beforeRO, 'C7 非身份键的拒绝发生在起 git 之前（零写进程）')
  const beforeNo = countWrites()
  const wrNo = await vcA.handleGitConfigWrite({ cwd: repoA, op: 'config-set', ticketId: 'missing-ticket-1', key: 'user.name', value: '偷偷改' })
  check(wrNo.ok === false && wrNo.error.reason === 'ticket-missing' && countWrites() === beforeNo, 'C8 没有票的写请求零进程拒绝')
  const beforeF = countWrites()
  const wrF = await vcA.handleGitConfigWrite({ cwd: repoA, op: 'config-set', ticketId: 'forged-123', key: 'user.name', value: '偷偷改' })
  check(wrF.ok === false && wrF.error.reason === 'ticket-missing' && countWrites() === beforeF, 'C9 伪造票同样零进程拒绝')
  const ckE = await vcA.handleGitConfigCheck({ cwd: repoA, op: 'config-set', key: 'user.email', value: 'new@example.com' })
  const wrMismatch = await vcA.handleGitConfigWrite({ cwd: repoA, op: 'config-unset', ticketId: ckE.ticket.id })
  check(wrMismatch.ok === false && wrMismatch.error.reason === 'ticket-op-mismatch', 'C10 拿 A 动作的票执行 B 动作当场拒（换动作票不通用）')
  clockNow += 120001
  const wrExp = await vcA.handleGitConfigWrite({ cwd: repoA, op: 'config-set', ticketId: ckE.ticket.id, requestId: 'c-exp' })
  check(wrExp.ok === false && wrExp.error.reason === 'ticket-expired', 'C11 过期票（超过 120 秒）拒绝执行，不自动重放')
  clockNow = 5050
  const ckStale = await vcA.handleGitConfigCheck({ cwd: repoA, op: 'config-set', key: 'user.email', value: 'later@example.com' })
  git(repoA, ['config', '--local', 'user.email', '先被别处改了@example.com'])
  const wrStale = await vcA.handleGitConfigWrite({ cwd: repoA, op: 'config-set', ticketId: ckStale.ticket.id, requestId: 'c-stale' })
  check(wrStale.ok === false && wrStale.error.reason === 'target-changed', 'C12 预检之后旧值被别处改掉，凭票执行拒绝（target-changed）')
  const ckUn = await vcA.handleGitConfigCheck({ cwd: repoA, op: 'config-unset', key: 'user.name', scope: 'local' })
  check(ckUn.ok === true && ckUn.confirmRequired === true && ckUn.confirm && ckUn.confirm.target === 'user.name', 'C13 删配置要先确认，确认卡对象写清是哪个键')
  const beforeNC = countWrites()
  const wrNC = await vcA.handleGitConfigWrite({ cwd: repoA, op: 'config-unset', ticketId: ckUn.ticket.id, requestId: 'c-nc' })
  check(wrNC.ok === false && wrNC.error.reason === 'need-confirm' && countWrites() === beforeNC, 'C14 没确认的删除零进程拒绝（need-confirm）')
  const wrUn = await vcA.handleGitConfigWrite({ cwd: repoA, op: 'config-unset', ticketId: ckUn.ticket.id, requestId: 'c-un', confirmed: true })
  check(wrUn.ok === true && wrUn.oldValue === '新名字', 'C15 确认后凭票删掉本仓库的姓名，并回删之前的旧值')
  check(git(repoA, ['config', '--local', 'user.name']).code !== 0, 'C16 真仓库里的 user.name 真的被删掉了')
  const repoB = mkRepo('b2')
  const ckB = await vcA.handleGitConfigCheck({ cwd: repoB, op: 'config-set', key: 'user.name', value: '另一仓库' })
  const wrCross = await vcA.handleGitConfigWrite({ cwd: repoA, op: 'config-set', ticketId: ckB.ticket.id, requestId: 'c-cross' })
  check(wrCross.ok === false && wrCross.error.reason === 'stale-repo', 'C17 在 A 仓库签的票拿到 B 仓库用，当场拒（stale-repo）')

  // ---- D 组：钩子清单与 2.36 版本门 ----
  const vcLow = makeVc('git version 2.34.1')
  const rdLow = await vcLow.handleGitConfigRead({ cwd: repoA })
  check(rdLow.ok === true && rdLow.hookRunVersion.state === 'hidden' && rdLow.hookRunVersion.needed === '2.36.0', 'D1 2.34 上读回「手动跑钩子这一档隐藏」，并给出需要的版本')
  check(String(rdLow.hookRunVersion.alternative).indexOf('终端直接执行钩子文件') >= 0, 'D2 隐藏时仍给替代做法（隐藏不等于沉默）')
  const beforeDV = countHookRuns()
  const ckLow = await vcLow.handleGitConfigCheck({ cwd: repoA, op: 'hook-run', name: 'pre-commit' })
  check(ckLow.ok === false && ckLow.error.kind === 'blocked' && ckLow.reason === 'hook-version', 'D3 2.34 上预检钩子当场块住（hook-version），不签票')
  check(!ckLow.ticket && countHookRuns() === beforeDV, 'D4 低版本块住时零写进程、也不发票')
  const ckNF = await vcA.handleGitConfigCheck({ cwd: repoA, op: 'hook-run', name: 'post-merge' })
  check(ckNF.ok === false && ckNF.reason === 'hook-not-found', 'D5 钩子文件不存在时块住（hook-not-found），不拿空钩子去跑')
  const ckH = await vcA.handleGitConfigCheck({ cwd: repoA, op: 'hook-run', name: 'pre-commit' })
  check(ckH.ok === true && ckH.ticket && ckH.confirmRequired === true && ckH.confirm.target === 'pre-commit', 'D6 2.49 上钩子预检签票，并要求先确认（钩子是仓库里的脚本）')
  check(git(repoA, ['config', '--local', 'user.name']).code !== 0, 'D7 预检没有偷偷改动配置（旧值仍是删掉之后的状态）')

  // ---- E 组：手动跑钩子（凭票执行、输出上限、重放去重、现场变化） ----
  const wrH = await vcA.handleGitConfigWrite({ cwd: repoA, op: 'hook-run', ticketId: ckH.ticket.id, requestId: 'e1', confirmed: true })
  check(wrH.ok === true && String(wrH.output).indexOf('hook-ran') >= 0 && wrH.hookFailed === false, 'E1 凭票真的跑起了钩子，输出原样带回')
  check(wrH.kind === 'done' && wrH.exitCode === 0 && wrH.truncated === false, 'E2 钩子正常退出：done、退出码 0、没截断')
  check(typeof wrH.command === 'string' && wrH.command.indexOf('hook run') >= 0, 'E3 结果里带 git 子命令名（界面照实显示跑了什么）')
  fs.writeFileSync(path.join(repoA, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\necho hook-failed\nexit 7\n')
  const ckFail = await vcA.handleGitConfigCheck({ cwd: repoA, op: 'hook-run', name: 'pre-commit' })
  const wrFail = await vcA.handleGitConfigWrite({ cwd: repoA, op: 'hook-run', ticketId: ckFail.ticket.id, requestId: 'e4', confirmed: true })
  check(wrFail.ok === true && wrFail.hookFailed === true && wrFail.exitCode === 7 && String(wrFail.output).indexOf('hook-failed') >= 0, 'E4 钩子自己退出码非零不算电话失败：照回 hookFailed 与退出码（界面不假装跑完）')
  fs.writeFileSync(path.join(repoA, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\necho hook-once\nexit 0\n')
  const ckOnce = await vcA.handleGitConfigCheck({ cwd: repoA, op: 'hook-run', name: 'pre-commit' })
  const beforeReplay = spawnLog.filter(function (s: string): boolean { return s.indexOf(' hook run ') >= 0 }).length
  const wrOnce = await vcA.handleGitConfigWrite({ cwd: repoA, op: 'hook-run', ticketId: ckOnce.ticket.id, requestId: 'e-once', confirmed: true })
  const midReplay = spawnLog.filter(function (s: string): boolean { return s.indexOf(' hook run ') >= 0 }).length
  const wrAgain = await vcA.handleGitConfigWrite({ cwd: repoA, op: 'hook-run', ticketId: ckOnce.ticket.id, requestId: 'e-once', confirmed: true })
  const afterReplay = spawnLog.filter(function (s: string): boolean { return s.indexOf(' hook run ') >= 0 }).length
  check(wrOnce.ok === true && midReplay === beforeReplay + 1, 'E5 一次凭票执行只起一条 hook run 进程')
  check(wrAgain.ok === true && wrAgain.reused === true && afterReplay === midReplay, 'E6 同一 requestId 重放回同一份结果，且不再起进程')
  const ckDigest = await vcA.handleGitConfigCheck({ cwd: repoA, op: 'hook-run', name: 'pre-commit' })
  fs.writeFileSync(path.join(repoA, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\necho hook-changed\nexit 0\n')
  const beforeChanged = countHookRuns()
  const wrChanged = await vcA.handleGitConfigWrite({ cwd: repoA, op: 'hook-run', ticketId: ckDigest.ticket.id, requestId: 'e-changed', confirmed: true })
  check(wrChanged.ok === false && wrChanged.error.reason === 'target-changed', 'E7 预检之后钩子文件被改过，凭票执行拒绝（绑定的是钩子内容摘要）')
  check(countHookRuns() === beforeChanged, 'E8 钩子文件变化后的拒绝发生在起写命令之前（零写进程）')

  printGateResult(GATE, total, failed)
  process.exit(failed ? 1 : 0)
}
main().catch(function (e: any): void { console.log('  FAIL 门禁自己抛错：' + String((e && e.stack) || e)); printGateResult(GATE, total, 1); process.exit(1) })
