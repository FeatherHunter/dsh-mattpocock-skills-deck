/**
 * src/client/kernel/locale-skilldetail.ts — 887 技能详情像素风中英词条的 TS 真源。
 *
 * 契约：本文件为真源；构建经 esbuild 转译出同名 .js（AUTO-GENERATED 头），再剥行首 export
 * 拼回 src/client/index.js 的拼接标记处，与 locale-skilldesc.ts 同模式（一源两物，src 零复制）。
 * 由 locale.js 的合并器一起并进 L，界面只认 tr('sd.*')。
 *
 * 键口径：sd.* 全是详情页自己的话术。按钮只转圈不换字，所以没有“加载中”这种键；
 * 缺文那段不带正文短描述——短描述是每篇自己的 use，由调用方当 prop 传进来。
 */
export const L_SKILLDETAIL: { zh: Record<string, string>; en: Record<string, string> } = {
  zh: {
    'sd.listTitle': '■ 技能',
    'sd.detailBtn': '详情',
    'sd.copy': '复制链接',
    'sd.copyPath': '复制路径',
    'sd.retry': '重试',
    'sd.dismiss': '关闭',
    'sd.close': '关闭 ✕',
    'sd.top': '顶部 ↑',
    'sd.copied': '已复制',
    'sd.toc': '■ 本篇目录',
    'sd.idle': '点上面任意一行的“详情”开始。',
    'sd.none': '还没打开任何详情。',
    'sd.fetch': '正在取文件…',
    'sd.parse': '正在解析…',
    'sd.layout': '正在排版…',
    'sd.layoutSlow': '正在排版…（超过 2 秒）',
    'sd.ready': '内容已到',
    'sd.readyHit': '内容已到（缓存命中）',
    'sd.fail': '没能读到这一篇的原文（可以点重试再试一次）',
    'sd.miss': '这篇没有随包原文',
    'sd.missBody': '包里没有这一篇，不编内容。下面保留短描述：',
    'sd.noBody': '正文没拿到，原因见上面横幅，点重试再拉一次。',
    // 详情栈：人看得到自己压了几层，也知道上限是三层（2026-10-10 人拍板）。
    'sd.stack': '第 {n} 层 / 共 {m} 层',
    'sd.toZh': '中文',
    'sd.toEn': 'EN',
    'sd.openLink': '原图链接',
  },
  en: {
    'sd.listTitle': '■ Skills',
    'sd.detailBtn': 'Details',
    'sd.copy': 'Copy link',
    'sd.copyPath': 'Copy path',
    'sd.retry': 'Retry',
    'sd.dismiss': 'Dismiss',
    'sd.close': 'Close ✕',
    'sd.top': 'Top ↑',
    'sd.copied': 'Copied',
    'sd.toc': '■ Contents',
    'sd.idle': 'Open any Details above to begin.',
    'sd.none': 'No detail open yet.',
    'sd.fetch': 'Fetching file…',
    'sd.parse': 'Parsing…',
    'sd.layout': 'Laying out…',
    'sd.layoutSlow': 'Laying out… (over 2s)',
    'sd.ready': 'Ready',
    'sd.readyHit': 'Ready (cache hit)',
    'sd.fail': 'Could not read this skill text (retry to try again)',
    'sd.miss': 'No bundled copy for this one',
    'sd.missBody': 'There is no bundled copy for this one, so nothing is made up. Short description kept:',
    'sd.noBody': 'Body not loaded, see the banner above. Retry to fetch again.',
    'sd.stack': 'Layer {n} of {m}',
    'sd.toZh': '中文',
    'sd.toEn': 'EN',
    'sd.openLink': 'Open link',
  },
}
