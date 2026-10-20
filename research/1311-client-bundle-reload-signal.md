# #1311 面板重载由什么触发：入口产物的修改时间、状态变更时间与大小，内容字节不参与

> 只认一手来源（DSH 0.2.1-rc.2 的源码与包内说明、本机运行中的服务与文件状态、本仓提交记录）。
> 每条结论后面跟 `文件:行`。本文件只报事实，不写方案、不做决策。
> 调查时间 2026-10-21（Asia/Shanghai）。
>
> **DSH 侧引用的读法**：本机 DSH 桌面版（DeepSeek Harness.exe，FileVersion 0.2.1-rc.2、ProductVersion 0.2.1.0）的实现装在 D:\DeepseekHarness\resources\app.asar 里，包内路径形如 dsh/node_modules/@deepseek-ai/<包名>/lib/index.js。这个路径是 asar 归档内的逻辑路径，用系统自带的 Node 直接读不到（本次实测：对 asar 内路径调用 fs.existsSync 返回 false；Electron 自己的文件读取打过补丁，所以应用自己读得到），所以先把相关文件按 asar 文件头里的偏移抽到仓库的 .scratch/1311/extract/（该目录已被 gitignore）再逐行读。抽取时用每个文件在 asar 头里的 integrity 摘要核对：本次引用的 8 个文件全部逐字节一致（见文末附表）。因此下文的行号对 asar 内该文件的原文成立。下文的 dsh-client-hmr/lib/index.js:105 这类写法，指的是 asar 内 dsh/node_modules/@deepseek-ai/ 下的同名文件；本仓文件的路径照常写。
>
> **三类事实分开标**：**源码**＝原文件里写着的实现或注释；**观察**＝本机跑出来、能看到原始输出的；**推理**＝由前两者推出、本次没有单独做实验的。没有引用任何 DSH 日志。

---

## 1 问题是什么，为什么现在要问

票 #1311 要弄清的是：面板重载到底由文件修改时间触发、内容变化触发，还是别的监听事件触发。

这个问题卡住的是本仓能做的那一半。本仓可以在「缓存命中时完全不碰产物文件」这一半上下功夫（#1325，提交 ecadaab3），但那只在 DSH 把「文件被碰过」当成更新时才有意义：如果 DSH 按内容比对，「碰一下」是无害的；如果 DSH 按文件元数据判定，「碰一下」就是一次真实重载，用户看到的就是面板重挂一次、React 状态丢一次。

一句话概括本票要判定的分叉：**DSH 说的「产物变了」，指的是字节变了，还是文件的时间戳与大小变了。**

## 2 判定依据：DSH 侧实现逐条读

### 2.1 判定值是三个元数据拼出来的哈希

**源码**：每个插件的客户端产物有一个版本值（DSH 源码里叫 revision，SSE 帧里的字段名是 rev）。它由 artifactRevision(baseline) 算出来，输入只有三样：mtimeMs（修改时间）、ctimeMs（状态变更时间）、size（字节数）。函数原文是把这三样各转成字符串，交给 framedHash("plugin-artifact", [...])（dsh-client-modules/lib/index.js:194-200）。

**源码**：framedHash 先喂域名与一个空字符（NUL），再对每个字段先喂「字段字节长度 + 冒号」、再喂字段本身，最后取 sha1 十六进制的前 12 位；shortHash 的注释也写明「sha1 metadata hash shortened to 12 hex chars」，长度常量 HASH_REVISION_LENGTH = 12 在 :163（dsh-client-modules/lib/index.js:183-191、:163）。长度前缀的作用是不让字节跨字段边界滑动（:187 的注释）。

**源码**：这三个值来自 statSync，包装在 captureArtifactBaseline(clientPath) 里，返回 {path, mtimeMs, ctimeMs, size}（dsh-client-modules/lib/index.js:813-822）。启动组合时先记基线、再读产物字节，注释说明这样「读字节之前捕获基线」，避免读到一半被写（dsh-client-modules/lib/index.js:823-841）。

