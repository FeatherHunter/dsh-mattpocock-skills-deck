# 发布 Runbook — 通用发布规范（读的规范文档）

> 生效日期：2026-08-31  
> 冲突时以更新日期者为准。本文件是以后每一版发布的裁决依据；向导脚本与发布议题模板由本文档驱动生成，三者同源且首行互相引用。

> **总则：零手动命令 — AI 全驱动，只扫码**  
> 整个发布旅程由 **AI 驱动**（AI 读本文档、跑向导、执行 `git`/`npm`/`gh`、落盘与轮询），**人只需在浏览器授权页扫码一次**；**禁止要求人手动敲任何 `git`/`npm`/`gh`/`bash` 命令**。本文档中的所有命令均为 **AI 的执行清单与审计依据**，不是人机交接；人机交接仅一处：浏览器 2FA 扫码。

## 目的地

把“发布”本身固化为以后每一版都能直接引用的通用规范——发布新版本只是用这套规范走一遍的自然副产品。未来的每一次发布都通过同一份文档、同一张清单、同一个只扫码的向导来复用，无需再回 grill。

---

## 1. 每次发布必改的 8 项对外展示清单

> 清单不随技术细节漂移。新增对外可视位置需先修订本文档并更新生效日期。

| # | 位置 | 要求 | 校验方式 |
|---|---|---|---|
| 1 | 根 `package.json` 与 `package/package.json` | 版本号完全同源，等于本次发布的 `vX.Y.Z` | 文本对比 |
| 2 | `README.md` 三处锁定版本 | 安装示例、锁定版本说明、更新指引中的版本号均为 `vX.Y.Z` | 搜索 `1.7.8` 旧版本应为 0 处命中，新版本为 3+ 处 |
| 3 | `docs/README.en.md` 英文安装示例 | 与根 README 同源 | 文本对比 |
| 4 | `package/README.md` 首段版本 | 首段明确声明当前版本为 `vX.Y.Z` | 首段包含版本号 |
| 5 | `CHANGELOG.md` 新增节 | 按统一模板新增一节：日期、版本、主题、提炼、对应提交、验证与影响；与 GitHub Release 说明同文 | 结构检查 |
| 6 | GitHub 仓库 About 描述 | 与 `package.json` 的 `description` 同句，逐项可校验，human-first（人类首次阅读可准确理解），无营销夸大；任何数字与能力名在变更前可在产物中检索到 | 文本对比 |
| 7 | GitHub 话题 | 始终包含 `dsh-plugin` | API 查询 |
| 8 | `package.json` 的 `description` 与 `keywords` / 按需的 awesome 描述 | `description` 与 About 同源；`keywords` 含 `dsh` / `dsh-plugin` 等可发现性关键字；awesome 侧仅在描述有实质变化或介绍文字可优化时才更新，且遵循单条目原则、不手改生成产物、含冒号的描述已加引号 | 文本对比、awesome PR 规则 |

> 产物白名单：`package/lib`、`package/shared`、`cordis.patch.yml` 等由 `package.json#files` 锁定，发布前打包预览校验。

---

## 2. 文档同源与 human-first

- GitHub About 的描述与包清单的介绍文字保持同句，逐字对应。
- 任何数字（如技能数量 25、版本数量）与能力名在对外描述变更前，需在产物中逐项可检索到，避免夸大。
- 话题始终包含 `dsh-plugin`，以便被插件市场与搜索正确发现。
- 安装节锁定版本与包清单版本自动同源：用户按文档复制的安装命令即为最新发布。
- 致谢名单由每日任务自动追加，不再随发布手工改：`.github/workflows/thanks.yml` 每天凌晨拉一次新编号（手动点一次也行），`scripts/update-thanks.mts` 按游标只看新的、老的绝不重看，合进来重排后把中英两表一次写好；数据源是 `docs/thanks-data.json`，发布时只需确认当天任务已跑、新贡献已收录。手动跑一次：`npm run thanks:update`。
- 致谢区每个人名字那一行末尾的花数，就是这个人的票数：一朵 🌹 对应本人的一次 Issue、PR 或有编号的讨论。按「提交」算，不按「合入」算——作者自己关掉的 PR、维护者按请求关闭的 PR 都算一次提交；同一编号串里的实质参与也记一次（留言里给了能用的东西就算），例如 #476 的 snmtg1008 留下了自测过的修复、#257 的 271912980 提出了稳定会话方案，两人都是这样进来的；仓库所有者本人与机器人账号不计入。同花数的人按最后一次活跃的时间倒排，最后活跃的排在前面。
- 票数多了用更大的图案进位，不再把同一图案贴满一行：1 张票是 1 朵 🌹；10 张票进 1 个 💐；100 张票进 1 个 🏆；1000 张票进 1 个 👑；💎 等于 10000 张票，先占位备用，以后真有人到那一步再用。显示时大图案永远排在前面、小图案排在后面，每一档最多出现 9 个，满 10 个就往前进一位，和钱的写法一样（例如 11 张票显示为 💐🌹，123 张票显示为 🏆💐💐🌹🌹🌹）。选这四个是从小到大单枝花、捧花、奖杯、皇冠、钻石，越往上越重，一眼能看出分量，形状颜色差得远，小字号下也不会看混。
- 数花不再手工跑命令：每人的事项与时间都在 `docs/thanks-data.json` 里记着（一人一行，编号带诞生时间），`tests/verify-thanks-table.ts` 会重算总数、重对最后活跃、钉死进位，表错一位就红；老编号串里后来的留言机器看不见，看到这种去 JSON 里手工补一条再跑 `node scripts/update-thanks.mts --render-only` 只重画表格不联网。
- 花数在中英两版与包内说明三处由脚本一次写好：改完 `README.md` 不用再跑构建去同步包内说明——脚本写的是同一份表格文字，构建重抄结果一字不差，`node tests/verify-readme-sync.ts` 照常确认。三处表格（起止标记之间的内容）禁止手改，要改只改 `docs/thanks-data.json` 再重跑脚本。
- 安装命令版本同源：中文、英文 README 与包内说明的锁定版本号与本次发布同源，无旧版本残留（与第 1 节第 2–4 项同源，由发布契约门禁覆盖）。

