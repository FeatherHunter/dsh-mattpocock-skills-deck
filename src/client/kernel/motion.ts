/**
 * src/client/kernel/motion.ts —— 界面动效时长（过渡与动画）的唯一真源（#1236）。
 *
 * 为什么要有这一片：界面上「悬停 120 毫秒」「转一圈 800 毫秒」「骨架呼吸 1.1 秒」这类时长，
 *   以前按用途散在 11 个文件的样式字符串里，共 51 条声明、78 次出现、24 种值。调一次动画要翻全仓；
 *   同一个动作在不同页面会悄悄写成两个数（面板转圈 800 毫秒、详情页内联转圈 1000 毫秒）；
 *   有的文件注释写着「数值从旋钮取」，实际却写死了字面量。开票时（2026-10-16）是 42 处、8 个文件，
 *   到 2026-10-28 复核已经是 51 条声明行、11 个文件——没有门禁时它会持续长回来。
 *
 * 怎么用：样式字符串里写
 *   'transition:background ' + MOTION.hoverFadeMs + 'ms ease'
 * 内联样式的 JS 字符串同样拼这个毫秒数。不要在这里放缓动函数、关键帧名、颜色或位移量：
 *   本文件只回答「多久」，形状与颜色各归各的样式叶子。
 *
 * 命名：键名按「这个时长是做什么用的」命名，统一以 Ms 结尾，值是整数毫秒；同一个数值如果用在
 *   两件不同的事上，就各起一个名字（例如 spinMs 与 inlineSpinnerMs 都是转圈，但改造前就是
 *   两个数，先按原值保留）。这样调参的人按用途找得到，而不是先猜数值。
 *   每个分组的行尾注释都写清了用途：写「过渡」「淡入淡出」「迁移」的是一次性 transition；
 *   写「呼吸」「轮播」「微光」「闪烁」并配 infinite 关键帧的是循环 animation。哪个动画配哪个
 *   关键帧仍写在样式叶子里，这里只回答「多久」。
 *
 * 为什么不是 config/ 下的 YAML：见 docs/adr/20261021-config-ownership.md。这些值由写界面代码的人改，
 *   客户端又是构建产物、运行期读不到数据文件；做成 YAML 会凭空多出「真源 + 生成物」两份会漂的拷贝，
 *   还丢掉 TypeScript 的类型与跳转。所以真源留在 TypeScript 里，靠这道门禁保证没有第二处。
 *
 * 契约（与仓库其它内核片同一套）：模块真源是 ESM 导出，构建时剥掉行首 export 拼进 apply 闭包；
 *   运行时不许跨文件 import；不许 export default；只写可剥离的 TypeScript。
 *   拼接次序：kernel:motion 必须排在 kernel:styles 之前（样式字符串在模块求值时就要取值，const 有暂时性死区）。
 *
 * 门禁：tests/verify-motion-tokens.ts。它守五件事：MOTION 的形状、每个键都被引用且引用名都有定义、
 *   全仓只有这一份定义、构建与内核档案确实登记了它（且每个读 MOTION 的模块都排在它后面）、
 *   src/client 下（本文件除外）任何一行同时出现 transition/animation 关键字与写死的时长就判红。
 *   写死的时长有三种形态都算（.12s、' + 200 + 'ms'、i + 's'）；真要留一处，必须去门禁的 EXEMPTS
 *   表登记文件、片段与理由。改这里之后要跑 npm run verify:parallel。
 */
export const MOTION = {
  // ---- 面板外壳与通用交互 ----
  tabFoldMs: 250, // 页签文字折叠/展开：max-width、margin 与内边距一起走
  tabFoldFadeMs: 200, // 同一次折叠里的透明度
  hoverFadeMs: 120, // 通用悬停与按下的淡入淡出（分隔条、+N 药丸、开关芯片、弹窗单选、入口卡、通用按压反馈）
  toggleMs: 150, // 设置页开关：轨道底色/描边与圆钮位移
  spinMs: 800, // 面板里的小转圈（.dsws-spinner 与 .dsws-spin）
  inlineSpinnerMs: 1000, // 详情页与拉取请求页的内联转圈；改造前它和 spinMs 就是两个值，这里照原样保留
  rowFlashMs: 2400, // 变更行与新增行的黄绿闪光
  vcShimmerMs: 1400, // 版本管理页骨架条的微光

  // ---- 交互反馈（#948 三批） ----
  rippleMs: 550, // 主按钮按下时的水波纹
  ringOutMs: 600, // ghost 按钮按下时的内画外扩环
  sheenMs: 500, // 弹窗主按钮按下时掠过的一道高光
  flashMs: 450, // 成功/失败/警告三种结果闪光
  shakeMs: 400, // 失败结果的抖动
  dotsMs: 900, // 等待三个圆点的呼吸周期
  dotsStaggerMs: 150, // 三个圆点依次错开的时间；第三颗是它的两倍（保持改造前 300 毫秒）
  breathMs: 1600, // 等待文案的呼吸
  successRingMs: 600, // 成功圈的外扩
  popMs: 350, // 结果数字的弹一下
  skeletonShimmerMs: 1100, // 面板列表骨架的微光扫过
  inkMoveMs: 240, // 选中块迁移时墨块的位移
  inkResizeMs: 160, // 墨块宽高变化（只在换行或折叠时发生）
  inkFadeMs: 120, // 墨块淡入淡出
  inkSquashMs: 300, // 墨块落定时的拉伸回弹
  pressDipMs: 80, // 通用按压下沉

  // ---- 地图详情与像素皮肤 ----
  progressFillMs: 200, // 地图详情进度条宽度变化
  busyStripesMs: 900, // 取数中进度条上的流动斜纹
  pixelPressMs: 120, // 像素按钮/卡片按下时的位移与投影
  pixelBlinkMs: 600, // 像素加载方块的闪烁
  pixelStatusCycleMs: 3000, // 像素状态行三句轮播一轮
  pixelStatusStepMs: 1000, // 像素状态行里每句往后错开的步长（三句轮播一轮 = 3 步）
  pixelSkeletonMs: 1000, // 像素骨架方块的闪烁
  pixelResultFlashMs: 500, // 像素成功/失败的底色一闪
  pixelShakeMs: 400, // 像素失败抖动

  // ---- 「下一步建议」气泡：原来在 suggestAppearance.ts 里，随 #1236 并入这一处 ----
  suggestBubbleDelayMaxMs: 560, // 出场：每颗小泡的出发延迟上限
  suggestBubbleTravelMinMs: 500, // 出场：飞行时长下限
  suggestBubbleTravelMaxMs: 1030, // 出场：飞行时长上限
  suggestBubbleCleanupDelayMs: 400, // 出场：全部落完后清掉小泡节点前的等待
  suggestPickBubbleDelayMaxMs: 70, // 退场：每颗小泡的出发延迟上限
  suggestPickBubbleTravelMinMs: 400, // 退场：飞行时长下限
  suggestPickBubbleTravelMaxMs: 500, // 退场：飞行时长上限
  suggestPickBubbleTailMs: 60, // 退场：最后一颗飘完后到收起整组的余量
  suggestFadeMs: 170, // 关闭或被覆盖时整组淡出
  suggestPillMs: 140, // 选项药丸悬停的底色/描边/阴影过渡
  suggestPopMs: 120, // 悬停浮层的透明度与位移过渡
  suggestCloseMs: 120, // 关闭按钮的透明度与底色过渡

  // ---- 系统要求减少动态效果时 ----
  motionOffMs: 1, // 把动画压到几乎为零的一毫秒（suggestStyles 的 reduced-motion 分支）
}