**源码**：rebuilt(id) 每次都重新 stat 一遍算新版本值；新值与当前图里那行相同就直接返回，**连读文件都不做**，注释原文是「Unchanged mtime, ctime and size preserve the graph without reading the bundle」；只有不同才 readFileSync 读产物、换图、通知监听者、再通知图变了（dsh-client-modules/lib/index.js:618-643，短路在 :630，注释在 :621）。

**源码**：onRebuilt 的注释写明它「fires only when artifact metadata changes the rev」（dsh-client-modules/lib/index.js:644-653）。rebuilt 自己的注释说它是「构建变化进入图的唯一入口」（dsh-client-modules/lib/index.js:618-620）；本次抽出的三个包里，rebuilt() 的调用点也只有 dsh-client-hmr/lib/index.js:50 一处。

**推理**：所以这个版本值是「文件系统代际」的标识，不是内容摘要。包内说明也是这么写的：「revision 标识文件系统代际，而非内容相等性。仅元数据变化也可能重载插件」（dsh-client-modules/README.zh.md:135）。

### 2.2 谁在盯着文件：每 500 毫秒一次的 stat 轮询

**源码**：dsh-client-hmr 的文件头把机制写得很直白：一个定时器每隔一段时间 stat 轮询图里每一行的客户端产物；轮询是**有意为之**，因为网络挂载不会投递 inotify 事件；Web 组合会挂这个传输，开发时的重建 watcher 只是另外再提供 bundle 变化（dsh-client-hmr/lib/index.js:9-17）。

**源码**：轮询间隔的配置项是 pollIntervalMs，默认 500 毫秒（dsh-client-hmr/lib/index.js:22；包内配置表同值，dsh-client-hmr/README.zh.md:42）。

**源码**：bundleStat(path) 只从 statSync 里取 mtimeMs、ctimeMs、size 三样；sameBundleStat 判断「没变」的标准是这三个值全等（dsh-client-hmr/lib/index.js:27-39）。

**源码**：apply 里装着这套监视：syncWatches() 从 ctx.clientModules.graph().entries 逐行取 artifactBaseline(row.id) 拿到产物路径与启动基线（:93-104），onGraphChanged(syncWatches) 在图变化时重装，setInterval(pollWatches, pollIntervalMs) 起定时器并 unref()（:105-115）。syncWatches 里取不到基线的行（:96-97）不会被监视。

**源码**：pollWatches 每轮对每个被监视的行 stat 一次；「不脏且三值全等」就跳过（:89），否则 publish（:90）。stat 抛 ENOENT 时把该行标脏、下一轮继续试，不立刻发帧（:84-88）。

**源码**：publish 先调 ctx.clientModules.rebuilt(id)（:50），成功后才把监视里的三值更新成刚读到的值、清掉脏标记；rebuilt 抛 ENOENT 时标脏返回，其他错误只记一条警告（:48-62）。

**源码**：装监视的那一刻也会立刻比一次：watchRow 先 stat 当前文件，若与启动基线不同就立刻 publish（dsh-client-hmr/lib/index.js:63-78，比较在 :77）。这条是「启动组合完成到装好监视之间发生的写入」不会漏掉的原因，正是上面 2.1 里那段基线注释说的场景。

**推理**：所以「别的监听事件」这个选项要拆开看——图变化会触发 syncWatches 重装监视，新加进来的行在装监视时立刻比一次（:107、:77），但**真正判断「变没变」的地方只有按三值比较这一处**；没有 inotify、没有内容比对，也没有「文件被打开过」之类的信号。

### 2.3 从 stat 到浏览器：SSE 上的两种帧

**源码**：端点常量是 /plugins/events（dsh-client-hmr/lib/index.js:5）。新连接进来先收到 : connected 注释行和一条完整的 graph 帧（:124-139，注释行在 :130，graph 帧在 :132-135）。rebuilt 帧在 onRebuilt 里发出，形状是 {type:"rebuilt", id, rev}（:154-161）。图变化另有 graph 帧广播（:116-123）。