---

## 3. 语义化版本与提交口径

- **修补递增（patch）**：缺陷修复与收口性变更，无新增用户可见能力，无破坏契约。
- **次版本递增（minor）**：新增用户可见能力，向后兼容。
- **主版本递增（major）**：破坏契约的变更。
- 标签形态为 `vX.Y.Z`，指向该发布的提交。
- 发布提交标题为中文完整句且不少于 10 个字，例如：“发布 v1.7.9：README 版本全量对齐与状态栏修复”。
- 变更历史新增节复用统一模板（日期、版本、主题、提炼、对应提交、验证与影响），并与 GitHub Release 说明同文。

---

## 4. 隔离门禁（任一失败即阻断发布）

构建与全部校验在隔离环境中执行，不污染当前工作区与已装形态：

1. **隔离构建**：在隔离临时目录执行 `node scripts/build.mts`，产物不落当前工作区。
2. **产物新鲜度与双产物一致性**：根产物 `client.js`/`host.js` 与包内产物 `package/lib/client.js`/`package/lib/index.js` 逐字节一致，且与构建缓存（`node_modules/.cache/dsh-build.json`）里记的上次成功构建产物摘要一致——判据看内容，不看修改时间；缓存不可用时退回按修改时间判断，并会打印 `INFO` 说明原因。
3. **冒烟测试**：`npm run test:smoke` 必过（client / host / dispatch / render / naming）。
4. **打包预览**：`npm pack --dry-run` 文件清单仅含白名单，不含密钥、多余文档与私密文件。
5. **官方源包名占用预检**：显式指向官方源并跳过本地缓存，例如  
   `npm view dsh-mattpocock-skills-deck --registry https://registry.npmjs.org --prefer-online`  
   不被镜像延迟误判。

> **#1648 起，门禁段由发布脚本一次跑完，只构建一次**：`scripts/publish-token.ps1` 先跑 `npm run build` 生成产物，再跑唯一裁决入口 `npm run verify:parallel`（含五条冒烟）；不再跑会重复构建的整条 `npm test`。任何一步红，脚本都当场非零退出（`GATE-FAIL`），不带着过期产物进入发布。

> 以上任一失败即阻断后续发布步骤，不携带过期产物进入 `publish`。

---

## 5. npm-publish 子流程的封装（基于 wizard 能力，AI 全驱动）

> **执行主体：AI** — 本节所有 `npm` 操作由 AI 代为执行，人不敲命令；人唯一动作是在 AI 弹起的交互窗口内放行浏览器二次验证。
> **技能指引**：本节操作序列遵循 `/npm-publish` 技能（§0 前置三查 → §1 包就绪 → §2 打包预览 → §3 登录 → §4 发布 → §5 验证）；遇到报错码先查该技能 §4 失败分支表（EOTP/E401/E403/E404/E409 各有一类原因）。

- 环境检查、登录态检查、打包预览、网页二次验证发布、官方源验证的完整链路。
- 登录与发布均显式指向官方源（`--registry https://registry.npmjs.org`）且不重定向输出。
- 发布必须在分发包目录执行：先 `cd package`（根 `package.json` 含 `"private": true`，禁止发布，误跑会被 EPRIVATE 拦截）。
- 发布必须在交互终端（TTY）执行：后台任务、无交互终端、输出重定向下一律报 EOTP 且不给授权链接（2026-09-03 v1.7.12 实测三次）；Windows 下由 AI 用系统任务计划（`schtasks /it`）在用户桌面弹起交互式发布窗口，用户在窗口内按回车→浏览器完成二次验证→再按回车（见 `/npm-publish` 技能 §4 可选增强）。
- 网页登录态不能免掉发布口令（npm 10.9 + 写操作强制二次验证，实测新鲜登录直发仍 EOTP）；二次验证仅在交互终端的浏览器授权页完成，不隔空传递一次性验证码。
- 发布前包名占用预检始终显式跳过缓存。

