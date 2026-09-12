# 研究：宿主往用户工作区写文件的边界与失败语义（#614）

调查票 #614，父图 #610「标签配色可编辑」。本报告只回答「往 `<工作区>/docs/agents/label-colors.json` 写下去这一步会遇到什么」，不设计 JSON 形状与放置时机。

一句话结论：**插件宿主进程拿到的文件服务是按「部署默认策略」加栅栏的，默认只放行写 `<DSH 进程当前目录>` 与系统临时目录。用户工作区通常不在这两个根里，所以默认部署下这个文件写不下去。** 这不是「目录权限」问题，是插件自己的取用方式问题；落地票必须先解决它，否则本地 Markdown 这一半功能在默认部署下直接失败。

---

## 1 可写范围

### 1.1 插件拿到的是什么

- `src/host/index.js:31`：`const fs = ctx.get('fs')`，随后显式传给各房间（如 `src/host/index.js:88` 传给 repoKeys）。
- `src/host/platform/index.js:106`：`const fs = ctx.get('fs')`，**原样透传，不叠白名单**。文件头注释把性质写死了：
  - `src/host/platform/index.js:21`：「`fs`：**透传** `ctx.get('fs')`（DSH dsh-fs-sandbox：读穿透沙箱、写有栅栏）；**无 `mkdir`**。」
  - `src/host/platform/index.js:22`：区分 path-shaped（lstat / resolve）与 target-shaped（readText / writeText / stat / listDir），「实现者勿把裸路径串直接喂给 target-shaped 方法」。
  - 契约形状见 `src/host/platform/index.js:47`：`lstat/readText/writeText/resolve/listDir/stat；无 mkdir`。

也就是说：**读随便读**（`docs/agents/triage-labels.md` 现在就是这么被只读读走的，见 `src/host/tracker/backends/markdown/issues-labels.js:8-10`），**写有栅栏**。

### 1.2 栅栏的具体判据（来自 DSH 实现本体）

在 DSH 实现检出 `D:\0Tools\DSH Desktop\resources\app.asar` 里，`@deepseek-ai/dsh-fs-sandbox` 的 `SandboxedFileSystem.checkedTarget` 逐字如下（用 node 扫 asar 取原文）：

```js
async checkedTarget(target, sandboxPolicy) {
    const policy = sandboxPolicy ?? this.ctx.sandboxPolicy.resolve();
    const { mode } = policy;
    if (mode === "danger-full-access") return target;
    if (mode === "read-only") throw new FsError(`cannot write "${target.displayPath}": file access denied under read-only mode`, "FS_SANDBOX_DENIED");
    const fresh = await this.resolve(target.displayPath);
    let contained = false;
    for (const root of writableRoots(policy)) if (await isPathUnder(fresh.targetKey, root)) { contained = true; break; }
    if (!contained) throw new FsError(`cannot write "${target.displayPath}": file access denied under workspace-write mode`, "FS_SANDBOX_DENIED");
    return fresh;
}
```

可写根的定义（同一次扫描取到的 `@deepseek-ai/dsh-sandbox` 原文）：

```js
function writableRoots(policy) {
    if (policy.mode !== "workspace-write") return [];
    return [...new Set([ policy.workspaceRoot, "/tmp", tmpdir() ].map(canonicalPath))];
}
```

即 **`workspace-write` 只放行：策略里的 workspaceRoot、`/tmp`、`os.tmpdir()` 三处，且必须是规范化后的包含关系**。Windows 上没有 `/tmp`，实际就是 workspaceRoot 加系统临时目录。

拒绝的错误对象带结构化错误码 `FS_SANDBOX_DENIED`，消息原文（照抄）：

```
cannot write "<目标显示路径>": file access denied under workspace-write mode
```

### 1.3 插件的调用落哪一条政策

`writeText(target, content, expected, signal, sandboxPolicy)` 的第 5 个参数是「本次调用的政策」。**不传就用部署默认政策**：

```js
const policy = sandboxPolicy ?? this.ctx.sandboxPolicy.resolve();
```

