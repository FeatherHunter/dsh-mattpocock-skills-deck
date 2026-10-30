// src/tracker/rooms/github/routing/index.ts —— 路由目录锚（#1684 阶段 1 建立）
//
// 这一层决定「这件事该走哪条路、失败了算什么」：把房间对外的一次请求拆成读或写、
// 选 GraphQL 还是 REST、判定失败原因与回退理由。它自己不发请求、不拼查询文本。
//
// 允许引用的层：channels/graphql、channels/rest、model、support、transport。
// 不许引用 read、write、room——路由是 read 与 write 的共同下游，反过来引用会让「谁调谁」成环。
//
// 文件搬入安排在 #1685：issues.ts（读写入口的分派与形状归一）、fallback-reason.ts（失败原因归类）。
// 本文件现在只占位，让目录在 git 里存在、让分层门禁有据可依；它不是对外导入面——
// 拆层期间对外仍然走原来的平铺路径（旧路径保留转发，到 #1687 才删）。
export {}
