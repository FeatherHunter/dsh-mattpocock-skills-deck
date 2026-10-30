// src/tracker/rooms/github/channels/rest/index.ts —— REST 通道目录锚（#1684 阶段 1 建立）
//
// 这一层只认 REST 一种协议：拼 URL、带分页头、把回来的 JSON 还原成数据形状。
// 纯 REST 形状解析从 #1685 起陆续搬进来；URL 拼装、分页头与请求发起仍散在 transport 的 execJson 调用点
// 与 read/write 的混合文件里，搬入排在后续批次。目录先建好，搬出的纯 REST 代码落这里。
//
// 允许引用的层：transport、support。不许引用 routing、read、write、room——理由同上，
// channels 不能反向依赖上游（ADR 20261030-github-room-channel-layering 第 2 章第 1 条）。
// 两套协议互不引用：本目录不导入 channels/graphql。
//
// 已落位文件（#1685 阶段 1 第二批）：
//   list-row-metadata.ts —— REST 列表行里父票/依赖/子票三组字段的纯形状解析（原 rest-list-metadata.ts 原样搬入）；
//   read-shapes.ts       —— 回包的形状还原与完整度判定（数组形状、整页/空页/尾页不满/触 10 页上限、
//                           子票每页 100 至 1000 上限、标签一次 1000 上限、单票端点不表达评论与依赖）。
// 本文件是目录锚，不是对外导入面——拆层期间对外仍然走原来的平铺路径（旧路径保留转发，到 #1687 才删）。
export {}
