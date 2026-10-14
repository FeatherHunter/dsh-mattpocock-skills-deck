# #1150 DSH 文件服务（fs）的输入契约核对（2026-10-14）

**这份笔记要回答一件事**：DSH 的文件服务里，`readText` / `writeText` 到底认不认「裸路径字符串」？我上一轮把一次缓存写不出盘的故障诊断成「裸路径串被拒 → 抛错 → 被调用方的 try/catch 吞掉 → 盘上什么都没写」，这个诊断必须被严格检验，所以这份笔记的第一目标是**证伪它**。

**本文件是这次调查唯一的写入物**。仓库源码、测试、`package.json`、`tests/gate-map.json` 一个字未改。实验脚本与抽取出来的运行时源码副本放在 `.scratch/1150/`（该目录已被仓库忽略），不属于交付物。

**结论先说**：那条论断**成立**（主线四段里三段完全成立，一段措辞需要收窄）。但我在核对过程中发现两件比它更重要的事：一是**抛出来的错误类型会随沙箱档位变化**（`workspace-write` 档下报的是一句和路径毫无关系的 `Cannot read properties of undefined (reading 'trim')`）；二是**「缓存目录」和「沙箱允许写的地方」根本不是同一个东西**——缓存目录按 `process.cwd()` 算，沙箱栅栏却按**会话工作区目录**算，本机上这两个目录不重合，所以只要切回 `workspace-write` 档，同一个「盘上没写、谁也看不见」的症状会原样复发。

---

## 0. 材料与方法（先钉住版本，否则后面的引用没有意义）

本机安装的 DSH 运行时是一个 121MB 的单文件包 `D:\DeepseekHarness\resources\app.asar`（Electron 应用包）。里面的 `dsh/node_modules/@deepseek-ai/**` 就是运行时装的所有 DSH 包，**版本统一为 `0.2.0-rc.2`**（`app.asar` 内 `dsh/package.json` 的 `version` 字段，以及各 fs 包的 `package.json`）。

读它的办法（这是本机可复现的第一手读法，不需要装任何依赖）：Electron 自带 asar 支持，用「以 Node 模式启动同一个可执行文件」就能直接 `import` 包里的模块——

```powershell
$env:ELECTRON_RUN_AS_NODE=1
& "D:\DeepseekHarness\DeepSeek Harness.exe" 你的脚本.mjs
```

实测这个组合是 `node v24.18.1 / electron 44.0.0`，能 `readdirSync` 和 `import()` app.asar 内部的文件。为了后面引用行号方便，我把六个关键文件原样抽到了 `.scratch/1150/extract/`，并逐字节比对过 SHA-256（六个文件全部 `SAME`），所以下面给的「抽取副本路径 + 行号」与「asar 内真实路径 + 行号」是同一份内容：

| asar 内真实路径（下面简称 `…/`） | 抽取副本 | SHA-256 前 16 位 |
|---|---|---|
| `D:\DeepseekHarness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-fs-local\lib\index.js` | `.scratch/1150/extract/dsh/node_modules/@deepseek-ai/dsh-fs-local/lib/index.js` | `63fbb41d2c33e071` |
| `…\@deepseek-ai\dsh-fs-sandbox\lib\index.js` | 同名副本 | `cac65e21a0f0895b` |
| `…\@deepseek-ai\dsh-fs\lib\index.js` | 同名副本 | `b165659f1eff0607` |
| `…\@deepseek-ai\dsh-sandbox\lib\index.js` | 同名副本 | `b56373befbfcfe28` |
| `…\@deepseek-ai\dsh-sandbox-policy\lib\index.js` | 同名副本 | `772ca58f0f786d6c` |
| `…\@deepseek-ai\dsh-base\cordis.patch.yml` | 同名副本 | `9c2be64f46a193ef` |

下面所有引用我都写**绝对路径 + 行号**。为省篇幅，重复出现时用 `…\dsh-fs-local\lib\index.js:825` 这种写法，`…` 始终代表 `D:\DeepseekHarness\resources\app.asar\dsh\node_modules\@deepseek-ai`。

实验中「核对这些代码跑起来是什么样」的部分见第 5 节，脚本在 `.scratch/1150/exp1-fs-contract.mjs`（契约主实验）、`exp2-sandbox.mjs`（沙箱档位与隐藏目录）、`exp3-cache-fence.mjs`（缓存目录与栅栏错位）。

---

## 1. 问题一：`writeText` / `readText` 对入参做了什么检查？喂裸字符串会怎样？

### 1.1 实现里根本没有「检查入参形状」这一步，它是直接取字段

`readText` 的实现一共 6 行（`…\dsh-fs-local\lib\index.js:825-830`）：

```js
async readText(target, signal) {
    return readWholeText({
        displayPath: target.displayPath,
        targetKey: target.targetKey
    }, signal);
}
```

`writeText` 的第一句（`…\dsh-fs-local\lib\index.js:864-866`）：

```js
async writeText(target, content, expected, signal) {
    return this.withLock(target.targetKey, async () => {
        const existing = await probe(target.targetKey);
```

**两个方法都没有 `typeof target === 'string'` 之类的守卫，也没有「必须来自 resolve」的断言。** 它们只是把入参当对象取 `.targetKey` / `.displayPath` 两个字段。喂一个裸字符串进去，`"C:/tmp/x/y.json".targetKey` 是 `undefined`（字符串没有这两个属性），于是：

- `readText` 把 `{displayPath: undefined, targetKey: undefined}` 交给 `readWholeText` → `statRegularFile` 里执行 `await stat(target.targetKey)`，也就是 `stat(undefined)`（`…\dsh-fs-local\lib\index.js:349-361`）；
- `writeText` 先执行 `probe(target.targetKey)`，也就是 `probe(undefined)`（`…\dsh-fs-local\lib\index.js:238-239`）。

