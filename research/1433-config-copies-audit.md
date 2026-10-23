# 研究：全仓还有哪些「同一份配置存了两份」（#1433）

> 本文回答用户第三问：除了已经列入整改的「调试日志开关」那一份，插件仓的生产代码还有没有把同一份配置同时存两处。
> 只读源码、测试与 ADR，只新增这一份研究文档；没有修改生产代码、测试或配置，也没有提交。
>
> 写于 2026-10-23。审计基线是 `main` 分支的 HEAD 提交 `2298c11e`。审计期间工作区里另有 #1432 的未提交实现（日志开关、设置电话与客户端调试开关），本报告不把这份草稿当成现状，只在调试开关一条注明「已列入整改，见 #1432」。
> 编号 1433 是按 `research/` 现有命名与编号惯例取的下一号；本次没有建 GitHub issue，需要立票的事项列在 §4。

## 0 一句话结论

除已列入整改的调试日志开关（#1432）外，确认还有**两处真复印件**，外加**一处同根风险**：①布局答案同时写在工作区 YAML、宿主 `choices.json` 与浏览器 `localStorage` 三处，而快照和注入只读后两处、不读工作区文件；②老 `docs/agents/workspace.json` 在生产写路径上从不清理，仍被读链当兜底；③快照盘缓存回放会带出旧布局，和①是同一个根因，建议并入布局那一票。其余落盘项逐项判定后，均属真源、构建派生、兜底过渡或各自领域自有数据，不需要整改。

## 1 判据

先约定本报告怎么判，避免把「同一份数据被几个进程只读」误判成复印件。

1. **真源**：某个值只有一处定义，其他路径以它为准；它变了，行为就跟着变。ADR 20261021-config-ownership.md:24 的原话是「一个值只该有一处定义（真源），第二份拷贝不是备份，是将来必然漂移的债」。
2. **第二份拷贝（需要整改）**：同一件事被写进两处，而且两处都能被当成来源；任一处独立变化，另一处不会自动跟上，最终行为取决于谁先被读。典型特征是「两个写入口、两个读取点、没有一致性门禁」。
3. **合规的缓存/派生**：数据可以从别处重建，有明确的生成器或单一写入口，通常还有 `--check` 或门禁盯着；手工维护的副本不算这一类。本仓 `config/*.yaml` → `values.ts` / `locale-data.ts` / `prompt-data.ts` 就是这一类，源是 YAML，TS 是构建产物。
4. **合规的兜底/迁移**：只有主路失败（文件读不到、写不进、手机不通）或版本升级时才使用，主路成功时一个字都不写；并且有明确的收口方向。本仓客户端那批 `dsws.*` 旧键属于这一类，不是双写。
5. **自有领域数据**：本来就是另一个领域的事实，不是「同一份配置」；例如续跑游标、工作路线存档、命名跟踪状态、诊断日志、安装身份。
6. **相邻但不算**：同一份文件被多个进程只读、仓库声明与插件记忆回答不同问题（如 `docs/agents/issue-tracker.md` 与 `workspace.yaml`、`docs/agents/domain.md` 与插件记住的布局答案），都不按复印件处理。

判定顺序是：先找「真源」，再看有没有第二个**写入口**；如果第二个写入口只是缓存/兜底，看它会不会在主路成功时也被写、会不会被当成读取源；最后看有没有门禁能发现两边不一致。ADR 20261012-backend-decision-two-classes.md:43-44 已经把「工作区文件是后端选择的唯一真源、`choices.json` 只服务迁移和布局」这条先例定下来了，本报告沿用同一把尺子。

## 2 全仓落点清单

路径记号：

- `<home>`：平台 `getHome()` 返回的用户主目录；本机设置、`choices.json`、工作路线存档都在这下面。
- `<workspace>`：当前工作区的根目录；`docs/agents/` 下的仓库事实与缓存目录都在这下面。
- `<cache>`：**DSH 进程启动目录**下的 `.dsh-mattskillsdeck-cache/`，不是用户主目录（`src/host/git-process.ts:437-447` 的注释说明原因：fs 沙箱只允许写进程当前目录）。日志、快照盘缓存、命名状态、计划游标都在这里或工作区下的同名缓存目录。
- 「门禁」：仓库里已有的 `tests/verify-*` 或脚本检查；没有专门门禁的会写「无」。

### 2.1 本机设置与工作区配置文件

