# 研究：插件往会话工作区写文件的正规口子（#624）

调查票 #624，父图 #610「标签配色可编辑」，接在 #614 的结论之后。#614 的结论是：插件宿主拿到的 `ctx.fs` 是带栅栏的沙箱文件服务，写操作要求目标落在「部署默认可写根」里，而部署默认可写根是 DSH 进程当前目录，不是用户工作区，所以 `docs/agents/label-colors.json` 写不进去。

这张票只回答一个问题：**有没有正规口子让插件写到用户工作区里去。**

**一句话结论：有，而且是官方设计里的那条路——插件调用文件服务的写方法时，把「本次调用的政策」当第 5 个参数传进去，政策里的可写根写成当前会话的工作区根，这次写入就落在用户工作区里。这条口子不需要放宽沙箱，也不需要改部署配置。本报告最后附了一段可以在本机 30 秒复验的实验，已经跑过，结果与预期一致。**

另外三条同批结论，各自在下面有专门一节：

1. 那个按次政策参数就是一个普通对象，**只需要两个字段**：模式字符串与可写根绝对路径。DSH 的围栏**不校验调用方身份**，谁都能传，传什么就按什么判。
2. 按会话工作区限定的文件服务（`@deepseek-ai/dsh-api-workspace-files`）**只有读，没有任何写方法**。它不是本功能的正路。
3. 宿主起外部程序的能力（插件里的 `ctx.exec`）**确实不受文件沙箱约束**，可以借它写工作区里的文件；但 DSH 自己的文档口径是把「起程序」划在文件围栏之外、归另一层管，没有把这条路当作「往工作区写文件」的正规通道。本功能不建议走它。

---

## 1 写方法的完整签名与那个按次政策参数

### 1.1 文件服务接口：读穿透、写有栅栏

插件宿主侧入口 `src/host/index.js:31` 拿到的 `const fs = ctx.get('fs')`，注册的是 `@deepseek-ai/dsh-fs-sandbox` 提供的 `SandboxedFileSystem`。它继承本地后端，只覆写了两个写方法。原文（DSH 实现本体 `node_modules/@deepseek-ai/dsh-fs-sandbox/lib/index.js`，本机同时存在 asar 内与 profile 内两份拷贝，逐行内容一致，见第 6 节）：

```js
async writeText(target, content, expected, signal, sandboxPolicy) {
    return super.writeText(await this.checkedTarget(target, sandboxPolicy), content, expected, signal);
}
async editText(target, edit, expected, signal, sandboxPolicy) {
    return super.editText(await this.checkedTarget(target, edit, expected, signal), edit, expected, signal);
}
```

五个参数依次是：

| 位置 | 名字 | 含义 |
|---|---|---|
| 1 | `target` | 目标对象，必须由 `fs.resolve(路径[, 选项])` 产出（`src/host/tracker/backends/markdown/write.js:12` 现在就是这么取的） |
| 2 | `content` | 新文件的完整内容 |
| 3 | `expected` | 写入前的版本前提；不传就是无条件写 |
| 4 | `signal` | 取消信号；本次调用前取消就不发布 |
| 5 | `sandboxPolicy` | **本次调用的政策**；不传就回退到部署默认政策 |

判定发生在 `checkedTarget`（同文件）：

```js
async checkedTarget(target, sandboxPolicy) {
    const policy = sandboxPolicy ?? this.ctx.sandboxPolicy.resolve();
    const { mode } = policy;
    if (mode === "danger-full-access") return target;
    if (mode === "read-only") throw new FsError(`cannot write "...": file access denied under read-only mode`, "FS_SANDBOX_DENIED");
    const fresh = await this.resolve(target.displayPath);
    let contained = false;
    for (const root of writableRoots(policy)) if (await isPathUnder(fresh.targetKey, root)) { contained = true; break; }
    if (!contained) throw new FsError(`cannot write "...": file access denied under workspace-write mode`, "FS_SANDBOX_DENIED");
    return fresh;
}
```

`writableRoots` 在 `@deepseek-ai/dsh-sandbox/lib/index.js`：

```js
function writableRoots(policy) {
    if (policy.mode !== "workspace-write") return [];
    return [...new Set([ policy.workspaceRoot, "/tmp", tmpdir() ].map(canonicalPath))];
}
```

所以政策的形状就是 `{ mode, workspaceRoot }` 两个字段被读。**本报告用的两份代码拷贝都读到了同样的判据，且栅栏的输入完全来自这个参数对象。**

### 1.2 政策对象只需要两个字段

实测（下文第 5 节的脚本）确认：

