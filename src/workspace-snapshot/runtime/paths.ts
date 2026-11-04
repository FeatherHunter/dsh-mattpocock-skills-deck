// runtime/paths.ts —— 工作区根的归一与默认库路径。
//
// 工作区根规则来自 #1841 的 ADR：从给定目录向上最多 64 层找 docs/agents/workspace.yaml，
// 第一个命中的目录就是根；一路到顶都没有，就把给定目录自己当根。宿主侧的实现是
// src/host/workspaceKey.ts:224-267 的 resolveWorkspaceRoot（异步、走文件服务）。
//
// 为什么这里重写一份同步版本而不是 import 宿主：快照层不得依赖宿主层（否则 refresh 与
// 界面都拖不进来），而 shared/ 的约定是每棵树自包含、跨树相对引用会破坏构建产物。
// 规则只有「标记文件在哪」一件事，重复的代价小于反向依赖的代价；两处要改时必须一起改。
import { dirname, existsSync, join, resolve } from './node-builtins.js'
import type { SnapshotBackend } from '../model/types.js'

/** 工作区标记文件。与 src/shared/config-store/src/workspace.ts:29 的常量同一含义。 */
export const WORKSPACE_MARKER_REL = 'docs/agents/workspace.yaml'

/** 向上找的最大层数。64 层足够覆盖深目录，也能防止符号链接成环时死循环。 */
export const WORKSPACE_ROOT_MAX_DEPTH = 64

/** 快照缓存目录名（工作区根下）。 */
export const SNAPSHOT_CACHE_DIR = '.dsh-mattskillsdeck-cache'

/**
 * 把任意目录归一到工作区根。传相对路径时按进程当前目录展开；不解析符号链接——
 * 同一路径字符串在不同机器上是否指向同一处，由使用者保证。
 */
export function resolveSnapshotWorkspaceRoot(startDir: string): string {
  let current = resolve(startDir)
  for (let depth = 0; depth < WORKSPACE_ROOT_MAX_DEPTH; depth += 1) {
    if (existsSync(join(current, WORKSPACE_MARKER_REL))) return current
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return resolve(startDir)
}

/** 默认库路径：<工作区根>/.dsh-mattskillsdeck-cache/snapshot/<backend>.sqlite。 */
export function defaultSnapshotDbPath(workspaceRoot: string, backend: SnapshotBackend): string {
  return join(resolve(workspaceRoot), SNAPSHOT_CACHE_DIR, 'snapshot', `${backend}.sqlite`)
}
