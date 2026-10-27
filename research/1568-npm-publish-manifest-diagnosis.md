# 1568 诊断证据：npm 发布包 build/prepare 指向包外

日期：2026-10-27；依据：本票正文（一手）+ 下面各仓库一手文件；结论：建议 1 成立且归本仓，建议 2 归插件市场。

## 包外路径成立

- `package/package.json:16-19`：发布清单里 `build` 与 `prepare` 都是 `node ../scripts/build.mts --pkg-only`，相对路径指向包外。
- `package/scripts/`：只有 `fix-issue-body.mts` 与 `wire-subissues.mts`，没有 `build.mts`，在包内执行必定找不到文件。
- `package/lib/index.js`（本仓 60,733 字节）等预构建产物与 `bundled-skills`、`bundled-skills-zh` 都在包内，安装不需要再构建。
- 为什么发布时没炸：`../scripts` 相对仓库根存在，`prepare` 在发布打包时能跑到；坑只在用户机上。
- 发布脚本 `scripts/publish-token.ps1` 发前先跑构建与测试门禁，包内 `prepare` 是多余的。

## 提示越界不归本仓

- `allowBuilds|IGNORED_BUILDS|放行构建` 全仓只命中自家 `pnpm-workspace.yaml:7` 的 `allowBuilds:`，点名 dsh-purge 的提示文案来自插件市场 dshmarket 1.66.47，本仓改不了。
- 两次把脚本带进发布包的提交：a8380f6f（补 scripts/ 进发布清单）、6ec760c9（清单收窄到两条脚本），当时都没动 `build`/`prepare` 这两行。

## 不适用的既有笔记

- `.out-of-scope/popup-question-tool.md` 不适用原因：它只收录弹窗提问工具的否决结论，与安装失败和发布清单无关。

## 未复现、实施前需重放

- profile 里 dsh-purge 占位符是否真让整个 `pnpm add` 以 ERR_PNPM_IGNORED_BUILDS 失败（本机无该 profile，未复现，采信报告者）。
- 注册表包安装时 pnpm 是否真会执行 `prepare`（报告者一次改了两处配置，无法区分是哪一处起的作用）。
- 实施时应在干净 profile 里重放一次安装再定。
