# GitLab 工作区夹具与工具台缺口（#1680 探针）

这是一次小范围真机探针的记录，回答地图 #1673 下的任务票 #1680：现有真机验证工具台能不能造出 GitLab 工作区、缺什么；一个批次用的 GitLab 沙箱项目从建到删要哪些命令、免费账号够不够；把它们写成研究笔记供决策票 #1677（环境夹具与批次编排）使用。

探针只用了一个临时项目和一个临时工作区目录，跑完都已清理，没有跑真机批次。

## 总览（先读这一段）

- **工具台现在造不出 GitLab 工作区**：`make-workspace` 只认 github / cold / markdown / ab 四种形状（`scripts/real-machine/commands/make-workspace.mts:38-52`），后端绑定函数本身已经支持 `backendId: 'gitlab'`（`scripts/real-machine/lib/workspaces.mts:73-75`），缺的是工作区形状与远端项目生命周期这两块。
- **GitLab 工作区夹具不需要 git clone，也不需要 git 认证**：本地 `git init` + `git remote add origin https://gitlab.com/<group>/<project>.git` + 一份 `docs/agents/workspace.yaml`（`backendId: gitlab`）就够了。插件靠绑定文件认后端，`group/project` 形式的仓库身份由会话侧从 git 远端地址自动补上；票的读写全部走 glab API，本地仓库只用于定位身份。
- **免费账号能完成整个沙箱项目生命周期**：建项目、种票、删项目都成功。两个容易踩的坑是「建项目本地报网络错误但服务器已经建好」与「删除是延迟删除，不能按 404 判断删干净」。
- **要补的工具台能力很少**：一个工作区生成函数、`make-workspace` 的一个新 `--kind`、一个管沙箱项目的命令，再把远端项目 id 记进批次清单、让清理命令先删远端。复制 home、注入工作区登记、冻结候选、抓证据这些都能原样复用。

## 实测环境

| 项目 | 值 | 说明 |
| --- | --- | --- |
| 日期 | 2026-10-30 | 项目创建时间 2026-10-30T15:56:04Z |
| Node | v24.19.0 | 探针脚本用 `node --import ./scripts/ts-hook.mts` 直接跑 `.mts` |
| git | 2.49.0.windows.1 | 全局没有配置 credential.helper |
| glab | 1.123.0 | 已登录 gitlab.com（keyring 里的 token），API 走 https |
| GitLab 账号 | FeatherHunter（用户 id 42748659） | 免费版；`can_create_project: true`、`projects_limit: 100000` |
| 本机临时目录 | `D:\Temp` | 在仓库之外；夹具目录与探针脚本已在 2026-10-31 删除 |

网络注意：这次 `glab api user` 第一次报 `Get "https://gitlab.com/api/v4/user": EOF`，重试即成功；后面建项目也遇到一次 EOF。这不是权限问题，一次失败不能当结论，必须读回确认。

## 一、GitLab 工作区夹具怎么搭

### 工作区的形状

一个目录只要满足三件事，插件就把它当作 GitLab 工作区：

1. 目录里有一个 git 仓库（`.git/` 存在）；
2. `origin` 指向 `https://gitlab.com/<group>/<project>.git`（group 可以有多段）；
3. 目录里有一份 `docs/agents/workspace.yaml`，写 `version: 2`、`backendId: gitlab`、`pickedAt`、`source: user`。

绑定文件不要手写，用仓库自己的生成器，保证与插件读的是同一份模板：

```ts
// bind-gitlab.mts —— 在仓库根目录用 node --import ./scripts/ts-hook.mts 跑
const { bindWorkspace } = await import('./scripts/real-machine/lib/workspaces.mts')
await bindWorkspace(process.argv[2], { backendId: 'gitlab', layout: 'single' })
```

### 实测证据（组件级）

探针工作区：`D:\Temp\dsh-gitlab-probe-20261030-235602`，远端项目与目录同名。

