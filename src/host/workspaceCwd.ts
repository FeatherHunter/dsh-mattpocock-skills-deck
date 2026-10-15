// src/host/workspaceCwd.ts —— 工作区归一、绑定选择与工作区配置文件落盘（H5 #449 从 host/index.js 302–388 搬出电话体，纯结构、行为零变化；#957 起标签配色两条电话搬到 ./workspaceLabelColors.js）。
// 以后谁改它：改工作区路径归一、后端绑定选择、工作区配置文件落盘（#957 首绑人选与保护自动两写）的人。标签配色两条电话（#627）已搬到 ./workspaceLabelColors.js，改那两条去那边。预估约 200 行，超 350 打回。
// 接线：由 index.ts 动态 import 加载；normCwd 由本文件单一持有，评论线程经 index 转供给复用；改色叶子经本文件动态加载（单向，基线有记录），工作区文件纯函数经静态引用（跨层允许）；目录取法调 shared 共用函数（#730）。
import { resolveSessionCwd } from '../shared/session-cwd.js'
// #1115：opCtxFor 那个计时器口的唯一实现（撤销真句柄的三档判据见该文件头）。
import { hostTimers } from '../shared/host-timer/host-timers.js'
import { parseWorkspaceFile, stringifyWorkspaceFile, WORKSPACE_FILE_REL, WORKSPACE_FILE_LEGACY_REL } from '../deck/shell/workspace-anchor.js'
// #1139：界面描述（发给界面的那份后端数据）的投影只有一处实现，本文件不再自己挑字段。
import { projectUiDescription } from '../tracker/ui-description.js'
/**
 * 写工作区文件失败时把原因分成四档（#1003 契约期望行为第 2 条：失败必须带原因，四档各说各的）：
 * 拿不到文件通道、沙箱不给本次写许可、文件系统只读、目录不存在；判不出来归 other，绝不编一个具体原因。
 */
function fileWriteReasonOf(e: any) { const s = String((e && (e.code || e.message)) || e || ''); return /EACCES|EPERM|permission|denied|permit|沙箱/i.test(s) ? 'no-permit' : (/EROFS|read-only|readonly/i.test(s) ? 'readonly' : (/ENOENT|not found|不存在/i.test(s) ? 'no-dir' : 'other')) }
/**
 * 写文件失败的四档原因 → 一句人话（#1138：写不进去就等于这次选择没生效，所以这句话会直接出现在界面提示里）。
 * 分档口径与 fileWriteReasonOf 同一份，不另判一次；认不出来的那档照实说「写入这一步报了错」，不编具体原因。
 */
