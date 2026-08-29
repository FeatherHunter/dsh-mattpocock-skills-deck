import { parseMd, slugify } from './parse.js'
import { readTextFile, readDir, statFile, exists } from './read.js'
import { writeTextFile, ensureDir } from './write.js'
import { mdPath, issuesDir } from './path.js'
import { classifyError } from '../../preflight.js'
import { ERROR_KIND } from '../../../../shared/tracker/constants.js'
import nodePath from 'node:path'
function getPlat(ctx){if(ctx&&ctx.platform&&ctx.platform.path)return ctx.platform.path;if(ctx&&ctx.path)return ctx.path;if(typeof process!=='undefined'&&process.platform==='win32')return nodePath.win32;return nodePath.posix}
async function getScratchRoot(ctx){
  const plat=getPlat(ctx)
  const cwd=ctx&&typeof ctx.cwd==='string'?ctx.cwd:(typeof process!=='undefined'&&typeof process.cwd==='function'?process.cwd():'.')
  return plat.join(cwd,'.scratch')
}
async function listEffortDirs(ctx){
  const plat=getPlat(ctx)
  const root=await getScratchRoot(ctx)
  const out=[]
  try{ if(await exists(ctx, plat.join(root,'map.md'))) out.push(root) }catch{}
  let entries=[]
  try{ entries=await readDir(ctx, root) }catch{ entries=[] }
  for(const e of entries){
    if(!e || e.startsWith('.')) continue
    const dirPath=plat.join(root,e)
    const mapP=plat.join(dirPath,'map.md')
    try{ if(await exists(ctx, mapP)) out.push(dirPath) }catch{}
  }
  return out
}
async function findIssueFileGlobal(ctx, key){
  const plat=getPlat(ctx)
  const norm=String(key).padStart(2,'0')
  const dirs=await listEffortDirs(ctx)
  for(const dir of dirs){
    const idir=plat.join(dir,'issues')
    const files=await readDir(ctx, idir)
    for(const f of files){
      const m=/^(\d+)-/.exec(f)
      if(!m) continue
      if(!f.endsWith('.md')) continue
      const k=m[1].padStart(2,'0')
      if(k===norm){
        return plat.join(idir,f)
      }
    }
  }
  return null
}
async function findIssueFileInEffort(ctx, repo, key){
  const plat=getPlat(ctx)
  const idir=issuesDir(repo,ctx)
  const files=await readDir(ctx, idir)
  const norm=String(key).padStart(2,'0')
  for(const f of files){
    const m=/^(\d+)-/.exec(f)
    if(!m) continue
    if(!f.endsWith('.md')) continue
    const k=m[1].padStart(2,'0')
    if(k===norm) return plat.join(idir,f)
  }
  return null
}
async function loadPaletteMap(ctx){
  const plat=getPlat(ctx)
  const cwd=ctx&&typeof ctx.cwd==='string'?ctx.cwd:(typeof process!=='undefined'&&typeof process.cwd==='function'?process.cwd():'.')
  const palettePath=plat.join(cwd,'docs/agents/triage-labels.md')
  try{
    const text=await readTextFile(ctx, palettePath)
    const map={}
    const lines=text.split('\n')
    for(const line of lines){
      const t=line.trim()
      if(!t.startsWith('|')) continue
      if(t.includes('---')) continue
      const cells=t.split('|').map(s=>s.trim().replace(/[`]/g,'')).filter(Boolean)
      if(cells.length<2) continue
      const hexOf=function(v){const clean=String(v||'').replace(/[`]/g,'').trim();const m=clean.replace(/^#/,'').match(/([0-9a-fA-F]{6}|[0-9a-fA-F]{3})/);return m?(m[1].toLowerCase().padEnd(6,'0').slice(0,6)):''}
      // #323 联调：兼容两种布局——①旧四列 Color|…|Label（第一格=色）；②定稿三列 Label|Color|Meaning（第二格=色）
      let colorRaw='', labelRaw=''
      const c0=hexOf(cells[0]); const c1=hexOf(cells[1])
      if(c0 && !c1){ colorRaw=c0; labelRaw=cells[2]||cells[1]||'' }
      else if(c1){ colorRaw=c1; labelRaw=cells[0]||'' }
      else continue
      if(!labelRaw || !/^[0-9a-f]{6}$/.test(colorRaw)) continue
      map[labelRaw]=colorRaw
    }
    // If map empty, return null to fallback to static
    if(Object.keys(map).length===0) return null
    return map
  }catch{ return null }
}
function recolorLabels(issue, paletteMap){
  if(!issue||!Array.isArray(issue.labels)) return
  const staticPalette={
    'bug':'d73a4a','needs-triage':'fbca04','needs-info':'5319e7','ready-for-agent':'0e8a16','ready-for-human':'b60205','wontfix':'ffffff','wayfinder:map':'8b5cf6','wayfinder:research':'0ea5e9','wayfinder:prototype':'f59e0b','wayfinder:grilling':'9d7cd8','wayfinder:task':'10b981'
  }
  for(const lab of issue.labels){
    if(!lab||!lab.name) continue
    const fromFile = paletteMap && paletteMap[lab.name]
    const fromStatic = staticPalette[lab.name]
    lab.color = fromFile || fromStatic || 'cccccc'
  }
}

async function loadIssueFromFile(ctx,repo,fullPath,metaExtra={}){
  const txt=await readTextFile(ctx,fullPath)
  const st=await statFile(ctx,fullPath)
  let mtime=''
  if(st){
    const t=st.mtime||st.mtimeMs||st.ctime
    if(t){try{mtime=new Date(t).toISOString()}catch{} if(!mtime&&typeof t==='number'){try{mtime=new Date(t).toISOString()}catch{}}}
    if(!mtime&&st.mtime)mtime=String(st.mtime)
  }
  const base=fullPath.split(/[\\/]/).pop()||''
  const km=/^(\d+)-/.exec(base)
  const key=km?km[1].padStart(2,'0'):String(metaExtra.key||'00').padStart(2,'0')
  const parentKey=metaExtra.parentKey!==undefined?metaExtra.parentKey:null
  const isMap=!!metaExtra.isMap
  return parseMd(txt,{key,parentKey,isMap,createdAt:mtime,updatedAt:mtime})
}
export async function listIssues(ctx,repo,filter={}){
  const plat=getPlat(ctx)
  const paletteMap=await loadPaletteMap(ctx)
  try{
    const effortDirs=await listEffortDirs(ctx)
    const out=[]
    // Global enumeration path
    if(effortDirs.length>0){
      for(const effortPath of effortDirs){
        try{
          const mapP=plat.join(effortPath,'map.md')
          const txt=await readTextFile(ctx,mapP)
          const st=await statFile(ctx,mapP)
          let mtime=''
          if(st&&st.mtime){try{mtime=new Date(st.mtime).toISOString()}catch{}}
          const iss=parseMd(txt,{key:'00',parentKey:null,isMap:true,createdAt:mtime,updatedAt:mtime})
          recolorLabels(iss, paletteMap)
          out.push(iss)
        }catch{}
        const idir=plat.join(effortPath,'issues')
        const files=await readDir(ctx,idir)
        for(const f of files){
          const m=/^(\d+)-/.exec(f)
          if(!m) continue
          if(!f.endsWith('.md')) continue
          const key=m[1].padStart(2,'0')
          if(filter&&Array.isArray(filter.keys)&&filter.keys.length&&!filter.keys.includes(key))continue
          const full=plat.join(idir,f)
          try{const iss=await loadIssueFromFile(ctx,repo,full,{parentKey:'00',isMap:false});recolorLabels(iss, paletteMap);out.push(iss)}catch{}
        }
      }
    }
    // Fallback for repo.path based fixture (tests use repo.path = demo-full) — when global found nothing, try repo direct
    if(out.length===0){
      try{
        const mapP=mdPath(repo,'map',undefined,ctx)
        const txt=await readTextFile(ctx,mapP)
        const st=await statFile(ctx,mapP)
        let mtime=''
        if(st&&st.mtime){try{mtime=new Date(st.mtime).toISOString()}catch{}}
        const iss=parseMd(txt,{key:'00',parentKey:null,isMap:true,createdAt:mtime,updatedAt:mtime})
        recolorLabels(iss, paletteMap)
        out.push(iss)
      }catch{}
      const idir=issuesDir(repo,ctx)
      const files=await readDir(ctx,idir)
      for(const f of files){
        const m=/^(\d+)-/.exec(f)
        if(!m) continue
        if(!f.endsWith('.md')) continue
        const key=m[1].padStart(2,'0')
        if(filter&&Array.isArray(filter.keys)&&filter.keys.length&&!filter.keys.includes(key))continue
        const full=plat.join(idir,f)
        try{const iss=await loadIssueFromFile(ctx,repo,full,{parentKey:'00',isMap:false});recolorLabels(iss, paletteMap);out.push(iss)}catch{}
      }
      // also support repo.path case where map is directly at repo.path
      if(out.length===0 && repo&&repo.path){
        try{
          const plat2=getPlat(ctx)
          const mapP=plat2.join(repo.path,'map.md')
          const txt=await readTextFile(ctx,mapP)
          const iss=parseMd(txt,{key:'00',parentKey:null,isMap:true})
          recolorLabels(iss, paletteMap)
          out.push(iss)
          const idir2=plat2.join(repo.path,'issues')
          const files2=await readDir(ctx,idir2)
          for(const f of files2){
            const m=/^(\d+)-/.exec(f)
            if(!m) continue
            if(!f.endsWith('.md')) continue
            const key=m[1].padStart(2,'0')
            const full=plat2.join(idir2,f)
            try{const iss2=await loadIssueFromFile(ctx,repo,full,{parentKey:'00',isMap:false});recolorLabels(iss2, paletteMap);out.push(iss2)}catch{}
          }
        }catch{}
      }
    }
    // A: 回填 blockedBy 的 title/state（文件约束内满足契约：Blocked by 行只存 key，标题从被引文件首行取）
    try {
      const byKey = {}
      out.forEach(function(it){ if(it && it.key) byKey[String(it.key).padStart(2,'0')] = it })
      out.forEach(function(it){
        if(!it || !Array.isArray(it.blockedBy)) return
        it.blockedBy.forEach(function(ref){
          const k = ref && ref.key ? String(ref.key).padStart(2,'0') : ''
          const target = k ? byKey[k] : null
          if(target){
            if(!ref.title) ref.title = target.title || ''
            ref.state = target.state || ref.state || 'OPEN'
          }
        })
      })
    } catch {}
    let filtered=out
    if(filter){
      if(filter.type)filtered=filtered.filter(x=>x.type===filter.type)
      if(filter.state)filtered=filtered.filter(x=>x.state===filter.state)
      if(filter.parentKey!==undefined){
        if(filter.parentKey===null)filtered=filtered.filter(x=>x.parentKey===null)
        else filtered=filtered.filter(x=>x.parentKey===filter.parentKey)
      }
      if(Array.isArray(filter.keys)&&filter.keys.length){filtered=filtered.filter(x=>filter.keys.includes(x.key))}
    }
    filtered.sort((a,b)=>a.key.localeCompare(b.key))
    return{ok:true,data:filtered}
  }catch(e){const kind=e&&e.kind?e.kind:classifyError(e);return{ok:false,error:{kind,message:e&&e.message?e.message:String(e)}}}
}
export async function getIssue(ctx,repo,key){
  if(!key)return{ok:false,error:{kind:ERROR_KIND.NOTFOUND,message:'missing key'}}
  const norm=String(key).padStart(2,'0')
  const paletteMap=await loadPaletteMap(ctx)
  if(norm==='00'){
    const dirs=await listEffortDirs(ctx)
    for(const d of dirs){
      try{
        const plat=getPlat(ctx)
        const mapP=plat.join(d,'map.md')
        const txt=await readTextFile(ctx,mapP)
        const st=await statFile(ctx,mapP)
        let mtime=''
        if(st&&st.mtime){try{mtime=new Date(st.mtime).toISOString()}catch{}}
        const iss=parseMd(txt,{key:norm,parentKey:null,isMap:true,createdAt:mtime,updatedAt:mtime})
        recolorLabels(iss, paletteMap)
        return{ok:true,data:iss}
      }catch{}
    }
    try{
      const mapP=mdPath(repo,'map',undefined,ctx)
      const txt=await readTextFile(ctx,mapP)
      const st=await statFile(ctx,mapP)
      let mtime=''
      if(st&&st.mtime){try{mtime=new Date(st.mtime).toISOString()}catch{}}
      const iss=parseMd(txt,{key:norm,parentKey:null,isMap:true,createdAt:mtime,updatedAt:mtime})
      return{ok:true,data:iss}
    }catch{}
    // also repo.path fallback
    if(repo&&repo.path){
      try{
        const plat=getPlat(ctx)
        const mapP=plat.join(repo.path,'map.md')
        const txt=await readTextFile(ctx,mapP)
        const iss=parseMd(txt,{key:norm,parentKey:null,isMap:true})
        return{ok:true,data:iss}
      }catch{}
    }
  }
  const full=await findIssueFileGlobal(ctx,norm)
  if(full){
    try{const iss=await loadIssueFromFile(ctx,repo,full,{parentKey:'00',isMap:false});recolorLabels(iss, paletteMap);return{ok:true,data:iss}}catch(e){const kind=e&&e.kind?e.kind:classifyError(e);return{ok:false,error:{kind,message:e&&e.message?e.message:String(e)}}}
  }
  // fallback per-repo
  const per=await findIssueFileInEffort(ctx,repo,norm)
  if(per){
    try{const iss=await loadIssueFromFile(ctx,repo,per,{parentKey:'00',isMap:false});recolorLabels(iss, paletteMap);return{ok:true,data:iss}}catch(e){const kind=e&&e.kind?e.kind:classifyError(e);return{ok:false,error:{kind,message:e&&e.message?e.message:String(e)}}}
  }
  // repo.path fallback
  if(repo&&repo.path){
    try{
      const plat=getPlat(ctx)
      const cand=plat.join(repo.path,'issues',norm+'-')
      const files=await readDir(ctx, plat.join(repo.path,'issues'))
      const hit=files.find(f=>f.startsWith(norm+'-')&&f.endsWith('.md'))
      if(hit){
        const full2=plat.join(repo.path,'issues',hit)
        const iss=await loadIssueFromFile(ctx,repo,full2,{parentKey:'00',isMap:false})
        recolorLabels(iss, paletteMap)
        return{ok:true,data:iss}
      }
      // also unpadded fallback
      for(const f of files){
        const m=/^(\d+)-/.exec(f)
        if(!m) continue
        if(m[1].padStart(2,'0')===norm){
          const full2=plat.join(repo.path,'issues',f)
          const iss=await loadIssueFromFile(ctx,repo,full2,{parentKey:'00',isMap:false})
          recolorLabels(iss, paletteMap)
          return{ok:true,data:iss}
        }
      }
    }catch{}
  }
  return{ok:false,error:{kind:ERROR_KIND.NOTFOUND,message:'issue '+norm+' not-found'}}
}
export async function createIssue(ctx,repo,input){
  const plat=getPlat(ctx)
  const paletteMap=await loadPaletteMap(ctx)
  if(!input||typeof input.title!=='string'||!input.title.trim()){return{ok:false,error:{kind:ERROR_KIND.PARSE,message:'title required'}}}
  try{
    const idir=issuesDir(repo,ctx)
    await ensureDir(ctx,idir)
    // 全局 max+1（跨所有努力目录）避免多努力撞号 —— 符合 byKey 去重与全局看板预期
    let max=0
    try{
      const platG=getPlat(ctx)
      const rootG=await getScratchRoot(ctx)
      let effortDirsG=[]
      try{ const entries=await readDir(ctx, rootG); for(const name of entries){ if(!name||name.startsWith('.')) continue; const dir=platG.join(rootG,name); const mapP=platG.join(dir,'map.md'); try{ if(await exists(ctx,mapP)) effortDirsG.push(dir)}catch{} } }catch{}
      try{ if(await exists(ctx, platG.join(rootG,'map.md'))) effortDirsG.push(rootG)}catch{}
      for(const dir of effortDirsG){
        const idirG=platG.join(dir,'issues')
        const filesG=await readDir(ctx,idirG)
        for(const f of filesG){ const m=/^(\d+)-/.exec(f); if(m){ const n=parseInt(m[1],10); if(!isNaN(n)&&n>max) max=n } }
      }
      // also include self idir in case not in list
      const filesSelf=await readDir(ctx,idir)
      for(const f of filesSelf){ const m=/^(\d+)-/.exec(f); if(m){ const n=parseInt(m[1],10); if(!isNaN(n)&&n>max) max=n } }
    }catch{
      const files=await readDir(ctx,idir)
      for(const f of files){const m=/^(\d+)-/.exec(f);if(m){const n=parseInt(m[1],10);if(!isNaN(n)&&n>max)max=n}}
    }
    let next=max+1
    let attempt=0
    let finalPath=''
    let finalKey=''
    while(attempt<5){
      const keyStr=String(next).padStart(2,'0')
      const slug=slugify(input.title)
      const filename=keyStr+'-'+slug+'.md'
      const full=plat.join(idir,filename)
      const ex=await findIssueFileInEffort(ctx,repo,keyStr)
      if(ex){next++;attempt++;continue}
      finalPath=full;finalKey=keyStr;break
    }
    if(!finalPath)return{ok:false,error:{kind:ERROR_KIND.CONFLICT,message:'create NN conflict'}}
    const blockedByStr=Array.isArray(input.blockedBy)&&input.blockedBy.length?input.blockedBy.map(k=>'#'+String(k).padStart(2,'0')).join(', '):(typeof input.blockedBy==='string'?input.blockedBy:'')
    const typeField=input.type?String(input.type):(input.Type?String(input.Type):'')
    const labelsInput = Array.isArray(input.labels) ? input.labels : (Array.isArray(input.Labels)? input.Labels : null)
    let labelsStr=''
    if(labelsInput && labelsInput.length){
      const names=labelsInput.map(l=>{
        if(typeof l==='string') return l.trim()
        if(l&&typeof l.name==='string') return l.name.trim()
        return ''
      }).filter(Boolean)
      if(names.length) labelsStr=names.join(', ')
    } else if(typeof input.labels==='string' && input.labels.trim()){
      labelsStr=String(input.labels).trim()
    }
    const bodyPart=input.body?String(input.body).trim():''
    const title=String(input.title).trim()
    let content='# '+title+'\n\n'
    if(bodyPart)content+=bodyPart+'\n\n'
    content+='Status: '+(input.status||'ready-for-agent')+'\n'
    if(typeField)content+='Type: '+typeField+'\n'
    if(blockedByStr)content+='Blocked by: '+blockedByStr+'\n'
    else content+='Blocked by:\n'
    if(labelsStr) content+='Labels: '+labelsStr+'\n'
    else content+='Labels:\n'
    content+='\n## Comments\n\n\n## Answer\n\n'
    if(input.parentKey)content='<!-- parentKey: '+input.parentKey+' -->\n'+content
    await writeTextFile(ctx,finalPath,content)
    const st=await statFile(ctx,finalPath)
    let mtime=new Date().toISOString()
    if(st&&st.mtime){try{mtime=new Date(st.mtime).toISOString()}catch{}}
    const iss=parseMd(content,{key:finalKey,parentKey:input.parentKey||'00',isMap:false,createdAt:mtime,updatedAt:mtime})
    recolorLabels(iss, paletteMap)
    return{ok:true,data:iss}
  }catch(e){const kind=e&&e.kind?e.kind:classifyError(e);return{ok:false,error:{kind,message:e&&e.message?e.message:String(e)}}}
}
function replaceOrInsertField(txt,fieldName,newLine){
  const re=new RegExp('^\\s*'+fieldName+'\\s*[:\uFF1A]\\s*.*$','im')
  if(re.test(txt))return txt.replace(re,newLine)
  const lines=txt.split('\n')
  let insertIdx=1
  for(let i=0;i<lines.length;i++){if(/^#+\s+/.test(lines[i])){insertIdx=i+1;break}}
  lines.splice(insertIdx,0,newLine)
  return lines.join('\n')
}
export async function closeIssue(ctx,repo,key){
  const norm=String(key).padStart(2,'0')
  const paletteMap=await loadPaletteMap(ctx)
  let full=await findIssueFileGlobal(ctx,norm)
  if(!full) full=await findIssueFileInEffort(ctx,repo,norm)
  if(!full && repo&&repo.path){
    try{
      const plat=getPlat(ctx)
      const files=await readDir(ctx, plat.join(repo.path,'issues'))
      for(const f of files){
        const m=/^(\d+)-/.exec(f)
        if(m && m[1].padStart(2,'0')===norm && f.endsWith('.md')){ full=plat.join(repo.path,'issues',f); break }
      }
    }catch{}
  }
  if(!full){
    if(norm==='00'){
      const dirs=await listEffortDirs(ctx)
      for(const d of dirs){
        try{
          const plat=getPlat(ctx)
          const mapP=plat.join(d,'map.md')
          let txt=await readTextFile(ctx,mapP)
          txt=replaceOrInsertField(txt,'Status','Status: resolved')
          await writeTextFile(ctx,mapP,txt)
          const iss=parseMd(txt,{key:norm,parentKey:null,isMap:true})
          recolorLabels(iss, paletteMap)
          return{ok:true,data:iss}
        }catch(e){}
      }
      try{
        const mapP=mdPath(repo,'map',undefined,ctx)
        let txt=await readTextFile(ctx,mapP)
        txt=replaceOrInsertField(txt,'Status','Status: resolved')
        await writeTextFile(ctx,mapP,txt)
        const iss=parseMd(txt,{key:norm,parentKey:null,isMap:true})
        return{ok:true,data:iss}
      }catch(e){}
      if(repo&&repo.path){
        try{
          const plat=getPlat(ctx)
          const mapP=plat.join(repo.path,'map.md')
          let txt=await readTextFile(ctx,mapP)
          txt=replaceOrInsertField(txt,'Status','Status: resolved')
          await writeTextFile(ctx,mapP,txt)
          const iss=parseMd(txt,{key:norm,parentKey:null,isMap:true})
          return{ok:true,data:iss}
        }catch{}
      }
    }
    return{ok:false,error:{kind:ERROR_KIND.NOTFOUND,message:'issue '+norm+' not-found'}}
  }
  try{
    let txt=await readTextFile(ctx,full)
    txt=replaceOrInsertField(txt,'Status','Status: resolved')
    await writeTextFile(ctx,full,txt)
    const iss=parseMd(txt,{key:norm,parentKey:'00',isMap:false})
    recolorLabels(iss, paletteMap)
    return{ok:true,data:iss}
  }catch(e){const kind=e&&e.kind?e.kind:classifyError(e);return{ok:false,error:{kind,message:e&&e.message?e.message:String(e)}}}
}
export async function reopenIssue(ctx,repo,key){
  const norm=String(key).padStart(2,'0')
  const paletteMap=await loadPaletteMap(ctx)
  let full=await findIssueFileGlobal(ctx,norm)
  if(!full) full=await findIssueFileInEffort(ctx,repo,norm)
  if(!full && repo&&repo.path){
    try{
      const plat=getPlat(ctx)
      const files=await readDir(ctx, plat.join(repo.path,'issues'))
      for(const f of files){
        const m=/^(\d+)-/.exec(f)
        if(m && m[1].padStart(2,'0')===norm && f.endsWith('.md')){ full=plat.join(repo.path,'issues',f); break }
      }
    }catch{}
  }
  if(!full){
    if(norm==='00'){
      const dirs=await listEffortDirs(ctx)
      for(const d of dirs){
        try{
          const plat=getPlat(ctx)
          const mapP=plat.join(d,'map.md')
          let txt=await readTextFile(ctx,mapP)
          txt=replaceOrInsertField(txt,'Status','Status: ready-for-agent')
          await writeTextFile(ctx,mapP,txt)
          const iss=parseMd(txt,{key:norm,parentKey:null,isMap:true})
          return{ok:true,data:iss}
        }catch(e){}
      }
      try{
        const mapP=mdPath(repo,'map',undefined,ctx)
        let txt=await readTextFile(ctx,mapP)
        txt=replaceOrInsertField(txt,'Status','Status: ready-for-agent')
        await writeTextFile(ctx,mapP,txt)
        const iss=parseMd(txt,{key:norm,parentKey:null,isMap:true})
        return{ok:true,data:iss}
      }catch(e){}
      if(repo&&repo.path){
        try{
          const plat=getPlat(ctx)
          const mapP=plat.join(repo.path,'map.md')
          let txt=await readTextFile(ctx,mapP)
          txt=replaceOrInsertField(txt,'Status','Status: ready-for-agent')
          await writeTextFile(ctx,mapP,txt)
          const iss=parseMd(txt,{key:norm,parentKey:null,isMap:true})
          return{ok:true,data:iss}
        }catch{}
      }
    }
    return{ok:false,error:{kind:ERROR_KIND.NOTFOUND,message:'issue '+norm+' not-found'}}
  }
  try{
    let txt=await readTextFile(ctx,full)
    txt=replaceOrInsertField(txt,'Status','Status: ready-for-agent')
    await writeTextFile(ctx,full,txt)
    const iss=parseMd(txt,{key:norm,parentKey:'00',isMap:false})
    recolorLabels(iss, paletteMap)
    return{ok:true,data:iss}
  }catch(e){const kind=e&&e.kind?e.kind:classifyError(e);return{ok:false,error:{kind,message:e&&e.message?e.message:String(e)}}}
}
export async function updateIssue(ctx,repo,key,patch){
  const norm=String(key).padStart(2,'0')
  const paletteMap=await loadPaletteMap(ctx)
  let full=await findIssueFileGlobal(ctx,norm)
  if(!full) full=await findIssueFileInEffort(ctx,repo,norm)
  if(!full && repo&&repo.path){
    try{
      const plat=getPlat(ctx)
      const files=await readDir(ctx, plat.join(repo.path,'issues'))
      for(const f of files){
        const m=/^(\d+)-/.exec(f)
        if(m && m[1].padStart(2,'0')===norm && f.endsWith('.md')){ full=plat.join(repo.path,'issues',f); break }
      }
    }catch{}
  }
  if(!full)return{ok:false,error:{kind:ERROR_KIND.NOTFOUND,message:'issue '+norm+' not-found'}}
  try{
    let txt=await readTextFile(ctx,full)
    let changed=false
    if(patch&&typeof patch.title==='string'){
      const newTitle=patch.title.trim()
      if(newTitle){
        if(/^#+\s+.*$/m.test(txt))txt=txt.replace(/^#+\s+.*$/m,'# '+newTitle)
        else txt='# '+newTitle+'\n\n'+txt
        changed=true
      }
    }
    if(patch&&typeof patch.body==='string'){
      if(/^\s*Status\s*[:\uFF1A]/im.test(patch.body)){
        txt=String(patch.body);changed=true
      }else{
        const lines=txt.split('\n')
        const titleIdx=lines.findIndex(l=>/^#+\s+/.test(l))
        let insertAt=titleIdx>=0?titleIdx+1:0
        while(insertAt<lines.length&&lines[insertAt].trim()==='')insertAt++
        let fieldIdx=lines.findIndex((l,i)=>i>=insertAt&&/^\s*(Status|Type|Blocked\s+by|Labels)\s*[:\uFF1A]/i.test(l))
        if(fieldIdx<0)fieldIdx=lines.length
        const before=lines.slice(0,insertAt).join('\n')
        const after=lines.slice(fieldIdx).join('\n')
        const bodyBlock=String(patch.body).trim()
        txt=before+(before?'\n\n':'')+bodyBlock+'\n\n'+after
        changed=true
      }
    }
    if(patch&&Array.isArray(patch.customFields)){
      for(const cf of patch.customFields){
        if(cf&&cf.name==='Type'&&typeof cf.value==='string'&&cf.value.trim()){
          txt=replaceOrInsertField(txt,'Type','Type: '+String(cf.value).trim().toLowerCase());changed=true
        }
      }
    }
    if(patch&&patch.labels!==undefined){
      const names=Array.isArray(patch.labels)? patch.labels.map(l=> typeof l==='string'? l.trim() : (l&&l.name? String(l.name).trim():'' )).filter(Boolean) : []
      const line=names.length? 'Labels: '+names.join(', ') : 'Labels:'
      txt=replaceOrInsertField(txt,'Labels',line);changed=true
    }
    if(changed)await writeTextFile(ctx,full,txt)
    const iss=parseMd(txt,{key:norm,parentKey:'00',isMap:false})
    recolorLabels(iss, paletteMap)
    return{ok:true,data:iss}
  }catch(e){const kind=e&&e.kind?e.kind:classifyError(e);return{ok:false,error:{kind,message:e&&e.message?e.message:String(e)}}}
}
export async function setBlockedByIssue(ctx,repo,key,blockers){
  const norm=String(key).padStart(2,'0')
  const paletteMap=await loadPaletteMap(ctx)
  if(Array.isArray(blockers)&&blockers.map(k=>String(k).padStart(2,'0')).includes(norm)){return{ok:false,error:{kind:ERROR_KIND.CONFLICT,message:'self-block '+norm}}}
  let full=await findIssueFileGlobal(ctx,norm)
  if(!full) full=await findIssueFileInEffort(ctx,repo,norm)
  if(!full && repo&&repo.path){
    try{
      const plat=getPlat(ctx)
      const files=await readDir(ctx, plat.join(repo.path,'issues'))
      for(const f of files){
        const m=/^(\d+)-/.exec(f)
        if(m && m[1].padStart(2,'0')===norm && f.endsWith('.md')){ full=plat.join(repo.path,'issues',f); break }
      }
    }catch{}
  }
  if(!full)return{ok:false,error:{kind:ERROR_KIND.NOTFOUND,message:'issue '+norm+' not-found'}}
  try{
    let txt=await readTextFile(ctx,full)
    const arr=Array.isArray(blockers)?blockers:[]
    const line=arr.length?'Blocked by: '+arr.map(k=>'#'+String(k).padStart(2,'0')).join(', '):'Blocked by:'
    txt=replaceOrInsertField(txt,'Blocked\\s+by',line)
    await writeTextFile(ctx,full,txt)
    const iss=parseMd(txt,{key:norm,parentKey:'00',isMap:false})
    recolorLabels(iss, paletteMap)
    return{ok:true,data:iss}
  }catch(e){const kind=e&&e.kind?e.kind:classifyError(e);return{ok:false,error:{kind,message:e&&e.message?e.message:String(e)}}}
}
export async function setAssigneesIssue(ctx,repo,key,assignees){
  const norm=String(key).padStart(2,'0')
  const paletteMap=await loadPaletteMap(ctx)
  let full=await findIssueFileGlobal(ctx,norm)
  if(!full) full=await findIssueFileInEffort(ctx,repo,norm)
  if(!full && repo&&repo.path){
    try{
      const plat=getPlat(ctx)
      const files=await readDir(ctx, plat.join(repo.path,'issues'))
      for(const f of files){
        const m=/^(\d+)-/.exec(f)
        if(m && m[1].padStart(2,'0')===norm && f.endsWith('.md')){ full=plat.join(repo.path,'issues',f); break }
      }
    }catch{}
  }
  if(!full)return{ok:false,error:{kind:ERROR_KIND.NOTFOUND,message:'issue '+norm+' not-found'}}
  try{
    let txt=await readTextFile(ctx,full)
    const hasAssignee=Array.isArray(assignees)&&assignees.length>0
    const statusLine=hasAssignee?'Status: claimed':'Status: ready-for-agent'
    txt=replaceOrInsertField(txt,'Status',statusLine)
    await writeTextFile(ctx,full,txt)
    const iss=parseMd(txt,{key:norm,parentKey:'00',isMap:false})
    recolorLabels(iss, paletteMap)
    return{ok:true,data:iss}
  }catch(e){const kind=e&&e.kind?e.kind:classifyError(e);return{ok:false,error:{kind,message:e&&e.message?e.message:String(e)}}}
}
export async function setParentIssue(ctx,repo,key,parentKey){
  return{ok:false,error:{kind:ERROR_KIND.UNSUPPORTED,message:'markdown setParent unsupported (single-root)'}}
}
export async function setLabelsIssue(ctx,repo,key,labels){
  const norm=String(key).padStart(2,'0')
  const paletteMap=await loadPaletteMap(ctx)
  const names=Array.isArray(labels)? labels.map(l=> typeof l==='string'? l.trim() : (l&&typeof l.name==='string'? l.name.trim():String(l).trim())).filter(Boolean) : []
  let full=null
  // try map first if key 00
  if(norm==='00'){
    const dirs=await listEffortDirs(ctx)
    for(const d of dirs){
      const plat=getPlat(ctx)
      const mapP=plat.join(d,'map.md')
      try{
        if(await exists(ctx,mapP)){
          full=mapP
          break
        }
      }catch{}
    }
    if(!full){
      try{
        const mapP=mdPath(repo,'map',undefined,ctx)
        if(await exists(ctx,mapP)) full=mapP
      }catch{}
    }
    if(!full && repo&&repo.path){
      const plat=getPlat(ctx)
      const cand=plat.join(repo.path,'map.md')
      try{ if(await exists(ctx,cand)) full=cand }catch{}
    }
  } else {
    full=await findIssueFileGlobal(ctx,norm)
    if(!full) full=await findIssueFileInEffort(ctx,repo,norm)
    if(!full && repo&&repo.path){
      try{
        const plat=getPlat(ctx)
        const files=await readDir(ctx, plat.join(repo.path,'issues'))
        for(const f of files){
          const m=/^(\d+)-/.exec(f)
          if(m && m[1].padStart(2,'0')===norm && f.endsWith('.md')){ full=plat.join(repo.path,'issues',f); break }
        }
      }catch{}
    }
  }
  if(!full)return{ok:false,error:{kind:ERROR_KIND.NOTFOUND,message:'issue '+norm+' not-found'}}
  try{
    let txt=await readTextFile(ctx,full)
    const line=names.length? 'Labels: '+names.join(', ') : 'Labels:'
    txt=replaceOrInsertField(txt,'Labels',line)
    await writeTextFile(ctx,full,txt)
    const iss=parseMd(txt,{key:norm,parentKey: norm==='00'? null : '00', isMap: norm==='00'})
    recolorLabels(iss, paletteMap)
    return{ok:true,data:iss}
  }catch(e){const kind=e&&e.kind?e.kind:classifyError(e);return{ok:false,error:{kind,message:e&&e.message?e.message:String(e)}}}
}
export default{listIssues,getIssue,createIssue,closeIssue,reopenIssue,updateIssue,setBlockedByIssue,setAssigneesIssue,setParentIssue,setLabelsIssue}