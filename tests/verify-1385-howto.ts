// tests/verify-1385-howto.ts —— #1385：deck_context 的用法说明按后端分支，本地后端追加建票契约
// 门禁归属: src/deck/tools/context.ts, src/deck/tools/issue-create.ts, src/deck/tools/issue-patch.ts, src/deck/tools/issue-patch-definition.ts
// 验证（每条都能被删掉/改坏而变红）：
//   1) 本地后端（markdown）的 howto 含建票契约关键词：文件格式与位置以随包技能原文为唯一依据
//      （规格 spec.md、探索地图 map.md、票在 issues/<NN>-<slug>.md），六种 kind 与 parentKey / blockedBy、
//      补边用 deck_map_link、不要手写票文件、插件信息写进隐藏注释；旧写法「规格就是票」与 kind=ticket / kind=task 必须消失；
//   2) 其它后端（github/gitlab）的 howto 与改前逐字一致，一个字不多一个字不少；
//   3) deck_issue_create / deck_issue_patch 的描述在 350 字内，且含本地后端最必要的一两句。
// 用法: node --import ./scripts/ts-hook.mts tests/verify-1385-howto.ts
const path = require('path')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href)

// 改前逐字冻住的那 381 字：非本地后端必须与它一字不差（改一个字就红）。
const BASE_HOWTO = '写票之前先用本工具确认工作区与后端；建票用 deck_issue_create，建整张地图骨架用 deck_map_plan_create，补边用 deck_map_link，改票用 deck_issue_patch，上报当前在办哪张票用 deck_issue_report，读一张票用 deck_issue_get，看一张地图的全部子票用 deck_map_snapshot，按状态与 label 和 assignee 列薄行用 deck_issue_list。要快数：扫数先用 deck_issue_list 薄行；单票反向边不急就 deck_issue_get 传 blocking=false（跳过一次全仓扫描）；子票清单要全不断就 deck_map_snapshot 传 detail=thin（统计不变）。工作区与仓库不接受参数：它们只从当前会话取。'

async function main() {
  console.log('#1385：howto 按后端分支 + 描述字数与短句')
  const ctxMod = await imp('src/deck/tools/context.ts')
  const createMod = await imp('src/deck/tools/issue-create.ts')
  const patchMod = await imp('src/deck/tools/issue-patch.ts')

  // 纯函数：按后端 id 求值（非本地分支与改前逐字一致靠它保证）。
  const fn = ctxMod.howtoFor || ctxMod.buildHowto || ctxMod.howtoTextFor
  check(typeof fn === 'function', 'context.ts 按后端 id 求值的 howto 纯函数已导出（实得 ' + typeof fn + '）')
  if (typeof fn !== 'function') {
    console.log('\n存在失败')
    process.exit(1)
  }

  // —— 本地后端：含契约关键词 ——
  const local = fn('markdown')
  check(typeof local === 'string' && local.indexOf(BASE_HOWTO) === 0, '本地后端 howto 以改前那 381 字开头（老话一句不少）')
  check(local.indexOf('issue-tracker-local.md') >= 0, '本地后端 howto 点名随包技能原文，声明它是唯一依据（#1480）')
  check(local.indexOf('规格是 .scratch/<feature-slug>/spec.md') >= 0, '本地后端 howto 说清规格落在 spec.md（#1480）')
  check(local.indexOf('.scratch/<effort>/map.md') >= 0, '本地后端 howto 说清探索地图落在 map.md（#1480）')
  check(local.indexOf('issues/<NN>-<slug>.md') >= 0, '本地后端 howto 说清票落在 issues/<NN>-<slug>.md（#1480）')
  check(local.indexOf('kind=spec-ticket') >= 0, '本地后端 howto 说清实施票 kind=spec-ticket')
  check(local.indexOf('kind=map-ticket') >= 0, '本地后端 howto 说清地图子票 kind=map-ticket')
  check(local.indexOf('kind=issue') >= 0, '本地后端 howto 说清普通票 kind=issue 的兜底')
  check(local.indexOf('kind=bug') >= 0, '本地后端 howto 说清缺陷票 kind=bug')
  check(local.indexOf('kind=spec 建规格') >= 0, '本地后端 howto 说清规格票 kind=spec')
  check(local.indexOf('kind=ticket') < 0 && local.indexOf('kind=task') < 0, '本地后端 howto 里旧的 kind=ticket / kind=task 已经消失')
  check(local.indexOf('规格就是票') < 0 && local.indexOf('顶层容器') < 0, '本地后端 howto 不再把规格说成一张票或顶层容器（#1490）')
  check(local.indexOf('wayfinder:task') >= 0, '本地后端 howto 列出地图子票可选的 label')
  check(local.indexOf('parentKey') >= 0, '本地后端 howto 说清 parentKey 填谁')
  check(local.indexOf('blockedBy') >= 0, '本地后端 howto 说清依赖填 blockedBy')
  check(local.indexOf('不要手写票文件') >= 0, '本地后端 howto 说清不要手写票文件')
  check(local.indexOf('隐藏注释') >= 0, '本地后端 howto 说清插件信息写进文件头隐藏注释（#1480）')
  check(local.indexOf('.scratch') >= 0, '本地后端 howto 点名 .scratch 下的票文件不要手写')
  check(local.indexOf('deck_map_link') >= 0, '本地后端 howto 说清补边用 deck_map_link')
  check(local.indexOf('技能原文为准') >= 0, '本地后端 howto 声明与技能原文冲突时以原文为准（#1480）')
  check(local.indexOf('上报是记账') >= 0 && local.indexOf('deck_work_route') >= 0, '本地后端 howto 说清上报只记账不带表、在办表走 deck_work_route（#1561）')

  // —— 其它后端：逐字不变 ——
  for (const id of ['github', 'gitlab']) {
    const other = fn(id)
    check(other === BASE_HOWTO, id + ' 后端 howto 与改前逐字一致（实得 ' + String(other).length + ' 字，期望 ' + String(BASE_HOWTO).length + ' 字）')
  }

  // —— 描述：350 字内 + 本地短句 ——
  const createDesc = String((createMod.definition && createMod.definition.description) || '')
  const patchDesc = String((patchMod.definition && patchMod.definition.description) || '')
  check(createDesc.length <= 350, 'deck_issue_create 描述在 350 字内（实得 ' + createDesc.length + ' 字）')
  check(patchDesc.length <= 350, 'deck_issue_patch 描述在 350 字内（实得 ' + patchDesc.length + ' 字）')
  check(createDesc.indexOf('编号与文件头标记由工具写') >= 0 || createDesc.indexOf('编号和文件头标记由工具写') >= 0, 'deck_issue_create 描述含本地后端最必要的一句：编号与文件头标记由工具写')
  check(createDesc.indexOf('不要手写') >= 0, 'deck_issue_create 描述提醒不要手写票文件')
  check(patchDesc.indexOf('Assignees') >= 0, 'deck_issue_patch 描述含最必要的一句：认领写 Assignees 行')

  console.log('\n' + (failed ? '存在失败' : '全部通过 — #1385 howto 两分支 + 描述字数（' + total + ' 条）'))
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error('门禁执行异常：' + ((e && e.stack) || e)); process.exit(1) })
