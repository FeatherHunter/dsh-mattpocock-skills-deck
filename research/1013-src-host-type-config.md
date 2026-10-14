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

---

# 第二轮补充（2026-10-14 晚）

上面那一段是在 `40c222dd` 时刻写的。之后仓库又前进了两个提交，而且第一轮漏了一类门禁（归属表）。这一段补齐那部分，并把上面几处读数更新到 **`git rev-parse HEAD` = `40ce748a`**（提交时间 2026-10-14 16:51；比第一轮多出的两个提交是 `5e7c74aa` 把这份笔记本身入库、`40ce748a` 修 dispatch 冒烟的过时形状）。读第一轮的结论时以这一段为准。

## 补一：改名一个文件会踩到哪些门禁（第一轮没查的归属表）

先把结论说清：**把 `src/host/workspaceLabelColors.js` 改名成 `.ts`，真正会当场变红的门禁是「门禁归属表」那一条，不是类型检查那一条。**

类型检查那一条，第一轮说对了，而且这一轮用更硬的办法复现过：借一份临时索引（`GIT_INDEX_FILE` 指向 `.dsh-tmp/1131-research/tmp-index`，不碰真索引）把这份文件在索引里改名，再跑 `node scripts/typecheck.mts`，结果从「不通过 35 条、缺口 13 条」变成「不通过 36 条、缺口 14 条」，新多出来的那一条正是 `src/host/workspaceLabelColors.ts 不在任何配置的检查范围内`。也就是说「多一个没人圈的 `.ts` 就多一条失败」这句话，一字不差地成立。

归属表那一条是这么踩上的：

- `tests/verify-1003-single-outlet.js:73` 写着 `const lcMod = await imp('src/host/workspaceLabelColors.js');`，这份文件的名字是以字符串字面量的形式被这份测试「点名」的；
- `scripts/gate-map.mjs:14-22` 说明归属是怎么推出来的（读文件、载入模块、静态 import 的说明符、以及兜底认「磁盘上真实存在的源码路径字面量」），这条测试就落在最后那条兜底里；
- `tests/verify-gate-map.js:54-68` 做新鲜度对账：把归属重新推导一遍，与 `tests/gate-map.json` 逐字符比，不一致就判红，并让你重跑 `node scripts/gate-map.mjs`；同文件 `:110-116` 还额外要求「表里记的每个守卫路径都在磁盘上真实存在」；
- 实测：把上面那个字面量临时改成 `.ts`、重新推导一遍（改完立刻还原，`git status` 确认工作树没动过），这份门禁的守卫清单从 **12 条掉到 11 条**，`src/host/workspaceLabelColors.js` 那条从表里消失。**两件事同时发生**：表里的旧路径在磁盘上不存在了（`:116` 判红），重新推导的结果与表不一致（`:68` 判红）。

所以改名要配套三件事，缺一件就有一道门禁红：

1. `tests/verify-1003-single-outlet.js:73` 的字符串字面量跟着改成 `.ts`（不改的话，那条守卫指向一个不存在的文件）；
2. 重跑 `node scripts/gate-map.mjs` 重录 `tests/gate-map.json`（这一步会改一份入库的派生表，重录后的差异应当只有这一条）；
3. `tests/same-layer-baseline.json` 里那条记名的存量例外也要跟着改。它现在写的是 `{"file": "src/host/workspaceCwd.js", "spec": "./workspaceLabelColors.js", "resolved": "src/host/workspaceLabelColors.js", "owner": "#957（工作区文件写器：首绑落盘与无文件保护自动写）"}`；这份基线的文件头写着「存量豁免清单：只许减不许增；拆分票消掉一条边就同票删一条」。真正核这份清单的是 `tests/verify-dependency-rules.ts`（`:19`、`:556-572`），它把清单读成 `file|resolved` 的允许集合，**清单里有、图上没有的条目只记一条信息**（`:620` 那行的「豁免条目已消除可清理」），不判红。所以改名之后这条不会把门禁弄红，但会变成一条永远匹配不到的旧条目——这正是另一张票 #1154 正在收拾的那类账。

