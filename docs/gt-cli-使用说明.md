# gt 命令行使用说明（gitea-cli 1.0.0）

这一份写给要把 Gitea 后端从 `tea` 迁到 `gt` 的人：先讲清 gt 优先的选择规则，再讲 `gt` 与 `tea` 在功能上的差别，然后按「安装 → 登录 → 日常命令 → 脚本输出 → CI → 从 tea 迁移」的顺序给出使用说明。命令与旗标的依据是 gt 官方仓库（gitea.com/gitea/cli）的 README、迁移指南 `docs/migrating-from-tea.md` 与 Gitea 官方博客的两篇发布公告（2026-10-23 的 0.1.0、2026-11-02 的 1.0.0）；本文不收录未在官方文档出现的命令。

## 插件怎么选执行器：gt 优先，tea 兜底（规格 #19）

DSH 插件的 Gitea 后端不需要你手动配置用哪个工具——每次 preflight 现场探测、按下面的顺序自动选：

1. 本地找 `gt` 与 `tea` 两个可执行文件；
2. `gt` 已装 → 经 gt 自身命令（`gt api /version`）确认服务器为 Gitea 28 及以上 → **选 gt**；
3. 否则 `tea` 已装 → **落回 tea**，并在提示里说明为什么没用 gt；
4. 两个都没装 → 环境档失败，安装指引默认指向装 gt，并附一句「服务器低于 Gitea 28 才需要 tea」。

要点：

- 每次探测都是现场跑两条快命令，不落持久缓存、没有失效逻辑；
- gt 只支持 Gitea 28 及更新实例（gt 自己不拦低版本服务器，插件替你判这一档）；
- **gt 与 tea 配置互不迁移**：gt 用自己的配置目录 `~/.config/gitea-cli/`，不读 tea 的配置——之前用 `tea login add` 登录过不算数，切到 gt 必须重新 `gt auth login`；
- 提示文案（安装/登录/修复指引）按选中的执行器注入：选中 gt 时给你的是 gt 命令，选中 tea 时给你的是 tea 命令（`src/tracker/rooms/gitea/room/prompts.ts`）。

## 背景：tea 已被 gt 取代

- `tea` 仓库已归档，不再有新版本：没有新功能、没有修复、没有安全更新。旧版 tea 对它支持过的 Gitea 版本仍能用。
- `gt`（gitea-cli）是官方新命令行工具，1.0.0 起遵循语义化版本：1.x 内不会删除或改名命令、旗标、`--json` 字段、退出码与 `GITEA_CLI_*` 环境变量。
- `gt` 只支持 **Gitea 28 及更新**的实例；旧版实例不受支持。
- gt 还带了替代 gitea-tea-skill 的 agent skill（`npx skills add https://gitea.com/gitea/cli.git --skill gt`）。

## gt 与 tea 在功能上的差别

### 架构与一致性

- tea 自 2018 年长出来的命令面：各命令旗标与输出格式不统一，逻辑直接写在命令处理器里。gt 从零重写：每条命令一个文件、统一走服务层（基于 Gitea Go SDK，SDK 缺口处才用原始 HTTP 并逐处标注）、传输层只限时「等待回答」而不切断大上传慢下载、只重试瞬时失败。
- 测试从 tea 的 216 个测试函数增至 1222 个，另有对真实 Gitea 实例的集成测试。
- 发布前经过多轮对抗性评审（对本地 Gitea 28.2 实例逐命令真跑、注入网络故障与恶意文本），每个发现都带回归测试修复。

### 命令面形状

- 命令改为「单数资源 + 动词」分组：`gt pr`（不是 `tea pulls`）、`gt issue`、`gt repo`、`gt label`（单数）；每个 `list` 也接受 `ls`，每个 `delete` 也接受 `rm`。
- 输出格式统一：`--output` 被 `--json` / `--jq` / `--csv` 取代；每个命令的帮助里列出自己的 JSON 字段，`gt schema` 列出全部字段与类型。字段只增不改。
- 文本输出面向人、可能随版本变化；脚本一律用 `--json`（可加 `--jq` 过滤，不要求本机装 jq）或 `--csv`（带表头，字段列表同 `--json`）。
- `--template` 用 Go 模板格式化同一份 JSON（与 gh 同款）。
- `GITEA_CLI_ERROR_FORMAT=json` 让失败以一行 JSON 落到 stderr。
- `--dry-run` 预览写请求，不真正发送。
- `gt help exit-codes` 逐条解释退出码；`gt help environment`、`gt help formatting` 说明环境变量与输出格式。

