# ADR：版本管理页签的写操作（暂存 / 提交 / 拉取 / 推送）

> 日期：2026-10-04（#841 落地时定稿）
> 地位：本文是「面板上的写操作做到哪一步、怎么保证不越界」的唯一依据。只读那一版的口径见
> `docs/adr/20261002-version-control-readonly-no-network.md`——**那份一个字不改**，本文只加写操作这一段。
> 关联：#810（地图）· #840（决定清单 D1–D14）· #839（宿主执行层：安全地跑可能弹凭据提示的命令）· #841（实现）· #842（写界面）

## 1. 范围与最小集（承接 #840 的 D1–D14）

- **暂存**：只做整文件（`git add -- <路径…>`）。**不做部分暂存**（按行/按块要交互式 stdin 或构造补丁写临时文件，都是新能力面）；需要的人去侧栏终端 `git add -p`。
- **提交**：`git commit -m <信息>`。信息由面板输入（必填、标题 ≤200、整体 ≤5000），**不做模板、不强制本仓库的中文规范**（那是本仓库的规范，强加给用户的仓库是越界）；不 `--amend`、不 `--allow-empty`、不 `--no-verify`。
- **拉取**：只认 `git pull --ff-only`。不能快进就拒绝并指侧栏终端（合并/变基/冲突解决按地图归终端）。
- **推送**：一律**显式** `git push [ -u ] <remote> <localBranch>:<branch>`，**不裸 push**（裸 push 会被 `push.default`/`remote.<name>.push`/`push.followTags` 改道）。三档目标：① 有上游且远端分支在 → `existing`，老实推上游；② 完全没有上游 → `set-upstream`，显式确认后带 `-u` 建立上游；③ **上游配置还在、远端分支被删** → `recreate`，同样带 `-u`，但目标是配置里那个 `<remote>/<branch>`（不是「第一次推送」的 `<remote>/<local>`）。多远端不替用户挑（回候选让用户选）。

## 2. 两条总工裁决（2026-10-04）

1. **允许 `git push -u`，但只在这一档、且必须说清**：确认框要点名「会把本地分支 X 的上游设为 <remote>/X」；永不碰全局配置；只有「上游没了/本来就没有」才带 `-u`（有上游就老实推上游）。
2. **提交票据绑索引指纹，用只读命令取**：`git ls-files --stage -z` 的原始 stdout 做 sha256（取前 16 位十六进制），**不用 `git write-tree`**——只需要比对能力，不往用户对象库写东西。

## 3. 四处订正（实现期定下）

- **重放保护靠 requestId 去重，不是「用一次就烧掉」**（照 `updatePkg/service.js` 的 receipt 先例）；真正挡住重复执行的是「票里记的仓库状态与此刻不一致」。
- **推送显式 refspec**（见 §1）；`-u` 只在 set-upstream 与 recreate 两档（上游被删时目标是配置里那个 `<remote>/<branch>`，不是 `<remote>/<local>`）。
- **i-t-a（`git add -N`）直接拒绝**：它在 `ls-files --stage` 里与「真暂存一个空文件」指纹相同，提交进去的却是工作区此刻的内容——面板不替用户赌。判据用 porcelain v2 的 `1 .A … 000000 …`（XY=`.A` 且索引无 blob）。
- **票绑仓库**：不同目录的仓库可以有完全相同的 HEAD 与索引指纹，所以票据记 `repoRoot`（工作树路径）并在执行前比对；pull 的票同样绑「上游 + 本地分支」（防预检后改上游/切分支）。

## 4. 参数注入面的五条加固（用户可控字符串 → argv / refspec）

1. **argv 直传、不经 shell**：`-m` 里的 `$()`、换行、`#` 都不展开、不当注释（真机实测：提交标题原样保留 `a$(rm -rf /) b` / `#not-a-comment`）。**这条安全属性依赖「不经 shell」**——将来若改成拼 shell 或改用 `-F -`（不带 `--cleanup=verbatim`），`#` 开头的行会被 git 当注释剥掉，必须同时改口径。
2. **路径**：`--` 之后 + 固定前缀里的 `--literal-pathspecs`（关掉 pathspec 魔法与通配）；再挡前导 `-` 与前导 `:` 的形状。**真实保证是这两道开关，不是「路径已校验安全」**——git 自己的规则更细（绝对路径在仓库外、目录不存在等仍由 git 报错）。
3. **分支名**：形状正则拒前导 `-`（选项注入）与前导 `+`（refspec 首字符是强推标记，`+wip:+wip` 会覆盖远端），拼 refspec 前再用 `git check-ref-format --branch` 复核一次（只读）。
4. **远端名**：只从 `git remote` 的输出里选（白名单），形状拒 `:`、空白、NUL、前导 `-`——`foo:bar` 会被 git 当 scp 风格地址去连 SSH（真机实测）。
5. **票据 id / requestId**：外部输入，形状（非空、≤64、`[A-Za-z0-9_-]`）不合当场拒，不查表、不起进程。

## 5. 一次性票据与执行门

