// src/tracker/rooms/github/channels/graphql/index.ts —— GraphQL 通道目录锚（#1684 阶段 1 建立）
//
// 这一层只认 GraphQL 一种协议：把「要什么」写成查询文本、把回来的 JSON 还原成数据形状。
// 它不知道业务规则，也不做读写决策——判断该读还是该写、该重试还是该放弃，都是上游 routing 与 read/write 的事。
//
// 允许引用的层：transport、support。不许引用 routing、read、write、room——channels 在依赖里是最下层之一，
// 反向依赖会让协议层开始懂业务（见 ADR 20261030-github-room-channel-layering 第 2 章第 1 条）。
// 两套协议互不引用：本目录不导入 channels/rest。
//
// 文件搬入安排在 #1685：queries.ts（GraphQL 查询文本拼装）。
// 本文件现在只占位，让目录在 git 里存在、让分层门禁有据可依；它不是对外导入面——
// 拆层期间对外仍然走原来的平铺路径（旧路径保留转发，到 #1687 才删）。
export {}
