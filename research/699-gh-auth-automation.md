# 研究：把 gh 配置好这件事，哪些步骤能自动化、哪些必须人来做（#699）

这张票要回答 #701 里的那句话：「我们是否插件可以做到直接帮用户把 GH CLI 给安装好并且帮助用户配置好吗？我不确定可以做到，也不知道怎么做到。」——本报告只管**配置（登录）**这半边；「安装 gh」是另一张票，本报告只在需要说清边界的地方提它一句，不查它。

调查对象是本机真实安装的 GitHub 官方命令行工具 `gh`：`gh --version` 报 `gh version 2.97.0 (2026-07-31)`。凡是 gh 自身的说法，都按 gh 官方手册页面、以及 gh 官方源码仓库同一个版本标签 `v2.97.0` 里的代码核对；凡是这台机器上的事实，都按本仓库代码或当场跑出来的结果写清出处。

**一句话结论：把「配置 gh」拆到最细，插件能自己做的只有「起 `gh` 命令、把 gh 打出来的字读回来、按退出码与输出把状态判成已登录／未登录／网络未知」这三类；真正的授权动作只有人在浏览器里能做一次——登录自己的 GitHub 账号并对这次授权点「同意」（走令牌路线，则是人到 GitHub 网页上亲手生成一个令牌）；而插件起的 `gh` 进程拿到的是一个被擦过的环境，`GH_TOKEN` 与 `GITHUB_TOKEN` 都被去掉，所以「帮用户把 gh 配置好」在诚实口径上只能是「插件把该做的事铺好、把结果复核，授权那一下由人在浏览器里点」。**

另外三条结论各自有专门一节：令牌必须由人在 GitHub 网页上创建（第 B 节）、登录凭据存在当前 Windows 用户的本地环境里、换机器或换 Windows 用户都不会跟着走（第 C 节）、插件起的进程既拿不到环境令牌、又能读到用户已经登录好的凭据（第 D 节）。

---

## A `gh auth login` 今天有哪几种走法，各自交互长什么样

### A.1 一共四条入路

按官方手册 `gh auth login` 页与 gh 源码（`pkg/cmd/auth/login/login.go`，v2.97.0），今天能用到的入路是这四条：

1. **默认（不加任何开关）：交互式浏览器授权。** 手册原文：默认的认证方式是「网页浏览器流程」；完成后令牌会存进系统凭据库，找不到凭据库或用不了时退回写成明文文件，存放位置可以用 `gh auth status` 看到。
2. **`--web`：直接走浏览器授权，跳过「你想怎么认证」那一问。** 手册给的例子是 `gh auth login --web --clipboard`（开浏览器并把一次性设备码复制到剪贴板）。
3. **`--with-token`：从标准输入读一个令牌。** 手册原话是「pass in a personal access token (classic) on standard input」，并写明令牌至少要 `repo`、`read:org`、`gist` 三个 scope；手册同时提醒：细粒度个人访问令牌（fine-grained personal access token）塞给这条路过资源时容易出怪行为，它更推荐把细粒度令牌放进 `GH_TOKEN` 环境变量。
4. **根本不登录：用环境变量里的令牌。** 手册在同一页写了「gh 也会使用环境变量里的认证令牌，这种方式最适合无人值守的场景」，并指向 `gh help environment`。这条路在第 B 节展开。

### A.2 交互式登录时，gh 会依次问哪几个问题

问题清单来自 gh 源码 `pkg/cmd/auth/login/login.go` 与 `pkg/cmd/auth/shared/login_flow.go`（v2.97.0），措辞是源码里的原文：

| 顺序 | 出现的条件 | 屏幕上的问题 | 选项 |
|---|---|---|---|
| 1 | 没给 `--hostname`，而且是在终端里跑 | `Where do you use GitHub?` | `GitHub.com` / `Other`（选 Other 会再让人填主机名） |
| 2 | 没给 `--git-protocol` | `What is your preferred protocol for Git operations on this host?` | `HTTPS` / `SSH` |
| 3 | 上一步选了 HTTPS，而且 git 当前的凭据助手不是 gh 自己 | `Authenticate Git with your GitHub credentials?` | 默认 Yes（同意后 gh 会替 git 配置凭据助手，并给授权额外加一个 `workflow` scope） |
| 4 | 上一步选了 SSH | 先列出本机已有的 SSH 公钥问要不要传上去（`Upload your SSH public key to your GitHub account?`），没有公钥时问是否生成新密钥（`Generate a new SSH key to add to your GitHub account?`），选定后在传之前问密钥名字（`Title for your SSH key:`） | 由本机已有的密钥决定 |
| 5 | 没给 `--web`，而且是在终端里跑 | `How would you like to authenticate GitHub CLI?` | `Login with a web browser` / `Paste an authentication token` |

如果第 5 题选了「粘贴一个令牌」，gh 会先把这两行打到屏幕（源码原文，第二行的 scope 清单由「必须的两个」加上前面几问里攒下来的额外范围拼出来，例如前面同意了「让 gh 做 git 凭据助手」时会多一个 `workflow`）：

```
Tip: you can generate a Personal Access Token here https://<主机名>/settings/tokens
The minimum required scopes are 'repo', 'read:org'.
```

