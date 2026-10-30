// src/tracker/rooms/github/channels/graphql/index.ts —— GraphQL 通道目录锚（#1684 阶段 1 建立）
//
// 这一层只认 GraphQL 一种协议：把「要什么」写成查询文本、把回来的 JSON 还原成数据形状。
// 房间根 queries.ts 与 issues.ts 里的 GraphQL 文档/回包读法都归这里；REST 形状一行都不许出现在本目录。
// 它不知道业务规则，也不做读写决策——判断该读还是该写、该重试还是该放弃，都是上游 routing 与 read/write 的事。
//
// 允许引用的层：transport、support。不许引用 routing、read、write、room——channels 在依赖里是最下层之一，
// 反向依赖会让协议层开始懂业务（见 ADR 20261030-github-room-channel-layering 第 2 章第 1 条）。
// 两套协议互不引用：本目录不导入 channels/rest。
//
// 已落位文件（#1685 阶段 1 第二批）：queries.ts（GraphQL 查询文本与片段拼装，从房间根原样搬入，
// 只改了相对导入的层数）。后续本票还会落 read-shapes.ts（把回来的 JSON 还原成数据形状与上限判定）。
// 本文件是目录锚，不是对外导入面——拆层期间对外仍然走原来的平铺路径（旧路径保留转发，到 #1687 才删）。
export {}
