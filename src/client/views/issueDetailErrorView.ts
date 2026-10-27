// views/issueDetailErrorView.ts — Issue 详情页失败横幅的三块内容（从 IssueDetail.ts 抽出，#1573）
// 契约：模块真源（ESM 导出）；scripts/build.mts 构建时剥行首 export 拼回
// src/client/index.ts 的 leaf 标记处（源码树里只有这一份真源，标记 id 与本文件名一致）。
// 为什么单开：IssueDetail.ts 贴着 350 有效行上限（#438 的尺子），而 #1573 要给失败横幅加一条
//   「主行说人话、原文进折叠区」的映射；把三块（主行一句、kind 小标签、原始说明折叠区）整体搬到这里，
//   以后改失败横幅的显示口径只动这个文件，不再往详情页主文件里加行。
// 参数：h = 创建函数；e = api-io 的 dswsNormalizeError 给的那份 {message, kind, raw}。
// 返回：{ say, kind, rawBlock } —— say 是主行一句话；kind 是可选小标签（空串表示没有）；
//   rawBlock 是折叠区要素（没有原文时为 null，调用方直接当子节点放，null 会被 React 忽略）。
declare function tr(...args: any[]): any;

/**
 * 把一份失败对象拆成详情页顶部横幅要用的三样。
 *
 * #1573：GitHub 通路冷却时，后端会诚实回一段很长的技术说明（命令没起进程、冷却还剩多少秒、这笔没执行、
 * 可以直接重试）。这段话对排查有用，但直接铺在主行会压过整页。规则：network 档且后端原文超过 48 字的，
 * 主行换成 detail.err.networkShort 的一句人话，完整原文收进下面的「原始说明」折叠区；
 * 短消息（例如只写「boom」）保持原样，不吞掉本来就短的信息。
 *
 * 两个调用点（无快照的整页横幅、有快照的细横幅）都用这一份，判据不许各写一遍。
 */
export const issueErrorViewOf = function (h: any, e: any): any {
  const said = String((e && e.message) || '').trim()
  const direct = String((e && e.raw) || '').trim()
  const kind = String((e && e.kind) || '').trim()
  const longNetwork = kind === 'network' && said.length >= 48
  const say = longNetwork ? tr('detail.err.networkShort') : (said || tr('list.loadFail'))
  // 长 network 回话被主行换成了人话，这里必须把后端原文补进折叠区，否则「原始说明」反而看不到原因。
  const rawText = longNetwork
    ? (direct ? said + '\n\n' + direct : said)
    : (direct || ((e && typeof e.error === 'string') ? String(e.error).trim() : ''))
  // 折叠条（<summary>）本身始终可见，只能放短提示：长 network 时优先用 raw 里的短标签（例如
  // 「gh admission: transport cooling down」），没有短标签就用主行那句人话；整段技术原文只放进展开后的
  // 正文里，否则会出现「主行降噪了，折叠条却又把长文铺一遍」。
  const rawSummary = longNetwork ? (direct || tr('detail.err.networkShort')) : rawText
  const rawBlock = rawText
    ? h('details', { style: { width: '100%', marginTop: 2, paddingTop: 4, borderTop: '1px solid rgba(248,113,113,.25)' } }, [
      // 本次界面反馈需求：错误原文的折叠条能点，给它悬停反馈、按压态与自己的点击日志。
      //   原文是自由文本，不进定位串。
      h('summary', { className: 'dsws-hov', 'data-press': 'button', 'data-log': 'detail.err.raw.toggle', style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary,#a1a1aa)', cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, tr('vc.fail.raw', { msg: rawSummary })),
      h('div', { style: { marginTop: 4, padding: '6px 8px', background: 'rgba(0,0,0,.18)', border: '1px solid rgba(248,113,113,.25)', borderRadius: 6, fontSize: 11, lineHeight: 1.6, color: 'var(--dsw-alias-label-secondary,#a1a1aa)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 200, overflow: 'auto' } }, rawText),
    ])
    : null
  return { say: say, kind: kind, rawBlock: rawBlock }
}
