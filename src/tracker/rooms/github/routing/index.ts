// src/tracker/rooms/github/routing/index.ts —— 路由目录锚（#1684 阶段 1 建立）
//
// 这一层决定「这件事该走哪条路、失败了算什么」：把房间对外的一次请求拆成读或写、
// 选 GraphQL 还是 REST、判定失败原因与回退理由。它自己不发请求、不拼查询文本。
//
// 允许引用的层：channels/graphql、channels/rest、model、support、transport。
// 不许引用 read、write、room——路由是 read 与 write 的共同下游，反过来引用会让「谁调谁」成环。
//
// 已落位文件（#1685 阶段 1 第二批）：
//   read-result.ts —— 读结果的来源与按字段组完整度组装：从操作百科派生每条读操作的渠道计划，
//                     用 beginRead() 记取数起点，用 buildReadProvenance() 组装并校验 ReadProvenance。
// 还没搬进来的：issues.ts 的读写分派与形状归一、fallback-reason.ts 的失败原因归类。
// 它们改到 #1686 与 read/ 那批一起搬：issues.ts 有 460 行，要按读写拆开才不撞文件粒度门禁，
// 拆的时候正好把 REST 兜底判定与路由顺序一起收到本目录。
// 本文件是目录锚，不是对外导入面——拆层期间对外仍然走原来的平铺路径（旧路径保留转发，到 #1687 才删）。
export {}