同族的另一个执行器 `@deepseek-ai/dsh-bash-sandbox` 把同一句话写进了文档注释：「Tool calls pass the calling session's resolved policy; **direct calls fall back to the deployment policy**」。

插件是 direct call：`src/host/tracker/backends/markdown/write.js:12` 只传 `(target, content)` 两个参数；`src/host/repoKeys.js:215` 也只传两个。**所以插件永远走部署默认政策，拿不到调用会话自己的工作区根。**

部署默认政策的来源，在 DSH 出厂 profile 里是这两条（asar 内 yaml 原文）：

```yaml
- id: sandbox-policy
  name: '@deepseek-ai/dsh-sandbox-policy'
  config:
    mode: !!js process.env.DSH_PERMISSION_MODE ?? 'workspace-write'
    workspaceRoot: !!js process.cwd()

- id: fs-sandbox
  name: '@deepseek-ai/dsh-fs-sandbox'
```

（`fs-sandbox` 那条上方的注释原文：「The sandboxed filesystem provider. `cwd` defaults to `process.cwd()`; an overlay can pin another workspace.」）

现场核对：当前宿主进程环境里 `DSH_PERMISSION_MODE` **没有设置**（`Get-ChildItem env: | Where Name -like 'DSH*'` 只列出 `DSH_HOME`、`DSH_SESSION_ID`、`DSH_SHELL`、`DSH_WEB_URL`）。所以生效模式就是兜底值 `workspace-write`，workspaceRoot 就是 **DSH 进程的当前目录**。

结论：**插件可写范围 = DSH 进程的 `process.cwd()` 及其子目录，外加系统临时目录（`os.tmpdir()`），仅此三处。**

### 1.4 本机现场值：两个目录不是同一个（关键）

`getCacheDir()` 把缓存目录定义成 `process.cwd() + '/.dsh-mattskillsdeck-cache'`（`src/host/repoKeys.js:177-187`）。于是缓存目录就是「进程当前目录」的探针：

- 正在服务本面板的宿主进程，把插件缓存写在 `D:\0Tools\DSH Desktop\.dsh-mattskillsdeck-cache`。取证：该目录下 `logs\2026-09-13.log` 的写入时间就是当前时刻，内容是本面板正在发生的宿主调用（`wf.namingPlan`、`exec.run` via=refresh）。
- 也就是说，**这个进程的 `process.cwd()` = `D:\0Tools\DSH Desktop`**。
- 而用户面板选中的工作区是 `D:\dsh-plugin\dsh-mattpocock-skills-deck`。

两者不同。目标 `<工作区>/docs/agents/label-colors.json` = `D:\dsh-plugin\dsh-mattpocock-skills-deck\docs\agents\label-colors.json`，**不在可写根 `D:\0Tools\DSH Desktop` 之下**，按 1.2 的判据会被拒。

