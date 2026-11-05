/**
 * src/tracker/rooms/gitlab/labels/shared.ts —— 标签子树里两段共用的「失败原文怎么变成一句人话」。
 *
 * 为什么要有这份小文件：清单（list.ts）与配色（colors.ts）在把远端返回的失败原文拼进给用户看的
 * 提示语时用的是同一条口径——按字符串、message、stderr、stdout、JSON 的顺序找原文，拼进提示语时
 * 截到 160 字。两边各抄一份，将来一边改了一边没改，同一类失败就会出现两种说法。所以只把这两段
 * 纯文字处理放在这里共享。
 *
 * 这里不判错误档位，也不碰请求：档位仍然只走 ../errors.ts 的 classifyGlabError 一个出口，
 * 请求形状仍然只走房间根目录的 requests.ts。
 */

/**
 * 任意错误值 → 可读的一小段文字（给「人家说了什么」那一格用，不当作判档依据）。
 *
 * 按顺序认三种输入：① 直接就是字符串；② 带 message 的对象（Error 与本仓 `fail()` 的返回）；
 * ③ 客户端的进程结果 `{stdout, stderr, code}`——它没有 message 字段，真正有用的原文在 stderr
 * （glab 的报错都写在那儿），stderr 空时退回 stdout。其余对象一律转成 JSON。
 *
 * **绝不用 `String()` 兜底**：对象过 `String()` 得到的是 `[object Object]`，而这段话会被拼进
 * 直接显示给用户的提示语里——「（glab 返回的说明：[object Object]）」等于开了口却什么都没说，
 * 排查的人拿不到任何线索。这是本条注释存在的原因，改回 `String()` 就等于把这个坑重新挖开。
 */
export function errText(err: unknown): string {
  if (typeof err === 'string') return err
  if (err !== null && typeof err === 'object') {
    const bag = err as Record<string, unknown>
    if (typeof bag.message === 'string' && bag.message) return bag.message
    if (typeof bag.stderr === 'string' && bag.stderr.trim()) return bag.stderr
    if (typeof bag.stdout === 'string' && bag.stdout.trim()) return bag.stdout
    try {
      const json = JSON.stringify(err)
      if (json && json !== '{}') return json
    } catch (e) {
      // 循环引用的对象 JSON 化会抛。这里只是想把原文打出来，不该因为「打不出来」让整条操作崩掉，
      // 所以吞掉异常、落到下面那句如实的兜底。
    }
    return '（原始输出无法转成文字）'
  }
  return String(err)
}

/**
 * 列标签/改色失败时的对外一句话：`nativeMessage + 一段原文摘要`。
 *
 * 为什么原文摘要只截一小段：`fail()` 的第三段（raw）里放的是完整原文，界面上人展开就能看全；
 * 这一句是直接显示在提示语里的，太长的进程输出会把正文淹掉。
 */
export function withRawHint(nativeMessage: string, err: unknown): string {
  const text = errText(err).trim().replace(/\s+/g, ' ')
  if (!text) return nativeMessage
  const hint = text.length > 160 ? text.slice(0, 160) + '…（已截断）' : text
  return nativeMessage + '（glab 返回的说明：' + hint + '）'
}
