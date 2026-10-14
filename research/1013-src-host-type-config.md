# src/host 域为什么没有类型检查配置：缺口、代价与下一步

这份笔记回答一个问题：**`src/host` 这一片源码今天一次类型检查都没过，这件事是多大、谁该背、怎么修** —— 起因是刚关闭的 [#1131](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1131) 改动落在这一片里，而票面「下一步」只写了一句「留给类型迁移那条线」。

依据的仓库状态：`git rev-parse HEAD` = `40c222dd`（2026-10-14 16:37 前后在本机工作树上实测；工作树当时只有 7 份别的会话新写的未跟踪调研笔记，不影响这里的读数）。给要做决定的人（维护者）与将来接手这张票的人读。

---

## 1. 「缺口」这条判据是什么意思

`scripts/typecheck.mts` 是类型检查的唯一入口，它给 `src/` 下**每一个**源码文件找「哪份 tsconfig 真的看过它」，找不到就判一条硬失败：

- 配置从哪来：`scripts/typecheck.mts:148` —— 拿 git 文件清单里的 `**/tsconfig*.json`，**按目录自动发现，不需要在别处登记**；
- 「看过谁」用程序闭包算（顺 import 走到的也算看过）：`scripts/typecheck.mts:200-204`、`:243-249`；
- 判据本体：`scripts/typecheck.mts:437-452`（断言 B，硬失败），报错原文是「`xxx.ts` 不在任何配置的检查范围内，它今天一次类型检查都没过」；
- 同一份配置还有另外四条硬失败：`C 重复归属`（`:454-467`，只认 include 声明）、`D 越界`（`:469-485`）、`E 类型错误`（`:487-496`，配置自己编译不过就判红）、`F 棘轮涨了`（`:498-509`，手写 `.js` 只许减不许增；名单变短只记一条信息）。

这道门禁被挂进了 `npm test` 的第一段：`package.json` 的 `"test": "npm run typecheck && node scripts/build.mjs && node scripts/verify-chain.js && npm run test:smoke"`；`tests/verify-typecheck.mts:5` 也写明「npm test 的第一段已经是 `npm run typecheck`」。

## 2. 今天实际红在哪：35 条，13 条属于 src/host

在本机工作树跑 `node scripts/typecheck.mts`（退出码 1）得到的 35 条不通过，逐类归属：

| 条数 | 类别 | 落点 | 谁能修 |
| --- | --- | --- | --- |
| 13 | 缺口 | `src/host` 的 13 份 `.ts`（清单见下） | **今天没有任何票认领** |
| 20 | 重复归属 | `src/tracker/**` 同时被 `src/tracker/tsconfig.json` 与 `tsconfig.contract.json` 声明 | 别的会话正在做的 #1147/#1148 那条线 |
| 1 | 类型错误 | `src/tracker/tsconfig.json` 报 57 条（`detectionService.ts` 等） | 同上 |
| 1 | 棘轮涨了 | 新增手写 JS `tests/verify-1150-plan-store-durable.js` | 同上（#1150 那条线） |

13 份缺口清单（都是 git 跟踪的正式源码，不是临时文件）：`src/host/detectChain.ts`、`git-process.ts`、`sessionRefresh.ts`、`sessionSnapshot.ts`、`snapshotBuild.ts`、`snapshotEnvelope.ts`、`snapshotInflight.ts`、`platform/darwin/index.ts`、`platform/linux/index.ts`、`platform/win32/index.ts`、`refresh/gate.ts`、`refresh/ledger.ts`、`refresh/refusal-text.ts`。

（`src/host` 里另外三份 `.ts` —— `outbound/admission.ts`、`outbound/tiers.ts`、`refresh/chain-ride.ts` —— 不在缺口名单里，因为它们被别的配置顺 import 看到了。）

也就是说：**`npm test` 第一段今天就是红的，13 条缺口是其中一个独立原因，不是 #1131 造成的。**

## 3. 给 src/host 补一份配置会怎样：缺口清零，代价是 356 条错误

拿现成模板量了一次（探针配置放在不入库的 `.dsh-tmp/1131-research/host-tsconfig-probe.json`，圈 `src/host/**/*.ts`，其余照抄 `src/deck/tsconfig.json`）：

```
错误总条数: 356
sessionSnapshot.ts 60 ／ sessionRefresh.ts 56 ／ detectChain.ts 50 ／
refresh/gate.ts 41 ／ refresh/ledger.ts 41 ／ git-process.ts 29 ／
snapshotBuild.ts 24 ／ platform/win32/index.ts 13 ／ snapshotInflight.ts 12 ／
platform/darwin/index.ts 10 ／ platform/linux/index.ts 10 ／
refresh/refusal-text.ts 5 ／ snapshotEnvelope.ts 5
```

头几条长这样（`src/host/detectChain.ts(7,35): error TS7006: Parameter 'deps' implicitly has an 'any' type.`）——是「改了 `.ts` 后缀、体内还是旧写法」那一族欠账，和 #1148 描述的病同一个形状。独立跑了两次（一次是我自己的探针、一次是同参数的第二次探针），两次都是 356 条。

补这份配置的连带影响，逐条查过：

- **不会新增重复归属或越界**：今天没有任何配置声明 `src/host/**`（`tsconfig.client.json` 圈 `src/client/**`，`tsconfig.contract.json:33-48` 只圈 `src/tracker` 的契约目录与几份纯模块，域配置各自圈自己的目录）。新配置 `include: ["**/*.ts"]` 正好落在自己目录下，满足断言 D。
- **不用改构建**：`scripts/build.mjs:1132` 的 `copyHostJs` 只复制 `.js`（`.ts` 由投递步骤转译写入），配置不会进发布包；`scripts/build.mjs:854-869` 的 `collectMovedTs` 只收 `.ts`，不会把配置当源码。
- **不用手工登记**：见第 1 节的自动发现（`:148`）。#1107 票面里那句「登记进 `scripts/typecheck.mts` 的配置集合」在今天的实现里是自动的。
- **棘轮不受影响**：把一份 `.js` 改名成 `.ts` 只会让 `tests/handwritten-js-baseline.json`（714 条，只许减不许增）少一条，门禁记一条「棘轮已缩」的信息，不判红。

## 4. 现成模板与先例

- **模板**：`src/deck/tsconfig.json`（#1107 落地）——`include: ["**/*.ts"]` 目录通配、`allowJs: true` + `checkJs: false`（混编期）、`target ES2020`、`lib ["ES2020","DOM"]`、`module ESNext`、`moduleResolution Bundler`、`noEmit`、`strict`、`types: []`、`skipLibCheck`。它的文件头注释（`:8-21`）把这段历史写得很清楚：`#1039` 先建、`#1107` 放宽到整片域、放宽后顺 import 看到 `src/tracker` 的 4 份文件 117 条错误，交给 #1148。
- **同族先例**：#1148（`src/tracker` 四份 JSDoc 时代文件严格模式下 117 条错误，挡住 npm test 第一段）就是这套做法暴露出来的账；#1107 的关票评论明确写了「先落地并如实记账、欠账交给对应域」这个取舍。
- **口径**：地图 01 的讨论结论 Q5 与规格单 #1098 第 5 条定的是「每个域一份 tsconfig、include 写目录通配、一个文件只属于一个域目录、构建按目录扫描」。
- **一处旁证**：`scripts/build.mjs:830-835` 的注释在记「新树还没有自己的 tsconfig」时，点名的是 `src/tracker` 与 `src/deck` 两片（deck 那份有票 #1107、tracker 那份当时没票），**没提 `src/host`** —— 这一片的缺口一直没人替它说过话。

## 5. 归属：今天无主

- 地图 [#1013](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1013)（让 TypeScript 进构建与测试）下今天 5 张未关闭子票：`#1146`（门禁时间压缩助手的泵）、`#1136`（房间纪律依赖规则指空目录）、`#1154`（旧路径表述与两份基线的幽灵条目）、`#1153`（第三方包规则假阳）、`#1152`（同层互引判据缺席）——**没有一张是「给 src/host 补类型配置」**；地图自己的 `## Not yet specified` 写着「暂无。全票无未决事项」。
- 全库检索「类型配置」只有 8 张票命中，与 `src/host` 相关的 0 张。
- 所以 #1131 票面那句「留给类型迁移那条线」指的是一个**不存在的所有者**。

## 6. 判断与下一步

**(a) #1131 票面那句「下一步」对不对？** 一半对。「单独改名只会多一个缺口」这条路是准确的：改名会让缺口从 13 条变成 14 条，而且 AGENTS.md「TypeScript 优先」那节第 2 条要求「转完要接上构建：同步登记到对应 tsconfig 的 include」，今天连可登记的配置都不存在。错的那一半是「留给类型迁移那条线」——那条线里没有这张票，也没人认领这 13 条缺口；顺带说清，`npm test` 第一段今天本来就是红的（35 条，13 条属于这一片）。

**(b) 最小正确路径**：照 `src/deck/tsconfig.json` 的形状新增 `src/host/tsconfig.json`（`include: ["**/*.ts"]`，混编开关、ES2020 + DOM、strict、noEmit），先把 13 条缺口清零；再把探针量出来的 356 条错误在本域内还清（配置自己编译不过，断言 E 会判红）。做完之后，`src/host` 里逐份 `.js` → `.ts` 的迁移才是普通工作（先修后转、两次提交，照 AGENTS.md）。

**(c) 该由哪张票承担**：今天没有票，需要新开一张，挂在 #1013 下（`wayfinder:task`），比照 #1107 的写法写清验收（缺口 13 → 0、本域 0 条类型错误、构建产物逐字节一致）。一个取舍要人定：356 条错误是**同一张票里一并还清**（错误全在本域，不像 #1107 要交给别人；不还清 `npm test` 第一段就还是红的），还是**先落配置、把错误拆成后续票**（#1107 走的就是这条路，代价是闸门红着，但账记在明处）。

**(d) 硬做的最坏后果**：把 `src/host/workspaceLabelColors.js`（#1131 动过的那份）直接改名成 `.ts` 而不建配置 —— 缺口 13 → 14，`npm test` 第一段照旧红（原因不变，只是多一行），文件本身落进「改了后缀、没人检查」那一堆，正是 #1148 的病因；构建、门禁、发布包都不会因此变坏（`copyHostJs` 照转译 `.ts`，棘轮只会缩），所以这是一步「看起来在推进、实际在攒债」的动作。**不建议现在单独改名。**

## 还没查清的地方

1. 356 条只按文件分过组，没有逐条分类（哪些是 TS7006 隐式 any 可以批量补标注、哪些要动数据结构）。真正开票时值得先做一次分类，才能估工期、才能决定拆不拆票。
2. 本机 `node_modules` 缺 jsdom 的传递依赖 `is-potential-custom-element-name`，3 条浏览器类门禁（`verify-669-collapsed-recoverable.js`、`verify-669-switch-visible.js`、`verify-log-switch-597.js`）在本机必红，与这件事无关；本笔记没有验证它们在装全依赖的机器上是否绿。
3. `src/host` 下 57 份手写 `.js` 的迁移顺序（谁先谁后、哪些文件互相拖累）没有排；本笔记只回答了「配置与第一份改名的先后」。
4. 第 2 节那 20 条重复归属与 57 条 tracker 类型错误属于另一个会话正在做的线，读数会随后续提交变化；本笔记的数字是 `40c222dd` 时刻的快照。

## 怎么复核这份笔记

```powershell
git rev-parse HEAD                                  # 应看到 40c222dd 或其后的提交
node scripts/typecheck.mts                          # 全量：看「不通过 N 条」与缺口清单
node node_modules/typescript/bin/tsc -p .dsh-tmp/1131-research/host-tsconfig-probe.json --pretty false   # 只看 src/host 那 356 条
```

（探针配置在 `.dsh-tmp/` 下，不入库；它不在 `git ls-files` 里，所以不会被 `scripts/typecheck.mts` 当成第五份正式配置。）