function bindFailAdviceOf(reason: any) {
  if (reason === 'no-permit') return '这个工作区不在本次会话允许写入的范围内'
  if (reason === 'readonly') return '这个工作区所在的磁盘是只读的'
  if (reason === 'no-dir') return '工作区里的 docs/agents 这个目录建不出来'
  return '写入这一步报了错'
}
// #1074 转制类型：Ctx.get 取出来按 any 用（框架服务晚到是既有语义，运行时处处有 typeof 守卫）；
// WfArgs 是客户端 JSON 的边界，入口电话只负责原样转交。
type Ctx = { get(key: string): any }
type WfArgs = Record<string, any>
type Platform = import('./platform/index.js').Platform
type Registry = ReturnType<typeof import('../tracker/registry/core.js').createRegistry>
type FsSvc = { resolve(rel: string, opts?: unknown): Promise<any>; readText(t: unknown): Promise<string>; writeText(t: unknown, text: string, a?: unknown, b?: unknown, policy?: unknown): Promise<unknown>; mkdir(dir: string, opts?: unknown): Promise<unknown> }
type WorkspaceStore = { invalidate(h: unknown): unknown }
type ChoiceStore = { rememberWorkspace(cwd: unknown, backendId: unknown): Promise<any>; rememberLayout(cwd: unknown, want: unknown): Promise<any>; getWorkspace(key: unknown): Promise<any>; getLayout(cwd: unknown): Promise<any> }
type DecisionOutlet = { decideBackend(cwd: string, opts: unknown): Promise<any>; selectionFromOutlet?(o: unknown, describe: (id: string) => unknown): unknown }
type DetExec = ReturnType<typeof import('./platformChannel.js').createPlatformChannel>['detectionExec']
type LogCtx = { fire(level: string, event: string, fields?: unknown): void; isEnabled(level: string): boolean } | null
type Deps = { ctx: Ctx; DEFAULT_CWD: string; getPlatform(): Promise<Platform | null>; getTrackerRegistry(): Promise<Registry | null>; getWorkspaceStore(): Promise<WorkspaceStore>; getChoiceStore(): Promise<ChoiceStore | null>; getDecisionFn(): Promise<any>; getDetectionService?: unknown; canonicalKey(raw: string): Promise<string>; setCache(v: unknown): void; logCtx: LogCtx; timer: { timeout(ms: number): Promise<unknown> }; detectionExec: DetExec }
export function createWorkspaceCwd(deps: Deps) {
  const { ctx, DEFAULT_CWD, getPlatform, getTrackerRegistry, getWorkspaceStore, getChoiceStore, getDecisionFn, getDetectionService, canonicalKey, setCache, logCtx, timer, detectionExec } = deps
  // #176 + #190 修复：cwd 归一（绝对直通 + 相对尝试 fs.resolve + home 试探）
  // 根因：workspaces 服务在 client runtime 暴露的 item.path 可能是相对名（如 "matt-demo-markdown"），
  // 传给 wf.selection 后 select() 三级联中 markdown.matches 收到相对 cwd，plat.join(cwd,...) 仍是相对，
  // fs.resolve 默认基于进程 cwd 解析失败 → matches false → fallback → UI "未绑定"。
  // 归一后所有 handler 收到绝对 cwd，markdown.matches 命中 docs/agents/issue-tracker.md → Markdown 自动。
  // #652 起：上面三步回退连同「往上锚到工作区根」一起收进 canonicalWorkspaceKey 这一个出口 （源码在 src/host/workspaceKey.js，本文件只转交）。理由两条：① 钥匙只能有一个出口，读写删三侧 同形才删得中（#301 踩过的坑）；② 锚根正是本文件每条电话都要的——后端选择、后端绑定、配色文件 落点、标签读写全该按工作区根算。与旧行为的差别只有一条：会话选在子目录里时算出的是工作区根。
  async function normCwd(raw: string){
    try { return await canonicalKey(raw || DEFAULT_CWD) } catch (e) { return raw || DEFAULT_CWD }
  }
  // #155 + #152：后端绑定（per-workspace 覆盖，唯一写路径不回写 issue-tracker.md）+ 注册表查询 + detection 缓存失效
  // #618：用户为工作区选定后端这一步，顺手在工作区里放一份默认配色文件（幂等：文件在就一个字都不改）。
  // 怎么认出「该放的后端」：问后端自己 —— 它实现了 `ensureLabelColorsFile` 就放，没实现就是不愿意放。
  //   这里**不再按后端 id 写死名单**（原先写着 `github` / `gitlab` 直接跳过）。写死名单的毛病是：
  //   以后新来一个后端，得有人记得回来改这一行；按能力问则不用。GitHub 的标签颜色存在仓库标签上，
  //   它回的那句「不支持」就是「我不放这份文件」的意思，按跳过处理，不当失败。
  // 放失败不影响绑定本身（用户这次是来选后端的），但**不能无声**：失败要记一条日志，并且把结果如实 放进 bind 的回包里（labelColorsFile 一项），让界面与排查的人都能看见「这次没放上、为什么」。
  //   真正要用这份文件的时候（打开改色弹窗）会再试一次，那时按写失败分档如实报「写不进去」。
  async function placeLabelColorsFile(cwd: string, backendId: string) {
    if (!backendId) return { ok: true, skipped: 'not-markdown' }
    try {
      const reg = await getTrackerRegistry()
      if (!reg) return { ok: false, error: { kind: 'env', message: '插件尚未就绪：还没有可用的后端清单，这次没能看清要不要放配色文件。请重试一次；如果仍然失败，请把这条提示原文报告给插件维护者。' } }
      const tracker = reg.get(backendId)
      if (!tracker || typeof tracker.ensureLabelColorsFile !== 'function') return { ok: true, skipped: 'backend-wants-no-file' }
      const platform = await getPlatform()
      let ref = null
      try { ref = reg.describe({ cwd: cwd }, backendId) } catch (e) { ref = { backend: backendId, refId: '', name: '', url: '' } }
      const sb = resolveSandboxPolicy(null, cwd)
      const placed = await tracker.ensureLabelColorsFile(ref, opCtxFor(cwd, platform, ref, 'wf.bind', new AbortController().signal, sb.policy, sb.sessionId)) as unknown as { ok?: unknown; placed?: unknown; reason?: unknown; error?: { kind?: unknown; message?: unknown } }
      if (placed && placed.ok === true) return { ok: true, placed: placed.placed === true, reason: placed.reason || '' }
      // 后端如实回了「这件事我不做」：它的颜色存在别处，没有本地文件可放 —— 这是跳过，不是失败。
      if (placed && placed.error && placed.error.kind === 'unsupported') return { ok: true, skipped: 'backend-wants-no-file' }
      return { ok: false, error: (placed && placed.error) || { kind: 'env', message: '后端既没有说这次要不要放配色文件，也没有说明原因。请重试一次；如果仍然失败，请把这条提示原文报告给插件维护者。' } }
    } catch (e) {
      return { ok: false, error: { kind: 'env', message: '插件没能把标签配色文件放进这个工作区（放入这一步出错），所以这个工作区里现在可能还没有这份文件。请重试一次；如果仍然失败，请把这条提示原文报告给插件维护者。' } }
    }
  }
  async function handleBind(args: WfArgs) {
    // #1003 空目录闸：还没认出工作区是哪条时，不拿进程目录冒充去绑定写文件，直接说还没就绪。
    if (!args || typeof args.cwd !== 'string' || !args.cwd.trim()) return { ok: false, error: '这个工作区还没就绪（还没认出是哪个目录），等面板认出工作区后再试。' }
    const cwd = await canonicalKey(args.cwd)
    const backendId = args && ('backendId' in args ? args.backendId : args.backend)
    try {
      // 「明确不要后端」这条状态今天没有存法（工作区配置文件里只能写一个后端名，见
      // src/shared/config-store/src/workspace.ts 的校验）。它今天也没有活着的界面入口
      // （那颗「清除后端选择」在 #669 第 6 件已退役，见 src/client/kernel/store-switch.js）。
      // 所以如实回失败：不许回一句 ok 却在文件里什么都没写 —— 那就成了「以为选了、其实没选」。
      if (backendId === undefined || backendId === null || backendId === '') {
        return { ok: false, kind: 'no-record-for-none', cwd: cwd, error: '「这个工作区不选任何后端」这个选择今天还没有地方可以记下来（工作区里的配置文件只能写一个后端名），所以这次没有生效。想换后端请直接选一个。' }
      }
      const reg = await getTrackerRegistry()
      if (!reg) return { ok: false, error: '插件尚未就绪：还没有可用的后端清单，这次选择没有生效。请稍后重试。' }
      if (typeof reg.has !== 'function' || !reg.has(backendId)) {
        return { ok: false, kind: 'unknown-backend', cwd: cwd, error: '插件不认识这个后端（' + String(backendId).slice(0, 60) + '），这次选择没有生效。请重新打开选择窗口再选一次。' }
      }
      // #1138 唯一写入口，一次动作只写一份：先写工作区文件，**写成功才算这次选择生效**。
      //   以前这里同时写进程内绑定、本机记忆与工作区文件三处，顶层 ok 却恒为真 —— 文件写失败照样回 ok，
      //   界面于是显示「已切换」，而重启之后又变回原来的后端。今天写不进去就当场说没生效。
      let workspaceFile = null
      try { workspaceFile = await writeWorkspaceRecord(cwd, backendId, args) } catch (eW) { workspaceFile = { ok: false, error: { kind: 'env', reason: fileWriteReasonOf(eW), message: msgOf(eW) } } }
      if (!workspaceFile || workspaceFile.ok !== true) {
        const why = (workspaceFile && workspaceFile.error) || null
        try { if (logCtx && typeof logCtx.fire === 'function') logCtx.fire('warn', 'host.call.fail', { method: 'wf.bind.workspaceFile', kind: 'bind', errorHash: hash8('bind-file-not-written') }) } catch (eL) {}
        return {
          ok: false, kind: 'workspace-file-failed', cwd: cwd, backendId: backendId, workspaceFile: workspaceFile,
          errorKind: (why && why.reason) || 'other',
          error: '这次没能把选择写进这个工作区里的配置文件（' + bindFailAdviceOf(why && why.reason) + '），所以这次选择没有生效。请确认这个目录可以写，然后重新选一次。',
        }
      }
      // 落到这里才算生效：清三处缓存，顺手放配色文件，再补一份本机记忆（H）——H 只是「文件万一被删还能再生成一次」的备份，不参与判定。
      const handle = { cwd: cwd }
      setCache({ ts: 0, snapshot: null, error: null, cwd: cwd })
      try { const ws = await getWorkspaceStore(); ws.invalidate(handle) } catch {}
      let labelColorsFile = null
      try { labelColorsFile = await placeLabelColorsFile(cwd, backendId) } catch (e) { labelColorsFile = { ok: false, error: { kind: 'env', message: msgOf(e) } } }
      if (labelColorsFile && labelColorsFile.ok !== true && labelColorsFile.skipped === undefined) {
        try {
          if (logCtx && typeof logCtx.fire === 'function') logCtx.fire('warn', 'labelColors.write', { cwdHash: hash8(String(cwd)), count: 0, ok: false, reason: 'place-fail' })
        } catch (eL) {}
      }
      const cw = (typeof getChoiceStore === 'function') ? await getChoiceStore().catch(function () { return null }) : null
      const wr = (cw && typeof cw.rememberWorkspace === 'function') ? await cw.rememberWorkspace(cwd, backendId).catch(function () { return null }) : null
      return { ok: true, cwd: cwd, backendId: backendId, labelColorsFile: labelColorsFile, workspaceFile: workspaceFile, rev: (wr && wr.ok === true) ? (wr.rev || 0) : 0, persisted: !!(wr && wr.ok === true) }
    } catch (e) {
      const msg = String(((e as { message?: unknown }) && (e as { message?: unknown }).message) || e)
      if (/unknown-backend/.test(msg)) return { ok: false, error: msg, kind: 'unknown-backend' }
      return { ok: false, error: msg }
    }
  }
  // #1003 拍板：布局是「这个工作区用单栏还是多栏」的选择，属于这份工作区文件——写进去、也从它读回；本机记忆只在文件里还没有后端记录时兜底（老工作区过渡用）。
  async function handleSetupLayout(args: WfArgs) {
    const raw = (args && typeof args.cwd === 'string' && args.cwd.trim()) ? args.cwd : ''; if (!raw) { const v0 = args ? args.layout : undefined; return v0 == null ? { ok: true, cwd: '', layout: null, pickedAt: 0 } : { ok: false, cwd: '', error: 'not-stored' } }
    const cwd = await normCwd(raw); const cs = (typeof getChoiceStore === 'function') ? await getChoiceStore().catch(function () { return null }) : null; const v = args ? args.layout : undefined
    const plat = await getPlatform().catch(function () { return null }); let f: FsSvc | null = ((plat && plat.fs) as FsSvc | null) || null; if (!f && ctx && typeof ctx.get === 'function') { try { f = ctx.get('fs') } catch (eG) { f = null } }
    const usable = !!(f && typeof f.resolve === 'function' && typeof f.readText === 'function' && typeof f.writeText === 'function'); let target = null; let rec = null
    if (usable && f) { /* usable 已含 f 非空，写出来只是过类型检查 */ try { target = await f.resolve(WORKSPACE_FILE_REL, { cwd: cwd }); rec = parseWorkspaceFile(await f.readText(target)) } catch (eR) {} }
    if (v == null) {
      if (rec && (rec.layout === 'single' || rec.layout === 'multi')) return { ok: true, cwd: cwd, layout: rec.layout, pickedAt: 0 }
      const r = (cs && typeof cs.getLayout === 'function') ? await cs.getLayout(cwd).catch(function () { return null }) : null
      return (r && r.found === true) ? { ok: true, cwd: cwd, layout: r.layout, pickedAt: r.pickedAt } : { ok: true, cwd: cwd, layout: null, pickedAt: 0 }
    }
    const want = String(v).toLowerCase(); let why = usable ? 'no-record' : 'no-channel'
    if (rec && rec.backendId) { try {
        const text = stringifyWorkspaceFile({ backendId: rec.backendId, pickedAt: rec.pickedAt, source: rec.source, layout: want }); const pp = plat && plat.path
        if (pp && typeof pp.dirname === 'function' && typeof f!.mkdir === 'function') { try { await f!.mkdir(pp.dirname(target), { recursive: true }) } catch (eM) {} } /* f 为空时原来直接抛（外层接住报失败），! 只过检查，不改这条路 */
        await f!.writeText(target, text, undefined, undefined, resolveSandboxPolicy(args, cwd).policy)
        try { const ws = await getWorkspaceStore(); ws.invalidate({ cwd: cwd }) } catch {}; try { setCache({ ts: 0, snapshot: null, error: null, cwd: cwd }) } catch {}
        why = 'written'
      } catch (e) { why = fileWriteReasonOf(e) } }
    const w = (cs && typeof cs.rememberLayout === 'function') ? await cs.rememberLayout(cwd, want).catch(function () { return null }) : null
    if (why === 'written') return { ok: true, cwd: cwd, layout: want, pickedAt: (w && w.pickedAt) || 0, workspaceFile: 'written' }
    return (w && w.ok === true) ? { ok: true, cwd: cwd, layout: want, pickedAt: w.pickedAt, workspaceFile: why } : { ok: false, cwd: cwd, error: 'not-stored' }
  }
  // #1138：这一条答的是「哪些工作区已经选过后端，各选的是谁」。
  //   以前它读的是注册表里那份进程内副本（`reg.allBindings()`），重启就没、别的窗口也看不见；
  //   那份副本已经删了，所以改成按调用方给的候选目录去读**工作区文件**——谁有记录、记录写的是谁，
  //   都以文件为准，与判定出口读的是同一份东西。
  //   为什么要候选目录：插件这边没有「这台机器上有哪些工作区」的名单，那是 DSH 工作区服务的知识；
  //   调用方（设置页）手上有这份名单，直接把它递进来即可，谁也不替谁猜。
  async function readWorkspaceRecord(cwd: string) {
    let fsSvc: FsSvc | null = null
    try { const platform = await getPlatform(); fsSvc = ((platform && platform.fs) as FsSvc | null) || null } catch (eP) { fsSvc = null }
    if (!fsSvc && ctx && typeof ctx.get === 'function') { try { fsSvc = ctx.get('fs') } catch (eG) { fsSvc = null } }
    if (!fsSvc || typeof fsSvc.resolve !== 'function' || typeof fsSvc.readText !== 'function') return null
    // 新路径优先、老文件兼容读，与判定出口（src/tracker/detection/backendDecision.ts 的 readFileLayer）同一顺序。
    for (const rel of [WORKSPACE_FILE_REL, WORKSPACE_FILE_LEGACY_REL]) {
      if (!rel) continue
      try {
        const target = await fsSvc.resolve(rel, { cwd: cwd })
        const parsed = parseWorkspaceFile(await fsSvc.readText(target))
        if (parsed && parsed.backendId) return parsed
      } catch (eOne) { /* 这条路径没有或读坏就试下一条 */ }
    }
    return null
  }
  async function handleBindings(args: WfArgs) {
    try {
      const reg = await getTrackerRegistry()
      if (!reg) return { ok: false, error: 'registry unavailable' }
      const raw = (args && Array.isArray(args.cwds)) ? args.cwds : []
      const seen = Object.create(null)
      const bindings = []
      for (const one of raw) {
        if (typeof one !== 'string' || !one.trim()) continue
        const cwd = await normCwd(one)
        if (seen[cwd]) continue
        seen[cwd] = true
        const rec = await readWorkspaceRecord(cwd)
        if (!rec || !rec.backendId) continue
        let ref = null
        try { ref = reg.describe({ cwd: cwd }, rec.backendId) } catch (eD) {}
        bindings.push({ cwd: cwd, backendId: rec.backendId, source: 'explicit', ref: ref })
      }
      return { ok: true, bindings: bindings }
    } catch (e) { return { ok: false, error: String(((e as { message?: unknown }) && (e as { message?: unknown }).message) || e) } }
  }
  async function handleRegistry(args: WfArgs) {
    try {
      const reg = await getTrackerRegistry()
      if (!reg) return { ok: false, error: 'registry unavailable' }
      const mods = reg.modules().map(projectUiDescription)
      // #1138：这一条以前还回一格 `bound`（这个工作区绑了谁）。它答的正是注册表里那份进程内副本，
      //   副本删掉之后没有东西可答，而全仓没有任何调用方读它 —— 整格去掉，不拿别的来源凑一个值。
      //   要问「这个工作区用哪个后端」请走 wf.selection，那条路是唯一判定出口。
      return { ok: true, modules: mods }
    } catch (e) { return { ok: false, error: String(((e as { message?: unknown }) && (e as { message?: unknown }).message) || e) } }
  }
  async function handleSelection(args: WfArgs) {
    // #1003 空目录闸：还没认出工作区是哪条时，不拿进程目录冒充去探测，直接按未知回（界面说还没就绪）。
    const _rawSelCwd = (args && typeof args.cwd === 'string' && args.cwd.trim()) ? args.cwd : ''
    if (!_rawSelCwd) return { ok: true, selection: { backendId: null, source: 'unknown', origin: 'unknown-workspace', canWrite: false, reason: 'workspace-not-ready' }, repository: null }
    const cwd = await normCwd(_rawSelCwd)
    // #1003 老用户迁移（后台捎带，不挡回包）：文件缺席 + 记忆有 → 建一次文件，每工作区每进程只试一次。
    try { migrateChoiceToFile(cwd, args).catch(function () {}) } catch (eMigKick) {}
    try {
      const reg = await getTrackerRegistry()
      if (!reg) return { ok: false, error: 'registry unavailable' }
      // #1138：这里原来直调 `reg.select`，于是「注册表三级联」和「统一判定出口」各答一套。
      //   现在整段交给唯一判定出口（人选的唯一真源是工作区文件，出口内部再接声明文件与自动识别）。
      const outlet = (typeof getDecisionFn === 'function') ? await getDecisionFn().catch(function () { return null }) : null
      if (!outlet || typeof outlet.decideBackend !== 'function') {
        return { ok: false, error: '插件尚未就绪：判定出口这次没装上，所以没有选出后端。请稍后重试；如果仍然失败，请把这条提示原文报告给插件维护者。' }
      }
      // #1048 收口补做：把日志出口一并递进去，这条电话的判定才留下结论线（与面板、deck 工具同源同形）。
      //   不递的后果是「用户在设置页选了后端、事后想查为什么是这个」，日志里查不到这一趟判定。
      const o = await outlet.decideBackend(cwd, { registry: reg, platform: await getPlatform(), fs: ctx.get('fs'), caller: 'wf.selection', logCtx: logCtx }).catch(function () { return null })
      const describeOf = function (id: string) { try { return reg.describe({ cwd: cwd }, id) } catch (eD) { return null } }
      const sel = (typeof outlet.selectionFromOutlet === 'function' && o) ? outlet.selectionFromOutlet(o, describeOf) : null
      let repoRef = null
      if (sel && sel.backendId) { try { repoRef = reg.describe({ cwd: cwd }, sel.backendId) } catch (eD) {} }
      return { ok: true, selection: sel || { backendId: null, source: 'fallback' }, repository: repoRef }
    } catch (e) { return { ok: false, error: String(((e as { message?: unknown }) && (e as { message?: unknown }).message) || e) } }
  }
  // #957 拆分：改色两条电话住自包含叶子（./workspaceLabelColors.js），本文件只做装配与日志包装（动态加载、单向，同一出口、同一信封、同一 loggedPhone）。
  let _labelColorsP: Promise<any> | null = null
  function labelColorsPhones(): Promise<any> { if (!_labelColorsP) _labelColorsP = import('./workspaceLabelColors.js').then(function (m: any) { return m.createWorkspaceLabelColors({ normCwd: normCwd, getTrackerRegistry: getTrackerRegistry, getPlatform: getPlatform, opCtxFor: opCtxFor, resolveSandboxPolicy: resolveSandboxPolicy, getDecisionFn: getDecisionFn, getDetectionService: getDetectionService }) }); return _labelColorsP }
  async function handleListLabels(args: WfArgs) { const p = await labelColorsPhones(); return p.handleListLabels(args) }
  async function handleSetLabelColors(args: WfArgs) { const p = await labelColorsPhones(); return p.handleSetLabelColors(args) }
  function msgOf(e: any) { return String(((e as { message?: unknown }) && (e as { message?: unknown }).message) || e) }
  // #1003 唯一写入口（#1138 起是真正唯一的一份）：用户在任何能选后端的地方点确认，都走这一处写工作区文件。
  //   旧规则“文件已在就不覆盖”已废：唯一真源意味着用户明确选择时必须能覆盖它，否则换后端永远换不动。
  //   这里只做一件事：把「谁选的、什么时候、来源」写进文件；**写成或写不成如实回**，没有第三条路。
  //   #1138 之前这里有三个 `ok:true + skipped` 的早退（后端名为空、后端没注册、注册表问不到）：
  //   调用方（handleBind）现在先自己判这两件事并当场回失败，所以早退整段删掉 ——
  //   留着的话，写不进去会被上层当成「跳过」而不是「失败」，又回到「以为选了其实没选」。
  //   日志沿用既有事件（不新增事件、不新增字段）：成功记常驻 host.call，失败记常驻 host.call.fail。
  async function writeWorkspaceRecord(cwd: string, backendId: string, args: WfArgs, via?: string, layout?: unknown) {
    const _via = (via === 'migrate') ? 'migrate' : 'bind';
    const _method = (_via === 'migrate') ? 'wf.bind.migrate' : 'wf.bind.workspaceFile';
    const _t0 = Date.now();
    // 来源如实记：人当场点的是 user，从老记忆搬来的是 migrated（切核后核认，新老都认）。
    const _source = (_via === 'migrate') ? 'migrated' : 'user';
    if (!backendId || typeof backendId !== 'string' || backendId.trim() === '') {
      return { ok: false, error: { kind: 'env', reason: 'other', message: '内部调用没给后端名，这次没有写工作区文件。' } }
    }
    let fsSvc: FsSvc | null = null
    try {
      const platform = await getPlatform()
      fsSvc = ((platform && platform.fs) as FsSvc | null) || null
      if (!fsSvc && ctx && typeof ctx.get === 'function') { try { fsSvc = ctx.get('fs') } catch (eG) { fsSvc = null } }
      if (!fsSvc || typeof fsSvc.resolve !== 'function' || typeof fsSvc.readText !== 'function' || typeof fsSvc.writeText !== 'function') {
        try { if (logCtx && typeof logCtx.fire === 'function') logCtx.fire('warn', 'host.call.fail', { method: _method, kind: 'bind', errorHash: hash8('no-fs') }) } catch (eL) {}
        return { ok: false, error: { kind: 'env', reason: 'no-channel', message: '这次没拿到可用的文件通道（写工作区文件要用它）。' } }
      }
      let existed = false;
      let existedLayout = null;
      try {
        const target = await fsSvc.resolve(WORKSPACE_FILE_REL, { cwd: cwd })
        const txt = await fsSvc.readText(target)
        const parsed = parseWorkspaceFile(txt)
        if (parsed && typeof parsed.backendId === 'string' && parsed.backendId) {
          existed = true;
          if (parsed && (parsed.layout === 'single' || parsed.layout === 'multi')) existedLayout = parsed.layout;
        }
      } catch (eR) {}
      // 布局保留旧值（覆盖写不丢用户版式；迁移那条由调用方把记忆里的版式递进来，递了就听递的）。
      const _layout = (layout === 'single' || layout === 'multi') ? layout : existedLayout;
      const text = stringifyWorkspaceFile({ backendId: backendId, pickedAt: Date.now(), source: _source, layout: (_layout === null || _layout === undefined) ? undefined : _layout })
      const sb = resolveSandboxPolicy(args, cwd)
      const target2 = await fsSvc.resolve(WORKSPACE_FILE_REL, { cwd: cwd })
      try {
        const platPath = await getPlatform().then(function (p: any) { return (p && p.path) || null }).catch(function () { return null })
        if (platPath && typeof platPath.dirname === 'function' && typeof fsSvc.mkdir === 'function') { try { await fsSvc.mkdir(platPath.dirname(target2), { recursive: true }) } catch (eM) {} }
      } catch (eD) {}
      // #1003：写不进去先重试一次（重试前再建一次父目录）——目标是尽量百分百写成，失败才如实报因。
      try { await fsSvc.writeText(target2, text, undefined, undefined, sb.policy) } catch (eW1) { const pp2 = await getPlatform().then(function (p: any) { return (p && p.path) || null }).catch(function () { return null }); if (pp2 && typeof pp2.dirname === 'function' && typeof fsSvc.mkdir === 'function') { try { await fsSvc.mkdir(pp2.dirname(target2), { recursive: true }) } catch (eM2) {} }; await fsSvc.writeText(target2, text, undefined, undefined, sb.policy) }
      try { if (logCtx && typeof logCtx.fire === 'function') logCtx.fire('info', 'host.call', { method: _method, latencyMs: Date.now() - _t0, ok: true, kind: 'bind' }) } catch (eL) {}
      try { const ws = await getWorkspaceStore(); ws.invalidate({ cwd: cwd }) } catch {}
      try { setCache({ ts: 0, snapshot: null, error: null, cwd: cwd }) } catch {}
      return { ok: true, placed: true, reason: existed ? 'overwritten' : 'created' }
    } catch (eW) {
      try { if (logCtx && typeof logCtx.fire === 'function') logCtx.fire('warn', 'host.call.fail', { method: _method, kind: 'bind', errorHash: hash8(msgOf(eW)) }) } catch (eL) {}
      return { ok: false, error: { kind: 'env', reason: fileWriteReasonOf(eW), message: '写工作区配置文件这一步出错（' + msgOf(eW).slice(0, 120) + '）。' } } }
  }
  // #1003 老用户迁移：文件缺席 + 本机记忆有 → 把记忆写进工作区文件，写成功才算迁移成。
  //   人话：老工作区从没建过那份文件（本机记忆替它答了上万次），先把选择落到文件，
  //   文件一旦建好判定就优先读文件，记忆那条自动失效（老文件本身保留备查，不删）。
  //   来源记 migrated（切核后核认），版式把记忆里的那份一起搬过去（没有就不写，不丢也不造）。
  //   节流：每个工作区每进程只试一次（Set），不在探测热路径上试（只在选择电话里后台捎带一次，
  //   不挡回包）；失败留痕（host.call.fail 一行）可重试（下次进程再试，Set 是进程内的）。
  const migratedAttempted = new Set()
  async function migrateChoiceToFile(cwd: string, args: WfArgs) {
    const key = String(cwd || '')
    if (!key || !key.trim()) return { ok: true, skipped: 'empty-cwd' }
    if (migratedAttempted.has(key)) return { ok: true, skipped: 'already-tried' }
    migratedAttempted.add(key)
    try {
      const platform = await getPlatform().catch(function () { return null })
      const fsSvc: FsSvc | null = ((platform && platform.fs) as FsSvc | null) || (ctx && typeof ctx.get === 'function' ? (function () { try { return ctx.get('fs') } catch (eG) { return null } })() : null)
      if (fsSvc && typeof fsSvc.resolve === 'function' && typeof fsSvc.readText === 'function') {
        try {
          const target = await fsSvc.resolve(WORKSPACE_FILE_REL, { cwd: key })
          const txt = await fsSvc.readText(target)
          const parsed = parseWorkspaceFile(txt)
          if (parsed && parsed.backendId) return { ok: true, skipped: 'file-present' }
        } catch (eR) {}
      }
      const cs = (typeof getChoiceStore === 'function') ? await getChoiceStore().catch(function () { return null }) : null
      if (!cs || typeof cs.getWorkspace !== 'function') return { ok: true, skipped: 'no-store' }
      const got = await cs.getWorkspace(key).catch(function () { return null })
      if (!got || got.found !== true || !got.backendId || typeof got.backendId !== 'string' || !got.backendId.trim()) return { ok: true, skipped: 'no-memory' }
      const backendId = String(got.backendId).trim()
      // 版式一起搬：记忆里有就带上，没有就不带（核缺席整段省略，不丢也不造）。
      let memLayout = null
      try {
        if (cs && typeof cs.getLayout === 'function') {
          const gotL = await cs.getLayout(key).catch(function () { return null })
          if (gotL && gotL.found === true && (gotL.layout === 'single' || gotL.layout === 'multi')) memLayout = gotL.layout
        }
      } catch (eGL) {}
      try {
        const reg = await getTrackerRegistry().catch(function () { return null })
        if (!reg || typeof reg.has !== 'function' || !reg.has(backendId)) return { ok: true, skipped: 'unregistered' }
      } catch (eG2) { return { ok: true, skipped: 'registry-unavailable' } }
      const out = await writeWorkspaceRecord(key, backendId, args, 'migrate', memLayout)
      return out && out.ok === true ? { ok: true, migrated: true, reason: out.reason || 'created' } : { ok: false, error: (out && out.error) || { kind: 'env', message: '迁移写文件失败' } }
    } catch (eM) {
      try { if (logCtx && typeof logCtx.fire === 'function') logCtx.fire('warn', 'host.call.fail', { method: 'wf.bind.migrate', kind: 'bind', errorHash: hash8(msgOf(eM)) }) } catch (eL) {}
      return { ok: false, error: { kind: 'env', message: msgOf(eM).slice(0, 120) } }
    }
  }
  function opCtxFor(cwd: string, platform: Platform | null, repoRef: { refId?: string } | null, caller: string, signal: AbortSignal, sandboxPolicy: unknown, sessionId: string) {
    return {
      cwd: cwd,
      refId: (repoRef && repoRef.refId) || '',
      signal: signal,
      platform: platform as unknown as import('../tracker/contract/contexts.js').BackendPlatform,
      fs: ctx.get('fs'),
      caller: caller,
      outbound: undefined as unknown as import('../tracker/contract/outbound.js').OutboundControl,
      // 写文件要用的「本次调用的政策」（会话政策）：由沙箱政策服务按会话算，这里只传不算。
      // 后端把它当写方法的第 5 个参数交给 DSH 的文件服务 —— 不传就等于用部署默认政策，
      // 而部署默认可写根是 DSH 进程所在目录，不是用户工作区，所以往工作区写必然被拒（研究 #614/#624）。
      sandboxPolicy: sandboxPolicy,
      // 这份政策是按哪个会话算的（给日志与排查用；拿不到会话时是空串）。
      sessionId: sessionId || '',
      timers: hostTimers(timer) as unknown as { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout },
      exec: function (cmd: any, args: any, opts: any) { return detectionExec(cmd, args, opts, 'label-colors') },
      logEvent: function (level: string, event: string, fields: unknown) { try { if (logCtx && typeof logCtx.fire === 'function') logCtx.fire(level, event, fields) } catch (e) {} },
      isEnabled: function (level: string) { try { return (logCtx && typeof logCtx.isEnabled === 'function') ? logCtx.isEnabled(level) === true : (level === 'error' || level === 'warn') } catch (e) { return level === 'error' || level === 'warn' } },
    }
  }
  // ── 会话政策：写用户工作区时那条正规口子的两半（研究 #624）────────────────────
  // 一半是「政策」：调沙箱政策服务按某个会话算，它把会话头里的工作目录当可写根。
  // 另一半是「会话号」：客户端那条 wf.cwd 路径已经在带会话号，这两条电话照样收 args.sessionId。
  // 没带会话号时怎么办：找这个工作区名下活着的会话，正好一个就用它；找不到（或不止一个，无法确定
  // 是哪一次操作）就不猜、也不自己拼政策——退回让 DSH 按部署默认政策判，写不进用户工作区就如实报失败。
  // 为什么不猜：会话模式可以不一样（有的是只读），猜错等于替用户绕开他自己选的那档限制。
  function pathKeyOf(p: unknown) { return String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() }
  function sessionById(sid: unknown) {
    if (!sid) return null
    try {
      const svc = ctx.get('sessions')
      if (!svc || typeof svc.get !== 'function') return null
      return svc.get(String(sid)) || null
    } catch (e) { return null }
  }
  // 找「这个工作区名下活着的会话」。两种匹配，先精确、后包含（#652 补了后一种）：
  //   精确＝会话自己的目录就是这一条（根会话）；包含＝会话开在这个工作区根下面的某条子目录里。
  //   包含只在精确一个都没有时才用——顺序反了会让根会话被下面的子目录会话挤掉。
  function sessionsOfWorkspace(cwd: unknown, inside: unknown) {
    try {
      const svc = ctx.get('sessions')
      if (!svc || typeof svc.list !== 'function') return []
      const want = pathKeyOf(cwd)
      if (!want) return []
      const prefix = want + '/'
      const all = svc.list() || []
      const hits = []
      for (const s of all) {
        const c = resolveSessionCwd(s) // #730：与电话体同一套取法（从前只认 header.cwd 等 2 个字段会漏读）
        if (!c) continue
        const k = pathKeyOf(c)
        if (!k) continue
        if (inside) { if (k !== want && k.indexOf(prefix) === 0) hits.push(s) }
        else if (k === want) hits.push(s)
      }
      return hits
    } catch (e) { return [] }
  }
  // 政策服务算政策：有归属会话才按会话算（含会话自己的模式）；找不到归属会话就不调服务（#730），
  //   回 undefined 让后端如实报失败，不拿默认政策静默写。
  // 绝不在插件这边自己拼一个宽松政策。
  // #652：传进来的 cwd 现在是工作区根，而子目录会话自己仍挂在子目录上，所以「按同一条目录找」之外
  //   还要能「按这个根找它下面的会话」（sessionsOfWorkspace 的第二个参数），否则子目录会话写文件拿不到政策。
  function resolveSandboxPolicy(args: WfArgs | null, cwd: string) {
    try {
      const svc = ctx.get('sandboxPolicy')
      if (!svc || typeof svc.resolve !== 'function') return { policy: undefined, sessionId: '' }
      let session = sessionById(args && args.sessionId)
      if (!session) {
        const hits = sessionsOfWorkspace(cwd, false)
        if (hits.length === 1) session = hits[0]
        else if (hits.length === 0) {
          const inside = sessionsOfWorkspace(cwd, true)
          if (inside.length === 1) session = inside[0]
        }
      }
      if (!session) return { policy: undefined, sessionId: '' } // #730：无归属会话不取默认政策，免静默落错档
      return { policy: svc.resolve({ session: session }), sessionId: session.id ? String(session.id) : '' }
    } catch (e) { return { policy: undefined, sessionId: '' } }
  }
  function hash8(s: unknown) { try { const t = String(s || ''); let h = 5381; for (let i = 0; i < t.length; i++) h = (((h << 5) + h + t.charCodeAt(i)) >>> 0); return ('0000000' + h.toString(16)).slice(-8) } catch (e) { return '00000000' } }
  function phoneLog(method: string, kind: string, t0: number, res: any, err?: any) {
    try {
    if (err !== undefined && err !== null) { if (logCtx) logCtx.fire('warn', 'host.call.fail', { method: method, kind: kind, errorHash: hash8(String((err && err.message) || err)) }) }
    else if (res && res.ok) { if (logCtx) logCtx.fire('info', 'host.call', { method: method, latencyMs: Date.now() - t0, ok: true, kind: kind }) }
    else if (logCtx) logCtx.fire('warn', 'host.call.fail', { method: method, kind: kind, errorHash: hash8(String((res && (res.error || res.errorKind)) || 'workspace-not-ok')) }) } catch (eL) {} }
  function loggedPhone(method: string, kind: string, fn: (...args: any[]) => Promise<any>) { return async function (...args: any[]) { const t0 = Date.now(); try { const r = await fn.apply(null, args); phoneLog(method, kind, t0, r); return r } catch (e) { phoneLog(method, kind, t0, null, e); throw e } } }
  return { normCwd: normCwd, handleBind: loggedPhone('wf.bind', 'bind', handleBind), handleSetupLayout: loggedPhone('wf.setupLayout', 'setup-layout', handleSetupLayout), handleBindings: loggedPhone('wf.bindings', 'bindings', handleBindings), handleRegistry: loggedPhone('wf.registry', 'registry', handleRegistry), handleSelection: loggedPhone('wf.selection', 'selection', handleSelection), handleListLabels: loggedPhone('wf.listLabels', 'label-colors', handleListLabels), handleSetLabelColors: loggedPhone('wf.setLabelColors', 'label-colors', handleSetLabelColors), _migrateChoiceToFile: migrateChoiceToFile }
}