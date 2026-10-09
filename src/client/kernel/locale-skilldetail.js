/**
 * src/client/kernel/locale-skilldetail.js — 内核模块（887 技能详情像素风的中英词条）。
 *
 * 契约：本文件为模块真源（ESM 导出）；scripts/build.mjs 在构建时去掉每行行首
 * export 关键字，把声明体文本拼回 src/client/index.js 的拼接标记处（apply 闭包内
 * 原位），与 locale-skilldesc.js 同模式，一源两物，src 零复制。
 * 由 locale.js 的合并器一起并进 L，界面只认 tr('sd.*')。
 *
 * 键口径：sd.* 全是详情页自己的话术。按钮只转圈不换字，所以没有“加载中”这种键；
 * 缺文那段不带正文短描述——短描述是每篇自己的 use，由调用方当 prop 传进来。
 */
    export const L_SKILLDETAIL = {
      zh: {
        'sd.listTitle': '■ 技能',
        'sd.detailBtn': '详情',
        'sd.copy': '复制链接',
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
        'sd.fail': '读文件失败：包里找不到这一篇',
        'sd.miss': '这篇没有随包原文',
        'sd.missBody': '包里没有这一篇，不编内容。下面保留短描述：',
        'sd.noBody': '正文没拿到，原因见上面横幅，点重试再拉一次。',
        'sd.toZh': '中文',
        'sd.toEn': 'EN',
        'sd.openLink': '原图链接',
      },
      en: {
        'sd.listTitle': '■ Skills',
        'sd.detailBtn': 'Details',
        'sd.copy': 'Copy link',
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
        'sd.fail': 'Read failed: not in the bundle',
        'sd.miss': 'No bundled copy for this one',
        'sd.missBody': 'There is no bundled copy for this one, so nothing is made up. Short description kept:',
        'sd.noBody': 'Body not loaded, see the banner above. Retry to fetch again.',
        'sd.toZh': '中文',
        'sd.toEn': 'EN',
        'sd.openLink': 'Open link',
      },
    }
