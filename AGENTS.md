# Agent Instructions

This file gives an agent working in this repo the context it needs to operate well.

## Agent skills

### Issue tracker

Issues live as GitHub issues, driven through the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical triage roles (`needs-triage` / `needs-info` / `ready-for-agent` / `ready-for-human` / `wontfix`) plus five wayfinder labels (`wayfinder:map` / `research` / `prototype` / `grilling` / `task`). The **mandatory label set** is `bug` / `needs-triage` / `wayfinder:grilling`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout — root `CONTEXT.md` plus `docs/adr/`. See `docs/agents/domain.md`.

### 提问方式

需要人拿主意时，把问题直接写在对话正文里，不用弹窗式提问工具——弹窗会挡住正文解释，人看不到完整的来龙去脉。

### Human-first wording

执行任务中写下的所有文字——对话回复、issue 标题与正文、markdown 文档、代码注释、任何文件——都以「人类第一次阅读就能准确理解」为第一标准：只使用 CONTEXT.md 词典或此前交流中已确立含义的词语；确需表达新概念时，写成完整、平实的描述，而不是造一个需要另行解释的简称或比喻。先满足人的可读性，再谈机器的便利——AI 能读懂平实的完整句，却会替读者造出只有当次会话才明白的速记。

**发出去之前，都停一秒问自己：**
1. 没看过前文的人，能直接看懂这句话在说什么吗？
2. 有没有用了只有我们这次对话才懂的叫法？有就改成大白话。
3. 新东西是不是用一整句话说清楚了，而不是只扔一个词让别人去猜？

### 提交信息规范

所有 `git commit` 信息必须用中文，用通顺的完整句子说清“这次改了什么、为什么改”。标题至少 10 个字，不要只写 `fix` / `update`。详见 `docs/agents/commit-convention.md`。

### 日志埋点纪律（先读总纲票 #502：日志体系采用总纲与查阅入口）

以后你在这仓库加新代码，只要动了下面五种东西之一，就必须同步加一行写进本地诊断日志的记录（下面叫日志点），让以后查问题的人能看到这条路走过。五种东西是：跨过进程或模块边界的调用（例如客户端打给宿主、宿主调外部程序）、新增的宿主接口方法（仓库里叫电话的那种）、面板打开与刷新读数据展示的链路、新增的内存或磁盘缓存（命中、未命中、过期）、新增的定时触发的活（轮询、延迟扫、防抖刷盘）。

1. 加了上面五种东西就加日志点，记多细按 `docs/design/335-logging-contract.md` 第 3 章判定：调用次数少、跨边界的记成常驻（一直落盘）；调用很频繁的记成按需（只在用户打开调试开关时才记，还要加采样或节流）。拿不准该常驻还是按需时，去问总指挥，不要自己默认一种。
2. 日志里只记 `research/489-appendix.md` 白名单里允许的字段的子集：令牌和登录态的原文永远不写进日志，只记有没有、是哪一类；工作区原始路径和仓库地址不记原文，只记算出来的短指纹（散列）；标题和错误文本太长只留前一段并标注已截断。调用很频繁的日志，在调用记日志的函数之前，先在外层判断调试开关开没开，关着就不组装字符串；画界面、拼展示的函数里，不许把整个对象转成文本记进日志。
3. 动手改代码之前，先把 `tests/verify-log-*` 里相关的自动检查跑通；如果常驻名单（P0，始终落盘的 30 条）或按需名单（P1，只在调试开关打开时记的 22 条）增删了事件，就同步改 `research/489-appendix.md` 里第 1 章的对照表，让表和代码对得上。条数会随票变化，现行数字以该附录第 1 章为准（本条 2026-09-12 按 #606 落定后的数字更新）。
4. 上面三条没做到，自动检查会变红（字段检查、开关检查、计数检查，也就是 `fields`、`guards`、`count`）。变红了先把缺的日志点补上，再谈功能好不好用。