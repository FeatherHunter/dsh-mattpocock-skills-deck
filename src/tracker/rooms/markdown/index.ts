import type { Tracker } from '../../contract/operations.js'
import type { BackendModule } from '../../contract/backend-module.js'
import type { RepositoryRef, Issue, Comment, LabelColor } from '../../contract/entities.js'
import type { OpContext, RepoHandle } from '../../contract/contexts.js'
import type { Actor } from '../../contract/identity.js'
import type { OpResult, PreflightResult, Counts, PageResult, Dependencies, RepoPermissions, SubIssueList, LabelColorsFilePlacement, LabelColorBatchResult } from '../../contract/results.js'
import { ERROR_KIND } from '../../contract/vocabulary.js'
import { readTextFile, exists } from './read.js'
// #1513：本地 Markdown 的预检判据与检查链上的三项是同一份实现（票面硬条件：不许各写一套）。
import { runWorkspaceChecks, workspaceCheckLabel } from './workspace-checks.js'
import { listIssues, getIssue, createIssue, closeIssue, reopenIssue, updateIssue, setBlockedByIssue, setAssigneesIssue, setParentIssue, setLabelsIssue } from './issues.js'
import { countIssues } from './counts.js'
import { listIssuesPage } from './page.js'
import { getDependenciesForKey } from './graph.js'
import { addComment } from './comments.js'
import { listLabels, setLabelColors } from './label-colors-ops.js'
import { ensureLabelColors } from './label-colors.js'
import { useBuiltinLabelColors } from './label-colors-palette.js'
import { failAs, rawJson } from './error-fail.js'
import { emitPreflightCheck, emitReadDegraded } from './read-log.js'
// #1446：本地房的读额度是一条纯回答（离网口径），实现在 ./budget.ts。
import { readMarkdownBudget } from './budget.js'
// node:path 无类型声明（与 path.ts 同款）：压住这一行，拿到的 nodePath 按 any 用。
// @ts-expect-error node:path has no types here (types: []), same as path.ts
import nodePath from 'node:path'
// 运行本文件时没有文件服务：声明一个最小的 process 视图（只读 platform 选换行那套路径实现）。
declare const process: { platform?: string } | undefined

import type { PartiallyProvidedCapability, ProvidedCapability, StubbedByBackend } from '../../contract/capability-answer.js'
// `import type` 取登记数据：转译后不留运行时引用（理由与 GitHub 房那处相同，见 rooms/github/backend.ts）。
import type { MARKDOWN_CAPABILITY_REGISTER } from './capability-register.js'

// —— Markdown 交出来的成员：23 条能力 + id（读预算自 #1446 起「明确提供功能」，随本条进成员集合） ——
// 这份集合不再手写，从本房的登记数据推出来：明说「提供」的名字、明说「做了但没做到位」的名字（#1174 第四档，
// 它们的实现是有的），再加上「明确不支持、但后端自己在实例上补了显式桩」的那 4 条（登记里 `stubBy: 'backend'`）。
// 定位口要摘掉两条：本后端只有 `describe` / `issueAddress` 住在模块对象上（`markdownModule`）、不在工厂实例上，
// 所以这里点名摘它们；`getRepoKey` 则相反 —— 以前它在登记里写「由注册表补桩」，可注册表只按 23 条操作那个
// 名录补桩、不给定位口补，于是实例上没有这个方法却又不被要求有（#1174 决策 2）。现在它按「提供」登记、
// 在实例上真实现一条回空的，于是它留在成员集合里。
// 为什么集合与形状住在房间文件里（而不是判定文件）：判定收在 src/tracker/capability-assertions.ts，
// 而判定必须 import 三个工厂的类型；形状若跟判定同住一处，两边就成了 type-only 的环（#1136 把
// src/tracker 收进门禁扫描域时当场抓到）。方向单向：判定文件 → 房间。
export type MarkdownBackendMembers =
  | 'id'
  | Exclude<
      | ProvidedCapability<typeof MARKDOWN_CAPABILITY_REGISTER>
      | PartiallyProvidedCapability<typeof MARKDOWN_CAPABILITY_REGISTER>
      | StubbedByBackend<typeof MARKDOWN_CAPABILITY_REGISTER>,
      'describe' | 'issueAddress'
    >

