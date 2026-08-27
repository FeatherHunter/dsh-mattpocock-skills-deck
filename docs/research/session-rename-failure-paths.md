# 研究：#211 占位改名失效路径全景与存量成因归类

## 结论摘要

「双通道」实为单通道残废。host watcher（通道 A）的三个 handler 在 e98f636（标注为 #195 修复的重构提交，src/host/index.js 变更 -590 行）中被整块删除且无替身；前端兜底轮询（通道 B）只消费面板侧白名单事件队列，并不扫描会话文本。对主流程——AI 在新会话里自行运行 gh issue create 建号——两个通道都收不到任何信号，120 秒后永久放弃改名。

## 失效路径清单

- F1【回归 · 最高频】通道 A handler 全体消失：当前 src/host/index.js 的 harness.handle 注册表（20 个 op）中不存在 registerNewSessionWatcher / cancelNewSessionWatcher / awaitCreatedIssue；git pickaxe 显示仅 e77111c（添加）与 e98f636（移除，diff 中含 newSessionWatchers Map / cleanWatcher / 三 handler 的删除行）动过它。前端 api.js:48/70/85/109 的 host.call 全部落到未知 endpoint，Promise reject 被 .catch(function(){}) 静默吞掉——表面无异常，实际全灭。
- F2【设计缺口】通道 B 不扫文本：startNewSessionRenamePoll（src/client/kernel/api.js:75-111）每秒调 wf.issuePathPoll，而 pendingIssuePathEvents 的生产者只有三处——runGh 白名单（index.js:343/359/369，仅面板自身执行的 gh issue create/edit）、wf.claim（1834）、wf.issuePathPush（仅 inject() 提及识别会推，328）。#211 决议时序图承诺的「Client extractIssueRefs 扫描会话文本」这条腿在实现里不存在（extractIssueRefs 现仅用于注入文本的 breadcrumb 记录）。
- F3【易失】pendingNewSessions 是模块级内存 Map（api.js:42）：面板关闭/热重载/GUI 刷新即清空，无持久化；重开面板不会对仍在占位名的会话补启动轮询。
- F4【放弃无感】120 次 ×1s 到顶后永久删除跟踪项并 flash toast.newSessionKeepPlaceholder（api.js:81-87）——toast 只落在目标会话的 store 上，用户此刻多半不在看那个会话；此后没有任何后台重试或打开面板时的补偿扫描。
- F5【守卫失效】userRenamed 初始化为 false 后全仓无一处置 true（grep 仅两处出现）：『5 秒内用户手动改名则跳过』（api.js:55）是不可达的死代码；同时也不存在任何手动改名检测机制——与回填票的手改保护诉求直接相关。
- F6【静默】tryAutoRename 内 face.rename 失败走空 catch（api.js:72），条目保留下轮重试尚可；face 缺 rename 函数时每 tick 空转到超时（63-66 早退但不停止调度），浪费但无害。
- F7【边角】isNewPlaceholderTitle 要求精确匹配四种占位串（router.js:196）；创建后未匹配则整条链路不启动（低风险：占位串由同一函数生成）。

## 存量占位成因归类

- 类别一（预计大头）：AI 在会话内自行建号的主流程——F1+F2 叠加，事件从不产生，必然 120s 超时 → 永久 [New]。凡用户确实推进了需求的会话几乎都属于此类。
- 类别二：建号成功发生在面板白名单外、且期间面板发生过重载/刷新——F3 使本可能成功的轮询提前夭折。
- 类别三：从未走到建号的会话（闲聊/草稿/中途放弃）——占位名是当初设计的天然死角，机制上永远不会获得编号名。
三类相加即用户看到的成片 [New] 新建需求。

## 对下游两票的输入

- 给契约票 #260：命名规则不能假设『拿到编号』一定发生；需要为永不编号会话定义稳定命名档；手动改名检测（F5）必须成为锁定规则的前置原语。
- 给回填票 #261：F4 表明回填必须自带『打开面板时的补偿扫描』而非依赖单次时窗；F5 死代码应顺带修复，否则回填会践踏用户手改名。