`stat(undefined)` 在 Node 里是**同步参数校验失败**，抛的是 Node 自己的 `TypeError`：

```
TypeError [ERR_INVALID_ARG_TYPE]: The "path" argument must be of type string or an instance of Buffer or URL. Received undefined
```

这个 `TypeError` 不会被包成 DSH 自己的 `FsError`：`statRegularFile` 的 catch 只把 `ENOENT` 转成 `FsError`，其余原样重抛（`…\dsh-fs-local\lib\index.js:354-357`：

```js
	} catch (error) {
		/* v8 ignore next 2 -- a non-ENOENT stat failure needs a permission/IO fault; ... */
		if (!isENOENT(error)) throw error;
		throw new FsError(`cannot ${verb} "${target.displayPath}": not found`, "FS_NOT_FOUND");
	}
```

）；`probeStats` 的 catch 同理，只吞 `ENOENT` / `ENOTDIR`，`TypeError` 直接重抛（`…\dsh-fs-local\lib\index.js:224-232`）。

### 1.2 实测：确实抛错，而且**什么都没写、连父目录都没建**

实验（`.scratch/1150/exp1-fs-contract.mjs`，把 app.asar 里的 `LocalFileSystem` 真实实现加载起来跑）原始输出：

```
writeText(裸串 "D:/…/.scratch/1150/fslab/bare/child.txt", "HELLO-BARE")
  => THREW: TypeError | code=ERR_INVALID_ARG_TYPE | message="The \"path\" argument must be of type string or an instance of Buffer or URL. Received undefined"
  → 父目录是否被创建 => false
  → 盘上是否出现文件 => false

writeText(resolve()产物, "HELLO-TARGET")
  => RESOLVED: {"operation":"create","version":"914334758:…","before":null,"after":"HELLO-TARGET"}
  → 父目录是否被自动创建（mkdir recursive） => true
  → 盘上文件内容 => "HELLO-TARGET"

readText(裸串 绝对路径) => THREW: TypeError | code=ERR_INVALID_ARG_TYPE | message="The \"path\" argument must be of type string or an instance of Buffer or URL. Received undefined"
readText(裸串 相对路径) => 同上，一模一样
readText(resolve()产物) => RESOLVED: "HELLO-TARGET"
```

「什么都没写」是可以从代码上直接读出来的，不必只靠实验：`writeText` 里 `probe(target.targetKey)` 是**第一句**，它在 `writeFileAtomic`（真正建目录、写临时文件、改名发布的那段，`…\dsh-fs-local\lib\index.js:512-515`）之前就抛了。所以**不存在「写了一半」或「建了目录但没写文件」的中间态**。

### 1.3 一个反直觉的补充：`resolve()` 的产物里，**只有 `targetKey` 是关键字段**

实验里我故意只喂半个对象：

```
readText({targetKey: <真key>})              => RESOLVED: "HELLO-TARGET"      ← 缺 displayPath，照样读成功
readText({displayPath: <真路径>})            => THREW: 上面那个 TypeError     ← 缺 targetKey，失败
```

因为真正参与 I/O 的只有 `targetKey`；`displayPath` 只用来拼错误消息和给模型/界面看（`…\dsh-fs-local\lib\index.js:825-830` 与 `357`、`359` 里那些 `` `cannot ${verb} "${target.displayPath}"` ``）。这条对排查有用：如果哪天报错消息里路径是 `undefined`，那说明 `displayPath` 丢了；如果直接抛 Node 的 `ERR_INVALID_ARG_TYPE`，那说明 `targetKey` 丢了。

### 1.4 不是「文件不存在」那种错

对照组（实验实测）：

```
readText(resolve(不存在的路径)) => THREW: FsError | code=FS_NOT_FOUND | message="cannot read \"D:\\…\\nope\\nothere.txt\": not found"
```

**「文件不存在」报的是带 `displayPath` 的 `FsError`（`code=FS_NOT_FOUND`），而「喂了裸串」报的是不带 `code` 的 Node `TypeError`。** 两者形态完全不同，日志里不会混淆——前提是日志里真的记了 `error.code` 和 `error.message`（见第 6 节）。

---

## 2. 问题二：`resolve(path, opts?)` 接什么？`cwd` 干什么用？返回什么？

### 2.1 签名与返回值

DSH 自己生成的 API 目录（`…\dsh-tool-cordis\lib\types\api-catalog.js:987`，这是 DSH 喂给模型的权威接口清单）写的是：

```
abstract resolve(path: string, opts?: { cwd?: string; signal?: AbortSignal }): Promise<FsTarget>
```

描述里明说（同文件 `:988-990`）：`relative paths resolve against opts.cwd`、`the same file yields the same targetKey`。

实现（`…\dsh-fs-local\lib\index.js:780-788`）逐字是：

```js
	async resolve(path, opts) {
		if (opts?.signal?.aborted) throw new FsError("resolve aborted", "FS_ABORTED");
		const local = await resolveLocalTarget(opts?.cwd ?? this.config.cwd, path);
		if (opts?.signal?.aborted) throw new FsError("resolve aborted", "FS_ABORTED");
		return {
			targetKey: local.targetKey,
			displayPath: local.displayPath
		};
	}
```

**返回对象只有两个字段，没有第三个**（实验实测 `Object.keys(...)` = `targetKey,displayPath`）。两者都是字符串。