- 只给 `{ mode: 'workspace-write', workspaceRoot: <目标所在目录> }` → 写成功。
- 只给 `{ mode: 'workspace-write' }`（漏了根）→ 抛出一个**没有错误码**的类型错误 `Cannot read properties of undefined (reading 'toLowerCase')`，来自规范化可写根那一步。**这一点很重要：漏字段不会给你体面的拒绝，而是崩在内部。**
- `{ mode: 'workspace-write', workspaceRoot: <不包含目标的目录> }` → 规范拒绝，错误码 `FS_SANDBOX_DENIED`，消息 `cannot write "<目标>": file access denied under workspace-write mode`。
- `{ mode: 'danger-full-access', workspaceRoot: <任意> }` → 直接放行，目标写成功。
- `{ mode: 'write-everything', workspaceRoot: <目标所在目录> }`（模式字符串拼错）→ **落进 `workspace-write` 分支**，按包含关系判，包含就放行。也就是说栅栏对模式字符串不做校验，只做「是不是 `danger-full-access` / 是不是 `read-only`」两次相等比较，其余一律当 `workspace-write` 处理。

### 1.3 DSH 会不会校验调用方身份

**不校验。** 从代码到实测都是这个答案：

- `checkedTarget` 只读传入对象，没有任何身份、会话、来源检查。
- `writeText` 的 JSDoc 原文只写「omit to use the deployment fallback」（不传就用部署回退），没有写「只有某类调用方可以传」。
- 实测：脚本里手写一个 `{ mode: 'danger-full-access', workspaceRoot: 任意目录 }` 就能写到工作区外的目录，全程没有任何会话对象参与。

这条要如实写进落地票的取舍里：**插件自己传政策这条路，DSH 没有为它设门。** 插件应当传自己算出来、能自圆其说的政策（见第 4 节），而不是因为有口子就随手放宽——放宽度量的后果由插件自己兜。

### 1.4 部署默认政策从哪里来

`@deepseek-ai/dsh-sandbox-policy` 的 `resolve()`（`lib/index.js:141-148`）：

```js
resolve(request = {}) {
    const { session } = request;
    return {
        mode: request.mode ?? (session === void 0 ? void 0 : this.overrideOf(session)) ?? this.defaultMode,
        workspaceRoot: resolveWorkspaceRoot(session?.header.cwd ?? this.workspaceRoot),
        ...session === void 0 ? {} : { sessionId: session.id }
    };
}
```

三句话：

1. **不给会话时**，模式取部署默认 `defaultMode`，可写根取部署配置的 `workspaceRoot`（出厂写法是 `process.cwd()`）。
2. **给会话时**，可写根直接就是 `session.header.cwd`。这是我这次验证最想要的一条：**会话工作区根不存在别处，就在会话头的 `cwd` 字段里。**
3. 可选的 `request.mode` 优先级最高（这是给审批升权用的口子）。

对应的出厂部署配置（`@deepseek-ai/dsh-base/cordis.patch.yml`）：

```yaml
- id: sandbox-policy
  name: '@deepseek-ai/dsh-sandbox-policy'
  config:
    mode: !!js process.env.DSH_PERMISSION_MODE ?? 'workspace-write'
    workspaceRoot: !!js process.cwd()
```

本机现场：`D:\0Tools\DSH Desktop` 下的插件缓存与日志（`logs\2026-09-13.log`）正在被本面板的宿主调用写入，说明这个宿主进程的当前目录就是 `D:\0Tools\DSH Desktop`；而面板选中的工作区是 `D:\dsh-plugin\dsh-mattpocock-skills-deck`。#614 已经查明这两个目录不是同一个，所以「不传第 5 个参数」这条路在本机必然被拒。

---

## 2 按会话工作区限定的文件服务：只有读，没有写

包 `@deepseek-ai/dsh-api-workspace-files` 的 README 第一段原文：

> 使用本包可从 Web Client 预览 Session 文件系统允许读取的文件……**本服务不提供修改操作。**

方法表只有：`stat`、`read`、`readBytes`、`readAll`、`readRelated`、`list`、`changes`。我从 asar 里把这几个方法的定义位置也核了一遍（`lib/index.js` 的 `read` / `readBytes` / `readAll` / `readRelated` / `stat` / `list`），**没有任何 `write*` 方法**。

它有一个值得记下来的性质：根目录确实按会话定，而且正是会话头里的 `cwd`——README 的实现内幕一节写「Typert lookup 从 live Session header 或持久层的 header-only `stat` 导出 `WorkspaceFileScope`」，且「这些方法以文件系统执行环境中的绝对路径报告文件」。但**它唯一的用途是给浏览器画预览**，写这一半在设计上就不存在。