顺带把第一轮第 3 节漏说的两处补上，它们都**不需要动**：

- `scripts/typecheck.mts:141-151`：配置清单是「磁盘上有这份配置就自动进检查」，注释原文写着「判据是『磁盘上有这份配置』而不是『某张登记表里写了这份配置』：新增一份配置就自动进检查，不需要有人记得去别处登记」。所以「登记进 `scripts/typecheck.mts` 的配置集合」这句话在今天的实现里是自动的，没有可登记的清单；
- `scripts/build.mjs`：`src/host → package/lib` 这棵镜像树早就在搬家表里（`scripts/build.mjs:837` 那一行 `{ src: 'src/host', pkg: 'package/lib' }`，以及 `:812-830` 那段「新树投放」注释），`.ts` 由逐份转译写入、`.js` 逐字节复制，新增一份 `.ts` 走的是同一条路，构建脚本一个字不用改。发布包 `package/package.json` 的 `files` 只列 `lib`、`shared`、`deck`、`tracker` 等产物目录，`tsconfig.json` 不会进包。

`tests/handwritten-js-baseline.json` 这一份也说清（第一轮说得对，这里补上原文与规则出处）：它的 `note` 写着「手写 JavaScript 文件清单……**只许减不许增**：名单里少一个文件是正常进展（摸到谁转谁）」，今天 714 条，里面就有 `src/host/workspaceLabelColors.js`。判红的地方只有一处：`scripts/typecheck.mts:502-508`，只有「仓库里多出一份手写 `.js`」才报 `棘轮涨了`；名单里少一条走 `:511-513` 的信息级「棘轮已缩」。所以改名不会让这一条红，但基线里那条会变成幽灵条目（#1154 的口径是「减要一次减干净」）。

## 补二：六问的更新与更准的答案