值得注意的是：**屏幕上写的最小 scope 是 `repo, read:org`，而手册写的最小集合是 `repo, read:org, gist`，gh 自己校验粘贴进来的令牌时则只卡 `repo` 与 `read:org`**（`pkg/cmd/auth/shared/oauth_scopes.go` 的 `HeaderHasMinimumScopes`：`repo` 必须有；`read:org` 可以由 `write:org` 或 `admin:org` 顶替；另外令牌自称没有任何 scope 时，gh 直接放行不判）。

### A.3 选了浏览器授权之后，一次性设备码出现在哪里

gh 用的是 GitHub 的官方授权流程（GitHub 文档把它叫 device flow）。来源：gh 源码 `internal/authflow/flow.go`（v2.97.0）+ GitHub 官方文档 `authorizing-oauth-apps`（github/docs 仓库里的原文）。

1. gh 先向 GitHub 换一个一次性用户码和一个验证网址，然后**把这个码打到 gh 自己的标准错误输出上**，原文格式是：
   `! First copy your one-time code: XXXX-XXXX`。
   如果启动时带了 `--clipboard`，gh 会先试着把码复制到剪贴板并打印 `! One-time code (XXXX-XXXX) copied to clipboard`，复制失败则打印失败原因，然后再打上面那行。
2. 接着 gh 处理网址：
   - **在终端里交互着跑**：打印 `Press Enter to open <网址> in your browser...`，等人在终端按一下回车，然后调系统默认浏览器打开这个网址。
   - **不是交互着跑**（标准输入不是终端，或提示被关掉）：**不等待回车、也不自动开浏览器**，直接打印 `Open this URL to continue in your web browser: <网址>`。
3. **人在浏览器里要做的事**：打开这个网址（github.com 上就是 `https://github.com/login/device`），登录自己的 GitHub 账号，把刚才那个码输进去，然后点同意授权。GitHub 文档写明：这个码是 8 个字符、中间一个连字符（例子 `WDJB-MJHT`），必须在 15 分钟（900 秒）内输入，超时就作废、得重新来一次；用户点取消会得到一个 `access_denied` 错误，且那个码不能再用。
4. gh 在后台按 GitHub 给的间隔轮询授权结果，人点完授权之后它拿到令牌，打印 `✓ Authentication complete.`；如果这次登录顺带配了 git 协议，会再打印 `- gh config set -h <主机> git_protocol <协议>` 与 `✓ Configured git protocol`；如果令牌最终只能落成明文，会打印 `! Authentication credentials saved in plain text`；最后打印 `✓ Logged in as <用户名>`（如果这个账号本来就登录过，还会打印一行 `! You were already logged in to this account`）。

**这一节最要紧的分工判断**：把上面四步按「谁做得到」分一下，程序能做的部分是——起 `gh` 命令、从它的输出里把一次性码与网址读出来、把网址交给浏览器打开或摆给人看、等它轮询到结果、把退出码与输出判成状态；只有人能做的部分是在浏览器里**登录账号并点「同意」**这一下（等价于人回答「我同意把这台设备的访问权交给这个应用」），以及 SSH 那条支路里让人拿主意要不要上传或新建密钥。这两件事都不是权限问题，而是「同意」这个动作只能由本人表示。

### A.4 其余相关开关与相邻命令

- `--hostname`：指定要认证的 GitHub 实例，默认是 `github.com`；企业版/自建实例走它。
- `--git-protocol`：给 git 操作选 `ssh` 或 `https`；手册明确写「这个设置会对该主机上的所有用户生效」（因为它是按主机记的配置，不是按账号记的）。
- `--skip-ssh-key`：跳过「要不要上传/新建 SSH 密钥」那一段提问。
- `--scopes`：额外申请的授权范围。它和 `--with-token` 不能同时给，`--web` 也不能和 `--with-token` 同时给——源码里同时给会直接报 `specify only one of`。
- `--insecure-storage`：明确要求把凭据存成明文而不是进系统凭据库；手册把「安全存储」写成默认，源码里那条 `--secure-storage` 开关现在是隐藏的空开关，注释写着「安全存储自 2023/04/04 起就是默认」。
- `gh auth refresh`：扩权或修权限（`--scopes` / `--remove-scopes` / `--reset-scopes` / `--clipboard`）；源码写明不在终端里跑时必须显式给 `--hostname`，否则直接报错。
- `gh auth status` / `gh auth switch` / `gh auth token`（打印当前令牌）/ `gh auth logout` / `gh auth setup-git`（把 gh 设成 git 的凭据助手；手册写明没有任何已认证主机时这条命令直接失败）。

**一条容易踩的坑**：只要 `GH_TOKEN` 或 `GITHUB_TOKEN` 已经在起作用，`gh auth login` 与 `gh auth refresh` 都会拒绝把凭据写进配置，原文提示是：`The value of the <变量名> environment variable is being used for authentication.` + `To have GitHub CLI store credentials instead, first clear the value from the environment.`（源码 `login.go` / `refresh.go` 的 `AuthTokenWriteable` 分支，用的是 gh 的「静默错误」：只打印上面那两行，不再叠一层错误信息，命令以失败结束）。也就是说，「先用环境令牌，再教 gh 记住登录」这两件事在同一个环境里是互相顶掉的。

---

## B 令牌路线：`GH_TOKEN` 与 `GITHUB_TOKEN`

### B.1 谁赢，谁读它