- `displayPath`：绝对路径的「显示拼法」，给人看、给模型看、拼错误消息用。
- `targetKey`：不透明的稳定身份。本地后端里它是 realpath（`…\dsh-fs-local\lib\index.js:175`：`FsTargetKey(await realpath$1(displayPath))`），所以「同一个文件的不同写法（软链接、大小写、8.3 短名）会得到同一个 key」，这是它存在的理由。DSH 的官方包文档明确要求「消费方不得解析或解释 `targetKey`」（`…\dsh-fs\README.zh.md:76`）。

### 2.2 `cwd` 的作用与默认值

`cwd` 就是**相对路径的解析基准**，别的作用一个都没有（注意：它是「解析默认值」，**不是写入范围的边界**——`…\dsh-fs-local\lib\index.js:720-724` 的类注释原话是 "a resolution default, NOT a containment boundary"）。取值顺序是 `opts.cwd ?? this.config.cwd`，而 `config.cwd` 的默认值是 `process.cwd()`（`…\dsh-fs-local\lib\index.js:751-754`）：

```js
	static Config = z.object({
		cwd: z.string().default(process.cwd()),
		diffBasisMaxBytes: z.number().default(DEFAULT_DIFF_BASIS_MAX_BYTES)
	});
```

实验实测：

```
resolve("probe-rel.json", {cwd: LAB})  → displayPath = D:\…\.scratch\1150\fslab2\probe-rel.json
resolve("probe-rel.json")  不给 cwd     → displayPath = D:\dsh-plugin\dsh-mattpocock-skills-deck\probe-rel.json   （= config.cwd）
```

**吃裸路径这件事上，`resolve` 恰恰是唯一「本来就该喂字符串」的方法。** `path` 参数按定义就是字符串。

### 2.3 边界情况实测

```
resolve("")         => FsError | code=FS_NOT_FOUND | message="file_path must be a non-empty string"
resolve(undefined)  => TypeError | message="Cannot read properties of undefined (reading 'trim')"
resolve(123)        => TypeError | message="path.trim is not a function"
resolve(<target对象>) => TypeError | message="path.trim is not a function"
```

空串那条来自 `…\dsh-fs-local\lib\index.js:170`：`if (path.trim().length === 0) throw new FsError("file_path must be a non-empty string", "FS_NOT_FOUND");`。**「非字符串」不是被显式校验拒绝的，而是 `path.trim()` 崩掉**——这是这套实现的一贯手法（没有形状校验，靠下游操作自然失败）。

### 2.4 谁跟它配对，谁是「路径型」谁是「目标型」

DSH 的 API 目录（`…\dsh-tool-cordis\lib\types\api-catalog.js:975-1070`）把 `ctx.fs` 的全部方法列齐了，按参数形状分成两类，这个区分很值得记住：

| 路径型（接字符串） | 目标型（接 `resolve()` 的产物） |
|---|---|
| `resolve(path, opts?)` `:987` | `readText(target, signal?)` `:1029` |
| `lstat(path, opts?, signal?)` `:1023` | `streamText` `:1035`、`readBytes` `:1041`、`readByteRange` `:1047` |
| | `stat(target, signal?)` `:1017`、`listDir(target, signal?)` `:1053` |
| | `writeText(target, content, …)` `:1059`、`editText(target, edit, …)` `:1065` |
| | `processPath` `:993`、`fileUrl` `:1005`、`contains` `:1011`、`watch` `:980` |

`lstat` 是唯一的例外，API 目录还专门解释了为什么（`:1024`）：`lstat` 要的是「跟随软链接之前」那个路径本身，所以它**故意**保持路径型，而 `resolve` 会跟随软链接产生稳定身份。

本仓库的 `src/host/platform/index.js:21-23` 与 `src/host/platform/README.md:31` 已经写着这同一句结论（「path-shaped（lstat / resolve）vs target-shaped（readText / writeText / stat / listDir）」）——**这是二手转述，但与运行时实现完全一致**。

---

## 3. 问题三：有没有 `mkdir`？父目录怎么办？隐藏目录写得进去吗？

### 3.1 没有 `mkdir`

实验实测：`typeof fs.mkdir` → `undefined`（`LocalFileSystem` 实例上）。方法清单（`Object.getOwnPropertyNames(LocalFileSystem.prototype)`）是：

```
constructor, watch, withLock, resolve, processPath, processPathFromHostPath,
fileUrl, contains, stat, lstat, readText, streamText, readBytes,
readByteRange, listDir, writeText, editText, versionAfterWrite
```

`mkdir` 在这个清单里没有，在基类 `FileSystem.prototype`（`…\dsh-fs\lib\index.js:58-96`）里也没有。`node:fs/promises` 的 `mkdir` 只被导入给写文件内部用（`…\dsh-fs-local\lib\index.js:10` 的 import，实际调用点只有 `:515` 和 `:531` 两处，都在 `writeFileAtomic` 里）。

### 3.2 父目录由 `writeText` 自建，而且是递归建

`…\dsh-fs-local\lib\index.js:512-515`：

```js
async function writeFileAtomic(absolutePath, content, mode, signal, internals = {}, createIfAbsent) {
	throwIfAborted(signal, "write");
	const directory = dirname(absolutePath);
	await mkdir(directory, { recursive: true });
```

`recursive: true` 意味着**缺几层建几层**。实验实测：写到 4 层都不存在的 `/a/b/c/d/deep.txt`，返回 `create`，`fs.existsSync('…/a/b/c/d')` → `true`。

所以「没有 mkdir」不等于「父目录得自己建」——**调用方什么都不用做，直接 `writeText` 就行**。

