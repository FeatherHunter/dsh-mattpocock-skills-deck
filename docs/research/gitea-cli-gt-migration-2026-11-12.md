# gitea-cli（gt）替代 tea CLI 调研笔记（2026-11-12）

调研目的：本插件目前通过 `tea` 命令驱动 Gitea 作为 issue tracker 后端；Gitea 官方已宣布 tea 迁移到新的 `gitea-cli`（命令名 `gt`）。本笔记查证 gt 的仓库状态、安装方式、服务器版本要求、认证体系、issue 子命令与机器可读输出，为插件新增 gt 后端与自动探测（远程服务器版本、本地是否装有 gt/tea）提供依据。

只记录查证到的事实，每条附来源链接；查不到的明确写「未查到」。

## 1. 官方仓库、项目状态与迁移声明出处

- 官方仓库：[gitea.com/gitea/cli](https://gitea.com/gitea/cli)，二进制名为 `gt`（README 原文："The binary is called `gt`"）。
- Go 模块路径：`gitea.dev/cli`（README 与 [pkg.go.dev/gitea.dev/cli](https://pkg.go.dev/gitea.dev/cli) 一致）。
- 发布状态：已发布。2026-10-23 发布 [gitea-cli 0.1.0](https://blog.gitea.com/release-of-gitea-cli-0.1.0/)；2026-11-02 发布 [gitea-cli 1.0.0](https://blog.gitea.com/release-of-gitea-cli-1.0.0/)，即首个稳定版。仓库 release 页显示有 5 个 release（[Releases](https://gitea.com/gitea/cli/releases)）。
- tea 迁移官方声明的出处：1.0.0 发布公告《gt 1.0.0, and goodbye to tea》（2026-11-02），原文要点：
  - "With it, `gt` replaces `tea` as Gitea's official CLI. `tea` will not get further releases, and its repository is archived."（tea 不再发版，仓库 [gitea.com/gitea/tea](https://gitea.com/gitea/tea) 已归档。）
  - 最后一个 tea 版本对它支持的 Gitea 版本仍可工作，但不再有新功能、修复或安全更新。
  - tea 的 agent skill 由 cli 仓库自带的 gt skill 取代。
- 1.0 起 gt 承诺语义化版本：1.x 内不删除或重命名命令、flag、`--json` 字段、退出码与 `GITEA_CLI_*` 环境变量，也不改其含义（[1.0.0 公告](https://blog.gitea.com/release-of-gitea-cli-1.0.0/)）。

## 2. 安装方式与命令名

命令名确认为 `gt`（README 与两篇公告均如此）。安装方式（[README](https://gitea.com/gitea/cli) 与 [1.0.0 公告](https://blog.gitea.com/release-of-gitea-cli-1.0.0/)）：

- 安装脚本（校验 SHA-256）：Linux/macOS/FreeBSD/OpenBSD `curl -fsSL https://gitea.com/gitea/cli/raw/branch/main/scripts/install.sh | sh`；Windows PowerShell `irm https://gitea.com/gitea/cli/raw/branch/main/scripts/install.ps1 | iex`。
- Homebrew：`brew install gitea-cli`（macOS 或 Linux）。
- Arch Linux：extra 仓库 `sudo pacman -S gitea-cli`。
- Linux 包：release 附 `.deb` / `.rpm` / `.apk` / Arch `.pkg.tar.zst`，含 man 页与 shell 补全。
- 二进制下载：[dl.gitea.com/gitea-cli](https://dl.gitea.com/gitea-cli/)（amd64、arm64、arm）。
- Docker：`docker run --rm gitea/gitea-cli --help`（镜像 [gitea/gitea-cli](https://hub.docker.com/r/gitea/gitea-cli)）。
- 源码：`go install gitea.dev/cli/cmd/gt@latest`（需 Go 1.27+）；`make install` 装进 GOPATH/bin。
- 脚本或二进制安装后可用 `gt upgrade` 自升级（校验 SHA-256）；由 Homebrew/系统包/Nix/go install 安装时，`gt upgrade` 会指回对应的包管理器升级命令。

## 3. 服务器版本要求与版本探测

- 最低服务器版本：**Gitea 28 及以上**。0.1.0 公告原文 "It requires Gitea 28 or newer"；1.0.0 公告原文 "`gt` supports Gitea 28 and newer"；[docs.gitea.com/cli](https://docs.gitea.com/cli/) 原文 "gt needs Gitea 28 or later"。0.1.0 公告还写明 "older versions are not supported"。也就是说：**远程 Gitea 服务器版本 < 28 时不能用 gt，只能继续用 tea**——这是插件自动判断的核心依据。
- gt 如何查询服务器版本：官方文档与 README 未写明 gt 内部是否调用 API `/version` 来校验版本。查证到的相关入口：
  - `gt doctor`：官方文档描述它 "checks your setup and suggests a fix for each problem it finds"（[docs.gitea.com/cli](https://docs.gitea.com/cli/)）。是否会把服务器版本过低列为问题、如何报告，未查到具体输出样例。
  - `gt auth status`：对应 tea 的 `login list` 与 `whoami`（[迁移指南](https://gitea.com/gitea/cli/src/branch/main/docs/migrating-from-tea.md)）。是否输出服务器版本未查到。
  - `gt api` 可以带 gt 的登录态调用任意 API 端点（[scripting 文档](https://docs.gitea.com/cli/scripting/)），因此插件可用 `gt api /version` 获取服务器版本（输出格式已实测，见「真机核对」第 4 条）。
- 版本检查失败（服务器 < 28）时 gt 的具体行为：实测 gt 1.2.0 对 1.27.2 服务器不拦截、不报错（见「真机核对」第 4 条）。

## 4. 认证方式与 tea 的兼容性

- gt 读取自己的配置，**不迁移、也不读取 tea 的配置**：0.1.0 公告原文 "Nothing is migrated. `gt` keeps its configuration in `~/.config/gitea-cli/` and does not read tea's config. Log in once with `gt auth login`."。两者二进制与配置目录都不同，可并存。
- 配置文件：偏好存 `config.yml`，实例与账号存 `hosts.yml`（均在 `~/.config/gitea-cli/` 下）。
- 凭据存放：默认存操作系统 keyring；需要私密文件存储时显式 `--credential-store file`（README）。tea 的 login/token 体系与之不兼容，**不能自动迁移**，需 `gt auth login` 重新登录。
- 登录方式（README 与 [authentication 文档入口](https://docs.gitea.com/cli/)）：
  - token：`gt auth login --host https://instance --with-token < token-file`。
  - OAuth：`gt auth login --host https://instance --oauth`（浏览器授权，不是所有部署都可用，且要求机器上有浏览器）。
- 环境变量（CI 用）：`GITEA_TOKEN` 提供令牌，实例由 `GITEA_CLI_HOST` 或 `GITEA_INSTANCE_URL` 提供；环境变量凭据不会被持久化。在 Gitea Actions 里只需 `GITEA_TOKEN`，gt 会像 gh 在 GitHub 上那样从 job 环境自动取得实例。其余环境变量用 `GITEA_CLI_` 前缀（0.1.0 公告）。`gt help environment` 可列出全部环境变量。
- 与 tea 环境变量的关系：tea 也用 `GITEA_TOKEN` 类变量（tea 具体变量名与优先级未在本笔记查证范围），gt 接受 `GITEA_TOKEN` 与 `GITEA_INSTANCE_URL` 这两个通用名；前缀变量从 `GITEA_`（tea）变为 `GITEA_CLI_`（gt）（[迁移指南](https://gitea.com/gitea/cli/src/branch/main/docs/migrating-from-tea.md)与 0.1.0 公告）。

## 5. issue 相关子命令清单（与 tea 对比）

以下为查证到的 gt issue/label 命令（来源：[迁移指南](https://gitea.com/gitea/cli/src/branch/main/docs/migrating-from-tea.md)、[README](https://gitea.com/gitea/cli)、[1.0.0 公告](https://blog.gitea.com/release-of-gitea-cli-1.0.0/)，完整子命令清单已实测见「真机核对」第 1、2 条）。

| 用途 | tea | gt |
| --- | --- | --- |
| issue 列表/详情 | `tea issues` | `gt issue`（`gt issue list`、`gt issue view 42`） |
| 评论 | `tea comment` | `gt issue comment`、`gt pr comment` |
| 关闭/重开 | 未单独查证 | `gt issue close` / `gt issue reopen`（已实测，见「真机核对」第 1 条） |
| 标签 | `tea labels list --save` / `create --file` / `update` | `gt label export` / `gt label import` / `gt label edit` |
| issue 移动到项目看板列 | 未查到 | `gt issue move 17 to "In progress"`（1.0.0 公告） |
| 评论附件 | 未查到 | `gt issue comment attachment`（list/upload/download/rename/delete，1.0.0 公告） |
| 编辑 | 未查到 | `gt issue edit`（标签增删与整集替换语义已实测，见「真机核对」第 3 条）；`gt pr edit`、`gt label edit`、`gt release edit` 无参数时开交互表单（1.0.0 公告） |

命名通则（迁移指南）：命令改为单数并按资源分组（`gt pr` 而非 `tea pulls`）；每个 `list` 同时接受 `ls`，每个 `delete` 同时接受 `rm`。其余 tea 命令保留单数形式，如 `tea branches` → `gt branch`。

输出格式对比：tea 用 `--output`（`-o`）指定输出，支持 `--output json`（tea 仓库 README，见 [tea README](https://gitea.com/gitea/tea/raw/branch/main/README.md)；tea 的 JSON 输出不在 1.x 稳定承诺范围内）。gt 把 `--output` 换成 `--json` / `--jq` / `--csv`：每个 list 与 view 命令都支持 `--json`，`--jq` 内置过滤（不需要装 jq），1.0 起每个支持 `--json` 的命令也支持 `--csv`；各命令 `--help` 的 JSON FIELDS 段列出字段，`gt schema` 可列出全部字段及类型；`--template` 用 Go 模板格式化同一份 JSON（[scripting 文档](https://docs.gitea.com/cli/scripting/)、[README](https://gitea.com/gitea/cli)、[0.1.0 公告](https://blog.gitea.com/release-of-gitea-cli-0.1.0/)）。

## 6. 机器可读输出与退出码

- JSON 稳定性：1.0 公告承诺 1.x 内 `--json` 字段只增不改不删，字段含义不变；纯文本输出为人读，可能在版本间变化，脚本一律用 `--json`。
- 失败时可设 `GITEA_CLI_ERROR_FORMAT=json`，错误以一行 JSON 打到 stderr（[README](https://gitea.com/gitea/cli)）。
- 退出码：`gt` 成功为 0，命令失败为 1，用法错误为 2，认证缺失或被拒为 4；部分命令另有专用码——`gt pr checks` 检查仍在进行时退出码 8，`gt run watch` 失败的 run 退出码 5、run 属于另一提交时退出码 6；`gt help exit-codes` 列出全部退出码及其含义（[scripting 文档](https://docs.gitea.com/cli/scripting/)、[0.1.0 公告](https://blog.gitea.com/release-of-gitea-cli-0.1.0/)、[1.0.0 公告](https://blog.gitea.com/release-of-gitea-cli-1.0.0/)）。`docs/exit-codes.md` 独立文件在仓库中不存在（404），退出码文档通过 `gt help exit-codes` 提供。
- 其他脚本友好项：`--dry-run` 预览写请求不发送（README）；CI 下更新通知自动静默，`GITEA_CLI_NO_UPDATE_NOTIFIER` 可关（1.0.0 公告）。

## 对插件的直接推论（基于以上事实）

- 自动判断"远程服务器是否支持 gt"：gt 官方要求 Gitea ≥ 28。获取服务器版本可走 `gt api`（带登录态）或直接调 API `/version`（tea 现有后端已有的能力，可复用判断逻辑）。
- 自动判断本地安装：探测 `gt` 与 `tea` 两个二进制（`--version` / PATH 查找）；两者可并存，`gt` 优先。
- 配置不可迁移：gt 后端首次使用需用户 `gt auth login`；插件如需无人值守，走 `GITEA_TOKEN` + `GITEA_CLI_HOST` / `GITEA_INSTANCE_URL` 环境变量。
- 机器可读输出：gt 的 `--json` 字段受 1.x 稳定性承诺保护，适合作为插件解析目标；`gt schema` 可用于校验字段。

## 未查到 / 待实测

（2026-11-12 真机核对后，票 #20 要求的五项已全部实测并写进上文「真机核对」一节；以下为核对后仍悬空的项：）

1. gt 内部如何校验服务器版本、版本过低时的报错文案与退出码——实测表明 gt 1.2.0 对 1.27.2 服务器并不拦截（见真机核对第 4 条），低版本具体报错行为仍无法实测。
2. `gt auth status` / `gt doctor` 是否直接输出服务器版本号——`gt auth status` 实测输出各列（host/user/token/keyring 等）均不含版本号，`gt doctor` 未实测。
3. gt 各命令 JSON 字段的完整清单——官方指引看 `gt schema` 或 release docs 归档，票 #20 未要求逐条抓取。

## 真机核对（2026-11-12，gt 1.2.0，实例 gitea.vvmath.com，服务器自报版本 1.27.2）

以下各项在真机上逐条实测，测试仓库 `zhaolj/dsh-mattpocockskill-test`，实测后已清理测试票 #7。

### 1. `gt issue close` / `gt issue reopen` 子命令拼写

实测确认两者都存在，拼写就是 `gt issue close` / `gt issue reopen`：

```
$ gt issue close --help
USAGE
  gt issue close {<number> | <url>}... [flags]
FLAGS
  -c, --comment string   Leave a comment before closing the issue
      --dry-run          Show the write requests gt would send, without sending them

$ gt issue reopen --help
USAGE
  gt issue reopen {<number> | <url>}... [flags]
FLAGS
  -c, --comment string   Leave a comment before reopening the issue
```

实测写操作：`gt issue close 7 --json number,state` → `{"number":7,"state":"closed"}`；`gt issue reopen 7 --json number,state` → `{"number":7,"state":"open"}`。两者都接受多个票号批量操作，支持 `--json`（字段集与 `gt issue list` 相同）。对应 tea 无单票 close/reopen 的差距补齐了。

### 2. `gt issue comment` 列评论的子命令

`gt issue comment` 既是写命令也是命令组，列评论用：

```
$ gt issue comment list <number>   # 别名含 ls 通则
```

实测输出摘录（`gt issue comment list 4 -R … --json id,author,body`）：

```json
[{"author":"zhaolj","body":"真机验证评论 20261111013145","id":839}]
```

注意：JSON 里 `author` 是登录名字符串，不是对象（插件解析时不能按 `author.login` 取）；`id` 是数字。子组还有 `view` / `edit` / `delete` / `attachment`。写评论实测：`gt issue comment 7 --body "…" --json id,body` → `{"body":"真机核对测试评论","id":894}`。

### 3. `gt issue edit` 对标签是整集替换还是增删式

两种都有（`gt issue edit --help` 原文："Label and assignee flags add to or remove from each issue's current values; the --set flags replace them."）：

- 增删式：`--add-label name` / `--remove-label name`（可重复）；
- 整集替换：`--set-labels strings`（空值即清空全部标签）。

实测（测试仓库仅有标签「真机验证」）：`--add-label 真机验证` → `["真机验证"]`；`--remove-label 真机验证` → `[]`；`--set-labels ""` → `[]`。标签不存在时报错 `Error: label "bug" not found in …`（失败快，不静默）。**结论：插件侧 setLabels 不再需要自己算差集增删，直接用 `--set-labels` 即可。**

### 4. `gt api /version` 的输出格式

实测：`gt api /version` → `{"version":"1.27.2"}`。就是一个单键 JSON 对象，键名 `version`，值为服务器自报版本字符串；插件解析取 `.version` 即可。`gt api` 带登录态，端点是 `/api/v1` 下的路径，还支持 `--paginate` / `--slurp` / `--jq`。

一个附带观察：本实例自报版本 1.27.2（即官方命名里的 Gitea 27 线），而官方要求 Gitea ≥ 28，但上述全部命令实测都能正常工作——gt 实际并未在客户端硬拦低版本服务器。插件做版本判定时不能依赖 gt 自己报错，仍需按 `gt api /version` 的返回值自行判档。

### 5. `gt issue list` 的分页与每页上限语义

`gt issue list --help` 实测：`-L, --limit int`，范围 1..1000（写死校验，`-L 1001` 报 `Error: invalid argument "1001" for "-L, --limit" flag: must be 1..1000`），默认 30；`--page int` 默认 1（1 起始）。语义与 tea 的 `--limit`/`--page` 对应。实测 `-L 2 --page 1` → 返回票号 6,5 且附带提示 `more results available; use --page 2`，`--page 2` → 4,3，翻页按列表序推进。过滤参数有 `--state {open|closed|all}`（默认 open）、`--label`、`--assignee`、`--author`、`--search` 等；每页条数超仓库存量时正常返回剩余全部。

### 6. 里程碑的挂载与清空语义（2026-11-16 补测，票 #26 非目标项）

实测（测试仓库 zhaolj/dsh-mattpocockskill-test，临时测试票 #10 与临时里程碑，测完已删除）：

- 挂载：`gt issue edit 10 --milestone '里程碑名' --json` → 退出码 0，`gt issue view --json milestone` 回 `{"milestone":{"id":2,"title":"…"}}`（按名字认，回包是 id+title 对象）。
- 空串直传：`--milestone ''` → 退出码 2（用法错），`GITEA_CLI_ERROR_FORMAT=json` 时 stderr 单行 `{"error":{"code":2,"kind":"usage","message":"--milestone requires a title or ID; use --remove-milestone to clear it"}}`，票面不受影响。与票 #23 回填评论的 2026-11-15 实测一致。
- 清空：`--remove-milestone` → 退出码 0，回读 `milestone` 为 `null`——这是 gt 分支清里程碑唯一可用旗标，行为与 tea 的 `--milestone ""` 清空语义对齐。

**对插件的影响：现状（票 #26 已钉死）是 gt 分支对空串照值直传，选中 gt 时「清里程碑」这一操作会如实硬失败、无法完成；要支持清空需改走 `--remove-milestone`，取舍见对应拍板票。**

## 来源

- [gt 1.0.0, and goodbye to tea — Gitea Blog, 2026-11-02](https://blog.gitea.com/release-of-gitea-cli-1.0.0/)
- [gt, the new Gitea CLI — Gitea Blog, 2026-10-23](https://blog.gitea.com/release-of-gitea-cli-0.1.0/)
- [gitea-cli 仓库 README — gitea.com/gitea/cli](https://gitea.com/gitea/cli)
- [Migrating from tea — cli 仓库 docs](https://gitea.com/gitea/cli/src/branch/main/docs/migrating-from-tea.md)
- [Gitea CLI 官方文档 — docs.gitea.com/cli](https://docs.gitea.com/cli/)
- [Output and scripting — docs.gitea.com/cli/scripting](https://docs.gitea.com/cli/scripting/)
- [tea 仓库（已归档）— gitea.com/gitea/tea](https://gitea.com/gitea/tea)
- [dl.gitea.com/gitea-cli 二进制下载](https://dl.gitea.com/gitea-cli/)
- [pkg.go.dev/gitea.dev/cli](https://pkg.go.dev/gitea.dev/cli)