| 验证项 | 调用 | 实测结果 |
| --- | --- | --- |
| 写绑定文件 | `bindWorkspace(dir, { backendId: 'gitlab', layout: 'single' })` | 生成 `docs/agents/workspace.yaml`，724 字节；字段为 version: 2、backendId: gitlab、pickedAt: 1793376273109、source: user、layout: single |
| 认后端 | `detectExplicit` | `selection.backendId = gitlab`、`source = explicit`；`parsed.reason = workspace-file`、`confidence = high` |
| 认出仓库身份 | `getRepoKey` | `{"owner":"FeatherHunter","name":"dsh-gitlab-probe-20261030-235602"}`；第 1 层「读 git remote」就够，没走到直读 `.git/config` 和 glab 兜底 |
| 房间匹配 | `matches` | `true` |
| 补全后的身份显示 | `describe(handle, 'gitlab')` | refId/name 为 `FeatherHunter/dsh-gitlab-probe-20261030-235602`，url 为 `https://gitlab.com/FeatherHunter/dsh-gitlab-probe-20261030-235602` |

这条链的含义：绑定文件只写 `backendId`，**`refId` 不必写进绑定文件**，会话侧会用自己的 `getRepoKey` 从 git 远端地址补出 `group/project`。因此夹具不需要克隆或推送远端仓库，只要远端地址对得上。

一个调用细节：`detectExplicit` 的第二个参数要写成 `{ platform: { fs: 平台文件接口 } }`；传成 `{ platform: 平台文件接口 }` 会得到 `reason: 'no-platform'`，看起来像「环境不支持」，其实是参数形状不对（这次第一次就踩了）。

## 二、远端沙箱项目的生命周期（免费账号实测）

### 1. 建项目

```
glab repo create FeatherHunter/dsh-gitlab-probe-20261030-235602 --private --skipGitInit --readme --description 'DSH GitLab fixture probe, safe to delete'
```

本地输出报错 `Error creating project: Post "https://gitlab.com/api/v4/projects": unexpected EOF.`，但服务器上项目**已经建好**。按路径读回：

```
glab api "projects/FeatherHunter%2Fdsh-gitlab-probe-20261030-235602"
```

读到 `id: 88308984`、`path_with_namespace: FeatherHunter/dsh-gitlab-probe-20261030-235602`、`visibility: private`、`default_branch: main`、`web_url`。

**教训**：建项目之后必须按路径读回；读到项目就说明建成了，不能把 EOF 当成失败再建一次，否则会在账号里留下重复项目。工具台实现「建沙箱项目」时应把「读回」作为建项目的判定条件。

### 2. 种数据（票）

```
glab api --method POST projects/88308984/issues -f 'title=[probe] 夹具种子票，随项目一起删' -f 'description=DSH GitLab 夹具探针用，用完不保留。'
```

回包：`id: 208597692`、`iid: 1`、`state: opened`、`web_url: https://gitlab.com/FeatherHunter/dsh-gitlab-probe-20261030-235602/-/work_items/1`。

读回 `glab api "projects/88308984/issues?per_page=100"` 能看到同一张票。`glab api projects/88308984/labels` 返回空数组：新建项目没有默认标签，本房按名字加标签时会由 GitLab 自动创建。

注意票的 `web_url` 是 `/-/work_items/<iid>`（GitLab 新版界面把票显示为 work item），不是 GitHub 那种 `/issues/<n>`；测试判据不要把 URL 形状写死。

### 3. 删项目（延迟删除）

```
glab api --method DELETE projects/88308984
```

回包 `{"message":"202 Accepted"}`。约 3 秒后按 id 或按旧路径读回，项目**仍然读得到**，但已经改名：

- `name` / `path` / `path_with_namespace` 都带上了 `-deletion_scheduled-88308984` 后缀；
- 多出 `marked_for_deletion_at: 2026-10-30`、`marked_for_deletion_on: 2026-10-30` 两个字段。

**教训**：GitLab.com 的项目删除是延迟删除（先标记、过一段时间才真正清理，本探针没有等它到期），不能按 404 判「删干净」。批次清理的合格判据应是「DELETE 返回 202，且读回带 `marked_for_deletion_at`」，而不是等 404；也不要重复 DELETE 制造噪音。pending-deletion 的项目会短期留在账号里，探针批次要控制数量。

### 4. 权限结论

免费账号下的 `can_create_project: true`、`projects_limit: 100000`，建私密项目、写票、删项目都成功。数量上限不是瓶颈；真正要控制的是 pending-deletion 项目数（每个沙箱项目删后还会在账号里占用一段时间）。

### 5. 为什么不用 clone / push

一开始试过 `glab repo clone`：报 `remote: HTTP Basic: Access denied`（本机 git 没有 credential.helper，token 没进 git）。改用 `git -c credential.helper="!glab auth git-credential" ls-remote ...` 能通，但一次要等约 169 秒（先前一次后台任务实测），不适合放进夹具流程。

