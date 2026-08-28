# dsh-mattpocock-skills-deck 开发工作流：改 src → 构建 → 实时生效

> 本文件记录「修改 src/ 真源 → 构建产物 → 在真实 DSH 里实时看到效果」的完整流程与验证手段。
> 适用：任何 bug 修复 / UI 调整 / 功能迭代。2026-08-21 按 G1 产物策略（阶段 3 收尾 #98）重写：**仓库只见 src/ 为真源，产物全由构建生成，人手不再同步任何镜像**。

---

## 1. 真源与产物（改代码前必读）

**唯一真源 = `src/`**，含全部手写代码：

| 真源 | 说明 |
|---|---|
| `src/client/index.js` | Client 组装入口（apply(ctx) → Provider → 插槽注册） |
| `src/client/kernel/*` | 内核 9 模块（styles/locale/icons/prompts/config/store/probe/router/api）—— G3 冻结接口 |
| `src/client/views/*`、`statusbar/*`、`panel/*`、`floating/*` | 叶子 21 文件（G4 ≤350 单文件，useContext(DswsCtx) 消费） |
| `src/host/index.js` | Host 组装入口（RPC 派发） |
| `src/shared/parser.js`、`src/client/kernel/tabsfold.js` | 纯函数叶子（阶段 1） |
| `src/seam/*` | 6 绑定方言适配（runtime/style/rpc/timer/editor/sidebar） |

**可变产物 = `client.js` / `host.js` / `package/lib/*`**，由 `scripts/build.mjs` 一源出两物生成，**gitignore，不提交**：

| 产物 | 形态 | 加载方 |
|---|---|---|
| `_dev` → `client.js` / `host.js` | cordis_define 函数体（过 precheckCode） | 动态 runner（`new Function` 求值，潜在路径） |
| `_pkg` → `package/lib/client.js` / `package/lib/index.js` | ModuleLoader / ESM（pkg entry 提供 seam shim） | DSH 真实加载（`__ModuleLoader__.load({id,factory})`） |

> 根因：DSH 装配契约 = 一插件一模块 id = 单 bundle，必须把多源合为单产物才能加载；旧「手写双源镜像」已于 T0 废弃，产物 = `f(整个 src 树)`，人手永不碰产物。

**构建管线**（`scripts/build.mjs`）：

```
src/client/index.js + kernel/* + leaves/*  ──wireCtx+wireModules──▶  bodyW
     + seam shim（B2/B3/B4 词法绑定）  +  单组件单声明门禁 + __ModuleLoader__ 门禁
         ├── _dev client.js（return {apply}）
         └── _pkg package/lib/client.js（ModuleLoader 工厂壳）

src/host/index.js  ── harness shim + dispatch Map ──▶  _dev host.js / _pkg package/lib/index.js
注入项：__DSW_VERSION__ → package/package.json version（v1.6.18 → 'v1.6.18'）
门禁：dev 产物 precheckCode（等价宿主 (async () => {code})()）；pkg 语法 + ModuleLoader 特征
```

---

## 2. 改动生效方式（核心差异）

| 改动位置 | 生效方式 | 说明 |
|---------|---------|------|
| **client 半**（UI） | **刷新浏览器即可** | DSH web `Cache-Control: no-cache`，bundle URL 带 `?rev=` 内容哈希；刷新页面即拿最新产物 |
| **host 半**（数据） | **必须重启 DSH 桌面应用** | host 进程常驻，RPC 通道注册在 apply 时；改数据流/接口必须重启 |

> 旧教训仍适用：只改 host 不重启 → 看到旧行为。

---

## 3. 完整开发循环（改 → 构建 → 验 → 同步 → 生效）

```
① 改 src/ 真源（仅改 src/ 内文件，永不手改产物）
        │
② 构建（esbuild 双 entry：一源出两物 + version 注入 + 门禁）
        │
③ 语法/冒烟/契约验证（快速 loud fail）
        │
④ 同步 DSH 安装目录（Copy-Item + hash 校验）
        │
⑤ DSH web 实时复核（确认 serve 的是新产物）
        │
⑥ 用户刷新 / 重启 DSH → 看效果
        │
⑦ git commit（中文标题 + Tested-By，仅提交 src/ 与配置）
```

### ① 改 src/

- 仅编辑 `src/` 内文件；`client.js`/`host.js`/`package/lib/*` 永不手动编辑（gitignore 会挡提交，但本地仍是可变产物）。
- 找实现：按模块目录直达（如改状态栏 → `src/client/statusbar/StatusBar.js`），不再 grep 双源。
- 改内核（`src/client/kernel/*` 或 `src/seam/*`）需串行（conductor 单 session，接口按 `docs/architecture/kernel-contract.md` 冻结）。

