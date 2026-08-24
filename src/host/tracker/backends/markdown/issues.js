import { parseMd, slugify } from './parse.js'
import { readTextFile, readDir, statFile } from './read.js'
import { writeTextFile, ensureDir } from './write.js'
import { mdPath, issuesDir } from './path.js'
import { classifyError } from '../../preflight.js'
import { ERROR_KIND } from '../../../../shared/tracker/constants.js'
import nodePath from 'node:path'
function getPlat(ctx){if(ctx&&ctx.platform&&ctx.platform.path)return ctx.platform.path;if(ctx&&ctx.path)return ctx.path;if(typeof process!=='undefined'&&process.platform==='win32')return nodePath.win32;return nodePath.posix}
async function findIssueFile(ctx,repo,key){
  const plat=getPlat(ctx);const idir=issuesDir(repo,ctx)
  const files=await readDir(ctx,idir)
  const prefix=String(key).padStart(2,'0')+'-'
  const hit=files.find(f=>f.startsWith(prefix)&&f.endsWith('.md'))
  if(!hit)return null
  return plat.join(idir,hit)
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
  try{
    const out=[]
    try{
      const mapP=mdPath(repo,'map',undefined,ctx)
      const txt=await readTextFile(ctx,mapP)
      const st=await statFile(ctx,mapP)
      let mtime=''
      if(st&&st.mtime){try{mtime=new Date(st.mtime).toISOString()}catch{}}
      const iss=parseMd(txt,{key:'00',parentKey:null,isMap:true,createdAt:mtime,updatedAt:mtime})
      out.push(iss)
    }catch{}
    const idir=issuesDir(repo,ctx)
    const files=await readDir(ctx,idir)
    for(const f of files){
      if(!/^\d+-.*\.md$/.test(f))continue
      const key=f.slice(0,2)
      if(filter&&Array.isArray(filter.keys)&&filter.keys.length&&!filter.keys.includes(key))continue
      const full=plat.join(idir,f)
      try{const iss=await loadIssueFromFile(ctx,repo,full,{parentKey:'00',isMap:false});out.push(iss)}catch{}
    }
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
  if(norm==='00'){
    try{
      const mapP=mdPath(repo,'map',undefined,ctx)
      const txt=await readTextFile(ctx,mapP)
      const st=await statFile(ctx,mapP)
      let mtime=''
      if(st&&st.mtime){try{mtime=new Date(st.mtime).toISOString()}catch{}}
      const iss=parseMd(txt,{key:norm,parentKey:null,isMap:true,createdAt:mtime,updatedAt:mtime})
      return{ok:true,data:iss}
    }catch{}
  }
  const full=await findIssueFile(ctx,repo,norm)
  if(!full)return{ok:false,error:{kind:ERROR_KIND.NOTFOUND,message:'issue '+norm+' not-found'}}
  try{const iss=await loadIssueFromFile(ctx,repo,full,{parentKey:'00',isMap:false});return{ok:true,data:iss}}catch(e){const kind=e&&e.kind?e.kind:classifyError(e);return{ok:false,error:{kind,message:e&&e.message?e.message:String(e)}}}
}
export async function createIssue(ctx,repo,input){
  const plat=getPlat(ctx)
  if(!input||typeof input.title!=='string'||!input.title.trim()){return{ok:false,error:{kind:ERROR_KIND.PARSE,message:'title required'}}}
  try{
    const idir=issuesDir(repo,ctx)
    await ensureDir(ctx,idir)
    const files=await readDir(ctx,idir)
    let max=0
    for(const f of files){const m=/^(\d+)-/.exec(f);if(m){const n=parseInt(m[1],10);if(!isNaN(n)&&n>max)max=n}}
    let next=max+1
    let attempt=0
    let finalPath=''
    let finalKey=''
    while(attempt<5){
      const keyStr=String(next).padStart(2,'0')
      const slug=slugify(input.title)
      const filename=keyStr+'-'+slug+'.md'
      const full=plat.join(idir,filename)
      const ex=await findIssueFile(ctx,repo,keyStr)
      if(ex){next++;attempt++;continue}
      finalPath=full;finalKey=keyStr;break
    }
    if(!finalPath)return{ok:false,error:{kind:ERROR_KIND.CONFLICT,message:'create NN conflict'}}
    const blockedByStr=Array.isArray(input.blockedBy)&&input.blockedBy.length?input.blockedBy.map(k=>'#'+String(k).padStart(2,'0')).join(', '):(typeof input.blockedBy==='string'?input.blockedBy:'')
    const typeField=input.type?String(input.type):(input.Type?String(input.Type):'')
    const bodyPart=input.body?String(input.body).trim():''
    const title=String(input.title).trim()
    let content='# '+title+'\n\n'
    if(bodyPart)content+=bodyPart+'\n\n'
    content+='Status: '+(input.status||'ready-for-agent')+'\n'
    if(typeField)content+='Type: '+typeField+'\n'
    if(blockedByStr)content+='Blocked by: '+blockedByStr+'\n'
    else content+='Blocked by:\n'
    content+='\n## Comments\n\n\n## Answer\n\n'
    if(input.parentKey)content='<!-- parentKey: '+input.parentKey+' -->\n'+content
    await writeTextFile(ctx,finalPath,content)
    const st=await statFile(ctx,finalPath)
    let mtime=new Date().toISOString()
    if(st&&st.mtime){try{mtime=new Date(st.mtime).toISOString()}catch{}}
    const iss=parseMd(content,{key:finalKey,parentKey:input.parentKey||'00',isMap:false,createdAt:mtime,updatedAt:mtime})
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
  const full=await findIssueFile(ctx,repo,norm)
  if(!full){
    if(norm==='00'){
      try{
        const mapP=mdPath(repo,'map',undefined,ctx)
        let txt=await readTextFile(ctx,mapP)
        txt=replaceOrInsertField(txt,'Status','Status: resolved')
        await writeTextFile(ctx,mapP,txt)
        const iss=parseMd(txt,{key:norm,parentKey:null,isMap:true})
        return{ok:true,data:iss}
      }catch(e){}
    }
    return{ok:false,error:{kind:ERROR_KIND.NOTFOUND,message:'issue '+norm+' not-found'}}
  }
  try{
    let txt=await readTextFile(ctx,full)
    txt=replaceOrInsertField(txt,'Status','Status: resolved')
    await writeTextFile(ctx,full,txt)
    const iss=parseMd(txt,{key:norm,parentKey:'00',isMap:false})
    return{ok:true,data:iss}
  }catch(e){const kind=e&&e.kind?e.kind:classifyError(e);return{ok:false,error:{kind,message:e&&e.message?e.message:String(e)}}}
}
export async function reopenIssue(ctx,repo,key){
  const norm=String(key).padStart(2,'0')
  const full=await findIssueFile(ctx,repo,norm)
  if(!full){
    if(norm==='00'){
      try{
        const mapP=mdPath(repo,'map',undefined,ctx)
        let txt=await readTextFile(ctx,mapP)
        txt=replaceOrInsertField(txt,'Status','Status: ready-for-agent')
        await writeTextFile(ctx,mapP,txt)
        const iss=parseMd(txt,{key:norm,parentKey:null,isMap:true})
        return{ok:true,data:iss}
      }catch(e){}
    }
    return{ok:false,error:{kind:ERROR_KIND.NOTFOUND,message:'issue '+norm+' not-found'}}
  }
  try{
    let txt=await readTextFile(ctx,full)
    txt=replaceOrInsertField(txt,'Status','Status: ready-for-agent')
    await writeTextFile(ctx,full,txt)
    const iss=parseMd(txt,{key:norm,parentKey:'00',isMap:false})
    return{ok:true,data:iss}
  }catch(e){const kind=e&&e.kind?e.kind:classifyError(e);return{ok:false,error:{kind,message:e&&e.message?e.message:String(e)}}}
}
export async function updateIssue(ctx,repo,key,patch){
  const norm=String(key).padStart(2,'0')
  const full=await findIssueFile(ctx,repo,norm)
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
        let fieldIdx=lines.findIndex((l,i)=>i>=insertAt&&/^\s*(Status|Type|Blocked\s+by)\s*[:\uFF1A]/i.test(l))
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
    if(changed)await writeTextFile(ctx,full,txt)
    const iss=parseMd(txt,{key:norm,parentKey:'00',isMap:false})
    return{ok:true,data:iss}
  }catch(e){const kind=e&&e.kind?e.kind:classifyError(e);return{ok:false,error:{kind,message:e&&e.message?e.message:String(e)}}}
}
export async function setBlockedByIssue(ctx,repo,key,blockers){
  const norm=String(key).padStart(2,'0')
  if(Array.isArray(blockers)&&blockers.includes(norm)){return{ok:false,error:{kind:ERROR_KIND.CONFLICT,message:'self-block '+norm}}}
  const full=await findIssueFile(ctx,repo,norm)
  if(!full)return{ok:false,error:{kind:ERROR_KIND.NOTFOUND,message:'issue '+norm+' not-found'}}
  try{
    let txt=await readTextFile(ctx,full)
    const arr=Array.isArray(blockers)?blockers:[]
    const line=arr.length?'Blocked by: '+arr.map(k=>'#'+String(k).padStart(2,'0')).join(', '):'Blocked by:'
    txt=replaceOrInsertField(txt,'Blocked\\s+by',line)
    await writeTextFile(ctx,full,txt)
    const iss=parseMd(txt,{key:norm,parentKey:'00',isMap:false})
    return{ok:true,data:iss}
  }catch(e){const kind=e&&e.kind?e.kind:classifyError(e);return{ok:false,error:{kind,message:e&&e.message?e.message:String(e)}}}
}
export async function setAssigneesIssue(ctx,repo,key,assignees){
  const norm=String(key).padStart(2,'0')
  const full=await findIssueFile(ctx,repo,norm)
  if(!full)return{ok:false,error:{kind:ERROR_KIND.NOTFOUND,message:'issue '+norm+' not-found'}}
  try{
    let txt=await readTextFile(ctx,full)
    const hasAssignee=Array.isArray(assignees)&&assignees.length>0
    const statusLine=hasAssignee?'Status: claimed':'Status: ready-for-agent'
    txt=replaceOrInsertField(txt,'Status',statusLine)
    await writeTextFile(ctx,full,txt)
    const iss=parseMd(txt,{key:norm,parentKey:'00',isMap:false})
    return{ok:true,data:iss}
  }catch(e){const kind=e&&e.kind?e.kind:classifyError(e);return{ok:false,error:{kind,message:e&&e.message?e.message:String(e)}}}
}
export async function setParentIssue(ctx,repo,key,parentKey){
  return{ok:false,error:{kind:ERROR_KIND.UNSUPPORTED,message:'markdown setParent unsupported (single-root)'}}
}
export default{listIssues,getIssue,createIssue,closeIssue,reopenIssue,updateIssue,setBlockedByIssue,setAssigneesIssue,setParentIssue}