---

## 6. 向导子流程的封装（基于 wizard/template.sh 统一向导库，AI 全驱动）

> **执行主体：AI** — 向导由 AI 触发与步进（AI 调 `bash scripts/wizard-release.sh vX.Y.Z` 并代为确认/轮询），人不敲 `bash`；向导弹出的浏览器授权页由人扫码一次即结束人机交接。

向导基于统一的向导库 `wizard/template.sh`，按分段清屏、进度、显式打开链接、确认、落盘与收尾的节律组织：

- 库文件：`wizard/template.sh`（提供 `_clear`/`banner`/`stage` 分段清屏与进度、`open_url` 显式打开链接、`pause`/`confirm` 确认、`write_env`/`ENV_FILE` 落盘与 `finish` 收尾，以及 `poll_npm_version` 轮询辅助；被各向导 `source`，可中断重跑且已落盘值被记住）
- 等待应答的判据：`pause`/`confirm` 读不到任何输入（`read` 返回非零）即判「没有人应答」，此时打印一句「向导已退出：没有人应答……本次没有发布任何东西」并以退出码 3 结束，不再静默走默认分支；空行仍算「有人按了回车」（#609）。
- `open_url` 一律返回成功：它只在用户桌面弹浏览器，调起器（本机是 `explorer.exe`）返回非零是常态，这个返回值不得决定向导的生死（#609）。
- 发布向导：`scripts/wizard-release.sh`（基于 `wizard/template.sh`，6 段旅程，可中断重跑，已落盘值在 `.wizard-release.env` 中被记住，重跑时自动回填）
- 旅程覆盖：确认提交已推送与工作区干净 → 发布并弹浏览器完成 2FA → 官方源验证（后台轮询） → 已装形态验证与面板行为复核
- 每一段只聚焦当前任务，可重复执行；落盘键为 `WIZARD_RELEASE_VERSION` 等，`--dry-run` 可仅演练门禁
- 校验阻断：向导首段即调用 `tests/verify-release-contract.ts` 单一高层校验，任一失败即阻断后续发布步骤
- 技能指引：新建向导时遵循 `/wizard` 技能流程（定范围 → 定旅程 → 照 `template.sh` 写阶段 → 校验交接）；本仓库 `wizard/template.sh` 与 `scripts/wizard-release.sh` 分别是该技能的模板实例与发布实例

---

## 7. 交互窗口审批的体验（零手动命令的人机交接）

> **人机交接仅一处：交互窗口内的浏览器授权** — 除此之外，人不敲命令、不在终端粘贴、不隔空传一次性口令；所有 `git`/`npm`/`gh` 由 AI 代劳。

- 需要浏览器授权的步骤，AI 在用户桌面弹出可见的交互式发布窗口并打开授权链接，用户在窗口内按回车→浏览器完成二次验证→再按回车，其余轮询与验证由 AI 在后台完成。
- 纯后台“只扫码”在 npm 10.9 下不可行：无交互终端的发布一律报 EOTP 且不给授权链接（2026-09-03 v1.7.12 实测），不要空等授权链接出现；以后续官方源查询判成功。

---

## 8. 发布顺序与无回滚（AI 按序执行，人不敲命令）

> **执行主体：AI** — 下述 6 步均由 AI 按序执行，人不敲命令；第 2 步的人机交接仅为浏览器扫码一次。

> **发布前必须收口真机验证清单**：本版 `[真机验证] vX.Y.Z` 清单票必须恰好一张、已关闭，而且票面正文与评论记录内部一致（场景总览表的编号集合、每条场景的结论、正文与收口评论里的各处计数都对得上）；批次开始评论与每条场景结果评论都要带候选身份行，所有候选提交都要是发布提交的祖先（候选提交与发布提交不同时，票面要有「候选与发布差异审计」说明差异为什么可以接受），否则发布被阻断。两条发布路径都会自动跑这个检查（`scripts/publish-token.ps1` 在发布前；`scripts/wizard-release.sh` 在 Stage 3 第五步，也就是上面第 2 步之前），检查实现是 `node scripts/release-preflight.mts`；手工执行 `npm publish` 时请先自己跑一次，对不上的地方它会逐条列出并给出改法。发布成功后 `scripts/release-postflight.mts` 会给清单票补发布记录并建下一版占位票。规则见 [`docs/agents/real-machine-verification.md`](../agents/real-machine-verification.md)。

> **发布脚本自己证明「发出去的字节 = 门禁验过的字节」（#1648）**：`scripts/release-integrity.mts` 把 npm 的 tarball 解包成「逐文件清单」——每个文件的路径、字节数、sha256，再加一个整份清单的指纹——三处各拍一次：门禁构建完之后拍一次（`GATE-SNAPSHOT`）；发布前在包目录里补跑该包的 `prepublishOnly`（发布时 npm 会跑它，可能重新生成文件）再拍一次，与门禁那份比对，不一致打 `PRE-PACK-DIFF` 并停在发布之前，一致打 `PRE-PACK-SAME`；发布完成后按 `包名@版本` 从 registry 拉回 tarball 再拍一次，与发布前那份比对，一致打 `BYTES-SAME`，不一致打 `BYTES-DIFF` 并以非零退出——此时已经发出去、npm 不支持撤回，脚本会把「必须人工核对」写进日志与退出码。比对按逐文件 sha256，不按整个 tarball 的哈希：打包元数据（时间戳、写入顺序）会让同一份内容两次打包的整体哈希不同，那个差异说明不了内容变了。

