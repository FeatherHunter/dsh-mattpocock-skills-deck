> 规范：[发布 Runbook · 生效日期 2026-08-31](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/blob/main/docs/releases/RELEASE-RUNBOOK.md) — 冲突时以更新日期者为准

> **零手动命令**：本议题创建后，**AI 全驱动执行**（AI 按 Runbook 跑向导、执行 `git`/`npm`/`gh`、落盘与轮询），**人只需在浏览器授权页扫码一次**；**禁止要求人手动敲任何命令**，清单中的命令为 AI 的执行清单。

# 发布 vX.Y.Z

> 本议题由发布模板生成（网页卡或对话触发双入口同源）。请将标题与正文中的 `vX.Y.Z` 替换为本次实际版本号（例如 `v1.7.9`），并按清单勾选执行。语义化口径：修补递增用于缺陷与收口、次版本递增用于新增能力、主版本递增用于破坏契约。

## 版本信息

- **版本号**：`vX.Y.Z`（请替换为实际版本，例如 `v1.7.9`）
- **生效规范**：[`docs/releases/RELEASE-RUNBOOK.md`](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/blob/main/docs/releases/RELEASE-RUNBOOK.md)（2026-08-31）
- **标签**：`vX.Y.Z` 指向该发布提交
- **提交标题**：中文完整句且不少于 10 字，例如“发布 vX.Y.Z：xxx 修复与文档同步”

---

## 8 项对外展示清单（必改，逐项可校验）

- [ ] 1. 根 `package.json` 与 `package/package.json` 版本同源且等于 `vX.Y.Z`
- [ ] 2. `README.md` 三处锁定版本已对齐 `vX.Y.Z`（安装示例与锁定版本说明）
- [ ] 3. `docs/README.en.md` 英文安装示例已对齐 `vX.Y.Z`
- [ ] 4. `package/README.md` 首段版本已对齐 `vX.Y.Z`
- [ ] 5. `CHANGELOG.md` 新增节已按统一模板编写（日期、版本、主题、提炼、对应提交、验证与影响）且与 GitHub Release 说明同文
- [ ] 6. GitHub 仓库 About 描述已与 `package.json` 的 `description` 同句、逐项可校验且 human-first，无夸大（话题与描述同源）
- [ ] 7. GitHub 话题包含 `dsh-plugin`
- [ ] 8. `package.json` 的 `description` 与 `keywords` 已审核，awesome 描述按需已更新（仅实质变化时提交 PR，单条目、不手改生成产物、含冒号描述已加引号）

---

## 4 项隔离门禁（任一失败即阻断发布）

- [ ] 1. 在隔离环境执行构建与全部校验（`node scripts/build.mjs` 等），不污染当前工作区与已装形态
- [ ] 2. 构建产物新鲜度与双产物一致性校验通过（根产物与包内产物逐字节一致）
- [ ] 3. 冒烟测试与打包预览通过（`npm run test:smoke`、`npm pack --dry-run` 白名单与密钥检查）
- [ ] 4. 官方源包名占用预检通过（`npm view --registry https://registry.npmjs.org --prefer-online` 显式跳过缓存）

---

## 2 项发布验证（官方源与已装形态）

- [ ] 1. 官方源查询验证通过（`npm view dsh-mattpocock-skills-deck --registry https://registry.npmjs.org --prefer-online` 可查到 `vX.Y.Z`）
- [ ] 2. 已装形态验证通过（在已装 DSH 中版本号可见，面板行为符合发布内容）

---

## 发布顺序（无回滚）

按序执行，不可逆操作始终在可逆校验之后；出问题时不回滚，直接递增下一修补版覆盖：

1. 本地门禁全绿后提交并推送到 `main`
2. 发布到官方源（`npm publish --registry https://registry.npmjs.org`，网页 2FA 扫码一次）
3. 查询验证（`npm view --prefer-online`）
4. 打标签并推送（`git tag vX.Y.Z && git push origin vX.Y.Z`）
5. 创建 GitHub Release 并附产物说明（与 CHANGELOG 同文）
6. 验证已装形态

> 向导：由 **AI 触发** `bash scripts/wizard-release.sh vX.Y.Z`（基于 `wizard/template.sh` 的只扫码旅程，AI 全驱动）（分段清屏、进度、显式打开链接、确认、落盘与收尾，6 段：工作区与推送确认 → 隔离门禁 → 发布弹浏览器一次扫码 → 官方源轮询 → 已装形态验证），可中断重跑且已落盘值在 `.wizard-release.env` 中被记住；契约由 `tests/verify-release-contract.js` 单一高层 gate 保障，失败即阻断。详见 `docs/releases/RELEASE-RUNBOOK.md` 第 6、11 节。

---

## 备注

- 本模板与网页卡 `.github/ISSUE_TEMPLATE/release.yml` 同源，正文逐字一致。
- 未提供版本号时请勿猜测，需追问确认。
- awesome 侧更新保持按需原则，单条目且不手改生成产物。