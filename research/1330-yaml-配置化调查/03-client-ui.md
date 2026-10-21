# 客户端界面 YAML 化候选调查（第三片）

- 范围：`src/client/**`（跳过生成物 `src/client/kernel/locale-data.ts`）、`src/shared/ui/**`、`src/shared/label-color/**`。
- 方法：只读调查，没有改任何代码。统计命令是只读检索（`grep` / `Select-String` / `read`），完整命令见第 8 节。
- 结论口径与其它三份报告一致：强候选是策略、参数、词条、清单这类取值；中候选是形态同构但搬进 YAML 会丢类型安全；不适合是承载逻辑或收益低于成本。

## 1. 界面文案迁移完成度：基本迁完，残留是个位数

界面文案的主干已经走完 YAML 化。`config/copy/*.yaml` 放界面词条，`config/prompts/*.yaml` 放提示词模板，
`scripts/generate-locale-config.mts:1-119` 在构建时把它们拼成 `src/client/kernel/locale-data.ts`，
界面代码里一律用 `tr('list.state.open')` 这类词条键取值（例如 `src/client/views/ListTab.ts:428` 用
`tr('list.state.' + k)` 驱动五个状态筛选项，`src/client/views/IssueDetail.ts:238` 用
`tr('list.state.open' / 'list.state.merged' / 'list.state.closed')` 显示票的状态）。

数量级（统计口径见第 8 节）：`src/client` 下约 176 个手写 `.ts` 文件；
含中文字符的行约 5400 行，但这个数字把注释、日志、已被 `tr()` 包裹的行全算进去了，是上限而非实际残留。
逐行核实后，真正渲染给用户看、却没有进词表的硬编码文案只有个位数文件、约十处，集中在三处：

1. `src/client/views/IssueDetailComments.ts:87`：`'评论 · '` 前缀是手写拼接，只有后面的状态走了词表。
2. `src/client/views/IssueDetailComments.ts:104`：`'加载中…'`，同一文件别处加载中用的是 `tr('list.loading')`（如第 460 行附近的用法），属于同一意思两份写法。
3. `src/client/views/IssueDetailComments.ts:126`：`'加载中' / '重试' / '加载下 50'` 三个按钮文案全手写；同文件第 143 行还有 `'加载失败，可重试'`。
4. `src/client/views/shared/BackendSelector.ts:97`：`'检测到多个可用后端：' + … + ' — 建议显式绑定'` 整句手写，是多后端命中时的提示。
5. `src/client/views/NoRepoCard.ts:319` 附近用变量 `titleText` 画标题，标题来源本轮没有逐行追完（见第 9 节）。

分布规律：列表页（`ListTab.ts`）、行渲染（`ListTabRow.ts`）、详情页（`IssueDetail.ts`、`MapDetail.ts`）、
状态栏（`StatusBar.ts`、`StatusLogMenu.ts`）基本迁完，连无障碍标签（`aria-label`）都走了词表
（例如 `ListTab.ts:370` 的 `tr('list.filterRemoveAria', { name })`）。
残留只在评论区、后端选择器这类边缘浮层里。也就是说「视图骨架已迁完，浮层边角没收尾」。

## 2. 颜色与主题：身份色表与状态色是最大的一块

### 2.1 容器身份色（强候选，中央色表只有一处）

`src/client/kernel/container-view.ts:32-34` 定义了两种容器的身份色与行底色。
容器是指能装子票的票，现在有两种：探索地图（紫）与规格（蓝）：

```ts
export const CONTAINER_ACCENT: any = { map: '#c084fc', spec: '#1D4ED8' };
export const CONTAINER_TINT: any = { map: 'rgba(188,140,255,.07)', spec: 'rgba(29,78,216,.10)' };
```

同文件第 36-43 行还有角标样式类、角标词条键、三态用的空态橙 `#f59e0b` 与完成绿 `#3fb950`。
消费点：`ListTabRow.ts:212-229` 的 `accentOf / tintOf / chipClassOf / chipLabelKeyOf` 四个函数、
`IssueDetail.ts:237` 的状态色、`StatusBar.ts:325` 的接管色。
`ListTabRow.ts` 里每个函数都带了字面量兜底（例如取不到就回落到 `'rgba(188,140,255,.07)'`），
这是第二份真源，改颜色要改两处。
建议的 YAML 形状（新建 `config/ui-colors.yaml`，构建期生成）：

