// src/tracker/rooms/github/write/index.ts —— write 层目录锚（#1684 阶段 1 建立）
//
// 这一层负责「把一次改动写进 GitHub」：标签、issue 正文与状态、评论、阻塞关系、甘特图边、
// 关闭理由、项目初始化，以及标签颜色的写侧。它不自己起 gh 进程——写请求同样经 transport 出手，
// 写额度与排队档位由 transport 按命令形状判定，这一层不许绕过去猜。
//
// 允许引用的层：routing、model、support、transport。不许引用 read、room、channels。
// read 与 write 同层互不引用。
//
// 文件搬入安排在 #1687：labels.ts、issues-write.ts、comments.ts、blocked-by-write.ts、graph.ts、
// close-reason.ts、init-project.ts，以及 label-colors-ops.ts 的写侧（setLabelColors）。
// 本文件现在只占位，让目录在 git 里存在、让分层门禁有据可依；它不是对外导入面——
// 拆层期间对外仍然走原来的平铺路径（旧路径保留转发，到 #1687 才删）。
export {}
