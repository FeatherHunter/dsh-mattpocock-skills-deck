# 研究：DSH 插件界面能不能用原生取色盘（input type=color）（#611）

调查票 #611，父图 #610「标签配色可编辑」。本报告只回答一件事：这个环境能不能用浏览器原生的取色盘；能用就直接用，不能用才谈自绘。

一句话结论：**能用。** 插件面板不画在 iframe 里，而是画在 DSH 网页自己的文档里（普通 DOM，没有任何 `sandbox` 属性）；本机实测（Playwright 自带 Chromium、普通文档）点一下 `<input type="color">` 就会弹出 Chromium 自己画的取色盘，取值格式是 `#rrggbb`。所以弹窗里可以直接放原生取色控件，不需要自绘色板。

---

## 0 摘要（先给答案）

| 问题 | 结论 | 依据 |
|---|---|---|
| 面板在什么容器里 | 普通 DOM（DSH 网页自己的文档） | §1：插件 bundle 以同源 `<script>` 进主文档；面板挂到主文档 body 上的 React root |
| 有没有 `sandbox` 属性 | 没有。整条链上没有 HTML 的 `sandbox` 属性 | §1.1；DSH 全量代码里只有两处 iframe，都与面板无关（§1.1 末） |
| 原生取色盘能不能弹 | **能**（本机实测） | §2.2：点击后浏览器窗口的无障碍树里出现色调滑块/色井/红绿蓝通道/颜色提取器，且显示的就是输入框的值 |
| 能不能拿到 `input`/`change` | **未实测**（自动化的点击驱动不了浏览器自己画的取色盘）；事件名按规范是 `input` + `change` | §2.3 |
| 值的格式 | `#rrggbb` 小写六位（实测） | §2.2 |
| `<dialog>` / `showModal()` / popover | 三个都能用（实测） | §4 |
| 要不要沿用 `.dsws-modal` | 不必"必须"，但它是仓库既定路线，应当沿用 | §4 |

---

## 1 插件面板渲染在什么容器里

### 1.1 结论：普通 DOM，不存在 iframe 与 sandbox 属性

证据（四条独立链路，指向同一个结论）：

1. **插件代码怎么到页面里的**：DSH 把插件的客户端 bundle 当成**同源普通 `<script>`** 塞进主文档 head。
   - `@deepseek-ai/dsh-client-modules/lib/client.js:145`「Default bundle-load hook: same-origin external classic script.」
   - 同文件 `:158` `document.head.append(el)`。
   - 同文件 `:170-174`：插件在物化时注入的 `<style>` 由宿主按 `document.querySelectorAll("style:not([data-plugin])")` 认领——也说明插件样式进的就是主文档。
2. **插件自己的样式与查找也是主文档**：
   - `src/seam/style.js:19-22`：`document.createElement('style')` + `document.head.appendChild(styleEl)`（`data-plugin="dsh-mattpocock-skills-deck"`）。
   - `src/client/kernel/slotRenderer-modal-view.js:247`：`document.querySelector('.dsws-modalbox')` 直接在整篇文档里找弹窗。
3. **面板两种打开位置都落在主文档**（`cfg.openIn` 默认值见 `src/client/kernel/config.js:11-14`：装了 dsh-better-sidebar 默认 `sidebar`，否则 `dock`）：
   - `openIn="sidebar"`：面板作为 dsh-better-sidebar 的一个 tab 组件渲染；better-sidebar 把宿主节点直接挂到主文档 body 上，再在这节点上建 React root——本机安装的是 `C:\Users\辰辰洋洋\.dsh\profiles\web\node_modules\dsh-better-sidebar\lib\client.js:18558`（`document.body.appendChild(host)`）与 `:18612-18613`（`document.body.appendChild(host); root = createRoot(host)`）；tab 内容就是普通 React 组件（同文件 `:15084`、`:16517-16520` 是 `createElement(descriptor.component, …)`）。注册入口在 `src/client/kernel/router.js:133-140`（`bs.registerTab({ id: 'deck:map', component: DeckSidebarTab, … })`）。
   - `openIn="dock"`：注册进 DSH 官方 `details` 槽（`src/client/panelAssembly.js:96-98`），槽内容渲染在 DSH 网页自己的 React 树里。
