/**
 * src/host/versionControlCommitForm.ts —— 提交表单的只读取数电话（#1743，规格域 2）
 *
 * 为什么单独一份：提交页要把「本机签名配置、提交说明模板、上一条提交的原文」一起摆进面板，
 * 这三样都只能向 git 与文件系统问。把它们留在 src/host/versionControl.ts 会让父文件继续膨胀，
 * 所以照改动页的先例做成同层叶子：父文件只接一根 loggedPhone 的线，判定与解析都在这里。
 *
 * 约定（改了会坏的地方）：
 *   1) 只读：只跑 git config --list、rev-parse --verify HEAD、log -1 三条只读命令，绝不写仓库。
 *   2) 命令一律走父文件注入的同一进程出口：-C 钉仓库、固定前缀、字节上限、超时、git.exec 日志，
 *      本文件不直接调用任何起进程的内建模块（门禁会扫一遍源码确认这件事）。
 *   3) 失败统一 failPhone 信封 { ok:false, error:{ kind, message } }，与其它电话同一形状。
 *   4) 软降级的两处：提交说明模板文件读不到、修订目标读不到，电话本身仍回 ok:true，由回包里的
 *      template.problem / amend.problem 告诉界面哪一项不能用——表单不能因为模板丢了就整张打不开。
 *   5) 回包里不放原始配置文件全文，只放表单真正需要的六项：身份两项、签名三项、模板一项。
 */
import { commitTrailerOf } from '../shared/version-control/src/commit-plan.js'

/** 提交说明模板最多读这么多字：模板是给人看的说明，超过这个长度一定不是模板本身，宁可截断也不撑爆面板。 */
const TEMPLATE_LIMIT: number = 64 * 1024

/** 表单要读的那几项本机配置：键名写死，不把整份 git config 倒给界面（其中可能有凭据类配置）。 */
const FORM_CONFIG_KEYS: string[] = ['user.name', 'user.email', 'user.signingkey', 'gpg.format', 'commit.gpgsign', 'commit.template']

/** 拼仓库内相对路径：git 在 Windows 上也认正斜杠，这里统一用正斜杠，避免两处写法算出两个路径。 */
function joinRepo(root: any, rel: any): string { return String(root || '').replace(/[\\/]+$/, '') + '/' + String(rel || '') }

/** 去掉行尾换行：git 的单行输出（oid、短号、一句话主题）都带换行，界面不需要。 */
function trimOneLine(v: any): string { return String(v === undefined || v === null ? '' : v).replace(/[\r\n]+$/, '') }

/** 绝对路径识别：Windows 盘符、正斜杠开头、反斜杠开头三种都算绝对路径，其余按仓库内相对路径拼。 */
function isAbsPath(p: any): boolean { return /^[A-Za-z]:[\\/]/.test(String(p)) || /^[\\/]/.test(String(p)) }

/** git config --null --list 的输出：每条是「键\n值」，条目之间用 NUL 分隔；同一个键出现多次时后出现的赢（与 git 自己的口径一致）。 */
function parseConfigNul(text: any): any {
  const out: any = {}
  const entries: string[] = String(text === undefined || text === null ? '' : text).split('\u0000')
  for (let i: number = 0; i < entries.length; i += 1) {
    const entry: string = entries[i]
    if (entry === '') continue
    const cut: number = entry.indexOf('\n')
    if (cut < 0) continue
    const key: string = entry.slice(0, cut).replace(/\r$/, '')
    out[key] = entry.slice(cut + 1)
  }
  return out
}

/** git 的布尔配置只有这几种写法算开；其余（含没写）都算关。 */
function configTruthy(v: any): boolean { const t: string = String(v === undefined || v === null ? '' : v).trim().toLowerCase(); return t === 'true' || t === 'yes' || t === 'on' || t === '1' }

/**
 * 造提交表单的只读取数电话。
 * 依赖全部由父文件传入（同一个 git 进程出口、同一个文件服务），这里不猜环境、不直接碰 Node 内建模块。
 */
