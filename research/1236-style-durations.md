# 界面动画与过渡时长清单

这份文件是票 #1236 的底账：把界面代码里写死的动画、过渡、闪烁时长一处一处列出来，将来收拢时照着它做，不用再写一次性脚本去猜。

## 它是怎么来的

2026-10-16 做票 #1215「全仓时间参数收拢」时，调查脚本按判据把候选分成三桶：行为类（超时、节拍、有效期、退避）、样式类（动画与过渡时长）、时段计算。行为类已经全部收进 `config/` 下三份 YAML；样式类当时按 `docs/adr/20261016-time-config-yaml.md` 第 5 节判为「另有一件事」，于是开了票 #1236，并把清单落在本文件里。

## 判据（第二版，比第一版严）

第一版判据是「一行里出现时间词又有数字」，结果把 SVG 路径里的 `M12 21s-6-5.1…`、`rgba(...,.12)` 这类写法也算成了时长（`src/client/kernel/icons.js` 的两条就是这么来的）。现在的判据是：

1. 时长必须出现在 CSS 的 `transition` / `transition-duration` / `transition-delay` / `animation` / `animation-duration` / `animation-delay` / `-webkit-animation` 声明的值里；或者出现在 JavaScript 里同名的样式属性字符串上（例如 `animation: 'dsws-spin 1s linear infinite'`）。
2. 时长必须是紧跟数字的 `s` 或 `ms`（`.25s`、`300ms`），并且必须落在上面那类声明的值里面。
3. 范围是 git 跟踪的 `src/client/**` 下 `.js` / `.ts` / `.tsx`，本次参检 175 个文件。

按这个判据，界面里一共有 **42 处**，落在 8 个文件里。

## 清单

| 文件:行 | 声明 | 时长 | 原文（截断） |
| --- | --- | --- | --- |
| `src/client/kernel/styles.js:27` | transition | .25s / .2s | `transition:max-width .25s ease,opacity .2s ease,margin .25s ease` |
| `src/client/kernel/styles.js:29` | transition | .25s / .2s | `transition:max-width .25s ease,opacity .2s ease` |
| `src/client/kernel/styles.js:33` | transition | .25s | `transition:padding .25s ease` |
| `src/client/kernel/styles.js:103` | transition | .12s | `transition:opacity .12s` |
| `src/client/kernel/styles.js:184` | transition | .12s | `transition:background .12s,border-color .12s` |
| `src/client/kernel/styles.js:272` | animation | .8s | `animation:dsws-spin .8s linear infinite` |
| `src/client/kernel/styles.js:275` | animation | .8s | `animation:dsws-spin .8s linear infinite` |
| `src/client/kernel/styles.js:278` | animation | 2.4s | `animation:dsws-flash-amber 2.4s ease-out 1` |
| `src/client/kernel/styles.js:279` | animation | 2.4s | `animation:dsws-flash-green 2.4s ease-out 1` |
| `src/client/kernel/styles.js:297` | transition | .15s | `transition:background .15s,border-color .15s` |
| `src/client/kernel/styles.js:298` | transition | .15s | `transition:transform .15s,background .15s` |
| `src/client/kernel/styles.js:304` | transition | .12s | `transition:background .12s` |
| `src/client/kernel/styles.js:339` | transition | .12s | `transition:background .12s ease` |
| `src/client/kernel/modal-fields.js:39` | transition | .12s | `transition: 'border-color .12s,background .12s'` |
| `src/client/views/feedback/feedback-styles.js:32` | animation | .55s | `animation:dsws-ripple .55s ease-out` |
| `src/client/views/feedback/feedback-styles.js:34` | animation | .6s | `animation:dsws-ringout .6s ease-out` |
| `src/client/views/feedback/feedback-styles.js:38` | animation | .5s | `animation:dsws-sheen .5s ease` |
| `src/client/views/feedback/feedback-styles.js:44` | animation | .45s / .4s | `animation:dsws-fb-okflash .45s ease-out forwards` / `animation:dsws-fb-shake .4s ease-out 1` |
| `src/client/views/feedback/feedback-styles.js:48` | animation | .9s | `animation:dsws-fb-dots .9s ease-in-out infinite` |
| `src/client/views/feedback/feedback-styles.js:49` | animation-delay | .15s / .3s | `animation-delay:.15s` / `animation-delay:.3s` |
| `src/client/views/feedback/feedback-styles.js:51` | animation | 1.6s | `animation:dsws-fb-breath 1.6s ease-in-out infinite` |
| `src/client/views/feedback/feedback-styles.js:53` | animation | .6s | `animation:dsws-fb-success-ring .6s ease-out` |
| `src/client/views/feedback/feedback-styles.js:55` | animation | .35s | `animation:dsws-fb-pop .35s ease-out` |
| `src/client/views/feedback/feedback-styles.js:60` | animation | 1.1s | `animation:dsws-fb-skel 1.1s linear infinite` |
| `src/client/views/skillDetail/PixelStyles.ts:11` | transition | .12s | `transition:transform .12s steps(2,end),box-shadow .12s steps(2,end)` |
| `src/client/views/skillDetail/PixelStyles.ts:18` | animation | .6s | `animation:pixel-blk .6s steps(2,end) infinite` |
| `src/client/views/skillDetail/PixelStyles.ts:29` | animation | 3s | `animation:pixel-seq 3s step-end infinite both` |
| `src/client/views/skillDetail/PixelStyles.ts:31` | animation | 1s | `animation:pixel-blk 1s steps(2,end) infinite` |
| `src/client/views/skillDetail/PixelStyles.ts:88` | transition | .12s | `transition:transform .12s steps(2,end),box-shadow .12s steps(2,end)` |
| `src/client/views/skillDetail/PixelStyles.ts:99` | animation | .5s | `animation:pixel-fok .5s steps(3,end)` |
| `src/client/views/skillDetail/PixelStyles.ts:100` | animation | .5s | `animation:pixel-ferr .5s steps(3,end)` |
| `src/client/views/skillDetail/PixelStyles.ts:103` | animation | .4s | `animation:pixel-shk .4s steps(4,end)` |
| `src/client/views/cards/PixelCardsStyles.ts:7` | transition | .12s | `transition:transform .12s steps(2,end),box-shadow .12s steps(2,end)` |
| `src/client/views/cards/PixelCardsStyles.ts:38` | transition | .12s | `transition:transform .12s steps(2,end),box-shadow .12s steps(2,end)` |
| `src/client/views/IssueDetail.ts:176` | animation | 1s | `animation: 'dsws-spin 1s linear infinite'` |
| `src/client/views/IssueDetail.ts:243` | animation | 1s | `animation: 'dsws-spin 1s linear infinite'` |
| `src/client/views/PrTab.js:35` | animation | 1s | `animation: 'dsws-spin 1s linear infinite'` |
| `src/client/views/versionControl/vcStyles.ts:172` | animation | 1.4s | `animation:dsws-vc-shimmer 1.4s linear infinite` |