顺带一提：仓库 `src/host/git-process.ts:268` 那句 `try { const pfs = platform.fs; if (pfs !== undefined && typeof pfs.mkdir === 'function') await pfs.mkdir(cacheDirResolved) } catch (e) { /* 已存在或不可建，writeText 会自建 */ }` 是**永远不会执行的死代码**（`typeof undefined === 'function'` 恒假），但它无害，因为注释里那句「writeText 会自建」是对的。

### 3.3 沙箱怎么拦：`read-only` 全拦，`workspace-write` 按「可写根」拦

真正装配到 `ctx.fs` 的是沙箱版（见第 4 节），它只覆盖两个**写**操作（`…\dsh-fs-sandbox\lib\index.js:125-127`、`139-141`），读全部穿透（`:74-75` 原话 "Reads pass through untouched: every mode permits reading"）。

栅栏本体（`…\dsh-fs-sandbox\lib\index.js:153-166`）：

```js
	async checkedTarget(target, sandboxPolicy) {
		const policy = sandboxPolicy ?? this.ctx.sandboxPolicy.resolve();
		const { mode } = policy;
		if (mode === "danger-full-access") return target;
		if (mode === "read-only") throw new FsError(`cannot write "${target.displayPath}": file access denied under read-only mode`, "FS_SANDBOX_DENIED");
		const fresh = await this.resolve(target.displayPath);
		let contained = false;
		for (const root of writableRoots(policy)) if (await isPathUnder(fresh.targetKey, root)) {
			contained = true;
			break;
		}
		if (!contained) throw new FsError(`cannot write "${target.displayPath}": file access denied under workspace-write mode`, "FS_SANDBOX_DENIED");
		return fresh;
	}
```

「可写根」的算法（`…\dsh-sandbox\lib\index.js:166-173`）：

```js
function writableRoots(policy) {
	if (policy.mode !== "workspace-write") return [];
	return [...new Set([
		policy.workspaceRoot,
		"/tmp",
		tmpdir()
	].map(canonicalPath))];
}
```

也就是 `workspace-write` 允许三处：**会话工作区根、`/tmp`、系统临时目录**。本机实测这三者解析出来是：

```
writableRoots({mode:'workspace-write', workspaceRoot:'D:/dsh-plugin/dsh-mattpocock-skills-deck'})
  = ["D:\\dsh-plugin\\dsh-mattpocock-skills-deck","D:\\tmp","D:\\temp"]
```

（本机 `TEMP` 在 D 盘，所以 `tmpdir()` 是 `D:\temp`；`/tmp` 在这种盘符语义下成了 `D:\tmp`。）

**写在工作区根之下的隐藏目录 `.dsh-mattskillsdeck-cache/` 是被允许的**——实验实测：

```
workspace-write 写 <工作区根>/.dsh-mattskillsdeck-cache/probe.json
  => RESOLVED: {"operation":"create","version":"…","before":null,"after":"{\"probe\":1}"}
  盘上是否出现 => true
  resolve 出来的 displayPath => D:\dsh-plugin\dsh-mattpocock-skills-deck\.dsh-mattskillsdeck-cache\probe-1150.json
```

隐藏目录不特殊，只看「在不在可写根之下」。另外「在可写根之下」比的是 **realpath 后的身份**（`isPathUnder` 先做字面比较，字面不同就沿祖先逐个比 `dev`/`ino`，`…\dsh-fs-sandbox\lib\index.js:53-65`），所以 Windows 的 8.3 短名、大小写差异不会误判。

拒绝时抛的是带码的 `FsError`，实测原文（写工作区外的 `~/.dsh`）：

```
FsError | code=FS_SANDBOX_DENIED
message="cannot write \"C:\\Users\\辰辰洋洋\\.dsh\\mattskillsdeck\\probe.json\": file access denied under workspace-write mode"
```

`read-only` 档实测（连工作区内也拒）：

```
FsError | code=FS_SANDBOX_DENIED
message="cannot write \"D:\\…\\fslab2\\ro.txt\": file access denied under read-only mode"
```

`danger-full-access` 档实测：写工作区外的 `~/.dsh` 直接成功（`{"operation":"create",…}`），栅栏完全不介入。

### 3.4 `read-only` / `workspace-write` / `danger-full-access` 从哪来

档位由 `ctx.sandboxPolicy` 决定，默认档来自部署配置。本机桌面 profile 的配置在 `C:\Users\辰辰洋洋\.dsh\profiles\desktop\cordis.patch.yml` 的 `permission` 条目里：

```yaml
- id: permission
  name: "@deepseek-ai/dsh-permission-presets"
  config:
    presets:
      read-only:       { sandbox: read-only,        approval: ask }
      workspace-write: { sandbox: workspace-write,  approval: ask }
      danger-full-access: { sandbox: danger-full-access, approval: never }
    defaultPreset: danger-full-access
```

—— **本机当前默认是 `danger-full-access`**（这与本次会话运行时快照里写的 "Current DSH file policy: danger-full-access" 一致）。`docs/cache-and-diagnostics.md:23-29` 描述的那次事故发生在 `workspace-write` 档下，那是切档之后的情况，不是部署默认。

---

## 4. 问题四：`ctx.get('fs')` 到底是什么对象？会在某些装配路径下缺 `resolve` 吗？

### 4.1 服务名与实现类的注册点

服务名 `"fs"` 是在基类构造函数里注册的（`…\dsh-fs\lib\index.js:58-61`）：

```js
var FileSystem = class extends Service {
	constructor(ctx) {
		super(ctx, "fs");
	}
```