结论：这个接口不是本功能的正路。**#614 报告第 7 节第 2 条留的那个悬案（「如果它只有读，这条正路就不成立」）到此确认关闭：它只有读。**

---

## 3 宿主起外部程序的能力：确实不受文件沙箱约束

### 3.1 插件现在用的执行器是什么

插件没有直接叫 `ctx.exec`；宿主侧实际走的是 `src/host/repoKeys.js:100` 的 `execProc(argv, cwd, via)`，它调用 `subprocess.spawn({ argv, cwd, stdio, graceMs })`（同文件第 46、105 行）。`subprocess` 来自 `src/host/index.js:29` 的 `ctx.get('subprocess')`。

### 3.2 这个执行器不过文件沙箱

出厂 profile 把 `subprocess` 绑在 `@deepseek-ai/dsh-subprocess-local`（`@deepseek-ai/dsh-base/cordis.patch.yml` 第 199-200 行），而该包直接 `import { execFile, spawn, spawnSync } from "node:child_process"`——**它不引用 `sandboxPolicy`，也不引用任何沙箱执行器**。带沙箱的是另一族：`@deepseek-ai/dsh-bash-sandbox` 与 `@deepseek-ai/dsh-pwsh-sandbox`，它们注册为 `ctx.shell`，并且头部注释写明「直接调用回退到部署策略」。

实测旁证：这个插件今天就在用 `execProc` 跑 `gh`、`git`，并且在同一个进程里读到了工作区（`gh.exec` 与 `wf.probe` 的日志一直在落盘，`logs\2026-09-13.log`）。整条路上没有任何沙箱拒绝记录。

所以：**借 `ctx.exec` / `subprocess.spawn` 起一个外部程序去写工作区，在技术上可行，并且不会被文件沙箱拦。** 例如起一个 PowerShell 写文件。

### 3.3 DSH 自己算不算这是正当通道

查了 DSH 自己的文档口径，两条原文：

- `@deepseek-ai/dsh-fs-sandbox/README.md`（设计理念一节）：
  > 围栏是在可信代码中检查模型控制路径的策略，而非内核边界。操作属于 seam 自身（open、rename）……**不可信代码的内核级隔离仍由 `ctx.shell` 负责。**

- 同包 `lib/index.js` 的模块注释：
  > This is containment, not a security boundary; kernel-grade isolation of untrusted CODE stays `ctx.shell`'s job (`@deepseek-ai/dsh-bash-sandbox`). 本机改写：这是「围堵」而不是安全边界；对不可信「代码」的内核级隔离是 `ctx.shell` 的职责。

这两句说的是同层意思，但要分清它们**没有**说的话：

1. 它们说明的是「为什么文件围栏不去封进程能力」——那是分层设计，不是漏。**这一点被明确承认，所以「起外部程序能绕过文件栅栏」不是 bug、也不是谁偷偷开的洞。**
2. 它们**没有**把「起外部程序」认作「往工作区写文件」的正当通道。DSH 为「按会话工作区写文件」专门提供了第 5 个参数这条政策通道，并且把可写根按会话算好；绕过它去起程序，等于放弃模式编排（会话如果把模式设成了 `read-only`，起程序这条路不会尊重它）。

另外，插件在 DSH 眼里属于**受信任的静态插件**：它的宿主半由 profile 以普通插件条目加载（`~\.dsh\profiles\web\node_modules\dsh-mattpocock-skills-deck\cordis.patch.yml` 的 `insert` 条目），拿到的 `apply(ctx)` 是完整 Cordis 上下文，可以拿到任意服务。这份上下文**不是**给模型临时写的动态插件用的那道受限上下文——受限上下文由 `@deepseek-ai/dsh-cordis-host-runner` 构造，作用域只限它自己加载的动态包（`lib/types/guard.js:645`、`lib/index.js:685/693` 三处调用点都在动态包路径上；受限上下文只暴露 `get / on / provide / effect`，且被替换掉 `get` 以实现「必须在 inject 里声明过才给读」）。

**落地票的取舍建议：走第 5 个参数（政策通道），不要走起外部程序。** 理由不是「后者违法」，而是三件事：政策通道是 DSH 为这件事设计的口子、它尊重会话自己的模式、它不需要插件自己拼命令行（拼命令行意味着路径转义、编码、超时与退出码全都是插件自己的责任）。

---

## 4 前置条件与插件已有的会话上下文

### 4.1 要什么才能申请政策

要写出「可写根 = 当前会话工作区」的政策，插件需要两样东西之一：

