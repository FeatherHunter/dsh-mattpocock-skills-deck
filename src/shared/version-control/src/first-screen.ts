/**
 * src/shared/version-control/src/first-screen.ts —— 首屏一次取全的契约（#1739 T04）
 *
 * 规格 #1586 第 9 节的原句：首屏取数一次拿全（工作区状态、改动、提交历史首页、工作树、贮藏、
 * 同步带、版本与能力开关），各自失败互不影响，失败项单独显示失败态；不做「先给半份再慢慢补」。
 *
 * 本文件只定契约与纯判定，不读磁盘、不起进程、不 import 任何文件（共享层禁止层内互引：
 * .dependency-cruiser.ts 的 same-layer-import-shared，存量基线只许减不许增）。宿主侧聚合一电话
 * 与客户端数据层各自从这一份常量与判定出发，谁都不许在别处再抄一份片名、片数或版本号。
 *
 * 为什么带版本字段：快照会被存进缓存、跨刷新使用，也会被后续票（改动页 / 历史页 / 贮藏页）
 * 各自消费；片名或片形状一改，旧缓存必须能被认出来。界面只认 FIRST_SCREEN_VERSION 这一版，
 * 遇到别的版本按「读不到」处理（落 shape 失败、给重试），绝不拿旧形状硬画。
 *
 * 七片的顺序就是规格原句的书写顺序，快照里的键集合必须恰好是这七片 —— 想加第八片先升版本，
 * 不许悄悄塞进来（firstScreenShapeOk 会判红）。
 */

/** 快照契约名：客户端与宿主对暗号用的第一道字段。 */
export const FIRST_SCREEN_CONTRACT = 'version-control.first-screen'

/** 契约版本：片名、片形状或片语义一变就加一；界面只认这一版。 */
export const FIRST_SCREEN_VERSION = 2

/** 七片的能力 id（规格第 9 节原句的顺序）。 */
export const FIRST_SCREEN_SLICES: string[] = ['workspace', 'changes', 'history', 'worktrees', 'stashes', 'sync', 'version']

/** 七片的中文名（报错、悬停与门禁的人话；不是界面主文案，界面文案走词条）。 */
export const FIRST_SCREEN_SLICE_LABELS: Record<string, string> = {
  workspace: '工作区状态',
  changes: '改动',
  history: '提交历史首页',
  worktrees: '工作树',
  stashes: '贮藏',
  sync: '同步带',
  version: '版本与能力开关',
}

/**
 * 刷新三时机（规格第 9 节与票面验收④）：进入页面、任务完成后、手动刷新。
 * 客户端数据层按这三个名字各给一个入口，三个入口都只做同一件事 —— 发一次聚合一电话；
 * 除此之外没有第四个刷新路径（门禁按这份清单断言，防以后有人另开一条只刷半张的捷径）。
 */
export const FIRST_SCREEN_REFRESH_MOMENTS: string[] = ['enter', 'task-done', 'manual']

/** 一片的失败形状：kind 与 message 都从宿主失败信封原样带过来，客户端只翻词条、不改写。 */
export interface FirstScreenSliceError {
  kind: string
  message: string
}

/** 一片：要么 ok 带 data，要么 err 带 error；data 在 err 时可以是 null（客户端保旧值由自己决定）。 */
export interface FirstScreenSlice {
  state: 'ok' | 'err'
  data: any
  error: FirstScreenSliceError | null
}

/** 一次聚合读取回来的版本化快照：七片各带自己的成败，整张快照不受单片失败影响。 */
export interface FirstScreenSnapshot {
  contract: string
  version: number
  readAtMs: number
  slices: Record<string, FirstScreenSlice>
}

function isPlainObject(x: any): boolean {
  return !!x && typeof x === 'object' && !Array.isArray(x)
}

/** 把任意来源的失败归一成一片的失败形状；kind 缺省 unknown，绝不把 undefined 画到界面上。 */
export function firstScreenSliceErrorOf(kind: any, message: any): FirstScreenSliceError {
  const k = String(kind === null || kind === undefined || kind === '' ? 'unknown' : kind)
  return { kind: k, message: String(message === null || message === undefined ? '' : message) }
}

/** 契约与版本是否对得上（界面认版本的第一道判据）。 */
export function firstScreenVersionOk(snapshot: any): boolean {
  return isPlainObject(snapshot) && snapshot.contract === FIRST_SCREEN_CONTRACT && snapshot.version === FIRST_SCREEN_VERSION
}