旁证：磁盘上同时存在四份插件缓存目录——`D:\0Tools\DSH Desktop\`、`D:\dsh-plugin\dsh-mattpocock-skills-deck\`、`D:\dsh-plugin\dsh-prompt\`、`D:\ilife\`。说明「进程当前目录」随启动方式而变；只有当用户恰好从工作区目录启动 DSH 时，进程当前目录才等于工作区。

### 1.5 仓库里已有的实锤（两处，方向一致）

- `src/host/repoKeys.js:177-178`（T9 修复）：「缓存目录：`<DSH 进程 cwd>/.dsh-mattskillsdeck-cache/`（T9 修复：fs 沙箱 workspace-write 只允许 cwd 下，`~/.dsh` 在沙箱外被拒 → 缓存永不写入；改用 `process.cwd()` 落点，跨重启秒开）」——历史上真出现过「缓存永远写不进」。
- `src/host/tracker/predicatePrimitives.js:165-174`（#476 实锤）：写探测被拒时，「拒信关键词 `workspace-write` / `file access denied` 只认沙箱，不认系统；此时量不出系统可写性，诚实判 pending（灰态），不谎报『目录不可写』。系统级拒绝（EACCES 等）仍走 fail。」
- 对应的契约测试 `tests/verify-dirwritable.js:155-186` 把这条判据固化成 D8/D9 两例，D8 里内嵌的沙箱拒绝原文就是 `cannot write "/ws/.scratch/.dsh-write-probe": file access denied under workspace-write mode`。

### 1.6 路径归一变不出可写范围

`src/host/workspaceCwd.js:11-33`（`normCwd`）与 `src/host/workspaceKey.js:1-27`（`normalizeWorkspacePath`）做的是「盘符大小写、尾斜杠、斜杠方向、相对转绝对」这类写法归一，以及给按工作区分桶的抽屉洗一把同形钥匙。它们**不改变目标落在哪个根下**，对沙箱栅栏毫无帮助。别把「归一之后就是绝对路径了」当成「所以能写」。

### 1.7 现状：插件今天能写的地方

只有两处：

- 本地 Markdown 后端的票文件，落在 `<工作区>/.scratch/**`（`src/host/tracker/backends/markdown/write.js:9-16`）——**这一条只在工作区恰好等于进程当前目录时才写得进去**，工作区换了位置就会被沙箱拒。
- `<进程 cwd>/.dsh-mattskillsdeck-cache/**`（快照缓存 `src/host/repoKeys.js:206-217`、日志 `src/host/logStore.js:156-179`、命名守护 `src/host/namingGuardian.js:57-61`）——这一处永远在可写范围内，因为它本来就跟着进程当前目录走。

`docs/agents/*` 对插件一直是只读的（`src/host/tracker/backends/markdown/issues-labels.js:8-10` 读 `docs/agents/triage-labels.md`）。本图要写的 `docs/agents/label-colors.json` 是第一次往这个位置写。

---

## 2 失败面

### 2.1 实测（Windows，在系统临时目录 `%TEMP%` 下做，测完已删干净；工作区未留任何测试文件）

测法：用 `node:fs/promises` 复刻 DSH 本地后端的「同目录临时文件 + rename 覆盖」发布手法（DSH 侧对应包名 `@deepseek-ai/dsh-atomic-write`），逐例记录错误对象。错误原文照抄。

| 情形 | 原子写（临时文件 + rename） | 直写（直接 open 目标） |
|---|---|---|
| 父目录不存在 | `ENOENT`：`ENOENT: no such file or directory, open 'C:\...\no-such-dir2\.label-colors.json.25132.tmp'` | `ENOENT`：`ENOENT: no such file or directory, open 'C:\...\no-such-dir\label-colors.json'` |
| 文件不存在（读） | 不适用 | `ENOENT: no such file or directory, open '...\not-there.json'` |
| 目标是目录 | `EPERM`（`syscall: rename`）：`EPERM: operation not permitted, rename '...\.a-dir.25132.tmp' -> '...\a-dir'` | `EISDIR`: `EISDIR: illegal operation on a directory, open '...\a-dir'` |
| 已有文件带只读属性（`attrib +R`） | 临时文件写得进去，卡在改名：`EPERM: operation not permitted, rename '...\.readonly.json.tmp' -> '...\readonly.json'` | `EPERM: operation not permitted, open '...\readonly.json'` |
| 文件被别的程序独占占用 | `EPERM`（rename）：`EPERM: operation not permitted, rename '...\.locked.json.25132.tmp' -> '...\locked.json'` | `EBUSY: resource busy or locked, open '...\locked.json'`（连读也 `EBUSY`） |
| 路径含非 ASCII（`标签 颜色\配色.json`） | 成功，读回一致 | 成功 |

两条对文案很要命的观察：

1. **原子写失败时，错误对象里的 `path` 是临时文件名，不是目标文件。** 例：`...\.label-colors.json.25132.tmp`。界面上永远不要直接显示 `err.path`，否则用户会去找一个根本不存在的文件。
2. **只读/占用这两种情况，临时文件是写得进去的**，失败发生在最后一步改名。这意味着「写一个 2 字节探针」这种可写性探测**测不出**这类失败——探针能落地，但真正的保存会卡在改名。

### 2.2 未能实测的：磁盘满

没找到不损坏本机、又能造出「磁盘满」的可靠办法，**这一项没有实测**。按 2.1 的发布手法推断：临时文件写不下去时抛 `ENOSPC`，目标文件保持原样不被破坏（旧内容不会写成半截）。落地票如果要确定文案，需要在真的满盘环境验一次。

### 2.3 实测不出来的：沙箱拒绝

插件的宿主半跑在 DSH 宿主进程里，从外面没法直接调用它的文件服务（试过对活着的 RPC 通道 `http://127.0.0.1:43120/api/dsws` 发 `wf.chain`，回 `401 Unauthorized`；DSH 会话记录里也没有留下任何 `file access denied` 或政策原文可查，1310 份会话文件里 500 份扫过零命中）。

所以 1.2 的拒绝原文是**从 DSH 实现代码与仓库既有实锤取到的**（`tests/verify-dirwritable.js:157` 内嵌的那条同字），不是本次运行出来的。落地票应当给一条一次性的写探测把它坐实——见第 6 节清单第 1 条。

### 2.4 失败分档与用户可见文案建议

分档原则：**把「插件自己的能力缺失」和「用户文件的问题」严格分开**。前者怎么改用户文件都没用，文案不能引导用户去查目录权限（#476 已经为这件事在链上定过调子）。

| 档 | 触发条件（错误码 / 消息特征） | 建议文案 |
|---|---|---|
| 甲 路径类 | `ENOENT`（父目录不存在）、`EISDIR`、`EPERM`(rename，目标是目录) | 保存失败：写不进 `docs/agents/label-colors.json`，它所在的文件夹不见了或被换成了目录。文件没有改动，可以重试。 |
| 乙 占用类 | `EBUSY`、`EPERM`(rename，目标被占用) | 保存失败：`docs/agents/label-colors.json` 正被别的程序占着（编辑器、同步盘、杀毒都常见）。关掉那个程序再试一次，文件没有改动。 |
| 丙 只读类 | `EPERM`/`EACCES`(open，目标只读) | 保存失败：`docs/agents/label-colors.json` 是只读文件（或所在文件夹不允许修改）。去掉只读属性后再试。 |
| 丁 空间类 | `ENOSPC` | 保存失败：磁盘空间不足，配色没写进去。腾出空间后重试。 |
| 戊 沙箱类 | 消息含 `file access denied` 或 `workspace-write`；或错误码 `FS_SANDBOX_DENIED` | 保存失败：插件不被允许写到这个工作区。**这是插件自己的限制，不是你的文件权限问题**——去改文件或文件夹的权限不会有帮助。 |

戊档额外说明（给实现者）：这一类出现时，插件其实**没有能力**完成「本地配色文件」这件事，只能退回到「颜色改在这一台机器上、不落到工作区」或者直接告诉用户这条路在本部署下不可用。别写成「目录不可写」。

---

## 3 并发

### 3.1 同一工作区两个会话同时点保存会怎样

**如果按上面 1.4 的现状**：两个会话都写不进去，所以讨论不到并发——都是戊档失败。

**如果落地票解决了可写范围**，那么同一工作区两个会话同时点保存，会走 `src/host/tracker/backends/markdown/issues-patch.js:17-25` 那条现成的读-改-写形态：

```js
async function readParseWrite(ctx,r,norm,fn){
  try{
    let txt=await readTextFile(ctx,r.path)
    const out=fn(txt)
    const next=typeof out==='string'?out:txt
    if(next!==txt)await writeTextFile(ctx,r.path,next)
    ...
```

这条形态**没有任何锁**，是经典的「后写覆盖先写」：A 读、B 读、A 写、B 写 → A 的改动丢掉。它的失败模式是**静默丢改动**，不会有任何报错。配色文件是「整份文件一次性覆盖」的性质（弹窗底部一个批量保存按钮），两个会话同时保存的后果就是后保存的那份完整生效、先保存的那份无声消失。注意：这跟「两个字段各写各的」不同，配色文件没有字段级合并的余地，所以丢掉的是用户整整一轮改色。

### 3.2 仓库里现成可复用的两种写法

- **单写者队列 + 1000 毫秒防抖**：`src/host/logStore.js`。`queue`（第 32 行）、`flushTimer`/`flushing`/`flushQueued` 三态守卫（第 40-42 行）、`scheduleFlush`（第 116-124 行）、`flushNow` 的「正在写就排队，写完再补一轮」（第 132-154 行）。**这是同一个宿主进程内的串行化，正好对上「一个进程里两个会话同时点保存」**，可直接照着抄。防抖窗口 `LOG_DEBOUNCE_MS = 1000`（第 6 行）。
- **跨进程文件锁**：`src/host/updateStore.js:81-115`，`open(paths.lock, 'wx', 0o600)` 独占创建 + 写 pid/时间 + 冲突时判活再接管 + 释放时核对 id。**这是给「同一台电脑两个宿主进程」准备的。**

### 3.3 但是日志契约已经替这件事拍过一次板

`research/489-appendix.md:201-205`（双进程同写规则）：

- 「单个宿主进程内所有写入排成一队一次只写一份（单写者队列加繁忙守卫），写失败只计数不抛错。」
- 「**跨进程不加锁**：两个宿主进程写同一个当天文件时，以后写为准，前一次可能被覆盖，审计行可能少记。该行为与现有快照缓存一致，本轮不解决，需要时另立任务票。」
- 目录漂移一条（`:207-211`）：「缓存目录跟着宿主进程当前目录走……宿主换一种启动方式导致当前目录变化时，日志目录跟着变，旧日志不自动迁移。」

**建议**：配色文件复用第 3.2 的「单写者队列 + 防抖」形态（进程内串行化），跨进程（两个宿主进程同时开着同一工作区）**沿用已定的「以后写为准、不加锁」口径**，但要做两件日志契约没要求、配色文件必须要的事：

1. 保存成功后必须**回读一次并比较**，不一致就报错（日志丢一行无所谓，用户的配色丢了是数据损坏）。
2. 跨进程覆盖要留痕——在弹窗保存成功后把「本次写了几个标签的颜色」显示给用户，让「我明明改了却没生效」这种跨进程覆盖至少有个可对照的凭据。

---

## 4 要不要进检查链

### 4.1 结论：要进，但作为 markdown 后端的检查项，不是通用项

判据来自仓库自己的分类规则，`src/shared/tracker/check-catalog-dirs.js:26-31`：

> 通用 = 真值不随 backendId 改变……后端 = 真值随 backendId 改变（仅该后端需要，物理隔离）。
> 判据形式化：若把 backendId 从 'github' 切到 'markdown' / 'gitlab'，该检查的期望结果不变 → 通用；否则 → 后端。

把 backendId 从 github 切到 markdown，这个检查的期望结果会变（本地配色文件只有 markdown 系才用；#610 已定「GitHub 后不放」）。所以它是**后端范围的检查项**，跟 `md:scratchWritable` 同一格，进 `MARKDOWN_CATALOG`（`src/shared/tracker/check-catalog-dirs.js:174-191`）。

### 4.2 理由

1. **报错的时间点太晚。** 只在保存时报错，用户已经改完一轮颜色、点了保存，白干一次。检查链在「用户为工作区选定后端」这一步就能说，代价小得多。
2. **这一类失败用户没法自助排查。** 它是沙箱拒绝，不是文件权限。让用户在保存失败时才第一次听说，会去翻文件属性、翻 ACL，全是白费。#476 已经在链上专门为这种情况定了「诚实说沙箱、别按目录权限排查」的口径（`src/host/tracker/predicatePrimitives.js:169-173`），配色文件正好复用。
3. **已有原语，不用新造。** `DIR_WRITABLE` 就是「目录存在且可写」，它的实现已经在拒绝时区分沙箱与系统（同文件 165-174 行）。

### 4.3 三个必须一起想的代价（不能装作没有）

1. **探针会写进用户的仓库。** `DIR_WRITABLE` 的做法是往被检目录写一个固定名探针再删（`src/host/tracker/predicatePrimitives.js:125`，探针名 `.dsh-write-probe`）。现在探的是 `.scratch`，而 `.scratch/` 在 `.gitignore` 里（本仓库 `.gitignore` 第 5 行）；`docs/agents/` **不在** `.gitignore` 里，也没有任何规则忽略 `.dsh-write-probe`。也就是说探针存在的那一瞬间会被 `git status` 看见；万一删不掉就永久留一个陌生文件在用户的版本库里。
2. **`DIR_WRITABLE` 现在只测「目录里能不能落一个文件」，测不出 2.1 的只读/占用两档**——探针能落地，真正的改名会被拒。所以检查链只能覆盖「沙箱拒绝」这一档，覆盖不了乙、丙两档。
3. **探针的粒度是目录，不是文件。** 现在写死的 `check.path` 是目录（`src/shared/tracker/check-catalog-dirs.js:180` 的 `.scratch`）。要探 `docs/agents/label-colors.json`，要么新增一个「文件可写」原语，要么给 `DIR_WRITABLE` 加一个「探针落在 `path` 的父目录、探针名带原文件名」的变体。这是契约改动，`src/shared/tracker/chain-validate.js:182` 的形状校验要同步。

### 4.4 建议的落地取舍

**两处都做，分工不同：**

- 进检查链：`md:labelColorsWritable`（markdown 范围），让用户在选定后端那一刻就知道「本部署下这个工作区写不进去」。
- 保存时仍要分档报错：检查链测的是「快照那一刻」，用户随时可能把文件夹改成只读、开着编辑器占住文件，这些只有保存时才知道。

**并且**：如果落地票发现默认部署下「写用户工作区」根本不可行（见第 6 节清单第 1 条），那检查链这一项就从「能不能写」升级成「这个功能在本部署下不可用」的准出条件——那时候它不该是一行灰态待办，而该是一条明确的红牌加替代做法。

---

## 5 建议的日志点

判据用 `docs/design/335-logging-contract.md` 第 3 章的两张表，字段白名单用 `research/489-appendix.md` 第 1 章。

### 5.1 写入：常驻（P0）

**理由**：这一笔写是用户点「保存」才发生的，低频；跨的是「宿主进程 → 磁盘」的边界。对照 #57 `update.install.exec`，它进常驻的理由逐字就是「安装执行器跨进程边界调用与结果；用户点按钮安装才发生，低频不采样」（`research/489-appendix.md:115`）。#35 `settings.save` 也在常驻（`:106`），同为「用户手势触发的保存」。

**建议事件**：`labelColors.save`，级别「信息」，常驻。

**允许字段（白名单，之外不记）**：

- `outcome`：结果枚举，建议取 `ok` / `sandbox-denied` / `readonly` / `busy` / `no-parent` / `no-space` / `parse` / `unknown`。
- `count`：本次写了几个标签的颜色（整数，不记标签名，不记颜色值）。
- `scope`：后端枚举（`markdown`）。
- `latencyMs`：从发起写到落定多久。
- `errorHash`：失败时的错误原文短指纹（`H_ERR`，`src/host/logStore.js:13-18` 那个 `hashText` 同算法）。

不记：目标文件绝对路径（要记位置就记 `cwdHash` 或键散列）、文件内容全文、标签名列表、颜色值、错误原文。

### 5.2 读取：按需（P1），带外层判断

**理由**：读发生在「打开弹窗」这一步，弹窗可能被反复开关；高频要守卫。对照 #2 `snapshot.cache.hit`、#54 `client.snapshot.hit`、#56 `detail.cache.hit` 都是「按需 + 采样」（`research/489-appendix.md:123/141/142`）。

**建议事件**：`labelColors.read`，级别「调试」，按需，外层先判开关（`docs/design/335-logging-contract.md:55-58` 守卫纪律第 1 条：关闭时直接返回，不分配行对象、不拼字符串）。

**允许字段**：`source`（枚举 `file` / `builtin-default` / `fallback`）、`count`（读到几个标签）、`ageMs`（缓存多久）、`cwdHash`。

不记：文件内容、标签名、颜色值。

### 5.3 读失败 / 解析失败：告警（直通刷盘）

**理由**：`docs/design/335-logging-contract.md:87-91`（2.3 错误与告警直通刷盘）。用户手改过的 JSON 语法崩了，是必须留下的一条。

**建议事件**：`labelColors.read.fail`，级别「告警」，字段 `reason`（枚举 `missing` / `parse` / `denied`）、`errorHash`。

### 5.4 落地时必须同步的三件事

1. `research/489-appendix.md` 第 1 章对照表要加行：常驻从 30 条变 31 条、按需从 22 条变 23 条，并把编号清单、计数、第 4 节断言六的计数一起改（`:217-222`）。
2. `tests/verify-log-*` 的 `fields`、`guards`、`count` 三项检查要先跑通再加代码。
3. 写盘不能堵塞保存：日志本身是「只进队列就返回」（`src/host/logStore.js:108-114`），配色文件保存是用户等待的路径，两者不要互相等。

---

## 6 给落地票（#618 等）的实现约束清单

1. **先坐实可写范围。** 在改成功能之前，用一次性的写探测在真机上确认三件事：宿主进程的 `process.cwd()` 是什么、`ctx.sandboxPolicy.resolve()` 实际给的 mode 与 workspaceRoot 是什么、往 `<工作区>/docs/agents/` 写会拿到什么错误。本报告 1.2–1.4 是从 DSH 实现代码与现场缓存目录推出来的，没有在运行中的插件里直接跑过一次写入。
2. **可写范围的结论决定了这条路走不走得通。** 若确认默认部署下用户工作区不可写，本地配色文件这一半必须先解决「插件往用户工作区写」的取用方式，否则功能无法交付；不要在保存失败文案上打补丁了事。
3. **用户可见文案按第 2.4 节五档分。** 戊档（沙箱）绝不能说成「目录不可写」。
4. **永远不要把错误对象的 `path` 直接显示给用户**（2.1 观察 1：那是临时文件路径）。
5. **写入串行化照抄 `src/host/logStore.js` 的单写者队列**（第 32、40-42、116-124、132-154 行）；跨进程沿用 `research/489-appendix.md:204` 的「以后写为准、不加锁」口径，但补一次回读校验。
6. **写失败必须保证旧文件完好**（原子发布的临时文件 + 改名，`src/host/tracker/backends/markdown/write.js:12` 已是这个形态）。
7. **检查链加的是 markdown 范围的检查项**（第 4.1 节），且要先决定探针落在哪里、探针名是什么——`docs/agents/` 不在 `.gitignore` 里，探针会在 `git status` 里露头。
8. **日志点按第 5 节**：写入常驻、读取按需、失败告警；同步改 `research/489-appendix.md` 第 1 章与 `tests/verify-log-*`。

---

## 7 还没确定的事

1. **活着的插件宿主进程里，一次 `ctx.fs.writeText` 到底会拿到什么。** 报告里 1.2–1.4 的证据链是完整的（fence 代码 + 出厂配置 + 现场进程目录 + 仓库既有实锤），但没有直接在运行中的插件里跑过一次写入。差的就是这一步实测：写探测一跑，第 6 节清单第 1 条就有答案，第 4 节的检查链取舍也随之定下来。
2. **沙箱有没有「插件也能拿到会话工作区根」的正规口子。** 目前看到的所有出口（`writeText` 的第五个参数、bash 的 `sandboxPolicy`）都要调用方自己知道会话根，插件在 RPC 分发里拿不到；DSH 另有一个按会话工作区限定的文件接口 `@deepseek-ai/dsh-api-workspace-files`，它自己用会话头里的 `header.cwd` 解工作区根，但从扫描到的描述符看只有 `read`/`list`/`stat`/`changes`，**没看到写方法**，也不确定插件能不能取到它。这条如果成立，就是本功能最省事的正路；不成立，就只剩改部署配置（把 DSH 的工作目录设成用户工作区，或把权限模式设成 `danger-full-access`）这一条路可走。