/** 交出来的字面量形状：工厂用 `satisfies` 挂它（缺一条、多一条都在编译期红）。 */
export type MarkdownBackendShape = { [K in MarkdownBackendMembers]: Tracker[K] }
function getPlat(ctx: OpContext | undefined){if(ctx&&ctx.platform&&ctx.platform.path)return ctx.platform.path;if(ctx&&ctx.path)return ctx.path;if(typeof process!=='undefined'&&process.platform==='win32')return nodePath.win32;return nodePath.posix}
function isAbsolute(p: string,plat: { isAbsolute: (p: string) => boolean }){try{return plat.isAbsolute(p)}catch{return nodePath.isAbsolute(p)}}
/**
 * Markdown matches：启发式 boolean —— 这个工作区是不是本地 Markdown 票仓。
 *
 * 依次看两处，任何一处成立就认：
 *   1. 候选位置里有 map.md（调用方给的 refId 那一处、以及 `.scratch/map.md`）；
 *   2. `docs/agents/issue-tracker.md` 里声明 Local Markdown。
 * 两处都不成立，或者线索不够，一律回 false ——「不确定就当不是」是既定口径，不是故障。
 *
 * #1182 第 4 件（照 GitLab 房 #1130 那一趟的口径）：这一趟的失败原因必须能从房里报出来
 * （走本房的 `read-log.ts`，事件名沿用全仓登记的 `read.degraded`），不能像从前那样被一个裸
 * catch 吞掉、外面只剩注册表那句「没认出来」。判据与 GitLab 房逐字相同，是「哪一层没能给出
 * 答案」，不是「哪一层没认出 Markdown」—— 读到了内容只是里面没写 Local Markdown，那是正常的
 * 否定结论，不记；一个规规矩矩的工作区（有 `.scratch/map.md`，或者有声明文件）走这一趟
 * 一行都不会多出来。
 *
 * 三处落点（与 GitLab 房那三处同一套判据，只是这一房的步骤名按本房实况取）：
 *   - 分不出平台对象（`ctx.platform.path` 与 `ctx.path` 都不是个能用的东西，也不是 win32）→
 *     `matches:fs-unavailable`：识别这一趟根本没跑起来。这是故障，不是「这个工作区不是 Markdown」。
 *   - 声明文件 `docs/agents/issue-tracker.md` 这一层没能给出答案 —— 文件在、可两路读法都读不动，
 *     或者连它在不在都问不出来（拼路径那一步自己抛了）→ `matches:tracker-doc`：这一层是识别最后
 *     一道证据，它不出声，整条识别就只剩「没认出来」。
 *   - 上面之外整段抛了（平台对象形状怪、路径拼接抛错这类）→ `matches:unknown`，结论照旧按「不确定 = 不是」。
 *
 * 为什么没有第四个取值 `matches:no-map`（候选位置都没找到地图）：「候选都没有地图」这件事，
 * 恰恰是所有不是 Markdown 的工作区都会出现的正常答案 —— 记它等于给每一次 GitHub、GitLab 工作区
 * 探测都加一行噪音，而读了内容发现没写 Local Markdown 这一条又按上面的判据不记，两处口径就打架了。
 * 所以「没找到地图」本身不记，只有它后面的那一层（声明文件）也读不动时才留下痕迹。
 *
 * @param handle 识别时给的那点线索（只取 refId 与 cwd）
 * @param ctx 单次调用上下文（没有它、或它没有 logEvent 就记不出日志，但结论照旧）
 * @returns 认得出是本地 Markdown 就 true
 */