| 文件路径 | 写入方 | 真源判定 | 是否有拷贝 | 不同步风险与现有门禁 | 建议 |
| --- | --- | --- | --- | --- | --- |
| `<home>/.dsh/mattskillsdeck/settings.yaml`（整份） | 宿主 `src/host/settingsPhones.ts:168-203` 的 `handleSetSettings`，经 `src/host/configStore.ts:284-306` 的 `writeLocalSettings` 落盘；客户端通过同一组设置电话读写 | 用户本机设置的唯一真源 | 文件本身没有整份拷贝；字段级的旧键兜底见表 2，debug 的宿主副本见表 3 第 1 行 | 整份读改写；两个窗口同时改不同节时后写可能覆盖先写，当前没有并发门禁。文件版本更高时只读并如实回失败；`tests/verify-settings-phones.ts`、`tests/verify-settings-view.ts` 等守行为 | 保持单一真源；以后新增设置只进这份文件，不再开新的落盘口 |
| `settings.yaml` 的 `debug.enabled` 与 `debug.sampleRate` | 客户端 `src/client/kernel/settings-debug.ts`（HEAD 的 :1-21 头注写明先写设置文件、再 best-effort 推宿主）；宿主电话 `wf.setSettings` | 是 | 是：宿主缓存目录的 `log-switch.json`（表 3 第 1 行）与客户端 `dsws.debug.wf`（表 2） | **已列入整改，见 #1432**。HEAD 上设置页推送失败或旧宿主读不到时，日志实际是否记仍可能由缓存副本决定（`settings-debug.ts:1-21` 的「一条缺口」）；目前没有 yaml 与副本的一致性门禁 | 随 #1432 收口；收口时确认 `dsws.debug.wf` 只做开机秒显，不再被当作行为依据 |
| `settings.yaml` 的 `workspaces`（`bannerFolded` / `subwsMarkAutoShown`） | 客户端 `src/client/kernel/settings-view.ts` 与 `src/client/kernel/settings-view-write.ts` | 是 | 是，但只是兜底：`localStorage` 的 `dsws.bannerFold` 与 `dsws.subwsAutoShown`（表 2） | 只有文件读不到/写不进/手机不通时才读旧键，写成功时一个字不写旧键；已知局限是文件里已有该工作区记录时，写进旧键的值读不回来，只在本次窗口内充当记性（`settings-view.ts:20-28`）。`tests/verify-settings-view.ts` 覆盖行为，无一致性门禁 | 不立票；过渡期结束、文件路稳定后删旧键，另议 |
| `settings.yaml` 的 `ui` | 客户端 `src/client/kernel/settings-ui.ts` | 是 | 是，但只是兜底：`dsws.listPrefs`（`src/client/kernel/store-prefs.ts:32,43,50`；`settings-ui.ts:74-76`） | 文件路失败才写旧键；文件不可用时旧值可能过期；无一致性门禁 | 不立票 |
| `settings.yaml` 的 `templates` | 客户端 `src/client/kernel/settings-templates.ts` 与 `src/client/kernel/config.ts:16,21,27` | 是 | 是，但只是兜底：`dsws.templates`（`settings-view-write.ts:145-149` 按 section 分派） | 同上；文件写不进时旧键兜底 | 不立票 |
| `settings.yaml` 的 `workspaces.*.noRepoDismissed` | 核 `src/shared/config-store/src/settings.ts:230` 每次整份 stringify 时按默认 `false` 写回；设置页故意不替用户种这个值（`settings-view.ts:84-93`） | **占位，不是真源**；红卡收起的真实状态在 `localStorage` 的 `dsws:noRepoDismiss:<cwd 散列>`（`store-prefs.ts:65-69`） | 是，文件这格与浏览器键同名，但文件这格目前没有读者 | 将来红卡搬进设置文件时，如果直接读这格，会把收起的红卡重新弹出来（`settings-view.ts:87-92` 明确提示）；当前无门禁 | 不单独立票，并入无仓库红卡退役票；搬的时候先删占位或先读真实键 |
| `<workspace>/docs/agents/workspace.yaml` | 宿主 `src/host/workspaceCwd.ts:272-324` 的 `writeWorkspaceRecord`（`wf.bind` 成功后写）；同文件 :144-166 的 `handleSetupLayout` 在已有后端记录时写 `layout`；迁移路径 :325-374 | 后端选择：唯一真源（ADR 20261012:43）；布局：声明的写入地（#1003） | 后端选择在 `choices.json` 有一份备份（下表）；布局在 `choices.json` 与 `localStorage` 还有两份读取源 | 后端选择写文件成功才算生效；布局写进文件不等于快照/注入会读它（§3.1）；老 `workspace.json` 从不清理（下一行） | 后端保持；布局按 §3.1 先拍板单源，再改读取路径 |
| `<home>/.dsh/mattskillsdeck/choices.json` | 宿主 `src/host/choiceStore.ts:413-470` 的 `rememberWorkspace` / `rememberLayout`，调用点在 `workspaceCwd.ts:135,163`；ADR 里定的是原子写、按键读-改-写 | 后端选择：**只是备份，不参与判定**（ADR 20261012:44；`workspaceCwd.ts:123` 注释说「H 只是文件万一被删还能再生成一次的备份」）；布局：**快照实际读取它**（`sessionSnapshot.ts:85-86`） | 后端选择是工作区 YAML 的合规备份；布局是同一答案的第二真源 | 布局可与 `workspace.yaml` 不一致，且无一致性门禁（§3.1）；后端选择不被读，风险低 | 后端选择保留；布局部分随布局单源票处理，不应继续当读取源 |
| `<workspace>/docs/agents/workspace.json`（老版本） | **生产代码没有写者**；写 YAML 的生产路径绕过 `configStore.writeWithCleanup`，从不删老文件（`workspaceCwd.ts:272-324`） | 老版后端选择的兼容副本（v1 四字段，本来就没有布局；`src/shared/config-store/src/workspace.ts:4-5,13`、`src/deck/shell/workspace-anchor.ts:63`） | **是，同一事实的第二份，且从不清理**（#1012 票面本来要求写成功后再删，见 `research/1012-final-plan.md:32`） | 读链会退回它：`workspaceCwd.ts:179`、`src/tracker/detection/detectionService.ts:218`、`src/tracker/detection/backendDecision.ts:823`；YAML 缺失/被删时会复活旧选择。`tests/verify-1003-single-outlet.ts:160` 只把它当兼容读现场，`tests/verify-config-store-migration.ts` 只在内存假文件系统里测适配器删除，都不守生产路径 | **立票**：写 YAML 成功后 best-effort 删老文件、失败只记日志，并加门禁；删用户仓库里的文件前先让人拍板（§4） |
| `<workspace>/docs/agents/label-colors.yaml` | 宿主 `src/tracker/rooms/markdown/label-colors.ts:251-344` 的 `ensureLabelColors` / `publishLabelColors` | 标签配色真源 | 老 `label-colors.json` 只做兼容读；迁移或保存成功后调 `removeLegacyLabelsFile`（同文件 :288-298），删失败只记日志 | YAML 已是第一读取源，YAML 不在才读老 JSON；`tests/verify-markdown-label-colors.ts` 是门禁。删失败时老文件可能残留，但不再优先 | 合规，不立票 |