`0.2.0-rc.2` 这个运行时里，`FileSystem` 的子类**只有一个**（对全 asar 做 `extends FileSystem` 文本扫描，命中 1 处）：`…\dsh-fs-local\lib\index.js:725` 的 `var LocalFileSystem = class extends FileSystem`。另有一个沙箱版 `SandboxedFileSystem extends LocalFileSystem`（`…\dsh-fs-sandbox\lib\index.js:103`），它只覆盖 `writeText` / `editText` 两个方法，其余全部继承。

**装配点**在基础 bundle 里（`…\dsh-base\cordis.patch.yml:516-519`）：

```yaml
    # The sandboxed filesystem provider. `cwd` defaults to `process.cwd()`; an
    # overlay can pin another workspace.
    - id: fs-sandbox
      name: '@deepseek-ai/dsh-fs-sandbox'
```

这个 `dsh-base` 是所有模式都会挂的底座。全 asar 里**没有任何一份装配文件挂 `dsh-fs-local`**（扫 `cordis*.yml` 与 `package.json`，`dsh-fs-local` 只作为构建期依赖项出现在各包的 `package.json` 里）。所以在**本机这套运行时里，`ctx.fs` 就是 `SandboxedFileSystem` 的一个实例，且只有一个**。

### 4.2 它同时具备 `resolve` / `readText` / `writeText` 吗？

具备。三者都在原型链上：`SandboxedFileSystem.prototype`（只有 `writeText`、`editText`、`checkedTarget`）→ `LocalFileSystem.prototype`（`resolve`/`readText`/`writeText`/`listDir`/`stat`/`lstat`/… 全在这里）→ `FileSystem.prototype`（`watch`/`sandboxMode`/`processPathFromHostPath`）→ cordis `Service`。

