# #1504 复核：嵌套调用气泡已修，切回后台会话仍看不到那组气泡（2026-10-25）

> 只认一手来源：本机已安装的 1.9.0-beta.18 插件产物与仓库源码、插件调试日志、报告人导出的会话事件流（zip 解包后逐条读）。每条结论后面跟落点。调查时间 2026-10-25（Asia/Shanghai）。
>
> 一句话结论：**#1504 报的三处客户端缺口已经在 `ea967080`（v1.9.0-beta.12 起）修好，本机实装的 beta.18 产物能逐行对上；用报告人导出会话里的真实事件复算，当前源码会正常交付那 3 条建议。** 本机这次没看到气泡的原因不是这个缺陷：那一刻界面没有挂这个会话的建议流（屏幕上当时是别的会话），调用从未被界面看见，也就没有被投递、没有可切回时取回的缓存——这是 #1397 定下的「只借当前显示会话的事件流、打开旧会话的历史重放不冒泡」的边界，属于另一件待拍板的事。

## 1. #1504 报了什么

报告人给的标题是「suggest_next_steps：嵌套调用（run_code）时工具返回 ok 但 GUI 不出气泡」，环境为插件 v1.9.0-beta.11。正文列了三处客户端假设不成立：

1. 事件类型：嵌套调用在事件流里是 `tool/ptc-dispatch-start`，客户端 `suggestEventOf()` 只认 `tool/call`，整条被忽略。
2. 参数形状：PTC 事件的 `data.arguments` 是对象，客户端 `suggestItemsOf()` 只做 `JSON.parse(字符串)`。
3. 投递闸门：`pending` 只在 `turn/end` 才交付，而报告人说 program-only 会话的事件流里没有 `turn/end`。

正文另附三条建议修法：认 `tool/ptc-dispatch-start`；投递不再只挂 `turn/end`（`tool/ptc-dispatch` 或 `tool/result` 到达时兜底，或短 debounce）；在工具说明里注明嵌套调用也会出气泡。票面无验收勾选项。维护者在 2026-10-25T06:01:15Z 评论说最新 beta 已修复、升级并重启即可。

## 2. 修复发在哪、本机装的是不是它

- 修复提交：`ea967080e3afc9151a3aac3f6fc5cf81ec4dabf2`（2026-10-23 21:22:46 +0800，标题「修复 PTC 预设下建议气泡不出现：界面侧补认 tool/ptc-dispatch-start」），改 `src/client/statusbar/suggestFacts.ts`、`src/client/statusbar/suggestStream.ts`、`tests/verify-1409-suggest-stream.ts`（+150/−30）。
- 首次随哪个版本发布：`git tag --contains ea967080` 列出 `v1.9.0-beta.12` 到 `v1.9.0-beta.18`，即 beta.11 之后第一次发版就带上了。
- 本机装的是 beta.18：已安装包 `C:\Users\辰辰洋洋\.dsh\profiles\desktop\node_modules\dsh-mattpocock-skills-deck\package.json` 里 `version` 为 `1.9.0-beta.18`；同日插件日志里 22:01:48 启动的宿主（pid 61532）也报 `pluginVersion: 1.9.0-beta.18`（日志路径见第 4 节）。
- 产物里能逐行对上：该包 `lib/client.js`（44,669 行）第 24246 行起就是 `tool/ptc-dispatch-start` 分支，第 24187–24188 行是「参数已是对象就直接用」的分支（PTC 形态），与源码 `src/client/statusbar/suggestFacts.ts:131-158`、`:63-109` 一致。

## 3. 用报告人自己的会话事件流复算（关键验证）

