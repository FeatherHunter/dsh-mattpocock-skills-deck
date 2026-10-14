import type { Tracker } from '../../contract/operations.js'
import type { RepositoryRef, Issue, Comment, LabelColor } from '../../contract/entities.js'
import type { OpContext, RepoHandle } from '../../contract/contexts.js'
import type { Actor } from '../../contract/identity.js'
import type { OpResult, PreflightResult, Counts, PageResult, Dependencies, RepoPermissions, SubIssueList, LabelColorsFilePlacement, LabelColorBatchResult } from '../../contract/results.js'
import { ERROR_KIND } from '../../contract/vocabulary.js'
import { mdPath } from './path.js'
import { readTextFile, exists } from './read.js'
import { listIssues, getIssue, createIssue, closeIssue, reopenIssue, updateIssue, setBlockedByIssue, setAssigneesIssue, setParentIssue, setLabelsIssue } from './issues.js'
import { countIssues } from './counts.js'
import { listIssuesPage } from './page.js'
import { getDependenciesForKey } from './graph.js'
import { addComment } from './comments.js'
import { listLabels, setLabelColors } from './label-colors-ops.js'
import { ensureLabelColors } from './label-colors.js'
import { useBuiltinLabelColors } from './label-colors-palette.js'
import { failAs } from './error-fail.js'
import { emitReadDegraded } from './read-log.js'
// node:path 无类型声明（与 path.ts 同款）：压住这一行，拿到的 nodePath 按 any 用。
// @ts-expect-error node:path has no types here (types: []), same as path.ts
import nodePath from 'node:path'
// 运行本文件时没有文件服务：声明一个最小的 process 视图（只读 platform 选换行那套路径实现）。
declare const process: { platform?: string } | undefined

import type { PartiallyProvidedCapability, ProvidedCapability, StubbedByBackend } from '../../contract/capability-answer.js'
// `import type` 取登记数据：转译后不留运行时引用（理由与 GitHub 房那处相同，见 rooms/github/backend.ts）。
import type { MARKDOWN_CAPABILITY_REGISTER } from './capability-register.js'

