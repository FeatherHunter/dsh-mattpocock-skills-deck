# DSH 平台事实：读源码能钉死的四件事（对应 wayfinder 研究票 #717）

> **引用本文件时请带上 DSH 版本 2.0.10；版本一变必须重测。** 本文件的所有结论只对下面这一版安装成立；换了一版 DSH 之后，每条结论都要按同样的方法重测一遍，不能直接沿用。

本文件回答研究票 #717 里「只读源码就能回答」的四条问题。所有结论来自对本机 DSH 桌面应用安装目录 `D:\0Tools\DSH Desktop\resources\app\`（版本 2.0.10，内置 `@deepseek-ai/*` 0.1.5-rc.2）里已打包的 JavaScript 与 YAML 配置的阅读，另加少量对本机磁盘上「当前正在生效的配置」的只读核对。没有改动任何文件、没有启动任何服务。

一句话先给出四条结论：

1. 桌面应用运行的是一份「Web 组合」的配置档案（profile），当前这台机器上具名 `web`，默认名是 `desktop`，两者都是 `@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-web-app` 再加桌面壳自己的补丁层；智能体预设（preset）默认是 `standard`，不是 `ptc`。若某个会话真的跑在 `ptc` 上，内层工具调用会以完全不同的两种事件（`tool/ptc-dispatch-start`、`tool/ptc-dispatch`）出现，只订 `tool/call` 会漏。
2. Windows 上执行终端命令的工具名是 `pwsh`（不是 `bash`；`bash` 那一行在 Windows 上被显式关掉）。命令行在事件里就是 `JSON.parse(arguments).command`。
3. DSH 宿主侧根本不存在「哪个窗口活跃」的记录，也不存在「最近获得焦点」的记录：每个浏览器窗口对宿主的调用不携带任何身份，宿主也没有客户端清单。两个窗口互相顶不顶掉，完全取决于我们自己的宿主侧代码怎么写；`localStorage` 是同源所有窗口共享的，用它记窗口标识一定会互相顶掉。
4. 「插件加载之前的历史事件收不到」这句继续成立（事件是追加时才广播的）。补课的路存在：宿主侧有 `ctx.sessionQuery`，可以列出所有会话、读取任意一个会话（活的或已落盘的）的完整事件日志，而且读取不会让那个会话被激活。

---

## 一、运行时生效的是哪个 profile 与哪个 preset

### 结论

桌面应用启动时组合的是一份「Web 系配置档案」：档案目录是 `%USERPROFILE%\.dsh\profiles\<名字>`，默认名 `desktop`，本机 `%APPDATA%\DSH Desktop\profile-selection\state.json` 里记着当前生效的名字是 `web`。两种名字走的是同一条组合路径：先按档案清单的 `dsh.profile.bundles` 顺序叠加各 bundle 的补丁层，桌面启动器再把自己的一份补丁层插在 `@deepseek-ai/dsh-web-app` 之后，所以桌面壳（`dsh-plugin-desktop`）在任何一份可用档案下都一定在组合里。

智能体预设的生效默认值是 `standard`：它由 `@deepseek-ai/dsh-web-app` 的补丁层写死在 `agent-presets` 这一行的 `default` 字段上。桌面启动器在这一行只覆盖 `roots` 与 `includeUserRoot`，不动 `default`；本机上档案自己的补丁层 `cordis.patch.yml` 是空数组，设置文档 `%USERPROFILE%\.dsh\settings.yaml` 里也没有 `agent-presets` 段，所以没有任何一层把它改成 `ptc`。

工具呈现模式与预设是两件事。`ptc` 预设之所以让内层调用换形态，是因为它多插了一行 `@deepseek-ai/dsh-agent-tool-presentation`，配置 `mode: ptc`；`standard` 预设没有这一行。另外 `tools` 这一行还有一个「整个进程」的呈现模式旋钮 `mode`，取自环境变量 `DSH_TOOLS_MODE`（取值 `native` / `ptc` / `both`），没有设时模式默认是 `native`。所以「预设是 standard 就一定是 `tool/call`」这句话不成立：如果谁给 DSH 进程设了 `DSH_TOOLS_MODE=ptc`，那么跑 `standard` 预设的会话也会变成只看得见 `run_code`，内层调用同样走 `tool/ptc-dispatch`。

### 证据

**档案在哪、默认叫什么名字、什么条件才可用**

