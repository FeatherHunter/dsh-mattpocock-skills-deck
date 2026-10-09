# 切换与布局：测试与 ADR 当规格读出的场景矩阵

只认一手来源，不给改法建议。来源只取 8 份：tests/verify-669-choice-precedence.js、tests/verify-698-switch-asks-layout.js、tests/verify-655-setup-layout.js、tests/verify-prompts.js（TOOL_SECTION 两张表）、tests/verify-setup-describe.js、docs/adr/20260921-tracker-choice-precedence.md、docs/adr/20260921-setup-layout-ask-and-remember.md、research/489-appendix.md 第 1 章（含 1.3 增补与 1.5 #64 行）。
每格注测试文件名与断言名（check 第二参原文缩写）或 ADR 节名。断言名照测试里人可读的那句，不转述成新词。
正指应当发生，反指做坏实现必须变红的那条（反证）。

## 0. 入口名（全文统一）

- 切换弹窗路：右侧面板切换后端弹窗 SwitchConfirmModal + store-switch.js confirmSwitchConfirm / openSwitchConfirm。
- 门控窗路：蓝条选择后端门控窗 StatusBackend.js openStatusGate / confirmStatusGate（含 Dock.js 门控、OverlayGate.js 叶、StatusBar.js 状态栏门控）。
- 黄条路：状态栏初始化黄色横幅 StatusBackend.js onStatusSetupInit + prompts-setup.js injectSetupDecision（askLayout:true）。
- 检查页路：检查页红牌执行初始化按钮 ChecksTab.js 经 actions.js 分发器 + prompts-setup.js setupRunTextForClick / injectSetupDecision（不传 askLayout）。
- 布局卡：独立叶子 views/SetupCard.js SetupLayoutCard，经 slotRenderer-modal-view.js 弹窗座位渲染，经 StatusBackend.js settleSwitchCard / cancelStatusSetupPick / confirmStatusSetupPick 收尾。
- 判定链：宿主 detectionService.js detect（含 hintBackendId 布尔位），客户端 store-prefs.js userHintOf / keepUserPick，store-snapshot.js mergeSelection / hydrateFromCache。

## 1. 切换：后端判定（宿主 detectionService.detect）

| 入口×状态 | 输出 | 测试文件名与断言名 / ADR 节名 |
|---|---|---|
| 快照/链带 hint=markdown，锚写 GitHub | selection=markdown | 正：verify-669 A组 带用户选择时判定是markdown；ADR tracker §3.1、§5.1 |
| 快照/链不带 hint，锚写 GitHub | selection=github，锚照旧说话 | 正：verify-669 A组 不带选择时锚照旧说话；ADR §3.1、§3.3 |
| 带 hint 那一次 | explicit 一栏不空 | 正：verify-669 A组 带选择那一次也照旧读锚；ADR §5.1 |
| hint=未注册 id，锚写 GitHub | 落回锚 github | 正：verify-669 A组 未注册后端被忽略落回锚；ADR §5.1 |
| 无锚工作区 + hint=github | selection=github | 正：verify-669 A组 无锚区用户选择照旧生效；ADR §4攻击4 |
| 无选择时 | 锚→matches→兜底旧行为 | ADR §4攻击4，hint 缺省 false=旧行为 |
| 反：hint 分支关掉后带 hint | 退回锚 github | 反：verify-669 E组 反证A成立关掉hint退回github；ADR §5.8 |
| 反：hint 挪到兜底后带 hint | 锚压过选择退回github | 反：verify-669 E组 反证A2成立挪进兜底锚重压选择；ADR §5.8 |

## 2. 切换：什么算用户选择（userHintOf / keepUserPick / mergeSelection）

| 入口×状态 | 输出 | 测试文件名与断言名 / ADR 节名 |
|---|---|---|
| userHintOf 带标记 markdown+userPicked | 返回 markdown 当 hint | 正：verify-669 B组 亲手选带标记当hint上报；ADR §4攻击1、§5.2、§5.3 |
| userHintOf 无标记 markdown | 返回 undefined | 正：verify-669 B组 派生没标记不当hint；ADR §4攻击1 |
| userHintOf 无 id 带标记 | undefined | 正：verify-669 B组 无后端id不上报 |
| userHintOf 空 | undefined | 正：verify-669 B组 空选择不上报 |
| merge宿主回同一后端 | userPicked 留住 | 正：verify-669 B组 回同一条标记留住；ADR §5.6 |
| merge宿主回别的后端 | 标记消失照宿主 | 正：verify-669 B组 回别的后端标记消失；ADR §5.6 |
| 全仓带 backendId 的 wf.detect/wf.chain | 同行必过 userHintOf，漏0处 | 正：verify-669 D组 每一处带backendId都过闸；ADR §5.3 |

