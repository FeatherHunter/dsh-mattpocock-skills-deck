// issues-create.js —— 以后改新建单据落盘格式时改它（预估约 100 行）。
//
// effort 维度（2026-09-09）：建票必须落在**一个明确的 effort** 里，编号按契约「每个 effort 从 01 起」在该 effort 内取 max+1。
//   - repo.effortId 给出 → 就落在那一个 effort；
//   - 仓库只有一个 effort → 自动落它（单 effort 仓库用起来无感）；
//   - 仓库有多个 effort 又没指定 → 返回 conflict 诚实失败，绝不猜（旧实现在所有 effort 之间取全局 max+1，
//     与契约冲突，而且因为少了 getScratchRoot 的 import 从未生效）。
import { parseMd, slugify, stripLabelDecoration } from './parse.js'
import { readDir, statFile, exists } from './read.js'
import { writeTextFile, ensureDir } from './write.js'
import { issuesDir } from './path.js'
import { classifyError } from '../../preflight.js'
import { ERROR_KIND } from '../../../../shared/tracker/constants.js'
import { getPlat, listEfforts, findIssueFileInEffort } from './issues-locate.js'
import { loadPaintColorMap, applyLabelColors } from './label-colors-paint.js'
import { withLabelColorsWriter } from './label-colors.js'

/** 选定这次的票落在哪个 effort（这是**读**，不影响并发，放在写者队列外面）。
 *  - repo.effortId 给出 → 就落在那一个 effort；
 *  - 仓库只有一个 effort → 自动落它；
 *  - 仓库有多个 effort 又没指定 → 返回 conflict 诚实失败，绝不猜；
 *  - 指了 effort 但它不存在 → NOTFOUND 诚实失败，绝不落到根目录
 *    （否则票写进 .scratch/issues/ 面板永远看不见）。 */
async function resolveCreateTarget(ctx, repo){
  const efforts=await listEfforts(ctx)
  const scope=(repo&&repo.effortId!==undefined&&repo.effortId!==null)?String(repo.effortId):undefined
  let target=null
  if(scope!==undefined){
    target=efforts.find(function(e){ return e.effortId===scope })||null
    if(!target){
      const have=efforts.map(function(e){ return e.effortId||'(根)' }).join('、')||'（本仓库还没有 effort）'
      return{ok:false,error:{kind:ERROR_KIND.NOTFOUND,message:'找不到 effort「'+scope+'」；本仓库现有：'+have}}
    }
  }else if(efforts.length===1){
    target=efforts[0]
  }else if(efforts.length>1){
    return{ok:false,error:{kind:ERROR_KIND.CONFLICT,message:'本仓库有 '+efforts.length+' 个 effort（'+efforts.map(function(e){return e.effortId||'(根)'}).join('、')+'），新建票据必须指定 effortId'}}
  }
  return{ok:true,effortId:target?target.effortId:'',idir:target?getPlat(ctx).join(target.dir,'issues'):issuesDir(repo,ctx)}
}

/** 票面正文（落盘内容）。单独抽出来是因为落盘要在写者队列里做、回包还要按同一份内容解析，
 *  两处必须是同一份文本，不能各拼一遍（拼两遍迟早走样）。 */