- `D:\0Tools\DSH Desktop\resources\app\lib\profile-manager-SYprTE_H.js:35` — `const DEFAULT_PROFILE_NAME = "desktop";`
- 同文件 `:36-37` — `const BASE_BUNDLE_NAME = "@deepseek-ai/dsh-base";` / `const WEB_BUNDLE_NAME = "@deepseek-ai/dsh-web-app";`
- 同文件 `:80` — 判定一份档案能不能当桌面档案用：`webCapable: problem === void 0 && (name === DEFAULT_PROFILE_NAME || baseBundleIndex !== -1 && webBundleIndex > baseBundleIndex)`
- 同文件 `:101-136` — `createDesktopWebProfile()` 造默认档案时用的就是「web 模板」的 bundles：`:103 const template = PROFILE_TEMPLATES.web;`，`:116 initProfile(staging, template.bundles, template.patchReload);`
- 同文件 `:393-405` — 启动时决定用哪个档案名：默认档案不存在就先造出来，最后返回 `profileName: current.active`。

**「web 模板」到底是哪两个 bundle**

- `D:\0Tools\DSH Desktop\resources\app\node_modules\@deepseek-ai\dsh-app-boot\lib\index.js:327-349` — 出厂档案模板表，其中
  ```js
  web: {
      bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"],
      patchReload: "live"
  },
  ```
  注意这里没有名为 `desktop` 的模板：`desktop` 只是桌面启动器自己造出来的一份档案名（见上一条），它的 bundle 列表同样取自 `web` 模板。

**桌面启动器如何把三层拼起来（这是「任何档案都必然带桌面壳」的依据）**

- `D:\0Tools\DSH Desktop\resources\app\lib\profile-pZhrTizp.js:171` — `const DESKTOP_PROFILE_NAME = "desktop";`
- 同文件 `:177` — `const REQUIRED_BUNDLES = requiredWebBundles();`，而 `:288-292` 的 `requiredWebBundles()` 直接读 `PROFILE_TEMPLATES.web.bundles`。
- 同文件 `:683-716` — 组合入口。`:694` 读桌面包自己的补丁层 `DESKTOP_PATCH_PATH`（= 包根目录的 `cordis.patch.yml`）；`:702-715` 遍历档案的 bundle 层，`:712-714`
  ```js
  if (layer.packageName !== "@deepseek-ai/dsh-web-app") continue;
  bundlePatches.push(...desktopPatches);
  desktopLayerInserted = true;
  ```
  即桌面补丁层永远紧跟 web 层之后插入；`:716` 若档案里没有 web 层就直接抛错，启动失败。
- 同文件 `:898-911` — 组合到末尾时，`desktop-shell` 这一行必须存在，并且被强制打开：
  ```js
  const desktopShell = rows.get("desktop-shell");
  if (desktopShell === void 0) throw new Error(`${BIN_NAME}: desktop profile has no desktop-shell row`);
  patches.push({ id: "desktop-shell", disabled: false, config: {...rowConfig(desktopShell), mode, port, networkExposure, ...} });
  ```
- `D:\0Tools\DSH Desktop\resources\app\cordis.patch.yml:3-28` — 桌面包自己的补丁层：插入 `desktop-shell` / `desktop-terminal` / `desktop-diagnostics` / `desktop-notifications` / `desktop-pnpm` / `desktop-profiles` / `desktop-updates` 七行，并覆盖 `web-runtime` 的 `openBrowser: false`、`printUrl: false` 等。第 1-2 行注释写明它是「围绕既有 Web bundle 组合」。

**预设默认值是 standard，且桌面不改它**

- `D:\0Tools\DSH Desktop\resources\app\node_modules\@deepseek-ai\dsh-web-app\cordis.patch.yml:473-484` — 预设名册那一行：
  ```yaml
  - insert:
      - id: agent-presets
        name: '@deepseek-ai/dsh-agent-presets'
        config:
          default: standard
  ```
- `D:\0Tools\DSH Desktop\resources\app\lib\profile-pZhrTizp.js:818-835` — 桌面启动器对同一行的覆盖只碰 `roots` 与 `includeUserRoot`：
  ```js
  const presets = rows.get(AGENT_PRESETS_ROW_ID);
  if (presets !== void 0) {
      const roots = [{ path: shippedPresetRoot(), trust: "system" }, { path: join(home, USER_PRESET_DIRNAME), trust: "user" }];
      patches.push({ id: AGENT_PRESETS_ROW_ID, config: { ...rowConfig(presets), roots, includeUserRoot: false } });
  }
  ```
- 预设默认值的两级来源与读取时机：`D:\0Tools\DSH Desktop\resources\app\node_modules\@deepseek-ai\dsh-agent-presets\lib\index.js:1157`（设置段名 `const SETTINGS_NAMESPACE = "agent-presets";`）、`:1324`（`this.settings = settingsCtx.settings.register(SETTINGS_NAMESPACE, AgentPresetSettingsSchema, { base: { default: config.default } });`）、`:1349-1351`
  ```js
  get defaultId() {
      return this.settings?.get().default ?? this.config.default;
  }
  ```
  即：用户设置文档里若有 `agent-presets.default`，它盖过组合里的 `config.default`。

**单个会话用哪个预设：会话自己记着**