4. **DSH 全量代码里 iframe 只有两处，都不是面板容器**（我按 asar 全量扫了 `lib/**` 与 `node_modules/@deepseek-ai/**`）：
   - 侧栏的文档预览：`@deepseek-ai/dsh-client-ui-sidebar-documentpreview/lib/client.js:2389`（`jsx("iframe", …)`）+ `:2392` `sandbox: "allow-scripts"`。
   - dsh-better-sidebar 自带的 HTML 预览页与浏览器页：`dsh-better-sidebar/lib/client.js:8499` `HTML_IFRAME_SANDBOX = "allow-scripts allow-popups allow-downloads allow-modals"`、`:13243` `BROWSER_IFRAME_SANDBOX = "allow-scripts allow-forms allow-popups allow-downloads allow-modals allow-popups-to-escape-sandbox"`。
   - 其余 `iframe` 字样都是注释或第三方库内部字符串（如 `@deepseek-ai/dsh-client-ui-primitives/lib/index.js:1713` 只是一句讲"跨域 iframe 里 pointerdown 收不到"的注释）。

### 1.2 承载页面的窗口属性（Electron 侧，原文照抄）

DSH 桌面版把 Web GUI 装进一个 `WebContentsView`，`D:\0Tools\DSH Desktop\resources\app.asar` 里 `lib/electron-runtime-C0DyXlWq.js:492-500`：

```js
this.content = new WebContentsView({ webPreferences: {
    preload,
    partition: DESKTOP_RENDERER_SESSION_PARTITION,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    ...platform === "win32" ? { backgroundThrottling: false } : {}
} });
```

窗口创建处另有一份同样的四个开关（同文件 `:1252-1263`：`contextIsolation: true` / `nodeIntegration: false` / `sandbox: true` / `webSecurity: true` / `partition: "dsh-desktop-compatibility-host"`）。本机运行中的渲染器进程命令行里也能看到 `--enable-sandbox`（`Get-CimInstance Win32_Process` 里两个 `--type=renderer` 进程）。

**要把这两件事分清**：这是 Electron 的**渲染器进程沙箱**（Chromium 进程级隔离），不是 HTML 元素上的 `sandbox` 属性。它不拦页面里的原生控件，和 `<input type="color">` 能不能弹没有关系。本机 DSH Desktop 版本 2.0.9，其 Electron 版本 43.3.0（取自 app.asar 根 `package.json` 的 devDependencies）。

---

## 2 原生取色盘：实测

### 2.1 实测怎么做的

- 驱动：仓库 devDependency 里的 `playwright@1.62.1` + 它自带的 `chromium-1234`（`navigator.userAgent` 里是 `Chrome/151.0.0.0`）。
- 被测页面：一个最小静态页（顶层文档、无 iframe、无 sandbox），里面放 `<input type="color" id="c1" value="#112233">`；脚本挂了 `input`/`change` 监听并记录 `document.hasFocus()`。
- 难点与解法：取色盘是 Chromium 自己画的浮层，**既不在页面 DOM 里，也不新开顶层窗口，页面截图里也看不到**。所以判定方式改成枚举"浏览器窗口的无障碍树"（UI Automation）：先枚举一次（这一下会把 Chromium 的无障碍树打开），点击前后各枚举一次，比较元素。

### 2.2 结果：弹得出来

- 点击前：该窗口的无障碍树 37 个元素，没有任何取色盘控件。
- 点击后（同一窗口）：1495 个元素，新增这些控件——**「色调滑块」「色井」「红色通道」「绿色通道」「蓝色通道」「颜色提取器」「格式切换器」**；还有一个文本节点写着 **「红色通道 17, 绿色通道 34, 蓝色通道 51」**，正好等于输入框当时的值 `#112233`。重复跑一次，结果一致。
- 结论：**点色块会弹出原生取色盘**。

三条形态观察（都影响后面怎么写界面）：

1. 取色盘是浏览器在自己窗口里画的浮层：**不新开顶层窗口**、**不吃走页面焦点**（`document.hasFocus()` 仍是 `true`，`window.blur` 没触发）、页面截图里看不到它。所以"没看到新窗口/截图里没有"不能当作"没弹出来"的证据。
2. 只点一下、什么都不改：页面收不到 `input`/`change`（实测 events 为空），输入框的值也不变。
3. 取值与校验可以直接当工具用（实测，普通文档里）：空值默认 `#000000`；赋 `'red'` → `#ff0000`；赋 `'hsl(120, 100%, 25%)'` → `#008000`；赋 `'#ABCDEF'` → `#abcdef`（小写六位）；赋非法串 `'not-a-color'` → 回落 `#000000`。