function buildIssueText(input){
  const blockedByStr=Array.isArray(input.blockedBy)&&input.blockedBy.length?input.blockedBy.map(k=>'#'+String(k).padStart(2,'0')).join(', '):(typeof input.blockedBy==='string'?input.blockedBy:'')
  const typeField=input.type?String(input.type):(input.Type?String(input.Type):'')
  const labelsInput = Array.isArray(input.labels) ? input.labels : (Array.isArray(input.Labels)? input.Labels : null)
  let labelsStr=''
  if(labelsInput && labelsInput.length){
    // #634：落盘的标签名先剥掉外层成对引号/反引号（调用方递进来的名字可能带着照抄文档代码写法的那层）
    const names=labelsInput.map(l=>{
      if(typeof l==='string') return stripLabelDecoration(l)
      if(l&&typeof l.name==='string') return stripLabelDecoration(l.name)
      return ''
    }).filter(Boolean)
    if(names.length) labelsStr=names.join(', ')
  } else if(typeof input.labels==='string' && input.labels.trim()){
    // 整行直接给字符串时，同样逐个剥净：这是「一次贴一整行」的用法，最容易把引号一起带进来
    labelsStr=String(input.labels).split(/[,\uFF0C]+/).map(function(s){return stripLabelDecoration(s)}).filter(Boolean).join(', ')
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
  return content
}

export async function createIssue(ctx,repo,input){
  const plat=getPlat(ctx)
  const colorMap=await loadPaintColorMap(ctx)
  if(!input||typeof input.title!=='string'||!input.title.trim()){return{ok:false,error:{kind:ERROR_KIND.PARSE,message:'title required'}}}
  try{
    // 取号 → 探测 → 落盘这三段必须在**同一个按工作区串行的写者队列**里跑完（#712）。
    // 为什么：取号是「读目录取 max+1」（下面 readDir 那一段），落盘是整份覆盖
    // （write.js 的 writeTextFile，没有独占创建），而读目录这个 await 会让出事件循环 ——
    // 多个会话/子代理同时建票时，多路会读到同一个 max、算出同一个编号、都探测到「这个编号还没人占」，
    // 然后互相覆盖，最后盘上只剩一张，而每一路都回了 ok:true（本机实测 8 路并发全部回 key="01"）。
    // 队列钥匙按工作区归一（withLabelColorsWriter 内部用 workspaceKeyOf），与配色文件那条写路径共用同一条队，
    // 所以「同一个工作区里的写入」在插件内部是彼此排队、不交错的。
    const r=await withLabelColorsWriter(ctx,repo,async function(){
      const target=await resolveCreateTarget(ctx,repo)
      if(!target.ok)return target
      const effortId=target.effortId
      const idir=target.idir
      await ensureDir(ctx,idir)
      // 编号：只在目标 effort 内取 max+1（契约：每个 effort 从 01 起）
      let max=0
      const filesSelf=await readDir(ctx,idir)
      for(const f of filesSelf){ const m=/^(\d+)-/.exec(f); if(m){ const n=parseInt(m[1],10); if(!isNaN(n)&&n>max) max=n } }
      let next=max+1
      let attempt=0
      let finalPath=''
      let finalKey=''
      // 探测（findIssueFileInEffort）到「这个编号确实没人占」为止。串行化后前面的并发调用都已经落完盘，
      // 所以这里数出来的 max 一定包含它们刚建出来的票，取到的号不会与任何一路重复；
      // 就算真有同名编号存在（旧数据、手工建的文件），也在这里往后跳过，绝不覆盖。
      while(attempt<5){
        const keyStr=String(next).padStart(2,'0')
        const slug=slugify(input.title)
        const filename=keyStr+'-'+slug+'.md'
        const full=plat.join(idir,filename)
        const ex=await findIssueFileInEffort(ctx,{effortId},keyStr)
        if(ex){next++;attempt++;continue}
        finalPath=full;finalKey=keyStr;break
      }
      if(!finalPath)return{ok:false,error:{kind:ERROR_KIND.CONFLICT,message:'create NN conflict'}}
      // 内容拼装与落盘同样留在队列里：落盘这一步必须发生在**还握着队列**的时候，
      // 否则下一路会在「这一路已经取到号、但还没写下去」的缝里读目录，又读不到这张票、又取到同一个号。
      await writeTextFile(ctx,finalPath,buildIssueText(input))
      return{ok:true,effortId,finalPath,finalKey}
    })
    if(!r.ok)return r
    const {effortId,finalPath,finalKey}=r
    const content=buildIssueText(input)
    const st=await statFile(ctx,finalPath)
    let mtime=new Date().toISOString()
    if(st&&st.mtime){try{mtime=new Date(st.mtime).toISOString()}catch{}}
    const iss=parseMd(content,{key:finalKey,parentKey:input.parentKey||'00',isMap:false,effortId,createdAt:mtime,updatedAt:mtime})
    applyLabelColors(iss, colorMap)
    return{ok:true,data:iss}
  }catch(e){const kind=e&&e.kind?e.kind:classifyError(e);return{ok:false,error:{kind,message:e&&e.message?e.message:String(e)}}}
}