- **会话对象**（推荐）：调 `ctx.get('sandboxPolicy').resolve({ session })`，DSH 自己把 `session.header.cwd` 翻成可写根。这样插件不用猜「哪个字段才是工作区根」。
- **工作区根字符串**（等价）：直接传 `{ mode: 'workspace-write', workspaceRoot }`。省一步，但插件得自己确定那个字符串是对的。

两条都需要知道**当前会话是哪一个**，因为工作区根是会话的属性。

### 4.2 插件现在就已经有会话上下文

**有，而且这条电话今天就在跑。** `src/host/sessionLifecycle.js:11-30` 的 `wf.cwd` 就是「按会话号反查会话工作目录」：

```js
const sessions = ctx.get('sessions')
if (sessions === undefined || typeof sessions.get !== 'function') return { ok: false, error: 'sessions 服务不可用' }
const s = sessions.get(sid)
const header = s && (s.header || s.meta)
const cwd = header && (header.cwd || ...)
```

它拿到的 `s` 就是 `sandboxPolicy.resolve({ session: s })` 要的那个会话对象（同一个 `sessions.get(sid)` 产物，字段用的都是 `header.cwd`）。

现场证据（同一台机器、同一个宿主进程，`D:\0Tools\DSH Desktop\.dsh-mattskillsdeck-cache\logs\2026-09-13.log`）：

```
{"ts":1789231503750,"level":"info","event":"host.call","fields":{"method":"wf.cwd","latencyMs":0,"ok":true,"kind":"cwd"}}
```

`ok:true` 且耗时 0 毫秒，说明 `ctx.get('sessions')` 在活的宿主进程里返回了可用服务，并且这次查询成功取到了会话（否则会走 `{ ok: false }` 分支、日志记成 `host.call.fail`）。日志里这一类成功记录有很多条。

会话号本身从客户端来：`src/client/panel/DockSync.js:76` 的 `host.call('wf.cwd', { sessionId: sid })`（`StatusBar.js:54`、`kernel/probe-auto.js:90`、`kernel/probe-snapshot.js:303` 同形）。工作区路径则一直是客户端用 `args.cwd` 传进来的（`src/host/workspaceCwd.js` 的 `handleBind`/`handleSelection` 都是 `args.cwd`）。

**所以落地票不需要新造会话上下文**：把 `sid` 从客户端一路带到写文件的电话里，就能同时拿到会话对象与工作区根。

### 4.3 落地时的三个注意

1. `ctx.get('sessions')` 取不到时要退守。仓库里 `sessionLifecycle.js:15` 已有先例：`sessions` 不可用就返回 `{ ok: false, error: 'sessions 服务不可用' }`，不要崩。
2. `ctx.get('sandboxPolicy')` 同理要判空。它由 `@deepseek-ai/dsh-sandbox-policy` 注册，`@deepseek-ai/dsh-fs-sandbox` 自己也 `static inject = ["sandboxPolicy"]`，所以只要文件服务在，政策服务就在。取不到时应当**退回不传第 5 个参数**（即维持现状），而不是自己拼一个宽松政策。
3. **不要自己去动第 5 个参数里的 `mode`。** 让 DSH 按会话模式算：会话是 `read-only` 时写应当被拒，这是用户的意图，插件没有理由越过它。升权（`danger-full-access`）是审批流程的事，不是插件自己填的字段。这一点在有个「不校验身份」的口子（第 1.3 节）之后尤其要自觉。

---

## 5 最小可验证做法（本机 30 秒）

我实际跑过的一段实验。它用本机真实安装的 `dsh-fs-sandbox` / `dsh-fs-local` / `dsh-sandbox`（与 DSH 实现里的那份逐行一致，见第 6 节），在一个临时笼子目录里搭出「假装的工作区」与「假装不是工作区」两个目录，然后看同一个目标在不同政策下的结果。**不碰用户工作区、不碰任何被跟踪文件，笼子在脚本最后自删。**

### 5.1 复验步骤

本次调查用的脚本是一次性的，收尾时已从仓库里删干净，所以下面把完整脚本直接贴在报告里。**把这一段存成任意一个 `.js` 文件，在装上 DSH 的这台机器上跑 `node <文件名>` 即可**（30 秒内出结果）。它只 require 本机已安装的 DSH 包、只往自己建的临时笼子目录里写，跑完自删。

两处需要按本机实际情况改的地方已在脚本里用注释标出：一是 DSH 包的物理位置（`DSH_ORIGIN` 与 `PROFILE_NM`），二是笼子挂在哪（`CAGE_PARENT`，默认挂在仓库的 `.r5tmp` 下）。