- **问题 1（缺口判据）**：第一轮给的 `scripts/typecheck.mts:437-452` 是准的。补三条原文：判据用的集合是 `facts.repoScriptsInSrc`（`:445`），后缀口径写在 `:66-67`（`.ts`、`.tsx`、`.mts` 都算），配置来源是 `:147-151`。判红原文是「`xxx` 不在任何配置的检查范围内，它今天一次类型检查都没过」。
- **问题 2（改名之后会发生什么）**：类型检查 +1 条缺口；归属表两条断言同时红（上面补一）；归属表之外的构建、产物比对、行数、棘轮都不会红。想让这些都不红，就得照补一的三件事配套做，并且先有一份 `src/host/tsconfig.json` 把 14 条缺口收回去。
- **问题 3（现成模板与登记清单）**：模板仍是 `src/deck/tsconfig.json`（本域那份 `src/tracker/tsconfig.json` 是同一个模子，而且它现在已经入库、不是未提交状态：`git log` 显示 `2482604f` 落地、`40c222dd` 跟进口径）。**要登记的清单是空的**——类型配置按磁盘自动发现，构建按目录扫描，两处都不需要人工登记。这跟 AGENTS.md「TypeScript 优先」那节第 2 条写的「同步登记到对应 `tsconfig` 的 `include` 与 `scripts/build.mjs` 清单」在今天的具体实现上不矛盾：那一句要防的是「新文件静默不进编译」，而这两条路今天已经是自动的（`.ts` 落在已登记目录里就自动进）。
- **问题 4（归属）**：第一轮说「今天无主」仍然成立。这一轮补一条更根本的原因：#1040 那张票的标题虽然叫「地图05开发：宿主侧转TypeScript」，但它做的是 `src/deck/shell/` 那六份「宿主侧」的壳文件（票面原文：「宿主侧六份壳文件（call-shell / call-budget / plan-cursor / session-workdir / write-mutex / table-cell）加 edge-landing 三个读写转完 TypeScript」），不是 `src/host` 这一片目录——「宿主侧」在那张图里指「工具壳跑在宿主上的那半边」，与目录名 `src/host` 不是一回事。所以 `src/host` 从来没有被任何一张票划进范围，它不是「做完又被回退」，而是「一直没轮到」。
- **问题 5（#1148 那条路）**：`src/tracker/tsconfig.json` 已经入库（`2482604f`），#1148 还在开；今天跑 `collectFacts()` 的读数是「`src/tracker/tsconfig.json` 声明 99 个、闭包 115 个、57 条错误、退出码 1」——比 #1107 关票时记的 117 条已经降了，说明那条线正在按「先补配置、再让存量错误暴露、再逐个修」推进。把同一套办法套到 `src/host` 上的实测（临时在 `src/host` 下放一份探针配置、借 typecheck 自己的对账跑一遍、跑完删掉）：声明 16 个、闭包 53 个，**缺口 13 条清零、不新增重复归属、不新增越界**；顺 import 带进来的 30 个文件落在 `src/shared`（15 份手写 `.js`）与 `src/tracker`（15 份 `.ts`）里，它们本来就各有归属；356 条错误全部落在 `src/host` 自己的 13 份 `.ts` 上（`sessionSnapshot.ts` 60、`sessionRefresh.ts` 56、`detectChain.ts` 50、`refresh/gate.ts` 41、`refresh/ledger.ts` 41、`git-process.ts` 29、`snapshotBuild.ts` 24、`platform/win32/index.ts` 13、`snapshotInflight.ts` 12、`platform/darwin/index.ts` 10、`platform/linux/index.ts` 10、`refresh/refusal-text.ts` 5、`snapshotEnvelope.ts` 5），头几条是 `src/host/detectChain.ts(10,18): error TS7006: Parameter 's' implicitly has an 'any' type.` 这一族。换句话说：这一片不像 #1107 那样会把自己的债甩给别人，356 条全在本域内。
- **问题 6（判断）**：(a) 与 (b) 维持第一轮的答案；(c) 维持「需要新开一张挂在 #1013 下」；(d) 要改——第一轮说「硬做不会让任何门禁变坏」，这句不完整，见下。

## 补三：(d) 硬做的最坏后果，说具体

如果有人现在就把 `src/host/workspaceLabelColors.js` 改名成 `.ts`（不建配置、不动测试与表）：

1. `npm test` 的第一段 `npm run typecheck`（`package.json:17`：`npm run typecheck && node scripts/build.mjs && node scripts/verify-chain.js && npm run test:smoke`）当场红，红的条数从 35 涨到 36，多出来的正是那一条新缺口。第一段红，后面三段根本不会跑——`npm test` 停在原地。
2. 就算有人绕过第一段去跑长串（`npm test` 的第一段挡住的是整条 `npm test`；单独跑 `node tests/verify-gate-map.js` 也会红），归属表那两条断言会红，报错会直接说「归属表里记的每个 guards 路径都在磁盘上真实存在（不存在的 1 条）」与「归属表是最新的……不一致就重跑 node scripts/gate-map.mjs」。
3. 不会坏的是：构建照旧把这份文件转译进 `package/lib`、产物比对仍逐字节一致（第一轮已核）、行数门禁（`tests/verify-file-granularity.js`，350 有效行上限）不受影响、手写 `.js` 棘轮只会缩。
4. 真正的代价是「攒债」：这份文件从此变成「改了后缀、没人检查」的一堆里的一员，正是 #1148 描述的那个病因；而且它比别的债更隐蔽——归属表那道红会把人指向「重跑生成器」，照做之后表是绿了，缺口还留在类型检查里。

所以正确的最小路径是：**同一张票里先落 `src/host/tsconfig.json`（缺口 13 → 0），再决定 356 条怎么还**；356 条还不清之前，`npm test` 第一段不会变绿，这一点与 #1148 那条线是同一个道理，账要记在明处。单独改名这一步，无论放前放后都不该做。