### 2.3 明确"未实测"的部分

- **`input` / `change` 两个事件没能实测。** Chromium 自己画的取色盘在页面之外，Playwright 驱动不了它。我试过绕道：用 UI Automation 去改「红色通道」的值（两次运行都没等到取色盘在无障碍树里暴露出来），端到端事件没跑通。按 HTML 规范与 MDN 的说法是"拖动过程中连续发 `input`，落定/关闭时发一次 `change`"，但**本票没有实测证据**，落地时请按 §5 自己点一次确认。
- **没在 DSH 自己那个 Electron 窗口里实测。** 没有办法把测试页注入正在运行的窗口（不改仓库产物、也不另起第二个 DSH 实例）。以下是与 Electron 相关的旁证，只能当旁证：
  - `electron/electron#41981`（2024-04，Electron 30.0.1 / Windows 10）：标题是"点取色盘没反应"，实际是 **DevTools 自带的取色盘**坏了；维护者追问"页面上的 color input 呢"，报告人 2024-04-30 回复"**只有 DevTools 有问题，color input 正常**"。
  - `electron/electron#49262`（2025-12，Electron 39.2.7 / Windows 11）：打包后点 `<input type="color"/>` 窗口崩；最后判定是 electron-builder/NSIS 打包方式的机器相关冲突，维护者在 Windows 11 上复现不出来，已关票（不是 Electron 本身的问题）。
- **DSH 的页面地址是 `127.0.0.1`**，按 Chromium 规则算安全上下文；这条是规范结论，不是我在本机 DSH 页面里量到的（我从普通 HTTP 客户端访问 `http://127.0.0.1:43120/` 只拿到 401，没有连接令牌进不去页面）。

---

## 3 原生不可用时的替代形态与成本

只是备选，本票结论是原生可用，所以这一节是"万一以后要在别的宿主里跑"的账。三条路，按代价从小到大：

1. **预设色板 + 手填十六进制**（最小兜底，量级约 60～100 行）
   一排色块按钮 + 一个文本框，文本框用 `/^#?[0-9a-fA-F]{6}$/` 校验后统一成小写六位。
   - 现成的预设色从哪来：仓库已经在用的标签配色就是数据源——`src/client/views/ListTab.js:131` 把后端给的标签色规整成**不带 `#` 的六位串**（`String(l.color).trim().replace(/^#/, '')`），渲染时再拼 `'#' + c`，底色用 `hexA(c, 0.18)`、描边用 `darken(c, 0.16)`（同文件 `:178-201`；`hexA`/`darken` 在 `src/client/kernel/probe-snapshot.js:18`、`:27`，文字色深浅判断 `isLightHex` 在 `src/client/kernel/store-derived.js:205`）。
   - 已知坑：`#` 有无、大小写、三位简写（`#abc`）都要归一；用户手填非法值要即时提示；选不到任意颜色。
2. **自绘取色板 + 色相滑块**（量级约 200～350 行）
   一个饱和度/明度方块 + 一条色相滑块，用 CSS 渐变铺底、用指针事件取坐标换算 HSV/RGB；再配一个十六进制输入框。
   - 已知坑：要 `setPointerCapture`，否则拖出元素就断；面板可以被拖得很窄（现成样式里 `.dsws-panel` 宽 460px、窄屏另有折叠逻辑），方块尺寸要自适应；HSV↔RGB 得自己写或找现成实现；键盘可达性（方向键）要单独做；点面板外关闭要自己处理；最后还有层级问题——自绘浮层要跟 `.dsws-modal` 的 `z-index:10000`（`src/client/kernel/styles.js:67`）以及它上面的提示层（`:70` 的 `.dsws-note`，`z-index:10001`）协调。
3. **吸管取色（EyeDropper API / canvas 取色）**（量级高、收益低，不建议）
   - 本机实测：在**安全上下文**的普通页面里 `window.EyeDropper` 存在（`typeof` 为 `function`）、`navigator.mediaDevices.getDisplayMedia` 也存在；但在 `about:blank` 这种非安全上下文里两者都没有。
   - 但 Electron 仓库里有多条"EyeDropper 在 Electron 里不工作"的报告（`electron/electron#26883`、`#44916`、`#44917`，都已关闭）。**这三条我没有在本机复核**，只在社区报告这一层。
   - canvas 取色只能取"自己画上去的像素"：跨源图片会污染画布导致 `getImageData` 抛异常，也拿不到屏幕像素。要做真吸管只能走 `getDisplayMedia` 截屏，权限与体验都不划算。

