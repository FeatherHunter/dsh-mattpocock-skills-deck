// issues-status.js —— 以后改关闭与重开状态流转时改它；字段行改写小工具也住这，补丁文件共用（预估约 150 行）。
import { parseMd } from './parse.js'
import { readTextFile, readDir } from './read.js'
import { writeTextFile } from './write.js'
import { mdPath } from './path.js'
import { classifyError } from '../../preflight.js'
import { ERROR_KIND } from '../../../../shared/tracker/constants.js'
import { getPlat, listEffortDirs, findIssueFileGlobal, findIssueFileInEffort } from './issues-locate.js'
import { loadPaletteMap, recolorLabels } from './issues-labels.js'

export function replaceOrInsertField(txt,fieldName,newLine){
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