### 2.2 浏览器本地存储与会话存储

| 文件路径或键 | 写入方 | 真源判定 | 是否有拷贝 | 不同步风险与现有门禁 | 建议 |
| --- | --- | --- | --- | --- | --- |
| `localStorage['dsws.setupLayoutByCwd']` | 客户端 `src/client/kernel/store-prefs.ts:339-356` 的 `setCachedSetupLayout`：卡上点传裸字符串（时刻按现在），快照回填传 `{layout,pickedAt}`；调用点 `src/client/statusbar/StatusBackend.ts:68`、`src/client/kernel/probe-select.ts:164`、`src/client/kernel/probe-snapshot.ts:270` | 显示缓存/镜像，不是真源；但注入读取会把它当兜底（`src/client/kernel/prompts.ts:216-221` 先会话状态、再 C 表） | 是，布局的第三处家 | 与 `workspace.yaml`、`choices.json` 可不同步；`pickedAt` 只能仲裁两个壳的先后，不解决用户手改文件；换机器或清缓存时 C 为空，状态栏卡上预选丢失；`storage` 事件只合并这张表（`store-prefs.ts:205-221`）；无一致性门禁 | 随布局单源票降为只读显示缓存，不再被当成答案来源 |
| `localStorage['dsws.bannerFold']` | `src/client/kernel/settings-view.ts:236` 的旧键兜底写；读在 `store-prefs.ts:224-247` | `settings.yaml` 的 workspaces 旧键兜底 | 是兜底，不是双写 | 文件路成功时不写；文件不可用时可能显示旧值；属已知过渡 | 不立票 |
| `localStorage['dsws.subwsAutoShown']` | `src/client/views/SubworkspaceMark.ts:304` 仅在 infos 路径接不下时写；读在同文件 :225-228 | 同上 | 是兜底 | 同上；只有旧路才写 | 不立票 |
| `localStorage['dsws.listPrefs']` | `store-prefs.ts:43` 的 `saveListPrefsLegacy`；`settings-ui.ts:74-76` 文件路失败才写 | `settings.yaml` 的 ui 节兜底 | 是兜底 | 文件不可用时旧值可能过期；写成功不写旧键 | 不立票 |
| `localStorage['dsws.templates']` | `src/client/kernel/config.ts:27`；`settings-view-write.ts:145-149` 文件路失败时兜底 | `settings.yaml` 的 templates 节兜底 | 是兜底 | 同上 | 不立票 |
| `localStorage['dsws.debug.wf']`（键由日志包按插件标识派生） | 日志包 dsh-log 的客户端持久化（`src/client/kernel/settings-debug.ts:11` 说明「本地开关快照走包的 persist」）；本仓只在启动迁移时写入新形状 | `settings.yaml` 的 debug 节真源的本地镜像，用于开机秒显 | 是 | 若被当成行为依据，就会与设置文件不同步；HEAD 的已知缺口是宿主副本仍是实际闸门；有 `tests/verify-log-switch-526.ts`、`tests/verify-log-switch-597.ts`、`tests/verify-settings-debug.ts` 守行为，但没有 yaml/镜像一致性门禁 | 随 #1432 收口；确认只做只读镜像，不再回写设置文件 |
| `localStorage['dsws.debug']`（裸键） | `src/client/kernel/log.ts:33-35,64-66,224,302` 的老路写；`settings-debug.ts:53-71` 只在升级时把它当证据搬一次到 `dsws.debug.wf`；`:155-157` 文件路失败时写回当秒显快照 | 升级前选择的历史证据，不是活跃真源 | 是迁移残留 | 正常路径只读一次并迁移；文件写不进时仍可能写回，开机短时间显示旧值；#1432 收口时要确认它不复活 | 不立票；#1432 验收时加一条「旧裸键不再产生新的行为来源」 |
| `localStorage['dsws.selectionByCwd']` / `['dsws.repositoryByCwd']` | **无写者**；`store-prefs.ts:180-187` 已按 #1003 退役 | 已退役死键 | 历史残留 | 无读者；只可能留在老浏览器里，不改变行为 | 不立票 |
| `localStorage['dsws.labelClicks']` | **无写者**；`store-prefs.ts:58-60` 的 `saveLabelClicks` 是空动作 | 已退役死键 | 历史残留 | 无读者 | 不立票 |
| `localStorage['dsws:noRepoDismiss:<cwd 散列>']` | `store-prefs.ts:65-69`；红卡收起/展开时写 | 红卡收起状态的**当前唯一存储** | 与 `settings.yaml` 的 `noRepoDismissed` 占位同名但不同步 | 红卡退役、把状态搬进设置文件时要处理文件里的默认 `false`，否则会重新弹出；当前无门禁 | 并入无仓库红卡退役票 |
| `sessionStorage`（`RestFallbackBanner` 的关闭时刻；`attention-heartbeat` 的窗口身份） | `src/client/views/shared/RestFallbackBanner.ts:14,44-45`；`src/client/kernel/attention-heartbeat.ts:7-8,38-51` | 本标签页临时状态，不是配置 | 否 | 关闭标签页即失效，符合同源窗口/本页语义；不需要跨进程同步 | 不立票 |