export async function matches(handle: RepoHandle, ctx: OpContext): Promise<boolean>{
  const startedAt = Date.now()
  try{
    const cwd=handle&&handle.cwd?String(handle.cwd):(handle&&handle.refId?String(handle.refId):'')
    if(!cwd)return false
    const plat=getPlat(ctx)
    // 分不出平台对象就拼不出候选路径：识别这一趟没跑起来。这是故障（`matches:fs-unavailable`），
    // 不是「这个工作区不是 Markdown」—— 一个 GitHub / GitLab 工作区走这一趟不该留下这一行。
    if(!plat||typeof plat.join!=='function'){
      emitReadDegraded(ctx,'matches','matches:fs-unavailable',Date.now()-startedAt)
      return false
    }
    let candidatePaths=[]
    if(handle.refId&&String(handle.refId).includes('.scratch')){
      const p=isAbsolute(String(handle.refId),plat)?String(handle.refId):plat.join(cwd,String(handle.refId))
      // #1488：规格目录的落盘是 <目录>/spec.md 与 <目录>/issues/，调用方点名的目录也一样认这两种线索。
      candidatePaths.push(plat.join(p,'map.md'))
      candidatePaths.push(plat.join(p,'spec.md'))
      candidatePaths.push(plat.join(p,'issues'))
      candidatePaths.push(p)
    }
    const root=plat.join(cwd,'.scratch')
    candidatePaths.push(plat.join(root,'map.md'))
    candidatePaths.push(plat.join(root,'spec.md'))
    candidatePaths.push(plat.join(root,'issues'))
    // 这里原来还会列举 `.scratch` 下的每个条目、逐个拼一个 `<名字>/map.md` 去试（#1129 删掉）。
    // 为什么删：那是在猜 map.md 在哪，而不是读调用方说出来的事实。真机上 wayfinder 的地图写在
    // `.scratch/<effort>/map.md`，根级 `.scratch/map.md` 并不存在——本机四个 Local Markdown 工作区
    // （matt-demo-markdown、matt-demo-markdown-test1、demo-md-1、dsh-matt-md-09323）都是这个形态，
    // 它们能被认出来靠的是下面声明文件的兜底，遍历对它们没有用处；而只要一个工作区在 `.scratch` 下
    // 留过一张本地地图（本仓的 `.scratch/572-debug/map.md` 就是），旧实现就会把它误认成 Markdown 后端，
    // 只是恰好被「多房同时命中时按注册序取第一个」的顺序兜住（src/tracker/registry/core.ts:185-188）。
    // 成本也是实的：候选数等于 `.scratch` 里的条目数，每个候选至少访问两次文件系统。
    // 反例：不要把「扫 `.scratch` 找 map.md」加回来，包括「只看子目录」「只看唯一那个子目录」这类变体——
    // 它们同样是猜。要认下一个工作区，就让它把话说明白：`.scratch/map.md` 在，或者声明文件指向 markdown。
    for(const p of candidatePaths){if(await exists(ctx,p))return true}
    // bug 修复：setup 已选 Local Markdown 但尚未落 map.md 时，仍应算 Markdown 身份（底层 Markdown 格式以 docs/agents/issue-tracker.md 声明为准，非仅 map.md 数据）
    try{
      const itPath=plat.join(cwd,'docs/agents/issue-tracker.md')
      if(await exists(ctx,itPath)){
        let txt=''
        // 「两路读法都读不动」要单独留个记号：这时 `txt` 停在空串，与「读到了、内容恰好是空的」
        // 在结果上长得一样，可两者不是一回事 —— 前者是这一层没能给出答案（降级，要记），
        // 后者是正常的否定结论（不记）。
        let unreadable=false
        try{ txt=await readTextFile(ctx,itPath) }catch{
          unreadable=true
          try{
            const fs2=ctx&&ctx.platform?ctx.platform.fs:(ctx&&ctx.fs)||null
            if(fs2&&typeof fs2.resolve==='function'&&typeof fs2.readText==='function'){ const t=await fs2.resolve(itPath,{cwd}); txt=await fs2.readText(t); unreadable=false }
          }catch{}
        }
        if(typeof txt==='string'&&/Local\s+Markdown/i.test(txt)) return true
        // 声明文件在、可房里的读法与平台 fs 那条兜底都没读动：识别最后一道证据没能出声。
        if(unreadable) emitReadDegraded(ctx,'matches','matches:tracker-doc',Date.now()-startedAt)
        // 走到这里说明声明文件在、也读到了内容，只是里面没写 Local Markdown：这是正常的否定结论，不记。
      }
    }catch{
      // 声明文件这一层没能给出答案的另一种走法：拼这个路径的时候抛了（平台对象形状怪、join 自己抛）。
      // 与上面「两路都读不动」是同一件事（这一层没给出答案），所以落同一个取值。
      emitReadDegraded(ctx,'matches','matches:tracker-doc',Date.now()-startedAt)
    }
    return false
  }catch{
    // 上面那几处之外整段抛了（平台对象形状怪、路径拼接抛错这类）：结论照旧按「不确定 = 不是」，
    // 但这一趟为什么没给出答案要留下痕迹 —— 从前的裸 catch 让这类故障在日志里一个字都没有。
    emitReadDegraded(ctx,'matches','matches:unknown',Date.now()-startedAt)
    return false
  }
}
// 契约把第二个参数标成可选（`describe(handle, backendId?)`，见 contract/operations.ts 定位口那一段：
// 「实例自己知道身份，可以忽略它」）。这里给它一个默认值，别让契约说可选、实现却离了它就调不动。
export function describe(handle: RepoHandle, backendId: string = 'markdown'): RepositoryRef{
  const cwd=handle&&handle.cwd?String(handle.cwd):''
  const refId=handle&&handle.refId?String(handle.refId):(cwd?cwd:'')
  const finalRef=refId||cwd||''
  const name=finalRef?finalRef.split(/[\\/]/).pop()||finalRef:backendId
  // effort 维度：handle 带 effortId 时如实透传（describe 是 ref 的唯一产地，这里丢掉就再也拿不回来）
  const out: RepositoryRef={backend:backendId,refId:finalRef,name:name||backendId,url:''}
  if(handle&&handle.effortId!==undefined&&handle.effortId!==null) out.effortId=String(handle.effortId)
  return out
}
/** 给一张票的地址（#1110 实现决定第 14 条立这条；#1144 改成诚实回空串）。
 *
 *  本地 Markdown 后端**算不出**一张票的地址，所以这里回空串，不再按编号拼一个文件名。
 *  为什么算不出：在本后端里一张票就是工作区里的一个文件，文件名是「编号-标题转出来的后缀.md」，
 *  而后缀只由标题决定（中文现在会保留中文，#1277 修了把非 ASCII 删光回落 untitled 的旧写法），
 *  光凭引用与编号谁也算不出后缀 —— 盘上可能叫 01-hello-world.md、也可能叫 01-中文标题.md。
 *  真正知道地址的只有读写这个文件的那一层：#1142 起它把地址随票一起交出来（票的 url 字段，
 *  见 issues-locate.ts 的 loadIssueFromFile 与 parse.ts 的 url）。所以「一张票的地址」读票上的 url 就够了，
 *  本函数不是票地址的第二真源。
 *
 *  为什么这条还留在模块对象上：契约把「票的地址」列为三条定位口之一，而定位口的答案允许是空
 *  （contract/operations.ts 的「定位口三条」：答案是名字或者空，空也是答案，不是失败）。
 *  注册表对「后端没提供」与「后端回了空串」同样回空串，调用方本来就要处理空（registry/views.ts 的 issueAddress）。
 *
 *  为什么不用「扫一遍 issues/ 目录找 01-*.md、找不到再回空串」这条看上去更聪明的路：本函数是同步的，
 *  而本后端的文件读写一律经调用方递进来的平台文件层（ctx.platform.fs，是异步的）。扫目录要么绕开
 *  那一层直接摸盘、要么把这条改成异步，两条都比「回空串、让地址随票走」贵，还会多出第二个地址来源。
 *  三选一的定案过程见 #1144。
 *
 *  名字叫「地址」不叫「网址」的来由：同一个名字要同时罩住远端网址（GitHub / GitLab）与本地文件路径两家
 *  后端，路径也是地址；网址口吻的旧名字已按 #1141 删净（见下面 markdownModule 那一段）。 */
