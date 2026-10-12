# 日志导读（#1016）

这一页只教一件事：怎么读已经落盘的日志，说出一次调用走到哪、停在哪、为什么。事件与字段的现行清单不在这里抄——那两份基准文档才是准的，本页只指路。

## 日志在哪

- **落点**：宿主进程当前目录下缓存目录里的 `logs/` 子目录（本仓就是 `.dsh-mattskillsdeck-cache/logs/`），每个自然天一个文件 `YYYY-MM-DD.log`。每行一条 JSON，四个键：`ts`（epoch 毫秒）、`level`（error / warn / info / debug）、`event`、`fields`。
- **开关**：缓存目录根下的 `log-switch.json`，和 `logs/` 平级、不在 `logs/` 里面（本仓就是 `.dsh-mattskillsdeck-cache/log-switch.json`），内容 `{"enabled":true}` 才记「按需」那一批。开关关着、或这个文件还没建出来时，只有 error、warn 与「常驻」那一批会落盘。
- **三档的含义**（常驻 / 按需 / 自监控）见 `docs/design/335-logging-contract.md` 第 3 章；**每一档各有多少条、每条允许什么字段，以 `research/489-appendix.md` 第 1 章为准**，本页不抄条数。

## 读之前先翻两处

- `research/489-appendix.md` 第 1 章：逐事件的允许字段，以及截断与散列规则。日志里出现的 `cwdHash`、`dirHash`、`errorHash`、`titleHash` 这类值就是这一章规定的「只记散列、不记原文」；同一份输入散列值相同，所以可以按散列值分组比对。
- `docs/design/335-logging-contract.md`：第 3 章是埋点实施清单（哪些事件常驻、哪些按需），§2.1 是落盘位置与文件命名，§2.3 是错误与告警直通刷盘。

## 怎么照着读一趟

按一次调用自己的顺序找行：**起点输入摘要 → 分支原因 → 外部调用结果加耗时 → 状态变化 → 终点结论**。同一趟的行靠 `ts` 相邻与 `fields` 里同一个键串起来（工作区短指纹、方法名、票号）。

真实样例（2026-10-13 的日志，机器路径已删去；时间戳、进程号、散列每次运行都不同，看结构就行）：

```
{"ts":1791838660038,"level":"info","event":"host.start","fields":{"pid":52228,"startedAt":"2026-10-12T20:57:40.038Z","dir":"<缓存目录>"}}
{"ts":1791838660060,"level":"warn","event":"gh.resolve.fail","fields":{"hasDSH_GH_PATH":false,"errorHash":"664c6d90"}}
{"ts":1791838660060,"level":"warn","event":"host.call.fail","fields":{"method":"wf.initPublish","kind":"publish","errorHash":"664c6d90"}}
{"ts":1791838660084,"level":"info","event":"gh.exec","fields":{"argv0":"gh","cwdHash":"e83a4721","latencyMs":0,"kind":"auth","exitCode":1}}
{"ts":1791838661047,"level":"info","event":"host.call","fields":{"method":"wf.initPublish","latencyMs":287,"ok":true,"kind":"publish"}}
```

读法：`host.start` 是这一趟的起点（哪个进程、什么时候起、缓存目录在哪）；`gh.resolve.fail` 与 `gh.exec` 是外部命令那一段，`hasDSH_GH_PATH:false`、`exitCode:1` 说明 gh 没找到、命令非零退出；`host.call.fail` 是这一次的终点，错误原文按规则只记散列，所以拿 `errorHash` 去比对，才能分清是「同一类失败反复出现」还是「新冒出来的错」。末尾的 `host.call` 是同一个方法后来走通的那一次——`ok:true` 加 `latencyMs` 就是「这次成了，用了 287 毫秒」。同一趟的行靠 `ts` 相邻、`method` 同名串起来。

## 一句提醒：`log.persist.fail` 不一定是真失败

日志里常见这种行：

```
{"ts":1791837291450,"level":"warn","event":"log.persist.fail","fields":{"op":"readBack","reason":"read-fail","dirHash":"00001505"}}
```

它多数时候不代表落盘坏了：开关文件 `log-switch.json` 还没建（等于「开关关着」）时，日志包把「读不到开关文件」也记成一次读回失败，于是每次启动都会多出一条。判断真假看后面的行有没有照常写进来；`op:"persistSwitch"` 或 `reason:"write-fail"` 才是真写不进去。

## 这一页不做什么

不抄条数、不抄字段表（上面两处基准文档才是准的）；`dsh-log` 本体是外部 npm 包，不在本仓范围。日志体系的总纲票是 #502，设计契约是 #335。
