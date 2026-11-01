/**
 * src/host/versionControlMaintenanceCheck.ts —— 维护动作的预检签票与只读电话（#1758 T22，规格 #1586 域 11）
 *
 * 为什么单独一叶：维护动作要在动手前把「这个仓库现在是什么样、版本够不够、备份放哪、会删多少」
 * 一次读完并钉在票据里；执行层凭票再验一次现场，任何一格变了就零进程拒绝。
 * 本文件只签票、不执行：真正起任务或起本地维护命令在 versionControlMaintenanceWrite.ts。
 *
 * 铁律（改之前先读）：
 *   1. 票据只证明预检结论新鲜（120 秒），不管执行时长；长任务本身走任务通道，不占票据时限。
 *   2. 危险动作（清除不可达对象）必须先给出备份计划、并把「删了就找不回」写进确认卡；
 *      备份是否成功由执行层在动手前实测，预检只把计划和路径钉进票里。
 *   3. 版本不够的动作直接拒绝并说明替代做法，不签一张注定失败的命令票。
 */
import { failPhone } from '../shared/version-control/exec-envelope.js'
import { makeTicket } from '../shared/version-control/src/write-ticket.js'
import { humanBytesOf } from '../shared/version-control/src/recovery-point.js'
import {
  MAINTENANCE_CHECK_CONTRACT,
  MAINTENANCE_CHECK_VERSION,
  MAINTENANCE_VERSION_HIDE,
  maintenancePlanOf,
  maintenanceWriteOpOf,
  maintenanceSceneProblem,
  maintenanceVersionProblem,
  maintenanceRequiresBackupOf,
} from '../shared/version-control/src/maintenance-ops.js'

/** 票表上限：超过就删最旧的一张，免得长时间开着面板把内存攒成一个仓库历史。 */
const TICKET_MAX: number = 200