```yaml
containerAccent:
  map: '#c084fc'
  spec: '#1D4ED8'
containerTint:
  map: 'rgba(188,140,255,.07)'
  spec: 'rgba(29,78,216,.10)'
containerState:
  empty: '#f59e0b'
  done: '#3fb950'
```

迁移代价：中等。生成器要支持新形态（色表不是词条，不能走现有词表管线，需要给
`generate-locale-config.mts` 加一段或另起一个小的生成脚本），产物拼进界面闭包，
门禁要加一条「兜底字面量与 YAML 一致」检查（否则两份真源继续漂移）。
风险：`styles.ts:69-71` 的注释写明规格蓝在深色面板上对比度只有 2.6:1，
角标字被迫用同色系浅蓝 `#93c5df`。颜色不是孤立值，是和用法规定的配对，
YAML 化时要把「底色配什么字色」记成一对令牌，不能只搬六位色号，否则以后只改一半会出看不清的字。

### 2.2 状态色散点（强候选，语义令牌）

成功绿 `#3fb950`、警告橙 `#f59e0b`、错误红 `#f87171`、信息蓝 `#58a6ff` 直接写在约 15 个视图文件里
（`IssueDetail.ts:237,426`、`MapDetail.ts:248,252,312,332`、`ListTabRow.ts:164,261,265`、
`StatusLogMenu.ts:291`、`Dock.ts:255,257` 等）。同一个绿色在三态完成、状态圆点、进度条里各写一遍。
建议收成四个语义令牌（`success / warning / danger / info`），与上面的容器色放同一个 YAML 文件。
这是典型的策略取值：人要换主题只改一处。走构建期生成，代价小（纯替换），
风险是有人把色值当逻辑用（例如 `tone()` 函数按 `'red' / 'yellow'` 字符串分支），
搬的时候只搬色值、不搬分支名，或者把分支名也收进 YAML 做字符串枚举加校验。

### 2.3 标签配色默认值（推测：不在本片范围内，需向宿主侧确认）

`src/shared/label-color/src/colors.ts:1-104` 只有归一化、合法性判断、比较逻辑，
没有默认色表。文件头注释明确说「同族的默认色表有五处」，但那五处不在本次调查范围内，
本次在 `src/client` 与 `src/shared/ui`、`src/shared/label-color` 里没有找到默认色板定义。
推测标签默认色存在宿主侧或契约层，还缺的证据是宿主侧色表位置。结论是本片没有可搬的标签默认色，
不要为了凑数把校验逻辑搬进 YAML。

### 2.4 芯片样式（中候选）

`src/client/kernel/styles.ts:63-73` 的 `.dsws-chip-r/p/g/t/m/s/i` 七个类把背景与字色写死。
它们与 2.1、2.2 是同一批颜色的第三份写法。形态是 CSS 字符串，不是键值对，
生成器要先支持「颜色令牌拼成 CSS」才搬得动。建议与 2.1 同一批做，先立令牌再套进 CSS，
不要直接把整段 CSS 搬进 YAML（整段 CSS 搬进去等于换个地方写代码）。

## 3. 布局尺寸常量：面板几何是中候选

`src/client/kernel/styles.ts:31` 把面板几何写死：`left:16px;top:76px;width:460px`，
行高、字号、圆角、间距散落在同一文件 357 行里（例如页签 `padding:4px 10px;font-size:12px`）。
面板是否可缩放、缩放后尺寸存哪，本轮没有查到（`panelAssembly.ts` 有缩放手柄样式 `.dsws-rz-*`，
但持久化位置未确认，见第 9 节）。如果尺寸只是静态默认值，走构建期生成即可，
YAML 形状就是 `panel: { width: 460, top: 76, left: 16 }`；如果用户能拖动缩放，
那运行期值存在状态里，YAML 只管默认值。代价中等（改样式生成管线），
风险是样式文件手写了 357 行、注释比代码多，直接生成会丢注释里的决策记录（如 #670 的由来）。
建议：只把数字抽成令牌，注释留在代码里。

## 4. 动画与延时：中央时间参数已收完，剩的是 CSS 与零延时

时间参数是全仓 YAML 化最彻底的一块。`config/timeouts.yaml`、`config/intervals.yaml`、`config/ttl.yaml`
由生成器写出 `src/shared/time-config/src/values.ts`（文件头写明人手不改），
`scripts/build.mts:1803-1872` 的 `CLIENT_TIME_NAMES` 名单一共 60 个名字，
构建时从产物里摘出对应行拼进界面闭包（`scripts/build.mts:1873-1890`），
`tests/verify-time-config.ts` 看守「名单与消费点一一对应」。
界面里 `setTimeout(..., COPY_FLASH_MS)` 这类调用全都引用拼进来的常量，没有第二份数字。

