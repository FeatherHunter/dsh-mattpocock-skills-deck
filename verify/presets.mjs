// verify/presets.mjs —— 三款窗口预设与它们的外框换算，从旧的
// scripts/real-machine/lib/presets.mts 原样平移过来（2026-11-02，票 13 阶段 B1b）。
//
// 为什么这一层还留在插件仓（风险 R4）：base 库的页面检查只回答「页面里发生了什么」，
// 没有「把窗口调成某个尺寸再量」的原语，也没有「真全屏」这个概念。三款预设
// （全屏宽 / 窄窗 / 宽矮窗）是这个插件有头验证的固定覆盖：窄窗要压出面板的窄档，
// 宽矮窗要压出高度折叠档，全屏宽用来给遮挡类结论取证。这些尺寸与换算口径是插件特有的，
// 不能因为换了验证框架就静默丢掉。base 升到 0.1.5 仍未提供这一层，所以数据与纯换算留在
// 这里；真正改窗口、判断真全屏的执行部分在 verify/windows.mjs。
//
// 本文件零依赖（只导出数据与纯函数），也不 import 浏览器库：这样 headless 门禁可以直接
// 测换算，而不用真的开一个窗口。改预设尺寸前先读 tests/verify-windows.ts 里钉住的口径，
// 以及 D:/Temp/matt-t13-analysis.md §4.7 的迁移对照。

/**
 * 三款窗口预设。字段含义与旧文件一致：
 * - window 为 null 表示真全屏（windowState=fullscreen），不是把视口设成屏幕大小；
 * - width / height 里的 "screen" 表示取屏幕对应方向的尺寸；
 * - expectDockNarrow 记录这一档下面板应当落在窄档，有头检查用它判断分支是否真的压到。
 */
export const VIEWPORT_PRESETS = Object.freeze(
  [
    {
      id: "wide",
      label: "全屏宽",
      description: "真全屏；遮挡与被遮住的结论只能在这一档下取",
      window: null,
      expectDockNarrow: false,
    },
    {
      id: "narrow",
      label: "窄窗",
      description: "外框宽 800；面板应落进窄档（约 300–359）",
      window: { width: 800, height: "screen" },
      expectDockNarrow: true,
    },
    {
      id: "short",
      label: "宽矮窗",
      description: "屏幕宽、外框高 600；用来压高度折叠档",
      window: { width: "screen", height: 600 },
      expectDockNarrow: false,
    },
  ].map((preset) => Object.freeze(preset)),
);

/** 按 id 取一款预设。id 不认识就抛错，并把可选 id 列在错误里，别让调用方猜。 */
export function presetById(id) {
  for (const preset of VIEWPORT_PRESETS) {
    if (preset.id === id) return preset;
  }
  throw new Error(
    "未知的窗口预设 " + JSON.stringify(id) + "；可选：" + VIEWPORT_PRESETS.map((preset) => preset.id).join(" / "),
  );
}

/**
 * 把一款预设换算成窗口外框。screen 是屏幕尺寸 {width, height}，必须都是大于 0 的有限数字：
 * 全屏档不需要换算，但仍然先校验屏幕尺寸，避免调用方拿一个坏屏幕去跑有头检查。
 * 返回 {presetId, windowState, width?, height?}；全屏档没有 width / height。
 */
export function resolvePresetWindow(preset, screen) {
  if (preset === null || typeof preset !== "object" || typeof preset.window === "undefined") {
    throw new Error("窗口预设无效：需要 presetById() 返回的对象");
  }
  const width = screen !== null && typeof screen === "object" ? screen.width : undefined;
  const height = screen !== null && typeof screen === "object" ? screen.height : undefined;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error(
      "屏幕尺寸无效：需要 width 与 height 两个大于 0 的有限数字，收到 " + JSON.stringify(screen),
    );
  }
  if (preset.window === null) {
    return { presetId: preset.id, windowState: "fullscreen" };
  }
  const windowWidth = preset.window.width === "screen" ? Math.round(width) : preset.window.width;
  const windowHeight = preset.window.height === "screen" ? Math.round(height) : preset.window.height;
  if (
    !Number.isFinite(windowWidth) ||
    !Number.isFinite(windowHeight) ||
    windowWidth <= 0 ||
    windowHeight <= 0
  ) {
    throw new Error(
      "预设 " + String(preset.id) + " 换算出的窗口尺寸无效：" + String(windowWidth) + "x" + String(windowHeight),
    );
  }
  return { presetId: preset.id, windowState: "normal", width: windowWidth, height: windowHeight };
}

/** 按 id 取预设并换算成窗口外框，是有头检查与门禁共用的入口。 */
export function resolveViewportPreset(id, screen) {
  return resolvePresetWindow(presetById(id), screen);
}
