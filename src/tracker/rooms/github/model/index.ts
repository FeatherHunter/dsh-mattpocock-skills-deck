// src/tracker/rooms/github/model/index.ts —— model 层目录锚（#1684 阶段 1 建立）
//
// 这一层是房间自己的数据模型与规则：把 GitHub 的原始 JSON 归一成契约形状、
// 仓库与人员的静态信息、依赖环检查、名单解析。归一与判据都是纯计算；
// 仓库身份要经客户端问远端，所以这一层可以引用 transport，但自己不直接起进程。
//
// 允许引用的层：model（本层内部）、transport（仓库身份与远端探测经客户端出手）。
// 不许引用上面任何一层——model 被 read/write/routing 共用，
// 它一旦反过来引用谁，另外两边就会被间接绑在一起。
//
// 文件搬入安排在 #1686：normalize.ts、repo.ts、cycle-check.ts、roster.ts 已迁入。
// 错误分类（errors.ts）按票面「读写共用支撑」的定位落进 support/，不在本层，理由见 ADR 第 6 节。
// 拆层期间对外仍然走原来的平铺路径（旧路径保留纯转发，到 #1687 才删）。
export {}