### 全新能力（tea 没有）

- **升级与通知**：`gt upgrade` 自升级（校验 SHA-256，可 `--version` 选版本、`--nightly` 装 main 最新构建）；由包管理器装的会指回对应命令。每天至多提醒一次新版本，CI 与非终端下安静，`GITEA_CLI_NO_UPDATE_NOTIFIER` 可关。
- **扩展机制**：`gt extension` 安装/运行/卸载名为 `gt-NAME` 的可执行文件，以 `gt NAME` 运行；来源可以是任意 Gitea 实例上的仓库，不依赖 GitHub API 的 gh 扩展也能装；下载校验已发布的 SHA-256，没有校验值的会先警告；扩展要拿 Gitea 令牌须安装时显式允许；扩展可在 `gt-extension.yml` 里声明别名，直接以顶层 `gt` 命令出现。
- **回移 PR**：`gt pr backport 42 --to release/v1.25 --to release/v1.24` 把已合并 PR cherry-pick 到多个发布分支并逐分支开 PR；单分支冲突不挡其他分支，`--keep` / `--continue` 处理冲突续跑。
- **Projects（项目看板）**：`gt project` 列出/查看/创建/编辑/关闭/重开/删除仓库、组织（`--org`）或账号（`--account`）的看板，创建可带模板（`--template basic_kanban`）；`gt issue move 17 to "In progress"` 把票在看板列之间移动。
- **Actions runner 管理**：`gt runner` 列出/查看/启用/停用/删除 runner，打印注册新 runner 的令牌（`gt runner token --global`），作用域可以是仓库、组织、账号或整个实例。
- **Actions 强化**：`gt run watch --expect-head HEAD` 在 run 属于别的提交时以退出码 6 结束（不会傻等旧推送的 run）；失败 run 的退出码 5 与 gt 自身失败的退出码 1 分开；`gt run logs 34 --failed --tail 50` 只打失败作业的日志尾部。
- **PR 细节**：`gt pr list --local` 列本地分支各自的 PR 状态（开/关/已合并），配合 `gt pr clean` 一眼看出哪些能清；`gt pr update-branch`（可 `--rebase`）把基分支带进 PR；`gt pr merge --method manually-merged --commit <sha>` 标记站外合并；`gt pr checkout --update`、`gt pr diff | git apply` 覆盖 fork 与 AGit PR；`gt pr checks --watch` 检查未完时以退出码 8 结束；`gt pr review` 在终端逐行标注 diff（`#` 开头行成为其上一行的行内评论）。
- **评论附件**：`gt issue comment attachment` 与 `gt pr comment attachment` 列出/上传/下载/改名/删除评论附件。
- **包管理**：`gt package upload tool 1.0.0 dist/tool-linux-amd64`，含列出、链接、删除。
- **搜索与状态**：`gt search`（仓库搜索在 `gt search repo`）、`gt status`、`gt notification watch`。
- **更多 Gitea 面**：团队、分支保护、部署密钥、标签导入导出（`gt label import` / `gt label export`）、issue 依赖与时间线、fork/镜像同步（`gt repo sync`）。
- **交互表单**：create/edit 不带字段时打开表单（`gt pr edit`、`gt label edit`、`gt release edit`）；`TERM=dumb` 时所有提示退化为普通文本行，兼容读屏器。
- **别名与诊断**：`gt alias set bugs 'issue list --label bug'`、`gt completion <shell>`、`gt doctor`。
- **访问代理**：按实例配置自定义请求头、客户端证书与 `http_timeout`，适配 Cloudflare Access 这类代理后面的实例。
- **克隆辅助**：`gt repo clone --find-instance` 在未选实例时逐个你在册实例找仓库，多个都有时问从哪克隆。

### 认证与配置的差别