- 官方手册 `gh environment` 页把这两个变量写在一行：`GH_TOKEN`、`GITHUB_TOKEN`（**按优先级顺序**）——用于目标是 `github.com` 或其 `ghe.com` 子域的命令；并明确写「设置它会避免被提示去认证，且优先于此前保存的凭据」。企业版主机（GitHub Enterprise Server）看的是另一对：`GH_ENTERPRISE_TOKEN`、`GITHUB_ENTERPRISE_TOKEN`，同样按这个顺序。
- gh 底层读令牌的代码是官方库 `cli/go-gh` 的 `pkg/auth/auth.go`（v2.13.0）：目标主机归一化成 `github.com`（或 ghe.com 租户域名、`github.localhost`）时，先看 `GH_TOKEN`，为空再看 `GITHUB_TOKEN`；企业版主机先看 `GH_ENTERPRISE_TOKEN`，再看 `GITHUB_ENTERPRISE_TOKEN`；两边都没命中，才回落到配置文件 `hosts.<主机>.oauth_token`。
- **本机实测（两个都设成无效值）**：在同一个终端里设 `GH_TOKEN='bad-1'`、`GITHUB_TOKEN='bad-2'` 再跑 `gh auth status`，gh 报的是 `GH_TOKEN`——证明 `GH_TOKEN` 排在前面。（这条同时说明「只要设了，gh 就先信它」，哪怕同时还有一个有效的 `GITHUB_TOKEN` 也轮不到。）
- 谁读它：手册口径是「当某条命令的目标是 github.com 或 ghe.com 子域时」——也就是所有要访问 GitHub 接口的命令都会读到；`gh auth token` 打印的也正是这个「当前生效的令牌」（源码 `pkg/cmd/auth/token/token.go` 走 `ActiveToken`，顺序与上面一致）。

### B.2 `gh auth status` 在两种模式下怎么判，退出码与输出原文

判定逻辑来自 gh 源码 `pkg/cmd/auth/status/status.go`（v2.97.0），退出码规则来自官方手册 `gh auth status` 页：

- 要显示的主机清单来自「已知主机」（官方库 `KnownHosts`：`GH_HOST` 指定的主机、能解析出令牌的 `github.com`、以及配置文件里记着的主机）。
- 每台主机先取「当前账号的令牌 + 令牌来源」，再拿这个令牌去问 GitHub 接口。**令牌来源不是以 `_TOKEN` 结尾时**（也就是来自配置文件或凭据库），用户名直接读配置文件；**来源是环境变量时**（`GH_TOKEN` / `GITHUB_TOKEN` / `GH_ENTERPRISE_TOKEN` / `GITHUB_ENTERPRISE_TOKEN`，都以 `_TOKEN` 结尾），配置文件里没有用户名，gh 改成现场调接口问「我是谁」。
- 手册的退出码规则：**任何一台主机（或 `--hostname` 指定的那台）有认证问题，命令就以退出码 1 结束、输出写到标准错误**；加了 `--json` 时除了致命错误一律退出码 0。
- 输出里的令牌默认打码：`gh auth status` 会把 `ghp_` / `gho_` / `ghu_` / `ghs_` / `ghr_` / `github_pat_` 开头的令牌只留前缀再补一串星号（源码 `maskToken`）；想要原文得加 `--show-token`。
- **本机实测（凭据来自配置文件）**：

  ```
  github.com
    ✓ Logged in to github.com account <用户名> (C:\Users\<用户名>\AppData\Roaming\GitHub CLI\hosts.yml)
    - Active account: true
    - Git operations protocol: https
    - Token: gho_************************************
    - Token scopes: 'admin:enterprise', ..., 'repo', 'user', 'workflow', ...
  ```
  退出码 0。括号里那一项就是令牌来源：配置文件路径（源码里把来源 `oauth_token` 换成 `<配置目录>/hosts.yml` 显示）。
- **本机实测（环境令牌无效）**：

  ```
  github.com
    X Failed to log in to github.com using token (GH_TOKEN)
    - Active account: true
    - The token in GH_TOKEN is invalid.
  ```
  退出码 1。注意这一档**不会**打印「重新登录」「忘掉账号」那两行建议——源码里那两行只在来源可写（不是环境变量）时打印。

### B.3 令牌路线与浏览器授权的取舍

| 比较项 | 环境令牌／个人访问令牌 | 浏览器授权（gh 默认流程） |
|---|---|---|
| 谁产生它 | 人在 GitHub 网页上点「Generate token」生成，再交给 gh | gh 向 GitHub 申请，人在浏览器点同意后由 GitHub 下发 |
| 权限范围 | 人在网页上勾选：classic 令牌拿到的是「你能访问的全部仓库」的权限（GitHub 文档原话）；fine-grained 令牌按资源所有者、仓库、权限逐项勾（官方列了一串当前的功能缺口，例如不能用于访问多个组织的资源、不能调 Checks 接口） | gh 申请的是 `repo`、`read:org`、`gist` 三个最小集合，加上这次交互里额外加上的（例如同意让 gh 做 git 凭据助手时会加 `workflow`），再加 `--scopes` 里给的 |
| 过期 | 过期时间在建的时候选：GitHub 文档写明 fine-grained 令牌可用 URL 参数 `expires_in` 取 1 到 366 天，或不设过期，默认 30 天；组织/企业可以设「最长寿命」上限把它压短。另外 GitHub 会自动吊销一年没被用过的令牌，过期或被吊销后不能恢复，只能重建 | 令牌由 gh 保存，gh 侧可以 `gh auth refresh` 重新走一次授权；源码里 `AuthTokenRefreshable` 只对 `gho_` 开头的令牌说「可以 refresh」 |
| 人必须亲手做的部分 | 必须：上 GitHub 网页、选权限、点生成、把令牌交给 gh（gh 没有任何命令能替人创建一个令牌） | 必须：在浏览器里登录账号并点同意 |
| 适配机器无人值守时的差别 | 令牌可以放在环境变量里，命令不需要终端；但设了它以后 `gh auth login` / `gh auth refresh` 拒绝写配置 | 必须先有一次人在浏览器里的授权，之后本机才能读到凭据 |