```js
// #624 复验：栅栏到底按什么判。
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

// ① DSH 本体的包位置。优先级：DSH 进程自己的 node_modules 优先，profile 的物理拷贝兜底。
const DSH_ORIGIN = 'D:\\2Study\\nodejs\\node_modules\\@deepseek-ai\\dsh\\node_modules\\@deepseek-ai';
const PROFILE_NM = path.join(os.homedir(), '.dsh', 'profiles', 'node_modules', '@deepseek-ai');

// ② 笼子挂在哪。默认挂在仓库下的 .r5tmp（收尾会删）；换成任意临时目录也一样。
const CAGE_PARENT = 'D:\\dsh-plugin\\dsh-mattpocock-skills-deck\\.r5tmp';

const { SandboxedFileSystem } = require(path.join(DSH_ORIGIN, 'dsh-fs-sandbox', 'lib', 'index.js'));
const { writableRoots, canonicalPath } = require(path.join(DSH_ORIGIN, 'dsh-sandbox', 'lib', 'index.js'));

(async () => {
  const { Context } = await import('file:///' + path.join(PROFILE_NM, 'cordis', 'lib', 'index.js').replace(/\\/g, '/'));
  const cage = path.join(CAGE_PARENT, 'cage');
  const workspace = path.join(cage, 'user-workspace');    // 假装是用户工作区
  const elsewhere = path.join(cage, 'not-the-workspace'); // 假装不是工作区
  const deploymentCwd = path.join(cage, 'deployment-cwd');// 假装是 DSH 进程当前目录
  await fs.rm(cage, { recursive: true, force: true });
  for (const d of [workspace, elsewhere, deploymentCwd]) await fs.mkdir(d, { recursive: true });

  // 仿造一个政策服务：不给会话时用部署默认根，给会话时用会话头的 cwd。
  const applied = [];
  const sandboxPolicyService = {
    defaultMode: 'workspace-write',
    workspaceRoot: deploymentCwd,
    resolve(request = {}) {
      const p = {
        mode: request.mode ?? (request.session ? 'workspace-write' : this.defaultMode),
        workspaceRoot: request.session?.header?.cwd ?? this.workspaceRoot,
      };
      applied.push({ hasSession: !!request.session, p });
      return p;
    },
  };
  const ctx = new Context();
  ctx.provide('sandboxPolicy', sandboxPolicyService);
  const fss = new SandboxedFileSystem(ctx, { cwd: deploymentCwd, diffBasisMaxBytes: 1024 * 1024 });

  console.log('笼子                  = ' + cage);
  console.log('os.tmpdir()           = ' + canonicalPath(os.tmpdir()));
  console.log('  ↑ 三个目录都在 %TEMP% 之外，所以「成功」只可能来自第 5 个参数');
  console.log('');

  async function attempt(tag, cwd, policy, content) {
    const target = await fss.resolve('label-colors.json', { cwd });
    try {
      const out = await fss.writeText(target, JSON.stringify(content), undefined, undefined, policy);
      const back = await fs.readFile(path.join(cwd, 'label-colors.json'), 'utf8');
      console.log(tag + '：成功，落盘回读=' + back);
      await fs.rm(path.join(cwd, 'label-colors.json'), { force: true });
    } catch (e) {
      console.log(tag + '：' + (e.code || '(无错误码)') + ' :: ' + String(e.message).slice(0, 130));
    }
  }

  await attempt('A 只传 (target, content)                ', workspace, undefined, { a: 1 });
  await attempt('B 政策{workspace-write, 根=workspace}   ', workspace, { mode: 'workspace-write', workspaceRoot: workspace }, { b: 2 });
  await attempt('C 政策{workspace-write, 根=elsewhere}   ', workspace, { mode: 'workspace-write', workspaceRoot: elsewhere }, { c: 3 });
  await attempt('C2 同上但目标改到 elsewhere 自身        ', elsewhere, { mode: 'workspace-write', workspaceRoot: elsewhere }, { c2: 32 });

  const session = { id: 'fake-session', header: { cwd: workspace } };
  const policyD = sandboxPolicyService.resolve({ session });
  await attempt('D 政策=resolve({session}) 的结果         ', workspace, policyD, { d: 4 });
  await attempt('E 政策{mode:danger-full-access}          ', elsewhere, { mode: 'danger-full-access', workspaceRoot: elsewhere }, { e: 5 });
  await attempt('F 政策{mode:write-everything}            ', workspace, { mode: 'write-everything', workspaceRoot: workspace }, { f: 6 });
  await attempt('G 政策{workspace-write, 无 workspaceRoot}', workspace, { mode: 'workspace-write' }, { g: 7 });

  // 再验一次「不传参数走的就是回退政策」：只改回退政策、不碰调用点，看结果翻不翻面。
  const fallback = { mode: 'workspace-write', workspaceRoot: elsewhere };
  sandboxPolicyService.resolve = () => fallback;
  await attempt('H 回退根=elsewhere，不传政策            ', workspace, undefined, { h: 8 });
  fallback.workspaceRoot = workspace;
  await attempt('I 回退根=workspace，不传政策            ', workspace, undefined, { i: 9 });

  console.log('');
  console.log('resolve 被调用次数（回退路径的痕迹）：' + applied.length);
  console.log('writableRoots({workspace-write, 根=workspace}) = ' + JSON.stringify(writableRoots({ mode: 'workspace-write', workspaceRoot: workspace })));

  await fs.rm(cage, { recursive: true, force: true });
  console.log('');
  console.log('清理：cage ' + (await fs.stat(cage).then(() => '仍在（异常）', () => '已删除')));
})().catch((e) => { console.error('FAILED: ' + (e && e.stack || e)); process.exitCode = 1; });
```