// —— Markdown 交出来的成员：22 条能力 + id ——
// 这份集合不再手写，从本房的登记数据推出来：明说「提供」的名字、明说「做了但没做到位」的名字（#1174 第四档，
// 它们的实现是有的），再加上「明确不支持、但后端自己在实例上补了显式桩」的那 4 条（登记里 `stubBy: 'backend'`）。
// 定位口要摘掉两条：本后端只有 `describe` / `issueAddress` 住在模块对象上（`markdownModule`）、不在工厂实例上，
// 所以这里点名摘它们；`getRepoKey` 则相反 —— 以前它在登记里写「由注册表补桩」，可注册表只按 22 条操作那个
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
export async function matches(handle: RepoHandle, ctx: OpContext): Promise<boolean>{
  try{
    const cwd=handle&&handle.cwd?String(handle.cwd):(handle&&handle.refId?String(handle.refId):'')
    if(!cwd)return false
    const plat=getPlat(ctx)
    let candidatePaths=[]
    if(handle.refId&&String(handle.refId).includes('.scratch')){
      const p=isAbsolute(String(handle.refId),plat)?String(handle.refId):plat.join(cwd,String(handle.refId))
      candidatePaths.push(plat.join(p,'map.md'))
      candidatePaths.push(p)
    }
    const root=plat.join(cwd,'.scratch')
    candidatePaths.push(plat.join(root,'map.md'))
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
        try{ txt=await readTextFile(ctx,itPath) }catch{
          try{
            const fs2=ctx&&ctx.platform?ctx.platform.fs:(ctx&&ctx.fs)||null
            if(fs2&&typeof fs2.resolve==='function'&&typeof fs2.readText==='function'){ const t=await fs2.resolve(itPath,{cwd}); txt=await fs2.readText(t) }
          }catch{}
        }
        if(typeof txt==='string'&&/Local\s+Markdown/i.test(txt)) return true
      }
    }catch{}
    return false
  }catch{return false}
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
 *  而标题转后缀会把中文等非 ASCII 字符全部删掉、删空了回落 untitled（parse.ts 顶上的 slugify）。
 *  于是同一个编号在盘上可能叫 01-hello-world.md、也可能叫 01-untitled.md —— 光凭引用与编号谁也算不出真名字。
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
        const plat=getPlat(c)
        const cwd=(handle&&handle.cwd)||(c&&c.cwd)||''
        // 检查全局 .scratch 下是否有任意 map.md 或 docs 声明
        if(cwd){
          const root=plat.join(cwd,'.scratch')
          try{
            const fs=c&&c.platform?c.platform.fs:(c&&c.fs)||(c&&typeof c.get==='function'?c.get('fs'):null)
            let entries: unknown[]=[]
            if(fs&&typeof fs.resolve==='function'&&typeof fs.listDir==='function'){try{const t=await fs.resolve(root);entries=await fs.listDir(t)}catch{}}
            else if(fs&&typeof fs.readdir==='function'){try{entries=await fs.readdir(root)}catch{}}
            for(const e of entries){
              // 同 matches 里那一处：`as string` 只收类型视野，运行时还是原值。
              const name=(typeof e==='string'?e:(e&&(e as Record<string, unknown>).name)||'') as string
              if(!name||name.startsWith('.'))continue
              const cand=plat.join(root,name,'map.md')
              if(await exists(c,cand)) return{ok:true}
            }
            if(await exists(c,plat.join(root,'map.md'))) return{ok:true}
          }catch{}
        }
        // 带 backend 的 handle 被当成「已选定后端的引用」用（refId 即路径，见 matches）；
        // 契约的 RepositoryRef 要求 refId 等键齐全，断言只收类型视野，运行时还是原来那个对象。
        const repo=handle&&handle.backend?(handle as RepositoryRef):describe(handle,'markdown')
        const mapP=mdPath(repo,'map',undefined,c)
        if(await exists(c,mapP))return{ok:true}
        const plat2=getPlat(c)
        const cwd2=(handle&&handle.cwd)||(c&&c.cwd)||''
        if(cwd2){
          const root=plat2.join(cwd2,'.scratch')
          if(await exists(c,plat2.join(root,'map.md')))return{ok:true}
        }
        // 原文给空串：预检只是没找到地图文件，没有任何命令或文件读过它（这条结论本地就能定）。
        // 记一行（#1058）：探测没过是「这个工作区不能用本地 Markdown 当票仓」的唯一一句解释，
        // 不记的话事后只看得到「后端没选上」，看不出是走到这一步才没过的。
        emitReadDegraded(c,'preflight','preflight:no-map',Date.now()-startedAt)
        return failAs(ERROR_KIND.NOTFOUND,'markdown map.md not-found','') as PreflightResult
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
  // 2026-08-29 定版（用户）：注入只放 /wayfinder 命令与需求占位，规则由技能自身负责，不加解释。
  wayfinderMapBuild: {
    zh: '/wayfinder (请输入任务需求)',
    en: '/wayfinder (enter the task requirement)',
  },
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
 * 2026-08-29 用户定版：
 *  - md:scratchWritable 不提供修复指引（后端无法修复目录存在/权限问题——行 fail 仅如实展示，无按钮）；
 *  - md:parseOk 的修复指引 = 注入 wayfinder 技能构造关卡地图（地图缺失才失败，唯一真实修复路径是生成地图）。 */
export const fixes = Object.freeze({
  'md:parseOk': {
    hint: {
      zh: '本项目的关卡地图还没生成。点「执行 wayfinder 构造地图」让 AI 用 wayfinder 技能生成地图，完成后重查。',
      en: 'The local track map has not been created yet. Use "Build map with wayfinder" to have AI generate the map via the wayfinder skill, then re-check.',
    },
    actions: [
      { type: 'inject-prompt', prompt: 'wayfinderMapBuild', label: { zh: '执行 wayfinder 构造地图', en: 'Build map with wayfinder' } },
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
  // #231：本地 Markdown 无远程链接 —— 票的地址随票走（#1142 的票 url；#1144 后 issueAddress 回空串），
  // links 仅留提及识别正则；开仓为打开文件夹
  links: { linkPatternSource: "#(\\d+)" },
  openRepository: 'folder',
  prompts,
  fixes,
}
export default createMarkdownBackend