> **发布前还会核一次候选身份（#1766）**：`scripts/publish-token.ps1` 支持可选 `-Candidate <candidate.json>`，在发布前把待发字节的逐文件清单指纹与候选包的 `package.fileDigest` 对账——两份指纹用同一算法（`scripts/release-integrity.mts` 的清单指纹），所以能直接比。一致就继续发布；不一致但清单票正文的「候选与发布差异审计」一节已经写清差异为什么可以接受（发布前检查会打 `PREFLIGHT-CANDIDATE-AUDIT`）时继续发布并记 `CANDIDATE-DIFF-AUDITED`；不一致又没有差异审计时打 `CANDIDATE-DIFF` 并中止发布。候选的 `validity` 是 `development`（脏树冻结的开发验证）时直接拒绝发布；候选清单还必须带 `package.tgzSha256`（64 位小写十六进制），发布前检查会拿它与身份行里的候选包哈希互相核对。不传 `-Candidate` 时记 `CANDIDATE-SKIP`，行为与今天一致，只做票面检查、不做字节对账。

> **dist-tag 指向按版本形态定，发布前后各核一次**：预发布版本（版本号里带 `-`，例如 `1.9.0-beta.32`）发布时发到 `beta`，发布成功后脚本再把 `latest` 指到同一个版本，这样面板与市场拿到的都是新版；稳定版本发布时发到 `latest`，`beta` 保持发布前的指向不动。发布前脚本读一次当前各 tag，算出「发布后应该是什么样」（`TAG-PLAN`）；发布后再读一次核对（`TAG-VERIFY-OK`，不符打 `TAG-VERIFY-FAIL` 并非零退出）。发完把每包的文件数、字节数、清单指纹与各 tag 的最终指向写进发布记录评论。

顺序固定为：

1. 本地门禁全绿后提交并推送到 `main`（AI 执行 `git commit/push`）
2. 发布到官方源（AI 在交互窗口执行 `(cd package && npm publish --registry https://registry.npmjs.org --auth-type=web)`，人在窗口内按回车→浏览器完成二次验证→再按回车）
3. 查询验证（AI 执行 `npm view --prefer-online`）
4. 打标签并推送（AI 执行 `git tag vX.Y.Z && git push origin vX.Y.Z`）
5. 创建 GitHub Release 并附产物说明（AI 执行 `gh release create`，与 CHANGELOG 同文）。Release 一建好，`.github/workflows/release-tarball.yml` 会自动把 npm 上这一版的原样产物，以固定文件名 `dsh-mattpocock-skills-deck.tgz` 附着到这条 Release 上——不需要 AI 或人再上传。市场里那条「预构建包安装」链接指向的就是这个文件（见第 9 节）。
6. 验证已装形态（AI 在已装 DSH 中验证版本号可见，面板行为符合发布内容）

> 不提供回滚操作。出问题时递增下一个修补版本覆盖，流程保持极简。

> **审计提示**：本文档中的命令均为 AI 的执行清单与事后审计依据；若某次发布要求人手动敲上述任一命令，即视为偏离本规范，需立即审查并回退到 AI 驱动路径。

---

## 9. awesome 侧的按需更新

- 仅在描述有实质变化或介绍文字可优化时才更新市场条目，不为仅递增版本号而频繁打扰市场。
- 更新时仅改动自有条目且不手改生成产物，分类取最贴近的一项且不纠结。
- 描述逐项对应真实能力且含冒号的描述已加引号，以便市场检查一次性通过。
- 打包产物中的介绍需与市场描述同源。
- 技能指引：发布后按需更新市场条目时遵循 `/awesome-dsh-plugin-submit` 技能（只改自己 YAML、重生成 README、不手改产物；先发布 npm 再收录体验更好）。
- 条目里**不要写** `npm:` 之类的字段：npm 包与仓库的关联由市场自己判定——它读发布包 `package/package.json` 里的 `repository`，看它是否指回被收录的那个仓库。手写 `npm:` 会被市场校验直接拒掉，PR 因此过不了。
- 预构建包链接固定写成下面这一行，不要再写带版本号的资产名（`latest/download` 里的文件名是照字面取的，带版本号的话下一次发版就 404）：
  ```
  tarball: https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/releases/latest/download/dsh-mattpocock-skills-deck.tgz
  ```
  这个资产由第 8 节第 5 步提到的 workflow 在每次发布 Release 后自动附着，所以链接永远指向最新版，换完之后不再需要为它改条目。（现在条目里那条还钉在 `v1.7.14`，下次更新条目时一并换成上面这行。）