---

## C 登录之后凭据落在哪里，换机器或换 Windows 用户会怎样

### C.1 两个可能落点

- 官方手册 `gh auth login` 页的原文：默认网页流程完成后，认证令牌「会被安全地存进系统凭据库」；**如果找不到凭据库，或者用它时出了问题，gh 会退回把令牌写进一个明文文件**，具体存在哪可以用 `gh auth status` 看。
- **落点一：配置目录下的 `hosts.yml`。** 配置目录的判定顺序写死在官方库 `cli/go-gh` 的 `pkg/config/config.go`（v2.13.0）里：先看环境变量 `GH_CONFIG_DIR`；没有就看 `XDG_CONFIG_HOME`（取它的 `gh` 子目录）；再没有且系统是 Windows 且有 `AppData`，就取 `AppData\GitHub CLI`；否则取用户主目录下的 `.config/gh`。配置文件分成两份：`config.yml`（git 协议、编辑器、分页器这类通用设置）与 `hosts.yml`（各主机的账号与令牌），写文件时权限给到 0600。手册 `gh environment` 页对 `GH_CONFIG_DIR` 的说明与此一致。
- **落点二：系统凭据库。** gh 的配置代码（`internal/config/config.go`）在登录时先试着把令牌写进系统凭据库，服务名是 `gh:<主机名>`；写成功就把 `hosts.yml` 里对应账号的明文令牌删掉；写失败才退回明文，并让上层打印 `! Authentication credentials saved in plain text`。读取顺序是**环境变量 → `hosts.yml` 明文 → 系统凭据库**（源码注释原话：searching environment variables, plain text config, and lastly encrypted storage）。
- **Windows 上这个「系统凭据库」就是 Windows 凭据管理器**：gh 引入的是 `github.com/zalando/go-keyring`（gh 源码仓库 `go.mod` 里 v2.97.0 的依赖），而这个库在 Windows 上的实现文件 `keyring_windows.go` 只做一件事——调 `github.com/danieljoos/wincred` 读写 Windows 的「通用凭据」，凭据名字是 `<服务名>:<用户名>`，也就是 `gh:github.com:<用户名>`。

### C.2 本机实况

- `gh auth status` 的括号里给的是 `C:\Users\<用户名>\AppData\Roaming\GitHub CLI\hosts.yml`，也就是说**这台机器上当前这个账号的令牌是从明文 `hosts.yml` 里读出来的**，没有走 Windows 凭据管理器。至于为什么当年没写进凭据管理器（登录时的环境不支持？当时用了 `--insecure-storage`？），本报告没有查。
- 本机没有配置用户级或机器级的 `GH_TOKEN`（在注册表里查 `User` 与 `Machine` 两处都是空），也没有设 `GH_CONFIG_DIR` 与 `GH_HOST`。

### C.3 换机器、换 Windows 用户会怎样

- 两个落点都长在「当前 Windows 用户的本地环境」里：`%AppData%` 是用户主目录下的路径；凭据管理器里的通用凭据也是按登录用户存放的（后半句属于 Windows 自身行为，本次没有查微软官方文档，列在第 7 节）。
- 所以：**换一台机器，或者在同一台机器上换一个 Windows 用户，gh 会当成从来没登录过**——主机、账号、令牌、git 协议这些记录都不会跟着走，必须重新走一次登录（或者由人手动把 `hosts.yml` 拷过去）。本报告没有任何一步依赖「别的机器上的登录态也跟着走」。
- 另外会写下东西的一步是 `gh auth setup-git`：官方手册写明它把 gh 配成 git 的凭据助手（默认给所有已认证主机配），这条改动写在 git 自己的配置里，也属于当前用户的本地状态。

---

## D DSH 这边的硬约束：插件起的进程拿到的是被擦过的环境

### D.1 擦除规则

DSH 里负责起进程的包是 `@deepseek-ai/dsh-subprocess`。本机这份物理拷贝是 `C:\Users\辰辰洋洋\.dsh\profiles\node_modules\@deepseek-ai\dsh-subprocess\lib\index.js`，规则原文：

```js
const SENSITIVE_ENV_PATTERN = /KEY|PASSWORD|SECRET|TOKEN/i;   // lib/index.js:32
function scrubbedParentEnv() {                                 // lib/index.js:50-56
  const env = {};
  for (const [key, value] of Object.entries(process.env))
    if (value !== void 0 && !SENSITIVE_ENV_PATTERN.test(key) && !key.toUpperCase().startsWith("DSH_")) env[key] = value;
  ...
}
```

