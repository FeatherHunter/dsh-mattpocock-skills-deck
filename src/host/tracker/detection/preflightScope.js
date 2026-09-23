/**
 * tracker/detection/preflightScope.js — 一次评估里的环境预检复用（#709 · T5 补）
 *
 * 要解决的问题（票面硬要求）：环境预检（登录态「gh auth status」、仓库可达「gh api repos/…」）
 * 不是实时数据，一次检查链求值里却被问了两遍 —— 探测级联的 preflight 问一遍，后端链的两个谓词
 * （gh:authed / gh:repoAccess）各自再问一遍。一次求值因此花 5 条 REST（登录态 ×2、仓库可达 ×2，
 * 另加取当前登录用户名 1 条），票面要求降到 3 条。
 *
 * 做法：一次评估开始时开一个作用域，把「这一次评估里已经问过的那两条预检命令」的结论放在里面。
 * 同一轮里谁再问同样的命令，直接拿上一次那份，不再另起进程。下面这个函数是**包在真正执行命令那层
 * 外面的一层**：宿主的两条出站路（platformChannel 的 detectionExec、repoKeys 的 runGh）都从它走，
 * 于是「探测级联的预检」与「后端链的谓词」用的是同一份结论。
 *
 * 为什么按命令原文认（而不是按「谁在问」）：这样它不认识调用方是谁，也就不可能被某一处改口径带偏；
 * 而且真正费钱的判据本来就是「这条命令这一次评估里发了几遍」。
 *
 * 三条边界（写在这里，免得以后有人把它改成缓存）：
 *   ① **不是缓存，是复用位**：它绑在一次评估上，评估结束（一次 wf.chain 调用返回）就随对象一起丢掉，
 *      模块级、盘上都不留 —— 下一次评估照样重新问一次外部。这样做的原因是环境预检的寿命另有真源
 *      （refresh-core 的 backoff.ts：成功 10 分钟、失败立刻重试一次），跨评估的寿命归那条纯函数裁定，
 *      本文件不越过它自己攒一份缓存。
 *   ② **不跨评估串味**：两次评估各拿一个自己的作用域，谁也不读别人的结论（也没有东西可读 —— 用完即弃）。
 *   ③ **只复用这两条、只复用成功的**：环境预检成名的那两条命令（登录态、仓库可达）；失败的那一份
 *      不留下（下一问照样真问一次），因为「失败之后还允不允许立刻再试一次」由 refresh-core 的
 *      preflightRetryAllowed 定（上限 1 次，防重试风暴），本文件不替它做决定。
 *
 * 日志：新增内存复用位这一类东西要留日志点（AGENTS.md 的埋点纪律）。按 docs/design/335-logging-contract.md
 * 第 3 章判定，它属于「调用次数少、但要看得见命中/未命中」的那一类，所以记成**按需**（debug 级，
 * 只在调试开关打开时落盘），由调用方（src/host/detectChain.js）在这一次求值结束时记一行
 * chain.preflight.reuse：只记工作区短指纹、两个枚举（检查名、这次是复用还是真问）与条数，
 * 不记命令原文、不记路径原文。
 * 本文件自己不记 —— 它不持有宿主那套日志出口，也不该为了记一行去要一个。
 *
 * 证据还有第二份，而且更硬：每次真跨出去的进程都由 platformChannel 的 exec.run 记一行
 *（via 记的是调用链名），「这一轮问了几次」从那几行数得出来 —— 本票要它变少的就是那几条。
 */

/** 环境预检成名的那两条命令（argv[0] 与参数分开写：gh 这个程序名可能带路径、也可能是裸名字）。 */
const PREFLIGHT_COMMANDS = [
  { cmd: 'gh', head: ['auth', 'status'] },
  { cmd: 'gh', head: ['api', 'repos/'] },
]

/** argv[0] 是不是 gh（带路径也认：真机上 runGh 传的是解析出来的完整路径）。 */
function isGh(cmd) {
  return /(^|[\\/])gh(\.exe)?$/i.test(String(cmd || ''))
}

/**
 * 这一条调用是不是成名的环境预检。
 * 「仓库可达」按前缀认 `api repos/`，因为它后面跟着的是 owner/name，逐字比不出来。
 */
export function isPreflightCommand(cmd, args) {
  if (!isGh(cmd)) return false
  const parts = (args || []).map(String)
  for (let i = 0; i < PREFLIGHT_COMMANDS.length; i++) {
    const want = PREFLIGHT_COMMANDS[i].head
    let hit = true
    for (let k = 0; k < want.length; k++) {
      const got = String(parts[k] == null ? '' : parts[k])
      const okPiece = (want[k].slice(-1) === '/') ? got.indexOf(want[k]) === 0 : got === want[k]
      if (!okPiece) { hit = false; break }
    }
    if (hit) return true
  }
  return false
}

/** 这条调用的身份键：只取决定「问的是不是同一件事」的那几个字段，绝不含工作区路径原文。 */
function keyOf(cmd, args, opts) {
  const o = opts || {}
  const parts = [
    String(cmd || ''),
    (args || []).map(String).join(' '),
    String(o.cwd || ''),
    (o.timeout == null ? '' : String(o.timeout)),
  ]
  return parts.join('\u0000')
}

/**
 * 开一次评估的环境预检复用位。
 * @param {(cmd: string, args: string[], opts: object) => Promise<any>} exec 真正执行命令的那一下
 * @returns {{ exec: Function, asked: () => number, reused: () => number }}
 */
export function createPreflightScope(exec) {
  // 这一次评估里已经问出结论的预检：键 = 上面那串身份键，值 = 结论 + 被复用了几次。
  // 只用 Map 记「这两条命令」，其他命令一律直通 —— 一次评估里别的东西该问几次还问几次。
  const answered = new Map()

  /**
   * 包了一层的外部命令执行器。**签名与原来一模一样**，调用方不需要知道有这一层。
   *
   * 命中条件只有两条：① 这条命令是成名的环境预检；② 上一次问的结论是成功的。
   * 为什么只复用成功的：失败不缓存（与 refresh-core 的 preflightUsable 同一口径），
   * 免得一次网络抖动被同一轮后面的调用当成「已经问过了」。
   */
  function scopedExec(cmd, args, opts, via) {
    const a = args || []
    if (!isPreflightCommand(cmd, a)) return exec(cmd, a, opts, via)
    const key = keyOf(cmd, a, opts)
    const hit = answered.get(key)
    if (hit) { hit.hits += 1; return Promise.resolve(hit.value) }
    return Promise.resolve()
      .then(function () { return exec(cmd, a, opts, via) })
      .then(function (value) {
        // 成功才留下 —— 失败那份不缓存（与 refresh-core 的 preflightUsable 同一口径）。
        // 两条出站路的成功形状不同（detectionExec 回 code，runGh 回 ok/kind），所以两种都认。
        if (value && (value.ok === true || value.code === 0)) answered.set(key, { value: value, hits: 0 })
        return value
      })
  }

  return {
    exec: scopedExec,
    /**
     * 这一次评估里真问过几次外部（几条不同的预检命令各算一次）。
     * 供调用方在求值结束时记一行日志、供门禁读；不含命令原文。
     */
    asked: function () { return answered.size },
    /**
     * 这一次评估里省掉了几次外部问答（同一轮里第二次、第三次来问同一条命令的次数合计）。
     * 这个数 > 0 才是「复用真的发生了」；等于 0 说明这一轮压根没重复问（或者复用位没起作用）。
     */
    reused: function () {
      let n = 0
      answered.forEach(function (v) { n += Number(v && v.hits) || 0 })
      return n
    },
  }
}

export default createPreflightScope