### 2.3 缓存、派生与自有领域数据

| 文件路径 | 写入方 | 真源判定 | 是否有拷贝 | 不同步风险与现有门禁 | 建议 |
| --- | --- | --- | --- | --- | --- |
| `<cache>/log-switch.json` | HEAD 的宿主日志底座：正常路径优先 npm 包 dsh-log 的 `createHostLog`（`src/host/logFromPackage.ts:52-62` 把 `fs`/`getCacheDir` 递进去），包不可用时回退插件旧实现 `src/host/logStore.ts:43,220-251` 的 `loadSwitch`/`persistSwitch`/`setSwitch`；开关电话在 `src/host/logPhones.ts:72-73,152,157` | `settings.yaml` 的 debug 节的**宿主副本**；HEAD 上它是「日志记不记」的实际闸门（`settings-debug.ts:1-21` 的「一条缺口」） | **是，已列入整改** | 设置页先写 `settings.yaml` 再推送宿主；推送失败、旧宿主或外部写入时两份会不同步；`tests/verify-log-switch-526.ts`、`tests/verify-log-switch-597.ts`、`tests/verify-log-store.ts` 守行为，没有 yaml/json 一致性门禁 | 已列入整改，见 #1432；HEAD 仍是副本，工作区已有实现待合并（宿主改为从设置文件读、删掉这份文件） |
| `<cache>/<owner>__<name>.json`（快照盘缓存） | 宿主 `src/host/git-process.ts:466-476` 的 `writeDiskCache`；调用点 `sessionSnapshot.ts:369` | 派生物/缓存，不是真源 | 是：缓存里带了 `selection` 与 `setupLayout` 两份可写配置的旧值 | 回放时 `sessionSnapshot.ts:295-299` 只校验 `selection.backendId`，不覆盖 `setupLayout`；`cacheFormat===3` 只校验结构，没有 TTL，也不判断布局新鲜度；无门禁（`tests/verify-snapshot-cache-first.ts` 把 `readDiskCache` 桩成 null，`tests/verify-delta-wiring.ts:95,109-110` 直接用 `disk.snap`） | 并入布局单源票：回放时用当前 `_layEarly` 覆盖，或从缓存剥掉配置字段；不要让它成为布局的第四个来源 |
| `<cache>/logs/YYYY-MM-DD.log` | `src/host/logStore.ts:191-213` 的 `writeBatch`；目录名 `LOG_DIR_NAME='logs'` | 诊断日志，不是配置 | 否 | 日志内容不参与配置判定；真正的问题是开关决定记不记（见 #1432） | 不立票 |
| `<cache>/naming-guardian.json` | `src/host/namingGuardian.ts:54,81-89` 的 `persistNamingState` | 命名跟踪状态，自有领域数据 | 否 | 1200ms 防抖合并写；写失败不影响主流程，下轮重试；宽限期内进程被杀可能漏记，代码注释已说明 | 不立票 |
| `<workspace>/.dsh-mattskillsdeck-cache/deck-plans/deck-plan-<ws>-<planId>.json` | `src/deck/shell/plan-cursor.ts:83-117`；`src/deck/tools/map-plan-create.ts:123` | 批量建图的续跑游标，自有领域数据 | 否 | TTL 7 天（`PLAN_CURSOR_TTL_MS=604800000`）；清游标用空内容，写失败会抛错；与配置无关 | 不立票 |
| `<home>/.dsh/mattskillsdeck/work-path/<根散列>.json` | `src/deck/shell/work-path-store.ts:38,74,125-127` | 工作路线存档，自有领域数据 | 否 | 读-合并-写、按会话分页、30 天裁剪与 2MB 上限；写失败不抛错；与配置无关 | 不立票 |
| 已安装 `.../node_modules/.../package.json` 的 `version` 字段 | `src/host/updateFromPackage.ts:100-130` 的 `__syncInstalledManifest` | 安装身份（版本号），不是用户配置 | 否 | 只改 `version` 一个字段，还要求 banner 版本一致，否则跳过；不是「同一份配置」 | 不立票 |
| `src/shared/time-config/src/values.ts`、`src/client/kernel/locale-data.ts`、`src/client/kernel/prompt-data.ts` | 构建期生成器 `scripts/generate-time-config.mts`、`generate-locale-config.mts`、`generate-prompt-config.mts`；`npm run typecheck` 先跑 `--check` | 仓内 `config/*.yaml` 是源，这些 TS 是派生物 | 否（源 → 派生物） | 有 `--check`，还有 `tests/verify-time-config.ts`、`verify-locale-config.ts`、`verify-locale-completeness.ts`、`verify-prompt-config.ts`、`verify-prompts.ts`；手改生成文件会被覆盖/检查判红 | 保持，不立票；新增配置仍走「YAML + 生成器 + 门禁」 |
| 探测临时文件（能力探测写一个 `ok`） | `src/host/tracker/predicateFileProbes.ts:170-171` | 临时探测，不是持久配置 | 否 | 探测用完即弃，不属于配置存储 | 不立票 |