两句话：**名字里带 `KEY`、`PASSWORD`、`SECRET`、`TOKEN` 任一形状的变量一律不传**（不分大小写）；**名字以 `DSH_` 开头的一律不传**；其余照抄。真正起进程的地方先拿这个结果作底，再叠加调用方显式给的变量：`@deepseek-ai/dsh-subprocess-local/lib/runner-launch-COYGu0Dl.js:649-662` 的 `childEnv(extra)`，被用在同一文件第 1139 行 `env: childEnv(spec.env)`。

### D.2 逐个变量判定（外加本机实测）

本机实测办法：直接用 node 调 DSH 这个函数本身，先设好六个变量再看谁还在。命令与结果：

```
kept: GH_CONFIG_DIR,GH_HOST
PATH: false USERPROFILE: true APPDATA: true      ← 第一次用大写 PATH 查，Windows 上实际键名是 Path
Path: true HOME: false GH_TOKEN: false keys= 72  ← 第二次按真实键名复查
```

| 变量 | 结果 | 依据 |
|---|---|---|
| `GH_TOKEN` | **被删** | 名字含 `TOKEN`（实测也不在结果里） |
| `GITHUB_TOKEN` | **被删** | 同上 |
| `GH_ENTERPRISE_TOKEN` / `GITHUB_ENTERPRISE_TOKEN` | **被删** | 同上 |
| `GH_CONFIG_DIR` | **保留** | 名字里没有 KEY／PASSWORD／SECRET／TOKEN（实测在结果里） |
| `GH_HOST` | **保留** | 同上 |
| `Path` / `USERPROFILE` / `APPDATA` | 保留 | 名字不匹配擦除形状 |
| 任何 `DSH_*` | 被删 | 第二条规则（实测 `DSH_X` 不在结果里） |

### D.3 插件今天是怎么起 gh 的

本仓库里起 `gh` 的地方一共三处，**三处都没有传 env**，因此子进程拿到的就是上面那份擦过的环境：

| 位置 | 写法 |
|---|---|
| `src/host/repoKeys.js:40-51`（`runGh`，面板取票走这条） | `subprocess.spawn({ argv: [exe].concat(args), cwd, stdio: { stdin: 'ignore', ... }, graceMs: 2000 })` |
| `src/host/repoKeys.js:100-110`（`execProc`，git 与自建操作走这条） | 同样只给 `argv` / `cwd` / `stdio` / `graceMs` |
| `src/host/platformChannel.js:183-195`（`detectionExec`，后端的 `ctx.exec` 走这条） | 同样只给 `argv` / `cwd` / `stdio` / `graceMs` |

另外注意三处的 `stdio.stdin` 都写成 `'ignore'`：**今天插件起的 gh 进程连标准输入都没有接**。这一点对「把令牌从标准输入喂给 `gh auth login --with-token`」这种走法是有影响的。

### D.4 由此得到的两条边界

1. **插件起的 gh 进程读不到环境里的令牌。** 父进程（DSH 那棵进程树）里就算有 `GH_TOKEN`／`GITHUB_TOKEN`，也被擦掉，不进子进程；本机也确实没有用户级/机器级的 `GH_TOKEN`。要让子进程拿到令牌，只有一条路：**调用方自己在 spawn 时显式把这个变量传进去**（DSH 的合并规则是「显式项在擦除之后叠加」，显式给的值能活）。
2. **插件起的 gh 进程能读到用户已经登录好的凭据。** 因为凭据不在环境变量里，而在 `hosts.yml`（路径由 `APPDATA` 或 `GH_CONFIG_DIR` 决定，这两个都没被擦掉）或 Windows 凭据管理器里（由 gh 自己调系统接口读）。**本机实测正是这个情形**：在没有任何令牌的环境里跑 `gh auth status`，退出码 0、报已登录——这份环境与插件起 gh 时拿到的环境在令牌这一点上是一样的。

这也是插件今天能工作的原因：面板上能看到票，靠的就是「用用户自己的登录态去起 gh」。

### D.5 插件现在把「登录」这件事做成什么样

和本报告直接有关的是：插件今天**只做引导与判定，不做登录动作**。

- 检查链里有一项 `gh:authed`（标签「已登录 GitHub」，定义在 `src/shared/tracker/check-catalog-dirs.js:117-124`），它的判据就是跑 `gh auth status`（`src/host/tracker/backends/github/preflight.js:58-70`）。失败时给出的动作是往会话里注入一段提示词（`inject-prompt`，`src/host/tracker/backends/github/index.js:53-62`），提示词原文写的是「请为本机完成 GitHub CLI 登录（gh auth login）：1. 终端执行 gh auth login 2. 按向导选择 GitHub.com → HTTPS → Yes → 浏览器授权（OAuth）……」（`src/client/kernel/prompts.js:31`）——也就是叫人自己去终端跑、自己去浏览器点。
- 「未登录」的判定不靠猜文案：源码里带上了 gh 的退出码，并注明「gh 自己的约定是「需要登录 = 退出码 4」（`gh help exit-codes`）」（`src/host/tracker/backends/github/client.js:159-161`、`src/host/tracker/backends/github/label-colors-ops.js:236-241`）。本机跑 `gh help exit-codes` 的原文是：成功 0、失败 1、被取消 2、**需要认证 4**。
- 网络失败与未登录是分开的两档：`kind === 'auth'` 判失败并给登录引导，网络异常判「等待（pending）」，理由写在 `src/host/detectChain.js:110-120`（避免网络抖动时误报「未登录」）。
- 与仓库既有纪律相符的一处事实：插件记日志时「参数只记命令名，不记完整参数（避免令牌落盘）」（`src/host/tracker/backends/github/client.js:17`），仓库根 `AGENTS.md` 的日志埋点纪律也明确写「令牌和登录态的原文永远不写进日志，只记有没有、是哪一类」。