**源码**：graph 帧里的每一行带着 url 与 rev，url 形如 plugins/??<包名>/client.js&rev=<rev>（组合路由的拼法见 dsh-client-modules/lib/index.js:202-219）。浏览器据此去取脚本；版本值一变，URL 就变。

**推理**：因为 rebuilt() 在元数据没变时直接返回（2.1 的短路），所以「元数据没变」在这一层等于「不会发 rebuilt 帧、不会换 URL」。

### 2.4 浏览器收到 rebuilt 之后：拆掉旧的，重新挂一遍

**源码**：浏览器半侧把两种帧分开处理：graph 交给 entries.sync，rebuilt 交给 entries.reload(frame.id, frame.rev)（dsh-client-hmr/lib/client.js:271-275，分派在 :272）。

**源码**：reload(id, rev) 先把目标行的 rev 换成新值（dsh-client-modules/lib/client.js:433-439），把这次替换排进与图更新同一条串行队列（:440）；同一个 rev 直接忽略（:450），否则调 replace（:455）。

**源码**：replace 的顺序是：让旧模块失效 index.invalidateForReplacement(id, rev)、预取新脚本 await this.modules.prefetch(id)（:493-494）、拆掉旧 fiber await tearDownEntryFiber(entry)（:496）、移除自己的样式（:497）、导入新 bundle（:499）、**await entry.refresh() 用新 bundle 重新挂载**（:501）、等新 fiber 建立（:502），最后记下新版本值（:504）（dsh-client-modules/lib/client.js:492-505）。

**源码**：包内说明把这个顺序用文字重述了一遍：使旧模块失效、旧 fiber 仍在服务时预取脚本、删除注册表 runtime、等旧 fiber 清理、清除条目里的 fiber 引用并移除样式、物化新导出、再由 entry.refresh() 通过 Loader 挂载（dsh-client-hmr/README.zh.md:66）。

**源码**：最能说明「重挂载＝界面重渲染、状态丢失」的两处原文：一是 await entry.refresh(); 这一行本身（dsh-client-modules/lib/client.js:501）；二是已知限制里那句「重载有意保持粗粒度——全新 fiber 与全新组件；被重载插件内的 React 状态会丢失，而数据层（连接 fiber、运行时 fiber、Session 对象）不受影响」（dsh-client-hmr/README.zh.md:116；同义的说法在 :48）。

**推理**：一次重载就是卸载旧组件树、再挂一棵新树，所以用户在界面上看到的就是面板内容重建（闪烁）一次。这也是提交 ecadaab3 的说明里「验证链跑一次要命中十几回，面板就闪十几回」那句话的机制来源。

### 2.5 内容字节在这条链路上从头到尾没有被读来比对

**源码**：三处正面证据叠在一起：比较只看三值（dsh-client-hmr/lib/index.js:37-39）、版本值只由三值算出（dsh-client-modules/lib/index.js:194-200）、三值相同就不读文件直接返回（dsh-client-modules/lib/index.js:630）。

**源码**：包内说明两处把这件事写明：「首次发布与 HMR 都从入口的 mtimeMs、ctimeMs 和大小派生逐插件 revision，不对产物内容求哈希。状态变更时间用于区分保留 mtime 和大小的重写」（dsh-client-modules/README.zh.md:79）；「入口的 mtime、ctime 和大小共同标识 revision，无需对其内容求哈希；元数据未变时无需读取内容」（dsh-client-hmr/README.zh.md:62）。

**推理（方向一）**：内容一字节未变、只动了元数据 → 版本值变 → 发 rebuilt → 重挂载。本次实验做的正是这一支。
**推理（方向二）**：内容变了但三个元数据都没变 → 版本值不变 → 不重载。包内说明把这种情形列为「无法区分」（dsh-client-modules/README.zh.md:135）。本次没有构造这种情形。