- 截图与 README 都不用提 PR：`screenshots.json` 放在仓库根、`package.json` 旁边，写 1–8 张图、数组顺序就是市场详情页的展示顺序；两个 README 同理。改完推到 `main`，下一次市场构建自动生效。

---

## 10. 双入口的同源性（零手动命令的两种触发）

> **触发主体：人一句话，AI 建票** — 人不敲 `gh issue create`，只需点卡填版本或对 AI 说一句话，建票与后续发布全由 AI 驱动。

- 网页入口：通过仓库的议题模板选择器呈现（`.github/ISSUE_TEMPLATE/release.yml`），在 https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/new/choose 显示为“发布 vX.Y.Z”卡，点卡填版本号即由 **AI 感知并代为执行**后续发布（或 AI 据卡创建的议题自动推进）。
- 对话入口：对 AI 说一句自然话（如“按发布规范发版 v1.7.10”或“按发布规范发版 v1.7.9”）即由 AI 找到本 runbook 与模板文件 `docs/releases/release-issue-template.md` 并代为创建发布议题与执行发布。未提供版本号时需追问而非猜测。
- 网页卡与对话创建的发布议题正文逐字一致，均由同一模板渲染，首行即引用本 runbook。
- **零手动命令校验**：若发布要求人手动执行 `gh issue create`/`git`/`npm`，即视为偏离双入口设计，需审查。

---

## 11. 验证（AI 执行，人不敲命令）

> **执行主体：AI** — 本节校验由 AI 在隔离环境执行，人不敲 `node tests/...`；人仅在失败时看待改清单。

- 发布校验以单一高层的发布契约校验覆盖全部 8 项清单与双入口的一致性，优于为每个清单项各自补低层测试。单一入口：`node tests/verify-release-contract.ts --version vX.Y.Z`（亦可无参，自动取 `package.json` 当前版本，**由 AI 执行**）。
- 发布自证的机器判据另有门禁 `tests/verify-1648-release-integrity.ts`（由 `npm run verify:parallel` 统一跑）：静态检查发布脚本与本规范里的标记字面量，单测 `release-integrity.mts` 的 tar 逐文件清单、差异定位与 dist-tag 策略，动态在临时目录搭假仓库与假 registry 真跑发布脚本的关键路径（策略不允许时不进发布、发布前字节变了就停且不发 PUT、预发布与稳定版各按策略改 tag）。
- 校验断言：版本同源、说明锁定、变更历史与 Release 同文、包白名单、模板与网页卡同源、向导契约（`wizard/template.sh` 与 `scripts/wizard-release.sh` 的只扫码旅程与落盘语义）；校验失败时给出待改清单且阻断后续发布（`exit 1`）。
- 向导联动：`scripts/wizard-release.sh` 首段即调用本 gate，失败直接 `exit 1`，不进入 `npm publish`；`--dry-run` 仍执行校验但演示后续旅程。
- 将被测试的模块：runbook 文档的存在性与引用关系、模板与网页卡的渲染一致性、向导脚本的语法与可执行性（`bash -n`）、隔离门禁链的闭环、双产物一致性；双入口一致性由 `tests/verify-release-template.js` 另行保障，两门禁均挂入 `npm run verify`。

---

## 12. 发布 token 的文件通道与轮换（#1646）

> **背景**：2026-10-29 真机验证时，写权限 token 被写进命令行参数，整条命令被会话记录完整持久化，token 明文从此留在日志里。发布全程不需要人敲命令，但 token 值本身也不该经过命令行与聊天记录——这是本节唯一要守住的事。

### 12.1 Agent 执行时的标准姿势（文件通道）

1. 人把写权限 token（Automation 或 Granular，含 `package` 的写权限）写进一个临时文件的第一行，例如 `%TEMP%\dsh-publish-token.txt`。写的方法是打开记事本（`notepad $env:TEMP\dsh-publish-token.txt`）粘贴后保存关闭：值只经过这个文件，不要贴进对话、命令参数或提交。
2. Windows 上把文件权限收到只给本人读（`%TEMP%` 默认已按用户隔离，这一步是兜底）：`icacls "$env:TEMP\dsh-publish-token.txt" /inheritance:r /grant:r "$env:USERNAME:(R)"`；macOS/Linux 上用 `chmod 600 <路径>`。
3. Agent 的命令里只出现路径，token 值不出现：

```powershell
pwsh -NoProfile -File scripts\publish-token.ps1 -TokenFile $env:TEMP\dsh-publish-token.txt -Probe    # 必须先跑，要求 PROBE-OK
pwsh -NoProfile -File scripts\publish-token.ps1 -TokenFile $env:TEMP\dsh-publish-token.txt -DryRun   # 只读演练：读表 + 验 token
pwsh -NoProfile -File scripts\publish-token.ps1 -TokenFile $env:TEMP\dsh-publish-token.txt           # 正式发布（门禁 → 发布 → 一次采样）
```

要做候选字节对账时，在正式发布那条命令后面加 `-Candidate <批次目录>\pkg\candidate.json`；对账语义见第 8 节。

