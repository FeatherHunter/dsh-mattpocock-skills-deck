// src/tracker/rooms/github/room/index.ts —— room 层目录锚（#1684 阶段 1 建立）
//
// 这一层是房间对外的门面：backend 契约实现（谁来做读、谁来写、能力自述）、房间登记与健康检查。
// 它是依赖图的最上层，负责把 read 与 write 组装成「一个房间」。
//
// 允许引用的层：read、write、routing、model、support、transport。这一层不被任何层引用，
// 也不许被 read/write 反向引用——否则门面与实现互相牵住，房间就不能独立替换。
//
// 文件搬入安排在 #1687：backend.ts、index.ts（房间自身的入口）、checks.ts。
// 本文件现在只占位，让目录在 git 里存在、让分层门禁有据可依；它不是对外导入面——
// 拆层期间对外仍然走原来的平铺路径（旧路径保留转发，到 #1687 才删）。
export {}