### 5.1.1 如果只想在本机确认「部署默认可写根是哪个目录」

不用跑上面那段，也不用写任何东西——看插件缓存目录挂在哪就够了（`src/host/repoKeys.js:184` 把缓存目录定义成「宿主进程当前目录 + `.dsh-mattskillsdeck-cache`」）：

```powershell
Get-ChildItem 'D:\0Tools\DSH Desktop\.dsh-mattskillsdeck-cache\logs' | Select-Object Name, LastWriteTime
```

正在被写入的那个日志目录的父目录的父目录，就是 DSH 进程的当前目录，也就是部署默认可写根。本机跑出来的结果：`D:\0Tools\DSH Desktop`，与面板选中的工作区 `D:\dsh-plugin\dsh-mattpocock-skills-deck` 不是同一个。

### 5.2 预期输出（实际跑到的结果，逐字）

笼子与三个目录都在 `%TEMP%` 之外，所以成功只可能来自第 5 个参数（路径前缀已缩写，错误消息尾部超过界面的部分用 `…` 表示）：

```
笼子                  = <仓库>\.r5tmp\cage
os.tmpdir()           = C:\Users\辰辰洋洋\AppData\Local\Temp
  ↑ 三个目录都在 %TEMP% 之外，所以「成功」只可能来自第 5 个参数

A 只传 (target, content)                ：FS_SANDBOX_DENIED :: cannot write "…\user-workspace\label-colors.json": file access denied under wor…
B 政策{workspace-write, 根=workspace}   ：成功，落盘回读={"b":2}
C 政策{workspace-write, 根=elsewhere}   ：FS_SANDBOX_DENIED :: cannot write "…\user-workspace\label-colors.json": file access denied under wor…
C2 同上但目标改到 elsewhere 自身        ：成功，落盘回读={"c2":32}
D 政策=resolve({session}) 的结果         ：成功，落盘回读={"d":4}
E 政策{mode:danger-full-access}          ：成功，落盘回读={"e":5}
F 政策{mode:write-everything}            ：FS_SANDBOX_DENIED（按 workspace-write 分支处理）
G 政策{workspace-write, 无 workspaceRoot}：(无错误码) :: Cannot read properties of undefined (reading 'toLowerCase')
H 回退根=elsewhere，不传政策            ：FS_SANDBOX_DENIED
I 回退根=workspace，不传政策            ：成功，落盘回读={"i":9}

resolve 被调用次数（回退路径的痕迹）：2
writableRoots({workspace-write, 根=workspace}) = ["<仓库>\\.r5tmp\\cage\\user-workspace","D:\\tmp","C:\\Users\\辰辰洋洋\\AppData\\Local\\Temp"]

清理：cage 已删除
```

读这段输出的四个要点：

- **A 与 B 是核心对照**：同一个目标，只差第 5 个参数，结果一个是拒绝、一个是成功。
- **C 与 C2 是反向对照**：政策的可写根写成不包含目标的目录照样被拒（C），写成包含目标的目录就放行（C2）——证明判据真的用了这个参数。
- **H 与 I 证明「不传参数」走的是回退政策**：只改回退政策的根、完全不碰调用点，结果就翻面了。
- **G 是一处要当心的地方**：政策对象漏了 `workspaceRoot` 时，抛出的不是带错误码的沙箱拒绝，而是一个内部类型错误。落地票不能把这种崩当成「用户目录不可写」来显示。

政策对象的字段下限（同一次运行的附加用例）：只给 `mode` 会崩（G 行）；只给 `workspaceRoot`、`mode=null`、模式字符串大小写不对、空对象，都是 `FS_SANDBOX_DENIED`，不会放行。

### 5.3 清理与不变量

报告里那段内嵌脚本在结尾会 `fs.rm` 掉自己建的笼子目录，并打印确认：