导出包：`D:\Users\辰辰洋洋\Downloads\dsh-session-session-9c362068-1655-4098-b30e-e4cf24c5fb52.zip`，解到 `D:\Temp\sess1504\`。主会话 `session.v4.jsonl` 2,369,722 字节、581 行；子会话 `subagents\5e8ed314-e666-42d5-9e47-44a8d0b71919\session.v4.jsonl` 2,215,226 字节、440 行。主会话首记录写明 `cwd` 是本仓库、`agentPreset: "ptc"`、`delegationDepth: 0`，创建时间 `1792937500839`（= 22:11:40.839 +08），是一个真实的 program-only（PTC 预设）会话。

这次调用在事件流里的原始记录（同一文件逐行读出）：

| seq | 类型 | 时间（+08） | 关键字段 |
| --- | --- | --- | --- |
| 555 | `tool/call` | 22:24:24.233 | name=`run_code`，callId=`call_00_g3wy3tj3usc4m4gw5jpu77d0`，turn=1 |
| 556 | `tool/ptc-dispatch-start` | 22:24:24.446 | name=`suggest_next_steps`，subCallId=`call_00_g3wy3tj3usc4m4gw5jpu77d0:ptc:1`，arguments 是对象（3 条 items） |
| 557 | `tool/ptc-dispatch` | 22:24:24.448 | — |
| 558 | `tool/result` | 22:24:24.475 | 回执原文「已记下 3 条下一步建议」 |
| 571 | `turn/end` | 22:25:01.299 | turn=1，reason=`{kind:"completed"}` |

用当前仓库源码（同一份被构建进 beta.18 的 `suggestFacts.ts`）直接喂这几条事件，结论是：

- `suggestEventOf(seq556)` 返回 `{kind:"call", turn:null, callId:"call_00_g3wy3tj3usc4m4gw5jpu77d0:ptc:1", argumentsValue:{items:[…3 条…]}}`；
- `suggestItemsOf(该 argumentsValue)` 返回 `ok: true, items: 3`（三条简介分别是「补一张门禁缺口票」「复核这次的修复提交」「讨论死字段怎么处理」）；
- `suggestEventOf(seq571)` 返回 `{kind:"turn-end", turn:1}`；
- `suggestStream` 的交付条件 `pending.turn === null || pending.turn <= info.turn`（`src/client/statusbar/suggestStream.ts:135-145`）在这条上成立（turn 为 null）。

**所以：如果 22:24–22:25 期间界面挂着这个会话的建议流，这 3 条建议会在 22:25:01 那一轮结束时正常交付、冒泡。** 报告人所说的「根因③：没有 `turn/end`」在这份导出上不成立——它有 `turn/end`（整个导出里 `turn/start` 2 条、`turn/end` 1 条，第二轮在被导出时尚未结束）。

复算脚本放在 `D:\Temp\sess1504\check1504.mjs`（不入库），跑法：`node --import ./scripts/ts-hook.mts D:\Temp\sess1504\check1504.mjs`。

## 4. 为什么切回这个会话时仍然没有气泡

插件日志：`C:\Users\辰辰洋洋\.dsh\profiles\desktop\.dsh-mattskillsdeck-cache\logs\2026-10-25.log`（当天约 130 MB、77 万行；22:35 仍在写）。按会话散列 `361ffde4`（`sidHash`，对应 session-9c362068）筛 `suggest.*` 事件，结果是：

- `suggest.bind`（挂载取数流）只有三条：22:11:42.042、22:27:35.974、22:29:55.330，都是 `outcome: "bound"`；
- `suggest.call` 与 `suggest.ready` 一条都没有——即 **22:24:24 那次调用从来没有被界面看见、也没有被投递**。

同一时段屏幕上挂的是别的会话：22:16:20 的 `suggest.bind` 是 `f7051034`（#1516 那次 triage 的会话），22:24:44 是 `bf53b5ee`，22:24:53 是 `caf0c276`，直到 22:27:35 才重新 bind 回 `361ffde4`。也就是说 22:24:24 这次调用发生时，9c362068 这个后台正在跑 /implement #999 的会话不在屏幕上。

为什么不重新弹出来：客户端的取数流只在**被界面挂载的那个会话**上借事件流（`suggestStream.ts:191-204`：`sessions.binding(sid).eventSource` 只读订阅）；离开会话即 `dispose()` 退订（`:206-219`、`:269-272`）。切回时挂载组件先做的是 `suggestGroupRecall(sid)`（`:243`、`:256`），而这份按会话的缓存**只在交付成功时**写入（`:265` 的 `suggestGroupRemember`）——这次从未交付，缓存里没有它，自然取不回来。另外，打开旧会话时平台会把历史事件重放成 `replace` 通知，而取数层硬约束只处理 `append`（`:176-183`，文件头 `:8-13` 也写明），重放里那条 22:24 的调用与 22:25 的 `turn/end` 不会被当成新调用。

所以看到的「切回来没有气泡」是这条链的真实结果，不是 beta.18 又把 #1504 退回去了。

## 5. 这算不算已经承诺过的行为

- #1470（已关闭）做的是「按会话保留已上屏的建议组」：模块级内存缓存最多 32 组、新建议上屏前先 `remember`、切回来 `recall`、点走或关掉时 `forget`，不落盘、不加定时器、不 retain。它只对「曾经上过屏」的组成立，不覆盖「后台跑完、从未上屏」的会话。
- #1397（规格，已关闭）的用户故事 15 写的是「看到的是我正在看的这个会话的建议，别的会话不能覆盖过来」；实施决策写的是「拿不到事件流时（该会话没有被界面保持订阅）安静地什么都不做，只记一条日志」，不做的范围写的是「不做历史建议列表、不做跨窗口/多标签同步」。当前行为正落在这两条里。
- #1409（取数通路规格）文件头的硬约束也是「只借不保、不新增常驻定时器、拿不到就安静」；#1420（补验票，仍 open）把「切会话中途才挂载界面时可能漏掉本轮更早的建议」记为已知限制——本次情况比它更彻底：整轮期间界面都没挂过该会话。
- 运行期并非完全拿不到 PTC 嵌套调用：beta.18 的日志里有多条 `turn:null` 的 `suggest.ready delivered`（例如 2026-10-25 15:43:53 `sidHash=243bff7e` 3 条、16:41:04 `sidHash=2636157d` 2 条；再往前 01:47:30 `sidHash=fd7292a7` 3 条、05:22:47 `sidHash=e380d496` 3 条），说明修复在实装版本里确实生效，只是它需要「界面正挂着那个会话」这一前提。

## 6. 相对 #1504 建议修法，还差什么

- 建议①（认 `tool/ptc-dispatch-start`、兼容对象参数）：已做，见第 2、3 节。
- 建议②（投递不再只挂 `turn/end`，在 `tool/ptc-dispatch` / `tool/result` 到达时兜底或短 debounce）：**没做**。当前源码里没有任何兜底投递；不过本次导出会话有 `turn/end`，所以它不是这次没气泡的原因。只有真遇到「整条流确实没有 `turn/end`」的现场才会卡住，目前没有这种证据。
- 建议③（工具说明里注明嵌套调用也会出气泡）：**没做**。`src/deck/tools/suggest-next-steps.ts:51` 的 `definition.description` 仍只写「界面会显示成可点的气泡」，没有提 run_code 嵌套调用；这是文案缺口，不是功能缺口。

## 7. 结论与建议

1. **#1504 报的缺陷已经实现**：beta.12 起修复，本机 beta.18 产物与源码一致；用报告人自己导出的事件复算，当前源码会正常交付那 3 条建议。按 triage 的「已经实现」规则，这张票可以 `bug` + `wontfix` 收口并关闭，评论指到 `ea967080` 与 beta.12+，不写 `.out-of-scope`。
2. **「切回后台会话看不到气泡」是另一件事**：它落在 #1397 明写的设计边界里，不是 #1504 的回归。#1470 只保留上过屏的组；从未上屏的会话既没有交付记录，也不会从 `replace` 历史重放里重建。若要支持，需要新开一张决策票先定机制（例如「打开会话时从历史里重建最后一轮的一组，只显示一次、不落盘」或「宿主在轮结束时把建议写进会话存储、界面打开时读」——两种都触碰 #1397 的「只借当前显示会话事件流 / 不做历史建议列表」约束，必须维护者拍板，不在本笔记定方案）。
3. **建议②③保持不做**：没有「无 `turn/end`」的现场证据就不加兜底投递；工具说明那句属于可选文案，单独开小票比塞进本票合适。

## 8. 证据落点清单

- 源码：`src/client/statusbar/suggestFacts.ts:63-109`（参数解析，含对象分支）、`:131-158`（事件识别，含 PTC 分支）；`src/client/statusbar/suggestStream.ts:8-13`（硬约束）、`:135-145`（turn/end 交付）、`:176-183`（只认 append）、`:191-204`（借事件流）、`:206-221`（退订）、`:234-285`（挂载、remember/recall/forget 接线）；`src/deck/tools/suggest-next-steps.ts:51`（工具说明）。
- 测试：`tests/verify-1409-suggest-stream.ts`（取数通路，本次修复的回归门禁）、`tests/verify-1451-suggest-session-keep.ts`（按会话保留的 31 条断言）、`tests/verify-1411-suggest-bubble.ts`、`tests/verify-1411-suggest-appearance.ts`。
- 本机产物：`C:\Users\辰辰洋洋\.dsh\profiles\desktop\node_modules\dsh-mattpocock-skills-deck\lib\client.js` 第 24187–24188、24235–24262 行；`package.json` 的 `version: 1.9.0-beta.18`。
- 日志：`C:\Users\辰辰洋洋\.dsh\profiles\desktop\.dsh-mattskillsdeck-cache\logs\2026-10-25.log`（`host.start`、`suggest.bind`、`suggest.call`、`suggest.ready`；事件口径见 `research/489-appendix.md` 第 1 章 #127/#128/#129）。
- 导出会话：`D:\Users\辰辰洋洋\Downloads\dsh-session-session-9c362068-1655-4098-b30e-e4cf24c5fb52.zip` → 解包到 `D:\Temp\sess1504\`（`session.v4.jsonl` 与 `subagents\5e8ed314-e666-42d5-9e47-44a8d0b71919\session.v4.jsonl`）。
- 复用过的仓内笔记：`research/dsh-next-steps-notify-facts-2026-10-22.md`（工具调用与 binding 的事件形状、只读借用的边界）、`research/489-appendix.md`（suggest.bind/call/ready 三个日志事件的字段口径）。两份都答不了本次问题：它们讲的是事件形状与交付契约，没有覆盖「会话没有上屏时，那组建议会不会被保留/重建」这条运行期行为，所以另写了本笔记。
