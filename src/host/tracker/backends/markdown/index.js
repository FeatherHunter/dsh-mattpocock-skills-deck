import { ERROR_KIND } from '../../../../shared/tracker/constants.js'
import { mdPath } from './path.js'
import { parseMd } from './parse.js'
import { normalizeIssue } from './normalize.js'
import { readTextFile, exists } from './read.js'
import { listIssues, getIssue, createIssue, closeIssue, reopenIssue, updateIssue, setBlockedByIssue, setAssigneesIssue, setParentIssue, setLabelsIssue } from './issues.js'
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
export function issueUrl(ref, key) {
  try {
    if (ref == null || key == null) return ''
    const k = String(key).trim()
    if (!k) return ''
    // 文件约束内现算：mdPath 已处理 refId 绝对/相对、repo.path、getRoot 三分支
    // UI 拿到的是裸盘符路径（D:\…\issues\01-xxx.md），由 wf.openPath 按 OS 打开，不经 file:// 编码
    return mdPath(ref, 'issue', k, { cwd: (ref && ref.refId) || '' })
  } catch { return '' }
}
export function searchUrl(name) { return '' }
export const linkPattern = "#(\\d+)"
export function createMarkdownBackend(ctx){
  return{
    id:'markdown',
    preflight: async (handle,opCtx)=>{
      const c=opCtx||ctx
      try{
        const plat=getPlat(c)
        const cwd=(handle&&handle.cwd)||(c&&c.cwd)||''
        // 检查全局 .scratch 下是否有任意 map.md 或 docs 声明
        if(cwd){
          const root=plat.join(cwd,'.scratch')
          try{
            const fs=c&&c.platform?c.platform.fs:(c&&c.fs)||(c&&typeof c.get==='function'?c.get('fs'):null)
            let entries=[]
            if(fs&&typeof fs.resolve==='function'&&typeof fs.listDir==='function'){try{const t=await fs.resolve(root);entries=await fs.listDir(t)}catch{}}
            else if(fs&&typeof fs.readdir==='function'){try{entries=await fs.readdir(root)}catch{}}
            for(const e of entries){
              const name=typeof e==='string'?e:(e&&e.name)||''
              if(!name||name.startsWith('.'))continue
              const cand=plat.join(root,name,'map.md')
              if(await exists(c,cand)) return{ok:true}
            }
            if(await exists(c,plat.join(root,'map.md'))) return{ok:true}
          }catch{}
        }
        const repo=handle&&handle.backend?handle:describe(handle,'markdown')
        const mapP=mdPath(repo,'map',undefined,c)
        if(await exists(c,mapP))return{ok:true}
        const plat2=getPlat(c)
        const cwd2=(handle&&handle.cwd)||(c&&c.cwd)||''
        if(cwd2){
          const root=plat2.join(cwd2,'.scratch')
          if(await exists(c,plat2.join(root,'map.md')))return{ok:true}
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
    setLabels:(repo,key,labels,opts,opCtx)=>setLabelsIssue(opCtx||ctx,repo,key,labels),
    setAssignees:(repo,key,assignees,opts,opCtx)=>setAssigneesIssue(opCtx||ctx,repo,key,assignees),
    setParent:(repo,key,parentKey,opts,opCtx)=>setParentIssue(opCtx||ctx,repo,key,parentKey),
    setBlockedBy:(repo,key,blockers,opts,opCtx)=>setBlockedByIssue(opCtx||ctx,repo,key,blockers),
    getCurrentUser: async ()=>({ok:false,error:{kind:ERROR_KIND.UNSUPPORTED,message:'markdown getCurrentUser unsupported'}}),
    initProject: async ()=>({ok:false,error:{kind:ERROR_KIND.UNSUPPORTED,message:'markdown initProject unsupported'}}),
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
  // 2026-08-29 定版（用户）：注入只放 /wayfinder 命令与需求占位，规则由技能自身负责，不加解释。
  wayfinderMapBuild: {
    zh: '/wayfinder (请输入任务需求)',
    en: '/wayfinder (enter the task requirement)',
  },
  subIssue: {
    zh: '创后 setParent(map.key) 建边；以 list({parentKey}) 校验计数与预期一致',
    en: 'setParent(map.key) after creation; verify with list({parentKey}) equals expected'
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
  // #231：本地 Markdown 无远程链接 —— issueUrl 由后端现算为裸盘符路径，links 仅留提及识别正则；开仓为打开文件夹
  links: { linkPatternSource: "#(\\d+)" },
  openRepository: 'folder',
  prompts,
  fixes,
}
export default createMarkdownBackend