### ② 构建

```bash
# 完整构建（默认：_dev + _pkg 双产物）
node scripts/build.mjs
# 或经由 npm prepare 钩子（安装/发布时自动触发）
npm run build
# 完整流水线（含同步到 DSH profile，见 §④）
bash scripts/build.sh          # 构建 + 门禁 + 同步
bash scripts/build.sh --no-sync  # 仅构建，不同步
```

产物字节数会打印：`client.js (dev) ... bytes` 等；失败则门禁抛 `[G门禁]`。

### ③ 验证（loud fail）

```bash
# 语法门禁（已在 build.mjs 内；也可单独跑）
node -e "new (require('vm').Script)('(async()=>{'+require('fs').readFileSync('client.js','utf8')+'})()')"
node --check host.js
node scripts/build.mjs --pkg-only && echo "pkg gate OK"

# 运行时冒烟（jsdom，<2s，覆盖面板/状态栏/tab 关键路径）
npm run test:smoke
#  - smoke-client.test.js：ModuleLoader stub + style 注入
#  - smoke-host.test.js：ESM name/inject + /dsws 通道
#  - smoke-host-dispatch.test.js：dispatch ping → pong
#  - smoke-render.test.js：slots 6 注册 + React 挂载 StatusBar/DetailsDock/Overlay + 叶子渲染

# 契约测试（每模块一测试 + 叶子/内核冻结）
npm run verify
#  或按需：
node tests/verify-kernel.js        # kernel 9 模块拼接 + 产物新鲜度
node tests/verify-leaves.js        # 21 叶子 ≤350 + useContext(DswsCtx)
node tests/verify-ctx.js           # DswsCtx 8 字段冻结
node tests/verify-parse-leaf.js    # src/shared/parser === 产物（逐字）
node tests/verify-tabsfold-leaf.js # tabsfold 机器逐字
node tests/verify-t3-locale.js     # 254 键双语平衡（单产物）
#  其它 verify-* 均为单产物行为校验（T5 后已删除双源镜像断言，见各文件头部注释）
```

> 新鲜度门禁：`verify-ctx/kernel/leaves` 会检查 `产物 mtime ≥ src mtime`，过期提示 `请重新运行 node scripts/build.mjs`。

### ④ 同步 DSH 安装目录

```bash
# build.sh 已自动同步（若 profile 存在）
PROFILE="$HOME/.dsh/profiles/web/node_modules/dsh-mattpocock-skills-deck"
cp -f package/lib/client.js "$PROFILE/lib/client.js"
cp -f package/lib/index.js  "$PROFILE/lib/index.js"
# hash 校验必须一致
node -e "const fs=require('fs');const a=fs.readFileSync('package/lib/client.js','utf8'),b=fs.readFileSync(process.env.HOME+'/.dsh/profiles/web/node_modules/dsh-mattpocock-skills-deck/lib/client.js','utf8');if(a!==b)process.exit(1);console.log('hash OK')"
```

> 只同步 `package/lib/` 产物（真实加载对象），`client.js`/`host.js` 仅作开发 runner 备用，不进 profile。

### ⑤ DSH web 实时复核

```powershell
$body = (Invoke-WebRequest -Uri "http://127.0.0.1:59519/plugins/dsh-mattpocock-skills-deck/client.js" -UseBasicParsing).Content
$body.Contains("dsws-panel")   # 应 True（STYLE_TEXT 已注入）
```

### ⑦ 提交规范

```bash
# 只提交 src/ 与配置，产物被 gitignore
git add -- src/ scripts/build.mjs package/package.json DEV-WORKFLOW.md README.md CHANGELOG.md
git -c core.hooksPath=/dev/null commit -F <msgfile>   # 绕过 pytest hook（若需要）
```

模板：

```
[dsh-mattpocock-skills-deck] <主题> · <细节> · v1.6.18

<根因 + 修复说明 + 构建流>

构建产物由 src 生成 · 已通过 smoke/verify

Tested-By: npm run test:smoke (4/4) · npm run verify (9/9) · build OK
```

---

## 4. 产物一致性检查（旧 §4 已废弃）

旧「双源镜像一致性检查」（grep 两边特征 10/10）已于 T5 删除：双源手写镜像不存在，产物一致性由 **构建文本组合** 保证。

现检查点：

```bash
# 1) 产物新鲜度
node tests/verify-kernel.js   # 产物门禁 + 9 模块已拼接
node tests/verify-leaves.js   # 21 叶子已拼接 + 产物新鲜

# 2) 单产物行为特征（任一产物含关键特征即通过）
Select-String -Path package\lib\client.js -Pattern "dsws-panel|dsws-capsule|dsws-tabs"
Select-String -Path package\lib\index.js -Pattern "lastProbeAtByRepo|fetchMapsDetailREST"

# 3) 运行时冒烟
npm run test:smoke
```