## 3 重点发现

### 3.1 布局答案有三处家，运行时读的不是工作区文件（新发现，建议立票）

这是除 #1432 外最像「同一份配置存两份」的一处，而且是三份。

**写入侧**：`src/host/workspaceCwd.ts:144-166` 的 `handleSetupLayout` 先读 `docs/agents/workspace.yaml`；如果这个工作区还没有后端记录，它只把文件里的旧布局回给界面；如果已有后端记录，它把布局写进 `workspace.yaml`（:156-162）。紧接着，不管文件写没写成，它都调用 `choiceStore.rememberLayout` 写 `choices.json`（:163）。文件写成功回 `{ok:true, workspaceFile:'written'}`；文件写失败但 H 写成功则回 `ok:false`，并明说「布局这次只记在了本机」（:164-165）。`wf.bind` 覆盖写工作区文件时也会保留原有布局，不会把布局清空。

**读取侧**：宿主快照的 `readSetupLayoutOf` 只调 `choiceStore.getLayout` 读 `choices.json`，完全不读 `workspace.yaml`（`src/host/sessionSnapshot.ts:85-86`）；内存缓存短路时用 `_layEarly` 覆盖（:105-116）；客户端注入 `readSetupLayout` 先看会话状态，再看 `localStorage` 的 C 表（`src/client/kernel/prompts.ts:216-221`）。C 表又会被快照回包回填（`probe-select.ts:164`、`probe-snapshot.ts:270`）。也就是说，工作区文件里写着「布局是 single」，只要 H 里还是「multi」，界面和注入就会继续按 multi 走；用户手改 YAML 不会改变插件记住的答案。