- `D:\0Tools\DSH Desktop\resources\app\node_modules\@deepseek-ai\dsh-session\lib\index.js:792` — 会话存档头允许一个可选字段：`if (record.agentPreset !== void 0 && typeof record.agentPreset !== "string") throw new Error("session header agentPreset must be a string");`（写入处在同文件 `:1402`）。
- `D:\0Tools\DSH Desktop\resources\app\node_modules\@deepseek-ai\dsh-api-session-controller\lib\types\agent.js:381-394` — 创建会话时解析预设并把 id 交给会话头：
  ```js
  async composeAgent(presetId) {
      const presets = this.ctx.get('agentPresets');
      ...
      const resolvedId = (await presets.resolve(presetId)).id;
      return { agentPreset: resolvedId, setup: async (agentCtx, agent) => { this.installSelection(agent); await presets.mount(agentCtx, resolvedId); } };
  }
  ```
- `D:\0Tools\DSH Desktop\resources\app\node_modules\@deepseek-ai\dsh-agent-presets\lib\index.js:1087` — 会话投影 `agentPreset` 的折叠规则：`apply: (state, event) => event.type === "agent-preset/selected" ? event.data.agentPreset : state,`
- 同文件 `:1754-1762` — 换预设只允许在「还没开跑」的空白会话上：`if (boundary !== void 0 && (boundary.openTurnStartSeq !== null || boundary.lastTurn > 0)) throw new RemoteError("agent-preset/locked", ...)`，换成功后 `:1761 agent.session.append("agent-preset/selected", { agentPreset: preset.id });`

**`ptc` 预设到底改了什么**

- `D:\0Tools\DSH Desktop\resources\app\node_modules\@deepseek-ai\dsh-agent-presets\presets\ptc\agent.cordis.yml:264-272` — 只此一处与 `standard` 的差别来源：
  ```yaml
  - id: tool-presentation
    name: '@deepseek-ai/dsh-agent-tool-presentation'
    config:
      mode: ptc
  ```
  同文件 `:234-238` 还把 `tool-workflow` 关掉（「不要在 `run_code` 旁边再放第二个编排面」）。`presets\standard\agent.cordis.yml` 全文没有 `tool-presentation` 这一行。
- `D:\0Tools\DSH Desktop\resources\app\node_modules\@deepseek-ai\dsh-tools\lib\index.js:2570`（模式取值联合类型）、`:2607`（`this.defaultMode = config.mode ?? "native";`）、`:2668-2675`（`modeFor(scope)`：先看作用域自己的声明，没有才回落到 `defaultMode`）、`:2993-2995`（`collapses(name, scope, nested) { return !nested && this.modeFor(scope) === "ptc" && name !== "run_code"; }`）、`:894`（`const RUN_CODE_NAME = "run_code";`）。
- `D:\0Tools\DSH Desktop\resources\app\node_modules\@deepseek-ai\dsh-web-app\cordis.patch.yml:32-38` — 进程级旋钮：
  ```yaml
  - id: tools
    config:
      # TEMPORARY workaround: DSH_TOOLS_MODE (native|ptc|both) opts a whole dsh
      # process into PTC mode ...
      mode: !!js process.env.DSH_TOOLS_MODE
  ```

**`ptc` 下内层工具调用的事件形态（与 `tool/call` 完全不同）**

- 事件类型表在 `D:\0Tools\DSH Desktop\resources\app\node_modules\@deepseek-ai\dsh-session\lib\types\known-event-types.js:21-78`，其中与工具调用有关的是四条：`tool/call`、`tool/result`、`tool/ptc-dispatch`、`tool/ptc-dispatch-start`。**注意本机这一版里 `tool/result` 是单数 `tool`，不存在叫 `tools/result` 的会话事件**（`tools/result` 是另一套东西，见本节末）。
- 内层派发的写入点：`D:\0Tools\DSH Desktop\resources\app\node_modules\@deepseek-ai\dsh-tools\lib\index.js:1265-1271`（开始）与 `:1243-1251`（结束）
  ```js
  exec.agent?.session.append("tool/ptc-dispatch-start", { rootCallId: exec.rootCallId, parentCallId: exec.callId, subCallId, name, arguments: normalized.logged });
  ...
  agent.session.append("tool/ptc-dispatch", { rootCallId: ..., parentCallId: ..., subCallId, name, arguments: normalized.logged, isError: result.isError, content: logged });
  ```
  两个事件的 `arguments` 同样是「那一次内层调用的参数 JSON 串」（`normalized.logged`，见同文件 `:962-977`），`name` 是内层工具名。所以对内层命令，取命令行的写法与 `tool/call` 完全一致，只是事件类型与容器字段不同（多了 `rootCallId` / `parentCallId` / `subCallId`）。