（同一行里出现两个时长时分两行记，所以行数少于处数。）

## 这些时长的档位（去重后 19 个）

`.12s`、`.15s`、`.2s`、`.25s`、`.3s`、`.35s`、`.4s`、`.45s`、`.5s`、`.55s`、`.6s`、`.8s`、`.9s`、`1s`、`1.1s`、`1.4s`、`1.6s`、`2.4s`、`3s`

将来收拢时，可以先按用途定成命名档位（例如「悬停过渡」「切换过渡」「旋转一圈」「一次闪两下」「骨架呼吸」），而不是把 19 个裸时长原样搬进配置文件——那样只是把数字换了个地方，读者仍然不知道为什么是 .12s 而不是 .15s。

## 为什么没进 #1215 那三份 YAML

详见 `docs/adr/20261016-time-config-yaml.md` 第 5 节。一句话：行为类的时间值写错会让功能失败（超时、不重试、缓存判错），单位是毫秒；样式类写错只会让动画观感不对，写的是 CSS 时间字符串。两类的验收口径和豁免理由都不一样，混在一份文件里会让门禁的每条规则都要分情况讨论。

---

## 2026-10-28 复核（源码全部迁到 .ts 之后）

> 上面第 19-62 行是 2026-10-16 开票时的记录，文件名与行号都已经过期；保留它们是为了说明判据和当时的数字来源。改造时以本节为准。

**判据不变**（同第 9-15 行），只把参检范围改成今天 git 跟踪的 `src/client/**` 下全部 195 个 `.ts`（不含 `.d.ts`）。

**结果：51 条声明行、78 处时长、11 个文件、24 个不同值。**

逐文件（行号后括注该行出现的时长；同一取值重复出现时写 `×n`）：