export function issueAddress(ref: RepositoryRef, key: string): string {
  // 两个参数照契约收下、故意不读：这一条回答的是「算不出来」，不是「算一个给你」。
  return ''
}
/** 按仓库名找仓库的地址（#1110 实现决定第 14 条）：本地后端没有全站搜索页，诚实回空串。 */
export function repoSearchAddress(name: string): string { return '' }
/** 在这个后端的文本里认出票引用的写法（#1110 实现决定第 14 条）。 */
export const issueRefPattern = "#(\\d+)"
/**
 * 创建本地 Markdown 后端适配器（Tracker）。
 *
 * 返回类型故意不标（理由同 GitHub 房：标成成员全可选的集合就查不出少写，
 * 形状用下面的 `satisfies MarkdownBackendShape` 判定）：本后端没实现的那些操作由注册表补「我不支持」的桩。
 * 下面逐条写明的「本后端不提供」是**有意为之的诚实回法**，不是漏做：
 * 能做的事与不能做的事都在这一份里看得见，读的人不用去别的文件里对账。
 */
// 房间各操作经 failAs 交失败（error-fail.js 把 kind 注成 string，房间动不了它），
// 而契约的 OpResult/PreflightResult 要 ErrorKind：运行时的 kind 恒为 ERROR_KIND 八档之一
// （全房只从那八个常量里取，从不手写档位字符串），这里一次性断言收窄，后面每条操作复用——
// 只收类型视野，不碰运行时。入参收 `{ok:boolean}` 是因为各操作的成功侧形状不一
// （listIssues 的 {ok:true,data}、page 的 {ok:boolean,…}、create 透出的放置形状），但都有 ok。
function asOpResult<T>(p: Promise<{ ok: boolean }> | { ok: boolean }): Promise<OpResult<T>>{
  return Promise.resolve(p) as Promise<OpResult<T>>
}
// 返回类型故意不标，形状判定收在 capability-assertions.ts（理由同 GitHub 房）。
export function createMarkdownBackend(ctx: OpContext) {
  return{
    id:'markdown',
    preflight: async (handle: RepoHandle,opCtx: OpContext): Promise<PreflightResult>=>{
      const c=opCtx||ctx
      const startedAt=Date.now()
      try{
        // #1513：预检不再自己去找 map.md / spec.md / issues（#1488 那套散落的探测），改成调用检查链上
        //   同样三项判据的共用实现（./workspace-checks.ts）：md:workspace、md:scratchWritable、
        //   md:containersReadable。票面硬条件：房间预检与链上三项必须同一套判据，不许各写一套。
        // 返回口径（#1512 D0）：三项都没有 fail 就通过——空工作区、量不出来的 pending 都算通过；
        //   有 fail 才不通过，并把「哪一项没过 + 判据记下的证据」合成一句人话。
        const cwd=(handle&&handle.cwd)||(c&&c.cwd)||''
        const rows=await runWorkspaceChecks({
          // 房间侧的平台对象在 c.platform（带 fs/path）上；拿不到时把 ctx 本身交出去（它也有 fs/path）。
          platform: (c&&(c as unknown as {platform?:unknown}).platform)||c,
          cwd: cwd,
          lang: c&&(c as {lang?:string}).lang,
          sandboxPolicy: c&&(c as {sandboxPolicy?:unknown}).sandboxPolicy,
        })
        // #1514：三项判据各落一行按需日志（preflight.check）——起点输入（工作区根的散列）、这一项自己
        //   看到的短证据、结论、耗时。pass / fail / pending 都记：只记失败线时，事后分不清「这一项量过、
        //   是 pending」与「这一项根本没跑到」。真正的失败结论另由下面常驻的 read.degraded 落一条。
        for(let i=0;i<rows.length;i+=1){
          const row=rows[i]
          emitPreflightCheck(c,i+1,row.result.status,String(row.result.evidence||''),cwd,row.latencyMs)
        }
        const failed=rows.filter(row=>row.result.status==='fail')
        if(failed.length===0)return{ok:true}
        // 失败那句人话：先说哪一项没过，再把判据自己写下的证据原样接上（路径、错误码都在这段证据里）。
        const first=failed[0]
        const lang=c&&(c as {lang?:string}).lang
        const message='预检没过：'+workspaceCheckLabel(first.id,lang)+'。'+String(first.result.detail||'')
        // 失败结论沿用已登记的 preflight:fs-fail：三项里有 fail，说明这个工作区的文件系统这条线不通，
        //   与「还没建地图」是两回事；三项各自的证据与耗时在上面 preflight.check 那三行里。
        emitReadDegraded(c,'preflight','preflight:fs-fail',Date.now()-startedAt)
        return failAs(ERROR_KIND.ENV,message,rawJson(rows)) as PreflightResult
      }catch(e){
        // 档位按本步语义定：预检问的是「这个工作区能不能用本地 Markdown 当票仓」，
        // 中途任何意外都归环境档（这不是一次真的读写调用，判成网络档会让人去查错方向）。
        // 原文 = 抛上来的那个错误本身（人据此看它到底为什么读不动这个目录）。
        // caught 只为过类型：`e &&` 短路与原式逐字相同，message 非字符串时原样透传（不断言改值）。
        const caught=e as Record<string, unknown>
        emitReadDegraded(c,'preflight','preflight:fs-fail',Date.now()-startedAt)
        const kind=((e&&caught.kind)||ERROR_KIND.ENV) as string
        return failAs(kind,(e&&caught.message?caught.message:String(e)) as string,e) as PreflightResult
      }
    },
    list:(repo,filter,opCtx)=>asOpResult<Issue[]>(listIssues(opCtx||ctx,repo,filter)),
    // #691：本地 Markdown 补上契约的 counts（数「列举会返回的那些票行」，地图容器行分开算）。
    // 语义见 tracker/contract.js 的「计数契约」；本后端数的口径见 counts.js 顶部注释。
    counts:(repo,filter,opCtx)=>asOpResult<Counts>(countIssues(opCtx||ctx,repo,filter)),
    // #691：本地 Markdown 补上契约的 listPage（按「创建时间倒序」切一页票行 + 同口径总数）。
    // 语义见 tracker/contract-page.js 的「分页契约」；本后端的游标是「排好序的票行列表里的下标」。
    listPage:(repo,filter,opts,opCtx)=>asOpResult<PageResult>(listIssuesPage(opCtx||ctx,repo,filter,opts)),
    get:(repo,key,opts,opCtx)=>asOpResult<Issue>(getIssue(opCtx||ctx,repo,key,opts)),
    getDependencies:(repo,key,opts,opCtx)=>asOpResult<Dependencies>(getDependenciesForKey(opCtx||ctx,repo,key,opts)),
    create:(repo,input,opCtx)=>asOpResult<Issue>(createIssue(opCtx||ctx,repo,input)),
    close:(repo,key,opts,opCtx)=>asOpResult<Issue>(closeIssue(opCtx||ctx,repo,key,opts)),
    reopen:(repo,key,opCtx)=>asOpResult<Issue>(reopenIssue(opCtx||ctx,repo,key)),
    comment:(repo,key,body,opCtx)=>asOpResult<Comment>(addComment(opCtx||ctx,repo,key,body)),
    update:(repo,key,patch,opCtx)=>asOpResult<Issue>(updateIssue(opCtx||ctx,repo,key,patch)),
    setLabels:(repo,key,labels,opts,opCtx)=>asOpResult<Issue>(setLabelsIssue(opCtx||ctx,repo,key,labels,opts)),
    setAssignees:(repo,key,assignees,opts,opCtx)=>asOpResult<Issue>(setAssigneesIssue(opCtx||ctx,repo,key,assignees,opts)),
    setParent:(repo,key,parentKey,opts,opCtx)=>asOpResult<Issue>(setParentIssue(opCtx||ctx,repo,key,parentKey,opts)),
    setBlockedBy:(repo,key,blockers,opts,opCtx)=>asOpResult<Issue>(setBlockedByIssue(opCtx||ctx,repo,key,blockers,opts)),
    // #618：标签配色契约的两条操作（形状见 src/host/tracker/contract.js 的「标签配色契约」一节）。
    // listLabels 会在文件缺失时顺手补一份默认配色文件（首次打开改色弹窗那条放置路）。
    listLabels:(repo,opCtx)=>asOpResult<LabelColor[]>(listLabels(opCtx||ctx,repo)),
    setLabelColors:(repo,changes,opCtx)=>asOpResult<LabelColorBatchResult>(setLabelColors(opCtx||ctx,repo,changes)),
    // 放置配色文件的入口，给「用户为工作区选定后端」那一步用（host 不问后端 id，只问它愿不愿意放）。
    // 只有本后端实现它，所以只有 Markdown 系后端会往工作区放这个文件。
    ensureLabelColorsFile:(repo,opCtx)=>asOpResult<LabelColorsFilePlacement>(ensureLabelColors(opCtx||ctx,repo)),
    // 下面这几条是「本后端明确不提供这项能力」：原文给空串（一次调用都没发出去，没有外部来源的原文）。
    // 2026-10-14 起它们都是契约里的正式成员，回 unsupported 是合规答案，不是缺陷。
    getCurrentUser: ()=>asOpResult<Actor>(failAs(ERROR_KIND.UNSUPPORTED,'markdown getCurrentUser unsupported','')),
    initProject: ()=>asOpResult<RepositoryRef>(failAs(ERROR_KIND.UNSUPPORTED,'markdown initProject unsupported','')),
    // 本地票仓的写入能力由目录权限与沙箱决定，没有「仓库权限」这回事，所以没有可问的对象。
    getRepoPermissions: ()=>asOpResult<RepoPermissions>(failAs(ERROR_KIND.UNSUPPORTED,'markdown getRepoPermissions unsupported','')),
    // 子票就在工作区的票文件里，宿主要「这张地图的全部子票」直接读文件即可，不经这里。
    listSubIssues: ()=>asOpResult<SubIssueList>(failAs(ERROR_KIND.UNSUPPORTED,'markdown listSubIssues unsupported','')),
    // 定位口（#1174 决策 2）：问「这个仓库在这个后端上叫什么」。本地房的身份就是工作区目录本身，
    // 没有 owner/name 可以解析出来，所以恒回 null —— 契约写着定位口的答案「是名字或者空，
    // 空也是答案，不是失败」，所以这不是一条失败桩，是一条诚实回空的实现。
    // 契约 `operations.ts` 里那句「本地 Markdown 后端没有这条」也随这次改成「算不出来就回空」。
    getRepoKey: async ()=>null,
    // 读额度（#1446）：本地房是离网口径，答案固定为「离网」，不读盘、不调任何东西。
    readBudget: async ()=>readMarkdownBudget(),
  } satisfies MarkdownBackendShape
}
/** #323（2026-08-29 定版复核）：本地 Markdown 后端自己的默认调色盘（不依赖 GitHub）——
 *  这里是本地标签结构与**内置默认色值**的真源；模块经契约层（BackendModule.labelPalette）提供给面板。
 *  #618 起颜色的可改层换成工作区里的 docs/agents/label-colors.json（用户可手改的那份配色文件），
 *  旧的那张 docs/agents/triage-labels.md 调色盘表不再读（干净切断，不迁移、不回填）。
 *  颜色渲染由宿主侧按配色文件查色、文件里没收录的回落这份内置默认色，AI 不参与。 */