结论：夹具不 clone、不 push，本地 `git init` + `git remote add origin` 即可；所有票的读写都走 glab API，与本地 git 无关。

## 三、工具台现状与缺口

| 工具 / 文件 | 现状 | 对 GitLab 批次的影响 | 建议补法 |
| --- | --- | --- | --- |
| `make-workspace` | 只认 github / cold / markdown / ab（`commands/make-workspace.mts:38-52`） | 造不出 GitLab 工作区 | 增加 `--kind gitlab --project <group>/<project>` |
| `lib/workspaces.mts` | `bindWorkspace` 已接受 gitlab；三个生成函数都没有 gitlab 形状；`GeneratedWorkspace.kind` 联合类型也没有 'gitlab' | 没有可复用的生成函数 | 新增 `createGitlabWorkspace`，并把 'gitlab' 加进 kind 联合类型 |
| `seed-workspace` | 只写 home 的 `storages/workspace.json`，不关心后端 | 无缺口，直接复用 | 无 |
| `cleanup` | 只清本地批次 / home / 临时目录 / 包目录（`commands/cleanup.mts:1-16`） | 远端沙箱项目会残留 | 批次清单记远端项目 id/path，清理时先报账再删远端，再删本地 |
| 批次清单 `workspaces.json` | 只记本地信息（`lib/workspaces.mts:343-348`） | 清理与证据溯源找不到远端项目 | 每条工作区记录加远端项目 id、path、web_url |
| `copy-home` / `freeze-candidate` / `start-instance` / `stop-instance` / `browser-check` / `collect-evidence` | 与后端形状无关 | 无缺口 | 无 |
| 文档 | `scripts/real-machine/README.md`「造工作区」表没有 gitlab 行；`docs/agents/real-machine-verification.md:75` 只写「夹具放批次目录」为什么 | 后来的人不知道 GitLab 夹具怎么造 | 补 README 一行与验证规则一句（夹具须自带 `.git/`） |

## 四、建议的落法（供 #1677 决策）

1. **工作区生成函数**：`createGitlabWorkspace({ dir, project, force })`——`prepareTarget` → `git init` → `git remote add origin https://gitlab.com/<project>.git` → `bindWorkspace(dir, { backendId: 'gitlab', layout: 'single' })`；返回 kind 'gitlab'，extra 记 project 与 remoteUrl。不联网、不认证、秒级完成。
2. **命令入口**：`make-workspace --kind gitlab --project <group>/<project>`；不给 `--project` 就直接报错说清缺什么。
3. **沙箱项目管理命令**（独立 `gitlab-sandbox`，或并进 cleanup）：
   - `create`：`glab repo create <group>/<name> --private --skipGitInit --readme --description ...`，然后按路径读回拿 id；本地报 EOF 时先读回，读到了就算成功；
   - `delete`：`glab api --method DELETE projects/<id>`，读回带 `marked_for_deletion_at` 或确认已不存在即算完成；不重复删除；
   - `status`：按 id 或 path 读回，给清理与证据用。
4. **批次清单与清理**：`workspaces.json` 每条记远端项目 id/path/web_url；`cleanup` 先报账、确认后先删远端、再删本地，判定按上一条。
5. **命名约定**：`dsh-gl-<批次名>-<时间戳>`（private），用完即删；每批 1–2 个，避免 pending-deletion 堆积。
6. **文档**：更新 `scripts/real-machine/README.md` 的「造工作区」表与 `docs/agents/real-machine-verification.md` 的夹具规则。

## 五、最小命令序列（复制即用）

```powershell
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$name  = "dsh-gl-probe-$stamp"
$dir   = "D:\Temp\$name"

# 1) 建远端沙箱项目（本地报 EOF 也先读回；读到就是建成）
glab repo create "FeatherHunter/$name" --private --skipGitInit --readme --description 'DSH GitLab fixture probe, safe to delete'
glab api "projects/FeatherHunter%2F$name"

# 2) 本地夹具目录：不 clone、不 push，只要有 git 仓库与 origin 地址
New-Item -ItemType Directory -Path $dir | Out-Null
git -C $dir init -b main
git -C $dir remote add origin "https://gitlab.com/FeatherHunter/$name.git"

# 3) 写后端绑定（在仓库根执行；脚本正文见上一节）
node --import ./scripts/ts-hook.mts D:\Temp\bind-gitlab.mts $dir

# 4) 种一张票并读回
$id = (glab api "projects/FeatherHunter%2F$name" | ConvertFrom-Json).id
glab api --method POST "projects/$id/issues" -f 'title=[probe] 夹具种子票，随项目一起删' -f 'description=DSH GitLab 夹具探针用，用完不保留。'
glab api "projects/$id/issues?per_page=100"

# 5) 删项目：按 202 + marked_for_deletion_at 判，不按 404 判
glab api --method DELETE "projects/$id"
glab api "projects/$id"
```