| 文件 | 声明行（该行时长） |
| --- | --- |
| `src/client/kernel/styles.ts` | 37（.25s/.2s/.25s）、39（.25s/.2s）、44（.25s）、117（.12s）、198（.12s×2）、289（.8s）、292（.8s）、295（2.4s）、296（2.4s）、314（.15s×2）、315（.15s×2）、321（.12s）、356（.12s） |
| `src/client/kernel/modal-fields.ts` | 49（.12s×2） |
| `src/client/kernel/entry-choice.ts` | 268（.12s） |
| `src/client/statusbar/suggestStyles.ts` | 23（.14s×3）、34（.12s×2）、43（.12s×2）、60（1ms） |
| `src/client/views/cards/PixelCardsStyles.ts` | 25（.12s×2）、67（.12s×2） |
| `src/client/views/feedback/feedback-styles.ts` | 49（.55s）、51（.6s）、59（.5s）、65（.45s×3、.4s）、69（.9s）、70（.15s、.3s）、72（1.6s）、74（.6s）、76（.35s）、81（1.1s）、94（.24s、.16s×2、.12s）、96（.3s）、115（.08s）、116（.12s×3）、139（.12s×2、.08s） |
| `src/client/views/IssueDetail.ts` | 145（1s）、220（1s） |
| `src/client/views/mapDetailV2/view/skin/MapDetailV2Styles.ts` | 33（.12s×2）、65（.9s）、68（.2s） |
| `src/client/views/PrTab.ts` | 54（1s） |
| `src/client/views/skillDetail/PixelStyles.ts` | 41（.12s×2）、55（.6s）、66（3s）、68（1s）、128（.12s×2）、142（.5s）、143（.5s）、146（.4s） |
| `src/client/views/versionControl/vcStyles.ts` | 173（1.4s） |

24 个不同值及出现次数：`.12s`×28、`.15s`×5、`1s`×4、`.25s`×4、`.2s`×3、`.5s`×3、`.6s`×3、`.45s`×3、`.14s`×3、`.3s`×2、`.4s`×2、`.8s`×2、`.08s`×2、`.9s`×2、`.16s`×2、`2.4s`×2、`.24s`、`.35s`、`.55s`、`1.1s`、`1.4s`、`1.6s`、`3s`、`1ms`。其中 `1ms` 不是可调的观感时长，是「减少动态效果」分支里用来关掉动画的哨兵值，命名时也要说明，不要把它当成普通过渡档位。

**和旧记录的差异**：旧记录写 42 处 / 8 个文件 / 19 个档位，而且它的计数口径本身前后不一致（票面按文件写 `styles.js` 15 处，清单表里能数出 19 处）。本次重扫不做口径对齐，直接把 51 条声明行、78 处、24 个值作为改造与门禁的准据。差异来源有三类：一是源码从 `.js` 迁到 `.ts` 后行号全变；二是出现了开票时没有的文件（`src/client/statusbar/suggestStyles.ts`、`src/client/views/mapDetailV2/view/skin/MapDetailV2Styles.ts`、`src/client/kernel/entry-choice.ts`）；三是已有文件里的动画后续又改过（`src/client/views/feedback/feedback-styles.ts`、`src/client/views/cards/PixelCardsStyles.ts`、`src/client/views/skillDetail/PixelStyles.ts`、`src/client/kernel/styles.ts`）。

**旧记录漏判的一处**：`src/client/kernel/modal-fields.ts:49` 一行里有两处 `.12s`，旧表只记了一处。

**给改造的结论**：

- 这 51 条声明行按用途命名后搬进 `src/client/kernel/motion.ts` 的 `MOTION` 令牌（毫秒数字，键名以 `Ms` 结尾），样式字符串改成 `+ MOTION.xxx + 'ms'` 拼接；24 个值全部保留、不合并，保证观感零变化。
- `tests/verify-motion-tokens.ts` 应该扫的正是本文列出的这些声明行：`src/client/**/*.ts`（`motion.ts` 除外）里带 `transition`/`animation`（以及 camelCase 的 `transitionDuration`/`animationDuration`/`animationDelay` 等）并且写死字面时长的行判红。
- 改造时要一起改的测试与门禁：`tests/verify-1302-panel-list-skeleton.ts:336`、`tests/verify-ui-feedback.ts:196` 的源码断言；`tests/verify-1411-suggest-appearance.ts` 里 9 个毫秒值的断言；`tests/verify-time-config.ts` 的 STYLE 表；`tests/verify-kernel.ts` 的 MODULES 表；`scripts/build.mts` 的 `KERNEL_MODULES` 与 `src/client/index.ts` 的 `kernel:motion` 标记。
- 新增门禁后按仓内规矩跑 `node scripts/gate-map.mts` 重生成 `tests/gate-map.json`，再跑 `node tests/verify-gate-map.ts`。