## 补四：这一片的盘子有多大（给开票估工的人）

`git ls-files 'src/host/**'` 今天给出 74 份被跟踪文件：**16 份 `.ts`、57 份 `.js`**（外加子目录里的既有产物，不含在 74 里）。16 份 `.ts` 里 13 份是缺口清单上的，另外 3 份（`outbound/admission.ts`、`outbound/tiers.ts`、`refresh/chain-ride.ts`）因为被别的配置顺 import 看到，今天不在缺口名单上——这也是为什么新增配置之后 `claimed` 是 16 份而闭包是 53 份。

也就是说，这一片的「清零」不是一票能干完的活：先补配置（13 条缺口清零、356 条错误记账），再按「动到哪里就转到哪里」把 57 份手写 `.js` 逐份迁移，每份走「先修后转、两次提交」。开票时值得把这两段拆开写，别把 57 份的迁移压进补配置那一票。

## 补五：356 条按错误码分类（回答「同票还清还是拆票」）

第二轮末尾留了个答不了的问题：「356 条一句都没分类，所以不知道同一张票还清、还是要拆」。这一节把它补上——用第一轮留下的原始输出 `.dsh-tmp/1131-research/host-probe-errors.txt` 按错误码归堆：

| 错误码 | 条数 | 人话 |
| --- | --- | --- |
| TS7006 | 226 | 参数没写类型，隐式 any（`Parameter 'deps' implicitly has an 'any' type`） |
| TS2339 | 45 | 在不认识的对象上取属性（`Property 'message' does not exist on type '{}'`） |
| TS7053 | 42 | 用字符串下标去取一个未声明的对象 |
| TS2591 | 10 | 找不到 `process`，因为配置里 `types: []`，没带 Node 的类型 |
| TS7005 / TS7034 | 9 + 9 | 变量隐式 any（一个是有初始化器的写法，一个是「有些位置定不下类型」） |
| TS2353 / TS7031 | 4 + 4 | 对象字面量多给了不认识的属性 / 解构出来的名字没类型 |
| TS2304 | 2 | 找不到这个名字（`Cannot find name '_selEarly'`） |
| TS2322 / TS2345 / TS2454 / TS2559 / TS2769 | 各 1 | 真的对不上：类型不可赋值、实参不匹配、变量用在使用前、对象没有共同属性、重载不匹配 |

按「要动脑子多少」再归一次：

- **248 条（70%）是纯标注活**：TS7006 + TS7005 + TS7034 + TS7031，加类型不改行为，机械但量大；
- **10 条是配置层的**：TS2591 全是找不到 `process`。注意 `src/deck/tsconfig.json` 那份模板（`types: []`）就是这么设计的，所以要么给 `src/host` 单独带上 Node 类型，要么改成不直接引用 `process`——这是补配置那一票要顺手定的小取舍；
- **约 98 条要真读代码**：TS2339 + TS7053 + TS2353 + 那 5 个单例。多数仍是「把来源标清楚就消失」，但其中三条看着不是标注问题，值得单独验一眼，别顺手改掉：
  - `src/host/sessionRefresh.ts(205,78): error TS2304: Cannot find name '_selEarly'`——名字不存在，说明那一行在运行时根本不会走到；
  - `src/host/snapshotBuild.ts(226,31): error TS2454: Variable '_capDiag' is used before being assigned`；
  - `src/host/sessionRefresh.ts(72,82): error TS2353: 'ifNoneMatch' does not exist in type '{ force?: boolean }'`——调用方给了一个被调方不认得的键，像是两边契约错位。

结论（给开票人的一句话）：**分类之后不必按文件簇拆票，按性质拆更顺**——「配置 + 248 条标注」是一票、「约 98 条要读代码的」是一票（其中那三条疑似真缺陷单独建 bug 票）、57 份 `.js` 的迁移再另算。这样每一票的验收都能写成一句说得清的话，也不会出现「票开着、红着、没人知道还欠什么」。
