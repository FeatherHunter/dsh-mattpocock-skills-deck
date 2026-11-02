// hooks.ts —— 真机场景共用的一次性启动状态：给实例种一个本地 Markdown 工作区。
//
// 为什么需要钩子：DSH 的工作区来自 home 里的 storages/workspace.json，无头环境点不了原生目录选择器。
// 旧通用脚本靠 make-workspace + seed-workspace 两条命令先把工作区种进批次 home，再启动实例；
// 场景里没有这两步，所以由 launch 的 prepareHome 钩子代劳，用的仍是同一份种子实现
// （scripts/real-machine/lib/workspace-seed.mts）。
//
// 时点为什么必须是 prepareHome：base 的 executeInstance 先 copyProfile 建 home（home 已存在会 conflict，
// 所以 beforeLaunch 碰不到 info.home），随后才启动宿主进程。宿主启动时把工作区表读进内存，
// 之后按内存状态写回 storages/workspace.json——afterLaunch 时宿主已经在跑，写进去的条目会被
// 下一次写回覆盖（阶段 B1 前三次真机运行都只剩 DSH 自己的默认工作区）。prepareHome 恰好是
// 「home 已就绪、宿主还没启动」的唯一窗口，写进去的就是宿主启动时读到的状态。
//
// 钩子失败一律抛 Error 并写清是哪一步、哪里出的问题：base 会把它记成 prerequisite 失败，
// 比让界面断言变成「菜单为空」更容易定位。
//
// 注意这条写入只影响插件认得的运行环境，不经过界面：ui 场景仍在启动后走 DSH 自己的
// workspace/create（幂等解析）与 workspace/rename，用来证明这个目录确实进得了插件界面。

import fs from 'node:fs'
import path from 'node:path'
import type { ScenarioContext, ScenarioHooks, ScenarioLaunchHookInfo } from 'dsh-featherhunter-plugin-base/real-machine-verification'
import { seedWorkspaceRegistry } from '../scripts/real-machine/lib/workspace-seed.mts'

/** 界面里显示的工作区名字；场景断言也用它，改这里等于同时改种子与断言。 */
export const SEEDED_WORKSPACE_TITLE = '验证工作区'

/** 工作区目录建在实例目录下（与 home 并列），这样实例被清理时它跟着走。 */
export const SEEDED_WORKSPACE_DIRNAME = 'workspace'

/** 场景里由实例目录推出工作区路径：hooks 与断言共用这一条规则，不各自拼字符串。 */
export function seededWorkspacePath(instanceDir: string): string {
  return path.join(instanceDir, SEEDED_WORKSPACE_DIRNAME)
}

/** .scratch 下的 effort 目录名；地图文件放它下面。 */
const EFFORT_DIR = 'ui-scenario-workspace'

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 写最小可识别的本地 Markdown 工作区内容。
 * 「可识别」指插件读得出这是 markdown 后端：docs/agents/workspace.yaml 声明后端，
 * .scratch/<effort>/map.md 带 md-v1 文件头与五段正文。不引用仓库自己的渲染器：
 * 渲染器要经 ts-hook 才能加载，而钩子应当只依赖文件系统的几行写入，坏了也看得懂。
 */
function writeWorkspaceFixture(workspace: string): void {
  const bindingFile = path.join(workspace, 'docs', 'agents', 'workspace.yaml')
  fs.mkdirSync(path.dirname(bindingFile), { recursive: true })
  const pickedAt = Date.now()
  fs.writeFileSync(
    bindingFile,
    [
      '# 本文件的注释由插件生成；你自己加的注释会在下次写入时被替换。',
      '# 这份文件随仓库走：提交之后就团队共享，改动会影响所有人。',
      'version: 2',
      '# 这条工作区用哪个后端',
      'backendId: markdown',
      '# 这次选择发生的时间（毫秒）',
      'pickedAt: ' + String(pickedAt),
      '# 这条选择是谁做的：user=人在面板里亲手选的；migrated=从老版本机记忆搬来的；detected=插件按声明文件或自动识别生成的',
      'source: user',
      '# 域文档布局：single=单上下文（各部分共用一套用语，根目录一份 GLOSSARY.md）；',
      '# multi=多上下文（各有各的用语，子项目各一份 GLOSSARY.md，根目录一份 GLOSSARY-MAP.md指过去）',
      'layout: multi',
      '',
    ].join('\n'),
    'utf8',
  )

  const mapFile = path.join(workspace, '.scratch', EFFORT_DIR, 'map.md')
  fs.mkdirSync(path.dirname(mapFile), { recursive: true })
  const createdAt = new Date().toISOString()
  fs.writeFileSync(
    mapFile,
    [
      '<!-- DSH-FORMAT: md-v1 -->',
      '<!-- DSH-TITLE: ' + SEEDED_WORKSPACE_TITLE + '地图 -->',
      '<!-- DSH-STATUS: ready-for-agent -->',
      '<!-- DSH-IDEMPOTENCY-KEY: verify-ui-phase-b1-map -->',
      '<!-- DSH-CREATED: ' + createdAt + ' -->',
      '<!-- DSH-LABELS: wayfinder:map -->',
      '',
      '## Destination',
      '',
      '给真机界面场景提供一个插件认得出的本地 Markdown 工作区：.scratch 下有地图，docs/agents 下有后端绑定。',
      '',
      '## Notes',
      '',
      '这个工作区由 verify/hooks.ts 在场景启动时生成，不是仓库本身，验证过程改它不会碰到仓库里的文件。',
      '',
      '## Decisions so far',
      '',
      '## Not yet specified',
      '',
      '## Out of scope',
      '',
    ].join('\n'),
    'utf8',
  )
}

/** 建工作区目录与内容；只在实例目录下写，不碰 home。 */
function prepareWorkspace(info: ScenarioLaunchHookInfo): string {
  const workspace = seededWorkspacePath(info.dir)
  try {
    fs.mkdirSync(workspace, { recursive: true })
    writeWorkspaceFixture(workspace)
  } catch (error) {
    throw new Error('准备验证工作区失败（目录 ' + workspace + '）：' + messageOf(error))
  }
  return workspace
}

/**
 * 把工作区登记进 home 的注册表，作为宿主启动时读到的初始状态。
 *
 * 注册表的写入受 scripts/real-machine/lib/paths.mts 的「只写验证工作根」约束，
 * 而场景实例目录由 base 按 --work-root 算出来，未必落在默认工作根之下；
 * 因此这里临时把 DSH_VERIFY_WORK_ROOT 指到实例目录，写完整理，不污染后续步骤。
 */
function seedRegistry(info: ScenarioLaunchHookInfo, workspace: string): void {
  const previous = process.env.DSH_VERIFY_WORK_ROOT
  process.env.DSH_VERIFY_WORK_ROOT = info.dir
  try {
    seedWorkspaceRegistry(info.home, [{ path: workspace, title: SEEDED_WORKSPACE_TITLE }], {
      defaultPath: workspace,
    })
  } catch (error) {
    throw new Error('写入工作区注册表失败（home ' + info.home + '）：' + messageOf(error))
  } finally {
    if (previous === undefined) {
      delete process.env.DSH_VERIFY_WORK_ROOT
    } else {
      process.env.DSH_VERIFY_WORK_ROOT = previous
    }
  }
}

export const hooks: ScenarioHooks<ScenarioContext> = {
  prepareHome(_context, info) {
    const workspace = prepareWorkspace(info)
    seedRegistry(info, workspace)
  },
}

export default hooks