4. 脚本只记录来源（`TOKEN source=file path=…`），不打印 token 值；缺 token 或读不到文件时报错也只提 `-TokenFile` 与变量名，不给任何片段（误把 token 值当路径传进来时，长令牌串会先被打码再回显）。
5. 脚本发现 token 文件放在仓库目录里时只打一行 WARN 提醒，不阻断发布；仍按第 1 条放在 `%TEMP%`，不要依赖这条提醒。
6. 跑完立刻删：`Remove-Item -LiteralPath "$env:TEMP\dsh-publish-token.txt" -Force`。临时文件没删，等于把 token 留在磁盘上。
7. `-TokenFile` 只取第一行非空内容（UTF-8 BOM 与 Windows 换行都会被去掉）；文件里不要放第二份 token，也不要写注释。

### 12.2 环境变量入口（兼容）

`NODE_AUTH_TOKEN` / `NPM_TOKEN` 仍然可用（`-TokenEnv` 可改首选的变量名），但只建议人在自己的交互终端里设。Agent 执行时用文件通道，不要把值内联进命令——那正是 #1646 记下的泄露姿势。

### 12.3 轮换与泄露处置

- 正常发布后：按季度轮换一次发布 token（npm 网站 → Access Tokens → 重新签发，删掉旧的）。
- 怀疑泄露（错误地贴进了聊天、命令参数、提交或日志）：立刻到 npm 撤销该 token，重新签发一枚，再按 12.1 的文件通道重跑探针。撤销是唯一可靠的止血动作，改密码不够。
- 撤销后如果发布被 401/E403 拦住，先确认新 token 有 `package` 的写权限，再重跑 `-Probe`，PROBE-OK 之后才继续发布。

---

## 13. 发布失败之后的处置：不重跑，先做只读核对

> **背景**：2026-10-30 发布 1.9.0-beta.32 时，registry 已经收下包，但发布脚本在发布后 60 秒内 12 次都没能把 tarball 拉回来核对（`FETCH-FAIL`），按协议以非零退出记为失败。之后人工核对发现字节完全一致，只是 registry 的可见延迟比脚本预算长（实测 beta.31 约 2 分 44 秒、beta.32 约 3 分钟），补 `latest` 也成功了。这一节把这次教训固化成规则。

### 13.1 任何一次失败之后，禁止重跑发布命令

`scripts/publish-token.ps1` 判断「要不要发」的方法是看云端版本是否已可见：已可见就记 `SKIP 云端已有`；当所有包都被跳过、没有要发的包时，脚本直接输出 `DONE 本次没有要发的包` 并以 0 退出。也就是说，一次 `FETCH-FAIL` 之后再跑同一条发布命令，拿到的是成功退出码，而脚本既不重新做字节核对，也不检查 `dist-tag` —— 失败会被静默地洗成成功。`-FullPost` 也救不回来：它同样卡在「没有要发的包」这一步提前结束。所以失败之后第一件事是停下来做只读核对，不是再跑一遍。

### 13.2 只读核对三步（不发布、不改 tag）

1. 从 registry 拉回 tarball：`npm pack dsh-mattpocock-skills-deck@<版本> --registry https://registry.npmjs.org --pack-destination <临时目录>`。
2. 与冻结候选逐个比对：候选 tgz 的 sha256 记在批次目录的 `pkg/candidate.json` 与清单票的批次评论里；用 `Get-FileHash -Algorithm SHA256` 两两对照，字节数也要一致。beta.32 实测两边都是 1,483,823 字节、sha256 `de94618c…`（完整值 `de94618c47be9c0e594206297337bd3d69e73af5aea73b89e3f641e3da07c261`）。
3. 读 `dist-tag`：`npm dist-tag ls dsh-mattpocock-skills-deck --registry https://registry.npmjs.org`，确认 `beta` 与 `latest` 的指向符合第 8 节的策略（预发布版本两个 tag 都指向本版；稳定版本只动 `latest`）。

三步都通过，才算「发出去的字节就是验过的字节」；任何一步对不上，按第 8 节「不提供回滚」的口径处理：不删版本、不重发同一版本，评估补一个新版本修正。给 registry 留够时间：脚本的 60 秒预算短于实测可见延迟，人工核对建议至少等 5 分钟再判失败。把脚本的重试预算改长属于另一件事，要单独开票、带测试改，不在这一节里直接改代码。

### 13.3 需要补 tag 时，单独执行

核对通过后如果 `dist-tag` 不符合预期，只补 tag，不重新发布：

```powershell
npm dist-tag add dsh-mattpocock-skills-deck@<版本> latest --registry https://registry.npmjs.org
```

遇到 `E429`（请求过多）按秒退避，等几分钟再试；beta.32 实测第一次 429、稍等后重试成功。token 仍按第 12 节的文件通道传入，命令行里只出现路径。

### 13.4 发布记录只追加，不改历史

