/**
 * seam/editor.js · B5 editor 绑定（issuePath 胶囊识别/注入）
 *
 * R1 接口：editor.inject(st, text) + editor.issuePath.extract(text)
 *   dev：宿主通过 host.call('wf.issuePathPush'/'wf.issuePathPoll') 上报
 *   pkg：同通过 rpcCall('issuePathPush'/'issuePathPoll') 上报（B3 通道承接）
 *
 * 覆盖 D6/D8：npm 版 extractIssueRefs + recordIssuePath + wf.issuePathPush 的机制差异。
 * 该绑定把「从文本提取 issue 引用 / 记录胶囊路径」收敛为方言无关的小工具。
 */

/** 从文本中提取 #数字 引用（双方言一致）。 */
export function extractIssueRefs(text) {
  if (typeof text !== 'string') return []
  const seen = new Set()
  const out = []
  const re = /(?:^|\s)#(\d{1,7})(?=\s|$|[，,。.、）)\]])/g
  let m
  while ((m = re.exec(text)) !== null) {
    const n = Number(m[1])
    if (!seen.has(n)) { seen.add(n); out.push(n) }
  }
  return out
}

/** 记录 issuePath 胶囊（双方言一致的本地记账；真正的上报走 rpc/host 通道）。 */
export function recordIssuePath(st, number) {
  if (!st || !number) return
  const list = st.issuePathRefs || (st.issuePathRefs = [])
  if (!list.includes(number)) list.push(number)
}

export const describe = () => ({
  b: 'B5',
  name: 'editor',
  covers: ['D6/D8 issuePath 识别/注入机制差异'],
  dev: 'host.call("wf.issuePathPush"...)',
  pkg: 'rpcCall("issuePathPush"...)（B3 通道）',
})