---

## E 一句话结论：把「配置 gh」拆成诚实的步骤

**把「帮用户配置 gh」拆开来只有三段：第一段是插件能做的——起 `gh` 命令、把 gh 打出来的设备码与网址读回来摆给人看、把退出码与输出判成「已登录／未登录／网络未知」；第二段是只有人能在浏览器里做一次的——登录自己的 GitHub 账号并对这次授权点「同意」（如果走令牌路线，则是人到 GitHub 网页上亲手生成一个令牌）；第三段是插件不该碰的——替人保管或代填账号与令牌原文、去读或复制用户已有凭据的原文、以及用「显式把令牌塞进子进程环境」的办法绕过 DSH 的环境擦除去传递登录态。**

三段各自的依据都在前面：第一段的可行性见第 A.3 节（码与网址都打在 gh 自己的输出里）与第 D.3、D.5 节（插件已经在用同样的方式起 gh、已经在判状态）；第二段的不可替代性见第 A.3 节（设备授权要人在浏览器里点同意）与第 B.3 节（令牌只能人在网页上建）；第三段的边界见第 D.1、D.4 节（DSH 有意把凭据形状的变量挡在子进程之外）与第 D.5 节（仓库自身「令牌原文不落盘」的既有纪律）。

---

## 6 证据索引

### 6.1 gh 官方手册（cli.github.com/manual）

| 页面 | 本报告用它说明的事 |
|---|---|
| https://cli.github.com/manual/gh_auth_login | 四条入路；默认是浏览器流程；令牌进系统凭据库、否则退回明文；`--with-token` 从标准输入读且要至少 `repo`/`read:org`/`gist`；细粒度令牌更适合放 `GH_TOKEN`；`--hostname`/`--git-protocol`/`--skip-ssh-key`/`--scopes`/`--clipboard`/`--web`/`--insecure-storage` 的作用；git 协议设置对该主机所有用户生效 |
| https://cli.github.com/manual/gh_auth_status | 逐主机测试并显示当前账号；有任何主机（或 `--hostname` 指定那台）出问题就退出码 1、输出到标准错误；`--json` 时除致命错误一律退出码 0；`--show-token`/`--active`/`--hostname`/`--json hosts` |
| https://cli.github.com/manual/gh_auth_setup-git | 把 gh 配成 git 的凭据助手；没有任何已认证主机时命令失败 |
| https://cli.github.com/manual/gh_help_environment | `GH_TOKEN`、`GITHUB_TOKEN`（按优先级顺序，用于 github.com 与 ghe.com 子域，且优先于已保存凭据）；企业版那一对；`GH_HOST`；`GH_CONFIG_DIR` 的判定顺序与三个默认路径；`GH_PROMPT_DISABLED` 等 |
| 本机 `gh help exit-codes`（v2.97.0 自带手册） | 退出码：成功 0、失败 1、被取消 2、**需要认证 4** |

### 6.2 gh 官方源码（cli/cli 标签 `v2.97.0`、cli/go-gh 标签 `v2.13.0`、zalando/go-keyring 标签 `v0.2.8`）