export const defaultLabelPalette = [
  { name: 'bug', color: 'd73a4a' },
  { name: 'needs-triage', color: 'fbca04' },
  { name: 'needs-info', color: '5319e7' },
  { name: 'ready-for-agent', color: '0e8a16' },
  { name: 'ready-for-human', color: 'b60205' },
  { name: 'wontfix', color: 'ffffff' },
  { name: 'wayfinder:map', color: '8b5cf6' },
  { name: 'wayfinder:research', color: '0ea5e9' },
  { name: 'wayfinder:prototype', color: 'f59e0b' },
  { name: 'wayfinder:grilling', color: '9d7cd8' },
  { name: 'wayfinder:task', color: '10b981' },
]
// 这一份就是全仓唯一的内置默认色表：标签配色机制（label-colors.js）用它做三件事——
// 并集里补上内置默认的那些标签、首建配色文件时按它预填、票面标签既不在文件里也不在内置表里才回灰。
// 为什么用「装载时交给它」而不是让它自己 import 这份表：本文件会 import label-colors.js，
// 反过来的 import 会形成循环引用（Node 能跑，但读代码的人很难判断谁先初始化）。
useBuiltinLabelColors(defaultLabelPalette)
/** 修复契约注入文案（Markdown 后端本地语义，双语单源；供 fixes 引用，host 组装时解析）。 */
export const prompts = {
  // #716：本地 Markdown 后端没有自己的命令行工具（票就是工作区里的文件），所以只声明站点名字；
  //   {cli} 那一格留空，渲染时回落中性说法「当前后端的命令行」—— 提示词里绝不写死别的后端的命令名。
  commandVocabulary: { cliBrand: '本地 Markdown' },
  // #1514：原来这里还有一条 wayfinderMapBuild（「执行 wayfinder 构造地图」按钮的注入提示词）。三项判据改成
  //   一起量工作区之后，「预检没过 → 执行 wayfinder 构造地图」这个修复动作不再成立：判据问的是工作区与容器
  //   文件读不读得动，不是「还没建地图」；那条提示词因此整条删掉，不再对外提供。
  subIssue: {
    // 2026-09 修正：旧文案让 agent 执行 setParent(map.key) / list({parentKey})，但宿主侧没有这些 agent tool，
    //   随包分发的也只有两个 GitHub 专用脚本 —— 照做不到。改成这个后端真的能做的动作：在 map 文件的任务清单里引用子票。
    zh: '在本仓库的 map 文件里，按已有写法在任务清单逐条引用这些子票，并把清单条目数与 map 的子票数对齐一致',
    en: 'add each sub-ticket to the task list inside the map file the way this repo already writes it, and keep the task-list entry count equal to the map sub-ticket count',
  },
  // #684：「体检」的本地 Markdown 科目。这里的票就是工作区里的文件，所以游离必须落到文件上：
  //   两条判据查的都是「票文件与地图清单对不对得上」。另外照别的后端那条口径，把「这张能不能单张票处理掉」
  //   的 AI 判断一起带上（是的话也可以不管、只在报告里登记一行）。
  // #716：本条原先点名「与 GitHub 同一套」「照 GitHub 的口径」—— 这是本地后端自己的科目，不该拿另一个
  //   后端的名字来解释自己，改成中性说法（同一个工作区的票仓结构在三个后端上本来就是同一套）。
  healthCheck: {
    zh: '**本后端的票就是工作区里的文件**（每个工作单元一个目录，地图写在 map.md 里、每张票写成一个文件），所以「游离」必须落到文件上。**查两条文件级判据**：\n1. 票文件存在，却没有被任何 map.md 的清单引用 —— 游离在外；\n2. map.md 的清单里列了某张票，但对应的文件不存在 —— 断链。\n\n**一条 AI 判断照同一套口径一起带上**：对每一张判一句「这张是不是明确可以单张票处理掉的」；是的话也可以不管，只登记一行。\n\n**三种结论**（挂在某张地图下 / 建议自立成一张新地图 / 建议留在原地 + 一句话理由）都只进建议清单，等人点头才动手。\n\n**不碰**：已关闭的票、任何票的标题与正文、标签与认领状态、别的仓库；不关票、不改源码、不提交。\n\n体检的范围是这个工作区里的全部票文件，不跟随面板当前的筛选。',
    en: '**On this backend a ticket is a file in this workspace** (one directory per work unit, the map written as map.md and each ticket as a file), so "orphaned" has to land on files. **Check two file-level criteria**:\n1. a ticket file exists but no map.md list references it — it is floating outside;\n2. a map.md list references a ticket whose file does not exist — a broken link.\n\n**One AI judgement on the same rules**: for each ticket, judge with one sentence — "is this clearly something a single ticket can finish?" If yes, you may also leave it alone and just log one line.\n\n**All three conclusions** (attach under a map / suggest a new map of its own / suggest leaving it where it is + a one-sentence reason) only go into the suggestion list — act only after the human nods.\n\n**Never touch**: closed tickets, any ticket title or body, labels and claim state, other repositories; do not close tickets, change source code, or commit.\n\nThe health check covers every ticket file in this workspace and does not follow the current panel filters.',
  },
}

