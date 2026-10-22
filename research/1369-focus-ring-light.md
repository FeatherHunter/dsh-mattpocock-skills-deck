# #1369 研究笔记：浅色外观下焦点环可用色值与跟随策略（2026-10-22）

所属：GitHub issue #1369（父图 #1366 的子票）。本笔记只回答该票的验收问题——浅色外观下焦点环用哪个色值、跟随策略是什么，并给出原样跟随、加深一档、深绿、深棕四档的十六进制与对比度对照，以及推荐一档与理由。不改生产代码，不认领不关闭票，结论供 #1368 讨论拍板。

核查日期：2026-10-22。核查人：wayfinder 地图 1366 后台研究员（子票 #1369）。

口径：只认三处一手来源——DSH 应用包里 ui-theme 的 focus.css 原文、仓内 `src/client/views/feedback/feedback-styles.ts:22-31`、真机浅色变量实测（本机 Chromium 实际解析变量链）。没有抄任何二手总结。凡是需要真机截图链才能判定的，本次如实写成未做（见第五节），不写成断言。

---

## 一、DSH 浅色外观下两个变量实际是多少

- 焦点环颜色变量 `--dsw-focus-ring-color`：DSH 主题自己平时不给它赋值，它只在 focus.css 里作为“有就用、没有就回落”的第一顺位出现。原文是 `:focus-visible{outline-color:var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-width:var(--dsw-focus-ring-width)}`，另有指针模态下把环色置透明的一条（来源：本机 `D:\DeepseekHarness\resources\app.asar` 内 `packages/client/ui-theme/src/styles/focus.css.mjs` 编译产物，`focus_css_default` 一行，宽 2 像素写在 `:root{--dsw-focus-ring-width:2px}`）。
- 回落到的主题主色 `--dsw-alias-state-business-primary`：浅色下等于 `--dsw-static-deepseek-500`，即 **#4176E6**；深色下等于 `--dsw-static-deepseek-400`，即 **#7AAAFF**。两处出处互相印证：同一应用包内 ui-theme 文档写明“主题将该蓝色解析为浅色模式的 #4176E6 和深色模式的 #7AAAFF”（来源：应用包内 ui-theme 文档 `focus.css` 说明段，中英文两份同一句话）；design-platform.css 里浅色 `body` 写 `--dsw-alias-state-business-primary:var(--dsw-static-deepseek-500)` 且 `--dsw-static-deepseek-500:#4176e6`，深色 `body[data-ds-dark-theme]` 写 `--dsw-alias-state-business-primary:var(--dsw-static-deepseek-400)` 且 `--dsw-static-deepseek-400:#7aaaff`（来源：应用包内 `design-platform.css.mjs` 编译产物）。
- 真机浅色变量实测：在本机 Chromium（Playwright 拉起的真 headless Chromium）里建空白页，按浅色（不挂 `data-ds-dark-theme`）注入上面两段原文，读 `getComputedStyle`：`--dsw-alias-state-business-primary` 解析为 `#4176e6`，`--dsw-focus-ring-color` 为空（未赋值，证实走回落分支），获得焦点的按钮 `outline-color` 解析为 `rgb(65, 118, 230)`（即 #4176E6），`outline-width` 为 `2px`（来源：本次实测探针 `.scratch/probe-light-vars.cjs` 输出）。
- 仓内落点现状：`src/client/views/feedback/feedback-styles.ts:22-31` 注释写明“统一走 DSH 主题自己的两个 token”，`:31` 的选择器用 `outline:var(--dsw-focus-ring-width,2px) solid var(--dsws-ring-color,var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#58a6ff)));outline-offset:-2px`——即宽 2 像素、往控件里面画、颜色先跟焦点环变量再跟主题主色。行尾的 `#58a6ff` 只是兜底（主题一定定义了主色，实际走不到它）。另据 #1366 图注记，维护者意见是“跟随 DSH 主题为主，有更好色值再跟”。
- 浅色底：浅色下 `--dsw-alias-bg-base` 等于 `--dsw-static-neutral-bluish-00` 即 `#fff` 纯白（来源：同一 design-platform.css 浅色 `body`；仓内 `tests/verify-670-panel-first-frame.ts:170-174` 逐字抄录的真令牌也是 `bluish-00:#fff` 对应浅色）。对比度下文一律以纯白底为基准，另附纸面底 `#f5f6f7`（`bluish-60`，像素风纸面方向的底）一列。

## 二、四档对照表（浅色底）