**判据盲区复验**：不在 `transition`/`animation` 行上的 `s`/`ms` 字面量只剩 13 处，全部是注释、界面文案或 SVG 路径（例如 `src/client/kernel/icons.ts:30` 的 `M12 21s…`、`src/client/kernel/api-handoff.ts:124` 的注释「2s 后恢复」），没有跨行书写的 CSS 声明被漏掉；camelCase 目前只有运行时拼接（`src/client/statusbar/suggestEngine.ts:139-140`、`src/client/views/pixel/PixelStatusLine.ts:19`），按行扫描的判据对现在的代码形态够用。

---

## 2026-10-28 落地记录（改完了，以这一节为准）

**最后的形态不是 YAML**：开票时设想的是新建一份 `config/motion.yaml`，落地时按更晚的 `docs/adr/20261021-config-ownership.md` 改成了 TypeScript 模块。理由是这份 ADR 的判据：值由写界面代码的人改、编译器又能把两份拷贝连起来，就该留在代码里用 import 让漏改在编译期红；做成 YAML 反而凭空多出「真源 + 生成物」两份会漂的拷贝，还丢掉类型。这也是 ADR §2.6「本轮一份新的 YAML 都不建」与 §4「不新建任何 YAML 文件」的直接约束。动效时长的真源因此落在 `src/client/kernel/motion.ts` 的 `MOTION` 对象上，和界面其它样式一样随构建拼进客户端闭包，运行期不读文件。

**改了什么**

- 新建 `src/client/kernel/motion.ts`（kernel 片，插在 `kernel:styles` 之前）：一个 `MOTION` 对象，45 个毫秒令牌，键名按用途命名、统一以 `Ms` 结尾，值全是整数毫秒。24 个原有取值全部保留、不合并（同一个数值用在两件不同的事上就各起一个名字，例如 `spinMs` 800 和 `inlineSpinnerMs` 1000 改造前就是两个数）；另有一个 `motionOffMs: 1` 是「系统要求减少动态效果」分支关动画用的哨兵，不是可调观感档位。
- 11 个文件里的 51 条声明行全部改成用 `MOTION.xxx + 'ms'` 拼样式字符串（内联 `animation: '…'` 的字符串同样拼）。产物里原来的 `.12s` 变成 `120ms`，CSS 等价，界面观感零变化；`tests/verify-time-config.ts` 的 STYLE 表与 `docs/adr/20261016-time-config-yaml.md` 第 5 节同步改写，时间门禁不再管样式时长。
- 「下一步建议」气泡原来放在 `suggestAppearance.ts` 的 9 个动画毫秒值（`bubbleDelayMaxMs` 等）一并搬进 `MOTION`（改名 `suggestBubbleDelayMaxMs` 等），那里只剩像素、颜色、比例等外观旋钮；时间门禁的 STYLE 表随之整张删除——那张表本来就写明是过渡，不是永久豁免。
- 新门禁 `tests/verify-motion-tokens.ts`（18 条断言）守五件事：`MOTION` 的形状（单一定义、键名以 `Ms` 结尾、值 1~10000 的整数、键数下限）、每个键至少被引用一次且引用名都有定义、全仓只有这一份定义且不自带 import、构建与内核档案确实登记了 motion 片、`src/client/**` 里除 `motion.ts` 外任何 `transition`/`animation` 行出现字面时长就判红。文件头写了「门禁归属: src/client/kernel/motion.ts」。
- 按 `docs/adr/20261021-config-ownership.md` §2.5 做了红绿演示：把 `src/client/views/cards/PixelCardsStyles.ts` 一处改回字面 `.12s`，门禁当场报 1 处违例、退出码 1；改回拼接后 18 条断言全绿、退出码 0，演示后文件已还原。

**验证**：`tests/verify-motion-tokens.ts` 18/18 通过（改动前先跑红，恰好报出 51 条声明行，与本文复核表逐条对上）；`tests/verify-time-config.ts` 全绿（覆盖率扫描 66 个文件）；11 个受影响的门禁与测试逐条跑绿；`node scripts/gate-map.mts` 重生成 `tests/gate-map.json` 后 `tests/verify-gate-map.ts` 全绿；全链 `npm run verify:parallel` 的结论见 #1236 的收尾评论（本文写作时有 4 道与本次无关的红：分页额度门禁、金标准回执、`verify-669`、文件粒度门禁，来源都是同一工作区里别的会话正在推进的改动，与动效时长无关）。

**留给以后**：新加动画时长时只改 `motion.ts` 一处，然后跑 `npm run verify:parallel`；不要往样式文件里写裸时长，门禁会拦。真要让用户或主题包在运行期调动画快慢，那是行为变更，按 ADR §7 另开票，不在本次范围内。