发布记录评论、批次结果评论、清单票上的历史结论都是审计记录，发出后不改写。首轮失败就如实留着，核对结果用一条新评论追加，写清「首轮为什么判失败、后来核对了什么、结论是什么」。如果已经编辑过历史评论（beta.32 先例：把「这次没有机器对账证据」改成实际核对结果），要在随后一条评论里写明改了哪句、为什么改，让读记录的人能复原先后顺序。GitHub 不提供可查的评论编辑历史，删掉或改写原始结论等于把审计链打断。

> **一句话**：失败之后先只读核对、再补 tag、最后追加记录；永远不要用重跑发布命令来「确认它好了」。

---

## 附：修订记录

- 2026-10-31 增补（#1766 候选身份与发布字节对账）：`scripts/publish-token.ps1` 新增可选 `-Candidate <candidate.json>`，发布前把待发字节的逐文件清单指纹与候选包 `package.fileDigest` 对账；一致继续，不一致但清单票有差异审计（发布前检查打 `PREFLIGHT-CANDIDATE-AUDIT`）时记 `CANDIDATE-DIFF-AUDITED` 继续，没有差异审计则 `CANDIDATE-DIFF` 中止；`development` 候选拒绝发布；不传 `-Candidate` 时记 `CANDIDATE-SKIP`，行为与以前一致。第 8 节同步，发布前清单检查补上「批次评论带候选身份行」「候选提交是发布提交祖先（不同时有差异审计）」两条。

- 2026-10-30 增补（beta.32 发布实测 FETCH-FAIL 与人工恢复）：新增第 13 节，写明发布一旦失败就停止重跑（脚本对云端已可见的版本记 `SKIP 云端已有`，没有要发的包时直接输出 `DONE 本次没有要发的包` 并以 0 退出，重跑会把失败洗成成功）、只读核对三步（拉回 tarball 比 sha256、读 dist-tag）、需要时单独补 tag（E429 退避）、发布记录只追加不改写；引用 beta.32 实测的可见延迟（约 3 分钟，长于脚本 60 秒预算）。

- 2026-10-29 增补（#1648 发布脚本自己证明字节与 dist-tag）：发布脚本的门禁段改成「只构建一次（`npm run build`）+ `npm run verify:parallel` 唯一裁决入口（含五条冒烟）」，不再跑会重复构建的整条 `npm test`；新增 `scripts/release-integrity.mts`，把 npm 的 tarball 解包成逐文件清单（路径、字节数、sha256 与整份清单指纹），在门禁后（`GATE-SNAPSHOT`）、发布前补跑 `prepublishOnly` 后（`PRE-PACK-SAME` / `PRE-PACK-DIFF`）、发布后从 registry 拉回（`BYTES-SAME` / `BYTES-DIFF`）三处比对，不一致一律非零退出；dist-tag 按版本形态定策略并在发布前后核对（`TAG-PLAN` / `TAG-VERIFY-OK` / `TAG-VERIFY-FAIL`），预发布版本发 `beta` 后把 `latest` 也指过去、稳定版只动 `latest`；发布记录评论补上逐文件清单摘要与各 tag 最终指向。第 4、8、11 节同步，新增门禁 `tests/verify-1648-release-integrity.ts`。

- 2026-10-29 增补（#1646 发布 token 不再经过命令行）：新增第 12 节，写明 token 改由 `-TokenFile` 临时文件传入（命令行只出现路径、文件权限、用完即删）、环境变量入口的兼容位置，以及季度轮换与「怀疑泄露先撤销再重签」的处置；权限与删除给了可执行命令（`icacls`、`chmod 600`、`Remove-Item -LiteralPath`），并写明仓库目录里的提醒只告警不阻断。发布脚本头注释同步改成文件通道的跑法。

