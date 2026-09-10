/**
 * src/shared/tracker/list-dedupe.js —— 面板列表数组按身份去重（#589）。
 *
 * 以后谁改它：改面板主列表“同一身份只出现一行”口径的人。纯函数，无依赖，
 * 宿主经动态 import 引用（D7 禁止静态 import），测试直接引用。
 *
 * 背景：一张票可以身兼两职——既是地图容器，又是另一张地图的子票
 * （经维护者确认为合法设计，数据不动）。宿主把快照拼成面板列表数组时，
 * 按“地图容器、所有地图的子票、未挂图的票”三段拼接，身兼两职的票在数组里
 * 出现两次；列表按“带地图标签即地图行”画行，于是画出两行像素级相同的行。
 * 本函数在拼完后收一次：同一身份只留第一次出现的那一行；
 * 调用方保持“地图容器在前”即等于地图容器优先；
 * 子票归属（地图名下的子票数组）不动，父地图详情页照常显示父子关系。
 */

/**
 * 池内身份：与快照组装层同规则——同 key 但是否为拉取请求不同，是两个东西，
 * 不互相吞。无该字段的后端省略该字段（保持裸 key）；字段在但不是布尔值单独隔离。
 * key 缺失时回落 number；两者都没有的条目指认不出身份，返回空，由调用方原样保留。
 * 后缀只是对象键里的区分标记，不外流。
 * effort 维度：身份含工作单元——不同工作单元的同号票是两张票，不许互相吞
 * （单工作单元后端 effortId 为空或缺失，退化成老口径，行为不变）。
 */
export function poolIdOf(entry) {
  if (!entry || (entry.key == null && entry.number == null)) return null
  const e = entry.effortId === undefined || entry.effortId === null ? '' : String(entry.effortId)
  const k = String(entry.key != null ? entry.key : entry.number)
  const base = e ? e + '|' + k : k
  if (!Object.prototype.hasOwnProperty.call(entry, 'isPullRequest')) return base
  if (entry.isPullRequest === true) return base + '|pr'
  if (entry.isPullRequest === false) return base + '|issue'
  return base + '|bad'
}

/**
 * 列表去重：同一身份只留第一次出现的那一行。
 * 调用方须保持三段拼接顺序（地图容器在前、子票和孤儿票在后），
 * 先到先留即等于地图容器优先；不改输入数组。
 */
export function dedupeListByPool(list) {
  if (!Array.isArray(list)) return list
  const seen = {}
  const out = []
  for (let i = 0; i < list.length; i++) {
    const it = list[i]
    if (!it) continue
    const id = poolIdOf(it)
    if (id === null) { out.push(it); continue }
    if (seen[id]) continue
    seen[id] = true
    out.push(it)
  }
  return out
}