/** 修复契约（Fix Contract · 2026-08-28）：后端检查失败 → 修复指引；结构见 host/tracker/fixContract.js。
 * #1513 起本地 Markdown 只有一条修复合约：md:scratchWritable —— 数据目录写不进去，人能做的是换一个可写的会话
 *   或去查目录权限，然后重查；后端自己修不了这件事。其余两项（工作区读不出来、容器版本不支持）同样不是
 *   后端能补的，如实展示、不挂任何动作。#1514 删掉了「执行 wayfinder 构造地图」那个按钮（连同它的提示词）：
 *   三项判据不再把「还没建地图」当失败，这个修复动作对着错误的因果指路。 */
export const fixes = Object.freeze({
  'md:scratchWritable': {
    hint: {
      zh: '本地数据目录写不进去。换一个可写的会话再试，或检查这个目录的权限，然后重查。',
      en: 'The local data directory cannot be written. Retry in a writable session or check the directory permissions, then re-check.',
    },
    actions: [
      { type: 'refresh', target: 'chain' },
    ],
  },
})

// 宿主今天还要用的本地图谱解析（parseMd）已不在本文件转出：#1170 把「宿主取件」收回装配点
// src/tracker/registry/builtins.ts 自己取（见那里的 loadMarkdownHostExtras），本文件只留房间自己的对外契约。