| 文件（仓库内路径） | 内容 |
|---|---|
| cli/cli `pkg/cmd/auth/login/login.go` | 主机名问题 `Where do you use GitHub?`；`--with-token` 读标准输入并校验；`--secure-storage` 是隐藏空开关（注释：2023/04/04 起安全存储为默认）；环境令牌在用时拒绝写凭据；`--web` 与 `--with-token`、`--scopes` 与 `--with-token` 互斥 |
| cli/cli `pkg/cmd/auth/shared/login_flow.go` | git 协议问题、git 凭据助手确认问题、`How would you like to authenticate GitHub CLI?`；粘贴令牌时的 Tip 两行；`✓ Authentication complete.` / `✓ Logged in as <用户名>` / `! Authentication credentials saved in plain text` 等打印 |
| cli/cli `pkg/cmd/auth/shared/git_credential.go` | `Authenticate Git with your GitHub credentials?`（默认 Yes）；同意后额外申请 `workflow` scope |
| cli/cli `internal/authflow/flow.go` | `DisplayCode`（`! First copy your one-time code: XXXX-XXXX`、`--clipboard` 的复制提示）；`BrowseURL`（交互时 `Press Enter to open … in your browser...`，非交互时 `Open this URL to continue in your web browser:`）；申请的最小 scope 是 `repo`、`read:org`、`gist`；企业版用 legacy 回调 `http://localhost/` |
| cli/cli `pkg/cmd/auth/status/status.go` | 状态输出各行的原文；令牌来源为配置文件时显示 `hosts.yml` 路径；来源以 `_TOKEN` 结尾（环境变量）时不给重新登录/忘掉账号两行；`maskToken` 的掩码规则；有问题的条目决定退出码 1 且改用标准错误输出 |
| cli/cli `pkg/cmd/auth/shared/oauth_scopes.go` | `HeaderHasMinimumScopes`：只卡 `repo` 与 `read:org`（后者可由 `write:org`/`admin:org` 顶替）；令牌自称无 scope 时放行 |
| cli/cli `pkg/cmd/auth/shared/writeable.go` | `AuthTokenWriteable` 用「来源是否以 `_TOKEN` 结尾」判凭据能不能写 |
| cli/cli `pkg/cmd/auth/token/token.go` | `gh auth token` 打印当前生效令牌（走 `ActiveToken`，包含环境变量这一档） |
| cli/cli `pkg/cmd/auth/refresh/refresh.go` | 刷新/扩权/减权的开关；非交互时必须给 `--hostname`；环境令牌在用时拒绝刷新 |
| cli/cli `internal/config/config.go` | 取值顺序「环境变量 → 明文配置 → 加密存储」；登录时先写 keyring（服务名 `gh:<主机名>`）再回落明文；`gh auth status` 里 `oauth_token` 来源被换成 `hosts.yml` |
| cli/cli `internal/keyring/keyring.go` | 这个包只是给 `zalando/go-keyring` 加 60 秒超时的薄封装 |
| cli/cli `go.mod` | 直接依赖 `github.com/zalando/go-keyring v0.2.8`；间接依赖 `github.com/danieljoos/wincred v1.2.3` |
| cli/go-gh `pkg/auth/auth.go` | `GH_TOKEN` 先于 `GITHUB_TOKEN`（github.com / ghe.com 租户 / github.localhost），企业版用另一对；之后回落 `hosts.<主机>.oauth_token`；`KnownHosts` 包含 `GH_HOST`、能解析出令牌的 github.com、以及配置里的主机；读凭据库时会去调 `gh auth token --secure-storage` |
| cli/go-gh `pkg/config/config.go` | 配置目录判定顺序 `GH_CONFIG_DIR` → `XDG_CONFIG_HOME/gh` → Windows 的 `AppData\GitHub CLI` → `~/.config/gh`；`hosts.yml` 与 `config.yml` 两个文件名；写文件权限 0600 |
| zalando/go-keyring `keyring_windows.go` | Windows 上读写的是凭据管理器里的「通用凭据」，名字 `<服务名>:<用户名>` |

### 6.3 GitHub 官方文档（github/docs 仓库内的原文）

| 文件 | 内容 |
|---|---|
| `content/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps.md` | device flow 三步；`user_code` 是 8 个字符、中间一个连字符；用户要到验证网址输入这个码；码 15 分钟（900 秒）过期、超时作废；`access_denied`（用户点取消后码不能再用）；OAuth 应用可以被配置成签发会过期的令牌（8 小时过期 + 刷新令牌 6 个月不用则失效） |
| `content/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens.md` | 两类令牌都要在网页上创建（Settings → Developer settings → Personal access tokens，fine-grained 或 Tokens (classic)）；classic 令牌能访问你能访问的全部仓库；fine-grained 令牌的过期时间可用 `expires_in` 取 1..366 天或 `none`，默认 30 天；一个账号最多 50 个细粒度令牌 |
| `content/authentication/keeping-your-account-and-data-secure/token-expiration-and-revocation.md` | 令牌到过期时间会被自动吊销；一年没被用过的令牌会被自动吊销；过期或被吊销后不能恢复，只能重建 |

### 6.4 DSH 实现（本机物理拷贝）

| 位置 | 内容 |
|---|---|
| `C:\Users\辰辰洋洋\.dsh\profiles\node_modules\@deepseek-ai\dsh-subprocess\lib\index.js:32` | `SENSITIVE_ENV_PATTERN = /KEY|PASSWORD|SECRET|TOKEN/i` |
| 同文件 `:50-56` | `scrubbedParentEnv()`：剔除匹配上面形状的名字，以及所有 `DSH_` 开头的名字 |
| 同文件 `:42-44` | 注释说明这个函数被导出，是为了让不经过子进程服务的起进程路径（终端 PTY 后端、SDK 自己起进程的传输层）共用同一套擦除定义 |
| `…\@deepseek-ai\dsh-subprocess-local\lib\runner-launch-COYGu0Dl.js:649-662` | `childEnv(extra)`：先取擦过的父环境，再叠加调用方显式给的变量（Windows 下按键名不分大小写地替换） |
| 同文件 `:1139` | 真正起进程时用 `env: childEnv(spec.env)` |

### 6.5 本仓库代码（工作目录 `D:\dsh-plugin\dsh-mattpocock-skills-deck`）