/**
 * 快照形状判据（客户端拿它挡坏回包）。
 * 为什么逐字段判而不是只判真假值：字符串、数组、数字、空对象都是真值，放过去以后界面会把
 * 「读不到」画成「工作树空、没有改动、没有提交、没有贮藏」—— 正是规格里最要避免的假装完整。
 * 判据：契约与版本对、readAtMs 是有限数、slices 恰好是那七个键、每片 state 只能是 ok/err，
 * ok 片带 data、err 片带 error（kind 与 message 都是字符串）。
 */
export function firstScreenShapeOk(snapshot: any): boolean {
  if (!firstScreenVersionOk(snapshot)) return false
  if (typeof snapshot.readAtMs !== 'number' || !isFinite(snapshot.readAtMs)) return false
  if (!isPlainObject(snapshot.slices)) return false
  const keys = Object.keys(snapshot.slices).slice().sort()
  const want = FIRST_SCREEN_SLICES.slice().sort()
  if (keys.length !== want.length) return false
  for (let i = 0; i < want.length; i += 1) if (keys[i] !== want[i]) return false
  for (let i = 0; i < FIRST_SCREEN_SLICES.length; i += 1) {
    const slice = snapshot.slices[FIRST_SCREEN_SLICES[i]]
    if (!isPlainObject(slice)) return false
    if (slice.state === 'ok') {
      if (slice.data === null || slice.data === undefined) return false
      if (slice.error !== null && slice.error !== undefined) return false
    } else if (slice.state === 'err') {
      if (!isPlainObject(slice.error)) return false
      if (typeof slice.error.kind !== 'string' || slice.error.kind === '') return false
      if (typeof slice.error.message !== 'string') return false
    } else {
      return false
    }
  }
  return true
}

/** 取一片；id 不认识或形状不对时回 null（调用方据此画空态，不猜）。 */
export function firstScreenSliceOf(snapshot: any, id: any): FirstScreenSlice | null {
  if (!firstScreenShapeOk(snapshot)) return null
  const key = String(id === null || id === undefined ? '' : id)
  if (FIRST_SCREEN_SLICES.indexOf(key) < 0) return null
  return snapshot.slices[key]
}

/** 读失败的那几片的 id（界面逐片画失败态与重试入口就用这一份）。 */
export function firstScreenFailedSlices(snapshot: any): string[] {
  if (!firstScreenShapeOk(snapshot)) return []
  const out: string[] = []
  for (let i = 0; i < FIRST_SCREEN_SLICES.length; i += 1) {
    const id = FIRST_SCREEN_SLICES[i]
    if (snapshot.slices[id].state === 'err') out.push(id)
  }
  return out
}

/** 读成功的那几片的 id（单片失败不阻塞整页：有这一份就能先画能画的）。 */
export function firstScreenOkSlices(snapshot: any): string[] {
  if (!firstScreenShapeOk(snapshot)) return []
  const out: string[] = []
  for (let i = 0; i < FIRST_SCREEN_SLICES.length; i += 1) {
    const id = FIRST_SCREEN_SLICES[i]
    if (snapshot.slices[id].state === 'ok') out.push(id)
  }
  return out
}

/** 七片全 ok 才算完整；有一片 err 就是「部分可用」——界面照画能画的，失败片单独说。 */
export function firstScreenIsComplete(snapshot: any): boolean {
  return firstScreenShapeOk(snapshot) && firstScreenFailedSlices(snapshot).length === 0
}

/** 有成功片也有失败片：这一档最需要逐片失败态（既不是全好，也不是全坏）。 */
export function firstScreenIsPartial(snapshot: any): boolean {
  if (!firstScreenShapeOk(snapshot)) return false
  const failed = firstScreenFailedSlices(snapshot).length
  return failed > 0 && failed < FIRST_SCREEN_SLICES.length
}

/** 刷新时机的说明句：未知时机回空串（不编第零种时机）。 */
export function firstScreenRefreshNoteOf(moment: any): string {
  const key = String(moment === null || moment === undefined ? '' : moment)
  if (key === 'enter') return '进入页面时读一次'
  if (key === 'task-done') return '任务完成后重读一次'
  if (key === 'manual') return '手动刷新时重读一次'
  return ''
}

/** 门禁按这一行找真源（与共享层其他 *_SOURCE 同一口径）。 */
export const FIRST_SCREEN_SOURCE = 'src/shared/version-control/src/first-screen.ts'