## 3. 切换：水合 hydrateFromCache（B2，真机回退直接原因）

| 入口×状态 | 输出 | 测试文件名与断言名 / ADR 节名 |
|---|---|---|
| loadSnapshot首步，已有刚选markdown+标记，缓存是切换前github | 仍是markdown+标记 | 正：verify-669 B2组 水合后刚点那一下还在；ADR §4攻击9、§5.6 |
| 同上 | 不把旧后端写回缓存 | 正：verify-669 B2组 水合没把旧后端写回缓存；ADR §5.6 |
| 无标记旧快照水合 | 照旧合并github | 正：verify-669 B2组 无标记旧快照照旧水合；ADR §4攻击9 |
| 反：守卫摘掉后同现场 | 退回github | 反：verify-669 B2组 反证B2成立摘掉守卫退回github；ADR §4攻击9 |


## 4. 切换：点确认切换之后的分流（store-switch confirmSwitchConfirm，真 guide-steps）

前提：三场景都打 wf.bind，都重取快照与链。判据先要证据（链里得有 tracker:initialized；没有先强制重取再判；仍没有一个字不注入）。

| 入口×状态 | 输出 | 测试文件名与断言名 / ADR 节名 |
|---|---|---|
| 已初始化 github→markdown | decision1条 allowCard+askLayout+source:switch；inject0；flash bindOkAskLayout请先回答下面那一问；记layoutFrom=multi、alignDone=false；bind/snap/chain各1 | 正：verify-669 C组 已初始化先开卡/每次都问/source:switch/零注入/提示条/记改前布局/记对齐未给/bind各1/snap链各1；verify-698 D组同口径；ADR tracker §3.4、§5.5 |
| 未初始化+仓库就绪 github→markdown | decision1条同上三标记；inject0；flash bindOkAskLayout | 正：verify-669 C组 未初始化就绪走决策器/同一份判据/不自注长文/提示条；verify-698 D组 还没初始化走同一判据/不自注；ADR §3.4、§5.5 |
| 未初始化+仓库没就绪 markdown→github（目标GitHub清单gh:remote current） | 仍交决策器 decision1+inject0；flash bindOkNotReady警示色先按状态栏提示处理 | 正：verify-669 C组 未初始化没就绪仍交决策器/提示条警示色；ADR §5.5 |
| 同仓库没过但目标Markdown（清单无仓库步骤） | 判没挡住 flash bindOkAskLayout | 正：verify-669 C组 切Markdown清单无仓库步照算就绪；ADR §5.5判据取setupBlockedByGuide真身 |
| 链还没到 chain null | inject0+decision0不开卡不猜 flash bindOkNotReady | 正：verify-669 C组 链没到不注不开不猜；verify-698 E组 链无初始化步不注指状态栏；ADR §4攻击10、§5.5 |
| 反：卡已开早返回摘掉后已初始化 | 既开卡又注switchAlign inject1+decision1 | 反：verify-669 E组 反证C成立摘早返回又开卡又注；ADR §5.8 |
| 反：blocked当成功后仓库没就绪 | flash谎称bindOkFresh | 反：verify-669 E组 反证C2成立blocked当成功提示谎称完成；ADR §5.8 |
| 反：无步骤不许猜闸摘掉后链null | 落还没初始化支 decision1 | 反：verify-669 E组 反证C3成立摘闸落还没初始化支；ADR §5.8 |

## 5. 切换：卡答完之后注什么（StatusBackend settleSwitchCard，点确认重判一次）

