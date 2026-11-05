/**
 * src/tracker/rooms/gitlab/repo.ts —— 旧路径的纯转发文件（仓库身份这一份）。
 *
 * 为什么还留在这里（#1918）：房外有测试与脚本按这条旧路径 import 这份文件的公开名字
 * （例如 tests/tracker-contract/sections/room-gitlab-extras.ts 从这里取 parseGitlabOrigin），
 * 而这次结构改造的约束是不改房外代码。ADR 20261105 决定三给这类旧名字留 9 个纯转发文件，
 * repo.ts 是其中之一：文件里只许 re-export，不加逻辑、不包一层、不设默认值、不做副作用。
 *
 * 实现在 repo/identity.ts（#1918 搬进去）：仓库坐标解析、三层兜底与网页端 origin 学习的唯一实现
 * 在那里。将来房外读者改完 import 路径之后，删掉本文件只需要删下面这几行导出，不需要把逻辑搬回来。
 *
 * 不能改的约定：下面导出的名字与搬走之前那份文件的公开名字逐个对应（parseGitlabRepo /
 * parseGitlabOrigin / learnGitlabOrigin / gitlabOriginOf / getRepoKey 与 RepoKey 类型），
 * default export 仍是 { parseGitlabRepo, getRepoKey } 这个形状 —— 房外有读者按默认导入取这两个函数，
 * 改形状就是改行为。往本文件加任何一行逻辑都会让它变成第二份会漂的拷贝。
 */

export {
  parseGitlabRepo,
  parseGitlabOrigin,
  learnGitlabOrigin,
  gitlabOriginOf,
  getRepoKey,
} from './repo/identity.js'
export type { RepoKey } from './repo/identity.js'
export { default } from './repo/identity.js'
