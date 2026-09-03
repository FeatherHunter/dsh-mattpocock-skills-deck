// issues-labels.js —— 以后改标签颜色对照规则时改它（预估约 50 行）。
import { readTextFile } from './read.js'
import { getPlat } from './issues-locate.js'

export async function loadPaletteMap(ctx){
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
export function recolorLabels(issue, paletteMap){
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