- 模型直接可见的只有 `run_code`：`D:\0Tools\DSH Desktop\resources\app\node_modules\@deepseek-ai\dsh-tools\lib\index.js:1074-1083`、`:3034-3035`、`:3067-3077`（被折叠的直接调用会被回一条「只允许调 `run_code`」的错误结果）。
- 会话事件类型总数：这一版 `known-event-types.js` 里实际登记 **56 条**（文件第 22-77 行，逐行计数为 56；用 `Select-String` 正则统计本文件得 `count=56`）。研究票里写的「57 种」与本机这一版对不上，落地时不要把这个数字当断言用。
- 形态在磁盘格式里还改过一次名字：`D:\0Tools\DSH Desktop\resources\app\node_modules\@deepseek-ai\dsh-session-format-v2-to-v3\lib\index.js:480-489` 把 `tool/ptc-dispatch-start` 写成 `tool/code-dispatch-start`、`tool/ptc-dispatch` 写成 `tool/code-dispatch`；反向恢复在 `dsh-session-format-catalog\lib\index.js:47-53`（`restoreReleasedV3Artifact(artifact, KNOWN_SESSION_EVENT_TYPES)`）。也就是说读磁盘历史时可能先看到 `code` 名，走官方恢复函数后才变回 `ptc` 名。我们若自己解析落盘文件，两种名字都要认。

**另一套同名易混的事件：`tools/result`（Cordis 运行时事件，不是会话事件）**

- `D:\0Tools\DSH Desktop\resources\app\node_modules\@deepseek-ai\dsh-tools\lib\index.js:3283-3302` — 工具注册表在每次工具执行收尾时发出的运行时事件：
  ```js
  notifyResult(exec, result) {
      Object.freeze(exec);
      const callbacks = this.ctx.events.dispatch("emit", [scopeTarget(this, exec.agent), "tools/result", exec, result]);
      ...
  }
  ```
  参数里 `exec` 带 `name`、`callId`、`rootCallId`、`arguments`（已解析并深冻结的对象，见 `:3037-3060`）、以及 `parent`（内层派发时有值）；`result` 带 `isError`、`content`、`value`。收尾路径的覆盖面：`:3013-3023` 的 `completeScheduledExecution` 把 `dispatch` / `post-result` / `final-result` 三种情况都汇到 `finishScheduledExecution`（`:3257-3272`）→ `notifyResult`，而 `ptc` 的内层派发走的正是同一个 `scheduler.finish(...)`（`dsh-tools\lib\types\ptc.js:451-457`）。
- 它在第一方插件里的先例：`dsh-tool-present\lib\index.js:110`、`dsh-agent-instructions\lib\index.js:1289`、`dsh-subagent-in-process-driver\lib\index.js:86`，都是 `ctx.on("tools/result", (exec, result) => ...)`。
- 作用域过滤的实际语义（决定「绑在宿主上的插件能不能收到全部会话的 `tools/result`」）：`D:\0Tools\DSH Desktop\resources\app\node_modules\@deepseek-ai\dsh-scope\lib\index.js:327-338`
  ```js
  function scopeTarget(base, key) {
      const carrier = { [Context.filter](ctx) {
          if (baseFilter !== void 0 && !baseFilter.call(base, ctx)) return false;
          const tag = scopeOf(ctx);
          if (tag === void 0) return true;      // 没打作用域标的监听器一律放行
          ...
      } };
  ```
  这段只对「`tools/result`」这一族做了代码阅读；它对我们是否真的收得到全部会话的 `tools/result` 属于推断，见文末实测清单。

### 对哪张票有影响

- **T6（#710，写事件订阅）**：事件名要以 `tool/call` + `tool/result` + `tool/ptc-dispatch-start` + `tool/ptc-dispatch` 四条来写，不要用 `tools/result` 当会话事件名。同时注意「`ptc` 不是只由预设决定」：进程若设了 `DSH_TOOLS_MODE=ptc`，连 `standard` 会话也会变成内层派发形态。最省事且与形态无关的做法是改订 `tools/result` 这一条运行时事件（它同时覆盖原生调用与 `ptc` 内层派发，且直接给出已解析的参数与结构化结果），代价是它不落盘、插件加载前的调用收不到。
- **T3（#707，视野模型）**：不用为「桌面 / web 两种 profile 要写两套」担心，两者组合一致；但要知道 `ptc` 会话只订 `tool/call` 会漏。
- 会话级判断预设的可用材料：`session.header.agentPreset`（活的会话直接读会话头）、会话投影 `agentPreset`、或事件 `agent-preset/selected`。

### 还没确定的

- 本机 `settings.yaml` 与档案补丁层都没有覆盖预设，所以「当前默认 `standard`」是可信的；但**当前正在跑的宿主进程**是否被某处设了 `DSH_TOOLS_MODE`，读源码无法确证（只能看到启动器不自设它）。这一条见文末实测清单第 1 条。
- 本机 `%APPDATA%\DSH Desktop\profile-selection\state.json` 写的是 `"active": "web"`（写入时间与该次应用启动同一秒），所以「当前生效的是名为 `web` 的档案」有磁盘证据；但「此刻跑着我的这个宿主进程就是它」属于合理推断，要用实测第 1 条一并确认。

