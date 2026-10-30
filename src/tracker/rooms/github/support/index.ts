// src/tracker/rooms/github/support/index.ts —— support 层目录锚（#1684 阶段 1 建立）
//
// 这一层是被各层共用、但不属于任何业务流程的零件：错误分类、读写日志、用量记数、
// 能力自述登记、初始化错误分类。纯工具，不知道「这次调用是读还是写」。
//
// 允许引用的层：无（只依赖本层、房间外的契约与内核）。support 在最底层，任何层都可以引用它，
// 它引用房间内任何一层都会把整张依赖图搅成环。
//
// #1686 搬入：errors.ts、read-log.ts、write-log.ts、op-usage.ts、capability-register.ts、
// init-project-error-kinds.ts（本批已落位）。原先也打算放这一层的幂等键 idempotency.ts 与
// 评论分页 comment-paging.ts 要调用 gh 客户端（属于 transport），放进来会让 support 反向依赖
// 传输层；按「support 不依赖房间内任何一层」的边界，它们改放 routing/ 与 channels/graphql/，
// 理由见 ADR 第 6 节变更记录。
//
// 本文件只占位，让目录在 git 里存在、让分层门禁有据可依；它不是对外导入面——
// 拆层期间对外仍然走原来的平铺路径（旧路径保留转发，到 #1687 才删）。
export {}