/** 造预检层；依赖全部由装配壳显式传入。 */
export function createMaintenanceCheck(deps: any): any {
  const read: any = deps.read
  const tickets: Map<string, any> = new Map()
  const results: Map<string, any> = new Map()
  const now = function (): number { try { return typeof deps.now === 'function' ? Number(deps.now()) : Date.now() } catch (e) { return Date.now() } }
  const nextId = function (): string { try { return String(deps.randomId()) } catch (e) { return 'm' + Math.random().toString(36).slice(2, 12) } }

  /** 失败信封：与其它页同一形状，reason 同时写进 error 与顶层。 */
  function fail(kind: any, reason: any, message: any, extra?: any): any {
    const base: any = failPhone(kind, message)
    base.error.reason = String(reason || '')
    base.reason = String(reason || '')
    if (extra) Object.assign(base, extra)
    return base
  }

  /** 拒绝信封：带上契约、动作与决策，界面据此画「为什么不让做」。 */
  function blocked(op: string, reason: string, message: string, extra?: any): any {
    const out: any = fail('blocked', reason, message)
    out.contract = MAINTENANCE_CHECK_CONTRACT
    out.version = MAINTENANCE_CHECK_VERSION
    out.op = op
    out.decision = { verdict: 'block', reasons: [reason] }
    out.reasons = [reason]
    out.readAtMs = now()
    if (extra) Object.assign(out, extra)
    return out
  }

  /** 界面/票据用的一句话现场摘要：不把整个 screen 塞进回包。 */
  function sceneSummaryOf(scene: any): any {
    return {
      repoRoot: scene.repoRoot,
      repoName: scene.repoName,
      headOid: scene.headOid,
      branch: scene.branch,
      gitVersion: scene.gitVersion,
      objects: scene.objects,
      maintenance: scene.maintenance,
      repoSizeBytes: scene.repoSizeBytes,
      freeBytes: scene.freeBytes,
      operation: scene.operation,
      dirty: scene.dirty,
      readAtMs: scene.readAtMs,
    }
  }

  /** 四段确认卡：做什么、不做什么、能不能恢复、按下去会发生什么。 */
  function confirmOf(op: string, scene: any, extra: any): any {
    const name: string = scene.repoName || scene.repoRoot
    if (op === 'prune') {
      const preview: any = extra.preview || {}
      const backup: any = extra.backup || {}
      const when: string = preview.earliestAtMs ? new Date(Number(preview.earliestAtMs)).toISOString() : '时间读不出（对象已打包）'
      return {
        what: '会从「' + name + '」里删掉 ' + String(preview.count || 0) + ' 个不可达对象（最早 ' + when + '），它们已经不再被任何引用或 reflog 指向，删掉之后就找不回来了。动手前会先做一份整仓备份到 ' + String(backup.path || '') + '（' + (backup.kind === 'bundle' ? '整仓打包' : '镜像克隆') + '，大约 ' + humanBytesOf(Number(backup.estimateBytes) || 0) + '）。',
        wont: '不删仍然被引用或被 reflog 保住的提交；不做整仓重写；备份只给还原步骤，面板不自动恢复。',
        reversible: false,
        verb: '按下之后先备份，备份成功才开始清理；备份失败会中止，一个对象都不删。',
        command: 'git prune',
        backup: backup,
        preview: preview,
      }
    }
    if (op === 'gc') {
      return {
        what: '会对「' + name + '」跑一次垃圾回收：把松散对象打成一个包，并清掉按默认保留期已经过期、不再被任何引用或 reflog 指向的对象；提交、分支和标签都不会变。',
        wont: '不删分支、不改历史、不碰远端。',
        reversible: true,
        verb: '按下之后开始回收，进度在任务区，可以取消；取消只停进程，已经整理好的对象不会还原。',
        command: 'git gc',
      }
    }
    if (op === 'maintenance-run') {
      return {
        what: '会让 git 立刻跑一轮自动维护任务（按仓库配置里开启的任务执行，默认包含垃圾回收）；提交、分支和标签都不会变。',
        wont: '不开启后台调度计划；不改仓库配置；不碰远端。',
        reversible: true,
        verb: '按下之后开始运行，进度在任务区，可以取消。',
        command: 'git maintenance run',
      }
    }
    if (op === 'maintenance-enable') {
      return {
        what: '会把「' + name + '」登记到本机后台自动维护清单，并装一个系统调度任务，之后 git 会在后台定期整理对象库。',
        wont: '不改提交与引用；不立刻跑维护任务；不动远端。',
        reversible: true,
        verb: '按下后安装调度任务；想撤销随时可以点关闭自动维护。',
        command: 'git maintenance start',
      }
    }
    return {
      what: '会先停掉系统调度任务，再把这个仓库从自动维护清单里移除；已有的提交和对象都不动。',
      wont: '不删对象、不改历史、不动远端。',
      reversible: true,
      verb: '按下后按 stop（摘掉系统调度项）→ unregister（移出维护清单）两步执行。',
      command: 'git maintenance stop / unregister',
    }
  }

  /** 只读电话：一条命令读一类事实，界面与预检共用。 */
  async function handleMaintenanceRead(args: any): Promise<any> {
    const a: any = args || {}
    return read.readOf(String(a.cwd || ''), String(a.op || ''))
  }

  /**
   * 预检电话：认动作 → 量现场 → 版本门与现场闸 → 危险动作补预览与备份计划 → 签 120 秒票。
   * 拒绝对话仍回可读事实（例如不可达对象 0 个时把预览一起带回），界面不用为拒绝再跑一次读数。
   */
  async function handleMaintenanceCheck(args: any): Promise<any> {
    const a: any = args || {}
    const op: string = String(a.op || '')
    const meta: any = maintenanceWriteOpOf(op)
    if (meta === null) return fail('args', 'bad-target', '维护页能签票的只有写动作，认不出这个动作：' + op)
    if (typeof a.cwd !== 'string' || a.cwd.trim() === '') return fail('args', 'bad-target', '缺少仓库目录，不知道该维护哪个仓库。')
    const plan: any = maintenancePlanOf({ op: op, mode: a.mode })
    const measured: any = await read.measure(a.cwd, plan)
    if (measured.ok !== true) return measured
    const scene: any = measured.scene
    const repoProblem: string | null = maintenanceSceneProblem({ repoBare: false, operation: scene.operation })
    if (repoProblem !== null) return blocked(op, repoProblem, repoProblem === 'operation-in-progress' ? '这个仓库有合并或变基正在进行，先收尾再来整理对象库。' : '这个仓库现在不能做维护动作。', { scene: sceneSummaryOf(scene) })
    const versionProblem: string | null = maintenanceVersionProblem(meta, scene.gitVersion)
    if (versionProblem !== null) {
      const need: string = MAINTENANCE_VERSION_HIDE[meta.capId] || ''
      return blocked(op, versionProblem, '这个 git 版本（' + scene.gitVersion + '）还没有自动维护（需要 ' + need + ' 起）；老版本可以用垃圾回收代替自动维护。', { scene: sceneSummaryOf(scene), needed: need })
    }
    const facts: any = {}
    if (op === 'maintenance-enable' && scene.maintenance.registeredLocal === true) {
      return blocked(op, 'nothing-to-do', '这个仓库已经登记了后台自动维护，不用重复开启。', { scene: sceneSummaryOf(scene) })
    }
    if (op === 'maintenance-disable' && scene.maintenance.registered !== true) {
      return blocked(op, 'nothing-to-do', '这个仓库没有登记后台自动维护，没有可关闭的计划。', { scene: sceneSummaryOf(scene) })
    }
    if (maintenanceRequiresBackupOf(op)) {
      const preview: any = await read.prunePreviewOf(measured.exe || 'git', measured.repoRoot)
      if (preview.ok !== true) return preview
      if (Number(preview.count) === 0) {
        return blocked(op, 'nothing-to-do', '现在没有不可达对象，不用清理；等以后出现再来。', { scene: sceneSummaryOf(scene), preview: preview })
      }
      facts.preview = preview
      facts.backup = read.backupPlanOf(scene)
    }
    const confirm: any = confirmOf(op, scene, facts)
    const bindings: any = read.bindingsOf(measured.screen, plan, scene.maintenance)
    const ticket: any = makeTicket({
      id: nextId(),
      op: op as any,
      nowMs: now(),
      headOid: scene.headOid,
      indexFingerprint: null,
      indexEntries: null,
      target: null,
      repoRoot: scene.repoRoot,
      changes: null,
      bindings: bindings,
    })
    ticket.plan = plan
    ticket.maintenance = { op: op, capId: meta.capId }
    ticket.decision = { verdict: 'allow', reasons: ['ok'] }
    ticket.confirmRequired = true
    ticket.confirm = confirm
    ticket.sceneSummary = sceneSummaryOf(scene)
    if (facts.backup) ticket.backup = facts.backup
    if (facts.preview) ticket.preview = facts.preview
    tickets.set(ticket.id, ticket)
    if (tickets.size > TICKET_MAX) { const keys: any[] = Array.from(tickets.keys()); tickets.delete(keys[0]) }
    const out: any = {
      ok: true,
      contract: MAINTENANCE_CHECK_CONTRACT,
      version: MAINTENANCE_CHECK_VERSION,
      op: op,
      decision: { verdict: 'allow', reasons: ['ok'] },
      reasons: ['ok'],
      confirmRequired: true,
      confirm: confirm,
      ticket: { id: ticket.id, op: op, checkedAtMs: ticket.checkedAtMs, expiresAtMs: ticket.expiresAtMs },
      plan: plan,
      scene: sceneSummaryOf(scene),
      readAtMs: now(),
    }
    if (facts.backup) out.backup = facts.backup
    if (facts.preview) out.preview = facts.preview
    return out
  }

  return {
    handleMaintenanceRead: handleMaintenanceRead,
    handleMaintenanceCheck: handleMaintenanceCheck,
    tickets: tickets,
    results: results,
    measure: read.measure,
  }
}