---

## 二、Windows 上实际生效的 shell 工具名是 `pwsh`

### 结论

是 `pwsh`。Windows 上被挂上的是 `@deepseek-ai/dsh-tool-pwsh`，它注册的工具名就叫 `pwsh`，命令行的参数键是 `command`。`@deepseek-ai/dsh-tool-bash`（工具名 `bash`）在 Windows 上被显式关闭。所以 `tool/call` 的 `name` 字段在 Windows 上是字符串 `"pwsh"`，命令行取 `JSON.parse(arguments).command`。

### 证据

- 预设在哪一行挂哪个 shell 工具（`standard` 与 `ptc` 两份文件里这段完全相同）：
  - `D:\0Tools\DSH Desktop\resources\app\node_modules\@deepseek-ai\dsh-agent-presets\presets\standard\agent.cordis.yml:45-51`
    ```yaml
    - id: tool-bash
      name: '@deepseek-ai/dsh-tool-bash'
      disabled: !!js process.platform === 'win32'

    - id: tool-pwsh
      name: '@deepseek-ai/dsh-tool-pwsh'
      disabled: !!js process.platform !== 'win32'
    ```
  - 同一份写法在 `presets\ptc\agent.cordis.yml:52-58`。
- 基础组合 `dsh-base` 里也有一对同名行，但被 Web 层关掉，说明「挂 shell 工具」这件事完全交给预设：
  - `...\@deepseek-ai\dsh-base\cordis.patch.yml:246-252`（基础层定义，同样的平台开关）
  - `...\@deepseek-ai\dsh-web-app\cordis.patch.yml:368-372`
    ```yaml
    - id: tool-bash
      disabled: true

    - id: tool-pwsh
      disabled: true
    ```
    同文件 `:351-360` 的注释解释了原因：Web 面把「一个 agent 贡献什么工具」全部交给预设，所以把基础层的那几行关掉（禁用而不是删除，防止以后有人调顺序时又冒出来）。
- 工具定义本体：`D:\0Tools\DSH Desktop\resources\app\node_modules\@deepseek-ai\dsh-tool-pwsh\lib\index.js:233-241`
  ```js
  ctx.tools.register(defineTool({
      name: "pwsh",
      ...
      parameters: {
          command: { type: "string", required: true, description: "The PowerShell command to execute." },
  ```
  另外 `:224` 在审批请求里也写 `toolName: "pwsh"`。对照 `dsh-tool-bash\lib\index.js:260` 是 `name: "bash"`。
- 事件里 `name` 的来源：`D:\0Tools\DSH Desktop\resources\app\node_modules\@deepseek-ai\dsh-agent-loop\lib\index.js:687-695`
  ```js
  function appendToolCall(session, turn, step, block) {
      return session.append("tool/call", { turn, step, callId: block.id, name: block.name, arguments: block.arguments }).seq;
  }
  ```
  `block.name` / `block.arguments` 来自模型那条消息里的工具调用块（模型侧工具名就是注册名）。
- 平台相关的另一处改动只换「执行器」不换工具名：`D:\0Tools\DSH Desktop\resources\app\lib\profile-pZhrTizp.js:838-861`，`platform === "win32"` 时把 `pwsh-sandbox` 那一行换成 `dsh-plugin-desktop/windows-pwsh-sandbox`，并把原行的 `config` 原样搬过去。这只影响命令怎么被沙箱执行，不影响 `tool/call` 里的 `name`。
- 结构化退出码的出处（供 T6 判断「命令成功没成功」）：`dsh-tool-pwsh\lib\index.js:157-178` 的 `canonicalPwshResult()` 把结果整理成 `{ kind:"foreground", exitCode, signal, timedOut, aborted, timeoutMs, stdout:{text,truncated,spillPath?}, stderr:{...}, sandbox? }`；`:285-288` 的 output schema 里 `exitCode` 是必填。这份结构化结果只出现在 `tools/result` 的 `result.value` 里；会话事件 `tool/result` 只有 `message.content` 文本（正文里写着 `[exit code: N]`）。
- `tool/call` / `tool/result` 的事件结构（field 级）：
  `D:\0Tools\DSH Desktop\resources\app\node_modules\@deepseek-ai\dsh-agent-loop\lib\index.js:697-713`（`tool/result` 里是 `{turn, step, message, error?, meta?}`，并通过 `sourceEventSeqs: [callSeq]` 指回对应的 `tool/call`）。

### 对哪张票有影响

- **T6（#710）**：工具名匹配表的 Windows 分支应当写 `pwsh`（`bash` 只可能在非 Windows 上出现）。取命令行统一从 `JSON.parse(arguments).command` 取。
- 若只看 `tool/result` 判断成功与否：结构化 `exitCode` 在 `tools/result` 的 `result.value.exitCode`，会话事件里没有。