**实验里也能反过来证明本机这套装配是活的**：`C:\Users\辰辰洋洋\.dsh\profiles\desktop\.dsh-mattskillsdeck-cache\` 下有本插件正在写的缓存文件，其中 `FeatherHunter__dsh-mattpocock-skills-deck.json`（8.7MB）与 `session-tickets.json` 的最后写入时间是 `2026-10-14T07:40:10Z` / `07:42:18Z`（= 本机 15:40 / 15:42，就在我跑这次调查的几分钟前）。插件写缓存走的就是 `ctx.get('fs')` → `resolve` → `writeText` 这条路，所以**在这套装配下 `resolve` 存在且能用**。

### 4.3 「某些装配路径下缺 `resolve`」的可能性：分三种情况

1. **同一个宿主进程里的插件**（本插件的宿主半边就是这一类）：拿到的是同一个 `ctx`，`ctx.fs` 就是 4.1 那个实例，`resolve` 一定在。**已证实**（上面的磁盘证据）。
2. **`ctx.fs` 根本不存在**：可能。DSH 自己的包文档就写着「未挂载任何后端的组合就没有 `ctx.fs`，工具会在注册时失败」（`…\dsh-fs\README.zh.md:32`）。DSH 自家代码里到处用 `ctx.get("fs")?.processPathFromHostPath(...)`（例如 `…\dsh-llm\lib\index.js:2276`、`…\dsh-repeat-tool-reminder\lib\index.js:1324`），这个 `?.` 说明「fs 可能拿不到」是官方承认的一种状态。本插件也在多处用 `try/catch` + `typeof` 兜（`src/host/platform/index.js:106`、`src/host/skillProbe.js:173`、`src/host/workspaceCwd.js:120`）。**有旁证但未证实**：我没能造出「fs 服务存在但缺少 `resolve`」的装配；缺只可能是整个服务缺失。
3. **客户端（浏览器）半边**：`ctx.fs` 在浏览器里不存在（fs 是宿主能力）。这次没深入核对客户端 runner 的服务代理形状，**列为没查到**。

**对「修复是否成立」的意义**：既然 `resolve` 与 `writeText` 出自同一个原型链、同一次注册，就不存在「`writeText` 有而 `resolve` 没有」的危险组合。调用方那两句防御（`src/host/git-process.ts:276`、`:291` 的 `typeof fs.resolve !== 'function'` 检查）挡的是「整个 fs 缺失」，不是「fs 缺一个方法」。

---

## 5. 问题五：最小实验（第一手证据，怎么跑的、跑出什么）

### 5.1 怎么把真实实现跑起来

`.scratch/1150/exp1-fs-contract.mjs`，用上面第 0 节那条 Electron node 模式命令跑。要点：

- `new LocalFileSystem(new Context(), { cwd: …, diffBasisMaxBytes: 10*1024*1024 })` —— **真对象能直接构造**（`@deepseek-ai/cordis` 的 `Context` 也在 asar 里，能 import）。
- 沙箱版**不能**这样构造：`new SandboxedFileSystem(new Context(), …)` 会抛 `TypeError: Cannot read properties of undefined (reading 'defaultMode')`，因为它声明了 `static inject = ["sandboxPolicy"]`（`…\dsh-fs-sandbox\lib\index.js:104-108`）而裸 `Context` 里没有这个服务。所以沙箱部分我用 `Object.create(SandboxedFileSystem.prototype)` 加上 `config` / `internals` / `locks` 三个字段做接收者——`checkedTarget`、`resolve`、`writeText` 这些方法体内只用到这几个字段，跑的是**同一份实现代码**，不是复刻。
- 沙箱策略按调用逐个传入（`writeText` 的第 5 个参数 `sandboxPolicy`），所以三种档位都能在同一个进程里测完。

### 5.2 `writeText` 喂裸串在三种档位下的真实报错（这是本次调查最值得记住的一张表）

| 场景 | 实际抛出 | `code` | 消息原文 |
|---|---|---|---|
| `danger-full-access` + 裸串 | `TypeError` | `ERR_INVALID_ARG_TYPE` | `The "path" argument must be of type string or an instance of Buffer or URL. Received undefined` |
| `workspace-write` + 裸串 | `TypeError` | `undefined` | `Cannot read properties of undefined (reading 'trim')` |
| `read-only` + 裸串 | `FsError` | `FS_SANDBOX_DENIED` | `cannot write "undefined": file access denied under read-only mode` |

三行都不是「静默接受」，都抛错、都没写盘。但**报出来的错各不相同，而且没有一条在说「你传了个字符串」**：

- `workspace-write`（就是那次事故所在的档位）报的是 `…reading 'trim'`——因为沙箱先跑 `checkedTarget`，它执行 `this.resolve(target.displayPath)`，而 `displayPath` 是 `undefined`，于是在 `…\dsh-fs-local\lib/index.js:170` 的 `path.trim()` 崩掉。**这条消息里既没有路径、也没有字段名，看日志的人几乎不可能猜到是「参数形状传错了」。**
- `read-only` 报的是 `FS_SANDBOX_DENIED`，消息里路径是字面量 `"undefined"`。**按错误码分支的调用方会把「传错了参数形状」误判成「沙箱不让我写这个目录」**——这正是 `docs/cache-and-diagnostics.md:23` 里那条「★ 真根因：fs 沙箱拒绝写」的诊断最容易被误导的地方。

### 5.3 其余实测（都已在上面对应章节引用过）

| 测什么 | 结果 |
|---|---|
| `typeof fs.mkdir` | `undefined` |
| `resolve()` 返回的键 | 恰好 `targetKey,displayPath` |
| `resolve(rel, {cwd})` | `cwd` 生效；不给则用 `config.cwd`（默认 `process.cwd()`） |
| `writeText(裸串)` 后父目录 | 没建（`false`） |
| `writeText(resolve产物)` 到 4 层不存在的父目录 | 自建成功（`true`） |
| `writeText` 返回值 | `{operation, version, before, after}`；`operation` 是 `create` / `update` |
| `writeText(…, {kind:'createIfAbsent'})` 二次写已存在文件 | `FsError FS_NOT_OBSERVED`：`cannot overwrite existing "…" without reading it first` |
| `readText({targetKey})`（缺 `displayPath`） | 成功 |
| `readText({displayPath})`（缺 `targetKey`） | `ERR_INVALID_ARG_TYPE` |
| `workspace-write` 写 `<工作区根>/.dsh-mattskillsdeck-cache/…` | 成功（隐藏目录不特殊） |
| `workspace-write` 写 `C:\Users\辰辰洋洋\.dsh\mattskillsdeck\…` | `FS_SANDBOX_DENIED` |
| `workspace-write` 写系统临时目录 | 成功 |

---

## 6. 证伪检查（这一节是本次调查的重点）

我这次的任务是**证伪**「裸串被拒 → 抛错 → 被吞 → 没写」。以下是所有我找到的、可能推翻它的东西，以及我为什么最终没有推翻。

### 6.1 反证一：有没有可能文件服务其实接受裸串？——没有

读遍 `readText` / `writeText` 的实现（`…\dsh-fs-local\lib\index.js:825-830`、`864-882`），没有任何字符串分支。全 asar 里 `ctx.fs.writeText(` 的调用点共 5 处（`…\dsh-tool-fs\lib\index.js:586`、`…\dsh-tool-str-replace-editor\lib\index.js:148/174/214`），**每一处传的都是 `resolve()` 的产物**，没有一处传字符串。实验里三种沙箱档位 × 两种参数形状共 6 组组合，裸串 3 组全部抛错、0 组成功。

### 6.2 反证二：有没有可能裸串「安静地不报错」或者「被当成别的东西」？——没有

`resolve(123)` 报 `path.trim is not a function`、`resolve(undefined)` 报 `Cannot read properties of undefined (reading 'trim')`，说明这套实现是「不校验、让它崩」。`writeText` 里 `probe(target.targetKey)` 在任何 I/O 之前，所以哪怕想「写了一半」也做不到。实验里「父目录是否被创建 = false」「盘上是否出现文件 = false」是直接 `fs.existsSync` 查的。

### 6.3 反证三：错误会不会其实没被吞掉？——**确实被吞了，而且今天还在吞**

这是我唯一要帮上一轮论断加固的地方，因为「被吞」不是 fs 服务的性质，而是本插件调用方的性质，必须单独证。三处：

- `src/host/git-process.ts:299`：`} catch (e) { /* 写失败不影响主流程 */ }` —— **空 catch，没有日志、没有返回值**。
- `src/host/git-process.ts:287`：`} catch (e) { return null }` —— 读不到就是 `null`，与「文件不存在」不可区分。
- `src/host/refresh/wiring.js:434`：`try { … await d.writeDiskCache(repo, snap) } catch (eD) {}` —— 外层又是一层空 catch。

`writeDiskCache` 自身**从不抛错、也不返回任何东西**（`src/host/git-process.ts:289-300`），所以调用方**在类型上就没有办法知道缓存写没写成功**。`src/host/sessionRefresh.ts:292-293` 是 `await writeDiskCache(...)` 紧接 `return adoptSnapLog(snap2, cwd)` —— 中间没有任何判断。

### 6.4 反证四：会不会有第二套 fs 实现跟文档不一致？——本机没有

扫描结果：`extends FileSystem` 全 asar 命中 1 处（`LocalFileSystem`）；没有任何装配文件挂 `dsh-fs-local` 或别的 fs 后端。所以**不存在「文档说的那套」和「实际跑的那套」不是同一套**的可能。客户端半边没有 fs，那是另一回事（第 4.3 节第 3 点）。

### 6.5 ⚠️ 最重要的一条：**原始事故的归因，仓库自己的文档就打了两处折扣**

这是我对上一轮论断最实质的保留。

**折扣一：`docs/cache-and-diagnostics.md` 自己说真根因是沙箱，不是契约。** 该文件 `:23` 那行（排查表第 5 行）写着「**★ 真根因**：file access denied under workspace-write mode —— fs 沙箱只允许 process.cwd() 下写入」；而契约问题被记为 `:20` 那行「**确认**：writeText(target,…) 要求 resolve() 返回的 {targetKey,displayPath} 对象，不能传路径字符串 → 修复」——是**同一次排查里一并落地的另一个缺陷**，不是根因。

这个区分在事实层面是站得住的：**就算把 target 对象传对了，`workspace-write` 档下写 `~/.dsh/...` 一样会被 `FS_SANDBOX_DENIED` 拒掉**（我第 5 节的实验就是这么复现的）。也就是说，两个缺陷产生的症状完全一样（盘上没写 + 空 catch 吞掉 + 用户只看到「不秒开」），只凭症状无法反推是哪一个。如果那张已关闭的票把「裸串被拒」写成了原始事故的唯一根因，那与仓库自己的记录相矛盾；只能说它是**两个并列缺陷之一**，且恰好是修完之后能被验证的那一个。

**折扣二（更值得马上处理）：文档对沙箱边界的那句话是错的，而且这个错今天还在生效。** `docs/cache-and-diagnostics.md:28` 写「**只允许写入 process.cwd()（DSH 进程工作目录）下的路径**」。实现不是这样：`workspace-write` 的可写根是 `policy.workspaceRoot`，而它取自**会话的工作区目录**，`process.cwd()` 只是「没有会话时」的兜底（`…\dsh-sandbox-policy\lib\index.js:141-148`）：

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

而插件的缓存目录取自 `process.cwd()`（`src/host/git-process.ts:265-267`：`const cwd0 = (… && process.cwd) ? process.cwd() : DEFAULT_CWD` → `platform.path.join(cwd0, '.dsh-mattskillsdeck-cache')`）。**两个「cwd」不是同一个东西**，本机上它们确实不重合：缓存实际落在 `C:\Users\辰辰洋洋\.dsh\profiles\desktop\.dsh-mattskillsdeck-cache\`，而会话的工作区是 `D:\dsh-plugin\dsh-mattpocock-skills-deck`。实验实测（`.scratch/1150/exp3-cache-fence.mjs`）：

```
workspace-write 的可写根 = ["D:\\dsh-plugin\\dsh-mattpocock-skills-deck","D:\\tmp","D:\\temp"]
插件要写的缓存目录 = C:/Users/辰辰洋洋/.dsh/profiles/desktop/.dsh-mattskillsdeck-cache
该目录在不在可写根之下 = false
写入结果 => THREW: FsError | code=FS_SANDBOX_DENIED | message="cannot write \"C:\\…\\probe-1150-ws.json\": file access denied under workspace-write mode"
盘上是否出现 = false
  （对照）把可写根换成进程 cwd 后 => RESOLVED: "create"
