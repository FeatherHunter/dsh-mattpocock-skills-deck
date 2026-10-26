# 1010 地图边界笔记（客户端快照等待与落地）

这是快照，用前复核。采集时刻：2026-10-10 20:00（Asia/Shanghai）。下面只写本会话亲手核过的事实与还没定的问题，不替讨论下结论。

## 已证实的事实（每条带证据）

- 正常回包会走两遍安装（F1，已修）。证据：`src/client/kernel/probe-snapshot.js` 旧第 183 行迟到处理器无条件挂载，正常路多经一层 `.finally`，微任务先跑迟到处理器（`mine.done=false`）。修法：超时那一支立 `mine.gaveUp=true`，迟到处理器进门先看它（`src/client/kernel/probe-select.js` 两处），提交 `24dab11c`。
- 旧快照晚回来会盖掉新数据（F2，已修）。证据：旧 `_installLateSnapshot` 只看请求序号，不比时间；仓库早有最新者胜契约（`src/client/kernel/store-snapshot.js:177`，`generatedMs`，#301）；探针增量路径直接写 `st.snapshot` 且不登记序号（`src/client/kernel/probe-auto.js:69-91`）。修法：装前按缺值规则比 `generatedMs`，提交 `24dab11c`。
- 三处生产者都会盖时间戳。证据：`src/host/snapshotEnvelope.js:21`（`generatedMs: Date.now()`）、`src/host/snapshotBuild.js:210`、`src/host/refresh/patch.js:317`；304 回包也带 `generatedMs: now`（`src/host/sessionSnapshot.js:115`），304 没有 `maps`，天然走只补选择那一支。
- 缺值规则已写死。两边正数比大小，来者大才装；只有一边有值，有值者胜；两边都没有退回序号判，不因缺字段丢；判落后丢弃记一行 `snapshot.late.install`（字段只用 `keyHash` 与 `installed`）。
- 单 30 秒耐心已恢复。证据：`src/client/kernel/probe-snapshot.js` 现只有 `SNAP_WAIT_MS = 30000`，超时原文回到固定串 `client loadSnapshot timeout 30s`（散列 `246ae7f1`）。删掉的冷 180 秒与 `snapWaitBudgetMs` 曾和 #962 的超 30 秒不搭车（`CHAIN_RIDE_MAX_AGE_MS = 30000`）直接冲突，现已拆掉，提交 `24dab11c`。
- 诚实等待旗子已补。放弃等待置 `st.snapPending=true`，迟到落地或真失败清掉；`src/client/views/shared/truthLines.js` 用它改一句（`truth.pendingLate`，黄字），词条在 `src/client/kernel/locale-pages.js` 中英各一。`StatusBar.js` 未动（它已 360 行，基线 359，只许减不许增）。
- 门禁已同步。`tests/verify-subdir-first-frame.js` 锚点回到单常量，新增 F1（没放弃不装、不记日志）与 F2（旧版本不装、记 `installed:false`）两条断言，共 61 项通过；`tests/verify-729-force-dedup.js` G 组回到固定串断言，共 40 项通过；构建 `node scripts/build.mjs` 通过（OK）。

## 待讨论的问题（每问给选项与代价，不下结论）

- 名额终值读几个写几个。选项：等 #962 测量回填再定（准，但慢）；先沿用代码现值读 64 写 16（快，但与 #1007 评论 24/4 对不上）。代价：不定终值，别处不敢收口。
- 跨调用方的等待要不要统一（面板 30 秒、deck 每步 30 秒、闸退避各有各的数）。选项：各层自治加迟到落地兜底（改动小，体感不一致）；统一成一个数（一致，但要动多条边界）。代价：统一必须有人同时改多家。
- 写侧超时回执怎么说清（#895/#857/#1007 已定写不许重放，没定话术）。选项：说不清就说不清（诚实，但用户困惑）；加回执状态机（清楚，但要新事件与字段，撞日志门禁）。代价：后者要先过日志附录。

## 故障票归位表（只收与 deck 工具超时报错相关的票）

- 已核（读过正文）：#998（闸连续失败自锁，已修 `71dbc3e`，实机 14:12 验证；次级分桶与冷却锚点未做）、#1007（房内掐表加名额放宽，已落地未发布；剩 `gh.exec` 记子命令与通路冷却）、#962（规格四件准入超时技能日志，未落完）、#891（链事件缺失已修 `c16f139`，等真机确认）。判定依据：正文逐节读过；复核方式：按票号重读正文。
- 未核（只看标题）：其余 23 张只看到标题，不要替下结论。判定依据：仅标题；复核方式：用三问逐票过正文后再定。

## 准入三问（新会话改边界前先问）

1. 你要改的在哪条边界上？
2. 那条边界的数字类别状态现在归谁，你是改它还是接线？
3. 你是并进已有实现，还是新增第二条？新增必须写清为什么不能并。

## 给下一个会话的阅读顺序

地图 #1010 正文 → 本文件 → 用三问逐票过 → 只动归属清楚的那一张。