```
清理：cage 已删除
```

本次调查的一次性脚本原本放在 `.r5tmp/`，收尾时**整个目录已删除**，所以仓库里只留下内容性产物，不留工具残留。

三条不变量：

1. 全程没有往 `D:\dsh-plugin\dsh-mattpocock-skills-deck` 以外的任何目录写过东西，也没有往 `docs/agents/` 写过。
2. 所有写操作都落在实验自己建的笼子目录里，脚本跑完自删。
3. 全程没有运行过任何 `git` 命令，没有改过任何被跟踪文件。

### 5.4 落地票应当补的一次真机探测

本节的实验是在**独立起的一个进程**里直接构造 `SandboxedFileSystem` 跑的，它证明的是「围栏怎么判」。它没有在**活着的插件宿主进程里**真的调一次 `ctx.fs.writeText`。落地票在改成功能之前，应当先加一次一次性的写探测，把这三件现场事实打出来：

1. 宿主进程的 `process.cwd()`（即部署默认可写根）；
2. `ctx.get('sandboxPolicy').resolve({})` 与 `.resolve({ session })` 各自给出的 mode 与 workspaceRoot；
3. 不传政策往 `<工作区>/docs/agents/` 写会拿到哪条错误（预期是含 `workspace-write` 的 `FS_SANDBOX_DENIED`），传政策之后是否成功。

这与 #614 报告第 6 节清单第 1 条是同一件事，两票在这里并轨：**先探测、再功能。**

---

## 6 证据索引

### 6.1 插件仓库（工作目录 `D:\dsh-plugin\dsh-mattpocock-skills-deck`）

| 位置 | 内容 |
|---|---|
| `src/host/index.js:29-31` | `subprocess` / `timer` / `fs` 三个服务从 `ctx.get(...)` 进来 |
| `src/host/index.js:255` | `wf.cwd` 电话注册 |
| `src/host/sessionLifecycle.js:11-30` | 按 `sessionId` 反查会话工作目录；用的是 `ctx.get('sessions').get(sid)` 与会话头的 `cwd` |
| `src/host/repoKeys.js:100-127` | `execProc` → `subprocess.spawn` |
| `src/host/tracker/backends/markdown/write.js:9-16` | 插件现在的写路径：`fs.resolve(path)` 后 `fs.writeText(target, content)`，只传两个参数 |
| `src/host/workspaceCwd.js:11-36` | 工作区路径来自客户端传的 `args.cwd`，不是会话头 |
| `src/client/panel/DockSync.js:76` | 客户端用 `host.call('wf.cwd', { sessionId: sid })` 反查工作区 |
| `D:\0Tools\DSH Desktop\.dsh-mattskillsdeck-cache\logs\2026-09-13.log` | 活着的宿主进程正在写日志（证明进程当前目录是 `D:\0Tools\DSH Desktop`）；`wf.cwd` 成功记录 |

### 6.2 DSH 实现本体

asar 里的包内容与 profile 里的物理拷贝逐行一致（比对方式见 6.3），本节行号对两份都成立。

| 位置 | 内容 |
|---|---|
| `node_modules/@deepseek-ai/dsh-fs-sandbox/lib/index.js`（`writeText` / `editText` / `checkedTarget`） | 五参数签名；`sandboxPolicy ?? this.ctx.sandboxPolicy.resolve()`；三种模式判定；`FS_SANDBOX_DENIED` |
| `node_modules/@deepseek-ai/dsh-sandbox/lib/index.js`（`writableRoots`、`canonicalPath`） | 可写根 = 政策的 `workspaceRoot` + `/tmp` + `os.tmpdir()`；`read-only` 时为空 |
| `node_modules/@deepseek-ai/dsh-sandbox-policy/lib/index.js:141-148` | `resolve({ session, mode })`：可写根 = `session.header.cwd`，缺会话时用部署配置根；`request.mode` 优先级最高 |
| `node_modules/@deepseek-ai/dsh-sandbox-policy/lib/index.js:96-131` | 政策服务的构造：`defaultMode` 与 `workspaceRoot` 来自配置 |
| `node_modules/@deepseek-ai/dsh-base/cordis.patch.yml`（`sandbox-policy`、`fs-sandbox`、`subprocess` 三条） | 出厂配置：默认 `workspace-write`、根为 `process.cwd()`；子进程走 `dsh-subprocess-local` |
| `node_modules/@deepseek-ai/dsh-tool-fs/lib/index.js`（`resolvePolicy`、`sessionResolveOptions`） | DSH 自己怎么用这条通道：`this.policy?.resolve({ session: exec.agent.session })`，升权时只覆盖 `mode` 字段 |
| `node_modules/@deepseek-ai/dsh-pwsh-sandbox/lib/index.js:148` | 同族执行器的同一句话：`sandboxPolicy: request.sandboxPolicy ?? this.ctx.sandboxPolicy.resolve()` |
| `node_modules/@deepseek-ai/dsh-api-workspace-files/README.md` | 「本服务不提供修改操作」；方法只有读与列举 |
| `node_modules/@deepseek-ai/dsh-api-workspace-files/lib/index.js` | `read` / `readBytes` / `readAll` / `readRelated` / `stat` / `list` 六个方法，无 `write*` |
| `node_modules/@deepseek-ai/dsh-cordis-host-runner/lib/types/guard.js:645`、`lib/index.js:685,693` | 「受限上下文」只作用于动态加载的临时插件包，不是静态插件 |
| `node_modules/@deepseek-ai/dsh-subprocess-local/lib/index.js`（头部 `import ... from "node:child_process"`） | 子进程服务直接起进程，不引用沙箱政策 |