## 六、没验证的与风险

- 没有跑真机批次，也没有打开面板：这次只到组件级与 glab API 级，面板展示、鼠标操作、双实例并发都没验（属于后续方案与执行阶段）。
- 没有验证宿主启动时 PATH 里没有 glab 的机器上的表现（glab 未装 / 未登录是方案里的异常组）。
- 没有验证标签对象、指派、里程碑、父子边、阻塞降级等种子数据的批量写法：这次只种了一张无标签票。
- 没有验证删除后同一路径能否立即复用（延迟删除期间项目名带后缀，新建同名项目会不会撞名未知）。
- 没有验证「夹具放在批次工作根（默认仓库内 `.scratch/verify-run/batches/<批次名>/`）里」时会不会被插件当成主仓库的子目录：夹具自带 `.git/` 应当切断向上查找，但没实测。建议批次开始前专门验一次，或把 GitLab 夹具固定放在仓库之外的工作根（用 `DSH_VERIFY_WORK_ROOT`）。
- 没有验证 glab 版本下限：1.123.0 可用，`repo create --skipGitInit --readme` 这些参数在旧版是否都有未知。
- 探针期间创建的项目已在 2026-10-30 提交删除（id 88308984，当前处于 pending-deletion 状态、名字带 `-deletion_scheduled-` 后缀），本地夹具目录已删除。

## 七、依据（file:line）

- `scripts/real-machine/lib/workspaces.mts:73-75`：`bindWorkspace` 的 backendId 联合类型已含 gitlab。
- `scripts/real-machine/lib/workspaces.mts:18-25`：`GeneratedWorkspace.kind` 联合类型（无 gitlab）。
- `scripts/real-machine/lib/workspaces.mts:106-113`：`prepareTarget` 只允许批次目录与系统临时目录。
- `scripts/real-machine/lib/workspaces.mts:343-348`：`writeWorkspaceManifest` 写 `<批次>/workspaces.json`。
- `scripts/real-machine/commands/make-workspace.mts:38-52`：四种 `--kind` 的分发，无 gitlab。
- `scripts/real-machine/commands/cleanup.mts:1-16`：只清本地批次产物，不涉及远端。
- `scripts/real-machine/README.md:163-170`：「造工作区」命令表（无 gitlab 行）。
- `docs/agents/real-machine-verification.md:69`：工作根默认 `.scratch/verify-run/`，可用 `DSH_VERIFY_WORK_ROOT` 换位置。
- `docs/agents/real-machine-verification.md:75`：无头环境用 `seed-workspace` 注入工作区登记；夹具放批次目录、不要放本仓库里。
- `docs/agents/real-machine-verification.md:78`：清理先报账后删，容量上限 15GB / 20 批次 / 单批 2GB。
- `src/tracker/detection/explicitDetector.ts:60-100`：从 `docs/agents/workspace.yaml` 认后端。
- `src/tracker/rooms/gitlab/repo.ts:105-177`：`getRepoKey` 三层（git remote → 直读 `.git/config` → `glab repo view`）。
- `src/tracker/rooms/gitlab/repo.ts:58` 起：`parseGitlabRepo` 支持 https/ssh/scp、多段分组、自建主机。
- `src/tracker/rooms/gitlab/index.ts:138-191`：`matches` 的判定顺序。
- `src/tracker/rooms/gitlab/index.ts:199-211`：`describe` 在 refId 含 `/` 时拼仓库 url。
- `src/tracker/rooms/gitlab/client.ts:1-70`：glab 客户端的执行与 `api` 快捷。
- `tests/verify-1447-gitlab-e2e.ts:14`：现有自动测试用假 glab 执行器，不联网，所以证明不了真 GitLab 回包。