| 入口×状态 | 输出 | 测试文件名与断言名 / ADR 节名 |
|---|---|---|
| 已初始化+改布局multi→single+确认 | inject2条 ALIGN github→markdown + LAYOUT setup.layoutMulti→setup.layoutSingle；logSwitchSettle kind=align-layout | 正：verify-669 C2组 改布局确认两条/首条switchAlign/次条switchLayout/轨迹align-layout；verify-698 E组同五条含后端对齐也留行；ADR §3.4、§5.5、附录#698 |
| 已初始化+没改布局+确认 | 只注switchAlign1条 | 正：verify-669 C2组 没改布局只一条；verify-698 E组同条；ADR §3.4、§5.5 |
| 已初始化+取消 | switchAlign照旧1条不补布局 | 正：verify-669 C2组 取消照给switchAlign；verify-698 E组 取消不补只给后端；ADR §3.4取消的是改布局问 |
| 整链 snapshot→卡点另一项→取消 | 会话退回开卡前multi卡关不补LAYOUT只给ALIGN | 正：verify-698 E组 取消退回开卡前/卡关/不补/照给后端；ADR setup-layout §3.4草稿 |
| 对照同现场确认 | 留住single两条都给 | 正：verify-698 E组 对照确认留住/两条都给 |
| 竞态开卡未初始化确认时已初始化 | 按已初始化走对齐≥1条不拼全文 | 正：verify-669 C2组 竞态按现在已初始化走对齐；ADR §5.5重判 |
| 还没初始化+确认 | 交回决策器 decision1条allowCard:false不自拼 | 正：verify-669 C2组 还没初始化交回决策器不开卡；verify-698 E组 同两条；ADR §5.5 |
| 链null+确认 | inject0 flash bindOkNotReady | 正：verify-669 C2组 链没到零注指状态栏；verify-698 E组同条；ADR §4攻击10 |
| switchAlignDone=true再确认 | 不重复ALIGN只补LAYOUT | 正：verify-669 C2组 给过不再重复；verify-698 E组同条；ADR §5.5只给一次 |
| 卡归属 cardOwnedBySwitch | switch→true缺省→false | 正：verify-669 C2组 认得出归切换/黄条检查页不归；verify-698 E组同两条；ADR §5.5 |
| 黄条卡取消 | inject0卡关 | 正：verify-669 C2组 黄条取消零注；verify-698 E组 黄条取消零注+卡关 |
| 反：不重判后还没初始化 | 直接注对齐两条 decision0 | 反：verify-698 G组 反证2成立不重判直接注两条 |

## 6. 切换：弹窗与门控窗静态（删按钮、置灰、词条、模板）

| 入口×状态 | 输出 | 测试文件名与断言名 / ADR 节名 |
|---|---|---|
| 切换弹窗 | 无clearBackendBinding无switch.clearBind，内核亦无 | 正：verify-669 D组 弹窗清除按钮没了/内核退役；ADR §3.2、§5.4 |
| 选项migrate/clear | 进OPTION_LOCKED置灰 DOM可查 onOption再挡 | 正：verify-669 D组 进置灰名单/DOM可查/再挡一道；ADR §4攻击6、§5.4 |
| 三窗选GitLab | 同问isBackendUnavailable不可选确认再挡，名单gitlab | 正：verify-669 D组 GitLab暂不可选/三窗同判据/置灰可查；ADR §4攻击6、§5.4 |
| 门控窗提示条 | 不说旧数据已保留改说按提示完成初始化 | 正：verify-669 D组 门控不再说旧数据保留；ADR §5.4 |
| 词条5组 | bindOk/bindOkFresh/bindOkNotReady/optLockedTip/targetLockedTip中英各一；clearBind三条不在表 | 正：verify-669 D组 词条成对5/退役三条不在表；ADR §5.4 |
| 新模板switchAlign | 注册表V4七占位符加from/to点名setup命令 | 正：verify-669 D组 新模板在表七占位符/点名setup命令；ADR §3.4、§5.5 |
| 新模板switchLayout | V15原文加首句有意回归，表与取值各一处 | 正：verify-698 E组 新模板是V15原文首句/表与代码各一；ADR §3.4 |
| 同屏只许一张卡 | 布局卡开着挡切换窗 flash setupCardOpen返false | 正：verify-698 F组 有闸/说人话/返false+词条两组中英；ADR §5.5 |
| 反：同屏闸摘掉后卡开着再开窗 | 开成true同屏两张 | 反：verify-698 G组 反证3成立摘闸同屏两张 |


## 7. 布局：注入决策（prompts-setup injectSetupDecision / setupBlockedByGuide）

