// src/tracker/rooms/github/read/index.ts —— read 层目录锚（#1684 阶段 1 建立）
//
// 这一层负责「从 GitHub 读一次事实」：分页、计数、子 issue、依赖、PR、地图、权限、预检、
// 父 issue 修复，以及标签颜色的读侧。它只读不写，也不自己起 gh 进程——gh 调用一律走 transport。
//
// 允许引用的层：read（本层）、routing、channels/graphql、channels/rest、model、support、transport。
// 取请求文档与回包形状本来就是「读一次事实」的一部分，所以这一层直接引用 channels 的两份只读文件；
// 渠道选择与降级顺序仍然只由 routing 决定，channels 不许反过来引用本层。
// 不许引用 write、room；read 与 write 同层互不引用，这样任何一面的改动都不会把另一面拖下水。
//
// 文件搬入安排在 #1686：preflight.ts、counts.ts、sub-issues.ts、deps-read.ts、pulls.ts、maps.ts、
// parent-repair.ts、repo-permissions.ts、page.ts 与 issues-rest-list.ts，以及 label-colors-ops.ts
// 的读侧（listLabels，落成 read/labels.ts）。page、counts、sub-issues、deps-read、maps、
// parent-repair 已在第 3 批迁入；本文件只占位，让目录在 git 里存在、让分层门禁有据可依；
// 它不是对外导入面——拆层期间对外仍然走原来的平铺路径（旧路径保留转发，到 #1687 才删）。
export {}