export const markdownModule = {
  id: 'markdown',
  label: 'Markdown',
  describe,
  // 链接三件（#1110 实现决定第 14 条 / #1134 改名 / #1141 删旧名 / #1144 收口）：名字讲的是「地址」，
  // 不是「网址」，因为本地这家给的曾经是票文件路径。#1144 起 issueAddress 诚实回空串
  // （本地后端算不出票的地址，地址随票走，理由见它自己的注释）；另两条本来就没有本地对应物，一并回空。
  issueAddress,
  repoSearchAddress,
  issueRefPattern,
  // #191：品牌色完整色板（B 方案定版 · #177）
  presentation: {
    color: '#1a7f37',
    darkColor: '#3fb950',
    bg: 'light-dark(rgba(26,127,55,.12), rgba(63,185,80,.14))',
    border: 'light-dark(rgba(26,127,55,.25), rgba(63,185,80,.30))',
  },
  // #230（D10 · 键入 locale）：setup 描述数据键；labelReqs='' → Markdown 注入的 setupRun 不要求标签齐全
  setupPrompt: {
    trackerLine: 'setup.markdown.trackerLine',
    trackerChoice: 'setup.markdown.trackerChoice',
    backendNote: 'setup.markdown.backendNote',
    labelReqs: 'setup.markdown.labelReqs',
  },
  // #323（2026-08-29 定版复核）：本地后端自己的默认调色盘（结构/label/颜色）经契约层供给面板；工作区表为用户覆盖层
  labelPalette: defaultLabelPalette,
  create: createMarkdownBackend,
  matches,
  // 预算口径（规格 1439 起必填）：离网——本地文件不花任何额度，账恒记零花。
  budget: { kind: 'off-network', countsRequests: false, countsPoints: false, independentBuckets: false },
  // #231：本地 Markdown 无远程链接 —— 票的地址随票走（#1142 的票 url；#1144 后 issueAddress 回空串），
  // links 仅留提及识别正则；开仓为打开文件夹
  links: { linkPatternSource: "#(\\d+)" },
  openRepository: 'folder',
  prompts,
  fixes,
} satisfies BackendModule
export default createMarkdownBackend