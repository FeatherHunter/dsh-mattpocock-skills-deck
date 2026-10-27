/**
 * src/tracker/rooms/github/checks.ts — GitHub 后端的检查表（GITHUB_CHECKS）。
 *
 * 由 #440 从 index.js 纯结构移出，行为零变化；文件头原写 `backends/github/checks.js`，
 * 是 #1019 目录归位前的旧路径，#1052 按读路径这一片改到今天的真名。
 *
 * 这张表只做一件事：把检查目录（`src/shared/tracker/check-catalog-dirs.ts`）里属于 GitHub
 * 后端的检查项、按目录顺序交给模块对象（`index.ts` 的 `githubModule.checks`）。2026-10-27
 * 之前这里手抄着同样的 4 项；手抄等于给「有哪些检查项」养第二份真源，迟早会漂——#1223 修的
 * 正是这种漂移（目录里多留一项已退役的旧标签检查，运行期用一条过滤把多出来的行藏起来，
 * 测试又抄了同一条过滤，门禁反而替它背书）。改成派生之后，「目录与检查表各说各话」这种状态
 * 在结构上不可能出现。
 * 以后改检查项的人改目录，不改这里：新增或退役一项只动目录那一个地方。预估约 40 行。
 *
 * 为什么这份文件一条日志也不记（#1052 逐份判过）：它只在模块加载时从目录投影出一张只读数组，
 * 没有外部调用、没有时间边界、也没有状态变化——加日志属于「只记结果不记原因」，读了也指不出
 * 下一步该查哪里。真正会失败的判断在 `preflight.ts` 那三项门禁里。
 */
import type { RoomCheckEntry } from '../../contract/backend-module.js'
import { GITHUB_CATALOG } from '../../../shared/tracker/check-catalog-dirs.js'

/**
 * GitHub 后端检查表：目录 GitHub 段的只读投影（4 项：仓库定位 c1、gh CLI c4、gh 登录 c5、
 * API 可达 c6，语义与迁移前一致）。检查页渲染链读的也是同一份目录
 * （`src/refresh/rooms/host/check-chain-evaluation.ts` 的 `catalogFor`），所以行数与排序
 * 不依赖第二张表。
 *
 * 过滤 `scope === 'backend'` 是把范围写明白：这张表只交后端链那几行，不把通用链的技能探测 /
 * 环境项混进来；目录里万一混进通用项，这里也不会把它带上链路。
 *
 * 为什么直接投影而不是手写：#1223 之前它是一份手抄副本，靠运行期一条过滤和目录维持表面一致；
 * 副本的代价是两处都可能撒谎，而且门禁比的也是两份副本，谁也不比谁真。
 */
export const GITHUB_CHECKS: readonly RoomCheckEntry[] = Object.freeze(
  GITHUB_CATALOG.filter((item) => item.scope === 'backend'),
)

// 这里曾有一把 `checks()` 工厂，按需返回目录的一份浅拷贝（「轻量 view，与 catalogFor('github') 后端段一致」）。
// #1027（2026-10-15）把它删掉：全仓零调用——模块对象 `githubModule` 挂的是上面那张表本身，门禁与编排层
// 读的也是 `githubModule.checks`，没有任何一处走这把工厂。留着的代价是同一件事有两个名字（表、拷贝），
// 读代码的人会以为它们有分工，而实际分工并不存在。真需要一份可改的拷贝时，当场写 `[...GITHUB_CHECKS]` 即可。
