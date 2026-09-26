// src/host/platform/deckToolsRow.js —— agent 层的行模块（#741）
//
// 这一行跑在 agent 层（官方教程的正规路：名字、注入工具服务、应用函数），
// 与宿主插件那一行互不干扰。宿主插件里的兼容钩子留着（别的产品可能是同一容器）。
// 住在平台区的原因与装配点一样：行模块要读七个工具文件里的定义，
// 宿主层的文件之间不许互相引用，平台区是被排除的位置。
//
// 七个工具的执行在代执行通道接通前用诚实占位（只回“还没接好”并指去面板），
// 另加一个探针工具回服务清单——通道设计就靠这份清单定，两个都是通道接通即退役。
import { defineTool } from '@deepseek-ai/dsh-tools'
import { definition as deckContextDef } from '../tools/deckContext.js'
import { definition as deckIssueGetDef } from '../tools/deckIssueGet.js'
import { definition as deckMapSnapshotDef } from '../tools/deckMapSnapshot.js'
import { definition as deckIssueCreateDef } from '../tools/deckIssueCreate.js'
import { definition as deckMapPlanCreateDef } from '../tools/deckMapPlanCreate.js'
import { definition as deckMapLinkDef } from '../tools/deckMapLink.js'
import { definition as deckIssuePatchDef } from '../tools/deckIssuePatch.js'
import { buildAgentToolOptions, makePendingExecute, probeDefinition, probeServices } from '../../shared/deck-tools/agent-register.js'

export const name = 'dsh-mattpocock-skills-deck-tools'
export const inject = ['tools']

const SEVEN = [deckContextDef, deckIssueGetDef, deckMapSnapshotDef, deckIssueCreateDef, deckMapPlanCreateDef, deckMapLinkDef, deckIssuePatchDef]

export function apply(ctx) {
  if (!ctx || !ctx.tools || typeof ctx.tools.register !== 'function') {
    throw new Error('[deckToolsRow] 工具服务不在，行起不来（注入声明了 tools，框架本应保证就绪）。')
  }
  for (const d of SEVEN) {
    const opt = buildAgentToolOptions(d)
    if (!opt) continue
    try {
      ctx.tools.register(defineTool({
        name: opt.name,
        description: opt.description,
        parameters: opt.parameters,
        output: opt.output,
        execute: makePendingExecute(d.name),
      }))
    } catch (e) { continue }
  }
  ctx.tools.register(defineTool({
    name: probeDefinition.name,
    description: probeDefinition.description,
    parameters: {},
    output: {
      schema: { type: 'string' },
      render: function (args, value) { return [{ type: 'text', text: value }] },
    },
    execute: async function () { return JSON.stringify(probeServices(ctx)) },
  }))
}