**两代 ADR 的口径已经不一致**：`docs/adr/20260921-setup-layout-ask-and-remember.md:30-33` 的口径是「布局答案存浏览器本地缓存，不是仓库事实，换机器/浏览器/清缓存会重问」；后来的 #1003 把布局写进工作区文件（`workspaceCwd.ts:143` 的注释与 :156-162 的写入），而 `docs/adr/20261012-backend-decision-two-classes.md:44` 仍让 `choices.json` 继续服务布局答案。代码同时实现两代口径，于是三处都有，而且读路径只走 H/C。

**为什么这不是「合规备份」**：`choices.json` 的后端选择部分确实只是备份，ADR 明说不参与判定；但布局部分不是，它是快照的实际输入。一个不参与读取的备份可以留，一个参与读取的第二真源不能留。

**门禁缺口**：`tests/verify-1003-layout-in-file.ts:1-12` 只测宿主 `handleSetupLayout` 电话的五件事（写文件、文件为准、文件没这项才退回 H、空目录失败、无文件通道不谎报），不测快照/注入是否读文件；`tests/verify-683-host-wiring.ts:258` 测的是 H 与快照接通；`tests/verify-683-mirror-write.ts` 只钉客户端 C 表。没有一条「改 `workspace.yaml` 的 layout 后，快照或注入必须跟着变」的门禁。

**建议**：立票并先让人拍板单源方向。推荐把 `workspace.yaml` 的 `layout` 定为唯一真源（符合用户「只有 yaml 一条路」和 #1003 的方向）：`handleSetupLayout` 写文件成功才算成功，H 降为写失败时的本机备份；宿主快照/注入改为读工作区文件，文件不可用时才退回 H；客户端 C 只做显示缓存，不再参与回答。反向方案（H 是唯一记忆、从工作区 YAML 删掉 layout）也能自洽，但和用户这次的要求相反，不推荐。

### 3.2 老 `docs/agents/workspace.json` 在生产路径上从不清理（新发现，建议立票）

`src/host/workspaceCwd.ts:272-324` 的 `writeWorkspaceRecord` 只解析并覆写 `WORKSPACE_FILE_REL`，成功后只清缓存和让 workspace store 失效，**没有删除 `WORKSPACE_FILE_LEGACY_REL` 的动作**；`migrateChoiceToFile`（:325-374）也一样。`src/host/configStore.ts:196-231` 其实实现了「写 YAML → 读回比对 → 顺手删老 JSON（删不掉只警告）」的 `writeWithCleanup`，`writeWorkspaceConfig`（:253-264）也用了它，但生产代码没有一处 import 这两个工作区函数；设置走的是 `writeLocalSettings`（:284-306，没有 legacy 清理），工作区和标签配色各走自己的叶子。

这不是「历史遗留、反正没人读」：读链在 YAML 缺失时仍会退回老文件——`workspaceCwd.ts:173-188` 按 `[WORKSPACE_FILE_REL, WORKSPACE_FILE_LEGACY_REL]` 顺序读，`detectionService.ts:218` 同样两份都读，`backendDecision.ts:823` 也取 legacy 兜底。用户删掉/移走 YAML、或 YAML 损坏时，插件会复活老 JSON 里的旧后端选择。

`research/1012-final-plan.md:32` 引用的 #1012 票面原文明确要求「写成功后再删老文件，删除失败只记日志、不影响主流程」。也就是说清理本来就是票面要求，只是生产路径没接上。`tests/verify-1003-single-outlet.ts:160` 会写老 `workspace.json` 作兼容读现场，`tests/verify-683-host-wiring.ts:104,177` 也写；这些测试证明兼容读存在，但没有一条守「生产写 YAML 之后老文件消失」。

**建议**：立票。在写 YAML 成功后 best-effort 删除老文件，删不掉只记日志；再补一条门禁，至少覆盖「真实文件系统里写 YAML 后老 JSON 不再存在」和「老 JSON 存在但 YAML 有效时以 YAML 为准」。删的是用户仓库里的文件，**需要人先拍板是否允许插件自动删**；如果答案是不允许，至少要把读兜底改成带警告并在下一版移除，不能让两份长期并存。

### 3.3 快照盘缓存回放会带出旧布局（同根，建议并入 3.1）

`src/host/git-process.ts:437-476` 的盘缓存是派生物，本身不算配置，但它整份保存 snapshot，里面带着 `selection` 与 `setupLayout`。回放路径 `sessionSnapshot.ts:295-299` 只对 `selection.backendId` 做了校验，然后用 `Object.assign({}, diskb, freshModules, {fromCache:true})` 返回，**没有像内存短路那样用 `_layEarly` 覆盖 `setupLayout`**。缓存只认 `cacheFormat===3`，没有 TTL，也不判断布局新鲜度。

