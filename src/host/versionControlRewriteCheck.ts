/**
 * src/host/versionControlRewriteCheck.ts —— 全库重写的预览与预检签票（#1750 T15，规格 #1586 域 5.11）
 *
 * 两个电话：预览（只读，给影响计数与命令原文）与预检（表单校验 + 现场闸 + 备份决策 + 签 120 秒票）。
 * 为什么预览单独一个电话：五张表单填一点就要能看「会影响多少东西」，不能每改一个字都签一张票；
 * 签票只在人点「准备执行」时发生，票里绑着计划摘要与工作区形状，执行前逐格重验（见 Write 片）。
 *
 * 约定：本文件不执行任何写命令，也不起别的 git 进程——读写全走注入的现场读取层（Scene 片）。
 * 票的有效期只表示「预检结论新鲜」，不延长长任务的执行时限（filter-repo 走任务通道，不在票据时限内）。
 */
import { failPhone } from '../shared/version-control/exec-envelope.js'
import { makeTicket } from '../shared/version-control/src/write-ticket.js'
import { rewritePlanOf, rewriteFormProblem, rewriteFormOf, rewriteGuardProblem } from '../shared/version-control/src/rewrite-ops.js'

/** 造预检层；依赖全部由装配壳显式传入。 */
export function createRewriteCheck(deps: any): any {
  const tickets: Map<string, any> = new Map()
  const results: Map<string, any> = new Map()
  const now = function (): number { try { return typeof deps.now === 'function' ? Number(deps.now()) : Date.now() } catch (e) { return Date.now() } }
  const nextId = function (): string { try { return typeof deps.randomId === 'function' ? String(deps.randomId()) : 'rw' + Math.random().toString(36).slice(2, 12) } catch (e) { return 'rw' + Math.random().toString(36).slice(2, 12) } }

  /** 失败信封：reason 同时写进 error 与顶层，界面按 reason 取词条，门禁按 reason 断言。 */
  function fail(kind: any, reason: any, message: any, extra?: any): any {
    const base: any = failPhone(kind, message)
    base.error.reason = String(reason || '')
    base.reason = String(reason || '')
    if (extra) Object.assign(base, extra)
    return base
  }

  const argsFail = function (reason: any, extra?: any): any { return fail('args', reason, '这次请求缺东西或者形状不对：' + String(reason), extra) }

  /** 阻止信封：没起任何写进程，回包告诉界面停在哪个理由上。 */
  function blocked(op: any, reason: any, extra?: any): any {
    const out: any = fail('blocked', reason, String(reason), extra)
    out.op = op
    out.decision = { verdict: 'block', reasons: [String(reason)] }
    out.reasons = [String(reason)]
    return out
  }

  /** 把请求里的载荷归一成计划：也接受界面直接把表单字段铺在顶上。 */
  function planFrom(args: any): any {
    const payload: any = (args && args.plan) ? args.plan : args
    return rewritePlanOf(payload || {})
  }

  /**
   * 预览电话：只读。表单自身不合法时回失败（先让人把输入改对），但不因现场闸（tool-missing、脏工作区等）
   * 拦预览——预览的意义正是让人在动手前看清影响。
   */
  async function handleRewritePreview(args: any): Promise<any> {
    const a: any = args || {}
    if (!a.cwd || typeof a.cwd !== 'string') return argsFail('bad-target')
    const plan: any = planFrom(a)
    if (!rewriteFormOf(plan.form)) return argsFail('bad-form')
    const formProblem: any = rewriteFormProblem(plan.form, plan)
    if (formProblem) return argsFail(formProblem)
    const full: any = await deps.scene.sceneOf(a.cwd)
    if (full.ok !== true) return full
    const preview: any = await deps.scene.previewOf(full, plan)
    if (preview.ok !== true) return preview
    return Object.assign({ ok: true, op: 'rewrite', plan: plan, preview: preview, scene: deps.scene.sceneSummaryOf(full.scene), readAtMs: now() })
  }

  /**
   * 确认卡四段：做什么、不做什么、可不可逆、怎么继续。备份在哪、多大也写进来。
   * 这里写中文完整句而不是词条键：确认卡是最后一道人看的门，宿主把事实说全，界面原样展示，
   * 避免「词条翻译得好看、事实却漏了」这类事故；四段都写全也方便门禁逐段断言。
   */
  function confirmOf(plan: any, preview: any, backup: any): any {
    const form: any = rewriteFormOf(plan.form) || {}
    const what: string[] = [
      '用 filter-repo 的「' + String(form.labelKey || plan.form) + '」表单重写这个仓库的全部 ' + String(preview.counts.commits) + ' 个提交的历史。',
      '全部提交号都会变：重写之后旧的提交哈希一个都不再存在。',
      '远端要强推（git push --force）才能和本地对齐。',
      '每个协作者都必须重新克隆这个仓库，不能继续在旧克隆上推拉。',
    ]
    const wont: string[] = [
      '不执行 filter-branch 本体：它只作为只读说明保留。',
      '不提供自动恢复：备份只是给你一条可自己执行的还原路径。',
      '不改 replace 与 fast-export/import 两件事，它们归别的票。',
    ]
    return {
      what: what,
      wont: wont,
      reversible: true,
      verb: '备份成功后执行整仓重写',
      backup: {
        kind: backup && backup.kind === 'bundle' ? 'bundle' : 'mirror',
        path: String((backup && backup.path) || ''),
        estimateBytes: Number((backup && backup.estimateBytes) || 0),
        repoSizeBytes: Number((backup && backup.repoSizeBytes) || 0),
      },
      command: String(preview.command || ''),
    }
  }

  /** 签票：把计划与绑定值打包成 120 秒票，界面拿票号去执行。 */
  function sign(plan: any, full: any, confirm: any, backup: any): any {
    const ticket: any = makeTicket({
      id: nextId(),
      op: plan.op,
      nowMs: now(),
      headOid: full.scene.headOid,
      indexFingerprint: null,
      indexEntries: null,
      target: null,
      repoRoot: full.scene.repoRoot,
      changes: null,
      bindings: deps.scene.bindingsOf(full.screen, plan),
    })
    ticket.plan = plan
    ticket.rewrite = plan
    ticket.decision = { verdict: 'allow', reasons: ['ok'] }
    ticket.confirm = confirm
    ticket.confirmRequired = true
    // 备份计划随票存一份：确认卡上写的是哪个路径，执行时就备份到哪个路径，不在执行时重新算。
    ticket.backup = backup
    ticket.sceneSummary = deps.scene.sceneSummaryOf(full.scene)
    tickets.set(ticket.id, ticket)
    // 票表只留最近两百张：预检是高频动作，旧票过一百二十秒本来也过期，留太多没有意义。
    if (tickets.size > 200) { const keys: any[] = Array.from(tickets.keys()); tickets.delete(keys[0]) }
    return ticket
  }

  /**
   * 预检电话：表单校验 → 现场闸 → 影响预览 → 备份决策 → 签票。
   * 顺序有讲究：现场闸在预览之前，因为工具没装、仓库是浅克隆、工作区脏这三件事会让人白等一次预览。
   */
  async function handleRewriteCheck(args: any): Promise<any> {
    const a: any = args || {}
    if (!a.cwd || typeof a.cwd !== 'string') return argsFail('bad-target')
    const plan: any = planFrom(a)
    if (!rewriteFormOf(plan.form)) return argsFail('bad-form')
    const formProblem: any = rewriteFormProblem(plan.form, plan)
    if (formProblem) return argsFail(formProblem)
    const full: any = await deps.scene.sceneOf(a.cwd)
    if (full.ok !== true) return full
    const guard: any = rewriteGuardProblem(full.scene, plan)
    if (guard) {
      const extra: any = { plan: plan, scene: deps.scene.sceneSummaryOf(full.scene) }
      // 工具没装时把探测到的版本与「去哪里装」一起说清楚，别让人对着一条失败命令猜。
      if (guard === 'tool-missing') extra.filterRepoVersion = full.scene.filterRepoVersion
      return blocked(plan.op, guard, extra)
    }
    const preview: any = await deps.scene.previewOf(full, plan)
    if (preview.ok !== true) return preview
    const backup: any = deps.scene.backupPlanOf(full.scene)
    // previewOf 已经回的是预览本体（counts/command 都在这一层），不要再往里点一层。
    const confirm: any = confirmOf(plan, preview, backup)
    const ticket: any = sign(plan, full, confirm, backup)
    return {
      ok: true,
      contract: 'vc-rewrite-check',
      version: 1,
      op: plan.op,
      decision: { verdict: 'allow', reasons: ['ok'] },
      reasons: ['ok'],
      confirmRequired: true,
      confirm: confirm,
      ticket: { id: ticket.id, op: ticket.op, checkedAtMs: ticket.checkedAtMs, expiresAtMs: ticket.expiresAtMs },
      plan: plan,
      preview: preview.preview,
      backup: backup,
      scene: deps.scene.sceneSummaryOf(full.scene),
      readAtMs: now(),
    }
  }

  return { handleRewritePreview: handleRewritePreview, handleRewriteCheck: handleRewriteCheck, tickets: tickets, results: results }
}
