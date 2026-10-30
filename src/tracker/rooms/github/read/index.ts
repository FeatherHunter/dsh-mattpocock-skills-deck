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
// 文件搬入安排在 #1686，分三批完成：page.ts、counts.ts、sub-issues.ts、deps-read.ts、maps.ts、
// parent-repair.ts 在第 3 批迁入；preflight.ts、pulls.ts、repo-permissions.ts、issues-rest-list.ts
// 与标签读侧（listLabels，落成 read/labels.ts）在第 4 批迁入。到第 4 批收尾时，本层该有的文件
// 已经全部落位；旧的平铺路径（src/tracker/rooms/github/<同名>.ts）现在都只是指向这里的纯转发，
// 等 #1687 把写侧与房间入口也搬完时统一删掉。
// 标签读侧是从 label-colors-ops.ts 拆出来的：那个文件里读侧与写侧混在一起，读侧搬到这里后，
// 旧文件只剩写侧的 setLabelColors，并继续转发本层导出的读侧名字，行为零变化。
//
// 本文件只占位，让目录在 git 里存在、让分层门禁有据可依；它不是对外导入面——拆层期间对外仍然走
// 原来的平铺路径（旧路径保留转发，到 #1687 才删）。
export {}
