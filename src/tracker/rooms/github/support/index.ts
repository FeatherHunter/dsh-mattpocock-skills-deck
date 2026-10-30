// src/tracker/rooms/github/support/index.ts —— support 层目录锚（#1684 阶段 1 建立）
//
// 这一层是被各层共用、但不属于任何业务流程的零件：幂等键、读写日志、用量记数、
// 评论分页游标、能力自述登记、初始化错误分类。纯工具，不知道「这次调用是读还是写」。
//
// 允许引用的层：无（只依赖本层与语言标准库）。support 在最底层，任何层都可以引用它，
// 它引用任何一层都会把整张依赖图搅成环。
//
// 文件搬入安排在 #1686：idempotency.ts、read-log.ts、write-log.ts、op-usage.ts、
// comment-paging.ts、capability-register.ts、init-project-error-kinds.ts。
// 本文件现在只占位，让目录在 git 里存在、让分层门禁有据可依；它不是对外导入面——
// 拆层期间对外仍然走原来的平铺路径（旧路径保留转发，到 #1687 才删）。
export {}
