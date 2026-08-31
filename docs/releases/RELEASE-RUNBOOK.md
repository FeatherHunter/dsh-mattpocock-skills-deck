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

1. **隔离构建**：在隔离临时目录执行 `node scripts/build.mjs`，产物不落当前工作区。
2. **产物新鲜度与双产物一致性**：根产物 `client.js`/`host.js` 与包内产物 `package/lib/client.js`/`package/lib/index.js` 逐字节一致，且 mtime 新于源码。
3. **冒烟测试**：`npm run test:smoke` 必过（client / host / dispatch / render / naming）。
4. **打包预览**：`npm pack --dry-run` 文件清单仅含白名单，不含密钥、多余文档与私密文件。
5. **官方源包名占用预检**：显式指向官方源并跳过本地缓存，例如  
   `npm view dsh-mattpocock-skills-deck --registry https://registry.npmjs.org --prefer-online`  
   不被镜像延迟误判。

> 以上任一失败即阻断后续发布步骤，不携带过期产物进入 `publish`。

---

## 5. npm-publish 子流程的封装（基于 wizard 能力，AI 全驱动）

> **执行主体：AI** — 本节所有 `npm` 操作由 AI 在可见终端代为执行，人不敲命令；人唯一动作是浏览器 2FA 扫码。

- 环境检查、登录态检查、打包预览、网页 2FA 发布、官方源验证的完整链路。
- 登录与发布均显式指向官方源（`--registry https://registry.npmjs.org`）且不重定向输出。
- 2FA 仅在交互终端的浏览器授权页完成，不隔空传递一次性验证码。
- 发布前包名占用预检始终显式跳过缓存。

---

## 6. 向导子流程的封装（基于 wizard/template.sh 统一向导库，AI 全驱动）

> **执行主体：AI** — 向导由 AI 触发与步进（AI 调 `bash scripts/wizard-release.sh vX.Y.Z` 并代为确认/轮询），人不敲 `bash`；向导弹出的浏览器授权页由人扫码一次即结束人机交接。

向导基于统一的向导库 `wizard/template.sh`，按分段清屏、进度、显式打开链接、确认、落盘与收尾的节律组织：

- 库文件：`wizard/template.sh`（提供 `_clear`/`banner`/`stage` 分段清屏与进度、`open_url` 显式打开链接、`pause`/`confirm` 确认、`write_env`/`ENV_FILE` 落盘与 `finish` 收尾，以及 `poll_npm_version` 轮询辅助；被各向导 `source`，可中断重跑且已落盘值被记住）
- 发布向导：`scripts/wizard-release.sh`（基于 `wizard/template.sh`，6 段旅程，可中断重跑，已落盘值在 `.wizard-release.env` 中被记住，重跑时自动回填）
- 旅程覆盖：确认提交已推送与工作区干净 → 发布并弹浏览器完成 2FA → 官方源验证（后台轮询） → 已装形态验证与面板行为复核
- 每一段只聚焦当前任务，可重复执行；落盘键为 `WIZARD_RELEASE_VERSION` 等，`--dry-run` 可仅演练门禁
- 校验阻断：向导首段即调用 `tests/verify-release-contract.js` 单一高层校验，任一失败即阻断后续发布步骤

---

## 7. 只扫码的体验（零手动命令的人机交接）

> **人机交接仅一处：浏览器扫码** — 除此之外，人不敲命令、不在终端粘贴、不隔空传 OTP；所有 `git`/`npm`/`gh` 由 AI 在可见终端代劳。

- 需要浏览器授权的步骤，向导在用户桌面弹出可见的交互窗口并打开授权链接，用户仅需扫码或完成授权，其余轮询与验证由工具在后台完成。
- 后台无可见授权链接时不空等，而是直接在可见窗口完成发布并以后续查询判成功。

---

## 8. 发布顺序与无回滚（AI 按序执行，人不敲命令）

> **执行主体：AI** — 下述 6 步均由 AI 按序执行，人不敲命令；第 2 步的人机交接仅为浏览器扫码一次。

顺序固定为：

1. 本地门禁全绿后提交并推送到 `main`（AI 执行 `git commit/push`）
2. 发布到官方源（AI 执行 `npm publish --registry https://registry.npmjs.org`，网页 2FA 扫码一次由人完成）
3. 查询验证（AI 执行 `npm view --prefer-online`）
4. 打标签并推送（AI 执行 `git tag vX.Y.Z && git push origin vX.Y.Z`）
5. 创建 GitHub Release 并附产物说明（AI 执行 `gh release create`，与 CHANGELOG 同文）
6. 验证已装形态（AI 在已装 DSH 中验证版本号可见，面板行为符合发布内容）

> 不提供回滚操作。出问题时递增下一个修补版本覆盖，流程保持极简。

> **审计提示**：本文档中的命令均为 AI 的执行清单与事后审计依据；若某次发布要求人手动敲上述任一命令，即视为偏离本规范，需立即审查并回退到 AI 驱动路径。

---

## 9. awesome 侧的按需更新

- 仅在描述有实质变化或介绍文字可优化时才更新市场条目，不为仅递增版本号而频繁打扰市场。
- 更新时仅改动自有条目且不手改生成产物，分类取最贴近的一项且不纠结。
- 描述逐项对应真实能力且含冒号的描述已加引号，以便市场检查一次性通过。
- 打包产物中的介绍需与市场描述同源。

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

- 发布校验以单一高层的发布契约校验覆盖全部 8 项清单与双入口的一致性，优于为每个清单项各自补低层测试。单一入口：`node tests/verify-release-contract.js --version vX.Y.Z`（亦可无参，自动取 `package.json` 当前版本，**由 AI 执行**）。
- 校验断言：版本同源、说明锁定、变更历史与 Release 同文、包白名单、模板与网页卡同源、向导契约（`wizard/template.sh` 与 `scripts/wizard-release.sh` 的只扫码旅程与落盘语义）；校验失败时给出待改清单且阻断后续发布（`exit 1`）。
- 向导联动：`scripts/wizard-release.sh` 首段即调用本 gate，失败直接 `exit 1`，不进入 `npm publish`；`--dry-run` 仍执行校验但演示后续旅程。
- 将被测试的模块：runbook 文档的存在性与引用关系、模板与网页卡的渲染一致性、向导脚本的语法与可执行性（`bash -n`）、隔离门禁链的闭环、双产物一致性；双入口一致性由 `tests/verify-release-template.js` 另行保障，两门禁均挂入 `npm run verify`。

---

## 附：修订记录

- 2026-08-31 初版：以 map #353 的 Implementation Decisions 为基线固化，生效日期 2026-08-31。
- 2026-08-31 增补 #356：落地 `wizard/template.sh` 统一向导库与 `scripts/wizard-release.sh` 只扫码向导（6 段旅程、分段清屏/进度/显式打开链接/确认/落盘与收尾、可中断重跑、浏览器授权页仅扫码一次、后台轮询验证），并新增单一高层发布契约校验 `tests/verify-release-contract.js`（覆盖版本同源等 6 类，失败给待改清单且阻断发布）。
- 2026-08-31 增补：全规范强调**零手动命令 — AI 全驱动，只扫码**（总则 + 第 5/6/7/8/10/11 节 + 模板/网页卡/向导头部），明确所有 `git`/`npm`/`gh`/`bash` 由 AI 执行，人仅浏览器扫码一次；偏离（要求人敲命令）即视为不合规需审查。