后果：缓存来自上一次的旧布局时，客户端会先拿到旧布局，再用它回填 C 表；等到下一次真正重建快照才可能纠正。这和 §3.1 是同一个根因（布局没有唯一的运行时读取源），单独修缓存也会被布局口径的改动重做，**建议并入布局单源票**。修法可以是回放时用当前 `_layEarly` 覆盖，或干脆从缓存里剥掉 `setupLayout`（缓存只留 GitHub/Markdown 等真正的可重建数据）。

### 3.4 `noRepoDismissed` 是占位，不是活跃第二真源（已知，不单独立票）

`settings.yaml` 里每次都会出现 `noRepoDismissed: false`，但这是核 `src/shared/config-store/src/settings.ts:230` 整份 stringify 时按默认值补上的；设置页明确不替用户种这个值（`settings-view.ts:84-93`，注释说「这张表里没有 noRepoDismissed」）。真正决定红卡收不收起的是 `localStorage` 的 `dsws:noRepoDismiss:<cwd 散列>`（`store-prefs.ts:65-69`）。文件这格目前没有读者，所以不是活跃副本；风险在将来：红卡搬进设置文件时如果直接读这格，会把用户已经收起的卡重新弹出来。处理方式是并入「无仓库红卡退役」那一票，搬的时候先读真实键或先删占位，不要单独为这个字段立票。

### 3.5 客户端 localStorage 旧键属于兜底/迁移，不是双写（合规，不立票）

这批键容易被误判成复印件，逐条核对后是三小类：

- **兜底**：`dsws.bannerFold`、`dsws.subwsAutoShown`、`dsws.listPrefs`、`dsws.templates`、`dsws.debug`。只有文件读不到/写不进/手机不通时才读或写；主路成功时一个字不写（`settings-view.ts:20-28` 的原话是「那不是双写，是过渡」）。它们确实可能显示过期值，但不会在主路成功时偷偷写第二份，且都有收口方向。
- **死键**：`dsws.selectionByCwd`、`dsws.repositoryByCwd`、`dsws.labelClicks`。已经按 #1003/#1012 退役，没有写者也没有读者，只可能留在老浏览器里，不改变行为。
- **迁移残留**：裸键 `dsws.debug`。加载时只当「升级前用户选过什么」的证据搬一次到 `dsws.debug.wf`（`settings-debug.ts:53-71`）；正常路径不会把它当活跃真源。文件路彻底走不通时仍可能写回它当秒显快照（:155-157），这属于兜底，不属于双写。

需要单独提醒的是 `dsws.debug.wf`：它是日志包按插件标识派生的本地镜像，不是设置文件本身。**#1432 收口时要确认它只做开机秒显、不再被当作行为依据**；否则只是把「副本」从缓存目录挪到了 localStorage，用户的问题换了个位置。

### 3.6 判为合规或相邻误判的项

- **`label-colors.yaml` / 老 `label-colors.json`**：YAML 是第一读取源，老 JSON 只在 YAML 不在时兼容读；迁移/发布成功后主动删老文件（`label-colors.ts:251-344,288-298`），有 `tests/verify-markdown-label-colors.ts`。这是「迁移后清理」的正确样子，可当作 §3.2 的修法样板。
- **`config/*.yaml` → 生成 TS**：仓内 19 份 YAML 是源，`values.ts` / `locale-data.ts` / `prompt-data.ts` 是构建期派生物，三个生成器都支持 `--check`，`npm run typecheck` 先检查，配套门禁见 §2.3。`config/copy/` 下的十份是按语言/文案分族的源，不是同一份数据的十份拷贝；`config/languages.yaml` 是语言清单。这些都不需要整改。
- **计划游标、工作路线存档、命名跟踪状态、诊断日志、已安装 manifest 的 version、探测临时文件**：各自领域自有数据或派生物，不是同一份配置（各自的依据见 §2.3）。
- **`docs/agents/issue-tracker.md` 的 declaration 与 `workspace.yaml` 的 `backendId`**：前者是程序自己认的仓库声明，后者是人选的唯一真源；ADR 20261012:25-33 把「人选」与「程序自己认」分成两类来源，两者冲突时人选优先，这是设计而不是副本。
- **`docs/agents/domain.md` 与插件记住的布局答案**：前者是仓库级布局事实，后者是插件对用户的记忆（ADR 20260921:30-33 明确两者回答不同问题）；手改 `domain.md` 不会改变插件记住的答案，这是已知语义，不是复印件。若 §3.1 把布局单源定到 `workspace.yaml`，这两个文件仍回答不同问题，不能合并。
- **构建产物 `.build/`、`package/lib`、`scripts/generated/*`**：构建生成或自动检查生成，不是手工维护的第二份数据源，本报告不逐文件审计；若发现有人手改生成文件，应由生成器/门禁判红，不靠人工巡检。

## 4 是否立票

