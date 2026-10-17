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