### 2.6 旁证：宿主插件那条通道也按元数据判定，但不看 ctime

**源码**：DSH 另有一条 dsh-hmr，管的是宿主进程里已加载的模块。它给每个模块记的身份是 ino:size:mtimeMs（dsh-hmr/lib/index.js:416-417），比较时判「陈旧」的标准是这条身份串与记录不同；没有记录过的新模块则看它的修改时间是否晚于上次观察（:461-472）。注释明确说**不记 ctime**，理由是给文件建硬链接（pnpm 从自己的 store 导入时）会改 ctime 而不改内容（dsh-hmr/lib/index.js:420-427）。profile 重建组合时，reconcileProfile 就是用这套比较找出磁盘上变了的模块（dsh-hmr/lib/index.js:1320-1384，比较在 :1332-1338）。

**源码**：包内说明说，profile 监听与 Plugin Manager 触发的重组，会替换 profile 目录下磁盘上有变化的插件，包括 node_modules 里已安装的包与已链接包的目标（dsh-hmr/README.zh.md:49、:65）。

**区别（推理）**：这条替换的是宿主侧模块（插件在宿主进程里的代码），不是浏览器里的 bundle；判据也不含 ctime。本次没有单独验证它在本机这个 profile 是否真的生效，只能确认 asar 里 dsh-base/package.json 的 dependencies 含 @deepseek-ai/dsh-hmr 0.2.1-rc.2。所以它只当旁证：DSH 侧「文件变了没有」的两条通道都用元数据，都不比内容。

## 3 本机复现实验

### 3.1 环境与对象

**观察**：DSH 桌面版 DeepSeek Harness.exe，FileVersion 0.2.1-rc.2、ProductVersion 0.2.1.0；profile 是 C:\Users\辰辰洋洋\.dsh\profiles\desktop。该 profile 的 package.json 里 dsh.profile.bundles 含 @deepseek-ai/dsh-web-app；asar 内 dsh-web-app/package.json 的 dependencies 含 @deepseek-ai/dsh-client-hmr 0.2.1-rc.2（本次从 asar 头直接读到的原文）。另有一条直接证据：本次在该服务上连 /plugins/events 能正常收到 graph 帧（见 3.3），说明 2.2 说的那个轮询传输在当前运行的宿主里确实挂着。

**观察**：本插件以 link 方式安装：profile 的 node_modules\dsh-mattpocock-skills-deck 是符号链接，指向 D:\dsh-plugin\dsh-mattpocock-skills-deck\package。客户端入口由 package/package.json:20 的 exports["./client"] 声明为 ./lib/client.js。

**对象文件**：D:\dsh-plugin\dsh-mattpocock-skills-deck\package\lib\client.js。初始状态：size=2095846、mtimeMs=1792520462760、ctimeMs=1792520462760.7024、sha1=60af5ad1a62500b0a72adb75bc6d9c993c10a1ac。

### 3.2 步骤与原始输出（照抄）

1. 连 http://127.0.0.1:54643/plugins/events（本机 DSH 桌面版 Web 服务的插件事件通道，即 2.3 那个端点）拿 graph 帧。本插件那一行是：

   ```json
   {"id":"dsh-mattpocock-skills-deck","url":"plugins/??dsh-mattpocock-skills-deck/client.js&rev=eff3bbfd11ae","rev":"eff3bbfd11ae","inject":[],"immediately":true}
   ```

2. 只改元数据、不写内容：fs.utimesSync(文件, 现在, 原 mtimeMs+17000)，即把 mtime 往后拨 17 秒，全程没有打开文件写一个字节。改完 stat：mtimeMs=1792520479760、ctimeMs=1792521292343.4016、size=2095846；sha1 仍是 60af5ad1…（内容一字节未动）。

3. 约 0.5 秒内收到 SSE 帧：

   ```json
   {"type":"rebuilt","id":"dsh-mattpocock-skills-deck","rev":"447d62bdd7fd"}
   ```

