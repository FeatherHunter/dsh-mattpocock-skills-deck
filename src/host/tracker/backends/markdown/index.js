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
/** 修复契约注入文案（Markdown 后端本地语义，双语单源；供 fixes 引用，host 组装时解析）。 */
export const prompts = {
  mdParseFix: {
    zh: '本地 Markdown 图谱解析失败（parseOk 未通过）。请按序检查：\n1. .scratch/map.md 是否存在且为合法 markdown（UTF-8、无 BOM、字段名未被改坏）；\n2. 图谱文件格式是否被破坏（YAML 头/字段名/分隔符；对照 parse.js 期望的字段集）；\n3. 修复后请用户点「重查」。若文件损坏，与用户确认后先备份再重建。',
    en: 'Local Markdown graph parse failed (parseOk not passed). Check in order:\n1. .scratch/map.md exists and is valid markdown (UTF-8, no BOM, field names intact);\n2. File format not corrupted (YAML header / field names / separators; compare with the fields expected by parse.js);\n3. After fixing, ask the user to re-check. If corrupted, back it up before rebuilding with user confirmation.',
  },
  mdWritableFix: {
    zh: '.scratch 目录不可写。请检查：① 目录是否存在；② 文件系统权限（Windows ACL / POSIX chmod）；③ 挂载点是否只读。修复后请用户点「重查」。',
    en: '.scratch is not writable. Check: ① the directory exists; ② filesystem permissions (Windows ACL / POSIX chmod); ③ read-only mount. After fixing, ask the user to re-check.',
  },
}

/** 修复契约（Fix Contract · 2026-08-28）：后端检查失败 → 修复指引；结构见 host/tracker/fixContract.js。 */
export const fixes = Object.freeze({
  'md:scratchWritable': {
    hint: {
      zh: '.scratch 目录不可写。点「修复指引」检查目录权限，完成后重查。',
      en: '.scratch is not writable. Use the fix guide to check directory permissions, then re-check.',
    },
    actions: [
      { type: 'inject-prompt', prompt: 'mdWritableFix', label: { zh: '修复指引', en: 'Fix guide' } },
      { type: 'refresh', target: 'chain' },
    ],
  },
  'md:parseOk': {
    hint: {
      zh: '本地图谱解析失败（.scratch/map.md 或图谱文件格式异常）。点「修复指引」让 AI 检查文件格式，完成后重查。',
      en: 'Local graph parse failed (.scratch/map.md or file format). Use the fix guide, then re-check.',
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
    // #323（2026-08-29 生效）：标签调色盘规则经此注入 —— 票内 Labels 只写名字、颜色查 docs/agents/triage-labels.md 调色盘表
    paletteNote: 'setup.markdown.paletteNote',
  },
  create: createMarkdownBackend,
  matches,
  // #231：本地 Markdown 无远程链接 —— 空 links 为诚实形状；开仓动作为打开本地文件夹（契约动作声明，UI 通用执行）
  links: {},
  openRepository: 'folder',
  prompts,
  fixes,
}
export default createMarkdownBackend