| 事项 | 建议 | 理由 | 需要人拍板 |
| --- | --- | --- | --- |
| 调试日志开关的宿主副本 `log-switch.json` | 已有 #1432，不另立 | 已列入整改；HEAD 上仍是副本，工作区已有实现待合并 | 否，按 #1432 验收即可 |
| 布局答案三处家（工作区 YAML / `choices.json` / localStorage C；含快照与注入的读取路径） | **立新票** | 运行时读 H/C 不读 YAML，用户手改文件无效；无一致性门禁；盘缓存回放还会带旧值 | **是**：单源选哪条路（推荐工作区 YAML），以及是否允许改快照/注入的读取路径 |
| 老 `docs/agents/workspace.json` 的清理与门禁 | **立新票** | #1012 票面要求写成功删老，生产路径没接上；YAML 缺失时读链会复活旧选择 | **是**：是否允许插件自动删用户仓库里的老文件 |
| 快照盘缓存回放旧布局 | **并入布局票** | 和布局三处家同一根因；单独修也会被布局口径变化重做 | 否，作为布局票的一项验收 |
| `settings.yaml` 的 `noRepoDismissed` 占位 | 不单独立票，并入无仓库红卡退役票 | 文件这格无读者，真实状态在 localStorage；将来搬家时处理默认 false | 否 |
| 客户端 `localStorage` 旧键（兜底/死键/迁移残留） | 不立票 | 主路成功不写、死键无读者；属已知过渡 | 否 |
| 其余派生/自有领域数据 | 不立票 | 见 §2.3 与 §3.6 | 否 |

## 5 给用户的行动建议（3 条以内）

1. **先拍板布局单源，再立票落地。** 推荐把 `docs/agents/workspace.yaml` 的 `layout` 定为唯一真源：写文件成功才算成功，H 只做本机备份，快照/注入改读工作区文件，localStorage C 只做显示缓存；顺带修掉盘缓存回放带旧布局。这样才真正满足「只有 yaml 一条路」。反向方案（H 是唯一记忆、从 YAML 删 layout）也能自洽，但和这次的要求相反。
2. **收口 #1432。** 合并工作区里那套未提交实现，删掉宿主缓存目录的 `log-switch.json`，让日志底座通过 `switchSource` 直接读 `settings.yaml` 的 `debug.enabled`；再补一条一致性门禁，并确认 `dsws.debug.wf` 只做开机秒显、不再回写设置文件。
3. **清理老 `docs/agents/workspace.json`。** 写 YAML 成功后 best-effort 删老文件，删不掉只记日志，加一条「写 YAML 后老 JSON 不在」的门禁。因为删的是用户仓库里的文件，动手前先拍板；如果暂时不允许自动删，至少把兼容读降级为带警告的兜底，并排期移除。

## 6 复核方法与未纳入清单

**复核方法**：在 `src/` 全树按写入面搜 `writeFile`、`writeFileSync`、`localStorage`、`sessionStorage`、`fs.promises`、`writeText`、`writeDiskCache`、`persist` 等字样，再逐个打开写入口和对应读入口，按 §1 的判据分类；同时对照 ADR 20261021-config-ownership.md、ADR 20261012-backend-decision-two-classes.md、ADR 20260921-setup-layout-ask-and-remember.md 与 `research/1330-yaml-配置化调查.md` 的既有结论。本报告没有跑门禁：本次没有改代码或测试，跑门禁不会增加判定；文中提到门禁是为了说明现有覆盖与缺口，不代表本次执行过。

**基线说明**：审计基线是 `main` 的 `2298c11e`。审计期间工作区有 #1432 的未提交改动（涉及 `src/host/logStore.ts`、`src/host/settingsPhones.ts`、`src/host/index.ts`、客户端调试开关与相关测试/配置），本报告只在调试开关一条注明「已列入整改」，其余结论以 HEAD 的提交内容为准；等 #1432 合并后，表 3 第 1 行与表 2 的 `dsws.debug.wf` 两行需要按新实现复核一次。

**没有逐项纳入的**：浏览器与用户机器上实际存在的 localStorage 值、`<home>` 与 `<cache>` 里的真实文件内容（本报告只看代码路径，没有读用户数据）；`node_modules`、构建产物 `.build/`、`package/lib`、`package/scripts`、`scripts/generated/*`（构建/生成物，不是手写第二份数据源）；仓库外的用户备份或手工拷贝。

**已知局限**：本报告只能证明「代码路径上存在/不存在第二写入口与第二读取点」，不能证明某台机器上两份文件此刻值是否相同；要判断实际漂移，需要在用户机器上对比 `settings.yaml`、`choices.json`、localStorage 与 `workspace.yaml` 的内容。布局那一项的实际表现还取决于用户当前工作区里有没有 `choices.json` 记录、旧快照缓存是否还在，建议按 §3.1 的读取路径做一次实机复核。
