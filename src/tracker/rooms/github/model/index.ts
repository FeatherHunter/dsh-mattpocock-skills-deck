// src/tracker/rooms/github/model/index.ts —— model 层目录锚（#1684 阶段 1 建立）
//
// 这一层是房间自己的数据模型与规则：把 GitHub 的原始 JSON 归一成契约形状、错误分类、
// 仓库与人员的静态信息、依赖环检查、名单解析。纯计算，不发起任何外部调用，也不认识读写流程。
//
// 允许引用的层：model（本层内部）。不许引用上面任何一层——model 被 read/write/routing 共用，
// 它一旦反过来引用谁，另外两边就会被间接绑在一起。
//
// 文件搬入安排在 #1686：normalize.ts、errors.ts、repo.ts、cycle-check.ts、roster.ts。
// 本文件现在只占位，让目录在 git 里存在、让分层门禁有据可依；它不是对外导入面——
// 拆层期间对外仍然走原来的平铺路径（旧路径保留转发，到 #1687 才删）。
export {}