### 还没确定的

- 现场这台机器的工具目录里除 `pwsh` 之外还有第三方插件注册的、同样能执行命令的工具（本机 Web 档案里装了 `dsh-better-sidebar`，它带来 `terminal_create` / `terminal_send` / `terminal_read` 这一族；这些名字在 DSH 自带包里搜不到，只存在于第三方包里）。这些工具的参数字段形状不遵循 DSH 的 `command` 约定。是否要把它们纳入「写操作」判定，属于产品决定；若纳入，需要各自实测参数形状。见文末实测清单第 2 条。

---

## 三、两个窗口同时上报活跃时的行为

### 结论

DSH 宿主侧**没有任何「哪个窗口活跃」的状态**，也**没有「最近获得焦点」的记录**，所以「会不会互相顶掉」这件事在平台层不存在答案：平台不会合并、也不会顶掉任何窗口的上报。活跃集合就是我们的宿主侧代码自己维护的那份数据结构——如果只存一个「当前在看哪个工作区根」的变量，那么后上报的窗口必然覆盖先上报的（后写覆盖先写）；如果按下发上来的窗口标识存成一张表，就可以多个并存。关键约束是：**宿主认不出窗口**（插件的宿主侧接口拿到的是 端点名 + 载荷 + 取消信号，没有调用方身份），要区分窗口只能由客户端自己生成一个标识带上来；而 `localStorage` 是同源所有窗口共享的，用它存窗口标识一定会互相覆盖，得用 `sessionStorage`（每个标签页独立）或内存里的一次性随机标识。

### 证据

**宿主侧没有客户端身份、也没有客户端清单**

- `D:\0Tools\DSH Desktop\resources\app\node_modules\@deepseek-ai\dsh-client-connection\lib\index.js:602-619` — 插件注册自己的接口只有「通道 + 处理器」，没有任何客户端身份参数：
  ```js
  register(owner, channel, handler) {
      assertChannel(channel);
      const fetchHandler = rpcFetchHandler(channel, handler);
      ...
  }
  ```
- 同文件 `:635-663` — 真正调用处理器的地方，第三个参数是取消信号，**没有** 客户端 id、没有窗口 id、没有连接对象：
  ```js
  const result = await handler(endpoint, message.payload, request.signal);
  ```
- 同文件 `:523-538` — 宿主连接服务的实例字段只有 `trustedHosts`、`browserAuth`、`interceptors`、`fetchRoutes` 四样，没有「已连接客户端」之类的登记表。整个文件里没有连接数上限，也没有「只允许一个客户端」的判定。
- 唯一出现「按连接分配 id」的地方是测试夹具，不是产品路径：`dsh-client-connection\lib\client.js:5671-5689`（`FxInbox`、`FIXTURE_HOME`、`fixture:` 标记都在附近）。
- 桌面应用自己只开一个主窗口，并且用单实例锁阻止第二个实例：`D:\0Tools\DSH Desktop\resources\app\lib\main.js:3644-3648`
  ```js
  async function start() {
      if (!app.requestSingleInstanceLock()) { app.quit(); return; }
  ```
  所以「两个 DSH 窗口」在桌面版里指的是两个浏览器标签页/窗口同时打开同一个 DSH 地址（Web 服务器不限制客户端数量），而不是两个应用实例。
- 桌面壳里唯一和「焦点」有关的代码是每个窗口自己的「提醒」计数（任务栏闪烁 / 角标），不是全局的「最近谁获得过焦点」：
  - `D:\0Tools\DSH Desktop\resources\app\lib\electron-runtime-C0DyXlWq.js:1453` — `window.on("focus", clearAttention);`
  - 同文件 `:1602-1608` — `notifyAttention(notification) { ... if (window === void 0 || window.isDestroyed() || window.isFocused()) return; this.attentionCount += 1; ... }`
  - 桌面壳也没有把窗口焦点暴露给插件（`desktop-shell` 行只提供终端、档案、通知、更新这些面）。
- 浏览器侧同理：DSH 的全部前端包里搜不到 `visibilitychange`，`document.hasFocus()` 只在文件目录选择器里出现过一次（`dsh-client-ui-directory-picker-browse\lib\client.js:722`）。也就是说 DSH 自己从不判断「我是不是被聚焦的那个窗口」。

**客户端的持久化状态是同源共享的**

- `D:\0Tools\DSH Desktop\resources\app\node_modules\@deepseek-ai\dsh-client-store\lib\index.js:104-125` — 客户端存储的持久化就是写 `localStorage`：
  ```js
  if (typeof localStorage === "undefined") return;
  ...
  localStorage.setItem(name, JSON.stringify(state));
  ```
- 用了这套持久化的第一方界面例子：`dsh-client-ui-workspace\lib\client.js:194-203`，键名 `dsh.workspace.view.v5`。同一来源的任何窗口共享同一个键，后写的覆盖先写的。

