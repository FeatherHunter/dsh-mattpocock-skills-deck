// presets.mts —— 真机验证的三款窗口尺寸（2026-10-29 定版：只测这三款，其它尺寸不再安排）。
//
// 为什么不按「常见分辨率」枚举：界面里决定布局的只有几处阈值，按分辨率枚举会把同一处分支测很多遍、
// 又漏掉真正会改布局的那一侧。这三款各压一类分支：
//   1. wide   真全屏：宽布局那一侧（桌面右侧面板是独立一列，面板宽本机约 988 像素）。
//   2. narrow 窗口外框宽 800、高铺满屏幕：插件面板落在 300–359 像素、根节点带 .dsws-narrow 的窄态分支。
//   3. short  窗口外框宽铺满屏幕、高 600：面板仍走宽布局，但页面视口只有约 507 像素高，压垂直方向。
//
// 一个反直觉的实测结论（2026-10-29 在 2195x1235 屏幕、设备像素比 1.75 上量的，原始数据见批次证据
// beta32-batch3/s1653/evidence-mapping/mapping-window.json）：窗口宽度与插件面板宽度不是线性的。
// DSH 宿主在窄窗口会把右侧面板从「右列」切成「整宽覆盖」——窗口外框 720 宽时，页面视口 707，
// 面板宽约 707 像素、.dsws-narrow 反而不在场；窗口外框 800 宽时，页面视口 787，面板宽约 331 像素、
// 窄态生效。所以窄窗这一款按「面板分支」定成窗口 800 宽，不按直觉写成 720 宽。
//
// 本文件只有纯数据与纯函数，不 import playwright：门禁可以不起浏览器直接验算，
// 真正改窗口与量尺寸的代码在 lib/browser.mts 的 applyViewportPreset。

/** 三款预设的编号；写进证据与脚本参数的就是这三个词。 */
export type ViewportPresetId = 'wide' | 'narrow' | 'short'

/** 屏幕尺寸，单位是 CSS 像素（page.evaluate 里的 window.screen.width/height）。 */
export interface ViewportScreenSize {
  width: number
  height: number
}

export interface ViewportPreset {
  id: ViewportPresetId
  /** 中文短名，出现在证据与报错里。 */
  label: string
  /** 这一款压的是哪一类分支，写清本机实测值，读证据的人不用再翻脚本。 */
  description: string
  /**
   * 请求的窗口状态。null 表示真全屏；否则是窗口外框的宽高，
   * 'screen' 表示取屏幕对应一边的尺寸（宽度铺满 / 高度铺满）。
   */
  window: { width: number | 'screen'; height: number | 'screen' } | null
  /** 期望插件落在窄态（根节点带 .dsws-narrow）。applyViewportPreset 会核对这一项，对不上直接报错。 */
  expectDockNarrow: boolean
}

/** 三款预设，顺序固定：全屏 → 窄窗 → 宽矮窗。 */
export const VIEWPORT_PRESETS: readonly ViewportPreset[] = [
  {
    id: 'wide',
    label: '全屏宽',
    description: '真全屏；右侧面板走宽布局，压「面板远远宽于窄态阈值、不进入 .dsws-narrow」的一侧（本机 2195x1235 时面板约 988 像素）',
    window: null,
    expectDockNarrow: false,
  },
  {
    id: 'narrow',
    label: '窄窗',
    description: '窗口外框宽 800、高铺满屏幕；压插件面板 300–359 像素的窄态分支（本机实测页面视口 787x1142、面板约 331 像素、.dsws-narrow 生效）',
    window: { width: 800, height: 'screen' },
    expectDockNarrow: true,
  },
  {
    id: 'short',
    label: '宽矮窗',
    description: '窗口外框宽铺满屏幕、高 600；面板仍走宽布局，但页面视口高只有约 507 像素，压垂直方向的分支（本机实测面板约 988 像素）',
    window: { width: 'screen', height: 600 },
    expectDockNarrow: false,
  },
]

/**
 * 按编号取预设；没有这个编号时抛中文错误，并把可选编号列全。
 * 反例：不要写 presetById('medium') 之类的猜测名字，三款之外的尺寸本版不测。
 */
export function presetById(id: string): ViewportPreset {
  const found = VIEWPORT_PRESETS.find((preset) => preset.id === id)
  if (!found) {
    throw new Error('没有名为 ' + id + ' 的窗口尺寸预设；可选：' + VIEWPORT_PRESETS.map((preset) => preset.id).join('、'))
  }
  return found
}

/** CDP Browser.setWindowBounds 认的窗口外框尺寸，或「切真全屏」这一种状态。 */
export type ResolvedWindowBounds =
  | { windowState: 'fullscreen' }
  | { windowState: 'normal'; width: number; height: number }

/**
 * 把预设换算成窗口外框尺寸：'screen' 换成实际屏幕的宽/高，整数化后再交给 CDP。
 * 屏幕尺寸拿不到或不是正数时抛错——宁可让调用方看见「屏幕尺寸不对」，
 * 也不要用 0 宽窗口去量出一个假结论。
 */
export function resolvePresetWindow(preset: ViewportPreset, screen: ViewportScreenSize): ResolvedWindowBounds {
  if (!preset || typeof preset !== 'object') {
    throw new Error('窗口尺寸预设无效：传进来的不是预设对象')
  }
  const screenWidth = Number(screen && screen.width)
  const screenHeight = Number(screen && screen.height)
  if (!Number.isFinite(screenWidth) || screenWidth <= 0 || !Number.isFinite(screenHeight) || screenHeight <= 0) {
    throw new Error(
      '拿不到有效的屏幕尺寸（宽 ' + String(screen && screen.width) + '、高 ' + String(screen && screen.height) +
        '），无法把预设 ' + preset.id + ' 换算成窗口外框尺寸',
    )
  }
  if (!preset.window) return { windowState: 'fullscreen' }
  const width = preset.window.width === 'screen' ? Math.round(screenWidth) : preset.window.width
  const height = preset.window.height === 'screen' ? Math.round(screenHeight) : preset.window.height
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    throw new Error('窗口尺寸预设 ' + preset.id + ' 换算出了非法的窗口尺寸：' + String(width) + 'x' + String(height))
  }
  return { windowState: 'normal', width, height }
}