4. 再把 mtime 拨回原值，又收到一条：

   ```json
   {"type":"rebuilt","id":"dsh-mattpocock-skills-deck","rev":"8873a11aa9c8"}
   ```

   sha1 仍然不变。原因：Windows 上改元数据会把 ctime 推到当前时刻，而 ctime 无法手动拨回，所以版本值不可能回到原值（eff3bbfd11ae）。

**副作用（推理，依据源码与图 #1310 的既有观察）**：面板会按 rebuilt 帧重载本插件——这正是 #1310 里反复闪烁的机制；本次实验期间预期发生了两次这样的重载，本笔记不把界面状态当作直接观察值。文件内容已确认逐字节未变、mtime 已还原、ctime 已无法还原。实验只对 link 安装的本仓产物做，命令与输出可按上面的数值复现；不要拿无关文件重试。

### 3.3 复核：三个版本值都能从元数据原样算回来（2026-10-21 02:40 左右，只读）

**观察**：按 dsh-client-modules/lib/index.js:188-200 的算法，用每一步的 (mtimeMs, ctimeMs, size) 重算，三个值全部对上实验里收到的帧。脚本输出照抄：

```text
initial mtime=1792520462760 ctime=1792520462760.7024 -> eff3bbfd11ae MATCH
step2 mtime=1792520479760 ctime=1792521292343.4016 -> 447d62bdd7fd MATCH
step3/current mtime=1792520462760 ctime=1792521292701.2014 -> 8873a11aa9c8 MATCH
```

第三步的 ctimeMs 是复核时读到的当前值（那次 utimes 之后文件没有再被动过）；实验记录里没有单列这一步的 ctime，这次补上，并且它同样能算回当时收到的 8873a11aa9c8。

**观察**：同一时刻再从运行中的 /plugins/events 读一次 graph 帧（HTTP 200，共 93 个插件行），本插件那一行的 rev 是 8873a11aa9c8，与当前 stat 重算值一致：

```json
{"id":"dsh-mattpocock-skills-deck","url":"plugins/??dsh-mattpocock-skills-deck/client.js&rev=8873a11aa9c8","rev":"8873a11aa9c8","inject":[],"immediately":true}
```

**观察**：同一份文件的 sha1 仍是 60af5ad1a62500b0a72adb75bc6d9c993c10a1ac。

**对照（推理）**：把内容 sha1 当作输入、套同一套 framedHash 算一个对照值，得到 97a0cc7d9792，与运行中的版本值 8873a11aa9c8 不同。这只说明「内容不同、版本值不同」，不是 DSH 的算法；DSH 的算法就是 2.1 那三个元数据。

**由复核得出的事实**：运行中的版本值可以被「三个元数据」完整复现；不能被「内容」复现。

### 3.4 复核之后又发生的一次真实构建（2026-10-21 02:47 左右，只读）

**观察**：复核之后再读时，`package/lib/client.js` 已经被一次真实构建改写过：size=2099243、mtimeMs=1792521928694、ctimeMs=1792521928694.4438、sha1=36262d5cf056424283232a968944d20718bea3e1。按 2.1 的算法重算得 rev=7dab089d1ad3，运行中的 /plugins/events 里本插件那一行也已经是 rev=7dab089d1ad3。

**说明**：这不是本笔记记录的操作（写这份笔记期间没有跑构建），同一工作区里还有别的构建在写这份产物。它正好正面印证第 5 节边界二：一次真实构建必然改写产物元数据，因此必然触发一次重载。上文 3.2、3.3 是按时序记录的事实，各自的数值以标注的时间为准。

## 4 一句话结论

**DSH 对本机 link 安装插件的客户端产物，热更判定只看入口文件的三样元数据——mtimeMs、ctimeMs、size，把三者拼起来算一个 sha1 前 12 位的版本值，每 500 毫秒 stat 轮询一次；内容字节不参与判定。** 所以「文件被碰过」——哪怕只拨了 mtime、内容一字未改——就足以让 DSH 重载这个插件的浏览器 bundle，用户看到的就是面板重挂一次（React 状态丢失）。原样重写同样字节同样会触发，因为 mtime 与 ctime 会变。