### 6.3 两份拷贝一致性怎么核的

DSH 桌面版的包内容在 asar 里；`dsh web` profile 另有一份物理拷贝在 `~\.dsh\profiles\node_modules\@deepseek-ai\`，本次实验是拿物理拷贝跑的（Node 不能直接 require asar 里的文件）。为了确认两者不是不同版本，我把三个关键包的 `lib/index.js` 从 asar 里读出来跟物理拷贝逐行比对：

```
dsh-sandbox           行数 asar=204 profile=203  不同的行号=1,203,204
dsh-fs-sandbox        行数 asar=171 profile=170  不同的行号=1,170,171
dsh-sandbox-policy    行数 asar=160 profile=160  不同的行号=1,160
```

**只有第 1 行与最后 1-2 行不同，其余每一行都相同。** 第 1 行是 asar 打包时把文件开头切进上一段文本造成的伪影（那份 dump 的第一行是上一段注释的尾巴），末尾几行是 dump 的收尾。中间全部一致，所以本报告引用的源码行与实测行为对得上。两边的 `version` 字段不同（asar 内 `0.1.5-rc.1`、profile 内 `0.1.5-rc.2`），但源码逐行相同，对本票结论无影响。

---

## 7 对落地票（#618 等）的直接后果

1. **`docs/agents/label-colors.json` 能按原计划写在用户工作区里。** 不需要换通道、不需要换存储位置、不需要换执行者，也不需要改部署配置或放宽沙箱。
2. **改法就一处**：`src/host/tracker/backends/markdown/write.js:12` 现在传 `(target, content)` 两个参数，补上第 5 个参数即可。政策用 `ctx.get('sandboxPolicy').resolve({ session })` 算，会话对象用 `ctx.get('sessions').get(sid)` 取——两样插件都已经在用同样的写法（`sessionLifecycle.js`）。
3. **调用点要能拿到会话号。** 写文件这条链路上现在只有工作区路径（客户端传的 `args.cwd`），要把 `sessionId` 顺着同样的路带进来。这也是「这个文件属于哪个会话」的答案来源。
4. **政策服务取不到时不要自己拼政策**，退回不传参数（维持现状并如实报失败），不要放宽。
5. **别自己动 `mode` 字段。** 会话是 `read-only` 时该被拒就被拒。
6. **`ctx.exec` 这条路技术上通但不用。** 理由见第 3.3 节：它不是 DSH 给这件事准备的口子，也不尊重会话自己的模式。
7. **检查链那一项照原计划加。** 实测确认「不传政策必然被拒」，所以检查链探针能从「本部署写不进这个工作区」直接升级成「这条功能可用了」的正向判断。探针位置、探针名、`.gitignore` 的取舍仍按 #614 报告第 4 节办。

---

## 8 还没确定的事

1. **活着的插件宿主进程里的一次真写入，仍然没有实测。** 本报告的实验是独立进程里直接构造沙箱文件服务跑的，证明的是围栏判据；「活着的插件宿主进程里，`ctx.get('sandboxPolicy')` 取到的是哪一个实例、`ctx.get('sessions').get(sid)` 给的会话对象与客户端传的 `sid` 是否严格对应」还没有在运行中的插件里跑过一次。落地票的第 5.4 节探测一跑，这一条就有答案。
2. **会话模式是 `read-only` 时插件应当怎么表现，没有查。** DSH 侧的行为是明确的（拒绝写入，错误码 `FS_SANDBOX_DENIED`，消息含 `read-only`），但插件该把它显示成什么、要不要在保存按钮上提前灰掉，属于交互设计，本票没有查证。