### 对哪张票有影响

- **T3（#707，视野模型）**：宿主侧那份「活跃集合」必须自己写清语义，因为平台不会替我们兜底。要多个窗口并存，就得①由客户端生成窗口标识（放 `sessionStorage` 或推进内存，绝不放 `localStorage`），②宿主侧用「窗口标识 → 最近一次上报时间」的表来存，而不是单个变量。若产品上只想保一个「最近活跃」，那就用时间戳做淘汰，而不是依赖平台的「最近获得焦点」。另外，既然前端就是浏览器页面，客户端的「我是不是被聚焦的那个窗口」可以自己用 `document.hasFocus()` / `focus` / `visibilitychange` 判断，再主动上报「我不再活跃」——平台不提供这个信号，但浏览器提供。
- **T6（#710）**：「刷新面板数据」的推送目标也需要窗口标识才能只推给相关窗口；平台侧没有广播给「某个窗口」的通道，只能每个窗口各自订阅（各开一条事件流）。

### 还没确定的

- 两个浏览器窗口同时打开同一 DSH 地址时，宿主的会话事件流（`session/event` 的浏览器侧订阅）是各自独立还是共用一条，需要实际开两个窗口看现象。代码层面每条订阅都是独立的流式请求（`dsh-api-session-controller\lib\types\history.js:139-268` 的 `follow()` 每个调用者一份缓冲），据此推断是彼此独立，但没有实测证据。见文末实测清单第 3 条。

---

## 四、插件加载之前的历史事件：能不能从本地落盘补课

### 结论

「收不到加载之前发生的事件」这句继续成立：会话事件是「追加即广播」，订阅之前追加的事件不会补发；`session/created` 那种带种子的创建路径里，种子事件本身也不广播。补课的路是存在的，而且是宿主侧的一等接口：`ctx.sessionQuery`（`@deepseek-ai/dsh-session-query` 的服务名就是 `sessionQuery`）可以列出全部会话、读取任意一个会话的完整原始事件日志（活的或只在磁盘上的都行），而且读取**不会**把那个会话变成活跃会话。这套服务在基础组合里默认就挂着（后端是 SQLite 那份 `dsh-session-query-sqlite`）。

### 证据

**事件只在追加时广播**

- `D:\0Tools\DSH Desktop\resources\app\node_modules\@deepseek-ai\dsh-session\lib\index.js:1170-1210` — `append()`：先把事件推进日志（`:1200 this.log.push(event);`）再调用已经收集好的回调（`:1202 invokeContainedSessionObservers(...)`）。没有「给新订阅者重放已有事件」这类逻辑。
- 同文件 `:1015` 与 `:772` 的注释都写明：`session/event` 是「追加即广播的火管（构造期种子不广播）」（原文：`` `session/event` firehose (constructor seeds do not emit) ``）。
- 想要订阅全部会话要显式打全局面：第一方写法一致，例如 `dsh-api-session-controller\lib\types\history.js:158-163`
  ```js
  const disposeEvent = this.ctx.on('session/event', (session, event) => { ... }, { global: true });
  ```

**从本地落盘补课的接口**

- `D:\0Tools\DSH Desktop\resources\app\node_modules\@deepseek-ai\dsh-session-query\lib\index.js:1034-1090` — 服务本体 `SessionQueryEngine`（`super(ctx, "sessionQuery")`），公开方法：
  - `:1056-1058` `observeSession(sessionId, options)` — 「不先做列表预检地观察一个活的或已落盘的会话」，返回一份调用方持有的观察租约（带 `events`、`header`、`cursor`、`projections`）。
  - `:1064-1066` `listSessions(signal)` — 列出完整的逻辑会话集（最新的在前）。
  - `:1073-1081` `readSession(sessionId)` — 最直接的一条：
    ```js
    async readSession(sessionId) {
        const loaded = await this._corpus.load(sessionId);
        Session.create(sessionId, loaded.events, loaded.header, loaded.inheritedEventCount);
        return { session: structuredClone(loaded.header), inheritedEventCount: loaded.inheritedEventCount, events: loaded.events.map(snapshotSessionEvent) };
    }
    ```
    返回的就是「会话头 + 完整事件数组」的克隆，注释写明「读取并重放校验一个完整的逻辑会话日志，但不让它变成活的」（`:1068` 原文：`Read and replay-validate one complete logical session log without making it live.`）。
  - `:1088-1091` `filterSessions(filters, signal)`、`:1098-1109` `readTitle` / `readTitleSnapshot` 等按需读。