| 入口×状态 | 输出 | 测试文件名与断言名 / ADR 节名 |
|---|---|---|
| 可弹卡入口+仓库没就绪GitHub红，三种opts | kind=blocked零注不开卡 | 正：verify-655 #664仓库没就绪三入口零注不开卡+判据三条；ADR tracker §5.5 blocked |
| 黄条allowCard+布局未定，三后端 | kind=askLayout零注开卡重绘 | 正：verify-655 #655可弹卡先问三后端；ADR setup-layout §3.1 |
| 拿不到卡不传opts+布局未定+就绪 | kind=setup按缺省single注无悬空 | 正：verify-655 #655拿不到卡照注三后端；ADR setup-layout §3原定版 |
| 布局已选single/multi+就绪 | kind=setup含所选句无悬空中英各不同三后端同模板 | 正：verify-655 #655选后全文两句不同+按语取帧+体裁+点名domain；ADR setup-layout §5.1 |
| 单漏斗已选multi+injectNow:false/allowCard | decision仍setup/askLayout次数对齐金样 | 正：verify-655 #655单漏斗5条；ADR setup-layout §5.1 |
| 黄条askLayout:true+已答single | 仍askLayout开卡零注每次都问 | 正：verify-655 2026-09-21黄条每次问1；verify-698 C组答过传askLayout照问4条；ADR setup-layout §3.1 |
| 检查页不传askLayout+已答single | kind=setup直接注金样 | 正：verify-655 同节2；verify-698 C组答过不传不问；ADR setup-layout §3原3 |
| 会话未答+记住multi | read=multi直接setup注multi句 | 正：verify-655 同节3前两条；ADR setup-layout §3.2 |
| 会话single+记住multi | read=single会话优先 | 正：verify-655 同节3第三条；ADR setup-layout §4.1 |
| 会话未答+无记住 | read=null allowCard→askLayout | 正：verify-655 同节3后两条；verify-698 C组没答过不传仍问 |
| 记住nonsense | read=null当没答过 | 正：verify-655 同节4+兜底不认识按未选；ADR setup-layout §5.1校验 |
| Markdown缺仓库 | setupOrRepo=setup无blocksSetup步 | 正：verify-655 #664 Markdown无建仓步直接注 |
| 建仓补发pending+已选multi | 补一次multi全文消费不重复 | 正：verify-655 #655补发5条； |
| 检查页点击真分发：没过/未定/就绪已选 | 0段/0段开卡/1段金样 | 正：verify-655 #664检查页按钮4条；ADR setup-layout §3原3 |
| 兜底容错 | 缺布局按single，空不抛错，未知后端缺省，关调试零日志 | 正：verify-655 兜底5条+日志1条；附录#64开关 |
| 结构直注禁令 | 视图双产物无绕行，检查页经setupRunTextForClick，黄条经injectSetupDecision | 正：verify-655 结构门禁2条；ADR setup-layout §5.1 |
| 结构单选位置 | SetupCard有layoutRadios，StatusBar无，Dock/OverlayGate不调决策 | 正：verify-655 同节后三条；verify-698 A组黄条不拼/座位分派/声明一处三用+B组单源8条；ADR setup-layout §5.1 |
| 反：每次问改答过不问后答multi+askLayout | 返false不再问 | 反：verify-698 G组 反证1成立改回不问 |

## 8. 提示词：TOOL_SECTION两张表（verify-prompts，合覆注册表23条）

| 模板 | 工具节有无 | 测试文件名与断言名 |
|---|---|---|
| 该带15条：8票+4地图+2产物+1写回 | 中英必须有工具两行 deck_与report | 正：verify-prompts #779缺工具节；条数钉15 |
| 不该带8条：setupRun/switchAlign/switchLayout/installSkills/installSkillsFix/ghAuthLogin/handoff1/handoff2 | 中英一条不许有 | 正：verify-prompts #792不该带；条数钉8；理由见表上注释 |
| 任一条不在两表/表不在注册表/同现两表 | 判红 | 正：verify-prompts 完整性三条 |
| setupRun版本底线 | 不小于v13（v11删调色盘v12加布局v13删告诫） | 正：verify-prompts V_MIN未bump |
| switchAlign/switchLayout版本 | 不在V_MIN，由669D与698E守 | verify-prompts无此两条；见§6 |

## 9. 描述数据化与全文金样（verify-setup-describe）

| 状态 | 输出 | 测试文件名与断言名 |
|---|---|---|
| 三后端四键声明+markdown默认调色盘11行+host转发 | 齐无paletteNote | verify-setup-describe 后端声明/四键/不声明palette/调色盘/host转发 |
| locale双语齐+布局键非空长句+后端不声明布局+各不串台+两布局只差一句 | 成对非空 | verify-setup-describe locale 8条 |
| 数据等于金样三后端加default中英+markdown空+无调色盘项+缺省组 | 逐字节等 | verify-setup-describe 验收1 |
| 全文三后端中英未传single multi+状态无关+算法一致+无标签齐全等+保留核对+以setup命令开头+布局落文 | 逐字同 | verify-setup-describe 验收2+3全组 |
| 零残留client加双产物无trio等 | clean | verify-setup-describe 验收5 |

## 10. 日志 inject.decision 取值与落点（附录第1章#64行+1.3增补）