```

**结论：契约那条修好了，「沙箱那条」没修，而且它现在躲在默认档 `danger-full-access` 后面没发作。** 一旦用户把权限档切回 `workspace-write`，缓存写入会再次被拒、再次被那三个空 catch 吞掉、再次表现为「重启不秒开」，而现场唯一的线索是一句看起来像别的问题的 `FS_SANDBOX_DENIED`（或者，如果那时还残留着裸串调用，是一句 `Cannot read properties of undefined (reading 'trim')`）。

### 6.6 我没能排除的可能（如实列出）

- **`process.cwd()` 就是 `C:\Users\辰辰洋洋\.dsh\profiles\desktop` 这件事，我是从磁盘上缓存的落点反推的**，没找到显式 `process.chdir`（全 asar 扫 `chdir` 只命中 subprocess runner 与第三方包）。桌面版可能是在启动子进程时用 `cwd` 参数指定的，我没定位到那段启动代码。所以「两个 cwd 不重合」的**事实链**（缓存落在 profile 目录）是硬的，**机制链**（谁把 cwd 设成那样）是软的。
- **客户端（浏览器）半边的 `ctx` 里 fs 长什么样**，这次没查。
- **`docs/cache-and-diagnostics.md:97-99` 记的三个 commit（`17158102` / `b154abd3` / `ea0b59dd`）在本仓库的 git 历史里查不到**（`git show b154abd3` → `fatal: ambiguous argument`）。可能是变基或换库前的老历史，所以「修复长什么样」我只能用**今天工作树里的代码**（`src/host/git-process.ts:289-300`）来说，不能用那两个 commit 来说。
- **`docs/cache-and-diagnostics.md` 里「readDiskCache 实测：resolve + readText 返回合法数据」这类「运行时探测」结论，我无法复现其原始过程**（那是 2026-08-16 的一次对话，中间产物没留）。但它的结论与今天的实现一致，所以不影响判断。

---

## 7. 逐条结论（按证据强度分档）

### 已证实（有实现代码原文 + 本机真实运行时实验双重证据）

1. `readText(target, signal?)` / `writeText(target, content, expected?, signal?, sandboxPolicy?)` 是**目标型**：实现直接取 `target.targetKey` / `target.displayPath`，**没有形状校验**，**不吃裸路径串**（`…\dsh-fs-local\lib\index.js:825-830`、`864-866`）。
2. 喂裸串**一定抛错**，从不静默接受、从不写盘、连父目录都不建。抛出的具体错误随档位而变（第 5.2 节那张表）；在非沙箱路径上是 Node 的 `TypeError [ERR_INVALID_ARG_TYPE]: The "path" argument must be of type string or an instance of Buffer or URL. Received undefined`。
3. `resolve(path: string, opts?: {cwd?, signal?})` **接字符串**（它就是路径型方法），返回**恰好** `{targetKey, displayPath}` 两个字段；`opts.cwd` 只决定相对路径的解析基准，`opts` 缺省时用 `config.cwd`（默认 `process.cwd()`）。`resolve` 本身**不是**写入范围的边界。
4. 文件服务**没有 `mkdir`**；`writeText` 内部用 `mkdir(dirname, { recursive: true })` 自动递归建父目录（`…\dsh-fs-local\lib/index.js:512-515`）。
5. `ctx.fs` 在本机这套运行时里是 `SandboxedFileSystem` 的唯一实例，注册点是 `…\dsh-base\cordis.patch.yml:516-519`，服务名来自 `…\dsh-fs\lib\index.js:58-61`；它**同时**具备 `resolve` / `readText` / `writeText`（同一条原型链）。全运行时**只有一套** fs 实现，没有第二套与之矛盾。
6. `workspace-write` 的可写根 = 会话工作区根 + `/tmp` + 系统临时目录（`…\dsh-sandbox\lib\index.js:166-173`）；**工作区根之下的隐藏目录 `.dsh-mattskillsdeck-cache/` 被允许**。
7. 本插件 `writeDiskCache` / `readDiskCache` 的错误**确实被吞**：`src/host/git-process.ts:287`（`return null`）、`:299`（空 catch）、`src/host/refresh/wiring.js:434`（空 catch），且 `writeDiskCache` 不返回任何东西——调用方**在代码层面就无法知道写没写成功**。

### 有旁证但未证实

1. 桌面进程的 `process.cwd()` 是 `C:\Users\辰辰洋洋\.dsh\profiles\desktop`（旁证：插件缓存文件就落在那个目录下，最后写入时间在本次调查前几分钟；但没找到显式 `process.chdir` 或启动参数，见 6.6）。
2. 「`ctx.fs` 可能整个缺失」是 DSH 官方承认的状态（`…\dsh-fs\README.zh.md:32` 与 DSH 自家代码里的 `ctx.get("fs")?.`），但本插件运行的那条装配路径下它没缺——缓存文件在写就是证据。
3. `docs/cache-and-diagnostics.md` 记录的三个 commit 与本机 git 历史对不上；该文档所述「运行时探测」的原始过程不可复现。

### 没查到

1. DSH 自己的文件系统子系统文档（`…\dsh-fs\README.zh.md:89` 引用的 `docs/subsystems/filesystem.zh.md`）**没有打进 app.asar**，本机找不到该文件。
2. 客户端（浏览器）半边 `ctx` 里 fs 服务/代理的形状。
3. 「fs 服务存在、但缺少 `resolve` 这一个方法」的任何装配路径——我造不出来，也没在任何装配文件里看到。
4. 桌面进程 `cwd` 被设置的那段启动代码。

---

## 8. 我对上一轮那条论断的判定

**原论断**：「裸路径串喂给 `writeText`/`readText` 会被拒绝并抛错；那个错误又被调用方的 try/catch 吞掉，于是盘上什么都没写、回执却报成功。」

**判定：成立（主线四段里三段完全成立），但两处措辞要收窄。把握很高**——实现代码原文与本机真实运行时实验两条独立证据都指向同一结论，且我用的是「证伪优先」的读法（先找有没有接受裸串的分支、有没有静默成功的路径、有没有第二套实现，都没找到）。

逐段：

| 论断的分段 | 判定 | 说明 |
|---|---|---|
| 裸串会被拒绝并抛错 | **成立** | 但要补：抛的是 Node `TypeError`（不是 `FsError`），且**消息随沙箱档位变**；`workspace-write` 档下是 `Cannot read properties of undefined (reading 'trim')`，`read-only` 档下是 `FS_SANDBOX_DENIED`——后者会让人误判成沙箱问题。 |
| 错误被 try/catch 吞掉 | **成立** | 三处吞点，今天仍在吞，且 `writeDiskCache` 连返回值都没有。这条我比原论断说得更重：它不只是「被吞」，是**结构上不可能知道成败**。 |
| 盘上什么都没写 | **成立** | 抛点在所有 I/O 之前（`probe(target.targetKey)` 是 `writeText` 第一句），实验证实父目录都没建。不存在半写状态。 |
| 回执却报成功 | **部分成立** | 严格说没有「写缓存」的回执。`writeDiskCache` 返回 `undefined`、从不抛错；`src/host/sessionRefresh.ts:292-293` 在它之后无条件返回快照。所以是「**刷新成功，缓存成败完全无信号**」，让用户看到的是「重启不秒开」这个结果。如果理解成「明明写失败却收到一条写成功的回执」，那是把它说重了。 |

**最后一句提醒（不是对论断的否定，是对它外延的修正）**：这条论断解释的是「修之前为什么没写盘」这个问题的一半。另一半——`workspace-write` 档下写 `~/.dsh` 会被沙箱拒——**今天仍然存在**，只是因为默认档是 `danger-full-access` 而没发作；而缓存目录按 `process.cwd()` 算、沙箱栅栏按会话工作区算，这两个目录本机不重合（第 6.5 节实验实录）。要把「重启秒开」真正做稳，光有 resolve 契约修复不够，得让缓存落点与可写根对齐（例如改用会话工作区目录，或换用不受沙箱管的 DSH storage 服务——`docs/cache-and-diagnostics.md:91` 已经把这个方向记下来了）。
