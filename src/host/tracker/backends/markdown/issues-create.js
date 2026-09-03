// issues-create.js —— 以后改新建单据落盘格式时改它（预估约 90 行）。
import { parseMd, slugify } from './parse.js'
import { readDir, statFile, exists } from './read.js'
import { writeTextFile, ensureDir } from './write.js'
import { issuesDir } from './path.js'
import { classifyError } from '../../preflight.js'
import { ERROR_KIND } from '../../../../shared/tracker/constants.js'
import { getPlat, findIssueFileInEffort } from './issues-locate.js'
import { loadPaletteMap, recolorLabels } from './issues-labels.js'

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
