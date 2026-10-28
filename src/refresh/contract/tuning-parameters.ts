/**
 * 共用调参表：refresh 链上三个可调数的唯一存放处（只搬运、不统一数值）。
 *
 * 为什么要有这张表：这三个数以前散在宿主层各文件里，改一个数要改几处（300000 那对
 * 孪生子就是现成证据）。表只能放共用层：宿主层文件之间不许互相引用，闸去引宿主层
 * 的表会被门禁打回来；表也不落用户电脑，不和工作区选择文件混用。位置是维护者拍板
 * 的（#1069 评论，2026-10-15）。
 *
 * 回落约定：调用方读表时一律写「表里没写就用代码缺省值顶上」（`?? 缺省值`），缺省值
 * 与今天的行为一致。所以字段都是可选的：删掉哪个字段，调用方就回到今天的数，不炸。
 *
 * 不进表的（记名在此，理由见 #1069 正文）：
 *   · 单次工具调用总预算 300000（src/refresh/rooms/host/tool-call-budget-enforcement.ts:25）与其孪生兄弟
 *     （src/deck/registration/register-options.ts:39）：后者零导入引不了表，且有门禁
 *     看守两处同值，单搬一边必炸另一边，等统一数值那张票再动；
 *   · wiring.js 的本地读 5000、call-budget 的余量 15000 与单次钳制 30000：与表里
 *     的 15000 同值不同命，本轮只搬运不统一，不收。
 *
 * #1215 起本表的时间字段（deckEnsureTimeoutMs）真引中央时间参数：
 * config/timeouts.yaml 的 deckEnsureMs 键经 src/shared/time-config/values.js 生成
 * DECK_ENSURE_TIMEOUT_MS，本表直接用它，不再写数字字面量；
 * tests/verify-time-config.ts 断言两者相等。调时间请改 YAML。
 */
import { DECK_ENSURE_TIMEOUT_MS } from '../../shared/time-config/values.js'

/** 调参表的形状：三个字段都可选，缺字段时调用方用代码缺省值顶上。 */
export interface SharedTuning {
  /** 读桶上限；调用方 src/refresh/rooms/host/outbound-admission.ts 读取，缺字段时回落到 64。 */
  readBucketMax?: number
  /** 写桶上限；调用方同上，缺字段时回落到 16。 */
  writeBucketMax?: number
  /** deck 调用前置保读数等待；真源是 config/timeouts.yaml 的 deckEnsureMs（生成 DECK_ENSURE_TIMEOUT_MS）。 */
  deckEnsureTimeoutMs?: number
}

/**
 * 调参表当前值（每次改数字都要在这里写清依据，不要只改值）：
 *   · 读 64：#1224 按 2026-10-28 实测定为终值（同时在飞需求峰值 65，93.8% 不排队）；
 *   · 写 16：#1224 补测写需求峰值 6，16 留约两倍半余量；
 *   · 保读数 15000 毫秒：前置保读的等待上限，真源是 config/timeouts.yaml 的 deckEnsureMs。
 */
export const TUNING: SharedTuning = {
  readBucketMax: 64,
  writeBucketMax: 16,
  deckEnsureTimeoutMs: DECK_ENSURE_TIMEOUT_MS,
}