还剩三类没进 YAML，但都不值得搬（详见第 7 节）：一是 CSS 过渡 `.25s ease`
（`styles.ts:37` 等），二是 `setTimeout(run, 0)` 与 `requestAnimationFrame` 降级这类零延时调度，
三是注释里提到的历史数字（如「至少转 2 秒」旁边的 `CLIENT_HANDOFF_DELAY_MS` 其值已在 YAML 里）。
结论是延时这一类没有新的强候选。

## 5. 交互契约：排序筛选枚举与三态表是强候选，图标与快捷键不是

### 5.1 列表页状态筛选与排序键（强候选）

`src/client/views/ListTab.ts:424` 把五个状态筛选项写成数组字面量
`['all', 'open', 'closed', 'blocked', 'frontier']`，第 431 行把四个排序键写成
`['updatedAt', 'createdAt', 'number', 'title']`，显示文案已经是 `tr('list.state.' + k)` /
`tr('list.sort.' + k)` 动态取值。数组本身是清单型取值，人要加一档筛选不用改代码逻辑，
只改清单与词条。建议的 YAML 形状（新建 `config/ui-views.yaml`）：

```yaml
listTab:
  stateFilters: [all, open, closed, blocked, frontier]
  sortKeys: [updatedAt, createdAt, number, title]
  defaultSort: { key: updatedAt, dir: desc }
```

走构建期生成，生成器改动小（字符串数组是最容易支持的形态），门禁加一条
「词条键 `list.state.*` 与清单一一对应」。风险低，类型安全可用字符串枚举加运行时校验兜底。
注意排序比较逻辑（`ListTab.ts:193-208` 按键分数字、标题、默认三路比较）是算法，不能搬。

### 5.2 容器三态按钮表（强候选）

`src/client/kernel/container-view.ts:70-79` 的 `containerTriState` 函数本质是一张纯数据表：
按容器种类与三态返回词条键、按钮底色、图标名、悬停提示词条键。
除了分支判断外没有逻辑，建议搬成 YAML 数据表，分支收敛到一个按两维查表的小函数。
词条键（如 `act.inspect`、`map.doneTitle`）本来就在 `config/copy` 里，YAML 里存键名即可，
类型安全损失小。代价小，风险是图标名变成字符串后拼写错误要到运行时才暴露，
需要门禁校验图标名在 `icons.ts` 的清单里存在。

### 5.3 页签与面板装配（中候选）

页签结构在 `src/client/views/shared/Tabs.ts:89-94`（地图、缺陷等页签与图标），
面板装配在 `src/client/panelAssembly.ts:157-160`（图标函数与引导标题）。
页签的顺序、显隐是产品策略，形态同构，适合 YAML 清单。但页签的渲染函数（图标、点击行为）是逻辑，
YAML 只能管「有哪些页签、什么顺序」，管不了行为。结论是中候选：先搬清单，行为留代码。

### 5.4 图标名（不适合搬，但清单值得被门禁看守）

`src/client/kernel/icons.ts` 约 40 个 `case 'map' / 'check' / 'lock' …`，
每个名字背后是一段 SVG 路径。名字是逻辑的键，不是策略取值，搬进 YAML 后图标定义还是要在代码里，
多一层间接没有收益。保持现状，但建议门禁核对「YAML 里引用的图标名都在 `icons.ts` 存在」
（5.2 落地时顺带做）。

### 5.5 快捷键与键盘处理（不适合搬）

`src/client` 里约 335 行提到键盘事件（`ctrlKey/metaKey/shiftKey/Escape/Enter`），
集中在 `StatusLogMenu.ts:148-154` 的 Esc 关闭、点击外部关闭。
这些是交互行为逻辑，不是取值。且本插件没有自定义快捷键体系（没有发现快捷键注册表），
无清单可搬。结论是不适合。

## 6. 界面与宿主的接线常量：名是契约，不适合 YAML 化

### 6.1 宿主调用名 `wf.*`（不适合）