- 2026-08-31 初版：以 map #353 的 Implementation Decisions 为基线固化，生效日期 2026-08-31。
- 2026-08-31 增补 #356：落地 `wizard/template.sh` 统一向导库与 `scripts/wizard-release.sh` 只扫码向导（6 段旅程、分段清屏/进度/显式打开链接/确认/落盘与收尾、可中断重跑、浏览器授权页仅扫码一次、后台轮询验证），并新增单一高层发布契约校验 `tests/verify-release-contract.ts`（覆盖版本同源等 6 类，失败给待改清单且阻断发布）。
- 2026-08-31 增补：全规范强调**零手动命令 — AI 全驱动，只扫码**（总则 + 第 5/6/7/8/10/11 节 + 模板/网页卡/向导头部），明确所有 `git`/`npm`/`gh`/`bash` 由 AI 执行，人仅浏览器扫码一次；偏离（要求人敲命令）即视为不合规需审查。
- 2026-09-03 增补（v1.7.12 发布实测 #406）：§5 接入 `/npm-publish` 技能并写明交互终端真相（后台/重定向必 EOTP，Windows 用 `schtasks /it` 弹交互窗口；网页登录不能免发布口令；必须 `cd package`）；§6 说明与 `/wizard` 技能的关系；§7 把“只扫码”修正为交互窗口审批；§8 第 2 步对齐交互窗口命令；§9 接入 `/awesome-dsh-plugin-submit` 技能。本次为澄清性增补，不改 8+4+2 清单，生效日期保持 2026-08-31。
- 2026-09-03 增补（#432 发布 v1.7.13）：第 2 节明确致谢名单随发布更新与安装命令版本同源，模板与网页卡备注同步。本次为备注级增补，不改 8+4+2 清单编号，生效日期保持 2026-08-31（沿 #406 前例，模板同源门禁硬编码该日期）。
- 2026-09-08 缺陷修正（v1.7.15 发布实测）：① 发布向导把 `npm publish` 的输出接了管道，npm 因此判定为非交互终端、直接报 EOTP 且不给授权链接（违反第 5 节「不重定向输出」），已改为输出直连终端；② 向导的落盘文件因为先加载向导库而被库里的默认值 `.env` 占位，已改为在加载向导库之前设好 `.wizard-release.env`；③ `open_url` 不再拿调起器的退出码判成败（explorer.exe 打开成功也常返回非零，会误报「浏览器未自动弹出」）。本次为缺陷修正，不改 8+4+2 清单，生效日期保持 2026-08-31。
- 2026-09-12 缺陷修正（#609 实测，发布向导）：
  ① `open_url` 的「发射后不管」原来只做到一半——它把调起器的退出码交回给了调用处，而调用处多在 `set -e` 下，于是本机 `explorer.exe` 打开网址返回 1 时，发布向导在第 287 行（弹包主页）当场无声结束：退出码 1、最后一行停在「↗ opening …」、没有任何提示。现在 `wizard/template.sh` 的 `open_url` 一律返回 0，向导里四处调用（第 271、287、339、350 行）都不再受调起器返回值影响。
  ② `pause` / `confirm` 原来用 `read … || true`，读不到任何输入（后台运行、没人坐在终端前）时回复变量保持空串，向导据此静默走「否」分支，还把 `WIZARD_RELEASE_PUBLISHED` 写进落盘文件、退出码仍是 0——读这份台账的人会得到与事实相反的结论。现在判据写明为「读不到任何输入＝没有人应答」（空行仍算「有人按了回车」，人自己按回车走默认那条路不受影响）：没人应答时向导打印一行「向导已退出：没有人应答……本次没有发布任何东西」并以退出码 3 结束，全脚本每一处 `pause` / `confirm` 都走同一条判据，因此发布那一段在没人应答时也写不出 `WIZARD_RELEASE_PUBLISHED`。
  ③ 新增门禁 `tests/verify-wizard-exit-609.js` 并挂进 `npm run verify`：它驱动真实脚本代码（把 `scripts/wizard-release.sh` 里每一处 `open_url` 调用与第 285–320 行的发布段原样抽出来跑，npm 与调起器都是桩），上面两条缺陷任一条回来都会当场变红；原先的 `tests/verify-release-contract.ts` F 段只做关键字与语法检查，这两条它都拦不住。
  本次为缺陷修正，不改 8+4+2 清单，生效日期保持 2026-08-31。
- 2026-09-17 增补：第 2 节写明致谢区的花数规则与核对口径——一朵花对应本人提交的一次 Issue 或 PR（按「提交」算、不按「合入」算；只在评论区或讨论区留过言、没提过票的人不带花），并给出两条 `gh` 数花命令与「中英 README、包内说明三处逐行一致」的落地步骤。本次为备注级增补，不改 8+4+2 清单编号，生效日期保持 2026-08-31。
- 2026-09-20 增补（市场里的预构建包链接接上最新版）：第 8 节第 5 步写明预构建包资产由新增的 `.github/workflows/release-tarball.yml` 在每次发布 Release 后自动附着，文件名固定为 `dsh-mattpocock-skills-deck.tgz`；第 9 节改掉「npm 包发布后可补 `npm:` 字段」这句错误指引（市场现在会拒绝该字段，包与仓库的关联改由发布包的 `repository` 自动判定），并写明预构建包链接的固定写法与「截图、README 改自家仓库即可、不用提 PR」。起因：市场条目里那条 `tarball` 还钉在 `v1.7.14`，而 npm 上已是 `1.7.22`——链接本身有效，但谁从市场点「预构建包安装」，装到的是九版之前的产物。本次为备注级增补，不改 8+4+2 清单编号，生效日期保持 2026-08-31。
- 2026-10-22 增补：致谢名单改成机器自动追加——第 2 节「随发布手工增补、两条 `gh` 数花、改完跑构建同步包内说明」三句作废，换成每日任务（`.github/workflows/thanks.yml`，每天凌晨与 Star History 错峰跑，也可手动点）加数据源（`docs/thanks-data.json`，游标只看新编号）加离线门禁（`tests/verify-thanks-table.ts`，钉死进位、排序、链接与三处一致）。顺带把两条旧口径对齐到已发生的事实：进位仍是 💐=10、🏆=100、👑=1000、💎=10000；实质参与过编号串的留言记一次（#476 的 snmtg1008、#257 的 271912980 各一朵）。英文致谢同步改成与中文同一结构的三列表格，原先的逐人描述语被表格替代，旧文案留在 git 历史里可查。本次为备注级增补，不改 8+4+2 清单编号，生效日期保持 2026-08-31。