- 预检（`wf.gitWriteCheck`）读一次首屏 → `rules.judge` 判定 → **推送档把 `no-upstream`/`upstream-gone` 从 block 里摘掉**（它们不是「不能推」：`no-upstream` 走 set-upstream 档、`upstream-gone` 走 recreate 档，见 §1）→ 解析目标 → 取指纹 → 发票；票据表与结果表各带 200 条上限（只存进程内存）（`id` + 有效期 120 秒 + `headOid` + `repoRoot` + 指纹 + 目标）。客户端只拿得到 `id/checkedAtMs/expiresAtMs/op` 与给人看的目标。
- 执行电话（`wf.gitStage/Commit/Pull/Push`）**先过纯判定**（票在不在 / 动作对不对 / 过期没有——这一关不起任何进程），再重量状态（HEAD / 仓库根 / 指纹 / 目标）比对，任一不一致就拒绝并让人重读。
- **任何写命令之前必须先过票据门**：票据失效时**一个进程都不许起**（纯判定先行，门禁 A1/A2 断言 spawns 全零），状态比对阶段也一条写命令都不许起（A3/A4/A6 断言零写命令）。A 组是七个用例（missing / expired / op-mismatch / stale-head / stale-index / stale-repo / 反证装置自检），**不是**「把实现改坏」那种反证；真反证在 B5（refspec 强推）、E2/E6（归类）、F3/F3b（看门狗），以及 G 组的变体脚本（跳掉 G 自己的调用必须红）。
- 暂存不走票据（可逆、天然幂等）；提交失败后**不自动重试、不声称成功**：读得到 HEAD 就按「HEAD 变了」如实说，读不到就说「结果未知」。

## 6. 非交互执行边界（承接 #839）

写命令一律走 #839 的安全执行层：`GIT_TERMINAL_PROMPT=0`、`GCM_INTERACTIVE=never`、`-c credential.interactive=false`、清掉 `GIT_ASKPASS`/`SSH_ASKPASS`/`DISPLAY`、ssh 走 `BatchMode=yes`、`LC_ALL=C`（失败分类靠英文正则）、`GIT_HTTP_LOW_SPEED_*`；每操作预算 + 调用级总预算，到点由共享出口杀整棵进程树。**不保存凭据、不改用户 git 配置、不代替用户登录、不在没有用户点击时发起网络动作**（无定时器、无自动重试、无后台预取）。

## 7. 看门狗（`stallMs`）的结论：pull/push **不开**

- 结论：写路径的 fetch/pull/push **不传 `stallMs`**（保持默认关闭）。理由（真机实测）：`fetch --progress` 跑 8.1 秒、每 250ms 采样 32 次**全是 0 字节**，结束时才一次到达——看门狗会在 2.5 秒把**健康**传输杀掉。它想补的两类「挂住」已由 git 自带低速阈值（20s 放弃）与预算强杀覆盖。
- 将来要开的前提（三条，缺一不可）：① 只对**实测确认会增量吐进度**的命令开；② 带 `GIT_PROGRESS_DELAY=0`；③ `stallMs ≥ 3 × 实测刷新间隔`。
- 另外：写层构造给执行层的请求**按白名单显式拼**（只给 args/cwd/timeoutMs/stdoutLimit），绝不把客户端入参整包透传——`stallMs` 尤其不许来自客户端。门禁 F2 断言它进不了 argv，**F3/F3b 断言看门狗级证据**（看门狗每 tick 调 `timer.timeout(tickOf(stallMs))`，stallMs=2500 → tick=625；这一跑里没有 625 的定时器调用 = 看门狗没开；再把一份含 625 的序列喂给同一判据必须判红）。

## 8. 限制（如实写，别当成保证）

- **不是原子保证（TOCTOU）**：预检与执行之间用户或别的程序仍可能改仓库。票据把「用户看过的状态」与「真正执行时的状态」比对上，比不上的拒；但比对本身不是事务，中间仍有一个窗口。真正的兜底是 git 自己的锁与失败退出。
- **提交钩子**：pre-commit/commit-msg 钩子是用户的，面板不绕过；钩子失败就如实失败并指终端看输出。钩子自身也可能在检查与提交之间改仓库。
- **指纹拦不住「并发进程在检查与提交之间改索引」**：指纹只证明「执行那一刻的索引与用户确认时一致」，不证明期间没人动过（那种情况会以 stale-index 拒，或恰好与确认时相同而通过）。
- **部分暂存、合并、变基、冲突解决、切分支/工作树、强推、amend、stash、子模块、tag**：一律不做，指侧栏终端。

## 9. 日志与门禁

- 事件不新开：`git.exec` / `git.exec.fail`（起进程）+ `host.call` / `host.call.fail`（电话层，失败带 `errorKind`）；`via` 沿用 `version-control`。提交信息原文、凭据、远端地址原文一律不进日志。
- 门禁：`tests/verify-841-write-phones.js`（A–G 七组、30 项断言，含票据四条反证、refspec 强推反证、看门狗白名单反证、真 git 文本归类反证）；`verify-log-coverage` 的电话清单 46 → 51；`research/489-appendix.md` 第 1 章同步。