- 这套服务默认就在组合里：`D:\0Tools\DSH Desktop\resources\app\node_modules\@deepseek-ai\dsh-base\cordis.patch.yml:129-130`（`- id: session-query-sqlite` / `name: '@deepseek-ai/dsh-session-query-sqlite'`，宿主层）；Web 层只改它的配置：`dsh-web-app\cordis.patch.yml:27-30`（`path: ':memory:'`、`openAt: never`，即默认不主动开全文检索索引，不影响上面这几个「精确读」方法）。
- 浏览器那一侧用的是同一套能力，只是包了一层：`dsh-api-session-controller\lib\types\history.js:97-132` 的 `page()`（按消息对齐翻页）、`:139-268` 的 `follow()`（先给一份完整快照，再持续补差量）。其中 `:158-177` 就展示了「先订阅、再补快照、再用 `session.snapshotEvents(offset)` 把 `session/created` 期间的种子事件补齐」这套自洽写法，可作为我们补课逻辑的参照。
- 会话列表里能直接拿到我们需要的字段：`dsh-session-query\lib\index.js:282-289` 的 `listPersisted()` 返回的是各会话的 `header`；会话头里含 `cwd`（工作区根）与可选 `agentPreset`（见第一节）。

### 对哪张票有影响

- **T6（#710）**：插件启动/面板打开时可以先用 `ctx.sessionQuery.listSessions()` 拿到全部会话头（`cwd`、`agentPreset`、创建时间），再对关心的会话 `readSession(id)` 把事件日志读回来，用与实时订阅同一套解析规则跑一遍，就补上了「加载之前发生的事」。这条路径读的是落盘数据，不激活会话，也不会把别人的会话拉活。
- 反过来说，实时订阅仍然不可省：`sessionQuery` 是「读取」接口，没有推送；要「立刻刷新」还得靠 `session/event`。

### 还没确定的

- `readSession()` 返回的事件类型名是恢复过的现名（`tool/ptc-dispatch*`）还是磁盘上的新格式名（`tool/code-dispatch*`），取决于底层后端读出来的是哪一种形态。代码上官方恢复函数 `restoreReleasedV3Artifact` 会把 `code` 名还原成 `ptc` 名（见第一节证据），据此推断是现名，但要用一次实际调用来确认。见文末实测清单第 4 条。
- `readSession()` 的读取代价（大会话一次读全部事件的内存与耗时）需要量化，决定我们是「打开面板就全读」还是「只对活跃工作区的会话读」。见文末实测清单第 4 条。

---

## 需要跑起来才能确认的部分

以下四条，读源码只能给出推断，必须实际跑一次才能钉死。每条都写了最小做法。

1. **当前宿主进程实际生效的 profile 名、预设默认值与工具呈现模式**
   做法：在一个能被插件读到的地方（例如插件 `apply()` 里）打一行诊断，打印 `process.env.DSH_TOOLS_MODE`、`process.env.DSH_HOME`、以及 `ctx.get('agentPresets')?.defaultId`；再新建一个空白会话，把它的 `session.header.agentPreset` 打出来。预期是 `DSH_TOOLS_MODE` 为空、`defaultId === "standard"`、新会话头 `agentPreset === "standard"`。若 `defaultId` 是 `ptc`，说明有人改过设置或档案补丁层，第一、二节的落地判断要跟着改。

2. **第三方命令执行工具是否也要纳入写操作判定**
   做法：在本机这份 Web 档案下，用一次真实会话调用 `dsh-better-sidebar` 的终端工具（`terminal_create` 等），同时把 `tools/result` 的 `exec.name` 与 `exec.arguments` 打出来（或把 `tool/call` 的 `name`/`arguments` 打出来）。看参数里有没有可识别的命令行字段、有没有工作目录字段。若形状不成体系，就在规则里显式排除，而不是猜一个字段名。

3. **两个窗口同时上报活跃时的真实可见行为**
   做法：开两个浏览器窗口（或标签页）打开同一个 DSH 地址，各自在客户端打印 `document.hasFocus()` 与一个自生成的窗口标识（存在 `sessionStorage`），并定时把标识 + 时间戳打到宿主接口；在宿主侧把收到的记录原样打日志。观察：①两条流是否都到；②`sessionStorage` 里的标识在两个窗口里是否确实不同；③临时把标识改存 `localStorage`，确认两个窗口会互相覆盖（这一步是反证，用来确认第三节的结论确实成立）。做完把窗口关到只剩一个，观察宿主侧是否需要「收摊」逻辑。

4. **`readSession()` 的实际可用性**
   做法：在一个测试会话里调一次 `ctx.sessionQuery.listSessions()` 打印条数，再对其中一条跑 `ctx.sessionQuery.readSession(id)`，统计返回事件的条数、`events` 里出现的事件类型集合（重点看 `tool/call` / `tool/ptc-dispatch` / `tool/code-dispatch` 哪一种出现）、以及这次读取的耗时和 `process.memoryUsage()` 的增量。若出现 `tool/code-dispatch*`，说明历史读回来的名字与实时订阅的名字不一致，解析规则要同时认两种。