---

## 5. 版本号维护

- `package/package.json` → `version`（发布 + DSW_VERSION 注入源）
- `CHANGELOG.md` → 每版一段
- 产物内 `DSW_VERSION`（tabs 行最右）由构建从 `package.json` 注入 `__DSW_VERSION__`，无需手改

---

## 6. 常见坑清单（2026-08-15 沉淀，2026-08-21 按构建流修订）

| 坑 | 现象 | 解法 |
|----|------|------|
| 改了产物没改 src | 下次构建覆盖丢失；git diff 看不到改动 | 永远只改 `src/`，产物由 `node scripts/build.mjs` 生成 |
| 产物过期未重建 | verify 报「产物过期，请重新构建」 | 改 src 后必跑 `node scripts/build.mjs` 或 `bash scripts/build.sh` |
| host 改动没重启 | 刷新仍旧行为 | host 改动必须重启 DSH |
| 三元缺 : null | build 门禁报 precheckCode 失败 | 补 `: null` |
| Get-Content 中文乱码 | includes 假 MISS | 用 `[IO.File]::ReadAllText(..., UTF8)` |
| commit 被 hooks 挡 | pre-commit 跑 pytest | `git -c core.hooksPath=/dev/null commit` |
| 安装目录没同步 | DSH 加载旧 bundle | `bash scripts/build.sh` 或手动 cp + hash 校验 |
| jsdom 缺失 | smoke 抛 Cannot find module 'jsdom' | `npm i -D jsdom react react-dom`（已在 devDependencies） |

---

## 7. 发布（G1 三段式）

- **开发**：`bash scripts/build.sh`（构建 → 同步 profile）
- **发布前**：`npm pack` 前 `prepare` 自动跑 `node scripts/build.mjs`，产物进 tgz（git 忽略的不影响发布）
- **安装**：`dsh plugin --profile web add dsh-mattpocock-skills-deck` 拉 tgz 内的 `package/lib/*`，无需仓库内 lib

---

## 8. Pages 静态站点（docs/ 为根）

> Pages 已启用：`main` 分支的 `docs/` 目录即网站根目录。推送后约 1 分钟生效，访问地址为 `https://featherhunter.github.io/dsh-mattpocock-skills-deck/<docs 下相对路径>`。仓库 About 的 Homepage 已指向 `architecture/MattSkills-architecture.html` 的在线预览，`docs/.nojekyll` 已放置以跳过 Jekyll 处理。

**落盘规约（必遵守）：**

1. **位置固定**：所有需要生成并对外在线预览的 HTML 文件（架构图、原型、调研可视化、报告、演示页等）必须放在 `docs/` 下的相应子目录中，禁止放在仓库根目录、`src/`、`package/` 或其它与 Pages 无关的位置。
2. **目录与文件名必须可溯源**：子目录名与 HTML 文件名要能直接对应到当前任务与内容，方便日后按文件路径就能找回上下文。命名用英文 `kebab-case` 小写，必要时带上日期或关联的 issue/PR 编号。
   - 正确示例：`docs/architecture/MattSkills-architecture.html`（品牌名保留原大小写，豁免小写化）、`docs/prototype/readme-variants-20260828.html`（README 多方案原型）、`docs/research/20260828-session-governance.html`（会话治理调研）
   - 避免：`docs/a.html`、`docs/test.html`、`docs/new-page.html`（看不出任务）
3. **链接同步更新**：新增或移动 `docs/` 下的 HTML 后，需同步更新 `README.md` / `docs/README.en.md` 中对应章节的在线预览链接（前缀为 `https://featherhunter.github.io/dsh-mattpocock-skills-deck/` + `docs` 下相对路径去掉 `docs/`），并保持本地相对路径 `docs/...` 的「本地直接打开也能看」说明。
4. **不提交 Pages 构建产物**：Pages 仅托管手写或工具生成的 `docs/**/*.html`，不要把 `client.js` / `host.js` 等构建产物移入 `docs/`。
5. **豁免（不纳入 Pages）**：`lessons/*.html`、`reference/*.html` 为本地教学配套（依赖 `../assets/teach.css`、`../assets/quiz.js` 等相对路径，构成独立导航），`tests/verify-*.html` 为本地 UI 验收夹具，均不通过 Pages 对外托管，故保留原位，不纳入本规约；如需对外发布，须整体迁入 `docs/` 并同步修正所有相对路径与导航链接。
