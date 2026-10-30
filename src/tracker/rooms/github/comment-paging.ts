// src/tracker/rooms/github/comment-paging.ts —— 已搬进 channels/graphql/comment-paging.ts（#1686 阶段 1 房间分层）。
//
// 评论翻页只拼 GraphQL 查询文本、只认 GraphQL 回包，属于协议形状层，所以搬进 channels/graphql/。
// 这里只留转发，行为一字不变：房内还没搬走的文件与外部导入仍按旧路径导入，等 #1687 收口时才删这一层。
// 新代码请直接写 src/tracker/rooms/github/channels/graphql/comment-paging.ts；tests/verify-room-layering.ts
// 会拦住「新分层代码从旧路径导入」这种写法。
export * from './channels/graphql/comment-paging.js'