---

## 4 同环境的弹层能力，以及 `.dsws-modal` 要不要沿用

- **实测（同一个普通文档）**：`<dialog>.showModal()` 可用——调用后 `dlg.open === true`、`dlg.matches(':modal') === true`（真的进了 top layer）；popover API 可用——`HTMLElement.prototype` 上有 `popover`、`showPopover()` 后 `matches(':popover-open') === true`；`inert` 属性也存在。
- **但仓库已经有现成写法，应当沿用**：遮罩 `.dsws-modal`（`position:fixed; inset:0; z-index:10000`）与居中卡片 `.dsws-modalbox` 定义在 `src/client/kernel/styles.js:67-68`；#587 的更新弹窗明确复用它们（`src/client/views/UpdateDialog.js:7` 的注释与 `:29-30` 的 `className: 'dsws-modal'`／`'dsws-modalbox'`）；`modal-seat` 的挂载点也复用同一套（`src/client/views/ChecksTab.js:171` 注释「复用 .dsws-modal 遮罩」）；表单/向导弹窗同样写成 `.dsws-modal` + `role="dialog" aria-modal="true"`（`src/client/kernel/slotRenderer-modal-view.js:302`、`:336-341`）。
- 所以：**不是技术上"必须"，而是仓库既定路线**。用 `<dialog>` 另起一套会多出重复的遮罩与焦点管理，还和 `modal-seat` 的单例排队语义（`src/client/kernel/slots.js:20`、`slotRenderer-queue.js`）并行两套，不划算。
- 与本票直接相关的一个好处：取色盘由浏览器自己画，**永远盖在页面之上**，不会像自绘浮层那样被 `.dsws-modal` 的 `z-index:10000` 或面板的 `z-index:9999` 压住。

---

## 5 最小验证方法（本机 30 秒复验）

**方法一（人点，最贴近真实场景）** —— 在 DSH 窗口里打开 DevTools（桌面版有开关：`lib/host-process-entry.js:172-174` 的 `toggleDeveloperTools`），Console 里贴：

```js
const i = document.createElement('input');
i.type = 'color';
i.value = '#112233';
i.style.cssText = 'position:fixed;left:40px;top:40px;width:80px;height:40px;z-index:2147483647';
i.addEventListener('input', (e) => console.log('input', e.target.value));
i.addEventListener('change', (e) => console.log('change', e.target.value));
document.body.appendChild(i);
```

点这个色块：应当弹出取色盘（**注意**：它是浏览器自己画的浮层，不会出现在截图里，也不会新开一个窗口）；拖完/关掉之后 Console 会打出 `input` / `change` 与 `#rrggbb` 格式的值。这一段同时补上本票没测到的两个事件。

**方法二（自动化，复现我的实测）** —— 要点只有一个：**先枚举一次那个窗口的无障碍树**（这一下会把 Chromium 的无障碍树打开），再点，再枚举：

1. 用 Playwright 打开任意含 `<input type="color">` 的页面，把浏览器窗口留住不关；
2. 用 `[System.Windows.Automation.AutomationElement]::RootElement` 枚举子窗口，找到标题匹配的浏览器窗口，对它 `FindAll(TreeScope::Descendants, TrueCondition)` 跑一次；
3. `page.click('#c1')`，等 2 秒，再枚举一次；
4. 第二次里应当出现名字为「色调滑块」「色井」「红色通道」「绿色通道」「蓝色通道」「颜色提取器」的元素。

（我本机跑的脚本与结果在临时目录：`%TEMP%\asar611\color-probe2.html`、`%TEMP%\asar611\probe-color3.mjs`、`%TEMP%\asar611\dump-uia.ps1`。这些不在仓库里，属于一次性脚手架。）

---

## 6 还没确定的事（不要当成已验）

1. **在 DSH 自己的 Electron 43.3.0 窗口里没有实测**：本机证明的是"同一引擎、同一类容器（普通文档）里能弹"，Electron 侧只有社区旁证（§2.3）。落地时请按 §5 方法一在真窗口里点一次。
2. **`input` / `change` 的实际触发时机没实测**：拖动过程中是否每次都发 `input`、关闭取色盘时是否一定发一次 `change`，需要靠 §5 方法一确认。
