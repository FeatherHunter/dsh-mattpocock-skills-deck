/**
 * src/tracker/rooms/github/room/checks.ts — GitHub 后端的检查表（GITHUB_CHECKS）。
 *
 * #1687 阶段 1：从房间根迁入 room/（它是房间门面的一部分）；旧路径 checks.ts 保留纯转发，行为零变化。
 *
 * 这张表只做一件事：把检查目录（`src/shared/tracker/check-catalog-dirs.ts`）里属于 GitHub 后端
 * 的检查项、按目录顺序交给模块对象（`index.ts` 的 `githubModule.checks`）。2026-10-27 之前这里
 * 手抄着同样的 4 项，等于给「有哪些检查项」养第二份真源；#1223 删掉目录里多留的一项死项后，
 * 这里改成直接派生，以后新增或退役检查项只改目录一处。
 *
 * 为什么这份文件一条日志也不记（#1052 逐份判过）：它只在模块加载时从目录投影出一张只读数组，
 * 没有外部调用、没有时间边界、也没有状态变化——加日志属于「只记结果不记原因」，读了也指不出
 * 下一步该查哪里。真正会失败的判断在 `preflight.ts` 那三项门禁里。
 */
import type { RoomCheckEntry } from '../../../contract/backend-module.js'
import { backendItemsOf } from '../../../../shared/tracker/check-catalog-dirs.js'

/**
 * GitHub 后端检查表：目录 GitHub 后端段的只读投影（4 项：仓库定位 c1、gh CLI c4、gh 登录 c5、
 * API 可达 c6，语义与迁移前一致）。链快照渲染读的也是同一份目录
 * （`src/refresh/rooms/host/check-chain-evaluation.ts` 的 `catalogFor`），行数与顺序不依赖第二张表。
 */
export const GITHUB_CHECKS: readonly RoomCheckEntry[] = Object.freeze(backendItemsOf('github'))

// 这里曾有一把 `checks()` 工厂（#1027，2026-10-15 删掉）：全仓零调用，模块对象挂的就是上面这张表；
// 留着会让同一件事有两个名字。真需要一份可改的拷贝时，当场写 `[...GITHUB_CHECKS]` 即可。