export function createCommitFormPhone(host: any): any {
  const h: any = host || {}
  const failPhone: any = h.failPhone
  const fs: any = h.fs
  const fsAbsence: any = h.fsAbsence
  const resolveGitExecutable: any = h.resolveGitExecutable
  const runGit: any = h.runGit
  const fixedPrefix: any = h.fixedPrefix
  const DEFAULT_CWD: any = h.DEFAULT_CWD
  const timeoutMs: any = (typeof h.timeoutMs === 'number' && h.timeoutMs > 0) ? h.timeoutMs : 20000
  const STDOUT_LIMIT: number = (typeof h.STDOUT_LIMIT === 'number' && h.STDOUT_LIMIT > 0) ? h.STDOUT_LIMIT : 8 * 1024 * 1024
  const nowFn: any = (typeof h.now === 'function') ? h.now : Date.now

  /** 一条只读命令：-C 钉仓库 + 固定前缀，参数各自独立成元素，不经 shell。 */
  async function readGit(dir: any, argv: any): Promise<any> {
    const exe: any = await resolveGitExecutable()
    if (!exe) return { kind: 'spawn-failed', message: '找不到 git 命令（platform.resolveExecutable("git") 没有给出路径）' }
    const args: string[] = ['-C', String(dir)].concat(fixedPrefix(), Array.isArray(argv) ? argv : [])
    return runGit(exe, String(dir), args, { stdoutLimit: STDOUT_LIMIT, timeoutMs: timeoutMs })
  }

  /** 把一次只读命令的失败翻成固定失败信封；成功回 null。软降级的两处只判「读不到」，不走这里。 */
  function failureOf(res: any, what: string): any {
    const kind: string = String((res && res.kind) || '')
    if (kind === 'timeout') return failPhone('timeout', what + '超时了，没能在限定时间内拿到结果')
    if (kind === 'spawn-failed') return failPhone('env', what + '起不了 git 进程：' + String((res && res.message) || ''))
    if (kind === 'stdin-failed') return failPhone('env', what + '没能把内容交给 git')
    if (kind === 'non-zero') return failPhone('git', what + '被 git 拒绝（退出码 ' + String((res && res.exitCode) || '') + '）')
    if (kind !== 'ok') return failPhone('env', what + '没能完成')
    if (res && res.truncated) return failPhone('truncated', what + '的输出超过了宿主上限，读不全就不猜')
    return null
  }

  /** 读本机 git 配置里表单用得到的那几项；读不成整条电话失败（身份与签名设置拿不到，表单没法可靠预填）。 */
  async function readFormConfig(dir: any): Promise<any> {
    const res: any = await readGit(dir, ['config', '--null', '--list'])
    const bad: any = failureOf(res, '读本机 git 配置这一步')
    if (bad) return { error: bad }
    return { cfg: parseConfigNul(res.stdout) }
  }

  /** 读提交说明模板全文：路径为绝对路径就用它，其余按当前工作目录拼；读不到只软降级，不判整条电话失败。 */
  async function readTemplate(dir: any, rawPath: any): Promise<any> {
    const raw: string = trimOneLine(rawPath)
    if (raw === '') return { configured: false, path: '', text: '', truncated: false, problem: '' }
    if (!fs || typeof fs.resolve !== 'function' || typeof fs.readText !== 'function') {
      return { configured: true, path: raw, text: '', truncated: false, problem: 'unavailable' }
    }
    const abs: string = isAbsPath(raw) ? raw : joinRepo(dir, raw)
    let target: any = null
    try { target = await fs.resolve(abs) } catch (e) { return { configured: true, path: raw, text: '', truncated: false, problem: await absenceProblem(e) } }
    let text: string = ''
    try { const got: any = await fs.readText(target); text = String(got === undefined || got === null ? '' : got) } catch (e) {
      return { configured: true, path: raw, text: '', truncated: false, problem: await absenceProblem(e) }
    }
    const truncated: boolean = text.length > TEMPLATE_LIMIT
    const kept: string = truncated ? text.slice(0, TEMPLATE_LIMIT) : text
    return { configured: true, path: raw, text: kept, truncated: truncated, problem: '' }
  }

  /** 文件读不到时区分「还没有这份文件」与「真读不了」，界面按 problem 给不同提示。 */
  async function absenceProblem(e: any): Promise<string> {
    try { const absence: any = (typeof fsAbsence === 'function') ? await fsAbsence() : null; if (absence && typeof absence.isAbsenceError === 'function' && absence.isAbsenceError(e)) return 'missing' } catch (eA) {}
    return 'unreadable'
  }

  /** 读上一条提交：修订（2.3）要把原说明预填回面板，并显示原提交号；没有提交时只是按钮不可用，不是电话失败。 */
  async function readAmend(dir: any): Promise<any> {
    const rev: any = await readGit(dir, ['rev-parse', '--verify', 'HEAD'])
    if (!rev || rev.kind !== 'ok') {
      if (rev && rev.kind === 'non-zero') return { available: false, oid: '', short: '', subject: '', message: '', problem: 'no-commits' }
      return { available: false, oid: '', short: '', subject: '', message: '', problem: 'unreadable' }
    }
    const oid: string = trimOneLine(rev.stdout)
    if (oid === '') return { available: false, oid: '', short: '', subject: '', message: '', problem: 'no-commits' }
    const lg: any = await readGit(dir, ['log', '-1', '--format=%h%x00%s%x00%B'])
    if (!lg || lg.kind !== 'ok') return { available: true, oid: oid, short: oid.slice(0, 7), subject: '', message: '', problem: 'unreadable' }
    const parts: string[] = String(lg.stdout || '').split('\u0000')
    const short: string = trimOneLine(parts[0])
    const subject: string = trimOneLine(parts[1])
    const message: string = parts.slice(2).join('\u0000').replace(/\s+$/, '')
    return { available: true, oid: oid, short: short, subject: subject, message: message, problem: '' }
  }

  /** 电话 wf.gitCommitForm 的处理体：一次把身份、签名、模板、修订目标都读回来。 */
  async function handleGitCommitForm(args: any): Promise<any> {
    const cwd: any = args && typeof args.cwd === 'string' && args.cwd.trim() !== '' ? args.cwd : DEFAULT_CWD
    const dir: string = String(cwd || '')
    if (typeof resolveGitExecutable !== 'function' || typeof runGit !== 'function' || typeof fixedPrefix !== 'function') return failPhone('env', '宿主没有把 git 进程出口接给提交表单')
    const configed: any = await readFormConfig(dir)
    if (configed.error) return configed.error
    const cfg: any = configed.cfg || {}
    const identity: any = { name: String(cfg['user.name'] || ''), email: String(cfg['user.email'] || '') }
    const signing: any = { key: String(cfg['user.signingkey'] || ''), format: String(cfg['gpg.format'] || 'openpgp'), gpgsign: configTruthy(cfg['commit.gpgsign']) }
    const template: any = await readTemplate(dir, cfg['commit.template'])
    const amend: any = await readAmend(dir)
    return {
      ok: true,
      cwd: dir,
      atMs: nowFn(),
      identity: identity,
      signing: signing,
      template: template,
      trailer: commitTrailerOf(identity),
      amend: amend,
      configKeys: FORM_CONFIG_KEYS.length,
    }
  }

  return { handleGitCommitForm: handleGitCommitForm }
}
