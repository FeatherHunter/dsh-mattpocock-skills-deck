import { ERROR_KIND } from '../../../../shared/tracker/constants.js'
import { mdPath } from './path.js'
import { parseMd } from './parse.js'
import { normalizeIssue } from './normalize.js'
import { readTextFile, exists } from './read.js'
import { listIssues, getIssue, createIssue, closeIssue, reopenIssue, updateIssue, setBlockedByIssue, setAssigneesIssue, setParentIssue } from './issues.js'
import { getDependenciesForKey } from './graph.js'
import { addComment } from './comments.js'
import nodePath from 'node:path'
function getPlat(ctx){if(ctx&&ctx.platform&&ctx.platform.path)return ctx.platform.path;if(ctx&&ctx.path)return ctx.path;if(typeof process!=='undefined'&&process.platform==='win32')return nodePath.win32;return nodePath.posix}
function isAbsolute(p,plat){try{return plat.isAbsolute(p)}catch{return nodePath.isAbsolute(p)}}
export async function matches(handle, ctx){
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
    try{
      const fs=ctx&&ctx.platform?ctx.platform.fs:(ctx&&ctx.fs)||(ctx&&typeof ctx.get==='function'?ctx.get('fs'):null)
      let entries=[]
      if(fs&&typeof fs.resolve==='function'&&typeof fs.listDir==='function'){try{const t=await fs.resolve(root);entries=await fs.listDir(t)}catch{}}
      else if(fs&&typeof fs.readdir==='function'){try{entries=await fs.readdir(root)}catch{}}
      for(const e of entries){
        const name=typeof e==='string'?e:(e&&e.name)||''
        if(!name||name.startsWith('.'))continue
        candidatePaths.push(plat.join(root,name,'map.md'))
      }
    }catch{}
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
export function describe(handle, backendId){
  const cwd=handle&&handle.cwd?String(handle.cwd):''
  const refId=handle&&handle.refId?String(handle.refId):(cwd?cwd:'')
  const finalRef=refId||cwd||''
  const name=finalRef?finalRef.split(/[\\/]/).pop()||finalRef:backendId
  return{backend:backendId,refId:finalRef,name:name||backendId,url:''}
}
export function issueUrl(ref, key) { return '' }
export function searchUrl(name) { return '' }
export const linkPattern = null
export function createMarkdownBackend(ctx){
  const unsupported=(op)=>({ok:false,error:{kind:ERROR_KIND.UNSUPPORTED,message:'markdown '+op+' unsupported (labels MISSING per #134)'}})
  return{
    id:'markdown',
    preflight: async (handle,opCtx)=>{
      const c=opCtx||ctx
      try{
        const repo=handle&&handle.backend?handle:describe(handle,'markdown')
        const mapP=mdPath(repo,'map',undefined,c)
        if(await exists(c,mapP))return{ok:true}
        const plat=getPlat(c)
        const cwd=(handle&&handle.cwd)||(c&&c.cwd)||''
        if(cwd){
          const root=plat.join(cwd,'.scratch')
          if(await exists(c,plat.join(root,'map.md')))return{ok:true}
        }
        return{ok:false,error:{kind:ERROR_KIND.NOTFOUND,message:'markdown map.md not-found'}}
      }catch(e){const kind=e&&e.kind?e.kind:ERROR_KIND.ENV;return{ok:false,error:{kind,message:e&&e.message?e.message:String(e)}}}
    },
    list:(repo,filter,opCtx)=>listIssues(opCtx||ctx,repo,filter),
    get:(repo,key,opts,opCtx)=>getIssue(opCtx||ctx,repo,key),
    getDependencies:(repo,key,opts,opCtx)=>getDependenciesForKey(opCtx||ctx,repo,key),
    create:(repo,input,opCtx)=>createIssue(opCtx||ctx,repo,input),
    close:(repo,key,opts,opCtx)=>closeIssue(opCtx||ctx,repo,key),
    reopen:(repo,key,opCtx)=>reopenIssue(opCtx||ctx,repo,key),
    comment:(repo,key,body,opCtx)=>addComment(opCtx||ctx,repo,key,body),
    update:(repo,key,patch,opCtx)=>updateIssue(opCtx||ctx,repo,key,patch),
    setLabels:()=>unsupported('setLabels'),
    setAssignees:(repo,key,assignees,opts,opCtx)=>setAssigneesIssue(opCtx||ctx,repo,key,assignees),
    setParent:(repo,key,parentKey,opts,opCtx)=>setParentIssue(opCtx||ctx,repo,key,parentKey),
    setBlockedBy:(repo,key,blockers,opts,opCtx)=>setBlockedByIssue(opCtx||ctx,repo,key,blockers),
    normalize:normalizeIssue,
    parse:parseMd,
  }
}
/** #323（2026-08-29 定版复核）：本地 Markdown 后端自己的默认调色盘（不依赖 GitHub）——
 *  这里是本地标签结构与默认色值的真源；模块经契约层（BackendModule.labelPalette）提供给面板，
 *  工作区 docs/agents/triage-labels.md 的调色盘表为用户可见的覆盖/改色层（默认按此真源预填）。
 *  颜色渲染由面板底层按 labelPalette + 工作区覆盖查色，AI 不参与。 */
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
/** 修复契约注入文案（Markdown 后端本地语义，双语单源；供 fixes 引用，host 组装时解析）。 */
export const prompts = {
  // 2026-08-29 人话改写（用户反馈：".scratch/图谱/map.md"是黑话，第一阅读看不懂指的是什么）：
  //   用户面向一律说「本地数据目录（隐藏文件夹 .scratch）」「关卡地图（map.md）」；技术名只括注保留，供排查定位。
  mdParseFix: {
    zh: '本项目的本地关卡地图（map.md，放在本地数据目录 .scratch 下）还没就绪：很可能是还没初始化生成，也可能是文件存在但内容不符合格式。请按序检查：\n1. 地图文件在不在：.scratch/map.md（根地图），或 .scratch/<关卡名>/map.md（一关一个子目录）；\n2. 文件在但读不了/解析报错：内容是否为正常文本（UTF-8、无 BOM），卡片与决策的字段是否被改坏、开头与分隔符是否符合约定（对照解析器期望的字段）；\n3. 两种位置都没有：说明还没初始化——先执行本地 Markdown 初始化生成地图，再重查。若文件已损坏，先备份再重建（与用户确认）。',
    en: 'The local track map (map.md under the hidden .scratch folder) is not ready yet: either it has not been initialized, or it exists but does not match the expected format. Check in order:\n1. Where is the map file: .scratch/map.md (root map) or .scratch/<track-name>/map.md (one subdirectory per track)?\n2. If the file exists but cannot be read/parsed: is the content plain text (UTF-8, no BOM), are the card/decision fields intact, and do the header and separators match what the parser expects?\n3. If neither location has the file: initialization has not run yet, run Local Markdown setup first, then re-check. If a file is corrupted, back it up before rebuilding (confirm with the user).',
  },
  mdWritableFix: {
    zh: '本项目的本地数据目录（隐藏文件夹 .scratch）当前不可用：可能是目录还没创建（需要先初始化），也可能是系统不允许往里面写（权限只读、磁盘挂载为只读等）。请按序检查：① 目录是否存在（项目根目录下 .scratch）；② 文件系统是否允许写入（Windows 权限，或 macOS/Linux 的读写权限）；③ 目录所在的磁盘或挂载点是否为只读。修好后请用户点「重查」。',
    en: 'The local data directory (hidden folder .scratch) is not usable: either it has not been created yet (initialization needed), or the system does not allow writing into it (read-only permissions, read-only mount, etc.). Check in order: ① does the directory exist (.scratch under the project root)? ② does the filesystem allow writing (Windows permissions, or macOS/Linux read-write permissions)? ③ is the disk or mount point read-only? After fixing, ask the user to re-check.',
  },
}

/** 修复契约（Fix Contract · 2026-08-28）：后端检查失败 → 修复指引；结构见 host/tracker/fixContract.js。 */
export const fixes = Object.freeze({
  'md:scratchWritable': {
    hint: {
      zh: '本项目的本地数据目录还没就绪（可能未初始化，也可能系统不允许写入）。点「修复指引」让 AI 检查，完成后重查。',
      en: 'The local data directory is not ready (maybe not initialized, or the system does not allow writing). Use the fix guide to check, then re-check.',
    },
    actions: [
      { type: 'inject-prompt', prompt: 'mdWritableFix', label: { zh: '修复指引', en: 'Fix guide' } },
      { type: 'refresh', target: 'chain' },
    ],
  },
  'md:parseOk': {
    hint: {
      zh: '本项目的关卡地图还没就绪（可能未初始化生成，也可能文件已损坏）。点「修复指引」让 AI 检查，完成后重查。',
      en: 'The local track map is not ready (maybe not initialized yet, or the file is damaged). Use the fix guide to check, then re-check.',
    },
    actions: [
      { type: 'inject-prompt', prompt: 'mdParseFix', label: { zh: '修复指引', en: 'Fix guide' } },
      { type: 'refresh', target: 'chain' },
    ],
  },
})

export const markdownModule = {
  id: 'markdown',
  label: 'Markdown',
  describe,
  issueUrl,
  searchUrl,
  linkPattern,
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
    // #323（2026-08-29 定版复核）：注入只讲规则（票带 Labels 行只写名 + 改色入口），颜色机制/色值由 labelPalette 真源与面板底层负责
    paletteNote: 'setup.markdown.paletteNote',
  },
  // #323（2026-08-29 定版复核）：本地后端自己的默认调色盘（结构/label/颜色）经契约层供给面板；工作区表为用户覆盖层
  labelPalette: defaultLabelPalette,
  create: createMarkdownBackend,
  matches,
  // #231：本地 Markdown 无远程链接 —— 空 links 为诚实形状；开仓动作为打开本地文件夹（契约动作声明，UI 通用执行）
  links: {},
  openRepository: 'folder',
  prompts,
  fixes,
}
export default createMarkdownBackend