| 维度 | 取值 | 落点 |
|---|---|---|
| prompt哪一段 | setupRun全文 / switchAlign对齐指令669扩 / switchSettle卡后哪类698扩 | 附录1.5#64行；1.3 #655恒setupRun、#669扩switchAlign、#698扩switchSettle |
| kind哪一种 | setup注全文 / askLayout先开卡不注698前叫setup-card / blocked没过不注664起原repo退役 / align只对齐669只已初始化 / align-layout多布局对齐698只改布局 | 附录1.5#64行；1.3 #655、#664、#698改名扩 |
| layout哪种 | single根一份 / multi子各一份加根MAP / unset没选；switchAlign恒unset switchSettle记会话结论 | 附录1.5#64行；1.3 #655、#669、#698 |
| 级别守卫 | 按需调试开才记同行先判关不组装一次最多几条 | 附录1.5#64行；1.3 #655、#698仍按需；verify-655关零日志 |
| 落点 | prompts-setup injectSetupDecision698搬家原prompts与logSwitchSettle收尾另store-switch兜底 | 附录1.5#64行；1.3 #698；ADR tracker §5.7 |


## 11. 现在无断言覆盖的场景（单列，只说哪格没量）

1. 换机器清缓存后锚重说话（凭据丢失）。ADR tracker §4攻击2已知限制，无自动断言。
2. 挑过一次后手改锚或他AI改文件到另一后端，本机仍跟用户选择。ADR tracker §4攻击8代价与三出路，无自动断言。
3. 点确认瞬间顶部标乐观写新后端、失败回退底部报因。ADR tracker §4攻击7已有行为，669C只量bind/snap/chain与flash，未量乐观值与回退。
4. 切换后AI真相仍旧、prompt先改文件再自证回读。ADR tracker §4攻击3验收要求，669D只量注册与点名，未逐字量自证句。
5. 门控窗确认写userPicked true五处。ADR tracker §5.2点名，669B只量函数与合并，669D只量同谓词，未量门控写标记。
6. 手改domain布局结论不改记住答案。ADR setup-layout §4明写，655只量读优先，未量文件与记住脱钩。
7. 换机器换浏览器清缓存后布局重问。ADR setup-layout §4明写，无自动断言。
8. 卡上不加 上次选过 说明（预选即线索）。ADR setup-layout §4明写，698A只量结构座位，未量该句缺席。
9. 黄条按钮在布局卡已开时的互斥。698F只量切换窗被挡，未量黄条被挡。
10. 链取失败抛错后强制重取再判动作本身。669C/698D/E直喂快照，未量取发起。
11. 状态栏门控确认挡GitLab行为。669D量三窗同谓词与弹窗双保险，未量门控确认分支。
12. 清除路径全仓零调用。669D只查两文件与词表，未做clear全仓扫描。
13. 取消后记住不变下次仍问。ADR setup-layout §3.4，698E只量会话回退与注，655只量读优先，未量取消后缓存。
14. store-switch兜底行开关守卫。附录#64统一口径，655只量决策关安静，669C2/698E只量开有行，未量兜底关安静。
15. switchSettle layout三值全交叉。669C2/698E只量kind，未逐格量single/multi/unset。
16. switchAlign/switchLayout版本未进V_MIN。仅setupRun v13在表，另两条由669D/698E守。
17. 空工作区旧绑定失效与hint共存。ADR tracker §4攻击4写明不受影响，无自动断言。
18. 快照与链两路一致同hint同果。ADR tracker §4攻击5要求，669A只量单路，未量双路同果。

## 12. 一手来源行号索引（备查）

- verify-669：A组宿主判定、B组闸门、B2水合、C组分流、C2收尾、D组静态、E组反证。
- verify-698：A组位置、B组单源、C组判据、D组切换两支、E组收尾、F组同屏、G组三反证。
- verify-655：#664 blocked、#655问与注、单漏斗、2026-09-21记住、黄条检查页、补发、点击分发、兜底日志结构。
- verify-prompts：TOOL_SECTION两张表15加8合覆23条、V_MIN setupRun13。
- verify-setup-describe：后端声明、双语键、数据等于金样、全文等价状态无关、零残留。
- ADR tracker：§3裁决、§4攻击1到10与附两入口、§5落地1到8。
- ADR setup-layout：§3裁决1到4含2026-09-22改口径、§4代价、§4.1卡点不动坑、§5落地1到4。
- 附录第1章：#64行三枚举与守卫落点；1.3 #655初建、#669扩switchAlign、#698扩switchSettle搬家改名。