- **配置互不迁移**：gt 用自己的配置目录 `~/.config/gitea-cli/`（偏好 `config.yml`、实例与账号 `hosts.yml`），不读 tea 的配置。装了 gt 必须重新 `gt auth login`。
- **凭据进系统钥匙环**：默认走操作系统 keyring；确需文件存储时显式 `--credential-store file`。环境变量凭据永不落盘。
- **登录方式**：终端里 `gt auth login` 问你选 OAuth（浏览器授权）或令牌；CI 里 `gt auth login --host <实例> --with-token < token-file`。
- **CI 环境变量**：`GITEA_TOKEN` + `GITEA_CLI_HOST`（或 `GITEA_INSTANCE_URL`）即可，不需要登录动作；在 Gitea Actions 里只设 `GITEA_TOKEN` 就够——gt 像 gh 在 GitHub Actions 里那样从 job 环境自动取实例地址。
- **登录管理命令重排**：`gt auth login` / `gt auth status` / `gt auth switch` / `gt auth logout` / `gt auth refresh`（OAuth 刷新）/ `gt auth setup-git`（接 git 凭据助手）。
- **全局旗标**：`--login`/`-l` 换成 `--host` 与 `--user`；`--repo`/`-R`；`--remote`；`--web` 取代 `tea open`（在相关命令上打开网页）。

## 安装

Linux / macOS / FreeBSD / OpenBSD（脚本校验下载的 SHA-256）：

```sh
curl -fsSL https://gitea.com/gitea/cli/raw/branch/main/scripts/install.sh | sh
# nightly 最新构建
curl -fsSL https://gitea.com/gitea/cli/raw/branch/main/scripts/install.sh | sh -s -- --nightly
```

Windows PowerShell：

```powershell
irm https://gitea.com/gitea/cli/raw/branch/main/scripts/install.ps1 | iex
```

其他方式：