## 5 边界与保守做法

**边界一（本仓管不到判定）**：判定发生在 DSH 侧，本仓改不了它按什么比。本仓能控制的只有一件事：产物文件的元数据变不变。

**边界二（真构建必然改元数据）**：**观察**——scripts/build.mts:1645-1660 在把文件复制进 package/lib 等目录之后，会把目录下每个文件的 mtime 统一 touch 到当前时刻，注释写明是为了让「产物新鲜度门禁」（比较产物 mtime 与源 mtime）通过。因此一次真构建必然改 package/lib/client.js 的 mtime，也就必然触发一次重载。缓存命中路径则一个文件都不写：注释写「命中时不写盘：产物一个字节不改、mtime 原样」（scripts/build.mts:237-239），日志也把两条路径分开（scripts/build.mts:2089-2092）。

**边界三（还原 mtime 没用）**：不要用「写同样内容再把 mtime 拨回去」来规避。3.2 第 4 步就是反例：mtime 已拨回原值，版本值仍然从 eff3bbfd11ae 变成了 8873a11aa9c8，因为 ctime 回不去。

**边界四（单项 mtime 没单独验证）**：本机 Windows 上没法只改 mtime 而不改 ctime，所以「单改 mtime 是否足以触发」没有单独验证。能确认的是三者任一变化都会换版本值（源码把三值一起拼进哈希，dsh-client-modules/lib/index.js:194-200），以及本次实验里「只动时间戳、不动内容」确实换来了 rebuilt 帧。

**边界五（只管浏览器 bundle 这条通道）**：宿主侧 dsh-hmr 是另一条通道（身份键不同、不含 ctime，见 2.6），本次未验证它在这个 profile 是否生效；另外包内说明写明「仅负责 Web 传输——Electron 的安装和后端重启流程不使用此 SSE 路径」（dsh-client-hmr/README.zh.md:118）。本次交互所在的 Web 界面地址就是 http://127.0.0.1:54643（运行上下文提供），实验与复核都是在这个地址上读的帧。

**边界六（证据种类）**：本笔记没有引用任何 DSH 日志；结论来自源码原文、一次受控实验、一次只读复核。

**由上面几条直接读出的实现约束（推理，不是方案）**：

- 凡是「命中缓存」的分支，都不要写产物文件、不要改它的 mtime；命中时「什么都不做」才是对的。
- 确实需要写产物时，先用内容比对决定要不要真的写；内容相同就不写。
- 不要用「写完再还原 mtime」当补救，ctime 会留下痕迹（3.2 第 4 步）。
- 面板闪烁的次数与「产物文件被改写的次数」是同一件事，不是两件事。

## 6 旧笔记为何不够用

**先说一处路径纠正**：提示里写的 research/424-refresh-dual-channel-spec.md 在仓里不存在；实际文件在 docs/research/424-refresh-dual-channel-spec.md（:49、:76）。仓里两个研究目录并存：提交 15ce75de（2026-09-04）把根目录 research 并入 docs/research，但此后新笔记仍写在根 research/ 下（例如 research/1047-detection-cost-and-write-facts.md，2026-10-14 加入）。本笔记按近期笔记的位置写在 research/ 下。

逐份说它们回答了什么、没回答什么：