四档的取法（全部取自设计平台静态色阶，不是新编的颜色）：

- 原样跟随：`--dsw-static-deepseek-500` 即 **#4176E6**（浅色主题主色本身）。
- 加深一档：同色系往深走一格 `--dsw-static-deepseek-600` 即 **#4868B2**（色阶里 500 的下一格深色；带 `delete` 后缀的 `deepseek-700-delete #2F4C8F` 是废弃位，不取）。
- 深绿：静态色阶里最深的绿 `--dsw-static-green-900` 即 **#233C2C**（亮绿 `#22C55E` 在白底上只有 2.28:1，连 3:1 都不到，不可用，所以深绿只能取 900 这一格）。
- 深棕：静态色阶里最深的暖棕 `--dsw-static-amber-900` 即 **#27241F**（该色系没有中间深档，只有这一格深色）。

| 档位 | 十六进制 | 出处 token | 白底对比度 | 纸面底 #f5f6f7 对比度 | 是否过 3:1（焦点环线） |
|---|---|---|---|---|---|
| 原样跟随 | #4176E6 | `deepseek-500` / 浅色主色 | 4.23:1 | 3.91:1 | 过 |
| 加深一档 | #4868B2 | `deepseek-600` | 5.39:1 | 4.98:1 | 过（含 4.5:1 文字段） |
| 深绿 | #233C2C | `green-900` | 11.97:1 | 11.06:1 | 过 |
| 深棕 | #27241F | `amber-900` | 15.46:1 | 14.29:1 | 过 |

算法：WCAG 相对亮度公式（`lum` 与 `(hi+0.05)/(lo+0.05)`，来源：本次计算脚本 `.scratch/contrast.cjs` 输出）。判定线用焦点指示器的 3:1（非文本对比）；4.5:1 一列只作参考，因为焦点环是 2 像素的线，不是正文。

## 三、推荐与跟随策略

- 推荐档：**原样跟随 #4176E6**。
- 理由四条。第一，维护者已定方向是跟随 DSH 主题（见第一节末），原样跟随是唯一零分叉的档，换主题（深色 #7AAAFF）自动跟着变，不用为浅深两套各写一个死值。第二，对比度够用：白底 4.23:1、纸面底 3.91:1，都过了焦点环的 3:1 线。第三，全 DSH 一致：应用包里所有自带控件的焦点环都用同一个颜色表达式，插件用原样跟随就和宿主永远同色；深绿深棕会让插件成为全应用里唯一异色。第四，深绿深棕有语义代价：深棕 #27241F 接近正文黑，深绿 #233C2C 接近成功态绿，用户容易把“这是焦点”误读成“这是正文描边”或“这是成功状态”；且两者都是死值，深色下不会自动变亮，在深底上反而看不清。
- 有条件备选：如果 #1368 讨论时认为 4.23:1 在纸面纹理上偏惊险，要求正文级 4.5:1，则改用**加深一档 #4868B2**（白底 5.39:1，纸面 4.98:1），仍是同色系，不破坏“蓝色即焦点”的约定。深绿深棕不建议采用。
- 跟随策略（给 #1368 的一句话结论草案）：浅色下不写死任何色值，继续用 `var(--dsws-ring-color,var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#58a6ff)))` 跟随 DSH 主题，宽 2 像素往内画（`outline-offset:-2px`）保持不变——内画是 2026-10-21 用户实测结论，外扩的环会被页签行、按钮组的 `overflow:hidden` 裁掉上下两截。

## 四、给 #1368 的结论路径

- 本笔记路径：`research/1369-focus-ring-light.md`（本文件）。
- #1368 拍板时只需定一句：原样跟随 #4176E6（默认），或加深一档 #4868B2（要求 4.5:1 时）；宽度与内画位置不变；深绿深棕不用。

## 五、本次未做与边界

- #1369 票面原话要求“在浅色底上拼按钮与页签行截图对照”，本次没有出截图：#1366 图注记本轮视觉截图链不可用，讨论以真机浅色截图与 HTML 原型为准；本次以真机变量实测（Chromium 实际解析值）加对比度计算代替像素截图，对照表见第二节。按钮与页签行的像素拼图留待 #1370 原型或 #1368 讨论时补。
- 对比度是数学值，不是人眼投票；纸面纹理底上的实际观感以 #1370 像素风原型为准。
- 深色值（#7AAAFF 等）只在第一节列出对应关系，本票只定浅色，深色沿用跟随不变。