- Homebrew：`brew install gitea-cli`
- Arch：`sudo pacman -S gitea-cli`
- 发行版包：每个 release 附 `.deb` / `.rpm` / `.apk`（含 man 页与 shell 补全）
- 二进制直下：[dl.gitea.com/gitea-cli](https://dl.gitea.com/gitea-cli/)（amd64 / arm64 / arm）
- Docker：`docker run --rm gitea/gitea-cli --help`
- 源码：`go install gitea.dev/cli/cmd/gt@latest`（Go 1.27+）或 clone 后 `make` / `make install`

脚本或二进制装的，用 `gt upgrade` 保持最新。安装脚本的版本与目录可用 `GITEA_CLI_VERSION`、`GITEA_CLI_INSTALL_DIR` 调。

## 登录

```sh
# 方式一：令牌（任何 Gitea 部署都可行）。先在网页端「用户设置」生成应用令牌，存入私有文件：
gt auth login --host https://gitea.example.org --with-token < token-file

# 方式二：OAuth 浏览器授权（要求该实例开启了 OAuth，且本机有浏览器）
gt auth login --host https://gitea.example.org --oauth

# 查看登录态 / 切默认实例 / 登出
gt auth status
gt auth switch
gt auth logout
```

## 日常命令速查

以下按资源分组列出主要命令；旗标细节以 `gt <command> --help` 为准，man 页可用 `gt man` 生成。

```sh
# 仓库
gt repo clone <url-or-owner/name>          # 也支持 --find-instance 跨实例找
gt repo create --template <tpl>            # 从模板建仓
gt repo sync                               # 同步 fork / 镜像
gt browse                                  # 在浏览器打开（取代 tea open）

# 票（issue）
gt issue list --repo owner/name --state all
gt issue view 17
gt issue create
gt issue comment 17                        # 评论；comment attachment 管附件
gt issue move 17 to "In progress"          # 项目看板列间移动

# 拉取请求（pr）
gt pr create                               # 自动推分支；fork 场景推到 fork
gt pr checkout 13 --update
gt pr diff 13 | git apply
gt pr checks 13 --watch && gt pr merge 13 --squash
gt pr review 13 --approve                  # --request-changes 提修改意见
gt pr review comments / reply / resolve / unresolve
gt pr list --local                         # 本地分支 × PR 状态
gt pr update-branch --rebase
gt pr merge --method manually-merged --commit <sha>
gt pr backport 42 --to release/v1.25
gt pr clean                                # 清掉已合并/已关闭的本地分支

# 标签 / 里程碑 / 发布 / 时间
gt label list / create / edit / import / export
gt milestone list / create / issue ...     # milestone issue 管票与里程碑关联
gt release create / edit / asset ...       # release asset 管附件
gt time create                             # 工时记录（tea times add）

# Actions
gt workflow run deploy.yml --ref main --field env=staging
gt run watch 34 --timeout 10m --expect-head HEAD
gt run logs 34 --job build --follow
gt run download 34
gt secret set DEPLOY_TOKEN
gt variable set ENV=production
gt runner list --org acme --disabled
gt runner token --global

# 项目看板 / 组织 / 其他
gt project create Roadmap --org acme --template basic_kanban
gt org / gt team / gt branch / gt wiki / gt ssh-key / gt webhook / gt admin user
gt search repo <关键词>
gt status
gt notification watch / mark-read / mark-unread
gt package upload tool 1.0.0 dist/tool-linux-amd64

# 个人效率
gt alias set bugs 'issue list --label bug'
gt completion bash|zsh|fish|powershell
gt doctor                                  # 诊断本机环境
gt upgrade                                 # 自升级
gt schema                                  # 列出全部 --json 字段与类型
```

## 脚本与输出

```sh
# JSON + jq 过滤（不要求本机装 jq）
gt issue list --repo owner/name --json number,title --jq '.[] | "\(.number)\t\(.title)"'

# CSV（带表头，同字段列表）
gt issue list --state all --csv number,title,state > issues.csv

# Go 模板（与 gh 同款）
gt pr view 123 --repo owner/name --template '{{.Title}}'

# 失败以一行 JSON 落 stderr；写命令可先预览
GITEA_CLI_ERROR_FORMAT=json gt pr merge 13 --squash
gt pr merge 13 --squash --dry-run
```

稳定性承诺：1.x 内 `--json` 字段只增不改，退出码与环境变量不改名不改义；文本输出面向人，脚本不要解析文本。

## CI 用法

```sh
# 通用 CI：两个环境变量即可，无需 gt auth login
export GITEA_TOKEN=...            # 令牌
export GITEA_INSTANCE_URL=https://gitea.example.org   # 或 GITEA_CLI_HOST

# Gitea Actions：只设 GITEA_TOKEN，gt 自动从 job 环境取实例地址
env:
  GITEA_TOKEN: ${{ gitea.token }}
```

## 从 tea 迁移：命令对照表

全局旗标：

| tea | gt |
| --- | --- |
| `--login`, `-l` | `--host` 与 `--user` |
| `--repo`, `-r` | `--repo`, `-R` |
| `--remote`, `-R` | `--remote` |
| `--output`, `-o` | `--json`, `--jq`, `--csv` |

命令：

| tea | gt |
| --- | --- |
| `tea login add` | `gt auth login` |
| `tea login list`, `tea whoami` | `gt auth status` |
| `tea login default` | `gt auth switch` |
| `tea login delete`, `tea logout` | `gt auth logout` |
| `tea login oauth-refresh` | `gt auth refresh` |
| `tea login helper setup` | `gt auth setup-git` |
| `tea open` | `gt browse`（或相关命令的 `--web`） |
| `tea clone` | `gt repo clone` |
| `tea repos create-from-template` | `gt repo create --template` |
| `tea repos search` | `gt search repo` |
| `tea issues` | `gt issue` |
| `tea comment` | `gt issue comment` / `gt pr comment` |
| `tea pulls` | `gt pr` |
| `tea pulls approve` | `gt pr review --approve` |
| `tea pulls reject` | `gt pr review --request-changes` |
| `tea pulls review-comments` | `gt pr review comments` |
| `tea pulls reply` / `resolve` / `unresolve` | `gt pr review reply` / `resolve` / `unresolve` |
| `tea labels list --save` | `gt label export` |
| `tea labels create --file` | `gt label import` |
| `tea labels update` | `gt label edit` |
| `tea milestones issues` | `gt milestone issue` |
| `tea releases assets` | `gt release asset` |
| `tea times add` | `gt time create` |
| `tea notifications read` / `unread` | `gt notification mark-read` / `mark-unread` |
| `tea organizations` | `gt org` |
| `tea ssh-keys add` | `gt ssh-key create` |
| `tea webhooks update` | `gt webhook edit` |
| `tea actions runs` | `gt run` |
| `tea actions workflows dispatch` | `gt workflow run` |
| `tea actions secrets` / `variables` | `gt secret` / `gt variable` |
| `tea admin users` | `gt admin user` |

其余命令保留原名改单数：`tea branches` → `gt branch`、`tea wiki` → `gt wiki` 等。手滑打成旧名时 gt 会提示：`gt pulls` 报 `unknown command "pulls" for "gt"; did you mean pr?`。

### 本插件视角的对照（Gitea 房当前用的 tea 命令 → gt 等价）

Gitea 房（`src/tracker/rooms/gitea/`）今天依赖的 tea 命令面在 gt 下的对应写法：

| 房间现用的 tea 命令 | gt 对应 |
| --- | --- |
| `tea issues ls --limit 1`（preflight 探针） | `gt issue list --limit 1` |
| `tea issues ls`（list / counts / listPage / listMaps 扫描） | `gt issue list`（每页上限与游标语义待真机核对） |
| `tea issues <编号>`（get） | `gt issue view <编号>` |
| `tea issues <编号> comments`（get 评论） | `gt issue comment list <编号>`（子命令形状待核对） |
| `tea issues create`（create；回包一行文本含 #编号，不认 --output） | `gt issue create`（结构化输出更稳，建后回读可简化） |
| `tea issues close <编号>` / `tea issues reopen <编号>` | `gt issue close <编号>` / `gt issue reopen <编号>` |
| `tea issues edit <编号> --add-labels / --remove-labels / --set-assignees / --description` | `gt issue edit <编号>`（整集替换形态待核对；标签整集替换可能不再需要差集增删） |
| `tea labels ls` / `tea labels create` / `tea labels update`（labels/list、assign 先建后挂、colors） | `gt label list` / `gt label create` / `gt label edit`（edit 支持改色） |
| `tea logins ls`（getCurrentUser 取 default 项） | `gt auth status` |
| `tea repos ls --fields owner,name,permission`（getRepoPermissions 翻页扫仓） | `gt repo list`（字段名待核对） |
| `tea login list`（preflight 登录探测） | `gt auth status` |
| `git remote get-url origin`（matches 兜底，非 tea） | 不变 |

对插件有直接意义的 gt 新能力：

- **`--json` 全覆盖 + 字段只增不改**：房间不再需要解析「一行文本抠 #编号」这类脆弱回包；`gt schema` 让每个操作的可用字段有据可查。
- **退出码文档化**（`gt help exit-codes`）：错误判档（`errors.ts` 的 AUTH/NOTFOUND/NETWORK 三档）可以换成按退出码 + JSON 错误判，不再靠匹配 tea 的原话正则。
- **`GITEA_CLI_ERROR_FORMAT=json`**：失败也有结构化输出，判档与日志埋点都能拿到结构。
- **issue 依赖与时间线是 gt 原生命令**：正文隐藏标记（`<!-- DSH-PARENT -->`、Blocked by 成对标记）的读写可以逐步换成原生接口——这与 GitHub 房走原生父子边是同一条路。
- **`GITEA_TOKEN` + `GITEA_INSTANCE_URL` 的 CI 口**：preflight 的「找 tea → 有登录项 → 能列票」三步在 CI 场景下可简化为环境变量探测。
- **gt 只支持 Gitea 28+**：迁移前要确认用户实例版本；tea 对旧实例仍是唯一选择，但 tea 已归档不再修复。
- **配置互不迁移**：切 gt 后用户必须重新登录；房间的 preflight 提示语与引导步骤要跟着改命令词汇（`room/prompts.ts` 的 `commandVocabulary.cli` 由 `tea` 换 `gt`）。

## 参考来源

- gt 官方仓库：https://gitea.com/gitea/cli （README 与 `docs/migrating-from-tea.md`）
- 发布公告：https://blog.gitea.com/release-of-gitea-cli-0.1.0/ 、https://blog.gitea.com/release-of-gitea-cli-1.0.0/
- tea 归档仓库：https://gitea.com/gitea/tea
- 二进制下载：https://dl.gitea.com/gitea-cli/