界面经 `host.call('wf.xxx', …)` 调用宿主（例如 `src/client/kernel/api-handoff.ts:83,86,93` 的
`wf.handoffResolve / wf.handoffLatest`）。本轮扫出约 37 个名字：
`wf.bind / wf.chain / wf.snapshot / wf.probe / wf.refresh / wf.status / wf.logBatch / …` 等。
这些名字是界面与宿主两端的共同契约，改一个字符两端一起断。
放进 YAML 会制造「第三份真源」， drift 风险高于收益。保持代码即契约，
已有 `docs/architecture/kernel-contract.md` 接口冻结清单看守。结论是不适合。

### 6.2 槽位五端口定义（不适合）

`src/shared/ui/slots.ts:32-55` 定义五端口（`banner-seat / dock-seat / statusbar-seat / modal-seat / toast-seat`），
`src/client/kernel/slots.ts:13-19` 冗余一份零依赖声明供宿主预检。
顺序（`order`）、作用域（`scope`）、父槽归属是治理规则（依据 ADR #221 与 #308），
`orderOf` 越权返回 999、`canDeclareIn` 只认三个父槽都是安全判据，不是策略参数。
结论是不适合。两处冗余声明由注释标明了同源关系，保持现状即可。

### 6.3 本地存储键（不适合）

`dsws.templates`（`config.ts:16`）等本地存储键是数据迁移兼容点，改名会丢用户存量。
键名短、消费点单一，不适合 YAML 化。

## 7. 机制约束结论：凡本节候选一律走构建期生成

客户端界面是构建产物：界面闭包在构建时由 `scripts/build.mts` 拼装，
运行期不能读文件。已有的两条路都已铺好：

- 词条类走现有管线：`config/copy/*.yaml` 经 `generate-locale-config.mts` 生成 `locale-data.ts`，
  再拼进闭包。第 1 节的残留文案、第 5.1 节的筛选项文案直接适用，加词条、加生成器分支都不用大改。
- 时间参数类走 `CLIENT_TIME_NAMES` 摘取管线：`scripts/build.mts:1803-1890` 从中央时间产物里按名摘行拼进闭包，
  加名字只改名单一行，`tests/verify-time-config.ts` 自动看守对应关系。

运行期经宿主读盘这条路在本片不成立：界面侧已有经宿主通道的只有数据请求
（`host.call('wf.*')`），没有读配置文件的通道；为几个颜色新开一条宿主配置通道，
要改宿主、协议、缓存、降级，成本远超把色值烘进闭包。
唯一的例外是用户可调的主题：如果以后要做「用户自选主题」，那才需要运行期通道，
本次候选全是内置默认值，走构建期生成即可。

## 8. 统计口径与命令

- 文件范围：`src/client/**/*.ts` 约 176 个文件（生成物 `locale-data.ts` 除外），
  加 `src/shared/ui/slots.ts`、`src/shared/label-color/src/*.ts`。
- 文案完成度：`Select-String -Path src/client/*.ts,src/client/**/*.ts -Pattern "['\"\`][^'\"`]*[一-鿿]"`
  先圈出含中文字符串的行（约 5400 行，含注释与已 `tr()` 化行），再人工排除注释、日志、已迁行，
  剩余渲染用硬编码约十处（第 1 节逐条列出文件行号）。
- 颜色：`#` 开头六位色号散点约 20 处文件（`IssueDetail.ts:237` 等为例）。
- 延时：`CLIENT_TIME_NAMES` 共 60 个名字（`scripts/build.mts:1803-1872`），消费点全引用拼入常量，
  无裸数字；CSS 过渡时长（`.25s`）与 `setTimeout(..., 0)` 另计，不属可调参数。
- 接线：`wf.[A-Za-z]+` 去重约 37 个宿主调用名；槽位 5 个加父槽 3 个。

## 9. 没查清的，需要别人确认

1. 标签默认色表的位置：`colors.ts` 头注释说同族默认色表有五处，本片范围内没找到。宿主侧还是契约层？请熟悉宿主侧的人指位置。
2. `NoRepoCard.ts:319` 的 `titleText` 来源没有逐行追完，不能断言它是硬编码还是词表输出。
3. 面板尺寸用户能否拖动缩放、缩放后存哪：`panelAssembly.ts` 有缩放手柄样式，持久化位置本轮没查到，影响第 3 节 YAML 只管默认值还是要管运行期。
4. 图标清单的确切数量：`icons.ts` 本轮只读到部分 `case` 行，「约 40 个」是估计数，5.2 的门禁要以实际清单为准。
5. `config/copy/*.yaml` 的确切词条数没有数（只读了生成器与消费侧），「残留约十处 vs 词表总数」的比例分母缺失，完成度百分比写不出，只能给分子。
