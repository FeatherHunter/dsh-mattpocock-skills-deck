// src/tracker/rooms/github/channels/rest/index.ts —— REST 通道目录锚（#1684 阶段 1 建立）
//
// 这一层只认 REST 一种协议：拼 URL、带分页头、把回来的 JSON 还原成数据形状。
// 今天房间里还没有一个「纯 REST 通道」文件——REST 调用散在 transport 的 execJson 调用点与 read/write 的混合文件里，
// 这是拆层要做的事；目录先建好，搬出的纯 REST 拼装代码落这里。
//
// 允许引用的层：transport、support。不许引用 routing、read、write、room——理由同上，
// channels 不能反向依赖上游（ADR 20261030-github-room-channel-layering 第 2 章第 1 条）。
// 两套协议互不引用：本目录不导入 channels/graphql。
//
// 文件搬入安排在 #1685：从 read/write 的混合文件里抽出纯 REST 拼装（URL、分页头、错误形状）。
// 本文件现在只占位，让目录在 git 里存在、让分层门禁有据可依；它不是对外导入面——
// 拆层期间对外仍然走原来的平铺路径（旧路径保留转发，到 #1687 才删）。
export {}