- docs/research/424-refresh-dual-channel-spec.md:49 与 :76：说的是「DSH Desktop 启动后由 dsh-plugin-desktop 显式擦除 loader.internal，故桌面端无 HMR/热更通道——宿主代码变更必须重启桌面；客户端变更刷新页面即可」。它回答的是「宿主代码要不要重启」，没有回答「浏览器 bundle 的重载按什么判定」。它与本次结论不冲突：424 讲的是宿主 Loader 内部注入那条路，本次讲的是 Web 页面上的 client-hmr SSE 通道。
- research/532-dsh-im-update.md:20：「安装完必须手动重启，更新功能自己不重启、不热更新、不刷新页面」。讲的是插件更新流程，不是 DSH 的热更判定。
- research/330-host-persistence.md:44：讲命名守护每 15 秒的常驻节拍，句中的「热重载时先清掉上一代循环」只说明插件内部有常驻定时器，没有说重载由什么触发。
- research/751-attribution.md:36：验收步骤里写「卸载后重启宿主，保证宿主进程重载」，把重载等同于重启，同样没有涉及文件元数据。
- docs/adr/20260827-gate-flake-adversarial.md:28：「需重启 DSH Desktop 进程（host 是 Node vm, client 是 Vite 壳, 无 pnpm dev:web watcher 时无 HMR）」。这句话把 HMR 的有无归到 watcher 上；源码写的是轮询本来就是设计，watcher 只是额外提供 bundle 变化（dsh-client-hmr/lib/index.js:9-17）。所以这句话不能当作「判定依据」的来源。

**一句话**：这些笔记回答的是「有没有热更通道、更新要不要手动重启、插件内部有没有常驻定时器」，没有回答「热更判定看 mtime 还是看内容」；本票要的正是后者。

## 7 附：本次核对过的原文（行号与哈希）

| 文件（asar 内 dsh/node_modules/@deepseek-ai/ 下） | 行数 | 字节数 | SHA-256 前 16 位 |
| --- | --- | --- | --- |
| dsh-client-hmr/lib/index.js | 172 | 5130 | dcc6157a921254b0 |
| dsh-client-hmr/lib/client.js | 316 | 13248 | 697e5273fa6f7ac7 |
| dsh-client-hmr/README.zh.md | 128 | 6630 | b7b696f520b3138f |
| dsh-client-modules/lib/index.js | 1000 | 42376 | d2d89461e1e7f15d |
| dsh-client-modules/lib/client.js | 1019 | 46292 | 426084f8672c26a4 |
| dsh-client-modules/README.zh.md | 151 | 15968 | 4290f59f22039ea4 |
| dsh-hmr/lib/index.js | 1465 | 60934 | 143b445f1b303be8 |
| dsh-hmr/README.zh.md | 129 | 13935 | 5c03a9afa0ac010f |

引用的关键位置：

- dsh-client-modules/lib/index.js：:163（长度常量 12）、:183-191（shortHash/framedHash）、:194-200（artifactRevision 三值）、:202-219（组合路由 URL）、:618-643（rebuilt 与 :630 短路）、:644-653（onRebuilt 注释）、:813-841（基线捕获与启动快照）。
- dsh-client-hmr/lib/index.js：:5（端点）、:9-17（文件头说明）、:22（500 毫秒）、:27-39（bundleStat/sameBundleStat）、:48-62（publish）、:63-78（watchRow）、:79-92（pollWatches）、:93-104（syncWatches）、:105-115（定时器）、:116-139（graph 帧）、:154-161（rebuilt 帧）。
- dsh-client-hmr/lib/client.js：:271-275（帧分派）、:272（sync/reload）。
- dsh-client-modules/lib/client.js：:431-461（reload）、:492-505（replace，含 :501 的 entry.refresh()）。
- 包内说明：dsh-client-modules/README.zh.md:79、:135；dsh-client-hmr/README.zh.md:42、:48、:62、:66、:116、:118；dsh-hmr/README.zh.md:49、:65。
- dsh-hmr/lib/index.js：:416-417、:420-427、:461-472、:1320-1384。
- 本仓：package/package.json:20、scripts/build.mts:237-239、:1645-1660、:2089-2092；旧笔记 docs/research/424-refresh-dual-channel-spec.md:49、:76，research/532-dsh-im-update.md:20，research/330-host-persistence.md:44，research/751-attribution.md:36，docs/adr/20260827-gate-flake-adversarial.md:28。