| 位置 | 内容 |
|---|---|
| `src/host/repoKeys.js:40-51` | `runGh` 用 `subprocess.spawn` 起 gh，不传 env，`stdin` 设为 `ignore` |
| `src/host/repoKeys.js:70-79` | 退出码非 0 时按输出文案归一错误类别，其中一档是 `auth` |
| `src/host/repoKeys.js:100-110` | `execProc`：通用外部命令执行，同样不传 env |
| `src/host/platformChannel.js:183-195` | `detectionExec`：后端的 `ctx.exec` 实现，同样不传 env、`stdin` 为 `ignore` |
| `src/host/platformChannel.js:105,151` | 平台层的 env 是宿主进程 `process.env` 的只读视图（只读不改） |
| `src/host/tracker/backends/github/preflight.js:44-70` | 先找 gh 可执行，再跑 `gh auth status` 判登录态，类别经 `classifyGhError` 归一 |
| `src/host/tracker/backends/github/client.js:122-174` | `execGh`：走 `ctx.exec('gh', …)`，带 timeout 与 signal，失败时把 gh 的退出码一起交回调用方 |
| `src/host/tracker/backends/github/client.js:159-161` | 「需要登录 = 退出码 4」的判据与注释 |
| `src/host/tracker/backends/github/label-colors-ops.js:236-241` | 同一条退出码判据的另一处使用 |
| `src/host/tracker/backends/github/index.js:40-62` | `gh:installed` 的动作是注入安装指引（安装那半张票的边界）；`gh:authed` 的动作是注入登录指引 |
| `src/shared/tracker/check-catalog-dirs.js:110-124` | 检查链里的三项：`gh:installed`（命令存在）、`gh:authed`（后端 `ghAuth` 判据）、`gh:repoAccess` |
| `src/client/kernel/prompts.js:31` | 今天注入给会话的登录引导原文（叫人在终端跑 `gh auth login`、在浏览器完成授权） |
| `src/host/detectChain.js:110-120` | 未登录判失败并给登录引导、网络异常判等待的理由 |
| `src/host/tracker/backends/github/client.js:17` | 「参数只记命令名，不记完整参数（避免令牌落盘）」 |
| `AGENTS.md`（仓库根，日志埋点纪律第 2 条） | 「令牌和登录态的原文永远不写进日志，只记有没有、是哪一类」 |

### 6.6 本机实测（全在 better-sidebar 的 `701-research` 终端里跑）

| 实测 | 结果 |
|---|---|
| `gh --version` | `gh version 2.97.0 (2026-07-31)` |
| `gh auth status`（环境里没有任何令牌） | 退出码 0；报已登录，令牌来源显示为 `C:\Users\<用户名>\AppData\Roaming\GitHub CLI\hosts.yml` |
| `$env:GH_TOKEN='bad-1'; $env:GITHUB_TOKEN='bad-2'; gh auth status` | 退出码 1；报 `X Failed to log in to github.com using token (GH_TOKEN)` 与 `- The token in GH_TOKEN is invalid.`（证明 `GH_TOKEN` 优先） |
| `gh help exit-codes` | 0 成功、1 失败、2 被取消、4 需要认证 |
| 用 node 直接调 `scrubbedParentEnv()`（先设好 `GH_TOKEN`/`GITHUB_TOKEN`/`GH_CONFIG_DIR`/`GH_HOST`/`DSH_X`） | 保留下来的只有 `GH_CONFIG_DIR` 与 `GH_HOST`；`GH_TOKEN`、`GITHUB_TOKEN`、`DSH_X` 都不在结果里；`Path`、`USERPROFILE`、`APPDATA` 保留（共 72 个变量） |
| `[Environment]::GetEnvironmentVariable('GH_TOKEN','User'/'Machine')`、`$env:GH_CONFIG_DIR`、`$env:GH_HOST` | 四项全为空 |

---

## 7 还没确定的事

1. **本机为什么用的是明文 `hosts.yml` 而不是 Windows 凭据管理器**没有查。可能是当年登录时的环境不支持凭据库，也可能当时用了 `--insecure-storage`；`gh auth status` 的输出只能说明「当前内存放在哪」，说明不了原因。
2. **gh 用的那个 OAuth 应用有没有被配置成签发「会过期的令牌」**没有查到官方说明。GitHub 文档写明 OAuth 应用可以这样配置（访问令牌 8 小时过期，配一个 6 个月不用则失效的刷新令牌，gh 的授权流程支持这条路），gh 源码里也留了「只有 `gho_` 开头的令牌可以 `gh auth refresh`」的判断；但这条令牌到底会不会在 8 小时后失效，本报告没有定论。
3. **凭据管理器里的「通用凭据」在不同 Windows 用户之间是否互相可见**，属于 Windows 自身行为，本次没有查微软官方文档；第 C.3 节里「换 Windows 用户等于没登录过」这句话的前半截（`%AppData%` 属于当前用户）是确定的，后半截按 Windows 的常识写的，没有官方依据。
4. **在 DSH 起的 sidebar 终端里跑 `gh auth login` 与在普通终端里跑是否完全一致**没有实测。终端后端（`@deepseek-ai/dsh-terminal-bash`）起 shell 时也是把一份环境交给子进程的终端原语，但我没有逐行读完它拼环境的过程，也没有在真机上跑过一次登录。
5. **完整跑一遍浏览器授权流程**没有做（那会往用户账号里写一条新的授权记录，不适合在调查里做）。所以「gh 起的那个进程在人授权之前一直活着并轮询成功」这一点，是根据源码与 GitHub 官方文档推断的，不是本机实测。
6. **企业版主机（GitHub Enterprise Server）那一支的细节**只看了源码注释（企业版的回调地址用的是老式 `http://localhost/`），没有在真机上验证设备码页面地址与授权过程。
7. 本报告的 gh 事实按本机安装的 2.97.0 与该版本标签的官方源码核对；cli.github.com 的手册页面本身不带版本号，如果哪天手册与 2.97.0 的行为出现出入，以本机实跑与那一版的源码为准。
